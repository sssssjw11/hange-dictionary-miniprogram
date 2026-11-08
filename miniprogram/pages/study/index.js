const study = require('../../services/study');
const ui = require('../../utils/ui');
Page({
  data: {theme:'light',decks:[],stats:{today:{},plan:{}},deck:'favorites',deckName:'全部生词',deckCount:0,queued:0,mode:'flash',dailyNew:'20',dailyReview:'100'},
  onShow() { ui.apply(this); this.refresh(); },
  refresh() { try { const stats=study.stats(),decks=study.decks();let selected=decks.find(item=>item.id===this.data.deck);if(!selected||!this._pickedDeck&&!selected.count)selected=decks.find(item=>item.count>0)||decks[0];this.setData({decks,deck:selected.id,deckName:selected.name,deckCount:selected.count,queued:study.queue(selected.id).words.length,stats,dailyNew:String(stats.plan.dailyNew),dailyReview:String(stats.plan.dailyReview)}); } catch(error){ui.error(error);} },
  onDeck(event){try{const selected=this.data.decks.find(item=>item.id===ui.dataset(event,'id'));if(!selected)return;this._pickedDeck=true;this.setData({deck:selected.id,deckName:selected.name,deckCount:selected.count,queued:study.queue(selected.id).words.length});}catch(error){ui.error(error);}},
  onMode(event){this.setData({mode:ui.dataset(event,'mode')});},
  onStart(){try{const queue=study.queue(this.data.deck);if(!queue.words.length)return ui.error(new Error('没有待学词，先收藏单词、导入词表或调整学习计划'));wx.navigateTo({url:'/pages/review/index?deck='+encodeURIComponent(this.data.deck)+'&mode='+this.data.mode});}catch(error){ui.error(error);}},
  onContinue(){const pending=study.pending();if(pending)wx.navigateTo({url:'/pages/review/index?resume=1'});},
  onMastered(){wx.navigateTo({url:'/pages/wordlist/index?id=mastered'});},
  onStatistics(){wx.navigateTo({url:'/pages/statistics/index'});},
  onVocabulary(){wx.navigateTo({url:'/pages/vocabulary/index'});},
  onPlayer(){wx.navigateTo({url:'/pages/player/index?deck='+encodeURIComponent(this.data.deck)});},
  onNew(event){this.setData({dailyNew:event.detail.value});},onReview(event){this.setData({dailyReview:event.detail.value});},
  onSavePlan(){try{study.plan(this.data.dailyNew,this.data.dailyReview);this.refresh();wx.showToast({title:'计划已保存'});}catch(error){ui.error(error);}},
  onCreate(){wx.showModal({title:'新建词表',editable:true,placeholderText:'词表名称',success:result=>{if(result.confirm && result.content)wx.navigateTo({url:'/pages/wordlist/index?name='+encodeURIComponent(result.content)});}});},
  onWordlist(event){wx.navigateTo({url:'/pages/wordlist/index?id='+encodeURIComponent(ui.dataset(event,'id'))});},
  onOxfordWordlists(){wx.navigateTo({url:'/pages/wordlist/index?source=oxford'});}
});
