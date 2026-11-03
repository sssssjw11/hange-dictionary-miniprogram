const store = require('../../utils/store');
const ui = require('../../utils/ui');
const list = require('../../utils/list');
Page({
  data: { rows: [], query: '', count: 0, total: 0, listPage: 0, listPages: 1, theme: 'light' },
  onShow() { ui.apply(this); this.refresh(); },
  refresh(index=0) { try { const all = store.favorites(), query = this.data.query.toLowerCase(); this.setData(Object.assign({count:all.length},list.page(all.filter(x => (x.word + x.meaning + x.note).toLowerCase().includes(query)),index))); } catch (error) { ui.error(error); } },
  onPrev(){this.refresh(this.data.listPage-1);},onNext(){this.refresh(this.data.listPage+1);},
  onInput(event) { this.setData({ query: event.detail.value }); this.refresh(); },
  onWord(event) { ui.open(ui.dataset(event)); },
  onExport() {
    try { if(store.favorites().length>2000)return wx.navigateTo({url:'/pages/backup/index'});const text = store.exportJson();
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
          const count = store.importJson(result.data); this.refresh(); wx.showToast({ title: '导入 ' + count + ' 个新词', icon: 'none' });
        } catch (error) { ui.error(error); }
      }, fail() { ui.error(new Error('无法读取备份文件')); } });
    }, fail(error) { if (!/cancel/.test(error.errMsg || '')) ui.error(new Error('无法选择备份文件')); } });
  }
});
