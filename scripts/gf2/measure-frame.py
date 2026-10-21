"""比较同尺寸原游戏帧与网页重绘，保留像素指标和相同范围裁剪。"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--reference',type=Path,required=True)
p.add_argument('--render',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--roi',type=int,nargs=4,default=[980,70,580,1200],metavar=('X','Y','W','H'))
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
reference=Image.open(a.reference).convert('RGB');render=Image.open(a.render).convert('RGB')
if reference.size!=render.size:raise ValueError(f'画幅不同：{reference.size} / {render.size}')
original=np.asarray(reference);candidate=np.asarray(render);difference=np.abs(original.astype(np.int16)-candidate.astype(np.int16))
x,y,w,h=a.roi
def metrics(data):
    return {'meanAbsoluteByteError':float(data.mean()),'channelPercentiles':dict(zip(['50','90','95','99','100'],np.percentile(data,[50,90,95,99,100]).tolist())),
            'pixelsOver10':int((data.max(axis=2)>10).sum()),'pixelCount':int(data.shape[0]*data.shape[1])}
report={'reference':str(a.reference.resolve()),'render':str(a.render.resolve()),'width':reference.width,'height':reference.height,
        'referenceSha256':hashlib.sha256(a.reference.read_bytes()).hexdigest(),'renderSha256':hashlib.sha256(a.render.read_bytes()).hexdigest(),
        'fullFrame':metrics(difference),'characterRectangle':{'xywh':a.roi,**metrics(difference[y:y+h,x:x+w])},
        'measurement':'RGB显示字节；不缩放、不对齐、不调色。人物矩形不是逐像素人物遮罩。'}
(a.output/'metrics.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
Image.fromarray(np.clip(difference*6,0,255).astype('uint8')).save(a.output/'difference-x6.png')
box=(x,y,x+w,y+h);reference.crop(box).save(a.output/'reference-character.png');render.crop(box).save(a.output/'render-character.png')
pair=Image.new('RGB',(w*2,h));pair.paste(reference.crop(box),(0,0));pair.paste(render.crop(box),(w,0));pair.save(a.output/'character-comparison.png')
print(json.dumps({k:report[k]for k in ['fullFrame','characterRectangle']},ensure_ascii=False))
