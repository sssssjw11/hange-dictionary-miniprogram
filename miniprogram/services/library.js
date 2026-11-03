const records=require('../utils/records');
const COLORS=['yellow','green','blue'];
const WORD=/[A-Za-zÀ-ÖØ-öø-ɏ][A-Za-zÀ-ÖØ-öø-ɏ\u0300-\u036f]*(?:['’-][A-Za-zÀ-ÖØ-öø-ɏ][A-Za-zÀ-ÖØ-öø-ɏ\u0300-\u036f]*)*/g;
function state(){return records.read('library',{articles:[]});}
function list(){return state().articles.map(item=>({id:item.id,title:item.title,characters:item.text.length,progress:item.progress||0,annotations:(item.annotations||[]).length,created:item.created})).sort((a,b)=>b.created-a.created);}
function get(id){return state().articles.find(item=>item.id===id)||null;}
function add(title,text){
 title=(String(title||'').trim()||'未命名文章').slice(0,100);text=String(text||'').replace(/\r/g,'');
 if(!text.trim()||text.length>200000)throw new Error('单篇文章须为 1～200000 字，较长书籍请按章节导入');
 const data=state();if(data.articles.length>=100)throw new Error('书架最多保留 100 篇文章，请先导出或整理旧内容');
 const item={id:'read-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),title,text,created:Date.now(),progress:0,annotations:[]};
 data.articles.unshift(item);records.write('library',data);return item.id;
}
function remove(id){const data=state();data.articles=data.articles.filter(item=>item.id!==id);records.write('library',data);}
function progress(id,index){const data=state(),item=data.articles.find(item=>item.id===id);if(item){item.progress=Math.max(0,Number(index)||0);records.write('library',data);}}
function ranges(text,maxLength=1800){
 if(!Number.isInteger(maxLength)||maxLength<2)throw new Error('无效的阅读分页长度');
 const result=[];let start=0;
 while(start<text.length){
  let end=Math.min(start+maxLength,text.length);
  if(end<text.length){const found=text.lastIndexOf(' ',end-1);if(found>start+maxLength/2)end=found+1;if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;}
  result.push({start,end,text:text.slice(start,end)});start=end;
 }
 return result.length?result:[{start:0,end:0,text:''}];
}
function pages(text,maxLength=1800){return ranges(text,maxLength).map(page=>page.text);}
function tokens(text,start=0){
 const result=[];let offset=0;WORD.lastIndex=0;let match;
 function nonwords(end){for(const value of text.slice(offset,end)){const begin=offset;offset+=value.length;result.push({id:start+begin,start:start+begin,end:start+offset,text:value,word:''});}}
 while((match=WORD.exec(text))){nonwords(match.index);offset=match.index+match[0].length;result.push({id:start+match.index,start:start+match.index,end:start+offset,text:match[0],word:match[0]});}
 nonwords(text.length);return result;
}
function boundary(text,offset){return offset===0||offset===text.length||!(/[\uD800-\uDBFF]/.test(text[offset-1])&&/[\uDC00-\uDFFF]/.test(text[offset]));}
function preview(text,max){let end=Math.min(text.length,max);if(!boundary(text,end))end--;return text.slice(0,end);}
function validAnnotation(item,text){
 return !!item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.id==='string'&&item.id.length>0&&item.id.length<=100&&Number.isInteger(item.start)&&Number.isInteger(item.end)&&item.start>=0&&item.end>item.start&&item.end<=text.length&&item.end-item.start<=6000&&boundary(text,item.start)&&boundary(text,item.end)&&typeof item.note==='string'&&item.note.length<=4000&&COLORS.includes(item.color)&&['highlight','bookmark'].includes(item.kind)&&Number.isFinite(item.created)&&item.created>=0&&Number.isFinite(item.updated)&&item.updated>=0;
}
function validateArticleAnnotations(article){
 const items=article.annotations===undefined?[]:article.annotations;
 if(!Array.isArray(items)||items.length>1000||!items.every(item=>validAnnotation(item,article.text))||new Set(items.map(item=>item.id)).size!==items.length)throw new Error('阅读批注格式无效，原数据未修改');
 return items;
}
function annotations(articleId=null){
 const result=[];
 for(const article of state().articles){if(articleId&&article.id!==articleId)continue;for(const item of article.annotations||[])result.push(Object.assign({},item,{articleId:article.id,title:article.title,quote:article.text.slice(item.start,item.end)}));}
 return result.sort((a,b)=>a.articleId.localeCompare(b.articleId)||a.start-b.start||b.updated-a.updated);
}
function annotationSummaries(articleId=null,query=''){
 const result=[],needle=String(query).toLowerCase();
 for(const article of state().articles){
  if(articleId&&article.id!==articleId)continue;
  for(const item of article.annotations||[]){
   if(needle&&!(article.title+item.note+article.text.slice(item.start,item.end)).toLowerCase().includes(needle))continue;
   result.push({key:article.id+':'+item.id,id:item.id,articleId:article.id,title:article.title,start:item.start,end:item.end,color:item.color,kind:item.kind,quote:preview(article.text.slice(item.start,item.end),180),quoteLength:item.end-item.start,note:preview(item.note,240),noteLength:item.note.length,updated:item.updated});
  }
 }
 return result.sort((a,b)=>b.updated-a.updated||a.start-b.start);
}
function mark(articleId,start,end,note='',color='yellow',id='',kind='highlight'){
 const data=state(),article=data.articles.find(item=>item.id===articleId);if(!article)throw new Error('阅读材料不存在');
 const items=article.annotations||[],existing=id?items.find(item=>item.id===id):null;
 if(id&&!existing)throw new Error('这条批注已不存在，请刷新后重试');
 const item={id:id||'mark-'+Date.now()+'-'+Math.random().toString(36).slice(2,9),start,end,note,color,kind,created:existing?existing.created:Date.now(),updated:Date.now()};
 if(!validAnnotation(item,article.text))throw new Error('请选择有效的原文范围，最多 6000 字；批注最多 4000 字');
 if(!existing&&items.length>=1000)throw new Error('每篇最多保存 1000 条高亮、批注或书签');
 article.annotations=existing?items.map(value=>value.id===id?item:value):items.concat(item);records.write('library',data);return item.id;
}
function removeAnnotation(articleId,id){const data=state(),article=data.articles.find(item=>item.id===articleId);if(!article)throw new Error('阅读材料不存在');article.annotations=(article.annotations||[]).filter(item=>item.id!==id);records.write('library',data);}
function bookmark(articleId,offset,label=''){
 const article=get(articleId);if(!article)throw new Error('阅读材料不存在');const existing=(article.annotations||[]).find(item=>item.kind==='bookmark'&&item.start===offset);
 if(existing){removeAnnotation(articleId,existing.id);return false;}
 const first=Array.from(article.text.slice(offset))[0];if(!first)throw new Error('当前位置没有可保存的正文');
 mark(articleId,offset,offset+first.length,String(label||'阅读书签').slice(0,120),'blue','','bookmark');return true;
}
function pageForOffset(pages,offset){let low=0,high=pages.length-1;while(low<high){const middle=Math.floor((low+high+1)/2);if(pages[middle].start<=offset)low=middle;else high=middle-1;}return low;}
function decorated(text,start=0,marks=[],selection=null){
 const relevant=marks.filter(item=>item.start<start+text.length&&item.end>start).sort((a,b)=>a.updated-b.updated),result=[];
 for(const token of tokens(text,start)){
  const cuts=new Set([token.start,token.end]);
  for(const mark of relevant){if(mark.start>token.start&&mark.start<token.end)cuts.add(mark.start);if(mark.end>token.start&&mark.end<token.end)cuts.add(mark.end);}
  if(selection){for(const edge of [selection.start,selection.end])if(edge>token.start&&edge<token.end)cuts.add(edge);}
  const points=Array.from(cuts).sort((a,b)=>a-b);
  for(let index=0;index<points.length-1;index++){
   const begin=points[index],end=points[index+1],cover=relevant.filter(item=>item.kind==='highlight'&&item.start<=begin&&item.end>=end),chosen=cover[cover.length-1];
   const lookup=!!token.word&&token.word.length<=256;
   result.push({id:begin+'-'+end,text:text.slice(begin-start,end-start),word:lookup,wordStart:lookup?token.start:-1,wordEnd:lookup?token.end:-1,start:begin,end,color:chosen?chosen.color:'',marked:!!cover.length,selected:!!selection&&selection.start<end&&selection.end>begin});
  }
 }
 return result;
}
module.exports={list,get,add,remove,progress,pages,ranges,tokens,annotations,annotationSummaries,mark,removeAnnotation,bookmark,pageForOffset,decorated,validAnnotation,validateArticleAnnotations,excerpt:preview};
