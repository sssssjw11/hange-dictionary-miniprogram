const store=require('../utils/store');const records=require('../utils/records');
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&(!required||!!value.trim());
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const word=value=>text(value,256,true)&&!/[\x00-\x1f]/.test(value);
function invalid(){throw new Error('备份记录格式无效，原数据未修改');}
function array(value,limit,predicate){if(!Array.isArray(value)||value.length>limit||!value.every(item=>object(item)&&predicate(item)))invalid();}
function exportAll(){return JSON.stringify({format:'hange-learning-backup',version:2,created:new Date().toISOString(),learning:store.snapshot(),records:records.snapshot()});}
function validate(type,value){
 if(!records.names.includes(type)||!object(value)||store.bytes(JSON.stringify(value))>2*1024*1024)invalid();
 if(type==='study'){
  if(!object(value.cards)||!object(value.days)||!Array.isArray(value.events)||value.events.length>500||!value.events.every(item=>text(item,256))||!object(value.plan))invalid();
  const plan=value.plan;if(!Number.isInteger(plan.dailyNew)||plan.dailyNew<1||plan.dailyNew>100||!Number.isInteger(plan.dailyReview)||plan.dailyReview<1||plan.dailyReview>300)invalid();
  array(value.decks,30,item=>text(item.id,100,true)&&text(item.name,40,true)&&Array.isArray(item.words)&&item.words.length<=10000&&item.words.every(word));
  for(const [key,card]of Object.entries(value.cards))if(!word(key)||!object(card)||!['repetitions','interval','ease','lapses','due'].every(field=>number(card[field]))||typeof card.known!=='boolean')invalid();
  for(const [day,data]of Object.entries(value.days))if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!object(data)||!['new','review','correct','attempts','seconds'].every(field=>number(data[field])))invalid();
  if(value.pending!=null){const item=value.pending;if(!object(item)||!text(item.id,100,true)||!text(item.deck,100,true)||!['flash','spell','choice'].includes(item.mode)||!Array.isArray(item.words)||item.words.length>400||!item.words.every(word)||!Number.isInteger(item.index)||item.index<0||item.index>item.words.length||!Number.isInteger(item.done)||item.done<0||item.done>item.index)invalid();}
 }else if(type==='library')array(value.articles,100,item=>text(item.id,100,true)&&text(item.title,100,true)&&text(item.text,200000,true)&&number(item.created)&&number(item.progress));
 else if(type==='sentences')array(value.items,2000,item=>text(item.id,100,true)&&text(item.en,6000,true)&&text(item.zh,6000)&&text(item.note,2000)&&text(item.source,120)&&number(item.created)&&number(item.updated));
 else if(type==='chat'){array(value.sessions,30,item=>text(item.id,100,true)&&text(item.title,100)&&['chat','translate','writing','explain','summarize'].includes(item.mode)&&Array.isArray(item.messages)&&item.messages.length<=40&&item.messages.every(message=>object(message)&&['user','assistant'].includes(message.role)&&text(message.content,200000)));if(value.active!=null&&!text(value.active,100,true))invalid();}
 else if(type==='tools')array(value.translations,30,item=>number(item.created)&&['en','zh'].includes(item.target)&&text(item.source,16000)&&text(item.text,200000));
 return value;
}
function unique(current,incoming,id='id'){const result=current.slice(),seen=new Set(current.map(item=>item[id]));for(const item of incoming)if(!seen.has(item[id])){seen.add(item[id]);result.push(item);}return result;}
function merge(type,old,value){if(!Object.keys(old).length)return value;if(type==='study'){const result=Object.assign({},value,old);result.decks=unique(old.decks,value.decks);result.cards=Object.assign(Object.create(null),value.cards,old.cards);result.days=Object.assign({},value.days,old.days);result.events=Array.from(new Set(value.events.concat(old.events))).slice(-500);if(result.decks.length>30)throw new Error('合并后词表超过 30 个，原数据未修改');return result;}const key={library:'articles',sentences:'items',chat:'sessions',tools:'translations'}[type];if(key){const id=type==='tools'?'created':'id';const result=Object.assign({},value,old);result[key]=unique(old[key]||[],value[key]||[],id);const limit={library:100,sentences:2000,chat:30,tools:30}[type];if(result[key].length>limit)throw new Error('合并后的记录超过容量限制，原数据未修改');return result;}return Object.assign({},value,old);}
function parse(text){if(typeof text!=='string'||store.bytes(text)>12*1024*1024)throw new Error('完整备份最大为 12 MiB');let root;try{root=JSON.parse(text);}catch(_){throw new Error('备份不是有效的 JSON');}if(!object(root))invalid();if(root.format==='hange-local-notebook'){store.parseImport(text);return root;}if(root.format!=='hange-learning-backup'||root.version!==2||!object(root.records))throw new Error('不是支持的完整学习备份');store.mergeSnapshot(root.learning);for(const [type,value]of Object.entries(root.records))validate(type,value);return root;}
function importAll(text){const root=parse(text);if(root.format==='hange-local-notebook')return {favorites:store.importJson(text),types:[]};const learning=store.mergeSnapshot(root.learning),prepared=[];for(const [type,value]of Object.entries(root.records)){const merged=merge(type,records.read(type,{}),value);validate(type,merged);prepared.push(records.prepare(type,merged));}records.commit(prepared,learning);return {favorites:learning.favorites.length,types:prepared.map(item=>item.name)};}
module.exports={exportAll,parse,importAll};
