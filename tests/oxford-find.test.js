const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));let navigated='',scrolled='';
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarColor(){},setBackgroundColor(){},setNavigationBarTitle(){},pageScrollTo(options){scrolled=options.selector||'';},navigateTo(options){navigated=options.url;}};
const {find}=require('../miniprogram/utils/oxford-find'),codec=require('../miniprogram/vendor/codec'),dictionary=require('../miniprogram/services/dictionary'),lookupContext=require('../miniprogram/utils/lookup-context');
const text=value=>({type:'text',text:value}),block=(id,...parts)=>({id,nodes:parts.map(text)}),nodeText=nodes=>nodes.map(node=>node.type==='text'?node.text:nodeText(node.children||[])).join('');
function page(){let definition;global.Page=value=>{definition=value;};const file=path.resolve(__dirname,'../miniprogram/pages/entry/index.js');delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value,callback){Object.assign(this.data,copy(value));if(callback)callback();}};for(const [key,value]of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
test.beforeEach(()=>{memory.clear();navigated='';scrolled='';});

test('find maps normalized, overlapping and cross-block matches back to intact UTF-16 positions',()=>{
 const blocks=[block('a','😀cafe\u0301 '),block('b','词_ 句 O’Reilly 哈哈哈 𠀀字')],before=JSON.stringify(blocks),raw=blocks.map(row=>nodeText(row.nodes)).join('');
 const match=find(blocks,'CAFÉ 词 句');assert.equal(match.length,1);assert.deepEqual([match[0].blockIndex,match[0].offset],[0,2]);assert.equal(raw.slice(match[0].start,match[0].end),'cafe\u0301 词_ 句');
 const focus=codec.focusOxford({blocks},match[0]);assert.equal(focus.blocks.map(row=>nodeText(row.nodes)).join(''),raw);assert.ok(nodeText(focus.blocks[focus.index].nodes).startsWith('cafe\u0301'));
 assert.equal(find(blocks,"o'reilly").length,1);assert.equal(find(blocks,'哈哈').length,2);assert.equal(find(blocks,'𠀀')[0].end-find(blocks,'𠀀')[0].start,2);assert.equal(find([block('g','ΟΣ Σ')],'ς')[0].offset,1);assert.deepEqual(find([block('i','İ')],'i'),[]);assert.deepEqual(find(blocks,'a'.repeat(257)),[]);assert.equal(JSON.stringify(blocks),before);
});

test('Chinese result navigation carries the query and a selected entry opens at the matching source text',async()=>{
 const lookup=dictionary.lookup;const oxford=codec.renderOxford([{word:'apple',html:'<div class="entry"><span>FIRST</span><li class="sense"><deft><chn>一只苹果。</chn></deft></li><li class="sense"><deft><chn>另一只苹果。</chn></deft></li></div>'}]);
 dictionary.lookup=async word=>word==='苹果'?{kind:'matches',matches:[{word:'apple',meaning:'苹果'}],source:'offline-pack',nextCursor:null}:{kind:'entry',word:'apple',brief:'苹果',oxford};
 const list=page(),detail=page();try{await list.load('苹果');list.onWord({currentTarget:{dataset:{word:'apple'}}});assert.match(navigated,/^\/pages\/entry\/index\?q=apple&matchRef=[a-z0-9]+$/);const reference=new URL(navigated,'https://local.invalid').searchParams.get('matchRef');detail.onLoad({q:'apple',matchRef:reference});await new Promise(resolve=>setImmediate(resolve));assert.equal(detail.data.findTotal,2);assert.equal(detail.data.findIndex,0);assert.ok(nodeText(detail._focus.blocks[detail._focus.index].nodes).startsWith('苹果'));assert.match(scrolled,/^#oxford-/);}
 finally{list.onUnload();detail.onUnload();dictionary.lookup=lookup;}
});

test('long Chinese queries use a short, single-use context tied to the selected word',()=>{
 const controller=page(),term='长'.repeat(256);controller.setData({resultKind:'matches',matchQuery:term,matches:[{word:'apple'}]});
 try{controller.onWord({currentTarget:{dataset:{word:'apple'}}});assert.ok(navigated.length<150);let reference=new URL(navigated,'https://local.invalid').searchParams.get('matchRef');assert.equal(lookupContext.take(reference,'other'),'');controller.onWord({currentTarget:{dataset:{word:'apple'}}});reference=new URL(navigated,'https://local.invalid').searchParams.get('matchRef');assert.equal(lookupContext.take(reference,'apple'),term);assert.equal(lookupContext.take(reference,'apple'),'');}
 finally{controller.onUnload();}
});

test('a direct single Chinese result locates its original text and missing Oxford content stays explicit',async()=>{
 const lookup=dictionary.lookup,oxford=codec.renderOxford([{word:'rare',html:'<div>前文𠀀词后文</div>'}]);let result={kind:'entry',word:'rare',oxford};dictionary.lookup=async()=>result;const controller=page();
 try{await controller.load('𠀀词');assert.equal(controller.data.findTotal,1);assert.ok(nodeText(controller._focus.blocks[controller._focus.index].nodes).startsWith('𠀀词'));result={kind:'entry',word:'rare',zh:'𠀀词',oxford:{blocks:[]}};await controller.load('𠀀词');assert.match(controller.data.focusError,/没有可定位/);assert.equal(controller.data.findTotal,0);}
 finally{controller.onUnload();dictionary.lookup=lookup;}
});

test('finding next and previous preserves the body and unsaved note, and closing returns to the original text',async()=>{
 const lookup=dictionary.lookup,oxford=codec.renderOxford([{word:'demo',html:'<div class="entry"><span>first match</span><div>other match</div><div id="anchor">last</div></div>'}]);dictionary.lookup=async()=>({kind:'entry',word:'demo',oxford});const controller=page();
 try{await controller.load('demo');controller.onNote({detail:{value:'draft remains'}});const original=controller._entry.oxford.blocks.map(row=>nodeText(row.nodes)).join('');controller.onFindOpen();controller.onFindInput({detail:{value:'match'}});controller.onFindRun();assert.equal(controller.data.findTotal,2);controller.onFindNext();assert.equal(controller.data.findIndex,1);assert.ok(nodeText(controller._focus.blocks[controller._focus.index].nodes).startsWith('match'));assert.equal(controller._focus.blocks.map(row=>nodeText(row.nodes)).join(''),original);controller.onFindPrev();assert.equal(controller.data.findIndex,0);controller.onFindClose();assert.equal(controller._focus,null);assert.equal(controller.data.findTotal,0);assert.equal(controller.data.note,'draft remains');assert.equal(controller.data.noteStatus,'尚未保存');}
 finally{controller.onUnload();dictionary.lookup=lookup;}
});

test('an explicit dictionary anchor supersedes a text search without losing the anchor when search closes',async()=>{
 const lookup=dictionary.lookup,oxford=codec.renderOxford([{word:'demo',html:'<div>find me <span id="target">anchor text</span></div>'}]);dictionary.lookup=async()=>({kind:'entry',word:'demo',oxford});const controller=page();
 try{await controller.load('demo');controller.startFind('find');assert.equal(controller.data.findTotal,1);controller.focusAnchor('target','原定位');assert.equal(controller.data.findTotal,0);assert.equal(controller.data.focusLabel,'原定位');controller.onFindClose();assert.equal(controller.data.focusLabel,'原定位');}
 finally{controller.onUnload();dictionary.lookup=lookup;}
});
