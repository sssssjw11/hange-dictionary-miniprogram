const library=require('../../services/library');
const dictionary=require('../../services/dictionary');
const sentences=require('../../services/sentences');
const media=require('../../services/media');
const store=require('../../utils/store');
const ui=require('../../utils/ui');
const chinese=require('../../utils/chinese');
const {voiceLabel}=require('../../services/pronunciation');
Page({
 data:{theme:'light',fontSize:16,title:'',tokens:[],page:0,total:0,popup:false,word:'',meaning:'',looking:false,canFavorite:false,error:'',markMode:false,hasSelection:false,selectionLength:0,selectionQuote:'',annotationsCount:0,bookmarked:false,hasCurrentMark:false,groupPicker:false,groupWord:'',groupMeaning:'',reading:false,readContinuous:false,readStatus:'',readError:''},
 onLoad(options){
  this._closed=false;this._id=ui.decode(options.id);this._lookup=0;this._readGeneration=0;
  try{const article=library.get(this._id);if(!article)throw new Error('阅读材料不存在');this._article=article;this._ranges=library.ranges(article.text);this._pages=this._ranges.map(page=>page.text);this.setData({title:article.title,total:this._ranges.length});const offset=options.offset===undefined?null:Number(options.offset);this.showPage(offset!==null&&Number.isFinite(offset)?library.pageForOffset(this._ranges,offset):Math.min(article.progress||0,this._ranges.length-1));wx.setNavigationBarTitle({title:article.title});if(offset!==null)this.scrollToOffset(offset);}catch(error){this.setData({error:error.message});}
 },
 onShow(){ui.apply(this);this.refreshArticle();},
 refreshArticle(){
  try{const article=library.get(this._id);if(!article){this.stopReading('阅读材料已移除，朗读已停止');this._article=null;this.setData({tokens:[],total:0,error:'阅读材料已移除'});return;}if(!this._article||article.text!==this._article.text){this.stopReading('阅读材料已更新，朗读已停止');this._ranges=library.ranges(article.text);this._pages=this._ranges.map(page=>page.text);this._selection=null;this._anchor=null;}this._article=article;this.setData({title:article.title,total:this._ranges.length});this.renderTokens();}catch(error){ui.error(error);}
 },
 renderTokens(){
  if(!this._article||!this._ranges.length)return;const index=Math.min(this.data.page,this._ranges.length-1),page=this._ranges[index],marks=this._article.annotations||[],selection=this._selection;
  this.setData({page:index,tokens:library.decorated(page.text,page.start,marks,selection),annotationsCount:marks.length,bookmarked:marks.some(item=>item.kind==='bookmark'&&item.start===page.start),hasSelection:!!selection,selectionLength:selection?selection.end-selection.start:0,selectionQuote:selection?library.excerpt(this._article.text.slice(selection.start,selection.end),120):''});
 },
 showPage(index,options={}){
  if(!this._ranges||!this._ranges.length)return;const wasReading=this.data.reading;if(!options.reading)this.stopReading();index=Math.max(0,Math.min(index,this._ranges.length-1));this._lookup++;this._entry=null;this.setData(Object.assign({page:index,popup:false},options.reading?{}:{readStatus:wasReading?'已停止朗读':'',readError:''}));this.renderTokens();
  try{library.progress(this._id,index);}catch(error){ui.error(error);}wx.pageScrollTo({scrollTop:0,duration:0});
 },
 onPrev(){this.showPage(this.data.page-1);},onNext(){this.showPage(this.data.page+1);},
 scrollToOffset(offset){const run=()=>{if(!this._closed)wx.pageScrollTo({selector:'#reader-token-'+offset,duration:180,fail:()=>wx.pageScrollTo({scrollTop:0,duration:0})});};if(wx.nextTick)wx.nextTick(run);else setTimeout(run,0);},
 jumpOffset(offset){if(!this._article)return;offset=Math.max(0,Math.min(Number(offset)||0,this._article.text.length-1));this._selection=null;this._anchor=null;this.setData({markMode:false});this.showPage(library.pageForOffset(this._ranges,offset));this.scrollToOffset(offset);},
 token(event){const value=event.currentTarget.dataset;return {start:Number(value.start),end:Number(value.end),wordStart:Number(value.wordStart),wordEnd:Number(value.wordEnd)};},
 covers(start,end){return (this._article.annotations||[]).filter(item=>item.start<end&&item.end>start).sort((a,b)=>b.updated-a.updated);},
 onToken(event){
  if(!this._article||Date.now()<(this._ignoreTapUntil||0))return;const token=this.token(event);
  if(this.data.markMode){this.selectRange(token);return;}
  if(token.wordStart>=0){this.openWord(this._article.text.slice(token.wordStart,token.wordEnd),token.start,token.end,{start:token.wordStart,end:token.wordEnd});return;}
  const covers=this.covers(token.start,token.end);if(covers.length)this.editAnnotation(covers[0]);
 },
 onTokenLong(event){
  if(!this._article)return;const token=this.token(event);this._ignoreTapUntil=Date.now()+600;
  const covers=this.covers(token.start,token.end);if(covers.length){this.editAnnotation(covers[0]);return;}
  const range=token.wordStart>=0?{start:token.wordStart,end:token.wordEnd}:token;if(!this._article.text.slice(range.start,range.end).trim())return;
  this.openAnnotation(range.start,range.end);
 },
 selectRange(token){
  if(!this._anchor){this._anchor={start:token.start,end:token.end};this._selection={start:token.start,end:token.end};}
  else{this._selection={start:Math.min(this._anchor.start,token.start),end:Math.max(this._anchor.end,token.end)};this._anchor=null;}
  this.renderTokens();
 },
 onMarkMode(){this.stopReading('选段时朗读已暂停');this._selection=null;this._anchor=null;this._lookup++;this.setData({markMode:!this.data.markMode,popup:false});this.renderTokens();},
 async openWord(word,start,end,range,preferExisting=true){
  this.stopReading('查词时朗读已暂停');
  const generation=++this._lookup;this._entry=null;this._tokenRange=range;this._activeMark=preferExisting?this.covers(start,end)[0]||null:null;
  this.setData({popup:true,looking:true,word,meaning:'',canFavorite:false,hasCurrentMark:!!this._activeMark});
  try{const entry=await dictionary.lookup(word);if(this._closed||this._lookup!==generation)return;this._entry=entry.kind==='entry'?entry:null;this.setData({looking:false,canFavorite:!!this._entry,meaning:this._entry?(entry.brief||entry.zh||(entry.teaching||{}).title||((entry.senses||[])[0]||{}).definition||'点击查看完整词条'):entry.kind==='matches'?'找到多个匹配，点击完整释义继续选择':'暂未匹配到，可先保存原文批注'});}catch(error){if(!this._closed&&this._lookup===generation)this.setData({looking:false,meaning:error.message});}
 },
 onSelectedLookup(){const range=this._selection;if(!range)return;if(range.end-range.start>256)return ui.error(new Error('词句查询最多 256 字，较长选段可保存批注'));this._anchor=null;this.setData({markMode:false});this.openWord(this._article.text.slice(range.start,range.end),range.start,range.end,range,false);},
 onClose(){this._lookup++;this._entry=null;this.setData({popup:false});if(!this.data.markMode){this._selection=null;this.renderTokens();}},
 onDetail(){ui.open(this._entry?this._entry.word:this.data.word);},
 onFavorite(){if(!this._entry)return;try{if(!store.favorite(this._entry.word))store.toggle(this._entry.word,this.data.meaning);wx.showToast({title:'已加入生词本'});}catch(error){ui.error(error);}},
 onGroups(){if(this._entry)this.setData({groupPicker:true,groupWord:this._entry.word,groupMeaning:this.data.meaning});},
 onGroupSaved(){this.setData({groupPicker:false});},onGroupClose(){this.setData({groupPicker:false});},
 openAnnotation(start,end,id=''){
  if(end-start>6000)return ui.error(new Error('一次标注最多 6000 字，请缩小选段'));
  this.stopReading('批注时朗读已暂停');
  this._lookup++;this._selection=null;this._anchor=null;this.setData({popup:false,markMode:false});this.renderTokens();
  wx.navigateTo({url:'/pages/annotation/index?article='+encodeURIComponent(this._id)+'&start='+start+'&end='+end+(id?'&id='+encodeURIComponent(id):'')});
 },
 editAnnotation(item){this.openAnnotation(item.start,item.end,item.id);},
 onAnnotate(){if(this._activeMark)this.editAnnotation(this._activeMark);else if(this._tokenRange)this.openAnnotation(this._tokenRange.start,this._tokenRange.end);},
 onSaveSelection(){if(this._selection)this.openAnnotation(this._selection.start,this._selection.end);},
 onBookmark(){if(!this._article)return;try{library.bookmark(this._id,this._ranges[this.data.page].start,'第 '+(this.data.page+1)+' 页');this.refreshArticle();}catch(error){ui.error(error);}},
 onAnnotations(){wx.navigateTo({url:'/pages/annotations/index?article='+encodeURIComponent(this._id)+'&from=reader',success:result=>result.eventChannel.on('jump',value=>this.jumpOffset(value.offset))});},
 onSpeak(){if(this.data.reading&&!this.data.readContinuous){this.stopReading();return;}return this.startReading(false);},
 onReadAll(){if(this.data.reading&&this.data.readContinuous){this.stopReading();return;}return this.startReading(true);},
 stopReading(message='已停止朗读'){
  this._readGeneration=(this._readGeneration||0)+1;media.stopAudio();if(!this._closed)this.setData(Object.assign({reading:false,readContinuous:false},this.data.reading?{readStatus:message}:{}));
 },
 async startReading(continuous){
  if(!this._article||!this._pages||this._closed)return;this.stopReading();const generation=this._readGeneration,active=()=>!this._closed&&generation===this._readGeneration;
  this._lookup++;this._entry=null;this._selection=null;this._anchor=null;this.setData({reading:true,readContinuous:!!continuous,readStatus:'正在准备朗读…',readError:'',markMode:false,popup:false});this.renderTokens();
  try{
   while(active()){
    const index=this.data.page,text=this._pages[index]||'',language=chinese.hasHan(text)?'zh':'en';
    if(text.trim()){
     this.setData({readStatus:'正在准备第 '+(index+1)+' / '+this._pages.length+' 页…'});
     const result=await media.speakAndWait(text,undefined,language,undefined,info=>{if(active())this.setData({readStatus:'第 '+(index+1)+' / '+this._pages.length+' 页 · '+voiceLabel(Object.assign({},info,{kind:'tts'}))});});
     if(!active())return;if(result.cancelled){this.setData({readStatus:'朗读已暂停，可从本页重新开始'});return;}
    }
    if(!continuous||index>=this._pages.length-1){this.setData({readStatus:text.trim()?(continuous?'已读到文章末尾':'本页朗读完成'):'本页没有可朗读的文字'});break;}
    this.showPage(index+1,{reading:true});
   }
  }catch(error){if(active()){this.setData({readStatus:'朗读已暂停',readError:error.message});ui.error(error);}}
  finally{if(active())this.setData({reading:false,readContinuous:false});}
 },
 onSavePassage(){if(!this._article)return;try{sentences.save(this._pages[this.data.page],'',this._article.title);wx.showToast({title:'已存为例句卡片'});}catch(error){ui.error(error);}},
 onTranslate(){if(this._article)wx.navigateTo({url:'/pages/translate/index',success:result=>result.eventChannel.emit('source',{text:this._pages[this.data.page]})});},
 onHide(){this._lookup++;this.stopReading('离开页面后朗读已暂停');},onUnload(){this._closed=true;this.onHide();}
});
