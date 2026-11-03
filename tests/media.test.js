const test=require('node:test');const assert=require('node:assert/strict');
const api=require('../miniprogram/services/api');
let resolveRequest,played=0,started=0;
global.wx={showToast(){},downloadFile(options){options.success({statusCode:200,tempFilePath:'temporary.mp3'});},createInnerAudioContext(){return {onError(){},play(){played++;},stop(){},destroy(){}};},getRecorderManager(){return {start(){started++;}};}};
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
