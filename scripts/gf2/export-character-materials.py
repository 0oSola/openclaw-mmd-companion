"""从已核实的GF2材质证据导出克莱妲原皮贴图及程序分支。"""
from pathlib import Path
import argparse
import ctypes
import hashlib
import json
import struct
import time

import lz4.block
import UnityPy
from UnityPy.streams import EndianBinaryReader
from UnityPy.export.ShaderConverter import ShaderSubProgram

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--evidence', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
evidence = json.loads(args.evidence.read_text(encoding='utf-8'))
args.out.mkdir(parents=True, exist_ok=False)
(args.out / 'textures').mkdir()
(args.out / 'programs').mkdir()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def decode(raw):
    key = bytes(a ^ b for a, b in zip(raw[:16], b'UnityFS\0\0\0\0\x075.x.'))
    result = bytearray(raw)
    for i in range(min(len(raw), 32768)):
        result[i] ^= key[i % 16]
    return bytes(result)

def segments(file):
    with file.open('rb') as f:
        offset, total = 0, file.stat().st_size
        while offset < total:
            f.seek(offset)
            raw = f.read(64)
            if len(raw) < 64:
                raise ValueError(f'记录头截断: {file.name}:{offset}')
            h = decode(raw)
            size = struct.unpack_from('>Q', h, 30)[0]
            if not 64 <= size <= total - offset:
                # 缓存还含其他封装；本次只按已支持格式查找指定资源身份。
                return
            yield offset, size, h
            offset += size

def read_record(file, offset, size):
    with file.open('rb') as f:
        f.seek(offset)
        raw = f.read(size)
    return decode(raw)

envs = {}
locations = []
for loc in evidence['locations']:
    file = args.source / loc['file']
    for offset, size, h in segments(file):
        if offset != loc['offset']:
            continue
        data = read_record(file, offset, size)
        if sha(data) != loc['record_sha256']:
            raise ValueError('材质片段已变化，需要重新定位: ' + file.name)
        env = UnityPy.load(data)
        for asset in env.assets:
            envs[asset.name.lower()] = (env, asset)
        locations.append(loc)
        break

materials = {}
required = set()
for mat in evidence['materials']:
    saved = mat['saved_properties']
    textures = {}
    source_cab = next(loc['assets'][0].lower() for loc in evidence['locations'] if loc['file'] == mat['source_file'])
    for name, value in saved['m_TexEnvs']:
        ref = value['m_Texture']
        if not ref['m_PathID']:
            continue
        cab = mat['externals'][ref['m_FileID'] - 1].split('/')[-1].lower() if ref['m_FileID'] else source_cab
        required.add(cab)
        textures[name] = {'cab': cab, 'id': str(ref['m_PathID']), 'scale': value['m_Scale'], 'offset': value['m_Offset']}
    materials[mat['name']] = {'sourceId': mat['id'], 'shader': mat['shader_name'], 'keywords': mat['keywords'].split(),
                              'floats': dict(saved['m_Floats']), 'colors': dict(saved['m_Colors']), 'textures': textures}

missing = required - envs.keys()
start = time.monotonic()
for file in args.source.glob('*.bundle'):
    if not missing:
        break
    if time.monotonic() - start > 180:
        raise TimeoutError('贴图资源定位超过180秒: ' + ','.join(missing))
    with file.open('rb') as f:
        for offset, size, h in segments(file):
            n, unpacked, flags = struct.unpack_from('>III', h, 38)
            if flags & 128:
                continue
            f.seek(offset)
            key = bytes(a ^ b for a, b in zip(f.read(16), b'UnityFS\0\0\0\0\x075.x.'))
            f.seek(offset + 64)
            raw = f.read(n)
            c = bytes(v ^ key[(i + 64) % 16] if i + 64 < 32768 else v for i, v in enumerate(raw))
            kind = flags & 63
            if kind not in (0, 2, 3):
                continue
            info = lz4.block.decompress(c, uncompressed_size=unpacked) if kind else c
            hits = [cab for cab in missing if cab[4:].encode() in info]
            if not hits:
                continue
            data = read_record(file, offset, size)
            env = UnityPy.load(data)
            for asset in env.assets:
                cab = asset.name.lower()
                if cab in missing:
                    envs[cab] = (env, asset)
                    missing.remove(cab)
                    locations.append({'file': file.name, 'offset': offset, 'record_sha256': sha(data), 'assets': [asset.name]})
                    print('texture bundle', file.name, cab, flush=True)

if missing:
    raise ValueError('未定位贴图资源: ' + ','.join(missing))
