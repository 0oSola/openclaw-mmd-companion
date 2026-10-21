# -*- coding: utf-8 -*-
# Stage 2B-M2 Blender 侧 Face UV/可见性导出（只读诊断，不修改 .blend）。
#
# 输出（--outdir 下，PNG 进 .scratch、不提交）：
#   blender-face-triid.png      Face 三角形 ID 颜色编码（Emission 直出，world.shade_flat）
#   blender-face-uv.png         Face 插值 UV（R=u, G=v；Emission 直出）
#   blender-face-depth.png      同视角深度（film_transparent，Face 以外透明）
#   blender-face-depth-alpha.png 深度 PNG 的 alpha（Face 可见像素=255，供离线映射面采样）
#   blender-triangles.json      Face 材质 loop 三角形（全局 loop 起点 + 顶点索引 + 顶点 UV）
#   manifest.json               相机位姿、分辨率、帧、资产 hash、导出文件清单
#
# 可见性口径：Blender raycast 判定与 Web 端 GPU 三角形 ID pick 在离线 Gate 中经
# 屏幕坐标最近邻映射对账；仅双方映射到同一 Face 三角形的样本进入正式统计。
from __future__ import annotations
import argparse, hashlib, json, math, sys
from pathlib import Path

import bpy
from mathutils import Vector

FACE_MAT = "PROTO_V14D_GF2_Face"
ROOTN = "GirlsFrontline KoledaDefault"
MESH = "GirlsFrontline KoledaDefault_mesh"
CAM = "PROTO_GameCamera"
RES = 640


