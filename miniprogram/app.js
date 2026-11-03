const ui = require('./utils/ui');
App({
  globalData: {},
  onLaunch() {
    if (wx.onThemeChange) wx.onThemeChange(() => {
      const pages = getCurrentPages();
      if (pages.length) ui.apply(pages[pages.length - 1]);
    });
  }
});
