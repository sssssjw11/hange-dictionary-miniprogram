const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const codec = require('../miniprogram/vendor/codec');
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'output');
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(output, 'pack-test-'));
const memory = new Map();
let activeReads=0,peakReads=0;const readCounts=new Map();
function safe(target) { const resolved = path.resolve(target); assert.ok(resolved === temp || resolved.startsWith(temp + path.sep)); return resolved; }
const mock = {
  readFile(o) { activeReads++;peakReads=Math.max(peakReads,activeReads);readCounts.set(o.filePath,(readCounts.get(o.filePath)||0)+1);fs.readFile(o.filePath,o.encoding||null,(error,data)=>{activeReads--;if(error)o.fail({errMsg:error.message});else o.success({data:o.encoding?data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)});}); },
  stat(o) { fs.stat(o.path, (error, stats) => error ? o.fail({ errMsg: error.message }) : o.success({ stats })); },
  readdir(o){fs.readdir(safe(o.dirPath),(error,files)=>error?o.fail({errMsg:error.message}):o.success({files}));},
  open(o) { fs.open(o.filePath, o.flag, (error, fd) => error ? o.fail({ errMsg: error.message }) : o.success({ fd: String(fd) })); },
  read(o) { fs.read(Number(o.fd), Buffer.from(o.arrayBuffer), o.offset, o.length, o.position, (error, bytesRead) => error ? o.fail({ errMsg: error.message }) : o.success({ bytesRead, arrayBuffer: o.arrayBuffer })); },
  close(o) { fs.close(Number(o.fd), error => error ? o.fail({ errMsg: error.message }) : o.success({})); },
  mkdir(o) { fs.mkdir(safe(o.dirPath), { recursive: !!o.recursive }, error => error ? o.fail({ errMsg: error.message }) : o.success({})); },
  rmdir(o) { fs.rm(safe(o.dirPath), { recursive: !!o.recursive, force: false }, error => error ? o.fail({ errMsg: error.message }) : o.success({})); },
  rename(o) { fs.rename(safe(o.oldPath), safe(o.newPath), error => error ? o.fail({ errMsg: error.message }) : o.success({})); },
  unzip(o) { const result = spawnSync('python', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', o.zipFilePath, safe(o.targetPath)], { encoding: 'utf8' }); if (result.status) o.fail({ errMsg: result.stderr }); else o.success({}); }
};
global.wx = { env: { USER_DATA_PATH: temp }, getFileSystemManager() { return mock; }, getStorageSync(key) { return memory.has(key) ? JSON.parse(JSON.stringify(memory.get(key))) : ''; }, setStorageSync(key, value) { memory.set(key, JSON.parse(JSON.stringify(value))); }, removeStorageSync(key) { memory.delete(key); }, getStorageInfoSync() { return { keys: [...memory.keys()] }; } };
const pack = require('../miniprogram/services/offline-pack');
const store = require('../miniprogram/utils/store');
function nodesText(nodes) { return nodes.map(node => node.type === 'text' ? node.text : nodesText(node.children || [])).join(''); }
test.after(() => { safe(temp); fs.rmSync(temp, { recursive: true, force: true }); });

test('native codec preserves Chinese, entities, unsafe-tag removal and Unicode', () => {
  const data = codec.renderOxford([{ html: '<script>bad()</script><defT>English<chn>中文&#65307;🙂</chn></defT><a href="entry://bank" onclick="bad()">bank</a><custom>tail</custom>', word: 'demo' }]);
  const text = data.blocks.map(block => nodesText(block.nodes)).join('');
  assert.equal(text, 'English中文；🙂banktail'); assert.deepEqual(data.related, ['bank']);
  const large = '中文🙂' .repeat(15000);
  const full = codec.renderOxford([{ html: '<chn>' + large + '</chn>' }]);
  assert.equal(full.blocks.map(block => nodesText(block.nodes)).join(''), large);
  assert.ok(full.blocks.every(block => Buffer.byteLength(JSON.stringify(block)) < 50000));
});
test('import rejects a ZIP path traversal before native extraction', async () => {
  const zip = path.join(temp, 'bad.zip');
  const result = spawnSync('python', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],"w");z.writestr("../learning.json","bad");z.close()', zip]); assert.equal(result.status, 0);
  await assert.rejects(pack.install([zip]), /不允许的路径/);
  assert.equal((await pack.status()).installed, false);
});

