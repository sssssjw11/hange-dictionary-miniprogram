const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const pack = require('../miniprogram/services/offline-pack');
let picker, installed, attempts, packets, controllers, picks;

global.wx = {
  getStorageSync(){return '';}, getAppBaseInfo(){return {theme:'light'};},
  setNavigationBarColor(){}, setBackgroundColor(){}, setTabBarStyle(){}, showToast(){},
  chooseMessageFile(options){picks++;picker=options;}
};
function page(){
  let definition;
  const file=path.join(__dirname,'../miniprogram/pages/dictionaries/index.js');
  global.Page=value=>definition=value;delete require.cache[file];require(file);
  const controller={data:JSON.parse(JSON.stringify(definition.data)),setData(value){packets++;Object.assign(this.data,value);}};
  for(const [name,value] of Object.entries(definition))if(typeof value==='function')controller[name]=value.bind(controller);
  controller.onLoad();controllers.push(controller);return controller;
}
function choose(controller,name,location=name){
  controller.onChooseFiles();picker.success({tempFiles:[{name,path:location,size:1024}]});
}
test.beforeEach(()=>{
  installed=false;attempts=[];packets=0;controllers=[];picks=0;
  pack.status=async()=>({installed});
  pack.progress=()=>({working:false,progress:0,message:'',error:''});
  pack.install=async paths=>{attempts.push(paths);installed=true;};
});
test.afterEach(()=>controllers.forEach(controller=>controller.onUnload()));

test('single-file native pickers can collect all volumes across hide/show without starting an incomplete import',async()=>{
  const controller=page();choose(controller,'index.zip','index-v1');
  controller.onHide();controller.onShow();await controller.refresh();
  choose(controller,'data1.zip');choose(controller,'data2.zip');
  choose(controller,'index.zip','index-v2');
  assert.equal(controller.data.selectedFiles.length,3);
  assert.equal(attempts.length,0);
  picker.fail({errMsg:'chooseMessageFile:fail cancel'});
  assert.equal(controller.data.selectedFiles.length,3);
  await controller.onImport();
  assert.deepEqual(attempts,[['index-v2','data1.zip','data2.zip']]);
  assert.equal(controller.data.installed,true);
  assert.equal(controller.data.selectedFiles.length,0);
});

test('a missing-volume failure retains selected files for adding the missing volume and retrying',async()=>{
  const controller=page();choose(controller,'index.zip');
  pack.install=async paths=>{attempts.push(paths);if(paths.length<2)throw new Error('缺少词库分卷');installed=true;};
  await controller.onImport();
  assert.match(controller.data.error,/缺少/);
  assert.equal(controller.data.working,false);
  assert.equal(controller.data.selectedFiles.length,1);
  choose(controller,'data.zip');
  assert.equal(controller.data.error,'');
  await controller.onImport();
  assert.deepEqual(attempts,[['index.zip'],['index.zip','data.zip']]);
  assert.equal(controller.data.installed,true);
});

test('invalid or excessive selections do not discard previously selected volumes',()=>{
  const controller=page();choose(controller,'index.zip');
  controller.onChooseFiles();
  picker.success({tempFiles:[{name:'data.zip',path:'data.zip'},{name:'not-a-volume.txt',path:'bad.txt'}]});
  assert.deepEqual(controller.data.selectedFiles.map(file=>file.name),['index.zip']);
  assert.match(controller.data.error,/ZIP/);
  controller.onChooseFiles();
  picker.success({tempFiles:Array.from({length:5},(_,i)=>({name:'data'+i+'.zip',path:'data'+i+'.zip'}))});
  assert.deepEqual(controller.data.selectedFiles.map(file=>file.name),['index.zip']);
  assert.match(controller.data.error,/最多/);
});

test('a file selection delivered after page unload never changes the destroyed view or imports files',()=>{
  const controller=page();controller.onChooseFiles();controller.onUnload();const previous=packets;
  picker.success({tempFiles:[{name:'late.zip',path:'late.zip'}]});
  assert.equal(packets,previous);assert.equal(attempts.length,0);
});

test('repeated taps cannot open overlapping pickers and cancellation permits a fresh selection',()=>{
  const controller=page();controller.onChooseFiles();controller.onChooseFiles();
  assert.equal(picks,1);
  picker.fail({errMsg:'chooseMessageFile:fail cancel'});
  choose(controller,'index.zip');
  assert.equal(picks,2);assert.equal(controller.data.selectedFiles.length,1);
});
