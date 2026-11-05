const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarTitle(){},pageScrollTo(){}};
const codec=require('../miniprogram/vendor/codec'),media=require('../miniprogram/services/media'),dictionary=require('../miniprogram/services/dictionary'),study=require('../miniprogram/services/study'),backup=require('../miniprogram/services/backup');
const {Pronunciation,candidates,voiceLabel}=require('../miniprogram/services/pronunciation'),{ResourceFiles}=require('../miniprogram/services/dictionary-media');
const sourceSha='a'.repeat(64),row=(key,text,variant='UK')=>({key,kind:'audio',variant,pronunciationText:text,label:text+' pronunciation'});
const entry={kind:'entry',word:'analysis',phonetics:{uk:'UK-IPA',us:'US-IPA'},brief:'analysis meaning',oxford:{mediaVersion:2,sourceSha256:sourceSha,mediaRefs:[row('lemma.wav','analysis'),row('plural.wav','analyses')]}};
function page(name){let definition;const file=path.resolve(__dirname,'../miniprogram/pages',name,'index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value,callback){Object.assign(this.data,copy(value));if(callback)callback();}};for(const [key,value] of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
test.beforeEach(()=>memory.clear());

test('only explicit word phonetic recordings match, preserving inflections and checking every candidate in bounded batches',async()=>{
 const html='<div class="phons_br"><a class="pron-uk" href="sound://lemma.wav" title="analysis pronunciation English"></a></div><div class="inflections"><div class="phons_br"><a class="pron-uk" href="sound://plural.wav" title="analyses pronunciation English"></a></div></div><audio-wr><a class="pron-uk" href="sound://example.wav" title="analyses pronunciation English"></a></audio-wr>';
 const rendered=codec.renderOxford([{word:'analysis',html}]);assert.equal(rendered.mediaVersion,2);assert.deepEqual(candidates({oxford:rendered},'analyses','UK').map(row=>row.key),['plural.wav']);assert.deepEqual(candidates({oxford:rendered},'analyses','US'),[]);
 const original=media.playLocal,speaker=new Pronunciation(),batches=[];let file;
 speaker.files={cancel(){},release(){},resolve:async rows=>{batches.push(rows.length);return{available:true,rows:rows.map(row=>({key:row.key,available:row.key==='candidate26.wav',bytes:64}))};},download:async row=>row.key};
 media.playLocal=async(value,start)=>{file=value;if(start)start();return{};};
 try{const result=await speaker.play({word:'analysis',oxford:{mediaVersion:2,sourceSha256:sourceSha,mediaRefs:Array.from({length:27},(_,i)=>row('candidate'+i+'.wav','analysis'))}},{variant:'UK',mode:'original'});assert.equal(file,'candidate26.wav');assert.deepEqual(batches,[24,3]);assert.equal(voiceLabel(result),'英式 · 原版录音');
  const lookup=dictionary.lookup,old=copy(entry);old.oxford.mediaVersion=1;old.note='keep';const before=copy(old);dictionary.lookup=async()=>({word:'analysis',kind:'entry',oxford:{mediaVersion:2,sourceSha256:sourceSha,mediaRefs:[row('candidate26.wav','analysis')]}});
  try{await speaker.play(old,{variant:'UK',mode:'original'});assert.deepEqual(old,before);assert.equal(file,'candidate26.wav');}finally{dictionary.lookup=lookup;}
 }
 finally{media.playLocal=original;speaker.release();}
});

test('automatic and strict source modes remain distinct and missing MDD status is reused without repeated requests',async()=>{
 const original=media.speakAndWait,speaker=new Pronunciation();let queries=0,tts=0;
 speaker.files={cancel(){},release(){},resolve:async()=>{queries++;return{available:false,reason:'未导入 MDD',rows:[]};}};
 media.speakAndWait=async(text,variant,language,rate,start)=>{tts++;const data={locale:'en-US',variantFallback:variant==='UK'};if(start)start(data);return data;};
 try{const info=await speaker.play(entry,{variant:'UK'});assert.match(voiceLabel(info),/系统合成.*未安装所选口音/);await speaker.play(entry,{text:'analyses',variant:'UK'});assert.equal(queries,1);assert.equal(tts,2);await assert.rejects(speaker.play(entry,{variant:'UK',mode:'original'}),/未导入 MDD/);assert.equal(tts,2);await speaker.play(entry,{variant:'UK',mode:'tts'});assert.equal(queries,1);assert.equal(tts,3);}
 finally{media.speakAndWait=original;speaker.release();}
});

test('cancelling during either resource resolution or download never starts original or synthesized playback later',async()=>{
 const speak=media.speakAndWait,play=media.playLocal;let played=0;media.speakAndWait=media.playLocal=async()=>{played++;return{};};
 try{for(const phase of ['resolve','download']){let finish;const speaker=new Pronunciation();speaker.files={cancel(){},release(){},resolve:rows=>phase==='resolve'?new Promise(resolve=>{finish=()=>resolve({available:true,rows:rows.map(row=>({key:row.key,available:true,bytes:64}))});}):Promise.resolve({available:true,rows:rows.map(row=>({key:row.key,available:true,bytes:64}))}),download:()=>new Promise(resolve=>{finish=()=>resolve('owned.wav');})};const pending=speaker.play(entry,{variant:'UK'});await tick();speaker.release();finish();assert.deepEqual(await pending,{cancelled:true});}assert.equal(played,0);}
 finally{media.speakAndWait=speak;media.playLocal=play;}
});

test('word player uses the requested inflection, retains its source mode in backup, and does not mark listening as review',async()=>{
 const lookup=dictionary.lookup,resolve=ResourceFiles.prototype.resolve,download=ResourceFiles.prototype.download,play=media.playLocal;let played;
 dictionary.lookup=async()=>copy(entry);ResourceFiles.prototype.resolve=async rows=>({available:true,rows:rows.map(row=>({key:row.key,available:true,bytes:64}))});ResourceFiles.prototype.download=async row=>row.key;media.playLocal=async(file,start)=>{played=file;if(start)start();return{};};let controller,resumed;
 try{const id=study.createDeck('Inflection','analyses');controller=page('player');controller.onLoad({deck:id});await tick();controller.onVariant({currentTarget:{dataset:{variant:'UK'}}});controller.onVoiceMode({currentTarget:{dataset:{mode:'original'}}});await controller.onPlay();assert.equal(played,'plural.wav');assert.equal(controller.data.message,'本轮播放完成');assert.equal(controller.data.phonetic,'');assert.equal(study.stats().today.attempts,0);assert.equal(backup.parse(backup.exportAll()).records.study.playback.voiceMode,'original');resumed=page('player');resumed.onLoad({deck:id});await tick();assert.equal(resumed.data.voiceMode,'original');}
 finally{if(controller)controller.onUnload();if(resumed)resumed.onUnload();dictionary.lookup=lookup;ResourceFiles.prototype.resolve=resolve;ResourceFiles.prototype.download=download;media.playLocal=play;}
});

test('moving to the next review card cancels an in-flight pronunciation without changing review grades',async()=>{
 const lookup=dictionary.lookup,resolve=ResourceFiles.prototype.resolve,download=ResourceFiles.prototype.download,play=media.playLocal;let finish,played=0,controller;
 dictionary.lookup=async word=>word==='analyses'?copy(entry):{kind:'entry',word,brief:'next meaning'};ResourceFiles.prototype.resolve=async rows=>({available:true,rows:rows.map(row=>({key:row.key,available:true,bytes:64}))});ResourceFiles.prototype.download=()=>new Promise(resolve=>{finish=()=>resolve('plural.wav');});media.playLocal=async()=>{played++;return{};};
 try{const id=study.createDeck('Review','analyses\nrun');controller=page('review');controller.onLoad({deck:id,mode:'flash'});await tick();const speaking=controller.onSpeak({currentTarget:{dataset:{variant:'UK'}}});await tick();controller.onSkip();finish();await speaking;await tick();assert.equal(controller.data.word,'run');assert.equal(controller.data.speakingVariant,'');assert.equal(played,0);assert.equal(study.stats().today.attempts,0);}
 finally{if(controller)controller.onUnload();dictionary.lookup=lookup;ResourceFiles.prototype.resolve=resolve;ResourceFiles.prototype.download=download;media.playLocal=play;}
});
