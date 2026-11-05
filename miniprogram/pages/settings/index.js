const config = require('../../config');
const store = require('../../utils/store');
const cache = require('../../utils/cache');
const dictionary = require('../../services/dictionary');
const ui = require('../../utils/ui');
const api = require('../../services/api');
const media=require('../../services/media');
const voicePreferences=require('../../services/voice-preferences');
const {voiceLabel}=require('../../services/pronunciation');
Page({
  data: { theme: 'light', selectedTheme: 'system', fontSize: 16, apiBase: '', online: true, checking: false, statusText: '', serviceRows:[], offlineCount: dictionary.offlineCount,voiceMode:'auto',voiceVariant:'US',ttsRate:0,previewing:false,voicePreviewStatus:'',voiceOptions:[{id:'',label:'自动选择'}],voiceIndex:0,zhVoiceOptions:[{id:'',label:'自动选择'}],zhVoiceIndex:0,voiceLoading:false,voiceCatalogStatus:'' },
  onShow() { this._closed=false;const settings = store.settings(); this.setData({ selectedTheme: settings.theme, apiBase: settings.apiBase === null ? config.apiBase : settings.apiBase, online: settings.online,checking:false,voiceLoading:false,voiceMode:settings.voiceMode,voiceVariant:settings.voiceVariant,ttsRate:settings.ttsRate });this.refreshVoiceOptions(); ui.apply(this); },
  saveVoice(value){this.stopPreview();try{store.saveSettings(value);const settings=store.settings();this.setData({voiceMode:settings.voiceMode,voiceVariant:settings.voiceVariant,ttsRate:settings.ttsRate});this.refreshVoiceOptions();}catch(error){ui.error(error);}},
  refreshVoiceOptions(){
    const settings=store.settings(),origin=api.base(),catalog=this._voiceCatalogBase===origin?this._voiceCatalog:[],english=voicePreferences.choices(catalog,'en',settings.voiceVariant==='UK'?'en-GB':'en-US',voicePreferences.selected(settings,origin,'en',settings.voiceVariant)),chinese=voicePreferences.choices(catalog,'zh','zh-CN',voicePreferences.selected(settings,origin,'zh','US'));
    this.setData({voiceOptions:english.rows,voiceIndex:english.index,zhVoiceOptions:chinese.rows,zhVoiceIndex:chinese.index});
  },
  applyVoiceCatalog(catalog,origin){this._voiceCatalog=Array.isArray(catalog)?catalog:[];this._voiceCatalogBase=origin;this.refreshVoiceOptions();},
  async onLoadVoices(){
    if(this.data.voiceLoading||this.data.checking)return;this.stopPreview();const generation=this._voiceRequest=(this._voiceRequest||0)+1,origin=api.base();this.setData({voiceLoading:true,voiceCatalogStatus:'正在读取已安装音色…'});
    try{const result=await api.request('voices',{refresh:'1'},'GET',20000);if(this._closed||generation!==this._voiceRequest||origin!==api.base())return;
      if(!Array.isArray(result.voices))throw new Error('音色列表格式无效，请更新配套服务');this.applyVoiceCatalog(result.voices,origin);this.setData({voiceCatalogStatus:result.available?'已读取 '+result.voices.length+' 个系统音色；具体音色使用其实际口音。':result.reason||'当前服务未提供可用音色'});
    }catch(error){if(!this._closed&&generation===this._voiceRequest)this.setData({voiceCatalogStatus:error.message==='接口不存在'?'请更新配套服务后读取音色':error.message});}
    finally{if(!this._closed&&generation===this._voiceRequest)this.setData({voiceLoading:false});}
  },
  onInstalledVoice(event){
    const chinese=ui.dataset(event,'kind')==='zh',rows=chinese?this.data.zhVoiceOptions:this.data.voiceOptions,index=Number(event.detail.value);if(!Number.isInteger(index)||!rows[index])return ui.error(new Error('请选择列表中的音色'));
    const origin=api.base(),settings=store.settings(),values=settings.ttsVoiceBase===origin?Object.assign({},settings.ttsVoices):{};values[chinese?'zh':settings.voiceVariant]=rows[index].id;this.saveVoice({ttsVoiceBase:origin,ttsVoices:values});
  },
  onVoiceMode(event){this.saveVoice({voiceMode:ui.dataset(event,'mode')});},
  onVoiceVariant(event){this.saveVoice({voiceVariant:ui.dataset(event,'variant')});},
  onTtsRate(event){this.saveVoice({ttsRate:Number(ui.dataset(event,'rate'))});},
  stopPreview(){this._preview=(this._preview||0)+1;media.stopAudio();if(!this._closed)this.setData({previewing:false,voicePreviewStatus:''});},
  async onPreview(){
    if(this.data.previewing){this.stopPreview();return;}const generation=this._preview=(this._preview||0)+1;this.setData({previewing:true,voicePreviewStatus:'正在准备合成音色…'});
    try{await media.speakAndWait('Learning starts with a single word.',undefined,'en',undefined,data=>{if(!this._closed&&generation===this._preview)this.setData({voicePreviewStatus:voiceLabel(Object.assign({},data,{kind:'tts'}))});});}
    catch(error){if(!this._closed&&generation===this._preview){this.setData({voicePreviewStatus:error.message});ui.error(error);}}
    finally{if(!this._closed&&generation===this._preview)this.setData({previewing:false});}
  },
  onHide(){this._voiceRequest=(this._voiceRequest||0)+1;if(!this._closed)this.setData({voiceLoading:false,voiceCatalogStatus:this.data.voiceLoading?'':this.data.voiceCatalogStatus});this.stopPreview();},onUnload(){this._closed=true;this._voiceRequest=(this._voiceRequest||0)+1;this.stopPreview();},
  onTheme(event) { const theme = ui.dataset(event, 'theme'); store.saveSettings({ theme }); this.setData({ selectedTheme: theme }); ui.apply(this); },
  onSize(event) { store.saveSettings({ fontSize: Number(ui.dataset(event, 'size')) }); ui.apply(this); },
  onAddress(event) { this.stopPreview();this.setData({ apiBase: event.detail.value }); },
  onDictionaries() { wx.navigateTo({ url: '/pages/dictionaries/index' }); },
  onBackup(){wx.navigateTo({url:'/pages/backup/index'});},
  onOnline(event) { this.stopPreview();store.saveSettings({ online: event.detail.value }); this.setData({ online: event.detail.value, statusText: '' }); dictionary.reset(); },
  async onConnect() {
    const value=this.data.apiBase.trim().replace(/\/+$/,'');
    if(!/^https?:\/\/[^\s/?#]+(?::\d+)?(?:\/[^\s?#]*)?$/.test(value))return ui.error(new Error('请输入 http:// 或 https:// 开头的服务地址'));
    if(!/^https:\/\//.test(value)&&!/^http:\/\/(?:127\.0\.0\.1|localhost|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?(?:\/|$)/.test(value))return ui.error(new Error('公网服务必须使用 HTTPS'));
    const generation=this._voiceRequest=(this._voiceRequest||0)+1;this.stopPreview();store.saveSettings({apiBase:value,online:true});dictionary.reset();this.refreshVoiceOptions();this.setData({checking:true,online:true,statusText:'',voiceLoading:true,voiceCatalogStatus:''});
    try{
      const state=await dictionary.status(true);if(this._closed||generation!==this._voiceRequest||value!==api.base())return;
      this.setData({statusText:state.ready?(state.oxford?'已连接 · 牛津十版 + 补充词库':'已连接 · 补充词库，未配置牛津数据'):state.connected?'配套服务已连接，服务端尚未配置词库；已导入的微信离线词库仍可使用。':'连接未成功。开发工具可用本机地址，手机需同一局域网地址或 HTTPS 服务。'});
      if(state.connected){const caps=await api.request('capabilities');if(this._closed||generation!==this._voiceRequest||value!==api.base())return;this.applyVoiceCatalog((caps.tts||{}).voices,value);this.setData({serviceRows:[['tts','朗读'],['ocr','拍照识词'],['asr','录音转写'],['ai','AI 学习助手'],['translation','全文翻译']].map(([key,name])=>{const row=caps[key]||{};return{name,available:!!row.available,detail:row.available?(row.engine||row.model||'已连接真实服务'):row.reason||'当前服务未提供此能力'};})});}
    }catch(error){if(!this._closed&&generation===this._voiceRequest)this.setData({statusText:error.message});}
    finally{if(!this._closed&&generation===this._voiceRequest)this.setData({checking:false,voiceLoading:false});}
  },
  async onClearCache() { if (await ui.confirm('清理查词缓存？', '生词本、笔记和历史记录会保留。')) { try { cache.clear(); wx.showToast({ title: '缓存已清理' }); } catch (error) { ui.error(error); } } }
});
