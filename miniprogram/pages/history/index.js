const store = require('../../utils/store');
const ui = require('../../utils/ui');
Page({
  data: { rows: [], theme: 'light' },
  onShow() { ui.apply(this); try { this.setData({ rows: store.history() }); } catch (error) { ui.error(error); } },
  onWord(event) { ui.open(ui.dataset(event)); },
  async onClear() { if (await ui.confirm('清空查词记录？', '生词本和笔记会保留。')) try { store.clearHistory(); this.setData({ rows: [] }); } catch (error) { ui.error(error); } }
});
