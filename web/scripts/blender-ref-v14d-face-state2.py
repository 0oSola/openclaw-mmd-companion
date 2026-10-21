# -*- coding: utf-8 -*-
# Stage 2B-M1 Blender 参考帧：用 Emission 直出「State2 ShadowFactor」与「State2 Final Composite」。
# 白光世界 + Standard 视图变换 + exposure 0 + gamma 1，隔离多灯/AgX，与 Web 线性合成同口径对账。
# 不修改 .blend；产出 .scratch PNG 供 Face Gate 对照（不提交）。
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import bpy

FACE_MAT = "PROTO_V14D_GF2_Face"
ROOTN = "GirlsFrontline KoledaDefault"
MESH = "GirlsFrontline KoledaDefault_mesh"
CAM = "PROTO_GameCamera"


def find(nt, name):
    return next((n for n in nt.nodes if n.name == name), None)


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

    # 白光世界 + Standard 视图变换
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
    scene.view_settings.exposure = 0.0; scene.view_settings.gamma = 1.0
    scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False

    mat = bpy.data.materials.get(FACE_MAT)
    nt = mat.node_tree
    mlinks = nt.links

    warm = find(nt, "PROTO_FaceWarm")
    apply_art = find(nt, "PROTO_V14D_NarrowApplyArtShadow")
    final_color = find(nt, "PROTO_V14D_NarrowFinalFaceColor")
    shadow_tint = find(nt, "PROTO_V14D_NarrowShadowTint")
    fringe_tint = find(nt, "PROTO_V14D_NarrowFringeTint")

    # Emission 直出：把链上颜色接 Emission，不经光照/AgX。
    emission = nt.nodes.new("ShaderNodeEmission")
    out_node = find(nt, "材质输出") or find(nt, "Material Output")
    if out_node is None:
        out_node = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial"), None)
    for l in list(out_node.inputs["Surface"].links):
        mlinks.remove(l)
    mlinks.new(emission.outputs["Emission"], out_node.inputs["Surface"])

    def set_emission(sock):
        for l in list(emission.inputs["Color"].links):
            mlinks.remove(l)
        mlinks.new(sock, emission.inputs["Color"])

    results = {}

    # State2 Final Composite = warm * art * fringe（State=2 Blend=0 恒等公式，
    # 不经过 NarrowFinalFaceColor 的 Hysteresis/Narrow Blend 链）。
    # 用独立 MixRGB 重建：warm * (art * fringe)。
    warm_out = find(nt, "PROTO_FaceWarm")
    shadow_tint = find(nt, "PROTO_V14D_NarrowShadowTint")
    fringe_tint = find(nt, "PROTO_V14D_NarrowFringeTint")
    mult_art = nt.nodes.new("ShaderNodeMixRGB"); mult_art.blend_type = "MULTIPLY"; mult_art.inputs["Factor"].default_value = 1.0
    mlinks.new(warm_out.outputs["Color"], mult_art.inputs["Color1"])
    mlinks.new(shadow_tint.outputs["Color"], mult_art.inputs["Color2"])
    mult_fringe = nt.nodes.new("ShaderNodeMixRGB"); mult_fringe.blend_type = "MULTIPLY"; mult_fringe.inputs["Factor"].default_value = 1.0
    mlinks.new(mult_art.outputs["Color"], mult_fringe.inputs["Color1"])
    mlinks.new(fringe_tint.outputs["Color"], mult_fringe.inputs["Color2"])
    set_emission(mult_fringe.outputs[0])
    p = outdir / "blender-ref-state2-final-composite.png"
    scene.render.filepath = str(p); bpy.ops.render.render(write_still=True)
    results["finalFaceComposite"] = p.name

    # State2 ShadowFactor = art * fringe = ApplyArtShadow(Color2=shadowTint) * fringeTint
    # 用独立 MixRGB multiply 重现 shadowFactor 链，避免 warm 项。
    mult = nt.nodes.new("ShaderNodeMixRGB"); mult.blend_type = "MULTIPLY"; mult.inputs["Factor"].default_value = 1.0
    mlinks.new(shadow_tint.outputs["Color"], mult.inputs["Color1"])
    mlinks.new(fringe_tint.outputs["Color"], mult.inputs["Color2"])
    set_emission(mult.outputs[0])
    p = outdir / "blender-ref-state2-shadow-factor.png"
    scene.render.filepath = str(p); bpy.ops.render.render(write_still=True)
    results["faceShadowOnly"] = p.name

    print("===REF-OK===")
    print(json.dumps({"results": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
