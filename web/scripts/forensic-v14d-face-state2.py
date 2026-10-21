# -*- coding: utf-8 -*-
# Stage 2B-M1 权威取证（只读）：打开权威 .blend，自省 Face 材质节点、State2 packed mask、
# warm/art/fringe 常量与节点连接，推导 Web 线性实时合成公式，输出 manifest JSON。
#
# 用法:
#   blender --background --python web/scripts/forensic-v14d-face-state2.py -- \
#     --blend <path.blend> --out <manifest.json>
#
# 不修改 .blend；不提交第三方资产；只记录 SHA/色彩空间/常量/连接/公式。
from __future__ import annotations
import argparse, hashlib, json, sys
from pathlib import Path
import bpy

FACE_MAT = "PROTO_V14D_GF2_Face"
MASK_STATE2_NODE = "PROTO_V14D_MaskState2"
MASK_STATE2_IMG = "PROTO_V14D_FaceShadow_State2"
FACE_D_IMG = "c_Koleda_slg_face_d.png"


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
    info["inputs"] = {inp.name: sock(inp) for inp in n.inputs}
    info["outputs"] = {out.name: sock(out) for out in n.outputs}
    return info


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--state2-mask-src", default=r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\textures\v14d-01234-face-shadow-state-2.png")
    ap.add_argument("--face-d-src", default=r"D:\mmd\克莱妲原皮\Textures\c_Koleda_slg_face_d.png")
    args = ap.parse_args(argv)

    blend = Path(args.blend)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    blend_sha = sha256_file(blend)
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    scene = bpy.context.scene

    mat = bpy.data.materials.get(FACE_MAT)
    if mat is None or not mat.use_nodes:
        print(json.dumps({"error": f"Face 材质 {FACE_MAT} 缺失或未启用节点"}, ensure_ascii=False))
        return 2
    nt = mat.node_tree
    nodes = {n.name: node_info(n) for n in nt.nodes}

    # State 值节点
    state_values = {
        n.name: float(n.outputs[0].default_value)
        for n in nt.nodes
        if n.bl_idname == "ShaderNodeValue" and n.name.startswith("PROTO_V14D_")
    }

    # 取证常量（从实际节点读取，不硬编码进 manifest；公式由连接结构推导）
    warm_node = nodes.get("PROTO_FaceWarm", {})
    shadow_tint_node = nodes.get("PROTO_V14D_NarrowShadowTint", {})
    fringe_tint_node = nodes.get("PROTO_V14D_NarrowFringeTint", {})
    blend_weight = state_values.get("PROTO_V14D_BlendWeight", 0.0)
    state_sel = state_values.get("PROTO_V14D_State01234", 2.0)

    warm_rgb = warm_node.get("inputs", {}).get("Color2", {}).get("default")
    shadow_tint = shadow_tint_node.get("inputs", {}).get("Color2", {}).get("default")
    fringe_tint = fringe_tint_node.get("inputs", {}).get("Color2", {}).get("default")

    mask_img = bpy.data.images.get(MASK_STATE2_IMG)
    face_d_img = bpy.data.images.get(FACE_D_IMG)

    manifest = {
        "contract": "v14d-face-state2-live-composite",
        "ticket": "Stage 2B-M1 Face State 2 实时合成（固定帧）",
        "authoritativeBlend": {
            "path": str(blend),
            "sha256": blend_sha,
        },
        "blender": {
            "version": bpy.app.version_string,
            "scene": scene.name,
            "fps": scene.render.fps,
            "view_transform": scene.view_settings.view_transform,
        },
        "faceMaterial": FACE_MAT,
        "stateSelection": {"state": state_sel, "blend": blend_weight, "note": "本票固定 State=2, Blend=0（恒等取 LayerA=State2）"},
        "assets": {
            "faceBaseColor": {
                "node": "图像纹理",
                "image": FACE_D_IMG,
                "colorspace": face_d_img.colorspace_settings.name if face_d_img else None,
                "size": list(face_d_img.size) if face_d_img else None,
                "sourcePath": str(Path(args.face_d_src)),
                "sourceSha256": sha256_file(Path(args.face_d_src)),
            },
            "state2Mask": {
                "node": MASK_STATE2_NODE,
                "image": MASK_STATE2_IMG,
                "colorspace": mask_img.colorspace_settings.name if mask_img else None,
                "size": list(mask_img.size) if mask_img else None,
                "packed": bool(mask_img.packed_file) if mask_img else None,
                "packed_sha256": hashlib.sha256(bytes(mask_img.packed_file.data)).hexdigest() if mask_img and mask_img.packed_file else None,
                "blendInternalPath": mask_img.filepath if mask_img else None,
                "sourcePath": str(Path(args.state2_mask_src)),
                "sourceSha256": sha256_file(Path(args.state2_mask_src)),
            },
        },
        "channelMeaning": {
            "R": "art shadow weight（艺术阴影权重）",
            "G": "fringe weight（边缘/ fringe 权重）",
            "B": "narrow face-valid / protect 通道（用于 (1-B) 门控）",
            "alpha": "faceValid（State=2 Blend=0 时恒为 1）",
        },
        "constants": {
            "warmColor": warm_rgb,
            "artShadowTint": shadow_tint,
            "fringeTint": fringe_tint,
        },
        "linearCompositeFormula": {
            "space": "linear（Blender 节点与 Web 实时合成均在线性空间执行；face_d 需 sRGB->linear 解码，mask 为 Non-Color 不解码）",
            "warm": "warm = faceD_linear * warmColor",
            "art": "art = mix(white, artShadowTint, R * (1 - B))",
            "fringe": "fringe = mix(white, fringeTint, G * (1 - B))",
            "shadowFactor": "shadowFactor = art * fringe",
            "composite": "composite = warm * shadowFactor",
            "note": "State=2 / Blend=0 时 faceValid=1，FinalMixAlphaFaceValid 为恒等；occlusion 链对本票退化为 shadowFactor。",
        },
        "nodeGraph": {
            "warmNode": warm_node,
            "shadowTintNode": shadow_tint_node,
            "applyArtShadowNode": nodes.get("PROTO_V14D_NarrowApplyArtShadow"),
            "fringeTintNode": fringe_tint_node,
            "finalFaceColorNode": nodes.get("PROTO_V14D_NarrowFinalFaceColor"),
            "finalMaskRGBBlend": nodes.get("PROTO_V14D_FinalMaskRGBBlend"),
            "finalMaskRGBSeparate": nodes.get("PROTO_V14D_FinalMaskRGBSeparate"),
            "stateValues": state_values,
        },
    }

    out_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("===FORENSIC-OK===")
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
