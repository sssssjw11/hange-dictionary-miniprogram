const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));let pending=[],scrolls=[],packets=[];
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarTitle(){},nextTick(callback){pending.push(callback);},pageScrollTo(options){scrolls.push(options);}};
const search=require('../miniprogram/utils/reader-search'),library=require('../miniprogram/services/library'),media=require('../miniprogram/services/media'),study=require('../miniprogram/services/study');
function page(){let definition;const file=path.resolve(__dirname,'../miniprogram/pages/reader/index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value,callback){packets.push(value);Object.assign(this.data,copy(value));if(callback)callback();}};for(const [key,value]of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
function flush(){while(pending.length)pending.shift()();}
test.beforeEach(()=>{memory.clear();pending=[];scrolls=[];packets=[];});

test('reader search maps canonical Unicode and overlapping matches without losing dense final results',()=>{
 const source='😀 cafe\u0301 词_ 句 O’Reilly ΟΣ Σ 哈哈哈 𠀀字';
 for(const [query,expected]of [['CAFÉ 词 句','cafe\u0301 词_ 句'],["o'reilly",'O’Reilly'],['ς','Σ'],['😀','😀'],['𠀀','𠀀']]){const hits=search.find(source,query),range=search.range(hits,0);assert.ok(range);assert.equal(source.slice(range.start,range.end),expected);}
 assert.deepEqual(Array.from(search.find('哈哈哈','哈哈')),[0,2,1,3]);assert.equal(search.find('İ','i').length,0);assert.equal(search.find('e\u0301','e').length,0);assert.equal(search.range(new Uint32Array(),0),null);assert.throws(()=>search.find(source,' '),/1～256/);assert.throws(()=>search.find(source,'x'.repeat(257)),/1～256/);
 const dense=search.find('a'.repeat(200000),'a');assert.equal(dense.length/2,200000);assert.ok(dense.buffer.byteLength<=1600000);assert.deepEqual(search.range(dense,199999),{start:199999,end:200000});assert.equal(search.range(dense,200000),null);
});

test('cross-page highlights retain every source character, existing marks and whole-word lookup offsets',()=>{
 const source='文'.repeat(1798)+'cafe\u0301尾',hit=search.range(search.find(source,'CAFÉ'),0),pages=library.ranges(source),marks=[{start:1798,end:1803,color:'green',kind:'highlight',updated:1}];
 const decorated=pages.map(page=>library.decorated(page.text,page.start,marks,null,hit));assert.equal(decorated.flat().map(token=>token.text).join(''),source);assert.equal(decorated.flat().filter(token=>token.searchMatch).map(token=>token.text).join(''),'cafe\u0301');assert.ok(decorated.every(tokens=>tokens.some(token=>token.searchMatch&&token.color==='green')));
 const word=library.decorated('learning',20,[],null,{start:22,end:25});assert.equal(word.filter(token=>token.searchMatch).map(token=>token.text).join(''),'arn');assert.ok(word.every(token=>token.wordStart===20&&token.wordEnd===28));
});

test('reader navigates all hits, clears failed searches and closes without changing source or notes',()=>{
 const source='target '+('A useful sentence. '.repeat(150))+'TARGET end',id=library.add('Reading',source);library.mark(id,0,6,'Keep this note','yellow');const before=library.get(id),controller=page();
 try{controller.onLoad({id});controller.onSearchOpen();controller.onSearchInput({detail:{value:'target'}});controller.onSearchRun();assert.equal(controller.data.searchTotal,2);assert.equal(controller.data.page,0);assert.equal(controller.data.tokens.filter(token=>token.searchMatch).map(token=>token.text).join(''),'target');assert.ok(controller.data.tokens.some(token=>token.searchMatch&&token.color==='yellow'));
  controller.onSearchNext();const lastPage=controller.data.page;assert.ok(lastPage>0);assert.equal(controller.data.searchIndex,1);assert.equal(library.get(id).progress,lastPage);controller.onSearchNext();assert.equal(controller.data.page,lastPage);controller.onSearchPrev();assert.equal(controller.data.page,0);controller.onSearchPrev();assert.equal(controller.data.searchIndex,0);
  controller.onSearchNext();controller.onSearchClose();assert.equal(controller.data.page,lastPage);assert.equal(controller.data.searchOpen,false);assert.equal(controller._searchHits,null);assert.ok(controller.data.tokens.every(token=>!token.searchMatch));
  controller.onSearchInput({detail:{value:'missing text'}});controller.onSearchRun();assert.equal(controller.data.searchTotal,0);assert.match(controller.data.searchError,/未找到/);assert.ok(controller.data.tokens.every(token=>!token.searchMatch));controller.onSearchInput({detail:{value:''}});controller.onSearchRun();assert.match(controller.data.searchError,/1～256/);
  const after=library.get(id);assert.equal(after.text,before.text);assert.deepEqual(after.annotations,before.annotations);assert.equal(study.stats().today.attempts,0);assert.ok(packets.every(value=>!Object.values(value).some(item=>ArrayBuffer.isView(item))));assert.ok(packets.every(value=>Buffer.byteLength(JSON.stringify(value))<900000));
 }finally{controller.onUnload();}
});

test('late scroll callbacks cannot override the newest hit, and source changes invalidate saved offsets',()=>{
 const id=library.add('Reading','one '+('body '.repeat(500))+'one'),controller=page(),get=library.get;
 try{controller.onLoad({id});controller.onSearchInput({detail:{value:'one'}});controller.onSearchRun();controller.onSearchNext();const range=controller._searchRange;flush();assert.deepEqual(scrolls.filter(value=>value.selector).map(value=>value.selector),['#reader-token-'+range.start]);
  library.get=()=>Object.assign({},get(id),{text:'changed body',annotations:[]});controller.refreshArticle();assert.equal(controller._searchHits,null);assert.equal(controller._searchRange,null);assert.equal(controller.data.searchTotal,0);assert.match(controller.data.searchError,/更新/);assert.equal(controller.data.tokens.map(token=>token.text).join(''),'changed body');
  library.get=get;library.remove(id);controller.refreshArticle();assert.equal(controller.data.searchOpen,false);assert.equal(controller.data.total,0);assert.deepEqual(controller.data.tokens,[]);
 }finally{library.get=get;controller.onUnload();}
});

test('opening search pauses continuous reading and ignores a late audio completion',async()=>{
 const speak=media.speakAndWait,id=library.add('Reading','Find this sentence. '.repeat(200)),controller=page();let finish,calls=0;
 media.speakAndWait=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
 try{controller.onLoad({id});const playing=controller.onReadAll();controller.onSearchOpen();assert.equal(controller.data.reading,false);assert.match(controller.data.readStatus,/查找时朗读已暂停/);controller.onSearchInput({detail:{value:'Find'}});controller.onSearchRun();controller.onSearchNext();const foundPage=controller.data.page;finish({});await playing;assert.equal(calls,1);assert.equal(controller.data.page,foundPage);assert.equal(controller.data.searchIndex,1);
 }finally{controller.onUnload();media.speakAndWait=speak;}
});