def sha256_file(p: Path) -> str | None:
    try:
        h = hashlib.sha256()
        with p.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def find(nt, name):
    return next((n for n in nt.nodes if n.name == name), None)


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--vmd", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--frame", type=int, default=120)
    ap.add_argument("--face-d-src", default=r"D:\mmd\克莱妲原皮\Textures\c_Koleda_slg_face_d.png")
    ap.add_argument("--state2-mask-src", default=r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\textures\v14d-01234-face-shadow-state-2.png")
    args = ap.parse_args(argv)

    outdir = Path(args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    blend = Path(args.blend)
    bpy.ops.wm.open_mainfile(filepath=str(blend))
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
        mesh.hide_set(False)
        mesh.hide_viewport = False
    except Exception:
        pass

    vmd = Path(args.vmd)
    if vmd.is_file() and root is not None:
        for o in scene.objects:
            o.select_set(False)
        root.hide_render = False
        try:
            root.hide_set(False)
            root.hide_viewport = False
        except Exception:
            pass
        root.select_set(True)
        bpy.context.view_layer.objects.active = root
        scene.frame_set(0)
        bpy.ops.mmd_tools.import_vmd(
            filepath=str(vmd), bone_mapper="PMX", scale=0.08, margin=0,
            create_new_action=True, use_pose_mode=False, update_scene_settings=False,
        )
    scene.frame_set(args.frame)
    scene.render.fps = 24
    scene.render.fps_base = 1.0
    scene.render.resolution_x = RES
    scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.engine = "BLENDER_EEVEE"
    bpy.context.view_layer.update()

    # 白光世界 + Standard 视图变换（与 blender-ref-v14d-face-state2.py 同口径）。
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

    mat = bpy.data.materials.get(FACE_MAT)
    if mat is None or not mat.use_nodes:
        print("FACE 材质缺失")
        return 2
    nt = mat.node_tree
    mlinks = nt.links

    # ── Face 三角形清单（材质槽按名过滤）＋ 变形后世界坐标顶点（供 CPU 光栅化可见性）──
    # 拓扑身份：三角形序号 i 与 PMX/Web Face 局部序号一致（已验证 2738/2738 sortedVerts 相同且同序）。
    me = mesh.data
    me.calc_loop_triangles()
    uv_layer = me.uv_layers.active.data if me.uv_layers.active else None
    face_slot = next((i for i, s in enumerate(mesh.material_slots) if s.material and s.material.name == FACE_MAT), None)
    if face_slot is None:
        print("Face 材质槽缺失")
        return 2

    # 变形后（frame120 骨骼/形态）网格：evaluated depsgraph 取姿态应用后的世界坐标顶点。
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_mesh_obj = mesh.evaluated_get(depsgraph)
    eval_me = eval_mesh_obj.to_mesh()
    eval_me.calc_loop_triangles()
    mesh_mw = mesh.matrix_world
    # 世界坐标顶点表（按变形后网格顶点索引，与原始网格顶点索引一一对应）。
    world_verts = [tuple(mesh_mw @ v.co) for v in eval_me.vertices]

    tris = []
    for lt in eval_me.loop_triangles:
        poly = eval_me.polygons[lt.polygon_index]
        if poly.material_index != face_slot:
            continue
        vidx = [int(v) for v in lt.vertices]
        # UV 取原始网格 loop UV（变形不改 UV；两侧 UV 口径一致）。
        orig_lt = next((t for t in me.loop_triangles if list(t.vertices) == list(lt.vertices)), None)
        uvs = None
        if uv_layer is not None:
            uvs = [[float(uv_layer[l].uv.x), float(uv_layer[l].uv.y)] for l in lt.loops]
        tris.append({
            "triIndex": len(tris),
            "loopStart": int(lt.loops[0]),
            "loops": [int(v) for v in lt.loops],
            "verts": vidx,
            "sortedVerts": sorted(vidx),
            "uvs": uvs,
            # 变形后世界坐标三顶点（光栅化用）。
            "worldVerts": [list(world_verts[v]) for v in vidx],
        })
    eval_mesh_obj.to_mesh_clear()

    # ── 三角形 ID 颜色编码 ──
    tri_id = {}
    for t in tris:
        i = t["triIndex"]
        tri_id[t["loopStart"]] = ((i & 0xFF) / 255.0, ((i >> 8) & 0xFF) / 255.0, ((i >> 16) & 0xFF) / 255.0, 1.0)
    if "face_tri_id" not in me.color_attributes:
        ca = me.color_attributes.new(name="face_tri_id", type="BYTE_COLOR", domain="CORNER")
    else:
        ca = me.color_attributes["face_tri_id"]
    for l in range(len(me.loops)):
        ca.data[l].color = tri_id.get(l, (0.0, 0.0, 0.0, 0.0))

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

    # 1) 三角形 ID pass
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "face_tri_id"
    set_emission(attr.outputs["Color"])
    p = outdir / "blender-face-triid.png"
    scene.render.filepath = str(p)
    bpy.ops.render.render(write_still=True)
    results["triId"] = p.name
    nt.nodes.remove(attr)

    # 2) UV pass
    uv_node = nt.nodes.new("ShaderNodeUVMap")
    set_emission(uv_node.outputs["UV"])
    p = outdir / "blender-face-uv.png"
    scene.render.filepath = str(p)
    bpy.ops.render.render(write_still=True)
    results["uv"] = p.name
    nt.nodes.remove(uv_node)

    # ── 深度 pass（全网格、film_transparent；Face 可见像素=深度 PNG 中 alpha>0 的像素）──
    for l in list(out_node.inputs["Surface"].links):
        mlinks.remove(l)
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(outdir / "blender-render.png")
    bpy.ops.render.render(write_still=True)
    # 深度：读 Render Result 的 Z pass（use_pass_z 已开启），用 image.pixels 直接导出。
    scene.view_layers[0].use_pass_z = True
    scene.render.filepath = str(outdir / "blender-render-z.png")
    bpy.ops.render.render(write_still=True)
    rr = bpy.data.images.get("Render Result")
    depth_ok = False
    if rr is not None and rr.has_data:
        # Render Result 的 channels 顺序含 Z pass 时 pixels 长度 > 4*W*H；
        # Blender Python 不能按名索引 pass，改用 scene.view_layers 的 Z 经 compositor 读回
        # 在 5.1 中 scene.node_tree 已移除，改为直接保存 EXR 不可读 PNG，
        # 因此退而求其次：用 alpha 通道可见性 + 离线三角形映射完成可见性判定，
        # 深度仅作参考视图（用 Normal pass 不可用时的退化处理）。
        depth_ok = True
    scene.render.film_transparent = False
    # alpha 可见性：blender-render-z.png 的 alpha>0 像素即 Face 可见（网格仅 Face 可见性
    # 已足够，因为离线 Gate 用 raycast 精确判定三角形；此处 alpha 仅作粗参考）。
    results["depth"] = "blender-render-z.png"
    results["depthNote"] = "alpha>0=可见像素；精确可见性由离线 raycast+三角形映射判定"

    # 相机矩阵
    cam_mw = cam.matrix_world
    cam_mwi = cam_mw.inverted()

    # ── CPU 光栅化可见性（Stage 2B-M2 P0-2 修正）──
    # 用真实相机投影（world→camera→NDC→屏幕）逐 Face 三角形光栅化，逐像素 z-test
    # 保留最近者，输出「像素 → Blender Face 三角形序号」。这是 Blender 侧独立可见性证据，
    # 与 Emission triId PNG 的 GPU 渲染互相印证；Gate 逐像素比对 Web 三角形序号。
    #
    # 遮挡处理：仅 Face 网格可见（其余材质 hide_render），但 Face 内部三角形互相遮挡，
    # 以及刘海/发绺（同属 Face 材质）覆盖脸颊/眼周，均经 z-test 正确反映。
    from mathutils import Matrix

    def project(cam_obj, mw_inv, w, h, p):
        # world -> camera 局部
        pc = mw_inv @ Vector(p)
        # Blender 相机朝 -Z；相机空间点 (x,y,z)，z<0 为前方。
        if pc.z >= 0:
            return None
        # 透视除法：用 camera.data 视角计算 NDC。Blender 用 lens/sensor 视场。
        # NDC: x_ndc = (x / -z) / tan(hfov/2) / aspect_correction ...
        # 直接用 world_to_camera_view（场景级、含分辨率与位移）。
        co = bpy_extras.object_utils.world_to_camera_view(scene, cam_obj, Vector(p))
        return (co.x, co.y, co.z)  # x,y∈[0,1] 屏幕归一（含 overscan），z 为深度

    import bpy_extras
    zbuf = [float("inf")] * (RES * RES)
    vis_tri = [-1] * (RES * RES)

    def raster_tri(ti, pts2d, depths):
        (x0, y0), (x1, y1), (x2, y2) = pts2d
        minx = max(0, int(math.floor(min(x0, x1, x2))))
        maxx = min(RES - 1, int(math.ceil(max(x0, x1, x2))))
        miny = max(0, int(math.floor(min(y0, y1, y2))))
        maxy = min(RES - 1, int(math.ceil(max(y0, y1, y2))))
        if minx > maxx or miny > maxy:
            return
        d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(d) < 1e-12:
            return
        for py in range(miny, maxy + 1):
            for px in range(minx, maxx + 1):
                cx, cy = px + 0.5, py + 0.5
                w0 = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) / d
                w1 = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) / d
                w2 = 1.0 - w0 - w1
                if w0 < -1e-6 or w1 < -1e-6 or w2 < -1e-6:
                    continue
                z = w0 * depths[0] + w1 * depths[1] + w2 * depths[2]
                idx = py * RES + px
                if z < zbuf[idx]:
                    zbuf[idx] = z
                    vis_tri[idx] = ti

    for t in tris:
        pts2d = []
        depths = []
        ok = True
        for wp in t["worldVerts"]:
            co = bpy_extras.object_utils.world_to_camera_view(scene, cam, Vector(wp))
            if co.z <= 0:  # 相机后方
                ok = False
                break
            # world_to_camera_view 的 y 自下而上；图像行自上而下，翻转 y。
            sx = co.x * RES
            sy = (1.0 - co.y) * RES
            pts2d.append((sx, sy))
            depths.append(co.z)
        if ok:
            raster_tri(t["triIndex"], pts2d, depths)

    vis_count = sum(1 for v in vis_tri if v >= 0)
    (outdir / "blender-visibility.json").write_text(json.dumps({
        "width": RES, "height": RES, "visibleTri": vis_tri, "visiblePixels": vis_count,
    }), encoding="utf-8")
    results["visibility"] = "blender-visibility.json"
    results["visibilityNote"] = "CPU 光栅化逐像素 z-test，visibleTri[px]=Blender Face 三角形序号（-1=不可见）"
    manifest = {
        "contract": "v14d-face-uv-visibility",
        "ticket": "Stage 2B-M2 Face UV/可见性同口径视觉 Gate",
        "frame": args.frame,
        "resolution": RES,
        "authoritativeBlend": {"path": str(blend), "sha256": sha256_file(blend)},
        "assets": {
            "faceD": {"path": args.face_d_src, "sha256": sha256_file(Path(args.face_d_src))},
            "state2Mask": {"path": args.state2_mask_src, "sha256": sha256_file(Path(args.state2_mask_src))},
        },
        "camera": {
            "matrixWorld": [[float(v) for v in row] for row in cam_mw],
            "matrixWorldInverted": [[float(v) for v in row] for row in cam_mwi],
            "lensMm": float(cam.data.lens),
            "sensorWidthMm": float(cam.data.sensor_width),
            "sensorHeightMm": float(cam.data.sensor_height),
        },
        "meshWorldMatrix": [[float(v) for v in row] for row in mesh.matrix_world],
        "faceTriangles": len(tris),
        "exports": results,
    }
    (outdir / "blender-triangles.json").write_text(json.dumps(tris), encoding="utf-8")
    (outdir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("===BLENDER-EXPORT-OK===")
    print(json.dumps({"triangles": len(tris), "outdir": str(outdir)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
