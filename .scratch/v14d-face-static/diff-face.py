# -*- coding: utf-8 -*-
# Blender/Web/Diff 三联图 + 脸部 ROI 数值对比 (Face 材质隔离).
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
CAP = ROOT / ".scratch" / "v14d-face-static" / "capture"
SCR = ROOT / ".scratch" / "v14d-face-static"
OUT = SCR
ROI = [0.3462, 0.3142, 0.3052, 0.3354]  # 640 归一化

def load(p): return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0
def srgb_to_linear(c): return np.where(c <= 0.04045, c/12.92, ((c+0.055)/1.055)**2.4)

blender = load(SCR / "blender-face-composite-state2-linear.png")  # Blender Standard/SceneLinear 存为 PNG (近似 sRGB 显示)
web_normal = load(CAP / "face-static-normal.png")
web_shadow = load(CAP / "face-static-faceShadowOnly.png")

# ROI 像素块
def roi(img):
    h, w = img.shape[:2]
    x0=int(ROI[0]*w); y0=int(ROI[1]*h); x1=int((ROI[0]+ROI[2])*w); y1=int((ROI[1]+ROI[3])*h)
    return img[y0:y1, x0:x1]

# 脸部像素掩码 (肤色: 偏亮粉, 排除白底/暗发/紫发)
def face(px):
    r,g,b = px[...,0], px[...,1], px[...,2]
    return (r>0.45) & (r>g*1.02) & (g>b*0.85) & (b<r) & ~((r>0.93)&(g>0.93)&(b>0.93))

def stats(img, name):
    px = roi(img); m = face(px); sel = px[m]
    if len(sel)==0: return {"name": name, "faceSamples": 0}
    lin = srgb_to_linear(sel)
    return {"name": name, "faceSamples": int(len(sel)),
            "meanSrgb": [round(float(v),4) for v in sel.mean(axis=0)],
            "meanLinear": [round(float(v),4) for v in lin.mean(axis=0)]}

bs = stats(blender, "blender-white-composite")
wn = stats(web_normal, "web-normal")
ws = stats(web_shadow, "web-faceShadowOnly")

# Diff 图 (Blender vs Web normal, 脸部 ROI 区域放大差异)
def diff_map(a, b):
    d = np.abs(a - b).max(axis=-1)
    return np.clip(d * 4.0, 0, 1)  # 放大 4x 可视化
ra, rb = roi(blender), roi(web_normal)
H = min(ra.shape[0], rb.shape[0]); W = min(ra.shape[1], rb.shape[1])
dm = diff_map(ra[:H,:W], rb[:H,:W])

# 三联图
pad = np.ones((H, 8, 3))
trip = np.concatenate([ra[:H,:W], pad, rb[:H,:W], pad, np.stack([dm]*3, axis=-1)], axis=1)
Image.fromarray((np.clip(trip,0,1)*255).astype(np.uint8)).save(OUT / "v14d-face-static-blender-web-diff.png")

# 全图三联 (整帧)
fa, fb = blender, web_normal
hh = min(fa.shape[0], fb.shape[0]); ww = min(fa.shape[1], fb.shape[1])
fdfull = np.clip(np.abs(fa[:hh,:ww]-fb[:hh,:ww]).max(axis=-1)*4.0, 0, 1)
fulltrip = np.concatenate([fa[:hh,:ww], np.ones((hh,8,3)), fb[:hh,:ww], np.ones((hh,8,3)), np.stack([fdfull]*3,-1)], axis=1)
Image.fromarray((np.clip(fulltrip,0,1)*255).astype(np.uint8)).save(OUT / "v14d-face-static-fullframe-diff.png")

report = {"roi_norm": ROI, "blender": bs, "webNormal": wn, "webShadowOnly": ws,
          "note": "Blender=白光 Principled(含State2阴影) SceneLinear; Web normal/finalComposite=预烘焙合成图 unlit(无光照). 两者口径不同(照明), 属票据披露的未迁移灯光/AgX 剩余差异.",
          "diffImages": ["v14d-face-static-blender-web-diff.png", "v14d-face-static-fullframe-diff.png"]}
(OUT / "blender-web-roi.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("===DIFF-BEGIN==="); print(json.dumps(report, ensure_ascii=False, indent=2)); print("===DIFF-END===")
