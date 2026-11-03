const dictionary = require('../../services/dictionary');
const store = require('../../utils/store');
const ui = require('../../utils/ui');
Page({
  data: { query: '', recent: [], suggestions: [], ready: false, offlineCount: dictionary.offlineCount, shortcuts: ['subordinate', 'predicative', 'collocation', 'run'], theme: 'light' },
  onShow() {
    ui.apply(this); try { this.setData({ recent: store.history().slice(0, 5) }); } catch (error) { ui.error(error); }
    dictionary.status(false).then(state => this.setData({ ready: state.ready, oxford: state.oxford, hasOffline: state.offline, offlineDefinitions: state.offlineDefinitions }));
  },
  onInput(event) {
    const query = event.detail.value; this.setData({ query }); clearTimeout(this._timer);
    this._timer = setTimeout(async () => { try { const rows = await dictionary.suggest(query); if (this.data.query === query) this.setData({ suggestions: rows }); } catch (_) {} }, 180);
  },
  onSearch() { const query = this.data.query.trim(); if (query) { this.setData({ suggestions: [] }); ui.open(query); } },
  onWord(event) { this.setData({ suggestions: [] }); ui.open(ui.dataset(event)); },
  onClear() { clearTimeout(this._timer); this.setData({ query: '', suggestions: [] }); },
  onHistory() { wx.navigateTo({ url: '/pages/history/index' }); },
  onSettings() { wx.navigateTo({ url: '/pages/settings/index' }); },
  onDictionaries() { wx.navigateTo({ url: '/pages/dictionaries/index' }); },
  onCapture(){wx.navigateTo({url:'/pages/capture/index'});},
  onTranslate(){wx.navigateTo({url:'/pages/translate/index'});},
  onLibrary(){wx.navigateTo({url:'/pages/library/index'});},
  onDaily(event){wx.navigateTo({url:'/pages/daily/index?mode='+ui.dataset(event,'mode')});},
  onKnowledge(){wx.navigateTo({url:'/pages/knowledge/index'});},
  onHide() { clearTimeout(this._timer); },
  onShareAppMessage() { return { title: '涵词典 · 把用法查清楚', path: '/pages/search/index' }; }
});
