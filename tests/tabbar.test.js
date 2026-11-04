const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const memory=new Map();let route,keyboard,removed,navigations,instances;
global.getCurrentPages=()=>[{route}];
global.wx={getStorageSync:key=>memory.get(key)||'',setStorageSync:(key,value)=>memory.set(key,value),getAppBaseInfo:()=>({theme:'light'}),setNavigationBarColor(){},setBackgroundColor(){},onKeyboardHeightChange:callback=>{keyboard=callback;},offKeyboardHeightChange:callback=>{removed=callback;},switchTab:options=>navigations.push(options)};
const store=require('../miniprogram/utils/store');
function component(){
  let definition;global.Component=value=>definition=value;
  const file=path.join(__dirname,'../miniprogram/custom-tab-bar/index.js');delete require.cache[file];require(file);
  const instance={data:JSON.parse(JSON.stringify(definition.data)),setData(value){Object.assign(this.data,value);}};
  for(const [name,method]of Object.entries(definition.methods))instance[name]=method.bind(instance);
  definition.lifetimes.attached.call(instance);instance.detach=()=>definition.lifetimes.detached.call(instance);instances.push(instance);return instance;
}
test.beforeEach(()=>{memory.clear();route='pages/search/index';keyboard=null;removed=null;navigations=[];instances=[];});
test.afterEach(()=>instances.forEach(instance=>instance.detach()));

test('the floating tab bar follows the current page and the saved appearance',()=>{
  route='pages/notebook/index';store.saveSettings({theme:'dark'});
  const bar=component();assert.equal(bar.data.selected,2);assert.equal(bar.data.theme,'dark');
});
test('rapid taps cannot overlap navigation and a failed switch leaves the active tab unchanged',()=>{
  const bar=component();bar.onSwitch({currentTarget:{dataset:{index:1}}});bar.onSwitch({currentTarget:{dataset:{index:4}}});
  assert.equal(navigations.length,1);assert.equal(navigations[0].url,'/pages/ai/index');assert.equal(bar.data.selected,0);
  navigations[0].complete();assert.equal(bar.data.selected,0);
  bar.onSwitch({currentTarget:{dataset:{index:4}}});navigations[1].success();navigations[1].complete();assert.equal(bar.data.selected,4);
});
test('the tab bar hides for the keyboard and releases its listener when detached',()=>{
  const bar=component();keyboard({height:280});assert.equal(bar.data.keyboard,true);keyboard({height:0});assert.equal(bar.data.keyboard,false);
  bar.detach();assert.equal(removed,keyboard);
});
test('applying a page theme also synchronizes the floating navigation selection',()=>{
  const ui=require('../miniprogram/utils/ui');const values={};
  const page={route:'pages/study/index',setData(){},getTabBar:()=>({setData:patch=>Object.assign(values,patch)})};
  store.saveSettings({theme:'dark'});ui.apply(page);assert.deepEqual(values,{theme:'dark',selected:3});
});
