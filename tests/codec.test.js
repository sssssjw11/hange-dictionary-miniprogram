const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const crypto=require('node:crypto');
test('dictionary previews select real definitions before subject labels and examples without dropping the full body',()=>{
 const codec=require('../miniprogram/vendor/codec');
 const html='<div><span class="labels"><chn>测试领域</chn></span><deft><chn>第一义项</chn></deft><xt><chn>这里是完整例句。</chn></xt><deft><chn>第二义项</chn></deft><deft><chn>第一义项</chn></deft></div>';
 const result=codec.renderOxford([{word:'original-example',html}]);
 assert.equal(result.brief,'第一义项 / 第二义项');assert.equal(codec.oxfordSummary(html),result.brief);
 assert.equal(result.chineseNodes,5);assert.match(JSON.stringify(result.blocks),/测试领域/);assert.match(JSON.stringify(result.blocks),/这里是完整例句/);
 assert.equal(codec.oxfordSummary('<script><chn>脚本内容</chn></script><chn>兼容旧格式</chn>'),'兼容旧格式');
 assert.equal(Array.from(codec.oxfordSummary('<deft><chn>'+'🙂'.repeat(241)+'</chn></deft>')).length,240);
});
test('bundled native codec runs without Node require, Buffer, process, crypto or DOM globals',()=>{
 const context=vm.createContext({module:{exports:{}},require(){throw new Error('Node dependencies unavailable');}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../miniprogram/vendor/codec.js'),'utf8'),context);
 const digest=vm.runInContext("module.exports.hex(module.exports.sha256(module.exports.utf8('中文🙂')))",context);
 assert.equal(digest,crypto.createHash('sha256').update('中文🙂').digest('hex'));
 const compressed=Array.from(require('node:zlib').deflateSync(Buffer.from('中文🙂')));
 assert.equal(vm.runInContext('module.exports.strFromU8(module.exports.unzlibSync(new Uint8Array('+JSON.stringify(compressed)+')))',context),'中文🙂');
 const result=vm.runInContext("JSON.stringify(module.exports.renderOxford([{word:'demo',html:'<chn>中文🙂</chn>'}]))",context);
 assert.ok(result.includes('中文🙂'));assert.ok(!result.includes('Buffer'));
});

test('related links use the complete 256-character query contract and preserve long multiword targets',()=>{
 const codec=require('../miniprogram/vendor/codec'),long='original '.repeat(12).trim(),limit='a'.repeat(256);
 const result=codec.renderOxford([{word:'demo',html:`<a href="entry://${encodeURIComponent(long)}#sense">long phrase</a><a href="dic://${limit}">limit</a><a href="bword://${limit}a">too long</a><a href="entry://">empty</a><a href="entry://@asset">internal</a>`}]);
 assert.deepEqual(result.related,[long,limit]);
});

test('Oxford navigation retains fragment targets and duplicate ids with correct Unicode and generated pronunciation offsets',()=>{
 const codec=require('../miniprogram/vendor/codec');
 const html='<div class="entry" id="entry"><h1 class="headword">demo</h1><span class="pos">noun</span><div class="phons_br"><span class="phon">/demo/</span></div><li class="sense" id="sense" sensenum="2"><deft><chn>第二😀义项</chn></deft></li><span class="unbox" id="repeat"><span class="box_title">Extra Examples</span>ONE</span><span class="unbox" id="repeat"><span class="box_title">Word Origin</span>TWO</span><a href="entry://word%23name#target%2F2">word#name (2)</a><a href="#sense">本页义项</a><script id="ignore">ignored</script></div>';
 const rendered=codec.renderOxford([{word:'demo',html}]);
 const text=nodes=>nodes.map(node=>node.type==='text'?node.text:text(node.children||[])).join('');
 const body=rendered.blocks.map(block=>text(block.nodes)).join('');
 assert.equal(rendered.anchors.find(x=>x.id==='sense').position,body.indexOf('2. 第二😀义项'));
 assert.equal(rendered.anchors.filter(x=>x.id==='repeat').length,2);assert.ok(!rendered.anchors.some(x=>x.id==='ignore'));
 assert.deepEqual(rendered.references,[{word:'word#name',anchor:'target/2',label:'word#name (2)'}]);assert.equal(rendered.localLinks[0].anchor,'sense');
 const origin=rendered.contents.find(x=>x.label==='Word Origin');assert.ok(origin);assert.equal(body.slice(origin.position).startsWith('Word OriginTWO'),true);
 const saved=JSON.stringify(rendered.blocks),focused=codec.focusOxford(rendered,origin);
 assert.equal(focused.blocks.map(block=>text(block.nodes)).join(''),body);assert.ok(text(focused.blocks[focused.index].nodes).startsWith('Word OriginTWO'));assert.equal(JSON.stringify(rendered.blocks),saved);
});

test('focus splitting preserves every character across large fragments and refuses broken Unicode boundaries',()=>{
 const codec=require('../miniprogram/vendor/codec'),prefix='🙂中文 '.repeat(5000),html='<div>'+prefix+'<span id="target">Exact target</span>'+prefix+'</div>';
 const rendered=codec.renderOxford([{word:'demo',html}]),target=rendered.anchors.find(x=>x.id==='target');
 assert.ok(rendered.blocks.length>1);assert.equal(target.position,prefix.length);
 const text=nodes=>nodes.map(n=>n.type==='text'?n.text:text(n.children||[])).join('');const all=rendered.blocks.map(b=>text(b.nodes)).join('');
 const focused=codec.focusOxford(rendered,target);assert.equal(focused.blocks.map(b=>text(b.nodes)).join(''),all);assert.ok(text(focused.blocks[focused.index].nodes).startsWith('Exact target'));
 const tiny=codec.renderOxford([{html:'<span>🙂x</span>'}]);assert.throws(()=>codec.focusOxford(tiny,{blockIndex:0,offset:1}),/完整字符/);
 for(const point of [0,2,3])assert.equal(codec.focusOxford(tiny,{blockIndex:0,offset:point}).blocks.map(b=>text(b.nodes)).join(''),'🙂x');
});

test('navigation offsets remain local to each source document while block indexes address the full combined entry',()=>{
 const codec=require('../miniprogram/vendor/codec');const rendered=codec.renderOxford([{word:'first',html:'<span id="same">FIRST🙂</span>'},{word:'second',html:'B<span id="second">SECOND</span><a href="#same">other source document</a>'}]);
 const target=rendered.anchors.find(row=>row.id==='second');assert.equal(target.document,1);assert.equal(target.blockIndex,1);assert.equal(target.offset,1);
 const focus=codec.focusOxford(rendered,target),text=nodes=>nodes.map(n=>n.type==='text'?n.text:text(n.children||[])).join('');assert.ok(text(focus.blocks[focus.index].nodes).startsWith('SECOND'));assert.equal(rendered.localLinks[0].document,1);
});
