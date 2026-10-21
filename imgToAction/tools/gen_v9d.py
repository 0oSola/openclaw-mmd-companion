#!/usr/bin/env python
"""Generate front_depth_v9d VMD using position-driven retargeting.

Eliminates retargeter↔IK conflict by making IK the ONLY source of rotation.
For each frame:
1. BVH joint directions → PMX target positions (direction * PMX bone length)
2. FABRIK solves arm rotations from shoulder→target_elbow→target_wrist
3. Torso: BVH pelvis→neck direction → rotation for torso bones
4. Z-axis flip applied to all BVH directions
"""
import sys
import math
from pathlib import Path
from collections import defaultdict

TOOLS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS_DIR))

from import_bvh_motion import load_bvh, bvh_to_skeleton
from skeleton_motion import validate_skeleton, sub, normalize, dot, length, add, mul
from vmd_io import BoneFrame, write_vmd
from fk_world_model import (
    PMX_BONE_POSITIONS, PMX_SCALE, _pmx_to_render, _render_to_pmx,
    _quat_between, _quat_mul, _quat_conj, _quat_vec, _quat_normalize,
    IDENTITY_QUAT, fk_arm_chain, compute_front_axis, DEFAULT_TPOSE_PROBE,
    PMX_RIGHT_ARM_OFFSETS, PMX_LEFT_ARM_OFFSETS,
    apply_motion_smoothing_v2, apply_joint_limits, clamp_elbow_angle,
)

VMD_FPS = 30


def _quat_axis_angle(axis, radians):
    ax = normalize(list(axis))
    half = radians * 0.5
    s = math.sin(half)
    return _quat_normalize((ax[0]*s, ax[1]*s, ax[2]*s, math.cos(half)))


def bvh_to_pmx_dir(bvh_dir):
    """Convert BVH direction to PMX model space (Z-flip)."""
    return [bvh_dir[0], bvh_dir[1], -bvh_dir[2]]


def compute_torso_rotation(bvh_pelvis, bvh_neck, pmx_pelvis, pmx_neck):
    """Compute rotation that maps PMX torso up direction to BVH pelvis→neck direction."""
    bvh_dir = bvh_to_pmx_dir(sub(bvh_neck, bvh_pelvis))
    pmx_dir = sub(pmx_neck, pmx_pelvis)
    if length(bvh_dir) < 1e-8 or length(pmx_dir) < 1e-8:
        return IDENTITY_QUAT
    return _quat_between(normalize(pmx_dir), normalize(bvh_dir))


def quat_distribute(q, n):
    """Distribute a quaternion rotation across n bones (nth root of q)."""
    if n <= 1:
        return q
    angle = 2.0 * math.acos(max(-1.0, min(1.0, abs(q[3]))))
    if angle < 1e-8:
        return IDENTITY_QUAT
    sin_half = math.sin(angle * 0.5)
    if abs(sin_half) < 1e-8:
        return IDENTITY_QUAT
    axis = [q[0] / sin_half, q[1] / sin_half, q[2] / sin_half]
    if q[3] < 0:
        axis = [-axis[0], -axis[1], -axis[2]]
    axis = normalize(axis)
    per_bone_angle = angle / n
    s = math.sin(per_bone_angle * 0.5)
    return _quat_normalize((axis[0] * s, axis[1] * s, axis[2] * s, math.cos(per_bone_angle * 0.5)))


