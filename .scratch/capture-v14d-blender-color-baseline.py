from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import zlib
from collections import Counter, deque
from pathlib import Path

import bpy
import OpenImageIO as oiio
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


BLEND_PATH = Path(
    r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets"
    r"\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend"
)
VMD_PATH = Path(
    r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets"
    r"\koleda-v14d-authoritative-pose-f120.vmd"
)
VMD_IMPORT_PATH = Path(
    r"C:\w\v14d-gate-b\.scratch\koleda-assets"
    r"\koleda-v14d-authoritative-pose-f120.vmd"
)
OUT = Path(
    os.environ.get(
        "V14D_COLOR_BASELINE_OUT",
        r"C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture",
    )
)
OUT.mkdir(parents=True, exist_ok=True)

WIDTH = 1280
HEIGHT = 720
FRAME = 120
FPS = 30

AUTH_OBJECT = "GirlsFrontline KoledaDefault_mesh"
AUTH_ARMATURE = "GirlsFrontline KoledaDefault_arm"
LEGACY_OBJECT = "PROTO_RenderCharacter"
CAMERA_NAME = "PROTO_GameCamera"

ROI_MATERIALS = {
    "hair.front": "PROTO_GF2_HairA",
    "hair.back": "PROTO_GF2_HairB",
    "skin.face": "PROTO_V14D_GF2_Face",
    "clothes.chest": "PROTO_GF2_Cth1-Top",
    "clothes.leftSleeve": "PROTO_GF2_Cth1-Top",
}

BASE_EXR = OUT / "blender-white-light-frame120-base-color-scene-linear.exr"
LINEAR_EXR = OUT / "blender-white-light-frame120-linear-hdr-scene-linear.exr"
FINAL_PNG = OUT / "blender-white-light-frame120-final-display.png"
META_JSON = OUT / "blender-white-light-frame120-baseline.json"


def finite(value: object) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def rgba(value) -> list[float]:
    return [float(value[index]) for index in range(4)]


def vec3(value) -> list[float]:
    return [float(value[index]) for index in range(3)]


def set_socket_default(socket, value) -> None:
    if socket is not None and hasattr(socket, "default_value"):
        socket.default_value = value


def set_world_white(scene: bpy.types.Scene) -> None:
    world = scene.world or bpy.data.worlds.new("V14D_Baseline_WhiteWorld")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputWorld")
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    background.inputs["Strength"].default_value = 0.73
    links.new(background.outputs["Background"], output.inputs["Surface"])
    world.color = (1.0, 1.0, 1.0)


def hide_non_authoritative_meshes(scene: bpy.types.Scene) -> None:
    for obj in scene.objects:
        if obj.type != "MESH":
            continue
        obj.hide_render = obj.name != AUTH_OBJECT
        obj.hide_viewport = obj.name != AUTH_OBJECT
    if scene.objects.get(LEGACY_OBJECT):
        scene.objects[LEGACY_OBJECT].hide_render = True
        scene.objects[LEGACY_OBJECT].hide_viewport = True
    if scene.objects.get(AUTH_OBJECT):
        scene.objects[AUTH_OBJECT].hide_render = False
        scene.objects[AUTH_OBJECT].hide_viewport = False


def hide_existing_lights(scene: bpy.types.Scene) -> None:
    for obj in scene.objects:
        if obj.type == "LIGHT":
            obj.hide_render = True
            obj.hide_viewport = True


def select_vmd_root(root: bpy.types.Object) -> None:
    # 避免 bpy.ops.object.select_all 在 background 模式下触发依赖图重建，
    # 该重建会让后续 scene.objects.get("PROTO_GameCamera") 偶发返回 None。
    # 改为直接遍历清选，不经过 ops 上下文。
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    root.hide_viewport = False
    root.hide_render = False
    root.hide_set(False)
    root.select_set(True)
    bpy.context.view_layer.objects.active = root


