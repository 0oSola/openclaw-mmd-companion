from __future__ import annotations
import json, sys
from pathlib import Path
import bpy

BLEND = Path(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
OUT = Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else Path(r".scratch\v14d-face-static\extracted")
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
result = {"outDir": str(OUT), "extracted": {}, "errors": []}

def unpack(img_name, out_name):
    img = bpy.data.images.get(img_name)
    if img is None:
        result["errors"].append("missing image: " + img_name)
        return
    fp = OUT / out_name
    try:
        img.unpack(method="WRITE_LOCAL")
        src = Path(bpy.path.abspath(img.filepath))
        data = src.read_bytes()
        fp.write_bytes(data)
        result["extracted"][img_name] = {
            "file": str(fp), "size": list(img.size),
            "colorspace": img.colorspace_settings.name,
            "channels": img.channels, "depth": img.depth,
            "packed": bool(img.packed_file), "bytes": len(data),
        }
    except Exception as exc:
        result["errors"].append(img_name + ": " + str(exc))

unpack("PROTO_V14D_FaceShadow_State2", "v14d-face-shadow-state2-raw.png")
unpack("c_Koleda_slg_face_d.png", "koleda-face-d-raw.png")

print("===EXTRACT-BEGIN===")
print(json.dumps(result, ensure_ascii=False, indent=2))
print("===EXTRACT-END===")
