"""把 RenderDoc 已导出的角色绘制整理为本机网页可消费的资源。"""
import argparse
import json
import os
import struct
from pathlib import Path
from PIL import Image

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--capture', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
src = a.capture.resolve()
dst = a.output.resolve()
dst.mkdir(parents=True, exist_ok=True)
assets = json.loads((src / 'capture-assets/capture-assets.json').read_text(encoding='utf-8'))
draws = json.loads((src / 'capture-analysis/draws/draw-index.json').read_text(encoding='utf-8'))
states = {d['eventId']: d for d in json.loads((src / 'capture-assets/draw-states.json').read_text(encoding='utf-8'))}
meshes = {d['eventId']: d for d in assets['draws']}

def link(folder, name):
    source, target = src / folder / name, dst / name
    if not target.exists():
        os.link(source, target)
    return name

result = {'width': 3470, 'height': 1803, 'frame': 7480, 'draws': [], 'shadows': [], 'pipeline': [], 'textures': assets['textures']}
for d in draws:
    eid = d['eventId']
    m = meshes[eid]
    attributes, offset = [], 0
    # RenderDoc 按签名顺序紧密保存输出；同一个寄存器的不同分量可以共用它。
    signature=d['stages']['vs']['outputSignature']
    for s in sorted(signature, key=lambda s: s['semanticIdxName'] != 'SV_POSITION'):
        attributes.append({'register': s['regIndex'], 'components': s['compCount'], 'mask': s['regChannelMask'],
                           'semantic': s['semanticIdxName'], 'offset': offset})
        offset += s['compCount'] * 4
    assert offset == m['mesh']['vertexByteStride'], (eid, offset, m['mesh']['vertexByteStride'])
    fragment = 'shader-' + d['ps'].split('::')[-1] + '.glsl'
    entry = {'eventId': eid, 'fragment': link('capture-analysis/draws', fragment),
             'vertexShader': link('capture-analysis/draws', 'shader-' + d['stages']['vs']['shader'].split('::')[-1] + '.glsl'),
             'vertexInputs': [{'register': x['regIndex'], 'semantic': x['semanticIdxName'], 'components': x['compCount']} for x in d['stages']['vs']['inputSignature']],
             'vertexBlocks': [{'slot': b['slot'], 'file': link('capture-analysis/draws', b['file'])} for b in d['stages']['vs']['blocks']],
             'vertexFile': link('capture-assets', f'{eid}-vertices.bin'), 'indexFile': link('capture-assets', f'{eid}-indices.bin'),
             'stride': offset, 'indexStride': m['mesh']['indexByteStride'] or 4, 'count': m['mesh']['numIndices'],
             'attributes': attributes, 'inputs': [{'register': x['regIndex'], 'semantic': x['semanticIdxName'], 'mask': x['regChannelMask']} for x in d['stages']['ps']['inputSignature']],
             'blocks': [{'slot': b['slot'], 'file': link('capture-analysis/draws', b['file'])} for b in d['stages']['ps']['blocks']],
             'textures': {t['access']['index']: t['resource'] for t in d['textures']},
             'samplers': {s['access']['index']: s['sampler'] for s in m['samplers']}, 'state': states[eid],
             'outputs': d.get('outputs', []), 'depthTarget': d.get('depthTarget', 'ResourceId::8729')}
    if eid < 2200:
        result['shadows'].append(entry)
    elif eid <= 2849 or eid in [3356,3368]:
        result['draws'].append(entry)
    if 2849 < eid <= 3717:
        if eid in [3356,3368]:
            entry['outputs']=[{'id':'ResourceId::8708','format':'R16G16B16A16_FLOAT','width':3470,'height':1803},
                              {'id':'ResourceId::8715','format':'R8G8B8A8_UNORM','width':3470,'height':1803}]
        result['pipeline'].append(entry)
result['pipeline'].sort(key=lambda d:d['eventId'])
for tid in ['ResourceId::8164','ResourceId::8327','ResourceId::8248']:
    if tid in result['textures']:result['textures'][tid]['format']='R16_FLOAT'
for t in result['textures'].values():
    for s in t['subresources']:
        link('capture-assets', s['file'])
for name in ['reference-final.png', 'scene-after-character.png', 'scene-before-character.png']:
    link('capture-assets', name)
extra_path = src / 'capture-assets/extra.json'
if extra_path.exists():
    extra = json.loads(extra_path.read_text(encoding='utf-8'))
    for key, texture in extra['textures'].items():
        for sub in texture['subresources']:
            link('capture-assets', sub['file'])
    result['extra'] = extra
    link('capture-assets', 'reference-post.png')
    # 这些渲染目标的 Alpha 在游戏后期链中携带辅助数据，显示副本保留 RGB、移除透明合成。
    for original,display in [('reference-post.png','reference-post-display.png'),('scene-after-character.png','scene-after-character-display.png')]:
        Image.open(dst / original).convert('RGB').save(dst / display)
    link('capture-assets', 'post-8211.glsl')
    link('capture-assets', 'post-3717-cb0.bin')
layout_path = src / 'capture-assets/input-layouts.json'
if layout_path.exists():
    result['vertexColors'] = {}
    for layout in json.loads(layout_path.read_text(encoding='utf-8')):
        buffers = {b['slot']: (b['stride'], (src / 'capture-assets' / b['file']).read_bytes()) for b in layout['buffers']}
        def read_attribute(semantic, semantic_index, vertex):
            attr = next(x for x in layout['attributes'] if x['semantic'] == semantic and x['semanticIndex'] == semantic_index)
            stride, raw = buffers[attr['slot']]
            if semantic == 'TEXCOORD' and semantic_index == 1 and attr['format'] == 'R8G8B8A8_UNORM':
                return (0.0, 0.0)  # 当前眼部变体未读取这一占位输入。
            fmt = {'R16G16_FLOAT': '<2e', 'R32G32_FLOAT': '<2f', 'R32G32B32A32_FLOAT': '<4f'}[attr['format']]
            return struct.unpack_from(fmt, raw, vertex * stride + attr['offset'])
        index = (src / 'capture-assets' / layout['indexBuffer']['file']).read_bytes()
        index_size = layout['indexBuffer']['stride']
        vertices = sorted({struct.unpack_from('<H' if index_size == 2 else '<I', index, i * index_size)[0] + layout['baseVertex']
                           for i in range(layout['indexOffset'], layout['indexOffset'] + layout['count'])})
        packed = bytearray()
        for vertex in vertices:
            packed.extend(struct.pack('<8f', *read_attribute('TEXCOORD', 0, vertex),
                                      *read_attribute('TEXCOORD', 1, vertex), *read_attribute('COLOR', 0, vertex)))
        filename = f"colors-{layout['eventId']}.bin"
        (dst / filename).write_bytes(packed)
        result['vertexColors'][layout['eventId']] = filename
(dst / 'frame.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'draws': len(result['draws']), 'textures': len(result['textures']), 'output': str(dst)}, ensure_ascii=False))
