const daily=require('../../services/daily');const ui=require('../../utils/ui');const media=require('../../services/media');const sentences=require('../../services/sentences');
const {Pronunciation,voiceLabel}=require('../../services/pronunciation');
Page({
 data:{theme:'light',item:null,listening:false,revealed:true,busy:false,loading:false,voiceStatus:'',discoveryStatus:'',recording:false,recordPending:false,recordSeconds:0,recordDuration:'',recordReady:false,replaying:false,recordStatus:'',recordError:''},
 onLoad(options={}){const listening=options.mode==='listening';this._sequence=0;this._words=null;this._loaded=false;this._recordGeneration=0;this._replayGeneration=0;this._recordingFile='';this.setData({item:daily.today(),listening,revealed:!listening});},
 onShow(){ui.apply(this);this._visible=true;const date=daily.today().date;if(this._day&&this._day!==date){this._sequence=0;this._words=null;this._loaded=false;}this._day=date;if(!this._loaded||this._words&&this._words.length===0){if(this._words&&this._words.length===0)this._words=null;this.loadExample();}},
 async loadExample(){
  const generation=this._loadGeneration=(this._loadGeneration||0)+1,now=Date.now(),date=daily.today(now).date,active=()=>this._visible&&this._loadGeneration===generation;
  this.clearRecording();this.stopVoice();this.setData({loading:true,revealed:!this.data.listening,voiceStatus:''});
  try{
   if(this._words===null){const words=await daily.oxfordWords();if(!active())return;this._words=words;}
   const found=await daily.findOxford(date,this._words,this._sequence,{active,exclude:this._sequence&&this.data.item?this.data.item.word:''});if(!active())return;
   this._entry=found?found.entry:null;this._loaded=true;this.setData({item:found?found.item:daily.today(now,this._sequence),loading:false,discoveryStatus:found?'来自已配置的牛津词库':'当前显示原创学习例句'});
  }catch(_){if(!active())return;this._entry=null;this._loaded=true;this.setData({item:daily.today(now,this._sequence),loading:false,discoveryStatus:'牛津例句暂不可用，已显示原创学习例句'});}
 },
 onChange(){if(this.data.loading)return;if(this._words&&this._words.length===0)this._words=null;this._sequence++;this.loadExample();},
 onReveal(){this.setData({revealed:!this.data.revealed});},
 stopVoice(){this._voiceGeneration=(this._voiceGeneration||0)+1;if(this._speaker)this._speaker.cancel();else media.stopAudio();if(this._visible)this.setData({busy:false});},
 async onPlay(){
  if(!this._visible||this.data.loading||this.data.recording||this.data.recordPending||!this.data.item)return;this.stopReplay();if(this.data.busy){this.stopVoice();this.setData({voiceStatus:'已停止朗读'});return;}
  const generation=this._voiceGeneration=(this._voiceGeneration||0)+1;if(!this._speaker)this._speaker=new Pronunciation();this.setData({busy:true,voiceStatus:'正在准备朗读…'});
  try{await this._speaker.play(this._entry||{word:this.data.item.word},{text:this.data.item.en,kind:'example',onStart:info=>{if(this._visible&&generation===this._voiceGeneration)this.setData({voiceStatus:voiceLabel(info)});}});}
  catch(error){if(this._visible&&generation===this._voiceGeneration){this.setData({voiceStatus:error.message});ui.error(error);}}
  finally{if(this._visible&&generation===this._voiceGeneration)this.setData({busy:false});}
 },
 discardRecording(file){if(!file)return;try{wx.getFileSystemManager().unlink({filePath:file,success(){},fail(){}});}catch(_){}},
 stopReplay(){this._replayGeneration=(this._replayGeneration||0)+1;if(this.data.replaying){media.stopAudio();if(!this._unloaded)this.setData({replaying:false,recordStatus:'录音已就绪，可再次回听'});}},
 clearRecording(){
  this._recordGeneration=(this._recordGeneration||0)+1;clearInterval(this._recordTimer);this._recordTimer=null;if(this._recordInFlight){this._recordInFlight=false;media.stopRecord(true);}this.stopReplay();const file=this._recordingFile;this._recordingFile='';this.discardRecording(file);
  if(!this._unloaded)this.setData({recording:false,recordPending:false,recordSeconds:0,recordDuration:'',recordReady:false,replaying:false,recordStatus:'',recordError:''});
 },
 async onRecord(){
  if(!this._visible||this.data.loading||this.data.recordPending||!this.data.item)return;if(this.data.recording){this.setData({recordPending:true,recordStatus:'正在结束录音…'});media.stopRecord();return;}
  this.stopReplay();this.stopVoice();const generation=this._recordGeneration=(this._recordGeneration||0)+1,active=()=>this._visible&&generation===this._recordGeneration;let timer,file='';this._recordInFlight=true;this.setData({recordPending:true,recordError:'',recordStatus:'正在准备麦克风…',recordSeconds:0,voiceStatus:''});
  try{
   const result=await media.startLocalRecord(()=>{if(!active()){media.stopRecord(true);return;}const started=Date.now();clearInterval(timer);this.setData({recording:true,recordPending:false,recordStatus:'正在跟读，点击结束，最长 60 秒'});this._recordTimer=timer=setInterval(()=>{if(active())this.setData({recordSeconds:Math.min(60,Math.floor((Date.now()-started)/1000))});},1000);});
   file=result&&typeof result.tempFilePath==='string'?result.tempFilePath:'';if(!active()){this.discardRecording(file);return;}if(result&&result.cancelled){this.setData({recordStatus:'录音已取消'});return;}
   if(!result||!file||!Number.isFinite(result.duration)||result.duration<=0||result.fileSize===0||result.fileSize>2*1024*1024)throw new Error('没有取得可回听的录音，请重新录制');
   const previous=this._recordingFile;this._recordingFile=file;file='';if(previous!==this._recordingFile)this.discardRecording(previous);this.setData({recordReady:true,recordDuration:(result.duration/1000).toFixed(1)+' 秒',recordStatus:'录音已就绪，可回听并对照原句'});
  }catch(error){this.discardRecording(file);if(active())this.setData({recordError:error.message,recordStatus:this._recordingFile?'录音未完成，已有录音仍可回听':'录音未完成，请重试'});}
  finally{clearInterval(timer);if(this._recordTimer===timer)this._recordTimer=null;if(active()){this._recordInFlight=false;this.setData({recording:false,recordPending:false});}}
 },
 async onReplay(){
  if(!this._visible||this.data.loading||this.data.recording||this.data.recordPending||!this._recordingFile)return;if(this.data.replaying){this.stopReplay();return;}this.stopVoice();const generation=this._replayGeneration=(this._replayGeneration||0)+1,active=()=>this._visible&&generation===this._replayGeneration;this.setData({replaying:true,recordError:'',recordStatus:'正在回听自己的录音…',voiceStatus:''});
  try{const result=await media.playLocal(this._recordingFile);if(active())this.setData({recordStatus:result.cancelled?'回听已停止':'回听结束，可再听原句对照'});}catch(error){if(active())this.setData({recordError:error.message,recordStatus:'回听未完成，请重试'});}finally{if(active())this.setData({replaying:false});}
 },
 onSave(){try{const item=this.data.item;sentences.save(item.en,item.zh,item.source+' · '+item.word);wx.showToast({title:'已存为例句卡片'});}catch(error){ui.error(error);}},
 onLookup(){if(this.data.item)ui.open(this.data.item.word);},
 onCopy(){const item=this.data.item;if(item)wx.setClipboardData({data:item.en+'\n'+item.zh});},
 onHide(){this._visible=false;this.clearRecording();this._loadGeneration=(this._loadGeneration||0)+1;this._voiceGeneration=(this._voiceGeneration||0)+1;if(this._speaker){this._speaker.release();this._speaker=null;}else media.stopAudio();if(this.data.loading)this._loaded=false;if(!this._unloaded)this.setData({loading:false,busy:false,voiceStatus:''});},
 onUnload(){this._unloaded=true;this.onHide();}
});
