const study=require('../../services/study');
const dictionary=require('../../services/dictionary');
const media=require('../../services/media');
const ui=require('../../utils/ui');
const store=require('../../utils/store');
const {Pronunciation,voiceLabel,MODES}=require('../../services/pronunciation');
const {SourceAudio}=require('../../services/wordlist-audio');
Page({
 data:{theme:'light',deck:'favorites',name:'单词播放',index:0,total:0,word:'',meaning:'',phonetic:'',loading:false,playing:false,error:'',message:'',voiceStatus:'',variant:'US',voiceMode:'auto',interval:3,loop:false,readMeaning:false,showMeaning:true},
 onLoad(options){
  this._closed=false;this._run=0;this._load=0;
  try{
   const deck=ui.decode(options.deck||'favorites'),saved=study.playback();this._words=study.words(deck);this._sourceAudio=new SourceAudio(study.sourceId(deck));
   const info=study.decks().find(item=>item.id===deck),settings=saved&&saved.deck===deck?saved:{},defaults=store.settings();
   const index=settings.word&&this._words.includes(settings.word)?this._words.indexOf(settings.word):Math.max(0,Math.min(Number(settings.index)||0,this._words.length-1));
   this.setData({deck,name:info?info.name:'单词播放',total:this._words.length,variant:['UK','US'].includes(settings.variant)?settings.variant:defaults.voiceVariant,voiceMode:MODES.includes(settings.voiceMode)?settings.voiceMode:defaults.voiceMode,interval:[2,3,5,8,10].includes(settings.interval)?settings.interval:3,loop:!!settings.loop,readMeaning:!!settings.readMeaning,showMeaning:settings.showMeaning!==false});
   if(!this._words.length)throw new Error('词表为空，请先收藏或导入单词');this.loadCard(index);
  }catch(error){this.setData({error:error.message});}
 },
 onShow(){ui.apply(this);},
 async loadCard(index){
  const generation=++this._load;if(this._pronunciation)this._pronunciation.cancel();this._entry=null;this.setData({index,loading:true,error:'',word:this._words[index],meaning:'',phonetic:'',voiceStatus:''});
  try{
   const entry=await dictionary.lookup(this._words[index]);if(this._closed||generation!==this._load)return null;
   if(entry.kind!=='entry'){this._entry={word:this._words[index]};this.setData({loading:false,word:this._words[index],message:'词库未提供独立释义，可朗读词表原文。'});this.persist();return this._entry;}
   this._entry=Object.assign({},entry,{dictionaryWord:entry.word,word:this._words[index]});this.setData({loading:false,word:this._words[index],message:'',meaning:entry.brief||entry.zh||(entry.teaching||{}).title||((entry.senses||[])[0]||{}).definition||'',phonetic:store.key(entry.word)===store.key(this._words[index])?((entry.phonetics||{})[this.data.variant==='UK'?'uk':'us']||entry.phonetic||''):''});
   this.persist();return this._entry;
  }catch(error){if(this._closed||generation!==this._load)return null;if(this._entry){this.setData({loading:false,error:error.message});return null;}this._entry={word:this._words[index]};this.setData({loading:false,word:this._words[index],message:'暂未读取到释义，可尝试朗读词表原文。'});try{this.persist();}catch(writeError){this.setData({error:writeError.message});this._entry=null;return null;}return this._entry;}
 },
 persist(){study.playback({deck:this.data.deck,index:this.data.index,word:this._words[this.data.index]||'',variant:this.data.variant,voiceMode:this.data.voiceMode,interval:this.data.interval,loop:this.data.loop,readMeaning:this.data.readMeaning,showMeaning:this.data.showMeaning});},
 wait(milliseconds){return new Promise(resolve=>{this._delayResolve=resolve;this._timer=setTimeout(()=>{this._delayResolve=null;resolve();},milliseconds);});},
 async onPlay(){
  if(this.data.playing||!this._words||!this._words.length)return;
  const generation=++this._run;this.setData({playing:true,error:'',message:'准备播放…'});
  try{
   while(!this._closed&&generation===this._run){
    const entry=this._entry||await this.loadCard(this.data.index);if(this._closed||generation!==this._run)return;
    if(!entry)throw new Error('当前词无法播放，可跳过后继续');
    this.setData({message:'准备单词发音…'});const voiceEntry=this.data.voiceMode!=='tts'&&this._sourceAudio?await this._sourceAudio.entry(entry):entry;if(this._closed||generation!==this._run)return;if(!this._pronunciation)this._pronunciation=new Pronunciation();
    const result=await this._pronunciation.play(voiceEntry,{text:entry.word,variant:this.data.variant,mode:this.data.voiceMode,onStart:info=>{if(!this._closed&&generation===this._run)this.setData({message:info.kind==='original'?'正在播放原版录音':'正在朗读单词',voiceStatus:voiceLabel(info)});}});if(this._closed||generation!==this._run||result.cancelled)return;
    if(this.data.readMeaning&&this.data.meaning){this.setData({message:'正在朗读释义'});const meaning=await media.speakAndWait(this.data.meaning,undefined,/[\u3400-\u9fff]/.test(this.data.meaning)?'zh':'en',undefined,data=>{if(!this._closed&&generation===this._run)this.setData({voiceStatus:'释义 · '+voiceLabel(Object.assign({},data,{kind:'tts'}))});});if(this._closed||generation!==this._run||meaning.cancelled)return;}
    if(this.data.index===this._words.length-1&&!this.data.loop){this.setData({message:'本轮播放完成'});break;}
    this.setData({message:this.data.interval+' 秒后继续'});await this.wait(this.data.interval*1000);if(this._closed||generation!==this._run)return;
    await this.loadCard((this.data.index+1)%this._words.length);
   }
  }catch(error){if(!this._closed&&generation===this._run)this.setData({error:error.message,message:'播放已暂停，请检查服务或跳过当前词'});}
  finally{if(!this._closed&&generation===this._run)this.setData({playing:false});}
 },
 onPause(){this._run++;if(this._pronunciation)this._pronunciation.cancel();media.stopAudio();clearTimeout(this._timer);if(this._delayResolve){this._delayResolve();this._delayResolve=null;}if(!this._closed)this.setData({playing:false,message:'已暂停'});},
 async move(delta){if(!this._words||!this._words.length)return;const playing=this.data.playing;this.onPause();const generation=this._run;let index=this.data.index+delta;index=this.data.loop?(index+this._words.length)%this._words.length:Math.max(0,Math.min(index,this._words.length-1));await this.loadCard(index);if(playing&&!this._closed&&generation===this._run)this.onPlay();},
 onPrev(){this.move(-1);},onNext(){this.move(1);},
 onVariant(event){this.onPause();const variant=ui.dataset(event,'variant')==='UK'?'UK':'US',entry=this._entry||{},phonetic=store.key(entry.dictionaryWord||entry.word)===store.key(this.data.word)?((entry.phonetics||{})[variant==='UK'?'uk':'us']||entry.phonetic||''):'';this.setData({variant,phonetic,voiceStatus:''});this.persist();},
 onVoiceMode(event){const voiceMode=ui.dataset(event,'mode');if(!MODES.includes(voiceMode))return;this.onPause();if(this._pronunciation){this._pronunciation.release();this._pronunciation=null;}this.setData({voiceMode,voiceStatus:''});this.persist();},
 onInterval(event){this.onPause();this.setData({interval:Number(ui.dataset(event,'seconds'))});this.persist();},
 onLoop(event){this.setData({loop:!!event.detail.value});this.persist();},
 onReadMeaning(event){this.onPause();this.setData({readMeaning:!!event.detail.value});this.persist();},
 onShowMeaning(event){this.setData({showMeaning:!!event.detail.value});this.persist();},
 onDetail(){if(this._entry){this.onPause();ui.open(this._entry.word);}},
 onHide(){this.onPause();if(this._sourceAudio)this._sourceAudio.reset();if(this._pronunciation){this._pronunciation.release();this._pronunciation=null;}try{if(this._words&&this._words.length)this.persist();}catch(error){if(!this._closed)ui.error(error);}},
 onUnload(){this._closed=true;this._load++;this.onHide();}
});
