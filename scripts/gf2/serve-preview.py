"""提供克莱妲原游戏材质的独立本机预览。"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import quote, unquote, urlparse
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=18748)
parser.add_argument('--assets', type=Path, required=True)
parser.add_argument('--model', type=Path, default=Path('D:/mmd/克莱妲原皮'))
parser.add_argument('--motion', type=Path, default=ROOT / '.scratch/koleda-current-preview-20261018/assets')
args = parser.parse_args()
MOUNT_NAMES = {'game-assets': 'assets', 'model': 'model', 'motion': 'motion', 'stage-motions': 'stage_motions',
               'runtime': 'runtime', 'vendor': 'vendor'}
mounts = {'/game-assets/': args.assets, '/model/': args.model, '/motion/': args.motion,
          '/stage-motions/': ROOT / 'ak-12/vmd/v1.1/查验_2026.10.12_09.59.39',
          '/runtime/': ROOT / 'web/src/features/stage', '/vendor/three/': ROOT / 'web/node_modules/three',
          '/vendor/three-stdlib/': ROOT / 'web/node_modules/three-stdlib'}


def stage_idle_motions():
    """主舞台待机循环使用的动作清单，与 characterIdlePlaylist 同源筛选规则。"""
    catalog = json.loads((ROOT / 'web/src/features/stage/characterIdleCatalog.json').read_text(encoding='utf-8'))
    # 主舞台按 L0x_02 循环段轮播，L05 只有躺姿循环不参与；A03 进场放在最前。
    entries = [item for item in catalog
               if not item['filename'].startswith('L05_') and re.match(r'^L\d+_02_', item['filename'])]
    entries.sort(key=lambda item: item['filename'].split('_')[0])
    entrance = [item for item in catalog if item['filename'].startswith('A03_')]
    return [{'filename': item['filename'], 'url': '/stage-motions/' + quote(item['filename']),
             'size_bytes': item.get('size_bytes', 0)} for item in entrance + entries]

class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        if urlparse(self.path).path == '/stage-motions.json':
            body = json.dumps({'motions': stage_idle_motions()}, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

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
