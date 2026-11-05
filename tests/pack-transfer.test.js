const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const project=path.resolve(__dirname,'..'),output=path.join(project,'output');fs.mkdirSync(output,{recursive:true});const temp=fs.mkdtempSync(path.join(output,'transfer-client-')),user=path.join(temp,'user'),fixtures=path.join(temp,'fixtures');fs.mkdirSync(user);
const safe=value=>{const result=path.resolve(value);assert.ok(result===temp||result.startsWith(temp+path.sep));return result;},memory=new Map();let events=[],unzipCount=0,corrupt=false,request;
const built=spawnSync('python',[path.join(project,'tests/transfer_fixture.py'),fixtures],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);const response=JSON.parse(fs.readFileSync(path.join(fixtures,'response.json'),'utf8'));
const fail=(o,error)=>o.fail({errMsg:error.message}),manager={
 readFile(o){fs.readFile(safe(o.filePath),o.encoding||null,(e,data)=>e?fail(o,e):o.success({data:o.encoding?data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)}));},
 stat(o){fs.stat(safe(o.path),(e,stats)=>e?fail(o,e):o.success({stats}));},readdir(o){fs.readdir(safe(o.dirPath),(e,files)=>e?fail(o,e):o.success({files}));},
 open(o){fs.open(safe(o.filePath),o.flag,(e,fd)=>e?fail(o,e):o.success({fd:String(fd)}));},read(o){fs.read(Number(o.fd),Buffer.from(o.arrayBuffer),o.offset,o.length,o.position,(e,n)=>e?fail(o,e):o.success({bytesRead:n,arrayBuffer:o.arrayBuffer}));},close(o){fs.close(Number(o.fd),e=>e?fail(o,e):o.success({}));},
 mkdir(o){fs.mkdir(safe(o.dirPath),{recursive:!!o.recursive},e=>e?fail(o,e):o.success({}));},rmdir(o){fs.rm(safe(o.dirPath),{recursive:!!o.recursive},e=>e?fail(o,e):o.success({}));},rename(o){fs.rename(safe(o.oldPath),safe(o.newPath),e=>e?fail(o,e):o.success({}));},
 unlink(o){events.push('unlink:'+path.basename(o.filePath));fs.unlink(safe(o.filePath),e=>e?fail(o,e):o.success({}));},
 unzip(o){unzipCount++;const result=spawnSync('python',['-c','import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',safe(o.zipFilePath),safe(o.targetPath)],{encoding:'utf8'});result.status?o.fail({errMsg:result.stderr}):o.success({});}
};
global.wx={env:{USER_DATA_PATH:user},getFileSystemManager:()=>manager,getStorageSync:key=>memory.has(key)?JSON.parse(JSON.stringify(memory.get(key))):'',setStorageSync:(key,value)=>memory.set(key,value),removeStorageSync:key=>memory.delete(key),getStorageInfoSync:()=>({keys:[...memory.keys()]}),downloadFile(o){const url=new URL(o.url),i=Number(url.searchParams.get('volume'));assert.equal(url.searchParams.get('buildId'),response.buildId);events.push('download:'+i);const file=path.join(user,'remote'+i+'.zip');fs.copyFileSync(path.join(fixtures,response.volumes[i].name),file);if(corrupt){const data=fs.readFileSync(file);data[data.length-1]^=1;fs.writeFileSync(file,data);}setImmediate(()=>o.success({statusCode:200,tempFilePath:file}));return{onProgressUpdate(fn){fn({totalBytesWritten:response.volumes[i].bytes});}};}};
const pack=require('../miniprogram/services/offline-pack'),api=require('../miniprogram/services/api');
test.beforeEach(async()=>{memory.clear();events=[];unzipCount=0;corrupt=false;pack._reset();for(const name of fs.readdirSync(user))await fs.promises.rm(safe(path.join(user,name)),{recursive:true,force:true});fs.mkdirSync(path.join(user,'hange-learning'));fs.writeFileSync(path.join(user,'hange-learning/study.json'),'keep my progress');api.request=async()=>response;});
test.after(async()=>{safe(temp);await fs.promises.rm(temp,{recursive:true,force:true});});
const unchanged=()=>assert.equal(fs.readFileSync(path.join(user,'hange-learning/study.json'),'utf8'),'keep my progress');

test('service transfer installs verified volumes one at a time, rejects overlapping imports and reads the resulting dictionary',async()=>{
 let deliver;api.request=()=>new Promise(resolve=>{deliver=resolve;});const progress=[],pending=pack.installFromService((message,value)=>progress.push(value));await new Promise(resolve=>setImmediate(resolve));await assert.rejects(pack.installFromService(),/正在进行/);deliver(response);await pending;
 assert.ok(events.indexOf('unlink:remote0.zip')<events.indexOf('download:1'));assert.ok(!fs.existsSync(path.join(user,'remote1.zip')));assert.equal((await pack.status()).installed,true);assert.equal((await pack.lookup('transferword')).word,'transferword');assert.equal(progress.at(-1),100);unchanged();
});

test('corrupt, missing and malformed service volumes leave learning files unchanged and never enable a partial dictionary',async()=>{
 corrupt=true;await assert.rejects(pack.installFromService(),/校验失败/);assert.equal(unzipCount,0);assert.equal((await pack.status()).installed,false);assert.ok(!fs.existsSync(path.join(user,'remote0.zip')));unchanged();
 corrupt=false;api.request=async()=>Object.assign({},response,{volumes:response.volumes.slice(0,1),totalBytes:response.volumes[0].bytes});await assert.rejects(pack.installFromService(),/缺少词库分卷/);assert.equal((await pack.status()).installed,false);assert.ok(!fs.readdirSync(user).some(name=>name.startsWith('hange-oxford-stage-')));unchanged();
 api.request=async()=>Object.assign({},response,{volumes:[null]});await assert.rejects(pack.installFromService(),/清单无效/);unchanged();
});

test('local ZIP headers with a different path are rejected before native extraction',async()=>{await assert.rejects(pack.install([path.join(fixtures,'bad-local.zip')]),/本地路径/);assert.equal(unzipCount,0);unchanged();});

test('manual volume selection keeps working with the shared validation and commit path',async()=>{await pack.install([path.join(fixtures,'data.zip'),path.join(fixtures,'index.zip')]);assert.equal((await pack.lookup('transferword')).word,'transferword');assert.equal(events.length,0);assert.ok(fs.existsSync(path.join(fixtures,'index.zip')));unchanged();});
