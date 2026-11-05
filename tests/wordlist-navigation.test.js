const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));let destination='';
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarTitle(){},pageScrollTo(){},navigateTo(options){destination=options.url;}};
const navigation=require('../miniprogram/utils/wordlist-navigation'),context=require('../miniprogram/utils/lookup-context'),dictionary=require('../miniprogram/services/dictionary'),codec=require('../miniprogram/vendor/codec');
function page(name){let definition;const file=path.resolve(__dirname,'../miniprogram/pages',name,'index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value,callback){Object.assign(this.data,copy(value));if(callback)callback();}};for(const [key,value] of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
function openDestination(controller){const params=new URL(destination,'https://local.invalid').searchParams,options={};for(const [key,value] of params)options[key]=encodeURIComponent(value);controller.onLoad(options);}
function entry(word,body){return{kind:'entry',word,brief:'meaning',oxford:codec.renderOxford([{word,html:'<div class="entry"><h1 class="headword">'+word+'</h1><li class="sense" id="sense-one"><deft>'+body+'</deft></li></div>'}])};}
test.beforeEach(()=>{memory.clear();destination='';});

test('list navigation keeps a real phrase entry and its original anchor before trying any related word',async()=>{
 const old=dictionary.lookup,calls=[],detail=page('entry');dictionary.lookup=async word=>{calls.push(word);return entry(word,'direct phrase definition');};
 try{navigation.open({word:'direct phrase',query:'direct phrase',anchor:'sense-one',relatedWord:'related'});openDestination(detail);await tick();assert.deepEqual(calls,['direct phrase']);assert.equal(detail.data.entry.word,'direct phrase');assert.equal(detail.data.referenceNotice,'');assert.equal(detail.data.focusLabel,'direct phrase');}
 finally{detail.onUnload();dictionary.lookup=old;}
});

test('a missing phrase opens its source-related word and locates an exact text match',async()=>{
 const old=dictionary.lookup,calls=[],detail=page('entry');dictionary.lookup=async word=>{calls.push(word);return word==='related'?entry('related','The direct phrase appears here.'):{kind:'missing',suggestions:[]};};
 try{navigation.open({word:'direct phrase',relatedWord:'related'});openDestination(detail);await tick();assert.deepEqual(calls,['direct phrase','related']);assert.equal(detail.data.entry.word,'related');assert.match(detail.data.referenceNotice,/暂未找到独立词条/);assert.equal(detail.data.findTotal,1);assert.equal(detail.data.findQuery,'direct phrase');const shared=detail.onShareAppMessage().path;assert.match(shared,/q=related/);assert.match(shared,/match=direct%20phrase/);assert.match(shared,/fromList=1/);}
 finally{detail.onUnload();dictionary.lookup=old;}
});

test('explicit related-word navigation and review carry the phrase but never invent a source anchor',async()=>{
 const old=dictionary.lookup,detail=page('entry'),review=page('review');dictionary.lookup=async()=>entry('related','Another example without that expression.');
 try{review.setData({word:'a (specific) phrase',relatedWord:'related'});review.onSourceRelated();assert.match(destination,/q=related/);assert.doesNotMatch(destination,/anchor=/);openDestination(detail);await tick();assert.equal(detail.data.entry.word,'related');assert.match(detail.data.referenceNotice,/词表关联词/);assert.equal(detail.data.findTotal,0);assert.match(detail.data.findError,/未在关联词正文找到/);assert.equal(detail.data.findQuery,'a (specific) phrase');}
 finally{detail.onUnload();dictionary.lookup=old;}
});

test('related contexts are one-use, query-bound, and cannot replace a newer page result',async()=>{
 const token=context.putRelated('phrase','related');assert.equal(context.takeRelated(token,'different'),'');assert.equal(context.takeRelated(token,'phrase'),'');
 const old=dictionary.lookup,detail=page('entry');let finish;dictionary.lookup=word=>word==='phrase'?Promise.resolve({kind:'missing',suggestions:[]}):word==='related'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(entry('new word','new body'));
 try{navigation.open({word:'phrase',relatedWord:'related'});openDestination(detail);await tick();await detail.load('new word');finish(entry('related','phrase'));await tick();assert.equal(detail.data.entry.word,'new word');assert.equal(detail.data.referenceNotice,'');}
 finally{detail.onUnload();dictionary.lookup=old;}
});

test('related entry refresh and media keep the correct target and the unsaved note',async()=>{
 const old=dictionary.lookup,detail=page('entry'),calls=[],fresh=entry('related','direct phrase');let cached=copy(fresh);delete cached.oxford.wordListVersion;
 dictionary.lookup=async(word,options)=>{calls.push([word,!!(options&&options.refresh)]);if(word==='direct phrase')return{kind:'missing',suggestions:[]};return options&&options.refresh?fresh:cached;};
 try{navigation.open({word:'direct phrase',relatedWord:'related'});openDestination(detail);await tick();detail.onDictionaryMedia();assert.match(destination,/dictionary-media\/index\?q=related/);detail.onNote({detail:{value:'unsaved note'}});await detail.onWordLists();assert.deepEqual(calls,[['direct phrase',false],['related',false],['related',true]]);assert.equal(detail.data.entry.word,'related');assert.match(detail.data.referenceNotice,/暂未找到独立词条/);assert.equal(detail.data.note,'unsaved note');assert.equal(detail.data.noteStatus,'尚未保存');assert.equal(detail.data.wordListsOpen,true);}
 finally{detail.onUnload();dictionary.lookup=old;}
});

test('when the related target is missing, the original suggestions remain visible',async()=>{
 const old=dictionary.lookup,detail=page('entry');dictionary.lookup=async word=>word==='phrase'?{kind:'missing',suggestions:[{word:'similar'}]}:{kind:'missing',suggestions:[]};
 try{navigation.open({word:'phrase',relatedWord:'related'});openDestination(detail);await tick();assert.equal(detail.data.entry,null);assert.equal(detail.data.matches[0].word,'similar');assert.equal(detail.data.matchQuery,'phrase');}
 finally{detail.onUnload();dictionary.lookup=old;}
});
