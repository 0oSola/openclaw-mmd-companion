# -*- coding: utf-8 -*-
# 几何/UV 对应审计:
#   1) uvDebug 8-bit 量化误差下界(0.5/255 * 1024 ≈ 2 纹素)对 face_d 均值的影响
#   2) Web 屏幕捕获 vs Blender ref 的几何对齐(脸部像素质心/包围盒)
#   3) 在 UV 域扫描一个小平移, 看是否能显著降低 baseTexture 差异
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BL = ROOT / ".scratch" / "v14d-face-static" / "uv-align" / "blender"
WEB = ROOT / ".scratch" / "v14d-face-static" / "uv-align" / "web"
SAME = ROOT / ".scratch" / "v14d-face-static" / "same-metric"
OUT = ROOT / ".scratch" / "v14d-face-static" / "uv-align"

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def load_png(p, mode="RGB"):
    return np.asarray(Image.open(p).convert(mode), dtype=np.float64) / 255.0

face_lin = np.load(BL / "face-d-linear.npy").astype(np.float64)
uv_img = load_png(WEB / "web-face-uv.png")
face_mask = load_png(SAME / "web-face-mask.png", "L") > 0.5
web_normal = srgb_to_linear(load_png(ROOT / ".scratch" / "v14d-face-static" / "capture-final" / "face-static-normal.png"))
ref_normal = srgb_to_linear(load_png(BL / "blender-ref-normal.png"))
u = uv_img[..., 0]; v = uv_img[..., 1]
H, W = face_lin.shape[:2]

def bilinear(img, uu, vv):
    h, w = img.shape[:2]
    x = (uu % 1.0) * w - 0.5; y = (vv % 1.0) * h - 0.5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    x1 = x0 + 1; y1 = y0 + 1
    wx = (x - x0)[..., None]; wy = (y - y0)[..., None]
    x0 = np.clip(x0, 0, w-1); x1 = np.clip(x1, 0, w-1)
    y0 = np.clip(y0, 0, h-1); y1 = np.clip(y1, 0, h-1)
    return (img[y0,x0]*(1-wx)+img[y0,x1]*wx)*(1-wy)+(img[y1,x0]*(1-wx)+img[y1,x1]*wx)*wy

def masked_mean(img, m): return [float(img[m][..., c].mean()) for c in range(3)]
def masked_mean_diff(a, b, m): return [float(np.abs(a-b)[m][..., c].mean()) for c in range(3)]

# 1) 8-bit UV 量化误差影响: 在 ±0.5/255 范围内扰动 UV, 看重采样的均值摆动
step = 0.5 / 255.0
base = bilinear(face_lin[..., :3], u, v)
shift_right = bilinear(face_lin[..., :3], u + step, v)
shift_up = bilinear(face_lin[..., :3], u, v - step)
quant_swing = {
    "u+0.5/255": masked_mean_diff(base, shift_right, face_mask),
    "v-0.5/255": masked_mean_diff(base, shift_up, face_mask),
}

# 2) 几何对齐: Web 脸部 mask 质心/包围盒 vs Blender ref 的"脸部区域"
#    Blender ref 用白光渲染, 脸部是 ROI 内亮区; 用亮度阈值粗提取脸部连通域
ref_luma = ref_normal.mean(axis=-1)
ref_face = (ref_luma > 0.3)  # 粗阈值
ys, xs = np.where(face_mask)
web_bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
web_centroid = [float(xs.mean()), float(ys.mean())]
rys, rxs = np.where(ref_face)
ref_bbox = [int(rxs.min()), int(rys.min()), int(rxs.max()), int(rys.max())] if len(rxs) else None
ref_centroid = [float(rxs.mean()), float(rys.mean())] if len(rxs) else None

# 3) UV 域小平移扫描(-4..4 纹素)
best = None
for du in range(-4, 5):
    for dv in range(-4, 5):
        s = bilinear(face_lin[..., :3], u + du / W, v + dv / H)
        d = masked_mean_diff(s, web_normal, face_mask)
        score = sum(d)
        if best is None or score < best["score"]:
            best = {"du": du, "dv": dv, "score": score, "meanAbsDiff": d}

report = {
    "uvQuantizationSwing": quant_swing,
    "geometry": {
        "webFaceBbox": web_bbox, "webFaceCentroid": web_centroid,
        "blenderRefFaceBbox(luma>0.3)": ref_bbox, "blenderRefFaceCentroid": ref_centroid,
    },
    "uvShiftScanBest": best,
    "webVsBlenderRef_sameScreenMask": masked_mean_diff(web_normal, ref_normal, face_mask),
    "note": "若 uvShiftScanBest.score << 默认差, 则根因是 UV 系统性偏移; 若几何质心/包围盒错位, 则是相机/投影差异。",
}
(OUT / "geometry-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
