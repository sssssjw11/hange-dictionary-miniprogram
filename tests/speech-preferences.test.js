const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));let played=0;
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync:(key,value)=>memory.set(key,copy(value)),getAppBaseInfo:()=>({theme:'light'}),setNavigationBarColor(){},setBackgroundColor(){},showToast(){},downloadFile(options){options.success({statusCode:200,tempFilePath:'owned-preview.wav'});},createInnerAudioContext(){return{onEnded(){},onError(){},play(){played++;},stop(){},destroy(){}};}};
const store=require('../miniprogram/utils/store'),api=require('../miniprogram/services/api'),media=require('../miniprogram/services/media'),dictionary=require('../miniprogram/services/dictionary'),study=require('../miniprogram/services/study');
const {Pronunciation}=require('../miniprogram/services/pronunciation');
function page(name){let definition;const file=path.resolve(__dirname,'../miniprogram/pages',name,'index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value){Object.assign(this.data,copy(value));}};for(const [key,value] of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
test.beforeEach(()=>{memory.clear();played=0;});

test('legacy and invalid speech preferences read safe defaults, and invalid writes do not replace valid settings',()=>{
 memory.set('hange.settings.v1',{theme:'dark',fontSize:18,apiBase:'http://127.0.0.1:18748',online:false});assert.equal(store.settings().voiceMode,'auto');assert.equal(store.settings().voiceVariant,'US');assert.equal(store.settings().ttsRate,0);
 store.saveSettings({voiceMode:'tts',voiceVariant:'UK',ttsRate:-2});const before=copy(store.settings());assert.equal(before.theme,'dark');assert.equal(before.online,false);
 assert.throws(()=>store.saveSettings({voiceVariant:'wrong',ttsRate:2}),/无效/);assert.deepEqual(store.settings(),before);
 memory.set('hange.settings.v1',{voiceMode:'wrong',voiceVariant:'CN',ttsRate:100});assert.equal(store.settings().voiceMode,'auto');assert.equal(store.settings().voiceVariant,'US');assert.equal(store.settings().ttsRate,0);
});

test('synthesized speech inherits selected accent and speed while explicit call options remain effective',async()=>{
 const original=api.request,requests=[];api.request=async(route,data)=>{requests.push(data);return{audioPath:'/api/audio/test.wav',locale:'en-GB'};};store.saveSettings({voiceVariant:'UK',ttsRate:-2});
 try{await media.speak('A test sentence.');await media.speak('Explicit settings.','US','en',2);assert.deepEqual(requests.map(row=>[row.variant,row.rate]),[['UK',-2],['US',2]]);assert.equal(played,2);}
 finally{media.stopAudio();api.request=original;}
});

test('settings save across reopening and leaving while a preview is pending prevents late audio',async()=>{
 const request=api.request;let finish;api.request=()=>new Promise(resolve=>{finish=resolve;});const controller=page('settings');controller.onShow();
 try{controller.onVoiceMode({currentTarget:{dataset:{mode:'original'}}});controller.onVoiceVariant({currentTarget:{dataset:{variant:'UK'}}});controller.onTtsRate({currentTarget:{dataset:{rate:'-2'}}});const reopened=page('settings');reopened.onShow();assert.equal(reopened.data.voiceMode,'original');assert.equal(reopened.data.voiceVariant,'UK');assert.equal(reopened.data.ttsRate,-2);
  const pending=controller.onPreview();await tick();controller.onHide();finish({audioPath:'/api/audio/test.wav',locale:'en-GB'});await pending;assert.equal(played,0);assert.equal(controller.data.previewing,false);controller.onUnload();reopened.onUnload();
 }finally{api.request=request;}
});

test('new playback uses defaults while a saved deck keeps its explicit source mode and accent',async()=>{
 const lookup=dictionary.lookup;dictionary.lookup=async word=>({kind:'entry',word,brief:'meaning'});store.saveSettings({voiceVariant:'UK',voiceMode:'tts',ttsRate:2});let first,resumed;
 try{const id=study.createDeck('Voice defaults','word');first=page('player');first.onLoad({deck:id});await tick();assert.equal(first.data.variant,'UK');assert.equal(first.data.voiceMode,'tts');first.onVariant({currentTarget:{dataset:{variant:'US'}}});first.onVoiceMode({currentTarget:{dataset:{mode:'original'}}});first.onUnload();resumed=page('player');resumed.onLoad({deck:id});await tick();assert.equal(resumed.data.variant,'US');assert.equal(resumed.data.voiceMode,'original');}
 finally{if(resumed)resumed.onUnload();dictionary.lookup=lookup;}
 const speaker=new Pronunciation(),speak=media.speakAndWait;let variant,resolved=0;speaker.files.resolve=async()=>{resolved++;return{available:false,reason:'missing',rows:[]};};media.speakAndWait=async(text,value)=>{variant=value;return{locale:'en-GB'};};
 try{await speaker.play({word:'word',oxford:{mediaVersion:2,sourceSha256:'a'.repeat(64),mediaRefs:[{key:'word.wav',kind:'audio',variant:'UK',pronunciationText:'word'}]}});assert.equal(variant,'UK');assert.equal(resolved,0);}finally{speaker.release();media.speakAndWait=speak;}
});
