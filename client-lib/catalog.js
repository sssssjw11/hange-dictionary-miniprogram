import {parseDocument} from 'htmlparser2';
import {resourceKey} from './resources';
const ignored=new Set(['script','style','audio','video','img','iframe']);
function text(node){if(ignored.has(node.name))return '';return node.type==='text'?node.data:(node.children||[]).map(text).join('');}
function find(node,test){if(ignored.has(node.name))return null;if(test(node))return node;for(const child of node.children||[]){const hit=find(child,test);if(hit)return hit;}return null;}
const hasClass=(node,name)=>((node.attribs||{}).class||'').split(/\s+/).includes(name);
const human=value=>value.replace(/[_-]+/g,' ').replace(/^./,char=>char.toUpperCase());
function audioLinks(node){
 const result={};function visit(item){if(ignored.has(item.name))return;if(item.name==='a'){
  const href=(item.attribs||{}).href||'',variant=hasClass(item,'pron-uk')?'UK':hasClass(item,'pron-us')?'US':'',key=/^sound:\/\//i.test(href)?resourceKey(href):null;
  if(variant&&key&&/\.(mp3|wav|m4a|aac)$/.test(key)){if(!result[variant])result[variant]=[];if(!result[variant].includes(key))result[variant].push(key);}
 }for(const child of item.children||[])visit(child);}visit(node);return result;
}
export function wordListReference(word){
  if(typeof word!=='string'||word.length>256||/[\x00-\x1f]/.test(word))return null;
  const core=/^@ox(3000|5000)(?:&level=([abc][12]))?$/.exec(word);
  if(core){const level=core[2]||'',size=core[1]==='3000'&&level==='c1'?'5000':core[1];if(level==='c2')return null;return{id:'ox'+size+':'+(level||'all'),name:'牛津'+size+' · '+(level?level.toUpperCase():'全部')};}
  const opal=/^@opal_(written|spoken)(?:&level=sublist_(\d+))?$/.exec(word);
  if(opal){const part=Number(opal[2]||0);if(opal[2]&&(!part||part>(opal[1]==='written'?12:6)))return null;return{id:'opal:'+opal[1]+':'+(part?'sublist_'+part:'all'),name:'OPAL 学术'+(opal[1]==='written'?'书面语':'口语')+' · '+(part?'词汇分表 '+part:'全部')};}
  const topic=/^@topic_([a-z0-9][a-z0-9_-]*?)(?:_level=([abc][12]))?$/.exec(word);
  return topic?{id:'topic:'+topic[1]+':'+(topic[2]||'all'),name:human(topic[1])+' · '+(topic[2]?topic[2].toUpperCase():'全部')}:null;
}
export function parseWordList(html){
  const result=[];
  function visit(node){
    if(ignored.has(node.name))return;
    const at=node.attribs||{},word=(at['data-hw']||'').trim();
    if(word&&word.length<=256&&!/[\x00-\x1f]/.test(word)){
      const pos=find(node,item=>hasClass(item,'pos')),level=find(node,item=>hasClass(item,'belong-to'));
      const link=find(node,item=>/^entry:\/\//i.test((item.attribs||{}).href||''));
      let query=word,anchor='';
      if(link)try{const target=link.attribs.href.slice(8),hash=target.indexOf('#');query=decodeURIComponent(hash<0?target:target.slice(0,hash));anchor=hash<0?'':decodeURIComponent(target.slice(hash+1));}catch(_){}
      const academic=find(node,item=>/^\/definition\/academic\//.test((item.attribs||{}).href||''));let relatedWord='';
      if(academic)try{relatedWord=decodeURIComponent(academic.attribs.href.split('/').pop().split('#')[0]);}catch(_){}
      const fields={};for(const [key,value] of Object.entries(at))if(key.startsWith('data-'))fields[key]=value;
      const audio=audioLinks(node);
      const row={word,pos:pos?text(pos).trim():'',level:level&&/^[ABC][12]$/.test(text(level).trim().toUpperCase())?text(level).trim().toUpperCase():'',query,anchor,relatedWord:relatedWord.toLowerCase()===word.toLowerCase()?'':relatedWord,fields};if(Object.keys(audio).length)row.audio=audio;result.push(row);
      return;
    }
    for(const child of node.children||[])visit(child);
  }
  visit(parseDocument(html,{decodeEntities:true}));return result;
}
export function opalWordListFields(rows){
  const result={written:[],spoken:[],writtenPhrases:false,spokenPhrases:false,writtenCategories:[],spokenCategories:[]};
  for(const row of rows)for(const type of ['written','spoken']){
    const part=row.fields['data-opal_'+type];if(part&&!result[type].includes(part))result[type].push(part);
    const category=row.fields['data-opal_'+type+'_phrases'];if(category){result[type+'Phrases']=true;if(!result[type+'Categories'].includes(category))result[type+'Categories'].push(category);}
  }
  for(const type of ['written','spoken']){result[type].sort((a,b)=>Number(a.split('_').pop())-Number(b.split('_').pop()));result[type+'Categories'].sort();}
  return result;
}
export function describeWordLists(words,opal={}){
  const available=new Set(words),result=[];
  if(available.has('@ox3000'))for(const size of ['3000','5000'])for(const level of ['', 'a1','a2','b1','b2',...(size==='5000'?['c1']:[])]){
    result.push({id:'ox'+size+':'+(level||'all'),name:'牛津'+size+' · '+(level?level.toUpperCase():'全部'),group:'核心与等级',sourceKey:'@ox3000',column:'data-ox'+size,value:level,kind:'oxford'});
  }
  const opalSource=words.find(word=>/^@opal_(written|spoken)&level=sublist_\d+$/.test(word));
  if(opalSource)for(const type of ['written','spoken']){
    const label='OPAL 学术'+(type==='written'?'书面语':'口语'),parts=opal[type]||[];
    if(parts.length||opal[type+'Phrases'])result.push({id:'opal:'+type+':all',name:label+' · 全部',group:'学术词表',sourceKey:opalSource,column:'data-opal_'+type,kind:'opal',value:''});
    if(opal[type+'Phrases'])result.push({id:'opal:'+type+':phrases',name:label+' · 短语',group:'学术词表',sourceKey:opalSource,column:'data-opal_'+type+'_phrases',kind:'opal',value:''});
    for(const part of parts)result.push({id:'opal:'+type+':'+part,name:label+' · 词汇分表 '+part.split('_').pop(),group:'学术词表',sourceKey:opalSource,column:'data-opal_'+type,kind:'opal',value:part});
    for(const category of opal[type+'Categories']||[])result.push({id:'opal:'+type+':phrase:'+category,name:label+' · '+human(category),group:'学术短语分类',sourceKey:opalSource,column:'data-opal_'+type+'_phrases',kind:'opal',value:category});
  }
  for(const word of words){const match=/^@topic_(.+?)(?:_level=([abc][12]))?$/.exec(word);if(match)result.push({id:'topic:'+match[1]+':'+(match[2]||'all'),name:human(match[1])+' · '+(match[2]?match[2].toUpperCase():'全部'),group:'牛津主题',sourceKey:word,column:'',value:'',kind:'topic'});}
  return result;
}
export function selectWordList(rows,descriptor){
  const result=[];
  for(const row of rows){
    const value=row.fields[descriptor.column]||'',phraseValue=descriptor.kind==='opal'?row.fields[descriptor.column+'_phrases']||'':'';
    if(descriptor.column&&!(descriptor.value?value===descriptor.value:value||phraseValue))continue;
    const level=descriptor.kind==='oxford'?value.toUpperCase():row.level;
    const category=descriptor.kind==='opal'?(value||phraseValue):'';
    const note=category?(/^sublist_\d+$/.test(category)?'词汇分表 '+category.split('_').pop():human(category)):'';
    const selected={word:row.word,pos:row.pos,level,query:row.query,anchor:row.anchor,relatedWord:row.relatedWord,note};if(row.audio)selected.audio=row.audio;result.push(selected);
  }
  return {id:descriptor.id,name:descriptor.name,group:descriptor.group,rows:result,sourceRecords:result.length,uniqueWords:new Set(result.map(row=>row.word.normalize('NFC').replace(/_/g,' ').replace(/’/g,"'").trim().replace(/\s+/g,' ').toLowerCase())).size};
}
