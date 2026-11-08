const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { wxmlToJs } = require('miniprogram-compiler');
global.window = global;
const compile = new Function('global', wxmlToJs(path.resolve(__dirname, '../miniprogram')))({});
function text(node) { return typeof node === 'string' ? node : (node.children || []).map(text).join(''); }
function nodes(node) { return typeof node === 'string' ? [] : [node, ...(node.children || []).flatMap(nodes)]; }

test('native daily data preserves every original learning topic without requiring JSON at runtime',()=>{
  const fs=require('node:fs');
  const original=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../miniprogram/data/learning.json'),'utf8'));
  assert.deepEqual(require('../miniprogram/data/learning'),original);
  assert.equal(Object.keys(original).length,32);
});

test('the floating navigation renders all destinations and disappears while typing',()=>{
  const data={items:require('../miniprogram/data/tabs'),selected:0,theme:'light',keyboard:false};
  assert.equal(nodes(compile('custom-tab-bar/index.wxml')(data)).filter(node=>node.tag==='wx-button').length,5);
  assert.equal(nodes(compile('custom-tab-bar/index.wxml')(Object.assign({},data,{keyboard:true}))).filter(node=>node.tag==='wx-button').length,0);
});
test('official WXML renderer resolves search data and repeated shortcuts', () => {
  const result = compile('pages/search/index.wxml')({ theme: 'light', offlineCount: 97, recent: [], suggestions: [], shortcuts: ['predicative', 'run'] });
  assert.ok(text(result).includes('导入牛津')); assert.ok(text(result).includes('predicative'));
  assert.equal(nodes(result).filter(x => x.attr && x.attr.bindtap === 'onWord').length, 2);
});
test('native entry template selects Oxford nodes and teaching content correctly', () => {
  const data = { loading: false, theme: 'light', entry: { word: 'demo', hasOxford: true, hasTeaching: true, hasSenses: true, forms: [] }, source: 'oxford', oxfordBlocks: [{ id: '1', nodes: [{ type: 'text', text: 'A complete definition' }] }], senses: [], related: [], teaching: { title: 'Original note', explanation: 'Learning explanation', patterns: [], examples: [] }, page: 0, totalPages: 2 };
  const oxford = compile('pages/entry/index.wxml')(data);
  assert.equal(nodes(oxford).filter(x => x.tag === 'wx-rich-text').length, 1);
  assert.ok(text(oxford).includes('下一页')); assert.ok(!text(oxford).includes('Learning explanation'));
  const teaching = compile('pages/entry/index.wxml')(Object.assign({}, data, { source: 'teaching' }));
  assert.ok(text(teaching).includes('Learning explanation')); assert.equal(nodes(teaching).filter(x => x.tag === 'wx-rich-text').length, 0);
});

test('contents rows and source focus blocks use native buttons and addressable outer views',()=>{
  const data={loading:false,theme:'light',entry:{word:'demo',hasOxford:true,hasContents:true,forms:[]},source:'oxford',contentsOpen:true,contentsRows:[{key:'0-0',index:0,kind:'义项',label:'2. 原文义项'}],contentsPages:1,localJumpRows:[],oxfordBlocks:[{id:'0-1-focus',nodes:[{type:'text',text:'Original source fragment'}]}],totalPages:1,relatedTotal:1,referenceRows:[{index:0,label:'other (2)',word:'other',anchor:'second'}]};
  const result=compile('pages/entry/index.wxml')(data),all=nodes(result);assert.ok(text(result).includes('牛津目录'));assert.ok(text(result).includes('2. 原文义项'));assert.ok(all.some(node=>node.attr&&node.attr.id==='oxford-0-1-focus'));assert.ok(all.some(node=>node.attr&&node.attr.bindtap==='onReference'));assert.ok(all.some(node=>node.attr&&node.attr.bindtap==='onContentsItem'));
});

test('source page references and legacy refresh controls are rendered in the correct states',()=>{
  const base={loading:false,theme:'light',entry:{word:'demo',hasOxford:true,forms:[],learningTags:[]},source:'oxford',oxfordBlocks:[{id:'0',nodes:[]}],totalPages:1,relatedTotal:1};
  const current=compile('pages/entry/index.wxml')(Object.assign({},base,{pageReferenceAvailable:true,pageReferenceTotal:1,pageReferenceRows:[{index:0,label:'original link'}],pageReferencePages:1}));assert.ok(text(current).includes('本页关联词'));assert.ok(nodes(current).some(node=>node.attr&&node.attr.bindtap==='onPageReference'));assert.ok(!text(current).includes('读取本页关联'));
  const legacy=compile('pages/entry/index.wxml')(Object.assign({},base,{pageReferenceAvailable:false,pageReferenceTotal:0,pageReferenceRows:[]}));assert.ok(text(legacy).includes('读取本页关联'));assert.ok(nodes(legacy).some(node=>node.attr&&node.attr.bindtap==='onPageReferenceRefresh'));
});

