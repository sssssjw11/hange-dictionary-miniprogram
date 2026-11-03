const library=require('../../services/library');
const list=require('../../utils/list');
const ui=require('../../utils/ui');
Page({
 data:{theme:'light',rows:[],articleId:'',query:'',kind:'all',listPage:0,listPages:1,total:0,fromReader:false},
 onLoad(options){this.setData({articleId:ui.decode(options.article||''),fromReader:options.from==='reader'});},
 onShow(){ui.apply(this);this.refresh();},
 refresh(index=0){try{const rows=library.annotationSummaries(this.data.articleId||null,this.data.query).filter(item=>this.data.kind==='all'||item.kind===this.data.kind);this.setData(list.page(rows,index,15));}catch(error){ui.error(error);}},
 onInput(event){this.setData({query:event.detail.value});clearTimeout(this._timer);this._timer=setTimeout(()=>this.refresh(),180);},
 onKind(event){this.setData({kind:ui.dataset(event,'kind')});this.refresh();},onPrev(){this.refresh(this.data.listPage-1);},onNext(){this.refresh(this.data.listPage+1);},
 onEdit(event){const id=ui.dataset(event,'id'),article=ui.dataset(event,'article');wx.navigateTo({url:'/pages/annotation/index?article='+encodeURIComponent(article)+'&id='+encodeURIComponent(id)});},
 onJump(event){const offset=Number(ui.dataset(event,'start')),article=ui.dataset(event,'article');if(this.data.fromReader&&article===this.data.articleId){const channel=this.getOpenerEventChannel&&this.getOpenerEventChannel();if(channel&&channel.emit){channel.emit('jump',{offset});wx.navigateBack();return;}}wx.navigateTo({url:'/pages/reader/index?id='+encodeURIComponent(article)+'&offset='+offset});},
 onUnload(){clearTimeout(this._timer);}
});