def solve_arm_ik(
    shoulder_pos_pmx, shoulder_world_quat,
    target_elbow_pmx, target_wrist_pmx,
    upper_length, lower_length, arm_side,
):
    """Solve arm rotations (upper_local, lower_local) from target positions.

    Uses analytic two-bone IK: given shoulder, target elbow, target wrist,
    compute the rotations that place the arm chain at those positions.
    """
    # Compute desired directions
    target_upper_dir = sub(target_elbow_pmx, shoulder_pos_pmx)
    target_lower_dir = sub(target_wrist_pmx, target_elbow_pmx)

    if length(target_upper_dir) < 1e-8 or length(target_lower_dir) < 1e-8:
        return IDENTITY_QUAT, IDENTITY_QUAT

    # Normalize to unit length, then scale to PMX bone length
    upper_dir_norm = normalize(target_upper_dir)
    lower_dir_norm = normalize(target_lower_dir)

    # The shoulderC position (arm chain root)
    if arm_side == "left":
        offsets = PMX_LEFT_ARM_OFFSETS
        shoulderC_offset = offsets["左肩C"]
    else:
        offsets = PMX_RIGHT_ARM_OFFSETS
        shoulderC_offset = offsets["右肩C"]
    shoulderC_pos = add(shoulder_pos_pmx, _quat_vec(shoulder_world_quat, shoulderC_offset))

    # Rest directions (from shoulderC)
    if arm_side == "left":
        rest_upper = [2.322, -1.910, 0.128]
        rest_lower = [2.074, -1.529, -0.089]
    else:
        rest_upper = [-2.322, -1.910, 0.128]
        rest_lower = [-2.074, -1.529, -0.089]

    # Target upper direction from shoulderC (not from shoulder)
    target_upper_from_shoulderC = sub(target_elbow_pmx, shoulderC_pos)
    if length(target_upper_from_shoulderC) < 1e-8:
        return IDENTITY_QUAT, IDENTITY_QUAT

    # World rotations
    upper_world = _quat_between(normalize(rest_upper), normalize(target_upper_from_shoulderC))
    lower_world = _quat_between(normalize(rest_lower), normalize(target_lower_dir))

    # Convert to local rotations
    upper_local = _quat_mul(_quat_conj(shoulder_world_quat), upper_world)
    lower_local = _quat_mul(_quat_conj(upper_world), lower_world)

    return upper_local, lower_local


