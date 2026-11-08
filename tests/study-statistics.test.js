const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const memory=new Map(),copy=value=>JSON.parse(JSON.stringify(value)),now=new Date(2026,10,8,12).getTime();let fail=false,navigated='';
global.wx={getStorageSync:key=>memory.has(key)?copy(memory.get(key)):'',setStorageSync(key,value){if(fail)throw new Error('quota');memory.set(key,copy(value));},showToast(){},setNavigationBarColor(){},setBackgroundColor(){},navigateTo(value){navigated=value.url;}};
const study=require('../miniprogram/services/study'),statistics=require('../miniprogram/services/study-statistics'),records=require('../miniprogram/utils/records'),backup=require('../miniprogram/services/backup'),dictionary=require('../miniprogram/services/dictionary');
function page(name){let definition;const file=path.resolve(__dirname,'../miniprogram/pages/'+name+'/index.js');global.Page=value=>{definition=value;};delete require.cache[file];require(file);const result={data:copy(definition.data),setData(value){Object.assign(this.data,copy(value));}};for(const [key,value]of Object.entries(definition))if(typeof value==='function')result[key]=value.bind(result);return result;}
function seed(count=52){study.review('apple','good',{now,event:'seed'});const data=records.read('study',{}),day=study.dayKey(now);data.reviewLog=Array.from({length:count},(_,index)=>({id:'row-'+index,word:'apple',at:now+index,day,grade:index%2?'again':'hard',mode:index%2?'spell':'choice',seconds:1,first:index===0}));data.days[day]={new:1,review:count-1,attempts:count,correct:Math.ceil(count/2),seconds:count};data.events=[];records.write('study',data);return data;}
test.beforeEach(()=>{memory.clear();fail=false;navigated='';});

test('submitted grades record real modes and timing once, and failed writes preserve the committed state',()=>{
 study.review('Apple','hard',{now,event:'one',mode:'flash',seconds:12.4});study.review('apple','again',{now:now+1000,event:'two',mode:'spell',seconds:9});study.review('apple','easy',{now:now+2000,event:'three',mode:'choice',seconds:700});
 const before=records.read('study',{});assert.deepEqual(before.reviewLog.map(row=>[row.word,row.grade,row.mode,row.seconds,row.first]),[['apple','hard','flash',12,true],['apple','again','spell',9,false],['apple','easy','choice',600,false]]);assert.equal(study.review('apple','again',{now,event:'one'}).duplicate,true);assert.deepEqual(records.read('study',{}),before);
 assert.throws(()=>study.review('apple','good',{now,mode:'unknown'}),/参数/);fail=true;assert.throws(()=>study.review('apple','good',{now,event:'failed'}),/quota/);fail=false;assert.deepEqual(records.read('study',{}),before);
 const result=statistics.read({},now+3000);assert.equal(result.selected.attempts,3);assert.equal(result.selected.rate,'67%');assert.equal(result.selected.seconds,621);assert.equal(result.partial,false);assert.equal(result.recorded,3);assert.equal(statistics.read({filter:'again'},now).total,2);
});

test('date ranges include calendar boundaries and all filtered records remain accessible by pagination',()=>{
 seed();const yesterday=new Date(2026,10,7,12).getTime();study.review('run','good',{now:yesterday,event:'earlier',mode:'choice',seconds:5});
 const result=statistics.read({period:30,page:2},now);assert.equal(result.days.length,30);assert.equal(result.days[0].date,'2026-10-10');assert.equal(result.days.at(-1).date,'2026-11-08');assert.equal(result.summary.attempts,53);assert.equal(result.total,52);assert.equal(result.pages,3);assert.equal(result.rows.length,2);assert.equal(statistics.read({page:99},now).page,2);assert.equal(statistics.read({page:-1},now).page,0);
 assert.equal(statistics.read({filter:'new'},now).total,1);assert.equal(statistics.read({filter:'review'},now).total,51);const empty=statistics.read({date:'2026-11-06'},now);assert.equal(empty.selected.attempts,0);assert.equal(empty.selected.rate,'—');assert.deepEqual(empty.rows,[]);assert.throws(()=>statistics.read({date:'2026-02-30'},now),/日期/);assert.throws(()=>statistics.read({date:'2026-11-09'},now),/日期/);assert.equal(statistics.read({date:'2024-03-01',period:7},new Date(2024,2,1,12).getTime()).days[5].date,'2024-02-29');
});

