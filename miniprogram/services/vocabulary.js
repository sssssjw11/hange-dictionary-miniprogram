const library=require('./library'),dictionary=require('./dictionary'),store=require('../utils/store');
const MAX_TEXT=200000,MAX_SELECTION=500;
function extract(text){
 if(typeof text!=='string'||!text.trim()||text.length>MAX_TEXT)throw new Error('请输入 1～200000 字符的文字');
 const byWord=new Map();let occurrences=0,skipped=0;
 library.scanWords(text,(surface,start)=>{if(surface.length>128){skipped++;return;}const word=store.key(surface);if(word.length>128){skipped++;return;}occurrences++;const row=byWord.get(word);if(row)row.count++;else byWord.set(word,{word,count:1,start,end:start+surface.length});});
 return {rows:Array.from(byWord.values()),occurrences,skipped};
}
function context(text,row){let start=Math.max(0,row.start-45),end=Math.min(text.length,row.end+65);if(start>0&&/[\uDC00-\uDFFF]/.test(text[start])&&/[\uD800-\uDBFF]/.test(text[start-1]))start++;if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;const clean=value=>value.replace(/\s+/g,' ');return {before:(start?'…':'')+clean(text.slice(start,row.start)),hit:text.slice(row.start,row.end),after:clean(text.slice(row.end,end))+(end<text.length?'…':'')};}
async function resolve(words,options={}){
 if(!Array.isArray(words)||!words.length||words.length>MAX_SELECTION||words.some(word=>typeof word!=='string'||!word.trim()||word.length>128||/[\x00-\x1f]/.test(word)))throw new Error('每次请选择 1～500 个候选词');
 words=Array.from(new Set(words.map(store.key)));if(words.some(word=>!word||word.length>128))throw new Error('请选择有效的候选词');const active=options.active||(()=>true),rows=[];let cursor=0,completed=0;
 async function worker(){while(active()){
  const index=cursor++;if(index>=words.length)return;const word=words[index];let row;
  try{const entry=await dictionary.lookup(word);if(!active())return;row=entry&&entry.kind==='entry'?{word,kind:'entry',meaning:library.excerpt(String(entry.brief||entry.zh||(entry.teaching||{}).title||((entry.senses||[])[0]||{}).definition||''),500)}:{word,kind:'missing',meaning:''};}
  catch(error){if(!active())return;row={word,kind:'error',meaning:library.excerpt(error.message||'词条读取失败',160)};}
  rows.push(row);completed++;if(options.onResult)options.onResult(row,completed,words.length);
 }}
 await Promise.all(Array.from({length:Math.min(3,words.length)},worker));return {rows,cancelled:!active()};
}
module.exports={extract,context,resolve,MAX_SELECTION};
