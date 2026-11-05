const lessons=require('../data/learning');const study=require('./study');const store=require('../utils/store');const dictionary=require('./dictionary');
function all(){const result=[];for(const [word,lesson]of Object.entries(lessons))for(const [index,pair]of (lesson.examples||[]).entries())result.push({id:word+'-'+index,word,en:pair[0],zh:pair[1],note:lesson.explanation,source:'原创学习例句'});return result;}
function today(now=Date.now(),sequence=0){const key=study.dayKey(now);const number=Number(key.replace(/-/g,''));const rows=all();return Object.assign({date:key},rows[(number+sequence)%rows.length]);}
function topics(){return Object.entries(lessons).map(([word,lesson])=>Object.assign({word},lesson));}
function hash(value){let result=2166136261;for(const char of String(value))result=Math.imul(result^char.codePointAt(0),16777619);return result>>>0;}
async function oxfordWords(){
 const state=await dictionary.status(false);if(!state.oxford)return [];
 const list=await dictionary.wordList('ox5000:all'),seen=new Set(),words=[];
 for(const row of (list&&Array.isArray(list.rows)?list.rows:[])){if(!row||typeof row!=='object')continue;const word=String(row.query||row.word||'').trim(),key=store.key(word);if(word&&word.length<=256&&!seen.has(key)){seen.add(key);words.push(word);}}
 return words;
}
function usableExample(row){return !!(row&&typeof row.en==='string'&&row.en.trim().length>=12&&row.en.trim().length<=220&&typeof row.zh==='string'&&row.zh.trim()&&/[.!?…]["'’”\)\]]*$/.test(row.en.trim()));}
async function findOxford(date,words,sequence=0,options={}){
 if(!Array.isArray(words)||!words.length)return null;
 const active=typeof options.active==='function'?options.active:()=>true,start=hash(date+':'+sequence)%words.length,excluded=store.key(options.exclude||'');let failures=0;
 for(let offset=0;offset<Math.min(12,words.length);offset++){
  if(!active())return null;const word=words[(start+offset)%words.length];if(store.key(word)===excluded&&words.length>1)continue;
  let entry;try{entry=await dictionary.lookup(word);failures=0;}catch(error){if(!active())return null;if(++failures>=2)throw error;continue;}
  if(!active())return null;const rows=((entry||{}).oxford||{}).examples;if(!entry||entry.kind!=='entry'||!Array.isArray(rows))continue;const examples=rows.filter(usableExample);if(!examples.length)continue;
  const row=examples[hash(date+':'+sequence+':'+word)%examples.length];
  return {entry,item:{date,word:entry.word||word,en:row.en.trim(),zh:row.zh.trim(),note:'',source:'牛津十版'}};
 }
 return null;
}
module.exports={today,all,topics,oxfordWords,findOxford,usableExample};
