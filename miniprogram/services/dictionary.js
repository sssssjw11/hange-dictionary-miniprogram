const config = require('../config');
const store = require('../utils/store');
const cache = require('../utils/cache');
const offline = require('../data/offline');
const offlinePack = require('./offline-pack');
let health = { ready: false, checked: 0, base: '' };
const pending = new Map();
function base() { const settings = store.settings(); return settings.online ? String(settings.apiBase === null ? config.apiBase : settings.apiBase).replace(/\/+$/, '') : ''; }
function request(path, query, timeout) {
  const origin = base(); if (!origin) return Promise.reject(new Error('全量词库服务尚未连接'));
  return new Promise((resolve, reject) => wx.request({
    url: origin + '/api/' + path, data: query || {}, method: 'GET', timeout: timeout || config.requestTimeout,
    success(response) { if (response.statusCode === 200) resolve(response.data); else reject(new Error(response.data && response.data.error || '词库服务暂不可用')); },
    fail() { reject(new Error('未连接到全量词库。可在阅读设置中配置服务地址，或查询内置词条。')); }
  }));
}
async function status(force) {
  const installed = await offlinePack.status();
  const origin = base();
  const merge = () => Object.assign({}, health, { offline: installed.installed, offlineDefinitions: installed.definitions || 0, offlineError: installed.error || '', oxford: !!health.oxford || installed.installed });
  if (!force && installed.installed && !health.ready) return merge();
  if (!force && health.base === origin && Date.now() - health.checked < 30000) return merge();
  try { health = Object.assign(await request('health', {}, 1200), { connected:true,checked: Date.now(), base: origin }); }
  catch (_) { health = { ready: false, connected:false, checked: Date.now(), base: origin }; }
  return merge();
}
function local(word) {
  const key = store.key(word), entry = offline.entries[key] || offline.entries[offline.aliases[key]];
  if (entry) return Object.assign({}, entry, { requested: word, source: 'builtin' });
  if (/[\u3400-\u9fff]/.test(key)) {
    const matches = Object.values(offline.entries).filter(row => (row.zh || '').includes(key) || (row.teaching && JSON.stringify(row.teaching).includes(key))).map(row => ({ word: row.word, meaning: row.zh || (row.teaching || {}).title || '' }));
    if (matches.length === 1) return Object.assign({}, offline.entries[store.key(matches[0].word)], { requested: word, matchedFrom: word, source: 'builtin' });
    if (matches.length) return { kind: 'matches', requested: word, matches: matches.slice(0, 40), partial: true };
  }
  return null;
}
async function lookup(word) {
  word = String(word || '').trim(); if (!word || word.length > 256) throw new Error('请输入 1～256 字的单词或短语');
  const key = store.key(word), stored = cache.get(key);
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    const installed = await offlinePack.status();
    if (installed.installed) {
      const packed = await offlinePack.lookup(word);
      if (packed) { if (packed.kind !== 'entry') return packed; const supplement = local(packed.word) || local(word) || {}; return Object.assign({}, supplement, packed, { teaching: supplement.teaching || null, senses: supplement.senses || [], related: Array.from(new Set((packed.related || []).concat(supplement.related || []))) }); }
    }
    if (stored && stored.kind === 'entry') return Object.assign({}, stored, { source: 'cache', requested: word });
    const fallback = local(word), state = await status(false);
    if (state.ready) {
      try { const entry = await request('lookup', { q: word }); if (entry.kind === 'entry') cache.put(key, entry); return entry; }
      catch (error) { if (!fallback) throw error; }
    }
    if (fallback) return fallback;
    if (installed.installed) return {kind:'missing',requested:word,source:'offline-pack',offline:true};
    throw new Error('当前未连接全量词库，且此词尚未缓存。请连接词库服务后重试。');
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
async function suggest(word) {
  const key = store.key(word); if (!key || /[\u3400-\u9fff]/.test(key)) return [];
  const installed=await offlinePack.status();if(installed.installed){const full=await offlinePack.suggest(word);if(full.length)return full;}
  const rows = Object.values(offline.entries).filter(x => store.key(x.word).startsWith(key)).sort((a, b) => a.word.length - b.word.length).slice(0, 10).map(x => ({ word: x.word, meaning: x.zh || (x.teaching || {}).title || '' }));
  if (health.ready && health.base === base()) { try { return (await request('suggest', { q: word }, 1800)).rows; } catch (_) {} }
  return rows;
}
module.exports = { lookup, suggest, status, offlineCount: Object.keys(offline.entries).length, reset() { health.checked = 0; } };
