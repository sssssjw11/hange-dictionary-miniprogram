const test=require('node:test'),assert=require('node:assert/strict');
const codec=require('../miniprogram/vendor/codec');
const memory=new Map();
global.wx={getStorageSync:key=>memory.has(key)?JSON.parse(JSON.stringify(memory.get(key))):'',setStorageSync:(key,value)=>memory.set(key,JSON.parse(JSON.stringify(value)))};
const study=require('../miniprogram/services/study');

test('Oxford list readers preserve records and select core levels, OPAL words and phrases from source attributes',()=>{
 const html='<ul><li data-hw="a" data-ox3000="a1" data-ox5000="a1"><a href="entry://a_1#first">a</a><span class="pos">determiner</span><span class="belong-to">a1</span></li><li data-hw="a" data-ox3000="a1" data-ox5000="a1"><span class="pos">noun</span></li><li data-hw="complex" data-ox5000="c1"><span class="pos">adjective</span></li><li data-hw="analysis" data-opal_written="sublist_1" data-opal_spoken="sublist_2"><span class="pos">noun</span></li><li data-hw="for example" data-opal_written_phrases="giving_examples"><a href="/definition/academic/example#item">for example</a></li></ul><script><li data-hw="ignored"></li></script>';
 const rows=codec.parseWordList(html),fields=codec.opalWordListFields(rows),catalog=codec.describeWordLists(['@ox3000','@opal_written&level=sublist_1','@topic_art'],fields);
 assert.equal(rows.length,5);assert.equal(rows[0].query,'a_1');assert.equal(rows[0].anchor,'first');
 const select=id=>codec.selectWordList(rows,catalog.find(item=>item.id===id));
 assert.equal(select('ox3000:all').sourceRecords,2);assert.equal(select('ox3000:all').uniqueWords,1);
 assert.equal(select('ox5000:c1').rows[0].word,'complex');assert.equal(select('ox5000:c1').rows[0].level,'C1');
 assert.equal(select('opal:written:sublist_1').rows[0].word,'analysis');assert.equal(select('opal:written:phrases').rows[0].relatedWord,'example');
 assert.equal(select('opal:written:all').sourceRecords,2);assert.equal(select('opal:spoken:all').sourceRecords,1);
 assert.equal(select('opal:written:phrase:giving_examples').rows[0].word,'for example');
 assert.equal(catalog.find(item=>item.id==='opal:written:phrase:giving_examples').group,'学术短语分类');
 assert.ok(catalog.some(item=>item.id==='topic:art:all'));
});

test('entry list links resolve known Oxford targets without mixing them with dictionary references or body offsets',()=>{
 const html='<div class="entry"><h1 class="headword">demo</h1><a href="entry://@ox5000&amp;level=b2">core</a><a href="entry://%40topic_animals_level=a1">Animals</a><a href="entry://@opal_spoken&amp;level=sublist_2">OPAL S</a><a href="entry://@asset">asset</a><a href="https://example.invalid/@topic_external">external</a><a href="entry://other#sense">Other</a><li class="sense" id="last" sensenum="2"><deft>tail</deft></li><script><a href="entry://@topic_ignored">ignored</a></script></div>';
 const result=codec.renderOxford([{word:'demo',html},{word:'demo',html}]);
 assert.deepEqual(result.wordListLinks.map(row=>row.id),['ox5000:b2','topic:animals:a1','opal:spoken:sublist_2']);
 assert.equal(result.wordListVersion,1);assert.deepEqual(result.references,[{word:'other',anchor:'sense',label:'Other'}]);
 assert.equal(codec.wordListReference('@ox3000&level=c1').id,'ox5000:c1');
 for(const word of ['@asset','@ox5000&level=c2','@opal_spoken&level=sublist_7','@topic_animals<script>'])assert.equal(codec.wordListReference(word),null);
 const last=result.contents.find(row=>row.id==='last'),focus=codec.focusOxford(result,last);
 const text=nodes=>nodes.map(node=>node.type==='text'?node.text:text(node.children||[])).join('');
 assert.ok(text(focus.blocks[focus.index].nodes).startsWith('2. tail'));
});

