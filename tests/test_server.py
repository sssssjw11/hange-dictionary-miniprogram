"""Content-preservation and endpoint checks against optional local dictionaries."""
from pathlib import Path
from collections import Counter
from contextlib import closing
import json
import re
import sys
import threading
import tempfile
import sqlite3
import unittest
import zlib
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen
from urllib.parse import quote
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from dictionary import Engine, rich_blocks
from app import Handler
from bs4 import BeautifulSoup


def node_text(nodes):
    return ''.join(item.get('text', '') if item.get('type') == 'text' else node_text(item.get('children', [])) for item in nodes)


class RendererTest(unittest.TestCase):
    def test_navigation_offsets_are_utf16_and_preserve_fragment_targets_and_explicit_sense_numbers(self):
        html='<div class="entry" id="entry"><h1 class="headword">demo</h1><span class="pos">noun</span><div class="phons_br"><span class="phon">/demo/</span></div><li class="sense" id="second" sensenum="2"><deft><chn>第二😀义项</chn></deft></li><span class="unbox" id="repeat"><span class="box_title">Extra Examples</span>ONE</span><span class="unbox" id="repeat"><span class="box_title">Word Origin</span>TWO</span><a href="entry://word%23name#target%2F2">word#name (2)</a><a href="#second">本页</a></div>'
        blocks,_,info=rich_blocks(html,with_info=True,word='demo');text=''.join(node_text(block) for block in blocks)
        target=next(row for row in info['anchors'] if row['id']=='second')
        self.assertEqual(target['position'],len(text[:text.index('2. 第二😀义项')].encode('utf-16-le'))//2)
        self.assertEqual(len([row for row in info['anchors'] if row['id']=='repeat']),2)
        self.assertEqual(info['references'],[{'word':'word#name','anchor':'target/2','label':'word#name (2)'}])
        self.assertEqual(info['localLinks'][0]['anchor'],'second')
        origin=next(row for row in info['contents'] if row['label']=='Word Origin')
        self.assertEqual(text.encode('utf-16-le')[origin['position']*2:].decode('utf-16-le').startswith('Word OriginTWO'),True)

    def test_supplement_endpoint_returns_canonical_metadata_without_the_oxford_body(self):
        from search_fixture import build_source
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);(folder/'oxford').mkdir();build_source(folder/'oxford/oxford.db')
            with closing(sqlite3.connect(folder/'dictionary.db')) as db:
                db.executescript('CREATE TABLE entries(key TEXT,word TEXT,phonetic TEXT,zh TEXT,en TEXT,forms TEXT,tags TEXT); CREATE TABLE aliases(key TEXT,lemma TEXT); CREATE TABLE senses(key TEXT,json TEXT);')
                db.execute('INSERT INTO entries VALUES (?,?,?,?,?,?,?)',('love','love','lʌv','原创释义','Original meaning','3:loves','original'))
                db.execute('INSERT INTO senses VALUES (?,?)',('love',json.dumps([{'pos':'v','definition':'Original sense','examples':[],'synonyms':[],'antonyms':[]}])));db.commit()
            engine=Engine(folder);extra=engine.supplement('loved')
            self.assertEqual((extra['kind'],extra['word'],extra['phonetic']),('supplement','love','lʌv'))
            self.assertTrue(extra['available']);self.assertTrue(extra['found']);self.assertNotIn('oxford',extra)
            self.assertEqual(extra['forms'][0]['word'],'loves');self.assertEqual(extra['senses'][0]['definition'],'Original sense')
            self.assertFalse(engine.supplement('qzxunknownword')['found'])
            previous=Handler.engine;Handler.engine=engine;server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                base='http://127.0.0.1:'+str(server.server_port)
                self.assertEqual(json.load(urlopen(base+'/api/supplement?q=loved')),extra)
                with self.assertRaises(HTTPError) as caught:urlopen(base+'/api/supplement?q=')
                self.assertEqual(caught.exception.code,400);caught.exception.close()
            finally:server.shutdown();server.server_close();thread.join();Handler.engine=previous

    def test_reverse_pages_reach_all_words_and_deduplicate_across_supplemental_sources(self):
        sys.path.insert(0,str(ROOT/'scripts'))
        from build_chinese_index import build
        from search_fixture import build_source
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);(folder/'oxford').mkdir();source=folder/'oxford/oxford.db'
            build_source(source,81,True);build(source,folder/'oxford/chinese.db')
            with closing(sqlite3.connect(folder/'dictionary.db')) as db:
                db.executescript('CREATE TABLE entries(key TEXT,word TEXT,phonetic TEXT,zh TEXT,en TEXT,forms TEXT,tags TEXT); CREATE TABLE aliases(key TEXT,lemma TEXT); CREATE TABLE senses(key TEXT,json TEXT);')
                db.executemany('INSERT INTO entries VALUES (?,?,?,?,?,?,?)',[
                    ('indexed-00039','INDEXED-00039','','索引检索测试','','',''),
                    ('supplement-only','supplement-only','','索引检索测试','','','')]);db.commit()
            engine=Engine(folder);term='索引检索测试';pages=[];cursor=0
            import dictionary
            with patch('dictionary.visible_soup',wraps=dictionary.visible_soup) as parsed:
                while True:
                    page=engine.chinese_page(term,cursor);pages.append(page)
                    if page['nextCursor'] is None:break
                    self.assertGreater(page['nextCursor'],cursor);cursor=page['nextCursor']
                self.assertEqual(parsed.call_count,82,'Each candidate body is parsed once across all pages, including false positives')
            self.assertEqual([len(page['matches']) for page in pages],[40,40,2])
            self.assertEqual([row['word'] for page in pages for row in page['matches']],['indexed-%05d'%i for i in range(81)]+['supplement-only'])
            self.assertEqual(engine.lookup(term)['nextCursor'],40)
            for invalid in [-1,1.5,False,'40',10**9]:
                with self.assertRaises(ValueError):engine.chinese_page(term,invalid)
            previous=Handler.engine;Handler.engine=engine;server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                base='http://127.0.0.1:'+str(server.server_port)
                response=json.load(urlopen(base+'/api/reverse?q='+quote(term)+'&cursor=80'))
                self.assertEqual(response['matches'],pages[-1]['matches']);self.assertIsNone(response['nextCursor'])
                for suffix in ['&cursor=-1','&cursor=nope']:
                    with self.assertRaises(HTTPError) as caught:urlopen(base+'/api/reverse?q='+quote(term)+suffix)
                    self.assertEqual(caught.exception.code,400);caught.exception.close()
            finally:server.shutdown();server.server_close();thread.join();Handler.engine=previous

    def test_character_mixed_case_and_supplementary_queries_use_the_imported_source(self):
        sys.path.insert(0,str(ROOT/'scripts'))
        from build_chinese_index import build
        from search_fixture import build_source
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);(folder/'oxford').mkdir();source=folder/'oxford/oxford.db'
            build_source(source);build(source,folder/'oxford/chinese.db');engine=Engine(folder)
            self.assertTrue(engine.status()['oxfordChineseSingleCharacter'])
            self.assertEqual([row['word'] for row in engine.chinese('爱')],['love','beloved','aid','use'])
            self.assertEqual(engine.lookup('C语言')['word'],'compiler')
            alias=engine.lookup('loved')
            self.assertEqual(alias['word'],'love')
            self.assertEqual(alias['matchedFrom'],'loved')
            self.assertEqual(engine.lookup('𠮷')['word'],'rare')
            self.assertEqual(engine.lookup('𠮷野')['word'],'rare')
            self.assertEqual({row['word'] for row in engine.chinese('键盘')},{'compiler','typing'})
            self.assertIn('原文匹配',next(row for row in engine.chinese('输') if row['word']=='input')['meaning'])
            self.assertEqual(engine.lookup('秘')['matches'],[])
            # A supplemental entry for the inflection must not hide the Oxford
            # canonical headword or attach the wrong WordNet senses/forms.
            with closing(sqlite3.connect(folder/'dictionary.db')) as base:
                base.executescript('CREATE TABLE entries(key TEXT,word TEXT,phonetic TEXT,zh TEXT,en TEXT,forms TEXT,tags TEXT); CREATE TABLE aliases(key TEXT,lemma TEXT); CREATE TABLE senses(key TEXT,json TEXT);')
                base.executemany('INSERT INTO entries VALUES (?,?,?,?,?,?,?)',[
                    ('love','love','lʌv','原创基本释义','original base definition','3:loves',''),
                    ('loved','loved','','变形词的占位简释','','','')])
                base.execute('INSERT INTO senses VALUES (?,?)',('love',json.dumps([{'pos':'v','definition':'original sense','examples':[],'synonyms':[],'antonyms':[]}])));base.commit()
            combined=Engine(folder).lookup('loved')
            self.assertEqual((combined['word'],combined['matchedFrom']),('love','loved'))
            self.assertEqual(combined['phonetic'],'lʌv')
            self.assertEqual(combined['senses'][0]['definition'],'original sense')
            self.assertEqual(combined['forms'][0]['word'],'loves')

    def test_oxford_only_full_chinese_index(self):
        sys.path.insert(0,str(ROOT/'scripts'))
        from build_chinese_index import build
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);(folder/'oxford').mkdir();source=folder/'oxford/oxford.db'
            with closing(sqlite3.connect(source)) as db:
                db.executescript('CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE entries(id INTEGER PRIMARY KEY,key TEXT,compact TEXT,word TEXT,body BLOB,target TEXT);')
                db.execute('INSERT INTO metadata VALUES (?,?)',('source_sha256','fixture'))
                db.execute('INSERT INTO entries VALUES (1,?,?,?,?,NULL)',('demo','demo','demo',zlib.compress('<chn>非常罕见的词典示例</chn>'.encode())))
                db.commit()
            build(source,folder/'oxford/chinese.db');engine=Engine(folder)
            self.assertTrue(engine.status()['oxfordChineseIndex']);self.assertEqual(engine.lookup('罕见')['word'],'demo')
            self.assertEqual(engine.lookup('不存在的中文')['kind'],'matches')

    def test_imported_oxford_only_service_without_base_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / 'oxford').mkdir()
            with closing(sqlite3.connect(folder / 'oxford/oxford.db')) as db:
                db.execute('CREATE TABLE entries(id INTEGER PRIMARY KEY,key TEXT,compact TEXT,word TEXT,body BLOB,target TEXT)')
                html='<div>Complete example entry</div>'+''.join('<a href="entry://original-%d">Original %d</a>'%(i,i) for i in range(75))
                db.execute('INSERT INTO entries VALUES (1,?,?,?,?,NULL)', ('demo', 'demo', 'demo', zlib.compress(html.encode())))
                db.commit()
            engine = Engine(folder)
            self.assertTrue(engine.status()['ready'])
            self.assertEqual(engine.status()['oxfordDefinitions'], 1)
            self.assertEqual(engine.lookup('demo')['kind'], 'entry')
            self.assertTrue(engine.lookup('demo')['oxford']['blocks'])
            self.assertEqual(len(engine.lookup('demo')['related']),75)
            self.assertEqual(engine.lookup('interpersonal skills')['kind'], 'entry')
            self.assertEqual(engine.suggest('dem')[0]['word'], 'demo')

    def test_custom_tags_and_unsafe_source(self):
        html = '<script>bad()</script><defT>English<chn>中文释义</chn></defT><a href="entry://bank" onclick="bad()">bank</a><img src="https://invalid/test.png"><custom>keep me</custom>'
        blocks, links = rich_blocks(html)
        self.assertEqual(links, ['bank'])
        self.assertEqual(node_text([node for block in blocks for node in block]), 'English中文释义bankkeep me')
        encoded = json.dumps(blocks)
        self.assertNotIn('onclick', encoded)
        self.assertNotIn('invalid/test', encoded)
        self.assertNotIn('script', encoded)

    def test_long_content_is_split_without_loss(self):
        text = 'meaning 中文🙂' * 8000
        blocks, _ = rich_blocks('<div><chn>' + text + '</chn></div>')
        self.assertGreater(len(blocks), 5)
        self.assertEqual(node_text([node for block in blocks for node in block]), text)
        self.assertLess(max(len(json.dumps(block).encode()) for block in blocks), 50000)


class LocalDictionaryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine()
        if not cls.engine.oxford.is_file():
            raise unittest.SkipTest('Private dictionary data not installed; renderer tests still run.')

    def test_all_chinese_senses_preserved_in_long_entries(self):
        checks = []
        for word, expected in [('predicative', 3), ('subordinate', 12), ('run', 269), ('set', 192), ('apple', 18)]:
            entry = self.engine.lookup(word)
            self.assertEqual(entry['kind'], 'entry')
            original = self.engine._oxford(word)
            chinese = []
            for _, _, html in original:
                soup = BeautifulSoup(html, 'html.parser')
                chinese.extend(' '.join(node.get_text().split()) for node in soup.select('chn'))
            self.assertEqual(len(chinese), expected)
            output = ' '.join(node_text([node for block in entry['oxford']['blocks'] for node in block['nodes']]).split())
            for phrase, count in Counter(chinese).items():
                if phrase:
                    self.assertGreaterEqual(output.count(phrase), count, (word, phrase))
            maximum = max(len(json.dumps(block, ensure_ascii=False).encode()) for block in entry['oxford']['blocks'])
            self.assertLess(maximum, 50000)
            checks.append({'word': word, 'source_chinese_nodes': len(chinese), 'blocks': len(entry['oxford']['blocks']), 'response_bytes': len(json.dumps(entry, ensure_ascii=False).encode()), 'max_block_bytes': maximum})
        (ROOT / 'output').mkdir(exist_ok=True)
        (ROOT / 'output/content-verification.json').write_text(json.dumps(checks, indent=2), 'utf-8')

    def test_chinese_lookup_and_aliases(self):
        for query,word in [('人际交往能力','interpersonal skills'),('伸出援手','reach out')]:
            result=self.engine.lookup(query)
            self.assertIn(word,[result['word']] if result['kind']=='entry' else [item['word'] for item in result['matches']])
        self.assertIn('apple', [row['word'] for row in self.engine.lookup('苹果')['matches']])
        self.assertTrue(self.engine.lookup('running')['oxford']['blocks'])
        self.assertIn('subordinate', [row['word'] for row in self.engine.suggest('subo')])
        self.assertEqual(self.engine.lookup('qzxnonexistentword987')['kind'], 'missing')
        for value in ['', 'x' * 257, 'hello\x00']:
            with self.assertRaises(ValueError): self.engine.lookup(value)

    def test_http_routes_and_errors(self):
        Handler.engine = self.engine
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        try:
            self.assertTrue(json.load(urlopen(base + '/api/health'))['ready'])
            self.assertEqual(json.load(urlopen(base + '/api/lookup?q=predicative'))['word'], 'predicative')
            for route, status in [('/api/lookup?q=', 400), ('/secret', 404)]:
                with self.assertRaises(HTTPError) as error: urlopen(base + route)
                self.assertEqual(error.exception.code, status)
                error.exception.close()
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main(verbosity=2)
