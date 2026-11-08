const vocabulary=require('../../services/vocabulary'),library=require('../../services/library'),study=require('../../services/study'),store=require('../../utils/store'),ui=require('../../utils/ui'),list=require('../../utils/list');
Page({
 data:{theme:'light',editing:true,draft:'',sourceTitle:'',hasSource:false,article:false,rows:[],uniqueTotal:0,occurrences:0,skipped:0,total:0,listPage:0,listPages:1,query:'',filter:'new',hideMastered:true,sortIndex:0,sortNames:['按出现次数','按原文顺序','按字母'],selectedCount:0,readyCount:0,name:'提取词表',busy:false,completed:0,taskTotal:0,message:'',error:'',createdDeck:''},
 onLoad(options={}){
  this._closed=false;this._visible=true;this._generation=0;this._sourceText='';this._rows=[];this._byWord=new Map();this._selected=new Set();this._resolved=new Map();this._favorites=new Map();this._mastered=new Set();this._articleId=ui.decode(options.article);this._returnToReader=options.returnToReader==='1';
  if(typeof this.getOpenerEventChannel==='function'){this._opener=this.getOpenerEventChannel();if(this._opener&&this._opener.on)this._opener.on('source',value=>{if(!this._closed)this.applySource(value&&value.text,value&&value.title);});}
  if(this._articleId)this.syncArticle();
 },
 onShow(){this._visible=true;try{ui.apply(this);if(this._articleId)this.syncArticle();this.syncRecords();this.refresh(this.data.listPage);}catch(error){this.setData({error:error.message});}},
 syncArticle(){try{const article=library.get(this._articleId);if(!article)throw new Error('阅读材料已移除，请返回书架');if(article.text!==this._sourceText)this.applySource(article.text,article.title);else this.setData({sourceTitle:article.title});}catch(error){this.failSource(error);}},
 checkSource(){if(!this._articleId)return;const article=library.get(this._articleId);if(!article||article.text!==this._sourceText){this.syncArticle();this.refresh();throw new Error('正文已变化，请使用更新后的候选词');}},
 syncRecords(){this._favorites=new Map(store.favorites().map(item=>[store.key(item.word),item]));this._mastered=new Set(study.mastered());if(this._createdDeck&&!study.decks().some(deck=>deck.id===this._createdDeck)){this._createdDeck='';this._createdKey='';}},
 failSource(error){this._generation++;this._sourceText='';this._rows=[];this._byWord.clear();this._selected.clear();this._resolved.clear();this.setData({hasSource:false,rows:[],uniqueTotal:0,occurrences:0,selectedCount:0,readyCount:0,total:0,busy:false,message:'',error:error.message});},
 applySource(text,title){
  try{const extracted=vocabulary.extract(text);this._generation++;this._sourceText=text;this._rows=extracted.rows;this._byWord=new Map(this._rows.map(row=>[row.word,row]));this._selected.clear();this._resolved.clear();this.syncRecords();const sourceTitle=typeof title==='string'&&title.trim()?library.excerpt(title.trim(),100):'粘贴的文字';this.setData({hasSource:true,editing:false,draft:'',sourceTitle,article:!!this._articleId,uniqueTotal:this._rows.length,occurrences:extracted.occurrences,skipped:extracted.skipped,name:library.excerpt('提取 · '+sourceTitle,40),query:'',busy:false,completed:0,taskTotal:0,message:'',error:''});this.refresh();}catch(error){this.failSource(error);}
 },
 ordered(){const query=store.key(this.data.query);return this._rows.filter(row=>(this.data.filter!=='new'||!this._favorites.has(row.word))&&(!this.data.hideMastered||!this._mastered.has(row.word))&&(!query||row.word.includes(query))).sort(this.data.sortIndex===1?(a,b)=>a.start-b.start:this.data.sortIndex===2?(a,b)=>a.word.localeCompare(b.word):(a,b)=>b.count-a.count||a.start-b.start);},
 selectedWords(){return this.ordered().filter(row=>this._selected.has(row.word)).map(row=>row.word);},
 deckKey(words){return JSON.stringify([this.data.name.trim(),words]);},
 refresh(index=0){
  const ordered=this.ordered(),visible=new Set(ordered.map(row=>row.word));for(const word of this._selected)if(!visible.has(word))this._selected.delete(word);
  const result=list.page(ordered,index,25);result.rows=result.rows.map(row=>{const found=this._resolved.get(row.word),saved=this._favorites.get(row.word);return Object.assign({},row,vocabulary.context(this._sourceText,row),{checked:this._selected.has(row.word),mastered:this._mastered.has(row.word),status:saved?'已收藏':found?found.kind==='entry'?'已匹配':found.kind==='missing'?'未匹配':'读取失败':'待匹配',meaning:saved?library.excerpt(saved.meaning||'',500):found&&found.kind==='entry'?found.meaning:'',matchError:found&&found.kind==='error'?found.meaning:''});});
  const selected=ordered.filter(row=>this._selected.has(row.word)).map(row=>row.word),readyCount=selected.filter(word=>!this._favorites.has(word)&&(this._resolved.get(word)||{}).kind==='entry').length;this.setData(Object.assign(result,{selectedCount:selected.length,readyCount,createdDeck:this._createdKey===this.deckKey(selected)?this._createdDeck||'':''}));
 },
 onInput(event){this.setData({draft:event.detail.value});},onExtract(){if(this.data.busy)return;this.applySource(this.data.draft,'粘贴的文字');},
 onEdit(){if(this._articleId)return;this.cancelTask();this.setData({editing:true,draft:this._sourceText});},
 onQuery(event){if(this.data.busy)return;this._selected.clear();this.setData({query:event.detail.value});this.refresh();},
 onFilter(event){if(this.data.busy)return;this._selected.clear();this.setData({filter:ui.dataset(event,'filter')});this.refresh();},
 onMastered(event){if(this.data.busy)return;this._selected.clear();this.setData({hideMastered:!!event.detail.value});this.refresh();},
 onSort(event){if(this.data.busy)return;this.setData({sortIndex:Number(event.detail.value)});this.refresh();},
 onPrev(){if(!this.data.busy)this.refresh(this.data.listPage-1);},onNext(){if(!this.data.busy)this.refresh(this.data.listPage+1);},
 onSelection(event){if(this.data.busy)return;const next=new Set(this._selected),pageWords=new Set(this.data.rows.map(row=>row.word));for(const word of pageWords)next.delete(word);for(const word of event.detail.value)if(pageWords.has(word))next.add(word);if(next.size>vocabulary.MAX_SELECTION){ui.error(new Error('每次最多选择 500 个词'));this.refresh(this.data.listPage);return;}this._selected=next;this.refresh(this.data.listPage);},
 onSelectPage(){if(this.data.busy||!this.data.rows.length)return;const next=new Set(this._selected),remove=this.data.rows.every(row=>next.has(row.word));for(const row of this.data.rows)remove?next.delete(row.word):next.add(row.word);if(next.size>vocabulary.MAX_SELECTION)return ui.error(new Error('每次最多选择 500 个词'));this._selected=next;this.refresh(this.data.listPage);},
 onClear(){if(this.data.busy)return;this._selected.clear();this.refresh(this.data.listPage);},
 onName(event){const name=event.detail.value;this.setData({name,createdDeck:this._createdKey===JSON.stringify([name.trim(),this.selectedWords()])?this._createdDeck||'':''});},
 onToActions(){if(this._visible&&this.data.hasSource)wx.pageScrollTo({selector:'#vocabulary-actions',duration:180});},
 onWord(event){const word=ui.dataset(event);if(this._visible&&!this.data.busy&&this._byWord.has(word))ui.open(word);},
 async onResolve(){
  if(!this._visible||this.data.busy)return;try{this.checkSource();}catch(error){this.setData({error:error.message});return;}const words=this.selectedWords().filter(word=>!this._favorites.has(word));if(!words.length)return this.setData({message:'请先勾选未收藏的候选词；已收藏的词可直接生成学习词表。'});
  const generation=++this._generation,active=()=>!this._closed&&this._visible&&generation===this._generation;this.setData({busy:true,completed:0,taskTotal:words.length,error:'',message:''});
  try{await vocabulary.resolve(words,{active,onResult:(row,completed,total)=>{if(active()){this._resolved.set(row.word,row);this.setData({completed,taskTotal:total});}}});if(active()){this.refresh(this.data.listPage);this.setData({message:'匹配完成，可加入已匹配的词；未匹配项可单独查词或保留到学习词表。'});}}
  catch(error){if(active())this.setData({error:error.message});}finally{if(active())this.setData({busy:false});}
 },
 cancelTask(){this._generation++;if(!this._closed)this.setData({busy:false});},
 onCancel(){this.cancelTask();this.refresh(this.data.listPage);this.setData({message:'已停止匹配，已完成的结果仍保留。'});},
 onAdd(){
  if(!this._visible||this.data.busy)return;try{this.checkSource();}catch(error){this.setData({error:error.message});return;}const words=this.selectedWords().filter(word=>!this._favorites.has(word)&&(this._resolved.get(word)||{}).kind==='entry');if(!words.length)return ui.error(new Error('请先匹配所选词的释义'));
  try{const items=words.map(word=>({word,meaning:this._resolved.get(word).meaning,note:''})),count=store.importJson(JSON.stringify({format:'hange-local-notebook',version:1,items}));for(const word of words)this._selected.delete(word);this.syncRecords();this.refresh(this.data.listPage);this.setData({error:'',message:'已加入 '+count+' 个新词，未匹配项仍保留勾选。'});}catch(error){this.setData({error:error.message});}
 },
 onCreateDeck(){if(!this._visible||this.data.busy)return;try{this.checkSource();const words=this.selectedWords();if(!words.length)throw new Error('请先勾选候选词');const key=this.deckKey(words);if(this._createdKey!==key){this._createdDeck=study.createDeck(this.data.name,words.join('\n'));this._createdKey=key;}this.refresh(this.data.listPage);wx.navigateTo({url:'/pages/wordlist/index?id='+encodeURIComponent(this._createdDeck)});}catch(error){this.setData({error:error.message});}},
 onOriginal(event){
  if(!this._visible||this.data.busy||!this._articleId)return;const row=this._byWord.get(ui.dataset(event));if(!row)return;
  try{const article=library.get(this._articleId);if(!article||article.text!==this._sourceText){this.syncArticle();this.refresh();throw new Error('正文已变化，请使用更新后的候选词定位');}const target={article:this._articleId,offset:row.start,surface:this._sourceText.slice(row.start,row.end)};if(this._returnToReader&&this._opener&&this._opener.emit){this._opener.emit('vocabularyPosition',target);wx.navigateBack();}else wx.redirectTo({url:'/pages/reader/index?id='+encodeURIComponent(this._articleId)+'&offset='+row.start});}catch(error){this.setData({error:error.message});}
 },
 onHide(){this._visible=false;this.cancelTask();},onUnload(){this._closed=true;this._visible=false;this._generation++;this._sourceText='';this._rows=[];this._byWord.clear();this._selected.clear();this._resolved.clear();this._favorites.clear();this._mastered.clear();}
});
