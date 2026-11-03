const config = require('../../config');
const store = require('../../utils/store');
const cache = require('../../utils/cache');
const dictionary = require('../../services/dictionary');
const ui = require('../../utils/ui');
Page({
  data: { theme: 'light', selectedTheme: 'system', fontSize: 16, apiBase: '', online: true, checking: false, statusText: '', offlineCount: dictionary.offlineCount },
  onShow() { const settings = store.settings(); this.setData({ selectedTheme: settings.theme, apiBase: settings.apiBase === null ? config.apiBase : settings.apiBase, online: settings.online }); ui.apply(this); },
  onTheme(event) { const theme = ui.dataset(event, 'theme'); store.saveSettings({ theme }); this.setData({ selectedTheme: theme }); ui.apply(this); },
  onSize(event) { store.saveSettings({ fontSize: Number(ui.dataset(event, 'size')) }); ui.apply(this); },
  onAddress(event) { this.setData({ apiBase: event.detail.value }); },
  onOnline(event) { store.saveSettings({ online: event.detail.value }); this.setData({ online: event.detail.value, statusText: '' }); dictionary.reset(); },
  async onConnect() {
    const value = this.data.apiBase.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/?#]+(?::\d+)?(?:\/[^\s?#]*)?$/.test(value)) return ui.error(new Error('请输入 http:// 或 https:// 开头的服务地址'));
    if (!/^https:\/\//.test(value) && !/^http:\/\/(?:127\.0\.0\.1|localhost|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?(?:\/|$)/.test(value)) return ui.error(new Error('公网服务必须使用 HTTPS'));
    store.saveSettings({ apiBase: value, online: true }); dictionary.reset(); this.setData({ checking: true, online: true });
    const state = await dictionary.status(true); this.setData({ checking: false, statusText: state.ready ? (state.oxford ? '已连接 · 牛津十版 + 补充词库' : '已连接 · 补充词库，未配置牛津数据') : '连接未成功。开发工具可用本机地址，手机需同一局域网地址或 HTTPS 服务。' });
  },
  async onClearCache() { if (await ui.confirm('清理查词缓存？', '生词本、笔记和历史记录会保留。')) { try { cache.clear(); wx.showToast({ title: '缓存已清理' }); } catch (error) { ui.error(error); } } }
});
