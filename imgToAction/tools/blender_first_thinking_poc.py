"""Build the isolated Blender-first control rig for the thinking-motion POC."""

from __future__ import annotations

import argparse
from array import array
from dataclasses import dataclass
import hashlib
import importlib.util
import itertools
import json
import math
from pathlib import Path
import re
import shutil
import sys
import time
from typing import Sequence

try:
    import bpy  # type: ignore
    from mathutils import Euler, Matrix, Quaternion, Vector  # type: ignore
    from mathutils.bvhtree import BVHTree  # type: ignore
except ImportError:
    bpy = None
    Euler = None
    Matrix = None
    Quaternion = None
    Vector = None
    BVHTree = None


ARMATURE_NAME = "优菈_arm"
MESH_NAME = "优菈_mesh"
REFERENCE_ACTION_NAME = "POC_v16_reference"
OUTPUT_BLEND_NAME = "eula_elegant_thinking_blender_first_poc.blend"
OUTPUT_DIRECTORY_NAME = "blender_first_thinking_poc"
CONTROL_COLLECTION_NAME = "POC_controls"
PALM_SPACE_NAME = "POC_手掌_SPACE"

PROXY_BONE_NAMES = (
    "POC_右腕_CTRL",
    "POC_右ひじ_CTRL",
    "POC_右手_CTRL",
)
PROXY_SOURCE_BONES = {
    PROXY_BONE_NAMES[0]: "右腕",
    PROXY_BONE_NAMES[1]: "右ひじ",
    PROXY_BONE_NAMES[2]: "右手首",
}
CONTROL_NAMES = {
    "hand": "POC_右手_TARGET",
    "pole": "POC_右ひじ_POLE",
    "palm": "POC_手掌_ORIENTATION",
    "chin": "POC_下巴_CONTACT",
}
COMPENSATION_CONTROL_NAMES = {
    "upper_chest": "POC_上半身2_DELTA",
    "right_shoulder": "POC_右肩_DELTA",
    "neck": "POC_首_DELTA",
    "head": "POC_頭_DELTA",
}
COMPENSATION_CONTROL_PARENT_SPACE = "ARMATURE_LOCAL"
RIGHT_FINGER_BONES = (
    "右親指０", "右親指１", "右親指２",
    "右人指１", "右人指２", "右人指３",
    "右中指１", "右中指２", "右中指３",
    "右薬指１", "右薬指２", "右薬指３",
    "右小指１", "右小指２", "右小指３",
)
FINGER_FLEXION_AXIS = "LOCAL_X_NEGATIVE"
FINGER_CONTROL_PARENT_SPACE = "ARMATURE_LOCAL"
FINGER_CONTROL_NAMES = {
    bone_name: f"POC_{bone_name}_DELTA" for bone_name in RIGHT_FINGER_BONES
}
FINGER_CONSTRAINT_NAMES = {
    bone_name: f"POC_{bone_name}_LOCAL_DELTA" for bone_name in RIGHT_FINGER_BONES
}
FINGER_CONSTRAINT_SPECS = {
    bone_name: {
        "owner_bone": bone_name,
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "BEFORE",
    }
    for bone_name in RIGHT_FINGER_BONES
}
SLEEVE_CORRECTIVE_BONES = ("右手捩1", "右手捩2", "右手捩3")
SLEEVE_CORRECTIVE_CONTROL_NAMES = {
    bone_name: f"POC_{bone_name}_SLEEVE_DELTA"
    for bone_name in SLEEVE_CORRECTIVE_BONES
}
SLEEVE_CORRECTIVE_CONSTRAINT_NAMES = {
    bone_name: f"POC_{bone_name}_SLEEVE_LOCAL_DELTA"
    for bone_name in SLEEVE_CORRECTIVE_BONES
}
SLEEVE_CORRECTIVE_CONSTRAINT_SPECS = {
    bone_name: {
        "owner_bone": bone_name,
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "BEFORE",
    }
    for bone_name in SLEEVE_CORRECTIVE_BONES
}
COMPENSATION_BONES = {
    "upper_chest": "上半身2",
    "right_shoulder": "右肩",
    "neck": "首",
    "head": "頭",
}
COMPENSATION_CONSTRAINT_SPECS = {
    key: {
        "owner_bone": bone_name,
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "BEFORE",
    }
    for key, bone_name in COMPENSATION_BONES.items()
}
COMPENSATION_CONSTRAINT_NAMES = {
    "upper_chest": "POC_上半身2_LOCAL_DELTA",
    "right_shoulder": "POC_右肩_LOCAL_DELTA",
    "neck": "POC_首_LOCAL_DELTA",
    "head": "POC_頭_LOCAL_DELTA",
}
CONSTRAINT_NAMES = {
    "ik": "POC_右腕_IK",
    "palm_proxy": "POC_手掌_DELTA",
    "upper": "POC_右腕_COPY_ROTATION",
    "elbow": "POC_右ひじ_COPY_ROTATION",
    "upper_twist": "POC_右腕捩_AXIAL",
    "hand_twist": "POC_右手捩_AXIAL",
    "wrist": "POC_右手首_ORIENTATION",
}
CONSTRAINT_SPECS = {
    "palm_proxy": {
        "owner_bone": PROXY_BONE_NAMES[2],
        "target_control": CONTROL_NAMES["palm"],
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "REPLACE",
    },
    "upper": {
        "owner_bone": "右腕",
        "target_bone": PROXY_BONE_NAMES[0],
        "constraint_type": "CHILD_OF",
        "rotation_axes": "XYZ",
        "calibrate_inverse": True,
    },
    "elbow": {
        "owner_bone": "右ひじ",
        "target_bone": PROXY_BONE_NAMES[1],
        "constraint_type": "CHILD_OF",
        "rotation_axes": "XYZ",
        "calibrate_inverse": True,
    },
    "upper_twist": {
        "owner_bone": "右腕捩",
        "target_bone": PROXY_BONE_NAMES[2],
        "constraint_type": "COPY_ROTATION",
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "ADD",
        "rotation_axes": "Y",
    },
    "hand_twist": {
        "owner_bone": "右手捩",
        "target_bone": PROXY_BONE_NAMES[2],
        "constraint_type": "COPY_ROTATION",
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "ADD",
        "rotation_axes": "Y",
    },
    "wrist": {
        "owner_bone": "右手首",
        "target_bone": PROXY_BONE_NAMES[2],
        "constraint_type": "COPY_ROTATION",
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "ADD",
        "rotation_axes": "XYZ",
    },
}

REQUIRED_BONES = (
    "右肩",
    "右肩C",
    "右腕",
    "右腕捩",
    "右ひじ",
    "右手捩",
    "右手首",
    *SLEEVE_CORRECTIVE_BONES,
    "上半身2",
    "首",
    "頭",
    *RIGHT_FINGER_BONES,
)
EXPECTED_ACTION_RANGE = (0.0, 240.0)
VALIDATION_FRAME = 150
LENGTH_TOLERANCE = 1e-5
ROLL_TOLERANCE = 1e-6
ENABLED_DELTA_LIMIT_DEG = 10.0
BASELINE_RESTORE_TOLERANCE_DEG = 1e-4

# Rendered PMX calibration identifies right-elbow +Z as strongest flexion.
# Axis isolation against v16 maps that motion to proxy local Z: it reproduces
# the elbow plane at dot=0.999999 while local X misses by 0.2595 Blender units.
ELBOW_HINGE_AXIS = "Z"
ELBOW_IK_LOCKS = {"X": True, "Y": True, "Z": False}
ELBOW_IK_MIN_DEG = -150.0
ELBOW_IK_MAX_DEG = 0.0
ELBOW_FLEX_MIN_DEG = -150.0
ELBOW_FLEX_MAX_DEG = -5.0
ELBOW_OFF_AXIS_MAX_DEG = 0.1
ELBOW_ANGLE_MIN_DEG = 20.0
ELBOW_ANGLE_MAX_DEG = 175.0

HAND_TARGET_DIAGNOSTIC_OFFSET = (0.01, 0.0, 0.0)
HAND_RESPONSE_MIN_DEG = 0.25
HAND_RESPONSE_MAX_DEG = 10.0
PALM_AXIAL_DIAGNOSTIC_DEG = 10.0
PALM_RESPONSE_TOLERANCE_DEG = 1.0
PALM_OFF_AXIS_MAX_DEG = 1.0

SAVE_VERSION_OVERRIDE = 0

PMX_CHIN_SURFACE = (0.0, 18.44, -0.50)
PMX_TO_BLENDER_SCALE = 0.08
CANDIDATE_VIEWS = ("front", "left", "right", "back")
STATIC_RENDER_COUNT = 6
STATIC_METRICS_NAME = "static_pose_metrics.json"
ORIENTATION_GALLERY_DIRECTORY = "orientation_gallery"
ORIENTATION_GALLERY_METRICS_NAME = "orientation_gallery_metrics.json"
CHIN_SUPPORT_DIRECTORY = "chin_support_refinement"
CHIN_SUPPORT_METRICS_NAME = "chin_support_metrics.json"
COLLISION_SEVERITY_DIRECTORY = "collision_severity_diagnostic"
COLLISION_SEVERITY_METRICS_NAME = "collision_severity_metrics.json"
SLEEVE_CORRECTIVE_DIRECTORY = "sleeve_corrective_feasibility"
SLEEVE_CORRECTIVE_METRICS_NAME = "sleeve_corrective_metrics.json"
G14_ORIENTATION_SOURCE_ID = (
    "gallery_14_thumb_opposition_m15_sxp00_tzm10_thumb_opposed_base"
)
INDEX_SUPPORT_NORMAL_MAX_DEG = 35.0
THUMB_INDEX_CONTOUR_MAX_EDGE_MULTIPLIER = 7.0
STATIC_CANDIDATE_DIRECTORY = "candidates"
STATIC_CAMERA_NAME = "POC Static Full Body Camera"
STAGE_A_SURVIVOR_LIMIT = 216
STAGE_B_SURVIVOR_LIMIT = 48
STAGE_C_SURVIVOR_LIMIT = 48
RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
SOURCE_CANDIDATE_PATTERN = re.compile(
    r"^(?:candidate_[0-9]+|pole3d_[0-9]+)(?:__comp_[0-9]{3}|__finger_p[0-9]{2}_s[0-9]{2}_c[0-9]{2}(?:__dual_[0-9]{2}_[0-9]{3})?)?$"
)

CONTACT_VERTEX_GROUPS = (
    "右親指０",
    "右親指１",
    "右親指２",
    "右人指１",
    "右人指２",
    "右人指３",
)
EVIDENCE_VERTEX_GROUPS = (
    "右手首",
    "右親指０",
    "右親指１",
    "右親指２",
    "右人指１",
    "右人指２",
    "右人指３",
    "右中指１",
    "右薬指１",
    "右小指１",
)
RIGHT_HAND_VERTEX_GROUPS = (
    "右手首",
    "右親指０",
    "右親指１",
    "右親指２",
    "右親指先",
    "右人指１",
    "右人指２",
    "右人指３",
    "右人指先",
    "右中指１",
    "右中指２",
    "右中指３",
    "右中指先",
    "右薬指１",
    "右薬指２",
    "右薬指３",
    "右薬指先",
    "右小指１",
    "右小指２",
    "右小指３",
    "右小指先",
)
PALM_VERTEX_GROUPS = ("右手首",)
RIGHT_FOREARM_VERTEX_GROUPS = (
    "右ひじ",
    "右手捩",
    "右手捩1",
    "右手捩2",
    "右手捩3",
)
ADJACENT_RIGHT_ARM_VERTEX_GROUPS = (
    "右肩",
    "右肩C",
    "右腕",
    "右腕捩",
    "右腕捩1",
    "右腕捩2",
    "右腕捩3",
    *RIGHT_FOREARM_VERTEX_GROUPS,
    *RIGHT_HAND_VERTEX_GROUPS,
)
HEAD_VERTEX_GROUPS = ("頭", "首")
TORSO_VERTEX_GROUPS = ("上半身", "上半身2", "上半身3", "首", "下半身")
MIN_GROUP_WEIGHT = 1e-4
MESH_PENETRATION_TOLERANCE = 5e-5
FULL_BODY_MARGIN = 1.18
RENDER_RESOLUTION = 768
CHIN_REGION_BOOTSTRAP_RADIUS = 0.05
UPPER_CHEST_MAX_DEG = 4.0
RIGHT_SHOULDER_MAX_DEG = 3.0
NECK_HEAD_COMBINED_MAX_DEG = 5.0
COMPENSATION_SEED_LIMIT = 6
COMPENSATION_STAGE_D_LIMIT = 48
COMPENSATION_STAGE_E_LIMIT = 24
COMPENSATION_BASELINE_TOLERANCE_DEG = 1e-5
FINGER_SEED_IDS = ("candidate_764", "candidate_779")
FINGER_STAGE_SURVIVOR_LIMIT = 36
ORIENTATION_GALLERY_MIN_RENDER_COUNT = 12
ORIENTATION_GALLERY_MAX_RENDER_COUNT = 18
ORIENTATION_GALLERY_CLOSEUP_SCALE = 0.52
ORIENTATION_GALLERY_CONTACT_SHEET_COLUMNS = 5
ORIENTATION_GALLERY_CONTACT_SHEET_TILE = 256
SLEEVE_CORRECTIVE_MAX_DEG = 8.0
SLEEVE_CORRECTIVE_MAX_ADJACENT_DEG = 4.01
SLEEVE_PRIMARY_POSITION_TOLERANCE = 1e-5
SLEEVE_PRIMARY_ROTATION_TOLERANCE_DEG = 1e-4
SLEEVE_FINGERTIP_POSITION_TOLERANCE = 1e-5
SLEEVE_CONTACT_POSITION_TOLERANCE = 1e-5
SLEEVE_FACE_MIN_AREA_RATIO = 0.60
SLEEVE_FACE_MAX_AREA_RATIO = 1.50
PROTECTED_LOCAL_BONES = (
    "下半身",
    "左肩",
    "左腕",
    "左ひじ",
    "左手首",
    "左足",
    "左ひざ",
    "左足首",
    "右足",
    "右ひざ",
    "右足首",
)


@dataclass(frozen=True)
class StaticCandidate:
    candidate_id: str
    alignment_factor: float
    hand_offset: tuple[float, float, float]
    palm_euler_deg: tuple[float, float, float]
    pole_offset: float
    twist_influences: tuple[float, float, float]
    pole_offset_3d: tuple[float, float, float] = (0.0, 0.0, 0.0)
    search_family: str = "legacy_scalar"


@dataclass(frozen=True)
class UpperBodyCompensation:
    upper_chest_turn_deg: float
    upper_chest_lean_deg: float
    shoulder_retract_deg: float
    shoulder_elevate_deg: float
    neck_toward_deg: float
    head_toward_deg: float

    @property
    def is_identity(self) -> bool:
        return not any((
            self.upper_chest_turn_deg,
            self.upper_chest_lean_deg,
            self.shoulder_retract_deg,
            self.shoulder_elevate_deg,
            self.neck_toward_deg,
            self.head_toward_deg,
        ))


@dataclass(frozen=True)
class FingerPosePreset:
    name: str
    joint_targets_deg: dict[str, tuple[float, float, float]]


@dataclass(frozen=True)
class DualContactBand:
    mesh_resolution: float
    index_warning_distance: float
    thumb_target_distance: float
    thumb_warning_distance: float
    derivation: str


@dataclass(frozen=True)
class DualContactRefinement:
    neck_toward_deg: float
    head_toward_deg: float
    thumb_targets_deg: dict[str, tuple[float, float, float]]
    palm_refinement_deg: tuple[float, float, float]


@dataclass(frozen=True)
class ChinSupportBand:
    mesh_resolution: float
    support_target_distance: float
    support_warning_distance: float
    derivation: str


@dataclass(frozen=True)
class ChinSupportRefinement:
    hand_target_offset: tuple[float, float, float]
    neck_toward_deg: float
    head_toward_deg: float
    palm_refinement_deg: tuple[float, float, float]
    thumb_refinement_deg: tuple[float, float, float]
    upper_chest_turn_deg: float = 0.0
    upper_chest_lean_deg: float = 0.0
    shoulder_retract_deg: float = 0.0
    shoulder_elevate_deg: float = 0.0


@dataclass(frozen=True)
class SleeveCorrection:
    swings_deg: tuple[
        tuple[float, float], tuple[float, float], tuple[float, float]
    ]


@dataclass(frozen=True)
class OrientationGalleryVariant:
    source_id: str
    family: str
    label: str
    axial_angle_deg: float
    palm_swing_deg: float
    palm_tilt_deg: float
    twist_distribution: tuple[float, float, float]
    thumb_variant: str
    index_variant: str
    comparison_group: str
    comparison_dimension: str
    finger_targets_deg: dict[str, tuple[float, float, float]]


@dataclass(frozen=True)
class PocConfig:
    source_blend: Path
    vmd: Path | None
    output_blend: Path
    output_dir: Path
    frame_start: int
    frame_end: int
    setup_only: bool
    solve_static: bool
    search_static: bool
    select_static: bool
    orientation_gallery: bool
    chin_support_refinement: bool
    collision_severity_diagnostic: bool
    sleeve_corrective_feasibility: bool
    run_id: str | None
    overwrite_run: bool
    source_candidate_id: str | None
    orientation_source_id: str | None
    source_static_metrics: Path | None
    orientation_gallery_metrics: Path | None
    run_metrics_path: Path | None


@dataclass(frozen=True)
class StaticRunPaths:
    temporary: Path
    final: Path
    metrics: Path


def quaternion_angle_degrees(quaternion: Sequence[float]) -> float:
    values = tuple(float(value) for value in quaternion)
    if len(values) != 4 or not all(math.isfinite(value) for value in values):
        raise ValueError("Quaternion must contain four finite components")
    magnitude = math.sqrt(sum(value * value for value in values))
    if magnitude <= 1e-12:
        raise ValueError("Quaternion cannot be zero")
    normalized_w = max(-1.0, min(1.0, abs(values[0] / magnitude)))
    return math.degrees(2.0 * math.acos(normalized_w))


def _normalized_quaternion_tuple(quaternion: Sequence[float]) -> tuple[float, float, float, float]:
    values = tuple(float(value) for value in quaternion)
    if len(values) != 4 or not all(math.isfinite(value) for value in values):
        raise ValueError("Quaternion must contain four finite components")
    magnitude = math.sqrt(sum(value * value for value in values))
    if magnitude <= 1e-12:
        raise ValueError("Quaternion cannot be zero")
    return tuple(value / magnitude for value in values)


def _quaternion_multiply(left, right) -> tuple[float, float, float, float]:
    lw, lx, ly, lz = _normalized_quaternion_tuple(left)
    rw, rx, ry, rz = _normalized_quaternion_tuple(right)
    return _normalized_quaternion_tuple((
        lw * rw - lx * rx - ly * ry - lz * rz,
        lw * rx + lx * rw + ly * rz - lz * ry,
        lw * ry - lx * rz + ly * rw + lz * rx,
        lw * rz + lx * ry - ly * rx + lz * rw,
    ))


def _quaternion_inverse(quaternion) -> tuple[float, float, float, float]:
    w, x, y, z = _normalized_quaternion_tuple(quaternion)
    return (w, -x, -y, -z)


def absolute_local_control_delta(target_local, baseline_local):
    return _quaternion_multiply(target_local, _quaternion_inverse(baseline_local))


def compose_before_local_delta(control_delta, baseline_local):
    return _quaternion_multiply(control_delta, baseline_local)


def quaternion_distance_degrees(left, right) -> float:
    return quaternion_angle_degrees(
        _quaternion_multiply(left, _quaternion_inverse(right))
    )


def validate_compensation_angles(angles: dict[str, float]) -> tuple[str, ...]:
    required = set(COMPENSATION_BONES)
    if set(angles) != required:
        raise ValueError(f"Compensation angles must contain exactly: {sorted(required)}")
    values = {name: float(value) for name, value in angles.items()}
    if not all(math.isfinite(value) and value >= 0.0 for value in values.values()):
        raise ValueError("Compensation angles must be finite and non-negative")
    reasons = []
    if values["upper_chest"] > UPPER_CHEST_MAX_DEG + 1e-6:
        reasons.append(f"upper_chest exceeds {UPPER_CHEST_MAX_DEG:g} degrees")
    if values["right_shoulder"] > RIGHT_SHOULDER_MAX_DEG + 1e-6:
        reasons.append(f"right_shoulder exceeds {RIGHT_SHOULDER_MAX_DEG:g} degrees")
    if values["neck"] + values["head"] > NECK_HEAD_COMBINED_MAX_DEG + 1e-6:
        reasons.append(f"neck/head combined exceeds {NECK_HEAD_COMBINED_MAX_DEG:g} degrees")
    return tuple(reasons)


def upper_body_compensation_grid() -> tuple[UpperBodyCompensation, ...]:
    chest = ((0.0, 0.0), (2.0, 0.0), (-2.0, 0.0), (0.0, 2.0), (0.0, -2.0))
    shoulder = ((0.0, 0.0), (1.5, 0.0), (-1.5, 0.0), (0.0, 1.5), (0.0, -1.5))
    head_neck = ((0.0, 0.0), (1.5, 1.5), (2.0, 2.5))
    return tuple(
        UpperBodyCompensation(
            upper_chest_turn_deg=chest_values[0],
            upper_chest_lean_deg=chest_values[1],
            shoulder_retract_deg=shoulder_values[0],
            shoulder_elevate_deg=shoulder_values[1],
            neck_toward_deg=head_values[0],
            head_toward_deg=head_values[1],
        )
        for chest_values, shoulder_values, head_values in itertools.product(
            chest, shoulder, head_neck
        )
    )


def protected_pose_hashes(local_channels: dict[str, Sequence[float]]) -> dict[str, str]:
    hashes = {}
    for bone_name, values in sorted(local_channels.items()):
        payload = json.dumps(
            [float(value) for value in values],
            allow_nan=False,
            separators=(",", ":"),
        ).encode("ascii")
        hashes[bone_name] = hashlib.sha256(payload).hexdigest()
    return hashes


def compare_protected_pose_hashes(
    expected: dict[str, str],
    actual: dict[str, str],
) -> tuple[str, ...]:
    differences = []
    for bone_name in sorted(set(expected) | set(actual)):
        if expected.get(bone_name) != actual.get(bone_name):
            differences.append(f"Protected local pose changed for {bone_name}")
    return tuple(differences)


def compensation_improves_evidence(
    before: dict[str, float | int],
    after: dict[str, float | int],
    *,
    warning_distance: float,
) -> bool:
    math_module = _load_motion_math()
    elbow = float(after["elbow_angle_deg"])
    return (
        float(after["surface_contact_distance"]) <= float(warning_distance)
        and int(after["contact_patch_count"]) > 0
        and math_module.ELBOW_COMFORT_MIN_DEG <= elbow <= math_module.ELBOW_COMFORT_MAX_DEG
        and int(after["head_collision_count"]) == 0
        and int(after["torso_penetration_count"]) < int(before["torso_penetration_count"])
    )


def _finger_pose_targets(
    thumb,
    index,
    middle,
    ring,
    little,
) -> dict[str, tuple[float, float, float]]:
    values = (*thumb, *index, *middle, *ring, *little)
    return {
        bone_name: tuple(float(value) for value in delta)
        for bone_name, delta in zip(RIGHT_FINGER_BONES, values, strict=True)
    }


def semantic_finger_presets() -> tuple[FingerPosePreset, ...]:
    relaxed = (
        ((-12, -8, -5), (-18, -4, 0), (-10, 0, 0)),
        ((-5, -8, -8), (-4, 0, 0), (-3, 0, 0)),
        ((-18, 0, 0), (-24, 0, 0), (-18, 0, 0)),
        ((-24, 0, 0), (-30, 0, 0), (-24, 0, 0)),
        ((-30, 0, 0), (-36, 0, 0), (-30, 0, 0)),
    )
    variants = (
        ("support_soft", relaxed),
        ("support_reach", (
            ((-18, -12, -8), (-25, -8, 0), (-15, 0, 0)),
            ((-8, -12, -12), (-6, -4, 0), (-4, 0, 0)),
            *relaxed[2:],
        )),
        ("support_thumb_low", (
            ((-20, -12, -5), (-30, -8, 0), (-18, 0, 0)),
            ((-4, -12, -8), (-4, -4, 0), (-2, 0, 0)),
            *relaxed[2:],
        )),
        ("support_index_long", (
            relaxed[0],
            ((-10, -10, -12), (-7, -4, 0), (-4, 0, 0)),
            *relaxed[2:],
        )),
        ("support_open", (
            ((-15, -10, -8), (-22, -6, 0), (-12, 0, 0)),
            ((-3, -8, -12), (-3, 0, 0), (-2, 0, 0)),
            ((-14, 0, 0), (-20, 0, 0), (-15, 0, 0)),
            ((-20, 0, 0), (-26, 0, 0), (-20, 0, 0)),
            ((-26, 0, 0), (-32, 0, 0), (-26, 0, 0)),
        )),
        ("support_curled", (
            relaxed[0], relaxed[1],
            ((-22, 0, 0), (-28, 0, 0), (-22, 0, 0)),
            ((-28, 0, 0), (-34, 0, 0), (-28, 0, 0)),
            ((-34, 0, 0), (-40, 0, 0), (-34, 0, 0)),
        )),
    )
    return tuple(
        FingerPosePreset(name, _finger_pose_targets(*groups))
        for name, groups in variants
    )


def validate_absolute_finger_targets(joint_targets_deg) -> tuple[str, ...]:
    if set(joint_targets_deg) != set(RIGHT_FINGER_BONES):
        raise ValueError("Finger pose must contain exactly the 15 right-finger bones")
    reasons = []
    for bone_name in RIGHT_FINGER_BONES:
        target = tuple(float(value) for value in joint_targets_deg[bone_name])
        if len(target) != 3 or not all(math.isfinite(value) for value in target):
            raise ValueError(f"Finger target must contain three finite values: {bone_name}")
        if target[0] < -65.0 - 1e-6:
            reasons.append(f"{bone_name} absolute flex exceeds 65 degrees")
        if target[0] > 30.0 + 1e-6:
            reasons.append(f"{bone_name} reverse extension exceeds 30 degrees")
        spread_limit = 30.0 if bone_name.startswith("右親指") else 12.0
        if max(abs(target[1]), abs(target[2])) > spread_limit + 1e-6:
            reasons.append(
                f"{bone_name} fingertip spread exceeds {spread_limit:g} degrees"
            )
    for prefix in ("右人指", "右中指", "右薬指", "右小指"):
        curls = tuple(max(0.0, -float(joint_targets_deg[f"{prefix}{joint}"][0])) for joint in "１２３")
        if curls[2] > curls[0] + 20.0:
            reasons.append(f"{prefix} claw shape has excessive distal curl")
    proximal_curls = tuple(
        max(0.0, -float(joint_targets_deg[f"{prefix}１"][0]))
        for prefix in ("右中指", "右薬指", "右小指")
    )
    if not proximal_curls[0] <= proximal_curls[1] <= proximal_curls[2]:
        reasons.append("Relaxed finger curl is not progressive from middle to little")
    return tuple(reasons)


def finger_contact_improves_evidence(before, after, *, warning_distance: float) -> bool:
    return (
        float(after["surface_contact_distance"]) <= float(warning_distance)
        and float(after["surface_contact_distance"]) < float(before["surface_contact_distance"])
        and int(after["thumb_index_contact_patch_count"]) > 0
        and int(after["head_collision_count"]) == 0
        and int(after["torso_penetration_count"]) == 0
    )


def finger_palm_refinements() -> tuple[tuple[float, float, float], ...]:
    return (
        (0.0, 0.0, 0.0),
        (-6.0, 0.0, 0.0), (6.0, 0.0, 0.0),
        (0.0, -6.0, 0.0), (0.0, 6.0, 0.0),
        (0.0, 0.0, -6.0), (0.0, 0.0, 6.0),
        (-4.0, 4.0, 0.0), (4.0, -4.0, 0.0),
    )


def finger_search_compensations() -> tuple[UpperBodyCompensation, ...]:
    return (
        UpperBodyCompensation(0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        UpperBodyCompensation(0.0, 0.0, 0.0, 0.0, 1.5, 1.5),
    )


def finger_reach_diagnostic(records, *, warning_distance: float) -> dict[str, object]:
    if not records:
        return {
            "finger_length_or_orientation_insufficient": True,
            "reason": "No bounded semantic finger candidate survived",
        }
    best = min(records, key=lambda record: float(record["metrics"]["surface_contact_distance"]))
    metrics = best["metrics"]
    distance = float(metrics["surface_contact_distance"])
    collision_free = (
        int(metrics["head_collision_count"]) == 0
        and int(metrics["torso_penetration_count"]) == 0
    )
    insufficient = (
        collision_free
        and distance > float(warning_distance)
        and int(metrics["thumb_index_contact_patch_count"]) == 0
    )
    return {
        "best_source_candidate_id": best["source_candidate_id"],
        "best_surface_contact_distance": distance,
        "warning_distance": float(warning_distance),
        "distance_shortfall": max(0.0, distance - float(warning_distance)),
        "contact_distance_by_source": metrics.get("contact_distance_by_source", {}),
        "collision_free": collision_free,
        "finger_length_or_orientation_insufficient": insufficient,
        "reason": (
            "Bounded thumb/index local-axis and palm refinement cannot reach the chin band"
            if insufficient else "Failure is not solely attributable to bounded finger reach"
        ),
    }


def derive_dual_contact_band(
    *, mesh_resolution: float, index_warning_distance: float
) -> DualContactBand:
    resolution = float(mesh_resolution)
    index_warning = float(index_warning_distance)
    if resolution <= 0.0 or index_warning <= 0.0:
        raise ValueError("Dual-contact geometry scales must be positive")
    return DualContactBand(
        mesh_resolution=resolution,
        index_warning_distance=index_warning,
        thumb_target_distance=index_warning,
        thumb_warning_distance=index_warning + resolution,
        derivation=(
            "thumb support permits one additional median lower-chin triangle edge "
            "behind the index contact warning surface"
        ),
    )


def dual_contact_reasons(metrics, band: DualContactBand) -> tuple[str, ...]:
    distances = metrics["contact_distance_by_source"]
    patches = metrics["contact_patch_by_source"]
    reasons = []
    if float(distances["index"]) > band.index_warning_distance:
        reasons.append("Index contact exceeds the lower-chin warning distance")
    if int(patches["index"]) <= 0:
        reasons.append("Index lower-jaw contact patch is empty")
    if float(distances["thumb"]) > band.thumb_warning_distance:
        reasons.append("Thumb underside support exceeds its geometry-derived warning distance")
    if int(metrics.get("thumb_support_patch_count", 0)) <= 0:
        reasons.append("Thumb underside support patch is empty")
    return tuple(reasons)


def dual_contact_refinement_grid() -> tuple[DualContactRefinement, ...]:
    base = next(
        preset for preset in semantic_finger_presets()
        if preset.name == "support_thumb_low"
    ).joint_targets_deg
    thumb_variants = (
        {name: base[name] for name in ("右親指０", "右親指１", "右親指２")},
        {"右親指０": (-15.0, -12.0, -5.0), "右親指１": (-25.0, -8.0, 0.0), "右親指２": (-15.0, 0.0, 0.0)},
        {"右親指０": (-20.0, -8.0, -5.0), "右親指１": (-20.0, -6.0, 0.0), "右親指２": (-12.0, 0.0, 0.0)},
        {"右親指０": (-20.0, -12.0, -5.0), "右親指１": (-35.0, -8.0, 0.0), "右親指２": (-18.0, 0.0, 0.0)},
        {"右親指０": (-18.0, -10.0, -5.0), "右親指１": (-25.0, -6.0, 0.0), "右親指２": (-25.0, 0.0, 0.0)},
        {"右親指０": (-22.0, -12.0, -5.0), "右親指１": (-35.0, -8.0, 0.0), "右親指２": (-28.0, 0.0, 0.0)},
        {"右親指０": (-25.0, -12.0, -5.0), "右親指１": (-40.0, -8.0, 0.0), "右親指２": (-30.0, 0.0, 0.0)},
    )
    head_neck = ((1.5, 1.5), (2.0, 3.0), (2.5, 2.5), (1.5, 3.5))
    palm = (
        (0.0, 0.0, 0.0), (-3.0, 0.0, 0.0), (3.0, 0.0, 0.0),
        (0.0, -3.0, 0.0), (0.0, 3.0, 0.0),
        (0.0, 0.0, -3.0), (0.0, 0.0, 3.0),
    )
    return tuple(
        DualContactRefinement(neck, head, thumb, palm_delta)
        for (neck, head), thumb, palm_delta in itertools.product(
            head_neck, thumb_variants, palm
        )
    )


def orientation_gallery_variants() -> tuple[OrientationGalleryVariant, ...]:
    targets = semi_closed_finger_targets()
    distribution = (0.35, 0.50, 0.15)
    specs = [
        ("semi_closed_axial", -30.0, 0.0, -6.0, "base", "base", "semi_closed_axial", "palm"),
        ("semi_closed_axial", -15.0, 0.0, -6.0, "base", "base", "semi_closed_axial", "palm"),
        ("semi_closed_axial", 0.0, 0.0, 0.0, "base", "base", "semi_closed_axial", "palm"),
    ]
    for swing, tilt in ((-4.0, -6.0), (4.0, -6.0), (0.0, -10.0), (0.0, -2.0)):
        specs.append((
            "palm_tilt", -15.0, swing, tilt, "base", "base",
            "palm_m15", "palm",
        ))
    for swing, tilt in ((-4.0, 0.0), (4.0, 0.0), (0.0, -6.0), (0.0, -3.0), (0.0, 3.0)):
        specs.append((
            "palm_tilt", 0.0, swing, tilt, "base", "base",
            "palm_00", "palm",
        ))
    for angle, tilt, key in ((-15.0, -10.0, "m15"), (0.0, -6.0, "00")):
        for thumb in ("thumb_support", "thumb_opposed"):
            specs.append((
                "thumb_opposition", angle, 0.0, tilt, thumb, "base",
                f"thumb_{key}", "thumb",
            ))
        for index_pose in ("index_high", "index_long"):
            specs.append((
                "index_alignment", angle, 0.0, tilt, "base", index_pose,
                f"index_{key}", "index",
            ))

    variants = []
    for index, (
        family, angle, swing, tilt, thumb, index_pose,
        comparison_group, comparison_dimension,
    ) in enumerate(specs, start=1):
        pose = dict(targets["base"])
        if thumb != "base":
            for bone_name in ("右親指０", "右親指１", "右親指２"):
                pose[bone_name] = targets[thumb][bone_name]
        if index_pose != "base":
            for bone_name in ("右人指１", "右人指２", "右人指３"):
                pose[bone_name] = targets[index_pose][bone_name]
        angle_label = f"p{int(angle):02d}" if angle >= 0 else f"m{abs(int(angle)):02d}"
        source_id = (
            f"gallery_{index:02d}_{family}_{angle_label}_"
            f"sx{int(swing):+03d}_tz{int(tilt):+03d}_{thumb}_{index_pose}"
        ).replace("+", "p").replace("-", "m")
        variants.append(OrientationGalleryVariant(
            source_id=source_id,
            family=family,
            label=(
                f"G{index:02d} axial {angle:+.0f} swing {swing:+.0f} tilt {tilt:+.0f}\n"
                f"thumb {thumb} index {index_pose}"
            ),
            axial_angle_deg=angle,
            palm_swing_deg=swing,
            palm_tilt_deg=tilt,
            twist_distribution=distribution,
            thumb_variant=thumb,
            index_variant=index_pose,
            comparison_group=comparison_group,
            comparison_dimension=comparison_dimension,
            finger_targets_deg=pose,
        ))
    return tuple(variants)


def selected_orientation_variant(source_id: str) -> OrientationGalleryVariant:
    if source_id != G14_ORIENTATION_SOURCE_ID:
        raise ValueError(
            "Chin-support refinement is restricted to the controller-selected G14 family"
        )
    for variant in orientation_gallery_variants():
        if variant.source_id == source_id:
            return variant
    raise RuntimeError(f"Selected orientation variant is not defined: {source_id}")


def derive_chin_support_band(
    *, mesh_resolution: float, chin_warning_distance: float
) -> ChinSupportBand:
    resolution = float(mesh_resolution)
    warning = float(chin_warning_distance)
    if resolution <= 0.0 or warning <= 0.0:
        raise ValueError("Chin-support geometry scales must be positive")
    return ChinSupportBand(
        mesh_resolution=resolution,
        support_target_distance=min(warning, resolution * 1.5),
        support_warning_distance=warning,
        derivation=(
            "support warning reuses the lower-chin median-edge warning band; "
            "target is 1.5 median triangle edges capped by that warning"
        ),
    )


def chin_support_semantic_reasons(
    metrics, band: ChinSupportBand
) -> tuple[str, ...]:
    reasons = []
    if float(metrics["index_support_surface_distance"]) > band.support_warning_distance:
        reasons.append("Index support surface exceeds its geometry-derived warning distance")
    if int(metrics["index_support_patch_count"]) <= 0:
        reasons.append("Index support surface contact patch is empty")
    if (
        float(metrics["index_support_normal_opposition_error_deg"])
        > INDEX_SUPPORT_NORMAL_MAX_DEG
    ):
        reasons.append(
            "Index support normal opposition error exceeds "
            f"{INDEX_SUPPORT_NORMAL_MAX_DEG:.1f} degrees"
        )
    if not bool(metrics["index_support_under_chin"]):
        reasons.append("Index support patch is not positioned under the lower chin")
    if not bool(metrics["thumb_contour_bounded"]):
        reasons.append("Thumb exceeds the bounded opposed hand contour")
    return tuple(reasons)


def chin_support_refinement_grid() -> tuple[ChinSupportRefinement, ...]:
    hand_offsets = (
        (0.0, 0.0, 0.0),
        (0.004, 0.0, 0.0),
        (0.0, 0.035, 0.0),
        (0.0, 0.045, 0.0),
        (0.0, 0.050, 0.0),
        (0.0, 0.055, 0.0),
        (0.0, 0.060, 0.0),
        (0.004, 0.050, 0.0),
        (0.0, 0.050, 0.004),
    )
    compensations = (
        (0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        (0.0, -2.0, 1.5, 0.0, 2.0, 2.5),
    )
    palm = (
        (0.0, 0.0, 0.0),
        (2.0, 0.0, -2.0),
        (-2.0, 0.0, 2.0),
    )
    thumb = ((0.0, 0.0, 0.0), (-4.0, 3.0, 2.0))
    return tuple(
        ChinSupportRefinement(
            offset,
            compensation[4],
            compensation[5],
            palm_delta,
            thumb_delta,
            compensation[0],
            compensation[1],
            compensation[2],
            compensation[3],
        )
        for offset, compensation, palm_delta, thumb_delta in itertools.product(
            hand_offsets, compensations, palm, thumb
        )
    )


def sleeve_correction_smoothness(correction: SleeveCorrection) -> dict[str, float]:
    vectors = correction.swings_deg
    adjacent = tuple(
        math.hypot(
            vectors[index + 1][0] - vectors[index][0],
            vectors[index + 1][1] - vectors[index][1],
        )
        for index in range(2)
    )
    second = math.hypot(
        vectors[0][0] - 2.0 * vectors[1][0] + vectors[2][0],
        vectors[0][1] - 2.0 * vectors[1][1] + vectors[2][1],
    )
    return {
        "max_adjacent_delta_deg": max(adjacent),
        "second_difference_deg": second,
        "smoothness_penalty": sum(value * value for value in adjacent) + second * second,
    }


def sleeve_correction_reasons(correction: SleeveCorrection) -> tuple[str, ...]:
    if len(correction.swings_deg) != len(SLEEVE_CORRECTIVE_BONES):
        raise ValueError("Sleeve correction must contain three ordered bone swings")
    reasons = []
    magnitudes = tuple(math.hypot(*swing) for swing in correction.swings_deg)
    if not all(math.isfinite(value) for value in magnitudes):
        reasons.append("Sleeve correction contains non-finite angles")
    if max(magnitudes, default=0.0) > SLEEVE_CORRECTIVE_MAX_DEG + 1e-6:
        reasons.append(f"Sleeve correction exceeds {SLEEVE_CORRECTIVE_MAX_DEG:g} degrees")
    smoothness = sleeve_correction_smoothness(correction)
    if smoothness["max_adjacent_delta_deg"] > SLEEVE_CORRECTIVE_MAX_ADJACENT_DEG:
        reasons.append("Sleeve correction is not smooth across bones 1-2-3")
    return tuple(reasons)


def sleeve_correction_grid() -> tuple[SleeveCorrection, ...]:
    diagonal = math.sqrt(0.5)
    directions = (
        (1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0),
        (diagonal, diagonal), (diagonal, -diagonal),
        (-diagonal, diagonal), (-diagonal, -diagonal),
    )
    profiles = (
        (1.0, 1.0, 1.0),
        (0.5, 0.75, 1.0),
        (1.0, 0.75, 0.5),
        (0.5, 1.0, 0.5),
    )
    corrections = [SleeveCorrection(((0.0, 0.0),) * 3)]
    for magnitude, direction, profile in itertools.product(
        (2.0, 4.0, 6.0, 8.0), directions, profiles
    ):
        corrections.append(SleeveCorrection(tuple(
            (
                magnitude * weight * direction[0],
                magnitude * weight * direction[1],
            )
            for weight in profile
        )))
    return tuple(corrections)


def sleeve_primary_drift_reasons(metrics) -> tuple[str, ...]:
    reasons = []
    if float(metrics["max_primary_position_drift"]) > SLEEVE_PRIMARY_POSITION_TOLERANCE:
        reasons.append("Primary shoulder/elbow/wrist position drift exceeds tolerance")
    if (
        float(metrics["max_primary_rotation_drift_deg"])
        > SLEEVE_PRIMARY_ROTATION_TOLERANCE_DEG
    ):
        reasons.append("Primary shoulder/elbow/wrist rotation drift exceeds tolerance")
    if float(metrics["max_fingertip_drift"]) > SLEEVE_FINGERTIP_POSITION_TOLERANCE:
        reasons.append("Primary fingertip world drift exceeds tolerance")
    if float(metrics["contact_point_drift"]) > SLEEVE_CONTACT_POSITION_TOLERANCE:
        reasons.append("Primary contact point drift exceeds tolerance")
    return tuple(reasons)


def sleeve_correction_rank(record):
    return (
        int(record["raw_overlap_count"]) != 0,
        int(record["raw_overlap_count"]),
        float(record["max_penetration_depth"]),
        float(record["smoothness_penalty"]),
        str(record["source_id"]),
    )


def index_knuckle_region_indices(
    *, index1_indices, index2_indices, index3_indices, faces
):
    proximal = (set(index1_indices) | set(index2_indices)) - set(index3_indices)
    support_faces = tuple(
        tuple(int(index) for index in face)
        for face in faces
        if set(face) <= proximal
    )
    return {
        "support_vertices": proximal,
        "support_faces": support_faces,
        "triangle_count": len(support_faces),
        "vertex_count": len(proximal),
    }


def surface_normal_opposition_error(first, second) -> float:
    def normalized(values):
        vector = tuple(float(value) for value in values)
        length = math.sqrt(sum(value * value for value in vector))
        if length <= 1e-12:
            raise ValueError("Surface normals must be non-zero")
        return tuple(value / length for value in vector)

    left = normalized(first)
    right = normalized(second)
    dot = max(-1.0, min(1.0, sum(
        a * b for a, b in zip(left, right, strict=True)
    )))
    return abs(180.0 - math.degrees(math.acos(dot)))


def semi_closed_finger_targets() -> dict[str, dict[str, tuple[float, float, float]]]:
    relaxed = _finger_pose_targets(
        (
            (-18.0, -16.0, -10.0),
            (-26.0, -12.0, -6.0),
            (-16.0, -4.0, -2.0),
        ),
        (
            (-10.0, -8.0, -8.0),
            (-8.0, -3.0, 0.0),
            (-5.0, 0.0, 0.0),
        ),
        ((-34.0, 0.0, 0.0), (-42.0, 0.0, 0.0), (-34.0, 0.0, 0.0)),
        ((-42.0, 0.0, 0.0), (-50.0, 0.0, 0.0), (-42.0, 0.0, 0.0)),
        ((-50.0, 0.0, 0.0), (-58.0, 0.0, 0.0), (-50.0, 0.0, 0.0)),
    )
    variants = {"base": dict(relaxed)}
    variants["thumb_support"] = {
        **relaxed,
        "右親指０": (-36.0, 20.0, 12.0),
        "右親指１": (-46.0, 16.0, 8.0),
        "右親指２": (-30.0, 8.0, 4.0),
    }
    variants["thumb_opposed"] = {
        **relaxed,
        "右親指０": (-42.0, 24.0, 14.0),
        "右親指１": (-52.0, 20.0, 10.0),
        "右親指２": (-36.0, 12.0, 6.0),
    }
    variants["index_high"] = {
        **relaxed,
        "右人指１": (-6.0, -12.0, -6.0),
        "右人指２": (-5.0, -4.0, 0.0),
        "右人指３": (-3.0, 0.0, 0.0),
    }
    variants["index_long"] = {
        **relaxed,
        "右人指１": (-4.0, -8.0, -10.0),
        "右人指２": (-3.0, -2.0, 0.0),
        "右人指３": (-2.0, 0.0, 0.0),
    }
    return variants


def palm_control_nonaxial_degrees(requested_degrees: float, wrist_influence: float) -> float:
    influence = float(wrist_influence)
    if not math.isfinite(influence) or influence <= 0.0:
        raise ValueError("Gallery wrist influence must be positive")
    return float(requested_degrees) / influence


def _point_distance(left, right) -> float:
    return math.sqrt(sum(
        (float(a) - float(b)) ** 2 for a, b in zip(left, right, strict=True)
    ))


def orientation_gallery_pose_uniqueness_reasons(records) -> tuple[str, ...]:
    reasons = []
    hashes = {}
    for record in records:
        pose_hash = record["evaluated_pose_hash"]
        if pose_hash in hashes:
            reasons.append(
                f"Evaluated pose hash is duplicated by {hashes[pose_hash]} and {record['source_id']}"
            )
        hashes[pose_hash] = record["source_id"]
    groups = {}
    for record in records:
        groups.setdefault(
            (record["comparison_group"], record["comparison_dimension"]), []
        ).append(record)
    for (group_name, dimension), group in groups.items():
        if len(group) < 2:
            continue
        for left, right in itertools.combinations(group, 2):
            if dimension == "thumb":
                distance = max(
                    quaternion_distance_degrees(
                        left["evaluated_finger_quaternions"][bone_name],
                        right["evaluated_finger_quaternions"][bone_name],
                    )
                    for bone_name in ("右親指０", "右親指１", "右親指２")
                )
                if distance < 2.0:
                    reasons.append(f"{group_name} thumb quaternion variants are pose-identical")
                if _point_distance(
                    left["fingertip_world"]["thumb"], right["fingertip_world"]["thumb"]
                ) < 0.002:
                    reasons.append(f"{group_name} thumb tip variants are pose-identical")
            elif dimension == "index":
                distance = max(
                    quaternion_distance_degrees(
                        left["evaluated_finger_quaternions"][bone_name],
                        right["evaluated_finger_quaternions"][bone_name],
                    )
                    for bone_name in ("右人指１", "右人指２", "右人指３")
                )
                if distance < 2.0:
                    reasons.append(f"{group_name} index quaternion variants are pose-identical")
                if _point_distance(
                    left["fingertip_world"]["index"], right["fingertip_world"]["index"]
                ) < 0.002:
                    reasons.append(f"{group_name} index tip variants are pose-identical")
            elif quaternion_distance_degrees(
                left["palm_final_quaternion"], right["palm_final_quaternion"]
            ) < 1.0:
                reasons.append(f"{group_name} palm variants are pose-identical")
    return tuple(dict.fromkeys(reasons))


def gallery_source_reference(stored_metrics, source_candidate_id: str):
    candidate_record = next(
        (
            record for record in stored_metrics.get("candidates", ())
            if record.get("source_candidate_id") == source_candidate_id
        ),
        None,
    )
    seed_metrics = (
        stored_metrics.get("semantic_finger_search", {})
        .get("seed_metrics", {})
        .get(source_candidate_id)
    )
    if candidate_record is None or seed_metrics is None:
        raise ValueError(
            f"Gallery source candidate {source_candidate_id!r} is missing from stored metrics"
        )
    return _candidate_from_record(candidate_record), seed_metrics


def chin_support_source_reference(stored_metrics, source_candidate_id: str):
    """Resolve either a semantic-arm seed or a persisted compensated arm."""

    compensated = next(
        (
            record
            for record in stored_metrics.get("compensation_candidates", ())
            if record.get("source_candidate_id") == source_candidate_id
        ),
        None,
    )
    if compensated is not None:
        return (
            _candidate_from_record(compensated),
            _compensation_from_record(compensated),
            compensated["metrics"],
        )
    candidate, metrics = gallery_source_reference(stored_metrics, source_candidate_id)
    return candidate, UpperBodyCompensation(0.0, 0.0, 0.0, 0.0, 0.0, 0.0), metrics


def collision_severity_source_records(stored_metrics):
    compensated = [
        record for record in stored_metrics.get("compensation_candidates", ())
        if str(record.get("source_candidate_id", "")).startswith("pole3d_")
        and "__comp_" in str(record.get("source_candidate_id", ""))
        and record.get("metrics", {}).get("torso_penetration_count") is not None
        and int(record["metrics"]["torso_penetration_count"]) > 0
    ]
    if not compensated:
        raise ValueError("Source metrics contain no reconstructable colliding pole3d compensation")
    best = min(compensated, key=lambda record: (
        int(record["metrics"]["torso_penetration_count"]),
        float(record["metrics"].get("surface_contact_distance", math.inf)),
        str(record["source_candidate_id"]),
    ))
    return {"compensated": best}


def gallery_arm_state_reproduction_reasons(expected, actual) -> tuple[str, ...]:
    reasons = []
    vector_tolerances = {
        "hand_target_world": 1e-5,
        "wrist_world": 1e-5,
    }
    scalar_tolerances = {
        "elbow_angle_deg": 1e-3,
        "pole_side": 1e-4,
    }
    for key, tolerance in vector_tolerances.items():
        if key not in expected or key not in actual:
            reasons.append(f"Source reproduction is missing {key}")
        elif _point_distance(expected[key], actual[key]) > tolerance:
            reasons.append(f"Source {key} drift exceeds {tolerance:g}")
    for key, tolerance in scalar_tolerances.items():
        if key not in expected or key not in actual:
            reasons.append(f"Source reproduction is missing {key}")
        elif abs(float(expected[key]) - float(actual[key])) > tolerance:
            reasons.append(f"Source {key} drift exceeds {tolerance:g}")
    return tuple(reasons)


def gallery_source_reproduction_reasons(expected, actual) -> tuple[str, ...]:
    reasons = list(gallery_arm_state_reproduction_reasons(expected, actual))
    key = "surface_contact_distance"
    tolerance = 1e-5
    if key not in expected or key not in actual:
        reasons.append(f"Source reproduction is missing {key}")
    elif abs(float(expected[key]) - float(actual[key])) > tolerance:
        reasons.append(f"Source {key} drift exceeds {tolerance:g}")
    return tuple(reasons)


def orientation_gallery_rejection_reasons(metrics) -> tuple[str, ...]:
    math_module = _load_motion_math()
    reasons = []
    if not bool(metrics["matrices_finite"]):
        reasons.append("Non-finite pose matrix")
    if not signed_elbow_flex_is_valid(float(metrics["signed_elbow_flex_deg"])):
        reasons.append("Signed elbow hinge limit failed")
    if float(metrics["pole_side"]) <= math_module.EPSILON:
        reasons.append("Elbow is not on the pole-facing side")
    if abs(float(metrics["wrist_swing_deg"])) > math_module.WRIST_SWING_HARD_MAX_DEG:
        reasons.append("Wrist swing exceeds its hard limit")
    if abs(float(metrics["wrist_twist_deg"])) > math_module.WRIST_TWIST_HARD_MAX_DEG:
        reasons.append("Wrist twist exceeds its hard limit")
    if abs(float(metrics["forearm_twist_deg"])) > math_module.FOREARM_TWIST_HARD_MAX_DEG:
        reasons.append("Forearm twist exceeds its hard limit")
    if int(metrics["head_collision_count"]) != 0:
        reasons.append("Head collision is present")
    if int(metrics["torso_penetration_count"]) != 0:
        reasons.append("Non-adjacent torso penetration is present")
    return tuple(reasons)


def orientation_gallery_render_mapping(variants) -> list[dict[str, object]]:
    mapping = []
    for index, variant in enumerate(variants, start=1):
        root = f"{ORIENTATION_GALLERY_DIRECTORY}/variants/{index:02d}_{variant.source_id}"
        mapping.append({
            "gallery_index": index,
            "source_id": variant.source_id,
            "closeup": f"{root}/upper_body_hand.png",
            "front": f"{root}/front.png",
            "right": f"{root}/right.png",
            "left": f"{root}/left.png",
        })
    return mapping


def compensated_source_id(arm_source_id: str, compensation_index: int) -> str:
    if compensation_index < 0:
        raise ValueError("Compensation index must be non-negative")
    return f"{arm_source_id}__comp_{compensation_index:03d}"


def _compensation_contact_rank(item):
    _state, record = item
    metrics = record["metrics"]
    elbow = float(metrics["elbow_angle_deg"])
    elbow_comfort = _load_motion_math().ELBOW_COMFORT_MIN_DEG <= elbow <= _load_motion_math().ELBOW_COMFORT_MAX_DEG
    return (
        int(metrics.get("contact_patch_count", 0)) <= 0,
        not elbow_comfort,
        float(metrics.get("surface_contact_distance", math.inf)),
        float(record.get("score", math.inf)),
        record["source_candidate_id"],
    )


def compensation_seed_candidates(records, limit: int):
    if limit <= 0:
        return []
    return sorted(records, key=_compensation_contact_rank)[:limit]


def compensation_stage_survivors(records, limit: int):
    if limit <= 0:
        return []
    valid = [item for item in records if item[1].get("valid", False)]
    strata = {}
    for item in valid:
        arm_source = item[1].get("arm_source_candidate_id", "__global__")
        strata.setdefault(arm_source, []).append(item)
    for items in strata.values():
        items.sort(key=_compensation_contact_rank)
    selected = []
    depth = 0
    ordered_keys = sorted(strata)
    while len(selected) < limit:
        advanced = False
        for key in ordered_keys:
            items = strata[key]
            if depth < len(items):
                selected.append(items[depth])
                advanced = True
                if len(selected) == limit:
                    break
        if not advanced:
            break
        depth += 1
    return sorted(selected, key=_compensation_contact_rank)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-blend", type=Path, required=True)
    parser.add_argument("--vmd", type=Path)
    parser.add_argument("--output-blend", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--frame-start", type=int, default=0)
    parser.add_argument("--frame-end", type=int, default=240)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--setup-only", action="store_true")
    mode.add_argument("--search-static", action="store_true")
    mode.add_argument("--select-static", action="store_true")
    mode.add_argument("--orientation-gallery", action="store_true")
    mode.add_argument("--chin-support-refinement", action="store_true")
    mode.add_argument("--collision-severity-diagnostic", action="store_true")
    mode.add_argument("--sleeve-corrective-feasibility", action="store_true")
    parser.add_argument("--run-id")
    parser.add_argument("--overwrite-run", action="store_true")
    parser.add_argument("--source-candidate-id")
    parser.add_argument("--orientation-source-id")
    parser.add_argument("--source-static-metrics", type=Path)
    parser.add_argument("--orientation-gallery-metrics", type=Path)
    return parser


def static_run_paths(output_dir: Path, run_id: str) -> StaticRunPaths:
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise ValueError(f"Invalid static run ID: {run_id!r}")
    runs = Path(output_dir) / "runs"
    final = runs / run_id
    return StaticRunPaths(
        temporary=runs / f".tmp-{run_id}",
        final=final,
        metrics=final / STATIC_METRICS_NAME,
    )


def orientation_gallery_run_paths(output_dir: Path, run_id: str) -> StaticRunPaths:
    paths = static_run_paths(output_dir, run_id)
    return StaticRunPaths(
        temporary=paths.temporary,
        final=paths.final,
        metrics=(
            paths.final
            / ORIENTATION_GALLERY_DIRECTORY
            / ORIENTATION_GALLERY_METRICS_NAME
        ),
    )


def chin_support_run_paths(output_dir: Path, run_id: str) -> StaticRunPaths:
    paths = static_run_paths(output_dir, run_id)
    return StaticRunPaths(
        temporary=paths.temporary,
        final=paths.final,
        metrics=paths.final / CHIN_SUPPORT_METRICS_NAME,
    )


def collision_severity_run_paths(output_dir: Path, run_id: str) -> StaticRunPaths:
    paths = static_run_paths(output_dir, run_id)
    return StaticRunPaths(
        temporary=paths.temporary,
        final=paths.final,
        metrics=paths.final / COLLISION_SEVERITY_METRICS_NAME,
    )


def sleeve_corrective_run_paths(output_dir: Path, run_id: str) -> StaticRunPaths:
    paths = static_run_paths(output_dir, run_id)
    return StaticRunPaths(
        temporary=paths.temporary,
        final=paths.final,
        metrics=paths.final / SLEEVE_CORRECTIVE_METRICS_NAME,
    )


def _validated_config(namespace: argparse.Namespace) -> PocConfig:
    source_blend = namespace.source_blend.resolve()
    vmd = namespace.vmd.resolve() if namespace.vmd is not None else None
    output_blend = namespace.output_blend.resolve()
    output_dir = namespace.output_dir.resolve()
    source_static_metrics = (
        namespace.source_static_metrics.resolve()
        if namespace.source_static_metrics is not None
        else None
    )
    orientation_gallery_metrics = (
        namespace.orientation_gallery_metrics.resolve()
        if namespace.orientation_gallery_metrics is not None
        else None
    )

    if not source_blend.is_file():
        raise ValueError(f"Source blend does not exist: {source_blend}")
    if source_blend.suffix.lower() != ".blend":
        raise ValueError(f"Source blend must use the .blend extension: {source_blend}")
    if namespace.setup_only:
        if vmd is None or not vmd.is_file():
            raise ValueError(f"Reference VMD does not exist: {vmd}")
        if vmd.suffix.lower() != ".vmd":
            raise ValueError(f"Reference VMD must use the .vmd extension: {vmd}")
    if output_blend.name != OUTPUT_BLEND_NAME:
        raise ValueError(f"Output blend must be named {OUTPUT_BLEND_NAME}")
    if output_dir.name != OUTPUT_DIRECTORY_NAME:
        raise ValueError(f"Output directory must be named {OUTPUT_DIRECTORY_NAME}")
    static_mode = (
        namespace.search_static
        or namespace.select_static
        or namespace.orientation_gallery
        or namespace.chin_support_refinement
        or namespace.collision_severity_diagnostic
        or namespace.sleeve_corrective_feasibility
    )
    if static_mode and (
        source_blend.name != OUTPUT_BLEND_NAME or not _same_path(source_blend, output_blend)
    ):
        raise ValueError("Static modes must open the same existing POC blend")
    if namespace.frame_start < 0 or namespace.frame_end < namespace.frame_start:
        raise ValueError("Frame range must be a valid non-negative interval")

    run_metrics_path = None
    if static_mode:
        if namespace.run_id is None:
            raise ValueError("Static modes require a run ID")
        paths = (
            orientation_gallery_run_paths(output_dir, namespace.run_id)
            if namespace.orientation_gallery
            else static_run_paths(output_dir, namespace.run_id)
        )
        if namespace.chin_support_refinement:
            paths = chin_support_run_paths(output_dir, namespace.run_id)
            run_metrics_path = paths.metrics
        elif namespace.collision_severity_diagnostic:
            paths = collision_severity_run_paths(output_dir, namespace.run_id)
            run_metrics_path = paths.metrics
        elif namespace.sleeve_corrective_feasibility:
            paths = sleeve_corrective_run_paths(output_dir, namespace.run_id)
            run_metrics_path = paths.metrics
        else:
            run_metrics_path = paths.metrics
        if (namespace.search_static or namespace.orientation_gallery or namespace.chin_support_refinement or namespace.collision_severity_diagnostic or namespace.sleeve_corrective_feasibility) and paths.final.exists() and not namespace.overwrite_run:
            raise ValueError(f"Static run already exists: {paths.final}")
        if (namespace.search_static or namespace.orientation_gallery or namespace.chin_support_refinement or namespace.collision_severity_diagnostic or namespace.sleeve_corrective_feasibility) and paths.temporary.exists() and not namespace.overwrite_run:
            raise ValueError(f"Temporary static run already exists: {paths.temporary}")
    if namespace.select_static:
        if not namespace.source_candidate_id or not SOURCE_CANDIDATE_PATTERN.fullmatch(
            namespace.source_candidate_id
        ):
            raise ValueError("Select-static requires a reviewed source candidate ID")
        if run_metrics_path is None or not run_metrics_path.is_file():
            raise ValueError(f"Select-static run metrics do not exist: {run_metrics_path}")
    elif namespace.orientation_gallery:
        if not namespace.source_candidate_id or not SOURCE_CANDIDATE_PATTERN.fullmatch(
            namespace.source_candidate_id
        ):
            raise ValueError("Orientation gallery requires a source candidate ID")
        if source_static_metrics is None or not source_static_metrics.is_file():
            raise ValueError(
                f"Orientation gallery source metrics do not exist: {source_static_metrics}"
            )
    elif namespace.chin_support_refinement:
        if not namespace.source_candidate_id or not SOURCE_CANDIDATE_PATTERN.fullmatch(
            namespace.source_candidate_id
        ):
            raise ValueError("Chin-support refinement requires a source candidate ID")
        if source_static_metrics is None or not source_static_metrics.is_file():
            raise ValueError(
                f"Chin-support source metrics do not exist: {source_static_metrics}"
            )
        if namespace.orientation_source_id != G14_ORIENTATION_SOURCE_ID:
            raise ValueError(
                "Chin-support refinement requires the controller-selected G14 source ID"
            )
        if orientation_gallery_metrics is None or not orientation_gallery_metrics.is_file():
            raise ValueError("Chin-support refinement requires persisted orientation gallery metrics")
    elif namespace.collision_severity_diagnostic:
        if source_static_metrics is None or not source_static_metrics.is_file():
            raise ValueError(
                f"Collision severity source metrics do not exist: {source_static_metrics}"
            )
        if namespace.source_candidate_id is not None or namespace.orientation_source_id is not None:
            raise ValueError("Collision severity diagnostic uses its fixed evidence candidates")
        if orientation_gallery_metrics is not None:
            raise ValueError("Collision severity diagnostic does not use gallery metrics")
    elif namespace.sleeve_corrective_feasibility:
        if source_static_metrics is None or not source_static_metrics.is_file():
            raise ValueError(
                f"Sleeve corrective source metrics do not exist: {source_static_metrics}"
            )
        if namespace.source_candidate_id is not None or namespace.orientation_source_id is not None:
            raise ValueError("Sleeve corrective feasibility uses fixed near-contact candidates")
        if orientation_gallery_metrics is not None:
            raise ValueError("Sleeve corrective feasibility does not use gallery metrics")
    elif (
        namespace.source_candidate_id is not None
        or namespace.orientation_source_id is not None
        or source_static_metrics is not None
        or orientation_gallery_metrics is not None
    ):
        raise ValueError(
            "Source candidate and source static metrics are only valid with static selection or gallery"
        )

    return PocConfig(
        source_blend=source_blend,
        vmd=vmd,
        output_blend=output_blend,
        output_dir=output_dir,
        frame_start=namespace.frame_start,
        frame_end=namespace.frame_end,
        setup_only=namespace.setup_only,
        solve_static=False,
        search_static=namespace.search_static,
        select_static=namespace.select_static,
        orientation_gallery=namespace.orientation_gallery,
        chin_support_refinement=namespace.chin_support_refinement,
        collision_severity_diagnostic=namespace.collision_severity_diagnostic,
        sleeve_corrective_feasibility=namespace.sleeve_corrective_feasibility,
        run_id=namespace.run_id,
        overwrite_run=namespace.overwrite_run,
        source_candidate_id=namespace.source_candidate_id,
        orientation_source_id=namespace.orientation_source_id,
        source_static_metrics=source_static_metrics,
        orientation_gallery_metrics=orientation_gallery_metrics,
        run_metrics_path=run_metrics_path,
    )


def parse_blender_args(argv: Sequence[str] | None = None) -> PocConfig:
    arguments = list(sys.argv if argv is None else argv)
    if "--" not in arguments:
        raise ValueError("POC arguments must appear after Blender's -- separator")
    return _validated_config(_parser().parse_args(arguments[arguments.index("--") + 1 :]))


def pmx_point_to_blender_rest(point: Sequence[float]) -> tuple[float, float, float]:
    if len(point) != 3:
        raise ValueError("PMX point must have three components")
    x, y, z = (float(value) for value in point)
    if not all(math.isfinite(value) for value in (x, y, z)):
        raise ValueError("PMX point must be finite")
    return (x * PMX_TO_BLENDER_SCALE, z * PMX_TO_BLENDER_SCALE, y * PMX_TO_BLENDER_SCALE)


def contact_target_variants() -> tuple[tuple[float, tuple[float, float, float]], ...]:
    return (
        (0.35, (0.0, 0.0, 0.0)),
        (0.35, (0.0, 0.0, 0.005)),
        (0.35, (0.0, 0.0, 0.010)),
        (0.35, (0.0, 0.0, 0.015)),
        (0.35, (0.005, 0.0, 0.010)),
        (0.35, (-0.005, 0.0, 0.010)),
        (0.35, (-0.005, 0.0, 0.015)),
        (0.35, (-0.0075, 0.0, 0.015)),
        (0.35, (-0.010, 0.0, 0.010)),
        (0.35, (-0.010, 0.0, 0.015)),
        (0.35, (-0.010, 0.0, 0.0175)),
        (0.35, (-0.008, 0.0, 0.0175)),
        (0.35, (-0.009, 0.0, 0.0175)),
        (0.35, (-0.011, 0.0, 0.0175)),
        (0.35, (-0.012, 0.0, 0.0175)),
        (0.35, (-0.010, 0.0, 0.0165)),
        (0.35, (-0.010, 0.0, 0.0185)),
        (0.35, (-0.012, 0.0, 0.0185)),
        (0.35, (-0.010, 0.0, 0.020)),
        (0.35, (-0.015, 0.0, 0.015)),
        (0.35, (-0.020, 0.0, 0.015)),
        (0.50, (0.0, 0.0, 0.0)),
        (0.65, (0.0, 0.0, 0.0)),
        (0.80, (0.0, 0.0, 0.0)),
        (1.00, (0.0, 0.0, 0.0)),
        (0.65, (-0.025, 0.0, 0.015)),
        (0.65, (0.025, 0.0, -0.015)),
    )


def pole_search_basis(
    shoulder: Sequence[float],
    wrist: Sequence[float],
    base_pole: Sequence[float],
) -> dict[str, object]:
    math_module = _load_motion_math()
    chain = math_module.normalize(math_module.vector_subtract(wrist, shoulder))
    pole_delta = math_module.vector_subtract(base_pole, shoulder)
    radial = math_module.project_onto_plane(pole_delta, chain)
    if math_module.length(radial) <= math_module.EPSILON:
        radial = math_module.project_onto_plane((0.0, -1.0, 0.0), chain)
    if math_module.length(radial) <= math_module.EPSILON:
        radial = math_module.project_onto_plane((0.0, 0.0, 1.0), chain)
    radial = math_module.normalize(radial)
    tangent = math_module.normalize(math_module.cross(chain, radial))
    triad = (radial, tangent, chain)
    semantic = {
        "outward_lateral": (1.0, 0.0, 0.0),
        "forward_depth": (0.0, -1.0, 0.0),
        "vertical": (0.0, 0.0, 1.0),
    }
    labels = tuple(semantic)
    assignment = max(
        itertools.permutations(range(3)),
        key=lambda indices: sum(
            abs(math_module.dot(triad[index], semantic[label]))
            for label, index in zip(labels, indices, strict=True)
        ),
    )
    result = {"derivation": "shoulder_wrist_chain"}
    for label, index in zip(labels, assignment, strict=True):
        axis = triad[index]
        if math_module.dot(axis, semantic[label]) < 0.0:
            axis = math_module.vector_scale(axis, -1.0)
        result[label] = axis
    return result


def pole_offset_grid() -> tuple[tuple[float, float, float], ...]:
    step = 0.16
    return (
        (0.0, 0.0, 0.0),
        (-step, 0.0, 0.0),
        (step, 0.0, 0.0),
        (0.0, -step, 0.0),
        (0.0, step, 0.0),
        (0.0, 0.0, -step),
        (0.0, 0.0, step),
        (-step, -step, 0.0),
        (-step, step, 0.0),
        (step, -step, 0.0),
        (step, step, 0.0),
        (-step, 0.0, step),
        (step, 0.0, step),
    )


def static_candidate_grid() -> tuple[StaticCandidate, ...]:
    palm_orientations = (
        (0.0, 0.0, 0.0),
        (-15.0, 20.0, -10.0),
        (15.0, -20.0, 10.0),
        (12.0, -18.0, 8.0),
        (18.0, -22.0, 12.0),
        (20.0, -25.0, 12.0),
        (-25.0, 35.0, -15.0),
        (25.0, -35.0, 15.0),
        (-35.0, 20.0, 20.0),
        (35.0, -20.0, -20.0),
        (0.0, 40.0, 0.0),
        (0.0, -40.0, 0.0),
    )
    pole_offsets = (-0.16, -0.08, 0.0, 0.08, 0.16)
    twist_allocations = (
        (0.25, 0.50, 0.25),
        (0.35, 0.50, 0.15),
        (0.20, 0.60, 0.20),
    )
    combinations = itertools.product(
        contact_target_variants(),
        palm_orientations,
        pole_offsets,
        twist_allocations,
    )
    legacy = tuple(
        StaticCandidate(
            candidate_id=f"candidate_{index:03d}",
            alignment_factor=target_variant[0],
            hand_offset=target_variant[1],
            palm_euler_deg=palm_euler_deg,
            pole_offset=pole_offset,
            twist_influences=twist_influences,
        )
        for index, (target_variant, palm_euler_deg, pole_offset, twist_influences) in enumerate(
            combinations,
            1,
        )
    )
    refined_palm_orientations = palm_orientations[:6]
    refined_combinations = itertools.product(
        (
            (0.65, (0.025, 0.0, -0.015)),
            (0.70, (0.025, 0.0, -0.015)),
        ),
        refined_palm_orientations,
        pole_offset_grid(),
        twist_allocations,
    )
    refined = tuple(
        StaticCandidate(
            candidate_id=f"pole3d_{index:04d}",
            alignment_factor=target_variant[0],
            hand_offset=target_variant[1],
            palm_euler_deg=palm_euler_deg,
            pole_offset=0.0,
            twist_influences=twist_influences,
            pole_offset_3d=pole_offset_3d,
            search_family="pole_3d",
        )
        for index, (target_variant, palm_euler_deg, pole_offset_3d, twist_influences) in enumerate(
            refined_combinations,
            1,
        )
    )
    return legacy + refined


def attribute_collision_pairs(overlap_pairs, moving_records, target_records, vertices):
    points = tuple(tuple(float(value) for value in vertex) for vertex in vertices)

    def centroid(record):
        return tuple(
            sum(points[index][axis] for index in record["vertices"]) / len(record["vertices"])
            for axis in range(3)
        )

    counts_by_moving_region = {}
    counts_by_moving_group = {}
    counts_by_torso_group = {}
    counts_by_pair = {}
    representatives = []
    overlap_vertex_indices = set()
    for moving_index, target_index in overlap_pairs:
        moving = moving_records[int(moving_index)]
        target = target_records[int(target_index)]
        moving_region = str(moving["region"])
        moving_group = str(moving["group"])
        target_region = str(target["region"])
        target_group = str(target["group"])
        pair_name = f"{moving_region}:{moving_group} -> {target_region}:{target_group}"
        for counts, key in (
            (counts_by_moving_region, moving_region),
            (counts_by_moving_group, moving_group),
            (counts_by_torso_group, target_group),
            (counts_by_pair, pair_name),
        ):
            counts[key] = counts.get(key, 0) + 1
        overlap_vertex_indices.update(moving["vertices"])
        overlap_vertex_indices.update(target["vertices"])
        if len(representatives) < 12:
            moving_area = _polygon_area(points, moving["vertices"])
            torso_area = _polygon_area(points, target["vertices"])
            representatives.append({
                "moving_region": moving_region,
                "moving_group": moving_group,
                "moving_polygon_index": int(moving["polygon_index"]),
                "moving_world_point": centroid(moving),
                "moving_polygon_area_blender2": moving_area,
                "moving_polygon_area_pmx2": moving_area / (PMX_TO_BLENDER_SCALE ** 2),
                "torso_region": target_region,
                "torso_group": target_group,
                "torso_polygon_index": int(target["polygon_index"]),
                "torso_world_point": centroid(target),
                "torso_polygon_area_blender2": torso_area,
                "torso_polygon_area_pmx2": torso_area / (PMX_TO_BLENDER_SCALE ** 2),
            })
    if overlap_vertex_indices:
        overlap_points = tuple(points[index] for index in overlap_vertex_indices)
        overlap_bbox = overlap_bbox_evidence(overlap_points)
    else:
        overlap_bbox = None
    return {
        "counts_by_moving_region": counts_by_moving_region,
        "counts_by_moving_group": counts_by_moving_group,
        "counts_by_torso_group": counts_by_torso_group,
        "counts_by_pair": counts_by_pair,
        "representative_pairs": representatives,
        "overlap_bbox": overlap_bbox,
    }


def _linear_percentile(values, percentile: float) -> float:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * float(percentile)
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def summarize_penetration_depths(depths) -> dict[str, float | int]:
    values = tuple(max(0.0, float(depth)) for depth in depths)
    median = _linear_percentile(values, 0.5)
    p95 = _linear_percentile(values, 0.95)
    maximum = max(values, default=0.0)
    return {
        "sample_count": len(values),
        "median_blender": median,
        "p95_blender": p95,
        "max_blender": maximum,
        "median_pmx": median / PMX_TO_BLENDER_SCALE,
        "p95_pmx": p95 / PMX_TO_BLENDER_SCALE,
        "max_pmx": maximum / PMX_TO_BLENDER_SCALE,
    }


def _polygon_area(points, indices) -> float:
    polygon = [points[int(index)] for index in indices]
    if len(polygon) < 3:
        return 0.0
    origin = polygon[0]
    area = 0.0
    for first, second in zip(polygon[1:-1], polygon[2:], strict=True):
        left = tuple(first[axis] - origin[axis] for axis in range(3))
        right = tuple(second[axis] - origin[axis] for axis in range(3))
        cross = (
            left[1] * right[2] - left[2] * right[1],
            left[2] * right[0] - left[0] * right[2],
            left[0] * right[1] - left[1] * right[0],
        )
        area += math.sqrt(sum(value * value for value in cross)) * 0.5
    return area


def collision_area_evidence(overlap_pairs, moving_records, target_records, vertices):
    points = tuple(tuple(float(value) for value in point) for point in vertices)
    moving_indices = {int(pair[0]) for pair in overlap_pairs}
    target_indices = {int(pair[1]) for pair in overlap_pairs}
    moving_keys = {
        (moving_records[index]["region"], moving_records[index]["group"])
        for index in moving_indices
    }
    moving_area = sum(
        _polygon_area(points, moving_records[index]["vertices"])
        for index in moving_indices
    )
    target_area = sum(
        _polygon_area(points, target_records[index]["vertices"])
        for index in target_indices
    )
    moving_region_area = sum(
        _polygon_area(points, record["vertices"])
        for record in moving_records
        if (record["region"], record["group"]) in moving_keys
    )
    area_scale = PMX_TO_BLENDER_SCALE ** 2
    return {
        "moving_intersecting_polygon_count": len(moving_indices),
        "target_intersecting_polygon_count": len(target_indices),
        "moving_intersecting_area_blender2": moving_area,
        "target_intersecting_area_blender2": target_area,
        "moving_region_area_blender2": moving_region_area,
        "moving_intersection_area_ratio": (
            moving_area / moving_region_area if moving_region_area > 0.0 else 0.0
        ),
        "moving_intersecting_area_pmx2": moving_area / area_scale,
        "target_intersecting_area_pmx2": target_area / area_scale,
        "moving_region_area_pmx2": moving_region_area / area_scale,
    }


def overlap_bbox_evidence(points):
    values = tuple(tuple(float(value) for value in point) for point in points)
    if not values:
        return None
    minimum = tuple(min(point[axis] for point in values) for axis in range(3))
    maximum = tuple(max(point[axis] for point in values) for axis in range(3))
    dimensions = tuple(maximum[axis] - minimum[axis] for axis in range(3))
    center = tuple((maximum[axis] + minimum[axis]) * 0.5 for axis in range(3))
    return {
        "min": minimum,
        "max": maximum,
        "dimensions": dimensions,
        "center": center,
        "dimensions_pmx": tuple(value / PMX_TO_BLENDER_SCALE for value in dimensions),
        "center_pmx": tuple(value / PMX_TO_BLENDER_SCALE for value in center),
    }


def classify_silhouette_visibility(view_hits):
    result = {}
    any_visible = False
    for view, hits in view_hits.items():
        values = tuple(bool(value) for value in hits)
        visible_count = sum(values)
        any_visible = any_visible or visible_count > 0
        result[view] = {
            "sample_count": len(values),
            "visible_count": visible_count,
            "covered_count": len(values) - visible_count,
            "classification": (
                "reaches_visible_outer_surface"
                if visible_count else "internal_or_covered"
            ),
        }
    result["overall"] = (
        "visible_from_some_review_views" if any_visible else "internal_or_covered_all_views"
    )
    return result


def compare_penetration_scales(
    *, max_depth, median_mesh_edge, sleeve_thickness, chest_thickness
):
    depth = float(max_depth)
    result = {"max_depth_blender": depth}
    for key, value in (
        ("depth_to_median_edge_ratio", median_mesh_edge),
        ("depth_to_sleeve_thickness_ratio", sleeve_thickness),
        ("depth_to_chest_thickness_ratio", chest_thickness),
    ):
        numeric = float(value) if value is not None else 0.0
        result[key] = depth / numeric if numeric > 0.0 else None
    return result


def combine_head_collision_evidence(
    *,
    palm_intersections: int,
    finger_intersections: int,
    full_hand_intersections: int,
    signed_penetration_depth: float,
) -> dict[str, object]:
    counts = {
        "palm": int(palm_intersections),
        "fingers": int(finger_intersections),
        "full_hand": int(full_hand_intersections),
    }
    sources = tuple(name for name, count in counts.items() if count > 0)
    collision_count = max(counts.values(), default=0)
    penetration_depth = (
        max(float(signed_penetration_depth), MESH_PENETRATION_TOLERANCE * 2.0)
        if collision_count > 0
        else 0.0
    )
    return {
        "collision_count": collision_count,
        "penetration_depth": penetration_depth,
        "sources": sources,
        "counts": counts,
    }


def candidate_render_names(count: int = STATIC_RENDER_COUNT) -> tuple[str, ...]:
    if count < 0:
        raise ValueError("Candidate render count cannot be negative")
    return tuple(
        f"candidate_{candidate_index:03d}/{view}.png"
        for candidate_index in range(1, count + 1)
        for view in CANDIDATE_VIEWS
    )


def render_artifact_paths(run_dir: Path, count: int = STATIC_RENDER_COUNT) -> tuple[Path, ...]:
    return tuple(
        Path(run_dir) / STATIC_CANDIDATE_DIRECTORY / relative
        for relative in candidate_render_names(count)
    )


def rank_source_mapping(records: Sequence[dict[str, object]]) -> dict[str, str]:
    ordered = sorted(records, key=lambda record: int(record["rank"]))
    ranks = [int(record["rank"]) for record in ordered]
    if ranks != list(range(1, len(ordered) + 1)):
        raise ValueError("Rendered candidate ranks must be contiguous from one")
    return {
        f"candidate_{rank:03d}": str(record["source_candidate_id"])
        for rank, record in zip(ranks, ordered, strict=True)
    }


def assign_render_ranks(records: Sequence[dict[str, object]]) -> None:
    for rank, record in enumerate(records, 1):
        record["rank"] = rank


def static_search_policy(
    *,
    collision_clear_count: int,
    selection_eligible_count: int,
) -> dict[str, object]:
    can_render_ranked = (
        collision_clear_count >= STATIC_RENDER_COUNT
        and selection_eligible_count >= STATIC_RENDER_COUNT
    )
    return {
        "selection_status": "NEEDS_CONTEXT" if can_render_ranked else "BLOCKED_NEEDS_CONTEXT",
        "ranked_render_count": STATIC_RENDER_COUNT if can_render_ranked else 0,
    }


def compare_static_state(
    expected: dict[str, object],
    actual: dict[str, object],
    tolerance: float,
) -> tuple[str, ...]:
    differences: list[str] = []
    for key in sorted(set(expected) | set(actual)):
        if key not in expected or key not in actual:
            differences.append(f"{key} is missing from one state")
            continue
        left = expected[key]
        right = actual[key]
        if isinstance(left, (tuple, list)) and isinstance(right, (tuple, list)):
            if len(left) != len(right) or any(
                abs(float(a) - float(b)) > tolerance
                for a, b in zip(left, right, strict=False)
            ):
                differences.append(f"{key} differs: {left!r} != {right!r}")
        elif isinstance(left, (int, float)) and isinstance(right, (int, float)):
            if abs(float(left) - float(right)) > tolerance:
                differences.append(f"{key} differs: {left!r} != {right!r}")
        elif left != right:
            differences.append(f"{key} differs: {left!r} != {right!r}")
    return tuple(differences)


def compare_selected_metrics(
    stored: dict[str, object],
    measured: dict[str, object],
) -> tuple[str, ...]:
    tolerances = {
        "surface_contact_distance": 1e-5,
        "elbow_angle_deg": 1e-3,
        "wrist_swing_deg": 1e-3,
        "wrist_twist_deg": 1e-3,
        "minimum_clearance": 1e-5,
    }
    differences: list[str] = []
    for name, tolerance in tolerances.items():
        if name not in stored or name not in measured:
            continue
        if abs(float(stored[name]) - float(measured[name])) > tolerance:
            differences.append(
                f"{name} changed from {float(stored[name]):.9g} to {float(measured[name]):.9g}"
            )
    for name in ("head_collision_count", "torso_penetration_count"):
        if name in stored and name in measured and int(stored[name]) != int(measured[name]):
            differences.append(f"{name} changed from {stored[name]} to {measured[name]}")
    for name in ("hand_contact_world", "nearest_chin_surface_world"):
        if name in stored and name in measured and any(
            abs(float(left) - float(right)) > 1e-5
            for left, right in zip(stored[name], measured[name], strict=True)
        ):
            differences.append(f"{name} changed from {stored[name]} to {measured[name]}")
    for name in ("contact_patch_count", "surface_intersection_count"):
        if name in stored and name in measured and int(stored[name]) != int(measured[name]):
            differences.append(f"{name} changed from {stored[name]} to {measured[name]}")
    return tuple(differences)


def static_selection_eligibility(
    metrics: dict[str, object],
    warning_distance: float,
) -> tuple[str, ...]:
    math_module = _load_motion_math()
    reasons = []
    if float(metrics["surface_contact_distance"]) > float(warning_distance):
        reasons.append("Surface contact exceeds the geometry-derived warning distance")
    if int(metrics["contact_patch_count"]) <= 0:
        reasons.append("Surface contact patch is empty")
    if int(metrics.get("thumb_index_contact_patch_count", metrics["contact_patch_count"])) <= 0:
        reasons.append("Thumb/index lower-jaw contact patch is empty")
    if int(metrics["surface_intersection_count"]) > 0:
        reasons.append("Contact surface intersection is present")
    if int(metrics["head_collision_count"]) > 0:
        reasons.append("Head collision is present")
    if int(metrics["torso_penetration_count"]) > 0:
        reasons.append("Torso collision is present")
    if float(metrics["minimum_clearance"]) < math_module.CLEARANCE_COMFORT_DISTANCE:
        reasons.append("Torso clearance is below the comfort distance")
    if float(metrics["continuity_distance"]) > math_module.CONTINUITY_COMFORT_DISTANCE:
        reasons.append("Continuity displacement exceeds the comfort distance")
    elbow = float(metrics["elbow_angle_deg"])
    if not math_module.ELBOW_COMFORT_MIN_DEG <= elbow <= math_module.ELBOW_COMFORT_MAX_DEG:
        reasons.append("Elbow angle is outside the comfort range")
    return tuple(reasons)


def _triangulated_polygons(polygons: Sequence[Sequence[int]]) -> tuple[tuple[int, int, int], ...]:
    triangles: list[tuple[int, int, int]] = []
    for polygon in polygons:
        indices = tuple(int(index) for index in polygon)
        triangles.extend(
            (indices[0], indices[offset], indices[offset + 1])
            for offset in range(1, len(indices) - 1)
        )
    return tuple(triangles)


def lower_chin_surface_region(
    vertices: Sequence[Sequence[float]],
    polygons: Sequence[Sequence[int]],
    *,
    anchor: Sequence[float],
    radius: float,
) -> dict[str, object]:
    """Return the connected local triangle patch surrounding the chin anchor."""

    math_module = _load_motion_math()
    points = tuple(tuple(float(value) for value in vertex) for vertex in vertices)
    triangles = _triangulated_polygons(polygons)
    if not triangles or radius <= 0.0:
        raise ValueError("Lower-chin topology and region radius must be non-empty")
    projections = tuple(
        math_module.closest_point_on_triangle(
            anchor, points[triangle[0]], points[triangle[1]], points[triangle[2]]
        )
        for triangle in triangles
    )
    seed = min(range(len(triangles)), key=lambda index: projections[index].distance)
    centroids = tuple(
        tuple(sum(points[index][axis] for index in triangle) / 3.0 for axis in range(3))
        for triangle in triangles
    )
    local = {
        index
        for index, centroid in enumerate(centroids)
        if math_module.length(math_module.vector_subtract(centroid, anchor)) <= radius
    }
    local.add(seed)
    connected = {seed}
    frontier = [seed]
    while frontier:
        current = frontier.pop()
        current_vertices = set(triangles[current])
        for index in sorted(local - connected):
            if len(current_vertices.intersection(triangles[index])) >= 2:
                connected.add(index)
                frontier.append(index)
    selected_indices = tuple(sorted(connected))
    selected_triangles = tuple(triangles[index] for index in selected_indices)
    vertex_indices = tuple(sorted({index for triangle in selected_triangles for index in triangle}))
    edge_lengths = tuple(
        math_module.length(math_module.vector_subtract(points[right], points[left]))
        for triangle in selected_triangles
        for left, right in ((triangle[0], triangle[1]), (triangle[1], triangle[2]), (triangle[2], triangle[0]))
    )
    return {
        "triangle_indices": selected_indices,
        "triangles": selected_triangles,
        "triangle_count": len(selected_triangles),
        "vertex_indices": vertex_indices,
        "vertex_count": len(vertex_indices),
        "edge_lengths": edge_lengths,
        "seed_triangle_index": seed,
    }


def measure_triangle_surface_contact(
    contact_points: dict[str, Sequence[Sequence[float]]],
    surface_vertices: Sequence[Sequence[float]],
    surface_triangles: Sequence[Sequence[int]],
    *,
    patch_distance: float,
) -> dict[str, object]:
    """Measure named hand samples against an oriented triangle surface."""

    math_module = _load_motion_math()
    vertices = tuple(tuple(float(value) for value in vertex) for vertex in surface_vertices)
    triangles = tuple(tuple(int(index) for index in triangle) for triangle in surface_triangles)
    samples = []
    for source in sorted(contact_points):
        for point in contact_points[source]:
            nearest = None
            for triangle_index, triangle in enumerate(triangles):
                projection = math_module.closest_point_on_triangle(
                    point, vertices[triangle[0]], vertices[triangle[1]], vertices[triangle[2]]
                )
                if nearest is None or projection.distance < nearest[0].distance:
                    edge_a = math_module.vector_subtract(vertices[triangle[1]], vertices[triangle[0]])
                    edge_b = math_module.vector_subtract(vertices[triangle[2]], vertices[triangle[0]])
                    normal = math_module.normalize(math_module.cross(edge_a, edge_b))
                    signed_distance = math_module.dot(
                        math_module.vector_subtract(point, projection.point), normal
                    )
                    nearest = (projection, signed_distance, triangle_index)
            if nearest is not None:
                samples.append((nearest[0].distance, source, tuple(point), nearest[0].point, nearest[1], nearest[2]))
    if not samples:
        raise ValueError("Contact measurement requires points and surface triangles")
    best = min(samples, key=lambda item: (item[0], item[1], item[2]))
    return {
        "surface_contact_distance": float(best[0]),
        "contact_source": best[1],
        "hand_contact_world": tuple(float(value) for value in best[2]),
        "nearest_chin_surface_world": tuple(float(value) for value in best[3]),
        "surface_signed_distance": float(best[4]),
        "nearest_chin_triangle_index": int(best[5]),
        "surface_intersection_count": sum(
            signed_distance < -MESH_PENETRATION_TOLERANCE
            for _distance, _source, _point, _nearest, signed_distance, _triangle in samples
        ),
        "contact_patch_count": sum(distance <= patch_distance for distance, *_rest in samples),
        "contact_sample_count": len(samples),
    }


def signed_elbow_flex_is_valid(flex_degrees: float) -> bool:
    flex = float(flex_degrees)
    return math.isfinite(flex) and ELBOW_FLEX_MIN_DEG <= flex <= ELBOW_FLEX_MAX_DEG


def blender_backup_path(output_blend: Path) -> Path:
    return Path(f"{output_blend}1")


def _require_blender() -> None:
    if (
        bpy is None
        or Euler is None
        or Matrix is None
        or Quaternion is None
        or Vector is None
        or BVHTree is None
    ):
        raise RuntimeError("This operation must run inside Blender")


def _same_path(left: Path, right: Path) -> bool:
    return str(left.resolve()).casefold() == str(right.resolve()).casefold()


def _select_armature(armature) -> None:
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature


def _validate_scene_objects():
    armature = bpy.data.objects.get(ARMATURE_NAME)
    mesh = bpy.data.objects.get(MESH_NAME)
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError(f"Missing armature object {ARMATURE_NAME}")
    if mesh is None or mesh.type != "MESH":
        raise RuntimeError(f"Missing mesh object {MESH_NAME}")
    missing = [name for name in REQUIRED_BONES if name not in armature.data.bones]
    if missing:
        raise RuntimeError(f"Missing required PMX bones: {', '.join(missing)}")
    return armature, mesh


def _import_reference_action(config: PocConfig, armature):
    _select_armature(armature)

    # mmd_tools offsets imported keys from the current scene frame.
    bpy.context.scene.frame_set(0)
    result = bpy.ops.mmd_tools.import_vmd(
        filepath=str(config.vmd),
        bone_mapper="PMX",
        scale=0.08,
        margin=0,
        create_new_action=True,
        use_pose_mode=False,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"mmd_tools VMD import failed: {sorted(result)}")

    animation_data = armature.animation_data
    action = animation_data.action if animation_data else None
    if action is None:
        raise RuntimeError("VMD import did not assign an action to the armature")
    action.name = REFERENCE_ACTION_NAME
    action_range = tuple(float(value) for value in action.frame_range)
    if action_range != EXPECTED_ACTION_RANGE:
        raise RuntimeError(
            f"Imported action range must be exactly 0-240, got {action_range[0]:g}-{action_range[1]:g}"
        )
    return action


def _create_proxy_chain(armature) -> None:
    _select_armature(armature)
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bones = armature.data.edit_bones
    geometry = {
        proxy_name: (
            edit_bones[source_name].head.copy(),
            edit_bones[source_name].tail.copy(),
            float(edit_bones[source_name].roll),
        )
        for proxy_name, source_name in PROXY_SOURCE_BONES.items()
    }
    for name in PROXY_BONE_NAMES:
        existing = edit_bones.get(name)
        if existing is not None:
            edit_bones.remove(existing)

    upper = edit_bones.new(PROXY_BONE_NAMES[0])
    upper.head, upper.tail, upper.roll = geometry[PROXY_BONE_NAMES[0]]
    upper.parent = edit_bones["右肩C"]
    upper.use_connect = False
    upper.use_deform = False

    forearm = edit_bones.new(PROXY_BONE_NAMES[1])
    forearm.head, forearm.tail, forearm.roll = geometry[PROXY_BONE_NAMES[1]]
    forearm.parent = upper
    forearm.use_connect = True
    forearm.use_deform = False

    hand = edit_bones.new(PROXY_BONE_NAMES[2])
    hand.head, hand.tail, hand.roll = geometry[PROXY_BONE_NAMES[2]]
    hand.parent = forearm
    hand.use_connect = True
    hand.use_deform = False
    for proxy_name, source_name in PROXY_SOURCE_BONES.items():
        roll_delta = abs(edit_bones[proxy_name].roll - edit_bones[source_name].roll)
        if roll_delta > ROLL_TOLERANCE:
            raise RuntimeError(
                f"Proxy roll mismatch for {proxy_name}: {edit_bones[proxy_name].roll} vs "
                f"{edit_bones[source_name].roll}"
            )
    bpy.ops.object.mode_set(mode="POSE")
    armature.pose.bones[PROXY_BONE_NAMES[0]].ik_stretch = 0.0
    armature.pose.bones[PROXY_BONE_NAMES[1]].ik_stretch = 0.0
    bpy.ops.object.mode_set(mode="OBJECT")


def _world_point(armature, point):
    return armature.matrix_world @ point


def _pose_head_world(armature, bone_name: str):
    return _world_point(armature, armature.pose.bones[bone_name].head)


def _calibrated_chin_points(armature):
    rest_point = Vector(pmx_point_to_blender_rest(PMX_CHIN_SURFACE))
    head_rest = armature.data.bones["頭"].matrix_local
    head_local = head_rest.inverted() @ rest_point
    world_point = armature.matrix_world @ armature.pose.bones["頭"].matrix @ head_local
    return rest_point, head_local, world_point


def _create_control(collection, name: str, location, display_type: str, size: float):
    old = bpy.data.objects.get(name)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    control = bpy.data.objects.new(name, None)
    collection.objects.link(control)
    control.empty_display_type = display_type
    control.empty_display_size = size
    control.location = location
    control.show_in_front = True
    return control


def _create_controls(armature):
    collection = bpy.data.collections.get(CONTROL_COLLECTION_NAME)
    if collection is None:
        collection = bpy.data.collections.new(CONTROL_COLLECTION_NAME)
        bpy.context.scene.collection.children.link(collection)

    shoulder = _pose_head_world(armature, "右腕")
    elbow = _pose_head_world(armature, "右ひじ")
    wrist = _pose_head_world(armature, "右手首")
    reach_axis = wrist - shoulder
    if reach_axis.length_squared <= 1e-12:
        raise RuntimeError("Cannot build controls from a zero-length shoulder-to-wrist axis")
    elbow_radial = elbow - shoulder - reach_axis * ((elbow - shoulder).dot(reach_axis) / reach_axis.length_squared)
    if elbow_radial.length < 1e-6:
        elbow_radial = armature.matrix_world.to_3x3() @ Vector((0.0, -1.0, 0.0))
    pole_location = elbow + elbow_radial.normalized() * 0.5

    palm_space = _create_control(
        collection,
        PALM_SPACE_NAME,
        wrist,
        "PLAIN_AXES",
        0.08,
    )
    palm_space.matrix_world = armature.matrix_world @ armature.pose.bones["右手首"].matrix

    controls = {
        "hand": _create_control(collection, CONTROL_NAMES["hand"], wrist, "SPHERE", 0.08),
        "pole": _create_control(collection, CONTROL_NAMES["pole"], pole_location, "CUBE", 0.08),
        "palm": _create_control(collection, CONTROL_NAMES["palm"], wrist, "ARROWS", 0.12),
        "chin": _create_control(
            collection,
            CONTROL_NAMES["chin"],
            _calibrated_chin_points(armature)[2],
            "SPHERE",
            0.05,
        ),
    }
    controls["palm"].parent = palm_space
    controls["palm"].matrix_parent_inverse = Matrix.Identity(4)
    controls["palm"].matrix_basis = Matrix.Identity(4)
    return controls


def _ensure_compensation_controls(armature):
    collection = bpy.data.collections.get(CONTROL_COLLECTION_NAME)
    if collection is None:
        collection = bpy.data.collections.new(CONTROL_COLLECTION_NAME)
        bpy.context.scene.collection.children.link(collection)
    controls = {}
    for key, control_name in COMPENSATION_CONTROL_NAMES.items():
        control = bpy.data.objects.get(control_name)
        if control is None:
            control = bpy.data.objects.new(control_name, None)
            collection.objects.link(control)
            control.empty_display_type = "ARROWS"
            control.empty_display_size = 0.08
            control.show_in_front = True
        control.rotation_mode = "QUATERNION"
        control.parent = armature
        control.matrix_parent_inverse = Matrix.Identity(4)
        control.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        control.location = armature.matrix_world.inverted() @ _pose_head_world(
            armature, COMPENSATION_BONES[key]
        )
        controls[key] = control

    if "POC_compensation_influence" not in armature:
        armature["POC_compensation_influence"] = 1.0
        armature.id_properties_ui("POC_compensation_influence").update(min=0.0, max=1.0)
    for key, spec in COMPENSATION_CONSTRAINT_SPECS.items():
        owner = armature.pose.bones[spec["owner_bone"]]
        constraint_name = COMPENSATION_CONSTRAINT_NAMES[key]
        constraint = owner.constraints.get(constraint_name)
        if constraint is None:
            constraint = owner.constraints.new("COPY_ROTATION")
            constraint.name = constraint_name
            constraint.target = controls[key]
            constraint.owner_space = spec["owner_space"]
            constraint.target_space = spec["target_space"]
            constraint.mix_mode = spec["mix_mode"]
            constraint.use_x = True
            constraint.use_y = True
            constraint.use_z = True
            constraint.influence = 0.0
            _add_influence_driver(constraint, armature, "POC_compensation_influence")
        elif constraint.target != controls[key]:
            raise RuntimeError(f"Compensation constraint target mismatch: {constraint_name}")
    return controls


def _compensation_constraints(armature):
    return {
        key: armature.pose.bones[COMPENSATION_BONES[key]].constraints[
            COMPENSATION_CONSTRAINT_NAMES[key]
        ]
        for key in COMPENSATION_BONES
    }


def _set_compensation_identity(controls) -> None:
    for control in controls.values():
        control.rotation_mode = "QUATERNION"
        control.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))


def _validate_compensation_baseline(armature, controls) -> None:
    constraints = _compensation_constraints(armature)
    previous_enabled = float(armature["POC_enabled"])
    previous_mutes = {key: constraint.mute for key, constraint in constraints.items()}
    _set_compensation_identity(controls)
    try:
        armature["POC_enabled"] = 1.0
        for constraint in constraints.values():
            constraint.mute = True
        armature.update_tag()
        _refresh_frame()
        baseline = {
            key: _world_rotation(armature, bone_name)
            for key, bone_name in COMPENSATION_BONES.items()
        }
        for constraint in constraints.values():
            constraint.mute = False
        armature.update_tag()
        _refresh_frame()
        enabled_deltas = {
            key: _rotation_delta_degrees(baseline[key], _world_rotation(armature, bone_name))
            for key, bone_name in COMPENSATION_BONES.items()
        }
        if any(delta > COMPENSATION_BASELINE_TOLERANCE_DEG for delta in enabled_deltas.values()):
            raise RuntimeError(f"Compensation identity controls introduce a baseline jump: {enabled_deltas}")
        response_deltas = {}
        for key, bone_name in COMPENSATION_BONES.items():
            controls[key].rotation_quaternion = Quaternion(
                Vector((1.0, 0.0, 0.0)), math.radians(1.0)
            )
            armature.update_tag()
            _refresh_frame()
            response_deltas[key] = _rotation_delta_degrees(
                baseline[key], _world_rotation(armature, bone_name)
            )
            controls[key].rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
            armature.update_tag()
            _refresh_frame()
        if any(not 0.99 <= delta <= 1.01 for delta in response_deltas.values()):
            raise RuntimeError(
                f"Compensation controls do not produce local quaternion deltas: {response_deltas}"
            )
        for constraint in constraints.values():
            constraint.mute = True
        armature.update_tag()
        _refresh_frame()
        restored = {
            key: _rotation_delta_degrees(baseline[key], _world_rotation(armature, bone_name))
            for key, bone_name in COMPENSATION_BONES.items()
        }
        if any(delta > COMPENSATION_BASELINE_TOLERANCE_DEG for delta in restored.values()):
            raise RuntimeError(f"Compensation constraints do not restore exactly: {restored}")
    finally:
        armature["POC_enabled"] = previous_enabled
        for key, constraint in constraints.items():
            constraint.mute = previous_mutes[key]
        armature.update_tag()
        _refresh_frame()


def _ensure_finger_controls(armature):
    collection = bpy.data.collections.get(CONTROL_COLLECTION_NAME)
    if collection is None:
        collection = bpy.data.collections.new(CONTROL_COLLECTION_NAME)
        bpy.context.scene.collection.children.link(collection)
    controls = {}
    for bone_name in RIGHT_FINGER_BONES:
        control_name = FINGER_CONTROL_NAMES[bone_name]
        control = bpy.data.objects.get(control_name)
        if control is None:
            control = bpy.data.objects.new(control_name, None)
            collection.objects.link(control)
            control.empty_display_type = "ARROWS"
            control.empty_display_size = 0.018
            control.show_in_front = True
        control.parent = armature
        control.matrix_parent_inverse = Matrix.Identity(4)
        control.location = armature.matrix_world.inverted() @ _pose_head_world(armature, bone_name)
        control.rotation_mode = "QUATERNION"
        control.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        controls[bone_name] = control
    if "POC_finger_influence" not in armature:
        armature["POC_finger_influence"] = 1.0
        armature.id_properties_ui("POC_finger_influence").update(min=0.0, max=1.0)
    for bone_name, spec in FINGER_CONSTRAINT_SPECS.items():
        owner = armature.pose.bones[bone_name]
        constraint_name = FINGER_CONSTRAINT_NAMES[bone_name]
        constraint = owner.constraints.get(constraint_name)
        if constraint is None:
            constraint = owner.constraints.new("COPY_ROTATION")
            constraint.name = constraint_name
            constraint.target = controls[bone_name]
            constraint.owner_space = spec["owner_space"]
            constraint.target_space = spec["target_space"]
            constraint.mix_mode = spec["mix_mode"]
            constraint.use_x = True
            constraint.use_y = True
            constraint.use_z = True
            constraint.influence = 0.0
            _add_influence_driver(constraint, armature, "POC_finger_influence")
        elif constraint.target != controls[bone_name]:
            raise RuntimeError(f"Finger constraint target mismatch: {constraint_name}")
    return controls


def _finger_constraints(armature):
    return {
        bone_name: armature.pose.bones[bone_name].constraints[FINGER_CONSTRAINT_NAMES[bone_name]]
        for bone_name in RIGHT_FINGER_BONES
    }


def _set_finger_identity(controls) -> None:
    for control in controls.values():
        control.rotation_mode = "QUATERNION"
        control.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))


def _validate_finger_baseline(armature, controls) -> None:
    constraints = _finger_constraints(armature)
    previous_enabled = float(armature["POC_enabled"])
    previous_mutes = {name: constraint.mute for name, constraint in constraints.items()}
    _set_finger_identity(controls)
    try:
        armature["POC_enabled"] = 1.0
        for constraint in constraints.values():
            constraint.mute = True
        armature.update_tag()
        _refresh_frame()


        baseline = {name: _world_rotation(armature, name) for name in RIGHT_FINGER_BONES}
        for constraint in constraints.values():
            constraint.mute = False
        armature.update_tag()
        _refresh_frame()
        enabled = {
            name: _rotation_delta_degrees(baseline[name], _world_rotation(armature, name))
            for name in RIGHT_FINGER_BONES
        }
        if any(delta > COMPENSATION_BASELINE_TOLERANCE_DEG for delta in enabled.values()):
            raise RuntimeError(f"Finger identity controls introduce a baseline jump: {enabled}")
        response = {}
        for name in RIGHT_FINGER_BONES:
            controls[name].rotation_quaternion = Quaternion(Vector((1, 0, 0)), math.radians(-1))
            armature.update_tag()
            _refresh_frame()
            response[name] = _rotation_delta_degrees(baseline[name], _world_rotation(armature, name))
            controls[name].rotation_quaternion = Quaternion((1, 0, 0, 0))
            armature.update_tag()
            _refresh_frame()
        if any(not 0.99 <= delta <= 1.01 for delta in response.values()):
            raise RuntimeError(f"Finger controls do not produce local X deltas: {response}")
        for constraint in constraints.values():
            constraint.mute = True
        armature.update_tag()
        _refresh_frame()
        restored = {
            name: _rotation_delta_degrees(baseline[name], _world_rotation(armature, name))
            for name in RIGHT_FINGER_BONES
        }
        if any(delta > COMPENSATION_BASELINE_TOLERANCE_DEG for delta in restored.values()):
            raise RuntimeError(f"Finger constraints do not restore v16 exactly: {restored}")
    finally:
        armature["POC_enabled"] = previous_enabled
        _set_finger_identity(controls)
        for name, constraint in constraints.items():
            constraint.mute = previous_mutes[name]
        armature.update_tag()
        _refresh_frame()


def _ensure_sleeve_corrective_controls(armature):
    collection = bpy.data.collections.get(CONTROL_COLLECTION_NAME)
    if collection is None:
        collection = bpy.data.collections.new(CONTROL_COLLECTION_NAME)
        bpy.context.scene.collection.children.link(collection)
    controls = {}
    for bone_name in SLEEVE_CORRECTIVE_BONES:
        control_name = SLEEVE_CORRECTIVE_CONTROL_NAMES[bone_name]
        control = bpy.data.objects.get(control_name)
        if control is None:
            control = bpy.data.objects.new(control_name, None)
            collection.objects.link(control)
            control.empty_display_type = "ARROWS"
            control.empty_display_size = 0.025
            control.show_in_front = True
        control.parent = armature
        control.matrix_parent_inverse = Matrix.Identity(4)
        control.location = armature.matrix_world.inverted() @ _pose_head_world(
            armature, bone_name
        )
        control.rotation_mode = "QUATERNION"
        control.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        controls[bone_name] = control
    if "POC_sleeve_corrective_influence" not in armature:
        armature["POC_sleeve_corrective_influence"] = 1.0
        armature.id_properties_ui("POC_sleeve_corrective_influence").update(
            min=0.0, max=1.0
        )
    for bone_name, spec in SLEEVE_CORRECTIVE_CONSTRAINT_SPECS.items():
        owner = armature.pose.bones[bone_name]
        constraint_name = SLEEVE_CORRECTIVE_CONSTRAINT_NAMES[bone_name]
        constraint = owner.constraints.get(constraint_name)
        if constraint is None:
            constraint = owner.constraints.new("COPY_ROTATION")
            constraint.name = constraint_name
            constraint.target = controls[bone_name]
            constraint.owner_space = spec["owner_space"]
            constraint.target_space = spec["target_space"]
            constraint.mix_mode = spec["mix_mode"]
            constraint.use_x = True
            constraint.use_y = True
            constraint.use_z = True
            constraint.influence = 0.0
            _add_influence_driver(
                constraint, armature, "POC_sleeve_corrective_influence"
            )
        elif constraint.target != controls[bone_name]:
            raise RuntimeError(
                f"Sleeve corrective constraint target mismatch: {constraint_name}"
            )
    return controls


def _sleeve_corrective_constraints(armature):
    return {
        bone_name: armature.pose.bones[bone_name].constraints[
            SLEEVE_CORRECTIVE_CONSTRAINT_NAMES[bone_name]
        ]
        for bone_name in SLEEVE_CORRECTIVE_BONES
    }


def _set_sleeve_corrective_identity(controls):
    for control in controls.values():
        control.rotation_mode = "QUATERNION"
        control.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))


def _sleeve_rest_local_axes(armature):
    axes = {}
    for bone_name in SLEEVE_CORRECTIVE_BONES:
        rest = armature.data.bones[bone_name]
        rest_rotation = rest.matrix_local.to_3x3().normalized()
        longitudinal_armature = (rest.tail_local - rest.head_local).normalized()
        longitudinal = (rest_rotation.inverted() @ longitudinal_armature).normalized()
        swing_a_armature = rest_rotation @ Vector((1.0, 0.0, 0.0))
        swing_a = rest_rotation.inverted() @ swing_a_armature
        swing_a -= longitudinal * swing_a.dot(longitudinal)
        if swing_a.length_squared <= 1e-12:
            swing_a = Vector((0.0, 0.0, 1.0))
            swing_a -= longitudinal * swing_a.dot(longitudinal)
        swing_a.normalize()
        swing_b = longitudinal.cross(swing_a).normalized()
        axes[bone_name] = {
            "longitudinal": tuple(float(value) for value in longitudinal),
            "swing_a": tuple(float(value) for value in swing_a),
            "swing_b": tuple(float(value) for value in swing_b),
            "derivation": "PMX rest matrix and rest head-tail longitudinal axis",
        }
    return axes


def _validate_sleeve_corrective_baseline(armature, controls, axes):
    constraints = _sleeve_corrective_constraints(armature)
    previous_enabled = float(armature["POC_enabled"])
    previous_mutes = {
        name: constraint.mute for name, constraint in constraints.items()
    }
    _set_sleeve_corrective_identity(controls)
    try:
        armature["POC_enabled"] = 1.0
        for constraint in constraints.values():
            constraint.mute = True
        armature.update_tag()
        _refresh_frame()


        baseline = {
            name: _world_rotation(armature, name)
            for name in SLEEVE_CORRECTIVE_BONES
        }
        for constraint in constraints.values():
            constraint.mute = False
        armature.update_tag()
        _refresh_frame()
        enabled = {
            name: _rotation_delta_degrees(
                baseline[name], _world_rotation(armature, name)
            )
            for name in SLEEVE_CORRECTIVE_BONES
        }
        if any(value > COMPENSATION_BASELINE_TOLERANCE_DEG for value in enabled.values()):
            raise RuntimeError(
                f"Sleeve corrective identity controls introduce a baseline jump: {enabled}"
            )
        response = {}
        for name in SLEEVE_CORRECTIVE_BONES:
            controls[name].rotation_quaternion = Quaternion(
                Vector(axes[name]["swing_a"]), math.radians(1.0)
            )
            armature.update_tag()
            _refresh_frame()
            response[name] = _rotation_delta_degrees(
                baseline[name], _world_rotation(armature, name)
            )
            controls[name].rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        if any(not 0.99 <= value <= 1.01 for value in response.values()):
            raise RuntimeError(
                f"Sleeve corrective controls do not produce calibrated local deltas: {response}"
            )
        for constraint in constraints.values():
            constraint.mute = True
        armature.update_tag()
        _refresh_frame()
        restored = {
            name: _rotation_delta_degrees(
                baseline[name], _world_rotation(armature, name)
            )
            for name in SLEEVE_CORRECTIVE_BONES
        }
        if any(value > COMPENSATION_BASELINE_TOLERANCE_DEG for value in restored.values()):
            raise RuntimeError(
                f"Sleeve corrective constraints do not restore exactly: {restored}"
            )
    finally:
        armature["POC_enabled"] = previous_enabled
        _set_sleeve_corrective_identity(controls)
        for name, constraint in constraints.items():
            constraint.mute = previous_mutes[name]
        armature.update_tag()
        _refresh_frame()


def _apply_sleeve_correction(armature, controls, axes, correction):
    reasons = sleeve_correction_reasons(correction)
    if reasons:
        raise ValueError("Invalid sleeve correction: " + "; ".join(reasons))
    quaternions = {}
    for bone_name, swing in zip(
        SLEEVE_CORRECTIVE_BONES, correction.swings_deg, strict=True
    ):
        quaternion = (
            _axis_angle_quaternion(axes[bone_name]["swing_a"], swing[0])
            @ _axis_angle_quaternion(axes[bone_name]["swing_b"], swing[1])
        ).normalized()
        controls[bone_name].rotation_mode = "QUATERNION"
        controls[bone_name].rotation_quaternion = quaternion
        quaternions[bone_name] = tuple(float(value) for value in quaternion)
    armature.update_tag()
    _refresh_frame()
    return quaternions


def _add_influence_driver(constraint, armature, property_name: str) -> None:
    driver = constraint.driver_add("influence").driver
    driver.type = "SCRIPTED"
    enabled = driver.variables.new()
    enabled.name = "enabled"
    enabled.targets[0].id = armature
    enabled.targets[0].data_path = '["POC_enabled"]'
    weight = driver.variables.new()
    weight.name = "weight"
    weight.targets[0].id = armature
    weight.targets[0].data_path = f'["{property_name}"]'
    driver.expression = "enabled * weight"


def _new_copy_rotation(armature, name: str, target, spec):
    pose_bone = armature.pose.bones[spec["owner_bone"]]
    old = pose_bone.constraints.get(name)
    if old is not None:
        pose_bone.constraints.remove(old)
    constraint = pose_bone.constraints.new(spec.get("constraint_type", "COPY_ROTATION"))
    constraint.name = name
    constraint.target = target
    constraint.subtarget = spec.get("target_bone", "")
    constraint.owner_space = spec["owner_space"]
    constraint.target_space = spec["target_space"]
    constraint.mix_mode = spec["mix_mode"]
    axes = spec.get("rotation_axes", "XYZ")
    constraint.use_x = "X" in axes
    constraint.use_y = "Y" in axes
    constraint.use_z = "Z" in axes
    constraint.influence = 0.0
    return constraint


def _new_child_of_rotation(armature, name: str, spec):
    pose_bone = armature.pose.bones[spec["owner_bone"]]
    old = pose_bone.constraints.get(name)
    if old is not None:
        pose_bone.constraints.remove(old)
    constraint = pose_bone.constraints.new(spec["constraint_type"])
    constraint.name = name
    constraint.target = armature
    constraint.subtarget = spec["target_bone"]
    constraint.use_location_x = False
    constraint.use_location_y = False
    constraint.use_location_z = False
    constraint.use_scale_x = False
    constraint.use_scale_y = False
    constraint.use_scale_z = False
    axes = spec["rotation_axes"]
    constraint.use_rotation_x = "X" in axes
    constraint.use_rotation_y = "Y" in axes
    constraint.use_rotation_z = "Z" in axes

    constraint.influence = 1.0
    _select_armature(armature)
    bpy.ops.object.mode_set(mode="POSE")
    armature.data.bones.active = armature.data.bones[spec["owner_bone"]]
    bpy.context.view_layer.update()
    result = bpy.ops.constraint.childof_set_inverse(constraint=name, owner="BONE")
    if "FINISHED" not in result:
        raise RuntimeError(f"Failed to calibrate inverse matrix for {name}: {sorted(result)}")
    constraint.influence = 0.0
    return constraint


def _proxy_elbow_pole_side(armature, pole_control) -> float:
    root = _pose_head_world(armature, PROXY_BONE_NAMES[0])
    elbow = _pose_head_world(armature, PROXY_BONE_NAMES[1])
    end = _pose_head_world(armature, PROXY_BONE_NAMES[2])
    axis = end - root
    if axis.length_squared <= 1e-12:
        raise RuntimeError("Proxy chain has a zero-length shoulder-to-wrist axis")
    elbow_offset = elbow - root - axis * ((elbow - root).dot(axis) / axis.length_squared)
    pole_offset = pole_control.location - root - axis * (
        (pole_control.location - root).dot(axis) / axis.length_squared
    )
    return elbow_offset.dot(pole_offset)


def _create_constraints(armature, controls) -> None:
    proxy_forearm = armature.pose.bones[PROXY_BONE_NAMES[1]]
    old_ik = proxy_forearm.constraints.get(CONSTRAINT_NAMES["ik"])
    if old_ik is not None:
        proxy_forearm.constraints.remove(old_ik)
    ik = proxy_forearm.constraints.new("IK")
    ik.name = CONSTRAINT_NAMES["ik"]
    ik.target = controls["hand"]
    ik.pole_target = controls["pole"]
    ik.chain_count = 2
    ik.use_tail = True
    ik.use_stretch = False
    proxy_forearm.lock_ik_x = ELBOW_IK_LOCKS["X"]
    proxy_forearm.lock_ik_y = ELBOW_IK_LOCKS["Y"]
    proxy_forearm.lock_ik_z = ELBOW_IK_LOCKS["Z"]
    proxy_forearm.use_ik_limit_x = False
    proxy_forearm.use_ik_limit_y = False
    proxy_forearm.use_ik_limit_z = True
    proxy_forearm.ik_min_z = math.radians(ELBOW_IK_MIN_DEG)
    proxy_forearm.ik_max_z = math.radians(ELBOW_IK_MAX_DEG)
    bpy.context.scene.frame_set(VALIDATION_FRAME - 1)
    bpy.context.scene.frame_set(VALIDATION_FRAME)
    bpy.context.view_layer.update()
    if _proxy_elbow_pole_side(armature, controls["pole"]) <= 0.0:
        ik.pole_angle = math.pi
        bpy.context.scene.frame_set(VALIDATION_FRAME - 1)
        bpy.context.scene.frame_set(VALIDATION_FRAME)
        bpy.context.view_layer.update()
    if _proxy_elbow_pole_side(armature, controls["pole"]) <= 0.0:
        raise RuntimeError("Unable to align the proxy IK elbow with its pole target")

    palm_proxy = _new_copy_rotation(
        armature,
        CONSTRAINT_NAMES["palm_proxy"],
        controls["palm"],
        CONSTRAINT_SPECS["palm_proxy"],
    )
    palm_proxy.influence = 1.0

    properties = {
        "POC_enabled": 0.0,
        "POC_upper_arm_influence": 1.0,
        "POC_elbow_influence": 1.0,
        "POC_upper_twist_influence": 0.25,
        "POC_hand_twist_influence": 0.50,
        "POC_wrist_influence": 0.25,
    }
    for name, value in properties.items():
        armature[name] = value
        armature.id_properties_ui(name).update(min=0.0, max=1.0)

    driven = (
        (
            _new_child_of_rotation(
                armature,
                CONSTRAINT_NAMES["upper"],
                CONSTRAINT_SPECS["upper"],
            ),
            "POC_upper_arm_influence",
        ),
        (
            _new_child_of_rotation(
                armature,
                CONSTRAINT_NAMES["elbow"],
                CONSTRAINT_SPECS["elbow"],
            ),
            "POC_elbow_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                CONSTRAINT_NAMES["upper_twist"],
                armature,
                CONSTRAINT_SPECS["upper_twist"],
            ),
            "POC_upper_twist_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                CONSTRAINT_NAMES["hand_twist"],
                armature,
                CONSTRAINT_SPECS["hand_twist"],
            ),
            "POC_hand_twist_influence",
        ),
        (
            _new_copy_rotation(
                armature,
                CONSTRAINT_NAMES["wrist"],
                armature,
                CONSTRAINT_SPECS["wrist"],
            ),
            "POC_wrist_influence",
        ),
    )
    for constraint, property_name in driven:
        _add_influence_driver(constraint, armature, property_name)
    bpy.ops.object.mode_set(mode="OBJECT")


def _finite_matrix(matrix) -> bool:
    return all(math.isfinite(value) for row in matrix for value in row)


def _world_rotation(armature, bone_name: str):
    return (armature.matrix_world @ armature.pose.bones[bone_name].matrix).to_quaternion()


def _rotation_delta_degrees(before, after) -> float:
    degrees = math.degrees(before.rotation_difference(after).angle)
    return min(degrees, abs(360.0 - degrees))


def _evaluated_local_rotation(armature, bone_name: str):
    pose_bone = armature.pose.bones[bone_name]
    parent = pose_bone.parent
    if parent is None:
        return (pose_bone.bone.matrix_local.inverted() @ pose_bone.matrix).to_quaternion()
    current_relative = parent.matrix.inverted() @ pose_bone.matrix
    rest_relative = parent.bone.matrix_local.inverted() @ pose_bone.bone.matrix_local
    return (rest_relative.inverted() @ current_relative).to_quaternion()


def _signed_proxy_elbow_flex(armature) -> tuple[float, float]:
    euler = _evaluated_local_rotation(armature, PROXY_BONE_NAMES[1]).to_euler("XYZ")
    flex_degrees = math.degrees(euler.z)
    off_axis_degrees = math.degrees(math.hypot(euler.x, euler.y))
    return flex_degrees, off_axis_degrees


def _local_y_twist_response(before, after) -> tuple[float, float, float]:
    delta = (before.inverted() @ after).normalized()
    twist = Quaternion((delta.w, 0.0, delta.y, 0.0))
    if twist.magnitude <= 1e-12:
        twist = Quaternion((1.0, 0.0, 0.0, 0.0))
    else:
        twist.normalize()
    swing = (delta @ twist.inverted()).normalized()
    twist_degrees = math.degrees(2.0 * math.atan2(twist.y, twist.w))
    return twist_degrees, math.degrees(swing.angle), math.degrees(delta.angle)


def _set_poc_enabled(armature, scene, enabled: bool) -> None:
    armature["POC_enabled"] = 1.0 if enabled else 0.0
    armature.update_tag()
    scene.frame_set(VALIDATION_FRAME - 1)
    scene.frame_set(VALIDATION_FRAME)
    bpy.context.view_layer.update()


def _run_behavior_diagnostics(armature, controls) -> None:
    scene = bpy.context.scene
    diagnostic_bones = ("右腕", "右ひじ", "右腕捩", "右手捩", "右手首")
    baseline_rotations = {name: _world_rotation(armature, name) for name in diagnostic_bones}
    hand_location = controls["hand"].location.copy()
    palm_basis = controls["palm"].matrix_basis.copy()
    failures: list[str] = []

    try:
        _set_poc_enabled(armature, scene, True)
        enabled_rotations = {name: _world_rotation(armature, name) for name in diagnostic_bones}
        enabled_deltas = {
            name: _rotation_delta_degrees(baseline_rotations[name], enabled_rotations[name])
            for name in ("右腕", "右ひじ", "右手首")
        }
        print("POC_ENABLED_DELTAS_DEG", enabled_deltas)
        for name, delta in enabled_deltas.items():
            if delta >= ENABLED_DELTA_LIMIT_DEG:
                failures.append(f"{name} baseline enable delta is {delta:.6f} degrees")

        controls["hand"].location += armature.matrix_world.to_3x3() @ Vector(
            HAND_TARGET_DIAGNOSTIC_OFFSET
        )
        armature.update_tag()
        scene.frame_set(VALIDATION_FRAME - 1)
        scene.frame_set(VALIDATION_FRAME)
        bpy.context.view_layer.update()
        translated_rotations = {
            name: _world_rotation(armature, name) for name in ("右腕", "右ひじ", "右手首")
        }
        hand_response = {
            name: _rotation_delta_degrees(enabled_rotations[name], translated_rotations[name])
            for name in translated_rotations
        }
        print("POC_HAND_TARGET_RESPONSE_DEG", hand_response)
        for name in ("右腕", "右ひじ"):
            response = hand_response[name]
            if not HAND_RESPONSE_MIN_DEG <= response <= HAND_RESPONSE_MAX_DEG:
                failures.append(f"{name} hand-target response is {response:.6f} degrees")

        controls["hand"].location = hand_location
        armature.update_tag()
        scene.frame_set(VALIDATION_FRAME - 1)
        scene.frame_set(VALIDATION_FRAME)
        bpy.context.view_layer.update()
        hand_restore = {
            name: _rotation_delta_degrees(enabled_rotations[name], _world_rotation(armature, name))
            for name in diagnostic_bones
        }
        if any(delta > BASELINE_RESTORE_TOLERANCE_DEG for delta in hand_restore.values()):
            failures.append(f"hand target did not restore enabled baseline: {hand_restore}")

        palm_bones = {
            "右腕捩": "POC_upper_twist_influence",
            "右手捩": "POC_hand_twist_influence",
            "右手首": "POC_wrist_influence",
        }
        palm_before = {name: _evaluated_local_rotation(armature, name) for name in palm_bones}
        controls["palm"].rotation_mode = "XYZ"
        controls["palm"].rotation_euler.y = math.radians(PALM_AXIAL_DIAGNOSTIC_DEG)
        armature.update_tag()
        scene.frame_set(VALIDATION_FRAME - 1)
        scene.frame_set(VALIDATION_FRAME)
        bpy.context.view_layer.update()
        palm_response = {}
        for name, property_name in palm_bones.items():
            twist, off_axis, total = _local_y_twist_response(
                palm_before[name],
                _evaluated_local_rotation(armature, name),
            )
            expected = PALM_AXIAL_DIAGNOSTIC_DEG * float(armature[property_name])
            palm_response[name] = {
                "twist_y": twist,
                "off_axis": off_axis,
                "total": total,
                "expected": expected,
            }
            if abs(abs(twist) - expected) > PALM_RESPONSE_TOLERANCE_DEG:
                failures.append(
                    f"{name} palm twist response {twist:.6f} differs from expected {expected:.6f}"
                )
            if off_axis > PALM_OFF_AXIS_MAX_DEG:
                failures.append(f"{name} palm off-axis response is {off_axis:.6f} degrees")
        print("POC_PALM_AXIAL_RESPONSE_DEG", palm_response)
    finally:
        controls["hand"].location = hand_location
        controls["palm"].matrix_basis = palm_basis
        _set_poc_enabled(armature, scene, False)

    restored_rotations = {name: _world_rotation(armature, name) for name in diagnostic_bones}
    restore_deltas = {
        name: _rotation_delta_degrees(baseline_rotations[name], restored_rotations[name])
        for name in diagnostic_bones
    }
    print("POC_RESTORE_DELTAS_DEG", restore_deltas)
    if any(delta > BASELINE_RESTORE_TOLERANCE_DEG for delta in restore_deltas.values()):
        failures.append(f"disabled POC chain did not restore v16 baseline: {restore_deltas}")
    if failures:
        raise RuntimeError("POC behavior diagnostics failed: " + "; ".join(failures))


def _validate_setup(armature, action, controls) -> None:
    scene = bpy.context.scene
    scene.frame_set(VALIDATION_FRAME)
    bpy.context.view_layer.update()

    if tuple(float(value) for value in action.frame_range) != EXPECTED_ACTION_RANGE:
        raise RuntimeError("Reference action range changed after rig construction")
    if float(armature["POC_enabled"]) != 0.0:
        raise RuntimeError("POC deform-chain influence must remain disabled in the baseline setup")

    for name in PROXY_BONE_NAMES:
        bone = armature.data.bones.get(name)
        if bone is None or bone.use_deform:
            raise RuntimeError(f"Invalid non-deforming proxy bone: {name}")

    proxy_forearm = armature.pose.bones[PROXY_BONE_NAMES[1]]
    actual_locks = {
        "X": proxy_forearm.lock_ik_x,
        "Y": proxy_forearm.lock_ik_y,
        "Z": proxy_forearm.lock_ik_z,
    }
    if actual_locks != ELBOW_IK_LOCKS:
        raise RuntimeError(f"Proxy elbow IK locks are invalid: {actual_locks}")
    if (
        not proxy_forearm.use_ik_limit_z
        or abs(math.degrees(proxy_forearm.ik_min_z) - ELBOW_IK_MIN_DEG) > 1e-4
        or abs(math.degrees(proxy_forearm.ik_max_z) - ELBOW_IK_MAX_DEG) > 1e-4
    ):
        raise RuntimeError("Proxy elbow local-Z hinge limits are invalid")

    expected_lengths = (
        (armature.data.bones["右ひじ"].head_local - armature.data.bones["右腕"].head_local).length,
        (armature.data.bones["右手首"].head_local - armature.data.bones["右ひじ"].head_local).length,
    )
    for name, expected in zip(PROXY_BONE_NAMES[:2], expected_lengths, strict=True):
        pose_bone = armature.pose.bones[name]
        evaluated = (pose_bone.tail - pose_bone.head).length
        if expected <= 0.0 or evaluated <= 0.0 or abs(evaluated - expected) > LENGTH_TOLERANCE:
            raise RuntimeError(f"Proxy segment length is invalid for {name}: expected {expected}, got {evaluated}")
        if not _finite_matrix(pose_bone.matrix):
            raise RuntimeError(f"Proxy pose matrix is not finite: {name}")

    root = _pose_head_world(armature, PROXY_BONE_NAMES[0])
    elbow = _pose_head_world(armature, PROXY_BONE_NAMES[1])
    end = _pose_head_world(armature, PROXY_BONE_NAMES[2])
    if _proxy_elbow_pole_side(armature, controls["pole"]) <= 0.0:
        raise RuntimeError("Proxy elbow is not on the pole-facing side")
    bend = math.degrees((root - elbow).angle(end - elbow))
    if not math.isfinite(bend) or not ELBOW_ANGLE_MIN_DEG <= bend <= ELBOW_ANGLE_MAX_DEG:
        raise RuntimeError(f"Proxy elbow bend is invalid: {bend}")
    signed_flex, off_axis_flex = _signed_proxy_elbow_flex(armature)
    if not signed_elbow_flex_is_valid(signed_flex):
        raise RuntimeError(f"Proxy elbow signed flex is reversed or hyperextended: {signed_flex}")
    if off_axis_flex > ELBOW_OFF_AXIS_MAX_DEG:
        raise RuntimeError(
            f"Proxy elbow flex left the local-{ELBOW_HINGE_AXIS} hinge: {off_axis_flex} degrees"
        )
    print(
        "POC_ELBOW_HINGE",
        {
            "axis": ELBOW_HINGE_AXIS,
            "signed_flex_deg": signed_flex,
            "off_axis_deg": off_axis_flex,
            "anatomical_angle_deg": bend,
        },
    )

    expected_targets = {
        CONSTRAINT_NAMES["ik"]: (PROXY_BONE_NAMES[1], controls["hand"], "", controls["pole"]),
        CONSTRAINT_NAMES["palm_proxy"]: (
            PROXY_BONE_NAMES[2],
            controls["palm"],
            "",
            None,
        ),
        CONSTRAINT_NAMES["upper"]: (
            CONSTRAINT_SPECS["upper"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["upper"]["target_bone"],
            None,
        ),
        CONSTRAINT_NAMES["elbow"]: (
            CONSTRAINT_SPECS["elbow"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["elbow"]["target_bone"],
            None,
        ),
        CONSTRAINT_NAMES["upper_twist"]: (
            CONSTRAINT_SPECS["upper_twist"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["upper_twist"]["target_bone"],
            None,
        ),
        CONSTRAINT_NAMES["hand_twist"]: (
            CONSTRAINT_SPECS["hand_twist"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["hand_twist"]["target_bone"],
            None,
        ),
        CONSTRAINT_NAMES["wrist"]: (
            CONSTRAINT_SPECS["wrist"]["owner_bone"],
            armature,
            CONSTRAINT_SPECS["wrist"]["target_bone"],
            None,
        ),
    }
    for constraint_name, (bone_name, target, subtarget, pole_target) in expected_targets.items():
        constraint = armature.pose.bones[bone_name].constraints.get(constraint_name)
        if constraint is None or constraint.target != target:
            raise RuntimeError(f"Missing or mistargeted constraint: {constraint_name}")
        if constraint.subtarget != subtarget:
            raise RuntimeError(
                f"Constraint {constraint_name} must target subtarget {subtarget!r}, "
                f"got {constraint.subtarget!r}"
            )
        if pole_target is not None and constraint.pole_target != pole_target:
            raise RuntimeError(f"Missing or mistargeted pole target: {constraint_name}")
        spec_key = next(
            key for key, configured_name in CONSTRAINT_NAMES.items() if configured_name == constraint_name
        )
        expected_type = (
            "IK"
            if spec_key == "ik"
            else CONSTRAINT_SPECS[spec_key].get("constraint_type", "COPY_ROTATION")
        )
        if constraint.type != expected_type:
            raise RuntimeError(
                f"Constraint {constraint_name} must use {expected_type}, got {constraint.type}"
            )
        if constraint.type == "CHILD_OF" and not _finite_matrix(constraint.inverse_matrix):
            raise RuntimeError(f"Constraint inverse matrix is not finite: {constraint_name}")
        if "rotation_axes" in CONSTRAINT_SPECS.get(spec_key, {}):
            expected_axes = CONSTRAINT_SPECS[spec_key]["rotation_axes"]
            if constraint.type == "CHILD_OF":
                axis_flags = (
                    ("X", constraint.use_rotation_x),
                    ("Y", constraint.use_rotation_y),
                    ("Z", constraint.use_rotation_z),
                )
            else:
                axis_flags = (
                    ("X", constraint.use_x),
                    ("Y", constraint.use_y),
                    ("Z", constraint.use_z),
                )
            actual_axes = "".join(axis for axis, enabled in axis_flags if enabled)
            if actual_axes != expected_axes:
                raise RuntimeError(
                    f"Constraint {constraint_name} rotation axes must be {expected_axes}, "
                    f"got {actual_axes}"
                )
        if constraint_name not in (CONSTRAINT_NAMES["ik"], CONSTRAINT_NAMES["palm_proxy"]) and constraint.influence != 0.0:
            raise RuntimeError(f"Baseline POC constraint must be disabled: {constraint_name}")

    for name, control in controls.items():
        if control.name != CONTROL_NAMES[name] or not _finite_matrix(control.matrix_world):
            raise RuntimeError(f"Invalid control object: {CONTROL_NAMES[name]}")
        if any(value <= 0.0 or not math.isfinite(value) for value in control.scale):
            raise RuntimeError(f"Invalid control scale: {control.name}")

    palm_control = controls["palm"]
    if palm_control.parent is None or palm_control.parent.name != PALM_SPACE_NAME:
        raise RuntimeError(f"Palm control must be parented to {PALM_SPACE_NAME}")
    if any(abs(value) > 1e-8 for value in palm_control.rotation_euler):
        raise RuntimeError("Palm control must have zero local rotation in the baseline setup")
    palm_constraint = armature.pose.bones[PROXY_BONE_NAMES[2]].constraints[
        CONSTRAINT_NAMES["palm_proxy"]
    ]
    palm_spec = CONSTRAINT_SPECS["palm_proxy"]
    if (
        palm_constraint.owner_space != palm_spec["owner_space"]
        or palm_constraint.target_space != palm_spec["target_space"]
        or palm_constraint.mix_mode != palm_spec["mix_mode"]
    ):
        raise RuntimeError("Palm delta constraint uses incompatible rotation spaces")

    _run_behavior_diagnostics(armature, controls)


def _save_setup_blend(output_blend: Path) -> None:
    backup_path = blender_backup_path(output_blend)
    if backup_path.exists():
        backup_path.unlink()

    file_preferences = bpy.context.preferences.filepaths
    original_save_version = int(file_preferences.save_version)
    try:
        file_preferences.save_version = SAVE_VERSION_OVERRIDE
        result = bpy.ops.wm.save_as_mainfile(filepath=str(output_blend), check_existing=False)
        if "FINISHED" not in result:
            raise RuntimeError(f"Failed to save POC blend: {sorted(result)}")
    finally:
        file_preferences.save_version = original_save_version

    if backup_path.exists():
        backup_path.unlink()
        raise RuntimeError(f"Blender created an unexpected backup artifact: {backup_path}")


def _load_motion_math():
    module_name = "blender_first_motion_math"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    tool_path = Path(__file__).with_name(f"{module_name}.py")
    spec = importlib.util.spec_from_file_location(module_name, tool_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load motion math module: {tool_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _existing_controls():
    controls = {key: bpy.data.objects.get(name) for key, name in CONTROL_NAMES.items()}
    missing = [CONTROL_NAMES[key] for key, control in controls.items() if control is None]
    if missing:
        raise RuntimeError(f"Existing POC blend is missing controls: {', '.join(missing)}")
    return controls


def _validate_existing_poc(armature, controls) -> None:
    action = armature.animation_data.action if armature.animation_data else None
    if action is None or action.name != REFERENCE_ACTION_NAME:
        raise RuntimeError(f"Existing POC blend must use action {REFERENCE_ACTION_NAME}")
    if tuple(float(value) for value in action.frame_range) != EXPECTED_ACTION_RANGE:
        raise RuntimeError("Existing POC reference action range must remain 0-240")
    for name in PROXY_BONE_NAMES:
        bone = armature.data.bones.get(name)
        if bone is None or bone.use_deform:
            raise RuntimeError(f"Existing POC blend has an invalid proxy bone: {name}")
    expected = (
        (PROXY_BONE_NAMES[1], CONSTRAINT_NAMES["ik"]),
        (PROXY_BONE_NAMES[2], CONSTRAINT_NAMES["palm_proxy"]),
        ("右腕", CONSTRAINT_NAMES["upper"]),
        ("右ひじ", CONSTRAINT_NAMES["elbow"]),
        ("右腕捩", CONSTRAINT_NAMES["upper_twist"]),
        ("右手捩", CONSTRAINT_NAMES["hand_twist"]),
        ("右手首", CONSTRAINT_NAMES["wrist"]),
    )
    missing_constraints = [
        constraint_name
        for bone_name, constraint_name in expected
        if armature.pose.bones[bone_name].constraints.get(constraint_name) is None
    ]
    if missing_constraints:
        raise RuntimeError(
            f"Existing POC blend is missing constraints: {', '.join(missing_constraints)}"
        )
    if controls["palm"].parent is None or controls["palm"].parent.name != PALM_SPACE_NAME:
        raise RuntimeError("Existing POC palm control is not in its calibrated local space")


def _group_indices(mesh, names: Sequence[str]) -> set[int]:
    missing = [name for name in names if mesh.vertex_groups.get(name) is None]
    if missing:
        raise RuntimeError(f"Mesh is missing required vertex groups: {', '.join(missing)}")
    return {mesh.vertex_groups[name].index for name in names}


def _vertices_for_groups(mesh, group_indices: set[int]) -> set[int]:
    return {
        vertex.index
        for vertex in mesh.data.vertices
        if any(
            membership.group in group_indices and membership.weight > MIN_GROUP_WEIGHT
            for membership in vertex.groups
        )
    }


def polygon_belongs_to_region(
    polygon_vertices: Sequence[int],
    included: set[int],
    excluded: set[int],
) -> bool:
    vertices = tuple(int(vertex) for vertex in polygon_vertices)
    return bool(vertices) and all(vertex in included for vertex in vertices) and not any(
        vertex in excluded for vertex in vertices
    )


def _polygons_touching(mesh, included: set[int], excluded: set[int] | None = None):
    excluded = excluded or set()
    return tuple(
        tuple(polygon.vertices)
        for polygon in mesh.data.polygons
        if polygon_belongs_to_region(polygon.vertices, included, excluded)
    )


def _polygon_records(
    mesh,
    included: set[int],
    excluded: set[int],
    *,
    region_resolver,
    group_names: Sequence[str],
):
    group_indices = {mesh.vertex_groups[name].index: name for name in group_names}
    records = []
    for polygon in mesh.data.polygons:
        vertices = tuple(int(index) for index in polygon.vertices)
        if not polygon_belongs_to_region(vertices, included, excluded):
            continue
        totals = {name: 0.0 for name in group_names}
        for vertex_index in vertices:
            for membership in mesh.data.vertices[vertex_index].groups:
                name = group_indices.get(membership.group)
                if name is not None:
                    totals[name] += float(membership.weight)
        dominant = max(totals, key=lambda name: (totals[name], name))
        records.append({
            "polygon_index": int(polygon.index),
            "vertices": vertices,
            "region": region_resolver(vertices),
            "group": dominant,
        })
    return tuple(records)


def _mesh_geometry_sets(mesh):
    contact = _vertices_for_groups(mesh, _group_indices(mesh, CONTACT_VERTEX_GROUPS))
    thumb0 = _vertices_for_groups(mesh, _group_indices(mesh, ("右親指０",)))
    thumb1 = _vertices_for_groups(mesh, _group_indices(mesh, ("右親指１",)))
    thumb2 = _vertices_for_groups(mesh, _group_indices(mesh, ("右親指２",)))
    index1 = _vertices_for_groups(mesh, _group_indices(mesh, ("右人指１",)))
    index2 = _vertices_for_groups(mesh, _group_indices(mesh, ("右人指２",)))
    index3 = _vertices_for_groups(mesh, _group_indices(mesh, ("右人指３",)))
    thumb = _vertices_for_groups(mesh, _group_indices(mesh, ("右親指０", "右親指１", "右親指２")))
    index = _vertices_for_groups(mesh, _group_indices(mesh, ("右人指１", "右人指２", "右人指３")))
    hand = _vertices_for_groups(mesh, _group_indices(mesh, RIGHT_HAND_VERTEX_GROUPS))
    palm = _vertices_for_groups(mesh, _group_indices(mesh, PALM_VERTEX_GROUPS))
    forearm = _vertices_for_groups(mesh, _group_indices(mesh, RIGHT_FOREARM_VERTEX_GROUPS))
    sleeve_corrective = _vertices_for_groups(
        mesh, _group_indices(mesh, SLEEVE_CORRECTIVE_BONES)
    )
    head = _vertices_for_groups(mesh, _group_indices(mesh, HEAD_VERTEX_GROUPS))
    torso = _vertices_for_groups(mesh, _group_indices(mesh, TORSO_VERTEX_GROUPS))
    adjacent = _vertices_for_groups(
        mesh,
        _group_indices(mesh, ADJACENT_RIGHT_ARM_VERTEX_GROUPS),
    )
    moving = hand | forearm
    contact_surface = thumb | index | palm
    index_knuckle_region = index_knuckle_region_indices(
        index1_indices=index1,
        index2_indices=index2,
        index3_indices=index3,
        faces=tuple(tuple(int(index) for index in polygon.vertices) for polygon in mesh.data.polygons),
    )
    moving_records = _polygon_records(
        mesh,
        moving,
        set(),
        region_resolver=lambda vertices: (
            "hand" if all(index in hand for index in vertices)
            else "forearm" if all(index in forearm for index in vertices)
            else "mixed_hand_forearm"
        ),
        group_names=(*RIGHT_HAND_VERTEX_GROUPS, *RIGHT_FOREARM_VERTEX_GROUPS),
    )
    torso_records = _polygon_records(
        mesh,
        torso,
        adjacent,
        region_resolver=lambda _vertices: "torso",
        group_names=TORSO_VERTEX_GROUPS,
    )
    return {
        "contact_vertices": contact,
        "thumb_vertices": thumb,
        "thumb0_vertices": thumb0,
        "thumb1_vertices": thumb1,
        "thumb2_vertices": thumb2,
        "index_vertices": index,
        "index1_vertices": index1,
        "index2_vertices": index2,
        "index3_vertices": index3,
        "index_knuckle_region": index_knuckle_region,
        "side_palm_vertices": palm,
        "hand_vertices": hand,
        "moving_vertices": moving,
        "sleeve_corrective_vertices": sleeve_corrective,
        "sleeve_corrective_faces": _polygons_touching(mesh, sleeve_corrective),
        "palm_faces": _polygons_touching(mesh, palm),
        "contact_faces": _polygons_touching(mesh, contact),
        "contact_surface_faces": _polygons_touching(mesh, contact_surface),
        "hand_faces": _polygons_touching(mesh, hand),
        "moving_faces": tuple(record["vertices"] for record in moving_records),
        "moving_face_records": moving_records,
        "head_faces": _polygons_touching(mesh, head),
        "head_vertices": head,
        "torso_faces": tuple(record["vertices"] for record in torso_records),
        "torso_face_records": torso_records,
        "group_counts": {
            name: len(
                _vertices_for_groups(mesh, _group_indices(mesh, (name,)))
            )
            for name in EVIDENCE_VERTEX_GROUPS
        },
    }


def _evaluated_world_vertex_subset(mesh, indices: Sequence[int]):
    requested = tuple(sorted(set(int(index) for index in indices)))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    try:
        if len(evaluated_mesh.vertices) != len(mesh.data.vertices):
            raise RuntimeError("Evaluated mesh topology changed; vertex-group evidence is invalid")
        return {
            index: evaluated.matrix_world @ evaluated_mesh.vertices[index].co
            for index in requested
        }
    finally:
        evaluated.to_mesh_clear()


def _evaluated_world_vertices(mesh):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = mesh.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    try:
        if len(evaluated_mesh.vertices) != len(mesh.data.vertices):
            raise RuntimeError("Evaluated mesh topology changed; vertex-group evidence is invalid")
        return tuple(evaluated.matrix_world @ vertex.co for vertex in evaluated_mesh.vertices)
    finally:
        evaluated.to_mesh_clear()


def _bvh(vertices, polygons):
    if not polygons:
        raise RuntimeError("Cannot build collision evidence from an empty polygon set")
    return BVHTree.FromPolygons(vertices, polygons, all_triangles=False)


def _local_bvh(vertex_map, polygons):
    indices = tuple(sorted({index for polygon in polygons for index in polygon}))
    local_index = {source: target for target, source in enumerate(indices)}
    local_vertices = tuple(vertex_map[index] for index in indices)
    local_polygons = tuple(
        tuple(local_index[index] for index in polygon) for polygon in polygons
    )
    return _bvh(local_vertices, local_polygons)


def _nearest_surface_evidence(points, tree):
    minimum_distance = math.inf
    maximum_penetration = 0.0
    for point in points:
        nearest = tree.find_nearest(point)
        if nearest is None:
            continue
        location, normal, _index, distance = nearest
        minimum_distance = min(minimum_distance, float(distance))
        signed_distance = (point - location).dot(normal)
        if signed_distance < -MESH_PENETRATION_TOLERANCE:
            maximum_penetration = max(maximum_penetration, -float(signed_distance))
    return minimum_distance, maximum_penetration


def _mesh_evidence(mesh, geometry, chin_world):
    vertices = _evaluated_world_vertices(mesh)
    contact_error = min((vertices[index] - chin_world).length for index in geometry["contact_vertices"])
    head_tree = _bvh(vertices, geometry["head_faces"])
    torso_tree = _bvh(vertices, geometry["torso_faces"])
    palm_tree = _bvh(vertices, geometry["palm_faces"])
    contact_tree = _bvh(vertices, geometry["contact_faces"])
    hand_tree = _bvh(vertices, geometry["hand_faces"])
    moving_tree = _bvh(vertices, geometry["moving_faces"])
    _head_clearance, head_penetration = _nearest_surface_evidence(
        (vertices[index] for index in geometry["hand_vertices"]),
        head_tree,
    )
    palm_intersections = len(palm_tree.overlap(head_tree))
    finger_intersections = len(contact_tree.overlap(head_tree))
    full_hand_intersections = len(hand_tree.overlap(head_tree))
    head_evidence = combine_head_collision_evidence(
        palm_intersections=palm_intersections,
        finger_intersections=finger_intersections,
        full_hand_intersections=full_hand_intersections,
        signed_penetration_depth=head_penetration,
    )
    minimum_clearance, _torso_signed_penetration = _nearest_surface_evidence(
        (vertices[index] for index in geometry["moving_vertices"]),
        torso_tree,
    )
    torso_intersections = len(moving_tree.overlap(torso_tree))
    return {
        "contact_error": float(contact_error),
        "head_penetration_depth": float(head_evidence["penetration_depth"]),
        "head_collision_count": int(head_evidence["collision_count"]),
        "head_intersection_count": int(head_evidence["collision_count"]),
        "palm_head_intersection_count": palm_intersections,
        "finger_head_intersection_count": finger_intersections,
        "full_hand_head_intersection_count": full_hand_intersections,
        "head_collision_sources": head_evidence["sources"],
        "torso_penetration_count": int(torso_intersections),
        "minimum_clearance": float(minimum_clearance),
    }, vertices


def _invariant_collision_context(vertices, geometry):
    return {
        "head_tree": _bvh(vertices, geometry["head_faces"]),
        "torso_tree": _bvh(vertices, geometry["torso_faces"]),
        "torso_face_records": geometry["torso_face_records"],
    }


def _full_collision_evidence(mesh, geometry, invariant):
    vertices = _evaluated_world_vertices(mesh)
    head_tree = _bvh(vertices, geometry["head_faces"])
    torso_tree = _bvh(vertices, geometry["torso_faces"])
    palm_tree = _bvh(vertices, geometry["palm_faces"])
    contact_tree = _bvh(vertices, geometry["contact_faces"])
    hand_tree = _bvh(vertices, geometry["hand_faces"])
    moving_tree = _bvh(vertices, geometry["moving_faces"])
    _head_clearance, head_penetration = _nearest_surface_evidence(
        (vertices[index] for index in geometry["hand_vertices"]), head_tree
    )
    palm_intersections = len(palm_tree.overlap(head_tree))
    finger_intersections = len(contact_tree.overlap(head_tree))
    full_hand_intersections = len(hand_tree.overlap(head_tree))
    head_evidence = combine_head_collision_evidence(
        palm_intersections=palm_intersections,
        finger_intersections=finger_intersections,
        full_hand_intersections=full_hand_intersections,
        signed_penetration_depth=head_penetration,
    )
    minimum_clearance, _torso_signed_penetration = _nearest_surface_evidence(
        (vertices[index] for index in geometry["moving_vertices"]), torso_tree
    )
    torso_overlap_pairs = tuple(moving_tree.overlap(torso_tree))
    torso_attribution = attribute_collision_pairs(
        torso_overlap_pairs,
        geometry["moving_face_records"],
        invariant["torso_face_records"],
        vertices,
    )
    torso_intersections = len(torso_overlap_pairs)
    return {
        "head_penetration_depth": float(head_evidence["penetration_depth"]),
        "head_collision_count": int(head_evidence["collision_count"]),
        "head_intersection_count": int(head_evidence["collision_count"]),
        "palm_head_intersection_count": palm_intersections,
        "finger_head_intersection_count": finger_intersections,
        "full_hand_head_intersection_count": full_hand_intersections,
        "head_collision_sources": head_evidence["sources"],
        "torso_penetration_count": int(torso_intersections),
        "torso_collision_attribution": torso_attribution,
        "minimum_clearance": float(minimum_clearance),
    }, vertices


def _face_center_normal(record, vertices):
    polygon = [Vector(vertices[index]) for index in record["vertices"]]
    center = sum(polygon, Vector((0.0, 0.0, 0.0))) / len(polygon)
    normal = (polygon[1] - polygon[0]).cross(polygon[2] - polygon[0])
    if normal.length_squared <= 1e-12:
        return center, None
    return center, normal.normalized()


def _record_surface_samples(record, vertices):
    points = [Vector(vertices[index]) for index in record["vertices"]]
    points.append(sum(points, Vector((0.0, 0.0, 0.0))) / len(points))
    return tuple(points)


def _negative_signed_depths(records, vertices, tree):
    depths = []
    representatives = []
    for record in records:
        for point in _record_surface_samples(record, vertices):
            nearest = tree.find_nearest(point)
            if nearest is None:
                continue
            location, normal, polygon_index, distance = nearest
            signed = float((point - location).dot(normal))
            if signed >= -MESH_PENETRATION_TOLERANCE:
                continue
            depth = -signed
            depths.append(depth)
            if len(representatives) < 12:
                representatives.append({
                    "depth_blender": depth,
                    "depth_pmx": depth / PMX_TO_BLENDER_SCALE,
                    "sample_world": tuple(float(value) for value in point),
                    "nearest_surface_world": tuple(float(value) for value in location),
                    "nearest_surface_normal_world": tuple(float(value) for value in normal),
                    "nearest_polygon_index": int(polygon_index),
                    "unsigned_distance": float(distance),
                })
    return depths, representatives


def _record_edge_lengths(records, vertices):
    lengths = []
    seen = set()
    for record in records:
        indices = tuple(int(index) for index in record["vertices"])
        for first, second in zip(indices, indices[1:] + indices[:1], strict=True):
            edge = tuple(sorted((first, second)))
            if edge in seen:
                continue
            seen.add(edge)
            lengths.append((Vector(vertices[first]) - Vector(vertices[second])).length)
    return tuple(lengths)


def _shell_thickness_samples(records, vertices, tree, median_edge):
    epsilon = max(1e-5, float(median_edge) * 0.05)
    max_distance = max(0.2, float(median_edge) * 20.0)
    samples = []
    for record in records:
        center, normal = _face_center_normal(record, vertices)
        if normal is None:
            continue
        for sign in (-1.0, 1.0):
            outward = normal * sign
            direction = -outward
            first = tree.ray_cast(center + outward * epsilon, direction, max_distance)
            if first[0] is None:
                continue
            second_start = first[0] + direction * (epsilon * 4.0)
            second = tree.ray_cast(second_start, direction, max_distance)
            if second[0] is None:
                continue
            thickness = (second[0] - first[0]).length
            if thickness > epsilon * 2.0:
                samples.append(float(thickness))
                break
    return tuple(samples)


def _silhouette_visibility(full_tree, points, model_median_edge):
    tolerance = max(float(model_median_edge), 0.002)
    view_directions = {
        "front": Vector((0.0, -1.0, 0.0)),
        "left": Vector((1.0, 0.0, 0.0)),
        "right": Vector((-1.0, 0.0, 0.0)),
    }
    hits = {}
    for view, to_camera in view_directions.items():
        values = []
        for point in points:
            point = Vector(point)
            start = point + to_camera * 3.0
            hit = full_tree.ray_cast(start, -to_camera, 6.0)
            values.append(
                hit[0] is not None and (hit[0] - point).length <= tolerance
            )
        hits[view] = tuple(values)
    result = classify_silhouette_visibility(hits)
    result["method"] = (
        "orthographic camera-direction ray test; first full-mesh hit must be within "
        "one model-wide median mesh edge of the collision sample"
    )
    result["visibility_tolerance_blender"] = tolerance
    return result


def _collision_severity_evidence(mesh, geometry, vertices, overlap_pairs):
    focus_pairs = tuple(
        (int(moving_index), int(target_index))
        for moving_index, target_index in overlap_pairs
        if geometry["moving_face_records"][int(moving_index)]["region"] in {
            "forearm", "mixed_hand_forearm"
        }
        and geometry["torso_face_records"][int(target_index)]["group"] == "上半身2"
    )
    moving_indices = sorted({pair[0] for pair in focus_pairs})
    target_indices = sorted({pair[1] for pair in focus_pairs})
    moving_records = tuple(geometry["moving_face_records"][index] for index in moving_indices)
    target_records = tuple(geometry["torso_face_records"][index] for index in target_indices)
    moving_tree = _bvh(vertices, geometry["moving_faces"])
    torso_tree = _bvh(vertices, geometry["torso_faces"])
    full_tree = _bvh(vertices, tuple(tuple(int(index) for index in polygon.vertices) for polygon in mesh.data.polygons))
    moving_depths, moving_representatives = _negative_signed_depths(
        moving_records, vertices, torso_tree
    )
    target_depths, target_representatives = _negative_signed_depths(
        target_records, vertices, moving_tree
    )
    depths = tuple(moving_depths + target_depths)
    depth_summary = summarize_penetration_depths(depths)
    edge_lengths = _record_edge_lengths((*moving_records, *target_records), vertices)
    median_edge = _linear_percentile(edge_lengths, 0.5)
    model_edge_lengths = tuple(
        (Vector(vertices[edge.vertices[0]]) - Vector(vertices[edge.vertices[1]])).length
        for edge in mesh.data.edges
    )
    model_median_edge = _linear_percentile(model_edge_lengths, 0.5)
    sleeve_thickness_samples = _shell_thickness_samples(
        moving_records, vertices, moving_tree, median_edge
    )
    chest_thickness_samples = _shell_thickness_samples(
        target_records, vertices, torso_tree, median_edge
    )
    sleeve_thickness = _linear_percentile(sleeve_thickness_samples, 0.5) or None
    chest_thickness = _linear_percentile(chest_thickness_samples, 0.5) or None
    attribution = attribute_collision_pairs(
        focus_pairs,
        geometry["moving_face_records"],
        geometry["torso_face_records"],
        vertices,
    )
    marker_points = tuple(
        tuple(
            (float(moving) + float(target)) * 0.5
            for moving, target in zip(
                item["moving_world_point"], item["torso_world_point"], strict=True
            )
        )
        for item in attribution["representative_pairs"]
    )
    return {
        "raw_overlap_count": len(overlap_pairs),
        "focused_forearm_upper_chest_overlap_count": len(focus_pairs),
        "depth_method": (
            "bidirectional negative signed nearest-surface samples from overlapping "
            "moving and target polygons"
        ),
        "depth_caveat": (
            "signed depth is a mesh-normal proxy for intersecting layered shells, not a "
            "solid-volume containment proof"
        ),
        "penetration_depth": depth_summary,
        "representative_depth_samples": moving_representatives + target_representatives,
        "area": collision_area_evidence(
            focus_pairs,
            geometry["moving_face_records"],
            geometry["torso_face_records"],
            vertices,
        ),
        "attribution": attribution,
        "overlap_bbox": attribution["overlap_bbox"],
        "median_local_mesh_edge_blender": median_edge,
        "median_local_mesh_edge_pmx": median_edge / PMX_TO_BLENDER_SCALE,
        "model_median_mesh_edge_blender": model_median_edge,
        "model_median_mesh_edge_pmx": model_median_edge / PMX_TO_BLENDER_SCALE,
        "sleeve_thickness_blender": sleeve_thickness,
        "chest_thickness_blender": chest_thickness,
        "sleeve_thickness_pmx": (
            sleeve_thickness / PMX_TO_BLENDER_SCALE
            if sleeve_thickness is not None else None
        ),
        "chest_thickness_pmx": (
            chest_thickness / PMX_TO_BLENDER_SCALE
            if chest_thickness is not None else None
        ),
        "sleeve_thickness_samples": len(sleeve_thickness_samples),
        "chest_thickness_samples": len(chest_thickness_samples),
        "thickness_method": (
            "second-hit shell traversal along each implicated polygon normal; chest "
            "thickness may span the full closed torso shell"
        ),
        "scale_comparison": compare_penetration_scales(
            max_depth=depth_summary["max_blender"],
            median_mesh_edge=model_median_edge,
            sleeve_thickness=sleeve_thickness,
            chest_thickness=chest_thickness,
        ),
        "silhouette_visibility": _silhouette_visibility(
            full_tree, marker_points, model_median_edge
        ),
        "marker_points": marker_points,
    }


def _capture_sleeve_primary_state(armature, contact_world):
    primary_bones = ("右肩", "右腕", "右ひじ", "右手首")
    return {
        "bone_positions": {
            name: {
                "head": tuple(float(value) for value in _pose_head_world(armature, name)),
                "tail": tuple(
                    float(value)
                    for value in (armature.matrix_world @ armature.pose.bones[name].tail)
                ),
            }
            for name in primary_bones
        },
        "bone_rotations": {
            name: tuple(float(value) for value in _world_rotation(armature, name))
            for name in primary_bones
        },
        "fingertips": _finger_tip_positions(armature),
        "contact_world": tuple(float(value) for value in contact_world),
    }


def _sleeve_primary_drift(baseline, current):
    position_drifts = []
    for name in baseline["bone_positions"]:
        for endpoint in ("head", "tail"):
            position_drifts.append(_point_distance(
                baseline["bone_positions"][name][endpoint],
                current["bone_positions"][name][endpoint],
            ))
    rotation_drifts = [
        quaternion_distance_degrees(
            baseline["bone_rotations"][name], current["bone_rotations"][name]
        )
        for name in baseline["bone_rotations"]
    ]
    fingertip_drifts = [
        _point_distance(baseline["fingertips"][name], current["fingertips"][name])
        for name in baseline["fingertips"]
    ]
    return {
        "max_primary_position_drift": max(position_drifts, default=0.0),
        "max_primary_rotation_drift_deg": max(rotation_drifts, default=0.0),
        "max_fingertip_drift": max(fingertip_drifts, default=0.0),
        "contact_point_drift": _point_distance(
            baseline["contact_world"], current["contact_world"]
        ),
        "position_drift_by_bone": {
            name: max(
                _point_distance(
                    baseline["bone_positions"][name][endpoint],
                    current["bone_positions"][name][endpoint],
                )
                for endpoint in ("head", "tail")
            )
            for name in baseline["bone_positions"]
        },
        "rotation_drift_by_bone_deg": {
            name: quaternion_distance_degrees(
                baseline["bone_rotations"][name], current["bone_rotations"][name]
            )
            for name in baseline["bone_rotations"]
        },
        "fingertip_drift_by_name": {
            name: _point_distance(
                baseline["fingertips"][name], current["fingertips"][name]
            )
            for name in baseline["fingertips"]
        },
    }


def _capture_sleeve_shape(vertices, faces):
    points = tuple(tuple(float(value) for value in point) for point in vertices)
    records = []
    for index, face in enumerate(faces):
        first, second, third = (Vector(vertices[vertex]) for vertex in face[:3])
        normal = (second - first).cross(third - first)
        area = _polygon_area(points, face)
        records.append({
            "face_index": index,
            "area": area,
            "normal": (
                tuple(float(value) for value in normal.normalized())
                if normal.length_squared > 1e-12 else (0.0, 0.0, 0.0)
            ),
        })
    return tuple(records)


def _sleeve_shape_evidence(baseline, current):
    ratios = []
    flipped = 0
    finite = True
    for before, after in zip(baseline, current, strict=True):
        before_area = float(before["area"])
        after_area = float(after["area"])
        finite = finite and math.isfinite(after_area) and all(
            math.isfinite(value) for value in after["normal"]
        )
        if before_area > 1e-12:
            ratios.append(after_area / before_area)
        dot = sum(
            left * right
            for left, right in zip(before["normal"], after["normal"], strict=True)
        )
        if dot < 0.0:
            flipped += 1
    minimum = min(ratios, default=1.0)
    maximum = max(ratios, default=1.0)
    reasons = []
    if not finite:
        reasons.append("Sleeve corrective mesh contains non-finite face evidence")
    if flipped:
        reasons.append("Sleeve corrective mesh contains inverted faces")
    if minimum < SLEEVE_FACE_MIN_AREA_RATIO:
        reasons.append("Sleeve corrective mesh contains collapsed faces")
    if maximum > SLEEVE_FACE_MAX_AREA_RATIO:
        reasons.append("Sleeve corrective mesh contains excessively stretched faces")
    return {
        "face_count": len(current),
        "minimum_area_ratio": minimum,
        "maximum_area_ratio": maximum,
        "flipped_face_count": flipped,
        "matrices_finite": finite,
        "reasons": reasons,
    }


def _refresh_frame(frame: int = VALIDATION_FRAME) -> None:
    scene = bpy.context.scene
    scene.frame_set(frame - 1)
    scene.frame_set(frame)
    bpy.context.view_layer.update()


def _capture_pose_state(armature, frame: int):
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    return {
        "elbow": _pose_head_world(armature, "右ひじ").copy(),
        "wrist": _pose_head_world(armature, "右手首").copy(),
        "local_rotations": {
            name: _evaluated_local_rotation(armature, name).copy()
            for name in ("右腕捩", "右手捩", "右手首")
        },
    }


def _reset_static_controls_to_v16(armature, controls):
    armature["POC_enabled"] = 0.0
    controls["palm"].matrix_basis = Matrix.Identity(4)
    armature.update_tag()
    _refresh_frame()
    shoulder = _pose_head_world(armature, "右腕")
    elbow = _pose_head_world(armature, "右ひじ")
    wrist = _pose_head_world(armature, "右手首")
    reach_axis = wrist - shoulder
    elbow_radial = elbow - shoulder - reach_axis * (
        (elbow - shoulder).dot(reach_axis) / reach_axis.length_squared
    )
    if elbow_radial.length < 1e-6:
        elbow_radial = armature.matrix_world.to_3x3() @ Vector((0.0, -1.0, 0.0))
    controls["hand"].location = wrist
    controls["pole"].location = elbow + elbow_radial.normalized() * 0.5
    _refresh_frame()


def _apply_static_candidate(
    armature,
    controls,
    candidate,
    base_hand,
    contact_delta,
    base_pole,
    pole_axis,
    pole_basis,
):
    controls["hand"].location = (
        base_hand
        + contact_delta * candidate.alignment_factor
        + Vector(candidate.hand_offset)
    )
    controls["pole"].location = base_pole + pole_axis * candidate.pole_offset
    for coefficient, name in zip(
        candidate.pole_offset_3d,
        ("outward_lateral", "forward_depth", "vertical"),
        strict=True,
    ):
        controls["pole"].location += Vector(pole_basis[name]) * coefficient
    controls["palm"].rotation_mode = "XYZ"
    controls["palm"].rotation_euler = Euler(
        tuple(math.radians(value) for value in candidate.palm_euler_deg),
        "XYZ",
    )
    upper_twist, hand_twist, wrist = candidate.twist_influences
    armature["POC_upper_twist_influence"] = upper_twist
    armature["POC_hand_twist_influence"] = hand_twist
    armature["POC_wrist_influence"] = wrist
    armature["POC_enabled"] = 1.0
    armature.update_tag()
    _refresh_frame()


def _capture_static_control_state(
    armature, controls, compensation_controls=None, finger_controls=None
) -> dict[str, object]:
    state = {
        "hand": tuple(float(value) for value in controls["hand"].location),
        "pole": tuple(float(value) for value in controls["pole"].location),
        "palm_basis": tuple(float(value) for row in controls["palm"].matrix_basis for value in row),
        "enabled": float(armature["POC_enabled"]),
        "upper_twist_influence": float(armature["POC_upper_twist_influence"]),
        "hand_twist_influence": float(armature["POC_hand_twist_influence"]),
        "wrist_influence": float(armature["POC_wrist_influence"]),
    }
    if compensation_controls is not None:
        state["compensation_influence"] = float(armature["POC_compensation_influence"])
        state["compensation_quaternions"] = {
            key: tuple(float(value) for value in control.rotation_quaternion)
            for key, control in compensation_controls.items()
        }
    if finger_controls is not None:
        state["finger_influence"] = float(armature["POC_finger_influence"])
        state["finger_quaternions"] = {
            name: tuple(float(value) for value in control.rotation_quaternion)
            for name, control in finger_controls.items()
        }
    return state


def _restore_static_control_state(
    armature, controls, state: dict[str, object], compensation_controls=None, finger_controls=None
) -> None:
    controls["hand"].location = Vector(state["hand"])
    controls["pole"].location = Vector(state["pole"])
    controls["palm"].matrix_basis = Matrix(tuple(
        tuple(float(state["palm_basis"][row * 4 + column]) for column in range(4))
        for row in range(4)
    ))
    armature["POC_enabled"] = float(state["enabled"])
    armature["POC_upper_twist_influence"] = float(state["upper_twist_influence"])
    armature["POC_hand_twist_influence"] = float(state["hand_twist_influence"])
    armature["POC_wrist_influence"] = float(state["wrist_influence"])
    if compensation_controls is not None and "compensation_quaternions" in state:
        armature["POC_compensation_influence"] = float(state["compensation_influence"])
        for key, quaternion in state["compensation_quaternions"].items():
            compensation_controls[key].rotation_mode = "QUATERNION"
            compensation_controls[key].rotation_quaternion = Quaternion(quaternion)
    if finger_controls is not None and "finger_quaternions" in state:
        armature["POC_finger_influence"] = float(state["finger_influence"])
        for name, quaternion in state["finger_quaternions"].items():
            finger_controls[name].rotation_mode = "QUATERNION"
            finger_controls[name].rotation_quaternion = Quaternion(quaternion)
    armature.update_tag()
    _refresh_frame()


def _anatomy_measurements(armature, controls, previous, chin_world):
    root = _pose_head_world(armature, PROXY_BONE_NAMES[0])
    elbow = _pose_head_world(armature, PROXY_BONE_NAMES[1])
    end = _pose_head_world(armature, PROXY_BONE_NAMES[2])
    elbow_angle = math.degrees((root - elbow).angle(end - elbow))
    signed_flex, off_axis_flex = _signed_proxy_elbow_flex(armature)
    pole_side = _proxy_elbow_pole_side(armature, controls["pole"])
    upper_twist, upper_swing, _upper_total = _local_y_twist_response(
        previous["local_rotations"]["右腕捩"], _evaluated_local_rotation(armature, "右腕捩")
    )
    hand_twist, hand_swing, _hand_total = _local_y_twist_response(
        previous["local_rotations"]["右手捩"], _evaluated_local_rotation(armature, "右手捩")
    )
    wrist_twist, wrist_swing, _wrist_total = _local_y_twist_response(
        previous["local_rotations"]["右手首"], _evaluated_local_rotation(armature, "右手首")
    )
    proxy_names = tuple(
        name for name in ("右親指２", "右人指３", "右手首") if name in armature.pose.bones
    )
    contact_proxy = min(
        (_pose_head_world(armature, name) - chin_world).length for name in proxy_names
    )
    continuity = max(
        (elbow - previous["elbow"]).length,
        (_pose_head_world(armature, "右手首") - previous["wrist"]).length,
    )
    relevant_matrices = (
        armature.matrix_world,
        *(armature.pose.bones[name].matrix for name in (*PROXY_BONE_NAMES, "右腕", "右ひじ", "右手首")),
        *(control.matrix_world for control in controls.values()),
    )
    return {
        "elbow_angle_deg": elbow_angle,
        "signed_elbow_flex_deg": signed_flex,
        "elbow_off_axis_deg": off_axis_flex,
        "pole_side": pole_side,
        "wrist_swing_deg": wrist_swing,
        "wrist_twist_deg": wrist_twist,
        "forearm_twist_deg": upper_twist + hand_twist,
        "upper_twist_deg": upper_twist,
        "hand_twist_deg": hand_twist,
        "upper_twist_swing_deg": upper_swing,
        "hand_twist_swing_deg": hand_swing,
        "continuity_distance": continuity,
        "matrices_finite": all(_finite_matrix(matrix) for matrix in relevant_matrices),
        "cheap_contact_proxy_distance": contact_proxy,
        "hand_target_world": tuple(float(value) for value in controls["hand"].location),
        "pole_target_world": tuple(float(value) for value in controls["pole"].location),
        "palm_local_euler_deg": tuple(math.degrees(float(value)) for value in controls["palm"].rotation_euler),
        "twist_influences": (
            float(armature["POC_upper_twist_influence"]),
            float(armature["POC_hand_twist_influence"]),
            float(armature["POC_wrist_influence"]),
        ),
    }


def _stage_a_record(math_module, candidate, measurements):
    anatomy = math_module.score_anatomy(
        measurements["elbow_angle_deg"],
        measurements["wrist_swing_deg"],
        measurements["forearm_twist_deg"],
    )
    reasons = list(anatomy.reasons)
    valid = anatomy.valid
    if not signed_elbow_flex_is_valid(measurements["signed_elbow_flex_deg"]):
        valid = False
        reasons.append("Signed elbow hinge limit failed")
    if measurements["elbow_off_axis_deg"] > ELBOW_OFF_AXIS_MAX_DEG:
        valid = False
        reasons.append("Proxy elbow left its signed hinge axis")
    if measurements["pole_side"] <= math_module.EPSILON:
        valid = False
        reasons.append("Elbow is not on the pole-facing side")
    if abs(measurements["wrist_twist_deg"]) > math_module.WRIST_TWIST_HARD_MAX_DEG:
        valid = False
        reasons.append("Wrist twist exceeds its hard limit")
    if measurements["continuity_distance"] > math_module.CONTINUITY_HARD_DISTANCE:
        valid = False
        reasons.append("Candidate discontinuity exceeds its hard limit")
    if not measurements["matrices_finite"]:
        valid = False
        reasons.append("Candidate contains non-finite matrices")
    proxy_penalty = (measurements["cheap_contact_proxy_distance"] / 0.1) ** 2
    score = anatomy.component_penalties["elbow"] * math_module.ELBOW_SCORE_WEIGHT + anatomy.total_penalty * 4.0 + proxy_penalty
    return {
        "source_candidate_id": candidate.candidate_id,
        "parameters": {
            "alignment_factor": candidate.alignment_factor,
            "hand_offset": candidate.hand_offset,
            "palm_euler_deg": candidate.palm_euler_deg,
            "pole_offset": candidate.pole_offset,
            "pole_offset_3d": candidate.pole_offset_3d,
            "search_family": candidate.search_family,
            "twist_influences": candidate.twist_influences,
        },
        "stage": "A",
        "valid": valid,
        "verdict": "FAIL" if not valid else ("WARN" if reasons else "PASS"),
        "reasons": reasons,
        "score": float(score + (0.0 if valid else math_module.HARD_REJECTION_PENALTY)),
        "component_penalties": {**anatomy.component_penalties, "cheap_contact_proxy": proxy_penalty},
        "metrics": measurements,
    }


def _build_chin_surface(mesh, geometry, vertices, chin_world, math_module):
    bootstrap = lower_chin_surface_region(
        vertices,
        geometry["head_faces"],
        anchor=chin_world,
        radius=CHIN_REGION_BOOTSTRAP_RADIUS,
    )
    band = math_module.derive_contact_band(bootstrap["edge_lengths"])
    region = lower_chin_surface_region(
        vertices,
        geometry["head_faces"],
        anchor=chin_world,
        radius=band.region_radius,
    )
    band = math_module.derive_contact_band(region["edge_lengths"])
    tree = _bvh(vertices, region["triangles"])
    nearest = tree.find_nearest(chin_world)
    if nearest is None:
        raise RuntimeError("Unable to project calibrated chin point onto evaluated head surface")
    location, normal, triangle_index, distance = nearest
    return {
        "region": region,
        "band": band,
        "tree": tree,
        "calibrated_nearest_world": location,
        "calibrated_nearest_normal": normal.normalized(),
        "calibrated_surface_distance": float(distance),
        "calibrated_nearest_triangle_index": int(triangle_index),
    }


def _surface_contact_evidence_bvh(mesh, geometry, chin_surface):
    requested = geometry["thumb_vertices"] | geometry["index_vertices"] | geometry["side_palm_vertices"]
    vertices = _evaluated_world_vertex_subset(mesh, requested)
    samples = []
    groups = {
        "thumb": geometry["thumb_vertices"],
        "index": geometry["index_vertices"],
        "side_palm": geometry["side_palm_vertices"],
    }
    for source, indices in groups.items():
        for index in indices:
            point = vertices[index]
            nearest = chin_surface["tree"].find_nearest(point)
            if nearest is None:
                continue
            location, normal, triangle_index, distance = nearest
            signed_distance = (point - location).dot(normal)
            samples.append((float(distance), source, index, point, location, float(signed_distance), int(triangle_index)))
    if not samples:
        raise RuntimeError("No named hand vertices could be measured against the chin surface")
    best = min(samples, key=lambda item: (item[0], item[1], item[2]))
    band = chin_surface["band"]
    contact_tree = _local_bvh(vertices, geometry["contact_surface_faces"])
    contact_overlap_count = len(contact_tree.overlap(chin_surface["tree"]))
    negative_signed_samples = sum(
        signed < -MESH_PENETRATION_TOLERANCE
        for _distance, _source, _index, _point, _location, signed, _triangle in samples
    )
    patch_by_source = {
        source: sum(
            distance <= band.warning_distance
            for distance, sample_source, *_rest in samples
            if sample_source == source
        )
        for source in groups
    }
    distance_by_source = {
        source: min(
            distance
            for distance, sample_source, *_rest in samples
            if sample_source == source
        )
        for source in groups
    }
    nearest_by_source = {}
    for source in groups:
        nearest_sample = min(
            (sample for sample in samples if sample[1] == source),
            key=lambda sample: (sample[0], sample[2]),
        )
        nearest_by_source[source] = {
            "distance": nearest_sample[0],
            "vertex_index": nearest_sample[2],
            "hand_world": tuple(float(value) for value in nearest_sample[3]),
            "chin_surface_world": tuple(float(value) for value in nearest_sample[4]),
            "signed_distance": nearest_sample[5],
            "triangle_index": nearest_sample[6],
        }
    dual_band = derive_dual_contact_band(
        mesh_resolution=band.mesh_resolution,
        index_warning_distance=band.warning_distance,
    )
    thumb_support_patch_count = sum(
        distance <= dual_band.thumb_warning_distance
        for distance, source, *_rest in samples
        if source == "thumb"
    )
    return {
        "surface_contact_distance": best[0],
        "contact_error": best[0],
        "contact_source": best[1],
        "contact_vertex_index": best[2],
        "hand_contact_world": tuple(float(value) for value in best[3]),
        "nearest_chin_surface_world": tuple(float(value) for value in best[4]),
        "surface_signed_distance": best[5],
        "nearest_chin_triangle_index": best[6],
        "surface_intersection_count": contact_overlap_count,
        "negative_signed_sample_count": negative_signed_samples,
        "contact_patch_count": sum(patch_by_source.values()),
        "contact_patch_by_source": patch_by_source,
        "contact_distance_by_source": distance_by_source,
        "contact_nearest_by_source": nearest_by_source,
        "thumb_support_patch_count": thumb_support_patch_count,
        "dual_contact_band": {
            "mesh_resolution": dual_band.mesh_resolution,
            "index_warning_distance": dual_band.index_warning_distance,
            "thumb_target_distance": dual_band.thumb_target_distance,
            "thumb_warning_distance": dual_band.thumb_warning_distance,
            "derivation": dual_band.derivation,
        },
        "thumb_index_contact_patch_count": patch_by_source["thumb"] + patch_by_source["index"],
        "contact_sample_count": len(samples),
    }


def _chin_support_surface_evidence(mesh, geometry, chin_surface, armature):
    region = geometry["index_knuckle_region"]
    support_faces = region["support_faces"]
    support_indices = region["support_vertices"]
    if not support_faces:
        raise RuntimeError("Index knuckle support region contains no proximal surface triangles")
    requested = support_indices | geometry["thumb0_vertices"] | geometry["thumb1_vertices"]
    vertices = _evaluated_world_vertex_subset(mesh, requested)
    band = derive_chin_support_band(
        mesh_resolution=chin_surface["band"].mesh_resolution,
        chin_warning_distance=chin_surface["band"].warning_distance,
    )
    samples = []
    for face_index, face in enumerate(support_faces):
        first, second, third = (vertices[index] for index in face)
        index_normal = (second - first).cross(third - first)
        if index_normal.length_squared <= 1e-12:
            continue
        index_normal.normalize()
        points = (first, second, third, (first + second + third) / 3.0)
        for point_index, point in enumerate(points):
            nearest = chin_surface["tree"].find_nearest(point)
            if nearest is not None:
                location, chin_normal, chin_triangle_index, distance = nearest
                samples.append({
                    "distance": float(distance),
                    "index_face_index": int(face_index),
                    "index_face_vertices": tuple(int(index) for index in face),
                    "sample_index": int(point_index),
                    "index_surface_world": tuple(float(value) for value in point),
                    "chin_surface_world": tuple(float(value) for value in location),
                    "index_surface_normal_world": tuple(float(value) for value in index_normal),
                    "chin_surface_normal_world": tuple(float(value) for value in chin_normal),
                    "normal_opposition_error_deg": surface_normal_opposition_error(
                        index_normal, chin_normal
                    ),
                    "chin_triangle_index": int(chin_triangle_index),
                    "signed_chin_distance": float((point - location).dot(chin_normal)),
                })
    if not samples:
        raise RuntimeError("Index knuckle triangles could not be measured against the lower chin")
    best = min(samples, key=lambda item: (
        item["distance"], item["normal_opposition_error_deg"],
        item["index_face_index"], item["sample_index"],
    ))
    patch = [
        item for item in samples
        if item["distance"] <= band.support_warning_distance
        and item["normal_opposition_error_deg"] <= INDEX_SUPPORT_NORMAL_MAX_DEG
    ]
    support_sample = min(
        patch,
        key=lambda item: (
            item["distance"], item["normal_opposition_error_deg"],
            item["index_face_index"], item["sample_index"],
        ),
    ) if patch else best
    fingertips = _finger_tip_positions(armature)
    tip_surface = _tip_surface_evidence(armature, chin_surface)
    thumb_tip = Vector(fingertips["thumb"])
    index_surface_point = Vector(support_sample["index_surface_world"])
    thumb_to_index_surface = min(
        (thumb_tip - vertices[index]).length for index in support_indices
    )
    contour_limit = band.mesh_resolution * THUMB_INDEX_CONTOUR_MAX_EDGE_MULTIPLIER
    thumb_vertical_offset = float(thumb_tip.z - index_surface_point.z)
    under_chin_tolerance = band.mesh_resolution
    contact_vertical_offset = float(
        Vector(support_sample["index_surface_world"]).z
        - Vector(support_sample["chin_surface_world"]).z
    )
    return {
        "index_support_surface_distance": best["distance"],
        "index_support_patch_count": len({item["index_face_index"] for item in patch}),
        "index_support_patch_sample_count": len(patch),
        "index_support_nearest": best,
        "index_support_patch_representative": support_sample,
        "index_support_surface_normal_world": support_sample["index_surface_normal_world"],
        "chin_support_surface_normal_world": support_sample["chin_surface_normal_world"],
        "index_support_normal_opposition_error_deg": support_sample["normal_opposition_error_deg"],
        "index_support_normal_max_deg": INDEX_SUPPORT_NORMAL_MAX_DEG,
        "index_support_under_chin": contact_vertical_offset <= under_chin_tolerance,
        "index_support_vertical_offset_from_chin": contact_vertical_offset,
        "index_support_under_chin_tolerance": under_chin_tolerance,
        "index_support_vertex_count": len(support_indices),
        "index_support_triangle_count": len(support_faces),
        "index_support_vertex_indices": tuple(sorted(support_indices)),
        "index_support_face_vertices": support_faces,
        "support_band": {
            "mesh_resolution": band.mesh_resolution,
            "support_target_distance": band.support_target_distance,
            "support_warning_distance": band.support_warning_distance,
            "derivation": band.derivation,
        },
        "thumb_tip_world": tuple(float(value) for value in thumb_tip),
        "thumb_tip_surface_distance": float(tip_surface["thumb"]["distance"]),
        "index_tip_surface_distance": float(tip_surface["index"]["distance"]),
        "tip_surface_evidence": tip_surface,
        "thumb_index_contour_distance": float(thumb_to_index_surface),
        "thumb_index_contour_max_distance": float(contour_limit),
        "thumb_vertical_offset_from_index_support": thumb_vertical_offset,
        "thumb_contour_bounded": bool(
            thumb_to_index_surface <= contour_limit
            and thumb_vertical_offset <= band.mesh_resolution * 2.0
        ),
        "thumb_contour_derivation": (
            "thumb tip remains within seven median lower-chin triangle edges of the "
            "index 1/2 surface and no more than two edges above the support point"
        ),
    }


def _current_chin_surface(mesh, armature, baseline_surface):
    region = baseline_surface["region"]
    region_vertices = _evaluated_world_vertex_subset(mesh, region["vertex_indices"])
    tree = _local_bvh(region_vertices, region["triangles"])
    chin_world = _calibrated_chin_points(armature)[2]
    nearest = tree.find_nearest(chin_world)
    if nearest is None:
        raise RuntimeError("Unable to project the current head-tracked chin point")
    location, normal, triangle_index, distance = nearest
    return {
        "region": region,
        "band": baseline_surface["band"],
        "tree": tree,
        "region_vertices": region_vertices,
        "calibrated_nearest_world": location,
        "calibrated_nearest_normal": normal.normalized(),
        "calibrated_surface_distance": float(distance),
        "calibrated_nearest_triangle_index": int(triangle_index),
        "chin_world": chin_world,
    }


def _candidate_measurements(armature, mesh, controls, geometry, candidate, previous):
    root = _pose_head_world(armature, PROXY_BONE_NAMES[0])
    elbow = _pose_head_world(armature, PROXY_BONE_NAMES[1])
    end = _pose_head_world(armature, PROXY_BONE_NAMES[2])
    elbow_angle = math.degrees((root - elbow).angle(end - elbow))
    signed_flex, off_axis_flex = _signed_proxy_elbow_flex(armature)
    pole_side = _proxy_elbow_pole_side(armature, controls["pole"])
    upper_twist, upper_swing, _upper_total = _local_y_twist_response(
        previous["local_rotations"]["右腕捩"],
        _evaluated_local_rotation(armature, "右腕捩"),
    )
    hand_twist, hand_swing, _hand_total = _local_y_twist_response(
        previous["local_rotations"]["右手捩"],
        _evaluated_local_rotation(armature, "右手捩"),
    )
    wrist_twist, wrist_swing, _wrist_total = _local_y_twist_response(
        previous["local_rotations"]["右手首"],
        _evaluated_local_rotation(armature, "右手首"),
    )
    chin_rest, chin_local, chin_world = _calibrated_chin_points(armature)
    controls["chin"].location = chin_world
    mesh_metrics, vertices = _mesh_evidence(mesh, geometry, chin_world)
    continuity = max(
        (_pose_head_world(armature, "右ひじ") - previous["elbow"]).length,
        (_pose_head_world(armature, "右手首") - previous["wrist"]).length,
    )
    relevant_matrices = (
        armature.matrix_world,
        *(armature.pose.bones[name].matrix for name in (*PROXY_BONE_NAMES, "右腕", "右ひじ", "右手首")),
        *(control.matrix_world for control in controls.values()),
    )
    measurements = {
        "elbow_angle_deg": elbow_angle,
        "signed_elbow_flex_deg": signed_flex,
        "elbow_off_axis_deg": off_axis_flex,
        "pole_side": pole_side,
        "wrist_swing_deg": wrist_swing,
        "wrist_twist_deg": wrist_twist,
        "forearm_twist_deg": upper_twist + hand_twist,
        "upper_twist_deg": upper_twist,
        "hand_twist_deg": hand_twist,
        "upper_twist_swing_deg": upper_swing,
        "hand_twist_swing_deg": hand_swing,
        "continuity_distance": continuity,
        "matrices_finite": all(_finite_matrix(matrix) for matrix in relevant_matrices),
        "hand_target_world": tuple(float(value) for value in controls["hand"].location),
        "pole_target_world": tuple(float(value) for value in controls["pole"].location),
        "palm_local_euler_deg": tuple(
            math.degrees(float(value)) for value in controls["palm"].rotation_euler
        ),
        "twist_influences": (
            float(armature["POC_upper_twist_influence"]),
            float(armature["POC_hand_twist_influence"]),
            float(armature["POC_wrist_influence"]),
        ),
        **mesh_metrics,
        "chin_rest": tuple(float(value) for value in chin_rest),
        "chin_head_local": tuple(float(value) for value in chin_local),
        "chin_world": tuple(float(value) for value in chin_world),
    }
    return measurements, vertices


def _candidate_record(candidate, measurements, score):
    reasons = list(score.reasons)
    if measurements["elbow_off_axis_deg"] > ELBOW_OFF_AXIS_MAX_DEG:
        reasons.append(
            f"Proxy elbow left the local-{ELBOW_HINGE_AXIS} hinge by "
            f"{measurements['elbow_off_axis_deg']:.6f} degrees"
        )
    valid = score.valid and measurements["elbow_off_axis_deg"] <= ELBOW_OFF_AXIS_MAX_DEG
    verdict = score.verdict if valid else "FAIL"
    return {
        "source_candidate_id": candidate.candidate_id,
        "parameters": {
            "alignment_factor": candidate.alignment_factor,
            "hand_offset": candidate.hand_offset,
            "palm_euler_deg": candidate.palm_euler_deg,
            "pole_offset": candidate.pole_offset,
            "pole_offset_3d": candidate.pole_offset_3d,
            "search_family": candidate.search_family,
            "twist_influences": candidate.twist_influences,
        },
        "valid": valid,
        "verdict": verdict,
        "reasons": reasons,
        "score": float(score.total_score),
        "component_penalties": score.component_penalties,
        "metrics": measurements,
    }


def _rank_key(item):
    _candidate, record = item
    return (
        not record["valid"],
        record["score"],
        record["source_candidate_id"],
    )


def stage_a_survivors(evaluated, limit: int):
    if limit <= 0:
        return []
    strata = {}
    for candidate, record in evaluated:
        if not record["valid"]:
            continue
        key = (candidate.search_family, candidate.alignment_factor, candidate.hand_offset)
        strata.setdefault(key, []).append((candidate, record))
    for items in strata.values():
        items.sort(key=_rank_key)
    globally_ranked = sorted(
        (item for item in evaluated if item[1]["valid"]), key=_rank_key
    )
    selected = globally_ranked[: max(1, limit // 2)]
    selected_ids = {candidate.candidate_id for candidate, _record in selected}
    depth = 0
    ordered_keys = sorted(strata)
    while len(selected) < limit:
        advanced = False
        for key in ordered_keys:
            items = strata[key]
            if depth < len(items):
                advanced = True
                candidate_item = items[depth]
                if candidate_item[0].candidate_id not in selected_ids:
                    selected.append(candidate_item)
                    selected_ids.add(candidate_item[0].candidate_id)
                    if len(selected) == limit:
                        break
        if not advanced:
            break
        depth += 1
    return sorted(selected, key=_rank_key)


def _full_body_camera(scene, all_vertices):
    minimum = Vector((
        min(vertex.x for vertex in all_vertices),
        min(vertex.y for vertex in all_vertices),
        min(vertex.z for vertex in all_vertices),
    ))
    maximum = Vector((
        max(vertex.x for vertex in all_vertices),
        max(vertex.y for vertex in all_vertices),
        max(vertex.z for vertex in all_vertices),
    ))
    center = (minimum + maximum) * 0.5
    extents = maximum - minimum
    ortho_scale = max(extents.x, extents.y, extents.z) * FULL_BODY_MARGIN
    distance = max(extents) * 3.0 + 2.0
    old = bpy.data.objects.get(STATIC_CAMERA_NAME)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    camera_data = bpy.data.cameras.new(STATIC_CAMERA_NAME)
    camera = bpy.data.objects.new(STATIC_CAMERA_NAME, camera_data)
    scene.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ortho_scale
    scene.camera = camera
    return camera, center, distance, ortho_scale, minimum, maximum


def _render_candidates(
    output_dir,
    armature,
    controls,
    ranked,
    base_hand,
    contact_delta,
    base_pole,
    pole_axis,
    pole_basis,
    vertices_by_candidate,
):
    scene = bpy.context.scene
    candidate_root = Path(output_dir) / STATIC_CANDIDATE_DIRECTORY
    candidate_root.mkdir(parents=True, exist_ok=True)
    combined_vertices = tuple(
        vertex
        for candidate, _record in ranked[:STATIC_RENDER_COUNT]
        for vertex in vertices_by_candidate[candidate.candidate_id]
    )
    camera, center, distance, ortho_scale, bbox_min, bbox_max = _full_body_camera(
        scene,
        combined_vertices,
    )
    scene.render.resolution_x = RENDER_RESOLUTION
    scene.render.resolution_y = RENDER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    view_directions = {
        "front": Vector((0.0, -1.0, 0.0)),
        "left": Vector((1.0, 0.0, 0.0)),
        "right": Vector((-1.0, 0.0, 0.0)),
        "back": Vector((0.0, 1.0, 0.0)),
    }
    rendered = []
    rendered_records = [record for _candidate, record in ranked[:STATIC_RENDER_COUNT]]
    assign_render_ranks(rendered_records)
    for candidate, record in ranked[:STATIC_RENDER_COUNT]:
        _apply_static_candidate(
            armature,
            controls,
            candidate,
            base_hand,
            contact_delta,
            base_pole,
            pole_axis,
            pole_basis,
        )
        rank = int(record["rank"])
        directory = candidate_root / f"candidate_{rank:03d}"
        directory.mkdir(parents=True, exist_ok=True)
        record["render_directory"] = str(Path(STATIC_CANDIDATE_DIRECTORY) / f"candidate_{rank:03d}")
        record["renders"] = {}
        for view, direction in view_directions.items():
            camera.location = center + direction * distance
            camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
            output = directory / f"{view}.png"
            scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            relative_output = Path(STATIC_CANDIDATE_DIRECTORY) / f"candidate_{rank:03d}" / f"{view}.png"
            record["renders"][view] = str(relative_output)
            rendered.append(str(relative_output))
    return {
        "camera_name": camera.name,
        "ortho_scale": float(ortho_scale),
        "center": tuple(float(value) for value in center),
        "bbox_min": tuple(float(value) for value in bbox_min),
        "bbox_max": tuple(float(value) for value in bbox_max),
        "resolution": (RENDER_RESOLUTION, RENDER_RESOLUTION),
        "view_semantics": {
            "front": "camera at -Y",
            "left": "character-left view, camera at +X",
            "right": "character-right view, camera at -X",
            "back": "camera at +Y",
        },
        "rendered_files": rendered,
    }


def _render_compensated_candidates(output_dir, armature, controls, ranked, context, vertices_by_candidate):
    scene = bpy.context.scene
    candidate_root = Path(output_dir) / STATIC_CANDIDATE_DIRECTORY
    candidate_root.mkdir(parents=True, exist_ok=True)
    combined_vertices = tuple(
        vertex
        for _state, record in ranked[:STATIC_RENDER_COUNT]
        for vertex in vertices_by_candidate[record["source_candidate_id"]]
    )
    camera, center, distance, ortho_scale, bbox_min, bbox_max = _full_body_camera(
        scene, combined_vertices
    )
    scene.render.resolution_x = RENDER_RESOLUTION
    scene.render.resolution_y = RENDER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    view_directions = {
        "front": Vector((0.0, -1.0, 0.0)),
        "left": Vector((1.0, 0.0, 0.0)),
        "right": Vector((-1.0, 0.0, 0.0)),
        "back": Vector((0.0, 1.0, 0.0)),
    }
    rendered = []
    rendered_records = [record for _state, record in ranked[:STATIC_RENDER_COUNT]]
    assign_render_ranks(rendered_records)
    for (candidate, compensation), record in ranked[:STATIC_RENDER_COUNT]:
        _apply_compensated_state(armature, controls, candidate, compensation, context)
        rank = int(record["rank"])
        directory = candidate_root / f"candidate_{rank:03d}"
        directory.mkdir(parents=True, exist_ok=True)
        record["render_directory"] = str(
            Path(STATIC_CANDIDATE_DIRECTORY) / f"candidate_{rank:03d}"
        )
        record["renders"] = {}
        for view, direction in view_directions.items():
            camera.location = center + direction * distance
            camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
            output = directory / f"{view}.png"
            scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            relative = Path(STATIC_CANDIDATE_DIRECTORY) / f"candidate_{rank:03d}" / f"{view}.png"
            record["renders"][view] = str(relative)
            rendered.append(str(relative))
    return {
        "camera_name": camera.name,
        "ortho_scale": float(ortho_scale),
        "center": tuple(float(value) for value in center),
        "bbox_min": tuple(float(value) for value in bbox_min),
        "bbox_max": tuple(float(value) for value in bbox_max),
        "resolution": (RENDER_RESOLUTION, RENDER_RESOLUTION),
        "view_semantics": {
            "front": "camera at -Y",
            "left": "character-left view, camera at +X",
            "right": "character-right view, camera at -X",
            "back": "camera at +Y",
        },
        "rendered_files": rendered,
    }


def _render_finger_candidates(output_dir, armature, controls, ranked, context, vertices_by_candidate):
    scene = bpy.context.scene
    candidate_root = Path(output_dir) / STATIC_CANDIDATE_DIRECTORY
    candidate_root.mkdir(parents=True, exist_ok=True)
    combined_vertices = tuple(
        vertex
        for _state, record in ranked[:STATIC_RENDER_COUNT]
        for vertex in vertices_by_candidate[record["source_candidate_id"]]
    )
    camera, center, distance, ortho_scale, bbox_min, bbox_max = _full_body_camera(
        scene, combined_vertices
    )
    scene.render.resolution_x = RENDER_RESOLUTION
    scene.render.resolution_y = RENDER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    view_directions = {
        "front": Vector((0, -1, 0)), "left": Vector((1, 0, 0)),
        "right": Vector((-1, 0, 0)), "back": Vector((0, 1, 0)),
    }
    rendered = []
    rendered_records = [record for _state, record in ranked[:STATIC_RENDER_COUNT]]
    assign_render_ranks(rendered_records)
    for (candidate, compensation, preset), record in ranked[:STATIC_RENDER_COUNT]:
        _apply_semantic_finger_state(
            armature, controls, candidate, compensation, preset, context
        )
        rank = int(record["rank"])
        directory = candidate_root / f"candidate_{rank:03d}"
        directory.mkdir(parents=True, exist_ok=True)
        record["render_directory"] = str(Path(STATIC_CANDIDATE_DIRECTORY) / f"candidate_{rank:03d}")
        record["renders"] = {}
        for view, direction in view_directions.items():
            camera.location = center + direction * distance
            camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
            output = directory / f"{view}.png"
            scene.render.filepath = str(output)
            bpy.ops.render.render(write_still=True)
            relative = Path(STATIC_CANDIDATE_DIRECTORY) / f"candidate_{rank:03d}" / f"{view}.png"
            record["renders"][view] = str(relative)
            rendered.append(str(relative))
    return {
        "camera_name": camera.name,
        "ortho_scale": float(ortho_scale),
        "center": tuple(float(value) for value in center),
        "bbox_min": tuple(float(value) for value in bbox_min),
        "bbox_max": tuple(float(value) for value in bbox_max),
        "resolution": (RENDER_RESOLUTION, RENDER_RESOLUTION),
        "view_semantics": {
            "front": "camera at -Y", "left": "character-left view, camera at +X",
            "right": "character-right view, camera at -X", "back": "camera at +Y",
        },
        "rendered_files": rendered,
    }


def _render_diagnostic_candidate(output_dir, armature, controls, candidate, context, vertices):
    scene = bpy.context.scene
    _apply_context_candidate(armature, controls, candidate, context)
    camera, center, distance, ortho_scale, bbox_min, bbox_max = _full_body_camera(scene, vertices)
    scene.render.resolution_x = RENDER_RESOLUTION
    scene.render.resolution_y = RENDER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    directory = Path(output_dir) / "diagnostics" / candidate.candidate_id
    directory.mkdir(parents=True, exist_ok=True)
    view_directions = {
        "front": Vector((0.0, -1.0, 0.0)),
        "left": Vector((1.0, 0.0, 0.0)),
        "right": Vector((-1.0, 0.0, 0.0)),
        "back": Vector((0.0, 1.0, 0.0)),
    }


def _render_collision_severity_diagnostic(
    output_dir,
    source_id,
    vertices,
    severity,
    *,
    output_directory=COLLISION_SEVERITY_DIRECTORY,
    overlay_severity=None,
):
    scene = bpy.context.scene
    camera, center, distance, ortho_scale, bbox_min, bbox_max = _full_body_camera(
        scene, vertices
    )
    scene.render.resolution_x = RENDER_RESOLUTION
    scene.render.resolution_y = RENDER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    relative_root = Path(output_directory) / source_id
    directory = Path(output_dir) / relative_root
    directory.mkdir(parents=True, exist_ok=True)
    view_directions = {
        "front": Vector((0.0, -1.0, 0.0)),
        "left": Vector((1.0, 0.0, 0.0)),
        "right": Vector((-1.0, 0.0, 0.0)),
        "back": Vector((0.0, 1.0, 0.0)),
    }
    renders = {}
    for view, direction in view_directions.items():
        camera.data.ortho_scale = ortho_scale
        camera.location = center + direction * distance
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        output = directory / f"{view}.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        renders[view] = str(relative_root / f"{view}.png")

    overlay = overlay_severity or severity
    bbox = severity["overlap_bbox"] or overlay["overlap_bbox"]
    close_center = Vector(bbox["center"] if bbox else center)
    close_scale = max(
        0.32,
        max(bbox["dimensions"]) * 3.0 if bbox else 0.52,
    )
    camera.data.ortho_scale = close_scale
    camera.location = close_center + Vector((0.0, -1.0, 0.0)) * 2.0
    camera.rotation_euler = (close_center - camera.location).to_track_quat("-Z", "Y").to_euler()
    normal_closeup = directory / "collision_closeup_normal.png"
    scene.render.filepath = str(normal_closeup)
    bpy.ops.render.render(write_still=True)
    renders["collision_closeup_normal"] = str(
        relative_root / "collision_closeup_normal.png"
    )

    marker_material = _gallery_emission_material(
        "POC_COLLISION_SEVERITY_MARKER_MAT", (1.0, 0.02, 0.01, 1.0)
    )
    marker_radius = max(
        0.003,
        float(overlay["median_local_mesh_edge_blender"]) * 0.45,
    )
    markers = []
    try:
        for index, point in enumerate(overlay["marker_points"][:12], start=1):
            bpy.ops.mesh.primitive_uv_sphere_add(
                segments=16,
                ring_count=8,
                radius=marker_radius,
                location=Vector(point) + Vector((0.0, -0.012, 0.0)),
            )
            marker = bpy.context.object
            marker.name = f"POC_COLLISION_MARKER_{source_id}_{index:02d}"
            marker.data.materials.append(marker_material)
            markers.append(marker)
        marked_closeup = directory / "collision_closeup_marked.png"
        scene.render.filepath = str(marked_closeup)
        bpy.ops.render.render(write_still=True)
        renders["collision_closeup_marked"] = str(
            relative_root / "collision_closeup_marked.png"
        )
    finally:
        for marker in markers:
            bpy.data.objects.remove(marker, do_unlink=True)
    return {
        "renders": renders,
        "marker_count": len(markers),
        "marker_radius_blender": marker_radius,
        "marker_overlay_offset": (0.0, -0.012, 0.0),
        "marker_source": (
            "baseline_collision_points" if overlay_severity is not None
            else "current_collision_points"
        ),
        "full_body_camera": {
            "ortho_scale": float(ortho_scale),
            "center": tuple(float(value) for value in center),
            "bbox_min": tuple(float(value) for value in bbox_min),
            "bbox_max": tuple(float(value) for value in bbox_max),
        },
        "closeup_camera": {
            "ortho_scale": float(close_scale),
            "center": tuple(float(value) for value in close_center),
            "view": "front camera at -Y",
        },
    }
    renders = {}
    for view, direction in view_directions.items():
        camera.location = center + direction * distance
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        output = directory / f"{view}.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        renders[view] = str(Path("diagnostics") / candidate.candidate_id / f"{view}.png")
    return {
        "renders": renders,
        "camera": {
            "ortho_scale": float(ortho_scale),
            "center": tuple(float(value) for value in center),
            "bbox_min": tuple(float(value) for value in bbox_min),
            "bbox_max": tuple(float(value) for value in bbox_max),
        },
        "collision_overlay": "not_requested_optional",
    }


def _render_semantic_diagnostic(
    output_dir, armature, mesh, controls, candidate, compensation, preset, context
):
    scene = bpy.context.scene
    _apply_semantic_finger_state(
        armature, controls, candidate, compensation, preset, context
    )
    vertices = _evaluated_world_vertices(mesh)
    camera, center, distance, ortho_scale, bbox_min, bbox_max = _full_body_camera(
        scene, vertices
    )
    scene.render.resolution_x = RENDER_RESOLUTION
    scene.render.resolution_y = RENDER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    directory = Path(output_dir) / "diagnostics" / candidate.candidate_id
    directory.mkdir(parents=True, exist_ok=True)
    view_directions = {
        "front": Vector((0, -1, 0)), "left": Vector((1, 0, 0)),
        "right": Vector((-1, 0, 0)), "back": Vector((0, 1, 0)),
    }
    renders = {}
    for view, direction in view_directions.items():
        camera.data.ortho_scale = ortho_scale
        camera.location = center + direction * distance
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        output = directory / f"{view}.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        renders[view] = str(Path("diagnostics") / candidate.candidate_id / f"{view}.png")
    fingertips = _finger_tip_positions(armature)
    close_center = (
        Vector(fingertips["index"])
        + Vector(fingertips["thumb"])
        + Vector(_calibrated_chin_points(armature)[2])
    ) / 3.0
    camera.data.ortho_scale = 0.52
    camera.location = close_center + Vector((0, -1, 0)) * 2.0
    camera.rotation_euler = (close_center - camera.location).to_track_quat("-Z", "Y").to_euler()
    close_output = directory / "upper_body_hand.png"
    scene.render.filepath = str(close_output)
    bpy.ops.render.render(write_still=True)
    renders["upper_body_hand"] = str(
        Path("diagnostics") / candidate.candidate_id / "upper_body_hand.png"
    )
    return {
        "renders": renders,
        "full_body_ortho_scale": float(ortho_scale),
        "closeup_ortho_scale": 0.52,
        "full_body_center": tuple(float(value) for value in center),
        "closeup_center": tuple(float(value) for value in close_center),
        "bbox_min": tuple(float(value) for value in bbox_min),
        "bbox_max": tuple(float(value) for value in bbox_max),
    }


def _candidate_from_record(record) -> StaticCandidate:
    parameters = record["parameters"]
    return StaticCandidate(
        candidate_id=record["source_candidate_id"],
        alignment_factor=float(parameters["alignment_factor"]),
        hand_offset=tuple(float(value) for value in parameters["hand_offset"]),
        palm_euler_deg=tuple(float(value) for value in parameters["palm_euler_deg"]),
        pole_offset=float(parameters["pole_offset"]),
        twist_influences=tuple(float(value) for value in parameters["twist_influences"]),
        pole_offset_3d=tuple(float(value) for value in parameters.get("pole_offset_3d", (0.0, 0.0, 0.0))),
        search_family=str(parameters.get("search_family", "legacy_scalar")),
    )


def _finger_refined_candidate(candidate, palm_delta, source_id):
    return StaticCandidate(
        candidate_id=source_id,
        alignment_factor=candidate.alignment_factor,
        hand_offset=candidate.hand_offset,
        palm_euler_deg=tuple(
            float(value) + float(delta)
            for value, delta in zip(candidate.palm_euler_deg, palm_delta, strict=True)
        ),
        pole_offset=candidate.pole_offset,
        twist_influences=candidate.twist_influences,
        pole_offset_3d=candidate.pole_offset_3d,
        search_family="semantic_finger",
    )


def _finger_source_id(arm_source_id, palm_index, preset_index, compensation_index):
    return (
        f"{arm_source_id}__finger_p{palm_index:02d}_"
        f"s{preset_index:02d}_c{compensation_index:02d}"
    )


def _finger_rank_key(item):
    _state, record = item
    metrics = record["metrics"]
    return (
        int(metrics.get("thumb_index_contact_patch_count", 0)) <= 0,
        float(metrics.get("surface_contact_distance", math.inf)),
        float(record.get("score", math.inf)),
        record["source_candidate_id"],
    )


def finger_stage_survivors(records, *, seed_ids, limit: int):
    if limit <= 0:
        return []
    strata = {}
    for item in records:
        _state, record = item
        if not record.get("finger_stage_anatomy_valid", False):
            continue
        source_id = record["arm_source_candidate_id"]
        if source_id not in seed_ids:
            continue
        palm = tuple(record.get("parameters", {}).get("palm_refinement_deg", ()))
        strata.setdefault((source_id, palm), []).append(item)
    for items in strata.values():
        items.sort(key=_finger_rank_key)
    stratum_keys = sorted(
        strata,
        key=lambda key: (seed_ids.index(key[0]), key[1]),
    )
    survivors = []
    depth = 0
    while len(survivors) < limit:
        advanced = False
        for stratum_key in stratum_keys:
            items = strata[stratum_key]
            if depth >= len(items):
                continue
            survivors.append(items[depth])
            advanced = True
            if len(survivors) == limit:
                break
        if not advanced:
            break
        depth += 1
    return survivors


def semantic_diagnostic_candidate(records, *, preferred_source_id: str | None = None):
    if not records:
        raise ValueError("Semantic diagnostic requires at least one candidate")
    if preferred_source_id is not None:
        preferred = next(
            (
                item for item in records
                if item[1]["source_candidate_id"] == preferred_source_id
            ),
            None,
        )
        if preferred is not None:
            return preferred
    return min(records, key=_finger_rank_key)


def _compensation_from_record(record) -> UpperBodyCompensation:
    parameters = record["parameters"]["compensation"]
    return UpperBodyCompensation(
        upper_chest_turn_deg=float(parameters["upper_chest_turn_deg"]),
        upper_chest_lean_deg=float(parameters["upper_chest_lean_deg"]),
        shoulder_retract_deg=float(parameters["shoulder_retract_deg"]),
        shoulder_elevate_deg=float(parameters["shoulder_elevate_deg"]),
        neck_toward_deg=float(parameters["neck_toward_deg"]),
        head_toward_deg=float(parameters["head_toward_deg"]),
    )


def _finger_preset_from_record(record) -> FingerPosePreset:
    parameters = record["parameters"]
    return FingerPosePreset(
        name=str(parameters["finger_preset"]),
        joint_targets_deg={
            name: tuple(float(value) for value in delta)
            for name, delta in parameters["finger_joint_targets_deg"].items()
        },
    )


def _prepare_static_context(
    armature, mesh, controls, geometry, math_module,
    compensation_controls=None, finger_controls=None,
):
    scene = bpy.context.scene
    scene.frame_set(VALIDATION_FRAME)
    _reset_static_controls_to_v16(armature, controls)
    if compensation_controls is not None:
        _set_compensation_identity(compensation_controls)
    if finger_controls is not None:
        _set_finger_identity(finger_controls)
    baseline_state = _capture_static_control_state(
        armature, controls, compensation_controls, finger_controls
    )
    previous = _capture_pose_state(armature, VALIDATION_FRAME - 1)
    scene.frame_set(VALIDATION_FRAME)
    bpy.context.view_layer.update()
    chin_rest, chin_local, chin_world = _calibrated_chin_points(armature)
    controls["chin"].location = chin_world
    baseline_vertices = _evaluated_world_vertices(mesh)
    chin_surface = _build_chin_surface(mesh, geometry, baseline_vertices, chin_world, math_module)
    contact_indices = geometry["thumb_vertices"] | geometry["index_vertices"] | geometry["side_palm_vertices"]
    contact_anchor = min(
        (baseline_vertices[index] for index in contact_indices),
        key=lambda point: (point - chin_surface["calibrated_nearest_world"]).length,
    )
    target_contact = (
        chin_surface["calibrated_nearest_world"]
        + chin_surface["calibrated_nearest_normal"] * chin_surface["band"].target_distance
    )
    base_hand = controls["hand"].location.copy()
    base_pole = controls["pole"].location.copy()
    shoulder = _pose_head_world(armature, PROXY_BONE_NAMES[0])
    wrist = _pose_head_world(armature, PROXY_BONE_NAMES[2])
    pole_axis = armature.matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))
    pole_axis.normalize()
    pole_basis = pole_search_basis(shoulder, wrist, base_pole)
    protected_channels = {
        bone_name: tuple(
            float(value) for row in armature.pose.bones[bone_name].matrix_basis for value in row
        )
        for bone_name in PROTECTED_LOCAL_BONES
    }
    compensation_axes = (
        _derive_compensation_axes(armature, target_contact)
        if compensation_controls is not None
        else None
    )
    finger_baseline_local_quaternions = (
        {
            bone_name: tuple(
                float(value)
                for value in armature.pose.bones[bone_name].matrix_basis.to_quaternion().normalized()
            )
            for bone_name in RIGHT_FINGER_BONES
        }
        if finger_controls is not None else None
    )
    return {
        "armature": armature,
        "baseline_state": baseline_state,
        "previous": previous,
        "chin_rest": chin_rest,
        "chin_local": chin_local,
        "chin_world": chin_world,
        "baseline_vertices": baseline_vertices,
        "chin_surface": chin_surface,
        "contact_anchor": contact_anchor,
        "target_contact": target_contact,
        "base_hand": base_hand,
        "contact_delta": target_contact - contact_anchor,
        "base_pole": base_pole,
        "pole_axis": pole_axis,
        "pole_basis": pole_basis,
        "invariant_collision": _invariant_collision_context(baseline_vertices, geometry),
        "compensation_controls": compensation_controls,
        "finger_controls": finger_controls,
        "finger_baseline_local_quaternions": finger_baseline_local_quaternions,
        "compensation_axes": compensation_axes,
        "protected_pose_hashes": protected_pose_hashes(protected_channels),
    }


def _apply_context_candidate(armature, controls, candidate, context):
    _apply_static_candidate(
        armature, controls, candidate,
        context["base_hand"], context["contact_delta"], context["base_pole"], context["pole_axis"],
        context["pole_basis"],
    )


def _toward_target_local_axis(armature, bone_name: str, target_world):
    origin = _pose_head_world(armature, bone_name)
    target_direction = target_world - origin
    if target_direction.length_squared <= 1e-12:
        return Vector((1.0, 0.0, 0.0))
    target_direction.normalize()
    forward_world = armature.matrix_world.to_3x3() @ Vector((0.0, -1.0, 0.0))
    forward_world.normalize()
    axis_world = forward_world.cross(target_direction)
    if axis_world.length_squared <= 1e-12:
        axis_world = armature.matrix_world.to_3x3() @ Vector((1.0, 0.0, 0.0))
    axis_world.normalize()
    bone_world_rotation = _world_rotation(armature, bone_name)
    local_axis = bone_world_rotation.inverted() @ axis_world
    local_axis.normalize()
    return local_axis


def _rest_world_direction_to_local_axis(armature, bone_name: str, world_direction):
    rest_rotation = (
        armature.matrix_world.to_3x3()
        @ armature.data.bones[bone_name].matrix_local.to_3x3()
    ).normalized()
    local_axis = rest_rotation.inverted() @ Vector(world_direction).normalized()
    local_axis.normalize()
    return local_axis


def _derive_compensation_axes(armature, target_world):
    model_rotation = armature.matrix_world.to_3x3().normalized()
    model_right = model_rotation @ Vector((1.0, 0.0, 0.0))
    model_forward = model_rotation @ Vector((0.0, -1.0, 0.0))
    model_up = model_rotation @ Vector((0.0, 0.0, 1.0))
    return {
        "upper_chest_turn": _rest_world_direction_to_local_axis(
            armature, "上半身2", model_up
        ),
        "upper_chest_lean": _rest_world_direction_to_local_axis(
            armature, "上半身2", model_right
        ),
        "shoulder_retract": _rest_world_direction_to_local_axis(
            armature, "右肩", model_up
        ),
        "shoulder_elevate": _rest_world_direction_to_local_axis(
            armature, "右肩", model_forward
        ),
        "neck_toward": _toward_target_local_axis(armature, "首", target_world),
        "head_toward": _toward_target_local_axis(armature, "頭", target_world),
    }


def _axis_angle_quaternion(axis, angle_degrees: float):
    if abs(angle_degrees) <= 1e-12:
        return Quaternion((1.0, 0.0, 0.0, 0.0))
    return Quaternion(Vector(axis).normalized(), math.radians(angle_degrees))


def _apply_upper_body_compensation(armature, context, compensation):
    controls = context["compensation_controls"]
    axes = context["compensation_axes"]
    quaternions = {
        "upper_chest": (
            _axis_angle_quaternion(axes["upper_chest_turn"], compensation.upper_chest_turn_deg)
            @ _axis_angle_quaternion(axes["upper_chest_lean"], compensation.upper_chest_lean_deg)
        ).normalized(),
        "right_shoulder": (
            _axis_angle_quaternion(axes["shoulder_retract"], compensation.shoulder_retract_deg)
            @ _axis_angle_quaternion(axes["shoulder_elevate"], compensation.shoulder_elevate_deg)
        ).normalized(),
        "neck": _axis_angle_quaternion(axes["neck_toward"], compensation.neck_toward_deg).normalized(),
        "head": _axis_angle_quaternion(axes["head_toward"], compensation.head_toward_deg).normalized(),
    }
    for key, quaternion in quaternions.items():
        controls[key].rotation_mode = "QUATERNION"
        controls[key].rotation_quaternion = quaternion
    armature.update_tag()
    _refresh_frame()
    angles = {
        key: quaternion_angle_degrees(tuple(float(value) for value in quaternion))
        for key, quaternion in quaternions.items()
    }
    return quaternions, angles


def _apply_finger_preset(armature, context, preset):
    reasons = validate_absolute_finger_targets(preset.joint_targets_deg)
    if reasons:
        raise ValueError("Invalid semantic finger preset: " + "; ".join(reasons))
    controls = context["finger_controls"]
    control_quaternions = {}
    target_quaternions = {}
    corrective_angles = {}
    for bone_name in RIGHT_FINGER_BONES:
        target_degrees = preset.joint_targets_deg[bone_name]
        target_quaternion = Euler(
            tuple(math.radians(float(value)) for value in target_degrees), "XYZ"
        ).to_quaternion().normalized()
        target_tuple = tuple(float(value) for value in target_quaternion)
        baseline_tuple = context["finger_baseline_local_quaternions"][bone_name]
        control_tuple = absolute_local_control_delta(target_tuple, baseline_tuple)
        control_quaternion = Quaternion(control_tuple)
        controls[bone_name].rotation_mode = "QUATERNION"
        controls[bone_name].rotation_quaternion = control_quaternion
        control_quaternions[bone_name] = control_tuple
        target_quaternions[bone_name] = target_tuple
        corrective_angles[bone_name] = quaternion_angle_degrees(control_tuple)
    armature.update_tag()
    _refresh_frame()
    final_errors = {
        bone_name: quaternion_distance_degrees(
            tuple(float(value) for value in _evaluated_local_rotation(armature, bone_name).normalized()),
            target_quaternions[bone_name],
        )
        for bone_name in RIGHT_FINGER_BONES
    }
    if any(error > 1e-3 for error in final_errors.values()):
        raise RuntimeError(
            f"Absolute finger targets did not reproduce through local BEFORE constraints: {final_errors}"
        )
    return control_quaternions, {
        "corrective_angles_deg": corrective_angles,
        "target_quaternions": target_quaternions,
        "target_euler_deg": preset.joint_targets_deg,
        "final_target_errors_deg": final_errors,
    }


def _finger_tip_positions(armature):
    names = {
        "thumb": "右親指２",
        "index": "右人指３",
        "middle": "右中指３",
        "ring": "右薬指３",
        "little": "右小指３",
    }
    return {
        name: tuple(
            float(value)
            for value in (
                armature.matrix_world @ armature.pose.bones[bone_name].tail
            )
        )
        for name, bone_name in names.items()
    }


def _apply_semantic_finger_state(
    armature, controls, candidate, compensation, preset, context
):
    _set_compensation_identity(context["compensation_controls"])
    _set_finger_identity(context["finger_controls"])
    _apply_context_candidate(armature, controls, candidate, context)
    compensation_quaternions, compensation_angles = _apply_upper_body_compensation(
        armature, context, compensation
    )
    finger_quaternions, finger_solution = _apply_finger_preset(
        armature, context, preset
    )
    return (
        compensation_quaternions,
        compensation_angles,
        finger_quaternions,
        finger_solution,
    )


def _current_protected_pose_hashes(armature):
    channels = {
        bone_name: tuple(
            float(value) for row in armature.pose.bones[bone_name].matrix_basis for value in row
        )
        for bone_name in PROTECTED_LOCAL_BONES
    }
    return protected_pose_hashes(channels)


def _compensation_parameter_record(compensation, quaternions, angles, context):
    return {
        "upper_chest_turn_deg": compensation.upper_chest_turn_deg,
        "upper_chest_lean_deg": compensation.upper_chest_lean_deg,
        "shoulder_retract_deg": compensation.shoulder_retract_deg,
        "shoulder_elevate_deg": compensation.shoulder_elevate_deg,
        "neck_toward_deg": compensation.neck_toward_deg,
        "head_toward_deg": compensation.head_toward_deg,
        "quaternions": {
            key: tuple(float(value) for value in quaternion)
            for key, quaternion in quaternions.items()
        },
        "quaternion_angles_deg": angles,
        "local_axes": {
            key: tuple(float(value) for value in axis)
            for key, axis in context["compensation_axes"].items()
        },
    }


def _apply_compensated_state(armature, controls, candidate, compensation, context):
    _set_compensation_identity(context["compensation_controls"])
    _apply_context_candidate(armature, controls, candidate, context)
    return _apply_upper_body_compensation(armature, context, compensation)


def _stage_d_record(
    math_module,
    arm_candidate,
    arm_record,
    compensation,
    compensation_index,
    quaternions,
    angles,
    measurements,
    surface_metrics,
    context,
):
    record = _stage_a_record(math_module, arm_candidate, measurements)
    record["source_candidate_id"] = compensated_source_id(
        arm_candidate.candidate_id, compensation_index
    )
    record["arm_source_candidate_id"] = arm_candidate.candidate_id
    record["parameters"]["compensation"] = _compensation_parameter_record(
        compensation, quaternions, angles, context
    )
    limit_reasons = validate_compensation_angles(angles)
    protected_current = _current_protected_pose_hashes(context["armature"])
    protected_reasons = compare_protected_pose_hashes(
        context["protected_pose_hashes"], protected_current
    )
    record["metrics"].update({
        "compensation_angles_deg": angles,
        "protected_pose_hashes": protected_current,
        "protected_pose_unchanged": not protected_reasons,
        "collision_before_compensation": {
            key: arm_record["metrics"].get(key)
            for key in (
                "head_collision_count",
                "torso_penetration_count",
                "torso_collision_attribution",
                "minimum_clearance",
                "surface_contact_distance",
                "contact_patch_count",
                "elbow_angle_deg",
            )
        },
    })
    if limit_reasons or protected_reasons:
        record["valid"] = False
        record["reasons"] = list(dict.fromkeys([
            *record["reasons"], *limit_reasons, *protected_reasons,
        ]))
    _stage_b_update(math_module, record, surface_metrics, context["chin_surface"]["band"])
    record["stage"] = "D"
    return record


def _stage_e_update(math_module, record, collision_metrics):
    _stage_c_update(math_module, record, collision_metrics)
    record["stage"] = "E"
    record["metrics"]["collision_after_compensation"] = {
        key: collision_metrics.get(key)
        for key in (
            "head_collision_count",
            "torso_penetration_count",
            "torso_collision_attribution",
            "minimum_clearance",
        )
    }


def _stage_f_record(
    math_module,
    candidate,
    arm_source_id,
    palm_refinement,
    preset,
    compensation,
    compensation_quaternions,
    compensation_angles,
    finger_quaternions,
    finger_solution,
    measurements,
    surface_metrics,
    seed_collision,
    context,
):
    record = _stage_a_record(math_module, candidate, measurements)
    record["arm_source_candidate_id"] = arm_source_id
    record["parameters"].update({
        "palm_refinement_deg": palm_refinement,
        "finger_preset": preset.name,
        "finger_joint_targets_deg": preset.joint_targets_deg,
        "finger_quaternions": finger_quaternions,
        "compensation": _compensation_parameter_record(
            compensation, compensation_quaternions, compensation_angles, context
        ),
    })
    protected_current = _current_protected_pose_hashes(context["armature"])
    protected_reasons = compare_protected_pose_hashes(
        context["protected_pose_hashes"], protected_current
    )
    record["metrics"].update({
        "finger_preset": preset.name,
        "finger_joint_targets_deg": preset.joint_targets_deg,
        "finger_absolute_solution": finger_solution,
        "fingertip_world": _finger_tip_positions(context["armature"]),
        "compensation_angles_deg": compensation_angles,
        "protected_pose_hashes": protected_current,
        "protected_pose_unchanged": not protected_reasons,
        "collision_before_finger_solve": seed_collision,
    })
    if protected_reasons:
        record["valid"] = False
        record["reasons"] = list(dict.fromkeys([*record["reasons"], *protected_reasons]))
    record["finger_stage_anatomy_valid"] = bool(record["valid"])
    _stage_b_update(math_module, record, surface_metrics, context["chin_surface"]["band"])
    record["stage"] = "F"
    return record


def _stage_g_update(math_module, record, collision_metrics, warning_distance):
    _stage_c_update(math_module, record, collision_metrics)
    record["stage"] = "G"
    record["finger_stage_collision_valid"] = bool(
        record.get("finger_stage_anatomy_valid", False)
        and record["metrics"]["matrices_finite"]
        and record["metrics"]["head_collision_count"] == 0
        and record["metrics"]["torso_penetration_count"] == 0
    )
    record["metrics"]["finger_contact_improves_evidence"] = (
        finger_contact_improves_evidence(
            record["metrics"]["collision_before_finger_solve"],
            record["metrics"],
            warning_distance=warning_distance,
        )
    )


def _stage_b_update(math_module, record, surface_metrics, band):
    verdict, contact_reasons = math_module.classify_surface_contact(
        surface_metrics["surface_contact_distance"],
        surface_metrics["surface_intersection_count"],
        band,
    )
    record["stage"] = "B"
    record["metrics"].update(surface_metrics)
    record["metrics"]["contact_band"] = {
        "mesh_resolution": band.mesh_resolution,
        "target_distance": band.target_distance,
        "warning_distance": band.warning_distance,
        "hard_max_distance": band.hard_max_distance,
        "region_radius": band.region_radius,
        "derivation": "median lower-chin triangle edge length with 1.5x/2x/3x/12x multipliers",
    }
    record["reasons"] = list(dict.fromkeys([*record["reasons"], *contact_reasons]))
    record["valid"] = bool(record["valid"] and verdict != "FAIL")
    contact_penalty = (
        abs(surface_metrics["surface_contact_distance"] - band.target_distance)
        / max(band.mesh_resolution, 1e-9)
    ) ** 2
    record["component_penalties"]["surface_contact"] = contact_penalty
    record["score"] += contact_penalty * 5.0
    record["verdict"] = "FAIL" if not record["valid"] else ("WARN" if record["reasons"] else "PASS")


def _stage_c_update(math_module, record, collision_metrics):
    record["stage"] = "C"
    record["metrics"].update(collision_metrics)
    metrics = record["metrics"]
    score = math_module.score_static_candidate(
        elbow_angle_deg=metrics["elbow_angle_deg"],
        signed_elbow_flex_deg=metrics["signed_elbow_flex_deg"],
        pole_side=metrics["pole_side"],
        wrist_swing_deg=metrics["wrist_swing_deg"],
        wrist_twist_deg=metrics["wrist_twist_deg"],
        forearm_twist_deg=metrics["forearm_twist_deg"],
        contact_error=metrics["surface_contact_distance"],
        head_penetration_depth=metrics["head_penetration_depth"],
        head_collision_count=metrics["head_collision_count"],
        torso_penetration_count=metrics["torso_penetration_count"],
        minimum_clearance=metrics["minimum_clearance"],
        continuity_distance=metrics["continuity_distance"],
        matrices_finite=metrics["matrices_finite"],
    )
    contact_reasons = tuple(record["reasons"])
    record["reasons"] = list(dict.fromkeys([*contact_reasons, *score.reasons]))
    record["valid"] = bool(record["valid"] and score.valid)
    record["component_penalties"].update(score.component_penalties)
    record["score"] = float(score.total_score + record["component_penalties"].get("surface_contact", 0.0) * 5.0)
    record["verdict"] = "FAIL" if not record["valid"] else ("WARN" if record["reasons"] else "PASS")
    selection_reasons = static_selection_eligibility(
        metrics, metrics["contact_band"]["warning_distance"]
    )
    record["selection_eligible"] = bool(record["valid"] and not selection_reasons)
    record["selection_reasons"] = list(selection_reasons)


def _orientation_gallery_baseline(source_candidate):
    compensation = UpperBodyCompensation(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    preset = FingerPosePreset(
        name="semi_closed_base",
        joint_targets_deg=semi_closed_finger_targets()["base"],
    )
    return source_candidate, compensation, preset


def _gallery_candidate(base_candidate, variant):
    return StaticCandidate(
        candidate_id=variant.source_id,
        alignment_factor=base_candidate.alignment_factor,
        hand_offset=base_candidate.hand_offset,
        palm_euler_deg=base_candidate.palm_euler_deg,
        pole_offset=base_candidate.pole_offset,
        twist_influences=variant.twist_distribution,
        pole_offset_3d=base_candidate.pole_offset_3d,
        search_family="orientation_gallery",
    )


def _apply_orientation_gallery_variant(
    armature, controls, base_candidate, compensation, variant, context
):
    candidate = _gallery_candidate(base_candidate, variant)
    preset = FingerPosePreset(
        name=f"orientation_gallery_{variant.source_id}",
        joint_targets_deg=variant.finger_targets_deg,
    )
    compensation_quaternions, compensation_angles, finger_quaternions, finger_solution = (
        _apply_semantic_finger_state(
            armature, controls, candidate, compensation, preset, context
        )
    )
    palm = controls["palm"]
    base_quaternion = palm.rotation_euler.to_quaternion().normalized()
    wrist_influence = float(variant.twist_distribution[2])
    swing_control_degrees = palm_control_nonaxial_degrees(
        variant.palm_swing_deg, wrist_influence
    )
    tilt_control_degrees = palm_control_nonaxial_degrees(
        variant.palm_tilt_deg, wrist_influence
    )
    swing_quaternion = Quaternion(
        Vector((1.0, 0.0, 0.0)), math.radians(swing_control_degrees)
    )
    axial_quaternion = Quaternion(
        Vector((0.0, 1.0, 0.0)), math.radians(variant.axial_angle_deg)
    )
    tilt_quaternion = Quaternion(
        Vector((0.0, 0.0, 1.0)), math.radians(tilt_control_degrees)
    )
    palm.rotation_mode = "QUATERNION"
    palm.rotation_quaternion = (
        base_quaternion @ swing_quaternion @ axial_quaternion @ tilt_quaternion
    ).normalized()
    armature.update_tag()
    _refresh_frame()
    return {
        "candidate": candidate,
        "preset": preset,
        "compensation_quaternions": compensation_quaternions,
        "compensation_angles_deg": compensation_angles,
        "finger_quaternions": finger_quaternions,
        "finger_solution": finger_solution,
        "palm_base_quaternion": tuple(float(value) for value in base_quaternion),
        "palm_axial_quaternion": tuple(float(value) for value in axial_quaternion),
        "palm_swing_quaternion": tuple(float(value) for value in swing_quaternion),
        "palm_tilt_quaternion": tuple(float(value) for value in tilt_quaternion),
        "palm_final_quaternion": tuple(float(value) for value in palm.rotation_quaternion),
        "palm_swing_control_deg": swing_control_degrees,
        "palm_tilt_control_deg": tilt_control_degrees,
    }


def _orientation_gallery_record(metrics, source_id: str):
    for record in metrics.get("variant_table", ()):
        if record.get("source_id") == source_id:
            return record
    raise ValueError(f"Orientation gallery metrics do not contain {source_id}")


def _g14_refined_state(base_candidate, base_variant, refinement, index):
    source_id = f"g14_refine_{index:03d}"
    candidate = StaticCandidate(
        candidate_id=source_id,
        alignment_factor=base_candidate.alignment_factor,
        hand_offset=tuple(
            float(base) + float(delta)
            for base, delta in zip(
                base_candidate.hand_offset, refinement.hand_target_offset, strict=True
            )
        ),
        palm_euler_deg=base_candidate.palm_euler_deg,
        pole_offset=base_candidate.pole_offset,
        twist_influences=base_variant.twist_distribution,
        pole_offset_3d=base_candidate.pole_offset_3d,
        search_family="g14_chin_support",
    )
    targets = dict(base_variant.finger_targets_deg)
    for bone_name, scale in (("右親指０", 1.0), ("右親指１", 0.75), ("右親指２", 0.5)):
        targets[bone_name] = tuple(
            float(base) + float(delta) * scale
            for base, delta in zip(
                targets[bone_name], refinement.thumb_refinement_deg, strict=True
            )
        )
    swing_delta, axial_delta, tilt_delta = refinement.palm_refinement_deg
    variant = OrientationGalleryVariant(
        source_id=source_id,
        family="g14_chin_support",
        label=(
            f"{source_id} hand {refinement.hand_target_offset}\n"
            f"head {refinement.neck_toward_deg:+.1f}/{refinement.head_toward_deg:+.1f}"
        ),
        axial_angle_deg=base_variant.axial_angle_deg + axial_delta,
        palm_swing_deg=base_variant.palm_swing_deg + swing_delta,
        palm_tilt_deg=base_variant.palm_tilt_deg + tilt_delta,
        twist_distribution=base_variant.twist_distribution,
        thumb_variant="thumb_opposed_refined",
        index_variant=base_variant.index_variant,
        comparison_group="g14_chin_support",
        comparison_dimension="support",
        finger_targets_deg=targets,
    )
    compensation = UpperBodyCompensation(
        refinement.upper_chest_turn_deg,
        refinement.upper_chest_lean_deg,
        refinement.shoulder_retract_deg,
        refinement.shoulder_elevate_deg,
        refinement.neck_toward_deg,
        refinement.head_toward_deg,
    )
    return candidate, variant, compensation


def _apply_g14_refinement(
    armature, controls, base_candidate, base_variant, refinement, index, context
):
    candidate, variant, compensation = _g14_refined_state(
        base_candidate, base_variant, refinement, index
    )
    applied = _apply_orientation_gallery_variant(
        armature, controls, candidate, compensation, variant, context
    )
    return candidate, variant, compensation, applied


def _tip_surface_evidence(armature, chin_surface):
    fingertips = _finger_tip_positions(armature)
    evidence = {}
    for source in ("thumb", "index"):
        point = Vector(fingertips[source])
        nearest = chin_surface["tree"].find_nearest(point)
        if nearest is None:
            raise RuntimeError(f"Unable to measure evaluated {source} tip against chin surface")
        location, normal, triangle_index, distance = nearest
        evidence[source] = {
            "tip_world": tuple(float(value) for value in point),
            "chin_surface_world": tuple(float(value) for value in location),
            "distance": float(distance),
            "signed_distance": float((point - location).dot(normal)),
            "triangle_index": int(triangle_index),
        }
    return evidence


def _evaluated_finger_quaternions(armature):
    return {
        bone_name: tuple(
            float(value)
            for value in _evaluated_local_rotation(armature, bone_name).normalized()
        )
        for bone_name in RIGHT_FINGER_BONES
    }


def _orientation_gallery_pose_hash(palm_quaternion, finger_quaternions, fingertips):
    payload = {
        "palm": [round(float(value), 9) for value in palm_quaternion],
        "fingers": {
            bone_name: [round(float(value), 9) for value in finger_quaternions[bone_name]]
            for bone_name in RIGHT_FINGER_BONES
        },
        "tips": {
            source: [round(float(value), 9) for value in fingertips[source]]
            for source in ("thumb", "index")
        },
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _gallery_emission_material(name, color):
    material = bpy.data.materials.get(name)
    if material is None:
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = color
        emission.inputs["Strength"].default_value = 1.0
        material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def _ensure_gallery_label(camera):
    collection = bpy.data.collections.get(CONTROL_COLLECTION_NAME)
    labels = []
    for suffix, color, offset in (
        ("OUTLINE", (0.0, 0.0, 0.0, 1.0), 0.006),
        ("TEXT", (1.0, 0.82, 0.12, 1.0), 0.0),
    ):
        name = f"POC_ORIENTATION_GALLERY_{suffix}"
        text_object = bpy.data.objects.get(name)
        if text_object is None:
            curve = bpy.data.curves.new(name, type="FONT")
            text_object = bpy.data.objects.new(name, curve)
            collection.objects.link(text_object)
            curve.align_x = "LEFT"
            curve.align_y = "TOP"
            curve.extrude = 0.0
            curve.offset = offset
            curve.materials.append(_gallery_emission_material(f"{name}_MAT", color))
        text_object.parent = camera
        text_object.matrix_parent_inverse = Matrix.Identity(4)
        text_object.rotation_euler = (0.0, 0.0, 0.0)
        labels.append(text_object)
    return tuple(labels)


def _set_gallery_label(labels, text, ortho_scale, visible):
    for label in labels:
        label.data.body = text
        label.data.size = ortho_scale * 0.034
        label.location = (-ortho_scale * 0.47, ortho_scale * 0.47, -0.4)
        label.hide_render = not visible


def _write_orientation_contact_sheet(closeups, output_path):
    tile = ORIENTATION_GALLERY_CONTACT_SHEET_TILE
    columns = ORIENTATION_GALLERY_CONTACT_SHEET_COLUMNS
    rows = math.ceil(len(closeups) / columns)
    width = columns * tile
    height = rows * tile
    canvas = array("f", (0.055, 0.055, 0.055, 1.0)) * (width * height)
    loaded = []
    try:
        for index, closeup in enumerate(closeups):
            image = bpy.data.images.load(str(closeup), check_existing=False)
            loaded.append(image)
            image.scale(tile, tile)
            pixels = array("f", image.pixels[:])
            column = index % columns
            row_from_top = index // columns
            target_row = rows - row_from_top - 1
            for source_y in range(tile):
                source_start = source_y * tile * 4
                destination_start = (
                    (target_row * tile + source_y) * width + column * tile
                ) * 4
                canvas[destination_start:destination_start + tile * 4] = (
                    pixels[source_start:source_start + tile * 4]
                )
        sheet = bpy.data.images.new(
            "POC_ORIENTATION_GALLERY_CONTACT_SHEET",
            width=width,
            height=height,
            alpha=True,
        )
        sheet.pixels.foreach_set(canvas)
        sheet.filepath_raw = str(output_path)
        sheet.file_format = "PNG"
        sheet.save()
        bpy.data.images.remove(sheet)
    finally:
        for image in loaded:
            bpy.data.images.remove(image)


def _render_orientation_gallery(output_dir, armature, mesh, controls, states, context):
    scene = bpy.context.scene
    gallery_root = Path(output_dir) / ORIENTATION_GALLERY_DIRECTORY
    variant_root = gallery_root / "variants"
    variant_root.mkdir(parents=True, exist_ok=True)
    combined_vertices = tuple(
        vertex for _variant, _record, vertices in states for vertex in vertices
    )
    camera, full_center, distance, full_scale, bbox_min, bbox_max = _full_body_camera(
        scene, combined_vertices
    )
    labels = _ensure_gallery_label(camera)
    scene.render.resolution_x = RENDER_RESOLUTION
    scene.render.resolution_y = RENDER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    mapping = orientation_gallery_render_mapping([variant for variant, _record, _vertices in states])
    closeups = []
    for item, (variant, record, _vertices) in zip(mapping, states, strict=True):
        _apply_orientation_gallery_variant(
            armature,
            controls,
            context["orientation_gallery_base_candidate"],
            context["orientation_gallery_compensation"],
            variant,
            context,
        )
        directory = Path(output_dir) / Path(item["closeup"]).parent
        directory.mkdir(parents=True, exist_ok=True)
        record["gallery_index"] = item["gallery_index"]
        record["renders"] = {
            key: item[key] for key in ("closeup", "front", "right", "left")
        }
        fingertips = _finger_tip_positions(armature)
        close_center = (
            Vector(fingertips["index"])
            + Vector(fingertips["thumb"])
            + Vector(_calibrated_chin_points(armature)[2])
        ) / 3.0
        camera.data.ortho_scale = ORIENTATION_GALLERY_CLOSEUP_SCALE
        camera.location = close_center + Vector((0.0, -1.0, 0.0)) * 2.0
        camera.rotation_euler = (close_center - camera.location).to_track_quat("-Z", "Y").to_euler()
        _set_gallery_label(
            labels, variant.label, ORIENTATION_GALLERY_CLOSEUP_SCALE, True
        )
        closeup = Path(output_dir) / item["closeup"]
        scene.render.filepath = str(closeup)
        bpy.ops.render.render(write_still=True)
        closeups.append(closeup)
        _set_gallery_label(labels, variant.label, full_scale, False)
        for view, direction in (
            ("front", Vector((0.0, -1.0, 0.0))),
            ("right", Vector((-1.0, 0.0, 0.0))),
            ("left", Vector((1.0, 0.0, 0.0))),
        ):
            camera.data.ortho_scale = full_scale
            camera.location = full_center + direction * distance
            camera.rotation_euler = (full_center - camera.location).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = str(Path(output_dir) / item[view])
            bpy.ops.render.render(write_still=True)
    _set_gallery_label(labels, "", ORIENTATION_GALLERY_CLOSEUP_SCALE, False)
    contact_sheet = gallery_root / "contact_sheet.png"
    _write_orientation_contact_sheet(closeups, contact_sheet)
    return {
        "contact_sheet": str(Path(ORIENTATION_GALLERY_DIRECTORY) / "contact_sheet.png"),
        "render_mapping": mapping,
        "full_body_camera": {
            "center": tuple(float(value) for value in full_center),
            "ortho_scale": float(full_scale),
            "bbox_min": tuple(float(value) for value in bbox_min),
            "bbox_max": tuple(float(value) for value in bbox_max),
        },
        "closeup_ortho_scale": ORIENTATION_GALLERY_CLOSEUP_SCALE,
    }


def _render_chin_support_candidates(
    output_dir, armature, mesh, controls, states, context, base_candidate, base_variant
):
    scene = bpy.context.scene
    root = Path(output_dir) / CHIN_SUPPORT_DIRECTORY
    combined_vertices = tuple(
        vertex for _refinement, _index, _record, vertices in states for vertex in vertices
    )
    camera, full_center, distance, full_scale, bbox_min, bbox_max = _full_body_camera(
        scene, combined_vertices
    )
    labels = _ensure_gallery_label(camera)
    scene.render.resolution_x = RENDER_RESOLUTION
    scene.render.resolution_y = RENDER_RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    closeups = []
    mapping = []
    for rank, (refinement, refinement_index, record, _vertices) in enumerate(states, start=1):
        _candidate, variant, _compensation, _applied = _apply_g14_refinement(
            armature, controls, base_candidate, base_variant,
            refinement, refinement_index, context,
        )
        relative_root = Path(CHIN_SUPPORT_DIRECTORY) / "candidates" / (
            f"{rank:02d}_{record['source_id']}"
        )
        directory = Path(output_dir) / relative_root
        directory.mkdir(parents=True, exist_ok=True)
        renders = {
            "closeup": str(relative_root / "upper_body_hand.png"),
            **{view: str(relative_root / f"{view}.png") for view in CANDIDATE_VIEWS},
        }
        record["rank"] = rank
        record["renders"] = renders
        mapping.append({"rank": rank, "source_id": record["source_id"], **renders})
        support_point = Vector(
            record["metrics"]["index_support_nearest"]["index_surface_world"]
        )
        fingertips = _finger_tip_positions(armature)
        close_center = (
            support_point + Vector(fingertips["index"]) + Vector(fingertips["thumb"])
        ) / 3.0
        camera.data.ortho_scale = ORIENTATION_GALLERY_CLOSEUP_SCALE
        camera.location = close_center + Vector((0.0, -1.0, 0.0)) * 2.0
        camera.rotation_euler = (close_center - camera.location).to_track_quat("-Z", "Y").to_euler()
        _set_gallery_label(labels, variant.label, ORIENTATION_GALLERY_CLOSEUP_SCALE, True)
        closeup_path = Path(output_dir) / renders["closeup"]
        scene.render.filepath = str(closeup_path)
        bpy.ops.render.render(write_still=True)
        closeups.append(closeup_path)
        _set_gallery_label(labels, "", full_scale, False)
        for view, direction in (
            ("front", Vector((0.0, -1.0, 0.0))),
            ("left", Vector((1.0, 0.0, 0.0))),
            ("right", Vector((-1.0, 0.0, 0.0))),
            ("back", Vector((0.0, 1.0, 0.0))),
        ):
            camera.data.ortho_scale = full_scale
            camera.location = full_center + direction * distance
            camera.rotation_euler = (full_center - camera.location).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = str(Path(output_dir) / renders[view])
            bpy.ops.render.render(write_still=True)
    _set_gallery_label(labels, "", ORIENTATION_GALLERY_CLOSEUP_SCALE, False)
    contact_sheet = root / "contact_sheet.png"
    _write_orientation_contact_sheet(closeups, contact_sheet)
    return {
        "contact_sheet": str(Path(CHIN_SUPPORT_DIRECTORY) / "contact_sheet.png"),
        "render_mapping": mapping,
        "full_body_camera": {
            "center": tuple(float(value) for value in full_center),
            "ortho_scale": float(full_scale),
            "bbox_min": tuple(float(value) for value in bbox_min),
            "bbox_max": tuple(float(value) for value in bbox_max),
        },
        "closeup_ortho_scale": ORIENTATION_GALLERY_CLOSEUP_SCALE,
    }


def _chin_support_rank(record, band):
    metrics = record["metrics"]
    patch_penalty = 0.0 if metrics["index_support_patch_count"] > 0 else 4.0
    contact_penalty = abs(
        metrics["index_support_surface_distance"] - band.support_target_distance
    ) / max(band.mesh_resolution, 1e-9)
    normal_penalty = (
        metrics["index_support_normal_opposition_error_deg"]
        / INDEX_SUPPORT_NORMAL_MAX_DEG
    )
    position_penalty = float(not metrics["index_support_under_chin"])
    thumb_penalty = float(not metrics["thumb_contour_bounded"])
    return (
        not record.get("eligible", False),
        not record.get("collision_valid", False),
        patch_penalty + contact_penalty + normal_penalty + position_penalty + thumb_penalty,
        record["source_id"],
    )


def chin_support_refinement(config: PocConfig) -> None:
    _require_blender()
    if (
        not config.chin_support_refinement
        or config.run_id is None
        or config.source_candidate_id is None
        or config.source_static_metrics is None
        or config.orientation_source_id is None
        or config.orientation_gallery_metrics is None
    ):
        raise ValueError("Chin-support refinement requires source arm and G14 gallery records")
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must open the existing POC blend: {config.source_blend}")
    paths = chin_support_run_paths(config.output_dir, config.run_id)
    if config.overwrite_run and paths.temporary.exists():
        shutil.rmtree(paths.temporary)
    paths.temporary.mkdir(parents=True, exist_ok=False)

    armature, mesh = _validate_scene_objects()
    compensation_controls = _ensure_compensation_controls(armature)
    _validate_compensation_baseline(armature, compensation_controls)
    finger_controls = _ensure_finger_controls(armature)
    _validate_finger_baseline(armature, finger_controls)
    controls = _existing_controls()
    _validate_existing_poc(armature, controls)
    math_module = _load_motion_math()
    geometry = _mesh_geometry_sets(mesh)
    context = _prepare_static_context(
        armature, mesh, controls, geometry, math_module,
        compensation_controls, finger_controls,
    )
    source_document = json.loads(config.source_static_metrics.read_text(encoding="utf-8"))
    source_candidate, stored_source_metrics = gallery_source_reference(
        source_document, config.source_candidate_id
    )
    base_variant = selected_orientation_variant(config.orientation_source_id)
    gallery_document = json.loads(
        config.orientation_gallery_metrics.read_text(encoding="utf-8")
    )
    stored_g14 = _orientation_gallery_record(gallery_document, base_variant.source_id)
    context["orientation_gallery_base_candidate"] = source_candidate
    context["orientation_gallery_compensation"] = UpperBodyCompensation(
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    )
    started_total = time.perf_counter()
    stage_durations = {}
    records = []
    try:
        _set_compensation_identity(compensation_controls)
        _set_finger_identity(finger_controls)
        _apply_context_candidate(armature, controls, source_candidate, context)
        source_surface = _current_chin_surface(mesh, armature, context["chin_surface"])
        source_actual = _anatomy_measurements(
            armature, controls, context["previous"], source_surface["chin_world"]
        )
        source_actual.update(_surface_contact_evidence_bvh(mesh, geometry, source_surface))
        source_actual["wrist_world"] = tuple(
            float(value) for value in _pose_head_world(armature, "右手首")
        )
        source_expected = {
            key: stored_source_metrics[key]
            for key in (
                "hand_target_world", "elbow_angle_deg", "pole_side",
                "surface_contact_distance",
            )
        }
        source_expected["wrist_world"] = source_actual["wrist_world"]
        source_reasons = gallery_source_reproduction_reasons(source_expected, source_actual)
        if source_reasons:
            raise RuntimeError(
                "Chin-support source arm failed reconstruction: " + "; ".join(source_reasons)
            )

        base_applied = _apply_orientation_gallery_variant(
            armature, controls, source_candidate,
            context["orientation_gallery_compensation"], base_variant, context,
        )
        base_fingertips = _finger_tip_positions(armature)
        base_finger_quaternions = _evaluated_finger_quaternions(armature)
        base_pose_hash = _orientation_gallery_pose_hash(
            base_applied["palm_final_quaternion"], base_finger_quaternions, base_fingertips
        )
        if base_pose_hash != stored_g14.get("evaluated_pose_hash"):
            raise RuntimeError(
                "Selected G14 reconstruction drifted from persisted gallery pose hash: "
                f"{base_pose_hash} != {stored_g14.get('evaluated_pose_hash')}"
            )
        base_surface = _current_chin_surface(mesh, armature, context["chin_surface"])
        base_support = _chin_support_surface_evidence(
            mesh, geometry, base_surface, armature
        )
        base_collision, _base_vertices = _full_collision_evidence(
            mesh, geometry, context["invariant_collision"]
        )

        stage_started = time.perf_counter()
        refinements = chin_support_refinement_grid()
        band = derive_chin_support_band(
            mesh_resolution=context["chin_surface"]["band"].mesh_resolution,
            chin_warning_distance=context["chin_surface"]["band"].warning_distance,
        )
        staged = []
        for index, refinement in enumerate(refinements, start=1):
            candidate, variant, compensation, applied = _apply_g14_refinement(
                armature, controls, source_candidate, base_variant,
                refinement, index, context,
            )
            surface = _current_chin_surface(mesh, armature, context["chin_surface"])
            metrics = _anatomy_measurements(
                armature, controls, context["previous"], surface["chin_world"]
            )
            metrics.update(_chin_support_surface_evidence(mesh, geometry, surface, armature))
            metrics.update({
                "hand_target_world": tuple(float(value) for value in controls["hand"].location),
                "wrist_world": tuple(float(value) for value in _pose_head_world(armature, "右手首")),
                "compensation_angles_deg": applied["compensation_angles_deg"],
                "fingertip_world": _finger_tip_positions(armature),
            })
            protected_current = _current_protected_pose_hashes(armature)
            reasons = []
            if not metrics["matrices_finite"]:
                reasons.append("Non-finite pose matrix")
            if not signed_elbow_flex_is_valid(metrics["signed_elbow_flex_deg"]):
                reasons.append("Signed elbow hinge limit failed")
            if metrics["pole_side"] <= math_module.EPSILON:
                reasons.append("Elbow is not on the pole-facing side")
            if not math_module.ELBOW_COMFORT_MIN_DEG <= metrics["elbow_angle_deg"] <= math_module.ELBOW_COMFORT_MAX_DEG:
                reasons.append("Elbow is outside the 55-100 degree comfort range")
            if abs(metrics["wrist_swing_deg"]) > math_module.WRIST_SWING_HARD_MAX_DEG:
                reasons.append("Wrist swing exceeds its hard limit")
            if abs(metrics["wrist_twist_deg"]) > math_module.WRIST_TWIST_HARD_MAX_DEG:
                reasons.append("Wrist twist exceeds its hard limit")
            if abs(metrics["forearm_twist_deg"]) > math_module.FOREARM_TWIST_HARD_MAX_DEG:
                reasons.append("Forearm twist exceeds its hard limit")
            if metrics["continuity_distance"] > math_module.CONTINUITY_HARD_DISTANCE:
                reasons.append("Candidate discontinuity exceeds its hard limit")
            reasons.extend(validate_compensation_angles(applied["compensation_angles_deg"]))
            reasons.extend(compare_protected_pose_hashes(
                context["protected_pose_hashes"], protected_current
            ))
            semantic_reasons = chin_support_semantic_reasons(metrics, band)
            record = {
                "source_id": candidate.candidate_id,
                "orientation_source_id": base_variant.source_id,
                "valid": not reasons,
                "collision_valid": False,
                "eligible": False,
                "reasons": list(dict.fromkeys(reasons)),
                "semantic_reasons": list(semantic_reasons),
                "parameters": {
                    "hand_target_offset": refinement.hand_target_offset,
                    "upper_chest_turn_deg": refinement.upper_chest_turn_deg,
                    "upper_chest_lean_deg": refinement.upper_chest_lean_deg,
                    "shoulder_retract_deg": refinement.shoulder_retract_deg,
                    "shoulder_elevate_deg": refinement.shoulder_elevate_deg,
                    "neck_toward_deg": refinement.neck_toward_deg,
                    "head_toward_deg": refinement.head_toward_deg,
                    "palm_refinement_deg": refinement.palm_refinement_deg,
                    "thumb_refinement_deg": refinement.thumb_refinement_deg,
                    "absolute_finger_targets_deg": variant.finger_targets_deg,
                    "palm_final_quaternion": applied["palm_final_quaternion"],
                },
                "metrics": metrics,
                "protected_pose_hashes": protected_current,
            }
            records.append(record)
            if not reasons:
                staged.append((refinement, index, record))
        stage_durations["bounded_geometry"] = {
            "input_count": len(refinements),
            "survivor_count": len(staged),
            "duration_seconds": time.perf_counter() - stage_started,
        }

        stage_started = time.perf_counter()
        shortlist = sorted(
            staged, key=lambda item: _chin_support_rank(item[2], band)
        )[:24]
        collision_valid = []
        for refinement, refinement_index, record in shortlist:
            _candidate, _variant, _compensation, _applied = _apply_g14_refinement(
                armature, controls, source_candidate, base_variant,
                refinement, refinement_index, context,
            )
            collision, vertices = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            record["metrics"].update(collision)
            collision_reasons = orientation_gallery_rejection_reasons(record["metrics"])
            if record["metrics"]["minimum_clearance"] < math_module.CLEARANCE_COMFORT_DISTANCE:
                record["reasons"].append(
                    f"Clearance warning below {math_module.CLEARANCE_COMFORT_DISTANCE:.3f} Blender units"
                )
            if record["metrics"]["continuity_distance"] > math_module.CONTINUITY_COMFORT_DISTANCE:
                record["reasons"].append(
                    f"Continuity warning above {math_module.CONTINUITY_COMFORT_DISTANCE:.3f} Blender units"
                )
            record["reasons"] = list(dict.fromkeys([
                *record["reasons"], *collision_reasons,
            ]))
            record["collision_valid"] = not collision_reasons
            record["eligible"] = bool(
                record["valid"] and record["collision_valid"] and not record["semantic_reasons"]
            )
            record["verdict"] = (
                "PASS" if record["eligible"]
                else "WARN" if record["valid"] and record["collision_valid"]
                else "FAIL"
            )
            record["verdict_reasons"] = list(dict.fromkeys([
                *record["reasons"], *record["semantic_reasons"],
            ]))
            if record["collision_valid"]:
                collision_valid.append((refinement, refinement_index, record, vertices))
        stage_durations["full_collision"] = {
            "input_count": len(shortlist),
            "survivor_count": len(collision_valid),
            "duration_seconds": time.perf_counter() - stage_started,
        }
        ranked = sorted(
            collision_valid, key=lambda item: _chin_support_rank(item[2], band)
        )
        if not ranked:
            raise RuntimeError("No collision-free G14 chin-support refinements survived")
        render_states = ranked[:STATIC_RENDER_COUNT]
        render_evidence = _render_chin_support_candidates(
            paths.temporary, armature, mesh, controls, render_states, context,
            source_candidate, base_variant,
        )
        _restore_static_control_state(
            armature, controls, context["baseline_state"],
            compensation_controls, finger_controls,
        )


        restoration_reasons = compare_static_state(
            context["baseline_state"],
            _capture_static_control_state(
                armature, controls, compensation_controls, finger_controls
            ),
            tolerance=1e-6,
        )
        if restoration_reasons:
            raise RuntimeError(
                "Chin-support refinement failed to restore baseline controls: "
                + "; ".join(restoration_reasons)
            )
        metrics_document = {
            "mode": "chin-support-refinement",
            "selection_status": "NEEDS_CONTEXT",
            "run_id": config.run_id,
            "frame": VALIDATION_FRAME,
            "source_blend": str(config.source_blend),
            "output_blend_unchanged": str(config.output_blend),
            "source_static_metrics": str(config.source_static_metrics),
            "orientation_gallery_metrics": str(config.orientation_gallery_metrics),
            "source_arm_candidate_id": config.source_candidate_id,
            "orientation_source_id": config.orientation_source_id,
            "source_reconstruction": {
                "expected": source_expected,
                "actual": source_actual,
                "reasons": [],
            },
            "g14_reconstruction": {
                "stored_pose_hash": stored_g14["evaluated_pose_hash"],
                "reconstructed_pose_hash": base_pose_hash,
                "support_metrics": base_support,
                "collision_metrics": base_collision,
                "finger_targets_deg": base_variant.finger_targets_deg,
            },
            "support_band": {
                "mesh_resolution": band.mesh_resolution,
                "support_target_distance": band.support_target_distance,
                "support_warning_distance": band.support_warning_distance,
                "derivation": band.derivation,
            },
            "index_support_normal_max_deg": INDEX_SUPPORT_NORMAL_MAX_DEG,
            "stage_metrics": stage_durations,
            "evaluated_count": len(refinements),
            "collision_evaluated_count": len(shortlist),
            "collision_valid_count": len(collision_valid),
            "eligible_count": sum(record["eligible"] for _a, _b, record, _c in ranked),
            "rendered_count": len(render_states),
            "duration_seconds": time.perf_counter() - started_total,
            "render_evidence": render_evidence,
            "candidates": [record for _refinement, _index, record, _vertices in ranked],
            "candidate_table": records,
        }
        metrics_path = paths.temporary / CHIN_SUPPORT_METRICS_NAME
        metrics_path.write_text(
            json.dumps(
                metrics_document, ensure_ascii=False, indent=2,
                sort_keys=True, allow_nan=False,
            ) + "\n",
            encoding="utf-8",
        )
        expected_paths = [metrics_path, paths.temporary / render_evidence["contact_sheet"]]
        expected_paths.extend(
            paths.temporary / item[key]
            for item in render_evidence["render_mapping"]
            for key in ("closeup", *CANDIDATE_VIEWS)
        )
        missing = [str(path) for path in expected_paths if not path.is_file()]
        if missing:
            raise RuntimeError("Chin-support refinement is missing artifacts: " + ", ".join(missing))
        if paths.final.exists():
            shutil.rmtree(paths.final)
        paths.temporary.rename(paths.final)
        print("POC_CHIN_SUPPORT_COMPLETE", {
            "run_id": config.run_id,
            "evaluated": len(refinements),
            "collision_evaluated": len(shortlist),
            "eligible": metrics_document["eligible_count"],
            "rendered": len(render_states),
            "contact_sheet": str(paths.final / render_evidence["contact_sheet"]),
            "metrics": str(paths.metrics),
        })
    finally:
        _restore_static_control_state(
            armature, controls, context["baseline_state"],
            compensation_controls, finger_controls,
        )


def sleeve_corrective_feasibility(config: PocConfig) -> None:
    _require_blender()
    if (
        not config.sleeve_corrective_feasibility
        or config.run_id is None
        or config.source_static_metrics is None
    ):
        raise ValueError("Sleeve corrective feasibility requires its mode, run ID, and source metrics")
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must open the existing POC blend: {config.source_blend}")
    paths = sleeve_corrective_run_paths(config.output_dir, config.run_id)
    if config.overwrite_run and paths.temporary.exists():
        shutil.rmtree(paths.temporary)
    paths.temporary.mkdir(parents=True, exist_ok=False)

    armature, mesh = _validate_scene_objects()
    compensation_controls = _ensure_compensation_controls(armature)
    _validate_compensation_baseline(armature, compensation_controls)
    finger_controls = _ensure_finger_controls(armature)
    _validate_finger_baseline(armature, finger_controls)
    sleeve_controls = _ensure_sleeve_corrective_controls(armature)
    sleeve_axes = _sleeve_rest_local_axes(armature)
    _validate_sleeve_corrective_baseline(armature, sleeve_controls, sleeve_axes)
    controls = _existing_controls()
    _validate_existing_poc(armature, controls)
    math_module = _load_motion_math()
    geometry = _mesh_geometry_sets(mesh)
    if not geometry["sleeve_corrective_faces"]:
        raise RuntimeError("Sleeve corrective weighted groups contain no closed surface faces")
    context = _prepare_static_context(
        armature, mesh, controls, geometry, math_module,
        compensation_controls, finger_controls,
    )
    stored = json.loads(config.source_static_metrics.read_text(encoding="utf-8"))
    candidate_by_id = {
        candidate.candidate_id: candidate for candidate in static_candidate_grid()
    }
    seed_ids = ("candidate_4330", "candidate_4334")
    corrections = sleeve_correction_grid()
    baseline_by_seed = {}
    evaluated = []
    started = time.perf_counter()
    try:
        for seed_id in seed_ids:
            candidate = candidate_by_id[seed_id]
            _set_compensation_identity(compensation_controls)
            _set_finger_identity(finger_controls)
            _set_sleeve_corrective_identity(sleeve_controls)
            _apply_context_candidate(armature, controls, candidate, context)
            surface = _current_chin_surface(mesh, armature, context["chin_surface"])
            contact = _surface_contact_evidence_bvh(mesh, geometry, surface)
            collision_before, vertices_before = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            moving_tree_before = _bvh(vertices_before, geometry["moving_faces"])
            torso_tree_before = _bvh(vertices_before, geometry["torso_faces"])
            overlap_before = tuple(moving_tree_before.overlap(torso_tree_before))
            severity_before = _collision_severity_evidence(
                mesh, geometry, vertices_before, overlap_before
            )
            sleeve_tree_before = _bvh(
                vertices_before, geometry["sleeve_corrective_faces"]
            )
            head_tree_before = _bvh(vertices_before, geometry["head_faces"])
            hand_tree_before = _bvh(vertices_before, geometry["hand_faces"])
            baseline = {
                "candidate": candidate,
                "contact": contact,
                "primary": _capture_sleeve_primary_state(
                    armature, contact["hand_contact_world"]
                ),
                "shape": _capture_sleeve_shape(
                    vertices_before, geometry["sleeve_corrective_faces"]
                ),
                "collision": collision_before,
                "severity": severity_before,
                "sleeve_head_overlap_count": len(
                    sleeve_tree_before.overlap(head_tree_before)
                ),
                "sleeve_hand_overlap_count": len(
                    sleeve_tree_before.overlap(hand_tree_before)
                ),
            }
            baseline_by_seed[seed_id] = baseline

            for correction_index, correction in enumerate(corrections):
                source_id = f"{seed_id}__sleeve_{correction_index:03d}"
                _set_sleeve_corrective_identity(sleeve_controls)
                _apply_context_candidate(armature, controls, candidate, context)
                quaternions = _apply_sleeve_correction(
                    armature, sleeve_controls, sleeve_axes, correction
                )
                current_surface = _current_chin_surface(
                    mesh, armature, context["chin_surface"]
                )
                current_contact = _surface_contact_evidence_bvh(
                    mesh, geometry, current_surface
                )
                current_primary = _capture_sleeve_primary_state(
                    armature, current_contact["hand_contact_world"]
                )
                primary_drift = _sleeve_primary_drift(
                    baseline["primary"], current_primary
                )
                collision_after, vertices_after = _full_collision_evidence(
                    mesh, geometry, context["invariant_collision"]
                )
                sleeve_tree = _bvh(
                    vertices_after, geometry["sleeve_corrective_faces"]
                )
                head_tree = _bvh(vertices_after, geometry["head_faces"])
                hand_tree = _bvh(vertices_after, geometry["hand_faces"])
                sleeve_head_count = len(sleeve_tree.overlap(head_tree))
                sleeve_hand_count = len(sleeve_tree.overlap(hand_tree))
                shape = _sleeve_shape_evidence(
                    baseline["shape"],
                    _capture_sleeve_shape(
                        vertices_after, geometry["sleeve_corrective_faces"]
                    ),
                )
                smoothness = sleeve_correction_smoothness(correction)
                reasons = list(sleeve_correction_reasons(correction))
                reasons.extend(sleeve_primary_drift_reasons(primary_drift))
                reasons.extend(shape["reasons"])
                if collision_after["head_collision_count"] != baseline["collision"]["head_collision_count"]:
                    reasons.append("Sleeve correction changes the existing hand/head collision state")
                if sleeve_head_count > baseline["sleeve_head_overlap_count"]:
                    reasons.append("Sleeve correction introduces additional sleeve/head overlap")
                if sleeve_hand_count > baseline["sleeve_hand_overlap_count"]:
                    reasons.append("Sleeve correction introduces additional sleeve/hand overlap")
                matrices = tuple(
                    armature.pose.bones[name].matrix
                    for name in SLEEVE_CORRECTIVE_BONES
                ) + tuple(control.matrix_world for control in sleeve_controls.values())
                if not all(_finite_matrix(matrix) for matrix in matrices):
                    reasons.append("Sleeve correction contains non-finite matrices")
                raw_overlap = int(collision_after["torso_penetration_count"])
                eligible = not reasons and raw_overlap == 0
                evaluated.append({
                    "source_id": source_id,
                    "seed_id": seed_id,
                    "correction_index": correction_index,
                    "eligible": eligible,
                    "reasons": list(dict.fromkeys(reasons)),
                    "raw_overlap_count": raw_overlap,
                    "overlap_before": int(
                        baseline["collision"]["torso_penetration_count"]
                    ),
                    "overlap_reduction": int(
                        baseline["collision"]["torso_penetration_count"]
                    ) - raw_overlap,
                    "max_penetration_depth": 0.0,
                    "smoothness_penalty": smoothness["smoothness_penalty"],
                    "correction": correction,
                    "correction_swings_deg": correction.swings_deg,
                    "correction_quaternions": quaternions,
                    "local_axes": sleeve_axes,
                    "primary_drift": primary_drift,
                    "contact_before": baseline["contact"],
                    "contact_after": current_contact,
                    "shape": shape,
                    "collision_after": collision_after,
                    "sleeve_head_overlap_before": baseline["sleeve_head_overlap_count"],
                    "sleeve_head_overlap_after": sleeve_head_count,
                    "sleeve_hand_overlap_before": baseline["sleeve_hand_overlap_count"],
                    "sleeve_hand_overlap_after": sleeve_hand_count,
                    "smoothness": smoothness,
                })

        shortlist = sorted(evaluated, key=sleeve_correction_rank)[:24]
        for record in shortlist:
            baseline = baseline_by_seed[record["seed_id"]]
            _set_sleeve_corrective_identity(sleeve_controls)
            _apply_context_candidate(
                armature, controls, baseline["candidate"], context
            )
            _apply_sleeve_correction(
                armature, sleeve_controls, sleeve_axes, record["correction"]
            )
            vertices = _evaluated_world_vertices(mesh)
            moving_tree = _bvh(vertices, geometry["moving_faces"])
            torso_tree = _bvh(vertices, geometry["torso_faces"])
            overlaps = tuple(moving_tree.overlap(torso_tree))
            severity_after = _collision_severity_evidence(
                mesh, geometry, vertices, overlaps
            )
            record["severity_before"] = baseline["severity"]
            record["severity_after"] = severity_after
            record["max_penetration_depth"] = severity_after["penetration_depth"]["max_blender"]

        ranked = sorted(evaluated, key=sleeve_correction_rank)
        eligible = [record for record in ranked if record["eligible"]]
        render_records = (eligible or ranked)[:STATIC_RENDER_COUNT]
        closeups = []
        for record in render_records:
            baseline = baseline_by_seed[record["seed_id"]]
            _set_sleeve_corrective_identity(sleeve_controls)
            _apply_context_candidate(
                armature, controls, baseline["candidate"], context
            )
            _apply_sleeve_correction(
                armature, sleeve_controls, sleeve_axes, record["correction"]
            )
            vertices = _evaluated_world_vertices(mesh)
            if "severity_after" not in record:
                moving_tree = _bvh(vertices, geometry["moving_faces"])
                torso_tree = _bvh(vertices, geometry["torso_faces"])
                record["severity_before"] = baseline["severity"]
                record["severity_after"] = _collision_severity_evidence(
                    mesh, geometry, vertices,
                    tuple(moving_tree.overlap(torso_tree)),
                )
            render = _render_collision_severity_diagnostic(
                paths.temporary,
                record["source_id"],
                vertices,
                record["severity_after"],
                output_directory=SLEEVE_CORRECTIVE_DIRECTORY,
                overlay_severity=record["severity_before"],
            )
            record["render_evidence"] = render
            closeups.append(
                paths.temporary
                / render["renders"]["collision_closeup_normal"]
            )
        contact_sheet_relative = Path(SLEEVE_CORRECTIVE_DIRECTORY) / "contact_sheet.png"
        _write_orientation_contact_sheet(
            closeups, paths.temporary / contact_sheet_relative
        )

        _set_sleeve_corrective_identity(sleeve_controls)
        _restore_static_control_state(
            armature, controls, context["baseline_state"],
            compensation_controls, finger_controls,
        )
        metrics = {
            "mode": "sleeve-corrective-feasibility",
            "selection_status": "NEEDS_CONTEXT" if eligible else "BLOCKED",
            "acceptance_thresholds_changed": False,
            "run_id": config.run_id,
            "frame": VALIDATION_FRAME,
            "source_blend": str(config.source_blend),
            "output_blend_unchanged": str(config.output_blend),
            "source_static_metrics": str(config.source_static_metrics),
            "seed_ids": seed_ids,
            "correction_count_per_seed": len(corrections),
            "evaluated_count": len(evaluated),
            "zero_overlap_count": len(eligible),
            "rendered_count": len(render_records),
            "duration_seconds": time.perf_counter() - started,
            "local_axes": sleeve_axes,
            "limits": {
                "max_correction_deg": SLEEVE_CORRECTIVE_MAX_DEG,
                "max_adjacent_delta_deg": SLEEVE_CORRECTIVE_MAX_ADJACENT_DEG,
                "primary_position_tolerance": SLEEVE_PRIMARY_POSITION_TOLERANCE,
                "primary_rotation_tolerance_deg": SLEEVE_PRIMARY_ROTATION_TOLERANCE_DEG,
                "fingertip_position_tolerance": SLEEVE_FINGERTIP_POSITION_TOLERANCE,
                "contact_position_tolerance": SLEEVE_CONTACT_POSITION_TOLERANCE,
                "face_area_ratio": (
                    SLEEVE_FACE_MIN_AREA_RATIO, SLEEVE_FACE_MAX_AREA_RATIO
                ),
            },
            "baseline_by_seed": {
                seed_id: {
                    "collision": baseline["collision"],
                    "severity": baseline["severity"],
                    "contact": baseline["contact"],
                    "sleeve_head_overlap_count": baseline["sleeve_head_overlap_count"],
                    "sleeve_hand_overlap_count": baseline["sleeve_hand_overlap_count"],
                }
                for seed_id, baseline in baseline_by_seed.items()
            },
            "contact_sheet": str(contact_sheet_relative),
            "rendered_candidates": render_records,
            "candidate_table": evaluated,
        }
        metrics_path = paths.temporary / SLEEVE_CORRECTIVE_METRICS_NAME
        metrics_path.write_text(
            json.dumps(
                metrics, ensure_ascii=False, indent=2,
                sort_keys=True, allow_nan=False,
                default=lambda value: (
                    {"swings_deg": value.swings_deg}
                    if isinstance(value, SleeveCorrection) else str(value)
                ),
            ) + "\n",
            encoding="utf-8",
        )
        expected = [metrics_path, paths.temporary / contact_sheet_relative]
        expected.extend(
            paths.temporary / relative
            for record in render_records
            for relative in record["render_evidence"]["renders"].values()
        )
        missing = [str(path) for path in expected if not path.is_file()]
        if missing:
            raise RuntimeError(
                "Sleeve corrective feasibility is missing artifacts: " + ", ".join(missing)
            )
        if paths.final.exists():
            shutil.rmtree(paths.final)
        paths.temporary.rename(paths.final)
        print("POC_SLEEVE_CORRECTIVE_COMPLETE", {
            "run_id": config.run_id,
            "evaluated": len(evaluated),
            "zero_overlap": len(eligible),
            "rendered": len(render_records),
            "metrics": str(paths.metrics),
        })
    finally:
        _set_sleeve_corrective_identity(sleeve_controls)
        _restore_static_control_state(
            armature, controls, context["baseline_state"],
            compensation_controls, finger_controls,
        )


def collision_severity_diagnostic(config: PocConfig) -> None:
    _require_blender()
    if (
        not config.collision_severity_diagnostic
        or config.run_id is None
        or config.source_static_metrics is None
    ):
        raise ValueError("Collision severity diagnostic requires its mode, run ID, and source metrics")
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must open the existing POC blend: {config.source_blend}")
    paths = collision_severity_run_paths(config.output_dir, config.run_id)
    if config.overwrite_run and paths.temporary.exists():
        shutil.rmtree(paths.temporary)
    paths.temporary.mkdir(parents=True, exist_ok=False)

    armature, mesh = _validate_scene_objects()
    compensation_controls = _ensure_compensation_controls(armature)
    _validate_compensation_baseline(armature, compensation_controls)
    finger_controls = _ensure_finger_controls(armature)
    _validate_finger_baseline(armature, finger_controls)
    controls = _existing_controls()
    _validate_existing_poc(armature, controls)
    math_module = _load_motion_math()
    geometry = _mesh_geometry_sets(mesh)
    context = _prepare_static_context(
        armature, mesh, controls, geometry, math_module,
        compensation_controls, finger_controls,
    )
    stored = json.loads(config.source_static_metrics.read_text(encoding="utf-8"))
    selected_records = collision_severity_source_records(stored)
    candidate_by_id = {
        candidate.candidate_id: candidate for candidate in static_candidate_grid()
    }
    compensated_record = selected_records["compensated"]
    targets = (
        (
            "candidate_4330",
            candidate_by_id["candidate_4330"],
            None,
            stored.get("diagnostics", {}).get("candidate_4330"),
        ),
        (
            "candidate_4334",
            candidate_by_id["candidate_4334"],
            None,
            stored.get("diagnostics", {}).get("candidate_4334"),
        ),
        (
            str(compensated_record["source_candidate_id"]),
            _candidate_from_record(compensated_record),
            _compensation_from_record(compensated_record),
            compensated_record,
        ),
    )
    results = []
    started = time.perf_counter()
    try:
        for source_id, candidate, compensation, stored_record in targets:
            _set_finger_identity(finger_controls)
            if compensation is None:
                _set_compensation_identity(compensation_controls)
                _apply_context_candidate(armature, controls, candidate, context)
            else:
                _apply_compensated_state(
                    armature, controls, candidate, compensation, context
                )
            collision_metrics, vertices = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            moving_tree = _bvh(vertices, geometry["moving_faces"])
            torso_tree = _bvh(vertices, geometry["torso_faces"])
            overlap_pairs = tuple(moving_tree.overlap(torso_tree))
            severity = _collision_severity_evidence(
                mesh, geometry, vertices, overlap_pairs
            )
            stored_overlap_count = (
                stored_record.get("metrics", {}).get("torso_penetration_count")
                if stored_record else None
            )
            raw_count_matches_stored = (
                stored_overlap_count is None
                or int(stored_overlap_count)
                == int(collision_metrics["torso_penetration_count"])
            )
            render_evidence = _render_collision_severity_diagnostic(
                paths.temporary, source_id, vertices, severity
            )
            results.append({
                "source_id": source_id,
                "state": "upper_body_compensated" if compensation is not None else "arm_only",
                "candidate_parameters": {
                    "alignment_factor": candidate.alignment_factor,
                    "hand_offset": candidate.hand_offset,
                    "palm_euler_deg": candidate.palm_euler_deg,
                    "pole_offset": candidate.pole_offset,
                    "pole_offset_3d": candidate.pole_offset_3d,
                    "twist_influences": candidate.twist_influences,
                },
                "compensation": (
                    {
                        "upper_chest_turn_deg": compensation.upper_chest_turn_deg,
                        "upper_chest_lean_deg": compensation.upper_chest_lean_deg,
                        "shoulder_retract_deg": compensation.shoulder_retract_deg,
                        "shoulder_elevate_deg": compensation.shoulder_elevate_deg,
                        "neck_toward_deg": compensation.neck_toward_deg,
                        "head_toward_deg": compensation.head_toward_deg,
                    }
                    if compensation is not None else None
                ),
                "stored_raw_overlap_count": stored_overlap_count,
                "raw_overlap_count_matches_stored": raw_count_matches_stored,
                "collision_metrics": collision_metrics,
                "severity": severity,
                "render_evidence": render_evidence,
            })
        _restore_static_control_state(
            armature, controls, context["baseline_state"],
            compensation_controls, finger_controls,
        )
        restoration_reasons = compare_static_state(
            context["baseline_state"],
            _capture_static_control_state(
                armature, controls, compensation_controls, finger_controls
            ),
            tolerance=1e-6,
        )
        if restoration_reasons:
            raise RuntimeError(
                "Collision severity diagnostic failed to restore baseline controls: "
                + "; ".join(restoration_reasons)
            )
        metrics = {
            "mode": "collision-severity-diagnostic",
            "selection_status": "NEEDS_CONTEXT",
            "acceptance_thresholds_changed": False,
            "run_id": config.run_id,
            "frame": VALIDATION_FRAME,
            "source_blend": str(config.source_blend),
            "output_blend_unchanged": str(config.output_blend),
            "source_static_metrics": str(config.source_static_metrics),
            "duration_seconds": time.perf_counter() - started,
            "candidate_count": len(results),
            "candidates": results,
        }
        metrics_path = paths.temporary / COLLISION_SEVERITY_METRICS_NAME
        metrics_path.write_text(
            json.dumps(
                metrics, ensure_ascii=False, indent=2,
                sort_keys=True, allow_nan=False,
            ) + "\n",
            encoding="utf-8",
        )
        expected = [metrics_path]
        expected.extend(
            paths.temporary / relative
            for result in results
            for relative in result["render_evidence"]["renders"].values()
        )
        missing = [str(path) for path in expected if not path.is_file()]
        if missing:
            raise RuntimeError(
                "Collision severity diagnostic is missing artifacts: " + ", ".join(missing)
            )
        if paths.final.exists():
            shutil.rmtree(paths.final)
        paths.temporary.rename(paths.final)
        print("POC_COLLISION_SEVERITY_COMPLETE", {
            "run_id": config.run_id,
            "candidates": [result["source_id"] for result in results],
            "metrics": str(paths.metrics),
        })
    finally:
        _restore_static_control_state(
            armature, controls, context["baseline_state"],
            compensation_controls, finger_controls,
        )


def orientation_gallery(config: PocConfig) -> None:
    _require_blender()
    if (
        not config.orientation_gallery
        or config.run_id is None
        or config.source_candidate_id is None
        or config.source_static_metrics is None
    ):
        raise ValueError(
            "Orientation gallery requires its mode, run ID, source candidate, and source metrics"
        )
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must open the existing POC blend: {config.source_blend}")
    paths = orientation_gallery_run_paths(config.output_dir, config.run_id)
    if config.overwrite_run:
        if paths.temporary.exists():
            shutil.rmtree(paths.temporary)
    paths.temporary.mkdir(parents=True, exist_ok=False)

    armature, mesh = _validate_scene_objects()
    compensation_controls = _ensure_compensation_controls(armature)
    _validate_compensation_baseline(armature, compensation_controls)
    finger_controls = _ensure_finger_controls(armature)
    _validate_finger_baseline(armature, finger_controls)
    controls = _existing_controls()
    _validate_existing_poc(armature, controls)
    math_module = _load_motion_math()
    geometry = _mesh_geometry_sets(mesh)
    context = _prepare_static_context(
        armature, mesh, controls, geometry, math_module,
        compensation_controls, finger_controls,
    )
    stored_source = json.loads(config.source_static_metrics.read_text(encoding="utf-8"))
    source_candidate, stored_source_metrics = gallery_source_reference(
        stored_source, config.source_candidate_id
    )
    base_candidate, compensation, base_preset = _orientation_gallery_baseline(
        source_candidate
    )
    context["orientation_gallery_base_candidate"] = base_candidate
    context["orientation_gallery_compensation"] = compensation
    _set_compensation_identity(compensation_controls)
    _set_finger_identity(finger_controls)
    _apply_context_candidate(armature, controls, source_candidate, context)
    source_surface = _current_chin_surface(mesh, armature, context["chin_surface"])
    source_actual = _anatomy_measurements(
        armature, controls, context["previous"], source_surface["chin_world"]
    )
    source_actual.update(_surface_contact_evidence_bvh(mesh, geometry, source_surface))
    source_actual["wrist_world"] = tuple(
        float(value) for value in _pose_head_world(armature, "右手首")
    )
    source_expected = {
        key: stored_source_metrics[key]
        for key in (
            "hand_target_world",
            "elbow_angle_deg",
            "pole_side",
            "surface_contact_distance",
        )
    }
    source_expected["wrist_world"] = source_actual["wrist_world"]
    source_reproduction_reasons = gallery_source_reproduction_reasons(
        source_expected, source_actual
    )
    if source_reproduction_reasons:
        raise RuntimeError(
            "Orientation gallery source candidate failed reconstruction: "
            + "; ".join(source_reproduction_reasons)
        )
    variants = orientation_gallery_variants()
    evaluated = []
    valid_states = []
    started = time.perf_counter()
    try:
        for variant in variants:
            applied = _apply_orientation_gallery_variant(
                armature, controls, base_candidate, compensation, variant, context
            )
            current_surface = _current_chin_surface(
                mesh, armature, context["chin_surface"]
            )
            metrics = _anatomy_measurements(
                armature, controls, context["previous"], current_surface["chin_world"]
            )
            metrics.update(_surface_contact_evidence_bvh(mesh, geometry, current_surface))
            tip_surface = _tip_surface_evidence(armature, current_surface)
            fingertips = _finger_tip_positions(armature)
            evaluated_finger_quaternions = _evaluated_finger_quaternions(armature)
            metrics["tip_surface_evidence"] = tip_surface
            metrics["tip_surface_distance_by_source"] = {
                source: evidence["distance"] for source, evidence in tip_surface.items()
            }
            metrics["fingertip_world"] = fingertips
            metrics["wrist_world"] = tuple(
                float(value) for value in _pose_head_world(armature, "右手首")
            )
            collision_metrics, vertices = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            metrics.update(collision_metrics)
            protected_current = _current_protected_pose_hashes(armature)
            protected_reasons = compare_protected_pose_hashes(
                context["protected_pose_hashes"], protected_current
            )
            arm_reproduction_reasons = gallery_arm_state_reproduction_reasons(
                source_actual, metrics
            )
            reasons = tuple(dict.fromkeys((
                *orientation_gallery_rejection_reasons(metrics),
                *protected_reasons,
            )))
            record = {
                "source_id": variant.source_id,
                "family": variant.family,
                "label": variant.label,
                "valid": not reasons,
                "reasons": list(reasons),
                "axial_angle_deg": variant.axial_angle_deg,
                "palm_swing_deg": variant.palm_swing_deg,
                "palm_tilt_deg": variant.palm_tilt_deg,
                "twist_distribution": variant.twist_distribution,
                "twist_distribution_degrees": tuple(
                    variant.axial_angle_deg * influence
                    for influence in variant.twist_distribution
                ),
                "thumb_variant": variant.thumb_variant,
                "index_variant": variant.index_variant,
                "comparison_group": variant.comparison_group,
                "comparison_dimension": variant.comparison_dimension,
                "arm_state_drift_reasons": list(arm_reproduction_reasons),
                "finger_absolute_targets_deg": variant.finger_targets_deg,
                "finger_absolute_solution": applied["finger_solution"],
                "evaluated_finger_quaternions": evaluated_finger_quaternions,
                "fingertip_world": fingertips,
                "palm_quaternions": {
                    key: applied[key]
                    for key in (
                        "palm_base_quaternion",
                        "palm_axial_quaternion",
                        "palm_swing_quaternion",
                        "palm_tilt_quaternion",
                        "palm_final_quaternion",
                    )
                },
                "palm_final_quaternion": applied["palm_final_quaternion"],
                "palm_swing_control_deg": applied["palm_swing_control_deg"],
                "palm_tilt_control_deg": applied["palm_tilt_control_deg"],
                "evaluated_pose_hash": _orientation_gallery_pose_hash(
                    applied["palm_final_quaternion"],
                    evaluated_finger_quaternions,
                    fingertips,
                ),
                "compensation_angles_deg": applied["compensation_angles_deg"],
                "metrics": metrics,
                "protected_pose_hashes": protected_current,
            }
            evaluated.append(record)
            if not reasons:
                valid_states.append((variant, record, vertices))
        uniqueness_reasons = orientation_gallery_pose_uniqueness_reasons(evaluated)
        if uniqueness_reasons:
            raise RuntimeError(
                "Orientation gallery contains pose-identical labeled variants: "
                + "; ".join(uniqueness_reasons)
            )
        all_valid_states = valid_states
        if len(all_valid_states) < ORIENTATION_GALLERY_MIN_RENDER_COUNT:
            print("POC_ORIENTATION_GALLERY_REJECTIONS", [
                {
                    "source_id": record["source_id"],
                    "reasons": record["reasons"],
                    "wrist_swing_deg": record["metrics"]["wrist_swing_deg"],
                    "wrist_twist_deg": record["metrics"]["wrist_twist_deg"],
                    "forearm_twist_deg": record["metrics"]["forearm_twist_deg"],
                    "head_collision_count": record["metrics"]["head_collision_count"],
                    "torso_penetration_count": record["metrics"]["torso_penetration_count"],
                }
                for record in evaluated
            ])
            raise RuntimeError(
                "Orientation gallery requires 12-18 collision-free hard-limit variants; "
                f"got {len(all_valid_states)}"
            )
        valid_states = all_valid_states[:ORIENTATION_GALLERY_MAX_RENDER_COUNT]
        render_evidence = _render_orientation_gallery(
            paths.temporary, armature, mesh, controls, valid_states, context
        )
        _restore_static_control_state(
            armature, controls, context["baseline_state"], compensation_controls, finger_controls
        )
        restoration_differences = compare_static_state(
            context["baseline_state"],
            _capture_static_control_state(
                armature, controls, compensation_controls, finger_controls
            ),
            1e-6,
        )
        if restoration_differences:
            raise RuntimeError(
                "Orientation gallery failed to restore baseline controls: "
                + "; ".join(restoration_differences)
            )
        gallery_root = paths.temporary / ORIENTATION_GALLERY_DIRECTORY
        metrics_path = gallery_root / ORIENTATION_GALLERY_METRICS_NAME
        metrics_path.write_text(
            json.dumps({
                "mode": "orientation-gallery",
                "selection_status": "NEEDS_CONTEXT",
                "run_id": config.run_id,
                "frame": VALIDATION_FRAME,
                "source_blend": str(config.source_blend),
                "output_blend_unchanged": str(config.output_blend),
                "source_static_metrics": str(config.source_static_metrics),
                "baseline_source_id": config.source_candidate_id,
                "baseline": {
                    "arm_candidate_id": config.source_candidate_id,
                    "stored_parameters": {
                        "alignment_factor": source_candidate.alignment_factor,
                        "hand_offset": source_candidate.hand_offset,
                        "palm_euler_deg": source_candidate.palm_euler_deg,
                        "pole_offset": source_candidate.pole_offset,
                        "pole_offset_3d": source_candidate.pole_offset_3d,
                        "twist_influences": source_candidate.twist_influences,
                    },
                    "expected_metrics": source_expected,
                    "reconstructed_metrics": {
                        key: source_actual[key]
                        for key in (
                            "hand_target_world",
                            "wrist_world",
                            "elbow_angle_deg",
                            "pole_side",
                            "surface_contact_distance",
                        )
                    },
                    "reproduction_reasons": [],
                    "finger_preset": base_preset.name,
                    "compensation": {
                        "neck_toward_deg": compensation.neck_toward_deg,
                        "head_toward_deg": compensation.head_toward_deg,
                    },
                },
                "raw_variant_count": len(variants),
                "valid_variant_count": len(all_valid_states),
                "rendered_variant_count": len(valid_states),
                "rejected_variant_count": len(variants) - len(all_valid_states),
                "valid_not_rendered_count": len(all_valid_states) - len(valid_states),
                "duration_seconds": time.perf_counter() - started,
                "render_evidence": render_evidence,
                "variant_table": evaluated,
            }, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        expected = [
            paths.temporary / item[key]
            for item in render_evidence["render_mapping"]
            for key in ("closeup", "front", "right", "left")
        ]
        expected.append(paths.temporary / render_evidence["contact_sheet"])
        missing = [str(path) for path in expected if not path.is_file()]
        if missing:
            raise RuntimeError("Orientation gallery is missing artifacts: " + ", ".join(missing))
        if paths.final.exists():
            shutil.rmtree(paths.final)
        paths.temporary.rename(paths.final)
        print("POC_ORIENTATION_GALLERY_COMPLETE", {
            "run_id": config.run_id,
            "evaluated": len(variants),
            "rejected": len(variants) - len(all_valid_states),
            "rendered": len(valid_states),
            "contact_sheet": str(paths.final / render_evidence["contact_sheet"]),
            "metrics": str(paths.metrics),
        })
    finally:
        _restore_static_control_state(
            armature, controls, context["baseline_state"], compensation_controls, finger_controls
        )


def search_static(config: PocConfig) -> None:
    _require_blender()
    if not config.search_static or config.run_id is None:
        raise ValueError("Static search requires --search-static and --run-id")
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must open the existing POC blend: {config.source_blend}")
    paths = static_run_paths(config.output_dir, config.run_id)
    if config.overwrite_run:
        if paths.temporary.exists():
            shutil.rmtree(paths.temporary)
    paths.temporary.mkdir(parents=True, exist_ok=False)

    armature, mesh = _validate_scene_objects()
    compensation_controls = _ensure_compensation_controls(armature)
    _validate_compensation_baseline(armature, compensation_controls)
    finger_controls = _ensure_finger_controls(armature)
    _validate_finger_baseline(armature, finger_controls)
    controls = _existing_controls()
    _validate_existing_poc(armature, controls)
    math_module = _load_motion_math()
    geometry = _mesh_geometry_sets(mesh)
    context = _prepare_static_context(
        armature, mesh, controls, geometry, math_module,
        compensation_controls, finger_controls,
    )
    stage_metrics = {}
    candidates = static_candidate_grid()
    evaluated = []
    vertices_by_candidate = {}
    try:
        started = time.perf_counter()
        for candidate in candidates:
            _apply_context_candidate(armature, controls, candidate, context)
            measurements = _anatomy_measurements(
                armature, controls, context["previous"], context["chin_world"]
            )
            record = _stage_a_record(math_module, candidate, measurements)
            evaluated.append((candidate, record))
        stage_a_valid = stage_a_survivors(evaluated, STAGE_A_SURVIVOR_LIMIT)
        stage_metrics["A"] = {
            "input_count": len(candidates),
            "survivor_count": len(stage_a_valid),
            "rejected_count": len(candidates) - len(stage_a_valid),
            "duration_seconds": time.perf_counter() - started,
        }
        print("POC_STATIC_STAGE_A", stage_metrics["A"])

        started = time.perf_counter()
        for candidate, record in stage_a_valid:
            _apply_context_candidate(armature, controls, candidate, context)
            surface_metrics = _surface_contact_evidence_bvh(mesh, geometry, context["chin_surface"])
            _stage_b_update(math_module, record, surface_metrics, context["chin_surface"]["band"])
        stage_b_valid = sorted(
            (item for item in stage_a_valid if item[1]["valid"]), key=_rank_key
        )[:STAGE_B_SURVIVOR_LIMIT]
        stage_metrics["B"] = {
            "input_count": len(stage_a_valid),
            "survivor_count": len(stage_b_valid),
            "rejected_count": len(stage_a_valid) - len(stage_b_valid),
            "duration_seconds": time.perf_counter() - started,
        }
        print("POC_STATIC_STAGE_B", stage_metrics["B"])

        started = time.perf_counter()
        stage_c_input = stage_b_valid[:STAGE_C_SURVIVOR_LIMIT]
        for candidate, record in stage_c_input:
            _apply_context_candidate(armature, controls, candidate, context)
            collision_metrics, vertices = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            _stage_c_update(math_module, record, collision_metrics)
            vertices_by_candidate[candidate.candidate_id] = vertices
        stage_c_valid = sorted(
            (item for item in stage_c_input if item[1]["valid"]),
            key=lambda item: (not item[1].get("selection_eligible", False), *_rank_key(item)),
        )
        stage_metrics["C"] = {
            "input_count": len(stage_c_input),
            "survivor_count": len(stage_c_valid),
            "rejected_count": len(stage_c_input) - len(stage_c_valid),
            "duration_seconds": time.perf_counter() - started,
        }
        print("POC_STATIC_STAGE_C", stage_metrics["C"])
        diagnostic_records = {}
        candidate_by_id = {candidate.candidate_id: candidate for candidate in candidates}
        for source_id in ("candidate_4330", "candidate_4334"):
            candidate = candidate_by_id[source_id]
            _apply_context_candidate(armature, controls, candidate, context)
            diagnostic_record = _stage_a_record(
                math_module,
                candidate,
                _anatomy_measurements(armature, controls, context["previous"], context["chin_world"]),
            )
            _stage_b_update(
                math_module,
                diagnostic_record,
                _surface_contact_evidence_bvh(mesh, geometry, context["chin_surface"]),
                context["chin_surface"]["band"],
            )
            collision_metrics, diagnostic_vertices = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            _stage_c_update(math_module, diagnostic_record, collision_metrics)
            diagnostic_record["diagnostic_render_evidence"] = _render_diagnostic_candidate(
                paths.temporary,
                armature,
                controls,
                candidate,
                context,
                diagnostic_vertices,
            )
            diagnostic_records[source_id] = diagnostic_record

        seed_pool = list(stage_c_input)
        seed_pool.extend(
            (candidate_by_id[source_id], record)
            for source_id, record in diagnostic_records.items()
            if source_id in candidate_by_id
        )
        unique_seed_pool = {}
        for candidate, record in seed_pool:
            unique_seed_pool[candidate.candidate_id] = (candidate, record)
        compensation_seeds = compensation_seed_candidates(
            tuple(unique_seed_pool.values()), COMPENSATION_SEED_LIMIT
        )

        started = time.perf_counter()
        stage_d_evaluated = []
        compensation_grid = upper_body_compensation_grid()
        for arm_candidate, arm_record in compensation_seeds:
            for compensation_index, compensation in enumerate(compensation_grid):
                quaternions, angles = _apply_compensated_state(
                    armature, controls, arm_candidate, compensation, context
                )
                current_surface = _current_chin_surface(mesh, armature, context["chin_surface"])
                measurements = _anatomy_measurements(
                    armature, controls, context["previous"], current_surface["chin_world"]
                )
                surface_metrics = _surface_contact_evidence_bvh(
                    mesh, geometry, current_surface
                )
                record = _stage_d_record(
                    math_module,
                    arm_candidate,
                    arm_record,
                    compensation,
                    compensation_index,
                    quaternions,
                    angles,
                    measurements,
                    surface_metrics,
                    context,
                )
                stage_d_evaluated.append(((arm_candidate, compensation), record))
        stage_d_valid = compensation_stage_survivors(
            stage_d_evaluated, COMPENSATION_STAGE_D_LIMIT
        )
        stage_metrics["D"] = {
            "seed_count": len(compensation_seeds),
            "grid_count_per_seed": len(compensation_grid),
            "input_count": len(stage_d_evaluated),
            "survivor_count": len(stage_d_valid),
            "rejected_count": len(stage_d_evaluated) - len(stage_d_valid),
            "duration_seconds": time.perf_counter() - started,
        }
        print("POC_STATIC_STAGE_D", stage_metrics["D"])

        started = time.perf_counter()
        stage_e_input = compensation_stage_survivors(
            stage_d_valid, COMPENSATION_STAGE_E_LIMIT
        )
        compensated_vertices = {}
        for (arm_candidate, compensation), record in stage_e_input:
            _apply_compensated_state(
                armature, controls, arm_candidate, compensation, context
            )
            collision_metrics, vertices = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            _stage_e_update(math_module, record, collision_metrics)
            before = record["metrics"]["collision_before_compensation"]
            record["metrics"]["compensation_improves_evidence"] = (
                compensation_improves_evidence(
                    before,
                    record["metrics"],
                    warning_distance=context["chin_surface"]["band"].warning_distance,
                )
                if before.get("torso_penetration_count") is not None
                else False
            )
            compensated_vertices[record["source_candidate_id"]] = vertices
        stage_e_valid = sorted(
            (item for item in stage_e_input if item[1]["valid"]),
            key=lambda item: (not item[1].get("selection_eligible", False), *_compensation_contact_rank(item)),
        )
        stage_metrics["E"] = {
            "input_count": len(stage_e_input),
            "survivor_count": len(stage_e_valid),
            "rejected_count": len(stage_e_input) - len(stage_e_valid),
            "duration_seconds": time.perf_counter() - started,
        }
        print("POC_STATIC_STAGE_E", stage_metrics["E"])

        started = time.perf_counter()
        finger_seed_records = {}
        for source_id in FINGER_SEED_IDS:
            candidate = candidate_by_id[source_id]
            _set_compensation_identity(compensation_controls)
            _set_finger_identity(finger_controls)
            _apply_context_candidate(armature, controls, candidate, context)
            measurements = _anatomy_measurements(
                armature, controls, context["previous"], context["chin_world"]
            )
            seed_record = _stage_a_record(math_module, candidate, measurements)
            surface_metrics = _surface_contact_evidence_bvh(
                mesh, geometry, context["chin_surface"]
            )
            _stage_b_update(
                math_module, seed_record, surface_metrics, context["chin_surface"]["band"]
            )
            collision_metrics, _vertices = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            _stage_c_update(math_module, seed_record, collision_metrics)
            elbow = seed_record["metrics"]["elbow_angle_deg"]
            if (
                seed_record["metrics"]["head_collision_count"] != 0
                or seed_record["metrics"]["torso_penetration_count"] != 0
                or not math_module.ELBOW_COMFORT_MIN_DEG <= elbow <= math_module.ELBOW_COMFORT_MAX_DEG
            ):
                raise RuntimeError(f"Semantic finger seed is not collision-free and anatomical: {source_id}")
            finger_seed_records[source_id] = seed_record

        stage_f_evaluated = []
        presets = semantic_finger_presets()
        palm_refinements = finger_palm_refinements()
        finger_compensations = finger_search_compensations()
        for arm_source_id in FINGER_SEED_IDS:
            base_candidate = candidate_by_id[arm_source_id]
            seed_record = finger_seed_records[arm_source_id]
            seed_collision = {
                key: seed_record["metrics"].get(key)
                for key in (
                    "surface_contact_distance", "thumb_index_contact_patch_count",
                    "head_collision_count", "torso_penetration_count", "minimum_clearance",
                )
            }
            for palm_index, palm_refinement in enumerate(palm_refinements):
                for preset_index, preset in enumerate(presets):
                    for compensation_index, compensation in enumerate(finger_compensations):
                        source_id = _finger_source_id(
                            arm_source_id, palm_index, preset_index, compensation_index
                        )
                        candidate = _finger_refined_candidate(
                            base_candidate, palm_refinement, source_id
                        )
                        (
                            compensation_quaternions,
                            compensation_angles,
                            finger_quaternions,
                            finger_solution,
                        ) = _apply_semantic_finger_state(
                            armature, controls, candidate, compensation, preset, context
                        )
                        current_surface = _current_chin_surface(
                            mesh, armature, context["chin_surface"]
                        )
                        measurements = _anatomy_measurements(
                            armature, controls, context["previous"], current_surface["chin_world"]
                        )
                        surface_metrics = _surface_contact_evidence_bvh(
                            mesh, geometry, current_surface
                        )
                        record = _stage_f_record(
                            math_module, candidate, arm_source_id, palm_refinement,
                            preset, compensation, compensation_quaternions,
                            compensation_angles, finger_quaternions, finger_solution,
                            measurements, surface_metrics, seed_collision, context,
                        )
                        stage_f_evaluated.append(((candidate, compensation, preset), record))
        stage_f_valid = finger_stage_survivors(
            stage_f_evaluated,
            seed_ids=FINGER_SEED_IDS,
            limit=FINGER_STAGE_SURVIVOR_LIMIT,
        )
        stage_metrics["F"] = {
            "seed_count": len(finger_seed_records),
            "input_count": len(stage_f_evaluated),
            "survivor_count": len(stage_f_valid),
            "rejected_count": len(stage_f_evaluated) - len(stage_f_valid),
            "duration_seconds": time.perf_counter() - started,
        }
        print("POC_STATIC_STAGE_F", stage_metrics["F"])

        started = time.perf_counter()
        finger_vertices = {}
        for (candidate, compensation, preset), record in stage_f_valid:
            _apply_semantic_finger_state(
                armature, controls, candidate, compensation, preset, context
            )
            collision_metrics, vertices = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            _stage_g_update(
                math_module, record, collision_metrics,
                context["chin_surface"]["band"].warning_distance,
            )
            finger_vertices[record["source_candidate_id"]] = vertices
        stage_g_evaluated = sorted(
            stage_f_valid,
            key=lambda item: (not item[1].get("selection_eligible", False), *_finger_rank_key(item)),
        )
        stage_g_valid = [
            item for item in stage_g_evaluated
            if item[1].get("finger_stage_collision_valid", False)
        ]
        stage_metrics["G"] = {
            "input_count": len(stage_f_valid),
            "survivor_count": len(stage_g_valid),
            "rejected_count": len(stage_f_valid) - len(stage_g_valid),
            "duration_seconds": time.perf_counter() - started,
        }
        print("POC_STATIC_STAGE_G", stage_metrics["G"])
        diagnostic_pool = stage_g_valid or stage_g_evaluated
        reach_diagnostic = finger_reach_diagnostic(
            [record for _state, record in diagnostic_pool],
            warning_distance=context["chin_surface"]["band"].warning_distance,
        )

        diagnostic_state, diagnostic_record = semantic_diagnostic_candidate(
            diagnostic_pool,
            preferred_source_id="candidate_779__finger_p01_s02_c01",
        )
        diagnostic_record["diagnostic_render_evidence"] = _render_semantic_diagnostic(
            paths.temporary,
            armature,
            mesh,
            controls,
            *diagnostic_state,
            context,
        )

        started = time.perf_counter()
        dual_band = derive_dual_contact_band(
            mesh_resolution=context["chin_surface"]["band"].mesh_resolution,
            index_warning_distance=context["chin_surface"]["band"].warning_distance,
        )
        dual_seed_items = sorted(
            (
                item for item in stage_g_valid
                if item[1]["metrics"]["head_collision_count"] == 0
                and item[1]["metrics"]["torso_penetration_count"] == 0
            ),
            key=_finger_rank_key,
        )[:2]
        dual_refinements = dual_contact_refinement_grid()
        stage_h_evaluated = []
        for seed_index, ((seed_candidate, _seed_compensation, seed_preset), seed_record) in enumerate(dual_seed_items):
            for refinement_index, refinement in enumerate(dual_refinements):
                source_id = (
                    f"{seed_record['source_candidate_id']}__dual_"
                    f"{seed_index:02d}_{refinement_index:03d}"
                )
                candidate = _finger_refined_candidate(
                    seed_candidate, refinement.palm_refinement_deg, source_id
                )
                merged_deltas = dict(seed_preset.joint_targets_deg)
                merged_deltas.update(refinement.thumb_targets_deg)
                preset = FingerPosePreset(
                    name=f"{seed_preset.name}_dual", joint_targets_deg=merged_deltas
                )
                compensation = UpperBodyCompensation(
                    0.0, 0.0, 0.0, 0.0,
                    refinement.neck_toward_deg,
                    refinement.head_toward_deg,
                )
                (
                    compensation_quaternions,
                    compensation_angles,
                    finger_quaternions,
                    finger_solution,
                ) = _apply_semantic_finger_state(
                    armature, controls, candidate, compensation, preset, context
                )
                current_surface = _current_chin_surface(
                    mesh, armature, context["chin_surface"]
                )
                measurements = _anatomy_measurements(
                    armature, controls, context["previous"], current_surface["chin_world"]
                )
                surface_metrics = _surface_contact_evidence_bvh(
                    mesh, geometry, current_surface
                )
                seed_collision = {
                    key: seed_record["metrics"].get(key)
                    for key in (
                        "surface_contact_distance", "thumb_index_contact_patch_count",
                        "head_collision_count", "torso_penetration_count", "minimum_clearance",
                    )
                }
                record = _stage_f_record(
                    math_module, candidate, seed_record["arm_source_candidate_id"],
                    refinement.palm_refinement_deg, preset, compensation,
                    compensation_quaternions, compensation_angles,
                    finger_quaternions, finger_solution, measurements,
                    surface_metrics, seed_collision, context,
                )
                record["source_semantic_candidate_id"] = seed_record["source_candidate_id"]
                record["parameters"]["dual_contact_refinement"] = {
                    "neck_toward_deg": refinement.neck_toward_deg,
                    "head_toward_deg": refinement.head_toward_deg,
                    "thumb_targets_deg": refinement.thumb_targets_deg,
                    "palm_refinement_deg": refinement.palm_refinement_deg,
                }
                record["dual_contact_reasons"] = list(
                    dual_contact_reasons(record["metrics"], dual_band)
                )
                record["stage"] = "H"
                stage_h_evaluated.append(((candidate, compensation, preset), record))
        stage_h_valid = sorted(
            (
                item for item in stage_h_evaluated
                if item[1].get("finger_stage_anatomy_valid", False)
            ),
            key=lambda item: (
                len(item[1]["dual_contact_reasons"]),
                max(
                    item[1]["metrics"]["contact_distance_by_source"]["index"] / dual_band.index_warning_distance,
                    item[1]["metrics"]["contact_distance_by_source"]["thumb"] / dual_band.thumb_warning_distance,
                ),
                *_finger_rank_key(item),
            ),
        )[:36]
        stage_metrics["H"] = {
            "seed_count": len(dual_seed_items),
            "grid_count_per_seed": len(dual_refinements),
            "input_count": len(stage_h_evaluated),
            "survivor_count": len(stage_h_valid),
            "rejected_count": len(stage_h_evaluated) - len(stage_h_valid),
            "duration_seconds": time.perf_counter() - started,
        }
        print("POC_STATIC_STAGE_H", stage_metrics["H"])

        started = time.perf_counter()
        dual_vertices = {}
        for (candidate, compensation, preset), record in stage_h_valid:
            _apply_semantic_finger_state(
                armature, controls, candidate, compensation, preset, context
            )
            collision_metrics, vertices = _full_collision_evidence(
                mesh, geometry, context["invariant_collision"]
            )
            _stage_g_update(
                math_module, record, collision_metrics,
                context["chin_surface"]["band"].warning_distance,
            )
            combined_reasons = dual_contact_reasons(record["metrics"], dual_band)
            record["dual_contact_reasons"] = list(combined_reasons)
            if combined_reasons:
                record["selection_eligible"] = False
                record["selection_reasons"] = list(dict.fromkeys([
                    *record.get("selection_reasons", []), *combined_reasons,
                ]))
            record["stage"] = "I"
            dual_vertices[record["source_candidate_id"]] = vertices
        stage_i_valid = sorted(
            (
                item for item in stage_h_valid
                if item[1].get("finger_stage_collision_valid", False)
            ),
            key=lambda item: (
                not item[1].get("selection_eligible", False),
                len(item[1]["dual_contact_reasons"]),
                *_finger_rank_key(item),
            ),
        )
        stage_metrics["I"] = {
            "input_count": len(stage_h_valid),
            "survivor_count": len(stage_i_valid),
            "rejected_count": len(stage_h_valid) - len(stage_i_valid),
            "duration_seconds": time.perf_counter() - started,
        }
        print("POC_STATIC_STAGE_I", stage_metrics["I"])

        if len(stage_i_valid) < STATIC_RENDER_COUNT:
            print("POC_STATIC_STAGE_C_REJECTIONS", [
                {
                    "candidate": record["source_candidate_id"],
                    "surface_contact_distance": record["metrics"].get("surface_contact_distance"),
                    "contact_patch_count": record["metrics"].get("contact_patch_count"),
                    "head_collision_sources": record["metrics"].get("head_collision_sources"),
                    "head_collision_count": record["metrics"].get("head_collision_count"),
                    "torso_penetration_count": record["metrics"].get("torso_penetration_count"),
                    "minimum_clearance": record["metrics"].get("minimum_clearance"),
                    "reasons": record["reasons"],
                }
                for _candidate, record in stage_c_input
            ])
        eligible_count = sum(
            record.get("selection_eligible", False) for _state, record in stage_i_valid
        )
        policy = static_search_policy(
            collision_clear_count=len(stage_i_valid),
            selection_eligible_count=eligible_count,
        )
        eligible_ranked = [
            item for item in stage_i_valid if item[1].get("selection_eligible", False)
        ]
        render_ranked = eligible_ranked[: int(policy["ranked_render_count"])]
        render_evidence = (
            _render_finger_candidates(
                paths.temporary,
                armature,
                controls,
                render_ranked,
                context,
                dual_vertices,
            )
            if render_ranked
            else {"rendered_files": [], "reason": "No selection-eligible collision-clear candidate set"}
        )
        _restore_static_control_state(
            armature, controls, context["baseline_state"], compensation_controls, finger_controls
        )
        restoration_differences = compare_static_state(
            context["baseline_state"],
            _capture_static_control_state(
                armature, controls, compensation_controls, finger_controls
            ),
            1e-6,
        )
        if restoration_differences:
            raise RuntimeError("Static search failed to restore baseline controls: " + "; ".join(restoration_differences))

        rendered_records = [record for _state, record in render_ranked]
        chin_surface = context["chin_surface"]
        metrics = {
            "mode": "search-static",
            "selection_status": policy["selection_status"],
            "run_id": config.run_id,
            "frame": VALIDATION_FRAME,
            "source_blend": str(config.source_blend),
            "output_blend_unchanged": str(config.output_blend),
            "candidate_count": (
                len(candidates) + len(stage_d_evaluated)
                + len(stage_f_evaluated) + len(stage_h_evaluated)
            ),
            "arm_candidate_count": len(candidates),
            "compensation_candidate_count": len(stage_d_evaluated),
            "semantic_finger_candidate_count": len(stage_f_evaluated),
            "dual_contact_candidate_count": len(stage_h_evaluated),
            "rendered_count": len(rendered_records),
            "selection_eligible_count": eligible_count,
            "stage_metrics": stage_metrics,
            "rank_source_mapping": rank_source_mapping(rendered_records),
            "baseline_restored": True,
            "chin_calibration": {
                "pmx_surface": PMX_CHIN_SURFACE,
                "rest_blender": tuple(float(value) for value in context["chin_rest"]),
                "head_local": tuple(float(value) for value in context["chin_local"]),
                "world_frame_150": tuple(float(value) for value in context["chin_world"]),
            },
            "chin_surface": {
                "triangle_count": chin_surface["region"]["triangle_count"],
                "vertex_count": chin_surface["region"]["vertex_count"],
                "calibrated_nearest_world": tuple(float(value) for value in chin_surface["calibrated_nearest_world"]),
                "calibrated_surface_distance": chin_surface["calibrated_surface_distance"],
                "contact_band": {
                    "mesh_resolution": chin_surface["band"].mesh_resolution,
                    "target_distance": chin_surface["band"].target_distance,
                    "warning_distance": chin_surface["band"].warning_distance,
                    "hard_max_distance": chin_surface["band"].hard_max_distance,
                    "region_radius": chin_surface["band"].region_radius,
                },
            },
            "contact_vertex_group_counts": geometry["group_counts"],
            "baseline_contact_anchor": tuple(float(value) for value in context["contact_anchor"]),
            "target_contact_world": tuple(float(value) for value in context["target_contact"]),
            "base_hand_target": tuple(float(value) for value in context["base_hand"]),
            "contact_alignment_delta": tuple(float(value) for value in context["contact_delta"]),
            "pole_search": {
                "basis_derivation": context["pole_basis"]["derivation"],
                "basis_world": {
                    name: tuple(float(value) for value in context["pole_basis"][name])
                    for name in ("outward_lateral", "forward_depth", "vertical")
                },
                "offset_grid": pole_offset_grid(),
                "legacy_candidate_count": sum(candidate.search_family == "legacy_scalar" for candidate in candidates),
                "pole_3d_candidate_count": sum(candidate.search_family == "pole_3d" for candidate in candidates),
            },
            "upper_body_compensation": {
                "seed_source_ids": [
                    candidate.candidate_id for candidate, _record in compensation_seeds
                ],
                "grid_count": len(compensation_grid),
                "limits_degrees": {
                    "upper_chest": UPPER_CHEST_MAX_DEG,
                    "right_shoulder": RIGHT_SHOULDER_MAX_DEG,
                    "neck_head_combined": NECK_HEAD_COMBINED_MAX_DEG,
                },
                "constraint_space": "local bone-space quaternion delta",
                "protected_baseline_hashes": context["protected_pose_hashes"],
            },
            "semantic_finger_search": {
                "seed_source_ids": list(FINGER_SEED_IDS),
                "preset_names": [preset.name for preset in presets],
                "palm_refinements_deg": palm_refinements,
                "compensation_count": len(finger_compensations),
                "flexion_axis": FINGER_FLEXION_AXIS,
                "calibration": "20260702 verified PMX bone-local finger tests; fist flexion is local -X",
                "reach_diagnostic": reach_diagnostic,
                "seed_metrics": {
                    source_id: record["metrics"]
                    for source_id, record in finger_seed_records.items()
                },
            },
            "dual_contact_search": {
                "band": {
                    "mesh_resolution": dual_band.mesh_resolution,
                    "index_warning_distance": dual_band.index_warning_distance,
                    "thumb_target_distance": dual_band.thumb_target_distance,
                    "thumb_warning_distance": dual_band.thumb_warning_distance,
                    "derivation": dual_band.derivation,
                },
                "seed_source_ids": [
                    record["source_candidate_id"] for _state, record in dual_seed_items
                ],
                "best_absolute_diagnostic_source_id": diagnostic_record["source_candidate_id"],
                "best_absolute_diagnostic": diagnostic_record["diagnostic_render_evidence"],
            },
            "render_evidence": render_evidence,
            "diagnostics": diagnostic_records,
            "ranked_candidates": rendered_records,
            "candidates": [record for _candidate, record in evaluated],
            "compensation_candidates": [record for _state, record in stage_d_evaluated],
            "semantic_finger_candidates": [record for _state, record in stage_f_evaluated],
            "dual_contact_candidates": [record for _state, record in stage_h_evaluated],
        }
        temporary_metrics = paths.temporary / STATIC_METRICS_NAME
        temporary_metrics.write_text(
            json.dumps(metrics, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        expected_renders = render_artifact_paths(paths.temporary, len(rendered_records))
        missing_renders = [str(path) for path in expected_renders if not path.is_file()]
        if missing_renders:
            raise RuntimeError("Static run is missing rendered evidence: " + ", ".join(missing_renders))
        if paths.final.exists():
            shutil.rmtree(paths.final)
        paths.temporary.rename(paths.final)
        print("POC_STATIC_SEARCH_COMPLETE", {
            "run_id": config.run_id,
            "evaluated": (
                len(candidates) + len(stage_d_evaluated)
                + len(stage_f_evaluated) + len(stage_h_evaluated)
            ),
            "rendered": len(rendered_records),
            "metrics": str(paths.metrics),
            "selection_status": policy["selection_status"],
        })
    finally:
        _restore_static_control_state(
            armature, controls, context["baseline_state"], compensation_controls, finger_controls
        )


def select_static(config: PocConfig) -> None:
    _require_blender()
    if not config.select_static or config.run_metrics_path is None or config.source_candidate_id is None:
        raise ValueError("Static selection requires --select-static and a reviewed source candidate ID")
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must open the existing POC blend: {config.source_blend}")
    stored_run = json.loads(config.run_metrics_path.read_text(encoding="utf-8"))
    selectable_records = stored_run.get(
        "dual_contact_candidates",
        stored_run.get(
            "semantic_finger_candidates",
            stored_run.get("compensation_candidates", stored_run["candidates"]),
        ),
    )
    stored_record = next(
        (
            record
            for record in selectable_records
            if record["source_candidate_id"] == config.source_candidate_id
        ),
        None,
    )
    if (
        stored_record is None
        or stored_record.get("stage") not in ("C", "E", "G", "I")
        or not stored_record.get("valid")
        or not stored_record.get("selection_eligible")
    ):
        raise ValueError(f"Reviewed source candidate is not selection-eligible: {config.source_candidate_id}")

    armature, mesh = _validate_scene_objects()
    compensation_controls = _ensure_compensation_controls(armature)
    _validate_compensation_baseline(armature, compensation_controls)
    finger_controls = _ensure_finger_controls(armature)
    _validate_finger_baseline(armature, finger_controls)
    controls = _existing_controls()
    _validate_existing_poc(armature, controls)
    math_module = _load_motion_math()
    geometry = _mesh_geometry_sets(mesh)
    context = _prepare_static_context(
        armature, mesh, controls, geometry, math_module,
        compensation_controls, finger_controls,
    )
    candidate = _candidate_from_record(stored_record)
    _apply_context_candidate(armature, controls, candidate, context)
    if stored_record.get("stage") in ("E", "G", "I"):
        compensation = _compensation_from_record(stored_record)
        _apply_upper_body_compensation(armature, context, compensation)
        if stored_record.get("stage") in ("G", "I"):
            _apply_finger_preset(
                armature, context, _finger_preset_from_record(stored_record)
            )
        current_surface = _current_chin_surface(mesh, armature, context["chin_surface"])
    else:
        current_surface = context["chin_surface"]
    measured = _anatomy_measurements(
        armature,
        controls,
        context["previous"],
        current_surface.get("chin_world", context["chin_world"]),
    )
    measured.update(_surface_contact_evidence_bvh(mesh, geometry, current_surface))
    collision_metrics, _vertices = _full_collision_evidence(mesh, geometry, context["invariant_collision"])
    measured.update(collision_metrics)
    differences = compare_selected_metrics(stored_record["metrics"], measured)
    if differences:
        raise RuntimeError("Selected candidate failed reopen remeasurement: " + "; ".join(differences))
    armature["POC_selected_static_candidate"] = candidate.candidate_id
    armature["POC_selected_static_score"] = float(stored_record["score"])
    armature["POC_chin_head_local"] = tuple(float(value) for value in context["chin_local"])
    armature["POC_chin_rest"] = tuple(float(value) for value in context["chin_rest"])
    _save_setup_blend(config.output_blend)
    verification_path = config.run_metrics_path.parent / "selection_verification.json"
    verification_path.write_text(
        json.dumps({
            "mode": "select-static",
            "source_candidate_id": candidate.candidate_id,
            "remeasurement_differences": [],
            "measured_metrics": measured,
            "saved_blend": str(config.output_blend),
        }, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print("POC_STATIC_SELECTED", {"candidate": candidate.candidate_id, "verification": str(verification_path)})


def build_setup(config: PocConfig) -> None:
    _require_blender()
    if not config.setup_only:
        raise ValueError("Task 2 only supports --setup-only; VMD export is intentionally disabled")
    current_blend = Path(bpy.data.filepath)
    if not current_blend or not _same_path(current_blend, config.source_blend):
        raise RuntimeError(f"Blender must be opened with the requested source blend: {config.source_blend}")

    armature, _mesh = _validate_scene_objects()
    action = _import_reference_action(config, armature)
    bpy.context.scene.frame_start = config.frame_start
    bpy.context.scene.frame_end = config.frame_end
    bpy.context.scene.frame_set(VALIDATION_FRAME)
    _create_proxy_chain(armature)
    controls = _create_controls(armature)
    _create_constraints(armature, controls)
    compensation_controls = _ensure_compensation_controls(armature)
    _validate_compensation_baseline(armature, compensation_controls)
    finger_controls = _ensure_finger_controls(armature)
    _validate_finger_baseline(armature, finger_controls)
    _validate_setup(armature, action, controls)

    config.output_dir.mkdir(parents=True, exist_ok=True)
    config.output_blend.parent.mkdir(parents=True, exist_ok=True)
    _save_setup_blend(config.output_blend)
    print(f"POC_SETUP_SAVED {config.output_blend}")


def main(argv: Sequence[str] | None = None) -> int:
    config = parse_blender_args(argv)
    if config.setup_only:
        build_setup(config)
    elif config.search_static:
        search_static(config)
    elif config.select_static:
        select_static(config)
    elif config.orientation_gallery:
        orientation_gallery(config)
    elif config.chin_support_refinement:
        chin_support_refinement(config)
    elif config.collision_severity_diagnostic:
        collision_severity_diagnostic(config)
    elif config.sleeve_corrective_feasibility:
        sleeve_corrective_feasibility(config)
    else:
        raise ValueError("No POC mode selected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
