# -*- coding: utf-8 -*-
# Stage 2B-M3 权威取证（只读）：打开权威 .blend，自省 BodySkin 材质节点链、
# 纹理、UV 层、色彩空间与常量，并与 Face 取证 manifest 逐项对比，输出
# manifest JSON。本脚本不修改 .blend；不提交第三方资产；只记录结构事实。
#
# 用法:
#   D:/Blender/blender.exe --background --python web/scripts/forensic-v14d-bodyskin-state2.py -- \
#     --blend <path.blend> --out <manifest.json>
from __future__ import annotations
import argparse, hashlib, json, sys
from pathlib import Path
import bpy

BODY_MAT = "PROTO_GF2_BodySkin"
FACE_MAT = "PROTO_V14D_GF2_Face"
BODY_D_IMG = "body_d.png"


def sha256_file(p: Path) -> str | None:
    try:
        h = hashlib.sha256()
        with p.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def rgba(v):
    try:
        return [float(v[i]) for i in range(len(v))]
    except Exception:
        return float(v)


def sock(s):
    if s is None:
        return None
    d = {"linked": bool(s.is_linked)}
    if hasattr(s, "default_value"):
        d["default"] = rgba(s.default_value)
    if s.is_linked:
        d["links"] = [
            {"node": l.from_node.name, "socket": l.from_socket.name, "type": l.from_node.bl_idname}
            for l in s.links
        ]
    return d


def node_info(n):
    info = {"name": n.name, "type": n.bl_idname, "label": n.label or ""}
    if n.bl_idname == "ShaderNodeMixRGB":
        info["blendType"] = n.blend_type
    if n.bl_idname == "ShaderNodeMath":
        info["operation"] = n.operation
    if n.bl_idname == "ShaderNodeTexImage":
        img = n.image
        info["image"] = {
            "name": img.name if img else None,
            "size": list(img.size) if img else None,
            "colorspace": img.colorspace_settings.name if img else None,
            "alpha_mode": img.alpha_mode if img else None,
            "packed": bool(img.packed_file) if img else None,
        }
        if img and img.packed_file:
            info["image"]["packed_sha256"] = hashlib.sha256(bytes(img.packed_file.data)).hexdigest()
        info["interpolation"] = n.interpolation
        info["extension"] = n.extension
    if n.bl_idname == "ShaderNodeUVMap":
        info["uvMap"] = n.uv_map
    info["inputs"] = {inp.name: sock(inp) for inp in n.inputs}
    info["outputs"] = {out.name: sock(out) for out in n.outputs}
    return info


def uv_layers_used(nt):
    used = []
    for n in nt.nodes:
        if n.bl_idname == "ShaderNodeUVMap":
            used.append({"node": n.name, "uvMap": n.uv_map})
        if n.bl_idname == "ShaderNodeTexCoord":
            used.append({"node": n.name, "uvMap": "Generated/UV (TexCoord)"})
    return used


def walk_sources(nt, out_sock, depth=0, seen=None):
    """从输出节点沿 links 回溯，记录完整节点链（去重保持顺序）。"""
    if seen is None:
        seen = set()
    chain = []
    if depth > 40:
        return chain
    for link in out_sock.links:
        node = link.from_node
        if node.name in seen:
            continue
        seen.add(node.name)
        chain.append(node_info(node))
        for inp in node.inputs:
            if inp.is_linked:
                chain.extend(walk_sources(nt, inp, depth + 1, seen))
    return chain


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--body-d-src", default=r"D:\mmd\克莱妲原皮\Textures\body_d.png")
    args = ap.parse_args(argv)

    blend = Path(args.blend)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    blend_sha = sha256_file(blend)
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    scene = bpy.context.scene

    result = {
        "contract": "v14d-bodyskin-state2",
        "ticket": "Stage 2B-M3 全身皮肤材质统一（BodySkin 取证）",
        "authoritativeBlend": {"path": str(blend), "sha256": blend_sha},
        "blender": {
            "version": bpy.app.version_string,
            "scene": scene.name,
            "fps": scene.render.fps,
            "view_transform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": scene.view_settings.exposure,
        },
    }

    mat = bpy.data.materials.get(BODY_MAT)
    if mat is None or not mat.use_nodes:
        result["error"] = f"BodySkin 材质 {BODY_MAT} 缺失或未启用节点"
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(json.dumps({"error": result["error"]}, ensure_ascii=False))
        return 2

    nt = mat.node_tree
    output_nodes = [n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial" and n.is_active_output]
    if not output_nodes:
        output_nodes = [n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial"]
    surface_sock = output_nodes[0].inputs["Surface"] if output_nodes else None

    chain = walk_sources(nt, surface_sock) if surface_sock is not None else []
    body_d_img = bpy.data.images.get(BODY_D_IMG)

    # 列出链中出现的所有图像纹理节点（完整颜色处理事实）
    tex_nodes = [c for c in chain if c["type"] == "ShaderNodeTexImage"]
    rgb_nodes = [c for c in chain if c["type"] == "ShaderNodeRGB"]
    mix_nodes = [c for c in chain if c["type"] == "ShaderNodeMixRGB"]
    math_nodes = [c for c in chain if c["type"] == "ShaderNodeMath"]
    value_nodes = [c for c in chain if c["type"] == "ShaderNodeValue"]

    result["bodySkinMaterial"] = {
        "name": BODY_MAT,
        "outputNode": output_nodes[0].name if output_nodes else None,
        "uvLayersUsed": uv_layers_used(nt),
        "surfaceChainNodeCount": len(chain),
        "fullNodeChain": chain,
        "texNodes": tex_nodes,
        "rgbConstantNodes": rgb_nodes,
        "mixNodes": mix_nodes,
        "mathNodes": math_nodes,
        "valueNodes": value_nodes,
        "bodyBaseColor": {
            "image": BODY_D_IMG,
            "colorspace": body_d_img.colorspace_settings.name if body_d_img else None,
            "size": list(body_d_img.size) if body_d_img else None,
            "sourcePath": str(Path(args.body_d_src)),
            "sourceSha256": sha256_file(Path(args.body_d_src)),
        },
    }

    # Face 侧对照：复用既有取证常量做同族判定（只读节点名与颜色，不重跑整链）
    face_mat = bpy.data.materials.get(FACE_MAT)
    if face_mat is not None and face_mat.use_nodes:
        fnt = face_mat.node_tree
        warm = fnt.nodes.get("PROTO_FaceWarm")
        result["faceFamilyCheck"] = {
            "faceMaterial": FACE_MAT,
            "warmColor2": rgba(warm.inputs["Color2"].default_value) if warm else None,
            "hasDiscreteFaceShadowMask": any(
                n.bl_idname == "ShaderNodeTexImage" and n.image and "FaceShadow" in n.image.name
                for n in fnt.nodes
            ),
        }
    # BodySkin 是否拥有任何离散阴影 mask（face 专用 mask 禁止直接套用）
    result["bodySkinMaterial"]["hasDiscreteShadowMask"] = any(
        t.get("image") and t["image"].get("name") and "Shadow" in t["image"]["name"] for t in tex_nodes
    )
    result["bodySkinMaterial"]["allImageNames"] = [
        t.get("image", {}).get("name") for t in tex_nodes
    ]

    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("===FORENSIC-BODYSKIN-OK===")
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
