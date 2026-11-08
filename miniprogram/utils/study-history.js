const LIMIT=2000,GRADES=['again','hard','good','easy'],MODES=['flash','spell','choice'];
function dayKey(now=Date.now()){const date=new Date(now);return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
function dateValue(key){if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key))return null;const [year,month,day]=key.split('-').map(Number),date=new Date(year,month-1,day,12);return dayKey(date.getTime())===key?date:null;}
function ordered(rows){const seen=new Set();return rows.filter(row=>{if(seen.has(row.id))return false;seen.add(row.id);return true;}).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)).slice(-LIMIT);}
function valid(log,days){
 if(log===undefined)return true;if(!Array.isArray(log)||log.length>LIMIT)return false;const ids=new Set(),counts=new Map(),text=(value,max)=>typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\x00-\x1f]/.test(value);
 for(const row of log){
  if(!row||typeof row!=='object'||Array.isArray(row)||!text(row.id,256)||ids.has(row.id)||!text(row.word,256)||!GRADES.includes(row.grade)||!MODES.includes(row.mode)||!Number.isSafeInteger(row.at)||row.at<0||!Number.isFinite(new Date(row.at).getTime())||!dateValue(row.day)||!Object.prototype.hasOwnProperty.call(days,row.day)||!Number.isInteger(row.seconds)||row.seconds<0||row.seconds>600||typeof row.first!=='boolean')return false;
  ids.add(row.id);const count=counts.get(row.day)||{attempts:0,new:0,review:0,correct:0,seconds:0};count.attempts++;count[row.first?'new':'review']++;if(row.grade!=='again')count.correct++;count.seconds+=row.seconds;counts.set(row.day,count);
 }
 for(const [day,count]of counts)if(Object.keys(count).some(key=>count[key]>days[day][key]))return false;return true;
}
module.exports={LIMIT,GRADES,MODES,dayKey,dateValue,ordered,valid};
