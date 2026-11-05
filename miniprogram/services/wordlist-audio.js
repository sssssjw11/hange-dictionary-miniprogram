const store=require('../utils/store'),codec=require('../vendor/codec'),dictionary=require('./dictionary');
function references(row,source){
 if(!row||typeof row.word!=='string'||!row.word||row.word.length>256||!/^[a-f0-9]{64}$/.test(source||''))return [];
 const result=[],seen=new Set(),audio=row.audio||{};
 for(const variant of ['UK','US'])for(const key of Array.isArray(audio[variant])?audio[variant]:[]){
  const id=variant+'\0'+key;if(typeof key==='string'&&codec.resourceKey(key)===key&&/\.(mp3|wav|m4a|aac)$/.test(key)&&!seen.has(id)){seen.add(id);result.push({key,kind:'audio',variant,pronunciationText:row.word});}
 }
 return result;
}
function withSource(entry,row,source){
 const own=references(row,source);if(!own.length)return entry;const previous=(entry||{}).oxford||{},old=previous.sourceSha256===source&&Number(previous.mediaVersion||0)>=2&&Array.isArray(previous.mediaRefs)?previous.mediaRefs:[],seen=new Set(own.map(item=>item.variant+'\0'+item.key+'\0'+store.key(item.pronunciationText)));
 const extra=old.filter(item=>{if(!item||!item.key)return false;const key=item.variant+'\0'+item.key+'\0'+store.key(item.pronunciationText);if(seen.has(key))return false;seen.add(key);return true;});
 return Object.assign({},entry,{oxford:{mediaVersion:2,sourceSha256:source,mediaRefs:own.concat(extra)}});
}
function index(list){
 const rows=new Map();if(!list||!Array.isArray(list.rows)||!/^[a-f0-9]{64}$/.test(list.sourceSha256||''))return rows;
 for(const row of list.rows){if(!row||typeof row.word!=='string'||!row.word||row.word.length>256)continue;const refs=references(row,list.sourceSha256),key=store.key(row.word);let found=rows.get(key);if(!found){found={word:row.word,audio:{},relatedWord:row.relatedWord||''};rows.set(key,found);}for(const item of refs){if(!found.audio[item.variant])found.audio[item.variant]=[];if(!found.audio[item.variant].includes(item.key))found.audio[item.variant].push(item.key);}}
 return rows;
}
class SourceAudio{
 constructor(sourceId){this.sourceId=sourceId;this.task=null;}
 async record(word){
  if(!this.sourceId)return null;
  if(!this.task){const task=Promise.resolve().then(()=>dictionary.wordList(this.sourceId)).then(list=>({source:list.sourceSha256,rows:index(list)})).catch(()=>{if(this.task===task)this.task=null;return null;});this.task=task;}
  const data=await this.task,row=data&&data.rows.get(store.key(word));return row?{row,source:data.source}:null;
 }
 async entry(entry){const found=await this.record((entry||{}).word);return found?withSource(entry,found.row,found.source):entry;}
 reset(){this.task=null;}
}
module.exports={references,withSource,index,SourceAudio};
