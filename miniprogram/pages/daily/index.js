const daily=require('../../services/daily');const ui=require('../../utils/ui');const media=require('../../services/media');const sentences=require('../../services/sentences');
const {Pronunciation,voiceLabel}=require('../../services/pronunciation');
Page({
 data:{theme:'light',item:null,listening:false,revealed:true,busy:false,loading:false,voiceStatus:'',discoveryStatus:''},
 onLoad(options={}){const listening=options.mode==='listening';this._sequence=0;this._words=null;this._loaded=false;this.setData({item:daily.today(),listening,revealed:!listening});},
 onShow(){ui.apply(this);this._visible=true;const date=daily.today().date;if(this._day&&this._day!==date){this._sequence=0;this._words=null;this._loaded=false;}this._day=date;if(!this._loaded||this._words&&this._words.length===0){if(this._words&&this._words.length===0)this._words=null;this.loadExample();}},
 async loadExample(){
  const generation=this._loadGeneration=(this._loadGeneration||0)+1,now=Date.now(),date=daily.today(now).date,active=()=>this._visible&&this._loadGeneration===generation;
  this.stopVoice();this.setData({loading:true,revealed:!this.data.listening,voiceStatus:''});
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
  if(this.data.loading||!this.data.item)return;if(this.data.busy){this.stopVoice();this.setData({voiceStatus:'已停止朗读'});return;}
  const generation=this._voiceGeneration=(this._voiceGeneration||0)+1;if(!this._speaker)this._speaker=new Pronunciation();this.setData({busy:true,voiceStatus:'正在准备朗读…'});
  try{await this._speaker.play(this._entry||{word:this.data.item.word},{text:this.data.item.en,kind:'example',onStart:info=>{if(this._visible&&generation===this._voiceGeneration)this.setData({voiceStatus:voiceLabel(info)});}});}
  catch(error){if(this._visible&&generation===this._voiceGeneration){this.setData({voiceStatus:error.message});ui.error(error);}}
  finally{if(this._visible&&generation===this._voiceGeneration)this.setData({busy:false});}
 },
 onSave(){try{const item=this.data.item;sentences.save(item.en,item.zh,item.source+' · '+item.word);wx.showToast({title:'已存为例句卡片'});}catch(error){ui.error(error);}},
 onLookup(){if(this.data.item)ui.open(this.data.item.word);},
 onCopy(){const item=this.data.item;if(item)wx.setClipboardData({data:item.en+'\n'+item.zh});},
 onHide(){this._visible=false;this._loadGeneration=(this._loadGeneration||0)+1;this._voiceGeneration=(this._voiceGeneration||0)+1;if(this._speaker){this._speaker.release();this._speaker=null;}else media.stopAudio();if(this.data.loading)this._loaded=false;if(!this._unloaded)this.setData({loading:false,busy:false,voiceStatus:''});},
 onUnload(){this._unloaded=true;this.onHide();}
});
