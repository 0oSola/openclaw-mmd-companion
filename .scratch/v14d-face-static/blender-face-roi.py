# -*- coding: utf-8 -*-
# Blender 侧 frame-120 脸部 ROI 投影 + 权威 State2 mask 参考渲染 (unlit, 白光隔离).
from __future__ import annotations
import json, sys
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

BLEND = Path(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
VMD = Path(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\koleda-v14d-authoritative-pose-f120.vmd")
MESH = "GirlsFrontline KoledaDefault_mesh"
ARM = "GirlsFrontline KoledaDefault_arm"
CAM = "PROTO_GameCamera"
OUTDIR = Path(r".scratch\v14d-face-static")
OUTDIR.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
scene = bpy.context.scene
result = {"vmdImported": False, "camera": None, "faceRoiPx": None, "render": None, "errors": []}

# 导入权威 VMD 并固定 frame 120
root = bpy.data.objects.get("GirlsFrontline KoledaDefault") or bpy.data.objects.get(ARM)
if VMD.is_file() and root is not None:
    for o in scene.objects: o.select_set(False)
    root.hide_viewport = False; root.hide_render = False
    try: root.hide_set(False)
    except Exception: pass
    root.select_set(True); bpy.context.view_layer.objects.active = root
    scene.frame_set(0)
    r = bpy.ops.mmd_tools.import_vmd(filepath=str(VMD), bone_mapper="PMX", scale=0.08, margin=0, create_new_action=True, use_pose_mode=False, update_scene_settings=False)
    result["vmdImported"] = "FINISHED" in r
    result["vmdResult"] = sorted(r)
else:
    result["errors"].append("VMD missing or root missing; keep blend pose")
scene.frame_set(120)
scene.render.fps = 24
scene.render.resolution_x = 640; scene.render.resolution_y = 640; scene.render.resolution_percentage = 100
bpy.context.view_layer.update()

# 相机
cam = bpy.data.objects.get(CAM)
if cam is None:
    result["errors"].append("camera missing")
else:
    scene.camera = cam
    result["camera"] = {"location": [float(v) for v in cam.location], "lensMm": float(cam.data.lens), "sensorWidthMm": float(cam.data.sensor_width)}

# Face ROI: 评估网格在 frame120 的投影 bounds
mesh = bpy.data.objects.get(MESH)
if mesh is not None and cam is not None:
    dg = bpy.context.evaluated_depsgraph_get()
    em = mesh.evaluated_get(dg)
    m = em.to_mesh()
    m.calc_loop_triangles()
    face_idx = mesh.material_slots and next((i for i, s in enumerate(mesh.material_slots) if s.material and "V14D_GF2_Face" in s.material.name), None)
    if face_idx is None:
        result["errors"].append("face material slot not found")
    else:
        xs, ys = [], []
        wmat = em.matrix_world
        for tri in m.loop_triangles:
            if tri.material_index != face_idx: continue
            for vi in tri.vertices:
                w = wmat @ m.vertices[vi].co
                ndc = world_to_camera_view(scene, cam, w)
                xs.append(ndc.x); ys.append(ndc.y)
        em.to_mesh_clear()
        if xs:
            x0, x1 = max(0.0, min(xs)), min(1.0, max(xs))
            y0, y1 = max(0.0, min(ys)), min(1.0, max(ys))
            # Blender NDC y 向上; 转为图像自上而下的像素
            px = [x0 * 640, (1.0 - y1) * 640, (x1 - x0) * 640, (y1 - y0) * 640]
            result["faceRoiPx"] = [round(v, 2) for v in px]
            result["faceRoiNormBlenderNDC"] = [round(x0, 4), round(y0, 4), round(x1 - x0, 4), round(y1 - y0, 4)]
            result["faceVertCount"] = len(xs)

print("===ROI-BEGIN===")
print(json.dumps(result, ensure_ascii=False, indent=2))
print("===ROI-END===")
(OUTDIR / "face-roi.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
