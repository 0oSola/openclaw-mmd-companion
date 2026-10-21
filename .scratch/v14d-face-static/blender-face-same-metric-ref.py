# -*- coding: utf-8 -*-
# 同口径 Blender 参考帧: Face 材质 Base Color 接"分量/合成"因子链,
# 白光 EEVEE + Standard 视图变换 + exposure 0 + gamma 1 (隔离多灯/AgX),
# 与 Web unlit 同口径对账。产出 normal/finalFaceComposite/faceShadowOnly 三模式参考。
from __future__ import annotations
import json
from pathlib import Path
import bpy

BLEND = Path(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
VMD = Path(r"C:\w\rk3-face-v14d\web\public\assets\mmd\calibration\koleda-v14d\koleda-v14d-authoritative-pose-f120.vmd")
ROOTN = "GirlsFrontline KoledaDefault"
MESH = "GirlsFrontline KoledaDefault_mesh"
CAM = "PROTO_GameCamera"
OUTDIR = Path(r"C:\w\rk3-face-v14d\.scratch\v14d-face-static-derived")
OUTDIR.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
scene = bpy.context.scene
root = bpy.data.objects.get(ROOTN); mesh = bpy.data.objects.get(MESH); cam = bpy.data.objects.get(CAM)
scene.camera = cam
for o in scene.objects:
    if o.type == "MESH": o.hide_render = (o.name != MESH)
mesh.hide_render = False; mesh.hide_viewport = False
try: mesh.hide_set(False)
except Exception: pass

if VMD.is_file() and root is not None:
    for o in scene.objects: o.select_set(False)
    root.hide_viewport = False; root.hide_render = False
    try: root.hide_set(False)
    except Exception: pass
    root.select_set(True); bpy.context.view_layer.objects.active = root
    scene.frame_set(0)
    bpy.ops.mmd_tools.import_vmd(filepath=str(VMD), bone_mapper="PMX", scale=0.08, margin=0, create_new_action=True, use_pose_mode=False, update_scene_settings=False)
scene.frame_set(120)
scene.render.fps = 24; scene.render.fps_base = 1.0
scene.render.resolution_x = 640; scene.render.resolution_y = 640; scene.render.resolution_percentage = 100
scene.render.engine = "BLENDER_EEVEE"
bpy.context.view_layer.update()

# 白光世界 + Standard 视图变换 (隔离多灯/AgX)
world = scene.world or bpy.data.worlds.new("W"); scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links; wn.clear()
wout = wn.new("ShaderNodeOutputWorld"); wbg = wn.new("ShaderNodeBackground")
wbg.inputs["Color"].default_value = (1,1,1,1); wbg.inputs["Strength"].default_value = 1.0
wl.new(wbg.outputs["Background"], wout.inputs["Surface"])
for o in scene.objects:
    if o.type == "LIGHT": o.hide_render = True
scene.view_settings.view_transform = "Standard"; scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0; scene.view_settings.gamma = 1.0
scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGB"; scene.render.image_settings.color_depth = "8"
scene.render.film_transparent = False

mat = bpy.data.materials.get("PROTO_V14D_GF2_Face")
nt = mat.node_tree; mlinks = nt.links
principled = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
# 找取证出的关键节点
def find(pred):
    return next((n for n in nt.nodes if pred(n)), None)
face_d = find(lambda n: n.bl_idname == "ShaderNodeTexImage" and "face_d" in (n.image.name.lower() if n.image else ""))
mask_n = find(lambda n: n.bl_idname == "ShaderNodeTexImage" and "State2" in n.name)
warm_n = find(lambda n: "FaceWarm" in n.name)
art_n = find(lambda n: "NarrowApplyArtShadow" in n.name) or find(lambda n: "ShadowTint" in n.name)
final_n = find(lambda n: "NarrowFinalFaceColor" in n.name) or find(lambda n: "ApplyArtShadow" in n.name)

# 白光平光: Principled rough=1, specular=0, metallic=0 (近似纯 diffuse 直照)
principled.inputs["Roughness"].default_value = 1.0
if principled.inputs.get("Specular IOR Level"): principled.inputs["Specular IOR Level"].default_value = 0.0
principled.inputs["Metallic"].default_value = 0.0
base_color_in = principled.inputs["Base Color"]
def set_basecolor(out_socket):
    for l in list(base_color_in.links): mlinks.remove(l)
    mlinks.new(out_socket, base_color_in)

results = {}
# normal: 原始 face_d
set_basecolor(face_d.outputs["Color"])
scene.render.filepath = str(OUTDIR / "blender-ref-normal.png"); bpy.ops.render.render(write_still=True); results["normal"] = "blender-ref-normal.png"
# finalFaceComposite: 完整合成 (FinalFaceColor 输出 = warm*shadow*fringe)
set_basecolor(final_n.outputs[0])
scene.render.filepath = str(OUTDIR / "blender-ref-finalFaceComposite.png"); bpy.ops.render.render(write_still=True); results["finalFaceComposite"] = "blender-ref-finalFaceComposite.png"

print("===REF-BEGIN===")
print(json.dumps({"results": results, "found": {"face_d": bool(face_d), "mask": bool(mask_n), "warm": bool(warm_n), "final": bool(final_n)}}, ensure_ascii=False, indent=2))
print("===REF-END===")
