const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarColor(){},setBackgroundColor(){},pageScrollTo(){},setNavigationBarTitle(){}};
const daily=require('../miniprogram/services/daily'),dictionary=require('../miniprogram/services/dictionary'),media=require('../miniprogram/services/media'),sentences=require('../miniprogram/services/sentences');
const {Pronunciation,exampleCandidates}=require('../miniprogram/services/pronunciation'),{ResourceFiles}=require('../miniprogram/services/dictionary-media');
const sha='a'.repeat(64),example={en:'A little practice helps every day.',zh:'每天练习一点会有帮助。'},entry=word=>({kind:'entry',word,oxford:{mediaVersion:2,sourceSha256:sha,examples:[example],mediaRefs:[{key:'example.wav',kind:'audio',variant:'US',label:'例句 · '+example.en}]}});
function page(name){let definition;const file=path.resolve(__dirname,'../miniprogram/pages',name,'index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value,callback){Object.assign(this.data,copy(value));if(callback)callback();}};for(const [key,value] of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
test.beforeEach(()=>memory.clear());

test('daily examples use the actual dictionary word list, pick a stable bilingual sentence and allow another word',async()=>{
 const old={status:dictionary.status,wordList:dictionary.wordList,lookup:dictionary.lookup};
 dictionary.status=async()=>({oxford:true});dictionary.wordList=async id=>{assert.equal(id,'ox5000:all');return{rows:[{word:'alpha'},{query:'beta'},{word:'ALPHA'},null,{word:'gamma'}]};};dictionary.lookup=async word=>entry(word);
 try{const words=await daily.oxfordWords();assert.deepEqual(words,['alpha','beta','gamma']);const first=await daily.findOxford('2026-11-05',words),again=await daily.findOxford('2026-11-05',words);assert.deepEqual(first,again);assert.equal(first.item.source,'牛津十版');assert.deepEqual([first.item.en,first.item.zh],[example.en,example.zh]);const next=await daily.findOxford('2026-11-05',words,1,{exclude:first.item.word});assert.notEqual(next.item.word,first.item.word);assert.equal(daily.usableExample({en:'a short phrase',zh:'短语'}),false);assert.equal(daily.usableExample({en:'A sentence without translation.',zh:''}),false);dictionary.status=async()=>({oxford:false});assert.deepEqual(await daily.oxfordWords(),[]);}
 finally{Object.assign(dictionary,old);}
});

test('daily listening discards a late lookup after hiding, then resumes with a hidden answer and can read it',async()=>{
 const oldWords=daily.oxfordWords,lookup=dictionary.lookup,speak=media.speakAndWait;let finish,spoken='';daily.oxfordWords=async()=>['alpha'];dictionary.lookup=()=>new Promise(resolve=>{finish=resolve;});
 const controller=page('daily');
 try{controller.onLoad({mode:'listening'});controller.onShow();await tick();assert.equal(controller.data.loading,true);controller.onHide();const snapshot=copy(controller.data);finish(entry('alpha'));await tick();assert.deepEqual(controller.data,snapshot);dictionary.lookup=async()=>entry('alpha');controller.onShow();await tick();assert.equal(controller.data.item.source,'牛津十版');assert.equal(controller.data.revealed,false);assert.equal(controller.data.loading,false);media.speakAndWait=async(text,variant,language,rate,onStart)=>{spoken=text;const data={voice:'Sample',locale:'en-US'};onStart(data);return data;};await controller.onPlay();assert.equal(spoken,example.en);assert.match(controller.data.voiceStatus,/系统合成/);assert.equal(controller.data.busy,false);}
 finally{controller.onUnload();daily.oxfordWords=oldWords;dictionary.lookup=lookup;media.speakAndWait=speak;}
});

test('daily practice retries the dictionary after it becomes available',async()=>{
 const words=daily.oxfordWords,lookup=dictionary.lookup;let attempts=0;daily.oxfordWords=async()=>++attempts===1?[]:['alpha'];dictionary.lookup=async()=>entry('alpha');const controller=page('daily');
 try{controller.onLoad({});controller.onShow();await tick();assert.equal(controller.data.item.source,'原创学习例句');controller.onChange();await tick();assert.equal(controller.data.item.source,'牛津十版');assert.equal(attempts,2);}
 finally{controller.onUnload();daily.oxfordWords=words;dictionary.lookup=lookup;}
});

test('example audio requires the full example and requested accent, with strict original mode and explicit fallback',async()=>{
 const ref=entry('alpha'),refs=ref.oxford.mediaRefs;refs.push({key:'wrong-accent.wav',kind:'audio',variant:'UK',label:'例句 · '+example.en},{key:'other.wav',kind:'audio',variant:'US',label:'例句 · Another sentence.'},{key:'truncated.wav',kind:'audio',variant:'US',label:'例句 · '+('x'.repeat(195))});
 assert.deepEqual(exampleCandidates(ref,example.en,'US').map(row=>row.key),['example.wav']);assert.deepEqual(exampleCandidates(ref,'x'.repeat(195),'US'),[]);
 const speaker=new Pronunciation(),original=media.playLocal,speak=media.speakAndWait;let file='',synthesized=0;
 speaker.files={cancel(){},release(){},resolve:async rows=>({available:true,rows:rows.map(row=>({key:row.key,available:true,bytes:32}))}),download:async row=>row.key};media.playLocal=async(value,onStart)=>{file=value;onStart();return{};};media.speakAndWait=async(text,variant,language,rate,onStart)=>{synthesized++;const data={locale:'en-US'};onStart(data);return data;};
 try{const actual=await speaker.play(ref,{text:example.en,kind:'example',variant:'US',mode:'original'});assert.equal(file,'example.wav');assert.equal(actual.kind,'original');await assert.rejects(speaker.play(ref,{text:'This sentence is not in the source.',kind:'example',variant:'US',mode:'original'}),/未提供此例句/);assert.equal(synthesized,0);const fallback=await speaker.play(ref,{text:'This sentence is not in the source.',kind:'example',variant:'US',mode:'auto'});assert.equal(fallback.kind,'tts');assert.match(fallback.reason,/未提供此例句/);assert.equal(synthesized,1);}
 finally{speaker.release();media.playLocal=original;media.speakAndWait=speak;}
});

test('turning the example page cancels the pending sentence and ignores its late completion',async()=>{
 const play=Pronunciation.prototype.play;let finish;Pronunciation.prototype.play=function(_entry,options){options.onStart({kind:'original',variant:'US'});return new Promise(resolve=>{finish=resolve;});};const controller=page('entry');controller._entry=entry('alpha');controller.setData({source:'examples'});controller.contentPage(0);
 try{const pending=controller.onSpeakExample({currentTarget:{dataset:{index:0}}});assert.equal(controller.data.speakingExample,0);assert.match(controller.data.exampleStatus,/原版录音/);controller.onNext();assert.equal(controller.data.speakingExample,-1);assert.equal(controller.data.exampleStatus,'');finish({kind:'original'});await pending;assert.equal(controller.data.speakingExample,-1);assert.equal(controller.data.exampleStatus,'');}
 finally{controller.onUnload();Pronunciation.prototype.play=play;}
});

test('saving the same example again preserves its note and source, while an explicit edit can clear the note',()=>{
 sentences.save(example.en,example.zh,'最初来源','自己的笔记');sentences.save(example.en,example.zh,'另一个入口');let card=sentences.list()[0];assert.equal(card.note,'自己的笔记');assert.equal(card.source,'最初来源');sentences.save(card.en,card.zh,card.source,'',card.id);card=sentences.list()[0];assert.equal(card.note,'');assert.equal(sentences.list().length,1);
});
