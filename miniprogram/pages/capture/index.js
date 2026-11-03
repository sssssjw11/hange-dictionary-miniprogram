const api=require('../../services/api');
const media=require('../../services/media');
const ui=require('../../utils/ui');
Page({
 data:{theme:'light',busy:false,recording:false,seconds:0,text:'',imagePath:'',language:'en',caps:null,message:'',error:'',tokens:[]},
 onShow(){ui.apply(this);this._closed=false;this._visible=true;if(!this._nativeMedia)this._generation=(this._generation||0)+1;const token=this._generation;if(!this._nativeMedia)this.setData({busy:false,recording:false});media.available(true).then(caps=>{if(this.current(token))this.setData({caps});}).catch(error=>{if(this.current(token))this.setData({error:error.message});});},
 current(token){return !this._closed&&token===this._generation;},
 onInput(event){this.setData({text:event.detail.value});this.tokens();},
 tokens(){this.setData({tokens:Array.from(new Set((this.data.text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)||[]).map(word=>word.toLowerCase()))).slice(0,60)});},
 onLanguage(event){this.setData({language:ui.dataset(event,'language')});},
 async onPhoto(){
  if(this.data.busy||this.data.recording)return;const token=this._generation;
  this._nativeMedia=true;this.setData({busy:true,error:'',message:'选择需要识别的图片'});
  try{
   const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed'],success:resolve,fail:reject}));
   if(!this.current(token))return;const file=result.tempFiles[0];if(file.size>8*1024*1024)throw new Error('图片最大为 8 MiB，请压缩后再试');
   this.setData({imagePath:file.tempFilePath,text:'',tokens:[],message:'图片已就绪，可以先裁剪再识别'});
  }catch(error){if(this.current(token)&&!/cancel/.test(error.errMsg||''))this.setData({error:error.message||'图片选择未完成',message:''});}
  finally{this._nativeMedia=false;if(this.current(token))this.setData({busy:false});}
 },
 async onEditPhoto(){
  if(this.data.busy||this.data.recording||!this.data.imagePath)return;
  const token=this._generation;this._nativeMedia=true;this.setData({busy:true,error:''});
  try{
   const choice=await new Promise((resolve,reject)=>wx.showActionSheet({itemList:['自由编辑 / 裁剪','正方形 1:1','横向 4:3','纵向 3:4'],success:resolve,fail:reject}));
   if(!this.current(token))return;
   const edit=choice.tapIndex===0;
   if(typeof wx[edit?'editImage':'cropImage']!=='function')throw new Error('当前微信客户端不支持此编辑方式，请更新微信或选择已裁剪的图片');
   const options={src:this.data.imagePath};if(!edit)options.cropScale=['','1:1','4:3','3:4'][choice.tapIndex];
   const result=await new Promise((resolve,reject)=>wx[edit?'editImage':'cropImage'](Object.assign(options,{success:resolve,fail:reject})));
   if(this.current(token))this.setData({imagePath:result.tempFilePath,text:'',tokens:[],message:'图片已编辑，点击识别图片继续'});
  }catch(error){if(this.current(token)&&!/cancel/.test(error.errMsg||''))this.setData({error:error.message||'当前客户端未能编辑图片，请选择已裁剪的图片'});}
  finally{this._nativeMedia=false;if(this.current(token))this.setData({busy:false});}
 },
 async onRecognize(){
  if(this.data.busy||this.data.recording||!this.data.imagePath)return;
  const token=this._generation;this.setData({busy:true,error:'',message:'正在识别图片中的文字…'});
  try{
   const caps=await media.available();if(!this.current(token))return;if(!caps.ocr.available)throw new Error(caps.ocr.reason);
   const data=await api.upload('ocr',this.data.imagePath);
   if(this.current(token)){this.setData({text:data.text,message:data.text?'识别完成，可编辑后查词或翻译':'图片中未识别到文字'});this.tokens();}
  }catch(error){if(this.current(token))this.setData({error:error.message,message:''});}
  finally{if(this.current(token))this.setData({busy:false});}
 },
 async onRecord(){
  if(this.data.recording){media.stopRecord();return;}if(this.data.busy)return;
  const token=this._generation;let timer;this.setData({busy:true,error:'',message:'准备录音…'});
  try{
   const result=await media.startRecord(()=>{
    if(!this.current(token)){media.stopRecord(true);return;}
    const started=Date.now();this.setData({recording:true,busy:false,seconds:0,message:'正在录音，点击结束，最长 60 秒'});
    this._timer=timer=setInterval(()=>{if(this.current(token))this.setData({seconds:Math.floor((Date.now()-started)/1000)});},1000);
   });
   clearInterval(timer);if(!this.current(token)||result.cancelled)return;
   this.setData({recording:false,busy:true,message:'正在使用本地模型转写…'});
   const response=await api.upload('asr',result.tempFilePath,{language:this.data.language});
   if(this.current(token)){this.setData({text:response.text,message:response.text?'转写完成，请核对文字后继续使用':'未识别到清晰语音'});this.tokens();}
  }catch(error){if(this.current(token))this.setData({error:error.message,message:''});}
  finally{clearInterval(timer);if(this.current(token))this.setData({busy:false,recording:false});}
 },
 onWord(event){ui.open(ui.dataset(event));},
 onLookup(){const text=this.data.text.trim();if(text.length>256)return ui.error(new Error('全文可使用翻译；查词请从下方选择一个单词或短语'));if(text)ui.open(text);},
 onTranslate(){if(this.data.text.trim())wx.navigateTo({url:'/pages/translate/index',success:result=>result.eventChannel.emit('source',{text:this.data.text})});},
 onCopy(){if(this.data.text)wx.setClipboardData({data:this.data.text});},
 onHide(){this._visible=false;if(this._nativeMedia)return;this._generation++;clearInterval(this._timer);media.stopRecord(true);},
 onUnload(){this._closed=true;this._nativeMedia=false;this.onHide();}
});
