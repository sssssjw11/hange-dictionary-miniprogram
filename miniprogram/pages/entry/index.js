const dictionary = require('../../services/dictionary');
const store = require('../../utils/store');
const ui = require('../../utils/ui');
const POS = { n: '名词', v: '动词', a: '形容词', r: '副词' };
Page({
  data: { loading: true, error: '', matches: [], entry: null, favorite: false, note: '', noteStatus: '', source: '', oxfordBlocks: [], senses: [], page: 0, totalPages: 1, theme: 'light', fontSize: 16 },
  onLoad(options) { let query; try { query = decodeURIComponent(options.q || ''); } catch (_) { query = options.q || ''; } this._query = query; this.load(query); },
  onShow() { ui.apply(this); if (this._entry) this.refreshFavorite(); },
  async load(word) {
    const generation = (this._generation || 0) + 1; this._generation = generation; this._query = word;
    this._entry = null; this.setData({ loading: true, error: '', matches: [], entry: null });
    try {
      const result = await dictionary.lookup(word); if (this._generation !== generation) return;
      if (result.kind !== 'entry') { this._entry = null; this.setData({ loading: false, matches: result.matches || result.suggestions || [], partial: !!result.partial, error: result.kind === 'matches' ? (result.matches.length ? '' : '没有匹配的中文释义，请缩短关键词再试。') : '本地词库暂未匹配到，可调整拼写或查询原形。', matchQuery: word }); return; }
      this._entry = result;
      const meaning = result.zh || (result.teaching || {}).title || '';
      try { store.visit(result.word, meaning); } catch (error) { ui.error(error); }
      const hasOxford = !!(result.oxford && result.oxford.blocks.length), hasTeaching = !!result.teaching;
      this.setData({ loading: false, entry: { word: result.word, phonetic: result.phonetic || '', zh: result.zh || '', en: result.en || '', forms: result.forms || [], matchedFrom: result.matchedFrom || '', sourceLabel: result.source === 'cache' ? '已缓存 · 可离线重看' : result.source === 'builtin' ? '内置离线词条' : '全量词库', hasOxford, hasTeaching, hasSenses: !!(result.senses || []).length }, teaching: result.teaching || null, related: result.related || [], source: hasOxford ? 'oxford' : hasTeaching ? 'teaching' : 'wordnet' });
      this.refreshFavorite(); this.contentPage(0); wx.setNavigationBarTitle({ title: result.word });
    } catch (error) { if (this._generation === generation) this.setData({ loading: false, error: error.message }); }
  },
  refreshFavorite() { try { const item = store.favorite(this._entry.word); this.setData({ favorite: !!item, note: item ? item.note : '', noteStatus: item && item.note ? '已保存到本机' : '' }); } catch (error) { ui.error(error); } },
  contentPage(index) {
    const entry = this._entry; if (!entry) return;
    const oxford = this.data.source === 'oxford'; const rows = oxford ? entry.oxford.blocks : (entry.senses || []); const size = oxford ? 4 : 8;
    const totalPages = Math.max(1, Math.ceil(rows.length / size)); index = Math.min(Math.max(0, index), totalPages - 1);
    this.setData({ page: index, totalPages, totalItems: rows.length, oxfordBlocks: oxford ? rows.slice(index * size, (index + 1) * size) : [], senses: oxford ? [] : rows.slice(index * size, (index + 1) * size).map(row => Object.assign({}, row, { posLabel: POS[row.pos] || row.pos })) });
  },
  onSource(event) { this.setData({ source: ui.dataset(event, 'source') }); this.contentPage(0); },
  onPrev() { this.contentPage(this.data.page - 1); wx.pageScrollTo({ selector: '#content-start', duration: 180 }); },
  onNext() { this.contentPage(this.data.page + 1); wx.pageScrollTo({ selector: '#content-start', duration: 180 }); },
  onWord(event) { const word = ui.dataset(event); if (word) { this.load(word); wx.pageScrollTo({ scrollTop: 0, duration: 0 }); } },
  onRetry() { dictionary.reset(); this.load(this._query); },
  async onFavorite() {
    if (!this._entry) return;
    try { const item = store.favorite(this._entry.word); if (item && item.note && !await ui.confirm('移出生词本？', '这个词的本地笔记也会移除。')) return;
      store.toggle(this._entry.word, this._entry.zh || (this._entry.teaching || {}).title); this.refreshFavorite();
    } catch (error) { ui.error(error); }
  },
  onNote(event) { this.setData({ note: event.detail.value, noteStatus: '尚未保存' }); },
  onSaveNote() { if (!this._entry) return; try { store.saveNote(this._entry.word, this._entry.zh || (this._entry.teaching || {}).title, this.data.note); this.setData({ favorite: true, noteStatus: '已保存到本机' }); wx.showToast({ title: '笔记已保存', icon: 'success' }); } catch (error) { ui.error(error); } },
  onCopy() { if (this._entry) wx.setClipboardData({ data: this._entry.word }); },
  onUnload() { this._generation = (this._generation || 0) + 1; },
  onShareAppMessage() { return { title: this._entry ? this._entry.word + ' · 涵词典' : '涵词典', path: '/pages/entry/index?q=' + encodeURIComponent(this._query) }; }
});
