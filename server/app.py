"""Local development API; deploy behind HTTPS for a real WeChat release."""
import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from email.parser import BytesParser
from email.policy import default
import re
import sys
from urllib.parse import parse_qs, urlparse
from dictionary import Engine
from features import Features, Unavailable
from documents import extract as extract_document


class Handler(BaseHTTPRequestHandler):
    engine = None
    features = None

    def do_GET(self):
        route = urlparse(self.path)
        query = parse_qs(route.query)
        try:
            if route.path == '/api/health':
                data = self.engine.status()
            elif route.path == '/api/capabilities':
                if self.features is None:self.features=Features()
                data = self.features.capabilities()
            elif route.path.startswith('/api/audio/'):
                if self.features is None:self.features=Features()
                return self.send_audio(self.features.audio(route.path.rsplit('/',1)[1]))
            elif route.path == '/api/lookup':
                data = self.engine.lookup(query.get('q', [''])[0])
            elif route.path == '/api/supplement':
                data = self.engine.supplement(query.get('q',[''])[0])
            elif route.path == '/api/reverse':
                data = self.engine.chinese_page(query.get('q', [''])[0],int(query.get('cursor',['0'])[0]))
            elif route.path == '/api/suggest':
                data = {'rows': self.engine.suggest(query.get('q', [''])[0])}
            else:
                return self.respond(404, {'error': '接口不存在'})
            self.respond(200, data)
        except ValueError as error:
            self.respond(400, {'error': str(error)})
        except FileNotFoundError as error:
            self.respond(404 if route.path.startswith('/api/audio/') else 503, {'error': str(error)})
        except Exception:
            self.respond(500, {'error': '本地词库查询失败，请检查服务端控制台'})
            import traceback
            traceback.print_exc()

    def do_POST(self):
        route=urlparse(self.path).path
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=12*1024*1024:raise ValueError('请求内容为空或超过 12 MiB')
            body=self.rfile.read(length)
            if self.features is None:self.features=Features()
            if route in ['/api/tts','/api/assistant']:
                if length>256*1024:raise ValueError('文本请求过大')
                try:payload=json.loads(body)
                except (ValueError,UnicodeDecodeError) as error:raise ValueError('请求不是有效的 JSON') from error
                if not isinstance(payload,dict):raise ValueError('请求格式无效')
                if route=='/api/tts':data=self.features.synthesize(payload.get('text',''),payload.get('variant','US'),payload.get('language','en'),payload.get('rate',0))
                else:data=self.features.assistant(payload)
            elif route in ['/api/ocr','/api/asr','/api/document']:
                fields,blob=self.upload(body)
                if route=='/api/document':data=extract_document(blob,fields.get('filename','document.txt'))
                else:data=self.features.recognize_image(blob) if route=='/api/ocr' else self.features.recognize_audio(blob,fields.get('language','en'))
            else:return self.respond(404,{'error':'接口不存在'})
            self.respond(200,data)
        except Unavailable as error:self.respond(503,{'error':str(error),'unavailable':True})
        except ValueError as error:self.respond(400,{'error':str(error)})
        except Exception:
            self.respond(500,{'error':'服务处理失败，请检查服务端控制台'})
            import traceback
            traceback.print_exc()

    def upload(self,body):
        content_type=self.headers.get('Content-Type','')
        if not content_type.startswith('multipart/form-data') or len(content_type)>300:raise ValueError('请使用文件上传接口')
        message=BytesParser(policy=default).parsebytes(('Content-Type: '+content_type+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+body)
        fields={};blob=None
        if not message.is_multipart():raise ValueError('文件上传格式无效')
        for part in message.iter_parts():
            name=part.get_param('name',header='content-disposition');value=part.get_payload(decode=True)
            if name=='file':
                if blob is not None:raise ValueError('一次只支持一个文件')
                blob=value
            elif name in ['language','filename']:fields[name]=(value or b'').decode('utf-8')
        if not blob:raise ValueError('没有收到文件')
        return fields,blob

    def send_audio(self,path):
        total=path.stat().st_size;start=0;end=total-1;status=200
        header=self.headers.get('Range')
        if header:
            match=re.fullmatch(r'bytes=(\d+)-(\d*)',header)
            if not match:return self.respond(416,{'error':'音频范围无效'})
            start=int(match[1]);end=min(end,int(match[2])) if match[2] else end
            if start>end or start>=total:return self.respond(416,{'error':'音频范围超出文件'})
            status=206
        self.send_response(status);self.send_header('Content-Type','audio/mpeg' if path.suffix=='.mp3' else 'audio/wav');self.send_header('Accept-Ranges','bytes');self.send_header('Content-Length',str(end-start+1));self.send_header('Cache-Control','private, max-age=86400')
        if status==206:self.send_header('Content-Range','bytes %d-%d/%d'%(start,end,total))
        self.end_headers()
        with path.open('rb') as source:
            source.seek(start);remaining=end-start+1
            while remaining:
                data=source.read(min(65536,remaining))
                if not data:break
                self.wfile.write(data);remaining-=len(data)

    def respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, template, *args):
        # Query words and all learning records stay out of access logs.
        print(self.command, urlparse(self.path).path, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=18748)
    parser.add_argument('--data-dir', type=Path)
    args = parser.parse_args()
    Handler.engine = Engine(args.data_dir)
    Handler.features = Features()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print('Dictionary API: http://%s:%s/api/health' % (args.host, args.port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
