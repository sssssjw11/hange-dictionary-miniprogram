const config = require('../../config');
const store = require('../../utils/store');
const cache = require('../../utils/cache');
const dictionary = require('../../services/dictionary');
const ui = require('../../utils/ui');
const api = require('../../services/api');
const media=require('../../services/media');
Page({
  data: { theme: 'light', selectedTheme: 'system', fontSize: 16, apiBase: '', online: true, checking: false, statusText: '', serviceRows:[], offlineCount: dictionary.offlineCount,voiceMode:'auto',voiceVariant:'US',ttsRate:0,previewing:false,voicePreviewStatus:'' },
  onShow() { this._closed=false;const settings = store.settings(); this.setData({ selectedTheme: settings.theme, apiBase: settings.apiBase === null ? config.apiBase : settings.apiBase, online: settings.online,voiceMode:settings.voiceMode,voiceVariant:settings.voiceVariant,ttsRate:settings.ttsRate }); ui.apply(this); },
  saveVoice(value){this.stopPreview();try{store.saveSettings(value);const settings=store.settings();this.setData({voiceMode:settings.voiceMode,voiceVariant:settings.voiceVariant,ttsRate:settings.ttsRate});}catch(error){ui.error(error);}},
  onVoiceMode(event){this.saveVoice({voiceMode:ui.dataset(event,'mode')});},
  onVoiceVariant(event){this.saveVoice({voiceVariant:ui.dataset(event,'variant')});},
  onTtsRate(event){this.saveVoice({ttsRate:Number(ui.dataset(event,'rate'))});},
  stopPreview(){this._preview=(this._preview||0)+1;media.stopAudio();if(!this._closed)this.setData({previewing:false,voicePreviewStatus:''});},
  async onPreview(){
    if(this.data.previewing){this.stopPreview();return;}const generation=this._preview=(this._preview||0)+1;this.setData({previewing:true,voicePreviewStatus:'正在准备合成音色…'});
    try{await media.speakAndWait('Learning starts with a single word.',undefined,'en',undefined,data=>{if(!this._closed&&generation===this._preview)this.setData({voicePreviewStatus:'系统合成 · '+data.locale+(data.variantFallback?'（未安装所选口音）':'')});});}
    catch(error){if(!this._closed&&generation===this._preview){this.setData({voicePreviewStatus:error.message});ui.error(error);}}
    finally{if(!this._closed&&generation===this._preview)this.setData({previewing:false});}
  },
  onHide(){this.stopPreview();},onUnload(){this._closed=true;this.stopPreview();},
  onTheme(event) { const theme = ui.dataset(event, 'theme'); store.saveSettings({ theme }); this.setData({ selectedTheme: theme }); ui.apply(this); },
  onSize(event) { store.saveSettings({ fontSize: Number(ui.dataset(event, 'size')) }); ui.apply(this); },
  onAddress(event) { this.stopPreview();this.setData({ apiBase: event.detail.value }); },
  onDictionaries() { wx.navigateTo({ url: '/pages/dictionaries/index' }); },
  onBackup(){wx.navigateTo({url:'/pages/backup/index'});},
  onOnline(event) { this.stopPreview();store.saveSettings({ online: event.detail.value }); this.setData({ online: event.detail.value, statusText: '' }); dictionary.reset(); },
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
