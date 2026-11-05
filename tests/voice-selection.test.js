const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value));let played=0,packets=0;
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),getAppBaseInfo:()=>({theme:'light'}),setNavigationBarColor(){},setBackgroundColor(){},showToast(){},downloadFile(options){options.success({statusCode:200,tempFilePath:'selected-voice.wav'});},createInnerAudioContext(){return{onError(){},onEnded(){},play(){played++;},stop(){},destroy(){}};}};
const store=require('../miniprogram/utils/store'),api=require('../miniprogram/services/api'),media=require('../miniprogram/services/media'),preferences=require('../miniprogram/services/voice-preferences'),{voiceLabel}=require('../miniprogram/services/pronunciation');
const catalog=[{id:'English One',locale:'en-US'},{id:'English Two',locale:'en-US'},{id:'中文音色',locale:'zh-CN'}];
function page(){let definition;const file=path.resolve(__dirname,'../miniprogram/pages/settings/index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value){packets++;Object.assign(this.data,copy(value));}};for(const [key,value]of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);result.onShow();return result;}
test.beforeEach(()=>{memory.clear();played=0;packets=0;});

test('voice choices preserve actual locale labels, stale selections and endpoint-specific preferences',()=>{
 const options=preferences.choices(catalog.concat(catalog[0]),'en','en-GB','missing');assert.equal(options.rows.length,4);assert.match(options.rows[1].label,/en-US/);assert.match(options.rows[options.index].label,/未找到/);
 store.saveSettings({ttsVoiceBase:api.base(),ttsVoices:{UK:'English Two',US:'English One',zh:'中文音色'}});assert.equal(preferences.selected(store.settings(),api.base(),'zh','US'),'中文音色');assert.equal(preferences.selected(store.settings(),'http://different-service','en','US'),'');
 const before=store.settings();assert.throws(()=>store.saveSettings({ttsVoices:{US:'bad\nvoice'}}),/无效/);assert.deepEqual(store.settings(),before);
 assert.match(voiceLabel({kind:'tts',voice:'English Two',locale:'en-US',voiceExplicit:true,variantFallback:true}),/使用所选音色口音/);
});

test('settings pickers persist the chosen installed voice and TTS sends it only to its configured endpoint',async()=>{
 const request=api.request,calls=[];api.request=async(route,data)=>{calls.push({route,data});return route==='voices'?{available:true,voices:catalog}:{audioPath:'/api/audio/test.wav',voice:data.voice||'automatic',locale:data.language==='zh'?'zh-CN':'en-US',voiceExplicit:!!data.voice};};let controller;
 try{controller=page();await controller.onLoadVoices();controller.onInstalledVoice({currentTarget:{dataset:{kind:'en'}},detail:{value:'2'}});controller.onInstalledVoice({currentTarget:{dataset:{kind:'zh'}},detail:{value:'1'}});assert.equal(store.settings().ttsVoices.US,'English Two');const reopened=page();assert.match(reopened.data.voiceOptions[reopened.data.voiceIndex].label,/English Two/);
  await media.speak('A test.');await media.speak('测试。',undefined,'zh');assert.equal(calls.filter(row=>row.route==='tts')[0].data.voice,'English Two');assert.equal(calls.filter(row=>row.route==='tts')[1].data.voice,'中文音色');
  store.saveSettings({apiBase:'http://127.0.0.1:18749'});await media.speak('Other service.');assert.equal(calls.filter(row=>row.route==='tts')[2].data.voice,undefined);reopened.onUnload();
 }finally{if(controller)controller.onUnload();media.stopAudio();api.request=request;}
});

test('a voice list returned after hiding settings never updates the old view',async()=>{
 const request=api.request;let finish;api.request=()=>new Promise(resolve=>{finish=resolve;});const controller=page();
 try{const pending=controller.onLoadVoices();controller.onHide();const before=packets;finish({available:true,voices:catalog});await pending;assert.equal(packets,before);assert.equal(controller.data.voiceLoading,false);controller.onUnload();}
 finally{api.request=request;}
});
