const library=require('../services/library');
const BLOCKS=new Set(['div','p','li','ul','ol','h1','h2','h3','h4','blockquote']);
function fromBlocks(blocks){
 let result='';
 function line(){if(result&&!result.endsWith('\n'))result+='\n';}
 function visit(node){
  if(!node)return;if(node.type==='text'){result+=String(node.text||'');return;}
  const name=String(node.name||'').toLowerCase();if(name==='br'||name==='hr'){line();return;}
  const style=String((node.attrs||{}).style||''),block=BLOCKS.has(name)||/(?:^|;)\s*display\s*:\s*block\s*(?:;|$)/i.test(style);
  if(block)line();for(const child of node.children||[])visit(child);if(block)line();
 }
 for(const block of blocks||[]){for(const node of block.nodes||[])visit(node);line();}
 return result;
}
function fromExamples(rows){return (rows||[]).map(row=>[row.en||'',row.zh||''].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');}
function ranges(text){return library.ranges(text,1200);}
function tokens(page,selection){
 return library.tokens(page.text,page.start).map(token=>({id:token.id,text:token.text,start:token.start,end:token.end,word:token.word&&token.word.length<=256?token.word:/^\p{Script=Han}$/u.test(token.text)?token.text:'',selected:!!selection&&selection.start<token.end&&selection.end>token.start}));
}
module.exports={fromBlocks,fromExamples,ranges,tokens};
