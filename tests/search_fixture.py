"""Original dictionary examples shared by native-pack and service regressions."""
import hashlib
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import zlib

ENTRIES = [
    ('use', '<deft><chn>使用</chn></deft><xt><chn>我爱这里。</chn></xt>'),
    ('beloved', '<deft><chn>心爱的 / 爱</chn></deft>'),
    ('love', '<deft><chn>爱；热爱</chn></deft>'),
    ('aid', '<deft><chn>爱国的</chn></deft>'),
    ('compiler', '<deft><chn>C语言编译工具</chn></deft><custom>键盘输入</custom><script>忽略字符秘</script>'),
    ('rare', '<deft><chn>𠮷野家</chn></deft>'),
    ('input', '<custom>输入法</custom>'),
    ('typing', '<deft><chn>打字</chn></deft><custom>键盘输入</custom>'),
]


def build_source(path):
    with closing(sqlite3.connect(path)) as db:
        db.executescript('CREATE TABLE metadata(key TEXT,value TEXT); CREATE TABLE entries(id INTEGER PRIMARY KEY,key TEXT,compact TEXT,word TEXT,body BLOB,target TEXT);')
        db.executemany('INSERT INTO metadata VALUES (?,?)', [('source_sha256', hashlib.sha256(b'Original search examples').hexdigest()), ('edition', 'original-test')])
        for identifier, (word, html) in enumerate(ENTRIES):
            db.execute('INSERT INTO entries VALUES (?,?,?,?,?,NULL)', (identifier, word, word, word, zlib.compress(html.encode('utf-8'))))
        db.execute('INSERT INTO entries VALUES (8,?,?,?,?,?)', ('loved', 'loved', 'loved', None, 'love'))
        db.commit()


if __name__ == '__main__':
    build_source(Path(sys.argv[1]))
