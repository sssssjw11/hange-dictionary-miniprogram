// Exhaustive check of every unique imported body against native rich-text output.
// Input and detailed output stay local; no dictionary content is published.
const fs=require('node:fs');
const path=require('node:path');
const {parseDocument}=require('htmlparser2');
const codec=require('../miniprogram/vendor/codec');
const root=path.resolve(__dirname,'..');
const folder=process.argv[2]||path.join(root,'output/offline-pack-build');
const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
const ignored=new Set(['script','style','link','meta','base','iframe','object','embed','img','audio','video','source','audio-wr']);
const normalize=value=>value.replace(/\s/g,'');
function nodeText(nodes){return nodes.map(node=>node.type==='text'?node.text:nodeText(node.children||[])).join('');}
function expected(html){
 const result={text:[],chinese:0,related:new Set(),anchors:[],references:new Set()};let position=0;
 function visit(node){
  if(node.type==='text'){const text=normalize(node.data);if(text)result.text.push(text);position+=node.data.length;return;}
  if(node.type==='comment'||ignored.has(node.name)||((node.attribs||{}).class||'').split(/\s+/).includes('audio_play_button')||/^sound:/i.test((node.attribs||{}).href||''))return;
  if(node.name==='chn')result.chinese++;
  const attr=node.attribs||{},classes=(attr.class||'').split(/\s+/),identifier=attr.id||(node.name==='a'?attr.name:'');
  if(identifier)result.anchors.push({id:identifier,position});
  if(classes.includes('phons_br'))position+=2;if(classes.includes('phons_n_am'))position+=2;
  if(classes.includes('sense')&&attr.sensenum)position+=String(attr.sensenum).length+2;
  const href=(node.attribs||{}).href||'';
  if(/^(entry|dic|bword):\/\//i.test(href))try{const raw=href.split('://')[1],hash=raw.indexOf('#'),target=decodeURIComponent(hash<0?raw:raw.slice(0,hash)),anchor=hash<0?'':decodeURIComponent(raw.slice(hash+1));if(target.length>0&&target.length<=256&&!target.startsWith('@')){result.related.add(target);result.references.add(JSON.stringify([target,anchor]));}}catch(_){}
  for(const child of node.children||[])visit(child);
 }
 visit(parseDocument(html,{decodeEntities:true}));return result;
}
const handles=new Map(),failures=[];let documents=0,chinese=0,textNodes=0,blocks=0,maxBlock=0,relatedReferences=0,longRelatedReferences=0,maxRelated=0,sourceAnchors=0,entryTargets=0,focusedPositions=0,senseSections=0;
try{
 const shards=Object.keys(manifest.files).filter(name=>/^docs\//.test(name)).sort();
 for(const shard of shards){
  const rows=JSON.parse(fs.readFileSync(path.join(folder,shard),'utf8'));
  for(const [id,row]of Object.entries(rows)){
   const part=path.join(folder,'parts',String(row[0]).padStart(3,'0')+'.bin');
   if(!handles.has(part))handles.set(part,fs.openSync(part,'r'));
   const buffer=Buffer.alloc(row[2]);assert(fs.readSync(handles.get(part),buffer,0,row[2],row[1])===row[2],'short read');
   const html=codec.strFromU8(codec.unzlibSync(buffer)),source=expected(html),rendered=codec.renderOxford([{word:row[3],html}]);
   const text=normalize(rendered.blocks.map(block=>nodeText(block.nodes)).join(''));
   let position=0,missing=false;
   for(const fragment of source.text){const next=text.indexOf(fragment,position);if(next<0){missing=true;break;}position=next+fragment.length;}
   if(missing||source.chinese!==rendered.chineseNodes)failures.push({id,word:row[3],textPreserved:!missing,sourceChinese:source.chinese,outputChinese:rendered.chineseNodes});
   const absent=Array.from(source.related).filter(target=>!rendered.related.includes(target));
   if(absent.length)failures.push({id,word:row[3],missingRelated:absent});
   const anchors=rendered.anchors||[],targets=new Set((rendered.references||[]).map(item=>JSON.stringify([item.word,item.anchor])));
   const senses=rendered.contents.filter(item=>item.kind==='义项').length;if(senses!==rendered.senses)failures.push({id,word:row[3],senseSections:senses,sourceSenses:rendered.senses});senseSections+=senses;
   if(anchors.length!==source.anchors.length||source.anchors.some((item,i)=>!anchors[i]||anchors[i].id!==item.id||anchors[i].position!==item.position))failures.push({id,word:row[3],navigationAnchorsPreserved:false});
   if(Array.from(source.references).some(target=>!targets.has(target)))failures.push({id,word:row[3],referenceFragmentsPreserved:false});
   const original=JSON.stringify(rendered.blocks),blockTexts=rendered.blocks.map(block=>nodeText(block.nodes)),seenPoints=new Set();
   for(const marker of anchors){
    if(marker.blockIndex<0)continue;
    const key=marker.blockIndex+':'+marker.offset;if(seenPoints.has(key))continue;seenPoints.add(key);
    const focus=codec.focusOxford(rendered,marker),tail=nodeText(focus.blocks[focus.index].nodes),before=focus.index>marker.blockIndex?nodeText(focus.blocks[focus.index-1].nodes):'';
    if(before+tail!==blockTexts[marker.blockIndex]||tail!==blockTexts[marker.blockIndex].slice(marker.offset))failures.push({id,word:row[3],focusPreserved:false,anchor:marker.id});
    focusedPositions++;
   }
   if(JSON.stringify(rendered.blocks)!==original)failures.push({id,word:row[3],focusMutatedOriginal:true});
   sourceAnchors+=source.anchors.length;entryTargets+=source.references.size;
   relatedReferences+=source.related.size;longRelatedReferences+=Array.from(source.related).filter(target=>target.length>80).length;maxRelated=Math.max(maxRelated,source.related.size);
   for(const block of rendered.blocks)maxBlock=Math.max(maxBlock,Buffer.byteLength(JSON.stringify(block)));
   documents++;chinese+=source.chinese;textNodes+=source.text.length;blocks+=rendered.blocks.length;
   if(documents%10000===0)console.log('Checked '+documents+' / '+manifest.uniqueDocuments+' unique documents');
  }
 }
}finally{for(const fd of handles.values())fs.closeSync(fd);}
const report={sourceSha256:manifest.sourceSha256,definitionRecords:manifest.definitionRecords,redirectRecords:manifest.redirectRecords,uniqueDocuments:documents,chineseNodes:chinese,visibleTextNodes:textNodes,outputBlocks:blocks,maxBlockBytes:maxBlock,relatedReferences,longRelatedReferences,maxRelatedPerDocument:maxRelated,sourceAnchors,entryTargetsIncludingFragments:entryTargets,focusedPositions,senseSections,failedDocuments:failures.length,firstFailures:failures.slice(0,20),allSourceVisibleTextPreserved:!failures.length,allSupportedSourceLinksPreserved:!failures.length,allSourceAnchorsAndFocusTextPreserved:!failures.length,scope:'All supplied text, source anchors, supported entry targets including fragments, focused text splits, and every sense section; source-missing targets are reported separately. Absent MDD media and executable scripts are excluded.',wechatRuntimeTested:false};
fs.writeFileSync(path.join(root,'output/full-corpus-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
assert(documents===manifest.uniqueDocuments,'document count mismatch');assert(!failures.length,'native rendering lost source text');assert(maxBlock<50000,'rich-text block too large');
function assert(value,message){if(!value)throw new Error(message);}
