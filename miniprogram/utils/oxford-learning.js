// Keep the source's original and extended markers separate.
const levels=['A1','A2','B1','B2','C1','C2'],lists=['3000','5000'];
function badges(value){
  value=value||{};
  const read=(field,allowed)=>allowed.filter(item=>Array.isArray(value[field])&&value[field].includes(item));
  const main=read('levels',levels),core=read('lists',lists),extra=read('extendedLevels',levels).filter(item=>!main.includes(item)),extraLists=read('extendedLists',lists).filter(item=>!core.includes(item));
  return (main.length?['CEFR '+main.join(' / ')]:[]).concat(core.map(item=>'牛津'+item),extra.length?['词库扩展级别 '+extra.join(' / ')]:[],extraLists.map(item=>'词库扩展 · 牛津'+item));
}
module.exports={badges};
