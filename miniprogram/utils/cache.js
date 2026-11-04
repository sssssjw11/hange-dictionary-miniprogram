const store = require('./store');
const INDEX = 'hange.cache.index';
function storageKey(word) { return 'hange.cache.' + encodeURIComponent(store.key(word)); }
function get(word) {
  return readKey(storageKey(word));
}
function readKey(key){try{return wx.getStorageSync(key)||null;}catch(_){return null;}}
function putKey(target,value){
  const size = store.bytes(JSON.stringify(value)); if (size > 850000) return false;
  let rows = (wx.getStorageSync(INDEX) || []).filter(x => x.key !== target);
  try {
    while (rows.length && (rows.reduce((n, x) => n + x.size, 0) + size > 4000000 || rows.length >= 30)) wx.removeStorageSync(rows.shift().key);
    wx.setStorageSync(target, value); rows.push({ key: target, size }); wx.setStorageSync(INDEX, rows); return true;
  } catch (_) { try { wx.removeStorageSync(target); } catch (_) {} return false; }
}
function put(word,value){return putKey(storageKey(word),value);}
// A literal colon cannot occur in encodeURIComponent(word), so this namespace
// cannot collide with any existing full-entry key. Both share one quota.
function supplementKey(word){return 'hange.cache.supplement:'+encodeURIComponent(store.key(word));}
function clear() {
  const keys = wx.getStorageInfoSync().keys;
  keys.filter(key => key.startsWith('hange.cache.')).forEach(key => wx.removeStorageSync(key));
}
module.exports = { get, put, clear, getSupplement(word){return readKey(supplementKey(word));},putSupplement(word,value){return putKey(supplementKey(word),value);} };
