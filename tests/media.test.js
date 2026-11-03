const test=require('node:test');const assert=require('node:assert/strict');
const api=require('../miniprogram/services/api');
let resolveRequest,played=0,started=0;
let ended,failed;
global.wx={getStorageSync(){return '';},showToast(){},downloadFile(options){options.success({statusCode:200,tempFilePath:'temporary.mp3'});},createInnerAudioContext(){return {onError(handler){failed=handler;},onEnded(handler){ended=handler;},play(){played++;},stop(){},destroy(){}};},getRecorderManager(){return {start(){started++;}};}};
const media=require('../miniprogram/services/media');
test('leaving during speech generation prevents late audio playback; long text is never silently truncated',async()=>{
 api.request=()=>new Promise(resolve=>{resolveRequest=resolve;});
 const pending=media.speak('Hello.');media.stopAudio();resolveRequest({audioPath:'/api/audio/test.mp3'});await pending;assert.equal(played,0);
 await assert.rejects(media.speak('x'.repeat(2501)),/2500/);
});
test('cancelling while capabilities load never starts the microphone later',async()=>{
 api.request=()=>new Promise(resolve=>{resolveRequest=resolve;});
 const pending=media.startRecord();media.stopRecord(true);resolveRequest({asr:{available:true}});assert.deepEqual(await pending,{cancelled:true});assert.equal(started,0);
});
test('continuous playback waits for actual end events and stop resolves an in-flight wait',async()=>{
 api.request=async()=>({audioPath:'/api/audio/test.mp3',locale:'en-US'});
 const pending=media.speakAndWait('Hello.');let settled=false;pending.then(()=>settled=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);ended();assert.equal((await pending).locale,'en-US');
 const cancelled=media.speakAndWait('World.');await new Promise(resolve=>setImmediate(resolve));media.stopAudio();assert.deepEqual(await cancelled,{cancelled:true});
});
test('continuous playback rejects audio errors instead of advancing as if a word played',async()=>{
 api.request=async()=>({audioPath:'/api/audio/test.mp3'});const pending=media.speakAndWait('Hello.');const check=assert.rejects(pending,/播放未成功/);await new Promise(resolve=>setImmediate(resolve));failed();await check;media.stopAudio();
});
