const dictionary=require('../../services/dictionary'),media=require('../../services/media'),{ResourceFiles}=require('../../services/dictionary-media'),ui=require('../../utils/ui'),list=require('../../utils/list');
Page({
 data:{theme:'light',word:'',loading:true,error:'',query:'',kind:'all',rows:[],total:0,listPage:0,listPages:1,checking:false,status:'',mediaAvailable:false,busyKey:'',playingKey:''},
 onLoad(options){this._closed=false;this._visible=true;this._files=new ResourceFiles();this._query=ui.decode(options.q);media.stopAudio();this.load();},
 onShow(){this._visible=true;ui.apply(this);},
 onHide(){this._visible=false;this._action=(this._action||0)+1;this._files.cancel();media.stopAudio();this.setData({playingKey:'',busyKey:''});},
 async load(){
  const generation=this._load=(this._load||0)+1;this.setData({loading:true,error:''});
  try{
   let entry=await dictionary.lookup(this._query);if(this._closed||generation!==this._load)return;
   if(entry.kind!=='entry')throw new Error('请先打开完整牛津词条，再查看录音和插图');
   if(entry.oxford&&!entry.oxford.mediaVersion){entry=await dictionary.lookup(this._query,{refresh:true});if(this._closed||generation!==this._load)return;}
   if(entry.kind!=='entry'||!entry.oxford||!entry.oxford.mediaVersion)throw new Error('当前词条尚未包含媒体引用，请连接新版词库服务后重试');
   this._sourceSha=entry.oxford.sourceSha256;this._all=entry.oxford.mediaRefs||[];this.setData({word:entry.word,loading:false});this.refresh();
  }catch(error){if(!this._closed&&generation===this._load)this.setData({loading:false,error:error.message});}
 },
 refresh(index=0){
  media.stopAudio();this._files.cancel();this._action=(this._action||0)+1;
  const query=this.data.query.toLowerCase(),rows=(this._all||[]).map((row,index)=>Object.assign({},row,{index})).filter(row=>(this.data.kind==='all'||row.kind===this.data.kind)&&(row.label+' '+row.key).toLowerCase().includes(query));
  const page=list.page(rows,index,12);this._pageRows=page.rows;this.setData(Object.assign(page,{playingKey:'',busyKey:'',status:'',checking:false}));this.check();
 },
 async check(){
  const generation=this._check=(this._check||0)+1,rows=this._pageRows||[];if(!rows.length)return;
  this.setData({checking:true,status:''});
  try{const result=await this._files.resolve(rows,this._sourceSha);if(this._closed||generation!==this._check)return;
   this._resolved=rows.map((row,index)=>Object.assign({},row,result.rows[index]));this.setData({rows:this._resolved,checking:false,mediaAvailable:result.available,status:result.available?'原版媒体来自已导入的 MDD；当前页 '+this._resolved.filter(row=>row.available).length+' / '+rows.length+' 项可用。':result.reason});
  }catch(error){if(!this._closed&&generation===this._check){this._resolved=[];this.setData({checking:false,mediaAvailable:false,status:error.message,rows:rows.map(row=>Object.assign({},row,{available:false}))});}}
 },
 onRetry(){this.load();},onCheck(){this.check();},
 onSearch(event){this.setData({query:event.detail.value});this.refresh();},
 onKind(event){this.setData({kind:ui.dataset(event,'kind')});this.refresh();},
 onPrev(){this.refresh(this.data.listPage-1);},onNext(){this.refresh(this.data.listPage+1);},
 async onResource(event){
  const row=(this._resolved||[]).find(row=>row.index===Number(ui.dataset(event,'index')));if(!row||!row.available||this.data.busyKey)return;
  if(this.data.playingKey===row.key){media.stopAudio();this._action=(this._action||0)+1;this.setData({playingKey:''});return;}
  const action=this._action=(this._action||0)+1;media.stopAudio();this.setData({busyKey:row.key,playingKey:''});
  try{const file=await this._files.download(row,this._sourceSha);if(this._closed||!this._visible||action!==this._action)return;
   this.setData({busyKey:''});
   if(row.kind==='image'){wx.previewImage({current:file,urls:[file],fail:()=>ui.error(new Error('插图暂时无法显示，请核对原始媒体文件'))});return;}
   this.setData({playingKey:row.key});await media.playLocal(file);if(!this._closed&&action===this._action)this.setData({playingKey:''});
  }catch(error){if(!this._closed&&this._visible&&action===this._action){this.setData({playingKey:'',busyKey:''});ui.error(error);}}
 },
 onUnload(){this._closed=true;this._load=(this._load||0)+1;this._check=(this._check||0)+1;this._action=(this._action||0)+1;media.stopAudio();this._files.release();}
});
