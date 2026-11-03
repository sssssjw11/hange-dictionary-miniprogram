const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const api=require('../miniprogram/services/api'),media=require('../miniprogram/services/media');let choose,uploads=[],packets=0;
global.wx={getStorageSync(){return '';},getAppBaseInfo(){return {theme:'light'};},setNavigationBarColor(){},setBackgroundColor(){},setTabBarStyle(){},showToast(){},chooseMedia(options){choose=options;},showActionSheet(options){options.success({tapIndex:1});}};
media.available=async()=>({ocr:{available:true}});api.upload=async(route,file)=>{uploads.push({route,file});return {text:'apple dictionary'};};
function page(){let definition;const file=path.join(__dirname,'../miniprogram/pages/capture/index.js');global.Page=value=>definition=value;delete require.cache[file];require(file);const controller={data:JSON.parse(JSON.stringify(definition.data)),setData(value){packets++;Object.assign(this.data,value);}};for(const [key,value]of Object.entries(definition))if(typeof value==='function')controller[key]=value.bind(controller);return controller;}
test.beforeEach(()=>{uploads=[];packets=0;});
test('native selection and crop survive native-UI hide/show; OCR receives the cropped file only on request',async()=>{
 const controller=page();controller.onShow();const selected=controller.onPhoto();controller.onHide();controller.onShow();choose.success({tempFiles:[{tempFilePath:'original.jpg',size:1000}]});await selected;assert.equal(uploads.length,0);let crop;
 wx.cropImage=options=>{crop=options;options.success({tempFilePath:'cropped.jpg'});};await controller.onEditPhoto();assert.equal(crop.src,'original.jpg');assert.equal(crop.cropScale,'1:1');assert.equal(controller.data.imagePath,'cropped.jpg');await controller.onRecognize();assert.deepEqual(uploads,[{route:'ocr',file:'cropped.jpg'}]);assert.ok(controller.data.tokens.includes('apple'));controller.onUnload();
});
test('cancelled editing retains the selected image and text',async()=>{
 const controller=page();controller.onShow();controller.setData({imagePath:'original.jpg',text:'keep'});wx.cropImage=options=>options.fail({errMsg:'cropImage:fail cancel'});await controller.onEditPhoto();assert.equal(controller.data.imagePath,'original.jpg');assert.equal(controller.data.text,'keep');assert.equal(controller.data.busy,false);assert.equal(uploads.length,0);controller.onUnload();
});
test('a selection completing after page unload never updates the destroyed view',async()=>{
 const controller=page();controller.onShow();const selected=controller.onPhoto();controller.onUnload();const count=packets;choose.success({tempFiles:[{tempFilePath:'late.jpg',size:1000}]});await selected;assert.equal(packets,count);assert.equal(uploads.length,0);
});
