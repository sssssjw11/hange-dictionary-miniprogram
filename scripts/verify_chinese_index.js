// Independently audit the Python-built index against every supplied source body.
const fs=require('node:fs'),path=require('node:path');
const {parseDocument}=require('htmlparser2');
const codec=require('../miniprogram/vendor/codec');
const root=path.resolve(__dirname,'..'),folder=process.argv[2]||path.join(root,'output/offline-pack-build');
const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
if(!manifest.chineseSingleCharacter)throw new Error('Generate a pack with single-character indexing before this audit.');
const ignored=new Set(['script','style','link','meta','base','iframe','object','embed','img','audio','video','source','audio-wr']);
function text(node){
  if(node.type==='text')return node.data;
  if(node.type==='comment'||ignored.has(node.name)||((node.attribs||{}).class||'').split(/\s+/).includes('audio_play_button')||/^sound:/i.test((node.attribs||{}).href||''))return '';
  return (node.children||[]).map(text).join('');
}
function present(values,identifier){
  let left=0,right=values.length-1;
  while(left<=right){const mid=(left+right)>>>1;if(values[mid]===identifier)return true;if(values[mid]<identifier)left=mid+1;else right=mid-1;}
  return false;
}
const postings=new Map(),handles=new Map(),failures=[];let actualPairs=0,expectedPairs=0,documents=0,missingPairs=0;
for(const name of Object.keys(manifest.files).filter(name=>/^zh\/[0-9a-f]{2}\.z$/.test(name))){
  const values=JSON.parse(codec.strFromU8(codec.unzlibSync(fs.readFileSync(path.join(folder,name)))));
  for(const [term,encoded]of Object.entries(values)){
    const identifiers=codec.decodeDeltas(encoded);
    if(identifiers.some((id,index)=>id<0||id>=manifest.uniqueDocuments||index>0&&id<=identifiers[index-1]))throw new Error('Invalid posting order: '+name);
    postings.set(term,identifiers);actualPairs+=identifiers.length;
  }
}
try{
  for(const name of Object.keys(manifest.files).filter(name=>/^docs\/[0-9]{3}\.json$/.test(name)).sort()){
    for(const [key,row]of Object.entries(JSON.parse(fs.readFileSync(path.join(folder,name),'utf8')))){
      const identifier=Number(key),part=row[0];
      if(!Number.isInteger(part)||part<0||part>999||!Number.isInteger(row[1])||row[1]<0||!Number.isInteger(row[2])||row[2]<0||row[2]>48*1024*1024)throw new Error('Invalid body reference: '+key);
      if(!handles.has(part))handles.set(part,fs.openSync(path.join(folder,'parts',String(part).padStart(3,'0')+'.bin'),'r'));
      const body=Buffer.alloc(row[2]);
      if(fs.readSync(handles.get(part),body,0,body.length,row[1])!==body.length)throw new Error('Short body read: '+key);
      const source=text(parseDocument(codec.strFromU8(codec.unzlibSync(body)),{decodeEntities:true})).normalize('NFC').replace(/’/g,"'").replace(/_/g,' ').toLowerCase().trim().replace(/\s+/g,' ');
      const expected=new Set();
      // Script=Han is independent of the builder's explicit CJK ranges.
      for(const phrase of source.match(/\p{Script=Han}+/gu)||[]){
        const characters=Array.from(phrase);
        for(let i=0;i<characters.length;i++){expected.add(characters[i]);if(i+1<characters.length)expected.add(characters[i]+characters[i+1]);}
      }
      expectedPairs+=expected.size;
      for(const term of expected)if(!present(postings.get(term)||[],identifier)){missingPairs++;if(failures.length<20)failures.push({identifier,word:row[3],term});}
      documents++;if(documents%10000===0)console.log('Checked Chinese index '+documents+' / '+manifest.uniqueDocuments);
    }
  }
}finally{for(const handle of handles.values())fs.closeSync(handle);}
const report={sourceSha256:manifest.sourceSha256,uniqueDocuments:documents,indexedTerms:postings.size,expectedSourceHanPairs:expectedPairs,actualIndexedPairs:actualPairs,missingPairs,firstFailures:failures,allSourceHanCharactersAndBigramsIndexed:missingPairs===0&&documents===manifest.uniqueDocuments,scope:'Every Han-script single character and adjacent pair in visible supplied source text, including text outside chn tags. This does not verify absent media or phone hardware.'};
fs.writeFileSync(path.join(root,'output/chinese-index-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.allSourceHanCharactersAndBigramsIndexed)throw new Error('Chinese index coverage is incomplete.');
