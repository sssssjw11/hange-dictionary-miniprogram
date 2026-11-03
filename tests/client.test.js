const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const memory = new Map();
let packets = [], requestCalls = 0;
const copy = value => JSON.parse(JSON.stringify(value));
global.wx = {
  getStorageSync(key) { return memory.has(key) ? copy(memory.get(key)) : ''; },
  setStorageSync(key, value) { const text = JSON.stringify(value); if (Buffer.byteLength(text) > 1048576) throw new Error('single-key quota'); memory.set(key, copy(value)); },
  removeStorageSync(key) { memory.delete(key); }, getStorageInfoSync() { return { keys: [...memory.keys()] }; },
  getAppBaseInfo() { return { theme: 'light' }; }, setNavigationBarColor() {}, setBackgroundColor() {}, setTabBarStyle() {}, setNavigationBarTitle() {},
  showToast() {}, showModal(options) { options.success({ confirm: true }); }, navigateTo() {}, pageScrollTo() {},
  request(options) { requestCalls++; const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeout || 5000);
    const url = new URL(options.url); Object.entries(options.data || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    fetch(url, { signal: controller.signal }).then(async response => options.success({ statusCode: response.status, data: await response.json() })).catch(error => options.fail(error)).finally(() => clearTimeout(timer));
  }
};
const store = require('../miniprogram/utils/store');
const cache = require('../miniprogram/utils/cache');
const dictionary = require('../miniprogram/services/dictionary');
function page(name) {
  const file = path.join(root, 'miniprogram/pages', name, 'index.js'); let definition;
  global.Page = value => { definition = value; }; delete require.cache[file]; require(file);
  const instance = { data: copy(definition.data), setData(value) { const bytes = Buffer.byteLength(JSON.stringify(value)); packets.push(bytes); assert.ok(bytes < 900000, 'setData payload must stay below the platform limit'); Object.assign(this.data, copy(value)); } };
  Object.entries(definition).forEach(([key, value]) => { if (typeof value === 'function') instance[key] = value.bind(instance); });
  return instance;
}
test.beforeEach(() => { memory.clear(); packets = []; requestCalls = 0; dictionary.reset(); });

test('offline native page: Chinese lookup, save a note, and reload it', async () => {
  store.saveSettings({ online: false });
  const entry = page('entry'); await entry.load('人际交往能力');
  assert.equal(entry.data.entry.word, 'interpersonal skills');
  entry.onNote({ detail: { value: '倾听、沟通与合作' } }); entry.onSaveNote();
  assert.equal(store.favorite('interpersonal skills').note, '倾听、沟通与合作');
  const second = page('entry'); await second.load('interpersonal skills');
  assert.equal(second.data.note, '倾听、沟通与合作'); assert.equal(second.data.favorite, true);
  assert.equal(requestCalls, 0);
});
test('Android-compatible backups merge without overwriting notes; invalid input is atomic', () => {
  store.saveNote('run', '跑', '保留我的笔记');
  const backup = JSON.stringify({ format: 'hange-local-notebook', version: 1, items: [{ word: 'RUN', meaning: 'run', note: 'old' }, { word: 'apple', meaning: '苹果', note: 'new' }] });
  assert.equal(store.importJson(backup), 1); assert.equal(store.favorite('run').note, '保留我的笔记');
  assert.equal(store.importJson(backup), 0);
  const before = store.exportJson();
  assert.throws(() => store.importJson(JSON.stringify({ format: 'hange-local-notebook', version: 1, items: [{ word: 'bad', note: 'x'.repeat(4001) }] })));
  assert.equal(store.exportJson(), before);
  assert.throws(() => store.importJson('{broken'));
});
test('100-item history and clear preserve the learning notebook', () => {
  store.saveNote('run', '跑', 'note'); for (let i = 0; i < 105; i++) store.visit('word' + i, 'meaning');
  assert.equal(store.history().length, 100); assert.equal(store.history()[0].word, 'word104');
  store.clearHistory(); assert.deepEqual(store.history(), []); assert.equal(store.favorite('run').note, 'note');
});
test('cache quota eviction and clearing never delete learning records', () => {
  store.saveNote('run', '跑', 'note');
  for (let i = 0; i < 9; i++) cache.put('word' + i, { kind: 'entry', word: 'word' + i, body: 'x'.repeat(700000) });
  assert.equal(cache.get('word0'), null); assert.ok(cache.get('word8')); cache.clear();
  assert.equal(store.favorite('run').note, 'note'); assert.equal(memory.has('hange.cache.index'), false);
});
test('storage failure reports unsaved notes instead of pretending success', () => {
  const original = wx.setStorageSync; wx.setStorageSync = () => { throw new Error('storage full'); };
  try { assert.throws(() => store.saveNote('run', '跑', 'note'), /storage full/); } finally { wx.setStorageSync = original; }
  assert.equal(store.favorite('run'), null);
});
test('real dictionary service: all Oxford blocks remain reachable through native pagination', async t => {
  const api = process.env.HANGE_TEST_API;
  if (!api) { t.skip('set HANGE_TEST_API to include local full-dictionary integration'); return; }
  store.saveSettings({ online: true, apiBase: api });
  const entry = page('entry'); await entry.load('run');
  assert.equal(entry.data.entry.hasOxford, true); const expected = entry._entry.oxford.blocks;
  const ids = [];
  for (let i = 0; i < entry.data.totalPages; i++) { entry.contentPage(i); ids.push(...entry.data.oxfordBlocks.map(x => x.id)); }
  assert.deepEqual(ids, expected.map(x => x.id)); assert.equal(new Set(ids).size, ids.length);
  const calls = requestCalls; store.saveSettings({ online: false }); const cached = await dictionary.lookup('run');
  assert.equal(cached.source, 'cache'); assert.equal(requestCalls, calls); assert.equal(cached.oxford.blocks.length, expected.length);
  fs.mkdirSync(path.join(root, 'output'), { recursive: true }); fs.writeFileSync(path.join(root, 'output/client-verification.json'), JSON.stringify({ native_page_controller: true, simulated_wx_runtime: true, wechat_simulator_tested: false, run_blocks: expected.length, pages: Math.ceil(expected.length / 4), all_blocks_reachable: true, max_setData_bytes: Math.max(...packets), offline_cache: true }, null, 2));
});
