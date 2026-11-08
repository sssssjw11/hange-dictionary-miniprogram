const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));let packets=0;
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarTitle(){},pageScrollTo(){}};
const library=require('../miniprogram/services/library'),media=require('../miniprogram/services/media'),study=require('../miniprogram/services/study'),dictionary=require('../miniprogram/services/dictionary');
function page(){let definition;const file=path.resolve(__dirname,'../miniprogram/pages/reader/index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value){packets++;Object.assign(this.data,copy(value));}};for(const [key,value] of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
test.beforeEach(()=>{memory.clear();packets=0;});

test('continuous reading waits for each page to end, advances progress, and keeps source text and learning records',async()=>{
 const speak=media.speakAndWait,spoken=[],waiting=[],text='A useful reading example. '.repeat(180),id=library.add('Reading',text),mark=library.mark(id,0,1,'Keep this note'),controller=page();
 media.speakAndWait=(value,variant,language,rate,start)=>{spoken.push(value);assert.equal(language,'en');start({locale:'en-US',voice:'Sample voice'});return new Promise(resolve=>waiting.push(resolve));};
 try{controller.onLoad({id});const playing=controller.onReadAll(),total=controller.data.total;assert.ok(total>1);assert.equal(controller.data.page,0);assert.equal(spoken.length,1);assert.match(controller.data.readStatus,/系统合成.*Sample voice/);
  for(let index=0;index<total;index++){assert.equal(controller.data.page,index);assert.equal(spoken.length,index+1);waiting.shift()({locale:'en-US'});await tick();}
  await playing;assert.equal(spoken.join(''),text);assert.equal(controller.data.reading,false);assert.equal(controller.data.readStatus,'已读到文章末尾');assert.equal(library.get(id).progress,total-1);assert.equal(library.get(id).text,text);assert.equal(library.annotations(id)[0].id,mark);assert.equal(study.stats().today.attempts,0);
 }finally{controller.onUnload();media.speakAndWait=speak;}
});

test('manual page changes stop reading and a late completion cannot advance again',async()=>{
 const speak=media.speakAndWait,controller=page(),id=library.add('Reading','A small step. '.repeat(300));let finish,calls=0;
 media.speakAndWait=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 try{controller.onLoad({id});const playing=controller.onReadAll();controller.onNext();assert.equal(controller.data.reading,false);assert.equal(controller.data.page,1);finish({});await playing;assert.equal(calls,1);assert.equal(controller.data.page,1);assert.equal(library.get(id).progress,1);assert.equal(controller.data.readStatus,'已停止朗读');}
 finally{controller.onUnload();media.speakAndWait=speak;}
});

test('leaving during generation ignores both late start notifications and late audio completion',async()=>{
 const speak=media.speakAndWait;try{for(const phase of ['hide','unload']){const controller=page(),id=library.add('Reading','Read this page. '.repeat(200));let finish,start;media.speakAndWait=(text,variant,language,rate,callback)=>{start=callback;return new Promise(resolve=>{finish=resolve;});};controller.onLoad({id});const playing=controller.onReadAll();controller[phase==='hide'?'onHide':'onUnload']();const count=packets;start({locale:'en-US'});finish({});await playing;assert.equal(packets,count);assert.equal(controller.data.page,0);if(phase==='hide'){assert.equal(controller.data.reading,false);controller.onUnload();}}}finally{media.speakAndWait=speak;}
});

test('single-page reading and a failed request do not advance, and word lookup pauses continuous reading',async()=>{
 const speak=media.speakAndWait,lookup=dictionary.lookup,controller=page(),id=library.add('Reading','Read useful examples. '.repeat(180));let calls=0,finish;
 media.speakAndWait=async()=>{calls++;if(calls===1)throw new Error('service unavailable');return{};};dictionary.lookup=async word=>({kind:'entry',word,brief:'meaning'});
 try{controller.onLoad({id});await controller.onReadAll();assert.equal(controller.data.page,0);assert.equal(controller.data.readError,'service unavailable');assert.equal(controller.data.reading,false);await controller.onSpeak();assert.equal(controller.data.page,0);assert.equal(controller.data.readStatus,'本页朗读完成');assert.equal(controller.data.readError,'');
  media.speakAndWait=()=>new Promise(resolve=>{finish=resolve;});const playing=controller.onReadAll();await controller.openWord('Read',0,4,{start:0,end:4});assert.equal(controller.data.reading,false);assert.equal(controller.data.popup,true);finish({});await playing;assert.equal(controller.data.page,0);assert.match(controller.data.readStatus,/查词时朗读已暂停/);
 }finally{controller.onUnload();media.speakAndWait=speak;dictionary.lookup=lookup;}
});

test('Chinese text selects Chinese speech and tapping the active control stops without a second request',async()=>{
 const speak=media.speakAndWait,controller=page(),id=library.add('Reading','𠀀。中文阅读。');let language,finish,calls=0;
 media.speakAndWait=(text,variant,value)=>{calls++;language=value;return new Promise(resolve=>{finish=resolve;});};
 try{controller.onLoad({id});const pending=controller.onSpeak();assert.equal(language,'zh');controller.onSpeak();assert.equal(controller.data.reading,false);finish({});await pending;assert.equal(calls,1);assert.equal(controller.data.readStatus,'已停止朗读');}
 finally{controller.onUnload();media.speakAndWait=speak;}
});
