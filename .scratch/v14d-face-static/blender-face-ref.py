# -*- coding: utf-8 -*-
from __future__ import annotations
import json
from pathlib import Path
import bpy
from bpy_extras.object_utils import world_to_camera_view

BLEND = Path(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
VMD = Path(r"C:\w\rk3-face-v14d\web\public\assets\mmd\calibration\koleda-v14d\koleda-v14d-authoritative-pose-f120.vmd")
ROOTN = "GirlsFrontline KoledaDefault"
MESH = "GirlsFrontline KoledaDefault_mesh"
CAM = "PROTO_GameCamera"
OUTDIR = Path(r"E:\codexWorktree\4d43\MMD project\.scratch\v14d-face-static"); OUTDIR.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
scene = bpy.context.scene
res = {"vmdImported": False, "faceRoiPx": None, "renderPng": None, "errors": []}
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
    r = bpy.ops.mmd_tools.import_vmd(filepath=str(VMD), bone_mapper="PMX", scale=0.08, margin=0, create_new_action=True, use_pose_mode=False, update_scene_settings=False)
    res["vmdImported"] = "FINISHED" in r
    res["vmdResult"] = sorted(r)
else:
    res["errors"].append("VMD missing=" + str(not VMD.is_file()) + " root missing=" + str(root is None))
scene.frame_set(120)
scene.render.fps = 24; scene.render.fps_base = 1.0
scene.render.resolution_x = 640; scene.render.resolution_y = 640; scene.render.resolution_percentage = 100
scene.render.engine = "BLENDER_EEVEE"
bpy.context.view_layer.update()

dg = bpy.context.evaluated_depsgraph_get()
em = mesh.evaluated_get(dg); mm = em.to_mesh(); mm.calc_loop_triangles()
face_idx = next((i for i, s in enumerate(mesh.material_slots) if s.material and "V14D_GF2_Face" in s.material.name), None)
xs, ys = [], []
wmat = em.matrix_world
for tri in mm.loop_triangles:
    if tri.material_index != face_idx: continue
    for vi in tri.vertices:
        ndc = world_to_camera_view(scene, cam, wmat @ mm.vertices[vi].co)
        xs.append(ndc.x); ys.append(ndc.y)
em.to_mesh_clear()
x0, x1 = max(0.0, min(xs)), min(1.0, max(xs)); y0, y1 = max(0.0, min(ys)), min(1.0, max(ys))
res["faceRoiPx"] = [round(x0*640,2), round((1-y1)*640,2), round((x1-x0)*640,2), round((y1-y0)*640,2)]
res["faceRoiNorm"] = [round(x0,4), round(1-y1,4), round(x1-x0,4), round(y1-y0,4)]
res["faceVertSamples"] = len(xs)

world = scene.world or bpy.data.worlds.new("W"); scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links; wn.clear()
wout = wn.new("ShaderNodeOutputWorld"); wbg = wn.new("ShaderNodeBackground")
wbg.inputs["Color"].default_value = (1,1,1,1); wbg.inputs["Strength"].default_value = 0.73
wl.new(wbg.outputs["Background"], wout.inputs["Surface"])
for o in scene.objects:
    if o.type == "LIGHT": o.hide_render = True

mat = bpy.data.materials.get("PROTO_V14D_GF2_Face")
nt = mat.node_tree; mlinks = nt.links
principled = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
mask_node = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeTexImage" and n.name == "PROTO_V14D_MaskState2"), None)
for l in list(principled.inputs["Base Color"].links): mlinks.remove(l)
mlinks.new(mask_node.outputs["Color"], principled.inputs["Base Color"])
principled.inputs["Roughness"].default_value = 1.0
if principled.inputs.get("Specular IOR Level"): principled.inputs["Specular IOR Level"].default_value = 0.0
principled.inputs["Metallic"].default_value = 0.0

scene.view_settings.view_transform = "Standard"; scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0; scene.view_settings.gamma = 1.0
scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGB"; scene.render.image_settings.color_depth = "8"
scene.render.film_transparent = False
out_png = OUTDIR / "blender-face-mask-state2-linear.png"
scene.render.filepath = str(out_png)
bpy.ops.render.render(write_still=True)
res["renderPng"] = str(out_png) if out_png.exists() else None
res["renderExists"] = out_png.exists()

print("===REF-BEGIN===")
print(json.dumps(res, ensure_ascii=False, indent=2))
print("===REF-END===")
(OUTDIR / "face-roi.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
