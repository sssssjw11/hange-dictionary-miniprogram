const KEY='hange.learning.v1';
const SETTINGS='hange.settings.v1';
const HEADS='hange.records.heads.v1';
function key(word){const value=String(word||'');return (value.normalize?value.normalize('NFC'):value).replace(/’/g,"'").replace(/_/g,' ').trim().replace(/\s+/g,' ').toLowerCase();}
function bytes(text){let count=0;for(const char of text){const code=char.codePointAt(0);count+=code<128?1:code<2048?2:code<65536?3:4;}return count;}
function object(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function groupName(value){const name=String(value||'').trim();return name.normalize?name.normalize('NFC'):name;}
function groupKey(value){return groupName(value).toLowerCase();}
function checkedWord(value){const normalized=key(value);if(!normalized||normalized.length>256||/[\x00-\x1f]/.test(normalized))throw new Error('请输入有效的单词或短语');return normalized;}
function validateGroups(value){
 if(!Array.isArray(value)||value.length>30)throw new Error('生词本分组格式无效或超过 30 个');
 const ids=new Set(),names=new Set();
 for(const item of value){
  if(!object(item)||typeof item.id!=='string'||!/^book-[a-z0-9-]{1,90}$/i.test(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>40||ids.has(item.id)||names.has(groupKey(item.name)))throw new Error('生词本分组格式无效或名称重复');
  ids.add(item.id);names.add(groupKey(item.name));
 }
 return value;
}
function read(){
 const combined=wx.getStorageSync(HEADS),value=combined&&combined.learning?combined.learning:wx.getStorageSync(KEY);
 if(!value)return {favorites:[],history:[],groups:[]};
 if(!Array.isArray(value.favorites)||!Array.isArray(value.history))throw new Error('本地学习记录格式异常，请先导出或检查备份');
 const data=JSON.parse(JSON.stringify(value));data.groups=validateGroups(data.groups===undefined?[]:data.groups);
 const ids=new Set(data.groups.map(item=>item.id));
 for(const item of data.favorites){
  if(!object(item)||(item.groups!==undefined&&(!Array.isArray(item.groups)||item.groups.some(id=>!ids.has(id)))))throw new Error('本地生词分组归属异常，请检查完整备份');
  item.groups=Array.from(new Set(item.groups||[]));
 }
 return data;
}
function compact(data){
 const value=Object.assign({},data);value.favorites=data.favorites.map(item=>{if(item.groups&&item.groups.length)return item;const copy=Object.assign({},item);delete copy.groups;return copy;});
 if(!value.groups||!value.groups.length)delete value.groups;return value;
}
function write(value){
 value=compact(value);
 if(bytes(JSON.stringify(value))>850000)throw new Error('生词本接近单条缓存容量，请导出完整备份后整理笔记');
 const combined=wx.getStorageSync(HEADS);
 if(combined&&combined.learning){combined.learning=value;if(bytes(JSON.stringify(combined))>950000)throw new Error('本地学习数据容量不足，请先导出备份');wx.setStorageSync(HEADS,combined);}
 else wx.setStorageSync(KEY,value);
}
function filtered(data,group='all'){
 if(group==='all'||!group)return data.favorites;
 if(group==='ungrouped')return data.favorites.filter(item=>!item.groups.length);
 if(!data.groups.some(item=>item.id===group))throw new Error('这个生词本已不存在，请重新选择');
 return data.favorites.filter(item=>item.groups.includes(group));
}
function favorites(group='all'){return filtered(read(),group).slice().sort((a,b)=>b.updated-a.updated);}
function favorite(word){return read().favorites.find(item=>key(item.word)===key(word))||null;}
function makeFavorite(word,meaning){return {word,meaning:String(meaning||'').slice(0,4000),note:'',groups:[],created:Date.now(),updated:Date.now()};}
function toggle(word,meaning){
 const data=read(),normalized=checkedWord(word),index=data.favorites.findIndex(item=>key(item.word)===normalized);
 if(index>=0)data.favorites.splice(index,1);else data.favorites.push(makeFavorite(normalized,meaning));
 write(data);return index<0;
}
function saveNote(word,meaning,note){
 if(typeof note!=='string'||note.length>4000)throw new Error('笔记最多 4000 字');
 const data=read(),normalized=checkedWord(word);let item=data.favorites.find(item=>key(item.word)===normalized);
 if(!item){item=makeFavorite(normalized,meaning);data.favorites.push(item);}
 item.note=note;item.updated=Date.now();write(data);
}
function groups(){const data=read(),counts=new Map(data.groups.map(group=>[group.id,0]));for(const item of data.favorites)for(const id of item.groups)counts.set(id,counts.get(id)+1);return data.groups.map(group=>Object.assign({},group,{count:counts.get(group.id)}));}
function createGroup(name){
 name=groupName(name);if(!name||name.length>40)throw new Error('生词本名称须为 1～40 字');
 const data=read();if(data.groups.length>=30)throw new Error('最多保留 30 个生词本');
 if(data.groups.some(item=>groupKey(item.name)===groupKey(name)))throw new Error('已有同名生词本');
 const id='book-'+Date.now()+'-'+Math.random().toString(36).slice(2,9);
 data.groups.push({id,name,created:Date.now(),updated:Date.now()});write(data);return id;
}
function renameGroup(id,name){
 name=groupName(name);if(!name||name.length>40)throw new Error('生词本名称须为 1～40 字');
 const data=read(),group=data.groups.find(item=>item.id===id);if(!group)throw new Error('生词本不存在');
 if(data.groups.some(item=>item.id!==id&&groupKey(item.name)===groupKey(name)))throw new Error('已有同名生词本');
 group.name=name;group.updated=Date.now();write(data);
}
function removeGroup(id){
 const data=read();if(!data.groups.some(item=>item.id===id))throw new Error('生词本不存在');
 data.groups=data.groups.filter(item=>item.id!==id);for(const item of data.favorites)item.groups=item.groups.filter(value=>value!==id);
 write(data);
}
function checkedGroupIds(data,ids){
 if(!Array.isArray(ids)||ids.length>30)throw new Error('请选择有效的生词本');
 const known=new Set(data.groups.map(item=>item.id)),unique=Array.from(new Set(ids));
 if(unique.some(id=>!known.has(id)))throw new Error('所选生词本已不存在');
 return unique;
}
function setGroupsMany(words,ids,meaning=''){
 if(!Array.isArray(words)||!words.length||words.length>500)throw new Error('每次可批量整理 1～500 个单词');
 const unique=Array.from(new Set(words.map(checkedWord))),data=read(),selected=checkedGroupIds(data,ids),byWord=new Map(data.favorites.map(item=>[key(item.word),item]));
 for(const word of unique){let item=byWord.get(word);if(!item){item=makeFavorite(word,meaning);data.favorites.push(item);byWord.set(word,item);}item.groups=selected.slice();item.updated=Date.now();}
 write(data);return unique.length;
}
function setGroups(word,ids,meaning=''){return setGroupsMany([word],ids,meaning);}
function visit(word,meaning){
 const data=read(),normalized=checkedWord(word),existing=data.history.find(item=>key(item.word)===normalized);
 data.history=data.history.filter(item=>key(item.word)!==normalized);
 data.history.unshift({word:normalized,meaning:String(meaning||'').split('\n')[0].slice(0,500),visited:Date.now(),hits:existing?existing.hits+1:1});
 data.history=data.history.slice(0,100);write(data);
}
function history(){return read().history;}
function clearHistory(){const data=read();data.history=[];write(data);}
function exportJson(group='all'){
 const items=favorites(group).map(item=>({word:item.word,meaning:item.meaning,note:item.note,created:item.created,updated:item.updated}));
 return JSON.stringify({format:'hange-local-notebook',version:1,items},null,2);
}
function parseItems(items){
 if(!Array.isArray(items)||items.length>2000)throw new Error('一次最多导入 2000 个词条');
 return items.map(item=>{
  if(!object(item)||typeof item.word!=='string'||(item.note!=null&&typeof item.note!=='string')||(item.meaning!=null&&typeof item.meaning!=='string'))throw new Error('备份中含有格式异常的词条');
  const note=item.note||'',meaning=item.meaning||'';if(note.length>4000||meaning.length>4000)throw new Error('备份中的笔记或释义过长');
  return {word:checkedWord(item.word),meaning,note,groups:[],created:Number(item.created)||Date.now(),updated:Date.now()};
 });
}
function parseImport(text){
 if(typeof text!=='string'||bytes(text)>1048576)throw new Error('备份最大为 1 MiB');
 let root;try{root=JSON.parse(text);}catch(_){throw new Error('无法解析备份 JSON');}
 if(!object(root)||root.format!=='hange-local-notebook'||root.version!==1)throw new Error('不是本词典支持的生词本备份');
 return parseItems(root.items);
}
function importJson(text,group=null){
 const items=parseImport(text),data=read();if(group)checkedGroupIds(data,[group]);let count=0;const byWord=new Map(data.favorites.map(item=>[key(item.word),item]));
 for(const incoming of items){let existing=byWord.get(incoming.word);if(!existing){existing=incoming;data.favorites.push(existing);byWord.set(existing.word,existing);count++;}if(group&&!existing.groups.includes(group)){existing.groups.push(group);existing.updated=Date.now();}}
 write(data);return count;
}
function settings(){const value=Object.assign({theme:'system',fontSize:16,apiBase:null,online:true,voiceMode:'auto',voiceVariant:'US',ttsRate:0},wx.getStorageSync(SETTINGS)||{});if(!['auto','tts','original'].includes(value.voiceMode))value.voiceMode='auto';if(!['UK','US'].includes(value.voiceVariant))value.voiceVariant='US';if(![-2,0,2].includes(value.ttsRate))value.ttsRate=0;return value;}
function saveSettings(value){if(value.voiceMode!==undefined&&!['auto','tts','original'].includes(value.voiceMode)||value.voiceVariant!==undefined&&!['UK','US'].includes(value.voiceVariant)||value.ttsRate!==undefined&&![-2,0,2].includes(value.ttsRate))throw new Error('发音设置无效');wx.setStorageSync(SETTINGS,Object.assign(settings(),value));}
function snapshot(){return read();}
function mergeSnapshot(value){
 if(!object(value)||!Array.isArray(value.favorites)||value.favorites.length>10000||!Array.isArray(value.history)||value.history.length>100)throw new Error('学习备份格式无效');
 const incomingGroups=validateGroups(value.groups===undefined?[]:value.groups),incomingIds=new Set(incomingGroups.map(item=>item.id)),data=read(),mapping=new Map();
 for(const group of incomingGroups){
  let existing=data.groups.find(item=>item.id===group.id)||data.groups.find(item=>groupKey(item.name)===groupKey(group.name));
  if(!existing){existing=Object.assign({},group);data.groups.push(existing);}mapping.set(group.id,existing.id);
 }
 validateGroups(data.groups);
 const items=[];for(let index=0;index<value.favorites.length;index+=2000)items.push(...parseItems(value.favorites.slice(index,index+2000)));
 const byWord=new Map(data.favorites.map(item=>[key(item.word),item]));
 for(let index=0;index<items.length;index++){
  const raw=value.favorites[index],groups=raw.groups===undefined?[]:raw.groups;
  if(!Array.isArray(groups)||groups.length>30||groups.some(id=>!incomingIds.has(id)))throw new Error('备份中的生词本归属格式无效');
  const item=items[index];item.groups=Array.from(new Set(groups.map(id=>mapping.get(id))));
  const existing=byWord.get(item.word);
  if(existing)existing.groups=Array.from(new Set(existing.groups.concat(item.groups)));
  else{data.favorites.push(item);byWord.set(item.word,item);}
 }
 const current=new Set(data.history.map(item=>key(item.word)));
 for(const item of value.history){
  if(!object(item)||typeof item.word!=='string'||typeof item.meaning!=='string'||item.meaning.length>4000)throw new Error('历史记录格式无效');
  const word=checkedWord(item.word);
  if(!current.has(word)){current.add(word);data.history.push({word,meaning:item.meaning,visited:Number(item.visited)||0,hits:Number(item.hits)||1});}
 }
 data.history.sort((a,b)=>b.visited-a.visited);data.history=data.history.slice(0,100);
 const merged=compact(data);if(bytes(JSON.stringify(merged))>850000)throw new Error('合并后的生词本容量过大，原数据未修改');
 return merged;
}
module.exports={key,bytes,groupKey,favorites,favorite,toggle,saveNote,groups,createGroup,renameGroup,removeGroup,setGroups,setGroupsMany,visit,history,clearHistory,exportJson,parseImport,importJson,settings,saveSettings,snapshot,mergeSnapshot};
