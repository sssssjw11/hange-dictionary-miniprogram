const store=require('./store');
function nodeText(node){return node.type==='text'?String(node.text||''):(node.children||[]).map(nodeText).join('');}
function normalizedMap(raw){
 const chars=[],starts=[],ends=[];let cluster='',begin=0,position=0;
 function append(){
  if(!cluster)return;const value=(cluster.normalize?cluster.normalize('NFC'):cluster).replace(/’/g,"'").replace(/_/g,' ').toLowerCase();
  for(let index=0;index<value.length;index++){let char=value[index];if(/\s/.test(char)){if(!chars.length||chars[chars.length-1]===' ')continue;char=' ';}chars.push(char);starts.push(begin);ends.push(position);}
 }
 for(const char of raw){if(cluster&&!/^\p{M}$/u.test(char)){append();cluster='';begin=position;}if(!cluster)begin=position;cluster+=char;position+=char.length;}
 append();if(chars[chars.length-1]===' '){chars.pop();starts.pop();ends.pop();}
 return {text:chars.join(''),starts,ends};
}
function find(blocks,query){
 const needle=store.key(query);if(!needle||needle.length>256)return [];
 const pieces=(blocks||[]).map(block=>(block.nodes||[]).map(nodeText).join('')),ends=[];let length=0;for(const piece of pieces){length+=piece.length;ends.push(length);}if(!length)return [];
 const raw=pieces.join(''),mapped=normalizedMap(raw),canonical=store.key(raw),hits=[];
 function add(start,end,contextual=false){
  if(!contextual&&store.key(raw.slice(start,end))!==needle)return;let low=0,high=ends.length-1;while(low<high){const middle=(low+high)>>>1;if(ends[middle]>start)high=middle;else low=middle+1;}
  hits.push({blockIndex:low,offset:start-(low?ends[low-1]:0),start,end});
 }
 let sameShape=mapped.text.length===canonical.length;for(let index=0;sameShape&&index<canonical.length;index++)sameShape=mapped.text[index]===canonical[index]||('σς'.includes(mapped.text[index])&&'σς'.includes(canonical[index]));
 if(sameShape){
  let offset=0,last='';while((offset=canonical.indexOf(needle,offset))!==-1){const lastIndex=offset+needle.length-1,start=mapped.starts[offset],end=mapped.ends[lastIndex],key=start+':'+end,aligned=(offset===0||mapped.starts[offset-1]!==start)&&(lastIndex+1===mapped.starts.length||mapped.starts[lastIndex+1]!==mapped.starts[lastIndex]);if(key!==last&&aligned){add(start,end,true);last=key;}offset++;}
 }else{
  const pattern=Array.from(needle).map(char=>char===' '?'[\\s_]+':char==="'"?"['’]":char.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
  const expression=new RegExp(pattern,'giu');let match;while((match=expression.exec(raw))){add(match.index,match.index+match[0].length);expression.lastIndex=match.index+(raw.codePointAt(match.index)>0xffff?2:1);}
 }
 return hits;
}
module.exports={find};