test('history is bounded to the latest 2000 submissions and older summaries do not fabricate missing rows',()=>{
 seed(2000);assert.equal(study.review('apple','good',{now,event:'row-0'}).duplicate,true);study.review('apple','good',{now:now+3000,event:'last',mode:'spell',seconds:2});const data=records.read('study',{});assert.equal(data.reviewLog.length,2000);assert.equal(data.reviewLog[0].id,'row-1');assert.equal(data.reviewLog.at(-1).id,'last');assert.equal(statistics.read({},now).partial,true);
 const legacy=JSON.parse(backup.exportAll());delete legacy.records.study.reviewLog;legacy.version=2;memory.clear();backup.importAll(JSON.stringify(legacy));const result=statistics.read({},now);assert.equal(result.selected.attempts,2001);assert.equal(result.recorded,0);assert.equal(result.partial,true);assert.deepEqual(result.rows,[]);
});

test('full backups restore history, preserve current-day priority and reject invalid logs atomically',()=>{
 study.review('apple','good',{now,event:'current',mode:'spell',seconds:5});const source=backup.exportAll();memory.clear();backup.importAll(source);assert.equal(statistics.read({},now).rows[0].modeLabel,'单词拼写');const before=records.snapshot(),incoming=JSON.parse(source),day=study.dayKey(now),previous='2026-11-07',row=incoming.records.study.reviewLog[0];incoming.records.study.reviewLog=[Object.assign({},row,{id:'old-current',word:'run'}),Object.assign({},row,{id:'past',at:now-86400000,day:previous,word:'run'})];incoming.records.study.days[previous]=copy(incoming.records.study.days[day]);
 fail=true;assert.throws(()=>backup.importAll(JSON.stringify(incoming)),/quota/);fail=false;assert.deepEqual(records.snapshot(),before);backup.importAll(JSON.stringify(incoming));assert.equal(statistics.read({},now).recorded,1);assert.equal(statistics.read({},now).rows[0].word,'apple');assert.equal(statistics.read({date:previous},now).rows[0].word,'run');const stable=records.snapshot();
 for(const mutate of [root=>root.records.study.reviewLog[0].grade='bad',root=>root.records.study.reviewLog.push(copy(root.records.study.reviewLog[0])),root=>root.records.study.reviewLog[0].mode='audio',root=>root.records.study.reviewLog[0].day='2026-99-99',root=>root.records.study.days[day].attempts=0]){const invalid=JSON.parse(backup.exportAll());mutate(invalid);assert.throws(()=>backup.importAll(JSON.stringify(invalid)),/格式无效/);assert.deepEqual(records.snapshot(),stable);}
});

test('statistics page filters, dates and word links only read records',()=>{
 seed();const originalNow=Date.now,controller=page('statistics'),before=records.snapshot();Date.now=()=>now;
 try{controller.onShow();assert.equal(controller.data.date,'2026-11-08');assert.equal(controller.data.rows.length,25);controller.onNext();assert.equal(controller.data.page,1);controller.onPeriod({currentTarget:{dataset:{period:30}}});assert.equal(controller.data.period,30);assert.equal(controller.data.page,0);controller.onFilter({currentTarget:{dataset:{filter:'new'}}});assert.equal(controller.data.total,1);controller.onWord({currentTarget:{dataset:{word:'reach out'}}});assert.equal(navigated,'/pages/entry/index?q=reach%20out');controller.onDate({detail:{value:'2026-11-07'}});assert.equal(controller.data.recorded,0);controller.onToday();assert.equal(controller.data.date,'2026-11-08');assert.deepEqual(records.snapshot(),before);}
 finally{Date.now=originalNow;}
});

test('review controller records a submitted spelling result while skipped cards remain ungraded',async()=>{
 const lookup=dictionary.lookup,originalNow=Date.now;Date.now=()=>now;dictionary.lookup=async word=>({kind:'entry',word,brief:'原创释义'});const deck=study.createDeck('Practice','apple\nrun'),controller=page('review');
 try{controller.onLoad({deck,mode:'spell'});await new Promise(resolve=>setImmediate(resolve));controller.onAnswer({detail:{value:'apple'}});controller.onCheck();controller.onNext();await new Promise(resolve=>setImmediate(resolve));controller.onSkip();await new Promise(resolve=>setImmediate(resolve));assert.equal(controller.data.finished,true);assert.equal(controller.data.done,1);assert.equal(statistics.read({},now).selected.attempts,1);assert.equal(statistics.read({},now).rows[0].modeLabel,'单词拼写');assert.equal(statistics.read({},now).rows[0].gradeLabel,'记住');}
 finally{controller.onUnload();dictionary.lookup=lookup;Date.now=originalNow;}
});
