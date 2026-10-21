# -*- coding: utf-8 -*-
# Blender 侧 V14D Face 权威采样导出（UV-direct 逐纹素对账的上游）。
#
# 只读权威 .blend：脚本不保存 blend、不改 PMX/VMD/材质节点，仅提取:
#   1) Face 材质在 frame120（VMD 姿态）下的逐 loop 顶点 UV/屏幕像素坐标
#   2) 两张关键图像的线性像素矩阵快照:
#      - face_d（BaseColor, sRGB 打包图）
#      - State2 阴影掩码（Non-Color）
#   3) 采样口径登记: 分辨率/颜色空间/插值/扩展方式/透明度/打包状态/SHA256
#   4) 白光 Emission 参考渲染（normal/finalFaceComposite/faceShadowOnly 三模式）供同 mask Gate
#
# 输出全部写到 -- <outdir>（默认 .scratch/v14d-face-static/uv-align/blender），
# 不写入仓库已跟踪目录以外的位置，不触碰权威资产。
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view

BLEND = Path(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend")
VMD = Path(r"C:\w\rk3-face-v14d\web\public\assets\mmd\calibration\koleda-v14d\koleda-v14d-authoritative-pose-f120.vmd")
ROOTN = "GirlsFrontline KoledaDefault"
MESH = "GirlsFrontline KoledaDefault_mesh"
CAM = "PROTO_GameCamera"
FACE_MAT_HINT = "V14D_GF2_Face"

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUTDIR = Path(argv[0]) if argv else Path(r".scratch\v14d-face-static\uv-align\blender")
OUTDIR = OUTDIR.resolve()
OUTDIR.mkdir(parents=True, exist_ok=True)

def sha256_file(p: Path) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def sha256_arr(a: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()

def pack_bytes(path: Path) -> bytes | None:
    try:
        return Path(path).read_bytes()
    except OSError:
        return None

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
scene = bpy.context.scene
result: dict = {"blend": str(BLEND), "vmd": str(VMD), "outDir": str(OUTDIR), "errors": []}

root = bpy.data.objects.get(ROOTN)
mesh = bpy.data.objects.get(MESH)
cam = bpy.data.objects.get(CAM)
if mesh is None or cam is None:
    result["errors"].append(f"missing mesh/camera: mesh={mesh is None} cam={cam is None}")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(2)

scene.camera = cam
for o in scene.objects:
    if o.type == "MESH":
        o.hide_render = (o.name != MESH)
mesh.hide_render = False
mesh.hide_viewport = False
try:
    mesh.hide_set(False)
except Exception:
    pass

# 权威 VMD -> frame 120
if VMD.is_file() and root is not None:
    for o in scene.objects:
        o.select_set(False)
    root.hide_viewport = False
    root.hide_render = False
    try:
        root.hide_set(False)
    except Exception:
        pass
    root.select_set(True)
    bpy.context.view_layer.objects.active = root
    scene.frame_set(0)
    r = bpy.ops.mmd_tools.import_vmd(
        filepath=str(VMD), bone_mapper="PMX", scale=0.08, margin=0,
        create_new_action=True, use_pose_mode=False, update_scene_settings=False,
    )
    result["vmdImported"] = "FINISHED" in r
else:
    result["errors"].append("VMD missing or root missing")
scene.frame_set(120)
scene.render.fps = 24
scene.render.fps_base = 1.0
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.engine = "BLENDER_EEVEE"
bpy.context.view_layer.update()

# Face 材质槽与贴图节点
face_slot = next(
    (i for i, s in enumerate(mesh.material_slots) if s.material and FACE_MAT_HINT in s.material.name),
    None,
)
if face_slot is None:
    result["errors"].append("face material slot not found")
mat = mesh.material_slots[face_slot].material if face_slot is not None else None
nt = mat.node_tree if mat else None

def find_node(pred):
    return next((n for n in nt.nodes if pred(n)), None) if nt else None

face_d_node = find_node(lambda n: n.bl_idname == "ShaderNodeTexImage" and "face_d" in (n.image.name.lower() if n.image else ""))
state2_node = find_node(lambda n: n.bl_idname == "ShaderNodeTexImage" and "state2" in (n.image.name.lower() if n.image else ""))
final_node = find_node(lambda n: "NarrowFinalFaceColor" in n.name) or find_node(lambda n: "ApplyArtShadow" in n.name)

def describe_tex(node):
    if node is None or node.image is None:
        return None
    img = node.image
    packed = bool(img.packed_file)
    rec = {
        "nodeName": node.name,
        "imageName": img.name,
        "size": [int(img.size[0]), int(img.size[1])],
        "channels": int(img.channels),
        "depth": int(img.depth),
        "colorspace": img.colorspace_settings.name,
        "packed": packed,
        "alphaMode": img.alpha_mode,
        "interpolation": node.interpolation,
        "extension": node.extension,
        "filepathRaw": img.filepath,
    }
    data = None
    src_path = None
    if packed and img.packed_file is not None:
        data = bytes(img.packed_file.data)
        src_path = "packed"
    else:
        ap = bpy.path.abspath(img.filepath)
        if ap and Path(ap).is_file():
            src_path = ap
            data = pack_bytes(ap)
    rec["source"] = src_path
    rec["sha256"] = hashlib.sha256(data).hexdigest() if data else None
    rec["bytes"] = len(data) if data else None
    return rec

result["faceMaterial"] = {
    "slotIndex": face_slot,
    "materialName": mat.name if mat else None,
    "faceD": describe_tex(face_d_node),
    "state2Mask": describe_tex(state2_node),
    "finalNodeFound": bool(final_node),
}

# 逐 loop 顶点 UV + 屏幕像素投影（frame120 姿态）
dg = bpy.context.evaluated_depsgraph_get()
em = mesh.evaluated_get(dg)
mm = em.to_mesh()
mm.calc_loop_triangles()
uv_layer = mm.uv_layers.active
loops: list[list[float]] = []
wmat = em.matrix_world
for tri in mm.loop_triangles:
    if tri.material_index != face_slot:
        continue
    for li in tri.loops:
        uv = uv_layer.data[li].uv
        ndc = world_to_camera_view(scene, cam, wmat @ mm.vertices[li].co)
        loops.append([float(uv[0]), float(uv[1]), float(ndc.x * 640.0), float((1.0 - ndc.y) * 640.0)])
em.to_mesh_clear()
loops_arr = np.asarray(loops, dtype=np.float32)
np.save(OUTDIR / "face-loops-uv.npy", loops_arr)
result["faceLoops"] = {
    "count": int(loops_arr.shape[0]),
    "uvMin": [float(loops_arr[:, 0].min()), float(loops_arr[:, 1].min())],
    "uvMax": [float(loops_arr[:, 0].max()), float(loops_arr[:, 1].max())],
    "screenPxMin": [float(loops_arr[:, 2].min()), float(loops_arr[:, 3].min())],
    "screenPxMax": [float(loops_arr[:, 2].max()), float(loops_arr[:, 3].max())],
    "npySha256": sha256_file(OUTDIR / "face-loops-uv.npy"),
}

# 图像线性像素快照（Blender 解码后场景线性值）
def dump_pixels(node, name):
    if node is None or node.image is None:
        return None
    img = node.image
    px = np.asarray(img.pixels[:], dtype=np.float32)
    w, h, ch = int(img.size[0]), int(img.size[1]), int(img.channels)
    arr = px.reshape(h, w, ch)
    np.save(OUTDIR / name, arr)
    return {
        "file": name,
        "shape": [h, w, ch],
        "sha256": sha256_file(OUTDIR / name),
        "linearMin": [float(arr[..., c].min()) for c in range(min(ch, 3))],
        "linearMax": [float(arr[..., c].max()) for c in range(min(ch, 3))],
        "linearMean": [float(arr[..., c].mean()) for c in range(min(ch, 3))],
    }

result["linearDumps"] = {
    "faceD": dump_pixels(face_d_node, "face-d-linear.npy"),
    "state2Mask": dump_pixels(state2_node, "state2-mask-linear.npy"),
}

# 白光 Emission 参考渲染（Standard/曝光0/gamma1，隔离多灯与 AgX），三模式同口径
world = scene.world or bpy.data.worlds.new("W")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
wn.clear()
wout = wn.new("ShaderNodeOutputWorld")
wbg = wn.new("ShaderNodeBackground")
wbg.inputs["Color"].default_value = (1, 1, 1, 1)
wbg.inputs["Strength"].default_value = 1.0
wl.new(wbg.outputs["Background"], wout.inputs["Surface"])
for o in scene.objects:
    if o.type == "LIGHT":
        o.hide_render = True
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.color_depth = "8"
scene.render.film_transparent = False

bsdf = find_node(lambda n: n.bl_idname == "ShaderNodeBsdfPrincipled")
if bsdf is None:
    result["errors"].append("principled not found")
    bsdf_in = None
else:
    bsdf_in = bsdf.inputs["Base Color"]

def render_ref(out_socket, name):
    if bsdf_in is None:
        return None
    for l in list(bsdf_in.links):
        nt.links.remove(l)
    nt.links.new(out_socket, bsdf_in)
    scene.render.filepath = str(OUTDIR / name)
    bpy.ops.render.render(write_still=True)
    out = OUTDIR / name
    if not out.exists():
        return {"file": name, "error": "render output missing", "filepath": str(out)}
    return {"file": name, "sha256": sha256_file(out), "bytes": out.stat().st_size}

refs = {}
if face_d_node is not None:
    refs["normal"] = render_ref(face_d_node.outputs["Color"], "blender-ref-normal.png")
if final_node is not None:
    refs["finalFaceComposite"] = render_ref(final_node.outputs[0], "blender-ref-finalFaceComposite.png")
result["renderRefs"] = refs

(OUTDIR / "blender-uv-report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print("===UV-EXPORT-BEGIN===")
print(json.dumps(result, ensure_ascii=False, indent=2))
print("===UV-EXPORT-END===")
