const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));let packets=[];
global.wx={getStorageSync(key){return memory.has(key)?copy(memory.get(key)):'';},setStorageSync(key,value){memory.set(key,copy(value));},getAppBaseInfo(){return {theme:'light'};},setNavigationBarColor(){},setBackgroundColor(){},setTabBarStyle(){},showToast(){},navigateTo(){},navigateBack(){}};
const store=require('../miniprogram/utils/store');const study=require('../miniprogram/services/study');const dictionary=require('../miniprogram/services/dictionary');
function page(name){let definition;const file=path.join(__dirname,'../miniprogram/pages',name,'index.js');global.Page=value=>definition=value;delete require.cache[file];require(file);const controller={data:copy(definition.data),setData(value){const size=Buffer.byteLength(JSON.stringify(value));assert.ok(size<900000);packets.push(size);Object.assign(this.data,copy(value));}};for(const [key,value]of Object.entries(definition))if(typeof value==='function')controller[key]=value.bind(controller);return controller;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test.beforeEach(()=>{memory.clear();packets=[];});

test('a fresh learner starts with an available built-in deck and may deliberately select an empty wordbook',()=>{
 const controller=page('study');controller.onShow();assert.equal(controller.data.deck,'starter');assert.ok(controller.data.queued>0);
 controller.onDeck({currentTarget:{dataset:{id:'favorites'}}});controller.refresh();assert.equal(controller.data.deck,'favorites');assert.equal(controller.data.queued,0);
});

test('successful Chinese reverse queries are retained in history as queries rather than fabricated definitions',async()=>{
 const original=dictionary.lookup;dictionary.lookup=async()=>({kind:'matches',matches:[{word:'interpersonal',meaning:'人际关系的'}]});
 try{const controller=page('entry');await controller.load('人际关系');assert.equal(store.history()[0].word,'人际关系');assert.equal(store.history()[0].meaning,'找到 1 个相关词条');controller.onUnload();}finally{dictionary.lookup=original;}
});
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
test('word player sequences the whole deck, saves position, and does not count passive playback as review',async()=>{
 const media=require('../miniprogram/services/media'),lookup=dictionary.lookup,speak=media.speakAndWait;const spoken=[];
 dictionary.lookup=async word=>({kind:'entry',word,brief:'meaning'});media.speakAndWait=async word=>{spoken.push(word);return {locale:'en-US'};};
 try{const id=study.createDeck('Playback','apple\nrun');const controller=page('player');controller.onLoad({deck:id});await tick();controller.wait=async()=>{};await controller.onPlay();assert.deepEqual(spoken,['apple','run']);assert.equal(controller.data.playing,false);assert.equal(controller.data.message,'本轮播放完成');assert.equal(study.playback().index,1);assert.equal(study.stats().today.attempts,0);controller.onUnload();}finally{dictionary.lookup=lookup;media.speakAndWait=speak;}
});
test('word player pauses on hide and resumes its saved position without late view updates',async()=>{
 const media=require('../miniprogram/services/media'),lookup=dictionary.lookup,speak=media.speakAndWait;let finish;
 dictionary.lookup=async word=>({kind:'entry',word,brief:'meaning'});media.speakAndWait=()=>new Promise(resolve=>finish=resolve);
 try{const id=study.createDeck('Playback','apple\nrun');const controller=page('player');controller.onLoad({deck:id});await tick();const playing=controller.onPlay();await tick();controller.onHide();assert.equal(controller.data.playing,false);const count=packets.length;finish({cancelled:true});await playing;assert.equal(packets.length,count);const resumed=page('player');resumed.onLoad({deck:id});await tick();assert.equal(resumed.data.word,'apple');assert.equal(resumed.data.playing,false);controller.onUnload();resumed.onUnload();}finally{dictionary.lookup=lookup;media.speakAndWait=speak;}
});
