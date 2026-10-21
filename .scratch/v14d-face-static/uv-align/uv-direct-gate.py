# -*- coding: utf-8 -*-
# UV-direct 逐纹素对账(同 UV 直采, 消除 raster/filter 差异):
#   对每个脸部像素, 用 Web 侧实际插值 UV 直接双线性采样 Blender 权威线性像素
#   (face_d / State2 mask), 重算 baker 链得到 normal/attenuation/composite 参考值,
#   与 Web 实际捕获值对比, 按 Base→warm→mask→shadowFactor→composite 顺序定位首次分歧。
#
# 口径锁定:
#   - 只用 Face pick mask 内的像素(faceSamples=5865), 不混入背景/边缘/其他材质。
#   - 双线性采样在 Blender 线性像素上做(与 Blender Linear interpolation 同语义),
#     采样中心 = 纹素中心, UV 原点在纹理左上角(与 PNG/WebGPU 一致)。
#   - sRGB 只解码一次(face_d 在 Blender 侧已是场景线性; Non-Color mask 不解码)。
#   - Web 捕获值是 canvas display sRGB -> linear(与 Blender Standard/曝光0/gamma1 对应)。
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

# 正式口径: 只用 pre-tonemap HDR 浮点证据(web-face-uv.float.json + face-static-<mode>.hdr.json),
# 无静默 fallback。--legacy-diagnostic 显式启用旧的 8-bit UV PNG + tonemap 后截图路径,
# 仅作历史对照, 输出 formalEvidence=false, 不产生正式通过状态。
LEGACY = "--legacy-diagnostic" in sys.argv

ROOT = Path(__file__).resolve().parents[3]
BL = ROOT / ".scratch" / "v14d-face-static" / "uv-align" / "blender"
WEB = ROOT / ".scratch" / "v14d-face-static" / "uv-align" / "web"
SAME = ROOT / ".scratch" / "v14d-face-static" / "same-metric"
DERIVED = Path(r"C:\w\rk3-face-v14d\.scratch\v14d-face-static-derived")
OUT = ROOT / ".scratch" / "v14d-face-static" / "uv-align"

WARM = np.array([1.0, 0.935, 0.89], dtype=np.float64)
SHADOW = np.array([0.66, 0.58, 0.60], dtype=np.float64)
FRINGE = np.array([0.70, 0.64, 0.69], dtype=np.float64)

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def load_png(p, mode="RGB"):
    return np.asarray(Image.open(p).convert(mode), dtype=np.float64) / 255.0

# 1) 权威线性像素
# face_d: PIL 解码 PNG 字节(sRGB) -> 标准 sRGB->linear。
#   说明: Blender img.pixels 的 OCIO 解码/行序与 PNG 字节存在系统性偏差(见
#   colorspace-isolation.json), 而 Web 引擎实际收到的就是 PNG 字节, 故以 PIL 为
#   唯一可信的逐纹素参考。V 轴: PNG/引擎/Blender UV 均为左上原点, 无需翻转。
def load_face_d_linear():
    im = Image.open(r"D:\mmd\克莱妲原皮\Textures\c_Koleda_slg_face_d.png").convert("RGB")
    srgb = np.asarray(im, dtype=np.float64) / 255.0
    return srgb_to_linear(srgb)
