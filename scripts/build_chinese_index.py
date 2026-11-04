"""Build a private Chinese character/bigram index; the source stays read-only."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import zlib

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from dictionary import connect
from oxford_summary import oxford_summary, visible_soup
from text_index import index_terms

def build(source,output):
    if not source.is_file() or output.exists() or output.with_suffix('.partial').exists():raise ValueError('Source must exist; index and partial output paths must be new')
    output.parent.mkdir(parents=True,exist_ok=True);temporary=output.with_suffix('.partial')
    count=0
    with closing(connect(source)) as original,closing(sqlite3.connect(temporary)) as index:
        digest=original.execute("SELECT value FROM metadata WHERE key='source_sha256'").fetchone()[0]
        index.executescript("PRAGMA journal_mode=OFF; CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE documents(id INTEGER PRIMARY KEY,word TEXT,brief TEXT,length INTEGER); CREATE VIRTUAL TABLE search USING fts5(tokens,content='');")
        for identifier,word,body in original.execute('SELECT id,word,body FROM entries WHERE body IS NOT NULL'):
            soup=visible_soup(zlib.decompress(body).decode())
            text=soup.get_text();brief=oxford_summary(soup)
            grams=index_terms(text)
            if grams:
                index.execute('INSERT INTO documents VALUES (?,?,?,?)',(identifier,word,brief,len(text)))
                index.execute('INSERT INTO search(rowid,tokens) VALUES (?,?)',(identifier,' '.join(sorted(grams))))
            count+=1
            if count%10000==0:print('Indexed',count,'source definitions',flush=True)
        index.executemany('INSERT INTO metadata VALUES (?,?)',[('source_sha256',digest),('single_character','1')]);index.commit()
        assert index.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    temporary.replace(output)
    return {'definitions':count,'sourceSha256':digest,'bytes':output.stat().st_size}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--database',type=Path,default=ROOT/'server/data/oxford/oxford.db');parser.add_argument('--output',type=Path,default=ROOT/'server/data/oxford/chinese.db')
    args=parser.parse_args();print(json.dumps(build(args.database,args.output)))