test('old table update is offered only for entries with legacy table layout',()=>{
  const base={loading:false,theme:'light',entry:{word:'demo',hasOxford:true,hasOldTables:true,forms:[],learningTags:[]},source:'oxford',oxfordBlocks:[{id:'0',nodes:[]}],totalPages:1};
  const old=compile('pages/entry/index.wxml')(base);assert.ok(text(old).includes('更新表格'));assert.ok(nodes(old).some(node=>node.attr&&node.attr.bindtap==='onTableRefresh'));
  const current=compile('pages/entry/index.wxml')(Object.assign({},base,{entry:Object.assign({},base.entry,{hasOldTables:false})}));assert.ok(!text(current).includes('更新表格'));
});

test('reader exposes a stop control and the actual voice while continuous reading is active',()=>{
  const data={theme:'light',title:'Reading',total:2,page:0,tokens:[],reading:true,readContinuous:true,readStatus:'第 1 / 2 页 · 系统合成 · Sample voice',annotationsCount:0};
  const result=compile('pages/reader/index.wxml')(data);assert.ok(text(result).includes('停止连读'));assert.ok(text(result).includes('系统合成 · Sample voice'));assert.ok(nodes(result).some(node=>node.attr&&node.attr.bindtap==='onReadAll'));
});

test('reader search renders the matching source span and bounds the result navigation',()=>{
  const data={theme:'light',title:'Reading',total:2,page:0,searchOpen:true,searchQuery:'find',searchTotal:2,searchIndex:0,tokens:[{id:'3-7',start:3,end:7,text:'find',word:true,wordStart:3,wordEnd:7,searchMatch:true,color:'green'}]};
  const result=compile('pages/reader/index.wxml')(data),all=nodes(result);assert.ok(text(result).includes('找到 2 处'));assert.ok(all.some(node=>node.attr&&node.attr.id==='reader-token-3'&&node.attr.class.includes('reader-search-hit')&&node.attr.class.includes('mark-green')));assert.equal(all.find(node=>node.attr&&node.attr.bindtap==='onSearchPrev').attr.disabled,true);assert.equal(all.find(node=>node.attr&&node.attr.bindtap==='onSearchNext').attr.disabled,false);
  const closed=compile('pages/reader/index.wxml')(Object.assign({},data,{searchOpen:false}));assert.ok(!nodes(closed).some(node=>node.attr&&node.attr.bindtap==='onSearchNext'));
});

test('learning history renders honest partial records, native date selection and paginated word links',()=>{
  const data={theme:'light',date:'2026-11-08',today:'2026-11-08',start:'2025-10-05',period:7,filter:'all',selected:{new:1,review:25,attempts:26,rate:'50%',duration:'2 分 0 秒'},summary:{attempts:26,duration:'2 分 0 秒'},days:[{date:'2026-11-08',label:'11-08',count:26,height:150}],partial:true,recorded:25,historyLimit:2000,rows:[{id:'one',word:'apple',grade:'again',gradeLabel:'忘记',modeLabel:'单词拼写',time:'12:00',duration:'5 秒',first:false}],page:0,pages:2};
  const result=compile('pages/statistics/index.wxml')(data),all=nodes(result);assert.ok(text(result).includes('只有汇总数据'));assert.ok(text(result).includes('apple'));assert.ok(all.some(node=>node.tag==='wx-picker'&&node.attr.mode==='date'));assert.ok(all.some(node=>node.attr&&node.attr.bindtap==='onWord'));assert.equal(all.find(node=>node.attr&&node.attr.bindtap==='onPrev').attr.disabled,true);assert.equal(all.find(node=>node.attr&&node.attr.bindtap==='onNext').attr.disabled,false);
  const empty=compile('pages/statistics/index.wxml')(Object.assign({},data,{rows:[],recorded:0,pages:0,partial:false,selected:{attempts:0}}));assert.ok(text(empty).includes('这一天还没有提交学习记录'));assert.ok(!text(empty).includes('只有汇总数据'));
});

test('spelling suggestions keep the typed query and offer word buttons without Chinese pagination or an irrelevant retry',()=>{
  const data={loading:false,entry:null,resultKind:'missing',suggestionKind:'spelling',matchQuery:'semantci',matches:[{word:'semantic',meaning:'原创释义'}],error:'未找到这个拼写，选择下面的词条继续查词。',matchPage:0,matchNextCursor:null,partial:false};
  const result=compile('pages/entry/index.wxml')(data),all=nodes(result),copy=text(result);
  assert.ok(copy.includes('可能想查')&&copy.includes('semantci')&&copy.includes('semantic'));assert.ok(!copy.includes('第 1 页'));assert.ok(all.some(node=>node.attr&&node.attr.bindtap==='onWord'));assert.ok(!all.some(node=>node.attr&&node.attr.bindtap==='onRetry'));
});
