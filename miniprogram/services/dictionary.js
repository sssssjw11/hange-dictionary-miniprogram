const config = require('../config');
const chineseSearch = require('../utils/chinese');
const store = require('../utils/store');
const cache = require('../utils/cache');
const offline = require('../data/offline');
const offlinePack = require('./offline-pack');
const spelling = require('../utils/spelling');
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
async function status(force, probeMissing = false) {
  const installed = await offlinePack.status();
  const origin = base();
  const merge = () => Object.assign({}, health, { offline: installed.installed, offlineDefinitions: installed.definitions || 0, offlineError: installed.error || '', oxford: !!health.oxford || installed.installed });
  if (!force && installed.installed && !health.ready && !probeMissing) return merge();
  if (!force && health.base === origin && Date.now() - health.checked < 30000) return merge();
  try { health = Object.assign(await request('health', {}, 1200), { connected:true,checked: Date.now(), base: origin }); }
  catch (_) { health = { ready: false, connected:false, checked: Date.now(), base: origin }; }
  return merge();
}
function local(word, cursor = 0) {
  const key = store.key(word), entry = offline.entries[key] || offline.entries[offline.aliases[key]];
  if (entry) return Object.assign({}, entry, { requested: word, source: 'builtin' });
  if (chineseSearch.hasHan(key)) {
    const matches = Object.values(offline.entries).filter(row => (row.zh || '').includes(key) || (row.teaching && JSON.stringify(row.teaching).includes(key))).map(row => ({ word: row.word, meaning: row.zh || (row.teaching || {}).title || '' }));
    if (matches.length === 1) return Object.assign({}, offline.entries[store.key(matches[0].word)], { requested: word, matchedFrom: word, source: 'builtin' });
    if (matches.length) return { kind: 'matches', requested: word, matches: matches.slice(cursor,cursor+40), partial: true, source:'builtin', cursor, nextCursor:cursor+40<matches.length?cursor+40:null };
  }
  return null;
}
function builtinSuggestions(word){
  const key=store.key(word);if(!spelling.eligible(key))return {rows:[],kind:''};
  const items=Object.values(offline.entries).map(row=>({key:store.key(row.word),word:row.word,meaning:row.zh||(row.teaching||{}).title||''}));
  const prefix=items.filter(row=>row.key.startsWith(key)).sort((a,b)=>a.word.length-b.word.length).slice(0,8);
  const rows=prefix.length?prefix:spelling.rank(key,items);
  return {rows:rows.map(row=>({word:row.word,meaning:row.meaning})),kind:prefix.length?'prefix':'spelling'};
}
async function missingResult(word,installed,serviceResult){
  if(serviceResult&&(serviceResult.suggestions||[]).length)return serviceResult;
  if(installed.installed){
    const prefix=await offlinePack.suggest(word),rows=prefix.length?prefix:await offlinePack.correct(word);
    return {kind:'missing',requested:word,source:'offline-pack',offline:true,suggestions:rows,suggestionKind:prefix.length?'prefix':'spelling'};
  }
  const builtin=builtinSuggestions(word);
  if(builtin.rows.length)return {kind:'missing',requested:word,source:'builtin',partial:true,suggestions:builtin.rows,suggestionKind:builtin.kind};
  if(serviceResult)return serviceResult;
  throw new Error('当前未连接全量词库，且此词尚未缓存。请连接词库服务后重试。');
}
async function lookup(word,options={}) {
  word = String(word || '').trim(); if (!word || word.length > 256 || word.includes('\0')) throw new Error('请输入 1～256 字的单词或短语');
  const key = store.key(word), stored = cache.get(key),pendingKey=key+(options.refresh?'\0refresh':'');
  if (pending.has(pendingKey)) return pending.get(pendingKey);
  const task = (async () => {
    const installed = await offlinePack.status();
    if (installed.installed) {
      const packed = await offlinePack.lookup(word);
      if (packed) {
        if(packed.kind!=='entry')return packed;
        const builtin=local(packed.word)||local(word)||{};
        let result=mergeSupplement(packed,builtin);
        const cached=cache.getSupplement(packed.word);
        if(cached&&store.key(cached.word)===store.key(packed.word))result=mergeSupplement(result,Object.assign({},cached,{source:'cache'}));
        return result;
      }
    }
    if (!options.refresh&&stored && stored.kind === 'entry') return Object.assign({}, stored, { source: 'cache', requested: word });
    let fallback=stored&&stored.kind==='entry'?Object.assign({},stored,{source:'cache',requested:word}):local(word);
    const extra=cache.getSupplement(word);
    if(extra&&extra.kind==='supplement'&&store.key(extra.word)===key)fallback=mergeSupplement(fallback||{kind:'entry',word:extra.word,requested:word,source:'cache',oxford:{blocks:[]}},Object.assign({},extra,{source:'cache'}));
    const state = await status(!!options.refresh,true);
    if (state.ready) {
      let entry;
      try { entry = await request('lookup', { q: word }); }
      catch (error) { if (!fallback&&!installed.installed&&!builtinSuggestions(word).rows.length) throw error; }
      if(entry){if(entry.kind==='entry')cache.put(key,entry);if(entry.kind==='missing')return fallback&&fallback.kind==='entry'?fallback:await missingResult(word,installed,entry);return entry;}
    }
    if (fallback) return fallback;
    return missingResult(word,installed);
  })();
  pending.set(pendingKey, task);
  try { return await task; } finally { pending.delete(pendingKey); }
}
async function suggest(word) {
  const key = store.key(word); if (!key || chineseSearch.hasHan(key)) return [];
  const installed=await offlinePack.status();if(installed.installed){const full=await offlinePack.suggest(word);if(full.length)return full;}
  const rows = Object.values(offline.entries).filter(x => store.key(x.word).startsWith(key)).sort((a, b) => a.word.length - b.word.length).slice(0, 10).map(x => ({ word: x.word, meaning: x.zh || (x.teaching || {}).title || '' }));
  if (health.ready && health.base === base()) { try { return (await request('suggest', { q: word }, 1800)).rows; } catch (_) {} }
  return rows;
}
async function matchPage(word,cursor,source){
  word=String(word||'').trim();
  if(!word||word.length>256||!chineseSearch.hasHan(word)||!Number.isInteger(cursor)||cursor<0)throw new Error('查询页码无效，请重新查询');
  if(source==='offline-pack'){
    const result=await offlinePack.lookup(word,{cursor});
    if(!result)throw new Error('离线词库已移除，请重新查询');
    return result;
  }
  if(source==='builtin')return local(word,cursor)||{kind:'matches',matches:[],cursor,nextCursor:null,source:'builtin',partial:true};
  if(source==='service')return request('reverse',{q:word,cursor});
  throw new Error('当前服务不支持继续翻页，请重新查询或更新服务');
}
function mergeSupplement(entry,extra){
  const result=Object.assign({},entry);
  if(extra.word&&store.key(extra.word)!==store.key(entry.word))return result;
  for(const key of ['zh','en','phonetic','teaching'])if(extra[key])result[key]=extra[key];
  for(const key of ['senses','forms','tags'])if(Array.isArray(extra[key])&&extra[key].length)result[key]=extra[key];
  result.related=Array.from(new Set((entry.related||[]).concat(extra.related||[])));
  if(extra.kind==='supplement'&&extra.found)result.supplementState=extra.source==='cache'?'cache':'service';
  return result;
}
async function supplement(word,options={}){
  word=String(word||'').trim();if(!word||word.length>256)throw new Error('请输入 1～256 字的单词或短语');
  const stored=cache.getSupplement(word),cached=stored&&stored.kind==='supplement'&&store.key(stored.word)===store.key(word)?stored:null;
  if(cached&&(!options.refresh||!base()))return Object.assign({},cached,{source:'cache'});
  if(!base())throw new Error('请先连接本地词库服务，再读取补充释义；牛津仍可离线查阅。');
  try{
    const result=await request('supplement',{q:word});
    if(!result||result.kind!=='supplement'||typeof result.word!=='string'||typeof result.found!=='boolean'||typeof result.available!=='boolean'||store.key(result.word)!==store.key(word))throw new Error('补充词典未匹配到相同词头，请更新服务后重试。');
    if(result.found)cache.putSupplement(word,result);
    return result;
  }catch(error){
    if(cached)return Object.assign({},cached,{source:'cache',refreshError:error.message});
    throw error;
  }
}
module.exports = { lookup, matchPage, supplement, mergeSupplement, suggest, status, offlineCount: Object.keys(offline.entries).length, reset() { health.checked = 0; } };