def apply_authoritative_vmd(
    scene: bpy.types.Scene,
    root: bpy.types.Object,
    vmd_path: Path,
) -> dict:
    """
    在权威 Blend 的内存副本中导入已验证的 VMD，再固定到 frame 120。

    mmd_tools 会把导入帧叠加到当前 scene frame；从 0 导入、再跳到
    frame 120 与既有 roundtrip 探针保持同一语义。此脚本不保存源 Blend，
    也不改写外部 VMD。
    """
    if not vmd_path.is_file():
        raise RuntimeError(f"VMD 导入副本不存在: {vmd_path}")
    scene.frame_set(0)
    select_vmd_root(root)
    result = bpy.ops.mmd_tools.import_vmd(
        filepath=str(vmd_path),
        bone_mapper="PMX",
        scale=0.08,
        margin=0,
        create_new_action=True,
        use_pose_mode=False,
        update_scene_settings=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"VMD 导入失败: {result}")
    scene.frame_set(FRAME)
    bpy.context.view_layer.update()
    armature = bpy.data.objects.get(AUTH_ARMATURE)
    action = (
        armature.animation_data.action.name
        if armature and armature.animation_data and armature.animation_data.action
        else None
    )
    return {
        "status": "ok",
        "path": str(vmd_path),
        "scale": 0.08,
        "frame": FRAME,
        "operatorResult": sorted(result),
        "action": action,
    }


def set_camera(scene: bpy.types.Scene) -> dict:
    # scene.objects 在 background 模式下经过 depsgraph 更新后可能偶发剔除对象；
    # bpy.data.objects 是稳定的全局数据块集合，不受 view_layer 求值影响。
    camera = bpy.data.objects.get(CAMERA_NAME) or scene.objects.get(CAMERA_NAME)
    if camera is None or camera.type != "CAMERA":
        raise RuntimeError(f"找不到 Blender 相机 {CAMERA_NAME}")
    camera_y_sign = float(os.environ.get("V14D_CAMERA_Y_SIGN", "-1"))
    if camera_y_sign not in {-1.0, 1.0}:
        raise RuntimeError("V14D_CAMERA_Y_SIGN 只能是 -1 或 1")
    location = Vector((0.03, 1.02 * camera_y_sign, 1.335))
    target = Vector((0.030292384, 0.940000534 * camera_y_sign, 1.335))
    camera.location = location
    camera.rotation_mode = "XYZ"
    camera.rotation_euler = (target - location).to_track_quat("-Z", "Y").to_euler()
    # Web 的固定 camera.fov 按垂直 FOV 解释；在 1280x720 下换算为
    # 47.924977949° 水平 FOV，36mm sensor width 对应 40.5mm 镜头。
    camera.data.lens = 40.5
    camera.data.sensor_width = 36.0
    camera.data.shift_x = 0.0
    camera.data.shift_y = 0.0
    scene.camera = camera
    # Blender 的相机变换在脚本内设置后可能仍保留旧的 evaluated matrix；
    # 先刷新依赖图，再把 metadata 与实际渲染使用的 matrixWorld 对齐。
    bpy.context.view_layer.update()
    return {
        "name": camera.name,
        "location": vec3(camera.location),
        "target": vec3(target),
        "candidate": f"y-sign={int(camera_y_sign)}",
        "lensMm": float(camera.data.lens),
        "sensorWidthMm": float(camera.data.sensor_width),
        "rotationEuler": vec3(camera.rotation_euler),
        "matrixWorld": [[float(value) for value in row] for row in camera.matrix_world],
    }


def add_white_sun(scene: bpy.types.Scene) -> dict:
    """
    Web 的方向向量是光线行进方向。按既有轴映射：
      Blender x = Web x, Blender y = -Web z（相机前方为 -Y）, Blender z = Web y。
    这样保留方位/仰角语义，同时让相机前方受光。
    """
    azimuth = math.radians(10.0)
    elevation = math.radians(55.0)
    web_ray = Vector(
        (
            -math.cos(elevation) * math.sin(azimuth),
            -math.sin(elevation),
            -math.cos(elevation) * math.cos(azimuth),
        )
    )
    blender_ray = Vector((web_ray.x, -web_ray.z, web_ray.y)).normalized()
    light_data = bpy.data.lights.get("V14D_Baseline_WhiteSunData")
    if light_data is None:
        light_data = bpy.data.lights.new("V14D_Baseline_WhiteSunData", type="SUN")
    light_data.energy = 1.07
    light_data.color = (1.0, 1.0, 1.0)
    light_data.angle = 0.0
    light_obj = scene.objects.get("V14D_Baseline_WhiteSun")
    if light_obj is None:
        light_obj = bpy.data.objects.new("V14D_Baseline_WhiteSun", light_data)
        scene.collection.objects.link(light_obj)
    light_obj.data = light_data
    light_obj.hide_render = False
    light_obj.hide_viewport = False
    light_obj.rotation_mode = "XYZ"
    light_obj.rotation_euler = blender_ray.to_track_quat("-Z", "Y").to_euler()
    return {
        "name": light_obj.name,
        "type": light_data.type,
        "color": vec3(light_data.color),
        "energy": float(light_data.energy),
        "azimuth": 10.0,
        "elevation": 55.0,
        "webRayDirection": vec3(web_ray),
        "blenderRayDirection": vec3(blender_ray),
        "rotationEuler": vec3(light_obj.rotation_euler),
    }


