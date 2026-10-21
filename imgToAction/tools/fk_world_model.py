"""PMX forward-kinematics world model for iterative arm-chain correction.

Given VMD bone rotations and PMX T-pose bone positions, this module predicts
bone world positions and checks front-depth constraints. If the wrist falls
behind the torso, it iteratively adjusts the arm-chain rotations until the
constraint is satisfied.

This is the "world model" approach: predict, check, correct, in a closed loop,
all within PMX coordinate space.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any, Iterable

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from skeleton_motion import dot, length, sub, add, mul, normalize, validate_skeleton  # noqa: E402

IDENTITY_QUAT = (0.0, 0.0, 0.0, 1.0)


def _quat_normalize(q: tuple) -> tuple:
    n = math.sqrt(sum(c * c for c in q))
    if n <= 1e-8:
        return IDENTITY_QUAT
    return tuple(c / n for c in q)


def _quat_mul(l: tuple, r: tuple) -> tuple:
    lx, ly, lz, lw = l
    rx, ry, rz, rw = r
    return _quat_normalize((
        lw * rx + lx * rw + ly * rz - lz * ry,
        lw * ry - lx * rz + ly * rw + lz * rx,
        lw * rz + lx * ry - ly * rx + lz * rw,
        lw * rw - lx * rx - ly * ry - lz * rz,
    ))


def _quat_conj(q: tuple) -> tuple:
    return _quat_normalize((-q[0], -q[1], -q[2], q[3]))


def _quat_vec(q: tuple, v: list) -> list:
    """Rotate vector v by quaternion q."""
    x, y, z, w = q
    vx, vy, vz = v
    # q * v * q_conj (optimized)
    t = [2.0 * (y * vz - z * vy), 2.0 * (z * vx - x * vz), 2.0 * (x * vy - y * vx)]
    return [
        vx + w * t[0] + y * t[2] - z * t[1],
        vy + w * t[1] + z * t[0] - x * t[2],
        vz + w * t[2] + x * t[1] - y * t[0],
    ]


def _quat_axis_angle(axis: list, radians: float) -> tuple:
    ax = normalize(axis)
    half = radians * 0.5
    s = math.sin(half)
    return _quat_normalize((ax[0] * s, ax[1] * s, ax[2] * s, math.cos(half)))


def _quat_between(src: list, dst: list) -> tuple:
    """Quaternion rotating src direction to dst direction."""
    s = normalize(src)
    d = normalize(dst)
    dot_v = max(-1.0, min(1.0, dot(s, d)))
    if dot_v > 1.0 - 1e-8:
        return IDENTITY_QUAT
    if dot_v < -1.0 + 1e-8:
        # 180-degree rotation, find perpendicular axis
        fb = sub([1.0, 0.0, 0.0], mul(s, dot([1.0, 0.0, 0.0], s)))
        if length(fb) < 1e-8:
            fb = sub([0.0, 1.0, 0.0], mul(s, dot([0.0, 1.0, 0.0], s)))
        axis = normalize(fb)
        return _quat_axis_angle(axis, math.pi)
    cross_v = [
        s[1] * d[2] - s[2] * d[1],
        s[2] * d[0] - s[0] * d[2],
        s[0] * d[1] - s[1] * d[0],
    ]
    axis = normalize(cross_v)
    angle = math.acos(dot_v)
    return _quat_axis_angle(axis, angle)


# PMX model space constants (from mmd-parser bone data).
# The PMX model uses absolute bone positions in model space.
# A uniform scale S=0.9 and Z-axis flip maps PMX model space to render world space:
#   render = [S*pmx_x + BX, S*pmx_y + BY, -S*pmx_z + BZ]
PMX_SCALE = 0.9
PMX_OFFSET = (0.0, -9.738, 0.697)

# PMX absolute bone positions (model space, from mmd-parser)
PMX_BONE_POSITIONS = {
    "右肩":   [-0.274, 17.529, -0.226],
    "右肩C":  [-1.417, 17.305, -0.006],
    "右腕":   [-1.417, 17.305, -0.006],
    "右腕捩": [-2.810, 16.159, 0.036],
    "右ひじ": [-3.739, 15.395, 0.122],
    "右手捩": [-4.983, 14.478, 0.068],
    "右手首": [-5.813, 13.866, 0.033],
    "左肩":   [0.274, 17.529, -0.226],
    "左肩C":  [1.417, 17.305, -0.006],
    "左腕":   [1.417, 17.305, -0.006],
    "左腕捩": [2.810, 16.159, 0.036],
    "左ひじ": [3.739, 15.395, 0.122],
    "左手捩": [4.983, 14.478, 0.068],
    "左手首": [5.813, 13.866, 0.033],
    "下半身": [0.0, 13.541, -0.790],
    "上半身": [0.0, 13.715, -0.802],
    "上半身2": [0.0, 15.725, -0.831],
    "首":     [0.0, 17.942, -0.228],
    "頭":     [0.0, 18.855, -0.317],
}

# PMX bone local offsets (child.pos - parent.pos, in model space)
# Right arm chain: 右肩 → 右肩C → 右腕 → 右腕捩 → 右ひじ → 右手捩 → 右手首
PMX_RIGHT_ARM_OFFSETS = {
    "右肩C":  [-1.143, -0.224, 0.220],   # 右肩C.pos - 右肩.pos
    "右腕捩": [-1.393, -1.146, 0.042],   # 右腕捩.pos - 右腕.pos (右腕 has zero offset)
    "右ひじ": [-0.929, -0.764, 0.086],   # 右ひじ.pos - 右腕捩.pos
    "右手捩": [-1.244, -0.917, -0.054],  # 右手捩.pos - 右ひじ.pos
    "右手首": [-0.830, -0.612, -0.035],  # 右手首.pos - 右手捩.pos
}

# Left arm offsets (mirrored X)
PMX_LEFT_ARM_OFFSETS = {
    "左肩C":  [1.143, -0.224, 0.220],
    "左腕捩": [1.393, -1.146, 0.042],
    "左ひじ": [0.929, -0.764, 0.086],
    "左手捩": [1.244, -0.917, -0.054],
    "左手首": [0.830, -0.612, -0.035],
}

def _pmx_to_render(p: list) -> list:
    """Convert PMX model-space position to render world-space."""
    return [
        PMX_SCALE * p[0] + PMX_OFFSET[0],
        PMX_SCALE * p[1] + PMX_OFFSET[1],
        -PMX_SCALE * p[2] + PMX_OFFSET[2],
    ]


def _render_to_pmx(r: list) -> list:
    """Convert render world-space position to PMX model-space."""
    return [
        (r[0] - PMX_OFFSET[0]) / PMX_SCALE,
        (r[1] - PMX_OFFSET[1]) / PMX_SCALE,
        -(r[2] - PMX_OFFSET[2]) / PMX_SCALE,
    ]


# Render-space T-pose positions (computed from PMX via scale + Z-flip)
# Kept for backward compatibility with code that reads render positions.
DEFAULT_TPOSE_PROBE = {
    "right_shoulder": _pmx_to_render(PMX_BONE_POSITIONS["右肩"]),
    "right_elbow":    _pmx_to_render(PMX_BONE_POSITIONS["右ひじ"]),
    "right_wrist":    _pmx_to_render(PMX_BONE_POSITIONS["右手首"]),
    "left_shoulder":  _pmx_to_render(PMX_BONE_POSITIONS["左肩"]),
    "left_elbow":     _pmx_to_render(PMX_BONE_POSITIONS["左ひじ"]),
    "left_wrist":     _pmx_to_render(PMX_BONE_POSITIONS["左手首"]),
    "chin":           [0.0, 6.8534, 1.1435],  # from T-pose render probe
    "waist":          _pmx_to_render(PMX_BONE_POSITIONS["下半身"]),
}


def compute_front_axis(shoulder_l: list, shoulder_r: list, waist: list) -> list:
    """Compute the body-local front axis from shoulder and waist positions.

    In render space, +Z is the front of the character (toward camera).
    render_Z = -PMX_SCALE * pmx_Z + offset, so PMX Z- (front) maps to render Z+.
    Front direction = cross(shoulder_axis, up) which gives +Z.
    """
    shoulder_axis = normalize(sub(shoulder_l, shoulder_r))
    up = normalize(sub(shoulder_r, waist))
    front = [
        shoulder_axis[1] * up[2] - shoulder_axis[2] * up[1],
        shoulder_axis[2] * up[0] - shoulder_axis[0] * up[2],
        shoulder_axis[0] * up[1] - shoulder_axis[1] * up[0],
    ]
    front = normalize(front)
    return front


def fk_arm_chain(
    shoulder_pos: list,
    shoulder_world_quat: tuple,
    upper_local_quat: tuple,
    lower_local_quat: tuple,
    rest_upper: list,
    rest_lower: list,
    arm_side: str = "right",
) -> dict[str, list]:
    """Forward-kinematics for the right arm chain in PMX model space.

    Uses the full PMX bone hierarchy:
        右肩 → 右肩C → 右腕 → 右腕捩 → 右ひじ → 右手捩 → 右手首

    Bones 右肩C, 右腕捩, 右手捩 have no VMD rotation (identity).
    右腕 has zero-length offset (same position as 右肩C).

    Args:
        shoulder_pos: 右肩 world position in PMX model space.
        shoulder_world_quat: 右肩 accumulated world rotation.
        upper_local_quat: 右腕 local rotation (relative to 右肩C).
        lower_local_quat: 右ひじ local rotation (relative to 右腕捩).
        rest_upper: unused (kept for API compatibility).
        rest_lower: unused (kept for API compatibility).

    Returns:
        Dict with elbow_pos, wrist_pos, upper_world_quat, lower_world_quat.
        Positions are in PMX model space (use _pmx_to_render to convert).
    """
    # PMX bone local offsets — select right or left arm offsets
    if arm_side == "left":
        offsets = PMX_LEFT_ARM_OFFSETS
    else:
        offsets = PMX_RIGHT_ARM_OFFSETS
    shoulderC_offset = offsets["左肩C"] if arm_side == "left" else offsets["右肩C"]
    twist1_offset = offsets["左腕捩"] if arm_side == "left" else offsets["右腕捩"]
    elbow_offset = offsets["左ひじ"] if arm_side == "left" else offsets["右ひじ"]
    twist2_offset = offsets["左手捩"] if arm_side == "left" else offsets["右手捩"]
    wrist_offset = offsets["左手首"] if arm_side == "left" else offsets["右手首"]

    # World rotations (standard right-handed quaternion math, no Z-flip needed)
    # 右肩C world = shoulder_world (identity local + no grant effect)
    shoulderC_world = shoulder_world_quat
    # 右腕 world = shoulderC_world * upper_local
    upper_world = _quat_mul(shoulderC_world, upper_local_quat)
    # 右腕捩 world = upper_world (identity local)
    twist1_world = upper_world
    # 右ひじ world = twist1_world * lower_local
    lower_world = _quat_mul(twist1_world, lower_local_quat)
    # 右手捩 world = lower_world (identity local)
    twist2_world = lower_world

    # Compute positions in PMX model space
    # 右肩C position = shoulder_pos + shoulder_world * shoulderC_offset
    shoulderC_pos = add(shoulder_pos, _quat_vec(shoulder_world_quat, shoulderC_offset))
    # 右腕 position = shoulderC_pos (zero-length offset)
    upper_pos = shoulderC_pos
    # 右腕捩 position = upper_pos + upper_world * twist1_offset
    twist1_pos = add(upper_pos, _quat_vec(upper_world, twist1_offset))
    # 右ひじ position = twist1_pos + twist1_world * elbow_offset
    elbow_pos = add(twist1_pos, _quat_vec(twist1_world, elbow_offset))
    # 右手捩 position = elbow_pos + lower_world * twist2_offset
    twist2_pos = add(elbow_pos, _quat_vec(lower_world, twist2_offset))
    # 右手首 position = twist2_pos + twist2_world * wrist_offset
    wrist_pos = add(twist2_pos, _quat_vec(twist2_world, wrist_offset))

    return {
        "elbow_pos": elbow_pos,
        "wrist_pos": wrist_pos,
        "upper_world_quat": upper_world,
        "lower_world_quat": lower_world,
    }


def correct_arm_front_depth(
    shoulder_pos: list,
    shoulder_world_quat: tuple,
    upper_local_quat: tuple,
    lower_local_quat: tuple,
    rest_upper: list,
    rest_lower: list,
    front_axis: list,
    min_front_depth: float = 0.1,
    max_iterations: int = 30,
    correction_step: float = 0.1,
    arm_side: str = "right",
) -> tuple[tuple, tuple, dict[str, Any]]:
    """Iteratively correct upper arm rotation to push wrist forward.

    With the calibrated FK model, standard cross(arm_dir, front) is the correct
    correction direction (no reversed axis needed). The FK prediction now
    matches PMX render, so convergence checks are reliable.

    Returns corrected (upper_local_quat, lower_local_quat) and a report dict.
    """
    upper_q = upper_local_quat
    report = {"iterations": 0, "initial_front_depth": None, "final_front_depth": None, "converged": False}

    fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_q, lower_local_quat, rest_upper, rest_lower, arm_side=arm_side)
    wrist_offset_pmx = sub(fk["wrist_pos"], shoulder_pos)
    # Convert to render space for front_depth check
    wrist_offset_render = [PMX_SCALE * wrist_offset_pmx[0], PMX_SCALE * wrist_offset_pmx[1], -PMX_SCALE * wrist_offset_pmx[2]]
    fd_initial = dot(wrist_offset_render, front_axis)
    report["initial_front_depth"] = round(fd_initial, 4)

    if fd_initial >= min_front_depth:
        report["final_front_depth"] = round(fd_initial, 4)
        report["converged"] = True
        return upper_q, lower_local_quat, report

    for iteration in range(max_iterations):
        fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_q, lower_local_quat, rest_upper, rest_lower, arm_side=arm_side)
        wrist_offset_pmx = sub(fk["wrist_pos"], shoulder_pos)
        wrist_offset_render = [PMX_SCALE * wrist_offset_pmx[0], PMX_SCALE * wrist_offset_pmx[1], -PMX_SCALE * wrist_offset_pmx[2]]
        fd = dot(wrist_offset_render, front_axis)
        report["final_front_depth"] = round(fd, 4)

        if fd >= min_front_depth:
            report["converged"] = True
            report["iterations"] = iteration
            break

        # Standard correction axis: cross(arm_dir, front) pushes wrist forward
        arm_dir = normalize(wrist_offset_pmx)
        # front_axis is in render space; convert to PMX space for cross product
        front_pmx = [front_axis[0] / PMX_SCALE, front_axis[1] / PMX_SCALE, -front_axis[2] / PMX_SCALE]
        front_pmx = normalize(front_pmx)
        corr_axis = [
            arm_dir[1] * front_pmx[2] - arm_dir[2] * front_pmx[1],
            arm_dir[2] * front_pmx[0] - arm_dir[0] * front_pmx[2],
            arm_dir[0] * front_pmx[1] - arm_dir[1] * front_pmx[0],
        ]
        if length(corr_axis) < 1e-8:
            corr_axis = [1.0, 0.0, 0.0]
        correction = _quat_axis_angle(corr_axis, correction_step)
        upper_q = _quat_mul(correction, upper_q)
        report["iterations"] = iteration + 1

    return upper_q, lower_local_quat, report


def _correct_arm_at_frame(
    bones: dict,
    frame_no: int,
    arm_side: str,
    front_axis: list,
    chin_pmx: list,
    min_front_depth: float,
    max_iterations: int,
    upper_length: float,
    lower_length: float,
    rs_render: list,
    ls_render: list | None = None,
    waist_render: list | None = None,
    chin_render_offset: float = 0.3,
    elbow_forward_offset: float = 3.5,
    fk_func=None,
    fabrik_func=None,
    clamp_func=None,
) -> tuple[list, dict]:
    """Correct one arm (left or right) using FABRIK IK.

    Args:
        arm_side: "right" or "left".

    Returns (corrected_bone_frames, report_dict).
    """
    from vmd_io import BoneFrame

    if fk_func is None:
        fk_func = fk_arm_chain
    if fabrik_func is None:
        fabrik_func = fabrik_two_bone_ik
    if clamp_func is None:
        clamp_func = clamp_elbow_angle
    if ls_render is None:
        ls_render = rs_render
    if waist_render is None:
        waist_render = DEFAULT_TPOSE_PROBE["waist"]

    if arm_side == "right":
        shoulder_bone = "右肩"
        upper_bone_name = "右腕"
        lower_bone_name = "右ひじ"
        shoulder_pos_pmx = list(PMX_BONE_POSITIONS["右肩"])
    else:
        shoulder_bone = "左肩"
        upper_bone_name = "左腕"
        lower_bone_name = "左ひじ"
        shoulder_pos_pmx = list(PMX_BONE_POSITIONS["左肩"])

    # Accumulate shoulder world rotation from torso chain
    chain_names = ["下半身", "上半身", "上半身2", shoulder_bone]
    shoulder_world = IDENTITY_QUAT
    for name in chain_names:
        b = bones.get(name)
        if b:
            shoulder_world = _quat_mul(shoulder_world, b.rotation)

    upper_bone = bones.get(upper_bone_name)
    lower_bone = bones.get(lower_bone_name)

    if upper_bone is None or lower_bone is None:
        return [], {"arm": arm_side, "corrected": False, "reason": "missing_bones"}

    upper_q = upper_bone.rotation
    lower_q = lower_bone.rotation

    # Check current wrist front-depth before applying any IK correction.
    # Only correct when the wrist is behind the torso (front_depth < min_front_depth).
    # This preserves the original BVH motion timeline (raise/lower phases).
    fk_check = fk_func(shoulder_pos_pmx, shoulder_world, upper_q, lower_q, [], [], arm_side=arm_side)
    wrist_check_pmx = fk_check["wrist_pos"]
    elbow_check_pmx = fk_check["elbow_pos"]
    wrist_check_render = _pmx_to_render(wrist_check_pmx)
    elbow_check_render = _pmx_to_render(elbow_check_pmx)
    arm_root_render = rs_render if arm_side == "right" else ls_render
    wrist_fd_check = dot([wrist_check_render[i] - arm_root_render[i] for i in range(3)], front_axis)
    elbow_fd_check = dot([elbow_check_render[i] - arm_root_render[i] for i in range(3)], front_axis)

    # Also check torso core clearance: elbow and wrist must be far enough
    # from the body centerline (XZ plane distance from torso axis).
    # Torso core is at X=0 in render space.
    elbow_clear = math.sqrt(elbow_check_render[0]**2 + (elbow_check_render[2] - waist_render[2])**2)
    wrist_clear = math.sqrt(wrist_check_render[0]**2 + (wrist_check_render[2] - waist_render[2])**2)
    min_torso_clear = 0.45  # matches render quality gate threshold

    # Only correct when the arm is actually near the torso (potential clipping).
    # When the arm is hanging naturally (elbow far from torso), negative
    # front_depth is expected and should NOT trigger IK correction.
    arm_near_torso = elbow_clear < min_torso_clear * 1.5 or wrist_clear < min_torso_clear * 1.5

    if not arm_near_torso:
        return [], {
            "arm": arm_side, "corrected": False, "reason": "arm_away_from_torso",
            "wrist_front_depth": round(wrist_fd_check, 4),
            "elbow_front_depth": round(elbow_fd_check, 4),
            "elbow_clear": round(elbow_clear, 4),
            "wrist_clear": round(wrist_clear, 4),
        }

    if (wrist_fd_check >= min_front_depth and elbow_fd_check >= min_front_depth
            and elbow_clear >= min_torso_clear and wrist_clear >= min_torso_clear):
        # No correction needed - preserve original BVH motion
        return [], {
            "arm": arm_side, "corrected": False, "reason": "front_depth_ok",
            "wrist_front_depth": round(wrist_fd_check, 4),
            "elbow_front_depth": round(elbow_fd_check, 4),
            "elbow_clear": round(elbow_clear, 4),
            "wrist_clear": round(wrist_clear, 4),
        }

    # Compute wrist target based on current wrist height.
    # Only target chin position when the wrist is already raised near chin level
    # (the BVH source motion has entered the thinking-pose hold phase).
    # When the arm is still lowered (wrist below shoulder), just push forward
    # to clear the torso without redirecting to the chin.
    chin_render = DEFAULT_TPOSE_PROBE["chin"]
    chin_y_render = chin_render[1]
    shoulder_y_render = rs_render[1]
    wrist_y_render = wrist_check_render[1]

    if arm_side == "right":
        # If wrist is within 1.5 units of chin height, target the chin
        if abs(wrist_y_render - chin_y_render) < 1.5:
            target_wrist_pmx = list(chin_pmx)
        else:
            # Arm is lowered: just push wrist forward from current position
            # to clear torso, don't redirect to chin
            target_wrist_pmx = list(wrist_check_pmx)
    else:
        # Left arm: use waist position with lateral offset
        waist_pmx = _render_to_pmx(DEFAULT_TPOSE_PROBE["waist"])
        target_wrist_pmx = [waist_pmx[0] + 1.6, waist_pmx[1], waist_pmx[2]]

    # Push target forward in front_axis direction (PMX space)
    front_pmx = normalize([front_axis[0] / PMX_SCALE, front_axis[1] / PMX_SCALE, -front_axis[2] / PMX_SCALE])
    target_wrist_pmx = [target_wrist_pmx[i] + front_pmx[i] * chin_render_offset for i in range(3)]

    # Compute elbow target: push forward only (height lift causes wrist overshoot)
    fk = fk_func(shoulder_pos_pmx, shoulder_world, upper_q, lower_q, [], [], arm_side=arm_side)
    elbow_pmx = fk["elbow_pos"]
    elbow_target_pmx = [elbow_pmx[i] + front_pmx[i] * elbow_forward_offset for i in range(3)]

    # Run FABRIK
    upper_new, lower_new, ik_report = fabrik_func(
        shoulder_pos_pmx, shoulder_world, upper_q, lower_q,
        target_wrist_pmx, elbow_target_pmx,
        upper_length, lower_length,
        max_iterations=max_iterations,
        arm_side=arm_side,
    )

    # Apply joint angle limits (Stage 3)
    upper_new, lower_new = clamp_func(
        shoulder_pos_pmx, shoulder_world, upper_new, lower_new,
        min_angle=22.0, max_angle=170.0, arm_side=arm_side,
    )

    report = {
        "arm": arm_side,
        "corrected": True,
        "ik_iterations": ik_report["iterations"],
        "ik_converged": ik_report["converged"],
        "wrist_error": ik_report.get("wrist_error"),
    }

    # Verify correction in render space
    fk2 = fk_func(shoulder_pos_pmx, shoulder_world, upper_new, lower_new, [], [], arm_side=arm_side)
    wrist2_render = _pmx_to_render(fk2["wrist_pos"])
    wrist2_offset = [wrist2_render[i] - rs_render[i] for i in range(3)]
    wrist2_fd = dot(wrist2_offset, front_axis)
    report["final_front_depth"] = round(wrist2_fd, 4)

    # Rebuild only the arm bones for this side
    arm_frames = []
    for bone_name, bone_frame in bones.items():
        if bone_name == upper_bone_name:
            arm_frames.append(BoneFrame(
                bone_name, frame_no, bone_frame.position, upper_new,
                bone_frame.interpolation,
            ))
        elif bone_name == lower_bone_name:
            arm_frames.append(BoneFrame(
                bone_name, frame_no, bone_frame.position, lower_new,
                bone_frame.interpolation,
            ))

    return arm_frames, report


def apply_fabrik_arm_correction(
    vmd_frames: list,
    tpose_probe: dict[str, list] | None = None,
    min_front_depth: float = 0.1,
    max_iterations: int = 40,
) -> tuple[list, dict[str, Any]]:
    """Apply FABRIK IK correction to both arms.

    Right arm: push wrist toward chin, elbow forward.
    Left arm: push wrist toward waist rest position, elbow forward to clear torso.

    Uses the calibrated FK model and FABRIK two-bone IK for each arm.

    Args:
        vmd_frames: List of BoneFrame objects from the retargeter.
        tpose_probe: Unused (PMX data is built-in).
        min_front_depth: Minimum required front-depth.
        max_iterations: Max FABRIK iterations.

    Returns:
        (corrected_frames, report)
    """
    probe = DEFAULT_TPOSE_PROBE
    rs_render = probe["right_shoulder"]
    ls_render = probe["left_shoulder"]
    waist_render = probe["waist"]
    chin_render = probe["chin"]
    front_axis = compute_front_axis(ls_render, rs_render, waist_render)

    # PMX positions
    chin_pmx = _render_to_pmx(chin_render)

    # Bone lengths in PMX space (same for both arms, mirrored)
    upper_length = math.sqrt(sum(c * c for c in [-2.322, -1.910, 0.128]))
    lower_length = math.sqrt(sum(c * c for c in [-2.074, -1.529, -0.089]))

    frame_map: dict[int, dict[str, Any]] = {}
    for f in vmd_frames:
        if f.frame not in frame_map:
            frame_map[f.frame] = {}
        frame_map[f.frame][f.bone] = f

    corrected = []
    total_corrections = 0
    frame_reports = []

    for frame_no in sorted(frame_map.keys()):
        bones = frame_map[frame_no]
        report = {"frame": frame_no, "corrected": False}

        # Process right arm
        right_frames, right_report = _correct_arm_at_frame(
            bones, frame_no, "right", front_axis, chin_pmx,
            min_front_depth, max_iterations,
            upper_length, lower_length, rs_render, ls_render, waist_render,
        )
        # Process left arm (always correct to ensure clearance)
        left_frames, left_report = _correct_arm_at_frame(
            bones, frame_no, "left", front_axis, chin_pmx,
            min_front_depth, max_iterations,
            upper_length, lower_length, rs_render, ls_render, waist_render,
        )

        # Build corrected frame: replace arm bones, keep everything else
        right_arm_names = {"右腕", "右ひじ"}
        left_arm_names = {"左腕", "左ひじ"}
        arm_names = right_arm_names | left_arm_names

        for bone_name, bone_frame in bones.items():
            if bone_name in right_arm_names:
                # Use corrected version
                for rf in right_frames:
                    if rf.bone == bone_name:
                        corrected.append(rf)
                        break
                else:
                    corrected.append(bone_frame)
            elif bone_name in left_arm_names:
                for lf in left_frames:
                    if lf.bone == bone_name:
                        corrected.append(lf)
                        break
                else:
                    corrected.append(bone_frame)
            else:
                corrected.append(bone_frame)

        report["right"] = right_report
        report["left"] = left_report
        report["corrected"] = right_report.get("corrected", False) or left_report.get("corrected", False)
        if report["corrected"]:
            total_corrections += 1
        frame_reports.append(report)

    # Stage 4: Enhanced motion smoothing with per-bone velocity + acceleration limits
    corrected, smoothing_stats = apply_motion_smoothing_v2(corrected)

    return corrected, {
        "total_frames": len(frame_map),
        "total_corrections": total_corrections,
        "min_front_depth": min_front_depth,
        "front_axis": [round(x, 4) for x in front_axis],
        "frames": frame_reports,
        "smoothing_stats": smoothing_stats,
        "stages_applied": ["torso_lean_compensation", "collision_avoidance", "joint_angle_limits", "priority_constraints", "motion_smoothing_v2"],
    }


def apply_fk_world_model_correction(
    vmd_frames: list,
    tpose_probe: dict[str, list] | None = None,
    min_front_depth: float = 0.1,
    max_iterations: int = 30,
) -> tuple[list, dict[str, Any]]:
    """Apply FK world-model correction to VMD bone frames using calibrated PMX FK.

    Uses the full PMX bone hierarchy (右肩C, twist bones) for accurate FK
    prediction. Standard correction axis (no reversed axis trick needed).

    Corrects both upper arm (右腕) and forearm (右ひじ) to ensure:
    - Wrist front_depth >= min_front_depth
    - Elbow front_depth >= min_front_depth

    Args:
        vmd_frames: List of BoneFrame objects from the retargeter.
        tpose_probe: Unused (kept for API compatibility). PMX data is built-in.
        min_front_depth: Minimum required front-depth.
        max_iterations: Max correction iterations per frame.

    Returns:
        (corrected_frames, report)
    """
    from vmd_io import BoneFrame

    probe = DEFAULT_TPOSE_PROBE
    rs_render = probe["right_shoulder"]
    ls_render = probe["left_shoulder"]
    waist_render = probe["waist"]
    front_axis = compute_front_axis(ls_render, rs_render, waist_render)

    # PMX model-space shoulder position (for FK computation)
    shoulder_pos_pmx = list(PMX_BONE_POSITIONS["右肩"])

    frame_map: dict[int, dict[str, BoneFrame]] = {}
    for f in vmd_frames:
        if f.frame not in frame_map:
            frame_map[f.frame] = {}
        frame_map[f.frame][f.bone] = f

    corrected = []
    total_corrections = 0
    frame_reports = []

    for frame_no in sorted(frame_map.keys()):
        bones = frame_map[frame_no]
        report = {"frame": frame_no, "corrected": False}

        # Accumulate shoulder world rotation from torso chain
        chain_names = ["下半身", "上半身", "上半身2", "右肩"]
        shoulder_world = IDENTITY_QUAT
        for name in chain_names:
            b = bones.get(name)
            if b:
                shoulder_world = _quat_mul(shoulder_world, b.rotation)

        upper_bone = bones.get("右腕")
        lower_bone = bones.get("右ひじ")

        if upper_bone is None or lower_bone is None:
            for b in bones.values():
                corrected.append(b)
            continue

        # Stage 6: Torso lean compensation — if wrist target is beyond arm reach,
        # lean upper body forward to reduce distance.
        # This runs before arm IK so the shoulder position is adjusted first.
        chin_pmx = _render_to_pmx(DEFAULT_TPOSE_PROBE["chin"])
        bones, torso_report = apply_torso_lean_compensation(
            bones, list(shoulder_pos_pmx), front_axis,
            wrist_target_pmx=chin_pmx, max_lean_degrees=10.0, lean_step=0.5,
        )
        if torso_report["lean_applied"]:
            shoulder_pos_pmx = torso_report["modified_shoulder_pos"]
            report["torso_lean"] = torso_report

        upper_q = upper_bone.rotation
        lower_q = lower_bone.rotation

        # --- Step 1: Correct forearm (elbow front-depth) first ---
        # This ensures the elbow is in front before we correct the wrist.
        # If we correct the wrist first, the forearm correction may shift it back.
        fk = fk_arm_chain(
            shoulder_pos_pmx, shoulder_world, upper_q, lower_q, [], [], arm_side="right"
        )
        wrist_offset_pmx = sub(fk["wrist_pos"], shoulder_pos_pmx)
        wrist_offset_render = [PMX_SCALE * wrist_offset_pmx[0],
                                PMX_SCALE * wrist_offset_pmx[1],
                                -PMX_SCALE * wrist_offset_pmx[2]]
        wrist_fd = dot(wrist_offset_render, front_axis)

        upper_corrected = False
        if wrist_fd < min_front_depth:
            upper_q, _, corr_report = correct_arm_front_depth(
                shoulder_pos_pmx, shoulder_world, upper_q, lower_q, [], [],
                front_axis, min_front_depth=min_front_depth,
                max_iterations=max_iterations, arm_side="right",
            )
            report["corrected"] = True
            report["initial_front_depth"] = corr_report["initial_front_depth"]
            report["final_front_depth"] = corr_report["final_front_depth"]
            report["iterations"] = corr_report["iterations"]
            report["converged"] = corr_report["converged"]
            upper_corrected = True
            total_corrections += 1

        # --- Check and correct forearm (elbow front-depth) ---
        fk2 = fk_arm_chain(
            shoulder_pos_pmx, shoulder_world, upper_q, lower_q, [], [], arm_side="right"
        )
        elbow_offset_pmx = sub(fk2["elbow_pos"], shoulder_pos_pmx)
        elbow_offset_render = [PMX_SCALE * elbow_offset_pmx[0],
                                PMX_SCALE * elbow_offset_pmx[1],
                                -PMX_SCALE * elbow_offset_pmx[2]]
        elbow_fd = dot(elbow_offset_render, front_axis)

        lower_corrected = False
        if elbow_fd < min_front_depth:
            # Correct forearm rotation
            arm_dir = normalize(elbow_offset_pmx)
            front_pmx = normalize([front_axis[0] / PMX_SCALE, front_axis[1] / PMX_SCALE, -front_axis[2] / PMX_SCALE])
            corr_axis = [
                arm_dir[1] * front_pmx[2] - arm_dir[2] * front_pmx[1],
                arm_dir[2] * front_pmx[0] - arm_dir[0] * front_pmx[2],
                arm_dir[0] * front_pmx[1] - arm_dir[1] * front_pmx[0],
            ]
            if length(corr_axis) < 1e-8:
                corr_axis = [1.0, 0.0, 0.0]

            for i in range(max_iterations):
                fk3 = fk_arm_chain(
                    shoulder_pos_pmx, shoulder_world, upper_q, lower_q, [], [], arm_side="right"
                )
                eo = sub(fk3["elbow_pos"], shoulder_pos_pmx)
                eo_render = [PMX_SCALE * eo[0], PMX_SCALE * eo[1], -PMX_SCALE * eo[2]]
                efd = dot(eo_render, front_axis)
                if efd >= min_front_depth:
                    break
                correction = _quat_axis_angle(corr_axis, 0.1)
                lower_q = _quat_mul(correction, lower_q)

            lower_corrected = True
            if not upper_corrected:
                report["corrected"] = True
                total_corrections += 1

        # --- Step 3: Re-check wrist after forearm correction ---
        # Forearm correction may have shifted the wrist. Re-check and re-correct.
        if lower_corrected and upper_corrected:
            fk3 = fk_arm_chain(
                shoulder_pos_pmx, shoulder_world, upper_q, lower_q, [], [], arm_side="right"
            )
            wo3 = sub(fk3["wrist_pos"], shoulder_pos_pmx)
            wo3_render = [PMX_SCALE * wo3[0], PMX_SCALE * wo3[1], -PMX_SCALE * wo3[2]]
            wfd3 = dot(wo3_render, front_axis)
            if wfd3 < min_front_depth:
                upper_q, _, re_corr = correct_arm_front_depth(
                    shoulder_pos_pmx, shoulder_world, upper_q, lower_q, [], [],
                    front_axis, min_front_depth=min_front_depth,
                    max_iterations=max_iterations, arm_side="right",
                )
                report["final_front_depth"] = re_corr["final_front_depth"]
                report["iterations"] += re_corr["iterations"]

        report["upper_corrected"] = upper_corrected
        report["lower_corrected"] = lower_corrected

        # Stage 3: Apply joint angle limits after IK correction
        upper_q, lower_q, joint_report = apply_joint_limits(
            shoulder_pos_pmx, shoulder_world, upper_q, lower_q, arm_side="right",
        )
        report["joint_limits"] = joint_report

        # Stage 5: Apply priority constraints (collision > joint limits > target > path)
        # Pass chin as wrist target with forward offset for hold phase targeting.
        # The chin target is pushed forward to ensure the wrist ends up in front of the chin.
        front_pmx = normalize([front_axis[0] / PMX_SCALE, front_axis[1] / PMX_SCALE, -front_axis[2] / PMX_SCALE])
        chin_target_pmx = [chin_pmx[i] + front_pmx[i] * 0.3 for i in range(3)]
        upper_q, lower_q, constraint_report = apply_priority_constraints(
            shoulder_pos_pmx, shoulder_world, upper_q, lower_q,
            front_axis, wrist_target_pmx=chin_target_pmx, chin_pmx=chin_pmx,
            min_front_depth=min_front_depth,
            frame_progress=frame_no / max(1, max(frame_map.keys())),
            arm_side="right",
        )
        report["priority_constraints"] = constraint_report

        # Rebuild frames
        for bone_name, bone_frame in bones.items():
            if bone_name == "右腕":
                corrected.append(BoneFrame(
                    bone_name, frame_no, bone_frame.position, upper_q,
                    bone_frame.interpolation,
                ))
            elif bone_name == "右ひじ":
                corrected.append(BoneFrame(
                    bone_name, frame_no, bone_frame.position, lower_q,
                    bone_frame.interpolation,
                ))
            else:
                corrected.append(bone_frame)

        frame_reports.append(report)

    # Stage 4: Enhanced motion smoothing with per-bone velocity + acceleration limits
    corrected, smoothing_stats = apply_motion_smoothing_v2(corrected)

    return corrected, {
        "total_frames": len(frame_map),
        "total_corrections": total_corrections,
        "min_front_depth": min_front_depth,
        "front_axis": [round(x, 4) for x in front_axis],
        "frames": frame_reports,
        "smoothing_stats": smoothing_stats,
        "stages_applied": ["torso_lean_compensation", "collision_avoidance", "joint_angle_limits", "priority_constraints", "motion_smoothing_v2"],
    }


def fabrik_two_bone_ik(
    shoulder_pos: list,
    shoulder_world_quat: tuple,
    upper_local_quat: tuple,
    lower_local_quat: tuple,
    wrist_target: list,
    elbow_target: list | None,
    upper_length: float,
    lower_length: float,
    max_iterations: int = 40,
    tolerance: float = 0.05,
    arm_side: str = "right",
) -> tuple[tuple, tuple, dict[str, Any]]:
    """FABRIK two-bone IK solver for the arm (right or left).

    Given a wrist target position and optional elbow target direction,
    solve for upper arm and forearm rotations using FABRIK.

    FABRIK (Forward And Backward Reaching Inverse Kinematics):
    1. Backward: Move wrist to target, adjust elbow to maintain bone length
    2. Forward: Reset shoulder to fixed position, adjust elbow and wrist
    3. Repeat until converged

    After FABRIK converges on positions, convert back to quaternion rotations.

    Args:
        shoulder_pos: Fixed shoulder position in PMX space.
        shoulder_world_quat: Shoulder world rotation (for converting local quats).
        upper_local_quat: Initial upper arm local rotation.
        lower_local_quat: Initial forearm local rotation.
        wrist_target: Target wrist position in PMX space.
        elbow_target: Optional target elbow position (for front-depth constraint).
        upper_length: Upper arm bone length.
        lower_length: Forearm bone length.
        max_iterations: Max FABRIK iterations.
        tolerance: Convergence tolerance in PMX units.

    Returns:
        (corrected_upper_local_quat, corrected_lower_local_quat, report)
    """
    import math

    # Compute initial positions from FK
    fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_local_quat, lower_local_quat, [], [], arm_side=arm_side)
    elbow = list(fk["elbow_pos"])
    wrist = list(fk["wrist_pos"])

    # The actual chain base is shoulderC, not shoulder.
    if arm_side == "left":
        offsets = PMX_LEFT_ARM_OFFSETS
        shoulderC_offset = offsets["左肩C"]
        rest_upper_dir = [2.322, -1.910, 0.128]   # left arm: mirrored X
    else:
        offsets = PMX_RIGHT_ARM_OFFSETS
        shoulderC_offset = offsets["右肩C"]
        rest_upper_dir = [-2.322, -1.910, 0.128]  # right arm
    shoulderC_pos = add(shoulder_pos, _quat_vec(shoulder_world_quat, shoulderC_offset))

    # Bone lengths (should be constant)
    d_upper = upper_length  # shoulder to elbow
    d_lower = lower_length   # elbow to wrist

    # FABRIK iterations
    for iteration in range(max_iterations):
        # Backward pass: move wrist to target, adjust elbow
        wrist = list(wrist_target)

        # Keep elbow at distance d_lower from wrist
        elbow_to_wrist = sub(wrist, elbow)
        dist_ew = length(elbow_to_wrist)
        if dist_ew > 1e-8:
            scale = d_lower / dist_ew
            elbow = [wrist[i] - elbow_to_wrist[i] * scale for i in range(3)]

        # Keep elbow at distance d_upper from shoulder
        shoulder_to_elbow = sub(elbow, shoulderC_pos)
        dist_se = length(shoulder_to_elbow)
        if dist_se > 1e-8:
            scale = d_upper / dist_se
            elbow = [shoulderC_pos[i] + shoulder_to_elbow[i] * scale for i in range(3)]

        # Forward pass: fix shoulder, adjust elbow and wrist
        # Elbow already at distance d_upper from shoulder (from backward pass)
        # Now keep elbow at distance d_lower from wrist
        elbow_to_wrist = sub(wrist, elbow)
        dist_ew = length(elbow_to_wrist)
        if dist_ew > 1e-8:
            scale = d_lower / dist_ew
            wrist = [elbow[i] + elbow_to_wrist[i] * scale for i in range(3)]

        # Check convergence
        wrist_error = length(sub(wrist, wrist_target))
        if wrist_error < tolerance:
            break

    # Apply elbow target constraint (if provided) via pole target
    if elbow_target is not None:
        # Blend elbow toward target while maintaining distance constraints
        for _ in range(10):
            elbow = [elbow[i] * 0.9 + elbow_target[i] * 0.1 for i in range(3)]
            shoulder_to_elbow = sub(elbow, shoulderC_pos)
            dist_se = length(shoulder_to_elbow)
            if dist_se > 1e-8:
                scale = d_upper / dist_se
                elbow = [shoulderC_pos[i] + shoulder_to_elbow[i] * scale for i in range(3)]
            elbow_to_wrist = sub(wrist, elbow)
            dist_ew = length(elbow_to_wrist)
            if dist_ew > 1e-8:
                scale = d_lower / dist_ew
                wrist = [elbow[i] + elbow_to_wrist[i] * scale for i in range(3)]

        # Re-converge wrist to target after elbow adjustment
        for _ in range(20):
            # Backward pass
            wrist = list(wrist_target)
            elbow_to_wrist = sub(wrist, elbow)
            dist_ew = length(elbow_to_wrist)
            if dist_ew > 1e-8:
                scale = d_lower / dist_ew
                elbow = [wrist[i] - elbow_to_wrist[i] * scale for i in range(3)]
            shoulder_to_elbow = sub(elbow, shoulderC_pos)
            dist_se = length(shoulder_to_elbow)
            if dist_se > 1e-8:
                scale = d_upper / dist_se
                elbow = [shoulderC_pos[i] + shoulder_to_elbow[i] * scale for i in range(3)]
            # Forward pass
            elbow_to_wrist = sub(wrist, elbow)
            dist_ew = length(elbow_to_wrist)
            if dist_ew > 1e-8:
                scale = d_lower / dist_ew
                wrist = [elbow[i] + elbow_to_wrist[i] * scale for i in range(3)]
            wrist_error = length(sub(wrist, wrist_target))
            if wrist_error < tolerance:
                break

    # Convert positions back to quaternion rotations.
    # The bone hierarchy is: 右肩C → 右腕 → 右腕捩 → 右ひじ → 右手捩 → 右手首
    # 右肩C offset from 右肩: [-1.143, -0.224, 0.220]
    # 右腕 offset from 右肩C: [0, 0, 0] (zero length)
    # 右腕捩 offset from 右腕: [-1.393, -1.146, 0.042]
    # 右ひじ offset from 右腕捩: [-0.929, -0.764, 0.086]
    # 右手捩 offset from 右ひじ: [-1.244, -0.917, -0.054]
    # 右手首 offset from 右手捩: [-0.830, -0.612, -0.035]
    #
    # The upper arm world rotation rotates the rest upper offset to the current direction.
    # rest_upper = 右腕捩_offset + 右ひじ_offset = [-2.322, -1.910, 0.128]
    # But 右腕 has zero offset, so upper_world only rotates the combined offset.
    # The elbow position = shoulderC_pos + upper_world * (twist1_offset + elbow_offset)
    # = shoulderC_pos + upper_world * rest_upper_dir
    # So: upper_world = quat_between(rest_upper_dir, current_upper_dir)
    #
    # The forearm world rotation rotates the rest lower offset to the current direction.
    # rest_lower = 右手捩_offset + 右手首_offset = [-2.074, -1.529, -0.089]
    # wrist = elbow_pos + lower_world * rest_lower_dir
    # So: lower_world = quat_between(rest_lower_dir, current_lower_dir)

    if arm_side == "left":
        rest_upper_dir = [2.322, -1.910, 0.128]
        rest_lower_dir = [2.074, -1.529, -0.089]
    else:
        rest_upper_dir = [-2.322, -1.910, 0.128]
        rest_lower_dir = [-2.074, -1.529, -0.089]

    current_upper_dir = sub(elbow, shoulderC_pos)
    current_lower_dir = sub(wrist, elbow)

    # Compute world rotations using the full chain
    # shoulderC_world = shoulder_world (no VMD for 右肩C)
    # upper_world = shoulderC_world * upper_local
    # So upper_local = conj(shoulderC_world) * upper_world
    # = conj(shoulder_world) * upper_world
    upper_world = _quat_between(rest_upper_dir, current_upper_dir)
    upper_local = _quat_mul(_quat_conj(shoulder_world_quat), upper_world)

    # lower_world = twist1_world * lower_local
    # twist1_world = upper_world (no VMD for 右腕捩)
    # So lower_local = conj(upper_world) * lower_world
    lower_world = _quat_between(rest_lower_dir, current_lower_dir)
    lower_local = _quat_mul(_quat_conj(upper_world), lower_world)

    report = {
        "iterations": iteration + 1,
        "wrist_error": round(length(sub(wrist, wrist_target)), 4),
        "converged": length(sub(wrist, wrist_target)) < tolerance,
    }
    return upper_local, lower_local, report


def compute_elbow_angle(
    arm_root_pos: list,
    elbow_pos: list,
    wrist_pos: list,
) -> float:
    """Compute elbow joint angle in degrees.

    The arm root is the shoulderC position (the actual start of the arm chain),
    not the 右肩 position which is the collar bone tip.
    """
    upper = sub(elbow_pos, arm_root_pos)
    lower = sub(wrist_pos, elbow_pos)
    cos_angle = max(-1.0, min(1.0, dot(normalize(upper), normalize(lower))))
    return math.degrees(math.acos(cos_angle))


def clamp_elbow_angle(
    shoulder_pos: list,
    shoulder_world_quat: tuple,
    upper_local_quat: tuple,
    lower_local_quat: tuple,
    min_angle: float = 25.0,
    max_angle: float = 170.0,
    arm_side: str = "right",
) -> tuple[tuple, tuple]:
    """Clamp elbow joint angle to plausible human range.

    Uses the shoulderC position (actual arm chain root) for angle computation,
    not the 右肩 position. The 右肩C offset from 右肩 is:
        shoulderC_offset = [-1.143, -0.224, 0.220]

    Returns (possibly adjusted upper_local_quat, lower_local_quat).
    """
    # Compute shoulderC position from shoulder position + shoulder world rotation
    if arm_side == "left":
        shoulderC_offset = PMX_LEFT_ARM_OFFSETS["左肩C"]
    else:
        shoulderC_offset = PMX_RIGHT_ARM_OFFSETS["右肩C"]
    shoulderC_pos = add(shoulder_pos, _quat_vec(shoulder_world_quat, shoulderC_offset))

    fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_local_quat, lower_local_quat, [], [], arm_side=arm_side)
    angle = compute_elbow_angle(shoulderC_pos, fk["elbow_pos"], fk["wrist_pos"])

    if min_angle <= angle <= max_angle:
        return upper_local_quat, lower_local_quat

    # Need to adjust forearm rotation to change elbow angle
    current_lower_dir = normalize(sub(fk["wrist_pos"], fk["elbow_pos"]))
    upper_dir = normalize(sub(fk["elbow_pos"], shoulderC_pos))

    # Target angle: clamp to nearest bound with margin
    target_angle = min_angle + 2.0 if angle < min_angle else max_angle - 2.0
    target_rad = math.radians(target_angle)

    # Rotation axis perpendicular to the upper-lower plane
    rot_axis = [
        upper_dir[1] * current_lower_dir[2] - upper_dir[2] * current_lower_dir[1],
        upper_dir[2] * current_lower_dir[0] - upper_dir[0] * current_lower_dir[2],
        upper_dir[0] * current_lower_dir[1] - upper_dir[1] * current_lower_dir[0],
    ]
    if length(rot_axis) < 1e-8:
        rot_axis = [1.0, 0.0, 0.0]

    current_rad = math.radians(angle)
    delta = target_rad - current_rad

    correction = _quat_axis_angle(rot_axis, delta)
    upper_world = _quat_mul(shoulder_world_quat, upper_local_quat)
    lower_world = _quat_mul(upper_world, lower_local_quat)
    new_lower_world = _quat_mul(correction, lower_world)
    new_lower_local = _quat_mul(_quat_conj(upper_world), new_lower_world)

    # Verify
    fk2 = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_local_quat, new_lower_local, [], [], arm_side=arm_side)
    new_angle = compute_elbow_angle(shoulderC_pos, fk2["elbow_pos"], fk2["wrist_pos"])

    return upper_local_quat, new_lower_local


def apply_motion_smoothing(
    vmd_frames: list,
    max_angular_delta_per_frame: float = 0.3,
) -> list:
    """Apply temporal smoothing to VMD bone rotations.

    Limits per-frame angular change to max_angular_delta_per_frame (radians)
    using SLERP interpolation. This prevents frame-to-frame jitter from IK.

    Args:
        vmd_frames: List of BoneFrame objects.
        max_angular_delta_per_frame: Max angular change per frame (radians).

    Returns:
        Smoothed list of BoneFrame objects.
    """
    from vmd_io import BoneFrame

    # Group by bone name, sorted by frame
    bone_frames: dict[str, list[BoneFrame]] = {}
    for f in vmd_frames:
        if f.bone not in bone_frames:
            bone_frames[f.bone] = []
        bone_frames[f.bone].append(f)

    smoothed: list[BoneFrame] = []
    for bone_name, frames in bone_frames.items():
        frames.sort(key=lambda f: f.frame)
        if len(frames) <= 1:
            smoothed.extend(frames)
            continue

        for i, frame in enumerate(frames):
            if i == 0:
                smoothed.append(frame)
                continue

            prev = frames[i - 1]
            frame_delta = frame.frame - prev.frame
            if frame_delta <= 0:
                smoothed.append(frame)
                continue

            # Compute angular distance
            q1 = prev.rotation
            q2 = frame.rotation
            dot_q = max(-1.0, min(1.0, abs(sum(a * b for a, b in zip(q1, q2)))))
            angle = 2.0 * math.acos(dot_q)

            # Per-frame allowed delta
            allowed = max_angular_delta_per_frame * frame_delta

            if angle <= allowed:
                smoothed.append(frame)
            else:
                # SLERP between prev and current
                t = allowed / angle
                slerped = _quat_slerp(q1, q2, t)
                smoothed.append(BoneFrame(
                    frame.bone, frame.frame, frame.position, slerped,
                    frame.interpolation,
                ))

    return smoothed


def _quat_slerp(q1: tuple, q2: tuple, t: float) -> tuple:
    """Spherical linear interpolation between two quaternions."""
    dot_q = sum(a * b for a, b in zip(q1, q2))
    if dot_q < 0:
        q2 = tuple(-c for c in q2)
        dot_q = -dot_q
    if dot_q > 0.9995:
        # Linear interpolation for very close quaternions
        result = tuple(q1[i] + t * (q2[i] - q1[i]) for i in range(4))
        return _quat_normalize(result)
    theta = math.acos(max(-1.0, min(1.0, dot_q)))
    sin_theta = math.sin(theta)
    w1 = math.sin((1 - t) * theta) / sin_theta
    w2 = math.sin(t * theta) / sin_theta
    return _quat_normalize(tuple(w1 * q1[i] + w2 * q2[i] for i in range(4)))


# ============================================================================
# Stage 3: Joint Angle Limit Table
# ============================================================================

# Human-plausible joint angle ranges (degrees) for the Eula PMX model.
# Derived from the 102-axis calibration tests in mmd-bone-coordinate-system.md.
# These are the anatomical limits; IK solutions outside these ranges are
# clamped to the nearest bound.
JOINT_ANGLE_LIMITS = {
    # Elbow: fully extended ~172° in T-pose, can flex to ~20°
    "elbow": {"min": 20.0, "max": 175.0},
    # Knee: similar to elbow
    "knee": {"min": 15.0, "max": 175.0},
    # Shoulder abduction angle (upper arm to torso): 0° (arm down) to 180° (arm up)
    "shoulder_abduction": {"min": 0.0, "max": 170.0},
    # Shoulder twist (internal/external rotation): limited range
    "shoulder_twist": {"min": -80.0, "max": 80.0},
    # Wrist flexion/extension
    "wrist_flex": {"min": -70.0, "max": 70.0},
    # Wrist deviation (side-to-side)
    "wrist_deviation": {"min": -20.0, "max": 20.0},
    # Spine flexion (upper body forward lean)
    "spine_flex": {"min": -45.0, "max": 30.0},
    # Spine lateral bend
    "spine_bend": {"min": -35.0, "max": 35.0},
    # Neck flexion
    "neck_flex": {"min": -50.0, "max": 45.0},
}

# Per-bone max angular velocity (radians per frame at 30fps).
# Large bones move slower; small bones (fingers) can move fast.
BONE_MAX_ANGULAR_VELOCITY = {
    "右腕": 0.25,      # Upper arm: slow, heavy
    "左腕": 0.25,
    "右ひじ": 0.35,    # Forearm: moderate
    "左ひじ": 0.35,
    "右肩": 0.20,      # Shoulder blade: very slow
    "左肩": 0.20,
    "上半身": 0.15,    # Torso: slowest
    "上半身2": 0.15,
    "下半身": 0.15,
    "首": 0.30,        # Neck: moderate
    "頭": 0.30,
    "右足": 0.25,      # Hip: slow
    "左足": 0.25,
    "右ひざ": 0.30,    # Knee: moderate
    "左ひざ": 0.30,
    "右足首": 0.35,    # Ankle: moderate
    "左足首": 0.35,
}
DEFAULT_MAX_ANGULAR_VELOCITY = 0.40  # Default for bones not in the table


def compute_shoulder_abduction_angle(
    shoulder_pos: list,
    shoulder_world_quat: tuple,
    upper_local_quat: tuple,
    waist_pos: list,
    arm_side: str = "right",
) -> float:
    """Compute shoulder abduction angle (upper arm to torso angle) in degrees.

    This is the angle between the upper arm direction and the torso down direction.
    0° = arm at side, 90° = arm horizontal, 180° = arm overhead.
    """
    fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_local_quat, IDENTITY_QUAT, [], [], arm_side=arm_side)
    upper_dir = normalize(sub(fk["elbow_pos"], shoulder_pos))
    torso_down = normalize(sub(shoulder_pos, waist_pos))
    cos_angle = max(-1.0, min(1.0, dot(upper_dir, torso_down)))
    return math.degrees(math.acos(cos_angle))


def apply_joint_limits(
    shoulder_pos: list,
    shoulder_world_quat: tuple,
    upper_local_quat: tuple,
    lower_local_quat: tuple,
    arm_side: str = "right",
) -> tuple[tuple, tuple, dict[str, Any]]:
    """Stage 3: Apply full joint angle limit table to arm chain.

    Checks and clamps:
    - Elbow angle (flexion range)
    - Shoulder abduction angle (arm-to-torso angle)

    Returns (corrected_upper, corrected_lower, report).
    """
    report = {"elbow_angle": None, "shoulder_abduction": None, "clamped": []}

    # Compute shoulderC position
    if arm_side == "left":
        shoulderC_offset = PMX_LEFT_ARM_OFFSETS["左肩C"]
    else:
        shoulderC_offset = PMX_RIGHT_ARM_OFFSETS["右肩C"]
    shoulderC_pos = add(shoulder_pos, _quat_vec(shoulder_world_quat, shoulderC_offset))

    fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_local_quat, lower_local_quat, [], [], arm_side=arm_side)

    # 1. Elbow angle clamp
    elbow_angle = compute_elbow_angle(shoulderC_pos, fk["elbow_pos"], fk["wrist_pos"])
    report["elbow_angle"] = round(elbow_angle, 2)

    limits = JOINT_ANGLE_LIMITS["elbow"]
    if elbow_angle < limits["min"] or elbow_angle > limits["max"]:
        upper_local_quat, lower_local_quat = clamp_elbow_angle(
            shoulder_pos, shoulder_world_quat, upper_local_quat, lower_local_quat,
            min_angle=limits["min"], max_angle=limits["max"], arm_side=arm_side,
        )
        report["clamped"].append("elbow")
        # Recompute FK after clamping
        fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_local_quat, lower_local_quat, [], [], arm_side=arm_side)
        new_angle = compute_elbow_angle(shoulderC_pos, fk["elbow_pos"], fk["wrist_pos"])
        report["elbow_angle_clamped_to"] = round(new_angle, 2)

    # 2. Shoulder abduction angle clamp
    waist_pos = list(PMX_BONE_POSITIONS["下半身"])
    abd_angle = compute_shoulder_abduction_angle(
        shoulder_pos, shoulder_world_quat, upper_local_quat, waist_pos, arm_side=arm_side,
    )
    report["shoulder_abduction"] = round(abd_angle, 2)

    abd_limits = JOINT_ANGLE_LIMITS["shoulder_abduction"]
    if abd_angle > abd_limits["max"]:
        # Clamp by rotating upper arm back toward the torso
        fk_check = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_local_quat, IDENTITY_QUAT, [], [], arm_side=arm_side)
        upper_dir = normalize(sub(fk_check["elbow_pos"], shoulderC_pos))
        torso_down = normalize(sub(shoulderC_pos, waist_pos))
        # Rotation axis: cross(upper_dir, torso_down)
        rot_axis = [
            upper_dir[1] * torso_down[2] - upper_dir[2] * torso_down[1],
            upper_dir[2] * torso_down[0] - upper_dir[0] * torso_down[2],
            upper_dir[0] * torso_down[1] - upper_dir[1] * torso_down[0],
        ]
        if length(rot_axis) < 1e-8:
            rot_axis = [1.0, 0.0, 0.0]
        delta = math.radians(abd_limits["max"] - abd_angle)
        correction = _quat_axis_angle(rot_axis, delta)
        upper_local_quat = _quat_mul(correction, upper_local_quat)
        report["clamped"].append("shoulder_abduction")
        report["shoulder_abduction_clamped_to"] = abd_limits["max"]

    return upper_local_quat, lower_local_quat, report


# ============================================================================
# Stage 4: Enhanced Motion Smoothing with Per-Bone Velocity + Acceleration Limits
# ============================================================================

def apply_motion_smoothing_v2(
    vmd_frames: list,
    max_angular_velocity: dict[str, float] | None = None,
    max_acceleration_ratio: float = 2.0,
) -> tuple[list, dict[str, Any]]:
    """Stage 4: Enhanced motion smoothing.

    Two-pass smoothing:
    1. Velocity pass: SLERP-limit per-frame angular change per bone
    2. Acceleration pass: limit second-order angular change (jerk)

    Args:
        vmd_frames: List of BoneFrame objects.
        max_angular_velocity: Per-bone max rad/frame. Falls back to BONE_MAX_ANGULAR_VELOCITY.
        max_acceleration_ratio: Max ratio of consecutive velocity changes (2.0 = velocity can at most double).

    Returns:
        (smoothed_frames, report)
    """
    from vmd_io import BoneFrame

    if max_angular_velocity is None:
        max_angular_velocity = BONE_MAX_ANGULAR_VELOCITY

    # Group by bone name, sorted by frame
    bone_frames: dict[str, list[BoneFrame]] = {}
    for f in vmd_frames:
        if f.bone not in bone_frames:
            bone_frames[f.bone] = []
        bone_frames[f.bone].append(f)

    smoothed: list[BoneFrame] = []
    stats = {"velocity_clamped": 0, "acceleration_clamped": 0, "bones_processed": 0}

    for bone_name, frames in bone_frames.items():
        frames.sort(key=lambda f: f.frame)
        if len(frames) <= 1:
            smoothed.extend(frames)
            continue

        stats["bones_processed"] += 1
        max_vel = max_angular_velocity.get(bone_name, DEFAULT_MAX_ANGULAR_VELOCITY)

        # Pass 1: Velocity limiting
        clamped_frames = []
        prev_q = None
        for i, frame in enumerate(frames):
            if i == 0:
                clamped_frames.append(frame)
                prev_q = frame.rotation
                continue

            prev = clamped_frames[-1]
            frame_delta = frame.frame - prev.frame
            if frame_delta <= 0:
                clamped_frames.append(frame)
                prev_q = frame.rotation
                continue

            q1 = prev_q
            q2 = frame.rotation
            dot_q = max(-1.0, min(1.0, abs(sum(a * b for a, b in zip(q1, q2)))))
            angle = 2.0 * math.acos(dot_q)
            allowed = max_vel * frame_delta

            if angle > allowed:
                t = allowed / angle if angle > 1e-8 else 1.0
                slerped = _quat_slerp(q1, q2, t)
                clamped_frames.append(BoneFrame(
                    frame.bone, frame.frame, frame.position, slerped,
                    frame.interpolation,
                ))
                prev_q = slerped
                stats["velocity_clamped"] += 1
            else:
                clamped_frames.append(frame)
                prev_q = frame.rotation

        # Pass 2: Acceleration limiting (jerk reduction)
        if len(clamped_frames) > 2:
            accel_clamped = []
            for i, frame in enumerate(clamped_frames):
                if i < 2:
                    accel_clamped.append(frame)
                    continue

                prev = accel_clamped[-1]
                prev_prev = accel_clamped[-2]
                frame_delta = frame.frame - prev.frame
                if frame_delta <= 0:
                    accel_clamped.append(frame)
                    continue

                # Compute velocity of previous step and current step
                v_prev_q = prev_prev.rotation
                v_cur_q = frame.rotation
                v_prev_angle = 2.0 * math.acos(max(-1.0, min(1.0, abs(sum(a * b for a, b in zip(v_prev_q, prev.rotation))))))
                v_cur_angle = 2.0 * math.acos(max(-1.0, min(1.0, abs(sum(a * b for a, b in zip(prev.rotation, v_cur_q))))))

                # If velocity change exceeds max_acceleration_ratio, blend
                if v_prev_angle > 1e-6 and v_cur_angle > v_prev_angle * max_acceleration_ratio:
                    # Limit current velocity to max_acceleration_ratio * previous velocity
                    target_vel = v_prev_angle * max_acceleration_ratio
                    t = target_vel / v_cur_angle if v_cur_angle > 1e-8 else 1.0
                    slerped = _quat_slerp(prev.rotation, v_cur_q, t)
                    accel_clamped.append(BoneFrame(
                        frame.bone, frame.frame, frame.position, slerped,
                        frame.interpolation,
                    ))
                    stats["acceleration_clamped"] += 1
                else:
                    accel_clamped.append(frame)

            smoothed.extend(accel_clamped)
        else:
            smoothed.extend(clamped_frames)

    return smoothed, stats


# ============================================================================
# Stage 5: Priority Constraint System
# ============================================================================

# Constraint priority levels (lower number = higher priority)
CONSTRAINT_PRIORITY = {
    "collision_avoidance": 0,    # Must not penetrate body — highest
    "joint_angle_limits": 1,      # Must be anatomically plausible
    "target_position": 2,         # Wrist should reach chin target
    "path_constraint": 3,         # Wrist should stay in front during approach
    "motion_smoothness": 4,       # Should not jitter — lowest
}


def apply_priority_constraints(
    shoulder_pos: list,
    shoulder_world_quat: tuple,
    upper_local_quat: tuple,
    lower_local_quat: tuple,
    front_axis: list,
    wrist_target_pmx: list | None = None,
    chin_pmx: list | None = None,
    min_front_depth: float = 0.1,
    min_torso_clearance: float = 0.45,
    frame_progress: float = 0.0,
    arm_side: str = "right",
) -> tuple[tuple, tuple, dict[str, Any]]:
    """Stage 5: Apply constraints in priority order.

    Each constraint can modify the rotations. Higher-priority constraints
    are applied first and lower-priority constraints must respect their results.

    Args:
        shoulder_pos: PMX model-space shoulder position.
        shoulder_world_quat: Accumulated shoulder world rotation.
        upper_local_quat: Upper arm local rotation.
        lower_local_quat: Forearm local rotation.
        front_axis: Front direction in render space.
        wrist_target_pmx: Optional IK wrist target in PMX space.
        chin_pmx: Chin position in PMX space (for target constraint).
        min_front_depth: Minimum front depth (collision constraint).
        min_torso_clearance: Minimum distance from torso core (collision constraint).

    Returns:
        (corrected_upper, corrected_lower, constraint_report)
    """
    upper_q = upper_local_quat
    lower_q = lower_local_quat
    report = {"constraints_applied": [], "violations": []}

    # Priority 0: Collision avoidance
    # Check if wrist or elbow penetrates torso
    fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_q, lower_q, [], [], arm_side=arm_side)
    wrist_render = _pmx_to_render(fk["wrist_pos"])
    elbow_render = _pmx_to_render(fk["elbow_pos"])
    waist_render = DEFAULT_TPOSE_PROBE["waist"]

    wrist_clear = math.sqrt(wrist_render[0]**2 + (wrist_render[2] - waist_render[2])**2)
    elbow_clear = math.sqrt(elbow_render[0]**2 + (elbow_render[2] - waist_render[2])**2)

    wrist_fd = dot([wrist_render[i] - DEFAULT_TPOSE_PROBE["right_shoulder"][i] for i in range(3)], front_axis)
    elbow_fd = dot([elbow_render[i] - DEFAULT_TPOSE_PROBE["right_shoulder"][i] for i in range(3)], front_axis)

    collision_violated = (wrist_fd < min_front_depth or elbow_fd < min_front_depth or
                         wrist_clear < min_torso_clearance or elbow_clear < min_torso_clearance)

    if collision_violated:
        # Apply front-depth correction (reuse existing function)
        upper_q, lower_q, corr_report = correct_arm_front_depth(
            shoulder_pos, shoulder_world_quat, upper_q, lower_q, [], [],
            front_axis, min_front_depth=min_front_depth, max_iterations=20,
        )
        report["constraints_applied"].append("collision_avoidance")
        report["collision_correction"] = corr_report

    # Priority 1: Joint angle limits
    upper_q, lower_q, joint_report = apply_joint_limits(
        shoulder_pos, shoulder_world_quat, upper_q, lower_q, arm_side=arm_side,
    )
    if joint_report["clamped"]:
        report["constraints_applied"].append("joint_angle_limits")
    report["joint_report"] = joint_report

    # Priority 2: Target position (wrist to chin)
    if wrist_target_pmx is not None:
        if arm_side == "left":
            shoulderC_offset = PMX_LEFT_ARM_OFFSETS["左肩C"]
        else:
            shoulderC_offset = PMX_RIGHT_ARM_OFFSETS["右肩C"]
        shoulderC_pos = add(shoulder_pos, _quat_vec(shoulder_world_quat, shoulderC_offset))
        upper_length = 3.676 / PMX_SCALE
        lower_length = 2.321 / PMX_SCALE
        max_reach = upper_length + lower_length

        # Clamp target to reachable distance (don't skip — clamp)
        target = list(wrist_target_pmx)
        target_delta = sub(target, shoulderC_pos)
        target_dist = length(target_delta)
        if target_dist > max_reach * 0.98:
            # Clamp to max reach
            direction = normalize(target_delta)
            target = [shoulderC_pos[i] + direction[i] * max_reach * 0.98 for i in range(3)]

        # Always apply FABRIK to move wrist toward target
        # Blend strength based on frame progress: ramp up during approach, full during hold
        if frame_progress < 0.35:
            # Raise phase: light blend (20%) to preserve BVH motion
            blend = 0.2
        elif frame_progress < 0.7:
            # Approach phase: ramp from 20% to 100%
            blend = 0.2 + 0.8 * ((frame_progress - 0.35) / 0.35)
        else:
            # Hold phase: full target
            blend = 1.0

        # Apply FABRIK
        upper_q_ik, lower_q_ik, ik_report = fabrik_two_bone_ik(
            shoulder_pos, shoulder_world_quat, upper_q, lower_q,
            target, None,
            upper_length, lower_length,
            max_iterations=30,
        )

        # Blend IK result with pre-IK state
        upper_q = _quat_slerp(upper_q, upper_q_ik, blend)
        lower_q = _quat_slerp(lower_q, lower_q_ik, blend)

        report["constraints_applied"].append("target_position")
        report["ik_report"] = ik_report
        report["target_blend"] = round(blend, 2)

        # Re-check collision after IK (priority 0 wins over priority 2)
        fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_q, lower_q, [], [], arm_side=arm_side)
        wrist_render2 = _pmx_to_render(fk["wrist_pos"])
        wrist_fd2 = dot([wrist_render2[i] - DEFAULT_TPOSE_PROBE["right_shoulder"][i] for i in range(3)], front_axis)
        if wrist_fd2 < min_front_depth:
            # IK moved wrist behind torso — re-apply collision correction
            report["violations"].append("target_position_collided_recorrected")
            upper_q, lower_q, _ = correct_arm_front_depth(
                shoulder_pos, shoulder_world_quat, upper_q, lower_q, [], [],
                front_axis, min_front_depth=min_front_depth, max_iterations=20,
            )

    # Priority 3: Path constraint (wrist stays in front during approach)
    # Check that wrist front depth hasn't regressed below a looser threshold
    fk = fk_arm_chain(shoulder_pos, shoulder_world_quat, upper_q, lower_q, [], [], arm_side=arm_side)
    wrist_render_final = _pmx_to_render(fk["wrist_pos"])
    wrist_fd_final = dot([wrist_render_final[i] - DEFAULT_TPOSE_PROBE["right_shoulder"][i] for i in range(3)], front_axis)
    if wrist_fd_final < min_front_depth * 0.5:
        report["violations"].append("path_constraint_front_depth_low")
        # Push wrist forward slightly
        front_pmx = normalize([front_axis[0] / PMX_SCALE, front_axis[1] / PMX_SCALE, -front_axis[2] / PMX_SCALE])
        arm_dir = normalize(sub(fk["wrist_pos"], shoulder_pos))
        corr_axis = [
            arm_dir[1] * front_pmx[2] - arm_dir[2] * front_pmx[1],
            arm_dir[2] * front_pmx[0] - arm_dir[0] * front_pmx[2],
            arm_dir[0] * front_pmx[1] - arm_dir[1] * front_pmx[0],
        ]
        if length(corr_axis) < 1e-8:
            corr_axis = [1.0, 0.0, 0.0]
        correction = _quat_axis_angle(corr_axis, 0.15)
        upper_q = _quat_mul(correction, upper_q)
        report["constraints_applied"].append("path_constraint")

    return upper_q, lower_q, report


# ============================================================================
# Stage 6: Full-Body Kinematic Chain — Torso Lean Compensation
# ============================================================================

def apply_torso_lean_compensation(
    bones: dict,
    shoulder_pos_pmx: list,
    front_axis: list,
    wrist_target_pmx: list | None = None,
    max_lean_degrees: float = 15.0,
    lean_step: float = 0.5,
) -> tuple[dict, dict[str, Any]]:
    """Stage 6: Compensate for unreachable wrist targets by leaning torso forward.

    When the wrist target is beyond arm reach, instead of overextending the arm,
    lean the upper body forward (上半身 +X) to bring the shoulder closer to the target.

    Args:
        bones: Dict of bone_name -> BoneFrame for the current frame.
        shoulder_pos_pmx: PMX model-space shoulder position (will be modified by lean).
        front_axis: Front direction in render space.
        wrist_target_pmx: Target wrist position in PMX space.
        max_lean_degrees: Maximum torso forward lean.
        lean_step: Degrees per iteration.

    Returns:
        (modified_bones_dict, report)
    """
    import copy
    report = {"lean_applied": False, "lean_degrees": 0.0, "reason": ""}

    if wrist_target_pmx is None:
        return bones, report

    # Check if target is beyond arm reach
    upper_length = 3.676 / PMX_SCALE
    lower_length = 2.321 / PMX_SCALE
    max_reach = upper_length + lower_length

    # Current shoulder to target distance
    dist_to_target = length(sub(wrist_target_pmx, shoulder_pos_pmx))

    if dist_to_target <= max_reach * 0.95:
        report["reason"] = "target_within_reach"
        return bones, report

    # Need to lean torso forward to reduce distance
    # Front direction in PMX space
    front_pmx = normalize([front_axis[0] / PMX_SCALE, front_axis[1] / PMX_SCALE, -front_axis[2] / PMX_SCALE])

    # Current torso lean (from 上半身 rotation)
    upper_body = bones.get("上半身")
    current_lean = 0.0
    if upper_body:
        # Extract X-axis rotation from quaternion (simplified)
        q = upper_body.rotation
        # X rotation angle = 2 * atan2(x, w) for pure X rotation
        current_lean = 2.0 * math.degrees(math.atan2(abs(q[0]), abs(q[3])))

    # Iteratively lean forward until target is reachable or max lean reached
    lean_applied = 0.0
    modified_bones = {k: copy.copy(v) for k, v in bones.items()}

    while dist_to_target > max_reach * 0.95 and lean_applied < max_lean_degrees:
        lean_applied += lean_step
        lean_rad = math.radians(lean_step)

        # Apply forward lean to 上半身 and 上半身2
        for bone_name in ["上半身", "上半身2"]:
            b = modified_bones.get(bone_name)
            if b:
                # Create a forward lean rotation (X axis in PMX = forward lean)
                lean_quat = (math.sin(lean_rad * 0.5), 0.0, 0.0, math.cos(lean_rad * 0.5))
                lean_quat = _quat_normalize(lean_quat)
                b.rotation = _quat_mul(lean_quat, b.rotation)

        # Recompute shoulder position after lean
        # The shoulder moves forward when torso leans forward
        # Approximate: shoulder moves by lean_angle * torso_height * front_direction
        torso_height = abs(PMX_BONE_POSITIONS["上半身2"][1] - PMX_BONE_POSITIONS["右肩"][1])
        move_dist = math.sin(math.radians(lean_applied)) * torso_height
        # Modify shoulder_pos_pmx (caller should use the returned value)
        # Actually, we need to recompute the full chain. For simplicity,
        # we approximate the shoulder position shift.
        shoulder_pos_pmx = [
            shoulder_pos_pmx[0] + front_pmx[0] * move_dist,
            shoulder_pos_pmx[1] - move_dist * 0.1,  # slight drop
            shoulder_pos_pmx[2] + front_pmx[2] * move_dist,
        ]

        dist_to_target = length(sub(wrist_target_pmx, shoulder_pos_pmx))

    if lean_applied > 0:
        report["lean_applied"] = True
        report["lean_degrees"] = round(lean_applied, 2)
        report["final_dist"] = round(dist_to_target, 4)
        report["max_reach"] = round(max_reach, 4)
        report["reason"] = "torso_lean_compensated"
    else:
        report["reason"] = "no_lean_needed"

    # Store modified shoulder position in report for caller
    report["modified_shoulder_pos"] = [round(x, 4) for x in shoulder_pos_pmx]

    return modified_bones, report
