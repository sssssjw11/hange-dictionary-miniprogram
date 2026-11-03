const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));let packets=[];
global.wx={getStorageSync(key){return memory.has(key)?copy(memory.get(key)):'';},setStorageSync(key,value){memory.set(key,copy(value));},getAppBaseInfo(){return {theme:'light'};},setNavigationBarColor(){},setBackgroundColor(){},setTabBarStyle(){},showToast(){},navigateTo(){},navigateBack(){}};
const store=require('../miniprogram/utils/store');const study=require('../miniprogram/services/study');const dictionary=require('../miniprogram/services/dictionary');
function page(name){let definition;const file=path.join(__dirname,'../miniprogram/pages',name,'index.js');global.Page=value=>definition=value;delete require.cache[file];require(file);const controller={data:copy(definition.data),setData(value){const size=Buffer.byteLength(JSON.stringify(value));assert.ok(size<900000);packets.push(size);Object.assign(this.data,copy(value));}};for(const [key,value]of Object.entries(definition))if(typeof value==='function')controller[key]=value.bind(controller);return controller;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test.beforeEach(()=>{memory.clear();packets=[];});
test('10,000-word decks stay in logic storage; every word is reachable through bounded native pages',()=>{
 const words=Array.from({length:10000},(_,index)=>'word-'+String(index).padStart(5,'0'));
 const id=study.createDeck('Large deck',words.join('\n'));
 const learning=page('study');learning.onShow();assert.ok(!JSON.stringify(learning.data.decks).includes(words[9999]));
 const controller=page('wordlist');controller.onLoad({id});controller.onShow();assert.equal(controller.data.total,10000);assert.equal(controller.data.listPages,200);
 const visited=[];for(let index=0;index<controller.data.listPages;index++){controller.refresh(index);visited.push(...controller.data.rows);assert.ok(controller.data.rows.length<=50);}
 assert.deepEqual(visited,words);assert.ok(Math.max(...packets)<15000);
 controller.onSearch({detail:{value:'09999'}});assert.deepEqual(controller.data.rows,['word-09999']);
});
test('review ignores double submissions and never updates an unloaded page after lookup resolves',async()=>{
 const original=dictionary.lookup;
 store.saveNote('run','跑','keep');store.saveNote('apple','苹果','keep');
 dictionary.lookup=async word=>({kind:'entry',word,brief:'meaning',senses:[]});
 try{
  const controller=page('review');controller.onLoad({deck:'favorites',mode:'flash'});await tick();
  controller.onGrade({currentTarget:{dataset:{grade:'good'}}});controller.onGrade({currentTarget:{dataset:{grade:'good'}}});await tick();
  assert.equal(study.stats().today.new,1);assert.equal(controller._session.index,1);
  let finish;dictionary.lookup=()=>new Promise(resolve=>finish=resolve);
  const pending=page('review');pending.onLoad({deck:'starter',mode:'spell'});pending.onUnload();const count=packets.length;
  finish({kind:'entry',word:'run',brief:'meaning'});await tick();assert.equal(packets.length,count);assert.ok(study.pending());
 }finally{dictionary.lookup=original;}
});
