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
