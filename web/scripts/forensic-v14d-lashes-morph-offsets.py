#!/usr/bin/env python3
"""Stage 2C-M2a.4 Lashes Morph 偏移权威取证。

这条脚本提供两条相互独立的权威路线：

* PMX 二进制路线：复用项目已有 pmx_audit.Reader 做最小、显式的 index walk，
  读取顶点 Morph 的真实 vertex index 与 xyz offset，并按严格非零口径统计。
* Blender CLI 路线：加载权威 .blend，读取 Shape Key 相对 Basis 的逐顶点 delta，
  再以 PMX→Blender 的已知缩放/轴向变换逐索引核对。

默认输出 schema 同时保留 G7 既有消费字段：morphs[*].browsVerts 与
morphs[*].lashesVerts。脚本不修改 PMX、Blend 或生产引擎。

Blender CLI：
  blender --background --python web/scripts/forensic-v14d-lashes-morph-offsets.py -- \
    --pmx <model.pmx> --blend <authority.blend> --out <report.json>

只跑 PMX 路线（普通 Python，便于秒级红测/回归）：
  python web/scripts/forensic-v14d-lashes-morph-offsets.py --pmx-only \
    --pmx <model.pmx> --out <report.json>

数值口径自测（不读取资产、不写报告）：
  python web/scripts/forensic-v14d-lashes-morph-offsets.py --self-test
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

try:
    import bpy
except ModuleNotFoundError:  # 普通 Python 的 --pmx-only 路线
    bpy = None

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = ROOT / "docs" / "handoff" / "evidence"
sys.path.insert(0, str(EVIDENCE_DIR))
from pmx_audit import Reader, parse_pmx  # noqa: E402


DEFAULT_PMX = Path(r"D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx")
DEFAULT_BLEND = Path(
    r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets"
    r"\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend"
)
DEFAULT_MESH = "GirlsFrontline KoledaDefault_mesh"
DEFAULT_MORPHS = ("まばたき", "笑い")
BLENDER_MATERIAL_NAMES = {"Brows": "PROTO_GF2_Brows", "Lashes": "PROTO_GF2_Lashes"}
PMX_TO_BLENDER_SCALE = 0.08


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def rounded(value: float) -> float:
    return round(float(value), 9)


def vector_norm(vector: list[float]) -> float:
    return math.sqrt(sum(float(component) ** 2 for component in vector))


def offset_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    vectors = [[float(value) for value in row["offset"]] for row in rows]
    magnitudes = [vector_norm(vector) for vector in vectors]
    strict_rows = [
        row
        for row in rows
        if any(float(value) != 0.0 for value in row["offset"])
    ]
    strict_vertices = {int(row["vertex"]) for row in strict_rows}
    referenced_vertices = {int(row["vertex"]) for row in rows}
    buckets = {
        "exactZero": 0,
        "positiveUpTo1e-8": 0,
        "above1e-8UpTo1e-6": 0,
        "above1e-6UpTo1e-4": 0,
        "above1e-4": 0,
    }
    for magnitude in magnitudes:
        if magnitude == 0.0:
            buckets["exactZero"] += 1
        elif magnitude <= 1e-8:
            buckets["positiveUpTo1e-8"] += 1
        elif magnitude <= 1e-6:
            buckets["above1e-8UpTo1e-6"] += 1
        elif magnitude <= 1e-4:
            buckets["above1e-6UpTo1e-4"] += 1
        else:
            buckets["above1e-4"] += 1
    return {
        "totalOffsetReferences": len(rows),
        "referencedVertexCount": len(referenced_vertices),
        "strictNonZeroOffsetCount": len(strict_rows),
        "strictNonZeroVertexCount": len(strict_vertices),
        "duplicateReferenceCount": len(rows) - len(referenced_vertices),
        "maxOffset": rounded(max(magnitudes, default=0.0)),
        "meanOffset": rounded(sum(magnitudes) / len(magnitudes) if magnitudes else 0.0),
        "rmsOffset": rounded(
            math.sqrt(sum(value * value for value in magnitudes) / len(magnitudes))
            if magnitudes
            else 0.0
        ),
        "componentMin": [
            rounded(min((vector[axis] for vector in vectors), default=0.0))
            for axis in range(3)
        ],
        "componentMax": [
            rounded(max((vector[axis] for vector in vectors), default=0.0))
            for axis in range(3)
        ],
        "zeroNearZeroBuckets": buckets,
        "strictNonZeroVertexIndices": sorted(strict_vertices),
        "referencedVertexIndices": sorted(referenced_vertices),
        "offsetSha256": json_sha256(
            [
                {"vertex": int(row["vertex"]), "offset": [rounded(value) for value in row["offset"]]}
                for row in rows
            ]
        ),
    }


def material_intersections(
    rows: list[dict[str, Any]],
    material_vertex_sets: dict[str, set[int]],
) -> dict[str, Any]:
    referenced = {int(row["vertex"]) for row in rows}
    strict_rows = [
        row
        for row in rows
        if any(float(value) != 0.0 for value in row["offset"])
    ]
    strict_vertices = {int(row["vertex"]) for row in strict_rows}
    result: dict[str, Any] = {}
    for name, vertices in material_vertex_sets.items():
        result[name] = {
            "allReferenceVertexCount": len(referenced & vertices),
            "strictNonZeroVertexCount": len(strict_vertices & vertices),
            "strictNonZeroOffsetCount": sum(
                1 for row in strict_rows if int(row["vertex"]) in vertices
            ),
        }
    return result


def skip_bones(reader: Reader, count: int, encoding: int, bone_size: int) -> None:
    for _ in range(count):
        reader.text(encoding)
        reader.text(encoding)
        reader.vec3()
        reader.index(bone_size)
        reader.i32()
        flags = reader.u16()
        if flags & 0x0001:
            reader.index(bone_size)
        else:
            reader.vec3()
        if flags & (0x0100 | 0x0200):
            reader.index(bone_size)
            reader.f32()
        if flags & 0x0400:
            reader.vec3()
        if flags & 0x0800:
            reader.vec3()
            reader.vec3()
        if flags & 0x2000:
            reader.i32()
        if flags & 0x0020:
            reader.index(bone_size)
            reader.i32()
            reader.f32()
            link_count = reader.i32()
            for _ in range(link_count):
                reader.index(bone_size)
                has_limit = reader.u8()
                if has_limit:
                    reader.vec3()
                    reader.vec3()


def read_pmx_sources(path: Path, morph_names: tuple[str, ...]) -> dict[str, Any]:
    raw = path.read_bytes()
    reader = Reader(raw)
    if reader.take(4) != b"PMX ":
        raise ValueError(f"not a PMX file: {path}")
    version = reader.f32()
    header_size = reader.u8()
    globals_ = list(reader.take(header_size))
    if len(globals_) < 8:
        raise ValueError("PMX globals header is shorter than 8 bytes")
    encoding, additional_uv_count, vertex_size, texture_size, material_size, bone_size, morph_size, rigid_size = globals_[
        :8
    ]
    for _ in range(4):
        reader.text(encoding)

    vertex_count = reader.i32()
    positions: list[list[float]] = []
    for _ in range(vertex_count):
        positions.append(reader.vec3())
        reader.vec3()
        reader.vec2()
        for _ in range(additional_uv_count):
            reader.vec4()
        weight_type = reader.u8()
        if weight_type == 0:
            reader.index(bone_size)
        elif weight_type == 1:
            reader.index(bone_size)
            reader.index(bone_size)
            reader.f32()
        elif weight_type == 2:
            for _ in range(4):
                reader.index(bone_size)
            for _ in range(4):
                reader.f32()
        elif weight_type == 3:
            reader.index(bone_size)
            reader.index(bone_size)
            reader.f32()
            reader.vec3()
            reader.vec3()
            reader.vec3()
        elif weight_type == 4:
            for _ in range(4):
                reader.index(bone_size)
            for _ in range(4):
                reader.f32()
        else:
            raise ValueError(f"unsupported PMX weight type {weight_type}")
        reader.f32()

    index_count = reader.i32()
    indices = [reader.index(vertex_size, signed=False) for _ in range(index_count)]
    texture_count = reader.i32()
    for _ in range(texture_count):
        reader.text(encoding)

    material_count = reader.i32()
    materials: list[dict[str, Any]] = []
    cursor = 0
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
        texture_index = reader.index(texture_size)
        sphere_index = reader.index(texture_size)
        reader.u8()
        toon_flag = reader.u8()
        if toon_flag == 0:
            reader.index(texture_size)
        else:
            reader.u8()
        reader.text(encoding)
        face_vertex_count = reader.i32()
        materials.append(
            {
                "index": index,
                "name": name,
                "startIndex": cursor,
                "indexCount": face_vertex_count,
                "textureIndex": texture_index,
                "sphereTextureIndex": sphere_index,
            }
        )
        cursor += face_vertex_count

    bone_count = reader.i32()
    skip_bones(reader, bone_count, encoding, bone_size)

    morph_count = reader.i32()
    selected: dict[str, dict[str, Any]] = {}
    for index in range(morph_count):
        name = reader.text(encoding)
        name_en = reader.text(encoding)
        panel = reader.u8()
        morph_type = reader.u8()
        offset_count = reader.i32()
        offsets: list[dict[str, Any]] = []
        for _ in range(offset_count):
            if morph_type == 0:
                reader.index(morph_size)
                reader.f32()
            elif morph_type == 1:
                vertex = reader.index(vertex_size, signed=False)
                offsets.append({"vertex": vertex, "offset": reader.vec3()})
            elif morph_type == 2:
                reader.index(bone_size)
                reader.vec3()
                reader.vec4()
            elif morph_type in (3, 4, 5, 6, 7):
                reader.index(vertex_size, signed=False)
                reader.vec4()
            elif morph_type == 8:
                reader.index(material_size)
                reader.u8()
                reader.vec4()
                reader.vec3()
                reader.f32()
                reader.vec3()
                reader.vec4()
                reader.f32()
                reader.vec4()
                reader.vec4()
                reader.vec4()
            elif morph_type == 9:
                reader.index(morph_size)
                reader.f32()
            elif morph_type == 10:
                reader.index(rigid_size)
                reader.u8()
                reader.vec3()
                reader.vec3()
            else:
                raise ValueError(f"unsupported PMX morph type {morph_type}")
        if name in morph_names:
            selected[name] = {
                "index": index,
                "name": name,
                "nameEn": name_en,
                "panel": panel,
                "type": morph_type,
                "offsetCount": offset_count,
                "offsets": offsets,
            }

    audit = parse_pmx(path)
    if audit["reader_offset"] != len(raw) or audit["trailing_bytes"] != 0:
        raise ValueError(
            f"PMX parser did not consume the full asset: {audit['reader_offset']}/{len(raw)}"
        )

    material_vertex_sets = {
        material["name"]: set(
            indices[material["startIndex"] : material["startIndex"] + material["indexCount"]]
        )
        for material in materials
    }
    target_ranges = {
        material["name"]: {
            "firstIndex": material["startIndex"],
            "count": material["indexCount"],
            "indexSequenceSha256": json_sha256(
                indices[material["startIndex"] : material["startIndex"] + material["indexCount"]]
            ),
            "indexSequence": indices[material["startIndex"] : material["startIndex"] + material["indexCount"]],
            "uniqueVertexCount": len(material_vertex_sets[material["name"]]),
            "uniqueVertexIndices": sorted(material_vertex_sets[material["name"]]),
        }
        for material in materials
        if material["name"] in ("Brows", "Lashes")
    }
    morph_results: dict[str, dict[str, Any]] = {}
    for name in morph_names:
        morph = selected.get(name)
        if morph is None:
            raise ValueError(f"PMX morph not found: {name}")
        if morph["type"] != 1:
            raise ValueError(f"PMX morph {name} is type {morph['type']}, expected vertex type 1")
        rows = morph["offsets"]
        intersections = material_intersections(
            rows,
            {
                "Brows": material_vertex_sets.get("Brows", set()),
                "Lashes": material_vertex_sets.get("Lashes", set()),
            },
        )
        morph_results[name] = {
            "index": morph["index"],
            "name": name,
            "type": morph["type"],
            "sourceRoute": "pmx-binary-direct",
            "offsets": rows,
            "offsetStats": offset_stats(rows),
            "materialIntersections": intersections,
            "browsVerts": intersections["Brows"]["strictNonZeroVertexCount"],
            "lashesVerts": intersections["Lashes"]["strictNonZeroVertexCount"],
        }

    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "version": version,
        "vertexCount": vertex_count,
        "indexCount": index_count,
        "materialCount": material_count,
        "morphCount": morph_count,
        "readerOffset": audit["reader_offset"],
        "trailingBytes": audit["trailing_bytes"],
        "positions": positions,
        "indices": indices,
        "materials": materials,
        "materialVertexSets": {
            name: sorted(vertices)
            for name, vertices in material_vertex_sets.items()
            if name in ("Brows", "Lashes")
        },
        "productionDrawIndexSets": target_ranges,
        "morphs": morph_results,
    }


def blender_material_vertex_sets(obj: Any) -> dict[str, set[int]]:
    result: dict[str, set[int]] = {}
    for material_index, slot in enumerate(obj.material_slots):
        material_name = slot.material.name if slot.material else None
        if material_name is None:
            continue
        vertices: set[int] = set()
        for polygon in obj.data.polygons:
            if polygon.material_index == material_index:
                vertices.update(int(vertex) for vertex in polygon.vertices)
        result[material_name] = vertices
    return result


def compare_blender_shape_keys(obj: Any, pmx: dict[str, Any], morph_names: tuple[str, ...]) -> dict[str, Any]:
    mesh = obj.data
    shape_keys = mesh.shape_keys.key_blocks if mesh.shape_keys else None
    if shape_keys is None or "Basis" not in shape_keys:
        raise ValueError(f"Blender mesh has no Basis Shape Key: {obj.name}")
    basis = shape_keys["Basis"]
    blender_sets = blender_material_vertex_sets(obj)
    logical_sets = {
        logical: blender_sets.get(actual, set())
        for logical, actual in BLENDER_MATERIAL_NAMES.items()
    }
    target_pmx_sets = pmx["materialVertexSets"]
    vertex_errors = []
    for index, vertex in enumerate(mesh.vertices):
        expected = pmx["positions"][index]
        expected_blender = [
            expected[0] * PMX_TO_BLENDER_SCALE,
            expected[2] * PMX_TO_BLENDER_SCALE,
            expected[1] * PMX_TO_BLENDER_SCALE,
        ]
        vertex_errors.append(
            max(abs(float(vertex.co[axis]) - expected_blender[axis]) for axis in range(3))
        )
    mapping_proof: dict[str, Any] = {
        "vertexCountEqual": len(mesh.vertices) == pmx["vertexCount"],
        "basisPositionMaxAbsError": rounded(max(vertex_errors, default=0.0)),
        "basisPositionMeanAbsError": rounded(
            sum(vertex_errors) / len(vertex_errors) if vertex_errors else 0.0
        ),
        "materialVertexSetEqual": {},
    }
    for logical in ("Brows", "Lashes"):
        pmx_set = set(target_pmx_sets.get(logical, []))
        blender_set = logical_sets.get(logical, set())
        mapping_proof["materialVertexSetEqual"][logical] = {
            "equal": pmx_set == blender_set,
            "pmxCount": len(pmx_set),
            "blenderCount": len(blender_set),
            "pmxOnlyCount": len(pmx_set - blender_set),
            "blenderOnlyCount": len(blender_set - pmx_set),
        }

    morph_results: dict[str, Any] = {}
    for name in morph_names:
        pmx_morph = pmx["morphs"][name]
        key = shape_keys.get(name)
        if key is None:
            raise ValueError(f"Blender Shape Key not found: {name}")
        rows: list[dict[str, Any]] = []
        max_error = 0.0
        total_error = 0.0
        for row in pmx_morph["offsets"]:
            index = int(row["vertex"])
            actual = [
                float(key.data[index].co[axis] - basis.data[index].co[axis])
                for axis in range(3)
            ]
            expected = [
                float(row["offset"][0]) * PMX_TO_BLENDER_SCALE,
                float(row["offset"][2]) * PMX_TO_BLENDER_SCALE,
                float(row["offset"][1]) * PMX_TO_BLENDER_SCALE,
            ]
            error = max(abs(actual[axis] - expected[axis]) for axis in range(3))
            max_error = max(max_error, error)
            total_error += error
            rows.append({"vertex": index, "offset": actual})
        intersections = material_intersections(
            rows,
            {
                "Brows": logical_sets.get("Brows", set()),
                "Lashes": logical_sets.get("Lashes", set()),
            },
        )
        pmx_strict = set(pmx_morph["offsetStats"]["strictNonZeroVertexIndices"])
        blender_stats = offset_stats(rows)
        blender_strict = set(blender_stats["strictNonZeroVertexIndices"])
        morph_results[name] = {
            "name": name,
            "type": pmx_morph["type"],
            "sourceRoute": "blender-cli-shape-key",
            "offsetStats": blender_stats,
            "materialIntersections": intersections,
            "mapping": {
                "vertexSetEqual": pmx_strict == blender_strict,
                "pmxOnlyVertexCount": len(pmx_strict - blender_strict),
                "blenderOnlyVertexCount": len(blender_strict - pmx_strict),
                "maxAbsDeltaErrorAfterPmxToBlenderTransform": rounded(max_error),
                "meanAbsDeltaErrorAfterPmxToBlenderTransform": rounded(
                    total_error / len(rows) if rows else 0.0
                ),
                "transform": "[x,y,z]pmx -> [0.08*x,0.08*z,0.08*y]blender",
            },
            "browsVerts": intersections["Brows"]["strictNonZeroVertexCount"],
            "lashesVerts": intersections["Lashes"]["strictNonZeroVertexCount"],
        }
        mapping_proof.setdefault("morphDeltaMapping", {})[name] = morph_results[name]["mapping"]

    mapping_proof["consistent"] = bool(
        mapping_proof["vertexCountEqual"]
        and mapping_proof["basisPositionMaxAbsError"] <= 1e-6
        and all(item["equal"] for item in mapping_proof["materialVertexSetEqual"].values())
        and all(item["vertexSetEqual"] and item["maxAbsDeltaErrorAfterPmxToBlenderTransform"] <= 1e-6
                for item in mapping_proof["morphDeltaMapping"].values())
    )
    return {
        "object": obj.name,
        "vertexCount": len(mesh.vertices),
        "materialVertexSets": {
            logical: sorted(vertices) for logical, vertices in logical_sets.items()
        },
        "morphs": morph_results,
        "mappingProof": mapping_proof,
    }


def make_report(
    pmx_path: Path,
    blend_path: Path | None,
    mesh_name: str,
    morph_names: tuple[str, ...],
) -> dict[str, Any]:
    pmx = read_pmx_sources(pmx_path, morph_names)
    blender = None
    if blend_path is not None:
        if bpy is None:
            raise RuntimeError("Blender CLI is required unless --pmx-only is used")
        bpy.ops.wm.open_mainfile(filepath=str(blend_path))
        obj = bpy.data.objects.get(mesh_name)
        if obj is None or obj.type != "MESH":
            raise ValueError(f"Blender mesh not found or not a mesh: {mesh_name}")
        blender = compare_blender_shape_keys(obj, pmx, morph_names)

    morphs = []
    for name in morph_names:
        pmx_morph = pmx["morphs"][name]
        blender_morph = blender["morphs"].get(name) if blender else None
        morphs.append(
            {
                "name": name,
                "type": pmx_morph["type"],
                "sourceRoute": {
                    "pmx": "pmx-binary-direct",
                    "blender": blender_morph["sourceRoute"] if blender_morph else None,
                },
                "offsetStats": {
                    "pmx": pmx_morph["offsetStats"],
                    "blender": blender_morph["offsetStats"] if blender_morph else None,
                },
                "materialIntersections": {
                    "pmx": pmx_morph["materialIntersections"],
                    "blender": blender_morph["materialIntersections"] if blender_morph else None,
                },
                "browsVerts": pmx_morph["browsVerts"],
                "lashesVerts": pmx_morph["lashesVerts"],
                "pmxOffsetRows": pmx_morph["offsets"],
                "mapping": blender_morph["mapping"] if blender_morph else None,
            }
        )

    morph_draw_set_proof: dict[str, dict[str, Any]] = {}
    for morph in morphs:
        rows = morph["pmxOffsetRows"]
        reference_vertices = {int(row["vertex"]) for row in rows}
        strict_vertices = {
            int(row["vertex"])
            for row in rows
            if any(float(value) != 0.0 for value in row["offset"])
        }
        morph_draw_set_proof[morph["name"]] = {}
        for slot_name, draw in pmx["productionDrawIndexSets"].items():
            draw_vertices = {int(value) for value in draw["uniqueVertexIndices"]}
            morph_draw_set_proof[morph["name"]][slot_name] = {
                "referenceVertexCount": len(reference_vertices),
                "strictNonZeroVertexCount": len(strict_vertices),
                "drawVertexCount": len(draw_vertices),
                "referenceDrawIntersectionCount": len(reference_vertices & draw_vertices),
                "strictNonZeroDrawIntersectionCount": len(strict_vertices & draw_vertices),
                "referenceOnlyCount": len(reference_vertices - draw_vertices),
                "drawOnlyCount": len(draw_vertices - reference_vertices),
                "strictNonZeroOnlyCount": len(strict_vertices - draw_vertices),
            }

    mapping_proof = blender["mappingProof"] if blender else {"status": "pmx-only"}
    return {
        "schemaVersion": 1,
        "ticket": "Stage 2C-M2a.4 Lashes Morph 偏移权威取证",
        "assetSha256": {
            "pmx": sha256_file(pmx_path),
            "blend": sha256_file(blend_path) if blend_path else None,
        },
        "sourceRoutes": [
            "pmx-binary-direct",
            "blender-cli-shape-key" if blender else "not-run",
        ],
        "pmx": {
            key: value
            for key, value in pmx.items()
            if key not in ("positions", "indices", "morphs")
        },
        "blender": blender,
        "morphs": morphs,
        "materialVertexSets": {
            "pmx": pmx["materialVertexSets"],
            "blender": blender["materialVertexSets"] if blender else None,
        },
        "productionDrawIndexSets": {
            "pmxSource": pmx["productionDrawIndexSets"],
            "runtimeObserved": False,
            "runtimeStatus": "pending-production-capture",
        },
        "morphDrawSetProof": morph_draw_set_proof,
        "mappingProof": mapping_proof,
        "firstLostBoundary": {
            "status": "not-evaluated",
            "boundary": "PMX parser -> model -> GPU morph buffer -> compute -> production vertexBuffer",
        },
        "hypotheses": {
            "H1_pmxToBlenderIndexReorder": ("falsified" if mapping_proof.get("consistent") else "pending"),
            "H3_loaderMorphOffsetParse": "pending-production-loader-readback",
            "H2_weightOrClipOverride": "pending-production-runtime",
            "H4_gpuMorphUploadOrCompute": "pending-production-runtime",
            "H5_gpuReadbackOrTiming": "pending-production-runtime",
        },
    }


def run_self_test() -> None:
    rows = [
        {"vertex": 10, "offset": [0.0, 0.0, 0.0]},
        {"vertex": 11, "offset": [1e-9, 0.0, 0.0]},
        {"vertex": 12, "offset": [2e-7, 0.0, 0.0]},
        {"vertex": 13, "offset": [2e-5, 0.0, 0.0]},
        {"vertex": 14, "offset": [2e-4, 0.0, 0.0]},
        {"vertex": 14, "offset": [0.0, -0.2, 0.0]},
    ]
    stats = offset_stats(rows)
    expected_buckets = {
        "exactZero": 1,
        "positiveUpTo1e-8": 1,
        "above1e-8UpTo1e-6": 1,
        "above1e-6UpTo1e-4": 1,
        "above1e-4": 2,
    }
    expected_stats = {
        "totalOffsetReferences": 6,
        "referencedVertexCount": 5,
        "strictNonZeroOffsetCount": 5,
        "strictNonZeroVertexCount": 4,
        "duplicateReferenceCount": 1,
        "zeroNearZeroBuckets": expected_buckets,
        "strictNonZeroVertexIndices": [11, 12, 13, 14],
    }
    for key, expected in expected_stats.items():
        if stats[key] != expected:
            raise AssertionError(f"offset_stats.{key}: expected {expected!r}, got {stats[key]!r}")

    intersections = material_intersections(
        rows,
        {
            "Brows": {10, 11, 12},
            "Lashes": {10, 11, 12, 13, 14},
        },
    )
    expected_intersections = {
        "Brows": {
            "allReferenceVertexCount": 3,
            "strictNonZeroVertexCount": 2,
            "strictNonZeroOffsetCount": 2,
        },
        "Lashes": {
            "allReferenceVertexCount": 5,
            "strictNonZeroVertexCount": 4,
            "strictNonZeroOffsetCount": 5,
        },
    }
    if intersections != expected_intersections:
        raise AssertionError(
            f"material_intersections: expected {expected_intersections!r}, got {intersections!r}"
        )

    print("LASHES-MORPH-SELF-TEST-OK")
    print(json.dumps({"offsetStats": stats, "materialIntersections": intersections}, ensure_ascii=False))


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument("--pmx", type=Path, default=DEFAULT_PMX)
    parser.add_argument("--blend", type=Path, default=DEFAULT_BLEND)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--mesh-name", default=DEFAULT_MESH)
    parser.add_argument("--morph", dest="morphs", action="append", default=None)
    parser.add_argument("--pmx-only", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test()
        return
    if args.out is None:
        raise SystemExit("--out is required unless --self-test is used")
    pmx_path = args.pmx.resolve()
    blend_path = None if args.pmx_only else args.blend.resolve()
    morph_names = tuple(args.morphs or DEFAULT_MORPHS)
    if not pmx_path.is_file():
        raise SystemExit(f"PMX not found: {pmx_path}")
    if blend_path is not None and not blend_path.is_file():
        raise SystemExit(f"Blend not found: {blend_path}")
    report = make_report(pmx_path, blend_path, args.mesh_name, morph_names)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print("LASHES-MORPH-FORENSIC-OK -> " + str(args.out))
    for morph in report["morphs"]:
        pmx_stats = morph["offsetStats"]["pmx"]
        print(
            f"MORPH {morph['name']} type={morph['type']} "
            f"refs={pmx_stats['totalOffsetReferences']} strictNonZero={pmx_stats['strictNonZeroVertexCount']} "
            f"max={pmx_stats['maxOffset']} mean={pmx_stats['meanOffset']} rms={pmx_stats['rmsOffset']} "
            f"Brows={morph['browsVerts']} Lashes={morph['lashesVerts']}"
        )


if __name__ == "__main__":
    main()
