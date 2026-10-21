"""按原始 UV 对应，求原游戏面部对象坐标到当前 PMX 静止姿态的旋转。"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
import numpy as np

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--capture',type=Path,required=True)
p.add_argument('--pmx',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();b=a.capture
layout=next(x for x in json.loads((b/'capture-assets/input-layouts.json').read_text(encoding='utf-8')) if x['eventId']==2500)
buffers={x['slot']:(x['stride'],(b/'capture-assets'/x['file']).read_bytes()) for x in layout['buffers']}
def read(semantic,index,vertex):
    attr=next(x for x in layout['attributes'] if x['semantic']==semantic and x['semanticIndex']==index)
    stride,data=buffers[attr['slot']]
    fmt={'R32G32B32_FLOAT':'<3f','R32G32_FLOAT':'<2f','R16G16_FLOAT':'<2e'}[attr['format']]
    return struct.unpack_from(fmt,data,int(vertex)*stride+attr['offset'])
def key(uv):
    return tuple(np.array(uv,dtype=np.float16).view(np.uint16).tolist())
indices=np.fromfile(b/'capture-assets'/layout['indexBuffer']['file'],dtype='<u2')
indices=np.unique(indices[layout['indexOffset']:layout['indexOffset']+layout['count']]).astype(np.int64)+layout['baseVertex']
lookup={}
for vertex in indices:
    lookup.setdefault(key(read('TEXCOORD',0,vertex)),[]).append(read('POSITION',0,vertex))
pmx=json.loads((b/'capture-analysis/pmx-bind-face.json').read_text(encoding='utf-8'));source=[];target=[]
for vertex in pmx['vertices']:
    uv=key([vertex['uv'][0],1-vertex['uv'][1]])
    if uv in lookup:
        source.append(np.mean(lookup[uv],axis=0));target.append(vertex['position'])
x,y=np.array(source),np.array(target);mask=np.ones(len(x),bool)
for _ in range(3):
    xm=x[mask].mean(axis=0);ym=y[mask].mean(axis=0)
    u,_,vt=np.linalg.svd((x[mask]-xm).T@(y[mask]-ym));rotation=vt.T@u.T
    translation=ym-rotation@xm;error=np.linalg.norm(x@rotation.T+translation-y,axis=1)
    mask=error<np.percentile(error,90)
report={'sourceDraw':2500,'pmxSha256':hashlib.sha256(a.pmx.read_bytes()).hexdigest(),'pairs':len(x),'fitCount':int(mask.sum()),
        'rotationColumnMajor':rotation.T.flatten().tolist(),'translationUnity':translation.tolist(),
        'errorMedianMeters':float(np.median(error)),'errorP90Meters':float(np.percentile(error,90)),
        'headBindPositionPmx':pmx['head']['position']}
a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report))
