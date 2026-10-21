import bpy, json
import numpy as np
import OpenImageIO as oiio
import os
OUT = r"C:\w\v14d-basecolor\.scratch\v14d-color-baseline-capture\post-fix-blender"
WIDTH,HEIGHT,EROSION=1280,720,2
ROI={"hair.front":[478,119,277,334],"hair.back":[497,190,343,530],"skin.face":[570,282,167,114],
     "clothes.chest":[523,434,297,286],"clothes.leftSleeve":[878,675,23,45]}
def read_exr(p):
    ii=oiio.ImageInput.open(p); px=ii.read_image(oiio.FLOAT); ii.close()
    return np.asarray(px,dtype=np.float64)[:,:,:3]
def read_mask(p):
    ii=oiio.ImageInput.open(p); px=ii.read_image(oiio.FLOAT); ii.close()
    return np.asarray(px,dtype=np.float64)[:,:,1]>=0.5
def l2s(c):
    c=np.maximum(c,0.0)
    return np.where(c<=0.0031308, c*12.92, 1.055*np.power(c,1/2.4)-0.055)
base=read_exr(os.path.join(OUT,"blender-white-light-frame120-base-color-scene-linear.exr"))
res={}
for roi,(x,y,w,h) in ROI.items():
    mask=read_mask(os.path.join(OUT,f"blender-white-light-frame120-mask-{roi.replace('.','-')}.png"))
    region=np.zeros((HEIGHT,WIDTH),bool); region[y+EROSION:y+h-EROSION, x+EROSION:x+w-EROSION]=True
    sel=mask&region; vals=base[sel]
    lin=vals.mean(axis=0); srgb=l2s(lin)
    res[roi]={"n":int(sel.sum()),"linearMean":[float(v) for v in lin],"srgbMean":[float(v) for v in srgb]}
print("===REF-BEGIN==="); print(json.dumps(res,indent=2)); print("===REF-END===")
