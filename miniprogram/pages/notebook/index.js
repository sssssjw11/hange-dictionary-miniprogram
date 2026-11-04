const store=require('../../utils/store');
const ui=require('../../utils/ui');
const list=require('../../utils/list');
Page({
 data:{rows:[],query:'',count:0,total:0,listPage:0,listPages:1,theme:'light',book:'all',books:[],bookIndex:0,selecting:false,selectedCount:0,groupPicker:false,groupingWord:'',groupingWords:[],groupingMeaning:''},
 onShow(){ui.apply(this);this._selected=this._selected||new Set();if(typeof getApp==='function'){const app=getApp();if(app.globalData.notebookGroupId){this._selected.clear();this.setData({book:app.globalData.notebookGroupId,query:'',selecting:false,selectedCount:0});delete app.globalData.notebookGroupId;}}this.refresh();},
 refresh(index=0){
  try{
   const all=store.favorites(),groups=store.groups(),books=[{id:'all',label:'全部生词 · '+all.length},{id:'ungrouped',label:'未分组 · '+all.filter(item=>!item.groups.length).length}].concat(groups.map(item=>({id:item.id,label:item.name+' · '+item.count})));
   const existing=new Set(all.map(item=>item.word));for(const word of this._selected)if(!existing.has(word))this._selected.delete(word);
   let book=this.data.book;if(!books.some(item=>item.id===book)){book='all';this._selected.clear();}
   const query=this.data.query.toLowerCase(),names=new Map(groups.map(item=>[item.id,item.name]));
   const rows=store.favorites(book).filter(item=>(item.word+item.meaning+item.note).toLowerCase().includes(query));
   const result=list.page(rows,index);result.rows=result.rows.map(item=>Object.assign({},item,{bookNames:item.groups.map(id=>names.get(id)).join(' / '),checked:this._selected.has(item.word)}));
   this.setData(Object.assign({count:all.length,book,books,bookIndex:books.findIndex(item=>item.id===book),selectedCount:this._selected.size},result));
  }catch(error){ui.error(error);}
 },
 onPrev(){this.refresh(this.data.listPage-1);},onNext(){this.refresh(this.data.listPage+1);},
 onInput(event){this._selected.clear();this.setData({query:event.detail.value,selectedCount:0});this.refresh();},
 onBook(event){const book=this.data.books[Number(event.detail.value)];if(book){this._selected.clear();this.setData({book:book.id,query:'',selectedCount:0,selecting:false});this.refresh();}},
 onManage(){wx.navigateTo({url:'/pages/groups/index'});},
 onLookup(){wx.switchTab({url:'/pages/search/index'});},
 onWord(event){ui.open(ui.dataset(event));},
 onToggleSelect(){this._selected.clear();this.setData({selecting:!this.data.selecting,selectedCount:0});this.refresh(this.data.listPage);},
 onSelection(event){const next=new Set(this._selected);for(const item of this.data.rows)next.delete(item.word);for(const word of event.detail.value)if(this.data.rows.some(item=>item.word===word))next.add(word);if(next.size>500){ui.error(new Error('每次最多批量整理 500 词'));this.refresh(this.data.listPage);return;}this._selected=next;this.refresh(this.data.listPage);},
 onSelectPage(){const next=new Set(this._selected),remove=this.data.rows.every(item=>next.has(item.word));for(const item of this.data.rows)remove?next.delete(item.word):next.add(item.word);if(next.size>500)return ui.error(new Error('每次最多批量整理 500 词'));this._selected=next;this.refresh(this.data.listPage);},
 onAssign(event){const word=ui.dataset(event),item=store.favorite(word);if(item)this.setData({groupPicker:true,groupingWord:item.word,groupingWords:[],groupingMeaning:item.meaning});},
 onAssignSelection(){if(!this._selected.size)return ui.error(new Error('请先勾选单词'));this.setData({groupPicker:true,groupingWord:'',groupingWords:Array.from(this._selected),groupingMeaning:''});},
 onGroupSaved(){this._selected.clear();this.setData({groupPicker:false,selecting:false,selectedCount:0});this.refresh(this.data.listPage);},
 onGroupClose(){this.setData({groupPicker:false});},
 onHide(){this.setData({groupPicker:false});},
  onExport() {
    try { if(store.favorites(this.data.book).length>2000)return wx.navigateTo({url:'/pages/backup/index'});const text = store.exportJson(this.data.book);
      wx.showActionSheet({ itemList: ['导出 JSON 文件', '复制备份文本'], success: result => {
        if (result.tapIndex === 1) return wx.setClipboardData({ data: text });
        const name = '涵词典-生词本-' + Date.now() + '.json', path = wx.env.USER_DATA_PATH + '/' + name;
        wx.getFileSystemManager().writeFile({ filePath: path, data: text, encoding: 'utf8', success() {
          if (wx.shareFileMessage) wx.shareFileMessage({ filePath: path, fileName: name, fail(error) { if (!/cancel/.test(error.errMsg || '')) ui.error(new Error('文件已生成，可使用复制备份文本导出')); } });
          else wx.setClipboardData({ data: text });
        }, fail() { ui.error(new Error('文件写入失败，请使用复制备份文本')); } });
      } });
    } catch (error) { ui.error(error); }
  },
  onImport() {
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['json'], success: result => {
      const file = result.tempFiles[0]; if (!file || file.size > 1048576) return ui.error(new Error('请选择不超过 1 MiB 的 JSON 备份'));
      wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'utf8', success: async result => {
        try { const items = store.parseImport(result.data); if (!await ui.confirm('导入生词本', '备份含 ' + items.length + ' 个词条。已有词条和笔记会保留。')) return;
          const count = store.importJson(result.data,this.data.book!=='all'&&this.data.book!=='ungrouped'?this.data.book:null); this.refresh(); wx.showToast({ title: '导入 ' + count + ' 个新词', icon: 'none' });
        } catch (error) { ui.error(error); }
      }, fail() { ui.error(new Error('无法读取备份文件')); } });
    }, fail(error) { if (!/cancel/.test(error.errMsg || '')) ui.error(new Error('无法选择备份文件')); } });
  }
});
