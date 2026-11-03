// Development-only static projection of official-compiler WXML trees for layout QA.
// This is not a browser edition of the product or a WeChat runtime emulator.
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'), mini = path.join(root, 'miniprogram');
global.window = global;
const compile = new Function('global', fs.readFileSync(path.join(root, 'output/wxml-compiled.js'), 'utf8'))({});
const memory = new Map();
global.getApp=()=>({globalData:{}});
global.wx = { getStorageSync(key) { return memory.has(key) ? JSON.parse(JSON.stringify(memory.get(key))) : ''; }, setStorageSync(key, value) { memory.set(key, JSON.parse(JSON.stringify(value))); }, getAppBaseInfo() { return { theme: 'light' }; }, setNavigationBarColor() {}, setBackgroundColor() {}, setTabBarStyle() {}, setNavigationBarTitle() {}, showToast() {}, pageScrollTo() {}, request(options) { const url = new URL(options.url); Object.entries(options.data || {}).forEach(([k, v]) => url.searchParams.set(k, v)); fetch(url).then(async response => options.success({ statusCode: response.status, data: await response.json() })).catch(error => options.fail(error)); } };
function page(name) { let definition; global.Page = value => { definition = value; }; delete require.cache[path.join(mini,'pages',name,'index.js')];require(path.join(mini, 'pages', name, 'index.js')); const instance = { data: JSON.parse(JSON.stringify(definition.data)), setData(value) { Object.assign(this.data, value); } }; Object.entries(definition).forEach(([key, value]) => { if (typeof value === 'function') instance[key] = value.bind(instance); }); return instance; }
function escape(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function rich(node) { if (node.type === 'text') return escape(node.text); const tag = node.name || 'span'; return '<' + tag + ' style="' + escape((node.attrs || {}).style || '') + '">' + (node.children || []).map(rich).join('') + '</' + tag + '>'; }
function html(node) {
  if (typeof node === 'string') return escape(node);
  const name = node.tag.replace(/^wx-/, ''), attr = node.attr || {};
  if (name === 'rich-text') return '<div class="' + escape(attr.class || '') + '">' + (attr.nodes || []).map(rich).join('') + '</div>';
  const tag = ({ page: 'main', view: 'div', text: 'span', image: 'img', switch: 'input', 'scroll-view':'div' })[name] || name;
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
  const tabList=JSON.parse(fs.readFileSync(path.join(mini,'app.json'),'utf8')).tabBar.list;
  const tabs=tabList.some(tab=>tab.pagePath==='pages/'+name+'/index')?'<footer>'+tabList.map(tab=>'<span>'+escape(tab.text)+'</span>').join('')+'</footer>':'';
  const document = '<!doctype html><html data-theme="'+controller.data.theme+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>涵词典 · WXML 投影预览</title><link rel="icon" href="data:,"><style>body{margin:0}*{box-sizing:border-box}input,textarea{max-width:100%}input,textarea{font:inherit}input{border:0;background:none;color:inherit;min-width:0}button{cursor:pointer}img{object-fit:contain}textarea{display:block}main{display:block}footer{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-around;background:#fff;border-top:1px solid #e0eaf1;padding:12px;font-size:12px;color:#267fbb}.preview-label{background:#eaf4fb;color:#527186;font-size:10px;text-align:center;padding:4px}'+css(style,width)+'</style><div class="preview-label">WXML 编译树投影 · 非微信客户端运行截图</div>'+html(tree)+tabs+'</html>';
  fs.writeFileSync(path.join(root, 'output/preview', fileName + '.html'), document);
}
(async () => {
  const output=path.join(root,'output/preview');fs.mkdirSync(output,{recursive:true});
  const store=require('../miniprogram/utils/store'),study=require('../miniprogram/services/study'),library=require('../miniprogram/services/library'),sentences=require('../miniprogram/services/sentences');
  store.saveSettings({online:true});
  for(const word of ['run','apple','subordinate','predicative'])store.saveNote(word,'学习释义','在语境中理解和使用这个词。');
  const article=library.add('A small step every day',('Learning a language takes practice. Read a little, ask good questions, and keep useful examples. 中文阅读也可以保留。\n\n').repeat(25));
  sentences.save('A small step every day makes a difference.','每天的一小步会带来变化。','原创布局示例','留意搭配 make a difference。');
  study.review('apple','good',{event:'layout-fixture',seconds:12});
  const names=JSON.parse(fs.readFileSync(path.join(mini,'app.json'),'utf8')).pages.map(page=>page.split('/')[1]);
  const manifest=[];
  for(const theme of ['light','dark']){
    store.saveSettings({theme,fontSize:theme==='dark'?20:16});
    for(const name of names){
      const controller=page(name);
      const options={q:'run',id:name==='reader'?article:'starter',mode:name==='daily'?'listening':'flash',deck:'favorites'};
      if(controller.onLoad)await controller.onLoad(options);
      if(controller.onShow)await controller.onShow();
      if(name==='entry')await controller.load('run');
      await new Promise(resolve=>setTimeout(resolve,150));
      for(const width of [320,390,768,1024]){
        const fileName=name+'-'+theme+'-'+width;
        write(name,controller,width,fileName);
        manifest.push({name,theme,width,file:fileName+'.html'});
      }
      if(controller.onUnload)controller.onUnload();
    }
  }
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(output,'index.html'),'<!doctype html><meta charset="utf-8"><h1>WXML 编译树投影布局检查</h1><p>非微信运行截图。仅用于检查布局、换行和内容可达性。</p><div id="results"></div>'+manifest.map(item=>'<p><a href="'+item.file+'">'+item.file+'</a></p>').join(''));
  console.log('Generated '+manifest.length+' local WXML projection fixtures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
