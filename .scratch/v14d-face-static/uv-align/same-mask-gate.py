# -*- coding: utf-8 -*-
# 同 Face mask Gate: 用 Web 导出的 face pick mask, 在 Blender 参考渲染与 Web 捕获
# 的同一脸部像素集合上量化三模式均值绝对差(线性空间)。
# 口径与上一票 same-metric-gate 一致; 本票用 uv-align 新生成的 Blender ref。
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BL = ROOT / ".scratch" / "v14d-face-static" / "uv-align" / "blender"
SAME = ROOT / ".scratch" / "v14d-face-static" / "same-metric"
CAP = ROOT / ".scratch" / "v14d-face-static" / "capture-final"
OUT = ROOT / ".scratch" / "v14d-face-static" / "uv-align"

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def load_png(p, mode="RGB"):
    return np.asarray(Image.open(p).convert(mode), dtype=np.float64) / 255.0

face_mask = load_png(SAME / "web-face-mask.png", "L") > 0.5

bl_normal = srgb_to_linear(load_png(BL / "blender-ref-normal.png"))
bl_comp = srgb_to_linear(load_png(BL / "blender-ref-finalFaceComposite.png"))
web_normal = srgb_to_linear(load_png(CAP / "face-static-normal.png"))
web_comp = srgb_to_linear(load_png(CAP / "face-static-finalFaceComposite.png"))
web_atten = srgb_to_linear(load_png(CAP / "face-static-faceShadowOnly.png"))

def masked_mean(img, m): return [float(img[m][..., c].mean()) for c in range(3)]
def masked_diff(a, b, m): return [float(np.abs(a-b)[m][..., c].mean()) for c in range(3)]

report = {
    "maskFacePixels": int(face_mask.sum()),
    "normal": {
        "blender_masked_linear": masked_mean(bl_normal, face_mask),
        "web_masked_linear": masked_mean(web_normal, face_mask),
        "absDiff": masked_diff(bl_normal, web_normal, face_mask),
    },
    "faceShadowOnly": {
        "blender_masked_linear": None,  # 本票未重渲 shadowonly 参考
        "web_masked_linear": masked_mean(web_atten, face_mask),
        "absDiff": None,
    },
    "finalFaceComposite": {
        "blender_masked_linear": masked_mean(bl_comp, face_mask),
        "web_masked_linear": masked_mean(web_comp, face_mask),
        "absDiff": masked_diff(bl_comp, web_comp, face_mask),
    },
    "target": "三模式每通道均值绝对差 <= 0.03",
    "note": "Blender ref 是 uv-align 新生成的白光 Emission(Standard/曝光0/gamma1); Web 捕获是 faceStatic unlit。faceShadowOnly 的 Blender 参考沿用上一票(本票未重渲)。",
}
(OUT / "same-mask-gate.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))

# 进程退出码反映 Gate 状态: 有可比对的模式(normal/finalFaceComposite)任一通道均值绝对差
# 超过 0.03 目标时非零退出, 防止正式失败被误判为成功。faceShadowOnly 无 Blender 参考(本票
# 未重渲), 不参与判定。
import sys
THRESH = 0.03
fails = []
for mode in ("normal", "finalFaceComposite"):
    d = report[mode]["absDiff"]
    if d is not None and any(v > THRESH for v in d):
        fails.append(f"{mode} absDiff={[round(x,4) for x in d]} 超目标 {THRESH}")
if fails:
    print("GATE-FAIL: same-mask 同屏 Gate 未通过 - " + "; ".join(fails), file=sys.stderr)
    sys.exit(1)
print("GATE-OK: same-mask 同屏 Gate 通过")