face_lin = load_face_d_linear()
# State2 mask: Non-Color, PIL 解码字节即线性值(不做 sRGB 解码)。
mask_lin = np.asarray(Image.open(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\textures\v14d-01234-face-shadow-state-2.png").convert("RGB"), dtype=np.float64) / 255.0
H, W = face_lin.shape[:2]

# 2) Web 侧逐像素 UV 与脸部 mask
FLOAT_UV = WEB / "web-face-uv.float.json"
if not LEGACY:
    # 正式路径: 必须有 pre-tonemap HDR 浮点 UV, 缺失即失败, 无 fallback。
    if not FLOAT_UV.is_file():
        print("GATE-FAIL: 缺正式浮点 UV 证据 web-face-uv.float.json (pre-tonemap HDR readback); 正式路径无 8-bit fallback", file=sys.stderr)
        sys.exit(1)
    fj = json.loads(FLOAT_UV.read_text(encoding="utf-8"))
    fw, fh = int(fj["width"]), int(fj["height"])
    uvarr = np.asarray(fj["uv"], dtype=np.float64).reshape(fh, fw, 2)
    fmarr = np.asarray(fj["faceMask"], dtype=np.float64).reshape(fh, fw)
    u = uvarr[..., 0]
    v = uvarr[..., 1]
    face_mask = fmarr > 0.5
else:
    # legacy 诊断对照(非正式): 8-bit UV PNG + 旧 mask, formalEvidence=false。
    uv_img = load_png(WEB / "web-face-uv.png")
    face_mask = load_png(SAME / "web-face-mask.png", "L") > 0.5
    u = uv_img[..., 0]
    v = uv_img[..., 1]

# 3) Web 三模式捕获
CAPDIR = ROOT / ".scratch" / "v14d-face-static" / "capture-final"
def load_web_mode(mode):
    hdr_json = CAPDIR / f"face-static-{mode}.hdr.json"
    if not LEGACY:
        # 正式路径: 必须有 pre-tonemap HDR 浮点, 缺失即失败, 无 tonemap 截图 fallback。
        if not hdr_json.is_file():
            print(f"GATE-FAIL: 缺正式 HDR 浮点证据 face-static-{mode}.hdr.json; 正式路径无 tonemap 截图 fallback", file=sys.stderr)
            sys.exit(1)
        hj = json.loads(hdr_json.read_text(encoding="utf-8"))
        hw, hh = int(hj["width"]), int(hj["height"])
        return np.asarray(hj["rgb"], dtype=np.float64).reshape(hh, hw, 3)
    # legacy 诊断对照(非正式): tonemap 后的 canvas sRGB -> 线性。
    return srgb_to_linear(load_png(CAPDIR / f"face-static-{mode}.png"))
web_normal = load_web_mode("normal")
web_comp = load_web_mode("finalFaceComposite")
web_atten = load_web_mode("faceShadowOnly")

# 4) 双线性采样(纹素中心, UV 左上原点, REPEAT wrap 用 mod)
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

# 5) baker 链在 Web UV 上重算(同 UV 直采)
face_b = bilinear(face_lin[..., :3], u, v)       # Web UV 处的 face_d 线性
mask_b = bilinear(mask_lin[..., :3], u, v)       # Web UV 处的 State2 mask(Non-Color 线性)
R = mask_b[..., 0:1]; G = mask_b[..., 1:2]; B = mask_b[..., 2:3]
invB = 1.0 - B
art = 1.0 + (SHADOW - 1.0) * (R * invB)
fringe = 1.0 + (FRINGE - 1.0) * (G * invB)
shadow_factor = art * fringe
warm = face_b * WARM
composite = warm * shadow_factor
attenuation = 1.0 - shadow_factor

# 6) 只在脸部 mask 内量化(逐像素 abs diff)
def masked_stats(ref, web, m):
    d = np.abs(ref - web)
    dm = d[m]
    rm = ref[m]
    wm = web[m]
    return {
        "meanAbsLinearDiff": [float(dm[..., c].mean()) for c in range(3)],
        "p95AbsLinearDiff": [float(np.percentile(dm[..., c], 95)) for c in range(3)],
        "maxAbsLinearDiff": [float(dm[..., c].max()) for c in range(3)],
        "refMeanLinear": [float(rm[..., c].mean()) for c in range(3)],
        "webMeanLinear": [float(wm[..., c].mean()) for c in range(3)],
    }

# 6b) 脸部轮廓边缘/内部拆分(仅辅助诊断, 不重定义正式通过口径): hdrResolveTexture
# 由 MSAA 4x resolve 而来, 脸部轮廓边缘像素的子采样混入相邻背景/其他材质的 UV 与
# 颜色。正式 Gate 仍是全 Face 每通道 mean<=0.005 / P95<=0.01; 内部/边缘拆分只用于
# 定位误差空间分布, 不作为通过依据。
def split_edge(m):
    edge = np.zeros_like(m)
    edge[1:, :] |= m[1:, :] & (~m[:-1, :])
    edge[:-1, :] |= m[:-1, :] & (~m[1:, :])
    edge[:, 1:] |= m[:, 1:] & (~m[:, :-1])
    edge[:, :-1] |= m[:, :-1] & (~m[:, 1:])
    edge &= m
    return edge, m & ~edge
edge_mask, interior_mask = split_edge(face_mask)

report = {
    "textureSize": [W, H],
    "faceSamples": int(face_mask.sum()),
    "interiorSamples": int(interior_mask.sum()),
    "edgeSamples": int(edge_mask.sum()),
    "uvRange": {"u": [float(u[face_mask].min()), float(u[face_mask].max())], "v": [float(v[face_mask].min()), float(v[face_mask].max())]},
    "gate": {
        "normal": masked_stats(face_b, web_normal, face_mask),
        "faceShadowOnly": masked_stats(attenuation, web_atten, face_mask),
        "finalFaceComposite": masked_stats(composite, web_comp, face_mask),
    },
    "gateInterior": {
        "normal": masked_stats(face_b, web_normal, interior_mask),
        "faceShadowOnly": masked_stats(attenuation, web_atten, interior_mask),
        "finalFaceComposite": masked_stats(composite, web_comp, interior_mask),
    },
    "gateEdge": {
        "normal": masked_stats(face_b, web_normal, edge_mask),
        "faceShadowOnly": masked_stats(attenuation, web_atten, edge_mask),
        "finalFaceComposite": masked_stats(composite, web_comp, edge_mask),
    },
    "chainDivergence": {
        "baseTexture": masked_stats(face_b, web_normal, face_mask),
        "warmTint": masked_stats(warm, web_normal * (WARM if True else 1), face_mask),  # 近似: web normal 无 warm
        "shadowFactor": masked_stats(shadow_factor, 1.0 - web_atten, face_mask),
        "composite": masked_stats(composite, web_comp, face_mask),
    },
    "pass": {
        "meanLe0.005": None,
        "p95Le0.01": None,
    },
    "note": "UV-direct 同 UV 逐纹素对账; Web UV 来自 faceStatic uvDebug 模式(几何节点), 纹理采样在 Blender 权威线性像素上重算 baker 链。",
}

# Gate 判定(正式): 全 Face 每通道 mean <= 0.005, P95 <= 0.01。
# 内部/边缘仅为辅助诊断指标, 如实输出但不替代正式 Gate, 不重定义通过口径。
ok_mean = all(all(v <= 0.005 for v in report["gate"][k]["meanAbsLinearDiff"]) for k in report["gate"])
ok_p95 = all(all(v <= 0.01 for v in report["gate"][k]["p95AbsLinearDiff"]) for k in report["gate"])
ok_mean_i = all(all(v <= 0.005 for v in report["gateInterior"][k]["meanAbsLinearDiff"]) for k in report["gateInterior"])
ok_p95_i = all(all(v <= 0.01 for v in report["gateInterior"][k]["p95AbsLinearDiff"]) for k in report["gateInterior"])
report["pass"]["meanLe0.005"] = ok_mean
report["pass"]["p95Le0.01"] = ok_p95
report["pass"]["all"] = ok_mean and ok_p95
report["pass"]["formalEvidence"] = (not LEGACY)
# 辅助诊断(非正式): 内部像素指标, 用于定位误差空间分布, 不影响正式通过状态。
report["auxDiagnostic"] = {
    "interiorMeanLe0.005": ok_mean_i,
    "interiorP95Le0.01": ok_p95_i,
    "interiorAll": ok_mean_i and ok_p95_i,
    "note": "内部/边缘拆分仅辅助诊断; 正式 Gate 为全 Face pass.all。",
}

(OUT / "uv-direct-gate.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

# 差值热图(脸部 ROI)
for name, ref, web in [("normal", face_b, web_normal), ("faceShadowOnly", attenuation, web_atten), ("finalFaceComposite", composite, web_comp)]:
    d = np.abs(ref - web)
    d[~face_mask] = 0
    dm = d.max(axis=-1)
    vmax = max(dm[face_mask].max(), 1e-6)
    heat = (dm / vmax * 255).astype(np.uint8)
    Image.fromarray(heat, "L").save(OUT / f"uv-direct-diff-{name}.png")

print(json.dumps(report, ensure_ascii=False, indent=2))

# 进程退出码反映正式 Gate 状态: 正式全 Face pass.all 为 false 时非零退出,
# 防止正式失败被 CI/票据误判为成功。legacy 诊断不产生正式通过状态, 一律非零。
if LEGACY:
    print("LEGACY-DIAGNOSTIC: formalEvidence=false, 不产生正式通过状态", file=sys.stderr)
    sys.exit(2)
if not report["pass"]["all"]:
    print("GATE-FAIL: 正式全 Face UV-direct Gate 未通过 (pass.all=false)", file=sys.stderr)
    sys.exit(1)
print("GATE-OK: 正式全 Face UV-direct Gate 通过")
