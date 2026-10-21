"""提供克莱妲原游戏材质的独立本机预览。"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse
import argparse
import re

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18748)
parser.add_argument('--assets', type=Path, required=True)
parser.add_argument('--model', type=Path, default=Path('D:/mmd/克莱妲原皮'))
parser.add_argument('--motion', type=Path, default=ROOT / '.scratch/koleda-current-preview-20261018/assets')
args = parser.parse_args()
mounts = {'/game-assets/': args.assets, '/model/': args.model, '/motion/': args.motion,
          '/runtime/': ROOT / 'web/src/features/stage', '/vendor/three/': ROOT / 'web/node_modules/three',
          '/vendor/three-stdlib/': ROOT / 'web/node_modules/three-stdlib'}

class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def translate_path(self, url):
        value = unquote(urlparse(url).path)
        base, tail = ROOT / 'web/previews/gf2', value.lstrip('/') or 'index.html'
        for prefix, folder in mounts.items():
            if value.startswith(prefix):
                base, tail = folder, value[len(prefix):]
                break
        target = (base / tail).resolve()
        return str(target if target.is_relative_to(base.resolve()) else ROOT / '__denied__')

    def list_directory(self, path):
        self.send_error(403)
        return None

    def end_headers(self):
        versioned = re.fullmatch(r'pack-[0-9a-f]{64}\.bin\.gz', Path(urlparse(self.path).path).name) is not None
        self.send_header('Cache-Control', 'private, max-age=31536000, immutable' if versioned else 'no-store')
        super().end_headers()

    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.rgba16f': 'application/octet-stream'}

server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
print(f'http://127.0.0.1:{args.port}/', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
