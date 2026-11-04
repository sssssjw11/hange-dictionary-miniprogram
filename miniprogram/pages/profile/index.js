const store=require('../../utils/store');const study=require('../../services/study');const pack=require('../../services/offline-pack');const api=require('../../services/api');const ui=require('../../utils/ui');
Page({
 data:{theme:'light',favorites:0,notes:0,learned:0,offline:false,definitions:0,service:'按需连接朗读、识图与语音服务',menus:[
  {icon:'bookmark',title:'生词本管理',caption:'分类整理，按分组学习',path:'/pages/groups/index'},
  {icon:'study',title:'阅读批注与书签',caption:'回到原文，重温自己的笔记',path:'/pages/annotations/index'},
  {icon:'study',title:'阅读书架',caption:'TXT、EPUB、PDF，边读边查',path:'/pages/library/index'},
  {icon:'ai',title:'例句卡片',caption:'留住好句子和自己的理解',path:'/pages/sentences/index'},
  {icon:'camera',title:'拍照与语音识词',caption:'识别文字，再查词或翻译',path:'/pages/capture/index'},
  {icon:'translate',title:'全文翻译',caption:'中英互译，需要配置模型服务',path:'/pages/translate/index'},
  {icon:'history',title:'查词记录',caption:'找回最近查过的词',path:'/pages/history/index'},
  {icon:'backup',title:'完整备份与恢复',caption:'保存生词、笔记与学习进度',path:'/pages/backup/index'},
  {icon:'settings',title:'阅读与服务设置',caption:'主题、字号和服务连接',path:'/pages/settings/index'}
 ]},
 onShow(){this._unloaded=false;ui.apply(this);try{const favorites=store.favorites();this.setData({favorites:favorites.length,notes:favorites.filter(item=>item.note).length,learned:study.stats().learned});}catch(error){ui.error(error);}pack.status().then(state=>{if(!this._unloaded)this.setData({offline:state.installed,definitions:state.definitions||0});});},
 onMenu(event){wx.navigateTo({url:ui.dataset(event,'path')});},
 async onCheck(){this.setData({service:'正在检查服务…'});try{const caps=await api.request('capabilities');if(!this._unloaded)this.setData({service:['朗读 '+(caps.tts.available?'可用':'未配置'),'识图 '+(caps.ocr.available?'可用':'未配置'),'语音 '+(caps.asr.available?'可用':'未配置'),'AI '+(caps.ai.available?'可用':'待配置')].join(' · ')});}catch(error){if(!this._unloaded)this.setData({service:error.message});}},
 onUnload(){this._unloaded=true;}
});
