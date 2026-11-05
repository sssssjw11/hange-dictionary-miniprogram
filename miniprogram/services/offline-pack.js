const codec = require('../vendor/codec');
const store = require('../utils/store');
const chineseSearch = require('../utils/chinese');
const spelling = require('../utils/spelling');
const POINTER = 'hange.oxford.pack.v1';
const SAFE_NAME = /^(manifest\.json|NOTICE\.txt|lengths\.bin|keys\/[0-9a-f]{2}\.json|prefix\/[0-9a-f]{2}\.json|docs\/[0-9]{3}\.json|zh\/[0-9a-f]{2}\.z|parts\/[0-9]{3}\.bin)$/;
let active = null, restoring = null, installing = false;
let fileOperations=0;const fileWaiters=[];
let progressState={working:false,progress:0,message:'',error:''};
function missing(error){return /no such|not exist|不存在|ENOENT|1300002/i.test(error.message);}
function manager() { return wx.getFileSystemManager(); }
async function call(name, options) {
  if(fileOperations<8)fileOperations++;else await new Promise(resolve=>fileWaiters.push(resolve));
  try{return await new Promise((resolve,reject)=>manager()[name](Object.assign({},options,{success:resolve,fail:error=>reject(new Error(error.errMsg||'词库文件操作失败'))})));}
  finally{const next=fileWaiters.shift();if(next)next();else fileOperations--;}
}
function pathRoot() { return wx.env.USER_DATA_PATH + '/hange-oxford'; }
async function read(path, encoding) { const result = await call('readFile', { filePath: path, encoding }); return encoding ? result.data : new Uint8Array(result.data); }
async function stat(path) { return (await call('stat', { path })).stats.size; }
async function chunk(path, position, length) {
  const { fd } = await call('open', { filePath: path, flag: 'r' });
  try { const arrayBuffer = new ArrayBuffer(length); const result = await call('read', { fd, arrayBuffer, offset: 0, length, position }); if (result.bytesRead !== length) throw new Error('词库文件不完整'); return new Uint8Array(result.arrayBuffer); }
  finally { await call('close', { fd }); }
}
function validateManifest(manifest) {
  if (!manifest || manifest.format !== 'hange-oxford-pack' || manifest.version !== 1 || manifest.buckets !== 256 || manifest.documentShardSize !== 512 || !manifest.files || manifest.extractedBytes > 180*1024*1024 || !Number.isInteger(manifest.uniqueDocuments) || manifest.uniqueDocuments < 1) throw new Error('不是受支持的牛津离线词库包');
  const names = Object.keys(manifest.files);
  if (names.length > 1800 || names.some(name => !SAFE_NAME.test(name) || !/^[0-9a-f]{64}$/.test(manifest.files[name].sha256) || !(manifest.files[name].bytes >= 0 && manifest.files[name].bytes < 64*1024*1024))) throw new Error('词库文件清单异常');
  const total = names.reduce((sum, name) => sum + manifest.files[name].bytes, 0);
  if (total !== manifest.extractedBytes || !names.includes('lengths.bin') || !names.includes('parts/000.bin')) throw new Error('词库文件清单不完整');
  return manifest;
}
async function restore() {
  if (active) return active;
  if (restoring) return restoring;
  restoring = (async () => { const pointer = wx.getStorageSync(POINTER); if (!pointer) return null;
    if (pointer.root !== pathRoot()) throw new Error('离线词库路径异常，请重新导入');
    const manifest = validateManifest(JSON.parse(await read(pointer.root + '/manifest.json', 'utf8')));
    active = { root: pointer.root, manifest, json: new Map() }; return active;
  })();
  try { return await restoring; } finally { restoring = null; }
}
async function status() { try { const pack = await restore(); return pack ? { installed: true, title: pack.manifest.title, definitions: pack.manifest.definitionRecords, redirects: pack.manifest.redirectRecords, bytes: pack.manifest.extractedBytes, sourceSha256: pack.manifest.sourceSha256, singleCharacter:pack.manifest.chineseSingleCharacter===true } : { installed: false }; } catch (error) { return { installed: false, error: error.message }; } }
async function jsonFile(pack, name, compressed) {
  if (pack.json.has(name)) return pack.json.get(name);
  if(!pack.loading)pack.loading=new Map();
  if(pack.loading.has(name))return pack.loading.get(name);
  const task=(async()=>{
    let value=await read(pack.root+'/'+name,compressed?undefined:'utf8');
    if(compressed)value=codec.strFromU8(codec.unzlibSync(value));
    const result=JSON.parse(value);if(pack.json.size>=20)pack.json.delete(pack.json.keys().next().value);pack.json.set(name,result);return result;
  })();
  pack.loading.set(name,task);
  try{return await task;}finally{pack.loading.delete(name);}
}
async function references(pack, key) { const file = 'keys/' + codec.hashBucket(key).toString(16).padStart(2, '0') + '.json'; return (await jsonFile(pack, file))[key] || []; }
async function metadata(pack, id) { const values = await jsonFile(pack, 'docs/' + Math.floor(id / 512).toString().padStart(3, '0') + '.json'); const row = values[String(id)]; if (!row) throw new Error('词条索引损坏，请重新导入词库'); return row; }
async function wordLengths(pack){
  if(pack.lengths)return pack.lengths;
  if(!pack.loadingLengths)pack.loadingLengths=read(pack.root+'/lengths.bin').then(value=>(pack.lengths=value,value)).finally(()=>{pack.loadingLengths=null;});
  return pack.loadingLengths;
}
async function document(pack, id) { const row = await metadata(pack, id); const file = 'parts/' + row[0].toString().padStart(3, '0') + '.bin'; const body = await chunk(pack.root + '/' + file, row[1], row[2]); return { word: row[3], html: codec.strFromU8(codec.unzlibSync(body)) }; }
async function lookup(word, options = {}) {
  const pack = await restore(); if (!pack) return null;
  const key = store.key(word); if (chineseSearch.hasHan(key)) {const result=await chinese(pack,key,options.cursor===undefined?0:options.cursor);return result.matches.length||result.hint||options.cursor!==undefined?result:null;}
  let ids = await references(pack, key);
  if (!ids.length && pack.manifest.compactIndex) ids = await references(pack, '\x01' + key.replace(/[^\p{L}\p{N}]/gu, ''));
  if (!ids.length) return null;
  const pages = []; for (const id of ids) pages.push(await document(pack, id));
  const rendered = codec.renderOxford(pages);
  rendered.sourceSha256=pack.manifest.sourceSha256;
  return { kind: 'entry', requested: word, word: pages[0].word, matchedFrom:store.key(pages[0].word)!==key?word:'', source: 'offline-pack', oxford: rendered, related: rendered.related, phonetics: rendered.phonetics, brief:rendered.brief };
}
async function chineseGroups(pack, term) {
  const grams = chineseSearch.queryTerms(term,pack.manifest.chineseSingleCharacter===true);
  if (!grams.length) return null;
  let candidates = null;
  for (const gram of grams) { const file = 'zh/' + codec.hashBucket(gram).toString(16).padStart(2, '0') + '.z'; const values = await jsonFile(pack, file, true); const ids = codec.decodeDeltas(values[gram] || ''); if (candidates === null) candidates = ids; else { const set = new Set(ids); candidates = candidates.filter(id => set.has(id)); } if (!candidates.length) return {groups:[],pages:new Map()}; }
  const lengths = await wordLengths(pack);
  // Group ids by file; bounded batches avoid one native round trip per word.
  const groups=new Map(),ranked=[];
  for(const id of candidates){const shard=Math.floor(id/512);if(!groups.has(shard))groups.set(shard,[]);groups.get(shard).push(id);}
  const shards=Array.from(groups);
  for(let offset=0;offset<shards.length;offset+=8){
    const batches=await Promise.all(shards.slice(offset,offset+8).map(async([shard,ids])=>{
      const values=await jsonFile(pack,'docs/'+shard.toString().padStart(3,'0')+'.json');
      return ids.map(id=>{const row=values[String(id)];if(!row)throw new Error('词条索引损坏，请重新导入词库');return{id,word:row[3],rank:chineseSearch.meaningRank(row[4]||'',term)};});
    }));
    for(const batch of batches)ranked.push(...batch);
  }
  ranked.sort((a,b)=>a.rank-b.rank||lengths[a.id]-lengths[b.id]||a.id-b.id);
  // Retain ids only, not the full metadata/HTML for every matching document.
  const words=new Map();
  for(const {id,word} of ranked){const key=store.key(word);if(!words.has(key))words.set(key,[]);words.get(key).push(id);}
  return {groups:Array.from(words.values()),pages:new Map()};
}
async function chinese(pack, term, cursor) {
  if(!Number.isInteger(cursor)||cursor<0||cursor>pack.manifest.uniqueDocuments)throw new Error('查询页码无效，请重新查询');
  if(!pack.searches)pack.searches=new Map();
  let task=pack.searches.get(term);
  if(task){pack.searches.delete(term);pack.searches.set(term,task);}
  else{
    if(pack.searches.size>=2)pack.searches.delete(pack.searches.keys().next().value);
    task=chineseGroups(pack,term);pack.searches.set(term,task);
  }
  let state;
  try{state=await task;}catch(error){if(pack.searches.get(term)===task)pack.searches.delete(term);throw error;}
  if(!state)return {kind:'matches',requested:term,matches:[],source:'offline-pack',cursor,nextCursor:null,hint:'当前离线索引不支持单字反查，请导入新版词库后重试'};
  if(state.pages.has(cursor))return state.pages.get(cursor);
  const matches=[];let nextCursor=null;
  for(let index=cursor;index<state.groups.length;index++){
    let match=null;
    for(const id of state.groups[index]){
      const page=await document(pack,id);
      if(store.key(codec.plainText(page.html)).includes(term)){
        const row=await metadata(pack,id);
        match={word:row[3],meaning:(pack.manifest.summaryVersion>=2?row[4]:codec.oxfordSummary(page.html))||'原文匹配：'+term};break;
      }
    }
    if(!match)continue;
    if(matches.length===40){nextCursor=index;break;}
    matches.push(match);
  }
  const result={kind:'matches',requested:term,matches,source:'offline-pack',cursor,nextCursor,pageSize:40};
  if(state.pages.size>=3)state.pages.delete(state.pages.keys().next().value);
  state.pages.set(cursor,result);return result;
}
async function suggest(word){const pack=await restore(),key=store.key(word);if(!pack||!pack.manifest.prefixIndex||!key||chineseSearch.hasHan(key))return [];const first=Array.from(key)[0],file='prefix/'+codec.hashBucket(first).toString(16).padStart(2,'0')+'.json';const items=(await jsonFile(pack,file))[first]||[],rows=[];for(const item of items){if(store.key(item[0]).startsWith(key)){const row=await metadata(pack,item[1]),meaning=pack.manifest.summaryVersion>=2?row[4]:codec.oxfordSummary((await document(pack,item[1])).html);rows.push({word:item[0],meaning});if(rows.length===10)break;}}return rows;}
async function spellingIndex(pack){
  if(pack.spellingIndex)return pack.spellingIndex;
  if(pack.loadingSpelling)return pack.loadingSpelling;
  const task=(async()=>{
    const groups=new Map(),seen=new Set(),names=Object.keys(pack.manifest.files).filter(name=>name.startsWith('prefix/')&&pack.manifest.files[name].bytes>2);
    for(let start=0;start<names.length;start+=8){
      const batches=await Promise.all(names.slice(start,start+8).map(name=>jsonFile(pack,name)));
      for(const values of batches)for(const items of Object.values(values))for(const [word,id] of items){
        const key=store.key(word);if(seen.has(key)||!spelling.eligible(key,1))continue;seen.add(key);
        const length=Array.from(key).length;if(!groups.has(length))groups.set(length,[]);groups.get(length).push({key,word,id});
      }
    }
    // Include the supplied inflected forms and aliases, not just headwords.
    // Compact lookup markers and numbered internal aliases stay out of the UI.
    const keyFiles=Object.keys(pack.manifest.files).filter(name=>name.startsWith('keys/')&&pack.manifest.files[name].bytes>2);
    for(let start=0;start<keyFiles.length;start+=8){
      const batches=await Promise.all(keyFiles.slice(start,start+8).map(name=>jsonFile(pack,name)));
      for(const values of batches)for(const [key,ids] of Object.entries(values)){
        if(key.charCodeAt(0)===1||seen.has(key)||/ \d+$/.test(key)||!spelling.eligible(key,1))continue;
        seen.add(key);const length=Array.from(key).length;if(!groups.has(length))groups.set(length,[]);groups.get(length).push({key,word:key,id:ids[0]});
      }
    }
    pack.spellingIndex=groups;return groups;
  })();
  pack.loadingSpelling=task;try{return await task;}finally{pack.loadingSpelling=null;}
}
async function correct(word){
  const key=store.key(word);if(!spelling.eligible(key))return [];
  const pack=await restore();if(!pack||!pack.manifest.prefixIndex)return [];
  if((await references(pack,key)).length)return [];
  const groups=await spellingIndex(pack),length=Array.from(key).length,tolerance=length<5?1:2,candidates=[];
  for(let size=length-tolerance;size<=length+tolerance;size++)for(const item of groups.get(size)||[])candidates.push(item);
  const selected=spelling.rank(key,candidates),rows=[];
  for(const item of selected){const meta=await metadata(pack,item.id),meaning=pack.manifest.summaryVersion>=2?meta[4]:codec.oxfordSummary((await document(pack,item.id)).html);rows.push({word:item.word,meaning});}
  return rows;
}
async function wordListRows(pack,key){
  if(!pack.wordLists)pack.wordLists=new Map();if(!pack.loadingWordLists)pack.loadingWordLists=new Map();
  if(pack.wordLists.has(key))return pack.wordLists.get(key);
  if(pack.loadingWordLists.has(key))return pack.loadingWordLists.get(key);
  const task=(async()=>{
    const ids=await references(pack,store.key(key));if(!ids.length)throw new Error('当前词库没有这份词表');
    const rows=[];for(const id of ids)for(const row of codec.parseWordList((await document(pack,id)).html))rows.push(row);
    if(pack.wordLists.size>=2)pack.wordLists.delete(pack.wordLists.keys().next().value);pack.wordLists.set(key,rows);return rows;
  })();
  pack.loadingWordLists.set(key,task);try{return await task;}finally{pack.loadingWordLists.delete(key);}
}
async function wordListCatalog(){
  const pack=await restore();if(!pack||!pack.manifest.prefixIndex)return null;
  if(pack.wordListCatalog)return pack.wordListCatalog;if(pack.loadingWordListCatalog)return pack.loadingWordListCatalog;
  const task=(async()=>{
    const values=await jsonFile(pack,'prefix/'+codec.hashBucket('@').toString(16).padStart(2,'0')+'.json'),words=((values||{})['@']||[]).map(item=>item[0]).sort();
    const opal=words.find(word=>/^@opal_/.test(word)),fields=opal?codec.opalWordListFields(await wordListRows(pack,opal)):{};
    pack.wordListCatalog=codec.describeWordLists(words,fields);return pack.wordListCatalog;
  })();
  pack.loadingWordListCatalog=task;try{return await task;}finally{pack.loadingWordListCatalog=null;}
}
async function wordList(id){
  const pack=await restore(),catalog=await wordListCatalog();if(!pack||!catalog)return null;
  const descriptor=catalog.find(item=>item.id===id);if(!descriptor)return null;
  return Object.assign(codec.selectWordList(await wordListRows(pack,descriptor.sourceKey),descriptor),{source:'offline-pack'});
}
async function zipEntries(path) {
  const size = await stat(path); if (size < 22 || size > 160*1024*1024) throw new Error('词库压缩分卷体积异常');
  const tailLength = Math.min(size, 65557), tail = await chunk(path, size - tailLength, tailLength); let end = -1;
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0 || view.getUint16(end+4,true) !== 0 || view.getUint16(end+6,true) !== 0) throw new Error('不支持此 ZIP 文件');
  const count = view.getUint16(end+10,true), length = view.getUint32(end+12,true), position = view.getUint32(end+16,true);
  if (count > 1800 || length > 2*1024*1024 || position + length > size) throw new Error('ZIP 文件清单异常');
  const directory = await chunk(path, position, length), data = new DataView(directory.buffer, directory.byteOffset, directory.byteLength); const entries = []; let offset = 0;
  for (let i = 0; i < count; i++) {
    if (offset+46 > directory.length || data.getUint32(offset,true) !== 0x02014b50) throw new Error('ZIP 索引损坏');
    const flags = data.getUint16(offset+8,true), method = data.getUint16(offset+10,true), rawSize = data.getUint32(offset+24,true), nameLength = data.getUint16(offset+28,true), extra = data.getUint16(offset+30,true), comment = data.getUint16(offset+32,true);
    const name = codec.strFromU8(directory.slice(offset+46,offset+46+nameLength));
    const mode = (data.getUint32(offset+38,true) >>> 16) & 0xf000;
    if (flags & 1 || mode === 0xa000 || ![0,8].includes(method) || !SAFE_NAME.test(name) || rawSize > 64*1024*1024) throw new Error('ZIP 中包含不允许的路径或文件');
    entries.push({ name, bytes: rawSize }); offset += 46+nameLength+extra+comment;
  }
  return entries;
}
async function clearStages(){const result=await call('readdir',{dirPath:wx.env.USER_DATA_PATH});for(const name of result.files)if(/^hange-oxford-stage-[0-9]+$/.test(name))await call('rmdir',{dirPath:wx.env.USER_DATA_PATH+'/'+name,recursive:true});}
async function installPack(paths, progress) {
  if (paths.length < 1 || paths.length > 5) throw new Error('请选择索引卷和全部数据卷，最多 5 个 ZIP 文件');
  const state = await status(); if (state.installed) throw new Error('请先移除已安装的词库，再导入新版；生词本和笔记不受影响');
  if(state.error)throw new Error('请先移除未能读取的旧词库，再重新导入；学习记录会保留');
  const names = new Set(), declared = []; let total = 0;
  for (const path of paths) for (const entry of await zipEntries(path)) { if (names.has(entry.name)) throw new Error('选中了重复的词库分卷'); names.add(entry.name); declared.push(entry); total += entry.bytes; }
  if (!names.has('manifest.json') || total > 181*1024*1024) throw new Error('缺少索引分卷，或词库超出安全容量');
  const root = pathRoot(), stage = root + '-stage-' + Date.now();
  await clearStages();
  if(!wx.getStorageSync(POINTER)){try{await call('stat',{path:root});await call('rmdir',{dirPath:root,recursive:true});}catch(error){if(!missing(error))throw error;}}
  await call('mkdir', { dirPath: stage, recursive: true });
  try {
    for (let i = 0; i < paths.length; i++) { if (progress) progress('解压词库分卷 ' + (i+1) + '/' + paths.length, i/paths.length*30); await call('unzip', { zipFilePath: paths[i], targetPath: stage }); }
    const manifest = validateManifest(JSON.parse(await read(stage + '/manifest.json','utf8')));
    if (Object.keys(manifest.files).length + 1 !== names.size || declared.some(file => file.name !== 'manifest.json' && (!manifest.files[file.name] || manifest.files[file.name].bytes !== file.bytes))) throw new Error('缺少词库分卷，或分卷不属于同一版本');
    let checked = 0;
    for (const [name, expected] of Object.entries(manifest.files)) {
      if (await stat(stage + '/' + name) !== expected.bytes) throw new Error('词库分卷不完整：' + name);
      const digest = codec.sha256.create();
      for (let offset = 0; offset < expected.bytes; offset += 1024*1024) digest.update(await chunk(stage + '/' + name, offset, Math.min(1024*1024, expected.bytes-offset)));
      if (codec.hex(digest.digest()) !== expected.sha256) throw new Error('词库校验失败：' + name);
      checked += expected.bytes; if (progress) progress('核对词库完整性', 30 + checked/manifest.extractedBytes*70);
    }
    // Only our fixed dictionary directory may be replaced, never learning data.
    try { await call('rmdir', { dirPath: root, recursive: true }); } catch (_) {}
    await call('rename', { oldPath: stage, newPath: root });
    try { wx.setStorageSync(POINTER, { root, edition: manifest.edition }); }
    catch (error) { await call('rmdir', { dirPath: root, recursive: true }); throw error; }
    try { require('../utils/cache').clear(); } catch (_) {}
    active = null;
    return status();
  } catch (error) { try { await call('rmdir', { dirPath: stage, recursive: true }); } catch (_) {} throw error; }
}
async function install(paths,progress){if(installing)throw new Error('已有词库导入正在进行');installing=true;progressState={working:true,progress:0,message:'检查词库分卷',error:''};try{const result=await installPack(paths,(message,value)=>{progressState={working:true,message,progress:Math.min(100,Math.round(value)),error:''};if(progress)progress(message,value);});progressState.message='牛津词库已完整导入';return result;}catch(error){progressState.error=error.message;progressState.message='导入未完成，学习记录保持不变';throw error;}finally{installing=false;progressState.working=false;}}
async function remove() { if(installing)throw new Error('请等待当前词库导入结束');active = null; restoring = null; const root = pathRoot(); if (!root.startsWith(wx.env.USER_DATA_PATH + '/')) throw new Error('非法词库路径'); try { await call('rmdir', { dirPath: root, recursive: true }); } catch (error) { if (!missing(error)) throw error; } await clearStages();wx.removeStorageSync(POINTER);progressState={working:false,progress:0,message:'离线词库已移除',error:''}; }
module.exports = { lookup, status, progress(){return Object.assign({},progressState);}, suggest, correct, wordListCatalog, wordList, install, remove, zipEntries, validateManifest, _reset() { active = null; restoring = null; } };
