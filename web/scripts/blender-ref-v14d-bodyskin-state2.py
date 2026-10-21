# -*- coding: utf-8 -*-
# Stage 2B-M3 Blender 身体皮肤参考帧：BodySkin 材质 Emission 直出
# 「body_d × 身体 warm=[1,0.945,0.905]」（权威 blend 取证的 BodySkin 颜色口径）。
# 白光世界 + Standard 视图变换 + exposure 0 + gamma 1，与 Web 线性合成同口径对账。
# 与 blender-ref-v14d-face-state2.py 同一渲染口径；不修改 .blend。
#
# 用法:
#   D:/Blender/blender.exe --background --python web/scripts/blender-ref-v14d-bodyskin-state2.py -- \
#     --blend <path.blend> --vmd <pose.vmd> --outdir <dir>
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import bpy

BODY_MAT = "PROTO_GF2_BodySkin"
ROOTN = "GirlsFrontline KoledaDefault"
MESH = "GirlsFrontline KoledaDefault_mesh"
CAM = "PROTO_GameCamera"


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--vmd", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--frame", type=int, default=120)
    args = ap.parse_args(argv)

    outdir = Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.open_mainfile(filepath=args.blend)
    scene = bpy.context.scene
    root = bpy.data.objects.get(ROOTN)
    mesh = bpy.data.objects.get(MESH)
    cam = bpy.data.objects.get(CAM)
    scene.camera = cam
    for o in scene.objects:
        if o.type == "MESH":
            o.hide_render = (o.name != MESH)
    mesh.hide_render = False
    try:
        mesh.hide_set(False); mesh.hide_viewport = False
    except Exception:
        pass

    vmd = Path(args.vmd)
    if vmd.is_file() and root is not None:
        for o in scene.objects:
            o.select_set(False)
        root.hide_render = False
        try:
            root.hide_set(False); root.hide_viewport = False
        except Exception:
            pass
        root.select_set(True); bpy.context.view_layer.objects.active = root
        scene.frame_set(0)
        bpy.ops.mmd_tools.import_vmd(filepath=str(vmd), bone_mapper="PMX", scale=0.08, margin=0,
                                     create_new_action=True, use_pose_mode=False, update_scene_settings=False)
    scene.frame_set(args.frame)
    scene.render.fps = 24; scene.render.fps_base = 1.0
    scene.render.resolution_x = 640; scene.render.resolution_y = 640; scene.render.resolution_percentage = 100
    scene.render.engine = "BLENDER_EEVEE"
    bpy.context.view_layer.update()

    # 白光世界 + Standard 视图变换（与 face state2 参考帧同口径）
    world = scene.world or bpy.data.worlds.new("W"); scene.world = world
    world.use_nodes = True
    wn = world.node_tree.nodes; wl = world.node_tree.links; wn.clear()
    wout = wn.new("ShaderNodeOutputWorld"); wbg = wn.new("ShaderNodeBackground")
    wbg.inputs["Color"].default_value = (1, 1, 1, 1); wbg.inputs["Strength"].default_value = 1.0
    wl.new(wbg.outputs["Background"], wout.inputs["Surface"])
    for o in scene.objects:
        if o.type == "LIGHT":
            o.hide_render = True
    scene.view_settings.view_transform = "Standard"; scene.view_settings.look = "None"
    # Stage 2B-M3：Web faceStatic 显示口径为 exposure=-0.56（对齐权威 AgX 曝光），
    # 参考帧用同曝光做苹果对苹果对账（不再是 exposure=0）。
    scene.view_settings.exposure = -0.56; scene.view_settings.gamma = 1.0
    scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False

    mat = bpy.data.materials.get(BODY_MAT)
    nt = mat.node_tree
    mlinks = nt.links

    emission = nt.nodes.new("ShaderNodeEmission")
    out_node = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial"), None)
    for l in list(out_node.inputs["Surface"].links):
        mlinks.remove(l)
    mlinks.new(emission.outputs["Emission"], out_node.inputs["Surface"])

    # BodySkin 参考 = 权威 blend 的 PROTO_FaceWarm 输出（body_d × 身体 warm=[1,0.945,0.905]）。
    warm = next((n for n in nt.nodes if n.name == "PROTO_FaceWarm"), None)
    if warm is None:
        print(json.dumps({"error": "BodySkin 缺 PROTO_FaceWarm 节点"}, ensure_ascii=False))
        return 2
    mlinks.new(warm.outputs["Color"], emission.inputs["Color"])

    # 其余材质改成全透明（只渲 BodySkin 可见皮肤区域），否则手套/外套遮手，
    # 「非白像素」口径会被服装主导，与 Web BodySkin 材质 ROI 不可比。
    for m in bpy.data.materials:
        if m is not mat:
            m.use_nodes = True
            out2 = next((n2 for n2 in m.node_tree.nodes if n2.bl_idname == "ShaderNodeOutputMaterial"), None)
            tr = m.node_tree.nodes.new("ShaderNodeBsdfTransparent")
            for l in list(out2.inputs["Surface"].links):
                m.node_tree.links.remove(l)
            m.node_tree.links.new(tr.outputs["BSDF"], out2.inputs["Surface"])

    p = outdir / "blender-ref-bodyskin-composite.png"
    scene.render.filepath = str(p); bpy.ops.render.render(write_still=True)

    print("===REF-BODYSKIN-OK===")
    print(json.dumps({"results": {"bodyskinComposite": p.name}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
