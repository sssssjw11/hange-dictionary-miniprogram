const study=require('../../services/study');
const dictionary=require('../../services/dictionary');
const store=require('../../utils/store');
const ui=require('../../utils/ui');
const list=require('../../utils/list');
Page({
 data:{theme:'light',name:'',text:'',query:'',fileName:'',fileCharacters:0,creating:false,rows:[],total:0,listPage:0,listPages:1,id:'',custom:false,mastered:false,oxfordCatalog:false,oxfordList:false,loading:false,error:'',uniqueWords:0,sourceRecords:0,imported:false},
 onLoad(options){this._closed=false;if(options.source==='oxford'){this._oxfordMode='catalog';this.setData({oxfordCatalog:true,name:'牛津词库词表'});return;}if(options.oxford){this._oxfordMode='list';this._oxfordId=ui.decode(options.oxford);this.setData({oxfordList:true,name:'正在读取词表…'});return;}if(options.name)this.setData({name:ui.decode(options.name),creating:true});else{const id=ui.decode(options.id||'favorites'),deck=study.decks().find(item=>item.id===id);this.setData({id,name:id==='mastered'?'熟词管理':deck?deck.name:'词表',custom:!!deck&&!deck.system,mastered:id==='mastered'});}},
 onShow(){ui.apply(this);if(!this.data.creating)this.refresh(this.data.listPage);},
 words(){if(this._sourceList){const unique=new Map();for(const row of this._sourceList.rows)if(!unique.has(store.key(row.word)))unique.set(store.key(row.word),row.word);return Array.from(unique.values());}return this.data.mastered?study.mastered():study.words(this.data.id);},
 refresh(index=0){if(this._oxfordMode)return this.refreshOxford(index);try{const query=this.data.query.toLowerCase(),rows=this.words().filter(word=>word.toLowerCase().includes(query));this.setData(list.page(rows,index,50));}catch(error){ui.error(error);}},
 async refreshOxford(index=0){
  const generation=this._generation=(this._generation||0)+1;this.setData({loading:true,error:''});
  try{
   if(this._oxfordMode==='catalog'){
    if(!this._catalogTask)this._catalogTask=dictionary.wordListCatalog().catch(error=>{this._catalogTask=null;throw error;});
    const catalog=await this._catalogTask;if(this._closed||generation!==this._generation)return;
    const query=store.key(this.data.query),rows=catalog.filter(row=>store.key(row.name+' '+row.group).includes(query)).map(row=>({id:row.id,name:row.name,group:row.group}));
    this.setData(Object.assign(list.page(rows,index,20),{loading:false}));
   }else{
    if(!this._sourceTask)this._sourceTask=dictionary.wordList(this._oxfordId).catch(error=>{this._sourceTask=null;throw error;});
    const result=await this._sourceTask;if(this._closed||generation!==this._generation)return;
    this._sourceList=result;const query=store.key(this.data.query),rows=result.rows.map((row,index)=>Object.assign({},row,{index})).filter(row=>store.key(row.word+' '+row.pos+' '+row.level+' '+row.note).includes(query));
    const deck=study.sourceDeck(this._oxfordId);this._sourceDeckId=deck?deck.id:'';
    this.setData(Object.assign(list.page(rows,index,50),{loading:false,name:result.name,uniqueWords:result.uniqueWords,sourceRecords:result.sourceRecords,imported:!!deck}));
   }
  }catch(error){if(!this._closed&&generation===this._generation)this.setData({loading:false,error:error.message});}
 },
 onRetryOxford(){this._catalogTask=null;this._sourceTask=null;this.refresh();},
 onOxfordCatalog(event){wx.navigateTo({url:'/pages/wordlist/index?oxford='+encodeURIComponent(ui.dataset(event,'id'))});},
 onOxfordWord(event){
  const row=this._sourceList&&this._sourceList.rows[Number(ui.dataset(event,'index'))];if(!row)return;
  wx.navigateTo({url:'/pages/entry/index?q='+encodeURIComponent(row.query||row.word)+'&ref=1&label='+encodeURIComponent(row.word)+(row.anchor?'&anchor='+encodeURIComponent(row.anchor):'')});
 },
 onOxfordRelated(event){const row=this._sourceList&&this._sourceList.rows[Number(ui.dataset(event,'index'))];if(row&&row.relatedWord)wx.navigateTo({url:'/pages/entry/index?q='+encodeURIComponent(row.relatedWord)+'&ref=1&label='+encodeURIComponent(row.word)});},
 onOxfordImport(){try{if(!this._sourceList)return;this._sourceDeckId=study.importSourceDeck(this._oxfordId,this._sourceList.name,this.words());this.setData({imported:true});wx.showToast({title:'已加入学习词表'});}catch(error){ui.error(error);}},
 onOxfordLearn(){if(this._sourceDeckId)wx.navigateTo({url:'/pages/review/index?deck='+encodeURIComponent(this._sourceDeckId)+'&mode=flash'});},
 onOxfordPlay(){if(this._sourceDeckId)wx.navigateTo({url:'/pages/player/index?deck='+encodeURIComponent(this._sourceDeckId)});},
 onSearch(event){this.setData({query:event.detail.value});this.refresh();},
 onPrev(){this.refresh(this.data.listPage-1);},onNext(){this.refresh(this.data.listPage+1);},
 onInput(event){this.setData({text:event.detail.value});},onManual(){this._fileText=null;this.setData({fileName:'',fileCharacters:0,text:''});},onWord(event){ui.open(ui.dataset(event));},
 onRelearn(event){try{study.known(ui.dataset(event),false);this.refresh(this.data.listPage);}catch(error){ui.error(error);}},
 onExport(){try{const words=this.words(),name='涵词典-词表-'+Date.now()+'.txt',file=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFile({filePath:file,data:words.join('\n'),encoding:'utf8',success(){if(wx.shareFileMessage)wx.shareFileMessage({filePath:file,fileName:name});else wx.setClipboardData({data:words.join('\n')});},fail:()=>ui.error(new Error('词表导出失败'))});}catch(error){ui.error(error);}},
 onSave(){try{study.createDeck(this.data.name,this._fileText===null||this._fileText===undefined?this.data.text:this._fileText);wx.navigateBack();}catch(error){ui.error(error);}},
 onImport(){wx.chooseMessageFile({count:1,type:'file',extension:['txt','csv','tsv'],success:result=>{const file=result.tempFiles[0];if(file.size>2*1048576)return ui.error(new Error('词表文件最多 2 MiB'));wx.getFileSystemManager().readFile({filePath:file.path,encoding:'utf8',success:result=>{this._fileText=result.data;this.setData({text:'',fileName:file.name,fileCharacters:result.data.length});},fail:()=>ui.error(new Error('请使用 UTF-8 编码的文本词表'))});}});},
 onUnload(){this._closed=true;this._generation=(this._generation||0)+1;},
 async onDelete(){if(await ui.confirm('删除自定义词表？','词表会移除，已学单词的复习进度和生词本会保留。')){try{study.deleteDeck(this.data.id);wx.navigateBack();}catch(error){ui.error(error);}}}
});
