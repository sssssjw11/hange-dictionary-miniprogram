const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarTitle(){},pageScrollTo(){},navigateTo(){}};
const codec=require('../miniprogram/vendor/codec'),dictionary=require('../miniprogram/services/dictionary'),media=require('../miniprogram/services/media'),study=require('../miniprogram/services/study'),store=require('../miniprogram/utils/store');
const {ResourceFiles}=require('../miniprogram/services/dictionary-media'),audio=require('../miniprogram/services/wordlist-audio');
const sha='a'.repeat(64),row={word:'for the purpose of',query:'for the purpose of',relatedWord:'purpose',audio:{UK:['phrase-gb.mp3'],US:['phrase-us.mp3']}};
function page(name){let definition;const file=path.resolve(__dirname,'../miniprogram/pages',name,'index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value,callback){Object.assign(this.data,copy(value));if(callback)callback();}};for(const [key,value] of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
test.beforeEach(()=>memory.clear());

test('source list records preserve only explicit, safe British and American audio references',()=>{
 const html='<ul><li data-hw="a phrase"><a class="pron-uk" href="sound://SAME.mp3"></a><a class="pron-uk" href="sound://same.mp3"></a><a class="pron-us" href="sound://same.mp3"></a><a class="pron-us" href="sound://us.wav"></a><a class="pron-uk" href="sound://folder/../evil.mp3"></a><a class="pron-uk" href="https://example.invalid/no.mp3"></a><a href="sound://unknown.mp3"></a><a class="pron-uk" href="sound://image.png"></a></li></ul>';
 const rows=codec.parseWordList(html),descriptor=codec.describeWordLists(['@topic_test']).find(item=>item.id==='topic:test:all');
 assert.deepEqual(rows[0].audio,{UK:['same.mp3'],US:['same.mp3','us.wav']});assert.deepEqual(codec.selectWordList(rows,descriptor).rows[0].audio,rows[0].audio);
 assert.deepEqual(audio.references(rows[0],sha).map(item=>[item.variant,item.key]),[['UK','same.mp3'],['US','same.mp3'],['US','us.wav']]);
 const existing={word:'a phrase',oxford:{mediaVersion:2,sourceSha256:'b'.repeat(64),mediaRefs:[{kind:'audio',variant:'UK',key:'wrong.mp3',pronunciationText:'a phrase'}]}};
 assert.deepEqual(audio.withSource(existing,rows[0],sha).oxford.mediaRefs.map(item=>item.key),['same.mp3','same.mp3','us.wav']);assert.equal(existing.oxford.sourceSha256,'b'.repeat(64));
});

test('list row prefers its own exact recording and distinguishes missing MDD from synthesized speech',async()=>{
 const old={lookup:dictionary.lookup,resolve:ResourceFiles.prototype.resolve,download:ResourceFiles.prototype.download,play:media.playLocal,speak:media.speakAndWait};let selected,tts=0,available=true,controller;
 dictionary.lookup=async()=>{throw new Error('should not need another entry');};ResourceFiles.prototype.resolve=async(rows,source)=>{assert.equal(source,sha);selected=rows.map(item=>item.key);return{available,reason:'未导入 MDD',rows:rows.map(item=>({key:item.key,available,bytes:64}))};};ResourceFiles.prototype.download=async item=>item.key;media.playLocal=async(file,start)=>{assert.equal(file,'phrase-gb.mp3');start();return{};};media.speakAndWait=async(text,variant,language,rate,start)=>{tts++;start({locale:'en-GB'});return{locale:'en-GB'};};
 try{store.saveSettings({voiceMode:'original',voiceVariant:'UK'});controller=page('wordlist');controller.onLoad({oxford:'opal:written:phrases'});controller._sourceList={sourceSha256:sha,rows:[row]};await controller.onOxfordSpeak({currentTarget:{dataset:{index:0}}});assert.deepEqual(selected,['phrase-gb.mp3']);assert.match(controller.data.voiceInfo,/原版录音/);
  available=false;store.saveSettings({voiceMode:'auto'});await controller.onOxfordSpeak({currentTarget:{dataset:{index:0}}});assert.equal(tts,1);assert.match(controller.data.voiceInfo,/系统合成.*未导入 MDD/);
  store.saveSettings({voiceMode:'original'});await controller.onOxfordSpeak({currentTarget:{dataset:{index:0}}});assert.equal(tts,1);assert.match(controller.data.voiceInfo,/未导入 MDD/);
 }finally{if(controller)controller.onUnload();dictionary.lookup=old.lookup;ResourceFiles.prototype.resolve=old.resolve;ResourceFiles.prototype.download=old.download;media.playLocal=old.play;media.speakAndWait=old.speak;}
});

test('source-only phrases retain their recording in player and review without inventing a grade',async()=>{
 const old={lookup:dictionary.lookup,list:dictionary.wordList,resolve:ResourceFiles.prototype.resolve,download:ResourceFiles.prototype.download,play:media.playLocal};let played=[],player,review;
 dictionary.lookup=async()=>({kind:'missing'});dictionary.wordList=async()=>({sourceSha256:sha,rows:[row]});ResourceFiles.prototype.resolve=async rows=>({available:true,rows:rows.map(item=>({key:item.key,available:true,bytes:64}))});ResourceFiles.prototype.download=async item=>item.key;media.playLocal=async(file,start)=>{played.push(file);start();return{};};
 try{const id=study.importSourceDeck('opal:written:phrases','OPAL',[row.word]);store.saveSettings({voiceMode:'original',voiceVariant:'UK'});player=page('player');player.onLoad({deck:id});await tick();await player.onPlay();assert.equal(player.data.error,'');assert.deepEqual(played,['phrase-gb.mp3']);
  review=page('review');review.onLoad({deck:id,mode:'flash'});await tick();assert.equal(review.data.sourceOnly,true);assert.equal(review.data.relatedWord,'purpose');await review.onSpeak({currentTarget:{dataset:{variant:'US'}}});assert.deepEqual(played,['phrase-gb.mp3','phrase-us.mp3']);review.onGrade({currentTarget:{dataset:{grade:'good'}}});assert.equal(study.stats().today.attempts,0);
 }finally{if(player)player.onUnload();if(review)review.onUnload();dictionary.lookup=old.lookup;dictionary.wordList=old.list;ResourceFiles.prototype.resolve=old.resolve;ResourceFiles.prototype.download=old.download;media.playLocal=old.play;}
});

test('hiding the player while source list loading prevents late playback',async()=>{
 const old={lookup:dictionary.lookup,list:dictionary.wordList,play:media.playLocal};let finish,played=0,controller;
 dictionary.lookup=async()=>({kind:'missing'});dictionary.wordList=()=>new Promise(resolve=>{finish=resolve;});media.playLocal=async()=>{played++;return{};};
 try{const id=study.importSourceDeck('opal:spoken:phrases','OPAL',[row.word]);controller=page('player');controller.onLoad({deck:id});await tick();const pending=controller.onPlay();await tick();controller.onHide();finish({sourceSha256:sha,rows:[row]});await pending;assert.equal(played,0);assert.equal(controller.data.playing,false);}
 finally{if(controller)controller.onUnload();dictionary.lookup=old.lookup;dictionary.wordList=old.list;media.playLocal=old.play;}
});