test('old cached entries can fetch source list links while retaining a draft typed during refresh',async()=>{
 const dictionary=require('../miniprogram/services/dictionary'),lookup=dictionary.lookup;let release,definition,destination;
 const old={kind:'entry',word:'old-word',source:'cache',oxford:{navVersion:1,blocks:[{id:'old',nodes:[{type:'text',text:'Cached entry'}]}]}};
 const fresh={kind:'entry',word:'old-word',source:'service',oxford:codec.renderOxford([{word:'old-word',html:'<div class="entry"><h1 class="headword">old-word</h1><a href="entry://@topic_animals_level=a1">Animals</a></div>'}])};
 dictionary.lookup=(word,options)=>options&&options.refresh?new Promise(resolve=>{release=resolve;}):Promise.resolve(old);
 global.Page=value=>{definition=value;};wx.setNavigationBarTitle=()=>{};wx.pageScrollTo=()=>{};wx.navigateTo=value=>{destination=value.url;};
 delete require.cache[require.resolve('../miniprogram/pages/entry/index')];require('../miniprogram/pages/entry/index');
 const page={data:JSON.parse(JSON.stringify(definition.data)),setData(value,callback){Object.assign(this.data,value);if(callback)callback();}};
 for(const [key,value] of Object.entries(definition))if(typeof value==='function')page[key]=value.bind(page);
 try{await page.load('old-word');const task=page.onWordLists();assert.equal(page.data.wordListsLoading,true);page.onNote({detail:{value:'Keep my unsaved draft'}});release(fresh);await task;
  assert.equal(page.data.wordListsOpen,true);assert.equal(page.data.wordListsLoading,false);assert.equal(page.data.wordListTotal,1);
  assert.equal(page.data.note,'Keep my unsaved draft');assert.equal(page.data.noteStatus,'尚未保存');
  page.onWordListLink({currentTarget:{dataset:{index:0}}});assert.equal(destination,'/pages/wordlist/index?oxford=topic%3Aanimals%3Aa1');
 }finally{dictionary.lookup=lookup;page.onUnload();}
});

test('adding a source list keeps whole phrases, deduplicates and reuses existing review progress',()=>{
 memory.clear();const id=study.importSourceDeck('ox3000:all','牛津词表',['Apple','apple','first, second','reach out']);
 assert.deepEqual(study.words(id),['apple','first, second','reach out']);
 study.review('apple','good',{event:'source-list-check',now:1000000});const before=study.stats(1000000).learned;
 assert.equal(study.importSourceDeck('ox3000:all','Changed title',['different']),id);
 assert.equal(study.stats(1000000).learned,before);assert.equal(study.sourceDeck('ox3000:all').id,id);assert.equal(study.words(id).length,3);
});

test('Oxford list pages send bounded rows and preserve the selected reference when opening a word',async()=>{
 const dictionary=require('../miniprogram/services/dictionary'),load=dictionary.wordList;
 const rows=Array.from({length:121},(_,index)=>({word:'word '+index,query:'word_'+index,anchor:'sense',pos:'noun',level:'A1',note:'',relatedWord:''}));
 dictionary.wordList=async()=>({name:'原始词表',rows,uniqueWords:121,sourceRecords:121});
 let definition,destination;global.Page=value=>{definition=value;};wx.navigateTo=value=>{destination=value.url;};wx.showToast=()=>{};
 delete require.cache[require.resolve('../miniprogram/pages/wordlist/index')];require('../miniprogram/pages/wordlist/index');
 const page={data:JSON.parse(JSON.stringify(definition.data)),setData(value){if(value.rows)assert.ok(value.rows.length<=50);Object.assign(this.data,value);}};
 for(const [key,value] of Object.entries(definition))if(typeof value==='function')page[key]=value.bind(page);
 try{
  page.onLoad({oxford:'ox3000:all'});await page.refresh();assert.equal(page.data.rows.length,50);assert.equal(page.data.total,121);
  await page.refresh(2);assert.equal(page.data.rows.length,21);assert.equal(page.data.rows[0].index,100);
  page.onOxfordWord({currentTarget:{dataset:{index:100}}});assert.ok(destination.includes('q=word_100')&&destination.includes('ref=1')&&destination.includes('anchor=sense'));
  page.onUnload();
 }finally{dictionary.wordList=load;}
});

test('source phrases without independent definitions can still be read aloud as written',async()=>{
 const dictionary=require('../miniprogram/services/dictionary'),media=require('../miniprogram/services/media'),lookup=dictionary.lookup,speak=media.speakAndWait;
 memory.clear();const id=study.importSourceDeck('opal:written:phrases','学术短语',['for the purpose of']);
 let definition,spoken;global.Page=value=>{definition=value;};dictionary.lookup=async()=>({kind:'missing',suggestions:[]});media.speakAndWait=async word=>{spoken=word;return{locale:'test',variantFallback:false};};
 delete require.cache[require.resolve('../miniprogram/pages/player/index')];require('../miniprogram/pages/player/index');
 const page={data:JSON.parse(JSON.stringify(definition.data)),setData(value){Object.assign(this.data,value);}};
 for(const [key,value] of Object.entries(definition))if(typeof value==='function')page[key]=value.bind(page);
 try{page.onLoad({deck:id});await page.loadCard(0);assert.equal(page.data.meaning,'');await page.onPlay();assert.equal(spoken,'for the purpose of');assert.equal(page.data.error,'');}
 finally{dictionary.lookup=lookup;media.speakAndWait=speak;}
});
