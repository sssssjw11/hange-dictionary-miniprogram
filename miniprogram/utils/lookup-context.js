const store=require('./store');
const pending=new Map();let sequence=0;
function add(word,value,kind){
 word=String(word||'');value=String(value||'');if(!word||word.length>256||!value||value.length>256||/\x00/.test(word+value))return '';
 while(pending.size>=16)pending.delete(pending.keys().next().value);const id=Date.now().toString(36)+(++sequence).toString(36);pending.set(id,{word:store.key(word),value,kind,time:Date.now()});return id;
}
function get(id,word,kind){const item=pending.get(id);if(!item)return '';pending.delete(id);return Date.now()-item.time<=300000&&store.key(word)===item.word&&item.kind===kind?item.value:'';}
function put(word,query){return add(word,query,'match');}
function take(id,word){return get(id,word,'match');}
function putRelated(word,related){return store.key(word)===store.key(related)?'':add(word,related,'related');}
function takeRelated(id,word){return get(id,word,'related');}
function discard(id){pending.delete(id);}
module.exports={put,take,putRelated,takeRelated,discard};
