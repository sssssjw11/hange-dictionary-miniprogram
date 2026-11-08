const {scan}=require('./oxford-find');
function find(text,query){
 if(typeof text!=='string'||text.length>200000)throw new Error('当前正文超出阅读查找范围');
 query=String(query||'').trim();if(!query||query.length>256)throw new Error('请输入 1～256 字的词句');
 const positions=new Uint32Array(text.length*2);let count=0;scan(text,query,(start,end)=>{positions[count++]=start;positions[count++]=end;});return positions.subarray(0,count);
}
function range(positions,index){return positions&&Number.isInteger(index)&&index>=0&&index*2+1<positions.length?{start:positions[index*2],end:positions[index*2+1]}:null;}
module.exports={find,range};
