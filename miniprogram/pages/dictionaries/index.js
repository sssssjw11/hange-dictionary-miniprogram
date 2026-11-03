const pack = require('../../services/offline-pack');
const ui = require('../../utils/ui');
Page({
  data: { theme: 'light', installed: false, working: false, progress: 0, message: '', error: '', title: '', definitions: 0, redirects: 0, size: '' },
  update(value){if(!this._unloaded)this.setData(value);},
  onShow() { this._unloaded=false;ui.apply(this);this.refresh();clearInterval(this._poll);this._poll=setInterval(()=>{if(pack.progress().working||this.data.working)this.refresh();},1000); },
  onHide(){clearInterval(this._poll);},
  async refresh() { const state = await pack.status(); this.update(Object.assign({}, state,pack.progress(), { error: state.error || pack.progress().error || '', size: state.bytes ? (state.bytes / 1048576).toFixed(1) + ' MiB' : '' })); },
  onImport() {
    if (this.data.working) return;
    wx.chooseMessageFile({ count: 5, type: 'file', extension: ['zip'], success: async result => {
      this.update({ working: true, progress: 0, message: '检查词库分卷', error: '' });
      try { await pack.install(result.tempFiles.map(file => file.path), (message, value) => this.update({ message, progress: Math.min(100, Math.round(value)) })); this.update({ message: '牛津词库已完整导入', progress: 100 }); await this.refresh(); }
      catch (error) { this.update({ error: error.message, message: '导入未完成，生词本和笔记保持不变' }); }
      finally { this.update({ working: false }); }
    }, fail(error) { if (!/cancel/.test(error.errMsg || '')) ui.error(new Error('无法选择词库文件')); } });
  },
  async onRemove() { if (this.data.working || !await ui.confirm('移除离线牛津词库？', '只移除已导入的词库文件，生词本、笔记和历史会保留。')) return; try { await pack.remove(); this.update({ message: '离线词库已移除', progress: 0 }); await this.refresh(); } catch (error) { ui.error(error); } },
  onUnload() { this._unloaded = true;clearInterval(this._poll); }
});
