#!/usr/bin/env python3
"""导出 v9e 的每帧 FK 关节位置，供 motion_acceptance_gate.py 评测。

输出 JSON 格式: [{"index": 0, "joints": {"right_wrist": [x,y,z], ...}}, ...]
"""
import sys, json, math
from pathlib import Path
from collections import defaultdict

TOOLS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS_DIR))

from import_bvh_motion import load_bvh, bvh_to_skeleton
from skeleton_motion import validate_skeleton, sub, normalize, dot, add, mul
from vmd_io import BoneFrame, write_vmd
from fk_world_model import (
    PMX_BONE_POSITIONS, PMX_SCALE, _pmx_to_render, _render_to_pmx,
    _quat_mul, _quat_vec, _quat_normalize, IDENTITY_QUAT,
    fk_arm_chain, compute_front_axis, DEFAULT_TPOSE_PROBE,
    PMX_RIGHT_ARM_OFFSETS, PMX_LEFT_ARM_OFFSETS,
    apply_motion_smoothing_v2, apply_joint_limits,
)

# Import retarget_frame from gen_v9e
from gen_v9e import retarget_frame, VMD_FPS

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

    # Apply same smoothing as gen_v9e
    from fk_world_model import BONE_MAX_ANGULAR_VELOCITY
    enhanced_limits = dict(BONE_MAX_ANGULAR_VELOCITY)
    enhanced_limits["右ひじ"] = 0.12
    enhanced_limits["左ひじ"] = 0.12
    enhanced_limits["右腕"] = 0.10
    enhanced_limits["左腕"] = 0.10
    all_frames, _ = apply_motion_smoothing_v2(all_frames, max_angular_velocity=enhanced_limits)
    all_frames, _ = apply_motion_smoothing_v2(all_frames, max_angular_velocity=enhanced_limits)

    # Group by frame
    by_frame = defaultdict(dict)
    for f in all_frames:
        by_frame[f.frame][f.bone] = f.rotation

    probe = DEFAULT_TPOSE_PROBE
    rs = probe["right_shoulder"]; ls_p = probe["left_shoulder"]
    waist = probe["waist"]; chin = probe["chin"]
    front = compute_front_axis(ls_p, rs, waist)

    # For each BVH frame, compute FK positions in PMX space
    output_frames = []
    for bvh_fi, bvh_frame in enumerate(bvh_frames):
        frame_no = int(round(int(bvh_frame["index"]) * VMD_FPS / fps))
        if frame_no not in by_frame:
            continue
        bones = by_frame[frame_no]

        # Torso world rotation
        torso_world = IDENTITY_QUAT
        for name in ["下半身", "上半身", "上半身2"]:
            if name in bones:
                torso_world = _quat_mul(torso_world, bones[name])

        # Shoulder world = torso + shoulder bone
        shoulder_world = torso_world  # 右肩 = identity in v9e

        # FK right arm
        r_upper = bones.get("右腕", IDENTITY_QUAT)
        r_lower = bones.get("右ひじ", IDENTITY_QUAT)
        fkR = fk_arm_chain(list(PMX_BONE_POSITIONS["右肩"]), shoulder_world, r_upper, r_lower, [], [], arm_side="right")

        # FK left arm
        l_upper = bones.get("左腕", IDENTITY_QUAT)
        l_lower = bones.get("左ひじ", IDENTITY_QUAT)
        fkL = fk_arm_chain(list(PMX_BONE_POSITIONS["左肩"]), shoulder_world, l_upper, l_lower, [], [], arm_side="left")

        # Head/neck position
        neck_pos = _quat_vec(torso_world, sub(list(PMX_BONE_POSITIONS["首"]), list(PMX_BONE_POSITIONS["下半身"])))
        neck_pos = add(list(PMX_BONE_POSITIONS["下半身"]), neck_pos)
        head_rot = bones.get("首", IDENTITY_QUAT)
        head_pos = _quat_vec(head_rot, sub(list(PMX_BONE_POSITIONS["頭"]), list(PMX_BONE_POSITIONS["首"])))
        head_pos = add(neck_pos, head_pos)

        # Shoulder positions
        r_shoulder_pos = add(list(PMX_BONE_POSITIONS["右肩"]), _quat_vec(torso_world, [0, 0, 0]))
        l_shoulder_pos = add(list(PMX_BONE_POSITIONS["左肩"]), _quat_vec(torso_world, [0, 0, 0]))

        # Leg positions (fixed T-pose, legs don't move in thinking pose)
        r_hip_pos = [-1.081, 12.483, -0.460]
        l_hip_pos = [1.081, 12.483, -0.460]
        r_knee_pos = [-0.933, 7.243, -0.561]
        l_knee_pos = [0.934, 7.244, -0.608]
        r_ankle_pos = [-0.757, 1.780, 0.118]
        l_ankle_pos = [0.757, 1.788, 0.118]

        output_frames.append({
            "index": bvh_fi,
            "joints": {
                "head": [round(v, 4) for v in head_pos],
                "neck": [round(v, 4) for v in neck_pos],
                "right_shoulder": [round(v, 4) for v in r_shoulder_pos],
                "right_elbow": [round(v, 4) for v in fkR["elbow_pos"]],
                "right_wrist": [round(v, 4) for v in fkR["wrist_pos"]],
                "left_shoulder": [round(v, 4) for v in l_shoulder_pos],
                "left_elbow": [round(v, 4) for v in fkL["elbow_pos"]],
                "left_wrist": [round(v, 4) for v in fkL["wrist_pos"]],
                "right_hip": [round(v, 4) for v in r_hip_pos],
                "right_knee": [round(v, 4) for v in r_knee_pos],
                "right_ankle": [round(v, 4) for v in r_ankle_pos],
                "left_hip": [round(v, 4) for v in l_hip_pos],
                "left_knee": [round(v, 4) for v in l_knee_pos],
                "left_ankle": [round(v, 4) for v in l_ankle_pos],
            }
        })

    out_path = Path("imgToAction/outputs/vmd/front_depth_v9e_gate_data.json")
    with open(out_path, "w") as f:
        json.dump(output_frames, f, indent=2)
    print(f"Exported {len(output_frames)} frames to {out_path}")

if __name__ == "__main__":
    main()
