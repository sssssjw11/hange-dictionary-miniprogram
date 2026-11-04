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

test('reverse page navigation preserves the list on failure, ignores a stale response and opens a word on a separate native page',async()=>{
  const lookup=dictionary.lookup,matchPage=dictionary.matchPage,navigate=wx.navigateTo;
  let release,fail=false,calls=0;
  dictionary.lookup=async word=>word==='apple'?{kind:'entry',word,zh:'苹果',oxford:{blocks:[]}}:{kind:'matches',requested:word,matches:[{word:'first',meaning:'原创测试'}],source:'offline-pack',nextCursor:40};
  dictionary.matchPage=async(word,cursor,source)=>{calls++;assert.equal(word,'测试');assert.equal(source,'offline-pack');if(fail)throw new Error('read failed');if(cursor===80)return new Promise(resolve=>{release=resolve;});return{kind:'matches',matches:[{word:cursor===40?'second':'first',meaning:'原创测试'}],nextCursor:cursor===40?80:40};};
  try{
    const entry=page('entry');await entry.load('测试');await entry.onMatchNext();assert.equal(entry.data.matchPage,1);assert.equal(entry.data.matches[0].word,'second');
    fail=true;await entry.onMatchNext();assert.equal(entry.data.matchPage,1);assert.equal(entry.data.matches[0].word,'second');assert.match(entry.data.matchError,/read failed/);
    fail=false;await entry.onMatchPrev();assert.equal(entry.data.matchPage,0);await entry.onMatchNext();
    let destination;wx.navigateTo=o=>{destination=o.url;};entry.onWord({currentTarget:{dataset:{word:'second'}}});assert.equal(destination,'/pages/entry/index?q=second');assert.equal(entry.data.matchPage,1);
    const pending=entry.onMatchNext();await entry.onMatchNext();assert.equal(calls,5);await entry.load('apple');release({kind:'matches',matches:[{word:'stale'}],nextCursor:null});await pending;
    assert.equal(entry.data.entry.word,'apple');assert.equal(entry.data.matches.length,0);assert.equal(entry.data.matchLoading,false);
  }finally{dictionary.lookup=lookup;dictionary.matchPage=matchPage;wx.navigateTo=navigate;}
});
test('100-item history and clear preserve the learning notebook', () => {
  store.saveNote('run', '跑', 'note'); for (let i = 0; i < 105; i++) store.visit('word' + i, 'meaning');
  assert.equal(store.history().length, 100); assert.equal(store.history()[0].word, 'word104');
  store.clearHistory(); assert.deepEqual(store.history(), []); assert.equal(store.favorite('run').note, 'note');
});

test('every related expression remains reachable without sending the complete link list to the view',async()=>{
  const lookup=dictionary.lookup,links=Array.from({length:75},(_,index)=>'original expression '+index);
  dictionary.lookup=async()=>({kind:'entry',word:'original-entry',oxford:{blocks:[]},related:links});
  try{const entry=page('entry');await entry.load('original-entry');const reached=[];
    for(let index=0;index<entry.data.relatedPages;index++){entry.relatedPage(index);assert.ok(entry.data.related.length<=24);reached.push(...entry.data.related);}
    assert.deepEqual(reached,links);assert.equal(entry.data.relatedTotal,75);
  }finally{dictionary.lookup=lookup;}
});
test('cache quota eviction and clearing never delete learning records', () => {
  store.saveNote('run', '跑', 'note');
  for (let i = 0; i < 9; i++) cache.put('word' + i, { kind: 'entry', word: 'word' + i, body: 'x'.repeat(700000) });
  assert.equal(cache.get('word0'), null); assert.ok(cache.get('word8')); cache.clear();
  assert.equal(store.favorite('run').note, 'note'); assert.equal(memory.has('hange.cache.index'), false);
});

test('supplement cache shares the quota without colliding with full words or deleting learning records',()=>{
  store.saveNote('run','跑','keep');cache.put('supplement:demo',{kind:'entry',word:'full-word'});
  cache.putSupplement('DEMO',{kind:'supplement',word:'demo',found:true,zh:'原创补充'});
  assert.equal(cache.get('supplement:demo').word,'full-word');assert.equal(cache.getSupplement('demo').zh,'原创补充');
  for(let index=0;index<35;index++)cache.putSupplement('word-'+index,{kind:'supplement',word:'word-'+index});
  assert.equal(cache.getSupplement('word-0'),null);assert.ok(cache.getSupplement('word-34'));cache.clear();
  assert.equal(cache.getSupplement('word-34'),null);assert.equal(store.favorite('run').note,'keep');
});

test('cached supplements enrich an installed entry offline without changing Oxford, its headword or its input alias',async()=>{
  const pack=require('../miniprogram/services/offline-pack'),status=pack.status,lookup=pack.lookup;
  const oxford={blocks:[{id:'original',nodes:[{type:'text',text:'Original full body'}]}]};
  try{
    store.saveSettings({online:false});pack.status=async()=>({installed:true});
    pack.lookup=async word=>({kind:'entry',word:word==='running'?'running':'fresh',requested:word,matchedFrom:'original input',source:'offline-pack',oxford,related:['original-link']});
    cache.putSupplement('fresh',{kind:'supplement',word:'fresh',found:true,zh:'原创补充',senses:[{definition:'Original sense'}]});
    const result=await dictionary.lookup('fresh');assert.equal(result.oxford,oxford);assert.equal(result.word,'fresh');assert.equal(result.matchedFrom,'original input');assert.equal(result.source,'offline-pack');assert.equal(result.supplementState,'cache');assert.equal(result.zh,'原创补充');
    const independent=await dictionary.lookup('running');assert.equal(independent.word,'running');assert.deepEqual(independent.senses||[],[],'the builtin run alias must not attach verb senses to the independent running headword');assert.equal(requestCalls,0);
    assert.equal((await dictionary.supplement('fresh',{refresh:true})).source,'cache');
  }finally{pack.status=status;pack.lookup=lookup;}
});

