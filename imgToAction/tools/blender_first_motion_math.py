"""Pure-Python geometry and anatomical scoring for the Blender-first arm POC.

Vectors are represented as three-item tuples. This module intentionally has no
dependency on Blender's ``bpy`` or ``mathutils`` modules so candidate geometry
can be tested and ranked outside Blender.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable, Mapping


Vector = tuple[float, float, float]
EPSILON = 1e-9

# Elbow comfort matches the thinking-motion G13 acceptance range. A signed
# angle below zero represents reversal; 175 degrees guards near-hyperextension.
ELBOW_HARD_MIN_DEG = 0.0
ELBOW_HARD_MAX_DEG = 175.0
ELBOW_COMFORT_MIN_DEG = 55.0
ELBOW_COMFORT_MAX_DEG = 100.0

# G17 rejects wrist bends above 55 degrees. The lower comfort bound keeps the
# visible wrist close to neutral before the hard visual break occurs.
WRIST_SWING_COMFORT_MAX_DEG = 35.0
WRIST_SWING_HARD_MAX_DEG = 55.0

# Axial forearm rotation should carry palm orientation without approaching an
# implausible full quarter turn. Remaining requested twist is left to the wrist.
FOREARM_TWIST_COMFORT_MAX_DEG = 45.0
FOREARM_TWIST_HARD_MAX_DEG = 80.0

WRIST_TWIST_COMFORT_MAX_DEG = 20.0
WRIST_TWIST_HARD_MAX_DEG = 40.0
SIGNED_ELBOW_FLEX_MIN_DEG = -150.0
SIGNED_ELBOW_FLEX_MAX_DEG = -5.0
CONTACT_COMFORT_DISTANCE = 0.008
CONTACT_WARNING_DISTANCE = 0.03
CONTACT_HARD_MAX_DISTANCE = 0.068
CONTACT_SCALE = 0.02
CLEARANCE_COMFORT_DISTANCE = 0.004
CONTINUITY_COMFORT_DISTANCE = 0.025
CONTINUITY_HARD_DISTANCE = 0.12
HARD_REJECTION_PENALTY = 1_000_000.0
ELBOW_SCORE_WEIGHT = 200.0

CONTINUITY_FLIP_PENALTY = 10.0


class UnreachableTargetError(ValueError):
    """Raised when strict two-bone reach is requested for an invalid target."""


@dataclass(frozen=True)
class ReachResult:
    root: Vector
    requested_target: Vector
    end: Vector
    reachable: bool
    clamped: bool
    original_distance: float
    solved_distance: float
    min_reach: float
    max_reach: float


@dataclass(frozen=True)
class TwoBoneSolution:
    root: Vector
    elbow: Vector
    end: Vector
    reach: ReachResult


@dataclass(frozen=True)
class TwistAllocation:
    requested_twist_deg: float
    forearm_twist_deg: float
    wrist_twist_deg: float


@dataclass(frozen=True)
class AnatomyScore:
    valid: bool
    total_penalty: float
    component_penalties: dict[str, float]
    measurements: dict[str, float]
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class StaticCandidateScore:
    valid: bool
    verdict: str
    total_score: float
    component_penalties: dict[str, float]
    measurements: dict[str, float | int | bool]
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class TriangleProjection:
    point: Vector
    distance: float
    barycentric: tuple[float, float, float]


@dataclass(frozen=True)
class ContactBand:
    mesh_resolution: float
    target_distance: float
    warning_distance: float
    hard_max_distance: float
    region_radius: float


def _vector(value: Iterable[float]) -> Vector:
    components = tuple(float(component) for component in value)
    if len(components) != 3:
        raise ValueError("Expected a three-component vector")
    if not all(math.isfinite(component) for component in components):
        raise ValueError("Vector components must be finite")
    return components


def vector_add(left: Iterable[float], right: Iterable[float]) -> Vector:
    a = _vector(left)
    b = _vector(right)
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vector_subtract(left: Iterable[float], right: Iterable[float]) -> Vector:
    a = _vector(left)
    b = _vector(right)
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vector_scale(value: Iterable[float], scale: float) -> Vector:
    vector = _vector(value)
    scalar = float(scale)
    if not math.isfinite(scalar):
        raise ValueError("Scale must be finite")
    return (vector[0] * scalar, vector[1] * scalar, vector[2] * scalar)


def dot(left: Iterable[float], right: Iterable[float]) -> float:
    a = _vector(left)
    b = _vector(right)
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(left: Iterable[float], right: Iterable[float]) -> Vector:
    a = _vector(left)
    b = _vector(right)
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def length(value: Iterable[float]) -> float:
    vector = _vector(value)
    return math.sqrt(dot(vector, vector))


def normalize(value: Iterable[float]) -> Vector:
    vector = _vector(value)
    magnitude = length(vector)
    if magnitude <= EPSILON:
        raise ValueError("Cannot normalize a zero-length vector")
    return vector_scale(vector, 1.0 / magnitude)


def required_surface_push(
    *,
    point: Iterable[float],
    surface_point: Iterable[float],
    outward_normal: Iterable[float],
    safety_margin: float,
) -> Vector:
    """Return the smallest normal displacement that clears a surface margin."""

    normal = normalize(outward_normal)
    margin = float(safety_margin)
    if not math.isfinite(margin) or margin < 0.0:
        raise ValueError("Safety margin must be finite and non-negative")
    signed_clearance = dot(vector_subtract(point, surface_point), normal)
    missing_clearance = margin - signed_clearance
    if missing_clearance <= 0.0:
        return (0.0, 0.0, 0.0)
    return vector_scale(normal, missing_clearance)


def smooth_corrective_displacements(
    *,
    adjacency: Mapping[int, Iterable[int]],
    allowed_vertices: Iterable[int],
    core_displacements: Mapping[int, Iterable[float]],
    propagation_rings: int,
    iterations: int = 60,
) -> dict[int, Vector]:
    """Diffuse fixed corrective deltas while pinning the outer topology ring."""

    allowed = {int(index) for index in allowed_vertices}
    core = {
        int(index): _vector(displacement)
        for index, displacement in core_displacements.items()
    }
    if not core:
        return {}
    if not set(core).issubset(allowed):
        raise ValueError("Corrective core must be contained by allowed vertices")
    rings = int(propagation_rings)
    if rings < 1:
        raise ValueError("Propagation rings must be at least one")
    relaxation_steps = int(iterations)
    if relaxation_steps < 1:
        raise ValueError("Iterations must be at least one")

    distance = {index: 0 for index in core}
    frontier = set(core)
    for ring in range(1, rings + 1):
        next_frontier = {
            int(neighbor)
            for index in frontier
            for neighbor in adjacency.get(index, ())
            if int(neighbor) in allowed and int(neighbor) not in distance
        }
        for index in next_frontier:
            distance[index] = ring
        frontier = next_frontier
        if not frontier:
            break

    active = set(distance)
    boundary = {index for index, ring in distance.items() if ring == rings}
    zero = (0.0, 0.0, 0.0)
    field = {index: core.get(index, zero) for index in active}
    fixed = set(core) | boundary
    for _ in range(relaxation_steps):
        updated = dict(field)
        for index in active - fixed:
            neighbors = [
                int(neighbor)
                for neighbor in adjacency.get(index, ())
                if int(neighbor) in active
            ]
            if not neighbors:
                continue
            count = float(len(neighbors))
            updated[index] = tuple(
                sum(field[neighbor][axis] for neighbor in neighbors) / count
                for axis in range(3)
            )
        field = updated
    return field


def closest_point_on_triangle(
    point: Iterable[float],
    first: Iterable[float],
    second: Iterable[float],
    third: Iterable[float],
) -> TriangleProjection:
    """Project a point onto a non-degenerate triangle, including its boundary."""

    p = _vector(point)
    a = _vector(first)
    b = _vector(second)
    c = _vector(third)
    ab = vector_subtract(b, a)
    ac = vector_subtract(c, a)
    if length(cross(ab, ac)) <= EPSILON:
        raise ValueError("Triangle must be non-degenerate")

    ap = vector_subtract(p, a)
    d1 = dot(ab, ap)
    d2 = dot(ac, ap)
    if d1 <= 0.0 and d2 <= 0.0:
        closest = a
        barycentric = (1.0, 0.0, 0.0)
    else:
        bp = vector_subtract(p, b)
        d3 = dot(ab, bp)
        d4 = dot(ac, bp)
        if d3 >= 0.0 and d4 <= d3:
            closest = b
            barycentric = (0.0, 1.0, 0.0)
        else:
            vc = d1 * d4 - d3 * d2
            if vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
                v = d1 / (d1 - d3)
                closest = vector_add(a, vector_scale(ab, v))
                barycentric = (1.0 - v, v, 0.0)
            else:
                cp = vector_subtract(p, c)
                d5 = dot(ab, cp)
                d6 = dot(ac, cp)
                if d6 >= 0.0 and d5 <= d6:
                    closest = c
                    barycentric = (0.0, 0.0, 1.0)
                else:
                    vb = d5 * d2 - d1 * d6
                    if vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
                        w = d2 / (d2 - d6)
                        closest = vector_add(a, vector_scale(ac, w))
                        barycentric = (1.0 - w, 0.0, w)
                    else:
                        va = d3 * d6 - d5 * d4
                        if va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
                            edge = vector_subtract(c, b)
                            w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
                            closest = vector_add(b, vector_scale(edge, w))
                            barycentric = (0.0, 1.0 - w, w)
                        else:
                            denominator = 1.0 / (va + vb + vc)
                            v = vb * denominator
                            w = vc * denominator
                            closest = vector_add(a, vector_add(vector_scale(ab, v), vector_scale(ac, w)))
                            barycentric = (1.0 - v - w, v, w)

    return TriangleProjection(
        point=closest,
        distance=length(vector_subtract(p, closest)),
        barycentric=barycentric,
    )


def derive_contact_band(local_edge_lengths: Iterable[float]) -> ContactBand:
    """Derive contact thresholds from the median lower-chin triangle edge length."""

    edges = sorted(float(value) for value in local_edge_lengths)
    if not edges or not all(math.isfinite(value) and value > 0.0 for value in edges):
        raise ValueError("Local mesh edge lengths must be finite and positive")
    midpoint = len(edges) // 2
    resolution = (
        edges[midpoint]
        if len(edges) % 2
        else (edges[midpoint - 1] + edges[midpoint]) * 0.5
    )
    return ContactBand(
        mesh_resolution=resolution,
        target_distance=resolution * 1.5,
        warning_distance=resolution * 2.0,
        hard_max_distance=resolution * 3.0,
        region_radius=resolution * 12.0,
    )


def classify_surface_contact(
    surface_distance: float,
    intersection_count: int,
    band: ContactBand,
) -> tuple[str, tuple[str, ...]]:
    """Classify measured contact without allowing distance to hide penetration."""

    distance = float(surface_distance)
    intersections = int(intersection_count)
    if not math.isfinite(distance) or distance < 0.0:
        return "FAIL", ("surface distance must be finite and non-negative",)
    if intersections > 0:
        return "FAIL", (f"Contact geometry has {intersections} surface intersection(s)",)
    if distance > band.hard_max_distance:
        return "FAIL", (
            f"surface distance {distance:.6f} exceeds hard maximum {band.hard_max_distance:.6f}",
        )
    if distance > band.warning_distance:
        return "WARN", (
            f"surface distance {distance:.6f} exceeds warning distance {band.warning_distance:.6f}",
        )
    return "PASS", ()


def project_onto_plane(value: Iterable[float], plane_normal: Iterable[float]) -> Vector:
    vector = _vector(value)
    normal = normalize(plane_normal)
    return vector_subtract(vector, vector_scale(normal, dot(vector, normal)))


def signed_angle(
    start: Iterable[float],
    end: Iterable[float],
    axis: Iterable[float],
) -> float:
    """Return the signed angle in degrees from ``start`` to ``end`` about ``axis``."""

    axis_unit = normalize(axis)
    start_plane = normalize(project_onto_plane(start, axis_unit))
    end_plane = normalize(project_onto_plane(end, axis_unit))
    sine = dot(axis_unit, cross(start_plane, end_plane))
    cosine = max(-1.0, min(1.0, dot(start_plane, end_plane)))
    return math.degrees(math.atan2(sine, cosine))


def clamped_two_bone_reach(
    root: Iterable[float],
    target: Iterable[float],
    upper_length: float,
    lower_length: float,
    *,
    reject_unreachable: bool = False,
) -> ReachResult:
    """Clamp a target to the closed reach interval, or reject it in strict mode."""

    root_vector = _vector(root)
    target_vector = _vector(target)
    upper = float(upper_length)
    lower = float(lower_length)
    if not math.isfinite(upper) or not math.isfinite(lower) or upper <= 0.0 or lower <= 0.0:
        raise ValueError("Two-bone segment lengths must be finite and positive")

    delta = vector_subtract(target_vector, root_vector)
    target_distance = length(delta)
    min_reach = abs(upper - lower)
    max_reach = upper + lower
    if target_distance <= EPSILON and min_reach <= EPSILON:
        raise UnreachableTargetError(
            "Target is singular because an equal-length two-bone chain has no bend axis at its root"
        )

    solved_distance = min(max(target_distance, min_reach), max_reach)
    clamped = solved_distance != target_distance
    reachable = not clamped
    if clamped and reject_unreachable:
        raise UnreachableTargetError(
            f"Target distance {target_distance:.6g} is outside the two-bone reach interval "
            f"[{min_reach:.6g}, {max_reach:.6g}]"
        )

    if target_distance <= EPSILON:
        direction = (1.0, 0.0, 0.0)
    else:
        direction = vector_scale(delta, 1.0 / target_distance)
    end = vector_add(root_vector, vector_scale(direction, solved_distance))
    return ReachResult(
        root=root_vector,
        requested_target=target_vector,
        end=end,
        reachable=reachable,
        clamped=clamped,
        original_distance=target_distance,
        solved_distance=solved_distance,
        min_reach=min_reach,
        max_reach=max_reach,
    )


def _perpendicular_direction(axis: Vector, preferred: Iterable[float] | None = None) -> Vector:
    if preferred is not None:
        projected = project_onto_plane(preferred, axis)
        if length(projected) > EPSILON:
            return normalize(projected)
    fallback = min(((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), key=lambda basis: abs(dot(axis, basis)))
    return normalize(project_onto_plane(fallback, axis))


def elbow_candidates(
    root: Iterable[float],
    end: Iterable[float],
    upper_length: float,
    lower_length: float,
    pole: Iterable[float] | None = None,
) -> tuple[Vector, Vector]:
    """Return the two mirrored elbow locations for a reachable end point."""

    root_vector = _vector(root)
    end_vector = _vector(end)
    axis_delta = vector_subtract(end_vector, root_vector)
    distance_to_end = length(axis_delta)
    if distance_to_end <= EPSILON:
        raise ValueError("Two-bone end must differ from its root")
    axis = normalize(axis_delta)
    upper = float(upper_length)
    lower = float(lower_length)
    if distance_to_end < abs(upper - lower) - EPSILON or distance_to_end > upper + lower + EPSILON:
        raise UnreachableTargetError("End point must be clamped before computing elbow candidates")

    along = (upper * upper - lower * lower + distance_to_end * distance_to_end) / (2.0 * distance_to_end)
    height = math.sqrt(max(0.0, upper * upper - along * along))
    midpoint = vector_add(root_vector, vector_scale(axis, along))
    preferred = vector_subtract(_vector(pole), root_vector) if pole is not None else None
    perpendicular = _perpendicular_direction(axis, preferred)
    offset = vector_scale(perpendicular, height)
    return vector_add(midpoint, offset), vector_subtract(midpoint, offset)


def elbow_side(
    root: Iterable[float],
    end: Iterable[float],
    elbow: Iterable[float],
    pole: Iterable[float],
) -> float:
    """Return a positive value when the elbow lies on the pole-facing side."""

    root_vector = _vector(root)
    axis = vector_subtract(end, root_vector)
    elbow_offset = project_onto_plane(vector_subtract(elbow, root_vector), axis)
    pole_offset = project_onto_plane(vector_subtract(pole, root_vector), axis)
    return dot(elbow_offset, pole_offset)


def continuity_score(
    candidate: Iterable[float],
    previous: Iterable[float],
    root: Iterable[float],
    end: Iterable[float],
) -> float:
    """Score elbow displacement and strongly penalize a mirrored-plane flip."""

    candidate_vector = _vector(candidate)
    previous_vector = _vector(previous)
    root_vector = _vector(root)
    axis = vector_subtract(end, root_vector)
    displacement = length(vector_subtract(candidate_vector, previous_vector))
    candidate_radial = project_onto_plane(vector_subtract(candidate_vector, root_vector), axis)
    previous_radial = project_onto_plane(vector_subtract(previous_vector, root_vector), axis)
    flipped = length(candidate_radial) > EPSILON and length(previous_radial) > EPSILON and dot(candidate_radial, previous_radial) < 0.0
    return displacement + (CONTINUITY_FLIP_PENALTY if flipped else 0.0)


def select_elbow_candidate(
    candidates: Iterable[Iterable[float]],
    root: Iterable[float],
    end: Iterable[float],
    pole: Iterable[float],
    previous_elbow: Iterable[float] | None = None,
) -> Vector:
    choices = tuple(_vector(candidate) for candidate in candidates)
    if len(choices) != 2:
        raise ValueError("Exactly two elbow candidates are required")

    root_vector = _vector(root)
    axis = vector_subtract(end, root_vector)
    projected_pole = project_onto_plane(vector_subtract(pole, root_vector), axis)
    pool = choices
    if length(projected_pole) > EPSILON:
        pole_facing = tuple(candidate for candidate in choices if elbow_side(root, end, candidate, pole) > EPSILON)
        if pole_facing:
            pool = pole_facing

    def candidate_score(candidate: Vector) -> tuple[float, float]:
        continuity = (
            continuity_score(candidate, previous_elbow, root, end)
            if previous_elbow is not None
            else 0.0
        )
        return continuity, -elbow_side(root, end, candidate, pole)

    return min(pool, key=candidate_score)


def solve_two_bone(
    root: Iterable[float],
    target: Iterable[float],
    upper_length: float,
    lower_length: float,
    pole: Iterable[float],
    *,
    previous_elbow: Iterable[float] | None = None,
    reject_unreachable: bool = False,
) -> TwoBoneSolution:
    reach = clamped_two_bone_reach(
        root,
        target,
        upper_length,
        lower_length,
        reject_unreachable=reject_unreachable,
    )
    candidates = elbow_candidates(reach.root, reach.end, upper_length, lower_length, pole)
    elbow = select_elbow_candidate(candidates, reach.root, reach.end, pole, previous_elbow)
    return TwoBoneSolution(root=reach.root, elbow=elbow, end=reach.end, reach=reach)


def allocate_forearm_twist(requested_twist_deg: float) -> TwistAllocation:
    """Put bounded axial rotation on the forearm and leave excess for the wrist."""

    requested = float(requested_twist_deg)
    if not math.isfinite(requested):
        raise ValueError("Requested twist must be finite")
    forearm = max(-FOREARM_TWIST_HARD_MAX_DEG, min(FOREARM_TWIST_HARD_MAX_DEG, requested))
    return TwistAllocation(requested, forearm, requested - forearm)


def _range_penalty(value: float, comfort_min: float, comfort_max: float, hard_min: float, hard_max: float) -> float:
    if comfort_min <= value <= comfort_max:
        return 0.0
    if value < comfort_min:
        span = max(EPSILON, comfort_min - hard_min)
        return ((comfort_min - value) / span) ** 2
    span = max(EPSILON, hard_max - comfort_max)
    return ((value - comfort_max) / span) ** 2


def _absolute_penalty(value: float, comfort_max: float, hard_max: float) -> float:
    magnitude = abs(value)
    if magnitude <= comfort_max:
        return 0.0
    span = max(EPSILON, hard_max - comfort_max)
    return ((magnitude - comfort_max) / span) ** 2


def score_anatomy(
    elbow_angle_deg: float,
    wrist_swing_deg: float,
    forearm_twist_deg: float,
) -> AnatomyScore:
    """Apply hard validity limits and soft comfort penalties to an arm pose."""

    elbow = float(elbow_angle_deg)
    wrist = float(wrist_swing_deg)
    twist = float(forearm_twist_deg)
    if not all(math.isfinite(value) for value in (elbow, wrist, twist)):
        raise ValueError("Anatomical measurements must be finite")

    penalties = {
        "elbow": _range_penalty(
            elbow,
            ELBOW_COMFORT_MIN_DEG,
            ELBOW_COMFORT_MAX_DEG,
            ELBOW_HARD_MIN_DEG,
            ELBOW_HARD_MAX_DEG,
        ),
        "wrist_swing": _absolute_penalty(wrist, WRIST_SWING_COMFORT_MAX_DEG, WRIST_SWING_HARD_MAX_DEG),
        "forearm_twist": _absolute_penalty(twist, FOREARM_TWIST_COMFORT_MAX_DEG, FOREARM_TWIST_HARD_MAX_DEG),
    }
    reasons: list[str] = []
    valid = True

    if elbow < ELBOW_HARD_MIN_DEG:
        valid = False
        reasons.append(f"Elbow is reversed below the {ELBOW_HARD_MIN_DEG:.0f} degree hard limit")
    elif elbow > ELBOW_HARD_MAX_DEG:
        valid = False
        reasons.append(f"Elbow exceeds the {ELBOW_HARD_MAX_DEG:.0f} degree extension hard limit")
    elif penalties["elbow"] > 0.0:
        reasons.append(
            f"Elbow is outside the {ELBOW_COMFORT_MIN_DEG:.0f}-{ELBOW_COMFORT_MAX_DEG:.0f} degree comfort range"
        )

    if abs(wrist) > WRIST_SWING_HARD_MAX_DEG:
        valid = False
        reasons.append(f"Wrist swing exceeds the {WRIST_SWING_HARD_MAX_DEG:.0f} degree hard limit")
    elif penalties["wrist_swing"] > 0.0:
        reasons.append(f"Wrist swing is outside the +/-{WRIST_SWING_COMFORT_MAX_DEG:.0f} degree comfort range")

    if abs(twist) > FOREARM_TWIST_HARD_MAX_DEG:
        valid = False
        reasons.append(f"Forearm twist exceeds the +/-{FOREARM_TWIST_HARD_MAX_DEG:.0f} degree hard limit")
    elif penalties["forearm_twist"] > 0.0:
        reasons.append(f"Forearm twist is outside the +/-{FOREARM_TWIST_COMFORT_MAX_DEG:.0f} degree comfort range")

    return AnatomyScore(
        valid=valid,
        total_penalty=sum(penalties.values()),
        component_penalties=penalties,
        measurements={
            "elbow_angle_deg": elbow,
            "wrist_swing_deg": wrist,
            "forearm_twist_deg": twist,
        },
        reasons=tuple(reasons),
    )


def score_static_candidate(
    *,
    elbow_angle_deg: float,
    signed_elbow_flex_deg: float,
    pole_side: float,
    wrist_swing_deg: float,
    wrist_twist_deg: float,
    forearm_twist_deg: float,
    contact_error: float,
    head_penetration_depth: float,
    head_collision_count: int,
    torso_penetration_count: int,
    minimum_clearance: float,
    continuity_distance: float,
    matrices_finite: bool,
) -> StaticCandidateScore:
    """Rank a static arm candidate and reject non-negotiable failures."""

    numeric_values = {
        "elbow_angle_deg": float(elbow_angle_deg),
        "signed_elbow_flex_deg": float(signed_elbow_flex_deg),
        "pole_side": float(pole_side),
        "wrist_swing_deg": float(wrist_swing_deg),
        "wrist_twist_deg": float(wrist_twist_deg),
        "forearm_twist_deg": float(forearm_twist_deg),
        "contact_error": float(contact_error),
        "head_penetration_depth": float(head_penetration_depth),
        "minimum_clearance": float(minimum_clearance),
        "continuity_distance": float(continuity_distance),
    }
    non_finite_measurements = tuple(
        name for name, value in numeric_values.items() if not math.isfinite(value)
    )
    if non_finite_measurements:
        matrices_finite = False
        numeric_values = {
            name: value if math.isfinite(value) else 0.0
            for name, value in numeric_values.items()
        }

    anatomy = score_anatomy(
        numeric_values["elbow_angle_deg"],
        numeric_values["wrist_swing_deg"],
        numeric_values["forearm_twist_deg"],
    )
    penalties = dict(anatomy.component_penalties)
    penalties["wrist_twist"] = _absolute_penalty(
        numeric_values["wrist_twist_deg"],
        WRIST_TWIST_COMFORT_MAX_DEG,
        WRIST_TWIST_HARD_MAX_DEG,
    )
    penalties["contact"] = (
        max(0.0, numeric_values["contact_error"] - CONTACT_COMFORT_DISTANCE)
        / CONTACT_SCALE
    ) ** 2
    penalties["clearance"] = (
        max(0.0, CLEARANCE_COMFORT_DISTANCE - numeric_values["minimum_clearance"])
        / CLEARANCE_COMFORT_DISTANCE
    ) ** 2
    penalties["continuity"] = (
        max(0.0, numeric_values["continuity_distance"] - CONTINUITY_COMFORT_DISTANCE)
        / max(EPSILON, CONTINUITY_HARD_DISTANCE - CONTINUITY_COMFORT_DISTANCE)
    ) ** 2

    reasons = list(anatomy.reasons)
    if non_finite_measurements:
        reasons.append(
            "Candidate contains non-finite measurements: "
            + ", ".join(non_finite_measurements)
        )
    valid = anatomy.valid
    signed_flex = numeric_values["signed_elbow_flex_deg"]
    if not SIGNED_ELBOW_FLEX_MIN_DEG <= signed_flex <= SIGNED_ELBOW_FLEX_MAX_DEG:
        valid = False
        reasons.append(
            f"Signed elbow flex must remain within {SIGNED_ELBOW_FLEX_MIN_DEG:g} to "
            f"{SIGNED_ELBOW_FLEX_MAX_DEG:g} degrees"
        )
    if numeric_values["pole_side"] <= EPSILON:
        valid = False
        reasons.append("Elbow is not on the pole-facing side")
    if abs(numeric_values["wrist_twist_deg"]) > WRIST_TWIST_HARD_MAX_DEG:
        valid = False
        reasons.append(f"Wrist twist exceeds the +/-{WRIST_TWIST_HARD_MAX_DEG:.0f} degree hard limit")
    elif penalties["wrist_twist"] > 0.0:
        reasons.append(
            f"Wrist twist is outside the +/-{WRIST_TWIST_COMFORT_MAX_DEG:.0f} degree comfort range"
        )
    if numeric_values["contact_error"] > CONTACT_HARD_MAX_DISTANCE:
        valid = False
        reasons.append(
            f"Thinking contact exceeds the maximum {CONTACT_HARD_MAX_DISTANCE:.3f} Blender-unit distance"
        )
    elif numeric_values["contact_error"] > CONTACT_WARNING_DISTANCE:
        reasons.append(
            f"Contact warning: lower-jaw distance exceeds {CONTACT_WARNING_DISTANCE:.3f} Blender units"
        )
    if int(head_collision_count) > 0:
        valid = False
        reasons.append(f"Head collision detected in {int(head_collision_count)} evaluated mesh pairs")
    if numeric_values["head_penetration_depth"] > EPSILON:
        valid = False
        reasons.append("Right-hand/head penetration is present")
    if int(torso_penetration_count) > 0 or numeric_values["minimum_clearance"] < -EPSILON:
        valid = False
        reasons.append("Right hand or forearm penetrates non-adjacent torso geometry")
    elif numeric_values["minimum_clearance"] < CLEARANCE_COMFORT_DISTANCE:
        reasons.append(
            f"Clearance warning: minimum torso clearance is below {CLEARANCE_COMFORT_DISTANCE:.3f} Blender units"
        )
    if numeric_values["continuity_distance"] > CONTINUITY_HARD_DISTANCE:
        valid = False
        reasons.append(
            f"Candidate discontinuity exceeds {CONTINUITY_HARD_DISTANCE:g} Blender units"
        )
    elif numeric_values["continuity_distance"] > CONTINUITY_COMFORT_DISTANCE:
        reasons.append(
            f"Continuity warning: displacement exceeds {CONTINUITY_COMFORT_DISTANCE:.3f} Blender units"
        )
    if not matrices_finite:
        valid = False
        reasons.append("Candidate contains non-finite matrices or measurements")

    weighted_score = (
        penalties["elbow"] * ELBOW_SCORE_WEIGHT
        + penalties["wrist_swing"] * 4.0
        + penalties["forearm_twist"] * 1.5
        + penalties["wrist_twist"] * 2.5
        + penalties["contact"] * 5.0
        + penalties["clearance"] * 3.0
        + penalties["continuity"] * 4.0
    )
    return StaticCandidateScore(
        valid=valid,
        verdict="FAIL" if not valid else ("WARN" if reasons else "PASS"),
        total_score=weighted_score + (0.0 if valid else HARD_REJECTION_PENALTY),
        component_penalties=penalties,
        measurements={
            **numeric_values,
            "torso_penetration_count": int(torso_penetration_count),
            "head_collision_count": int(head_collision_count),
            "matrices_finite": bool(matrices_finite),
        },
        reasons=tuple(reasons),
    )
