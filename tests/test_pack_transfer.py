from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import json
import sys
import unittest
from urllib.request import urlopen,Request
from urllib.error import HTTPError
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from pack_transfer import PackTransfer,prepare_index,REGISTRY
from app import Handler
from transfer_fixture import build


class TransferTests(unittest.TestCase):
    def setUp(self):
        output=(ROOT/'output').resolve();output.mkdir(exist_ok=True);self.temp=TemporaryDirectory(prefix='transfer-server-',dir=output);self.folder=Path(self.temp.name).resolve();assert self.folder.parent==output;self.addCleanup(self.temp.cleanup);self.info=build(self.folder);self.transfer=PackTransfer(self.folder,'a'*64)

    def test_only_indexed_volumes_and_the_current_build_are_available(self):
        self.assertTrue(self.info['available']);self.assertEqual(self.info['volumes'][0]['name'],'index.zip');self.assertEqual(self.transfer.volume(self.info['buildId'],1),self.folder/'data.zip')
        self.assertFalse(PackTransfer(self.folder,'b'*64).info()['available'])
        with self.assertRaises(ValueError):self.transfer.volume(self.info['buildId'],-1)
        with self.assertRaises(ValueError):self.transfer.volume('b'*64,0)
        (self.folder/'data.zip').write_bytes(b'changed');self.assertFalse(self.transfer.info()['available'])

    def test_incomplete_and_unsafe_archives_never_create_a_transfer_index(self):
        with self.assertRaises(ValueError):prepare_index([self.folder/'index.zip'],self.folder/'incomplete.json')
        self.assertFalse((self.folder/'incomplete.json').exists())
        with zipfile.ZipFile(self.folder/'unsafe.zip','w') as archive:archive.writestr('../study.json','unsafe')
        with self.assertRaises(ValueError):prepare_index([self.folder/'unsafe.zip'],self.folder/'unsafe.json')
        self.assertFalse((self.folder/'unsafe.json').exists())

    def test_http_metadata_and_bounded_file_reading(self):
        transfer=self.transfer
        class TestHandler(Handler):pass
        TestHandler.transfer=transfer;server=ThreadingHTTPServer(('127.0.0.1',0),TestHandler);Thread(target=server.serve_forever,daemon=True).start();self.addCleanup(server.server_close);self.addCleanup(server.shutdown);origin='http://127.0.0.1:'+str(server.server_port)
        with urlopen(origin+'/api/offline-pack') as response:data=json.load(response)
        url=origin+'/api/offline-pack/file?buildId='+data['buildId']+'&volume=0'
        with urlopen(Request(url,headers={'Range':'bytes=4-19'})) as response:self.assertEqual(response.status,206);self.assertEqual(response.headers['Content-Type'],'application/zip');self.assertEqual(response.read(),(self.folder/'index.zip').read_bytes()[4:20])
        with self.assertRaises(HTTPError) as error:urlopen(origin+'/api/offline-pack/file?buildId='+data['buildId']+'&volume=99')
        self.assertEqual(error.exception.code,400);error.exception.close()


if __name__=='__main__':unittest.main()
