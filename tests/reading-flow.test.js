const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));let packets=[],navigation=[],backs=0,channel,storageReads=0;
const app={globalData:{}};global.getApp=()=>app;
global.wx={getStorageSync(key){storageReads++;return memory.has(key)?copy(memory.get(key)):'';},setStorageSync(key,value){memory.set(key,copy(value));},getAppBaseInfo(){return {theme:'light'};},setNavigationBarColor(){},setBackgroundColor(){},setTabBarStyle(){},setNavigationBarTitle(){},showToast(){},showModal(options){options.success({confirm:true});},pageScrollTo(){},nextTick(callback){callback();},navigateBack(){backs++;},navigateTo(options){navigation.push(options.url);const handlers=new Map();channel={on(name,handler){handlers.set(name,handler);},emit(name,value){if(handlers.has(name))handlers.get(name)(value);}};if(options.success)options.success({eventChannel:channel});},switchTab(options){navigation.push(options.url);}};
const store=require('../miniprogram/utils/store'),library=require('../miniprogram/services/library'),dictionary=require('../miniprogram/services/dictionary'),study=require('../miniprogram/services/study');
const originalLookup=dictionary.lookup;
function bind(definition,properties={}){const controller={data:copy(definition.data),properties,setData(value){const bytes=Buffer.byteLength(JSON.stringify(value));assert.ok(bytes<900000,'native data packet');packets.push(bytes);Object.assign(this.data,copy(value));}};for(const [key,value]of Object.entries(definition.methods||definition))if(typeof value==='function')controller[key]=value.bind(controller);return controller;}
function page(name){const file=path.join(__dirname,'../miniprogram/pages',name,'index.js');let definition;global.Page=value=>definition=value;delete require.cache[file];require(file);return bind(definition);}
function picker(properties,handlers={}){const file=path.join(__dirname,'../miniprogram/components/group-picker/index.js');let definition;global.Component=value=>definition=value;delete require.cache[file];require(file);const instance=bind(definition,Object.assign({visible:true,word:'',words:[],meaning:'',theme:'light'},properties));instance.triggerEvent=(name,value)=>{if(handlers[name])handlers[name](value);};instance.refresh();return instance;}
function event(token){return {currentTarget:{dataset:{start:token.start,end:token.end,wordStart:token.wordStart,wordEnd:token.wordEnd}}};}
function options(url){return Object.fromEntries(new URL('https://local.invalid'+url).searchParams);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test.beforeEach(()=>{memory.clear();packets=[];navigation=[];backs=0;app.globalData={};dictionary.lookup=async word=>({kind:'entry',word,brief:'fixture meaning',senses:[]});});
test.after(()=>{dictionary.lookup=originalLookup;});

test('range selection crosses pages, saves an exact quote, renders highlights and jumps from the annotation list',()=>{
 const text=('A café makes learning meaningful. 中文🙂\n').repeat(110),id=library.add('Reading',text),reader=page('reader');reader.onLoad({id});reader.onShow();reader.onMarkMode();const first=reader.data.tokens.find(token=>token.word);reader.onToken(event(first));reader.onNext();const last=reader.data.tokens.find(token=>token.word);reader.onToken(event(last));const end=last.end;assert.equal(reader.data.selectionLength,end-first.start);reader.onSaveSelection();
 const editor=page('annotation');editor.onLoad(options(navigation.at(-1)));assert.equal(editor.data.quote,text.slice(first.start,end));editor.onNote({detail:{value:'跨页批注保留原文。'}});editor.onColor({currentTarget:{dataset:{color:'blue'}}});editor.onSave();assert.equal(backs,1);reader.onShow();assert.ok(reader.data.tokens.some(token=>token.color==='blue'));
 const joined=[];for(let index=0;index<reader.data.total;index++){reader.showPage(index);joined.push(...reader.data.tokens.map(token=>token.text));}assert.equal(joined.join(''),text);reader.onBookmark();assert.equal(library.annotations(id).length,2);
 reader.onAnnotations();const list=page('annotations');list.getOpenerEventChannel=()=>channel;list.onLoad({article:id,from:'reader'});list.onShow();const mark=list.data.rows.find(item=>item.kind==='highlight');list.onJump({currentTarget:{dataset:{start:mark.start,article:id}}});assert.equal(reader.data.page,0);assert.equal(library.get(id).text,text);assert.ok(Math.max(...packets)<900000);reader.onUnload();list.onUnload();
});

test('annotation save failure retains the draft and never claims a stored mark',()=>{
 const id=library.add('Book','hello world'),editor=page('annotation');editor.onLoad({article:id,start:'0',end:'5'});editor.onNote({detail:{value:'keep this draft'}});const original=wx.setStorageSync;wx.setStorageSync=()=>{throw new Error('quota');};try{editor.onSave();}finally{wx.setStorageSync=original;}assert.equal(editor.data.note,'keep this draft');assert.equal(editor.data.saving,false);assert.equal(library.annotations(id).length,0);assert.equal(backs,0);editor.onSave();assert.equal(library.annotations(id)[0].note,'keep this draft');
});

test('group picker preserves an unsaved entry note and supports batch notebook organization',async()=>{
 const book=store.createGroup('Reading');store.saveNote('run','跑','saved');const entry=page('entry');await entry.load('run');entry.onNote({detail:{value:'unsaved draft'}});entry.onGroups();const one=picker({word:'run',meaning:entry.data.groupingMeaning},{save:()=>entry.onGroupSaved(),close:()=>entry.onGroupClose()});one.onChange({detail:{value:[book]}});one.onSave();assert.equal(entry.data.note,'unsaved draft');assert.equal(entry.data.noteStatus,'尚未保存');assert.equal(store.favorite('run').note,'saved');entry.onSaveNote();assert.equal(store.favorite('run').note,'unsaved draft');
 store.saveNote('apple','苹果','another note');const notebook=page('notebook');notebook.onShow();notebook.onToggleSelect();notebook.onSelectPage();notebook.onAssignSelection();assert.equal(notebook.data.groupingWords.length,2);const many=picker({words:notebook.data.groupingWords},{save:()=>notebook.onGroupSaved(),close:()=>notebook.onGroupClose()});many.onChange({detail:{value:[book]}});many.onSave();assert.equal(store.favorites(book).length,2);assert.equal(store.favorite('apple').note,'another note');assert.equal(notebook.data.selecting,false);
 notebook.onToggleSelect();notebook.onSelectPage();notebook.onAssignSelection();notebook.onHide();assert.equal(notebook.data.groupPicker,false);store.toggle('run');notebook.onShow();assert.equal(notebook.data.selectedCount,1);assert.equal(notebook._selected.has('run'),false);
});

test('encoded wordbook links start review and playback with the intended collection',async()=>{
 const book=store.createGroup('Course');store.saveNote('run','跑','keep');store.setGroups('run',[book]);const deck='book:'+book,review=page('review');review.onLoad({deck:encodeURIComponent(deck),mode:'flash'});await tick();assert.equal(review._session.deck,deck);assert.equal(review.data.word,'run');const player=page('player');player.onLoad({deck:encodeURIComponent(deck)});await tick();assert.equal(player.data.word,'run');assert.equal(player.data.total,1);review.onUnload();player.onUnload();
});

test('opening a 500-word batch reads the notebook once rather than once per selected word',()=>{
 const book=store.createGroup('Batch'),words=Array.from({length:500},(_,index)=>'word'+index);store.setGroupsMany(words,[book]);storageReads=0;const component=picker({words});assert.equal(component.data.count,500);assert.deepEqual(component.data.selectedIds,[book]);assert.ok(storageReads<=8,'batch setup should not repeatedly decode the whole notebook');
});
