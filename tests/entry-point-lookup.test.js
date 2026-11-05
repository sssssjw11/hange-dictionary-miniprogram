const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));let navigated='';
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarColor(){},setBackgroundColor(){},setNavigationBarTitle(){},pageScrollTo(){},navigateTo(options){navigated=options.url;}};
const selection=require('../miniprogram/utils/dictionary-selection'),dictionary=require('../miniprogram/services/dictionary'),store=require('../miniprogram/utils/store');
function page(){let definition;global.Page=value=>{definition=value;};const file=path.resolve(__dirname,'../miniprogram/pages/entry/index.js');delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value,callback){Object.assign(this.data,copy(value));if(callback)callback();}};for(const [key,value]of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
function text(value){return {type:'text',text:value};}function node(name,children,style=''){return {type:'node',name,attrs:{style},children};}
test.beforeEach(()=>{memory.clear();navigated='';});

test('selection keeps every character through rich blocks, page boundaries and supplementary Han tokens',()=>{
 const blocks=[{nodes:[node('div',[text('Look '),node('b',[text('after')]),text(' 𠀀猫🙂.'),node('br',[]),node('span',[text('中文释义')],'display:block;')])]},{nodes:[node('p',[text('Next part. ')])]}];
 const value=selection.fromBlocks(blocks);assert.equal(value.replace(/\n/g,''),'Look after 𠀀猫🙂.中文释义Next part. ');const long=value+'a '.repeat(1500),pages=selection.ranges(long);assert.ok(pages.length>1);const tokens=pages.flatMap(part=>selection.tokens(part,null));assert.equal(tokens.map(item=>item.text).join(''),long);assert.ok(tokens.some(item=>item.word==='after'));assert.ok(tokens.some(item=>item.word==='𠀀'&&item.end-item.start===2));assert.ok(tokens.some(item=>item.word==='猫'));assert.equal(selection.fromExamples([{en:'A sentence.',zh:'一个句子。'},{en:'More.',zh:''}]),'A sentence.\n一个句子。\n\nMore.');
});

test('inline lookup discards older results, permits favorites and opens the selected full entry',async()=>{
 const original=dictionary.lookup,pending={};dictionary.lookup=word=>new Promise(resolve=>{pending[word]=resolve;});const controller=page();controller._entry={kind:'entry',word:'source',oxford:{blocks:[]}};controller.setData({source:'oxford',oxfordBlocks:[{nodes:[node('div',[text('First second 中文。')])]}]});
 try{controller.onPickText();assert.equal(controller.data.pickOpen,true);for(const word of ['First','second']){const token=controller.data.pickTokens.find(item=>item.word===word);controller.onPickToken({currentTarget:{dataset:token}});}pending.second({kind:'entry',word:'second',brief:'第二'});await tick();pending.First({kind:'entry',word:'First',brief:'第一'});await tick();assert.equal(controller.data.pickWord,'second');assert.equal(controller.data.pickMeaning,'第二');controller.onPickFavorite();assert.ok(store.favorite('second'));controller.onPickDetail();assert.equal(navigated,'/pages/entry/index?q=second');controller.closePickText();assert.equal(controller.data.pickOpen,false);assert.deepEqual(controller.data.pickTokens,[]);}
 finally{controller.onUnload();dictionary.lookup=original;}
});

test('a selection across segments is queried as a phrase and closing cancels an in-flight response',async()=>{
 const original=dictionary.lookup;let requested='',finish;dictionary.lookup=word=>{requested=word;return new Promise(resolve=>{finish=resolve;});};const controller=page();controller._entry={kind:'entry',word:'source'};controller.setData({source:'examples',examples:[{en:'x '.repeat(594)+'fresh step today.',zh:'今天迈出新的一步。'}]});
 try{controller.onPickText();assert.ok(controller.data.pickPages>1);controller.onPickMode();let token=controller.data.pickTokens.find(item=>item.word==='fresh');controller.onPickToken({currentTarget:{dataset:token}});controller.onPickNext();token=controller.data.pickTokens.find(item=>item.word==='today');controller.onPickToken({currentTarget:{dataset:token}});assert.equal(controller.data.pickSelection,'fresh step today');assert.equal(controller.data.pickSelectionLength,16);controller.onPickSelected();assert.equal(requested,'fresh step today');assert.equal(controller.data.pickLooking,true);controller.closePickText();const snapshot=copy(controller.data);finish({kind:'entry',word:requested,brief:'测试'});await tick();assert.deepEqual(controller.data,snapshot);}
 finally{controller.onUnload();dictionary.lookup=original;}
});

test('hiding the entry invalidates a pending lookup without replacing the paused result',async()=>{
 const original=dictionary.lookup;let finish;dictionary.lookup=()=>new Promise(resolve=>{finish=resolve;});const controller=page();controller._entry={kind:'entry',word:'source'};controller.setData({source:'examples',examples:[{en:'Read a sentence.',zh:'读一句话。'}]});
 try{controller.onPickText();const pending=controller.lookupPicked('Read');controller.onHide();assert.equal(controller.data.pickLooking,false);assert.match(controller.data.pickMeaning,/已暂停/);finish({kind:'entry',word:'Read',brief:'迟到的结果'});await pending;assert.match(controller.data.pickMeaning,/已暂停/);assert.equal(controller.data.pickCanFavorite,false);}
 finally{controller.onUnload();dictionary.lookup=original;}
});

test('returning to the parent entry preserves an unsaved note, including an intentionally emptied draft',()=>{
 store.saveNote('source','释义','原有笔记');const controller=page();controller._entry={kind:'entry',word:'source'};
 try{for(const draft of ['新的草稿','']){controller.setData({note:draft,noteStatus:'尚未保存'});controller.onShow();assert.equal(controller.data.note,draft);assert.equal(controller.data.noteStatus,'尚未保存');}assert.equal(store.favorite('source').note,'原有笔记');}
 finally{controller.onUnload();}
});
