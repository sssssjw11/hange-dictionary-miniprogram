const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),showToast(){},setNavigationBarTitle(){},pageScrollTo(){}};
const codec=require('../miniprogram/vendor/codec'),dictionary=require('../miniprogram/services/dictionary');
function page(){let definition;const file=path.resolve(__dirname,'../miniprogram/pages/entry/index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value,callback){Object.assign(this.data,copy(value));if(callback)callback();}};for(const [key,value] of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
const text=nodes=>nodes.map(node=>node.type==='text'?node.text:text(node.children||[])).join('');
function nodes(blocks){const found=[];function visit(node){if(node.type==='text')return;found.push(node);for(const child of node.children||[])visit(child);}for(const block of blocks)for(const node of block.nodes)visit(node);return found;}
test.beforeEach(()=>memory.clear());

test('table rows, cells and safe spans remain structured without executing source attributes',()=>{
 const html='<div><table onclick="bad()"><caption>Forms</caption><thead><tr><th colspan="2">Heading</th></tr></thead><tbody><tr><td rowspan="2">first</td><td>sound</td></tr><tr><td colspan="99999">second <a href="entry://target#sense">Target</a></td></tr></tbody></table><script>bad()</script><span id="after">after😀</span></div>';
 const result=codec.renderOxford([{word:'sample',html}]),all=nodes(result.blocks),table=all.find(node=>node.name==='table'),head=all.find(node=>node.name==='th'),cells=all.filter(node=>node.name==='td');
 assert.equal(result.tableVersion,1);assert.equal(result.tableCount,1);assert.ok(table.attrs.style.includes('table-layout:fixed'));assert.equal(table.attrs.onclick,undefined);assert.equal(head.attrs.colspan,'2');assert.equal(cells[0].attrs.rowspan,'2');assert.equal(cells[2].attrs.colspan,undefined);assert.equal(all.filter(node=>node.name==='tr').length,3);assert.equal(text(result.blocks.flatMap(block=>block.nodes)),'FormsHeadingfirstsoundsecond Targetafter😀');
 const focus=codec.focusOxford(result,result.anchors.find(row=>row.id==='after'));assert.ok(text(focus.blocks[focus.index].nodes).startsWith('after😀'));assert.equal(result.references[0].anchor,'sense');
});

test('large table fragments retain all original text and reference positions',()=>{
 const content='word '.repeat(5000),html='<table><tr><td>'+content+'</td><td><a href="entry://other">other</a></td></tr></table>';
 const result=codec.renderOxford([{word:'sample',html}]);assert.ok(result.blocks.length>1);assert.equal(text(result.blocks.flatMap(block=>block.nodes)),content+'other');const reference=result.referenceOccurrences[0],focus=codec.focusOxford(result,reference);assert.ok(text(focus.blocks[focus.index].nodes).startsWith('other'));
});

test('long tables split at row boundaries and keep missing trailing cells aligned',()=>{
 const rows=Array.from({length:18},(_,index)=>'<tr><td>'+('word'+index+' ').repeat(220)+'</td>'+(index%3?'<td>sound'+index+'</td>':'')+'</tr>'),result=codec.renderOxford([{word:'sample',html:'<table>'+rows.join('')+'</table>'}]),all=nodes(result.blocks),renderedRows=all.filter(node=>node.name==='tr');
 assert.equal(result.tableCount,1);assert.ok(all.filter(node=>node.name==='table').length>1);assert.equal(renderedRows.length,18);assert.ok(renderedRows.every(row=>row.children.filter(child=>child.name==='td'||child.name==='th').length===2));
 const expected=rows.map((_,index)=>('word'+index+' ').repeat(220)+(index%3?'sound'+index:'')).join('');assert.equal(text(result.blocks.flatMap(block=>block.nodes)),expected);
});

test('an older cached table can refresh without losing the current note',async()=>{
 const lookup=dictionary.lookup,controller=page(),sha='a'.repeat(64),old={kind:'entry',word:'sample',source:'cache',oxford:{sourceSha256:sha,blocks:[{id:'old',nodes:[{type:'node',name:'span',attrs:{style:'display:inline-block;padding-right:12px;'},children:[{type:'text',text:'old form'}]}]}],references:[]}},fresh={kind:'entry',word:'sample',source:'service',oxford:Object.assign(codec.renderOxford([{word:'sample',html:'<table><tr><td>form</td><td>sound</td></tr></table>'}]),{sourceSha256:sha})};let finish;
 dictionary.lookup=(word,options)=>options&&options.refresh?new Promise(resolve=>{finish=resolve;}):Promise.resolve(old);
 try{await controller.load('sample');assert.equal(controller.data.entry.hasOldTables,true);const pending=controller.onTableRefresh();controller.onNote({detail:{value:'keep this draft'}});finish(fresh);await pending;assert.equal(controller.data.entry.hasOldTables,false);assert.equal(controller.data.note,'keep this draft');assert.equal(controller.data.noteStatus,'尚未保存');assert.ok(nodes(controller._entry.oxford.blocks).some(node=>node.name==='table'));}
 finally{controller.onUnload();dictionary.lookup=lookup;}
});

test('a failed or mismatched table refresh leaves the old content untouched',async()=>{
 const lookup=dictionary.lookup,controller=page(),sha='a'.repeat(64),old={kind:'entry',word:'sample',source:'cache',oxford:{sourceSha256:sha,blocks:[{id:'old',nodes:[{type:'node',name:'span',attrs:{style:'display:inline-block;padding-right:12px;'},children:[{type:'text',text:'old form'}]}]}],references:[]}};
 dictionary.lookup=async(word,options)=>options&&options.refresh?{kind:'entry',word:'sample',oxford:{blocks:old.oxford.blocks,tableVersion:1,sourceSha256:'b'.repeat(64)}}:old;
 try{await controller.load('sample');controller.onNote({detail:{value:'keep'}});await controller.onTableRefresh();assert.match(controller.data.tableRefreshError,/暂不能更新/);assert.equal(controller.data.entry.hasOldTables,true);assert.equal(controller.data.note,'keep');assert.equal(controller._entry.oxford.blocks[0].id,'old');}
 finally{controller.onUnload();dictionary.lookup=lookup;}
});
