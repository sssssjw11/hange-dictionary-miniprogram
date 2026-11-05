const fields = ['levels', 'extendedLevels', 'lists', 'extendedLists'];
const levels = new Set(['A1','A2','B1','B2','C1','C2']);
export function emptyLearning() { return {levels:[],extendedLevels:[],lists:[],extendedLists:[]}; }
export function sourceLearning(attributes) {
  const result=emptyLearning(),value=name=>String(attributes[name]||'').trim().toUpperCase();
  if(levels.has(value('cefr')))result.levels.push(value('cefr'));
  if(levels.has(value('fkcefr')))result.extendedLevels.push(value('fkcefr'));
  for(const list of ['3000','5000']){
    if(value('ox'+list)==='Y')result.lists.push(list);
    if(value('fkox'+list)==='Y')result.extendedLists.push(list);
  }
  return result;
}
export function mergeLearning(target,source) {
  for(const field of fields)for(const value of source[field]||[])if(!target[field].includes(value))target[field].push(value);
  for(const field of fields)target[field].sort();
  return target;
}
