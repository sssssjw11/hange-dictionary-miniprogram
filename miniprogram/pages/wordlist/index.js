const study=require('../../services/study');
const ui=require('../../utils/ui');
const list=require('../../utils/list');
Page({
 data:{theme:'light',name:'',text:'',query:'',fileName:'',fileCharacters:0,creating:false,rows:[],total:0,listPage:0,listPages:1,id:'',custom:false,mastered:false},
 onLoad(options){if(options.name)this.setData({name:ui.decode(options.name),creating:true});else{const id=ui.decode(options.id||'favorites'),deck=study.decks().find(item=>item.id===id);this.setData({id,name:id==='mastered'?'熟词管理':deck?deck.name:'词表',custom:!!deck&&!deck.system,mastered:id==='mastered'});}},
 onShow(){ui.apply(this);if(!this.data.creating)this.refresh();},
 words(){return this.data.mastered?study.mastered():study.words(this.data.id);},
 refresh(index=0){try{const query=this.data.query.toLowerCase(),rows=this.words().filter(word=>word.toLowerCase().includes(query));this.setData(list.page(rows,index,50));}catch(error){ui.error(error);}},
 onSearch(event){this.setData({query:event.detail.value});this.refresh();},
 onPrev(){this.refresh(this.data.listPage-1);},onNext(){this.refresh(this.data.listPage+1);},
 onInput(event){this.setData({text:event.detail.value});},onManual(){this._fileText=null;this.setData({fileName:'',fileCharacters:0,text:''});},onWord(event){ui.open(ui.dataset(event));},
 onRelearn(event){try{study.known(ui.dataset(event),false);this.refresh(this.data.listPage);}catch(error){ui.error(error);}},
 onExport(){try{const words=this.words(),name='涵词典-词表-'+Date.now()+'.txt',file=wx.env.USER_DATA_PATH+'/'+name;wx.getFileSystemManager().writeFile({filePath:file,data:words.join('\n'),encoding:'utf8',success(){if(wx.shareFileMessage)wx.shareFileMessage({filePath:file,fileName:name});else wx.setClipboardData({data:words.join('\n')});},fail:()=>ui.error(new Error('词表导出失败'))});}catch(error){ui.error(error);}},
 onSave(){try{study.createDeck(this.data.name,this._fileText===null||this._fileText===undefined?this.data.text:this._fileText);wx.navigateBack();}catch(error){ui.error(error);}},
 onImport(){wx.chooseMessageFile({count:1,type:'file',extension:['txt','csv','tsv'],success:result=>{const file=result.tempFiles[0];if(file.size>2*1048576)return ui.error(new Error('词表文件最多 2 MiB'));wx.getFileSystemManager().readFile({filePath:file.path,encoding:'utf8',success:result=>{this._fileText=result.data;this.setData({text:'',fileName:file.name,fileCharacters:result.data.length});},fail:()=>ui.error(new Error('请使用 UTF-8 编码的文本词表'))});}});},
 async onDelete(){if(await ui.confirm('删除自定义词表？','词表会移除，已学单词的复习进度和生词本会保留。')){try{study.deleteDeck(this.data.id);wx.navigateBack();}catch(error){ui.error(error);}}}
});
