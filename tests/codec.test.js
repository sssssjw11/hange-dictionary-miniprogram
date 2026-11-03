const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const crypto=require('node:crypto');
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
