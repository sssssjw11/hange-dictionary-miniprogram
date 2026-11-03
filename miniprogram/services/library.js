const records=require('../utils/records');
function state(){return records.read('library',{articles:[]});}
function list(){return state().articles.map(item=>({id:item.id,title:item.title,characters:item.text.length,progress:item.progress||0,created:item.created})).sort((a,b)=>b.created-a.created);}
function get(id){return state().articles.find(item=>item.id===id)||null;}
function add(title,text){title=(String(title||'').trim()||'未命名文章').slice(0,100);text=String(text||'').replace(/\r/g,'');if(!text.trim()||text.length>200000)throw new Error('单篇文章须为 1～200000 字，较长书籍请按章节导入');const data=state();if(data.articles.length>=100)throw new Error('书架最多保留 100 篇文章，请先导出或整理旧内容');const item={id:'read-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),title,text,created:Date.now(),progress:0};data.articles.unshift(item);records.write('library',data);return item.id;}
function remove(id){const data=state();data.articles=data.articles.filter(item=>item.id!==id);records.write('library',data);}
function progress(id,index){const data=state(),item=data.articles.find(item=>item.id===id);if(item){item.progress=Math.max(0,Number(index)||0);records.write('library',data);}}
function pages(text,maxLength=1800){const result=[];let start=0;while(start<text.length){let end=Math.min(start+maxLength,text.length);if(end<text.length){const found=text.lastIndexOf(' ',end);if(found>start+maxLength/2)end=found+1;if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;}result.push(text.slice(start,end));start=end;}return result.length?result:[''];}
function tokens(text){return (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*|[^A-Za-z]+/g)||[]).map((value,index)=>({id:index,text:value,word:/^[A-Za-z]/.test(value)?value:''}));}
module.exports={list,get,add,remove,progress,pages,tokens};
