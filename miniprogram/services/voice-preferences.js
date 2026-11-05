const validId=value=>typeof value==='string'&&value.length<=160&&!/[\x00-\x1f\x7f]/.test(value);
function selected(settings,origin,language,variant){return settings.ttsVoiceBase===origin&&validId((settings.ttsVoices||{})[language==='zh'?'zh':variant])?(settings.ttsVoices||{})[language==='zh'?'zh':variant]:'';}
function choices(catalog,language,locale,saved){
 const seen=new Set(),rows=[{id:'',label:'自动选择'}],voices=[];
 for(const row of Array.isArray(catalog)?catalog:[])if(row&&validId(row.id)&&row.id&&typeof row.locale==='string'&&row.locale.startsWith(language)&&!seen.has(row.id)){seen.add(row.id);voices.push({id:row.id,locale:row.locale,label:row.id+' · '+row.locale});}
 voices.sort((a,b)=>(a.locale===locale?0:1)-(b.locale===locale?0:1));rows.push(...voices);
 if(saved&&!rows.some(row=>row.id===saved))rows.push({id:saved,label:saved+'（当前列表未找到）'});
 return {rows,index:Math.max(0,rows.findIndex(row=>row.id===saved))};
}
module.exports={selected,choices,validId};
