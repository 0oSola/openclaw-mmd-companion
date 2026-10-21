from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path
from typing import Any


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.i = 0

    def take(self, n: int) -> bytes:
        if self.i + n > len(self.data):
            raise EOFError(f"read past eof at {self.i}+{n}/{len(self.data)}")
        b = self.data[self.i : self.i + n]
        self.i += n
        return b

    def u8(self) -> int:
        return self.take(1)[0]

    def i8(self) -> int:
        return struct.unpack("<b", self.take(1))[0]

    def u16(self) -> int:
        return struct.unpack("<H", self.take(2))[0]

    def i16(self) -> int:
        return struct.unpack("<h", self.take(2))[0]

    def u32(self) -> int:
        return struct.unpack("<I", self.take(4))[0]

    def i32(self) -> int:
        return struct.unpack("<i", self.take(4))[0]

    def f32(self) -> float:
        return struct.unpack("<f", self.take(4))[0]

    def vec2(self) -> list[float]:
        return [self.f32(), self.f32()]

    def vec3(self) -> list[float]:
        return [self.f32(), self.f32(), self.f32()]

    def vec4(self) -> list[float]:
        return [self.f32(), self.f32(), self.f32(), self.f32()]

    def index(self, size: int, signed: bool = True) -> int:
        if size == 1:
            return self.i8() if signed else self.u8()
        if size == 2:
            return self.i16() if signed else self.u16()
        if size == 4:
            return self.i32() if signed else self.u32()
        raise ValueError(f"unsupported index size {size}")

    def text(self, encoding: int) -> str:
        n = self.i32()
        if n < 0 or n > len(self.data) - self.i:
            raise ValueError(f"invalid string byte length {n} at {self.i}")
        raw = self.take(n)
        codec = "utf-16-le" if encoding == 0 else "utf-8"
        return raw.decode(codec, errors="replace")


def sha_json(values: Any) -> str:
    blob = json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def sha_floats(rows: list[Any], digits: int | None = None) -> str:
    if digits is not None:
        def norm(x: Any) -> Any:
            if isinstance(x, float):
                return round(x, digits)
            if isinstance(x, list):
                return [norm(v) for v in x]
            if isinstance(x, dict):
                return {k: norm(v) for k, v in x.items()}
            return x
        rows = norm(rows)
    return sha_json(rows)


def finite(v: float) -> bool:
    return math.isfinite(v)


