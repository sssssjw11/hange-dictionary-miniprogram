const api=require('./api'),codec=require('../vendor/codec'),store=require('../utils/store');
function remove(path){try{wx.getFileSystemManager().unlink({filePath:path,fail(){}});}catch(_){} }
class ResourceFiles{
 constructor(){this.files=new Map();this.bytes=0;this.closed=false;this.generation=0;this.pending=null;}
 cancel(){this.generation++;if(this.pending&&this.pending.abort)this.pending.abort();this.pending=null;}
 async resolve(rows,sourceSha256){
  const keys=rows.map(row=>row.key);
  if(keys.length>24||keys.some(key=>codec.resourceKey(key)!==key)||!/^[a-f0-9]{64}$/.test(sourceSha256||''))throw new Error('词条媒体信息已过期，请更新词条后重试');
  const result=await api.request('dictionary-media/resolve',{keys,sourceSha256},'POST',5000);
  if(result.sourceSha256!==sourceSha256||!Array.isArray(result.rows)||result.rows.length!==keys.length||result.rows.some((row,index)=>row.key!==keys[index]))throw new Error('媒体服务与当前词条不匹配，请检查服务地址');
  return result;
 }
 async download(row,sourceSha256){
  if(this.closed)throw new Error('页面已关闭');
  if(!row.available||codec.resourceKey(row.key)!==row.key||!row.bytes||row.bytes>16*1048576||!/^[a-f0-9]{64}$/.test(sourceSha256||''))throw new Error('这项资源尚未导入或超过 16 MiB');
  this.cancel();const generation=this.generation,cacheKey=sourceSha256+'/'+row.key,cached=this.files.get(cacheKey);if(cached)return cached.path;
  if(!store.settings().online)throw new Error('网络服务已关闭，可在设置中开启');
  // Keep temporary media separate from the installed dictionary and learning files.
  while(this.files.size&&(this.files.size>=4||this.bytes+row.bytes>16*1048576)){const [key,file]=this.files.entries().next().value;this.files.delete(key);this.bytes-=file.bytes;remove(file.path);}
  let response;try{response=await new Promise((resolve,reject)=>{this.pending=wx.downloadFile({url:api.base()+'/api/dictionary-media/file?sourceSha256='+encodeURIComponent(sourceSha256)+'&key='+encodeURIComponent(row.key),timeout:120000,success:resolve,fail:()=>reject(new Error('词条媒体下载失败，请检查服务连接'))});});}finally{if(generation===this.generation)this.pending=null;}
  if(this.closed||generation!==this.generation){if(response.tempFilePath)remove(response.tempFilePath);throw new Error('媒体读取已取消');}
  if(response.statusCode!==200||!response.tempFilePath){if(response.tempFilePath)remove(response.tempFilePath);throw new Error('这项媒体暂不可用，请刷新资源状态后重试');}
  this.files.set(cacheKey,{path:response.tempFilePath,bytes:row.bytes});this.bytes+=row.bytes;return response.tempFilePath;
 }
 release(){this.closed=true;this.cancel();for(const file of this.files.values())remove(file.path);this.files.clear();this.bytes=0;}
}
module.exports={ResourceFiles};
