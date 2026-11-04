const store=require('./store');
const HAN=/[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{3ffff}]+/gu;
function hasHan(value){return /[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{3ffff}]/u.test(value);}
function queryTerms(value,singleCharacter=true){
  const terms=new Set();
  for(const phrase of store.key(value).match(HAN)||[]){
    const characters=Array.from(phrase);
    if(characters.length===1&&singleCharacter)terms.add(phrase);
    for(let i=0;i+1<characters.length;i++)terms.add(characters[i]+characters[i+1]);
  }
  return Array.from(terms).sort();
}
function meaningRank(brief,term){
  brief=store.key(brief);term=store.key(term);
  if(brief===term||brief.split(/[/；;、，,]/u).some(part=>part.trim()===term))return 0;
  if(brief.startsWith(term))return 1;
  return brief.includes(term)?2:3;
}
module.exports={hasHan,queryTerms,meaningRank};
