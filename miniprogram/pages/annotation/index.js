const library=require('../../services/library');
const ui=require('../../utils/ui');
Page({
 data:{theme:'light',valid:false,id:'',articleId:'',title:'',quote:'',length:0,note:'',color:'yellow',kind:'highlight',saving:false,error:''},
 onLoad(options){
  try{
   const articleId=ui.decode(options.article),article=library.get(articleId);if(!article)throw new Error('阅读材料不存在');
   const id=ui.decode(options.id||''),existing=id?(article.annotations||[]).find(item=>item.id===id):null;if(id&&!existing)throw new Error('这条批注已不存在');
   const draft=existing||{id:'draft',start:Number(options.start),end:Number(options.end),note:'',color:'yellow',kind:options.kind==='bookmark'?'bookmark':'highlight',created:0,updated:0};
   if(!library.validAnnotation(draft,article.text))throw new Error('原文范围无效或超过 6000 字，请重新选择');
   this._start=draft.start;this._end=draft.end;
   this.setData({valid:true,id,articleId,title:article.title,quote:article.text.slice(draft.start,draft.end),length:draft.end-draft.start,note:draft.note,color:draft.color,kind:draft.kind});
  }catch(error){this.setData({error:error.message});}
 },
 onShow(){ui.apply(this);},onNote(event){this.setData({note:event.detail.value});},onColor(event){this.setData({color:ui.dataset(event,'color')});},onKind(event){this.setData({kind:ui.dataset(event,'kind')});},
 onSave(){if(this.data.saving||!this.data.valid)return;this.setData({saving:true,error:''});try{library.mark(this.data.articleId,this._start,this._end,this.data.note,this.data.color,this.data.id,this.data.kind);wx.navigateBack();}catch(error){this.setData({error:error.message});ui.error(error);}finally{this.setData({saving:false});}},
 async onDelete(){if(!this.data.id||this.data.saving||!await ui.confirm('删除这条批注或书签？','原文、阅读进度、生词和其他批注会保留。'))return;try{library.removeAnnotation(this.data.articleId,this.data.id);wx.navigateBack();}catch(error){ui.error(error);}},
 onCopy(){if(this.data.quote)wx.setClipboardData({data:this.data.quote+(this.data.note?'\n\n'+this.data.note:'')});},onBack(){wx.navigateBack();}
});
