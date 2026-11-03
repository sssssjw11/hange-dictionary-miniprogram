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
from urllib.error import HTTPError
from urllib.request import urlopen
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from dictionary import Engine, rich_blocks
from app import Handler
from bs4 import BeautifulSoup


def node_text(nodes):
    return ''.join(item.get('text', '') if item.get('type') == 'text' else node_text(item.get('children', [])) for item in nodes)


class RendererTest(unittest.TestCase):
    def test_imported_oxford_only_service_without_base_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / 'oxford').mkdir()
            with closing(sqlite3.connect(folder / 'oxford/oxford.db')) as db:
                db.execute('CREATE TABLE entries(id INTEGER PRIMARY KEY,key TEXT,compact TEXT,word TEXT,body BLOB,target TEXT)')
                db.execute('INSERT INTO entries VALUES (1,?,?,?,?,NULL)', ('demo', 'demo', 'demo', zlib.compress(b'<div>Complete example entry</div>')))
                db.commit()
            engine = Engine(folder)
            self.assertTrue(engine.status()['ready'])
            self.assertEqual(engine.status()['oxfordDefinitions'], 1)
            self.assertEqual(engine.lookup('demo')['kind'], 'entry')
            self.assertTrue(engine.lookup('demo')['oxford']['blocks'])
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
        if not cls.engine.base.is_file() or not cls.engine.oxford.is_file():
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
        self.assertEqual(self.engine.lookup('人际交往能力')['word'], 'interpersonal skills')
        self.assertEqual(self.engine.lookup('伸出援手')['word'], 'reach out')
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