def parse_pmx(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    r = Reader(raw)
    magic = r.take(4)
    if magic != b"PMX ":
        raise ValueError(f"not a PMX file: {magic!r}")
    version = r.f32()
    header_size = r.u8()
    globals_ = list(r.take(header_size))
    if len(globals_) < 8:
        raise ValueError(f"PMX header globals too short: {len(globals_)}")
    encoding, add_uv_count, vi, ti, mi, bi, moi, ri = globals_[:8]

    model_name = r.text(encoding)
    model_name_en = r.text(encoding)
    comment = r.text(encoding)
    comment_en = r.text(encoding)

    header = {
        "magic": magic.decode("ascii"),
        "version": version,
        "header_size": header_size,
        "encoding": encoding,
        "encoding_name": "UTF-16LE" if encoding == 0 else "UTF-8",
        "additional_uv_count": add_uv_count,
        "vertex_index_size": vi,
        "texture_index_size": ti,
        "material_index_size": mi,
        "bone_index_size": bi,
        "morph_index_size": moi,
        "rigid_index_size": ri,
        "model_name": model_name,
        "model_name_en": model_name_en,
        "comment_length": len(comment),
        "comment_en_length": len(comment_en),
    }

    vertex_count = r.i32()
    vertices: list[dict[str, Any]] = []
    for _ in range(vertex_count):
        pos = r.vec3()
        normal = r.vec3()
        uv = r.vec2()
        add_uv = [r.vec4() for _ in range(add_uv_count)]
        weight_type = r.u8()
        weight: dict[str, Any] = {"type": weight_type}
        if weight_type == 0:  # BDEF1
            weight["bones"] = [r.index(bi)]
        elif weight_type == 1:  # BDEF2
            bones = [r.index(bi), r.index(bi)]
            weight["bones"] = bones
            weight["weights"] = [r.f32(), 0.0]
        elif weight_type == 2:  # BDEF4
            weight["bones"] = [r.index(bi) for _ in range(4)]
            weight["weights"] = [r.f32() for _ in range(4)]
        elif weight_type == 3:  # SDEF
            weight["bones"] = [r.index(bi), r.index(bi)]
            weight["weights"] = [r.f32(), 0.0]
            weight["c"] = r.vec3()
            weight["r0"] = r.vec3()
            weight["r1"] = r.vec3()
        elif weight_type == 4:  # QDEF
            weight["bones"] = [r.index(bi) for _ in range(4)]
            weight["weights"] = [r.f32() for _ in range(4)]
        else:
            raise ValueError(f"unsupported PMX weight type {weight_type}")
        edge_scale = r.f32()
        vertices.append(
            {
                "pos": pos,
                "normal": normal,
                "uv": uv,
                "add_uv": add_uv,
                "weight": weight,
                "edge_scale": edge_scale,
            }
        )

    face_index_count = r.i32()
    face_indices = [r.index(vi, signed=False) for _ in range(face_index_count)]
    face_count = face_index_count // 3

    texture_count = r.i32()
    textures = [r.text(encoding) for _ in range(texture_count)]

    material_count = r.i32()
    materials: list[dict[str, Any]] = []
    for index in range(material_count):
        name = r.text(encoding)
        name_en = r.text(encoding)
        diffuse = r.vec4()
        specular = r.vec3()
        specular_strength = r.f32()
        ambient = r.vec3()
        draw_flags = r.u8()
        edge_color = r.vec4()
        edge_size = r.f32()
        texture_index = r.index(ti)
        sphere_texture_index = r.index(ti)
        sphere_mode = r.u8()
        toon_flag = r.u8()
        if toon_flag == 0:
            toon_texture_index = r.index(ti)
        else:
            toon_texture_index = r.u8()
        mat_comment = r.text(encoding)
        material_face_vertex_count = r.i32()
        materials.append(
            {
                "index": index,
                "name": name,
                "name_en": name_en,
                "diffuse": diffuse,
                "specular": specular,
                "specular_strength": specular_strength,
                "ambient": ambient,
                "draw_flags": draw_flags,
                "edge_color": edge_color,
                "edge_size": edge_size,
                "texture_index": texture_index,
                "texture": textures[texture_index] if 0 <= texture_index < len(textures) else None,
                "sphere_texture_index": sphere_texture_index,
                "sphere_texture": (
                    textures[sphere_texture_index]
                    if 0 <= sphere_texture_index < len(textures)
                    else None
                ),
                "sphere_mode": sphere_mode,
                "toon_flag": toon_flag,
                "toon_texture_index": toon_texture_index,
                "toon_texture": (
                    textures[toon_texture_index]
                    if 0 <= toon_texture_index < len(textures)
                    else None
                ),
                "comment": mat_comment,
                "face_vertex_count": material_face_vertex_count,
            }
        )

    bone_count = r.i32()
    bones: list[dict[str, Any]] = []
    for index in range(bone_count):
        name = r.text(encoding)
        name_en = r.text(encoding)
        position = r.vec3()
        parent = r.index(bi)
        transform_level = r.i32()
        flags = r.u16()
        bone: dict[str, Any] = {
            "index": index,
            "name": name,
            "name_en": name_en,
            "position": position,
            "parent": parent,
            "transform_level": transform_level,
            "flags": flags,
        }
        if flags & 0x0001:
            bone["tail_index"] = r.index(bi)
        else:
            bone["tail_position"] = r.vec3()
        if flags & (0x0100 | 0x0200):
            bone["inherit_parent"] = r.index(bi)
            bone["inherit_ratio"] = r.f32()
        if flags & 0x0400:
            bone["fixed_axis"] = r.vec3()
        if flags & 0x0800:
            bone["local_axis_x"] = r.vec3()
            bone["local_axis_z"] = r.vec3()
        if flags & 0x2000:
            bone["external_parent_key"] = r.i32()
        if flags & 0x0020:
            bone["ik_target"] = r.index(bi)
            bone["ik_loop_count"] = r.i32()
            bone["ik_limit"] = r.f32()
            link_count = r.i32()
            links = []
            for _ in range(link_count):
                link_bone = r.index(bi)
                has_limit = r.u8()
                link: dict[str, Any] = {"bone": link_bone, "has_limit": has_limit}
                if has_limit:
                    link["min"] = r.vec3()
                    link["max"] = r.vec3()
                links.append(link)
            bone["ik_links"] = links
        bones.append(bone)

    morph_count = r.i32()
    morphs: list[dict[str, Any]] = []
    for index in range(morph_count):
        name = r.text(encoding)
        name_en = r.text(encoding)
        panel = r.u8()
        morph_type = r.u8()
        offset_count = r.i32()
        offsets: list[dict[str, Any]] = []
        for _ in range(offset_count):
            if morph_type == 0:  # group
                offsets.append({"morph": r.index(moi), "weight": r.f32()})
            elif morph_type == 1:  # vertex
                offsets.append({"vertex": r.index(vi, signed=False), "offset": r.vec3()})
            elif morph_type == 2:  # bone
                offsets.append({"bone": r.index(bi), "translation": r.vec3(), "rotation": r.vec4()})
            elif morph_type in (3, 4, 5, 6, 7):  # UV/additional UV
                offsets.append({"vertex": r.index(vi, signed=False), "offset": r.vec4()})
            elif morph_type == 8:  # material
                offsets.append(
                    {
                        "material": r.index(mi),
                        "offset_type": r.u8(),
                        "diffuse": r.vec4(),
                        "specular": r.vec3(),
                        "specular_strength": r.f32(),
                        "ambient": r.vec3(),
                        "edge_color": r.vec4(),
                        "edge_size": r.f32(),
                        "texture_tint": r.vec4(),
                        "sphere_tint": r.vec4(),
                        "toon_tint": r.vec4(),
                    }
                )
            elif morph_type == 9:  # flip
                offsets.append({"morph": r.index(moi), "weight": r.f32()})
            elif morph_type == 10:  # impulse
                offsets.append(
                    {
                        "rigid": r.index(ri),
                        "local": r.u8(),
                        "velocity": r.vec3(),
                        "torque": r.vec3(),
                    }
                )
            else:
                raise ValueError(f"unsupported PMX morph type {morph_type}")
        morphs.append(
            {
                "index": index,
                "name": name,
                "name_en": name_en,
                "panel": panel,
                "type": morph_type,
                "offset_count": offset_count,
                "offsets": offsets,
            }
        )

    frame_count = r.i32()
    frames = []
    for _ in range(frame_count):
        name = r.text(encoding)
        name_en = r.text(encoding)
        special = r.u8()
        element_count = r.i32()
        elements = []
        for _ in range(element_count):
            element_type = r.u8()
            if element_type == 0:
                elements.append({"type": "bone", "index": r.index(bi)})
            else:
                elements.append({"type": "morph", "index": r.index(moi)})
        frames.append({"name": name, "name_en": name_en, "special": special, "elements": elements})

    rigid_count = r.i32()
    rigids = []
    for index in range(rigid_count):
        name = r.text(encoding)
        name_en = r.text(encoding)
        bone = r.index(bi)
        group = r.u8()
        mask = r.u16()
        shape = r.u8()
        size = r.vec3()
        position = r.vec3()
        rotation = r.vec3()
        mass = r.f32()
        linear_damping = r.f32()
        angular_damping = r.f32()
        restitution = r.f32()
        friction = r.f32()
        mode = r.u8()
        rigids.append(
            {
                "index": index,
                "name": name,
                "name_en": name_en,
                "bone": bone,
                "group": group,
                "mask": mask,
                "shape": shape,
                "size": size,
                "position": position,
                "rotation": rotation,
                "mass": mass,
                "linear_damping": linear_damping,
                "angular_damping": angular_damping,
                "restitution": restitution,
                "friction": friction,
                "mode": mode,
            }
        )

    joint_count = r.i32()
    joints = []
    for index in range(joint_count):
        name = r.text(encoding)
        name_en = r.text(encoding)
        joint_type = r.u8()
        rigid_a = r.index(ri)
        rigid_b = r.index(ri)
        position = r.vec3()
        rotation = r.vec3()
        position_min = r.vec3()
        position_max = r.vec3()
        rotation_min = r.vec3()
        rotation_max = r.vec3()
        spring_position = r.vec3()
        spring_rotation = r.vec3()
        joints.append(
            {
                "index": index,
                "name": name,
                "name_en": name_en,
                "type": joint_type,
                "rigid_a": rigid_a,
                "rigid_b": rigid_b,
                "position": position,
                "rotation": rotation,
                "position_min": position_min,
                "position_max": position_max,
                "rotation_min": rotation_min,
                "rotation_max": rotation_max,
                "spring_position": spring_position,
                "spring_rotation": spring_rotation,
            }
        )

    resolved_textures = []
    base_dir = path.parent
    for index, texture in enumerate(textures):
        resolved = (base_dir / texture).resolve()
        entry: dict[str, Any] = {
            "index": index,
            "path": texture,
            "resolved": str(resolved),
            "exists": resolved.is_file(),
        }
        if resolved.is_file():
            entry["bytes"] = resolved.stat().st_size
            entry["sha256"] = hashlib.sha256(resolved.read_bytes()).hexdigest()
        resolved_textures.append(entry)

    material_face_ranges = []
    cursor = 0
    for material in materials:
        count = material["face_vertex_count"]
        material_face_ranges.append(
            {
                "material_index": material["index"],
                "name": material["name"],
                "start_face": cursor // 3,
                "face_count": count // 3,
                "start_index": cursor,
                "index_count": count,
            }
        )
        cursor += count

    weight_kinds: dict[str, int] = {}
    for v in vertices:
        key = str(v["weight"]["type"])
        weight_kinds[key] = weight_kinds.get(key, 0) + 1

    vertex_positions = [v["pos"] for v in vertices]
    vertex_normals = [v["normal"] for v in vertices]
    vertex_uvs = [v["uv"] for v in vertices]
    vertex_weights = [v["weight"] for v in vertices]
    # Blender's MMD importer used by the V14D file applies a uniform 0.08 scale,
    # swaps the PMX Y/Z axes, and flips the V coordinate in the active UV layer.
    # Keep these derived hashes next to the raw PMX hashes so the audit can prove
    # coordinate-converted equality without treating the importer transform as a
    # geometry edit.
    blender_positions = [[pos[0] * 0.08, pos[2] * 0.08, pos[1] * 0.08] for pos in vertex_positions]
    blender_normals = [[normal[0], normal[2], normal[1]] for normal in vertex_normals]
    blender_uvmap = [[uv[0], 1.0 - uv[1]] for uv in vertex_uvs]
    morph_summary = [
        {
            "index": m["index"],
            "name": m["name"],
            "name_en": m["name_en"],
            "panel": m["panel"],
            "type": m["type"],
            "offset_count": m["offset_count"],
            "offset_sha256": sha_floats(m["offsets"], digits=7),
        }
        for m in morphs
    ]
    bone_summary = [
        {
            "index": b["index"],
            "name": b["name"],
            "name_en": b["name_en"],
            "position": b["position"],
            "parent": b["parent"],
            "transform_level": b["transform_level"],
            "flags": b["flags"],
            "tail_index": b.get("tail_index"),
            "tail_position": b.get("tail_position"),
            "inherit_parent": b.get("inherit_parent"),
            "inherit_ratio": b.get("inherit_ratio"),
            "fixed_axis": b.get("fixed_axis"),
            "local_axis_x": b.get("local_axis_x"),
            "local_axis_z": b.get("local_axis_z"),
            "external_parent_key": b.get("external_parent_key"),
            "ik_target": b.get("ik_target"),
            "ik_loop_count": b.get("ik_loop_count"),
            "ik_limit": b.get("ik_limit"),
            "ik_links": b.get("ik_links"),
        }
        for b in bones
    ]

    result = {
        "path": str(path),
        "file_bytes": len(raw),
        "reader_offset": r.i,
        "trailing_bytes": len(raw) - r.i,
        "header": header,
        "counts": {
            "vertices": vertex_count,
            "face_indices": face_index_count,
            "faces": face_count,
            "textures": texture_count,
            "materials": material_count,
            "bones": bone_count,
            "morphs": morph_count,
            "frames": frame_count,
            "rigids": rigid_count,
            "joints": joint_count,
        },
        "vertex_weight_kinds": weight_kinds,
        "textures": resolved_textures,
        "materials": materials,
        "material_face_ranges": material_face_ranges,
        "bone_names": [b["name"] for b in bones],
        "bones": bone_summary,
        "morph_summary": morph_summary,
        "rigid_names": [x["name"] for x in rigids],
        "joint_names": [x["name"] for x in joints],
        "frames": frames,
        "hashes": {
            "vertex_positions": sha_floats(vertex_positions, digits=8),
            "vertex_normals": sha_floats(vertex_normals, digits=8),
            "vertex_uvs": sha_floats(vertex_uvs, digits=8),
            "blender_import_positions": sha_floats(blender_positions, digits=8),
            "blender_import_normals": sha_floats(blender_normals, digits=8),
            "blender_import_uvmap": sha_floats(blender_uvmap, digits=8),
            "vertex_weights": sha_floats(vertex_weights, digits=8),
            "edge_scales": sha_floats([v["edge_scale"] for v in vertices], digits=8),
            "face_indices": sha_json(face_indices),
            "material_face_ranges": sha_json(material_face_ranges),
            "bone_core": sha_floats(bone_summary, digits=8),
            "morph_summary": sha_json(morph_summary),
            "rigid_names": sha_json([x["name"] for x in rigids]),
            "joint_names": sha_json([x["name"] for x in joints]),
        },
    }
    return result


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python pmx_audit.py <file.pmx>")
    path = Path(sys.argv[1]).resolve()
    result = parse_pmx(path)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
