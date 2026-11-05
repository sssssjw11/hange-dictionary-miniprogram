const store=require('./store');
const pending=new Map();let sequence=0;
function put(word,query){
 word=String(word||'');query=String(query||'');if(!word||word.length>256||!query||query.length>256||/\x00/.test(word+query))return '';
 while(pending.size>=16)pending.delete(pending.keys().next().value);const id=Date.now().toString(36)+(++sequence).toString(36);pending.set(id,{word:store.key(word),query,time:Date.now()});return id;
}
function take(id,word){const item=pending.get(id);if(!item)return '';pending.delete(id);return Date.now()-item.time<=300000&&store.key(word)===item.word?item.query:'';}
function discard(id){pending.delete(id);}
module.exports={put,take,discard};
