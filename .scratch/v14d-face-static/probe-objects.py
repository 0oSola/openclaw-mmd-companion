import bpy, json
bpy.ops.wm.open_mainfile(filepath=r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
scene = bpy.context.scene
objs = []
for o in bpy.data.objects:
    objs.append({"name": o.name, "type": o.type, "hide_render": o.hide_render, "parent": (o.parent.name if o.parent else None)})
cams = []
for o in bpy.data.objects:
    if o.type == "CAMERA":
        cams.append({"name": o.name, "location": [round(float(v),4) for v in o.location], "lens": float(o.data.lens), "sensor_w": float(o.data.sensor_width), "is_scene_cam": scene.camera == o})
print("===OBJ-BEGIN===")
print(json.dumps({"objects": objs, "cameras": cams, "scene_camera": (scene.camera.name if scene.camera else None), "frame_range": [scene.frame_start, scene.frame_end], "frame_current": scene.frame_current}, ensure_ascii=False, indent=2))
print("===OBJ-END===")
