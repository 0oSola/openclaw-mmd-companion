# -*- coding: utf-8 -*-
# V14D Face State 2 逐纹素烘焙 —— 产出三张语义独立的派生纹理。
# 公式来源: 权威 .blend PROTO_V14D_GF2_Face 节点取证 (probe-*.py):
#   warm   = face_d_linear * [1, 0.935, 0.89]            (PROTO_FaceWarm MULTIPLY)
#   art    = mix(white, [0.66,0.58,0.60], R*(1-B))       (NarrowShadowTint MIX)
#   fringe = mix(white, [0.70,0.64,0.69], G*(1-B))       (NarrowFringeTint MIX)
#   shadowFactor = art * fringe                          (乘法阴影因子)
#   composite  = warm * shadowFactor                     (BaseColor + State2, Blend 0)
#   attenuation = 1 - shadowFactor                       (纯阴影衰减分量, 0=无阴影, 黑底)
# 掩码 R/G/B 均来自 State2 Non-Color 图 (FinalMaskRGBSeparate.Red/Green/Blue).
#
# 三模式 -> 派生纹理:
#   normal             -> face-normal  (原始 face_d, 未应用 State2; Web 现有脸部基线)
#   finalFaceComposite -> composite    (完整合成)
#   faceShadowOnly     -> attenuation  (纯阴影衰减分量, 黑底灰阶)
#
# 资产政策: 派生纹理由第三方 face_d 生成, 不提交仓库; 输出到本地非仓库目录。
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

# 仓库根 = 本脚本位于 <root>/.scratch/v14d-face-static/
ROOT = Path(__file__).resolve().parents[2]
EXTRACT = ROOT / ".scratch" / "v14d-face-static" / "extracted"
# 本地非仓库输出目录（可用 --out 覆盖）
OUT_DIR = Path(r"C:\w\rk3-face-v14d\.scratch\v14d-face-static-derived")
if "--out" in sys.argv:
    OUT_DIR = Path(sys.argv[sys.argv.index("--out") + 1])
OUT_DIR.mkdir(parents=True, exist_ok=True)
# 权威 face_d（用户本地 Koleda 包）
FACE_D = Path(r"D:\workspace\MMD project\MMD\克莱妲原皮_by_少女前线2：追放_3801ab976ee72bef4da6543c0f956bb0\克莱妲原皮\Textures\c_Koleda_slg_face_d.png")
if not FACE_D.exists():
    FACE_D = Path(r"D:\mmd\克莱妲原皮\Textures\c_Koleda_slg_face_d.png")

WARM = np.array([1.0, 0.935, 0.89], dtype=np.float64)
SHADOW = np.array([0.66, 0.58, 0.60], dtype=np.float64)
FRINGE = np.array([0.70, 0.64, 0.69], dtype=np.float64)

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def linear_to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0.0), 1.0 / 2.4) - 0.055)

def load_rgba(path):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im, dtype=np.float64) / 255.0
    return a, im.size

def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

face, fsize = load_rgba(FACE_D)
mask, msize = load_rgba(EXTRACT / "v14d-face-shadow-state2-raw.png")
if fsize != msize:
    raise SystemExit("size mismatch face=%s mask=%s" % (fsize, msize))
W, H = fsize

face_lin = srgb_to_linear(face[..., :3])
alpha = face[..., 3:4]
R = mask[..., 0:1]; G = mask[..., 1:2]; B = mask[..., 2:3]
invB = 1.0 - B

art_factor = 1.0 + (SHADOW - 1.0) * (R * invB)
fringe_factor = 1.0 + (FRINGE - 1.0) * (G * invB)
shadow_factor = art_factor * fringe_factor     # 乘法阴影因子
warm = face_lin * WARM
composite_lin = warm * shadow_factor           # 完整合成
attenuation_lin = 1.0 - shadow_factor          # 纯阴影衰减分量 (黑底, 0=无阴影)

def to_srgb_png(lin, alpha_ch, path):
    srgb = np.clip(linear_to_srgb(np.clip(lin, 0.0, 1.0)), 0.0, 1.0)
    out = np.concatenate([srgb, alpha_ch], axis=-1)
    arr = np.round(out * 255.0).astype(np.uint8)
    Image.fromarray(arr, "RGBA").save(path)
    return arr

# normal: 原始 face_d 直接复制（不改色）
normal_arr = np.round(face * 255.0).astype(np.uint8)
Image.fromarray(normal_arr, "RGBA").save(OUT_DIR / "v14d-face-normal-state2.png")
composite_arr = to_srgb_png(composite_lin, alpha, OUT_DIR / "v14d-face-composite-state2.png")
atten_arr = to_srgb_png(attenuation_lin, alpha, OUT_DIR / "v14d-face-shadow-attenuation-state2.png")

opaque = (alpha[..., 0] > 0.5)
report = {
    "size": [W, H],
    "outDir": str(OUT_DIR),
    "mask": {"R_max": float(R.max()), "G_max": float(G.max()), "B_max": float(B.max())},
    "counts": {"opaque": int(opaque.sum()), "shadow_R_gt_0.1": int(((R[..., 0] > 0.1) & opaque).sum()), "fringe_G_gt_0.1": int(((G[..., 0] > 0.1) & opaque).sum())},
    "modeTextures": {
        "normal": "v14d-face-normal-state2.png",
        "finalFaceComposite": "v14d-face-composite-state2.png",
        "faceShadowOnly": "v14d-face-shadow-attenuation-state2.png",
    },
    "assets": {
        "v14d-face-normal-state2.png": {"sha256": sha(OUT_DIR / "v14d-face-normal-state2.png"), "bytes": (OUT_DIR / "v14d-face-normal-state2.png").stat().st_size},
        "v14d-face-composite-state2.png": {"sha256": sha(OUT_DIR / "v14d-face-composite-state2.png"), "bytes": (OUT_DIR / "v14d-face-composite-state2.png").stat().st_size},
        "v14d-face-shadow-attenuation-state2.png": {"sha256": sha(OUT_DIR / "v14d-face-shadow-attenuation-state2.png"), "bytes": (OUT_DIR / "v14d-face-shadow-attenuation-state2.png").stat().st_size},
    },
    "attenuationStats": {
        "meanLinearOpaque": [float(x) for x in attenuation_lin[..., :3][opaque].mean(axis=0)] if opaque.any() else None,
        "maxLinear": float(attenuation_lin[..., :3][opaque].max()) if opaque.any() else None,
    },
    "source": {
        "face_d": {"path": str(FACE_D), "sha256": sha(FACE_D)},
        "state2_mask_raw": {"sha256": sha(EXTRACT / "v14d-face-shadow-state2-raw.png")},
        "warm": WARM.tolist(), "shadow": SHADOW.tolist(), "fringe": FRINGE.tolist(),
    },
}
(ROOT / ".scratch" / "v14d-face-static" / "bake-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("===BAKE-BEGIN===")
print(json.dumps(report, ensure_ascii=False, indent=2))
print("===BAKE-END===")
