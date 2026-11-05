"""Original definitions for spelling tests; no publisher content."""
import hashlib
from contextlib import closing
import sqlite3
import sys
import unicodedata
import zlib
from pathlib import Path

WORDS=['apple','book','books','booking','dictionary','accommodation','knowledge',
       'semantic','chronological','collocation','subordinate','pitfall','receive',
       'interpersonal skills','reach out','éclair','café','résumé','run','house','I']


def build(path):
    with closing(sqlite3.connect(path)) as db:
        db.executescript('CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE entries(id INTEGER PRIMARY KEY,key TEXT,compact TEXT,word TEXT,body BLOB,target TEXT);')
        db.executemany('INSERT INTO metadata VALUES (?,?)',[('source_sha256',hashlib.sha256(b'Original spelling definitions').hexdigest()),('edition','original-spelling')])
        for identifier,word in enumerate(WORDS):
            key=unicodedata.normalize('NFC',word).lower()
            html='<div class="entry"><span class="headword">'+word+'</span><deft><chn>原创释义 · '+word+'</chn></deft></div>'
            db.execute('INSERT INTO entries VALUES (?,?,?,?,?,NULL)',(identifier,key,''.join(char for char in key if char.isalnum()),word,zlib.compress(html.encode('utf-8'))))
        for offset,(word,key,target) in enumerate([('ran','ran','run'),('receiving','receiving','receive'),('houses','houses','house'),('run_1','run 1','run')]):
            db.execute('INSERT INTO entries VALUES (?,?,?,?,NULL,?)',(len(WORDS)+offset,key,''.join(char for char in key if char.isalnum()),word,target))
        db.commit()


if __name__=='__main__':build(Path(sys.argv[1]))
