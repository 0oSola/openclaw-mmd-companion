from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import bpy


WORKTREE = Path(r"C:\w\v14d-mat-verify")
BLEND_PATH = Path(
    r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets"
    r"\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend"
)
PMX_PATH = Path(r"D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx")
OUT_PATH = WORKTREE / ".scratch" / "blender_headless_audit.json"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pmx_audit import Reader, parse_pmx  # noqa: E402


def finite(value: float) -> bool:
    return math.isfinite(float(value))


def vec(value: Any) -> list[float]:
    return [float(value[i]) for i in range(len(value))]


def sha_json(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def sha_float_rows(rows: list[Any], digits: int = 8) -> str:
    def normalize(item: Any) -> Any:
        if isinstance(item, float):
            return round(item, digits)
        if isinstance(item, list):
            return [normalize(child) for child in item]
        if isinstance(item, tuple):
            return [normalize(child) for child in item]
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        return item

    return sha_json(normalize(rows))


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def image_info(image: bpy.types.Image | None) -> dict[str, Any] | None:
    if image is None:
        return None
    return {
        "name": image.name,
        "source": image.source,
        "size": list(image.size),
        "has_data": bool(image.has_data),
        "packed": bool(image.packed_file),
        "filepath_raw": image.filepath_raw,
        "colorspace": getattr(image.colorspace_settings, "name", None),
        "alpha_mode": getattr(image, "alpha_mode", None),
    }


def socket_default(socket: bpy.types.NodeSocket) -> Any:
    value = socket.default_value
    if hasattr(value, "__len__") and not isinstance(value, str):
        try:
            return [float(item) for item in value]
        except Exception:
            return str(value)
    if isinstance(value, (int, float, bool)):
        return value
    return str(value)


def material_info(material: bpy.types.Material, index: int, face_count: int, face_start: int) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    links: list[dict[str, str]] = []
    if material.use_nodes and material.node_tree:
        for node in material.node_tree.nodes:
            item: dict[str, Any] = {
                "name": node.name,
                "type": node.type,
                "label": node.label,
            }
            if node.type == "TEX_IMAGE":
                item["image"] = image_info(node.image)
            if node.type in {"BSDF_PRINCIPLED", "VALTORGB", "MIX_RGB", "MATH", "MAP_RANGE", "NORMAL_MAP", "TANGENT"}:
                item["inputs"] = {
                    socket.name: socket_default(socket)
                    for socket in node.inputs
                    if not socket.is_linked
                }
            nodes.append(item)
        for link in material.node_tree.links:
            links.append(
                {
                    "from_node": link.from_node.name,
                    "from_socket": link.from_socket.name,
                    "to_node": link.to_node.name,
                    "to_socket": link.to_socket.name,
                }
            )
    return {
        "index": index,
        "name": material.name,
        "face_count": face_count,
        "face_start": face_start,
        "face_end": face_start + face_count - 1,
        "use_nodes": bool(material.use_nodes),
        "blend_method": getattr(material.surface_render_method, "name", getattr(material, "blend_method", None)),
        "nodes": nodes,
        "links": links,
    }


def read_pmx_geometry(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    reader = Reader(raw)
    if reader.take(4) != b"PMX ":
        raise ValueError(f"not a PMX file: {path}")
    reader.f32()
    header_size = reader.u8()
    globals_ = list(reader.take(header_size))
    encoding, add_uv_count, vi, ti, mi, bi, moi, ri = globals_[:8]
    for _ in range(4):
        reader.text(encoding)
    vertex_count = reader.i32()
    positions: list[list[float]] = []
    normals: list[list[float]] = []
    uvs: list[list[float]] = []
    weights: list[dict[str, Any]] = []
    edge_scales: list[float] = []
    for _ in range(vertex_count):
        positions.append(reader.vec3())
        normals.append(reader.vec3())
        uvs.append(reader.vec2())
        for _ in range(add_uv_count):
            reader.vec4()
        weight_type = reader.u8()
        weight: dict[str, Any] = {"type": weight_type}
        if weight_type == 0:
            weight["bones"] = [reader.index(bi)]
        elif weight_type == 1:
            weight["bones"] = [reader.index(bi), reader.index(bi)]
            weight["weights"] = [reader.f32(), 0.0]
        elif weight_type == 2:
            weight["bones"] = [reader.index(bi) for _ in range(4)]
            weight["weights"] = [reader.f32() for _ in range(4)]
        elif weight_type == 3:
            weight["bones"] = [reader.index(bi), reader.index(bi)]
            weight["weights"] = [reader.f32(), 0.0]
            weight["c"] = reader.vec3()
            weight["r0"] = reader.vec3()
            weight["r1"] = reader.vec3()
        elif weight_type == 4:
            weight["bones"] = [reader.index(bi) for _ in range(4)]
            weight["weights"] = [reader.f32() for _ in range(4)]
        else:
            raise ValueError(f"unsupported PMX weight type {weight_type}")
        edge_scales.append(reader.f32())
        weights.append(weight)
    face_index_count = reader.i32()
    face_indices = [reader.index(vi, signed=False) for _ in range(face_index_count)]
    texture_count = reader.i32()
    textures = [reader.text(encoding) for _ in range(texture_count)]
    material_count = reader.i32()
    materials = []
    for index in range(material_count):
        name = reader.text(encoding)
        reader.text(encoding)
        reader.vec4()
        reader.vec3()
        reader.f32()
        reader.vec3()
        reader.u8()
        reader.vec4()
        reader.f32()
        texture_index = reader.index(ti)
        sphere_index = reader.index(ti)
        reader.u8()
        toon_flag = reader.u8()
        toon_index = reader.index(ti) if toon_flag == 0 else reader.u8()
        reader.text(encoding)
        face_vertex_count = reader.i32()
        materials.append(
            {
                "index": index,
                "name": name,
                "texture_index": texture_index,
                "texture": textures[texture_index] if 0 <= texture_index < len(textures) else None,
                "sphere_texture_index": sphere_index,
                "sphere_texture": textures[sphere_index] if 0 <= sphere_index < len(textures) else None,
                "toon_texture_index": toon_index,
                "toon_texture": textures[toon_index] if 0 <= toon_index < len(textures) else None,
                "face_vertex_count": face_vertex_count,
            }
        )
    return {
        "positions": positions,
        "normals": normals,
        "uvs": uvs,
        "weights": weights,
        "edge_scales": edge_scales,
        "face_indices": face_indices,
        "materials": materials,
        "counts": {
            "vertices": vertex_count,
            "faces": face_index_count // 3,
            "materials": material_count,
        },
    }


def compare_vectors(actual: list[list[float]], expected: list[list[float]]) -> dict[str, Any]:
    count = min(len(actual), len(expected))
    errors = []
    for index in range(count):
        errors.append(max(abs(actual[index][axis] - expected[index][axis]) for axis in range(len(expected[index]))))
    return {
        "count_actual": len(actual),
        "count_expected": len(expected),
        "compared": count,
        "max_abs_error": max(errors) if errors else None,
        "mean_abs_error": mean(errors) if errors else None,
        "non_finite_actual": sum(1 for row in actual for value in row if not finite(value)),
    }


def compare_geometry(obj: bpy.types.Object, pmx: dict[str, Any]) -> dict[str, Any]:
    mesh = obj.data
    mesh.calc_loop_triangles()
    blender_positions = [list(vertex.co) for vertex in mesh.vertices]
    expected_positions = [[pos[0] * 0.08, pos[2] * 0.08, pos[1] * 0.08] for pos in pmx["positions"]]
    blender_uv = mesh.uv_layers.get("UVMap")
    uv_rows = [list(blender_uv.data[index].uv) for index in range(len(blender_uv.data))] if blender_uv else []
    expected_uv_rows = []
    for loop in mesh.loops:
        uv = pmx["uvs"][loop.vertex_index]
        expected_uv_rows.append([uv[0], 1.0 - uv[1]])

    blender_triangles = [list(triangle.vertices) for triangle in mesh.loop_triangles]
    pmx_triangles = [pmx["face_indices"][index : index + 3] for index in range(0, len(pmx["face_indices"]), 3)]
    same_set = 0
    same_order = 0
    reversed_order = 0
    for actual, expected in zip(blender_triangles, pmx_triangles):
        if sorted(actual) == sorted(expected):
            same_set += 1
        if actual == expected:
            same_order += 1
        if actual == list(reversed(expected)):
            reversed_order += 1

    material_ranges = []
    cursor = 0
    polygons = list(mesh.polygons)
    for material_index in range(len(obj.material_slots)):
        indices = [index for index, polygon in enumerate(polygons) if polygon.material_index == material_index]
        material_ranges.append(
            {
                "material_index": material_index,
                "name": obj.material_slots[material_index].material.name if obj.material_slots[material_index].material else None,
                "face_count": len(indices),
                "first_face": min(indices) if indices else None,
                "last_face": max(indices) if indices else None,
                "contiguous": bool(indices) and indices == list(range(min(indices), max(indices) + 1)),
            }
        )
        cursor += len(indices)

    return {
        "position_comparison": compare_vectors(blender_positions, expected_positions),
        "uv_comparison": compare_vectors(uv_rows, expected_uv_rows),
        "triangle_comparison": {
            "blender_count": len(blender_triangles),
            "pmx_count": len(pmx_triangles),
            "same_vertex_set": same_set,
            "same_order": same_order,
            "reversed_order": reversed_order,
        },
        "blender_hashes": {
            "positions": sha_float_rows(blender_positions),
            "uv_loop_data": sha_float_rows(uv_rows),
            "triangles": sha_json(blender_triangles),
            "material_indices": sha_json([polygon.material_index for polygon in polygons]),
        },
        "pmx_hashes": {
            "positions_after_import_transform": sha_float_rows(expected_positions),
            "uv_after_import_transform": sha_float_rows(expected_uv_rows),
            "triangles": sha_json(pmx_triangles),
            "material_face_ranges": sha_json(pmx["materials"]),
        },
        "material_ranges": material_ranges,
    }


def normal_and_tangent_stats(obj: bpy.types.Object, pmx: dict[str, Any]) -> dict[str, Any]:
    mesh = obj.data
    mesh.calc_loop_triangles()
    try:
        mesh.calc_normals()
    except Exception:
        pass
    corner_normals: list[list[float]] = []
    try:
        corner_normals = [list(item.vector) for item in mesh.corner_normals]
    except Exception:
        corner_normals = [list(item.normal) for item in mesh.loops]

    expected = []
    for loop in mesh.loops:
        normal = pmx["normals"][loop.vertex_index]
        expected.append([normal[0], normal[2], normal[1]])
    error_rows = []
    for actual, wanted in zip(corner_normals, expected):
        error_rows.append(max(abs(actual[axis] - wanted[axis]) for axis in range(3)))

    zero_normals = sum(1 for row in corner_normals if math.sqrt(sum(value * value for value in row)) <= 1e-8)
    normal_result: dict[str, Any] = {
        "count": len(corner_normals),
        "zero_count": zero_normals,
        "min_length": min((math.sqrt(sum(value * value for value in row)) for row in corner_normals), default=0.0),
        "max_length": max((math.sqrt(sum(value * value for value in row)) for row in corner_normals), default=0.0),
        "mean_length": mean([math.sqrt(sum(value * value for value in row)) for row in corner_normals]),
        "pmx_import_comparison": {
            "compared": len(error_rows),
            "max_abs_error": max(error_rows) if error_rows else None,
            "mean_abs_error": mean(error_rows) if error_rows else None,
            "large_error_count_gt_1e-3": sum(1 for error in error_rows if error > 1e-3),
        },
    }

    tangent_result: dict[str, Any] = {"count": 0, "zero_count": None, "uv_layer": "UVMap"}
    try:
        mesh.calc_tangents(uvmap="UVMap")
        tangents = [list(loop.tangent) for loop in mesh.loops]
        lengths = [math.sqrt(sum(value * value for value in row)) for row in tangents]
        tangent_result = {
            "count": len(tangents),
            "zero_count": sum(1 for length in lengths if length <= 1e-8),
            "min_length": min(lengths, default=0.0),
            "max_length": max(lengths, default=0.0),
            "mean_length": mean(lengths),
            "uv_layer": "UVMap",
            "handedness_signs": {
                "negative": sum(1 for loop in mesh.loops if loop.bitangent_sign < 0),
                "positive": sum(1 for loop in mesh.loops if loop.bitangent_sign >= 0),
            },
        }
    except Exception as error:
        tangent_result["error"] = str(error)

    attribute_info = []
    for attribute in mesh.attributes:
        attribute_info.append(
            {
                "name": attribute.name,
                "domain": attribute.domain,
                "data_type": attribute.data_type,
                "length": len(attribute.data),
            }
        )
    return {"normal": normal_result, "tangent": tangent_result, "attributes": attribute_info}


def armature_info(obj: bpy.types.Object, pmx: dict[str, Any]) -> dict[str, Any]:
    armature = obj.find_armature()
    if armature is None:
        armature = next((item for item in bpy.context.scene.objects if item.type == "ARMATURE"), None)
    if armature is None:
        return {"found": False}
    bones = list(armature.data.bones)
    vertex_groups = list(obj.vertex_groups)
    pmx_names = {bone["name"] for bone in parse_pmx(PMX_PATH)["bones"]}
    matched_name_count = sum(1 for bone in bones if bone.name in pmx_names)
    group_names = [group.name for group in vertex_groups]
    group_set = set(group_names)
    weight_group_counts: dict[str, int] = {}
    for vertex in obj.data.vertices:
        valid_groups = [
            vertex_groups[group.group].name
            for group in vertex.groups
            if group.group < len(vertex_groups)
            and vertex_groups[group.group].name in pmx_names
            and group.weight > 0
        ]
        key = str(len(valid_groups))
        weight_group_counts[key] = weight_group_counts.get(key, 0) + 1
    return {
        "found": True,
        "name": armature.name,
        "bones": len(bones),
        "pose_bones": len(armature.pose.bones),
        "pmx_bone_count": pmx["counts"]["bones"],
        "pmx_name_match_count": matched_name_count,
        "aux_bone_count_by_name": len([bone for bone in bones if bone.name not in pmx_names]),
        "vertex_group_count": len(vertex_groups),
        "vertex_group_names_tail": group_names[-4:],
        "weight_group_count_by_vertex": weight_group_counts,
        "armature_modifier_names": [modifier.name for modifier in obj.modifiers if modifier.type == "ARMATURE"],
    }


def shape_key_info(obj: bpy.types.Object, pmx: dict[str, Any]) -> dict[str, Any]:
    keys = obj.data.shape_keys
    names = [block.name for block in keys.key_blocks] if keys else []
    pmx_morph_summary = parse_pmx(PMX_PATH)["morph_summary"]
    pmx_vertex_morph_names = [m["name"] for m in pmx_morph_summary if m["type"] == 1]
    return {
        "count_including_basis": len(names),
        "names": names,
        "basis_present": "Basis" in names,
        "non_basis_count": len([name for name in names if name != "Basis"]),
        "pmx_vertex_morph_count": len(pmx_vertex_morph_names),
        "pmx_vertex_morph_name_match_count": len(set(names) - {"Basis"} & set(pmx_vertex_morph_names)),
        "pmx_material_morphs": [
            {"name": m["name"], "type": m["type"]}
            for m in pmx_morph_summary
            if m["type"] == 8
        ],
    }


def main() -> None:
    bpy.context.scene.frame_set(120)
    obj = bpy.data.objects.get("GirlsFrontline KoledaDefault_mesh")
    if obj is None or obj.type != "MESH":
        raise RuntimeError("authoritative mesh not found")
    pmx_summary = parse_pmx(PMX_PATH)
    pmx_geometry = read_pmx_geometry(PMX_PATH)
    mesh = obj.data
    mesh.calc_loop_triangles()

    face_start = 0
    materials = []
    for index, slot in enumerate(obj.material_slots):
        polygons = [polygon for polygon in mesh.polygons if polygon.material_index == index]
        materials.append(material_info(slot.material, index, len(polygons), face_start) if slot.material else {
            "index": index,
            "name": None,
            "face_count": len(polygons),
            "face_start": face_start,
            "face_end": face_start + len(polygons) - 1,
            "use_nodes": False,
            "nodes": [],
            "links": [],
        })
        face_start += len(polygons)

    uv_layers = []
    for layer in mesh.uv_layers:
        uv_layers.append(
            {
                "name": layer.name,
                "active": layer.name == mesh.uv_layers.active.name if mesh.uv_layers.active else False,
                "length": len(layer.data),
                "hash": sha_float_rows([list(item.uv) for item in layer.data]),
            }
        )

    world = bpy.context.scene.world
    view_settings = bpy.context.scene.view_settings
    result = {
        "source_file": str(BLEND_PATH),
        "headless": True,
        "blender_version": bpy.app.version_string,
        "scene": bpy.context.scene.name,
        "frame": bpy.context.scene.frame_current,
        "render_engine": bpy.context.scene.render.engine,
        "color_management": {
            "display_device": getattr(view_settings, "display_device", None),
            "view_transform": getattr(view_settings, "view_transform", None),
            "look": getattr(view_settings, "look", None),
            "exposure": getattr(view_settings, "exposure", None),
            "gamma": getattr(view_settings, "gamma", None),
            "world_color": list(world.color) if world else None,
        },
        "authoritative_object": {
            "name": obj.name,
            "data_name": mesh.name,
            "vertices": len(mesh.vertices),
            "edges": len(mesh.edges),
            "polygons": len(mesh.polygons),
            "loops": len(mesh.loops),
            "loop_triangles": len(mesh.loop_triangles),
            "material_slots": len(obj.material_slots),
            "uv_layers": uv_layers,
            "active_uv": mesh.uv_layers.active.name if mesh.uv_layers.active else None,
            "modifiers": [
                {"name": modifier.name, "type": modifier.type, "object": modifier.object.name if modifier.type == "ARMATURE" and modifier.object else None}
                for modifier in obj.modifiers
            ],
        },
        "geometry_comparison": compare_geometry(obj, pmx_geometry),
        "normal_tangent": normal_and_tangent_stats(obj, pmx_geometry),
        "armature": armature_info(obj, pmx_summary),
        "shape_keys": shape_key_info(obj, pmx_summary),
        "pmx_counts": pmx_summary["counts"],
        "pmx_weight_kinds": pmx_summary["vertex_weight_kinds"],
        "pmx_materials": pmx_geometry["materials"],
        "materials": materials,
        "images": [image_info(image) for image in bpy.data.images],
        "hashes": {
            "pmx_vertex_positions": pmx_summary["hashes"]["vertex_positions"],
            "pmx_vertex_normals": pmx_summary["hashes"]["vertex_normals"],
            "pmx_vertex_uvs": pmx_summary["hashes"]["vertex_uvs"],
            "pmx_vertex_weights": pmx_summary["hashes"]["vertex_weights"],
            "pmx_morph_summary": pmx_summary["hashes"]["morph_summary"],
            "pmx_bone_core": pmx_summary["hashes"]["bone_core"],
        },
        "notes": [
            "Blender import comparison applies position scale 0.08 and PMX Y/Z axis swap.",
            "UV comparison applies V inversion: Blender UV=(u, 1-v).",
            "Triangle reverse order is expected from the axis/winding import convention.",
            "The headless script only reads the .blend and writes JSON under this worktree.",
        ],
    }
    OUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({
        "output": str(OUT_PATH),
        "authoritative_object": result["authoritative_object"],
        "geometry_comparison": result["geometry_comparison"],
        "normal_tangent": result["normal_tangent"],
        "armature": result["armature"],
        "shape_keys": result["shape_keys"],
    }, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
