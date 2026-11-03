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
 const result={text:[],chinese:0};
 function visit(node){
  if(node.type==='text'){const text=normalize(node.data);if(text)result.text.push(text);return;}
  if(node.type==='comment'||ignored.has(node.name)||((node.attribs||{}).class||'').split(/\s+/).includes('audio_play_button')||/^sound:/i.test((node.attribs||{}).href||''))return;
  if(node.name==='chn')result.chinese++;
  for(const child of node.children||[])visit(child);
 }
 visit(parseDocument(html,{decodeEntities:true}));return result;
}
const handles=new Map(),failures=[];let documents=0,chinese=0,textNodes=0,blocks=0,maxBlock=0;
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
   for(const block of rendered.blocks)maxBlock=Math.max(maxBlock,Buffer.byteLength(JSON.stringify(block)));
   documents++;chinese+=source.chinese;textNodes+=source.text.length;blocks+=rendered.blocks.length;
   if(documents%10000===0)console.log('Checked '+documents+' / '+manifest.uniqueDocuments+' unique documents');
  }
 }
}finally{for(const fd of handles.values())fs.closeSync(fd);}
const report={sourceSha256:manifest.sourceSha256,definitionRecords:manifest.definitionRecords,redirectRecords:manifest.redirectRecords,uniqueDocuments:documents,chineseNodes:chinese,visibleTextNodes:textNodes,outputBlocks:blocks,maxBlockBytes:maxBlock,failedDocuments:failures.length,firstFailures:failures.slice(0,20),allSourceVisibleTextPreserved:!failures.length,scope:'All text supplied in MDX; absent MDD audio/illustrations and executable markup are excluded',wechatRuntimeTested:false};
fs.writeFileSync(path.join(root,'output/full-corpus-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
assert(documents===manifest.uniqueDocuments,'document count mismatch');assert(!failures.length,'native rendering lost source text');assert(maxBlock<50000,'rich-text block too large');
function assert(value,message){if(!value)throw new Error(message);}
