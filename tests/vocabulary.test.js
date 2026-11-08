const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));let fail=false,packets=[],navigated='',redirected='',backs=0,scrolls=[],channel=null;
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync(key,value){if(fail)throw new Error('quota');memory.set(key,copy(value));},showToast(){},setNavigationBarColor(){},setBackgroundColor(){},setNavigationBarTitle(){},pageScrollTo(value){scrolls.push(value);},nextTick:fn=>fn(),navigateTo(value){navigated=value.url;if(value.success)value.success({eventChannel:channel});},redirectTo(value){redirected=value.url;},navigateBack(){backs++;}};
const vocabulary=require('../miniprogram/services/vocabulary'),dictionary=require('../miniprogram/services/dictionary'),library=require('../miniprogram/services/library'),study=require('../miniprogram/services/study'),store=require('../miniprogram/utils/store'),records=require('../miniprogram/utils/records'),backup=require('../miniprogram/services/backup');
const event=(name,value)=>({currentTarget:{dataset:{[name]:value}}});
function page(name='vocabulary',opener=null){let definition;const file=path.resolve(__dirname,'../miniprogram/pages/'+name+'/index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value){packets.push(value);Object.assign(this.data,copy(value));}};if(opener)result.getOpenerEventChannel=()=>opener;for(const [key,value]of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
function ready(text){const controller=page();controller.onLoad();controller.onShow();controller.applySource(text,'Fixture');return controller;}
function alphabet(index){let value='';do{value=String.fromCharCode(97+index%26)+value;index=Math.floor(index/26)-1;}while(index>=0);return 'term'+value;}
function events(){const handlers=new Map();return {on(name,fn){handlers.set(name,fn);},emit(name,value){const handler=handlers.get(name);if(handler)handler(value);}};}
test.beforeEach(()=>{memory.clear();fail=false;packets=[];navigated='';redirected='';backs=0;scrolls=[];channel=null;});

test('candidate extraction preserves canonical word forms, first source positions and a full 200000-character input',()=>{
 const source='😀 CAFÉ cafe\u0301 well-being O’Reilly O\'Reilly 中文 hello HELLO '+ 'x'.repeat(129),result=vocabulary.extract(source),byWord=new Map(result.rows.map(row=>[row.word,row]));
 assert.equal(result.rows.length,4);assert.equal(result.occurrences,7);assert.equal(result.skipped,1);assert.equal(byWord.get('café').count,2);assert.equal(byWord.get("o'reilly").count,2);assert.equal(byWord.get('well-being').count,1);assert.equal(source.slice(byWord.get('café').start,byWord.get('café').end),'CAFÉ');const context=vocabulary.context(source,byWord.get('café'));assert.equal(context.hit,'CAFÉ');assert.ok(context.before.includes('😀'));assert.equal(library.pages(source).join(''),source);
 const dense=vocabulary.extract('word '.repeat(40000));assert.equal(dense.occurrences,40000);assert.equal(dense.rows.length,1);assert.equal(dense.rows[0].count,40000);assert.throws(()=>vocabulary.extract('x'.repeat(200001)),/200000/);assert.throws(()=>vocabulary.extract(' '),/200000/);
});

test('meaning resolution is limited to three requests, keeps missing results explicit and stops scheduling after cancellation',async()=>{
 const lookup=dictionary.lookup;let live=0,maximum=0,calls=0;
 dictionary.lookup=async word=>{calls++;live++;maximum=Math.max(maximum,live);await tick();live--;if(word==='failed')throw new Error('service failed');return word==='missing'?{kind:'matches',matches:[{word:'suggestion'}]}:{kind:'entry',word:word==='one'?'base':word,brief:'🙂'.repeat(300)};};
 try{const result=await vocabulary.resolve(['one','two','missing','failed','five']);assert.equal(result.rows.length,5);assert.equal(maximum,3);assert.equal(result.rows.find(row=>row.word==='one').kind,'entry');assert.ok(!result.rows.some(row=>row.word==='base'));assert.equal(result.rows.find(row=>row.word==='missing').kind,'missing');assert.equal(result.rows.find(row=>row.word==='failed').kind,'error');assert.ok(result.rows.filter(row=>row.kind==='entry').every(row=>row.meaning.length<=500&&!/[\uD800-\uDBFF]$/.test(row.meaning)));
  let active=true;calls=0;const cancelled=await vocabulary.resolve(['one','two','three','four','five'],{active:()=>active,onResult(){active=false;}});assert.equal(cancelled.cancelled,true);assert.ok(calls<=3);assert.equal(cancelled.rows.length,1);await assert.rejects(vocabulary.resolve(['_']),/有效/);await assert.rejects(vocabulary.resolve(Array(501).fill('word')),/500/);
 }finally{dictionary.lookup=lookup;}
});

test('pagination bounds native packets, selections span pages up to 500, and filters clear hidden selections',()=>{
 const words=Array.from({length:650},(_,index)=>alphabet(index));store.saveNote(words[0],'saved','note');study.known(words[1],true);const controller=ready(words.join(' '));
 try{assert.equal(controller.data.uniqueTotal,650);assert.equal(controller.data.total,648);assert.equal(controller.data.rows.length,25);for(let index=0;index<20;index++){controller.refresh(index);controller.onSelectPage();}assert.equal(controller.data.selectedCount,500);controller.onNext();controller.onSelectPage();assert.equal(controller.data.selectedCount,500);
  controller.onToActions();assert.equal(scrolls.at(-1).selector,'#vocabulary-actions');controller.onFilter(event('filter','all'));assert.equal(controller.data.selectedCount,0);assert.equal(controller.data.total,649);controller.onMastered({detail:{value:false}});assert.equal(controller.data.total,650);controller.onSelectPage();controller.onQuery({detail:{value:'no-match-here'}});assert.equal(controller.data.selectedCount,0);assert.equal(controller.data.total,0);assert.ok(packets.every(value=>!value.rows||value.rows.length<=25));assert.ok(packets.every(value=>Buffer.byteLength(JSON.stringify(value))<100000));assert.equal(study.stats().today.attempts,0);
 }finally{controller.onUnload();}
});

test('adding only matched entries is atomic and preserves existing notes, groups, meanings and review grades',async()=>{
 const lookup=dictionary.lookup,group=store.createGroup('Keep');store.saveNote('apple','own meaning','own note');store.setGroups('apple',[group]);study.review('run','good',{event:'before'});const beforeStats=copy(study.stats()),controller=ready('Apple run fresh missing failed');controller.onFilter(event('filter','all'));controller.onSelectPage();
 dictionary.lookup=async word=>{if(word==='failed')throw new Error('read failed');return word==='missing'?{kind:'matches',matches:[{word:'different'}]}:{kind:'entry',word,brief:'actual meaning '+word};};
 try{await controller.onResolve();assert.equal(controller.data.readyCount,2);assert.equal(controller.data.rows.find(row=>row.word==='missing').status,'未匹配');const before=store.snapshot();fail=true;controller.onAdd();fail=false;assert.deepEqual(store.snapshot(),before);assert.equal(controller.data.selectedCount,5);controller.onAdd();assert.equal(store.favorite('fresh').meaning,'actual meaning fresh');assert.equal(store.favorite('apple').meaning,'own meaning');assert.equal(store.favorite('apple').note,'own note');assert.deepEqual(store.favorite('apple').groups,[group]);assert.equal(store.favorite('missing'),null);assert.equal(store.favorite('failed'),null);assert.equal(store.favorite('different'),null);assert.equal(controller.data.selectedCount,3);assert.deepEqual(study.stats(),beforeStats);
 }finally{fail=false;controller.onUnload();dictionary.lookup=lookup;}
});

test('selected original forms create a restorable learning deck without fake definitions or duplicate decks',()=>{
 const controller=ready('Run unknown');controller.onSelectPage();controller.onName({detail:{value:'From reading'}});
 try{controller.onCreateDeck();const id=controller._createdDeck;assert.deepEqual(study.words(id),['run','unknown']);assert.ok(navigated.includes(encodeURIComponent(id)));controller.onCreateDeck();assert.equal(study.decks().filter(row=>!row.system).length,1);assert.equal(store.favorites().length,0);assert.equal(study.stats().today.attempts,0);study.deleteDeck(id);controller.onShow();assert.equal(controller.data.createdDeck,'');controller.onCreateDeck();const replacement=controller._createdDeck;assert.notEqual(replacement,id);const source=backup.exportAll();memory.clear();backup.importAll(source);assert.deepEqual(study.words(replacement),['run','unknown']);assert.equal(study.stats().today.attempts,0);
 }finally{controller.onUnload();}
});

test('leaving during selected-word resolution never saves partial favorites or updates a hidden page',async()=>{
 const lookup=dictionary.lookup,waiting=[],controller=ready('one two three four');controller.onSelectPage();dictionary.lookup=word=>new Promise(resolve=>waiting.push(()=>resolve({kind:'entry',word,brief:'meaning'})));
 try{const pending=controller.onResolve();assert.equal(waiting.length,3);controller.onHide();const count=packets.length;for(const finish of waiting)finish();await pending;assert.equal(packets.length,count);assert.equal(controller._resolved.size,0);assert.equal(store.favorites().length,0);assert.equal(study.stats().today.attempts,0);controller.onShow();assert.equal(controller.data.busy,false);assert.equal(controller.data.selectedCount,4);}
 finally{controller.onUnload();dictionary.lookup=lookup;}
});

test('reader and capture handoffs preserve source text, return to exact original positions and reject stale article offsets',()=>{
 channel=events();const source='文'.repeat(4000)+' CAFÉ end.',id=library.add('Reading',source);library.mark(id,4001,4005,'keep annotation');const reader=page('reader');reader.onLoad({id});reader.onVocabulary();assert.ok(navigated.includes('returnToReader=1'));reader.onHide();const controller=page('vocabulary',channel);controller.onLoad({article:id,returnToReader:'1'});controller.onShow();
 try{scrolls=[];controller.onOriginal(event('word','café'));assert.equal(backs,1);assert.equal(reader.data.page,0);assert.ok(!scrolls.some(value=>value.selector));reader.onShow();assert.ok(reader.data.page>0);assert.ok(scrolls.some(value=>value.selector==='#reader-token-4001'));assert.equal(library.get(id).text,source);assert.equal(library.annotations(id)[0].note,'keep annotation');
  controller.onSelectPage();const data=records.read('library',{});data.articles[0].text='changed body';data.articles[0].annotations=[];records.write('library',data);controller.onCreateDeck();assert.equal(study.decks().filter(row=>!row.system).length,0);controller.onOriginal(event('word','café'));assert.equal(backs,1);assert.equal(redirected,'');assert.ok(controller._byWord.has('changed'));assert.match(controller.data.error,/正文已变化/);library.remove(id);controller.onShow();assert.equal(controller.data.hasSource,false);assert.deepEqual(controller.data.rows,[]);
  controller.onUnload();channel=events();const received=page('vocabulary',channel),capture=page('capture');received.onLoad();capture.onLoad();capture.setData({text:'cafe\u0301 O’Reilly exact text'});capture.onVocabulary();assert.equal(navigated,'/pages/vocabulary/index');assert.equal(received._sourceText,capture.data.text);assert.ok(received._byWord.has('café'));received.onUnload();capture.onUnload();
 }finally{controller.onUnload();reader.onUnload();}
});