def retarget_frame_position_driven(joints, frame_no, pmx_shoulder_pos, pmx_shoulder_world):
    """Retarget one BVH frame using position-driven IK."""
    frames = []

    # Center position
    pelvis = joints.get("pelvis", [0, 0, 0])
    frames.append(BoneFrame("センター", frame_no, (float(pelvis[0]), float(pelvis[1]), float(pelvis[2])), IDENTITY_QUAT))

    # --- Torso ---
    # BVH pelvis→neck direction → rotation for all 3 torso bones
    bvh_pelvis = joints.get("pelvis", [0, 0, 0])
    bvh_neck = joints.get("neck", [0, 1, 0])
    pmx_pelvis = list(PMX_BONE_POSITIONS["下半身"])
    pmx_neck = list(PMX_BONE_POSITIONS["首"])
    torso_rot = compute_torso_rotation(bvh_pelvis, bvh_neck, pmx_pelvis, pmx_neck)
    torso_per_bone = quat_distribute(torso_rot, 3)

    for bone in ["下半身", "上半身", "上半身2"]:
        frames.append(BoneFrame(bone, frame_no, (0, 0, 0), torso_per_bone))

    # --- Neck/Head ---
    bvh_neck_pos = joints.get("neck", [0, 1, 0])
    bvh_head_pos = joints.get("head", [0, 1.3, 0])
    pmx_neck_pos = list(PMX_BONE_POSITIONS["首"])
    pmx_head_pos = list(PMX_BONE_POSITIONS["頭"])
    neck_rot = compute_torso_rotation(bvh_neck_pos, bvh_head_pos, pmx_neck_pos, pmx_head_pos)
    neck_per_bone = quat_distribute(neck_rot, 2)
    frames.append(BoneFrame("首", frame_no, (0, 0, 0), neck_per_bone))
    frames.append(BoneFrame("頭", frame_no, (0, 0, 0), neck_per_bone))

    # --- Shoulder (collar bone) = identity ---
    frames.append(BoneFrame("右肩", frame_no, (0, 0, 0), IDENTITY_QUAT))
    frames.append(BoneFrame("左肩", frame_no, (0, 0, 0), IDENTITY_QUAT))

    # --- Right Arm ---
    bvh_r_shoulder = joints.get("right_shoulder", [0, 0, 0])
    bvh_r_elbow = joints.get("right_elbow", [0, 0, 0])
    bvh_r_wrist = joints.get("right_wrist", [0, 0, 0])

    # Direction in BVH → Z-flip → PMX
    upper_dir = bvh_to_pmx_dir(sub(bvh_r_elbow, bvh_r_shoulder))
    lower_dir = bvh_to_pmx_dir(sub(bvh_r_wrist, bvh_r_elbow))

    # Scale to PMX bone lengths
    pmx_upper_len = 3.009  # shoulderC → elbow
    pmx_lower_len = 2.578   # elbow → wrist

    target_elbow = add(pmx_shoulder_pos, mul(normalize(upper_dir), pmx_upper_len))
    target_wrist = add(target_elbow, mul(normalize(lower_dir), pmx_lower_len))

    # Solve arm IK
    r_upper, r_lower = solve_arm_ik(
        pmx_shoulder_pos, pmx_shoulder_world,
        target_elbow, target_wrist,
        pmx_upper_len, pmx_lower_len, "right",
    )

    # Apply joint limits
    r_upper, r_lower, _ = apply_joint_limits(pmx_shoulder_pos, pmx_shoulder_world, r_upper, r_lower, arm_side="right")

    frames.append(BoneFrame("右腕", frame_no, (0, 0, 0), r_upper))
    frames.append(BoneFrame("右ひじ", frame_no, (0, 0, 0), r_lower))

    # --- Left Arm ---
    bvh_l_shoulder = joints.get("left_shoulder", [0, 0, 0])
    bvh_l_elbow = joints.get("left_elbow", [0, 0, 0])
    bvh_l_wrist = joints.get("left_wrist", [0, 0, 0])

    upper_dir_l = bvh_to_pmx_dir(sub(bvh_l_elbow, bvh_l_shoulder))
    lower_dir_l = bvh_to_pmx_dir(sub(bvh_l_wrist, bvh_l_elbow))

    pmx_l_shoulder = list(PMX_BONE_POSITIONS["左肩"])
    target_elbow_l = add(pmx_l_shoulder, mul(normalize(upper_dir_l), pmx_upper_len))
    target_wrist_l = add(target_elbow_l, mul(normalize(lower_dir_l), pmx_lower_len))

    l_upper, l_lower = solve_arm_ik(
        pmx_l_shoulder, pmx_shoulder_world,
        target_elbow_l, target_wrist_l,
        pmx_upper_len, pmx_lower_len, "left",
    )

    l_upper, l_lower, _ = apply_joint_limits(pmx_l_shoulder, pmx_shoulder_world, l_upper, l_lower, arm_side="left")

    frames.append(BoneFrame("左腕", frame_no, (0, 0, 0), l_upper))
    frames.append(BoneFrame("左ひじ", frame_no, (0, 0, 0), l_lower))

    # --- Legs (simplified: direction-based) ---
    for side, pfx, bvh_hip, bvh_knee, bvh_ankle, pmx_hip_name in [
        ("right", "右", "right_hip", "right_knee", "right_ankle", None),
        ("left", "左", "left_hip", "left_knee", "left_ankle", None),
    ]:
        hip_j = joints.get(bvh_hip, [0, 0, 0])
        knee_j = joints.get(bvh_knee, [0, 0, 0])
        ankle_j = joints.get(bvh_ankle, [0, 0, 0])
        thigh_dir = bvh_to_pmx_dir(sub(knee_j, hip_j))
        shin_dir = bvh_to_pmx_dir(sub(ankle_j, knee_j))
        thigh_rot = _quat_between([0, -1, 0], normalize(thigh_dir))
        shin_rot = _quat_between([0, -1, 0], normalize(shin_dir))
        frames.append(BoneFrame(f"{pfx}足", frame_no, (0, 0, 0), thigh_rot))
        frames.append(BoneFrame(f"{pfx}ひざ", frame_no, (0, 0, 0), shin_rot))

    # --- Identity bones ---
    for bone in ["右手首", "左手首", "右足首", "左足首"]:
        frames.append(BoneFrame(bone, frame_no, (0, 0, 0), IDENTITY_QUAT))

    return frames


