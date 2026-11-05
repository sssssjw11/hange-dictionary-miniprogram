const image=new Set(['png','jpg','jpeg','gif','webp']),audio=new Set(['mp3','wav','m4a','aac']);
const ignored=new Set(['script','style','iframe','object','embed']);
const classes=node=>((node.attribs||{}).class||'').split(/\s+/);
function text(node){return ignored.has(node.name)?'':node.type==='text'?node.data:(node.children||[]).map(text).join('');}
function find(node,test){if(ignored.has(node.name))return null;if(test(node))return node;for(const child of node.children||[]){const value=find(child,test);if(value)return value;}return null;}
export function resourceKey(value){
 if(typeof value!=='string'||value.length>2048||/[\x00-\x1f\x7f]/.test(value))return null;
 value=value.trim();
 if(/^(sound|res):\/\//i.test(value))value=value.replace(/^(sound|res):\/\//i,'');else if(/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('//'))return null;
 try{if(/%(?![0-9a-fA-F]{2})/.test(value))return null;value=decodeURIComponent(value.split('#')[0].split('?')[0]);}catch(_){return null;}
 value=value.replace(/\\/g,'/').normalize('NFC').replace(/^\/+/,'').toLowerCase();
 if(!value||value.length>512||/[\x00-\x1f\x7f:?#]/.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))return null;
 const ext=value.split('.').pop();return image.has(ext)||audio.has(ext)?value:null;
}
export function mediaReferences(root){
 const rows=[],seen=new Set();
 function visit(node){
  if(ignored.has(node.name))return;
  if(['a','img','audio','source'].includes(node.name)){
   const at=node.attribs||{},value=node.name==='a'?at.href||'':at.src||'',key=node.name==='a'&&!/^sound:\/\//i.test(value)?null:resourceKey(value);
   if(key&&!seen.has(key)){
    seen.add(key);const kind=image.has(key.split('.').pop())?'image':'audio',c=classes(node),variant=c.includes('pron-uk')?'UK':c.includes('pron-us')?'US':'';
    let label=at.alt||at.title||'',pronunciationText='';
    if(kind==='audio'){const title=String(at.title||'').replace(/\s+/g,' ').trim(),match=/^(.+?) pronunciation(?:\s|$)/i.exec(title);let parent=node.parent;for(let count=0;parent&&count<4;count++,parent=parent.parent){if(classes(parent).some(value=>value==='phons_br'||value==='phons_n_am')){if(match)pronunciationText=match[1];break;}}}
    if(kind==='audio'){let parent=node.parent;for(let count=0;parent&&count<4;count++,parent=parent.parent){if(classes(parent).some(value=>value==='entry'||value==='sense'))break;if(parent.name==='li'){const example=find(parent,item=>classes(item).includes('x'));if(example){label='例句 · '+text(example);break;}}}}
    label=Array.from(String(label||key.split('/').pop()).replace(/\s+/g,' ').trim()).slice(0,200).join('');const row={key,kind,variant,label};if(pronunciationText)row.pronunciationText=pronunciationText;rows.push(row);
   }
  }
  for(const child of node.children||[])visit(child);
 }
 visit(root);return rows;
}
