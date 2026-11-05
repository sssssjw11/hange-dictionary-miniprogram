from contextlib import closing
from http.server import ThreadingHTTPServer
import json
import re
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import sqlite3
from urllib.parse import quote
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from app import Handler
from dictionary import Engine
from spelling import distance,eligible,rank
from spelling_fixture import build


class SpellingTest(unittest.TestCase):
    def test_edit_types_unicode_and_bounded_suggestions(self):
        for typed,actual in [('bok','book'),('boook','book'),('boak','book'),('obok','book'),('qpple','apple'),('semantci','semantic'),('interpersonal skils','interpersonal skills'),('eclair','éclair')]:
            self.assertEqual(distance(typed,actual,1),1,(typed,actual))
            self.assertEqual([row['word'] for row in rank(typed,[{'key':actual,'word':actual}])],[actual])
        self.assertEqual(distance('dictionary','dicionry',2),2)
        self.assertEqual(distance('dictionary','unrelated',2),3)
        self.assertEqual(rank('ix',[{'key':'i','word':'I'}])[0]['word'],'I')
        for key in ['', 'a', '苹果', 'hello🙂', 'hello\nword','a'*257]:self.assertFalse(eligible(key),key)

    def test_base_dictionary_alone_supplies_real_meanings_for_spelling_suggestions(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary)
            with closing(sqlite3.connect(folder/'dictionary.db')) as db:
                db.executescript('CREATE TABLE entries(key TEXT,word TEXT,phonetic TEXT,zh TEXT,en TEXT,forms TEXT,tags TEXT); CREATE TABLE aliases(key TEXT,lemma TEXT); CREATE TABLE senses(key TEXT,json TEXT);')
                db.executemany('INSERT INTO entries VALUES (?,?,?,?,?,?,?)',[(word,word,'','原创释义 · '+word,'','','') for word in ['dictionary','semantic','apple']]);db.commit()
            result=Engine(folder).lookup('dictionry');self.assertEqual(result['kind'],'missing');self.assertEqual(result['suggestions'][0],{'word':'dictionary','meaning':'原创释义 · dictionary'})

    def test_real_readonly_api_keeps_the_query_and_opens_suggested_words(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);(folder/'oxford').mkdir();build(folder/'oxford/oxford.db');engine=Engine(folder)
            before=(folder/'oxford/oxford.db').read_bytes()
            previous=Handler.engine;Handler.engine=engine
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                base='http://127.0.0.1:'+str(server.server_port)
                for typed,actual in [('subordnate','subordinate'),('semantci','semantic'),('qpple','apple'),('eclair','éclair'),('interpersonal skils','interpersonal skills'),('recieving','receiving'),('housess','houses')]:
                    result=json.load(urlopen(base+'/api/lookup?q='+quote(typed)))
                    self.assertEqual(result['kind'],'missing');self.assertEqual(result['requested'],typed);self.assertEqual(result['suggestionKind'],'spelling')
                    self.assertIn(actual,[row['word'] for row in result['suggestions']]);self.assertLessEqual(len(result['suggestions']),8)
                    self.assertTrue(all('原创释义' in row['meaning'] for row in result['suggestions']))
                    opened=json.load(urlopen(base+'/api/lookup?q='+quote(actual)));self.assertEqual(opened['kind'],'entry');self.assertEqual(opened['word'],{'receiving':'receive','houses':'house'}.get(actual,actual))
                self.assertEqual(engine.lookup('colloca')['suggestionKind'],'prefix')
                self.assertEqual(engine.lookup('ran')['word'],'run');self.assertEqual(engine.lookup('Semantic')['word'],'semantic')
                self.assertFalse(any(re.search(r'run[_ ]1',row['word']) for row in engine.lookup('run x')['suggestions']))
                self.assertFalse(engine.lookup('zzzzzzzzzzzzzzzzzz')['suggestions'])
            finally:server.shutdown();server.server_close();thread.join();Handler.engine=previous
            self.assertEqual((folder/'oxford/oxford.db').read_bytes(),before)


if __name__=='__main__':unittest.main(verbosity=2)
