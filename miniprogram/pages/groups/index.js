const store=require('../../utils/store');
const ui=require('../../utils/ui');
Page({
 data:{theme:'light',rows:[],total:0},
 onShow(){ui.apply(this);this.refresh();},
 refresh(){try{this.setData({rows:store.groups(),total:store.favorites().length});}catch(error){ui.error(error);}},
 onCreate(){wx.showModal({title:'新建生词本',editable:true,placeholderText:'名称，最多 40 字',success:result=>{if(!result.confirm)return;try{store.createGroup(result.content);this.refresh();}catch(error){ui.error(error);}}});},
 onRename(event){const id=ui.dataset(event,'id'),group=store.groups().find(item=>item.id===id);if(!group)return;wx.showModal({title:'重命名生词本',editable:true,content:group.name,success:result=>{if(!result.confirm)return;try{store.renameGroup(id,result.content);this.refresh();}catch(error){ui.error(error);}}});},
 async onDelete(event){if(!await ui.confirm('删除这个生词本？','只移除分组及其归属，单词、笔记和复习进度会保留。'))return;try{store.removeGroup(ui.dataset(event,'id'));this.refresh();}catch(error){ui.error(error);}},
 onOpen(event){getApp().globalData.notebookGroupId=ui.dataset(event,'id');wx.switchTab({url:'/pages/notebook/index'});}
});
