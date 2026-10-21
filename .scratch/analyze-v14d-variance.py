import bpy, json
import numpy as np
import OpenImageIO as oiio
import os

OUT = r"C:\w\v14d-basecolor\.scratch\v14d-color-baseline-capture"
WIDTH, HEIGHT, EROSION = 1280, 720, 2
ROI = {"hair.front": [478,119,277,334], "hair.back": [497,190,343,530],
       "skin.face": [570,282,167,114], "clothes.chest": [523,434,297,286],
       "clothes.leftSleeve": [878,675,23,45]}
MASK = {"hair.front":"mask-hair-front","hair.back":"mask-hair-back","skin.face":"mask-skin-face",
        "clothes.chest":"mask-clothes-chest","clothes.leftSleeve":"mask-clothes-leftSleeve"}
TINT = {"hair.front":[0.84,0.85,0.96],"hair.back":[0.84,0.85,0.96],"skin.face":[1.0,0.935,0.89],
        "clothes.chest":None,"clothes.leftSleeve":None}

def read_exr(p):
    ii=oiio.ImageInput.open(p); px=ii.read_image(oiio.FLOAT); ii.close()
    return np.asarray(px,dtype=np.float64)[:,:,:3]
def read_mask(p):
    ii=oiio.ImageInput.open(p); px=ii.read_image(oiio.FLOAT); ii.close()
    return np.asarray(px,dtype=np.float64)[:,:,1]>=0.5

base = read_exr(os.path.join(OUT,"blender-white-light-frame120-base-color-scene-linear.exr"))
res={}
for roi,(x,y,w,h) in ROI.items():
    mask = read_mask(os.path.join(OUT,f"blender-white-light-frame120-{MASK[roi]}.png"))
    region=np.zeros((HEIGHT,WIDTH),bool); region[y+EROSION:y+h-EROSION, x+EROSION:x+w-EROSION]=True
    sel=mask&region; vals=base[sel]  # rendered = texture*tint (linear)
    t=TINT[roi]
    if t:
        tex = vals/np.array(t)  # pure texture linear per-pixel
    else:
        tex = vals
    mean = tex.mean(axis=0)
    # variance term: mean|pixel - mean| per channel
    var_term = np.abs(tex-mean).mean(axis=0)*100
    res[roi]={"n":int(sel.sum()),
              "pureTexLinearMean":[float(v) for v in mean],
              "varianceTerm_pct":[float(v) for v in var_term],
              "varianceMean_pct": float(var_term.mean())}
print("===VAR-BEGIN==="); print(json.dumps(res,indent=2)); print("===VAR-END===")
