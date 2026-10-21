# -*- coding: utf-8 -*-
# 单变量对照实验: 隔离 Web 引擎 mipmap 三线性过滤 vs Blender 顶层 mip 双线性。
# 对同一组 Web UV, 分别在以下口径采样 Blender 权威 face_d 线性像素:
#   mip0_bilinear : 顶层 mip 双线性(= 之前 uv-direct-gate 的口径)
#   mip_chain     : 用 PIL 生成 sRGB mip 链(模拟引擎 generateMipmaps 的盒滤波),
#                   按脸部在屏幕上的缩小率选 mip 层, 在该层双线性
# 若 mip_chain 的均值贴近 Web 捕获值, 则根因锁定为 mipmap 过滤差异。
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

def linear_to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0.0), 1.0 / 2.4) - 0.055)

def load_png(p, mode="RGB"):
    return np.asarray(Image.open(p).convert(mode), dtype=np.float64) / 255.0

face_lin = np.load(BL / "face-d-linear.npy").astype(np.float64)
uv_img = load_png(WEB / "web-face-uv.png")
face_mask = load_png(SAME / "web-face-mask.png", "L") > 0.5
web_normal = srgb_to_linear(load_png(ROOT / ".scratch" / "v14d-face-static" / "capture-final" / "face-static-normal.png"))
u = uv_img[..., 0]; v = uv_img[..., 1]
H, W = face_lin.shape[:2]

# 脸部屏幕尺寸估计
ys, xs = np.where(face_mask)
screen_h = ys.max() - ys.min() + 1
screen_w = xs.max() - xs.min() + 1
screen_area = int(face_mask.sum())
# 脸部 UV 覆盖的纹理面积
u_span = u[face_mask].max() - u[face_mask].min()
v_span = v[face_mask].max() - v[face_mask].min()
tex_area = u_span * v_span * W * H
# 平均每纹素对应屏幕像素数的倒数 = 缩小率; 纹理像素/屏幕像素 > 1 表示缩小
texels_per_screen_px = tex_area / max(screen_area, 1)
# mip 层选择: log2(缩小率), 引擎是各向同性近似(无显式各向异性)
mip_level = float(np.log2(max(texels_per_screen_px, 1.0)) / 2.0)  # 面积->线性
mip_floor = int(np.floor(mip_level))

def bilinear(img, uu, vv):
    h, w = img.shape[:2]
    x = (uu % 1.0) * w - 0.5
    y = (vv % 1.0) * h - 0.5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    x1 = x0 + 1; y1 = y0 + 1
    wx = (x - x0)[..., None]; wy = (y - y0)[..., None]
    x0 = np.clip(x0, 0, w - 1); x1 = np.clip(x1, 0, w - 1)
    y0 = np.clip(y0, 0, h - 1); y1 = np.clip(y1, 0, h - 1)
    c00 = img[y0, x0]; c01 = img[y0, x1]; c10 = img[y1, x0]; c11 = img[y1, x1]
    return (c00 * (1 - wx) + c01 * wx) * (1 - wy) + (c10 * (1 - wx) + c11 * wx) * wy

# mip0 双线性(参考口径)
mip0 = bilinear(face_lin[..., :3], u, v)

# 模拟引擎 mip 链: sRGB PNG -> 逐层盒滤波下采样(在线性域做, 与引擎注释一致), 选层双线性
def build_mips(lin_img, levels):
    mips = [lin_img[..., :3]]
    cur = lin_img[..., :3]
    for _ in range(1, levels):
        h, w = cur.shape[:2]
        nh, nw = max(1, h // 2), max(1, w // 2)
        # 盒滤波: 2x2 平均
        cur = cur[: nh * 2, : nw * 2].reshape(nh, 2, nw, 2, 3).mean(axis=(1, 3))
        mips.append(cur)
    return mips

mips = build_mips(face_lin, mip_floor + 2)
mip_sampled = bilinear(mips[mip_floor], u, v)
# 也在相邻层之间线性插值(三线性)
if mip_floor + 1 < len(mips):
    frac = mip_level - mip_floor
    mip_next = bilinear(mips[mip_floor + 1], u, v)
    mip_trilinear = mip_sampled * (1 - frac) + mip_next * frac
else:
    mip_trilinear = mip_sampled

def masked_mean(img, m):
    return [float(img[m][..., c].mean()) for c in range(3)]

report = {
    "textureSize": [W, H],
    "faceScreen": {"w": int(screen_w), "h": int(screen_h), "area": screen_area},
    "uvSpan": {"u": float(u_span), "v": float(v_span)},
    "texelsPerScreenPx": float(texels_per_screen_px),
    "mipLevelEstimate": mip_level,
    "mipFloor": mip_floor,
    "meanLinear": {
        "blender_mip0_bilinear": masked_mean(mip0, face_mask),
        "blender_mip_chain_box": masked_mean(mip_sampled, face_mask),
        "blender_mip_trilinear": masked_mean(mip_trilinear, face_mask),
        "web_capture": masked_mean(web_normal, face_mask),
    },
    "diffVsWeb": {
        "mip0_bilinear": [float(a - b) for a, b in zip(masked_mean(mip0, face_mask), masked_mean(web_normal, face_mask))],
        "mip_chain_box": [float(a - b) for a, b in zip(masked_mean(mip_sampled, face_mask), masked_mean(web_normal, face_mask))],
        "mip_trilinear": [float(a - b) for a, b in zip(masked_mean(mip_trilinear, face_mask), masked_mean(web_normal, face_mask))],
    },
    "note": "mip_trilinear 与 web_capture 的均值差若 << mip0_bilinear 与 web_capture 的差, 则根因锁定为 mipmap 过滤差异。",
}
(OUT / "mip-isolation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
