// Development-only static projection of official-compiler WXML trees for layout QA.
// This is not a browser edition of the product or a WeChat runtime emulator.
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'), mini = path.join(root, 'miniprogram');
global.window = global;
const compile = new Function('global', fs.readFileSync(path.join(root, 'output/wxml-compiled.js'), 'utf8'))({});
const memory = new Map();
global.wx = { getStorageSync(key) { return memory.has(key) ? JSON.parse(JSON.stringify(memory.get(key))) : ''; }, setStorageSync(key, value) { memory.set(key, JSON.parse(JSON.stringify(value))); }, getAppBaseInfo() { return { theme: 'light' }; }, setNavigationBarColor() {}, setBackgroundColor() {}, setTabBarStyle() {}, setNavigationBarTitle() {}, showToast() {}, request(options) { const url = new URL(options.url); Object.entries(options.data || {}).forEach(([k, v]) => url.searchParams.set(k, v)); fetch(url).then(async response => options.success({ statusCode: response.status, data: await response.json() })).catch(error => options.fail(error)); } };
function page(name) { let definition; global.Page = value => { definition = value; }; require(path.join(mini, 'pages', name, 'index.js')); const instance = { data: JSON.parse(JSON.stringify(definition.data)), setData(value) { Object.assign(this.data, value); } }; Object.entries(definition).forEach(([key, value]) => { if (typeof value === 'function') instance[key] = value.bind(instance); }); return instance; }
function escape(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function rich(node) { if (node.type === 'text') return escape(node.text); const tag = node.name || 'span'; return '<' + tag + ' style="' + escape((node.attrs || {}).style || '') + '">' + (node.children || []).map(rich).join('') + '</' + tag + '>'; }
function html(node) {
  if (typeof node === 'string') return escape(node);
  const name = node.tag.replace(/^wx-/, ''), attr = node.attr || {};
  if (name === 'rich-text') return '<div class="' + escape(attr.class || '') + '">' + (attr.nodes || []).map(rich).join('') + '</div>';
  const tag = ({ page: 'main', view: 'div', text: 'span', image: 'img', switch: 'input' })[name] || name;
  let attributes = '';
  for (const [key, value] of Object.entries(attr)) {
    if (['class', 'style', 'placeholder', 'maxlength', 'value', 'id'].includes(key)) attributes += ' ' + key + '="' + escape(value) + '"';
    if (key === 'disabled' && value) attributes += ' disabled';
  }
  if (name === 'switch') attributes += ' type="checkbox"' + (attr.checked ? ' checked' : '');
  if (name === 'image') { const image = path.join(mini, String(attr.src).replace(/^\//, '')); attributes += ' src="data:image/png;base64,' + fs.readFileSync(image).toString('base64') + '"'; }
  return '<' + tag + attributes + '>' + (node.children || []).map(html).join('') + '</' + tag + '>';
}
function css(text, width) { return text.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, number) => Number(number) * width / 750 + 'px').replace(/(?<![.\w-])page(?=\s*\{)/g, 'body').replace(/\bview(?=[,{>\s])/g, 'div').replace(/\btext(?=[,{>\s])/g, 'span'); }
function write(name, controller, width = 390, fileName = name) {
  const tree = compile('pages/' + name + '/index.wxml')(controller.data);
  const style = fs.readFileSync(path.join(mini, 'app.wxss'), 'utf8') + fs.readFileSync(path.join(mini, 'pages', name, 'index.wxss'), 'utf8');
  const tabs = ['search', 'notebook', 'history'].includes(name) ? '<footer><span>⌕ 查词</span><span>♧ 生词本</span><span>◷ 记录</span></footer>' : '';
  const document = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>涵词典 · WXML 投影预览</title><link rel="icon" href="data:,"><style>body{margin:0}input,textarea{font:inherit}input{border:0;background:none;color:inherit;min-width:0}button{cursor:pointer}img{object-fit:contain}textarea{display:block}main{display:block}footer{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-around;background:#fff;border-top:1px solid #e0eaf1;padding:12px;font-size:12px;color:#267fbb}.preview-label{background:#eaf4fb;color:#527186;font-size:10px;text-align:center;padding:4px}'+css(style,width)+'</style><div class="preview-label">WXML 编译树投影 · 非微信客户端运行截图</div>'+html(tree)+tabs;
  fs.writeFileSync(path.join(root, 'output/preview', fileName + '.html'), document);
}
(async () => {
  fs.mkdirSync(path.join(root, 'output/preview'), { recursive: true });
  const search = page('search'); search.onShow(); await new Promise(resolve => setTimeout(resolve, 100)); write('search', search);
  const entry = page('entry'); await entry.load('predicative'); entry.onShow(); write('entry', entry);
  entry.onNote({ detail: { value: '表语形容词在系动词后，说明主语的性质或状态。' } }); entry.onSaveNote();
  const notebook = page('notebook'); notebook.onShow(); write('notebook', notebook);
  const store = require('../miniprogram/utils/store'); store.saveSettings({ theme: 'dark', fontSize: 18 }); await entry.load('run'); entry.onShow(); write('entry', entry, 360, 'entry-dark');
  console.log('Generated local-only WXML projection pages in output/preview.');
})().catch(error => { console.error(error); process.exitCode = 1; });
