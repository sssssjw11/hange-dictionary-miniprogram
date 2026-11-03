"""Document/HTTP contracts run in CI; real local engines are an explicit opt-in."""
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from app import Handler
from dictionary import Engine
from documents import extract
from features import Features,Unavailable,has_module

def multipart(blob,filename='sample.txt',language='en'):
    boundary='hange-test-boundary'
    body=(f'--{boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n{filename}\r\n'
          f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{language}\r\n'
          f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="input"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()+blob+f'\r\n--{boundary}--\r\n'.encode()
    return body,{'Content-Type':'multipart/form-data; boundary='+boundary}

@contextmanager
def api_server(features):
    with tempfile.TemporaryDirectory() as folder:
        class TestHandler(Handler):pass
        TestHandler.engine=Engine(Path(folder));TestHandler.features=features
        server=ThreadingHTTPServer(('127.0.0.1',0),TestHandler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:yield 'http://127.0.0.1:'+str(server.server_port)
        finally:server.shutdown();server.server_close();thread.join()

class DocumentTest(unittest.TestCase):
    def test_utf8_and_epub_spine_order_preserve_text_and_ignore_scripts(self):
        self.assertEqual(extract('\ufeffHello 中文🙂'.encode(),'story.txt')['documents'][0]['text'],'Hello 中文🙂')
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as archive:
            archive.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>')
            archive.writestr('OPS/book.opf','<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>')
            archive.writestr('OPS/a.xhtml','<h1>First</h1><p>Hello 中文🙂</p><script>untrusted()</script>')
            archive.writestr('OPS/b.xhtml','<h1>Second</h1><p>Read this first.</p>')
        result=extract(buffer.getvalue(),'book.epub')
        self.assertEqual([row['title'] for row in result['documents']],['Second','First'])
        self.assertIn('Hello 中文🙂',result['documents'][1]['text']);self.assertNotIn('untrusted',str(result))
        for blob,name in [(b'\xff','bad.txt'),(b'notzip','bad.epub'),(b'abc','bad.exe')]:
            with self.assertRaises(ValueError):extract(blob,name)

    def test_pdf_text_when_optional_parser_is_installed(self):
        if not has_module('fitz'):self.skipTest('Optional PDF dependency absent')
        import fitz
        with fitz.open() as book:
            page=book.new_page();page.insert_text((72,72),'Complete dictionary reading test.')
            blob=book.tobytes()
        result=extract(blob,'test.pdf');self.assertIn('Complete dictionary reading test.',result['documents'][0]['text'])

class ContractTest(unittest.TestCase):
    def test_missing_model_configuration_returns_unavailable_without_generated_answers(self):
        environment={key:value for key,value in os.environ.items() if not key.startswith('HANGE_AI_')}
        with patch.dict(os.environ,environment,clear=True),api_server(Features()) as base:
            caps=json.load(urlopen(base+'/api/capabilities'))
            self.assertFalse(caps['ai']['available']);self.assertFalse(caps['translation']['available'])
            for payload in [{'task':'chat','messages':[{'role':'user','content':'Explain run'}]},{'task':'translate','messages':[{'role':'user','content':'Hello'}]}]:
                with self.assertRaises(HTTPError) as caught:urlopen(Request(base+'/api/assistant',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'}))
                self.assertEqual(caught.exception.code,503);data=json.load(caught.exception);caught.exception.close()
                self.assertTrue(data['unavailable']);self.assertNotIn('text',data)

    def test_multipart_document_audio_ranges_and_input_errors(self):
        features=Features()
        with tempfile.TemporaryDirectory() as folder:
            audio=Path(folder)/'fixture.wav';audio.write_bytes(b'RIFF'+bytes(range(100)))
            class FixtureFeatures(Features):
                def audio(self,name):
                    if name!='fixture.wav':raise FileNotFoundError('missing')
                    return audio
            with api_server(FixtureFeatures()) as base:
                body,headers=multipart('Hello 中文🙂'.encode())
                result=json.load(urlopen(Request(base+'/api/document',data=body,headers=headers)))
                self.assertEqual(result['documents'][0]['text'],'Hello 中文🙂')
                response=urlopen(Request(base+'/api/audio/fixture.wav',headers={'Range':'bytes=4-13'}))
                self.assertEqual(response.status,206);self.assertEqual(response.read(),bytes(range(10)));response.close()
                for route,body,headers,expected in [('/api/audio/none',None,{},404),('/api/assistant',b'[]',{'Content-Type':'application/json'},400),('/api/document',b'bad',{'Content-Type':'text/plain'},400)]:
                    with self.assertRaises(HTTPError) as caught:urlopen(Request(base+route,data=body,headers=headers))
                    self.assertEqual(caught.exception.code,expected);caught.exception.close()
        with self.assertRaises(ValueError):features.synthesize({'text':'invalid'})
        with patch.dict(os.environ,{'HANGE_AI_BASE_URL':'http://127.0.0.1:1/v1','HANGE_AI_MODEL':'test'}):
            with self.assertRaises(ValueError):features.assistant({'messages':[None]})

@unittest.skipUnless(os.environ.get('HANGE_TEST_MEDIA')=='1','Set HANGE_TEST_MEDIA=1 for real installed OCR, TTS and Vosk engines')
class LocalMediaTest(unittest.TestCase):
    def test_actual_engines_through_http(self):
        from PIL import Image,ImageDraw,ImageFont
        features=Features();caps=features.capabilities()
        self.assertTrue(all(caps[key]['available'] for key in ['tts','ocr','asr']))
        image=Image.new('RGB',(1000,220),'white');draw=ImageDraw.Draw(image)
        font_path=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts/arial.ttf'
        font=ImageFont.truetype(str(font_path),48)
        draw.text((40,40),'dictionary hello world',fill='black',font=font)
        buffer=io.BytesIO();image.save(buffer,format='PNG')
        with api_server(features) as base:
            body,headers=multipart(buffer.getvalue(),'sample.png')
            ocr=json.load(urlopen(Request(base+'/api/ocr',data=body,headers=headers),timeout=120))
            self.assertIn('dictionary',ocr['text'].lower());self.assertIn('hello',ocr['text'].lower())
            payload=json.dumps({'text':'Hello world. This is a dictionary.','variant':'UK'}).encode()
            tts=json.load(urlopen(Request(base+'/api/tts',data=payload,headers={'Content-Type':'application/json'}),timeout=120))
            response=urlopen(base+tts['audioPath']);self.assertGreater(len(response.read()),1000);response.close()
            wav=ROOT/'server/runtime/audio'/(Path(tts['audioPath']).stem+'.wav')
            body,headers=multipart(wav.read_bytes(),'recording.wav')
            asr=json.load(urlopen(Request(base+'/api/asr',data=body,headers=headers),timeout=120))
            self.assertIn('hello world',asr['text'].lower());self.assertIn('dictionary',asr['text'].lower())
            payload=json.dumps({'text':'你好，今天我们学习英语。','language':'zh'}).encode()
            chinese_tts=json.load(urlopen(Request(base+'/api/tts',data=payload,headers={'Content-Type':'application/json'}),timeout=120))
            chinese_wav=ROOT/'server/runtime/audio'/(Path(chinese_tts['audioPath']).stem+'.wav')
            body,headers=multipart(chinese_wav.read_bytes(),'recording.wav',language='zh')
            chinese_asr=json.load(urlopen(Request(base+'/api/asr',data=body,headers=headers),timeout=120))
            self.assertIn('你好',chinese_asr['text']);self.assertIn('学习',chinese_asr['text'])
        report={'real_local_engines':True,'http_multipart_uploads':True,'ocr_text':ocr['text'],'asr_text':asr['text'],'asr_zh_text':chinese_asr['text'],'tts_locale':tts['locale'],'tts_zh_locale':chinese_tts['locale'],'uk_voice_fallback':tts['variantFallback'],'wechat_recording_camera_runtime_tested':False}
        (ROOT/'output').mkdir(exist_ok=True);(ROOT/'output/media-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')

if __name__=='__main__':unittest.main(verbosity=2)
