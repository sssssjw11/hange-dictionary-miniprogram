// Bound row counts sent across the native setData bridge.
function page(rows,index=0,size=20){const pages=Math.max(1,Math.ceil(rows.length/size));index=Math.max(0,Math.min(pages-1,index));return {rows:rows.slice(index*size,(index+1)*size),listPage:index,listPages:pages,total:rows.length};}
module.exports={page};