exported = {}
for mat in materials.values():
    for slot, ref in mat['textures'].items():
        key = ref['cab'] + ':' + ref['id']
        if key not in exported:
            env, asset = envs[ref['cab']]
            obj = asset.objects[int(ref['id'])]
            texture = obj.read()
            stem = texture.m_Name + '-' + ref['id'].replace('-', 'n')
            path = args.out / 'textures' / (stem + '.png')
            entry = {'name': texture.m_Name, 'url': 'textures/' + path.name, 'width': texture.m_Width, 'height': texture.m_Height,
                     'format': int(texture.m_TextureFormat), 'colorSpace': texture.m_ColorSpace,
                     'settings': {k: getattr(texture.m_TextureSettings, k, None) for k in ('m_FilterMode', 'm_Aniso', 'm_MipBias', 'm_WrapU', 'm_WrapV', 'm_WrapW')}}
            if int(texture.m_TextureFormat) == 17:
                raw = texture.get_image_data()
                raw_path = args.out / 'textures' / (stem + '.rgba16f')
                raw_path.write_bytes(raw[:texture.m_Width * texture.m_Height * 8])
                entry['rawUrl'] = 'textures/' + raw_path.name
                entry['rawSha256'] = sha(raw_path.read_bytes())
                entry['url'] = entry['rawUrl']
                entry['sha256'] = entry['rawSha256']
            else:
                texture.image.convert('RGBA').save(path)
                entry['sha256'] = sha(path.read_bytes())
            exported[key] = entry
        ref.update(exported[key])

shader_file = args.source / evidence['shader_source']['file']
raw = shader_file.read_bytes()
if sha(raw) != evidence['shader_source']['sha256']:
    raise ValueError('着色器源包已变化')
shader_env = UnityPy.load(decode(raw))
program_report = []
dll = ctypes.WinDLL('d3dcompiler_47.dll')
disassemble = dll.D3DDisassemble
disassemble.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint, ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
disassemble.restype = ctypes.c_long
for obj in shader_env.objects:
    if obj.type.name != 'Shader':
        continue
    tree = obj.read_typetree()
    form = tree['m_ParsedForm']
    if form['m_Name'].split('/')[-1] not in ('uber', 'eye', 'eyeblend_add', 'eyeblend_multiply'):
        continue
    blob = bytes(tree['compressedBlob'])
    chunks = [lz4.block.decompress(blob[a:a+b], uncompressed_size=c) for a,b,c in zip(tree['offsets'][0], tree['compressedLengths'][0], tree['decompressedLengths'][0])]
    passes = form['m_SubShaders'][0]['m_Passes']
    for shader_pass in passes:
        if shader_pass['m_State']['m_Name'] != 'GFCharForward':
            continue
        indices = {v:k for k,v in shader_pass['m_NameIndices']}
        chosen = {}
        for variant in shader_pass['progFragment']['m_SubPrograms']:
            idx = variant['m_BlobIndex']
            offset, size, segment = struct.unpack_from('<iii', chunks[0], 4 + 12 * idx)
            reader = EndianBinaryReader(chunks[segment], endian='<')
            reader.Position = offset
            program = ShaderSubProgram(reader)
            keys = tuple(sorted(program.m_Keywords + getattr(program, 'm_LocalKeywords', [])))
            if any(x in ' '.join(keys) for x in ('HOLOGRAPHIC', 'DISSOLVE', 'HIT', 'ADDITIONAL_LIGHTS', 'SHADOWS', 'CONCEAL', 'TUTORIAL', 'GLITTER', 'WET', 'STOCKING')):
                continue
            if keys in chosen:
                continue
            chosen[keys] = (variant, program)
        for keys, (variant, program) in chosen.items():
            code = bytes(program.m_ProgramCode)
            pos = code.find(b'DXBC')
            if pos < 0:
                continue
            bytecode = code[pos:]
            bytecode = bytecode[:struct.unpack_from('<I', bytecode, 24)[0]]
            data = ctypes.create_string_buffer(bytecode)
            result = ctypes.c_void_p()
            hr = disassemble(data, len(bytecode), 0, None, ctypes.byref(result))
            if hr:
                raise RuntimeError('着色器反汇编失败: ' + str(hr))
            vt = ctypes.cast(result, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
            ptr = ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p)(vt[3])(result)
            length = ctypes.WINFUNCTYPE(ctypes.c_size_t, ctypes.c_void_p)(vt[4])(result)
            assembly = ctypes.string_at(ptr, length).decode('utf-8')
            ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vt[2])(result)
            stem = form['m_Name'].split('/')[-1] + '-' + str(variant['m_BlobIndex'])
            (args.out / 'programs' / (stem + '.asm')).write_text(assembly, encoding='utf-8')
            bindings = {x['m_NameIndex']: x['m_Index'] for x in variant['m_ConstantBufferBindings']}
            constants = {}
            for cb in variant['m_ConstantBuffers']:
                for param in cb['m_VectorParams']:
                    at = param['m_Index']
                    constants[indices[param['m_NameIndex']]] = f"cb{bindings[cb['m_NameIndex']]}[{at//16}].{'xyzw'[(at%16)//4]} ({param['m_Dim']})"
            program_report.append({'name': stem, 'shader': form['m_Name'], 'keywords': keys,
                                   'textures': {f"t{x['m_Index']}": indices[x['m_NameIndex']] for x in variant['m_TextureParams']}, 'constants': constants})

(args.out / 'programs.json').write_text(json.dumps(program_report, ensure_ascii=False, indent=2), encoding='utf-8')
(args.out / 'manifest.json').write_text(json.dumps({'materials': materials, 'sourceLocations': locations, 'sourceShader': evidence['shader_source'], 'textureCount': len(exported)}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'materials': len(materials), 'textures': len(exported), 'programs': len(program_report), 'out': str(args.out)}), flush=True)
