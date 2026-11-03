const config = require('../../config');
const store = require('../../utils/store');
const cache = require('../../utils/cache');
const dictionary = require('../../services/dictionary');
const ui = require('../../utils/ui');
const api = require('../../services/api');
Page({
  data: { theme: 'light', selectedTheme: 'system', fontSize: 16, apiBase: '', online: true, checking: false, statusText: '', serviceRows:[], offlineCount: dictionary.offlineCount },
  onShow() { const settings = store.settings(); this.setData({ selectedTheme: settings.theme, apiBase: settings.apiBase === null ? config.apiBase : settings.apiBase, online: settings.online }); ui.apply(this); },
  onTheme(event) { const theme = ui.dataset(event, 'theme'); store.saveSettings({ theme }); this.setData({ selectedTheme: theme }); ui.apply(this); },
  onSize(event) { store.saveSettings({ fontSize: Number(ui.dataset(event, 'size')) }); ui.apply(this); },
  onAddress(event) { this.setData({ apiBase: event.detail.value }); },
  onDictionaries() { wx.navigateTo({ url: '/pages/dictionaries/index' }); },
  onBackup(){wx.navigateTo({url:'/pages/backup/index'});},
  onOnline(event) { store.saveSettings({ online: event.detail.value }); this.setData({ online: event.detail.value, statusText: '' }); dictionary.reset(); },
  async onConnect() {
    const value = this.data.apiBase.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/?#]+(?::\d+)?(?:\/[^\s?#]*)?$/.test(value)) return ui.error(new Error('请输入 http:// 或 https:// 开头的服务地址'));
    if (!/^https:\/\//.test(value) && !/^http:\/\/(?:127\.0\.0\.1|localhost|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?(?:\/|$)/.test(value)) return ui.error(new Error('公网服务必须使用 HTTPS'));
    store.saveSettings({ apiBase: value, online: true }); dictionary.reset(); this.setData({ checking: true, online: true });
    const state = await dictionary.status(true); this.setData({ checking: false, statusText: state.ready ? (state.oxford ? '已连接 · 牛津十版 + 补充词库' : '已连接 · 补充词库，未配置牛津数据') : state.connected?'配套服务已连接，服务端尚未配置词库；已导入的微信离线词库仍可使用。':'连接未成功。开发工具可用本机地址，手机需同一局域网地址或 HTTPS 服务。' });
    if(state.connected)try{const caps=await api.request('capabilities');this.setData({serviceRows:[['tts','朗读'],['ocr','拍照识词'],['asr','录音转写'],['ai','AI 学习助手'],['translation','全文翻译']].map(([key,name])=>({name,available:!!caps[key].available,detail:caps[key].available?(caps[key].engine||caps[key].model||'已连接真实服务'):caps[key].reason}))});}catch(error){this.setData({statusText:error.message});}
  },
  async onClearCache() { if (await ui.confirm('清理查词缓存？', '生词本、笔记和历史记录会保留。')) { try { cache.clear(); wx.showToast({ title: '缓存已清理' }); } catch (error) { ui.error(error); } } }
});
