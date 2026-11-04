// Development-only static projection of official-compiler WXML trees for layout QA.
// This is not a browser edition of the product or a WeChat runtime emulator.
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'), mini = path.join(root, 'miniprogram');
global.window = global;
const compile = new Function('global', fs.readFileSync(path.join(root, 'output/wxml-compiled.js'), 'utf8'))({});
const memory = new Map();
const mockApp={globalData:{}};global.getApp=()=>mockApp;
global.wx = { getStorageSync(key) { return memory.has(key) ? JSON.parse(JSON.stringify(memory.get(key))) : ''; }, setStorageSync(key, value) { memory.set(key, JSON.parse(JSON.stringify(value))); }, getAppBaseInfo() { return { theme: 'light' }; }, setNavigationBarColor() {}, setBackgroundColor() {}, setTabBarStyle() {}, setNavigationBarTitle() {}, showToast() {}, pageScrollTo() {}, request(options) { const url = new URL(options.url); Object.entries(options.data || {}).forEach(([k, v]) => url.searchParams.set(k, v)); fetch(url).then(async response => options.success({ statusCode: response.status, data: await response.json() })).catch(error => options.fail(error)); } };
function page(name) { let definition; global.Page = value => { definition = value; }; delete require.cache[path.join(mini,'pages',name,'index.js')];require(path.join(mini, 'pages', name, 'index.js')); const instance = { data: JSON.parse(JSON.stringify(definition.data)), setData(value) { Object.assign(this.data, value); } }; Object.entries(definition).forEach(([key, value]) => { if (typeof value === 'function') instance[key] = value.bind(instance); }); return instance; }
function escape(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function rich(node) { if (node.type === 'text') return escape(node.text); const tag = node.name || 'span'; return '<' + tag + ' style="' + escape((node.attrs || {}).style || '') + '">' + (node.children || []).map(rich).join('') + '</' + tag + '>'; }
function html(node) {
  if (typeof node === 'string') return escape(node);
  const name = node.tag.replace(/^wx-/, ''), attr = node.attr || {};
  if(name==='group-picker'){
    const store=require('../miniprogram/utils/store'),words=Array.isArray(attr.words)&&attr.words.length?attr.words:[attr.word].filter(Boolean),favorites=new Map(store.favorites().map(item=>[store.key(item.word),item]));
    const members=words.map(word=>(favorites.get(store.key(word))||{}).groups||[]),selected=(members[0]||[]).filter(id=>members.every(ids=>ids.includes(id)));
    return html(compile('components/group-picker/index.wxml')(Object.assign({},attr,{count:words.length,busy:false,choices:store.groups().map(item=>Object.assign({},item,{checked:selected.includes(item.id)}))})));
  }
  if (name === 'rich-text') return '<div class="' + escape(attr.class || '') + '">' + (attr.nodes || []).map(rich).join('') + '</div>';
  const tag = ({ page: 'main', view: 'div', text: 'span', image: 'img', switch: 'input', checkbox:'input',picker:'div','checkbox-group':'div', 'scroll-view':'div' })[name] || name;
  let attributes = '';
  for (const [key, value] of Object.entries(attr)) {
    if (['class', 'style', 'placeholder', 'maxlength', 'value', 'id'].includes(key)) attributes += ' ' + key + '="' + escape(value) + '"';
    if (key === 'disabled' && value) attributes += ' disabled';
  }
  if (name === 'switch'||name==='checkbox') attributes += ' type="checkbox"' + (attr.checked ? ' checked' : '');
  if (name === 'image') { const image = path.join(mini, String(attr.src).replace(/^\//, '')); attributes += ' src="data:image/png;base64,' + fs.readFileSync(image).toString('base64') + '"'; }
  if(name==='scroll-view'&&(attr['scroll-y']||attr.scrollY))attributes+=' style="overflow-y:auto"';
  return '<' + tag + attributes + '>' + (name==='textarea'&&attr.value!==undefined?escape(attr.value):(node.children || []).map(html).join('')) + '</' + tag + '>';
}
function css(text, width) { return text.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, number) => Number(number) * width / 750 + 'px').replace(/(?<![.\w-])page(?=\s*\{)/g, 'body').replace(/\bview(?=[,{>\s])/g, 'div').replace(/\btext(?=[,{>\s])/g, 'span').replace(/(?<![.\w-])image(?=[,{>\s])/g,'img'); }
function write(name, controller, width = 390, fileName = name) {
  const tree = compile('pages/' + name + '/index.wxml')(controller.data);
  const style = fs.readFileSync(path.join(mini, 'app.wxss'), 'utf8') + fs.readFileSync(path.join(mini, 'pages', name, 'index.wxss'), 'utf8')+fs.readFileSync(path.join(mini,'components/group-picker/index.wxss'),'utf8')+fs.readFileSync(path.join(mini,'custom-tab-bar/index.wxss'),'utf8');
  const tabList=JSON.parse(fs.readFileSync(path.join(mini,'app.json'),'utf8')).tabBar.list;
  const selected=tabList.findIndex(tab=>tab.pagePath==='pages/'+name+'/index');
  const tabs=selected>=0?html(compile('custom-tab-bar/index.wxml')({items:require('../miniprogram/data/tabs'),selected,theme:controller.data.theme,keyboard:false})):'';
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
  const book=store.createGroup('Reading / 阅读');store.createGroup('考试 / Course');store.createGroup('X'.repeat(40));store.setGroupsMany(['run','apple'],[book]);
  const annotation=library.mark(article,0,35,'在原文语境中记下自己的理解。','green');library.bookmark(article,50,'本周阅读');
  study.review('apple','good',{event:'layout-fixture',seconds:12});
  const names=JSON.parse(fs.readFileSync(path.join(mini,'app.json'),'utf8')).pages.map(page=>page.split('/')[1]);
  const manifest=[];
  for(const theme of ['light','dark']){
    store.saveSettings({theme,fontSize:theme==='dark'?20:16});
    for(const name of names){
      const controller=page(name);
      const options={q:'run',id:name==='reader'?article:name==='annotation'?annotation:'starter',article,start:0,end:35,mode:name==='daily'?'listening':'flash',deck:'favorites'};
      if(controller.onLoad)await controller.onLoad(options);
      if(controller.onShow)await controller.onShow();
      if(name==='entry')await controller.load('run');
      await new Promise(resolve=>setTimeout(resolve,150));
      for(const width of [320,390,768,1024]){
        const fileName=name+'-'+theme+'-'+width;
        write(name,controller,width,fileName);
        manifest.push({name,theme,width,file:fileName+'.html'});
      }
      if(name==='capture'||name==='wordlist'){
        const variant=name==='capture'?'image':'file';
        if(name==='capture')controller.setData({imagePath:'/assets/search.png',message:'图片预览布局示例'});
        else controller.setData({creating:true,fileName:'A'.repeat(180)+'.csv',fileCharacters:500000});
        for(const width of [320,390,768,1024]){
          const fileName=name+'-'+variant+'-'+theme+'-'+width;
          write(name,controller,width,fileName);manifest.push({name:name+'-'+variant,theme,width,file:fileName+'.html'});
        }
      }
      if(name==='dictionaries'){
        controller.setData({selectedFiles:[{key:'index',name:'牛津十版-微信离线词库-索引.zip',size:'18.2 MiB'},{key:'data1',name:'牛津十版-微信离线词库-数据1.zip',size:'48.0 MiB'},{key:'data2',name:'A'.repeat(180)+'.zip',size:'48.0 MiB'}]});
        for(const width of [320,390,768,1024]){
          const fileName=name+'-volumes-'+theme+'-'+width;
          write(name,controller,width,fileName);manifest.push({name:name+'-volumes',theme,width,file:fileName+'.html'});
        }
      }
      if(name==='entry'){
        const original=JSON.parse(JSON.stringify(controller.data)),originalEntry=controller._entry;
        for(const variant of ['matches','matches-last','matches-error','related','supplement-loading','supplement-error','supplement-wordnet','contents','focus','focus-missing']){
          controller._entry=originalEntry;controller._focus=null;controller.setData(original);
          if(['contents','focus','focus-missing'].includes(variant)){
            const codec=require('../miniprogram/vendor/codec');
            const oxford=codec.renderOxford([{word:'layout',html:'<div class="entry" id="layout-entry"><span class="headword">layout</span><span class="pos">noun</span><li class="sense" sensenum="2" id="layout-sense"><span class="def">An original layout fixture.</span><defT><chn>包含中文与 English 的原创布局示例，用于检查长目录及定位说明在窄屏上的换行。</chn></defT></li><div class="unbox" id="layout-box"><div class="box_title">Extra Examples 补充例句</div><p>Read one useful example every day. 每天读一个有用的例句。</p></div><a href="#layout-box">补充例句</a></div>'}]);
            controller._entry=Object.assign({},originalEntry,{oxford});controller.setData({source:'oxford',entry:Object.assign({},original.entry,{hasContents:true}),contentsOpen:variant==='contents'});controller.contentsPage(0);controller.contentPage(0);
            if(variant==='focus')controller.focusTarget(oxford.contents.find(row=>row.kind==='义项'),'2. 包含中文与 English 的原创布局示例，用于检查长定位说明的完整换行。');
            if(variant==='focus-missing')controller.focusAnchor('absent-source-target');
          }else if(variant==='related'){
            controller._entry.related=Array.from({length:75},(_,index)=>'original related expression '+index);controller.relatedPage(3);
          }else if(variant.startsWith('supplement-')){
            controller.setData({supplementLoading:variant==='supplement-loading',supplementError:variant==='supplement-error'?'未连接到补充词库，牛津正文仍可离线查阅，请稍后重试。':'',supplementState:variant==='supplement-wordnet'?'cache':'',supplementNote:variant==='supplement-wordnet'?'补充词典已缓存，可离线查阅':'简释 · 英语分义 · 用法说明'});
            if(variant==='supplement-wordnet'){controller.setData({source:'wordnet'});controller.contentPage(0);}
          }else{
            controller.setData({entry:null,loading:false,error:'',matchQuery:'中文检索',matchPage:variant==='matches-last'?3:1,matchNextCursor:variant==='matches-last'?null:80,matchLoading:false,matchError:variant==='matches-error'?'读取暂时失败，请重试翻页。':'',matches:Array.from({length:variant==='matches-last'?4:40},(_,index)=>({word:'original expression '+index,meaning:'原创排版示例，包含中文释义和 English explanation，以检查长内容换行。'}))});
          }
          for(const width of [320,390,768,1024]){
            const fileName=name+'-'+variant+'-'+theme+'-'+width;
            write(name,controller,width,fileName);manifest.push({name:name+'-'+variant,theme,width,file:fileName+'.html'});
          }
        }
      }
      if(name==='notebook'||name==='reader'||name==='annotation'){
        const variants=name==='notebook'?['selecting','group-picker']:name==='reader'?['selection','popup']:['new'];
        for(const variant of variants){
          if(variant==='selecting'){controller.onToggleSelect();controller.onSelectPage();}
          if(variant==='group-picker'){controller.setData({selecting:false,groupPicker:true,groupingWord:'run',groupingWords:[]});}
          if(variant==='selection'){controller._selection={start:0,end:35};controller.setData({markMode:true});controller.renderTokens();}
          if(variant==='popup'){controller.setData({markMode:false});await controller.openWord('Learning',0,8,{start:0,end:8});}
          if(variant==='new')controller.setData({id:'',note:'',kind:'highlight'});
          for(const width of [320,390,768,1024]){
            const fileName=name+'-'+variant+'-'+theme+'-'+width;
            write(name,controller,width,fileName);manifest.push({name:name+'-'+variant,theme,width,file:fileName+'.html'});
          }
        }
      }
      if(controller.onUnload)controller.onUnload();
    }
  }
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(output,'index.html'),'<!doctype html><meta charset="utf-8"><h1>WXML 编译树投影布局检查</h1><p>非微信运行截图。仅用于检查布局、换行和内容可达性。</p><div id="results"></div>'+manifest.map(item=>'<p><a href="'+item.file+'">'+item.file+'</a></p>').join(''));
  console.log('Generated '+manifest.length+' local WXML projection fixtures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
