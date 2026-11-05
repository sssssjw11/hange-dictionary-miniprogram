from contextlib import closing
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import base64
import importlib.util
import io
import json
import os
import sqlite3
import sys
import unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import wave

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from dictionary_media import resource_key,media_references,MediaStore
from app import Handler
spec=importlib.util.spec_from_file_location('import_mdd',ROOT/'scripts/import_mdd.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
SHA='a'*64
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==')


def wav():
    output=io.BytesIO()
    with wave.open(output,'wb') as stream:stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(16000);stream.writeframes(b'\0\0'*160)
    return output.getvalue()


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.dictionary=self.root/'oxford.db'
        with closing(sqlite3.connect(self.dictionary)) as db:db.execute('CREATE TABLE metadata(key TEXT,value TEXT)');db.execute('INSERT INTO metadata VALUES (?,?)',('source_sha256',SHA));db.commit()

    def test_references_and_virtual_keys(self):
        self.assertEqual(resource_key('\\Pictures\\CAT.PNG'),'pictures/cat.png')
        for value in ['../x.png','%2e%2e/x.png','file:///x.png','https://example.invalid/x.png','x.svg','x.js']:self.assertIsNone(resource_key(value))
        refs=media_references('<ul><li><audio-wr><a class="pron-us" href="sound://clip.wav"></a></audio-wr><span class="x">A test sentence.</span></li></ul><img src="res://picture.png" alt="Picture"><script><img src="bad.png"></script>')
        self.assertEqual(refs,[{'key':'clip.wav','kind':'audio','variant':'US','label':'例句 · A test sentence.'},{'key':'picture.png','kind':'image','variant':'','label':'Picture'}])

    def test_private_import_binding_and_http_resource_ranges(self):
        audio=wav();source=self.root/'resources.mdd';source.write_bytes(b'fixture')
        class Reader:
            def __init__(self,_):pass
            def items(self):return iter([(b'\\picture.png',PNG),(b'\\clip.wav',audio),(b'\\script.js',b'alert(1)'),(b'\\picture.png',PNG)])
        output=self.root/'media.db';counts=module.import_resources([source],self.dictionary,output,Reader)
        self.assertEqual((counts['images'],counts['audio'],counts['unsupported'],counts['duplicates']),(1,1,1,1))
        store=MediaStore(output,SHA);self.assertTrue(store.status()['available']);self.assertFalse(MediaStore(output,'b'*64).status()['available'])
        with self.assertRaises(ValueError):module.import_resources([source],self.dictionary,output,Reader)
        class Engine:media=store
        class TestHandler(Handler):engine=Engine();features=object()
        server=ThreadingHTTPServer(('127.0.0.1',0),TestHandler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown);origin='http://127.0.0.1:'+str(server.server_port)
        data=json.dumps({'keys':['clip.wav','missing.wav'],'sourceSha256':SHA}).encode()
        with urlopen(Request(origin+'/api/dictionary-media/resolve',data=data,headers={'Content-Type':'application/json'})) as response:resolved=json.load(response)
        self.assertTrue(resolved['rows'][0]['available']);self.assertFalse(resolved['rows'][1]['available'])
        with urlopen(Request(origin+'/api/dictionary-media/file?key=clip.wav&sourceSha256='+SHA,headers={'Range':'bytes=4-11'})) as response:self.assertEqual(response.status,206);self.assertEqual(response.read(),audio[4:12])
        with urlopen(origin+'/api/dictionary-media/file?key=picture.png&sourceSha256='+SHA) as response:self.assertEqual(response.headers['Content-Type'],'image/png');self.assertEqual(response.read(),PNG)
        with self.assertRaises(HTTPError) as error:urlopen(origin+'/api/dictionary-media/file?key=clip.wav&sourceSha256='+'b'*64)
        self.assertEqual(error.exception.code,400)
        error.exception.close()

    def test_actual_mdd_reader_round_trip(self):
        reader_dir=os.environ.get('HANGE_MDICT_READER_DIR')
        if reader_dir:sys.path.insert(0,reader_dir)
        try:
            from mdict_utils.base.readmdict import MDD
            from mdict_utils.base.writemdict import MDictWriter
        except ImportError:self.skipTest('Optional mdict-utils reader not installed')
        source=self.root/'actual.mdd';audio=wav()
        with source.open('wb') as stream:MDictWriter({'\\picture.png':PNG,'\\clip.wav':audio},title='Original fixture',description='Generated test resources',is_mdd=True).write(stream)
        output=self.root/'actual-media.db';report=module.import_resources([source],self.dictionary,output,MDD)
        self.assertEqual(report['resources'],2);store=MediaStore(output,SHA)
        self.assertEqual(store.read('clip.wav',SHA),('audio/wav',audio));self.assertEqual(store.read('picture.png',SHA),('image/png',PNG))


if __name__=='__main__':unittest.main()
