"""Import user-supplied MDD volumes into a new, private media database."""
from contextlib import closing
from pathlib import Path
import argparse
import hashlib
import json
import sqlite3
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from dictionary_media import resource_key,mime_type,valid_bytes


def import_resources(sources,dictionary,output,reader_class):
    if output.exists() or output.with_suffix('.partial').exists():raise ValueError('输出文件或未完成导入已存在，请使用新的输出文件名')
    with closing(sqlite3.connect(dictionary.resolve().as_uri()+'?mode=ro',uri=True)) as db:
        row=db.execute("SELECT value FROM metadata WHERE key='source_sha256'").fetchone()
    if not row or len(row[0])!=64:raise ValueError('请指定已导入 MDX 的牛津数据库')
    dictionary_sha=row[0];output.parent.mkdir(parents=True,exist_ok=True);temporary=output.with_suffix('.partial')
    counts={'resources':0,'audio':0,'images':0,'duplicates':0,'unsupported':0};fingerprints=[]
    with closing(sqlite3.connect(temporary)) as db:
        db.executescript('CREATE TABLE resources(key TEXT PRIMARY KEY,mime TEXT NOT NULL,sha256 TEXT NOT NULL,body BLOB NOT NULL) WITHOUT ROWID; CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID;')
        for source in sources:
            with source.open('rb') as stream:fingerprints.append(hashlib.file_digest(stream,'sha256').hexdigest())
            for raw_key,body in reader_class(str(source)).items():
                key=resource_key(raw_key.decode('utf-8'))
                if not key or not valid_bytes(key,body):counts['unsupported']+=1;continue
                digest=hashlib.sha256(body).hexdigest();existing=db.execute('SELECT sha256 FROM resources WHERE key=?',(key,)).fetchone()
                if existing:
                    if existing[0]!=digest:raise ValueError('MDD 分卷包含不同内容的同名资源，未启用本次导入')
                    counts['duplicates']+=1;continue
                mime=mime_type(key);db.execute('INSERT INTO resources VALUES (?,?,?,?)',(key,mime,digest,body))
                counts['resources']+=1;counts['images' if mime.startswith('image/') else 'audio']+=1
        if not counts['resources']:raise ValueError('没有可导入的图片或音频资源，未启用本次导入')
        metadata={'format':'hange-dictionary-media-v1','dictionary_sha256':dictionary_sha,'sources':json.dumps(fingerprints),**{name:str(value) for name,value in counts.items()}}
        db.executemany('INSERT INTO metadata VALUES (?,?)',metadata.items());db.commit()
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('媒体索引校验失败')
    temporary.rename(output)
    return dict(counts,dictionary_sha256=dictionary_sha,source_sha256=fingerprints)


def main():
    parser=argparse.ArgumentParser(description='Import your own MDD volumes; no media is downloaded or published.')
    parser.add_argument('sources',nargs='+',type=Path)
    parser.add_argument('--dictionary',type=Path,default=ROOT/'server/data/oxford/oxford.db')
    parser.add_argument('--output',type=Path,default=ROOT/'server/data/oxford/media.db')
    parser.add_argument('--reader-dir',type=Path)
    args=parser.parse_args()
    if any(not source.is_file() or source.suffix.lower()!='.mdd' for source in args.sources):parser.error('请提供实际存在的 MDD 文件')
    if not args.dictionary.is_file():parser.error('请先导入 MDX 词库')
    if args.reader_dir:sys.path.insert(0,str(args.reader_dir))
    try:from mdict_utils.base.readmdict import MDD
    except ImportError:parser.error('请先安装可选读取器：python -m pip install mdict-utils==1.3.14')
    try:print(json.dumps(import_resources(args.sources,args.dictionary,args.output,MDD),ensure_ascii=False))
    except (ValueError,sqlite3.Error) as error:parser.error(str(error))


if __name__=='__main__':main()
