"""Local development API; deploy behind HTTPS for a real WeChat release."""
import argparse
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlparse
from dictionary import Engine


class Handler(BaseHTTPRequestHandler):
    engine = None

    def do_GET(self):
        route = urlparse(self.path)
        query = parse_qs(route.query)
        try:
            if route.path == '/api/health':
                data = self.engine.status()
            elif route.path == '/api/lookup':
                data = self.engine.lookup(query.get('q', [''])[0])
            elif route.path == '/api/suggest':
                data = {'rows': self.engine.suggest(query.get('q', [''])[0])}
            else:
                return self.respond(404, {'error': '接口不存在'})
            self.respond(200, data)
        except ValueError as error:
            self.respond(400, {'error': str(error)})
        except FileNotFoundError as error:
            self.respond(503, {'error': str(error)})
        except Exception:
            self.respond(500, {'error': '本地词库查询失败，请检查服务端控制台'})
            import traceback
            traceback.print_exc()

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
