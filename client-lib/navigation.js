const ignored=new Set(['script','style','link','meta','base','iframe','object','embed','img','audio','video','source','audio-wr']);
const classes=node=>new Set(((node.attribs||{}).class||'').split(/\s+/));
function hidden(node){return node.type==='comment'||ignored.has(node.name)||classes(node).has('audio_play_button')||/^sound:/i.test((node.attribs||{}).href||'');}
function sourceText(node){return hidden(node)?'':node.type==='text'?node.data:(node.children||[]).map(sourceText).join('');}
function headingText(node){return hidden(node)?'':node.type==='text'?node.data:node.name==='chn'?' · '+sourceText(node):(node.children||[]).map(headingText).join('');}
function find(node,test){if(hidden(node))return null;if(test(node))return node;for(const child of node.children||[]){const value=find(child,test);if(value)return value;}return null;}
function excerpt(value){const chars=Array.from(value.replace(/\s+/g,' ').trim());return chars.slice(0,120).join('')+(chars.length>120?'…':'');}
export function sensePrefix(node){return classes(node).has('sense')&&(node.attribs||{}).sensenum?String(node.attribs.sensenum)+'. ':'';}
function heading(node,word){
  const c=classes(node),at=node.attribs||{},byClass=name=>find(node,item=>classes(item).has(name));
  if(c.has('entry'))return{kind:'词性',label:[sourceText(byClass('headword')||{children:[]})||word,sourceText(byClass('pos')||{children:[]})].filter(Boolean).join(' · ')};
  if(c.has('shcut'))return{kind:'主题',label:headingText(node)};
  if(c.has('sense')){const translated=find(node,item=>item.name==='deft'),english=byClass('def');const value=(translated&&sourceText(translated).trim()?sourceText(translated):sourceText(english||{children:[]}))||sourceText(node)||'参见原文';return{kind:'义项',label:(at.sensenum?at.sensenum+'. ':'')+value};}
  if(c.has('unbox')){const title=byClass('box_title')||byClass('unbox-title');return{kind:title?'补充':'搭配',label:sourceText(title||node)||at.unbox||'补充内容'};}
  if(c.has('idm-g'))return{kind:'习语',label:sourceText(byClass('idm')||{children:[]})};
  if(c.has('phrasal_verb_links')){const title=byClass('heading')||find(node,item=>item.name==='h2');return{kind:'短语动词',label:title?sourceText(title):'Phrasal Verbs'};}
  return null;
}
export function navigation(root,blocks,document,word){
  const anchors=[],contents=[],references=[],localLinks=[];let position=0;
  function visit(node){
    if(hidden(node))return;
    if(node.type==='text'){position+=node.data.length;return;}
    const at=node.attribs||{},c=classes(node),id=at.id||(node.name==='a'?at.name:'');
    if(id)anchors.push({id,document,position});
    const title=heading(node,word);if(title&&title.label.trim())contents.push({key:document+'-'+contents.length,document,position,id:id||'',kind:title.kind,label:excerpt(title.label)});
    const href=at.href||'';
    try{
      if(href.startsWith('#')&&href.length>1)localLinks.push({anchor:decodeURIComponent(href.slice(1)),document,label:excerpt(sourceText(node))});
      else if(/^(entry|dic|bword):\/\//i.test(href)){
        const target=href.split('://')[1],hash=target.indexOf('#'),word=decodeURIComponent(hash<0?target:target.slice(0,hash)),anchor=hash<0?'':decodeURIComponent(target.slice(hash+1));
        if(word&&word.length<=256&&!word.startsWith('@'))references.push({word,anchor,label:excerpt(sourceText(node))||word});
      }
    }catch(_){}
    if(c.has('phons_br'))position+=2;if(c.has('phons_n_am'))position+=2;
    position+=sensePrefix(node).length;
    for(const child of node.children||[])visit(child);
  }
  visit(root);
  const ends=[];let size=0;for(const block of blocks){size+=nodeLength({children:block.nodes});ends.push(size);}
  function locate(marker){
    if(!blocks.length)return Object.assign({},marker,{blockIndex:-1,offset:0});
    let left=0,right=ends.length-1;
    while(left<right){const middle=(left+right)>>>1;if(ends[middle]>marker.position)right=middle;else left=middle+1;}
    return Object.assign({},marker,{blockIndex:left,offset:marker.position-(left?ends[left-1]:0)});
  }
  return{anchors:anchors.map(locate),contents:contents.map(locate),references,localLinks};
}
export function nodeLength(node){return node.type==='text'?node.text.length:(node.children||[]).reduce((sum,child)=>sum+nodeLength(child),0);}
function splitNodes(nodes,offset){
  if(offset===0)return[[],nodes];
  const before=[],after=[];let remaining=offset,passed=false;
  for(const node of nodes){
    if(passed){after.push(node);continue;}
    const length=nodeLength(node);
    if(remaining>=length){before.push(node);remaining-=length;continue;}
    if(node.type==='text'){
      const value=node.text;
      if(remaining>0&&/[\uD800-\uDBFF]/.test(value[remaining-1])&&/[\uDC00-\uDFFF]/.test(value[remaining]))throw new Error('定位不能切断完整字符');
      if(remaining)before.push({type:'text',text:value.slice(0,remaining)});
      after.push({type:'text',text:value.slice(remaining)});
    }else{
      const [a,b]=splitNodes(node.children||[],remaining);
      if(a.length)before.push(Object.assign({},node,{children:a}));if(b.length)after.push(Object.assign({},node,{children:b}));
    }
    passed=true;
  }
  if(remaining>0&&!passed)throw new Error('原文定位超出正文范围');
  return[before,after];
}
export function focusOxford(oxford,target){
  const index=target.blockIndex,source=oxford.blocks[index];
  if(!Number.isInteger(index)||!source||!Number.isInteger(target.offset)||target.offset<0||target.offset>nodeLength({children:source.nodes}))throw new Error('原文定位已失效，请重新查询');
  const [before,after]=splitNodes(source.nodes,target.offset),focusId=source.id+'-focus';
  const middle=[];if(before.length)middle.push({id:source.id+'-before',nodes:before});middle.push({id:focusId,nodes:after});
  return{blocks:oxford.blocks.slice(0,index).concat(middle,oxford.blocks.slice(index+1)),index:index+(before.length?1:0),id:focusId,originalIndex:index};
}
