from contextlib import ExitStack
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from types import SimpleNamespace
from unittest.mock import patch,Mock
import io
import json
import sys
import unittest
from urllib.request import Request,urlopen
import wave

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from features import Features,Unavailable
from app import Handler
VOICES=[{'id':'English One','locale':'en-US'},{'id':'English Two','locale':'en-US'},{'id':'中文音色','locale':'zh-CN'}]


class VoiceTests(unittest.TestCase):
    def setUp(self):
        output=(ROOT/'output').resolve();output.mkdir(exist_ok=True);self.temp=TemporaryDirectory(prefix='voice-test-',dir=output);self.folder=Path(self.temp.name).resolve();assert self.folder.parent==output;self.addCleanup(self.temp.cleanup);self.generated=[]
        self.stack=ExitStack();self.addCleanup(self.stack.close);self.stack.enter_context(patch('features.RUNTIME',self.folder));self.stack.enter_context(patch('features.voices',return_value=VOICES));self.stack.enter_context(patch('features.ffmpeg_path',return_value=None));self.stack.enter_context(patch('features.subprocess.run',side_effect=self.generate));self.features=Features()

    def generate(self,arguments,**_):
        source=Path(arguments[arguments.index('-RequestFile')+1]);output=Path(arguments[arguments.index('-OutputFile')+1]);assert source.resolve().parent==self.folder/'audio';assert output.resolve().parent==self.folder/'audio';self.generated.append(json.loads(source.read_text('utf-8')))
        with wave.open(str(output),'wb') as target:target.setnchannels(1);target.setsampwidth(2);target.setframerate(16000);target.writeframes(b'\0\0'*160)
        return SimpleNamespace(returncode=0)

    def test_explicit_installed_voice_reaches_the_generator_and_reports_its_real_locale(self):
        result=self.features.synthesize('A voice test.','UK','en',0,'English Two');self.assertEqual(result['voice'],'English Two');self.assertEqual(result['locale'],'en-US');self.assertTrue(result['variantFallback']);self.assertTrue(result['voiceExplicit']);self.assertEqual(self.generated[0]['voice'],'English Two')
        result=self.features.synthesize('音色测试。','US','zh',-2,'中文音色');self.assertEqual(result['locale'],'zh-CN');self.assertEqual(self.generated[1]['rate'],-2)

    def test_automatic_fallback_and_invalid_voice_names_are_distinct(self):
        automatic=self.features.synthesize('Automatic.','UK');self.assertFalse(automatic['voiceExplicit']);self.assertTrue(automatic['variantFallback'])
        with self.assertRaises(Unavailable):self.features.synthesize('Text.','US','en',0,'Missing voice')
        with self.assertRaises(ValueError):self.features.synthesize('Text.','US','en',0,'中文音色')
        with self.assertRaises(ValueError):self.features.synthesize('Text.','US','en',0,'bad\nvoice')
        self.assertEqual(len(self.generated),1)

    def test_catalog_refresh_handles_empty_voice_lists(self):
        voices=Mock(return_value=[])
        with patch('features.voices',voices):self.assertFalse(self.features.voice_catalog(True)['available']);voices.cache_clear.assert_called_once()

    def test_http_catalog_and_selected_voice_payload(self):
        features=self.features
        class TestHandler(Handler):pass
        TestHandler.features=features;server=ThreadingHTTPServer(('127.0.0.1',0),TestHandler);Thread(target=server.serve_forever,daemon=True).start();self.addCleanup(server.server_close);self.addCleanup(server.shutdown);origin='http://127.0.0.1:'+str(server.server_port)
        with urlopen(origin+'/api/voices') as response:self.assertEqual(json.load(response)['voices'],VOICES)
        body=json.dumps({'text':'HTTP voice test.','variant':'US','language':'en','voice':'English Two'}).encode()
        with urlopen(Request(origin+'/api/tts',data=body,headers={'Content-Type':'application/json'})) as response:self.assertEqual(json.load(response)['voice'],'English Two')


if __name__=='__main__':unittest.main()
