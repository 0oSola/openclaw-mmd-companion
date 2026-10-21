# -*- coding: utf-8 -*-
# 相机/几何口径对比: Web 固定相机 snapshot vs Blender PROTO_GameCamera,
# 量化两套投影下 Face 材质的屏幕覆盖差异, 判定 UV-direct 对账是否受几何错位主导。
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BL = ROOT / ".scratch" / "v14d-face-static" / "uv-align" / "blender"
SAME = ROOT / ".scratch" / "v14d-face-static" / "same-metric"
OUT = ROOT / ".scratch" / "v14d-face-static" / "uv-align"

# Web 固定相机(RezeWebGpuStage.tsx V14D_FACE_STATIC_CAMERA)
WEB_CAM = {
    "fov": 28.072486935852954,
    "position": [0.375, 16.6875, -12.75],
    "target": [0.375, 16.6875, -12.125],
}
# Blender 相机(从 blend 取证, PROTO_GameCamera)
BLENDER_CAM = {
    "loc": [0.03, -1.02, 1.335],
    "lensMm": 72.0,
    "sensorWidthMm": 36.0,
    "rotXDeg": 90.0,
}

loops = np.load(BL / "face-loops-uv.npy")
face_mask = np.asarray(Image.open(SAME / "web-face-mask.png").convert("L"), dtype=np.float64) / 255.0 > 0.5
ys, xs = np.where(face_mask)

# Web 脸部屏幕覆盖
web_face = {
    "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
    "width": int(xs.max() - xs.min() + 1),
    "height": int(ys.max() - ys.min() + 1),
    "areaPx": int(face_mask.sum()),
    "centroid": [float(xs.mean()), float(ys.mean())],
}
# Blender 脸部屏幕覆盖(frame120, PROTO_GameCamera)
bl_face = {
    "bbox": [float(loops[:, 2].min()), float(loops[:, 3].min()), float(loops[:, 2].max()), float(loops[:, 3].max())],
    "width": float(loops[:, 2].max() - loops[:, 2].min()),
    "height": float(loops[:, 3].max() - loops[:, 3].min()),
    "centroid": [float(loops[:, 2].mean()), float(loops[:, 3].mean())],
}
# 视场角换算: Blender lens 72mm / sensor 36mm -> fov = 2*atan(18/72) = 28.07 deg (与 Web 一致)
bl_fov = 2.0 * np.degrees(np.arctan(18.0 / 72.0))

report = {
    "webCamera": WEB_CAM,
    "blenderCamera": {**BLENDER_CAM, "computedFovDeg": float(bl_fov)},
    "webFaceScreen": web_face,
    "blenderFaceScreen": bl_face,
    "geometryMismatch": {
        "widthRatio": bl_face["width"] / max(web_face["width"], 1),
        "heightRatio": bl_face["height"] / max(web_face["height"], 1),
        "centroidDeltaPx": [bl_face["centroid"][0] - web_face["centroid"][0], bl_face["centroid"][1] - web_face["centroid"][1]],
        "blenderFaceOutOfFrame": bl_face["bbox"][3] > 640,
    },
    "note": "两相机 fov 相同(28.07deg)但 position/target 不同, 导致脸部在屏幕上大小/位置不同; UV-direct 对账必须使用同一几何, 否则同 UV 比较的是不同世界位置。",
}
(OUT / "camera-compare.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
