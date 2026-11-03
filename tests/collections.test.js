const test=require('node:test');const assert=require('node:assert/strict');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));let fail=false;
global.wx={getStorageSync(key){return memory.has(key)?copy(memory.get(key)):'';},setStorageSync(key,value){if(fail)throw new Error('quota');memory.set(key,copy(value));}};
const store=require('../miniprogram/utils/store');const study=require('../miniprogram/services/study');
test.beforeEach(()=>{memory.clear();fail=false;});
test('multiple wordbooks share one note and stay available as study decks; deleting a group keeps words and progress',()=>{
 const first=store.createGroup('阅读'),second=store.createGroup('考试');store.saveNote('run','跑','keep note');store.setGroups('run',[first,second]);study.review('run','good');
 assert.equal(store.groups().find(group=>group.id===first).count,1);assert.deepEqual(study.words('book:'+first),['run']);assert.ok(study.decks().find(deck=>deck.id==='book:'+first).system);
 store.renameGroup(first,'Reading');assert.equal(store.favorite('run').note,'keep note');store.removeGroup(first);assert.equal(store.favorite('run').note,'keep note');assert.deepEqual(store.favorite('run').groups,[second]);assert.equal(study.stats().learned,1);
 store.setGroups('run',[]);assert.equal(store.favorites('ungrouped').length,1);
});
test('batch assignments and imports into a selected group never overwrite existing notes',()=>{
 const group=store.createGroup('Course');store.saveNote('run','跑','current');store.setGroupsMany(['run','apple'],[group]);assert.equal(store.favorite('run').note,'current');
 const source=JSON.stringify({format:'hange-local-notebook',version:1,items:[{word:'run',note:'old',meaning:'old'},{word:'new',meaning:'new',note:'imported'}]});assert.equal(store.importJson(source,group),1);assert.equal(store.favorite('run').note,'current');assert.equal(store.favorites(group).length,3);
 const exported=JSON.parse(store.exportJson(group));assert.equal(exported.version,1);assert.ok(exported.items.every(item=>!Object.hasOwn(item,'groups')));
});
test('duplicate names, missing groups and quota failures do not partially change membership',()=>{
 const group=store.createGroup('Reading');store.saveNote('run','跑','safe');const before=store.snapshot();assert.throws(()=>store.createGroup('reading'),/同名/);assert.throws(()=>store.setGroupsMany(['run','apple'],['book-missing']),/不存在/);assert.deepEqual(store.snapshot(),before);
 fail=true;assert.throws(()=>store.setGroupsMany(['run','apple'],[group]),/quota/);fail=false;assert.deepEqual(store.snapshot(),before);
});
test('adding wordbook support does not consume the remaining capacity of a near-full legacy notebook',()=>{
 const favorites=Array.from({length:2000},(_,index)=>({word:'word'+index,meaning:'meaning',note:'',created:1,updated:1}));const value={favorites,history:[]},base=Buffer.byteLength(JSON.stringify(value)),length=Math.floor((840000-base)/favorites.length);for(const item of favorites)item.note='n'.repeat(length);assert.ok(Buffer.byteLength(JSON.stringify(value))<850000);memory.set('hange.learning.v1',value);
 assert.ok(Buffer.byteLength(JSON.stringify(store.snapshot()))>850000,'expanded defaults would exceed the old capacity');store.visit('run','meaning');assert.equal(store.favorites().length,2000);assert.equal(store.favorite('word1999').note.length,length);assert.equal(store.history()[0].word,'run');
});
