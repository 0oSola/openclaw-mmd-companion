import bpy, json
bpy.ops.wm.open_mainfile(filepath=r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
scene = bpy.context.scene
cam = bpy.data.objects.get("PROTO_GameCamera")
def v3(v): return [round(float(x),4) for x in v]
out = {"scene_cam": scene.camera.name, "location": v3(cam.location), "rotation_euler": v3(cam.rotation_euler), "rotation_mode": cam.rotation_mode, "lens": cam.data.lens, "sensor_w": cam.data.sensor_width, "sensor_fit": cam.data.sensor_fit, "shift_x": cam.data.shift_x, "shift_y": cam.data.shift_y, "type": cam.data.type, "matrix_world": [[round(float(x),4) for x in row] for row in cam.matrix_world]}
# mesh bounds at bind
mesh = bpy.data.objects.get("GirlsFrontline KoledaDefault_mesh")
import mathutils
dg = bpy.context.evaluated_depsgraph_get()
em = mesh.evaluated_get(dg); m = em.to_mesh()
wm = em.matrix_world
zs = [(wm @ v.co).z for v in m.vertices]; xsv=[(wm@v.co).x for v in m.vertices]
out["mesh_world_z_range"] = [round(min(zs),3), round(max(zs),3)]
out["mesh_world_x_range"] = [round(min(xsv),3), round(max(xsv),3)]
print("===CAM-BEGIN==="); print(json.dumps(out, indent=2)); print("===CAM-END===")
