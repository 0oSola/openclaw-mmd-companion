# 对三模式截图 + Blender State2 mask 参考做脸部 ROI 数值分析 (截图像素, sRGB).
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
CAP = ROOT / ".scratch" / "v14d-face-static" / "capture"
BLEND_REF = ROOT / ".scratch" / "v14d-face-static" / "blender-face-mask-state2-linear.png"
OUT = ROOT / ".scratch" / "v14d-face-static"
# Web 640x640 截图, 脸部 ROI (Blender 640 投影, 自上而下归一化)
ROI = [0.3462, 0.3142, 0.3052, 0.3354]
# 页面徽章在左上 12,12 ~ 约 318x86 px, 与脸部 ROI [222,201,195,215] 不重叠, 无需排除.

def load(p):
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0

def roi_pixels(img):
    h, w = img.shape[:2]
    x0 = int(ROI[0] * w); y0 = int(ROI[1] * h)
    x1 = int((ROI[0] + ROI[2]) * w); y1 = int((ROI[1] + ROI[3]) * h)
    return img[y0:y1, x0:x1].reshape(-1, 3)

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def face_mask(px):
    # 排除白底(>0.9) 与深色头发/徽章(暗) ; 脸部肤色偏亮粉
    r, g, b = px[:,0], px[:,1], px[:,2]
    keep = (r > 0.5) & (r >= g) & (g >= b * 0.7) & ~((r>0.93)&(g>0.93)&(b>0.93))
    return keep

report = {"roi_norm": ROI, "modes": {}, "blenderRef": None, "compare": {}}
imgs = {}
for mode in ["normal", "faceShadowOnly", "finalFaceComposite"]:
    p = CAP / ("face-static-" + mode + ".png")
    if not p.exists():
        report["modes"][mode] = {"error": "missing"}
        continue
    img = load(p)
    imgs[mode] = img
    px = roi_pixels(img)
    keep = face_mask(px)
    sel = px[keep]
    report["modes"][mode] = {
        "roiPx": [int(ROI[0]*img.shape[1]), int(ROI[1]*img.shape[0]), int(ROI[2]*img.shape[1]), int(ROI[3]*img.shape[0])],
        "samples": int(len(px)), "faceSamples": int(len(sel)),
        "meanSrgb": [round(float(v), 4) for v in sel.mean(axis=0)] if len(sel) else None,
        "meanLinear": [round(float(v), 4) for v in srgb_to_linear(sel).mean(axis=0)] if len(sel) else None,
    }

# Blender State2 mask 参考: 脸部区域 (mask 图本身, 全脸 UV) 的阴影分量线性均值
if BLEND_REF.exists():
    bref = load(BLEND_REF)
    # Blender 渲染是 640 屏幕图; 但 mask 贴图本身是权威. 用烘焙分量图作为权威线性参考更直接:
    comp = load(ROOT / "web/public/assets/mmd/calibration/koleda-v14d/v14d-face-shadow-state2-component.png")
    # 分量图全图 (脸部 UV 域) 线性均值
    comp_lin = srgb_to_linear(comp)
    report["blenderRef"] = {
        "note": "State2 阴影分量权威图 (artFactor*fringeFactor, sRGB->linear)",
        "meanLinear": [round(float(v),4) for v in comp_lin.reshape(-1,3).mean(axis=0)],
    }

# normal vs faceShadowOnly: 脸部应明显不同 (composite 有肤色+阴影, shadowOnly 近白)
if "normal" in imgs and "faceShadowOnly" in imgs:
    a = roi_pixels(imgs["normal"]); b = roi_pixels(imgs["faceShadowOnly"])
    ka = face_mask(a); kb = face_mask(b)
    report["compare"]["normal_vs_shadowOnly_faceMeanLinear"] = {
        "normal": report["modes"]["normal"].get("meanLinear"),
        "faceShadowOnly": report["modes"]["faceShadowOnly"].get("meanLinear"),
    }
# normal vs finalFaceComposite: 同一张烘焙图, 应几乎一致
if "normal" in imgs and "finalFaceComposite" in imgs:
    na = report["modes"]["normal"].get("meanLinear"); fc = report["modes"]["finalFaceComposite"].get("meanLinear")
    if na and fc:
        diff = [round(abs(na[i]-fc[i]),5) for i in range(3)]
        report["compare"]["normal_vs_finalComposite_absDiffLinear"] = diff

(OUT / "roi-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("===ROI-BEGIN===")
print(json.dumps(report, ensure_ascii=False, indent=2))
print("===ROI-END===")
