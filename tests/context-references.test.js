const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));let destination='';
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarTitle(){},pageScrollTo(){},navigateTo(options){destination=options.url;}};
const codec=require('../miniprogram/vendor/codec'),dictionary=require('../miniprogram/services/dictionary');
const text=nodes=>nodes.map(node=>node.type==='text'?node.text:text(node.children||[])).join('');
function page(){let definition;const file=path.resolve(__dirname,'../miniprogram/pages/entry/index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value,callback){if(value.pageReferenceRows)assert.ok(value.pageReferenceRows.length<=8);Object.assign(this.data,copy(value));if(callback)callback();}};for(const [key,value] of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
test.beforeEach(()=>{memory.clear();destination='';});

test('visible source links retain exact document and block positions across fragmentation',()=>{
 const first='<div class="entry"><h1 class="headword">first</h1><span>😀'+('A'.repeat(20000))+'</span><li class="sense" sensenum="2"><a href="entry://other#sense">Other</a></li><a href="entry://other#sense">Other</a><a href="entry://empty"></a><a href="entry://@topic_art">Topic</a><script><a href="entry://bad">bad</a></script></div>';
 const second='<div class="entry"><span>'+('B'.repeat(20000))+'</span><a href="dic://second%23head#target%2F2">Second</a></div>';
 const rendered=codec.renderOxford([{word:'first',html:first},{word:'second',html:second}]);assert.equal(rendered.referenceVersion,1);assert.deepEqual(rendered.referenceOccurrences.map(row=>row.label),['Other','Other','Second']);assert.deepEqual(rendered.referenceOccurrences.map(row=>row.document),[0,0,1]);assert.equal(rendered.referenceOccurrences[2].word,'second#head');assert.equal(rendered.referenceOccurrences[2].anchor,'target/2');
 for(const row of rendered.referenceOccurrences){const focus=codec.focusOxford(rendered,row);assert.ok(text(focus.blocks[focus.index].nodes).startsWith(row.label));}
 assert.equal(rendered.references.filter(row=>row.word==='other').length,1);assert.ok(rendered.references.some(row=>row.word==='empty'));assert.ok(!rendered.referenceOccurrences.some(row=>row.word==='bad'));
});

test('current-page links are bounded, follow page changes, and preserve an unsaved note',async()=>{
 const lookup=dictionary.lookup,controller=page(),blocks=Array.from({length:8},(_,index)=>({id:'b'+index,nodes:[{type:'text',text:'block '+index}]}));
 const refs=Array.from({length:10},(_,index)=>({word:'target'+index,anchor:'sense',label:'Link '+index,blockIndex:0,offset:0})).concat([{word:'later',anchor:'',label:'Later',blockIndex:4,offset:0},{word:'target0',anchor:'sense',label:'Link 0',blockIndex:0,offset:0}]);
 dictionary.lookup=async()=>({kind:'entry',word:'head',oxford:{blocks,referenceVersion:1,referenceOccurrences:refs,anchors:[{id:'local',blockIndex:0,offset:0}],references:[{word:'target0',anchor:'sense',label:'Link 0'}]}});
 try{await controller.load('head');controller.onNote({detail:{value:'my unsaved thought'}});assert.equal(controller.data.pageReferenceTotal,10);assert.equal(controller.data.pageReferenceRows.length,8);controller.onPageReferenceNext();assert.equal(controller.data.pageReferenceRows.length,2);controller.onPageReference({currentTarget:{dataset:{index:8}}});assert.match(destination,/q=target8/);assert.match(destination,/anchor=sense/);assert.equal(controller.data.note,'my unsaved thought');assert.equal(controller.data.noteStatus,'尚未保存');
  controller.onNext();assert.equal(controller.data.pageReferenceTotal,1);assert.equal(controller.data.pageReferenceRows[0].label,'Later');controller.onPrev();assert.equal(controller.data.pageReferencePage,0);controller.focusAnchor('local','local');assert.equal(controller.data.pageReferenceTotal,10);controller.onClearFocus();assert.equal(controller.data.pageReferenceTotal,10);
 }finally{controller.onUnload();dictionary.lookup=lookup;}
});

test('focused text keeps each reference on the page containing its original position',async()=>{
 const lookup=dictionary.lookup,controller=page(),blocks=Array.from({length:8},(_,index)=>({id:'b'+index,nodes:[{type:'text',text:'abcdef'}]}));
 dictionary.lookup=async()=>({kind:'entry',word:'head',oxford:{blocks,referenceOccurrences:[{word:'before',anchor:'',label:'Before',blockIndex:3,offset:1},{word:'after',anchor:'',label:'After',blockIndex:3,offset:4}],anchors:[{id:'split',blockIndex:3,offset:3}],references:[]}});
 try{await controller.load('head');controller.focusAnchor('split','split');assert.equal(controller.data.page,1);assert.deepEqual(controller.data.pageReferenceRows.map(row=>row.label),['After']);controller.onPrev();assert.deepEqual(controller.data.pageReferenceRows.map(row=>row.label),['Before']);controller.onClearFocus();assert.deepEqual(controller.data.pageReferenceRows.map(row=>row.label),['Before','After']);}
 finally{controller.onUnload();dictionary.lookup=lookup;}
});

test('older cached entries retain their original reference list',async()=>{
 const lookup=dictionary.lookup,controller=page();dictionary.lookup=async()=>({kind:'entry',word:'head',oxford:{blocks:[{id:'old',nodes:[{type:'text',text:'old'}]}],references:[{word:'other',anchor:'',label:'Other'}]}});
 try{await controller.load('head');assert.equal(controller.data.pageReferenceTotal,0);assert.equal(controller.data.relatedTotal,1);controller.onReference({currentTarget:{dataset:{index:0}}});assert.match(destination,/q=other/);}
 finally{controller.onUnload();dictionary.lookup=lookup;}
});

test('refreshing an older cached entry preserves the latest page and draft while adding source links',async()=>{
 const lookup=dictionary.lookup,controller=page(),sha='a'.repeat(64),blocks=Array.from({length:8},(_,index)=>({id:'b'+index,nodes:[{type:'text',text:'block '+index}]}));let finish;
 const old={kind:'entry',word:'head',source:'cache',oxford:{blocks,sourceSha256:sha,references:[{word:'other',anchor:'',label:'Other'}]}};
 const fresh={kind:'entry',word:'head',source:'service',oxford:{blocks,sourceSha256:sha,referenceVersion:1,referenceOccurrences:[{word:'other',anchor:'',label:'Other',blockIndex:4,offset:0}],references:old.oxford.references}};
 dictionary.lookup=(word,options)=>options&&options.refresh?new Promise(resolve=>{finish=resolve;}):Promise.resolve(old);
 try{await controller.load('head');const pending=controller.onPageReferenceRefresh();controller.onNext();controller.onNote({detail:{value:'draft written while refreshing'}});finish(fresh);await pending;assert.equal(controller.data.page,1);assert.equal(controller.data.pageReferenceAvailable,true);assert.equal(controller.data.pageReferenceRows[0].label,'Other');assert.equal(controller.data.note,'draft written while refreshing');assert.equal(controller.data.noteStatus,'尚未保存');}
 finally{controller.onUnload();dictionary.lookup=lookup;}
});

test('an incompatible or late refresh leaves the current entry and note intact',async()=>{
 const lookup=dictionary.lookup,controller=page(),sha='a'.repeat(64);let finish;
 const old={kind:'entry',word:'head',oxford:{blocks:[{id:'old',nodes:[{type:'text',text:'old'}]}],sourceSha256:sha,references:[{word:'other',anchor:'',label:'Other'}]}};
 dictionary.lookup=(word,options)=>options&&options.refresh?new Promise(resolve=>{finish=resolve;}):Promise.resolve(old);
 try{await controller.load('head');controller.onNote({detail:{value:'keep'}});let pending=controller.onPageReferenceRefresh();finish({kind:'entry',word:'head',oxford:{blocks:old.oxford.blocks,sourceSha256:'b'.repeat(64),referenceVersion:1,referenceOccurrences:[]}});await pending;assert.match(controller.data.pageReferenceError,/暂不能/);assert.equal(controller.data.note,'keep');assert.equal(controller.data.pageReferenceAvailable,false);
  pending=controller.onPageReferenceRefresh();controller.onHide();finish({kind:'entry',word:'head',oxford:{blocks:old.oxford.blocks,sourceSha256:sha,referenceVersion:1,referenceOccurrences:[]}});await pending;assert.equal(controller.data.pageReferenceAvailable,false);assert.equal(controller.data.pageReferenceLoading,false);assert.equal(controller.data.note,'keep');
 }finally{controller.onUnload();dictionary.lookup=lookup;}
});

test('refresh keeps active find position or unsubmitted find text and the currently selected source',async()=>{
 const lookup=dictionary.lookup,sha='a'.repeat(64),blocks=[{id:'one',nodes:[{type:'text',text:'needle and needle'}]}],old={kind:'entry',word:'head',oxford:{blocks,sourceSha256:sha,examples:[{en:'Example.',zh:'例句'}],references:[{word:'other',anchor:'',label:'Other'}]}},fresh={kind:'entry',word:'head',oxford:Object.assign({},old.oxford,{referenceVersion:1,referenceOccurrences:[]})};
 try{for(const state of ['active','unsubmitted']){let finish;const controller=page();dictionary.lookup=(word,options)=>options&&options.refresh?new Promise(resolve=>{finish=resolve;}):Promise.resolve(old);await controller.load('head');controller.startFind('needle');controller.showFind(1);const pending=controller.onPageReferenceRefresh();if(state==='unsubmitted'){controller.onFindInput({detail:{value:'unfinished search'}});controller.onSource({currentTarget:{dataset:{source:'examples'}}});}finish(fresh);await pending;if(state==='active'){assert.equal(controller.data.findTotal,2);assert.equal(controller.data.findIndex,1);assert.equal(controller.data.findQuery,'needle');}else{assert.equal(controller.data.source,'examples');assert.equal(controller.data.findOpen,true);assert.equal(controller.data.findQuery,'unfinished search');assert.equal(controller.data.findTotal,0);}controller.onUnload();}}
 finally{dictionary.lookup=lookup;}
});

test('source entry markers focus a verified entry root and unrelated markers remain unresolved',async()=>{
 const lookup=dictionary.lookup,controller=page(),html='<div class="entry" id="run-across"><h1 class="headword">run across</h1><li class="sense">definition</li></div>';
 dictionary.lookup=async()=>({kind:'entry',word:'run across',oxford:codec.renderOxford([{word:'run across',html}])});
 try{await controller.load('run-across',{anchor:'runacross2_e',reference:true,label:'run across'});assert.equal(controller.data.focusError,'');assert.equal(controller.data.focusLabel,'run across');assert.ok(text(controller._focus.blocks[controller._focus.index].nodes).startsWith('run across'));
  await controller.load('run-across',{anchor:'unrelated2_e',reference:true});assert.match(controller.data.focusError,/没有提供/);assert.equal(controller._focus,null);
 }finally{controller.onUnload();dictionary.lookup=lookup;}
});
