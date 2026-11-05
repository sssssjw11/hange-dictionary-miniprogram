"""Small original dictionary volumes for transfer tests, never publisher data."""
from pathlib import Path
import hashlib
import json
import struct
import sys
import zipfile
import zlib

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from pack_transfer import prepare_index,PackTransfer,REGISTRY


def bucket(text):
    value=2166136261
    for byte in text.encode():value=((value^byte)*16777619)&0xffffffff
    return value&255


def build(folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    html='<div class="entry"><h1 class="headword">transferword</h1><deft>A transfer fixture<chn>本地传输示例</chn></deft></div>'
    body=zlib.compress(html.encode());files={'parts/000.bin':body,'lengths.bin':b'\x0c','docs/000.json':json.dumps({'0':[0,0,len(body),'transferword','本地传输示例']},ensure_ascii=False).encode(),'keys/%02x.json'%bucket('transferword'):b'{"transferword":[0]}'}
    manifest={'format':'hange-oxford-pack','version':1,'buckets':256,'documentShardSize':512,'uniqueDocuments':1,'definitionRecords':1,'redirectRecords':0,'sourceSha256':'a'*64,'edition':'original-transfer-fixture','title':'Original transfer fixture','files':{name:{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in files.items()},'extractedBytes':sum(map(len,files.values()))}
    with zipfile.ZipFile(folder/'index.zip','w',compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,separators=(',',':')))
        for name,data in files.items():
            if not name.startswith('parts/'):archive.writestr(name,data)
    with zipfile.ZipFile(folder/'data.zip','w',compression=zipfile.ZIP_STORED) as archive:archive.writestr('parts/000.bin',body)
    prepare_index([folder/'data.zip',folder/'index.zip'],folder/REGISTRY)
    response=PackTransfer(folder,'a'*64).info();(folder/'response.json').write_text(json.dumps(response,ensure_ascii=False),encoding='utf-8')
    with zipfile.ZipFile(folder/'bad-local.zip','w') as archive:archive.writestr('lengths.bin',b'\0');archive.writestr('NOTICE.txt','second header')
    bad=bytearray((folder/'bad-local.zip').read_bytes());assert struct.unpack_from('<I',bad)[0]==0x04034b50;bad[30:41]=b'../bad.json';(folder/'bad-local.zip').write_bytes(bad)
    return response


if __name__=='__main__':build(Path(sys.argv[1]))