test('supplements are requested separately, retain honest cached fallbacks and reject another headword',async()=>{
  const request=wx.request;const payload={kind:'supplement',word:'demo',found:true,available:true,source:'service',zh:'原创补充',senses:[],forms:[]};let calls=0;
  try{
    store.saveSettings({online:true,apiBase:'http://localhost:18759'});
    wx.request=o=>{calls++;assert.ok(o.url.endsWith('/api/supplement'));o.success({statusCode:200,data:payload});};
    assert.equal((await dictionary.supplement('demo')).zh,'原创补充');assert.equal(calls,1);
    store.saveSettings({online:false});assert.equal((await dictionary.supplement('demo')).source,'cache');assert.equal(calls,1);
    store.saveSettings({online:true});wx.request=o=>o.fail({errMsg:'original unavailable service'});
    const cached=await dictionary.supplement('demo',{refresh:true});assert.equal(cached.source,'cache');assert.ok(cached.refreshError);
    wx.request=o=>o.success({statusCode:200,data:payload});await assert.rejects(dictionary.supplement('other'),/相同词头/);assert.equal(cache.getSupplement('other'),null);
  }finally{wx.request=request;}
});

test('more dictionaries preserves the Oxford page and unsaved note, ignores double clicks and discards stale responses',async()=>{
  const lookup=dictionary.lookup,supplement=dictionary.supplement;let release,calls=0;
  const blocks=Array.from({length:8},(_,index)=>({id:String(index),nodes:[{type:'text',text:'Original '+index}]}));
  dictionary.lookup=async word=>({kind:'entry',word,source:'offline-pack',oxford:{blocks},related:['original-link']});
  dictionary.supplement=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const extra={kind:'supplement',word:'demo',found:true,available:true,source:'service',zh:'原创补充',senses:[{pos:'v',definition:'Original sense',examples:[],synonyms:[],antonyms:[]}],related:['extra-link']};
  try{
    const entry=page('entry');await entry.load('demo');entry.contentPage(1);entry.onNote({detail:{value:'Uncommitted note'}});
    const reading=entry.onMoreDictionaries();await entry.onMoreDictionaries();assert.equal(calls,1);assert.equal(entry.data.page,1);
    release(extra);await reading;assert.equal(entry.data.page,1);assert.equal(entry.data.source,'oxford');assert.deepEqual(entry.data.oxfordBlocks.map(row=>row.id),['4','5','6','7']);assert.equal(entry.data.note,'Uncommitted note');assert.equal(entry.data.noteStatus,'尚未保存');assert.equal(store.favorite('demo'),null);assert.ok(entry.data.entry.hasSenses);
    entry.onSource({currentTarget:{dataset:{source:'wordnet'}}});assert.equal(entry.data.senses[0].definition,'Original sense');
    dictionary.supplement=async()=>{throw new Error('original service failure');};await entry.onMoreDictionaries();assert.match(entry.data.supplementError,/service failure/);assert.equal(entry.data.senses.length,1);
    dictionary.supplement=()=>new Promise(resolve=>{release=resolve;});const stale=entry.onMoreDictionaries();await entry.load('fresh');release(extra);await stale;
    assert.equal(entry.data.entry.word,'fresh');assert.equal(entry.data.entry.hasSenses,false);assert.equal(entry.data.supplementLoading,false);
  }finally{dictionary.lookup=lookup;dictionary.supplement=supplement;}
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

test('an installed pack miss probes a configured service after cold start and caches its supplemental entry',async()=>{
  const pack=require('../miniprogram/services/offline-pack'),status=pack.status,lookup=pack.lookup,request=wx.request;
  try{
    store.saveSettings({online:false});await dictionary.status(true);
    pack.status=async()=>({installed:true,definitions:69980});pack.lookup=async()=>null;
    store.saveSettings({online:true,apiBase:'http://localhost:18759'});
    const paths=[];wx.request=o=>{paths.push(new URL(o.url).pathname);o.success({statusCode:200,data:o.url.endsWith('/health')?{ready:true}:{kind:'entry',word:'supplement-only',zh:'原创补充词条',oxford:{blocks:[]}}});};
    const result=await dictionary.lookup('supplement-only');assert.equal(result.word,'supplement-only');assert.deepEqual(paths,['/api/health','/api/lookup']);
    store.saveSettings({online:false});assert.equal((await dictionary.lookup('supplement-only')).source,'cache');assert.equal(paths.length,2);
  }finally{pack.status=status;pack.lookup=lookup;wx.request=request;}
});

test('real local supplemental dictionaries return WordNet and base meanings without retransmitting the Oxford body',async t=>{
  const api=process.env.HANGE_TEST_API;if(!api){t.skip('set HANGE_TEST_API for installed supplemental dictionaries');return;}
  store.saveSettings({online:true,apiBase:api});const extra=await dictionary.supplement('meticulous');
  assert.equal(extra.kind,'supplement');assert.equal(extra.word,'meticulous');assert.equal(extra.found,true);assert.equal(extra.available,true);assert.ok(extra.zh);assert.ok(extra.senses.length>0);assert.equal('oxford' in extra,false);
  const calls=requestCalls;store.saveSettings({online:false});const cached=await dictionary.supplement('meticulous');assert.equal(cached.source,'cache');assert.deepEqual(cached.senses,extra.senses);assert.equal(requestCalls,calls);
});