def configure_render(scene: bpy.types.Scene) -> None:
    scene.frame_start = 1
    scene.frame_end = max(scene.frame_end, FRAME)
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.frame_set(FRAME)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.56
    scene.view_settings.gamma = 1.0
    for view_layer in scene.view_layers:
        view_layer.use_pass_combined = True
        view_layer.use_pass_material_index = True
        view_layer.use_pass_z = True


def find_principled(material: bpy.types.Material):
    if not material.use_nodes:
        return None
    return next(
        (node for node in material.node_tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"),
        None,
    )


def build_unlit_material_copy(material: bpy.types.Material) -> bpy.types.Material:
    copy = material.copy()
    copy.name = f"V14D_BASELINE_UNLIT::{material.name}"
    if not copy.use_nodes:
        copy.use_nodes = True
    nodes = copy.node_tree.nodes
    links = copy.node_tree.links
    output = next((node for node in nodes if node.bl_idname == "ShaderNodeOutputMaterial"), None)
    if output is None:
        output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.name = "V14D BaseColor Emission"
    emission.inputs["Strength"].default_value = 1.0

    # Stage 1 修复：BaseColor 参考必须是"纯纹理直接采样"，与 Web unlit 诊断图同口径。
    # 原实现接的是 Principled Base Color 的整条上游链，把 HairTint 乘色、
    # Cth1-Top 的 rmo*0.62+0.38 缩放、Face 的阴影混合全部算进了"纹理"参考，
    # 导致 Web 纯纹理值被系统性判为偏亮。这里改为直接追踪 Base Color 上游
    # 第一个 sRGB 图像纹理节点，只把该纹理颜色接入 emission。
    base_color = None
    principled = find_principled(copy)
    if principled is not None:
        base_color = principled.inputs.get("Base Color")

    def first_color_texture_socket(socket, depth: int = 0):
        """Depth-first 搜索 Base Color 上游第一个彩色图像纹理的 Color 输出。"""
        if socket is None or depth > 16:
            return None
        for link in socket.links:
            node = link.from_node
            if node.bl_idname == "ShaderNodeTexImage":
                image = getattr(node, "image", None)
                colorspace = (image.colorspace_settings.name if image else "") or ""
                # 只接受 sRGB 彩色纹理；Non-Color 的 rmo/mask 不属于 BaseColor 纹理。
                if image is not None and colorspace.lower() == "srgb":
                    return link.from_socket
            for child in node.inputs:
                found = first_color_texture_socket(child, depth + 1)
                if found is not None:
                    return found
        return None

    texture_socket = first_color_texture_socket(base_color)
    if texture_socket is not None:
        links.new(texture_socket, emission.inputs["Color"])
    elif base_color is not None and base_color.is_linked:
        links.new(base_color.links[0].from_socket, emission.inputs["Color"])
    elif base_color is not None:
        emission.inputs["Color"].default_value = base_color.default_value
    else:
        emission.inputs["Color"].default_value = material.diffuse_color

    for link in list(output.inputs["Surface"].links):
        links.remove(link)
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return copy


def swap_to_unlit_materials(obj: bpy.types.Object) -> list[tuple[bpy.types.MaterialSlot, bpy.types.Material]]:
    swaps = []
    for slot in obj.material_slots:
        original = slot.material
        if original is None:
            continue
        replacement = build_unlit_material_copy(original)
        slot.material = replacement
        swaps.append((slot, original))
    return swaps


def restore_materials(swaps: list[tuple[bpy.types.MaterialSlot, bpy.types.Material]]) -> None:
    for slot, original in swaps:
        slot.material = original


def read_exr_rgba(path: Path) -> tuple[list[float], list[str]]:
    image_input = oiio.ImageInput.open(str(path))
    if image_input is None:
        raise RuntimeError(f"无法读取 Blender EXR: {path}; {oiio.geterror()}")
    try:
        spec = image_input.spec()
        if (spec.width, spec.height) != (WIDTH, HEIGHT):
            raise RuntimeError(f"EXR 尺寸异常: {spec.width}x{spec.height}")
        if spec.nchannels < 4:
            raise RuntimeError(f"EXR 通道数不足: {spec.nchannels}; channels={list(spec.channelnames)}")
        pixels = image_input.read_image(oiio.FLOAT)
        if pixels is None:
            raise RuntimeError(f"无法读取 EXR 像素: {path}; {image_input.geterror()}")
        array = np.asarray(pixels, dtype=np.float32)
        if array.ndim != 3 or array.shape[2] < 4:
            raise RuntimeError(f"EXR 像素形状异常: {array.shape}")
        return array[:, :, :4].reshape(-1).tolist(), list(spec.channelnames)
    finally:
        image_input.close()


def render_to(path: Path, *, exr: bool) -> tuple[list[float], list[str]]:
    scene = bpy.context.scene
    scene.render.filepath = str(path)
    if exr:
        # Blender 5.1 移除了 OPEN_EXR_MULTILAYER 枚举；OPEN_EXR 仍会按
        # 当前渲染结果写出 Combined EXR。pass mask 由下方的材质 ID/深度
        # 光栅化生成，避免依赖 Blender 5.1 已移除的 Render Result.layers。
        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_depth = "32"
        scene.render.image_settings.exr_codec = "ZIP"
        scene.render.image_settings.color_management = "FOLLOW_SCENE"
    else:
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_depth = "8"
        scene.render.image_settings.color_management = "FOLLOW_SCENE"
    bpy.ops.render.render(write_still=True)
    if not path.exists():
        raise RuntimeError(f"Blender 没有生成输出文件: {path}")
    if exr:
        return read_exr_rgba(path)
    width, height, pixels = decode_png_rgba8(path)
    if (width, height) != (WIDTH, HEIGHT):
        raise RuntimeError(f"PNG 尺寸异常: {width}x{height}")
    return pixels, ["R", "G", "B", "A"]


def decode_png_rgba8(path: Path) -> tuple[int, int, list[float]]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"不是 PNG: {path}")
    offset = 8
    width = height = bit_depth = color_type = None
    idat = bytearray()
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk = data[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if bit_depth != 8 or color_type != 6 or compression != 0 or filter_method != 0 or interlace != 0:
                raise RuntimeError("只支持 Blender 输出的 8-bit RGBA 非交错 PNG")
        elif chunk_type == b"IDAT":
            idat.extend(chunk)
        elif chunk_type == b"IEND":
            break
    if width is None or height is None:
        raise RuntimeError(f"PNG 缺少 IHDR: {path}")
    raw = zlib.decompress(bytes(idat))
    stride = width * 4
    rows: list[bytearray] = []
    cursor = 0
    previous = bytearray(stride)
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        current = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        for index in range(stride):
            left = current[index - 4] if index >= 4 else 0
            up = previous[index]
            up_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                current[index] = (current[index] + left) & 0xFF
            elif filter_type == 2:
                current[index] = (current[index] + up) & 0xFF
            elif filter_type == 3:
                current[index] = (current[index] + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                estimate = left + up - up_left
                pa = abs(estimate - left)
                pb = abs(estimate - up)
                pc = abs(estimate - up_left)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else up_left
                current[index] = (current[index] + predictor) & 0xFF
            elif filter_type != 0:
                raise RuntimeError(f"PNG 使用了不支持的 filter type {filter_type}")
        rows.append(current)
        previous = current
    pixels = []
    for row in rows:
        for index in range(0, stride, 4):
            pixels.extend(channel / 255.0 for channel in row[index : index + 4])
    return width, height, pixels


def material_slot_indices(obj: bpy.types.Object) -> dict[str, int]:
    return {
        slot.material.name: index
        for index, slot in enumerate(obj.material_slots)
        if slot.material is not None
    }


def rasterize_material_masks(
    scene: bpy.types.Scene,
    obj: bpy.types.Object,
    camera: bpy.types.Object,
    target_slots: set[int],
) -> tuple[dict[int, list[bool]], dict[str, int], dict[str, object]]:
    """
    Blender 5.1 不再提供旧版 Render Result.layers/IndexMA 读取接口。
    这里对 frame 120 的评估后网格做材质槽 ID + 可见深度 z-buffer 光栅化：
    - 材质 ID 来自 evaluated mesh polygon.material_index；
    - 深度来自 world_to_camera_view 的相机空间深度；
    - 每个像素只保留最近三角形，因此背景不会因白色近似进入 ROI。
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated_obj = obj.evaluated_get(depsgraph)
    mesh = evaluated_obj.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    try:
        mesh.calc_loop_triangles()
        masks = {slot: [False] * (WIDTH * HEIGHT) for slot in target_slots}
        z_buffer = [float("inf")] * (WIDTH * HEIGHT)
        material_buffer = [-1] * (WIDTH * HEIGHT)
        counts: Counter[str] = Counter()
        triangle_count = 0
        rasterized_triangle_count = 0

        projected: list[tuple[float, float, float] | None] = []
        for vertex in mesh.vertices:
            world = evaluated_obj.matrix_world @ vertex.co
            ndc = world_to_camera_view(scene, camera, world)
            if not all(finite(value) for value in ndc):
                projected.append(None)
                continue
            projected.append((float(ndc.x * WIDTH), float((1.0 - ndc.y) * HEIGHT), float(ndc.z)))

        for triangle in mesh.loop_triangles:
            triangle_count += 1
            vertices = [projected[index] for index in triangle.vertices]
            if any(vertex is None for vertex in vertices):
                continue
            x0, y0, z0 = vertices[0]  # type: ignore[misc]
            x1, y1, z1 = vertices[1]  # type: ignore[misc]
            x2, y2, z2 = vertices[2]  # type: ignore[misc]
            if z0 <= 0.0 and z1 <= 0.0 and z2 <= 0.0:
                continue
            area = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(area) <= 1e-8:
                continue
            polygon = mesh.polygons[triangle.polygon_index]
            slot_index = int(polygon.material_index)
            min_x = max(0, int(math.floor(min(x0, x1, x2))))
            max_x = min(WIDTH - 1, int(math.ceil(max(x0, x1, x2)) - 1))
            min_y = max(0, int(math.floor(min(y0, y1, y2))))
            max_y = min(HEIGHT - 1, int(math.ceil(max(y0, y1, y2)) - 1))
            if min_x > max_x or min_y > max_y:
                continue
            rasterized_triangle_count += 1
            for y in range(min_y, max_y + 1):
                py = y + 0.5
                for x in range(min_x, max_x + 1):
                    px = x + 0.5
                    weight0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / area
                    weight1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / area
                    weight2 = 1.0 - weight0 - weight1
                    if weight0 < -1e-7 or weight1 < -1e-7 or weight2 < -1e-7:
                        continue
                    depth = weight0 * z0 + weight1 * z1 + weight2 * z2
                    if not finite(depth) or depth <= 0.0:
                        continue
                    pixel = y * WIDTH + x
                    if depth >= z_buffer[pixel]:
                        continue
                    z_buffer[pixel] = depth
                    material_buffer[pixel] = slot_index

        for pixel, slot_index in enumerate(material_buffer):
            if slot_index < 0:
                continue
            counts[str(slot_index)] += 1
            if slot_index in masks:
                masks[slot_index][pixel] = True
        return masks, dict(counts.most_common(32)), {
            "triangleCount": triangle_count,
            "rasterizedTriangleCount": rasterized_triangle_count,
            "visiblePixelCount": sum(1 for slot in material_buffer if slot >= 0),
            "cameraDepthRule": "每像素保留 evaluated mesh 三角形中相机空间 z 最小且大于 0 的材质槽。",
        }
    finally:
        evaluated_obj.to_mesh_clear()


def connected_components(mask: list[bool]) -> list[dict]:
    visited = bytearray(WIDTH * HEIGHT)
    components = []
    for start in range(WIDTH * HEIGHT):
        if not mask[start] or visited[start]:
            continue
        visited[start] = 1
        queue = deque([start])
        count = 0
        min_x = WIDTH
        min_y = HEIGHT
        max_x = -1
        max_y = -1
        while queue:
            pixel = queue.popleft()
            x = pixel % WIDTH
            y = pixel // WIDTH
            count += 1
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or nx >= WIDTH or ny < 0 or ny >= HEIGHT:
                    continue
                neighbor = ny * WIDTH + nx
                if mask[neighbor] and not visited[neighbor]:
                    visited[neighbor] = 1
                    queue.append(neighbor)
        components.append(
            {
                "pixelCount": count,
                "pixelBounds": [min_x, min_y, max_x, max_y],
                "normalizedBounds": [
                    min_x / WIDTH,
                    min_y / HEIGHT,
                    (max_x - min_x + 1) / WIDTH,
                    (max_y - min_y + 1) / HEIGHT,
                ],
            }
        )
    return sorted(components, key=lambda item: item["pixelCount"], reverse=True)


def save_mask_png(path: Path, mask: list[bool]) -> None:
    pixels = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    values = np.asarray(mask, dtype=np.uint8).reshape(HEIGHT, WIDTH) * 255
    pixels[:, :, 0] = values
    pixels[:, :, 1] = values
    pixels[:, :, 2] = values
    pixels[:, :, 3] = 255
    spec = oiio.ImageSpec(WIDTH, HEIGHT, 4, oiio.UINT8)
    output = oiio.ImageOutput.create(str(path))
    if output is None:
        raise RuntimeError(f"无法创建 mask PNG 输出: {path}; {oiio.geterror()}")
    try:
        if not output.open(str(path), spec):
            raise RuntimeError(f"无法打开 mask PNG 输出: {path}; {output.geterror()}")
        if not output.write_image(pixels):
            raise RuntimeError(f"无法写入 mask PNG 输出: {path}; {output.geterror()}")
    finally:
        output.close()


def mean_for_mask(pixels: list[float], mask: list[bool]) -> dict:
    sums = [0.0, 0.0, 0.0]
    valid = 0
    for index, enabled in enumerate(mask):
        if not enabled:
            continue
        offset = index * 4
        values = pixels[offset : offset + 3]
        if not all(finite(value) for value in values):
            continue
        sums[0] += values[0]
        sums[1] += values[1]
        sums[2] += values[2]
        valid += 1
    return {
        "sampleCount": sum(mask),
        "validSampleCount": valid,
        "validRate": valid / sum(mask) if sum(mask) else 0.0,
        "mean": [value / valid for value in sums] if valid else None,
    }


def mean_display_for_mask(pixels: list[float], mask: list[bool]) -> dict:
    return mean_for_mask(pixels, mask)


def main() -> None:
    scene = bpy.context.scene
    configure_render(scene)
    # 在任何 hide/VMD 导入前设置相机：background 模式下 hide_render/hide_viewport
    # 与 view_layer pass 组合会偶发触发 depsgraph 重建，导致 scene.objects 暂时
    # 取不到 PROTO_GameCamera。先在干净状态下锁定相机与 scene.camera 引用。
    camera_meta = set_camera(scene)
    set_world_white(scene)
    hide_non_authoritative_meshes(scene)
    hide_existing_lights(scene)
    sun_meta = add_white_sun(scene)
    obj = scene.objects.get(AUTH_OBJECT)
    if obj is None or obj.type != "MESH":
        raise RuntimeError(f"找不到权威对象 {AUTH_OBJECT}")
    armature = scene.objects.get(AUTH_ARMATURE)
    root = scene.objects.get("GirlsFrontline KoledaDefault")
    if root is None:
        raise RuntimeError("找不到 PMX ROOT GirlsFrontline KoledaDefault")
    vmd_meta = apply_authoritative_vmd(scene, root, VMD_IMPORT_PATH)

    material_slots = material_slot_indices(obj)
    missing = sorted(set(ROI_MATERIALS.values()) - set(material_slots))
    if missing:
        raise RuntimeError(f"权威对象缺少 ROI 材质: {missing}")

    original_materials = [slot.material for slot in obj.material_slots]
    unlit_swaps = swap_to_unlit_materials(obj)
    try:
        base_pixels, base_pass_names = render_to(BASE_EXR, exr=True)
    finally:
        restore_materials(unlit_swaps)
        for slot, original in zip(obj.material_slots, original_materials):
            slot.material = original
    linear_pixels, linear_pass_names = render_to(LINEAR_EXR, exr=True)
    display_pixels, display_pass_names = render_to(FINAL_PNG, exr=False)

    target_slots = {material_slots[material_name] for material_name in ROI_MATERIALS.values()}
    material_masks, material_histogram, mask_meta = rasterize_material_masks(
        scene,
        obj,
        scene.camera,
        target_slots,
    )

    rois = {}
    for roi_id, material_name in ROI_MATERIALS.items():
        slot_index = material_slots[material_name]
        mask = material_masks[slot_index]
        mask_count = sum(mask)
        mask_path = OUT / f"blender-white-light-frame120-mask-{roi_id.replace('.', '-')}.png"
        save_mask_png(mask_path, mask)
        rois[roi_id] = {
            "material": material_name,
            "materialSlotIndex": slot_index,
            "maskPixelCount": mask_count,
            "observedMaterialIndexHistogram": material_histogram,
            "maskSource": {
                "materialId": "evaluated mesh polygon.material_index",
                "depth": "software z-buffer from evaluated mesh triangles",
                "backgroundExcluded": True,
            },
            "components": connected_components(mask)[:12],
            "maskPath": str(mask_path),
            "baseColor": mean_for_mask(base_pixels, mask),
            "linearHdr": mean_for_mask(linear_pixels, mask),
            "finalDisplay": mean_display_for_mask(display_pixels, mask),
        }

    object_bounds = [float(value) for value in obj.bound_box[0]]
    for vertex in obj.bound_box[1:]:
        object_bounds.extend(float(value) for value in vertex)

    metadata = {
        "schemaVersion": "v14d-blender-color-baseline.v1",
        "blenderVersion": bpy.app.version_string,
        "blendPath": str(BLEND_PATH),
        "blendSha256": hashlib.sha256(BLEND_PATH.read_bytes()).hexdigest()
        if BLEND_PATH.exists()
        else None,
        "authoritativeAssets": {
            "blend": str(BLEND_PATH),
            "pmx": r"D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx",
            "vmd": str(VMD_PATH),
            "vmdExists": VMD_PATH.exists(),
        },
        "fixedInput": {
            "width": WIDTH,
            "height": HEIGHT,
            "fps": FPS,
            "frame": FRAME,
            "seconds": FRAME / FPS,
            "renderLoop": "Blender headless single frame",
        },
        "objects": {
            "authoritativeMesh": AUTH_OBJECT,
            "authoritativeMeshVisible": not obj.hide_render,
            "legacyMeshExcluded": bool(scene.objects.get(LEGACY_OBJECT) and scene.objects[LEGACY_OBJECT].hide_render),
            "authoritativeArmature": AUTH_ARMATURE,
            "authoritativeArmatureVisible": bool(armature and not armature.hide_render),
            "authoritativeMeshMaterialSlots": material_slots,
            "authoritativeMeshBoundingBox": object_bounds,
        },
        "pose": {
            "frameCurrent": scene.frame_current,
            "armatureAction": armature.animation_data.action.name
            if armature and armature.animation_data and armature.animation_data.action
            else None,
            "vmdPath": str(VMD_PATH),
            "vmdExists": VMD_PATH.exists(),
            "vmdImportPath": str(VMD_IMPORT_PATH),
            "vmdImportExists": VMD_IMPORT_PATH.exists(),
            "vmdImport": vmd_meta,
            "note": "仅在 Blender 后台进程内存副本导入已验证的 VMD；不保存权威 Blend，不修改骨骼、权重、Morph、VMD 或 Physics。",
        },
        "whiteLightScene": {
            "sunColor": "#ffffff",
            "worldColor": "#ffffff",
            "backgroundColor": "#ffffff",
            "groundColor": "#ffffff",
            "sunAzimuth": 10.0,
            "sunElevation": 55.0,
            "keyIntensity": 1.07,
            "ambientIntensity": 0.73,
            "sun": sun_meta,
            "worldStrength": 0.73,
            "ground": "未保留原舞台地面；World 为白色，背景不参与 ROI 材质 mask。",
        },
        "camera": camera_meta,
        "colorManagement": {
            "viewTransform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": float(scene.view_settings.exposure),
            "gamma": float(scene.view_settings.gamma),
            "finalDisplay": str(FINAL_PNG),
            "linearBaseColor": str(BASE_EXR),
            "linearHdr": str(LINEAR_EXR),
        },
        "renderPasses": {
            "baseColor": base_pass_names,
            "linearHdr": linear_pass_names,
            "finalDisplay": display_pass_names,
            "materialIndexSource": "evaluated mesh polygon.material_index",
            "depthSource": "software z-buffer from evaluated mesh triangles",
            "maskMeta": mask_meta,
        },
        "rois": rois,
        "outputs": {
            "baseColorSceneLinearExr": str(BASE_EXR),
            "linearHdrSceneLinearExr": str(LINEAR_EXR),
            "finalDisplayPng": str(FINAL_PNG),
            "metadata": str(META_JSON),
        },
    }
    META_JSON.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
