const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'hange-learning-test-'));
const memory=new Map();
let failFile='',failHead=false;
const copy=value=>JSON.parse(JSON.stringify(value));
function safe(file){const resolved=path.resolve(file);assert.ok(resolved===root||resolved.startsWith(root+path.sep));return resolved;}
global.wx={env:{USER_DATA_PATH:root},getStorageSync(key){return memory.has(key)?copy(memory.get(key)):'';},setStorageSync(key,value){if(failHead&&key==='hange.records.heads.v1')throw new Error('head quota');memory.set(key,copy(value));},getFileSystemManager(){return {
 readFileSync(file,encoding){return fs.readFileSync(safe(file),encoding);},
 writeFileSync(file,value,encoding){if(failFile&&file.includes(failFile))throw new Error('disk full');fs.writeFileSync(safe(file),value,encoding);},
 mkdirSync(file,recursive){fs.mkdirSync(safe(file),{recursive});}
};}};
const records=require('../miniprogram/utils/records');
const backup=require('../miniprogram/services/backup');
const store=require('../miniprogram/utils/store');
const study=require('../miniprogram/services/study');
const library=require('../miniprogram/services/library');
const sentences=require('../miniprogram/services/sentences');
function snapshot(){return {learning:store.snapshot(),records:records.snapshot()};}
test.after(()=>{safe(root);fs.rmSync(root,{recursive:true,force:true});});
test.beforeEach(()=>{memory.clear();failFile='';failHead=false;});

test('complete backup restores all learning modules and preserves current notes, cards and reading progress',()=>{
 store.saveNote('run','跑','original');study.plan(3,8);study.review('run','good',{event:'saved'});
 const id=library.add('Story','Hello world. 中文🙂');library.progress(id,2);
 sentences.save('Hello world.','你好，世界。','Story','first');
 const source=backup.exportAll();
 store.saveNote('run','跑','keep current');study.known('run',true);library.progress(id,5);
 const card=sentences.list()[0];sentences.save(card.en,card.zh,card.source,'keep edit',card.id);
 store.saveNote('apple','苹果','newer');
 backup.importAll(source);
 assert.equal(store.favorite('run').note,'keep current');assert.ok(store.favorite('apple'));
 assert.equal(library.get(id).progress,5);assert.equal(sentences.list()[0].note,'keep edit');assert.equal(study.queue('favorites').words.includes('run'),false);
 const expected=snapshot(),all=backup.exportAll();memory.clear();backup.importAll(all);
 assert.deepEqual(snapshot().records,expected.records);assert.equal(store.favorite('run').note,'keep current');
});

test('file-write or atomic-head failure leaves every committed module and notebook unchanged',()=>{
 store.saveNote('run','跑','before');sentences.save('Before.','','fixture');library.add('Before','Before text');
 const old=snapshot();
 const incoming=JSON.parse(backup.exportAll());incoming.learning.favorites.push({word:'apple',meaning:'苹果',note:'incoming'});
 incoming.records.sentences.items.push({...incoming.records.sentences.items[0],id:'other',en:'After.'});
 incoming.records.library.articles.push({id:'new',title:'After',text:'After text',created:1,progress:0});
 const source=JSON.stringify(incoming);
 failFile='library-';assert.throws(()=>backup.importAll(source),/disk full/);failFile='';assert.deepEqual(snapshot(),old);
 failHead=true;assert.throws(()=>backup.importAll(source),/head quota/);failHead=false;assert.deepEqual(snapshot(),old);
 backup.importAll(source);assert.equal(sentences.list().length,2);assert.equal(library.list().length,2);assert.ok(store.favorite('apple'));
});

test('malformed progress and over-capacity backups are rejected before any committed data changes',()=>{
 store.saveNote('run','跑','safe');study.review('run','good');const before=snapshot();
 for(const mutate of [root=>root.records.study.plan.dailyNew=-1,root=>root.records.study.cards.run.due='tomorrow',root=>root.records.library={articles:[null]},root=>root.records.tools={translations:[{created:1,target:'bad',source:'x',text:'y'}]}]){
  const root=JSON.parse(backup.exportAll());mutate(root);assert.throws(()=>backup.importAll(JSON.stringify(root)),/格式无效/);assert.deepEqual(snapshot(),before);
 }
 assert.throws(()=>records.write('library',{articles:[],extra:'中'.repeat(800000)}),/2 MiB/);assert.deepEqual(snapshot(),before);
 for(const source of ['null','[]','{broken'])assert.throws(()=>backup.importAll(source));
});

test('reading pagination and word tokens preserve every character; deleting a book retains saved sentences',()=>{
 const text=("They’re learning well-being. 中文🙂\n"+'x'.repeat(1801)).repeat(3);
 const pages=library.pages(text);assert.equal(pages.join(''),text);
 assert.ok(pages.every(page=>page.length<=1800&&!/[\uD800-\uDBFF]$/.test(page)));
 for(const page of pages)assert.equal(library.tokens(page).map(token=>token.text).join(''),page);
 const id=library.add('   ',text);assert.equal(library.get(id).title,'未命名文章');
 sentences.save(pages[0],'','saved passage');library.progress(id,1);assert.equal(library.get(id).progress,1);library.remove(id);assert.equal(sentences.list().length,1);
});
test('complete backup remains restorable beyond the legacy 2,000-item per-file limit',()=>{
 const favorites=Array.from({length:2500},(_,index)=>({word:'word'+index,meaning:'meaning',note:'saved',created:1,updated:1}));
 memory.set('hange.learning.v1',{favorites,history:[]});const exported=backup.exportAll();memory.clear();backup.importAll(exported);assert.equal(store.favorites().length,2500);assert.equal(store.favorite('word2499').note,'saved');
});
