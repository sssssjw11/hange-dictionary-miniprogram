const store = require('./store');
const tabs = require('../data/tabs');
function apply(page) {
  const settings = store.settings(); let system = 'light';
  try { system = wx.getAppBaseInfo ? wx.getAppBaseInfo().theme : wx.getSystemInfoSync().theme; } catch (_) {}
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && system === 'dark');
  const theme=dark?'dark':'light';
  page.setData({ theme, fontSize: settings.fontSize, accent:dark?'#8bc5f5':'#278de0' });
  const home=page.route==='pages/search/index';
  const background = dark ? (home?'#17293b':'#131b26') : home?'#edf6ff':'#ffffff';
  wx.setNavigationBarColor({ frontColor: dark ? '#ffffff' : '#000000', backgroundColor: background });
  wx.setBackgroundColor({ backgroundColor: dark?'#131b26':'#f7f9fc' });
  if(typeof page.getTabBar==='function'){
    const bar=page.getTabBar(),selected=tabs.findIndex(tab=>tab.pagePath===page.route);
    if(bar&&selected>=0)bar.setData({theme,selected});
  }
}
function error(error) { wx.showToast({ title: error.message || '操作未完成，请重试', icon: 'none', duration: 2800 }); }
function open(word) { wx.navigateTo({ url: '/pages/entry/index?q=' + encodeURIComponent(word) }); }
function confirm(title, content) { return new Promise(resolve => wx.showModal({ title, content, success: result => resolve(result.confirm), fail: () => resolve(false) })); }
function dataset(event, field = 'word') { return event.currentTarget.dataset[field]; }
function decode(value) { try { return decodeURIComponent(value || ''); } catch (_) { return value || ''; } }
module.exports = { apply, error, open, confirm, dataset, decode };
