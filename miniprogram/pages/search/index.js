const dictionary=require('../../services/dictionary');
const store=require('../../utils/store');
const ui=require('../../utils/ui');
Page({
  data:{query:'',recent:[],suggestions:[],ready:false,offlineCount:dictionary.offlineCount,shortcuts:['subordinate','predicative','collocation','run'],theme:'light',discovery:'sentence'},
  onShow(){
    this._unloaded=false;ui.apply(this);
    try{this.setData({recent:store.history().slice(0,20)});}catch(error){ui.error(error);}
    dictionary.status(false).then(state=>{if(!this._unloaded)this.setData({ready:state.ready,oxford:state.oxford,hasOffline:state.offline,offlineDefinitions:state.offlineDefinitions});});
  },
  onInput(event){const query=event.detail.value;this.setData({query});clearTimeout(this._timer);this._timer=setTimeout(async()=>{try{const rows=await dictionary.suggest(query);if(!this._unloaded&&this.data.query===query)this.setData({suggestions:rows});}catch(_){}},180);},
  onSearch(){const query=this.data.query.trim();if(query){this.setData({query:'',suggestions:[]});ui.open(query);}},
  onWord(event){this.setData({query:'',suggestions:[]});ui.open(ui.dataset(event));},
  onClear(){clearTimeout(this._timer);this.setData({query:'',suggestions:[]});},
  onHistory(){wx.navigateTo({url:'/pages/history/index'});},
  onSettings(){wx.navigateTo({url:'/pages/settings/index'});},
  onDictionaries(){wx.navigateTo({url:'/pages/dictionaries/index'});},
  onCapture(){wx.navigateTo({url:'/pages/capture/index?mode=photo'});},
  onVoice(){wx.navigateTo({url:'/pages/capture/index?mode=voice'});},
  onTranslate(){wx.navigateTo({url:'/pages/translate/index'});},
  onLibrary(){wx.navigateTo({url:'/pages/library/index'});},
  onDaily(event){wx.navigateTo({url:'/pages/daily/index?mode='+ui.dataset(event,'mode')});},
  onKnowledge(){wx.navigateTo({url:'/pages/knowledge/index'});},
  onDiscovery(event){const value=ui.dataset(event,'tab');if(['sentence','listening','knowledge'].includes(value)){this.setData({discovery:value});this.onOpenDiscovery();}},
  onOpenDiscovery(){if(this.data.discovery==='knowledge')this.onKnowledge();else wx.navigateTo({url:'/pages/daily/index?mode='+this.data.discovery});},
  onMenu(){wx.showActionSheet({itemList:['全文翻译','阅读书架','查词记录','词库管理','阅读与服务设置'],success:result=>{const routes=['/pages/translate/index','/pages/library/index','/pages/history/index','/pages/dictionaries/index','/pages/settings/index'];if(routes[result.tapIndex])wx.navigateTo({url:routes[result.tapIndex]});}});},
  onHide(){clearTimeout(this._timer);},onUnload(){this._unloaded=true;clearTimeout(this._timer);},
  onShareAppMessage(){return{title:'涵词典 · 把每个意思查清楚',path:'/pages/search/index'};}
});
