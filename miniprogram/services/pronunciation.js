const {ResourceFiles}=require('./dictionary-media'),media=require('./media'),store=require('../utils/store'),api=require('./api'),dictionary=require('./dictionary');
const MODES=['auto','tts','original'];
function candidates(entry,text,variant){return ((((entry||{}).oxford||{}).mediaRefs)||[]).filter(row=>row.kind==='audio'&&row.variant===variant&&row.pronunciationText&&store.key(row.pronunciationText)===store.key(text));}
function exampleCandidates(entry,text,variant){
 const prefix='例句 · ',wanted=store.key(text);if(!wanted)return [];
 return ((((entry||{}).oxford||{}).mediaRefs)||[]).filter(row=>row&&row.kind==='audio'&&row.variant===variant&&typeof row.label==='string'&&row.label.length<200&&row.label.startsWith(prefix)&&store.key(row.label.slice(prefix.length))===wanted);
}
function voiceLabel(info){
 if(info.kind==='original')return (info.variant==='UK'?'英式':'美式')+' · 原版录音';
 return '系统合成 · '+(info.voice?info.voice+' · ':'')+(info.locale||'本机可用音色')+(info.variantFallback?(info.voiceExplicit?'（使用所选音色口音）':'（未安装所选口音）'):'')+(info.reason?' · '+info.reason:'');
}
class Pronunciation{
 constructor(){this.files=new ResourceFiles();this.generation=0;this.closed=false;this.missing=new Map();}
 cancel(){this.generation++;this.files.cancel();media.stopAudio();}
 release(){this.closed=true;this.cancel();this.files.release();this.missing.clear();}
 async original(entry,text,variant,generation,example=false){
  let selectedEntry=entry,oxford=(entry||{}).oxford||{};
  if(Number(oxford.mediaVersion||0)<2&&(Array.isArray(oxford.mediaRefs)||(oxford.blocks||[]).length)){
   const word=entry.dictionaryWord||entry.word;let fresh=await dictionary.lookup(word);if(this.closed||generation!==this.generation)return {cancelled:true};
   if(fresh.kind!=='entry'||Number((fresh.oxford||{}).mediaVersion||0)<2)fresh=await dictionary.lookup(word,{refresh:true});if(this.closed||generation!==this.generation)return {cancelled:true};
   if(fresh.kind==='entry'&&store.key(fresh.word)===store.key(word)&&(!oxford.sourceSha256||(fresh.oxford||{}).sourceSha256===oxford.sourceSha256)){selectedEntry=fresh;oxford=fresh.oxford||{};}
   if(Number(oxford.mediaVersion||0)<2)return {reason:'旧词条尚未更新发音信息'};
  }
  const rows=example?exampleCandidates(selectedEntry,text,variant):candidates(selectedEntry,text,variant),source=oxford.sourceSha256;
  if(!rows.length||!/^[a-f0-9]{64}$/.test(source||''))return {reason:example?'未提供此例句的对应原版录音':'未提供此词形的对应原版录音'};
  const key=api.base()+'\0'+source+'\0'+store.settings().online,missing=this.missing.get(key);
  if(missing&&Date.now()-missing.time<30000)return {reason:missing.reason};
  for(let offset=0;offset<rows.length;offset+=24){
   const selected=rows.slice(offset,offset+24),result=await this.files.resolve(selected,source);if(this.closed||generation!==this.generation)return {cancelled:true};
   if(!result.available){if(this.missing.size>=2)this.missing.delete(this.missing.keys().next().value);this.missing.set(key,{reason:result.reason,time:Date.now()});return {reason:result.reason};}
   this.missing.delete(key);const index=result.rows.findIndex(row=>row.available);
   if(index>=0){const file=await this.files.download(Object.assign({},selected[index],result.rows[index]),source);return {file};}
  }
  return {reason:example?'MDD 未包含此例句的对应原版录音':'MDD 未包含此词形的对应原版录音'};
 }
 async play(entry,options={}){
  if(this.closed)return {cancelled:true};this.cancel();const defaults=store.settings(),generation=this.generation,text=String(options.text===undefined?(entry||{}).word||'':options.text),variant=options.variant===undefined?defaults.voiceVariant:options.variant==='UK'?'UK':'US',mode=MODES.includes(options.mode)?options.mode:defaults.voiceMode;
  const example=options.kind==='example';if(!text.trim()||text.length>(example?2500:256))throw new Error(example?'请输入 1～2500 字的例句':'请输入有效的单词或短语');
  const current=()=>!this.closed&&generation===this.generation,emit=info=>{if(current()&&options.onStart)options.onStart(info);};let reason='';
  try{
   if(mode!=='tts'){
    try{
     const original=await this.original(entry,text,variant,generation,example);if(!current()||original.cancelled)return {cancelled:true};reason=original.reason||'';
     if(original.file){const info={kind:'original',variant};const result=await media.playLocal(original.file,()=>emit(info));return current()?Object.assign({},info,result):{cancelled:true};}
    }catch(error){if(!current())return {cancelled:true};if(mode==='original')throw error;reason='原版录音暂时不可用';}
    if(mode==='original')throw new Error(reason||'未提供对应的原版录音');
   }
   if(!current())return {cancelled:true};let announced=false;
   const info=data=>Object.assign({},data,{kind:'tts',variant,reason});
   const result=await media.speakAndWait(text,variant,'en',options.rate,data=>{announced=true;emit(info(data));});
   if(!current()||result.cancelled)return {cancelled:true};if(!announced)emit(info(result));return info(result);
  }catch(error){if(!current())return {cancelled:true};throw error;}
 }
}
module.exports={Pronunciation,candidates,exampleCandidates,voiceLabel,MODES};
