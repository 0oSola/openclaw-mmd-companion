# -*- coding: utf-8 -*-
# 权威 frame-120 face composite 参考 (白光, Face 材质原 V14D 节点链, AgX 隔离).
from __future__ import annotations
import json
from pathlib import Path
import bpy

BLEND = Path(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
VMD = Path(r"C:\w\rk3-face-v14d\web\public\assets\mmd\calibration\koleda-v14d\koleda-v14d-authoritative-pose-f120.vmd")
ROOTN = "GirlsFrontline KoledaDefault"; MESH = "GirlsFrontline KoledaDefault_mesh"; CAM = "PROTO_GameCamera"
OUTDIR = Path(r"E:\codexWorktree\4d43\MMD project\.scratch\v14d-face-static"); OUTDIR.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(BLEND))
scene = bpy.context.scene
root = bpy.data.objects.get(ROOTN); mesh = bpy.data.objects.get(MESH); cam = bpy.data.objects.get(CAM)
scene.camera = cam
for o in scene.objects:
    if o.type == "MESH": o.hide_render = (o.name != MESH)
mesh.hide_render = False; mesh.hide_viewport = False
try: mesh.hide_set(False)
except Exception: pass
for o in scene.objects: o.select_set(False)
root.hide_viewport = False; root.hide_render = False
try: root.hide_set(False)
except Exception: pass
root.select_set(True); bpy.context.view_layer.objects.active = root
scene.frame_set(0)
r = bpy.ops.mmd_tools.import_vmd(filepath=str(VMD), bone_mapper="PMX", scale=0.08, margin=0, create_new_action=True, use_pose_mode=False, update_scene_settings=False)
scene.frame_set(120)
scene.render.fps = 24; scene.render.fps_base = 1.0
scene.render.resolution_x = 640; scene.render.resolution_y = 640; scene.render.resolution_percentage = 100
scene.render.engine = "BLENDER_EEVEE"
bpy.context.view_layer.update()
# 白光 World
world = scene.world or bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links; wn.clear()
wout = wn.new("ShaderNodeOutputWorld"); wbg = wn.new("ShaderNodeBackground")
wbg.inputs["Color"].default_value = (1,1,1,1); wbg.inputs["Strength"].default_value = 0.73
wl.new(wbg.outputs["Background"], wout.inputs["Surface"])
for o in scene.objects:
    if o.type == "LIGHT": o.hide_render = True
# AgX 隔离: 读 Scene Linear (Standard/None/0/1)
scene.view_settings.view_transform = "Standard"; scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0; scene.view_settings.gamma = 1.0
scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGB"; scene.render.image_settings.color_depth = "8"
scene.render.film_transparent = False
out = OUTDIR / "blender-face-composite-state2-linear.png"
scene.render.filepath = str(out)
bpy.ops.render.render(write_still=True)
print("===COMP-BEGIN===")
print(json.dumps({"vmd": "FINISHED" in r, "png": str(out), "exists": out.exists()}))
print("===COMP-END===")
