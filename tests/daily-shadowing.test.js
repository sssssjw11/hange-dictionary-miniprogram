const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const copy=value=>JSON.parse(JSON.stringify(value)),memory=new Map(),tick=()=>new Promise(resolve=>setImmediate(resolve));let callbacks,removed,contexts,starts,stops,options,requests;
const manager={onStart(fn){callbacks.start.add(fn);},offStart(fn){callbacks.start.delete(fn);},onStop(fn){callbacks.stop.add(fn);},offStop(fn){callbacks.stop.delete(fn);},onError(fn){callbacks.error.add(fn);},offError(fn){callbacks.error.delete(fn);},start(value){starts++;options=value;},stop(){stops++;}};
function emit(name,value){for(const fn of Array.from(callbacks[name]))fn(value);}
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarColor(){},setBackgroundColor(){},getRecorderManager:()=>manager,getFileSystemManager:()=>({unlink(value){removed.push(value.filePath);value.success();}}),createInnerAudioContext(){const context={src:'',played:0,destroyed:false,onEnded(fn){this.end=fn;},onError(fn){this.error=fn;},play(){this.played++;},stop(){},destroy(){this.destroyed=true;}};contexts.push(context);return context;}};
const api=require('../miniprogram/services/api'),media=require('../miniprogram/services/media'),daily=require('../miniprogram/services/daily'),records=require('../miniprogram/utils/records'),study=require('../miniprogram/services/study');
const {Pronunciation}=require('../miniprogram/services/pronunciation');
function page(){let definition;const file=path.resolve(__dirname,'../miniprogram/pages/daily/index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value){Object.assign(this.data,copy(value));}};for(const [key,value]of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
async function ready(){const words=daily.oxfordWords;daily.oxfordWords=async()=>[];const controller=page();try{controller.onLoad({mode:'listening'});controller.onShow();await tick();return controller;}finally{daily.oxfordWords=words;}}
async function record(controller,file='own.mp3',duration=2300){const pending=controller.onRecord();emit('start');await controller.onRecord();emit('stop',{tempFilePath:file,duration,fileSize:100});await pending;}
test.beforeEach(()=>{callbacks={start:new Set(),stop:new Set(),error:new Set()};removed=[];contexts=[];starts=0;stops=0;requests=0;memory.clear();api.request=async()=>{requests++;throw new Error('network should not be used for recording');};});
test.afterEach(()=>{media.stopRecord(true);emit('stop',{});media.stopAudio();});

test('local recording needs no network, is exclusive and releases only its own event listeners',async()=>{
 let announced=0;const pending=media.startLocalRecord(()=>announced++);assert.equal(requests,0);assert.deepEqual(options,{duration:60000,sampleRate:16000,numberOfChannels:1,format:'mp3',encodeBitRate:48000});await assert.rejects(media.startLocalRecord(),/正在进行/);emit('start');emit('start');assert.equal(announced,1);const lateError=Array.from(callbacks.error)[0];emit('stop',{tempFilePath:'first.mp3',duration:1000});assert.equal((await pending).tempFilePath,'first.mp3');assert.equal(callbacks.stop.size,0);
 const second=media.startLocalRecord();lateError({errMsg:'late old failure'});assert.equal(callbacks.stop.size,1);await assert.rejects(media.startLocalRecord(),/正在进行/);emit('stop',{tempFilePath:'second.mp3',duration:1000});await second;assert.deepEqual(removed,[]);
});

test('cancelling before the microphone starts discards late audio and supersedes a pending ASR check',async()=>{
 let finish,announced=0;api.request=()=>{requests++;return new Promise(resolve=>{finish=resolve;});};const asr=media.startRecord();const local=media.startLocalRecord(()=>announced++);finish({asr:{available:true}});assert.deepEqual(await asr,{cancelled:true});assert.equal(starts,1);media.stopRecord(true);assert.equal(stops,1);emit('start');assert.equal(announced,0);assert.equal(stops,2);emit('stop',{tempFilePath:'late.mp3',duration:2000});assert.deepEqual(await local,{cancelled:true});assert.deepEqual(removed,['late.mp3']);assert.equal(callbacks.start.size,0);
});

test('a denied microphone request can be retried and never leaves the recorder occupied',async()=>{
 const pending=media.startLocalRecord();const check=assert.rejects(pending,/auth deny/);emit('error',{errMsg:'auth deny'});await check;assert.equal(callbacks.start.size,0);const retry=media.startLocalRecord();emit('start');media.stopRecord();emit('stop',{tempFilePath:'retry.mp3',duration:1500});assert.equal((await retry).tempFilePath,'retry.mp3');assert.equal(requests,0);
 api.request=async()=>({asr:{available:true}});await media.available(true);const asr=media.startRecord();await tick();assert.equal(options.format,'wav');assert.equal(options.sampleRate,16000);emit('start');emit('stop',{tempFilePath:'recognition.wav',duration:1000});assert.equal((await asr).tempFilePath,'recognition.wav');
});

test('daily practice records, replays and stops on actual completion without changing learning records',async()=>{
 const controller=await ready(),before=records.snapshot(),sentence=controller.data.item.en;
 try{await record(controller);assert.equal(controller.data.recordReady,true);assert.equal(controller.data.recordDuration,'2.3 秒');assert.equal(controller.data.recording,false);assert.equal(controller.data.recordPending,false);assert.equal(controller._recordTimer,null);const playing=controller.onReplay();assert.equal(contexts.at(-1).src,'own.mp3');assert.equal(controller.data.replaying,true);contexts.at(-1).end();await playing;assert.equal(controller.data.replaying,false);assert.match(controller.data.recordStatus,/回听结束/);assert.equal(controller.data.item.en,sentence);assert.equal(study.stats().today.attempts,0);assert.deepEqual(records.snapshot(),before);assert.equal(requests,0);assert.ok(!removed.includes('own.mp3'));}
 finally{controller.onUnload();}assert.ok(removed.includes('own.mp3'));
});

test('failed replacement retains the previous recording and source playback cancels replay or yields to recording',async()=>{
 const controller=await ready(),play=Pronunciation.prototype.play;let finishSource;
 Pronunciation.prototype.play=function(_entry,value){value.onStart({kind:'original',variant:'US'});return new Promise(resolve=>{finishSource=resolve;});};
 try{await record(controller,'previous.mp3');const failure=controller.onRecord();emit('error',{errMsg:'auth deny'});await failure;assert.equal(controller._recordingFile,'previous.mp3');assert.equal(controller.data.recordReady,true);assert.ok(!removed.includes('previous.mp3'));
  const replay=controller.onReplay(),source=controller.onPlay();await replay;assert.equal(controller.data.replaying,false);assert.equal(controller.data.busy,true);assert.equal(contexts.at(-1).destroyed,true);const recording=controller.onRecord();emit('start');assert.equal(controller.data.busy,false);assert.equal(controller.data.recording,true);finishSource({kind:'original'});await source;assert.equal(controller.data.voiceStatus,'');await controller.onPlay();assert.equal(controller.data.busy,false);await controller.onRecord();emit('stop',{tempFilePath:'replacement.mp3',duration:3000,fileSize:200});await recording;assert.ok(removed.includes('previous.mp3'));assert.equal(controller._recordingFile,'replacement.mp3');
  controller.onChange();await tick();assert.equal(controller.data.recordReady,false);assert.ok(removed.includes('replacement.mp3'));
 }finally{controller.onUnload();Pronunciation.prototype.play=play;}
});

test('hiding during microphone startup ignores late callbacks and invalid recordings are removed',async()=>{
 const controller=await ready();
 try{const pending=controller.onRecord();controller.onHide();const hidden=copy(controller.data);emit('start');emit('stop',{tempFilePath:'hidden.mp3',duration:3000,fileSize:200});await pending;assert.deepEqual(controller.data,hidden);assert.ok(removed.includes('hidden.mp3'));await controller.onRecord();assert.equal(starts,1);
  controller._visible=true;const invalid=controller.onRecord();emit('start');emit('stop',{tempFilePath:'empty.mp3',duration:0,fileSize:0});await invalid;assert.equal(controller.data.recordReady,false);assert.match(controller.data.recordError,/没有取得/);assert.ok(removed.includes('empty.mp3'));assert.equal(controller._recordTimer,null);
 }finally{controller.onUnload();}
});
