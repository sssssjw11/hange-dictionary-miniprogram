const records=require('../utils/records'),history=require('../utils/study-history');
const PAGE_SIZE=25,GRADES={again:'忘记',hard:'困难',good:'记住',easy:'熟练'},MODES={flash:'词卡回忆',spell:'单词拼写',choice:'选义练习'};
const empty=()=>({new:0,review:0,correct:0,attempts:0,seconds:0});
function shifted(key,offset){const date=history.dateValue(key);date.setDate(date.getDate()+offset);return history.dayKey(date.getTime());}
function duration(seconds){seconds=Math.round(seconds||0);const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;return hours?hours+' 小时 '+minutes+' 分':minutes?minutes+' 分 '+rest+' 秒':rest+' 秒';}
function read(options={},now=Date.now()){
 const today=history.dayKey(now),date=options.date||today,period=options.period===undefined?7:Number(options.period),filter=options.filter||'all';
 if(!history.dateValue(date)||date>today||![7,30].includes(period)||!['all','again','new','review'].includes(filter))throw new Error('请选择有效的日期和统计范围');
 const data=records.read('study',{cards:{},days:{}}),retained=Object.keys(data.days).filter(history.dateValue).sort(),start=[shifted(today,-399),retained[0]||today].sort()[0],summary=empty(),days=[];
 if(date<start)throw new Error('该日期超出当前保留的记录范围');
 for(let index=period-1;index>=0;index--){const key=shifted(date,-index),value=Object.assign(empty(),data.days[key]);days.push({date:key,label:key.slice(5),count:value.attempts});for(const name of Object.keys(summary))summary[name]+=value[name];}
 const maximum=Math.max(1,...days.map(day=>day.count));for(const day of days)day.height=day.count?Math.max(4,Math.round(day.count/maximum*150)):0;
 const selected=Object.assign(empty(),data.days[date]),logged=(data.reviewLog||[]).filter(row=>row.day===date).sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)),filtered=logged.filter(row=>filter==='all'||filter==='again'&&['again','hard'].includes(row.grade)||filter==='new'&&row.first||filter==='review'&&!row.first),pages=Math.ceil(filtered.length/PAGE_SIZE),page=Math.max(0,Math.min(Number.isInteger(options.page)?options.page:0,Math.max(0,pages-1)));
 const rows=filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(row=>{const time=new Date(row.at);return {id:row.id,word:row.word,grade:row.grade,gradeLabel:GRADES[row.grade],modeLabel:MODES[row.mode],first:row.first,time:String(time.getHours()).padStart(2,'0')+':'+String(time.getMinutes()).padStart(2,'0'),duration:duration(row.seconds)};});
 return {date,today,start,period,filter,days,selected:Object.assign(selected,{rate:selected.attempts?Math.round(selected.correct/selected.attempts*100)+'%':'—',duration:duration(selected.seconds)}),summary:Object.assign(summary,{duration:duration(summary.seconds)}),recorded:logged.length,partial:logged.length<selected.attempts,rows,total:filtered.length,page,pages,historyLimit:history.LIMIT};
}
module.exports={read};
