const records = require('../utils/records');
const store = require('../utils/store');
const offline = require('../data/offline');
const DAY = 86400000;
function dayKey(now = Date.now()) { const date = new Date(now); return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'); }
function state() { const data=records.read('study', { version: 1, decks: [], cards: {}, days: {}, events: [], plan: { dailyNew: 20, dailyReview: 100 }, pending: null });data.cards=Object.assign(Object.create(null),data.cards);return data; }
function save(data) { records.write('study', data); }
function decks() { const data = state(); return [{ id:'favorites', name:'我的生词本', count:store.favorites().length, system:true }, { id:'starter', name:'基础与语法 · 内置词表', count:Object.keys(offline.entries).length, system:true }].concat(data.decks.map(deck => ({id:deck.id,name:deck.name,count:deck.words.length,created:deck.created,system:false}))); }
function words(deckId, data = state()) { if (deckId === 'favorites') return store.favorites().map(item => item.word); if (deckId === 'starter') return Object.keys(offline.entries); const deck = data.decks.find(item => item.id === deckId); if (!deck) throw new Error('词表不存在'); return deck.words; }
function createDeck(name, text) {
  name = String(name).trim(); if (!name || name.length > 40) throw new Error('词表名称须为 1～40 字');
  const list = parseWords(String(text).replace(/^\uFEFF/,''));
  if (!list.length || list.length > 10000 || list.some(word => word.length > 128)) throw new Error('词表须为 1～10000 行，每行一个单词或短语');
  const data = state(); if (data.decks.length >= 30) throw new Error('最多保存 30 个自定义词表');
  const id = 'deck-' + Date.now() + '-' + Math.random().toString(36).slice(2,7); data.decks.push({ id, name, words:list, created:Date.now() }); save(data); return id;
}
function parseWords(source){
 const result=[],row=[];let field='',quoted=false;
 function finish(){row.push(field);const first=store.key(row[0]);if(first&&!(result.length===0&&row.length>1&&['word','headword','单词','词条'].includes(first)))result.push(first);row.length=0;field='';}
 for(let index=0;index<source.length;index++){
  const char=source[index];
  if(quoted){if(char==='"'){if(source[index+1]==='"'){field+='"';index++;}else quoted=false;}else field+=char;}
  else if(char==='"'&&!field)quoted=true;
  else if(char===','||char==='\t'){row.push(field);field='';}
  else if(char==='\n'||char==='\r'){if(char==='\r'&&source[index+1]==='\n')index++;finish();}
  else field+=char;
 }
 if(quoted)throw new Error('CSV 词表中存在未闭合的引号，请检查文件');
 if(field||row.length)finish();
 return Array.from(new Set(result));
}
function deleteDeck(id) { const data = state(); data.decks = data.decks.filter(deck => deck.id !== id); if (data.pending && data.pending.deck === id) data.pending = null; save(data); }
function queue(deck, now = Date.now(), practice = false) {
  const data = state(), today = data.days[dayKey(now)] || { new:0, review:0 };
  const members = words(deck,data).filter(word => !(data.cards[word] || {}).known);
  const due = members.filter(word => data.cards[word] && data.cards[word].due <= now).sort((a,b) => data.cards[a].due-data.cards[b].due);
  const fresh = members.filter(word => !data.cards[word]);
  const result = practice ? members.slice(0,100) : due.slice(0,Math.max(0,data.plan.dailyReview-today.review)).concat(fresh.slice(0,Math.max(0,data.plan.dailyNew-today.new)));
  return { words:result, due:due.length, fresh:fresh.length, total:members.length, today, plan:data.plan };
}
function review(word, grade, options = {}) {
  if (!['again','hard','good','easy'].includes(grade)) throw new Error('未知的复习评分');
  word = store.key(word); if (!word || word.length > 256) throw new Error('无效单词');
  const data = state(), now = options.now || Date.now(), event = options.event || '';
  if (event && data.events.includes(event)) return { duplicate:true, card:data.cards[word] };
  const first = !data.cards[word], card = data.cards[word] || { repetitions:0, interval:0, ease:2.5, lapses:0, due:now, introduced:now, known:false };
  if (grade === 'again') { card.interval = 10/1440; card.repetitions = 0; card.lapses++; card.ease = Math.max(1.3,card.ease-0.2); }
  if (grade === 'hard') { card.interval = card.repetitions ? Math.max(1,card.interval*1.2) : 0.5; card.repetitions++; card.ease = Math.max(1.3,card.ease-0.15); }
  if (grade === 'good') { card.interval = card.repetitions === 0 ? 1 : card.repetitions === 1 ? 3 : Math.max(1,card.interval*card.ease); card.repetitions++; }
  if (grade === 'easy') { card.interval = card.repetitions ? Math.max(4,card.interval*card.ease*1.3) : 4; card.repetitions++; card.ease = Math.min(3.0,card.ease+0.15); }
  card.due = now + Math.round(card.interval*DAY); card.lastReviewed = now; data.cards[word] = card;
  const key = dayKey(now), day = data.days[key] || { new:0, review:0, correct:0, attempts:0, seconds:0 };
  day[first ? 'new':'review']++; day.attempts++; if (grade !== 'again') day.correct++; day.seconds += Math.min(600,Math.max(0,Math.round(options.seconds || 0))); data.days[key] = day;
  if (event) data.events = data.events.concat(event).slice(-500);
  const dates = Object.keys(data.days).sort(); for (const old of dates.slice(0,Math.max(0,dates.length-400))) delete data.days[old];
  save(data); return { card, today:day, first };
}
function known(word, value) { const data = state(), key = store.key(word);if(!key||key.length>256)throw new Error('无效单词');data.cards[key] = Object.assign({ repetitions:0, interval:0, ease:2.5, due:Date.now(), lapses:0 },data.cards[key] || {},{known:!!value});if(!value){data.cards[key].due=Date.now();data.cards[key].interval=0;data.cards[key].repetitions=0;}save(data); }
function mastered(){return Object.entries(state().cards).filter(([,card])=>card.known||card.interval>=21).map(([word])=>word).sort();}
function plan(dailyNew, dailyReview) { dailyNew = Number(dailyNew); dailyReview = Number(dailyReview); if (!Number.isInteger(dailyNew) || dailyNew < 1 || dailyNew > 100 || !Number.isInteger(dailyReview) || dailyReview < 1 || dailyReview > 300) throw new Error('每日新词 1～100，复习 1～300'); const data = state(); data.plan = {dailyNew,dailyReview}; save(data); }
function pending(value) { const data = state(); if (value !== undefined) { data.pending = value; save(data); } return data.pending; }
function playback(value){const data=state();if(value!==undefined){data.playback=value;save(data);}return data.playback||null;}
function stats(now = Date.now()) { const data = state(), cards = Object.values(data.cards), today = data.days[dayKey(now)] || {new:0,review:0,attempts:0,correct:0,seconds:0}; const days = []; for (let i = 6; i >= 0; i--) { const key = dayKey(now-i*DAY), value=data.days[key] || {new:0,review:0}; days.push({date:key.slice(5),count:value.new+value.review}); } let streak=0; for (let i=0;i<400;i++) { const day=data.days[dayKey(now-i*DAY)]; if (day && day.attempts) streak++; else if (i!==0) break; } return {today,days,streak,learned:cards.length,mastered:cards.filter(card=>card.known || card.interval>=21).length,due:cards.filter(card=>!card.known && card.due<=now).length,plan:data.plan,pending:data.pending}; }
function checkSpelling(answer, target) { return store.key(answer) === store.key(target); }
module.exports = { decks, words, createDeck, deleteDeck, queue, review, known, mastered, plan, pending, playback, stats, checkSpelling, dayKey };
