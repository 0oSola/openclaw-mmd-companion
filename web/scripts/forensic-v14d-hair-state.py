# Stage 2C-M1 权威取证（只读）：打开权威 V14D .blend，自省 HairA/HairB 材质节点，
# 记录 BaseColor 纹理、颜色空间、固定发色乘色、Roughness/Specular/Anisotropic、
# Hair Spec 连接状态、Toon Ramp 与 alpha/裁切口径。不修改 .blend，不提交第三方资产。
#
# 用法：
#   blender --background --python web/scripts/forensic-v14d-hair-state.py -- \
#     --blend <path.blend> --out <manifest.json>
import argparse
import json
import sys
from pathlib import Path

import bpy


def sha256_file(p: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def image_info(img):
    if img is None:
        return None
    return {
        "name": img.name,
        "filepath": img.filepath,
        "size": list(img.size),
        "hasData": bool(img.has_data),
        "colorspace": img.colorspace_settings.name,
        "alphaMode": getattr(img, "alpha_mode", None),
        "channels": img.channels,
        "packed": img.packed_file is not None,
    }


def describe_socket(sock):
    if sock is None:
        return None
    out = {
        "name": sock.name,
        "defaultValue": None,
        "linked": sock.is_linked,
        "links": [],
    }
    try:
        dv = sock.default_value
        if isinstance(dv, (int, float, str, bool)):
            out["defaultValue"] = dv
        else:
            out["defaultValue"] = [round(float(v), 6) for v in dv]
    except Exception:
        pass
    for link in sock.links:
        fr = link.from_node
        entry = {"fromNode": fr.name, "fromType": fr.type, "fromSocket": link.from_socket.name}
        if fr.type == "TEX_IMAGE":
            entry["image"] = image_info(fr.image)
        elif fr.type == "MIX":
            entry["mixDataType"] = fr.data_type
            entry["mixBlendType"] = fr.blend_type
            entry["mixInputs"] = {
                inp.name: (
                    [round(float(v), 6) for v in inp.default_value]
                    if not isinstance(inp.default_value, (int, float, str, bool))
                    else inp.default_value
                )
                for inp in fr.inputs
                if hasattr(inp, "default_value")
            }
        elif fr.type == "RGB":
            try:
                entry["rgb"] = [round(float(v), 6) for v in fr.outputs[0].default_value]
            except Exception:
                pass
        out["links"].append(entry)
    return out


def describe_map_range(node):
    # MAP_RANGE 节点：输出 from/to/clamp 与插值类型（Roughness/Specular 支路的机器证据）。
    out = {
        "node": node.name,
        "dataType": getattr(node, "data_type", None),
        "interpolationType": getattr(node, "interpolation_type", None),
        "clamp": getattr(node, "clamp", None),
        "inputs": {},
    }
    for inp in node.inputs:
        if hasattr(inp, "default_value"):
            dv = inp.default_value
            out["inputs"][inp.name] = (
                [round(float(v), 6) for v in dv]
                if not isinstance(dv, (int, float, str, bool))
                else round(float(dv), 6) if isinstance(dv, (int, float)) else dv
            )
        if inp.is_linked:
            out["inputs"].setdefault("_links", []).append(
                {"socket": inp.name, "fromNode": inp.links[0].from_node.name,
                 "fromType": inp.links[0].from_node.type}
            )
    return out


def describe_ramp(node):
    # VALTORGB 渐变：输出全部色标元素的位置与 RGBA（Toon Ramp 口径的机器证据）。
    cr = getattr(node, "color_ramp", None)
    if cr is None:
        return {"node": node.name, "elements": []}
    return {
        "node": node.name,
        "interpolation": cr.interpolation,
        "elements": [
            {"position": round(float(e.position), 6), "color": [round(float(c), 6) for c in e.color]}
            for e in cr.elements
        ],
        "linkedTo": [
            {"toNode": l.to_node.name, "toType": l.to_node.type, "toSocket": l.to_socket.name}
            for l in node.outputs[0].links
        ] if node.outputs else [],
    }


def describe_tangent(node):
    return {"node": node.name, "directionType": getattr(node, "direction_type", None), "axis": getattr(node, "axis", None)}


def describe_material(mat):
    if not mat.use_nodes:
        return {"name": mat.name, "useNodes": False}
    nodes = mat.node_tree.nodes
    principled = [n for n in nodes if n.type == "BSDF_PRINCIPLED"]
    toon = [n for n in nodes if n.type == "BSDF_TOON"]
    ramps = [n for n in nodes if n.type == "VALTORGB"]
    mix_nodes = [n for n in nodes if n.type in ("MIX", "MIX_RGB")]
    shader_to_rgb = [n for n in nodes if n.type == "SHADERTORGB"]
    tex_images = [n for n in nodes if n.type == "TEX_IMAGE"]
    map_ranges = [n for n in nodes if n.type == "MAP_RANGE"]
    tangents = [n for n in nodes if n.type == "TANGENT"]
    out = {
        "name": mat.name,
        "useNodes": True,
        "blendMethod": getattr(mat, "blend_method", None),
        "surfaceRenderMethod": getattr(mat, "surface_render_method", None),
        "useTransparentShadow": getattr(mat, "use_transparent_shadow", None),
        "alphaThreshold": getattr(mat, "alpha_threshold", None),
        "nodeTypes": sorted({n.type for n in nodes}),
        "texImages": [{"node": n.name, "image": image_info(n.image), "interpolation": n.interpolation} for n in tex_images],
        "principled": [],
        "toonCount": len(toon),
        "rampCount": len(ramps),
        "ramps": [describe_ramp(n) for n in ramps],
        "mapRanges": [describe_map_range(n) for n in map_ranges],
        "tangents": [describe_tangent(n) for n in tangents],
        "shaderToRgbCount": len(shader_to_rgb),
        "mixNodes": [],
    }
    for p in principled:
        inputs = {inp.name: describe_socket(inp) for inp in p.inputs if inp.name in (
            "Base Color", "Roughness", "Metallic", "Specular IOR Level", "Specular Tint",
            "Anisotropic IOR Level", "Anisotropic", "Anisotropic Rotation", "Tangent",
            "Subsurface Weight", "Emission Color", "Emission Strength", "Alpha", "Normal",
            "Coat Weight", "Coat Roughness",
        )}
        out["principled"].append({"node": p.name, "inputs": inputs})
    for m in mix_nodes:
        entry = {
            "node": m.name,
            "nodeType": m.type,
            "dataType": getattr(m, "data_type", None),
            "blendType": getattr(m, "blend_type", None),
            "inputs": {},
        }
        for inp in m.inputs:
            if hasattr(inp, "default_value"):
                dv = inp.default_value
                entry["inputs"][inp.name] = (
                    [round(float(v), 6) for v in dv]
                    if not isinstance(dv, (int, float, str, bool))
                    else dv
                )
        entry["linkedOutputs"] = [
            {"toNode": l.to_node.name, "toType": l.to_node.type, "toSocket": l.to_socket.name}
            for l in m.outputs[0].links
        ]
        out["mixNodes"].append(entry)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])

    blend = Path(args.blend)
    result = {"blend": str(blend), "blendSha256": sha256_file(blend), "materials": {}}
    bpy.ops.wm.open_mainfile(filepath=str(blend))

    for name in ("PROTO_GF2_HairA", "PROTO_GF2_HairB"):
        mat = bpy.data.materials.get(name)
        if mat is None:
            result["materials"][name] = None
            continue
        result["materials"][name] = describe_material(mat)

    # PMX 侧 alpha 裁切参考：Blender 材质的 alpha/裁切口径 + 引擎 PMX 侧由
    # pmx_audit（docs/handoff/evidence/pmx_audit.out.json）提供 edgeSize/flags，
    # 本脚本只负责 Blender 权威侧。
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print("FORENSIC-HAIR-OK -> " + str(out_path))


main()
