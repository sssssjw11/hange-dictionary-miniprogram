const test = require('node:test');
const assert = require('node:assert/strict');
const spelling = require('../miniprogram/utils/spelling');
const store = require('../miniprogram/utils/store');

test('spelling recognizes missing, extra, substituted and swapped letters, including a first-letter error', () => {
  for (const [typed, actual] of [['bok','book'],['boook','book'],['boak','book'],['obok','book'],['qpple','apple'],['semantci','semantic'],['interpersonal skils','interpersonal skills'],['eclair','éclair']]) {
    const rows = spelling.rank(store.key(typed), [{key:store.key(actual),word:actual}]);
    assert.deepEqual(rows.map(row => row.word), [actual], typed);
    assert.equal(spelling.distance(store.key(typed), store.key(actual), 1), 1, typed);
  }
  assert.equal(spelling.distance('dictionary','dictionry',2),1);
  assert.equal(spelling.distance('dictionary','dicionry',2),2);
  assert.equal(spelling.distance('dictionary','unrelated',2),3);
});

test('spelling keeps actual Unicode words, ranks close words first, deduplicates and bounds results', () => {
  const words=['book','Book','books','booking','back','boot','look','cook','rook','took','hook','nook','I'];
  const rows=spelling.rank('boook',words.map(word=>({key:store.key(word),word})));
  assert.equal(rows[0].word,'book');assert.ok(rows.length<=8);assert.equal(new Set(rows.map(row=>row.key)).size,rows.length);
  assert.deepEqual(spelling.rank('book',words.map(word=>({key:store.key(word),word}))),[]);
  assert.deepEqual(spelling.rank('ix',[{key:'i',word:'I'}]).map(row=>row.word),['I']);
  assert.deepEqual(spelling.rank(store.key('cafe\u0301'),[{key:store.key('café'),word:'café'}]),[]);
  for(const key of ['', 'a', '苹果', 'hello🙂', 'hello\nword', 'a'.repeat(257)]) assert.equal(spelling.eligible(key),false,key);
});
