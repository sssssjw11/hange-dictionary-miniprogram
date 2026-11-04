const lessons=require('../data/learning');const study=require('./study');
function all(){const result=[];for(const [word,lesson]of Object.entries(lessons))for(const [index,pair]of (lesson.examples||[]).entries())result.push({id:word+'-'+index,word,en:pair[0],zh:pair[1],note:lesson.explanation,source:'原创学习例句'});return result;}
function today(now=Date.now()){const key=study.dayKey(now);const number=Number(key.replace(/-/g,''));const rows=all();return Object.assign({date:key},rows[number%rows.length]);}
function topics(){return Object.entries(lessons).map(([word,lesson])=>Object.assign({word},lesson));}
module.exports={today,all,topics};
