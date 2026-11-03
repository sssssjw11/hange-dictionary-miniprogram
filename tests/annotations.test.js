const test=require('node:test');const assert=require('node:assert/strict');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));let fail=false;
global.wx={getStorageSync(key){return memory.has(key)?copy(memory.get(key)):'';},setStorageSync(key,value){if(fail)throw new Error('quota');memory.set(key,copy(value));}};
const library=require('../miniprogram/services/library');
test.beforeEach(()=>{memory.clear();fail=false;});
test('highlight spans retain accented words, Chinese, emoji and every source character across pagination',()=>{
 const source=('A café makes well-being possible. 中文🙂\n').repeat(100);const id=library.add('Reader',source),start=source.indexOf('café'),end=source.indexOf('possible')+8;
 const mark=library.mark(id,start,end,'my note','green');const article=library.get(id),pages=library.ranges(source);
 const rendered=pages.map(page=>library.decorated(page.text,page.start,article.annotations).map(token=>token.text).join('')).join('');assert.equal(rendered,source);
 const tokens=library.tokens(source.slice(0,100));assert.ok(tokens.some(token=>token.word==='café'));const first=library.decorated(pages[0].text,0,article.annotations);assert.ok(first.filter(token=>token.color==='green').map(token=>token.text).join('').includes('café'));
 library.mark(id,start,end,'edited','blue',mark);assert.equal(library.annotations(id)[0].note,'edited');library.removeAnnotation(id,mark);assert.equal(library.get(id).text,source);
});
test('bookmarks keep exact positions, validate surrogate boundaries and survive failed writes',()=>{
 const text='hello 🙂 world',id=library.add('Book',text),emoji=text.indexOf('🙂');assert.throws(()=>library.mark(id,emoji+1,emoji+2),/有效/);assert.equal(library.bookmark(id,emoji,'Here'),true);assert.equal(library.annotations(id)[0].quote,'🙂');
 const before=library.get(id);fail=true;assert.throws(()=>library.mark(id,0,5,'failed'),/quota/);fail=false;assert.deepEqual(library.get(id),before);assert.equal(library.bookmark(id,emoji),false);assert.equal(library.annotations(id).length,0);
});
test('dense overlapping marks do not repeat a long lookup word into oversized native data',()=>{
 const text='a'.repeat(1800),marks=Array.from({length:1000},(_,index)=>({id:'mark-'+index,start:index,end:index+2,color:'yellow',kind:'highlight',updated:index}));const tokens=library.decorated(text,0,marks);assert.equal(tokens.map(token=>token.text).join(''),text);assert.ok(Buffer.byteLength(JSON.stringify({tokens}))<900000);
});