test('Chinese reverse lookup ranks a direct definition ahead of an incidental example in a shorter word',async()=>{
  const zlib=require('node:zlib'),crypto=require('node:crypto');
  const bodies=[Buffer.from('<defT>use<chn>使用</chn><xt>Example<chn>在人际关系中使用。</chn></xt></defT>'),Buffer.from('<defT>interpersonal<chn>人际关系的</chn></defT>')].map(body=>zlib.deflateSync(body));
  const files={'parts/000.bin':Buffer.concat(bodies),'lengths.bin':Buffer.from([3,13])};
  files['docs/000.json']=Buffer.from(JSON.stringify({'0':[0,0,bodies[0].length,'use','使用'],'1':[0,bodies[0].length,bodies[1].length,'interpersonal','人际关系的']}));
  const buckets=new Map();
  for(const gram of ['人际','际关','关系']){const name='zh/'+codec.hashBucket(gram).toString(16).padStart(2,'0')+'.z';if(!buckets.has(name))buckets.set(name,{});buckets.get(name)[gram]='0001';}
  for(const [name,values]of buckets)files[name]=zlib.deflateSync(Buffer.from(JSON.stringify(values)));
  const manifest={format:'hange-oxford-pack',version:1,buckets:256,documentShardSize:512,uniqueDocuments:2,definitionRecords:2,redirectRecords:0,title:'Original test definitions',files:{},extractedBytes:0};
  for(const [name,body]of Object.entries(files)){manifest.files[name]={bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex')};manifest.extractedBytes+=body.length;}
  files['manifest.json']=Buffer.from(JSON.stringify(manifest));
  const zip=path.join(temp,'original-ranking-fixture.zip');
  const payload=JSON.stringify(Object.fromEntries(Object.entries(files).map(([name,body])=>[name,body.toString('base64')])));
  const result=spawnSync('python',['-c','import zipfile,base64,json,sys;z=zipfile.ZipFile(sys.argv[1],"w");[(z.writestr(name,base64.b64decode(body))) for name,body in json.loads(sys.argv[2]).items()];z.close()',zip,payload],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  try{await pack.install([zip]);const found=await pack.lookup('人际关系');assert.deepEqual(found.matches.map(row=>row.word),['interpersonal','use']);const single=await pack.lookup('人');assert.equal(single.matches.length,0);assert.match(single.hint,/新版词库/);}
  finally{await pack.remove();}
});
test('a generated pack searches single Han characters, case-insensitive mixed text and supplementary characters across all visible source text',async()=>{
  const folder=path.join(temp,'search-builder');fs.mkdirSync(folder);
  const source=path.join(folder,'source.db');
  let result=spawnSync('python',[path.join(project,'tests/search_fixture.py'),source],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  result=spawnSync('python',[path.join(project,'scripts/build_offline_pack.py'),'--database',source,'--output',path.join(folder,'pack.zip')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(fs.readFileSync(path.join(folder,'offline-pack-verification.json'),'utf8'));assert.equal(report.chineseSingleCharacter,true);
  try{
    const state=await pack.install(report.volumes.map(row=>path.join(folder,row.name)));assert.equal(state.singleCharacter,true);
    assert.deepEqual((await pack.lookup('爱')).matches.map(row=>row.word),['love','beloved','aid','use']);
    assert.deepEqual((await pack.lookup('C语言')).matches.map(row=>row.word),['compiler']);
    const alias=await pack.lookup('loved');assert.equal(alias.word,'love');assert.equal(alias.matchedFrom,'loved');
    assert.deepEqual((await pack.lookup('𠮷')).matches.map(row=>row.word),['rare']);
    assert.deepEqual((await pack.lookup('𠮷野')).matches.map(row=>row.word),['rare']);
    assert.deepEqual(new Set((await pack.lookup('键盘')).matches.map(row=>row.word)),new Set(['compiler','typing']));
    const input=(await pack.lookup('输')).matches.find(row=>row.word==='input');assert.ok(input);assert.match(input.meaning,/原文匹配/);
    assert.equal(await pack.lookup('秘'),null);
  }finally{await pack.remove();}
});
test('large reverse searches batch metadata with bounded concurrency and share the same in-flight files',async()=>{
  const folder=path.join(temp,'many-shards');fs.mkdirSync(folder);const source=path.join(folder,'source.db');
  let result=spawnSync('python',[path.join(project,'tests/search_fixture.py'),source,'4609'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  result=spawnSync('python',[path.join(project,'scripts/build_offline_pack.py'),'--database',source,'--output',path.join(folder,'pack.zip')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(fs.readFileSync(path.join(folder,'offline-pack-verification.json'),'utf8'));
  try{
    await pack.install(report.volumes.map(row=>path.join(folder,row.name)));peakReads=0;readCounts.clear();
    const found=await Promise.all([pack.lookup('测'),pack.lookup('试')]);
    for(const value of found){assert.equal(value.matches.length,40);assert.equal(value.matches[0].word,'indexed-00000');assert.equal(value.matches[39].word,'indexed-00039');}
    assert.ok(peakReads>1&&peakReads<=8,'metadata read concurrency '+peakReads);
    const metadata=Array.from(readCounts).filter(([name])=>/[\\/]docs[\\/]/.test(name));
    assert.equal(metadata.length,10);assert.ok(metadata.every(([,count])=>count===1),'metadata files should not be read twice while in flight');
    assert.equal(Array.from(readCounts).find(([name])=>name.endsWith('lengths.bin'))[1],1);
  }finally{await pack.remove();}
});
test('real private pack: import all volumes, full native lookup, aliases, Chinese reverse lookup, and removal', async t => {
  const reportFile = path.join(output, 'offline-pack-verification.json');
  if (!fs.existsSync(reportFile)) { t.skip('Private generated pack is absent'); return; }
  const report = JSON.parse(fs.readFileSync(reportFile));
  store.saveNote('run', '跑', 'must survive dictionary replacement');
  const abandoned=path.join(temp,'hange-oxford-stage-123');fs.mkdirSync(abandoned);fs.writeFileSync(path.join(abandoned,'incomplete.bin'),'interrupted import');
  const unrelated=path.join(temp,'hange-learning-other');fs.mkdirSync(unrelated);fs.writeFileSync(path.join(unrelated,'keep.json'),'keep');
  fs.mkdirSync(path.join(temp,'hange-oxford'));fs.writeFileSync(path.join(temp,'hange-oxford','unfinished'),'interrupted before pointer commit');
  let progress = 0;
  const state = await pack.install(report.volumes.map(volume => path.join(output, volume.name)), (_, value) => { progress = value; });
  assert.equal(state.installed, true); assert.equal(state.definitions, 69980); assert.equal(state.redirects, 240108); assert.equal(Math.round(progress), 100);
  assert.equal(fs.existsSync(abandoned),false);assert.equal(fs.readFileSync(path.join(unrelated,'keep.json'),'utf8'),'keep');
  const checks = [];
  for (const word of ['predicative','subordinate','run','set','apple','running','reach out','reach-out']) {
    const entry = await pack.lookup(word); assert.equal(entry.kind, 'entry', word);
    const text = entry.oxford.blocks.map(block => nodesText(block.nodes)).join(''); assert.ok(text.length > 30);
    checks.push({ word, documents: entry.oxford.documents, blocks: entry.oxford.blocks.length, text_chars: text.length });
  }
  const chinese = await pack.lookup('苹果'); assert.equal(chinese.kind, 'matches'); assert.ok(chinese.matches.some(x => x.word.toLowerCase() === 'apple'));
  const related=(await pack.lookup('人际关系')).matches.map(row=>row.word);
  assert.ok(related.indexOf('interpersonal')>=0&&related.indexOf('use')>=0&&related.indexOf('interpersonal')<related.indexOf('use'));
  const suggestions=await pack.suggest('subord'); assert.ok(suggestions.some(item=>item.word==='subordinate'));assert.ok(suggestions.every(item=>item.word.toLowerCase().startsWith('subord')));
  const run = await pack.lookup('run'); assert.ok(run.phonetics.uk); assert.ok(run.phonetics.us);
  const text = run.oxford.blocks.map(block => nodesText(block.nodes)).join('');
  assert.equal(run.oxford.chineseNodes, 269);
  assert.ok(text.includes('run')); assert.ok(/[\u3400-\u9fff]/.test(text));
  fs.writeFileSync(path.join(output, 'native-offline-verification.json'), JSON.stringify({ native_js_decoder: true, simulated_wechat_fs: true, wechat_runtime_tested: false, full_import_sha256: 'passed', definitions: state.definitions, redirects: state.redirects, chinese_reverse: 'passed', checks }, null, 2));
  await pack.remove(); assert.equal((await pack.status()).installed, false); assert.equal(store.favorite('run').note, 'must survive dictionary replacement');
});