def main():
    bvh_path = Path("imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh")
    bvh = load_bvh(bvh_path)
    skeleton = bvh_to_skeleton(bvh)
    validated = validate_skeleton(skeleton)
    fps = float(validated["fps"])
    bvh_frames = validated["frames"]

    pmx_shoulder_pos = list(PMX_BONE_POSITIONS["右肩"])
    pmx_shoulder_world = IDENTITY_QUAT  # simplified: no torso rotation yet

    all_frames = []
    for frame in bvh_frames:
        frame_no = int(round(int(frame["index"]) * VMD_FPS / fps))
        all_frames.extend(retarget_frame_position_driven(
            frame["joints"], frame_no, pmx_shoulder_pos, pmx_shoulder_world
        ))

    print(f"Retargeted {len(bvh_frames)} BVH frames -> {len(all_frames)} bone frames")

    # Apply motion smoothing
    all_frames, smooth_stats = apply_motion_smoothing_v2(all_frames)
    print(f"Smoothing: {smooth_stats['velocity_clamped']} frames clamped")

    # Write VMD
    out_path = Path("imgToAction/outputs/vmd/front_depth_v9d.vmd")
    write_vmd(out_path, all_frames, model_name="Eula")
    print(f"Wrote {len(all_frames)} frames to {out_path}")

    # Verify with FK
    by_frame = defaultdict(dict)
    for f in all_frames:
        by_frame[f.frame][f.bone] = f.rotation

    probe = DEFAULT_TPOSE_PROBE
    rs = probe["right_shoulder"]; ls = probe["left_shoulder"]; waist = probe["waist"]; chin = probe["chin"]
    front = compute_front_axis(ls, rs, waist)

    print(f"\n{'Frame':>5} {'Phase':>8} {'R_Elbow°':>8} {'R_Abd°':>6} {'R_FD':>6} {'R_ChinD':>7} {'L_FD':>6} {'Verdict':>20}")
    for fn in [0, 30, 50, 70, 80, 90, 100, 110, 120, 130, 150, 170, 190, 290]:
        if fn not in by_frame: continue
        bones = by_frame[fn]

        shoulder_world = IDENTITY_QUAT
        for name in ["下半身", "上半身", "上半身2", "右肩"]:
            if name in bones:
                shoulder_world = _quat_mul(shoulder_world, bones[name])

        r_upper = bones.get("右腕", IDENTITY_QUAT)
        r_lower = bones.get("右ひじ", IDENTITY_QUAT)
        l_upper = bones.get("左腕", IDENTITY_QUAT)
        l_lower = bones.get("左ひじ", IDENTITY_QUAT)

        fkR = fk_arm_chain(list(PMX_BONE_POSITIONS["右肩"]), shoulder_world, r_upper, r_lower, [], [], arm_side="right")
        wrR = _pmx_to_render(fkR["wrist_pos"])
        fkL = fk_arm_chain(list(PMX_BONE_POSITIONS["左肩"]), shoulder_world, l_upper, l_lower, [], [], arm_side="left")
        wrL = _pmx_to_render(fkL["wrist_pos"])

        # Elbow angle
        shoulderC_offset = PMX_RIGHT_ARM_OFFSETS["右肩C"]
        shoulderC_pos = add(list(PMX_BONE_POSITIONS["右肩"]), _quat_vec(shoulder_world, shoulderC_offset))
        ea = math.degrees(math.acos(max(-1, min(1,
            dot(normalize(sub(fkR["elbow_pos"], shoulderC_pos)),
                normalize(sub(fkR["wrist_pos"], fkR["elbow_pos"])))))))

        # Shoulder abduction
        upper_dir = normalize(sub(fkR["elbow_pos"], list(PMX_BONE_POSITIONS["右肩"])))
        torso_down = normalize(sub(list(PMX_BONE_POSITIONS["右肩"]), list(PMX_BONE_POSITIONS["下半身"])))
        abd = math.degrees(math.acos(max(-1, min(1, dot(upper_dir, torso_down)))))

        wfd = sum((wrR[i] - rs[i]) * front[i] for i in range(3))
        wfdL = sum((wrL[i] - ls[i]) * front[i] for i in range(3))
        wtc = math.sqrt(sum((wrR[i] - chin[i])**2 for i in range(3)))

        phase = "arm_down" if fn < 70 else "raise" if fn < 90 else "hold" if fn < 200 else "lower"
        violations = []
        if ea < 20: violations.append("elbow<20")
        if ea > 175: violations.append("elbow>175")
        if abd > 170: violations.append("abd>170")
        if wfd < 0: violations.append("R_behind")
        if wfdL < 0: violations.append("L_behind")
        verdict = "OK" if not violations else "/".join(violations)

        print(f"{fn:>5} {phase:>8} {ea:>8.1f} {abd:>6.1f} {wfd:>6.3f} {wtc:>7.3f} {wfdL:>6.3f} {verdict:>20}")


if __name__ == "__main__":
    main()
