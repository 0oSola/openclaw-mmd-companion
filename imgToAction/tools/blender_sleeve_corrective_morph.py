"""Build a frame-150 sleeve corrective shape-key POC in an existing blend.

Run with Blender, for example::

    blender --background existing.blend --python blender_sleeve_corrective_morph.py -- \
      --source-blend existing.blend --source-static-metrics static_pose_metrics.json \
      --source-candidate-id candidate_4330 --output-dir outputs/morph \
      --run-id run-20260715-morph-001

The source blend is never saved. Results are metrics and diagnostic renders only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import sys
import time
from pathlib import Path
from typing import NamedTuple, Sequence


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import blender_first_thinking_poc as poc

try:
    import bpy
    from mathutils import Matrix, Vector
except ImportError:  # Pure helpers and CLI validation run in normal Python.
    bpy = None
    Matrix = None
    Vector = None


SHAPE_KEY_NAME = "思考_右袖修正"
ALLOWED_VERTEX_GROUPS = ("右手捩1", "右手捩2", "右手捩3")
METRICS_NAME = "sleeve_corrective_morph_metrics.json"
RENDER_DIRECTORY = "sleeve_corrective_morph"
RUN_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{2,79}")
SOURCE_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{2,127}")
DEFAULT_EPSILON = 1.0e-4
DEFAULT_MAX_ITERATIONS = 16
DEFAULT_DIFFUSION_ITERATIONS = 4
DEFAULT_DIFFUSION_DECAY = 0.55
DEFAULT_MAX_LOCAL_STEP = 0.012


class Config(NamedTuple):
    source_blend: Path
    source_static_metrics: Path
    source_candidate_id: str
    output_dir: Path
    run_id: str
    overwrite_run: bool
    epsilon: float
    max_iterations: int
    diffusion_iterations: int
    diffusion_decay: float
    max_local_step: float
    safety_margin: float | None
    support_rings: int


class RunPaths(NamedTuple):
    temporary: Path
    final: Path
    metrics: Path


class ResolvedSourcePose(NamedTuple):
    source_record: dict
    arm_candidate_id: str
    compensation: dict | None
    expected_focused_overlap: int | None
    excluded_hand_overlap: int


def run_paths(output_dir: Path, run_id: str) -> RunPaths:
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise ValueError(f"Invalid run ID: {run_id!r}")
    output_dir = Path(output_dir)
    return RunPaths(
        temporary=output_dir / f".tmp-{run_id}",
        final=output_dir / run_id,
        metrics=output_dir / run_id / METRICS_NAME,
    )


def find_source_candidate(metrics: dict, source_id: str) -> dict:
    matches = []
    for table_name in (
        "compensation_candidates",
        "candidate_table",
        "candidates",
        "rendered_candidates",
    ):
        for record in metrics.get(table_name, ()):
            record_id = record.get("source_id", record.get("source_candidate_id"))
            if record_id == source_id:
                matches.append(record)
    if not matches:
        raise ValueError(f"Source candidate not found in metrics: {source_id}")
    unique = {json.dumps(record, sort_keys=True, ensure_ascii=False) for record in matches}
    if len(unique) > 1:
        raise ValueError(f"Source candidate has conflicting metric records: {source_id}")
    return matches[0]


def resolve_source_pose(metrics: dict, source_id: str) -> ResolvedSourcePose:
    record = find_source_candidate(metrics, source_id)
    compensation = record.get("parameters", {}).get("compensation")
    arm_candidate_id = record.get("arm_source_candidate_id")
    if compensation is None:
        arm_candidate_id = arm_candidate_id or source_id
    elif not arm_candidate_id:
        raise ValueError(f"Compensation source has no arm candidate ID: {source_id}")
    attribution = (
        record.get("metrics", {})
        .get("collision_after_compensation", {})
        .get("torso_collision_attribution", {})
    )
    region_counts = attribution.get("counts_by_moving_region", {})
    expected_focused = region_counts.get("forearm")
    excluded_hand = int(region_counts.get("hand", 0))
    return ResolvedSourcePose(
        source_record=record,
        arm_candidate_id=str(arm_candidate_id),
        compensation=compensation,
        expected_focused_overlap=(
            int(expected_focused) if expected_focused is not None else None
        ),
        excluded_hand_overlap=excluded_hand,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--source-static-metrics", type=Path, required=True)
    parser.add_argument("--source-candidate-id", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--overwrite-run", action="store_true")
    parser.add_argument("--epsilon", type=float, default=DEFAULT_EPSILON)
    parser.add_argument("--max-iterations", type=int, default=DEFAULT_MAX_ITERATIONS)
    parser.add_argument(
        "--diffusion-iterations", type=int, default=DEFAULT_DIFFUSION_ITERATIONS
    )
    parser.add_argument("--diffusion-decay", type=float, default=DEFAULT_DIFFUSION_DECAY)
    parser.add_argument("--max-local-step", type=float, default=DEFAULT_MAX_LOCAL_STEP)
    parser.add_argument("--safety-margin", type=float)
    parser.add_argument("--support-rings", type=int, default=3)
    return parser


def _script_args(argv: Sequence[str]) -> list[str]:
    values = list(argv)
    return values[values.index("--") + 1 :] if "--" in values else values


def parse_args(argv: Sequence[str] | None = None) -> Config:
    namespace = _parser().parse_args(_script_args(sys.argv[1:] if argv is None else argv))
    source_blend = namespace.source_blend.resolve()
    source_metrics = namespace.source_static_metrics.resolve()
    output_dir = namespace.output_dir.resolve()
    if not source_blend.is_file() or source_blend.suffix.lower() != ".blend":
        raise ValueError(f"Source blend does not exist or is not .blend: {source_blend}")
    if not source_metrics.is_file():
        raise ValueError(f"Source static metrics do not exist: {source_metrics}")
    if not SOURCE_ID_PATTERN.fullmatch(namespace.source_candidate_id):
        raise ValueError(f"Invalid source candidate ID: {namespace.source_candidate_id!r}")
    metrics = json.loads(source_metrics.read_text(encoding="utf-8"))
    find_source_candidate(metrics, namespace.source_candidate_id)
    paths = run_paths(output_dir, namespace.run_id)
    if not namespace.overwrite_run:
        existing = next((path for path in (paths.final, paths.temporary) if path.exists()), None)
        if existing is not None:
            raise ValueError(f"Morph run already exists: {existing}")
    if namespace.epsilon <= 0.0 or not math.isfinite(namespace.epsilon):
        raise ValueError("Epsilon must be finite and positive")
    if namespace.max_iterations <= 0 or namespace.diffusion_iterations < 0:
        raise ValueError("Iteration counts must be valid")
    if not 0.0 <= namespace.diffusion_decay <= 1.0:
        raise ValueError("Diffusion decay must be in [0, 1]")
    if namespace.max_local_step <= 0.0:
        raise ValueError("Maximum local step must be positive")
    if namespace.safety_margin is not None and namespace.safety_margin <= 0.0:
        raise ValueError("Safety margin must be positive")
    if namespace.support_rings < 0 or namespace.support_rings > 8:
        raise ValueError("Support rings must be between 0 and 8")
    return Config(
        source_blend=source_blend,
        source_static_metrics=source_metrics,
        source_candidate_id=namespace.source_candidate_id,
        output_dir=output_dir,
        run_id=namespace.run_id,
        overwrite_run=namespace.overwrite_run,
        epsilon=float(namespace.epsilon),
        max_iterations=int(namespace.max_iterations),
        diffusion_iterations=int(namespace.diffusion_iterations),
        diffusion_decay=float(namespace.diffusion_decay),
        max_local_step=float(namespace.max_local_step),
        safety_margin=(
            float(namespace.safety_margin) if namespace.safety_margin is not None else None
        ),
        support_rings=int(namespace.support_rings),
    )


def weighted_vertex_indices(
    memberships: dict[int, Sequence[tuple[int, float]]],
    allowed_group_indices: set[int],
    minimum_weight: float,
) -> set[int]:
    return {
        int(vertex_index)
        for vertex_index, groups in memberships.items()
        if any(
            int(group_index) in allowed_group_indices and float(weight) > minimum_weight
            for group_index, weight in groups
        )
    }


def allowed_adjacency_and_boundary(
    allowed: set[int], edges: Sequence[Sequence[int]]
) -> tuple[dict[int, set[int]], set[int]]:
    adjacency = {int(index): set() for index in allowed}
    boundary = set()
    for edge in edges:
        first, second = (int(value) for value in edge)
        first_allowed = first in allowed
        second_allowed = second in allowed
        if first_allowed and second_allowed:
            adjacency[first].add(second)
            adjacency[second].add(first)
        elif first_allowed:
            boundary.add(first)
        elif second_allowed:
            boundary.add(second)
    return adjacency, boundary


def expand_topology_support(
    *, core: set[int], eligible: set[int], edges: Sequence[Sequence[int]], rings: int
) -> set[int]:
    adjacency = {index: set() for index in eligible}
    for edge in edges:
        first, second = (int(value) for value in edge)
        if first in eligible and second in eligible:
            adjacency[first].add(second)
            adjacency[second].add(first)
    expanded = set(core) & set(eligible)
    frontier = set(expanded)
    for _ in range(int(rings)):
        frontier = {
            neighbor
            for index in frontier
            for neighbor in adjacency[index]
            if neighbor not in expanded
        }
        expanded.update(frontier)
        if not frontier:
            break
    return expanded


def _add(a, b):
    return tuple(float(x) + float(y) for x, y in zip(a, b, strict=True))


def _scale(value, factor: float):
    return tuple(float(component) * float(factor) for component in value)


def diffuse_world_displacements(
    seeds: dict[int, Sequence[float]],
    adjacency: dict[int, set[int]],
    *,
    fixed: set[int],
    iterations: int,
    decay: float,
) -> dict[int, tuple[float, float, float]]:
    zero = (0.0, 0.0, 0.0)
    seed_values = {int(index): tuple(float(v) for v in value) for index, value in seeds.items()}
    result = {index: zero for index in adjacency}
    result.update({index: value for index, value in seed_values.items() if index not in fixed})
    for index in fixed:
        if index in result:
            result[index] = zero
    for _ in range(iterations):
        updated = dict(result)
        for index, neighbors in adjacency.items():
            if index in fixed or index in seed_values or not neighbors:
                continue
            total = zero
            for neighbor in neighbors:
                total = _add(total, result.get(neighbor, zero))
            updated[index] = _scale(total, decay / len(neighbors))
        result = updated
    return result


def jacobians_from_batch_samples(
    base: dict[int, Sequence[float]],
    samples: dict[str, dict[int, Sequence[float]]],
    *,
    epsilon: float,
) -> dict[int, tuple[tuple[float, float, float], ...]]:
    if epsilon <= 0.0:
        raise ValueError("Epsilon must be positive")
    result = {}
    for index, origin in base.items():
        columns = []
        for axis in "xyz":
            point = samples[axis][index]
            columns.append(
                tuple(
                    (float(point[row]) - float(origin[row])) / epsilon
                    for row in range(3)
                )
            )
        result[index] = tuple(
            tuple(columns[column][row] for column in range(3))
            for row in range(3)
        )
    return result


def solve_local_delta(
    jacobian: Sequence[Sequence[float]], world_delta: Sequence[float]
) -> tuple[float, float, float]:
    a, b, c = (tuple(float(v) for v in row) for row in jacobian)
    determinant = (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
    )
    if not math.isfinite(determinant) or abs(determinant) <= 1.0e-10:
        raise ValueError("Shape-key Jacobian is singular")
    inverse = (
        (
            (b[1] * c[2] - b[2] * c[1]) / determinant,
            (a[2] * c[1] - a[1] * c[2]) / determinant,
            (a[1] * b[2] - a[2] * b[1]) / determinant,
        ),
        (
            (b[2] * c[0] - b[0] * c[2]) / determinant,
            (a[0] * c[2] - a[2] * c[0]) / determinant,
            (a[2] * b[0] - a[0] * b[2]) / determinant,
        ),
        (
            (b[0] * c[1] - b[1] * c[0]) / determinant,
            (a[1] * c[0] - a[0] * c[1]) / determinant,
            (a[0] * b[1] - a[1] * b[0]) / determinant,
        ),
    )
    return tuple(
        sum(inverse[row][column] * float(world_delta[column]) for column in range(3))
        for row in range(3)
    )


def outward_push_distance(
    signed_distance: float, safety_margin: float, *, intersecting: bool
) -> float:
    required = float(safety_margin) - float(signed_distance)
    if required > 0.0:
        return required
    return float(safety_margin) * 0.5 if intersecting else 0.0


def morph_quality_reasons(
    *, shape_evidence: dict, max_world_displacement: float, median_mesh_edge: float
) -> tuple[str, ...]:
    reasons = list(shape_evidence.get("reasons", ()))
    displacement = float(max_world_displacement)
    edge = float(median_mesh_edge)
    if not math.isfinite(displacement) or displacement < 0.0:
        reasons.append("Morph world displacement is non-finite")
    elif edge <= 0.0 or not math.isfinite(edge):
        reasons.append("Morph mesh-edge reference is invalid")
    elif displacement > edge * 3.0:
        reasons.append("Morph moves a vertex more than three median mesh edges")
    return tuple(dict.fromkeys(reasons))


def minimum_clear_scale(is_collision_free, *, steps: int = 12) -> float:
    if not is_collision_free(1.0):
        raise ValueError("The full morph must be collision free before scale search")
    low = 0.0
    high = 1.0
    for _ in range(int(steps)):
        middle = (low + high) * 0.5
        if is_collision_free(middle):
            high = middle
        else:
            low = middle
    return high


def laplacian_smooth_deltas(
    deltas: dict[int, Sequence[float]],
    adjacency: dict[int, set[int]],
    *,
    fixed: set[int],
    iterations: int,
    strength: float,
) -> dict[int, tuple[float, float, float]]:
    values = {index: tuple(float(v) for v in delta) for index, delta in deltas.items()}
    blend = float(strength)
    if not 0.0 <= blend <= 1.0:
        raise ValueError("Smoothing strength must be in [0, 1]")
    zero = (0.0, 0.0, 0.0)
    for _ in range(int(iterations)):
        updated = dict(values)
        for index, neighbors in adjacency.items():
            if index in fixed or not neighbors:
                updated[index] = zero if index in fixed else values[index]
                continue
            average = tuple(
                sum(values[neighbor][axis] for neighbor in neighbors) / len(neighbors)
                for axis in range(3)
            )
            updated[index] = tuple(
                values[index][axis] * (1.0 - blend) + average[axis] * blend
                for axis in range(3)
            )
        values = updated
    return values


def _require_blender() -> None:
    if bpy is None or Vector is None or Matrix is None:
        raise RuntimeError("This operation must run inside Blender Python")


def _same_path(first: Path, second: Path) -> bool:
    return str(first.resolve()).casefold() == str(second.resolve()).casefold()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _basis_hash(key_block) -> str:
    digest = hashlib.sha256()
    for point in key_block.data:
        for value in point.co:
            digest.update(float(value).hex().encode("ascii"))
    return digest.hexdigest()


def _candidate_from_grid(source_id: str):
    matches = [item for item in poc.static_candidate_grid() if item.candidate_id == source_id]
    if len(matches) != 1:
        raise RuntimeError(f"Candidate grid cannot reconstruct {source_id}: {len(matches)} matches")
    return matches[0]


def _ensure_shape_key(mesh):
    if mesh.data.shape_keys is None:
        basis = mesh.shape_key_add(name="Basis", from_mix=False)
    else:
        basis = mesh.data.shape_keys.key_blocks[0]
    key_blocks = mesh.data.shape_keys.key_blocks
    target = key_blocks.get(SHAPE_KEY_NAME)
    if target is None:
        target = mesh.shape_key_add(name=SHAPE_KEY_NAME, from_mix=False)
    mesh.data.shape_keys.use_relative = True
    target.relative_key = basis
    target.vertex_group = ""
    for index in range(len(basis.data)):
        target.data[index].co = basis.data[index].co
    target.value = 0.0
    target.slider_min = 0.0
    target.slider_max = 1.0
    mesh.data.update()
    bpy.context.view_layer.update()
    return basis, target


def _mesh_memberships(mesh) -> dict[int, tuple[tuple[int, float], ...]]:
    return {
        int(vertex.index): tuple(
            (int(group.group), float(group.weight)) for group in vertex.groups
        )
        for vertex in mesh.data.vertices
    }


def _morph_geometry(mesh, base_geometry, allowed: set[int]):
    sleeve_records = poc._polygon_records(
        mesh,
        allowed,
        set(),
        region_resolver=lambda _vertices: "forearm",
        group_names=ALLOWED_VERTEX_GROUPS,
    )
    upper_chest_records = tuple(
        record
        for record in base_geometry["torso_face_records"]
        if record["group"] == "上半身2"
    )
    if not sleeve_records or not upper_chest_records:
        raise RuntimeError("Sleeve or upper-chest surface records are empty")
    geometry = dict(base_geometry)
    geometry["moving_face_records"] = sleeve_records
    geometry["moving_faces"] = tuple(record["vertices"] for record in sleeve_records)
    geometry["torso_face_records"] = upper_chest_records
    geometry["torso_faces"] = tuple(record["vertices"] for record in upper_chest_records)
    return geometry


def _collision_state(mesh, geometry):
    vertices = poc._evaluated_world_vertices(mesh)
    sleeve_tree = poc._bvh(vertices, geometry["moving_faces"])
    torso_tree = poc._bvh(vertices, geometry["torso_faces"])
    overlaps = tuple(sleeve_tree.overlap(torso_tree))
    severity = poc._collision_severity_evidence(mesh, geometry, vertices, overlaps)
    return vertices, overlaps, severity, torso_tree


def _batch_world_jacobians(mesh, key_block, indices: set[int], epsilon: float):
    ordered = tuple(sorted(indices))
    base_vectors = poc._evaluated_world_vertex_subset(mesh, ordered)
    base = {index: tuple(float(value) for value in point) for index, point in base_vectors.items()}
    samples = {}
    for axis_index, axis_name in enumerate("xyz"):
        for index in ordered:
            key_block.data[index].co[axis_index] += epsilon
        mesh.data.update()
        bpy.context.view_layer.update()
        evaluated = poc._evaluated_world_vertex_subset(mesh, ordered)
        samples[axis_name] = {
            index: tuple(float(value) for value in point) for index, point in evaluated.items()
        }
        for index in ordered:
            key_block.data[index].co[axis_index] -= epsilon
        mesh.data.update()
        bpy.context.view_layer.update()
    return jacobians_from_batch_samples(base, samples, epsilon=epsilon)


def _projection_seeds(
    vertices,
    overlap_pairs,
    geometry,
    torso_tree,
    movable: set[int],
    safety_margin: float,
):
    seeds = {}
    source_vertices = {
        int(vertex_index)
        for moving_index, _target_index in overlap_pairs
        for vertex_index in geometry["moving_faces"][int(moving_index)]
        if int(vertex_index) in movable
    }
    for index in source_vertices:
        nearest, normal, _polygon_index, _distance = torso_tree.find_nearest(vertices[index])
        if nearest is None or normal is None or normal.length_squared <= 1.0e-12:
            continue
        normal = normal.normalized()
        signed_distance = (vertices[index] - nearest).dot(normal)
        required = outward_push_distance(
            signed_distance, safety_margin, intersecting=False
        )
        if required > 0.0:
            seeds[index] = tuple(float(value) for value in normal * required)
    # Triangle edges can still intersect after all face vertices clear the margin.
    # A centroid-based fallback keeps a small outward push until BVH overlap is gone.
    for moving_index, _target_index in overlap_pairs:
        face_vertices = geometry["moving_faces"][int(moving_index)]
        movable_vertices = [int(index) for index in face_vertices if int(index) in movable]
        if not movable_vertices:
            continue
        centroid = sum((vertices[index] for index in face_vertices), Vector()) / len(
            face_vertices
        )
        nearest, normal, _polygon_index, _distance = torso_tree.find_nearest(centroid)
        if nearest is None or normal is None or normal.length_squared <= 1.0e-12:
            continue
        normal = normal.normalized()
        signed_distance = (centroid - nearest).dot(normal)
        correction = normal * outward_push_distance(
            signed_distance, safety_margin, intersecting=True
        )
        for index in movable_vertices:
            previous = Vector(seeds.get(index, (0.0, 0.0, 0.0)))
            if correction.length > previous.length:
                seeds[index] = tuple(float(value) for value in correction)
    return seeds


def _clamped_vector(values: Sequence[float], maximum_length: float):
    vector = Vector(values)
    if not all(math.isfinite(float(value)) for value in vector):
        raise RuntimeError("Morph correction contains a non-finite displacement")
    if vector.length > maximum_length:
        vector.normalize()
        vector *= maximum_length
    return vector


def _render_pair(paths: RunPaths, mesh, severity_before, severity_after):
    evidence = {}
    for label, value, severity, overlay in (
        ("morph0", 0.0, severity_before, None),
        ("morph1", 1.0, severity_after, severity_before),
    ):
        key = mesh.data.shape_keys.key_blocks[SHAPE_KEY_NAME]
        key.value = value
        bpy.context.view_layer.update()
        vertices = poc._evaluated_world_vertices(mesh)
        rendered = poc._render_collision_severity_diagnostic(
            paths.temporary,
            label,
            vertices,
            severity,
            output_directory=RENDER_DIRECTORY,
            overlay_severity=overlay,
        )
        rendered["closeup_A"] = rendered["renders"]["collision_closeup_normal"]
        rendered["closeup_B"] = rendered["renders"]["collision_closeup_marked"]
        evidence[label] = rendered
    return evidence


def run(config: Config) -> dict:
    _require_blender()
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must open the requested source blend: {config.source_blend}")
    source_sha = _file_sha256(config.source_blend)
    source_metrics = json.loads(config.source_static_metrics.read_text(encoding="utf-8"))
    resolved_source = resolve_source_pose(source_metrics, config.source_candidate_id)
    source_record = resolved_source.source_record
    try:
        candidate, referenced_compensation, source_pose_metrics = (
            poc.chin_support_source_reference(
                source_metrics, config.source_candidate_id
            )
        )
    except ValueError:
        if resolved_source.compensation is not None:
            raise
        candidate = _candidate_from_grid(resolved_source.arm_candidate_id)
        referenced_compensation = poc.UpperBodyCompensation(
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        )
        source_pose_metrics = source_record.get("metrics", source_record)
    has_compensation = resolved_source.compensation is not None
    compensation = referenced_compensation if has_compensation else None
    paths = run_paths(config.output_dir, config.run_id)
    if config.overwrite_run:
        for path in (paths.temporary, paths.final):
            if path.exists():
                shutil.rmtree(path)
    paths.temporary.mkdir(parents=True, exist_ok=False)

    armature, mesh = poc._validate_scene_objects()
    controls = poc._existing_controls()
    poc._validate_existing_poc(armature, controls)
    compensation_controls = None
    if compensation is not None:
        compensation_controls = poc._ensure_compensation_controls(armature)
        poc._validate_compensation_baseline(armature, compensation_controls)
    base_geometry = poc._mesh_geometry_sets(mesh)
    context = poc._prepare_static_context(
        armature,
        mesh,
        controls,
        base_geometry,
        poc._load_motion_math(),
        compensation_controls=compensation_controls,
    )
    started = time.perf_counter()
    iterations = []
    try:
        bpy.context.scene.frame_set(poc.VALIDATION_FRAME)
        if compensation is None:
            poc._apply_context_candidate(armature, controls, candidate, context)
        else:
            poc._apply_compensated_state(
                armature, controls, candidate, compensation, context
            )
        basis, morph = _ensure_shape_key(mesh)
        basis_hash_before = _basis_hash(basis)
        allowed_group_indices = {
            mesh.vertex_groups[name].index for name in ALLOWED_VERTEX_GROUPS
        }
        core_allowed = weighted_vertex_indices(
            _mesh_memberships(mesh), allowed_group_indices, poc.MIN_GROUP_WEIGHT
        )
        forearm_group_indices = {
            mesh.vertex_groups[name].index for name in poc.RIGHT_FOREARM_VERTEX_GROUPS
        }
        forearm_eligible = weighted_vertex_indices(
            _mesh_memberships(mesh), forearm_group_indices, poc.MIN_GROUP_WEIGHT
        )
        mesh_edges = tuple(
            tuple(int(index) for index in edge.vertices) for edge in mesh.data.edges
        )
        allowed = expand_topology_support(
            core=core_allowed,
            eligible=forearm_eligible,
            edges=mesh_edges,
            rings=config.support_rings,
        )
        adjacency, boundary = allowed_adjacency_and_boundary(
            allowed,
            mesh_edges,
        )
        movable = allowed - boundary
        if not movable:
            raise RuntimeError("All allowed sleeve vertices are fixed boundary vertices")
        geometry = _morph_geometry(mesh, base_geometry, allowed)
        morph.value = 0.0
        bpy.context.view_layer.update()
        vertices0, overlap0, severity0, _torso0 = _collision_state(mesh, geometry)
        shape0 = poc._capture_sleeve_shape(vertices0, geometry["moving_faces"])
        if (
            config.support_rings == 0
            and
            resolved_source.expected_focused_overlap is not None
            and len(overlap0) != resolved_source.expected_focused_overlap
        ):
            raise RuntimeError(
                "Reconstructed focused overlap does not match source metrics: "
                f"{len(overlap0)} != {resolved_source.expected_focused_overlap}"
            )
        middle_indices = poc._vertices_for_groups(
            mesh, poc._group_indices(mesh, ("右中指３",))
        )
        middle_before = poc._evaluated_world_vertex_subset(mesh, middle_indices)
        morph.value = 1.0
        bpy.context.view_layer.update()
        vertices, overlaps, severity, torso_tree = _collision_state(mesh, geometry)
        model_edge = float(severity0["model_median_mesh_edge_blender"])
        safety_margin = config.safety_margin or max(0.0025, model_edge * 0.25)

        for iteration_index in range(config.max_iterations):
            record = {
                "iteration": iteration_index,
                "overlap_before": len(overlaps),
                "seed_count": 0,
                "solved_vertex_count": 0,
                "singular_vertex_count": 0,
                "max_world_request": 0.0,
                "max_local_step": 0.0,
            }
            if not overlaps:
                record["overlap_after"] = 0
                iterations.append(record)
                break
            seeds = _projection_seeds(
                vertices, overlaps, geometry, torso_tree, movable, safety_margin
            )
            record["seed_count"] = len(seeds)
            if not seeds:
                record["failure"] = "No movable overlap vertex has a valid outward projection"
                record["overlap_after"] = len(overlaps)
                iterations.append(record)
                break
            world_requests = diffuse_world_displacements(
                seeds,
                adjacency,
                fixed=boundary,
                iterations=config.diffusion_iterations,
                decay=config.diffusion_decay,
            )
            active = {
                index
                for index, value in world_requests.items()
                if index in movable and sum(component * component for component in value) > 1.0e-16
            }
            jacobians = _batch_world_jacobians(mesh, morph, active, config.epsilon)
            for index in sorted(active):
                request = Vector(world_requests[index])
                record["max_world_request"] = max(
                    record["max_world_request"], float(request.length)
                )
                try:
                    local = solve_local_delta(jacobians[index], request)
                except ValueError:
                    record["singular_vertex_count"] += 1
                    continue
                local_vector = _clamped_vector(local, config.max_local_step)
                morph.data[index].co += local_vector
                record["max_local_step"] = max(
                    record["max_local_step"], float(local_vector.length)
                )
                record["solved_vertex_count"] += 1
            local_deltas = {
                index: tuple(morph.data[index].co - basis.data[index].co)
                for index in allowed
            }
            smoothed = laplacian_smooth_deltas(
                local_deltas,
                adjacency,
                fixed=boundary,
                iterations=1,
                strength=0.05,
            )
            for index, delta in smoothed.items():
                morph.data[index].co = basis.data[index].co + Vector(delta)
            mesh.data.update()
            bpy.context.view_layer.update()
            vertices, overlaps, severity, torso_tree = _collision_state(mesh, geometry)
            record["overlap_after"] = len(overlaps)
            iterations.append(record)
            if record["solved_vertex_count"] == 0:
                record["failure"] = "All active shape-key Jacobians were singular"
                break

        solved_deltas = {
            index: (morph.data[index].co - basis.data[index].co).copy()
            for index in allowed
        }

        def apply_scale(scale: float):
            for index, delta in solved_deltas.items():
                morph.data[index].co = basis.data[index].co + delta * scale
            mesh.data.update()
            bpy.context.view_layer.update()
            return _collision_state(mesh, geometry)

        full_overlap = apply_scale(1.0)[1]
        if full_overlap:
            minimum_scale = 1.0
            selected_scale = 1.0
        else:
            minimum_scale = minimum_clear_scale(
                lambda scale: not apply_scale(scale)[1], steps=12
            )
            selected_scale = min(1.0, minimum_scale + 0.01)
        vertices1, overlap1, severity1, _torso1 = apply_scale(selected_scale)
        shape1 = poc._capture_sleeve_shape(vertices1, geometry["moving_faces"])
        shape_evidence = poc._sleeve_shape_evidence(shape0, shape1)
        max_world_displacement = max(
            ((vertices1[index] - vertices0[index]).length for index in allowed),
            default=0.0,
        )
        quality_reasons = morph_quality_reasons(
            shape_evidence=shape_evidence,
            max_world_displacement=max_world_displacement,
            median_mesh_edge=float(severity0["model_median_mesh_edge_blender"]),
        )
        middle_after = poc._evaluated_world_vertex_subset(mesh, middle_indices)
        middle_max_drift = max(
            (
                (middle_after[index] - middle_before[index]).length
                for index in middle_indices
            ),
            default=0.0,
        )
        basis_hash_after = _basis_hash(basis)
        disallowed_changes = [
            index
            for index in range(len(basis.data))
            if index not in allowed and (morph.data[index].co - basis.data[index].co).length > 1.0e-9
        ]
        if basis_hash_before != basis_hash_after:
            raise RuntimeError("Basis shape key changed during morph solve")
        if disallowed_changes:
            raise RuntimeError("Morph changed vertices outside the corrective weight groups")
        if middle_max_drift > 1.0e-8:
            raise RuntimeError(
                f"Morph moved excluded middle-finger vertices by {middle_max_drift}"
            )
        render_evidence = _render_pair(paths, mesh, severity0, severity1)
        status = "PASS" if not overlap1 and not quality_reasons else "FAIL"
        failure_reasons = list(quality_reasons)
        if overlap1:
            failure_reasons.append(
                f"Focused sleeve/upper-chest overlap remains {len(overlap1)}"
            )
        metrics = {
            "mode": "sleeve-corrective-morph-poc",
            "status": status,
            "failure_reasons": failure_reasons,
            "run_id": config.run_id,
            "frame": poc.VALIDATION_FRAME,
            "source_blend": str(config.source_blend),
            "source_blend_sha256_before": source_sha,
            "source_blend_saved": False,
            "source_static_metrics": str(config.source_static_metrics),
            "source_candidate_id": config.source_candidate_id,
            "arm_source_candidate_id": resolved_source.arm_candidate_id,
            "source_pose_type": (
                "upper_body_compensation" if compensation is not None else "arm_candidate"
            ),
            "source_candidate_record": source_record,
            "source_pose_metrics": source_pose_metrics,
            "source_compensation": resolved_source.compensation,
            "shape_key": {
                "name": SHAPE_KEY_NAME,
                "basis_hash_before": basis_hash_before,
                "basis_hash_after": basis_hash_after,
                "basis_unchanged": basis_hash_before == basis_hash_after,
                "allowed_vertex_groups": ALLOWED_VERTEX_GROUPS,
                "core_allowed_vertex_count": len(core_allowed),
                "support_rings": config.support_rings,
                "allowed_vertex_count": len(allowed),
                "fixed_boundary_vertex_count": len(boundary),
                "movable_vertex_count": len(movable),
                "changed_vertex_count": sum(
                    (morph.data[index].co - basis.data[index].co).length > 1.0e-9
                    for index in allowed
                ),
                "disallowed_changed_vertex_count": len(disallowed_changes),
                "excluded_middle_finger_vertex_count": len(middle_indices),
                "excluded_middle_finger_max_world_drift": middle_max_drift,
                "max_world_displacement": max_world_displacement,
                "shape_evidence": shape_evidence,
                "quality_reasons": quality_reasons,
                "minimum_collision_free_scale": minimum_scale,
                "selected_scale": selected_scale,
            },
            "solver": {
                "epsilon": config.epsilon,
                "epsilon_strategy": "batch all active vertices for each local XYZ axis",
                "safety_margin_blender": safety_margin,
                "safety_margin_derivation": (
                    "explicit CLI value" if config.safety_margin is not None
                    else "max(0.0025, 0.25 * model median evaluated edge length)"
                ),
                "max_iterations": config.max_iterations,
                "diffusion_iterations": config.diffusion_iterations,
                "diffusion_decay": config.diffusion_decay,
                "max_local_step": config.max_local_step,
                "iterations": iterations,
            },
            "collision": {
                "focused_overlap_before": len(overlap0),
                "focused_overlap_after": len(overlap1),
                "expected_focused_overlap": resolved_source.expected_focused_overlap,
                "excluded_source_hand_overlap": resolved_source.excluded_hand_overlap,
                "severity_before": severity0,
                "severity_after": severity1,
            },
            "render_evidence": render_evidence,
            "duration_seconds": time.perf_counter() - started,
            "exports": {"pmx": False, "vmd": False},
        }
        metrics_path = paths.temporary / METRICS_NAME
        metrics_path.write_text(
            json.dumps(metrics, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False)
            + "\n",
            encoding="utf-8",
        )
        expected = [metrics_path]
        expected.extend(
            paths.temporary / relative
            for evidence in render_evidence.values()
            for relative in evidence["renders"].values()
        )
        missing = [str(path) for path in expected if not path.is_file()]
        if missing:
            raise RuntimeError("Morph POC is missing artifacts: " + ", ".join(missing))
        if paths.final.exists():
            shutil.rmtree(paths.final)
        paths.temporary.rename(paths.final)
        return metrics
    finally:
        poc._restore_static_control_state(
            armature,
            controls,
            context["baseline_state"],
            compensation_controls,
        )


def main(argv: Sequence[str] | None = None) -> int:
    config = parse_args(argv)
    metrics = run(config)
    print(
        "POC_SLEEVE_MORPH_COMPLETE",
        {
            "run_id": config.run_id,
            "status": metrics["status"],
            "overlap_before": metrics["collision"]["focused_overlap_before"],
            "overlap_after": metrics["collision"]["focused_overlap_after"],
            "metrics": str(run_paths(config.output_dir, config.run_id).metrics),
        },
    )
    return 0 if metrics["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
