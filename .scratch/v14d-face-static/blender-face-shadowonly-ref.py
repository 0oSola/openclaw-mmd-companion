# -*- coding: utf-8 -*-
# faceShadowOnly 同口径参考: Face 用 Emission 输出"纯阴影衰减分量" attenuation=1-shadowFactor。
# 公式与 bake-face-state2.py 完全一致（线性空间）:
#   art=mix(1,[0.66,0.58,0.60], R*(1-B)); fringe=mix(1,[0.70,0.64,0.69], G*(1-B));
#   shadowFactor=art*fringe; attenuation=1-shadowFactor。
# Emission 隔离灯光/着色, Standard+exposure0+gamma1 -> 与 Web unlit 同口径。
from __future__ import annotations
import json
from pathlib import Path
import bpy

BLEND = Path(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
VMD = Path(r"C:\w\rk3-face-v14d\web\public\assets\mmd\calibration\koleda-v14d\koleda-v14d-authoritative-pose-f120.vmd")
ROOTN = "GirlsFrontline KoledaDefault"; MESH = "GirlsFrontline KoledaDefault_mesh"; CAM = "PROTO_GameCamera"
OUTDIR = Path(r"C:\w\rk3-face-v14d\.scratch\v14d-face-static-derived"); OUTDIR.mkdir(parents=True, exist_ok=True)

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
scene.render.resolution_x = 640; scene.render.resolution_y = 640; scene.render.resolution_percentage = 100
scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "Standard"; scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0; scene.view_settings.gamma = 1.0
scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGB"; scene.render.image_settings.color_depth = "8"
scene.render.film_transparent = False
bpy.context.view_layer.update()

mat = bpy.data.materials.get("PROTO_V14D_GF2_Face")
nt = mat.node_tree; mlinks = nt.links; nodes = nt.nodes
mask_n = next((n for n in nodes if n.bl_idname == "ShaderNodeTexImage" and "State2" in n.name), None)
sep = nodes.new("ShaderNodeSeparateColor"); mlinks.new(mask_n.outputs["Color"], sep.inputs["Color"])
# art = mix(1, SHADOW, R*(1-B)); 用 MixRGB: fac=R*(1-B), C1=1, C2=SHADOW
SHADOW=[0.66,0.58,0.60,1.0]; FRINGE=[0.70,0.64,0.69,1.0]
def const_rgb(val):
    n=nodes.new("ShaderNodeRGB"); n.outputs[0].default_value=val; return n
# w_art = R*(1-B)
invB = nodes.new("ShaderNodeMath"); invB.operation="SUBTRACT"; invB.inputs[0].default_value=1.0; mlinks.new(sep.outputs["Blue"], invB.inputs[1])
wArt = nodes.new("ShaderNodeMath"); wArt.operation="MULTIPLY"; mlinks.new(sep.outputs["Red"], wArt.inputs[0]); mlinks.new(invB.outputs[0], wArt.inputs[1])
wFringe = nodes.new("ShaderNodeMath"); wFringe.operation="MULTIPLY"; mlinks.new(sep.outputs["Green"], wFringe.inputs[0]); mlinks.new(invB.outputs[0], wFringe.inputs[1])
mixArt = nodes.new("ShaderNodeMixRGB"); mixArt.blend_type="MIX"; mixArt.inputs[1].default_value=(1,1,1,1); mixArt.inputs[2].default_value=SHADOW; mlinks.new(wArt.outputs[0], mixArt.inputs[0])
mixFringe = nodes.new("ShaderNodeMixRGB"); mixFringe.blend_type="MIX"; mixFringe.inputs[1].default_value=(1,1,1,1); mixFringe.inputs[2].default_value=FRINGE; mlinks.new(wFringe.outputs[0], mixFringe.inputs[0])
shadowFactor = nodes.new("ShaderNodeMixRGB"); shadowFactor.blend_type="MULTIPLY"; shadowFactor.inputs[0].default_value=1.0; mlinks.new(mixArt.outputs[0], shadowFactor.inputs[1]); mlinks.new(mixFringe.outputs[0], shadowFactor.inputs[2])
atten = nodes.new("ShaderNodeMixRGB"); atten.blend_type="SUBTRACT"; atten.inputs[0].default_value=1.0; atten.inputs[1].default_value=(1,1,1,1); mlinks.new(shadowFactor.outputs[0], atten.inputs[2])
# Emission 输出 attenuation, 断 Face 原 surface
emission = nodes.new("ShaderNodeEmission"); mlinks.new(atten.outputs[0], emission.inputs["Color"])
out = next((n for n in nodes if n.bl_idname=="ShaderNodeOutputMaterial"), None)
for l in list(out.inputs["Surface"].links): mlinks.remove(l)
mlinks.new(emission.outputs[0], out.inputs["Surface"])
scene.render.filepath = str(OUTDIR / "blender-ref-faceShadowOnly.png")
bpy.ops.render.render(write_still=True)
print("===SHADOW-REF-DONE=== mask=" + str(bool(mask_n)))
