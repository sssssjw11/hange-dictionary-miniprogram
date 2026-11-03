"""Convert a user-supplied local MDX into the private read-only SQLite schema."""
from pathlib import Path
from contextlib import closing
import argparse
import hashlib
import json
import sqlite3
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from dictionary import normalize


def main():
    parser = argparse.ArgumentParser(description='Import your own local MDX; nothing is downloaded or uploaded.')
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'server/data/oxford/oxford.db')
    parser.add_argument('--reader-dir', type=Path, help='Optional directory containing an installed mdict_utils package')
    args = parser.parse_args()
    if not args.source.is_file() or args.output.exists():
        parser.error('Source must exist and output must be a new file; existing dictionaries are never overwritten.')
    if args.reader_dir:
        sys.path.insert(0, str(args.reader_dir))
    try:
        from mdict_utils.base.readmdict import MDX
    except ImportError:
        parser.error('Install the optional reader first: python -m pip install mdict-utils==1.3.14')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.partial')
    if temporary.exists():
        parser.error('A partial import already exists. Choose another output path or inspect the partial file.')
    with args.source.open('rb') as source:
        source_hash = hashlib.file_digest(source, 'sha256').hexdigest()
    reader = MDX(str(args.source))
    definitions = aliases = 0
    with closing(sqlite3.connect(temporary)) as db:
        db.executescript('PRAGMA journal_mode=OFF; CREATE TABLE entries(id INTEGER PRIMARY KEY,key TEXT NOT NULL,compact TEXT NOT NULL,word TEXT NOT NULL,body BLOB,target TEXT); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;')
        batch = []
        for identifier, (raw_key, raw_value) in enumerate(reader.items(), 1):
            word = raw_key.decode('utf-8'); text = raw_value.decode('utf-8').strip('\x00\r\n ')
            key = normalize(word); compact = ''.join(char for char in key if char.isalnum())
            if text.startswith('@@@LINK='):
                target, body = text[len('@@@LINK='):].strip(), None; aliases += 1
            else:
                target, body = None, zlib.compress(text.encode(), 6); definitions += 1
            batch.append((identifier, key, compact, word, body, target))
            if len(batch) >= 2000:
                db.executemany('INSERT INTO entries VALUES (?,?,?,?,?,?)', batch); batch = []
        if batch:
            db.executemany('INSERT INTO entries VALUES (?,?,?,?,?,?)', batch)
        db.executescript('CREATE INDEX entries_key ON entries(key); CREATE INDEX entries_compact ON entries(compact);')
        db.executemany('INSERT INTO metadata VALUES (?,?)', [('edition', 'local-mdx-' + source_hash[:12]), ('source_sha256', source_hash), ('definitions', str(definitions)), ('aliases', str(aliases))])
        db.commit()
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    temporary.replace(args.output)
    print(json.dumps({'definition_records': definitions, 'redirect_records': aliases, 'source_sha256': source_hash}))


if __name__ == '__main__':
    main()
