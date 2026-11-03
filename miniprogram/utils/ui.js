const store = require('./store');
function apply(page) {
  const settings = store.settings(); let system = 'light';
  try { system = wx.getAppBaseInfo ? wx.getAppBaseInfo().theme : wx.getSystemInfoSync().theme; } catch (_) {}
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && system === 'dark');
  page.setData({ theme: dark ? 'dark' : 'light', fontSize: settings.fontSize });
  const background = dark ? '#14212b' : '#f4f8fb';
  wx.setNavigationBarColor({ frontColor: dark ? '#ffffff' : '#000000', backgroundColor: background });
  wx.setBackgroundColor({ backgroundColor: background });
  wx.setTabBarStyle({ color: dark ? '#9aafbd' : '#8193a1', selectedColor: dark ? '#8bc3ee' : '#267fbb', backgroundColor: dark ? '#1c2d39' : '#ffffff', borderStyle: dark ? 'black' : 'white', fail() {} });
}
function error(error) { wx.showToast({ title: error.message || '操作未完成，请重试', icon: 'none', duration: 2800 }); }
function open(word) { wx.navigateTo({ url: '/pages/entry/index?q=' + encodeURIComponent(word) }); }
function confirm(title, content) { return new Promise(resolve => wx.showModal({ title, content, success: result => resolve(result.confirm), fail: () => resolve(false) })); }
function dataset(event, field = 'word') { return event.currentTarget.dataset[field]; }
function decode(value) { try { return decodeURIComponent(value || ''); } catch (_) { return value || ''; } }
module.exports = { apply, error, open, confirm, dataset, decode };
