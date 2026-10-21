import bpy, json, math, os
import numpy as np

BLEND = r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend"
bpy.ops.wm.open_mainfile(filepath=BLEND)

OUT = r"C:\w\v14d-basecolor\.scratch\v14d-color-baseline-capture"
WIDTH, HEIGHT = 1280, 720
EROSION = 2

ROI = {
    "hair.front": {"mat": "PROTO_GF2_HairA", "bounds": [478, 119, 277, 334], "mask": "mask-hair-front"},
    "hair.back": {"mat": "PROTO_GF2_HairB", "bounds": [497, 190, 343, 530], "mask": "mask-hair-back"},
    "skin.face": {"mat": "PROTO_V14D_GF2_Face", "bounds": [570, 282, 167, 114], "mask": "mask-skin-face"},
    "clothes.chest": {"mat": "PROTO_GF2_Cth1-Top", "bounds": [523, 434, 297, 286], "mask": "mask-clothes-chest"},
    "clothes.leftSleeve": {"mat": "PROTO_GF2_Cth1-Top", "bounds": [878, 675, 23, 45], "mask": "mask-clothes-leftSleeve"},
}

TINT = {
    "PROTO_GF2_HairA": [0.84, 0.85, 0.96],
    "PROTO_GF2_HairB": [0.84, 0.85, 0.96],
    "PROTO_V14D_GF2_Face": [1.0, 0.935, 0.89],  # FaceWarm only; shadow term is spatially varying
}

def srgb_to_linear(c):
    c = np.maximum(c, 0.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1/2.4) - 0.055)

def linear_to_srgb(c):
    c = np.maximum(c, 0.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1/2.4) - 0.055)

def read_exr(path):
    ii = oiio.ImageInput.open(path)
    px = ii.read_image(oiio.FLOAT)
    ii.close()
    a = np.asarray(px, dtype=np.float64)
    return a[:, :, :3]

def read_mask_png(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.asarray(img.pixels[:], dtype=np.float64).reshape(h, w, 4)
    bpy.data.images.remove(img)
    # blender image origin is bottom-left; EXR saved with same origin? render result is top-left in file
    # masks were saved via render; we need consistent orientation. Read via file on disk: PNG top-left origin.
    # img.pixels is bottom-up, so flip vertically to match top-left indexing.
    return px[::-1, :, :]

import OpenImageIO as oiio

base_exr = read_exr(os.path.join(OUT, "blender-white-light-frame120-base-color-scene-linear.exr"))

result = {}
for roi_id, cfg in ROI.items():
    x, y, w, h = cfg["bounds"]
    mask_path = os.path.join(OUT, f"blender-white-light-frame120-{cfg['mask']}.png")
    mask = read_mask_png(mask_path)[:, :, 1] >= 0.5
    region = np.zeros((HEIGHT, WIDTH), dtype=bool)
    region[y+EROSION:y+h-EROSION, x+EROSION:x+w-EROSION] = True
    sel = mask & region
    vals = base_exr[sel]  # Nx3 linear, = texture_linear * tint (approx, modulo face shadow)
    tint = np.array(TINT.get(cfg["mat"], [1.0, 1.0, 1.0]))
    texture_linear_est = vals / tint
    texture_srgb_est = linear_to_srgb(texture_linear_est)
    result[roi_id] = {
        "n": int(sel.sum()),
        "blenderRenderedBaseLinear": [float(v) for v in vals.mean(axis=0)],
        "estimatedTextureSrgbMean": [float(v) for v in texture_srgb_est.mean(axis=0)],
        "estimatedTextureSrgbP25": [float(v) for v in np.percentile(texture_srgb_est, 25, axis=0)],
        "estimatedTextureSrgbP75": [float(v) for v in np.percentile(texture_srgb_est, 75, axis=0)],
        "tintApplied": [float(v) for v in tint],
    }

print("===PROOF-BEGIN===")
print(json.dumps(result, ensure_ascii=False, indent=2))
print("===PROOF-END===")
