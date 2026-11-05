const test=require('node:test'),assert=require('node:assert/strict');
const codec=require('../miniprogram/vendor/codec'),dictionary=require('../miniprogram/services/dictionary'),api=require('../miniprogram/services/api'),media=require('../miniprogram/services/media');
const sourceSha='a'.repeat(64);
let download,removed=[];
global.wx={getStorageSync:()=>'',setNavigationBarTitle(){},pageScrollTo(){},showToast(){},downloadFile(options){download=options;},getFileSystemManager:()=>({unlink(options){removed.push(options.filePath);}})};

test('original media references retain sentence context without executing or rendering source media',()=>{
 const html='<div class="entry"><a class="pron-uk audio_play_button" href="sound://Word__gb_1.mp3" title="word pronunciation"></a><ul class="examples"><li><audio-wr><a class="pron-us" href="sound://sentence.mp3"></a></audio-wr><span class="x">A test sentence.</span><xt>测试例句。</xt></li></ul><img src="res://pictures/cat.png" alt="Cat illustration"><img src="https://example.invalid/image.png"><img src="../outside.png"><img src="script.svg"><script><img src="bad.png"></script><li class="sense" id="last" sensenum="2">Tail</li></div>';
 const result=codec.renderOxford([{word:'word',html},{word:'word',html}]);
 assert.deepEqual(result.mediaRefs,[{key:'word__gb_1.mp3',kind:'audio',variant:'UK',label:'word pronunciation'},{key:'sentence.mp3',kind:'audio',variant:'US',label:'例句 · A test sentence.'},{key:'pictures/cat.png',kind:'image',variant:'',label:'Cat illustration'}]);
 const focus=codec.focusOxford(result,result.contents.find(row=>row.id==='last'));
 const text=nodes=>nodes.map(node=>node.type==='text'?node.text:text(node.children||[])).join('');assert.ok(text(focus.blocks[focus.index].nodes).startsWith('2. Tail'));
 assert.equal(codec.resourceKey('\\Pictures\\CAT.PNG'),'pictures/cat.png');
 for(const key of ['file:///x.png','sound://../x.mp3','%2e%2e/x.png','C:\\x.png','data:image/png;base64,abc'])assert.equal(codec.resourceKey(key),null);
});

test('native media paging rejects stale status results and leaving during download prevents late playback',async()=>{
 const lookup=dictionary.lookup,request=api.request,play=media.playLocal;let firstResolve,played=0,definition,calls=0;
 const refs=Array.from({length:30},(_,index)=>({key:'clip'+index+'.wav',kind:'audio',variant:'US',label:'Example '+index}));
 dictionary.lookup=async()=>({kind:'entry',word:'test',oxford:{mediaVersion:1,mediaRefs:refs,sourceSha256:sourceSha}});
 const result=keys=>({available:true,sourceSha256:sourceSha,rows:keys.map(key=>({key,available:true,mime:'audio/wav',bytes:64}))});
 api.request=(route,data)=>{calls++;return calls===1?new Promise(resolve=>{firstResolve=()=>resolve(result(data.keys));}):Promise.resolve(result(data.keys));};
 media.playLocal=async()=>{played++;};global.Page=value=>{definition=value;};delete require.cache[require.resolve('../miniprogram/pages/dictionary-media/index')];require('../miniprogram/pages/dictionary-media/index');
 const page={data:JSON.parse(JSON.stringify(definition.data)),setData(value){if(value.rows)assert.ok(value.rows.length<=12);Object.assign(this.data,value);}};for(const [key,value] of Object.entries(definition))if(typeof value==='function')page[key]=value.bind(page);
 try{
  page.onLoad({q:'test'});await new Promise(resolve=>setImmediate(resolve));page.refresh(1);await new Promise(resolve=>setImmediate(resolve));firstResolve();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(page.data.listPage,1);assert.equal(page.data.rows[0].key,'clip12.wav');
  const pending=page.onResource({currentTarget:{dataset:{index:12}}});page.onHide();download.success({statusCode:200,tempFilePath:'owned-clip.wav'});await pending;assert.equal(played,0);
  page.onUnload();assert.ok(removed.includes('owned-clip.wav'));
 }finally{dictionary.lookup=lookup;api.request=request;media.playLocal=play;}
});
