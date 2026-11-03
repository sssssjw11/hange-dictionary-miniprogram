const store = require('./store');
const INDEX = 'hange.cache.index';
function storageKey(word) { return 'hange.cache.' + encodeURIComponent(store.key(word)); }
function get(word) {
  try { return wx.getStorageSync(storageKey(word)) || null; } catch (_) { return null; }
}
function put(word, value) {
  const size = store.bytes(JSON.stringify(value)); if (size > 850000) return false;
  const target = storageKey(word);
  let rows = (wx.getStorageSync(INDEX) || []).filter(x => x.key !== target);
  try {
    while (rows.length && (rows.reduce((n, x) => n + x.size, 0) + size > 4000000 || rows.length >= 30)) wx.removeStorageSync(rows.shift().key);
    wx.setStorageSync(target, value); rows.push({ key: target, size }); wx.setStorageSync(INDEX, rows); return true;
  } catch (_) { try { wx.removeStorageSync(target); } catch (_) {} return false; }
}
function clear() {
  const keys = wx.getStorageInfoSync().keys;
  keys.filter(key => key.startsWith('hange.cache.')).forEach(key => wx.removeStorageSync(key));
}
module.exports = { get, put, clear };
