const api=require('./api');
let audio=null,recording=null,capabilities=null,audioGeneration=0,recordGeneration=0,settleAudio=null;
async function available(force){if(!capabilities||force)capabilities=await api.request('capabilities');return capabilities;}
async function speak(text,variant='US',language='en',rate=0,waitForEnd=false){
 if(!text||text.length>2500)throw new Error('单次朗读支持 1～2500 字，请选取较短的段落');
 stopAudio();const generation=audioGeneration;
 const data=await api.request('tts',{text,variant,language,rate},'POST',120000);
 if(generation!==audioGeneration)return Object.assign({},data,{cancelled:true});
 const file=await new Promise((resolve,reject)=>wx.downloadFile({url:api.base()+data.audioPath,timeout:120000,success(response){response.statusCode===200?resolve(response.tempFilePath):reject(new Error('朗读音频下载失败'));},fail(){reject(new Error('无法下载朗读音频'));}}));
 if(generation!==audioGeneration)return Object.assign({},data,{cancelled:true});
 return playDownloaded(file,data,waitForEnd,generation);
}
function playDownloaded(file,data,waitForEnd,generation){
 const context=audio=wx.createInnerAudioContext();context.src=file;
 let ended;
 if(waitForEnd){
  ended=new Promise((resolve,reject)=>{
   settleAudio=resolve;
   context.onEnded(()=>{if(generation!==audioGeneration)return;settleAudio=null;resolve(data);});
   context.onError(()=>{if(generation!==audioGeneration)return;settleAudio=null;reject(new Error('音频播放未成功，请重试'));});
  });
 }else context.onError(()=>{if(generation===audioGeneration)wx.showToast({title:'音频播放未成功，请重试',icon:'none'});});
 context.play();return waitForEnd?ended:data;
}
function playLocal(file){stopAudio();return playDownloaded(file,{originalRecording:true},true,audioGeneration);}
function speakAndWait(text,variant='US',language='en',rate=0){return speak(text,variant,language,rate,true);}
function stopAudio(){audioGeneration++;if(settleAudio){settleAudio({cancelled:true});settleAudio=null;}if(audio){audio.stop();audio.destroy();audio=null;}}
async function startRecord(onStart){const generation=recordGeneration;const caps=await available();if(generation!==recordGeneration)return {cancelled:true};if(!caps.asr.available)throw new Error(caps.asr.reason);if(recording)throw new Error('录音正在进行');const manager=wx.getRecorderManager();let cancelled=false;return new Promise((resolve,reject)=>{const cleanup=()=>{manager.offStop(stop);manager.offError(error);manager.offStart(start);recording=null;};const stop=result=>{cleanup();resolve(cancelled?{cancelled:true}:result);};const error=value=>{cleanup();if(cancelled)resolve({cancelled:true});else reject(new Error(value.errMsg||'录音未成功，请检查麦克风授权'));};const start=()=>{if(cancelled)manager.stop();else if(onStart)onStart();};manager.onStop(stop);manager.onError(error);manager.onStart(start);recording={stop(){manager.stop();},cancel(){cancelled=true;manager.stop();}};try{manager.start({duration:60000,sampleRate:16000,numberOfChannels:1,format:'wav'});}catch(value){error(value);}});}
function stopRecord(cancel=false){if(cancel)recordGeneration++;if(recording)recording[cancel?'cancel':'stop']();}
module.exports={available,speak,speakAndWait,playLocal,stopAudio,startRecord,stopRecord};
