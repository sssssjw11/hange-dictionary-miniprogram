const media=require('../../services/media');const {Pronunciation,voiceLabel}=require('../../services/pronunciation');
const study=require('../../services/study');const dictionary=require('../../services/dictionary');const offline=require('../../data/offline');const ui=require('../../utils/ui');const store=require('../../utils/store');
const {SourceAudio}=require('../../services/wordlist-audio');
const navigation=require('../../utils/wordlist-navigation');
Page({
 data:{theme:'light',loading:true,error:'',word:'',meaning:'',revealed:false,mode:'flash',index:0,total:0,answer:'',checked:false,correct:false,choices:[],finished:false,done:0,voiceStatus:'',speakingVariant:'',sourceOnly:false,relatedWord:''},
 onLoad(options){this._closed=false;const deck=ui.decode(options.deck||'favorites');const saved=options.resume?study.pending():null;this._session=saved || {id:'session-'+Date.now(),deck,mode:options.mode||'flash',words:study.queue(deck).words,index:0,done:0};this._sourceAudio=new SourceAudio(study.sourceId(this._session.deck));this.setData({mode:this._session.mode,index:this._session.index,total:this._session.words.length,done:this._session.done||0});this.loadCard();},
 onShow(){ui.apply(this);},
 async loadCard(){
  this.stopVoice();const generation=this._loadGeneration=(this._loadGeneration||0)+1,session=this._session;if(session.index>=session.words.length){study.pending(null);this.setData({finished:true,loading:false,done:session.done});return;}
  const word=session.words[session.index],current=()=>!this._closed&&generation===this._loadGeneration;this._entry=null;this._rated=false;this._firstCorrect=null;this._started=Date.now();this.setData({loading:true,error:'',word,meaning:'',phonetic:'',example:null,sourceOnly:false,relatedWord:'',voiceStatus:'',revealed:false,checked:false,answer:'',choices:[],index:session.index});
  try{
   let entry,lookupError;try{entry=await dictionary.lookup(word);}catch(error){lookupError=error;}if(!current())return;
   if(!entry||entry.kind!=='entry'){
    const source=this._sourceAudio?await this._sourceAudio.record(word):null;if(!current())return;if(!source)throw lookupError||new Error('词库中暂未找到此词，可跳过后检查拼写或导入词库');
    this._entry={kind:'source',word};this.setData({loading:false,sourceOnly:true,relatedWord:source.row.relatedWord});study.pending(session);return;
   }
   const meaning=entry.brief||entry.zh||(entry.teaching||{}).title||((entry.senses||[])[0]||{}).definition||'';this._entry=entry;this.setData({loading:false,word,meaning,phonetic:store.key(entry.word)===store.key(word)?(entry.phonetic||(entry.phonetics||{}).us||(entry.phonetics||{}).uk||''):'',example:(entry.teaching||{}).examples?entry.teaching.examples[0]:null});
   if(session.mode==='choice'){const choices=[{text:meaning,answer:true}],candidates=Object.values(offline.entries).filter(item=>store.key(item.word)!==store.key(entry.word)).sort(()=>Math.random()-.5);for(const candidate of candidates){const text=candidate.zh||(candidate.teaching||{}).title;if(text&&!choices.some(item=>item.text===text))choices.push({text,answer:false});if(choices.length===4)break;}this._choices=choices.sort(()=>Math.random()-.5);this.setData({choices:this._choices.map((item,index)=>({text:item.text,index}))});}study.pending(session);
  }catch(error){if(current())this.setData({loading:false,error:error.message});}
 },
 stopVoice(){this._voiceGeneration=(this._voiceGeneration||0)+1;if(this._pronunciation)this._pronunciation.cancel();else media.stopAudio();if(!this._closed)this.setData({speakingVariant:''});},
 async onSpeak(event){
  if(this.data.loading||!this._entry)return;const variant=ui.dataset(event,'variant')==='UK'?'UK':'US';if(this.data.speakingVariant===variant){this.stopVoice();this.setData({voiceStatus:'已停止发音'});return;}
  this.stopVoice();const generation=this._voiceGeneration;if(!this._pronunciation)this._pronunciation=new Pronunciation();this.setData({speakingVariant:variant,voiceStatus:'正在准备发音…'});
  try{const voiceEntry=store.settings().voiceMode!=='tts'&&this._sourceAudio?await this._sourceAudio.entry(Object.assign({},this._entry,{dictionaryWord:this._entry.dictionaryWord||this._entry.word,word:this.data.word})):this._entry;if(this._closed||generation!==this._voiceGeneration)return;await this._pronunciation.play(voiceEntry,{text:this.data.word,variant,onStart:info=>{if(!this._closed&&generation===this._voiceGeneration)this.setData({voiceStatus:voiceLabel(info)});}});}
  catch(error){if(!this._closed&&generation===this._voiceGeneration){this.setData({voiceStatus:error.message});ui.error(error);}}
  finally{if(!this._closed&&generation===this._voiceGeneration)this.setData({speakingVariant:''});}
 },
 onHide(){this.stopVoice();if(this._sourceAudio)this._sourceAudio.reset();if(!this._closed)this.setData({voiceStatus:''});if(this._pronunciation){this._pronunciation.release();this._pronunciation=null;}},
 onReveal(){this.setData({revealed:true});},onAnswer(event){this.setData({answer:event.detail.value});},
 onCheck(){if(this.data.sourceOnly||this.data.checked||!this._entry||this.data.loading)return;const correct=study.checkSpelling(this.data.answer,this._session.words[this._session.index]);this._firstCorrect=correct;this.setData({checked:true,correct,revealed:true});},
 onChoice(event){if(this.data.sourceOnly||this.data.checked||!this._entry||this.data.loading)return;const index=Number(ui.dataset(event,'index'));if(!this._choices||!this._choices[index])return;const correct=this._choices[index].answer;this._firstCorrect=correct;this.setData({checked:true,correct,revealed:true,choices:this._choices.map((item,i)=>({text:item.text,index:i,status:item.answer?'right':i===index?'wrong':''}))});},
 onGrade(event){const grade=ui.dataset(event,'grade');this.rate(grade);},
 onNext(){this.rate(this._firstCorrect?'good':'again');},
 rate(grade){if(this.data.sourceOnly||this._rated||!this._entry)return;this._rated=true;try{study.review(this._session.words[this._session.index],grade,{event:this._session.id+'#'+this._session.index,seconds:(Date.now()-this._started)/1000});this._session.index++;this._session.done++;study.pending(this._session);this.loadCard();}catch(error){this._rated=false;ui.error(error);}},
 onSkip(){if(this.data.loading)return;this._session.index++;study.pending(this._session);this.loadCard();},
 onDetail(){if(this._entry)ui.open(this._entry.word);},onSourceRelated(){navigation.openRelated({word:this.data.word,relatedWord:this.data.relatedWord});},onExit(){wx.navigateBack();},onUnload(){this._closed=true;this.onHide();this._loadGeneration++;if(this._session && !this.data.finished)study.pending(this._session);}
});
