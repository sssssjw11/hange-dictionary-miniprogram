const test=require('node:test');
const assert=require('node:assert/strict');
const codec=require('../miniprogram/vendor/codec');
const {badges}=require('../miniprogram/utils/oxford-learning');

test('source learning markers keep original and extended provenance without changing body offsets',()=>{
  const first='<div class="entry"><h1 class="headword" ox3000="y">demo</h1><li class="sense" id="first" sensenum="1" cefr="a1" ox3000="y"><deft>First<chn>第一义项</chn></deft></li><li class="sense" id="second" sensenum="2" fkcefr="c2" fkox5000="y"><deft>Second<chn>第二义项</chn></deft></li><script cefr="c1">ignored</script></div>';
  const second='<div class="entry"><li class="sense" id="third" cefr="b2" ox5000="y">Third</li><span cefr="unknown" ox3000="n">Tail</span></div>';
  const result=codec.renderOxford([{word:'demo',html:first},{word:'other',html:second}]);
  assert.deepEqual(result.learning,{levels:['A1','B2'],extendedLevels:['C2'],lists:['3000','5000'],extendedLists:['5000']});
  const meaning=result.contents.find(row=>row.id==='second');
  assert.deepEqual(meaning.learning,{levels:[],extendedLevels:['C2'],lists:[],extendedLists:['5000']});
  assert.deepEqual(badges(meaning.learning),['词库扩展级别 C2','词库扩展 · 牛津5000']);
  assert.deepEqual(badges(result.learning),['CEFR A1 / B2','牛津3000','牛津5000','词库扩展级别 C2']);
  assert.deepEqual(badges(),[]);
  const text=nodes=>nodes.map(node=>node.type==='text'?node.text:text(node.children||[])).join('');
  const focus=codec.focusOxford(result,meaning);assert.ok(text(focus.blocks[focus.index].nodes).startsWith('2. Second第二义项'));
  assert.equal(focus.blocks.map(block=>text(block.nodes)).join(''),result.blocks.map(block=>text(block.nodes)).join(''));
});
