const KEY = 'hange.learning.v1';
const SETTINGS = 'hange.settings.v1';
function key(word) { return String(word || '').replace(/’/g, "'").replace(/_/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase(); }
function bytes(text) { let n = 0; for (const char of text) { const c = char.codePointAt(0); n += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4; } return n; }
function read() {
  const value = wx.getStorageSync(KEY);
  if (!value) return { favorites: [], history: [] };
  if (!Array.isArray(value.favorites) || !Array.isArray(value.history)) throw new Error('本地学习记录格式异常，请先导出或检查备份');
  return JSON.parse(JSON.stringify(value));
}
function write(value) {
  if (bytes(JSON.stringify(value)) > 850000) throw new Error('生词本接近单条缓存容量，请导出备份后整理笔记');
  wx.setStorageSync(KEY, value);
}
function favorites() { return read().favorites.slice().sort((a, b) => b.updated - a.updated); }
function favorite(word) { return read().favorites.find(x => key(x.word) === key(word)) || null; }
function toggle(word, meaning) {
  const data = read(), normalized = key(word), index = data.favorites.findIndex(x => key(x.word) === normalized);
  if (index >= 0) data.favorites.splice(index, 1);
  else data.favorites.push({ word: normalized, meaning: String(meaning || '').slice(0, 4000), note: '', created: Date.now(), updated: Date.now() });
  write(data); return index < 0;
}
function saveNote(word, meaning, note) {
  if (note.length > 4000) throw new Error('笔记最多 4000 字');
  const data = read(), normalized = key(word);
  let item = data.favorites.find(x => key(x.word) === normalized);
  if (!item) { item = { word: normalized, meaning: String(meaning || '').slice(0, 4000), note: '', created: Date.now() }; data.favorites.push(item); }
  item.note = note; item.updated = Date.now(); write(data);
}
function visit(word, meaning) {
  const data = read(), normalized = key(word), existing = data.history.find(x => key(x.word) === normalized);
  data.history = data.history.filter(x => key(x.word) !== normalized);
  data.history.unshift({ word: normalized, meaning: String(meaning || '').split('\n')[0].slice(0, 500), visited: Date.now(), hits: existing ? existing.hits + 1 : 1 });
  data.history = data.history.slice(0, 100); write(data);
}
function history() { return read().history; }
function clearHistory() { const data = read(); data.history = []; write(data); }
function exportJson() { return JSON.stringify({ format: 'hange-local-notebook', version: 1, items: favorites() }, null, 2); }
function parseImport(text) {
  if (bytes(text) > 1048576) throw new Error('备份最大为 1 MiB');
  let root; try { root = JSON.parse(text); } catch (_) { throw new Error('无法解析备份 JSON'); }
  if (root.format !== 'hange-local-notebook' || root.version !== 1 || !Array.isArray(root.items)) throw new Error('不是本词典支持的生词本备份');
  if (root.items.length > 2000) throw new Error('一次最多导入 2000 个词条');
  return root.items.map(item => {
    if (!item || typeof item.word !== 'string' || !item.word.trim() || item.word.length > 256 || (item.note != null && typeof item.note !== 'string') || (item.meaning != null && typeof item.meaning !== 'string')) throw new Error('备份中含有格式异常的词条');
    const note = item.note || '', meaning = item.meaning || '';
    if (note.length > 4000 || meaning.length > 4000) throw new Error('备份中的笔记或释义过长');
    return { word: key(item.word), meaning, note, created: Number(item.created) || Date.now(), updated: Date.now() };
  });
}
function importJson(text) {
  const items = parseImport(text), data = read(), seen = new Set(data.favorites.map(x => key(x.word))); let count = 0;
  items.forEach(item => { if (!seen.has(item.word)) { seen.add(item.word); data.favorites.push(item); count++; } });
  write(data); return count;
}
function settings() { return Object.assign({ theme: 'system', fontSize: 16, apiBase: null, online: true }, wx.getStorageSync(SETTINGS) || {}); }
function saveSettings(value) { wx.setStorageSync(SETTINGS, Object.assign(settings(), value)); }
module.exports = { key, bytes, favorites, favorite, toggle, saveNote, visit, history, clearHistory, exportJson, parseImport, importJson, settings, saveSettings };
