import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from dictionary import rich_blocks


class ContextReferenceTests(unittest.TestCase):
    def test_source_link_positions_survive_fragmentation_and_utf16(self):
        html='<div>😀'+('A'*20000)+'<li class="sense" sensenum="2"><a href="entry://other#sense">Other</a></li><a href="entry://other#sense">Other</a><a href="entry://empty"></a><a href="entry://@topic_art">Topic</a><script><a href="entry://bad">bad</a></script></div>'
        blocks,_,info=rich_blocks(html,with_info=True,word='first')
        def text(nodes):return ''.join(node['text'] if node['type']=='text' else text(node['children']) for node in nodes)
        refs=info['referenceOccurrences']
        self.assertEqual([item['label'] for item in refs],['Other','Other'])
        for item in refs:
            value=text(blocks[item['blockIndex']])
            prefix=value.encode('utf-16-le')[:item['offset']*2].decode('utf-16-le')
            self.assertTrue(value[len(prefix):].startswith(item['label']))
        self.assertEqual(info['references'][-1]['word'],'empty')


if __name__=='__main__':unittest.main()
