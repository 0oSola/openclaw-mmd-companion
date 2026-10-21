#!/usr/bin/env python
"""Generate front_depth_v9e VMD using uniform torso-scale position-driven retargeting.

Key insight: Use a SINGLE uniform scale (torso ratio = 8.54x) to map ALL BVH joint
positions to PMX space. This preserves the BVH motion proportions and lets the arm
naturally fold to reach the chin, instead of over-extending.

Fixes:
1. Uniform scale: BVH position * 8.54 → PMX position (no per-bone length scaling)
2. Direct position mapping: BVH wrist → PMX wrist target (preserves BVH motion shape)
3. FABRIK IK: solve arm rotations from mapped target positions
4. Forward offset: small push to clear torso
5. Z-axis flip for BVH→PMX coordinate conversion
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
    _quat_slerp, IDENTITY_QUAT, fk_arm_chain, compute_front_axis, DEFAULT_TPOSE_PROBE,
    PMX_RIGHT_ARM_OFFSETS, PMX_LEFT_ARM_OFFSETS,
    apply_motion_smoothing_v2, apply_joint_limits,
    fabrik_two_bone_ik,
)

VMD_FPS = 30
UNIFORM_SCALE = 8.54  # BVH(meters) → PMX(model units), from torso ratio


def bvh_to_pmx_pos(bvh_pos, bvh_pelvis, pmx_pelvis):
    """Map BVH world position to PMX model space using uniform scale + Z-flip."""
    # Relative to pelvis
    rel = sub(bvh_pos, bvh_pelvis)
    # Scale and Z-flip
    return [
        pmx_pelvis[0] + rel[0] * UNIFORM_SCALE,
        pmx_pelvis[1] + rel[1] * UNIFORM_SCALE,
        pmx_pelvis[2] - rel[2] * UNIFORM_SCALE,  # Z-flip
    ]


def quat_distribute(q, n):
    """Distribute a quaternion rotation across n bones."""
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
    return _quat_normalize((axis[0]*s, axis[1]*s, axis[2]*s, math.cos(per_bone_angle*0.5)))


def smoothstep(edge0, edge1, value):
    if edge0 == edge1:
        return 1.0 if value >= edge1 else 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def solve_arm_from_positions(shoulder_pos_pmx, shoulder_world_quat,
                              target_elbow_pmx, target_wrist_pmx, arm_side):
    """Solve arm rotations from target elbow and wrist positions in PMX space."""
    if arm_side == "left":
        offsets = PMX_LEFT_ARM_OFFSETS
        rest_upper = [2.322, -1.910, 0.128]
        rest_lower = [2.074, -1.529, -0.089]
        shoulderC_key = "左肩C"
    else:
        offsets = PMX_RIGHT_ARM_OFFSETS
        rest_upper = [-2.322, -1.910, 0.128]
        rest_lower = [-2.074, -1.529, -0.089]
        shoulderC_key = "右肩C"

    shoulderC_offset = offsets[shoulderC_key]
    shoulderC_pos = add(shoulder_pos_pmx, _quat_vec(shoulder_world_quat, shoulderC_offset))

    # Target directions from shoulderC
    target_upper_dir = sub(target_elbow_pmx, shoulderC_pos)
    target_lower_dir = sub(target_wrist_pmx, target_elbow_pmx)

    if length(target_upper_dir) < 1e-8 or length(target_lower_dir) < 1e-8:
        return IDENTITY_QUAT, IDENTITY_QUAT

    # World rotations: rotate rest direction to target direction
    upper_world = _quat_between(normalize(rest_upper), normalize(target_upper_dir))
    lower_world = _quat_between(normalize(rest_lower), normalize(target_lower_dir))

    # Convert to local
    upper_local = _quat_mul(_quat_conj(shoulder_world_quat), upper_world)
    lower_local = _quat_mul(_quat_conj(upper_world), lower_world)

    return upper_local, lower_local


def solve_natural_arm_down(shoulder_pos_pmx, shoulder_world_quat, arm_side):
    """Solve a relaxed arms-down chain in PMX world space.

    compute_elbow_angle() uses 0 degrees as fully straight. A relaxed standing
    arm should therefore keep only a small bend here; the gate-side angle will
    read as roughly 170 degrees.
    """
    if arm_side == "left":
        side_sign = 1.0
        offsets = PMX_LEFT_ARM_OFFSETS
        shoulder_c_offset = offsets["左肩C"]
        rest_upper = [2.322, -1.910, 0.128]
        rest_lower = [2.074, -1.529, -0.089]
    else:
        side_sign = -1.0
        offsets = PMX_RIGHT_ARM_OFFSETS
        shoulder_c_offset = offsets["右肩C"]
        rest_upper = [-2.322, -1.910, 0.128]
        rest_lower = [-2.074, -1.529, -0.089]

    upper_len = length(rest_upper)
    lower_len = length(rest_lower)
    upper_dir = normalize([side_sign * 0.15, -0.90, -0.40])

    # Add a small elbow bend toward the model front so the arm is relaxed, not
    # mathematically locked straight. PMX front is negative Z.
    front_dir = [0.0, 0.0, -1.0]
    bend_axis_dir = sub(front_dir, mul(upper_dir, dot(front_dir, upper_dir)))
    if length(bend_axis_dir) < 1e-8:
        bend_axis_dir = [side_sign, 0.0, 0.0]
    bend_axis_dir = normalize(bend_axis_dir)
    bend_rad = math.radians(8.0)
    lower_dir = normalize(add(mul(upper_dir, math.cos(bend_rad)), mul(bend_axis_dir, math.sin(bend_rad))))

    shoulder_c_pos = add(shoulder_pos_pmx, _quat_vec(shoulder_world_quat, shoulder_c_offset))
    target_elbow = add(shoulder_c_pos, mul(upper_dir, upper_len))
    target_wrist = add(target_elbow, mul(lower_dir, lower_len))
    return solve_arm_from_positions(shoulder_pos_pmx, shoulder_world_quat, target_elbow, target_wrist, arm_side)


def retarget_frame(joints, frame_no):
    frames = []
    bvh_pelvis = joints.get("pelvis", [0, 0, 0])
    pmx_pelvis = list(PMX_BONE_POSITIONS["下半身"])

    # Center
    frames.append(BoneFrame("センター", frame_no, (float(bvh_pelvis[0]), float(bvh_pelvis[1]), float(bvh_pelvis[2])), IDENTITY_QUAT))

    # --- Torso ---
    bvh_neck = joints.get("neck", [0, 1, 0])
    pmx_neck = list(PMX_BONE_POSITIONS["首"])
    bvh_dir = sub(bvh_neck, bvh_pelvis)
    bvh_dir_pmx = [bvh_dir[0], bvh_dir[1], -bvh_dir[2]]
    pmx_dir = sub(pmx_neck, pmx_pelvis)
    torso_rot = _quat_between(normalize(pmx_dir), normalize(bvh_dir_pmx))
    torso_per_bone = quat_distribute(torso_rot, 3)
    for bone in ["下半身", "上半身", "上半身2"]:
        frames.append(BoneFrame(bone, frame_no, (0, 0, 0), torso_per_bone))

    # --- Neck/Head ---
    bvh_head = joints.get("head", [0, 1.3, 0])
    pmx_head = list(PMX_BONE_POSITIONS["頭"])
    bvh_neck_dir = sub(bvh_head, bvh_neck)
    bvh_neck_dir_pmx = [bvh_neck_dir[0], bvh_neck_dir[1], -bvh_neck_dir[2]]
    pmx_neck_dir = sub(pmx_head, pmx_neck)
    neck_rot = _quat_between(normalize(pmx_neck_dir), normalize(bvh_neck_dir_pmx))
    neck_per_bone = quat_distribute(neck_rot, 2)
    frames.append(BoneFrame("首", frame_no, (0, 0, 0), neck_per_bone))
    frames.append(BoneFrame("頭", frame_no, (0, 0, 0), neck_per_bone))

    # --- Shoulders = identity ---
    frames.append(BoneFrame("右肩", frame_no, (0, 0, 0), IDENTITY_QUAT))
    frames.append(BoneFrame("左肩", frame_no, (0, 0, 0), IDENTITY_QUAT))

    # Compute shoulder world rotation from torso
    shoulder_world = IDENTITY_QUAT
    for _ in range(3):
        shoulder_world = _quat_mul(shoulder_world, torso_per_bone)

    # Front direction in PMX space
    probe = DEFAULT_TPOSE_PROBE
    front = compute_front_axis(probe["left_shoulder"], probe["right_shoulder"], probe["waist"])
    front_pmx = normalize([front[0] / PMX_SCALE, front[1] / PMX_SCALE, -front[2] / PMX_SCALE])

    # --- Right Arm ---
    # Map BVH joints to PMX space
    bvh_r_sh = joints.get("right_shoulder", [0, 0, 0])
    bvh_r_el = joints.get("right_elbow", [0, 0, 0])
    bvh_r_wr = joints.get("right_wrist", [0, 0, 0])

    pmx_r_sh = bvh_to_pmx_pos(bvh_r_sh, bvh_pelvis, pmx_pelvis)
    pmx_r_el = bvh_to_pmx_pos(bvh_r_el, bvh_pelvis, pmx_pelvis)
    pmx_r_wr = bvh_to_pmx_pos(bvh_r_wr, bvh_pelvis, pmx_pelvis)

    # Use PMX shoulder bone position as fixed root (BVH-mapped shoulder may differ)
    pmx_shoulder_r = list(PMX_BONE_POSITIONS["右肩"])

    # Offset mapped elbow/wrist relative to mapped shoulder, use from PMX shoulder
    elbow_offset = sub(pmx_r_el, pmx_r_sh)
    wrist_offset = sub(pmx_r_wr, pmx_r_sh)
    target_elbow_r = add(pmx_shoulder_r, elbow_offset)
    target_wrist_r = add(pmx_shoulder_r, wrist_offset)

    # Add forward push to clear torso
    target_elbow_r = add(target_elbow_r, mul(front_pmx, 0.3))
    target_wrist_r = add(target_wrist_r, mul(front_pmx, 0.3))

    # --- Phase detection: arm_down vs raise/hold ---
    # BVH wrist Y relative to shoulder Y determines phase
    bvh_r_wr_y = bvh_r_wr[1]
    bvh_r_sh_y = bvh_r_sh[1]
    wrist_raise = bvh_r_wr_y - bvh_r_sh_y
    reach_blend = smoothstep(-0.15, 0.03, wrist_raise)
    is_arm_down = reach_blend <= 1e-6

    # During hold phase (wrist above shoulder), pull wrist toward chin
    if reach_blend > 0:
        # Wrist above shoulder = hold phase: target chin directly
        chin_pmx = _render_to_pmx(probe["chin"])
        # Blend continuously from BVH raise target to chin target.
        chin_blend = reach_blend
        target_wrist_r = [
            target_wrist_r[i] * (1 - chin_blend) + chin_pmx[i] * chin_blend
            for i in range(3)
        ]
        # Offset: right side of chin, raise Y to chin height, moderate forward push
        # FK solver adds ~1.3 Z forward beyond target, so target Z≈-0.2 → FK Z≈-1.5
        # Chin Z=-1.41, chest front Z=-2.11, wrist needs Z in [-2.11, -1.41]
        target_wrist_r = [target_wrist_r[0] - 0.3, target_wrist_r[1] + 0.1, target_wrist_r[2]]
        target_wrist_r = add(target_wrist_r, mul(front_pmx, 0.3))
        # Keep the hand in front of the head mesh. Head front AABB is about
        # PMX Z=-1.97, so a hold target at -2.25 leaves visible clearance.
        safe_hold_z = -2.25
        target_wrist_r[2] = (
            target_wrist_r[2] * (1.0 - reach_blend)
            + min(target_wrist_r[2], safe_hold_z) * reach_blend
        )
        # Cap Z to prevent over-extension
        target_wrist_r[2] = max(target_wrist_r[2], -3.5)

    # Cap wrist Z to stay within body bounds (G2: Z must be >= -4.0)
    target_wrist_r[2] = max(target_wrist_r[2], -3.5)
    target_elbow_r[2] = max(target_elbow_r[2], -3.5)

    natural_r_upper, natural_r_lower = solve_natural_arm_down(pmx_shoulder_r, shoulder_world, "right")
    if is_arm_down:
        # Arm-down is a rest pose, not a reach target. FABRIK plus the previous
        # 25-degree minimum elbow clamp folded the arm in front of the body.
        r_upper, r_lower = natural_r_upper, natural_r_lower
    else:
        # Use FABRIK two-bone IK for precise wrist positioning during reach/hold.
        from fk_world_model import fabrik_two_bone_ik
        reach_r_upper, reach_r_lower, ik_report = fabrik_two_bone_ik(
            pmx_shoulder_r, shoulder_world, IDENTITY_QUAT, IDENTITY_QUAT,
            target_wrist_r, target_elbow_r,
            3.009, 2.578,  # upper arm + forearm lengths
            max_iterations=50, tolerance=0.01, arm_side="right",
        )
        reach_r_upper, reach_r_lower, _ = apply_joint_limits(
            pmx_shoulder_r, shoulder_world, reach_r_upper, reach_r_lower, arm_side="right",
        )
        from fk_world_model import clamp_elbow_angle
        reach_r_upper, reach_r_lower = clamp_elbow_angle(
            pmx_shoulder_r, shoulder_world, reach_r_upper, reach_r_lower,
            min_angle=25.0, max_angle=170.0, arm_side="right",
        )
        r_upper = _quat_slerp(natural_r_upper, reach_r_upper, reach_blend)
        r_lower = _quat_slerp(natural_r_lower, reach_r_lower, reach_blend)
    frames.append(BoneFrame("右腕", frame_no, (0, 0, 0), r_upper))
    frames.append(BoneFrame("右ひじ", frame_no, (0, 0, 0), r_lower))

    # --- Left Arm ---
    bvh_l_sh = joints.get("left_shoulder", [0, 0, 0])
    bvh_l_el = joints.get("left_elbow", [0, 0, 0])
    bvh_l_wr = joints.get("left_wrist", [0, 0, 0])

    pmx_l_sh = bvh_to_pmx_pos(bvh_l_sh, bvh_pelvis, pmx_pelvis)
    pmx_l_el = bvh_to_pmx_pos(bvh_l_el, bvh_pelvis, pmx_pelvis)
    pmx_l_wr = bvh_to_pmx_pos(bvh_l_wr, bvh_pelvis, pmx_pelvis)

    pmx_shoulder_l = list(PMX_BONE_POSITIONS["左肩"])
    elbow_offset_l = sub(pmx_l_el, pmx_l_sh)
    wrist_offset_l = sub(pmx_l_wr, pmx_l_sh)
    target_elbow_l = add(pmx_shoulder_l, elbow_offset_l)
    target_wrist_l = add(pmx_shoulder_l, wrist_offset_l)

    # Forward push for left arm
    target_elbow_l = add(target_elbow_l, mul(front_pmx, 0.3))
    target_wrist_l = add(target_wrist_l, mul(front_pmx, 0.3))

    # Push wrist outward and forward when arm is down (+X for left arm)
    if target_wrist_l[1] < PMX_BONE_POSITIONS["下半身"][1] + 1.0:
        target_wrist_l = [target_wrist_l[0] + 0.6, target_wrist_l[1], min(target_wrist_l[2], -1.9)]
        target_elbow_l = [target_elbow_l[0] + 0.5, target_elbow_l[1], min(target_elbow_l[2], -1.9)]

    # Left arm: keep relaxed at the side. Identity would leave it in T-pose.
    l_upper, l_lower = solve_natural_arm_down(pmx_shoulder_l, shoulder_world, "left")
    frames.append(BoneFrame("左腕", frame_no, (0, 0, 0), l_upper))
    frames.append(BoneFrame("左ひじ", frame_no, (0, 0, 0), l_lower))

    # --- Legs: T-pose (identity) — thinking pose is stationary ---
    for pfx in ["右", "左"]:
        frames.append(BoneFrame(f"{pfx}足", frame_no, (0, 0, 0), IDENTITY_QUAT))
        frames.append(BoneFrame(f"{pfx}ひざ", frame_no, (0, 0, 0), IDENTITY_QUAT))

    # Identity bones
    for bone in ["右手首", "左手首", "右足首", "左足首"]:
        frames.append(BoneFrame(bone, frame_no, (0, 0, 0), IDENTITY_QUAT))

    return frames


def main():
    bvh = load_bvh(Path("imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh"))
    skeleton = bvh_to_skeleton(bvh)
    validated = validate_skeleton(skeleton)
    fps = float(validated["fps"])
    bvh_frames = validated["frames"]

    all_frames = []
    for frame in bvh_frames:
        frame_no = int(round(int(frame["index"]) * VMD_FPS / fps))
        all_frames.extend(retarget_frame(frame["joints"], frame_no))

    print(f"Retargeted {len(bvh_frames)} BVH frames -> {len(all_frames)} bone frames")

    # Enhanced smoothing: stronger for elbow to prevent jumps
    from fk_world_model import BONE_MAX_ANGULAR_VELOCITY
    enhanced_limits = dict(BONE_MAX_ANGULAR_VELOCITY)
    enhanced_limits["右ひじ"] = 0.08  # ~4.6°/frame
    enhanced_limits["左ひじ"] = 0.08
    enhanced_limits["右腕"] = 0.08  # ~4.6°/frame
    enhanced_limits["左腕"] = 0.08
    all_frames, smooth_stats = apply_motion_smoothing_v2(all_frames, max_angular_velocity=enhanced_limits)
    # Second pass to catch residual jumps from non-uniform frame spacing
    all_frames, smooth_stats2 = apply_motion_smoothing_v2(all_frames, max_angular_velocity=enhanced_limits)
    # Third pass for raise->hold transition jitter
    all_frames, smooth_stats3 = apply_motion_smoothing_v2(all_frames, max_angular_velocity=enhanced_limits)
    all_frames, smooth_stats4 = apply_motion_smoothing_v2(all_frames, max_angular_velocity=enhanced_limits)
    all_frames, smooth_stats5 = apply_motion_smoothing_v2(all_frames, max_angular_velocity=enhanced_limits)
    print(f"Smoothing: {smooth_stats['velocity_clamped']} + {smooth_stats2['velocity_clamped']} + {smooth_stats3['velocity_clamped']} + {smooth_stats4['velocity_clamped']} + {smooth_stats5['velocity_clamped']} frames clamped")

    out_path = Path("imgToAction/outputs/vmd/front_depth_v9e.vmd")
    write_vmd(out_path, all_frames, model_name="Eula")
    print(f"Wrote {len(all_frames)} frames to {out_path}")

    # Verify with FK
    by_frame = defaultdict(dict)
    for f in all_frames:
        by_frame[f.frame][f.bone] = f.rotation

    probe = DEFAULT_TPOSE_PROBE
    rs = probe["right_shoulder"]; ls_p = probe["left_shoulder"]
    waist = probe["waist"]; chin = probe["chin"]
    front = compute_front_axis(ls_p, rs, waist)

    print(f"\n{'Frame':>5} {'Phase':>8} {'R_Elbow°':>8} {'R_FD':>6} {'R_ChinD':>7} {'L_FD':>6} {'Verdict':>20}")
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

        shoulderC_offset = PMX_RIGHT_ARM_OFFSETS["右肩C"]
        shoulderC_pos = add(list(PMX_BONE_POSITIONS["右肩"]), _quat_vec(shoulder_world, shoulderC_offset))
        ea = math.degrees(math.acos(max(-1, min(1,
            dot(normalize(sub(fkR["elbow_pos"], shoulderC_pos)),
                normalize(sub(fkR["wrist_pos"], fkR["elbow_pos"])))))))
        upper_dir = normalize(sub(fkR["elbow_pos"], list(PMX_BONE_POSITIONS["右肩"])))
        torso_down = normalize(sub(list(PMX_BONE_POSITIONS["右肩"]), list(PMX_BONE_POSITIONS["下半身"])))
        abd = math.degrees(math.acos(max(-1, min(1, dot(upper_dir, torso_down)))))

        wfd = sum((wrR[i] - rs[i]) * front[i] for i in range(3))
        wfdL = sum((wrL[i] - ls_p[i]) * front[i] for i in range(3))
        wtc = math.sqrt(sum((wrR[i] - chin[i])**2 for i in range(3)))
        phase = "arm_down" if fn < 70 else "raise" if fn < 90 else "hold" if fn < 200 else "lower"
        violations = []
        if ea < 20: violations.append("elbow<20")
        if ea > 175: violations.append("elbow>175")
        # abd>170 only violation when arm is raised (wrist above shoulder)
        wrR_y = wrR[1]
        if abd > 170 and wrR_y > rs[1]: violations.append("abd>170")
        if wfd < 0: violations.append("R_behind")
        if wfdL < 0: violations.append("L_behind")
        verdict = "OK" if not violations else "/".join(violations)
        print(f"{fn:>5} {phase:>8} {ea:>8.1f} {wfd:>6.3f} {wtc:>7.3f} {wfdL:>6.3f} {verdict:>20}")


if __name__ == "__main__":
    main()
