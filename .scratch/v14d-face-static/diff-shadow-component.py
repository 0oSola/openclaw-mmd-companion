# -*- coding: utf-8 -*-
# faceShadowOnly 分量三联: Blender State2 mask 参考 | Web faceShadowOnly | Diff.
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image
ROOT = Path(__file__).resolve().parent
SCR = ROOT / ".scratch" / "v14d-face-static"
CAP = SCR / "capture"
def load(p): return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)/255.0
bm = load(SCR / "blender-face-mask-state2-linear.png")     # Blender 权威 mask 渲染 (白光)
wm = load(CAP / "face-static-faceShadowOnly.png")          # Web faceShadowOnly
ROI = [0.3462,0.3142,0.3052,0.3354]
def roi(img):
    h,w = img.shape[:2]
    return img[int(ROI[1]*h):int((ROI[1]+ROI[3])*h), int(ROI[0]*w):int((ROI[0]+ROI[2])*w)]
ra, rb = roi(bm), roi(wm)
H=min(ra.shape[0],rb.shape[0]); W=min(ra.shape[1],rb.shape[1])
dm = np.clip(np.abs(ra[:H,:W]-rb[:H,:W]).max(axis=-1)*4.0,0,1)
trip = np.concatenate([ra[:H,:W], np.ones((H,8,3)), rb[:H,:W], np.ones((H,8,3)), np.stack([dm]*3,-1)], axis=1)
Image.fromarray((np.clip(trip,0,1)*255).astype(np.uint8)).save(SCR/"v14d-face-shadow-component-diff.png")
# 脸部遮罩内均值 (排除白底>0.93)
def stat(img):
    px = roi(img).reshape(-1,3); m = ~((px[:,0]>0.93)&(px[:,1]>0.93)&(px[:,2]>0.93)); s=px[m]
    return {"samples": int(len(s)), "meanSrgb":[round(float(v),4) for v in s.mean(axis=0)]} if len(s) else {"samples":0}
print("===COMP-DIFF==="); print(json.dumps({"blenderMask": stat(bm), "webShadowOnly": stat(wm)}, ensure_ascii=False)); print("===END===")
