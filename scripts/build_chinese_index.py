"""Build a private Chinese bigram FTS index; the source MDX database stays read-only."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3
import sys
import zlib
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from dictionary import connect

def build(source,output):
    if not source.is_file() or output.exists() or output.with_suffix('.partial').exists():raise ValueError('Source must exist; index and partial output paths must be new')
    output.parent.mkdir(parents=True,exist_ok=True);temporary=output.with_suffix('.partial')
    count=0
    with closing(connect(source)) as original,closing(sqlite3.connect(temporary)) as index:
        digest=original.execute("SELECT value FROM metadata WHERE key='source_sha256'").fetchone()[0]
        index.executescript("PRAGMA journal_mode=OFF; CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE documents(id INTEGER PRIMARY KEY,word TEXT,brief TEXT,length INTEGER); CREATE VIRTUAL TABLE search USING fts5(tokens,content='');")
        for identifier,word,body in original.execute('SELECT id,word,body FROM entries WHERE body IS NOT NULL'):
            soup=BeautifulSoup(zlib.decompress(body).decode(),'html.parser')
            for node in soup.select('script,style,audio-wr,.audio_play_button'):node.decompose()
            text=soup.get_text();first=soup.find('chn');brief=first.get_text().strip()[:240] if first else ''
            grams=set()
            for phrase in re.findall('[\u3400-\u9fff]+',text):grams.update(phrase[offset:offset+2] for offset in range(len(phrase)-1))
            if grams:
                index.execute('INSERT INTO documents VALUES (?,?,?,?)',(identifier,word,brief,len(text)))
                index.execute('INSERT INTO search(rowid,tokens) VALUES (?,?)',(identifier,' '.join(sorted(grams))))
            count+=1
            if count%10000==0:print('Indexed',count,'source definitions',flush=True)
        index.execute('INSERT INTO metadata VALUES (?,?)',('source_sha256',digest));index.commit()
        assert index.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    temporary.replace(output)
    return {'definitions':count,'sourceSha256':digest,'bytes':output.stat().st_size}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--database',type=Path,default=ROOT/'server/data/oxford/oxford.db');parser.add_argument('--output',type=Path,default=ROOT/'server/data/oxford/chinese.db')
    args=parser.parse_args();print(json.dumps(build(args.database,args.output)))
