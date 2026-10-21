# -*- coding: utf-8 -*-
# 颜色空间隔离实验: 用同一组 Web UV, 分别采样以下三种 face_d 来源,
# 与 Web 实际捕获值对比, 定位颜色管理/解码链的第一次分歧:
#   A) Blender img.pixels(场景线性, 已 V 翻转)      —— Blender 权威口径
#   B) PIL 解码 PNG(sRGB 字节 -> sRGB->linear)      —— 无颜色管理的 PNG 原始口径
#   C) Chrome Canvas 2D 解码(colorSpaceConversion:none) —— 浏览器实际口径(近似 Web 引擎输入)
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

# A) Blender 权威(已 V 翻转)
bl = np.load(BL / "face-d-linear.npy").astype(np.float64)[::-1, :, :3]
# B) PIL 解码 -> sRGB->linear
pil = srgb_to_linear(load_png(r"D:\mmd\克莱妲原皮\Textures\c_Koleda_slg_face_d.png"))

uv_img = load_png(WEB / "web-face-uv.png")
face_mask = load_png(SAME / "web-face-mask.png", "L") > 0.5
web_normal = srgb_to_linear(load_png(ROOT / ".scratch" / "v14d-face-static" / "capture-final" / "face-static-normal.png"))
u = uv_img[..., 0]; v = uv_img[..., 1]

def bilinear(img, uu, vv):
    h, w = img.shape[:2]
    x = (uu % 1.0) * w - 0.5; y = (vv % 1.0) * h - 0.5
    x0 = np.clip(np.floor(x).astype(int), 0, w-1); y0 = np.clip(np.floor(y).astype(int), 0, h-1)
    x1 = np.clip(x0+1, 0, w-1); y1 = np.clip(y0+1, 0, h-1)
    wx = (x - np.floor(x))[..., None]; wy = (y - np.floor(y))[..., None]
    return (img[y0,x0]*(1-wx)+img[y0,x1]*wx)*(1-wy)+(img[y1,x0]*(1-wx)+img[y1,x1]*wx)*wy

bl_s = bilinear(bl, u, v)
pil_s = bilinear(pil, u, v)

def masked_mean(img, m): return [float(img[m][..., c].mean()) for c in range(3)]
def masked_diff(a, b, m): return [float(np.abs(a-b)[m][..., c].mean()) for c in range(3)]

report = {
    "sampledAtWebUv": {
        "A_blender_linear": masked_mean(bl_s, face_mask),
        "B_pil_srgb_to_linear": masked_mean(pil_s, face_mask),
        "C_web_capture": masked_mean(web_normal, face_mask),
    },
    "diffVsWeb": {
        "A_blender": masked_diff(bl_s, web_normal, face_mask),
        "B_pil": masked_diff(pil_s, web_normal, face_mask),
    },
    "blenderVsPil_atSameUv": masked_diff(bl_s, pil_s, face_mask),
    "note": "A vs B 的差异 = Blender img.pixels 与 PNG 原始字节的解码差异; B vs Web = Web 引擎采样/上传差异。",
}
(OUT / "colorspace-isolation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
