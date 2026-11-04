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
