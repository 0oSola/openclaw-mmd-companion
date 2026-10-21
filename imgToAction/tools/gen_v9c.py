#!/usr/bin/env python
"""Generate front_depth_v9c VMD with coordinate-aware BVH→PMX retargeting + FK world model correction.

Key fixes:
1. Z-axis flip: BVH (Z-forward, right-handed) → PMX (Z-back, left-handed)
2. Correct bone mapping: 右腕 gets upper arm rotation, 右肩 gets identity
3. Left arm uses PMX_LEFT_ARM_OFFSETS
4. front_axis points in correct direction (-Z = front of character)
"""
import sys
import math
from pathlib import Path
from collections import defaultdict

TOOLS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS_DIR))

from import_bvh_motion import load_bvh, bvh_to_skeleton
from skeleton_motion import validate_skeleton, sub, normalize, dot, length
from vmd_io import BoneFrame, write_vmd
from fk_world_model import (
    PMX_BONE_POSITIONS, PMX_SCALE, _pmx_to_render, _render_to_pmx,
    _quat_between, _quat_mul, _quat_conj, _quat_vec, IDENTITY_QUAT,
    fk_arm_chain, compute_front_axis, DEFAULT_TPOSE_PROBE,
    apply_fabrik_arm_correction, apply_fk_world_model_correction,
    PMX_RIGHT_ARM_OFFSETS, PMX_LEFT_ARM_OFFSETS,
)

VMD_FPS = 30

# PMX T-pose bone directions in PMX model space.
# For arm bones, the direction is from the chain root (shoulderC) to the next joint.
# 右肩C offset from 右肩: [-1.143, -0.224, 0.220]
# shoulderC → elbow = 右腕捩_offset + 右ひじ_offset = [-1.393-0.929, -1.146-0.764, 0.042+0.086]
# elbow → wrist = 右手捩_offset + 右手首_offset = [-1.244-0.830, -0.917-0.612, -0.054-0.035]
PMX_TPOSE_DIRS = {
    # Torso: pointing up (Y)
    "下半身": [0.0, 1.0, 0.0],
    "上半身": [0.0, 1.0, 0.0],
    "上半身2": [0.0, 1.0, 0.0],
    # Neck/head: pointing up
    "首": [0.0, 1.0, 0.0],
    "頭": [0.0, 1.0, 0.0],
    # Right arm
    "右肩": [-1.143, -0.224, 0.220],  # collar bone direction
    "右腕": [-2.322, -1.910, 0.128],  # shoulderC → elbow (upper arm)
    "右ひじ": [-2.074, -1.529, -0.089],  # elbow → wrist (forearm)
    # Left arm (mirrored X)
    "左肩": [1.143, -0.224, 0.220],
    "左腕": [2.322, -1.910, 0.128],
    "左ひじ": [2.074, -1.529, -0.089],
}

# BVH joint pair → list of (PMX bone, BVH parent, BVH child)
# Each bone gets the rotation from its PMX T-pose direction to the Z-flipped BVH direction
BVH_TO_PMX_BONES = [
    # Torso: BVH only has pelvis→neck, distribute same rotation to all 3 torso bones
    ("下半身", "pelvis", "neck"),      # pelvis→neck direction
    ("上半身", "pelvis", "neck"),      # same direction
    ("上半身2", "pelvis", "neck"),     # same direction
    ("首", "neck", "head"),            # neck→head
    ("頭", "neck", "head"),            # same (approximate up)
    # Right arm (右肩 collar bone = identity, no BVH equivalent)
    ("右腕", "right_shoulder", "right_elbow"),  # upper arm = shoulder→elbow
    ("右ひじ", "right_elbow", "right_wrist"),   # forearm = elbow→wrist
    # Left arm (左肩 collar bone = identity)
    ("左腕", "left_shoulder", "left_elbow"),
    ("左ひじ", "left_elbow", "left_wrist"),
    # Right leg
    ("右足", "right_hip", "right_knee"),
    ("右ひざ", "right_knee", "right_ankle"),
    # Left leg
    ("左足", "left_hip", "left_knee"),
    ("左ひざ", "left_knee", "left_ankle"),
]

# Bones that get identity rotation (no BVH mapping or handled differently)
IDENTITY_BONES = {"右肩", "左肩", "右手首", "左手首", "右足首", "左足首", "センター"}


def bvh_to_pmx_direction(bvh_dir):
    """Convert BVH direction to PMX model space by flipping Z axis."""
    return [bvh_dir[0], bvh_dir[1], -bvh_dir[2]]


def retarget_frame(joints, frame_no):
    """Retarget BVH joints to PMX bone frames for one frame."""
    frames = []

    # Center (pelvis position)
    pelvis = joints.get("pelvis", [0, 0, 0])
    frames.append(BoneFrame("センター", frame_no, (float(pelvis[0]), float(pelvis[1]), float(pelvis[2])), IDENTITY_QUAT))

    # Track which BVH joint pairs have been processed
    processed_dirs = {}

    for bone_name, bvh_parent, bvh_child in BVH_TO_PMX_BONES:
        if bvh_parent not in joints or bvh_child not in joints:
            frames.append(BoneFrame(bone_name, frame_no, (0, 0, 0), IDENTITY_QUAT))
            continue

        # For 右肩/左肩 (collar bone), use the same direction as upper arm but shorter
        # The collar bone rotation should match the shoulder→elbow direction approximately
        key = (bvh_parent, bvh_child)
        if key not in processed_dirs:
            bvh_dir = sub(joints[bvh_child], joints[bvh_parent])
            pmx_dir = bvh_to_pmx_direction(bvh_dir)
            processed_dirs[key] = pmx_dir
        else:
            pmx_dir = processed_dirs[key]

        tpose_dir = PMX_TPOSE_DIRS.get(bone_name)
        if tpose_dir is None or length(pmx_dir) < 1e-8 or length(tpose_dir) < 1e-8:
            frames.append(BoneFrame(bone_name, frame_no, (0, 0, 0), IDENTITY_QUAT))
            continue

        q = _quat_between(normalize(tpose_dir), normalize(pmx_dir))
        frames.append(BoneFrame(bone_name, frame_no, (0, 0, 0), q))

    # Identity bones
    for bone_name in IDENTITY_BONES - {"センター"}:
        frames.append(BoneFrame(bone_name, frame_no, (0, 0, 0), IDENTITY_QUAT))

    return frames


def main():
    bvh_path = Path("imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh")
    bvh = load_bvh(bvh_path)
    skeleton = bvh_to_skeleton(bvh)
    validated = validate_skeleton(skeleton)
    fps = float(validated["fps"])
    bvh_frames = validated["frames"]

    # Retarget all frames
    all_frames = []
    for frame in bvh_frames:
        frame_no = int(round(int(frame["index"]) * VMD_FPS / fps))
        all_frames.extend(retarget_frame(frame["joints"], frame_no))

    print(f"Retargeted {len(bvh_frames)} BVH frames -> {len(all_frames)} bone frames")

    # Apply FABRIK arm correction (both arms)
    all_frames, report_fabrik = apply_fabrik_arm_correction(all_frames, min_front_depth=0.5)
    print(f"FABRIK: {report_fabrik['total_corrections']}/{report_fabrik['total_frames']} corrected, front_axis={report_fabrik['front_axis']}")

    # Apply FK world model correction (stages 3-6)
    all_frames, report_fk = apply_fk_world_model_correction(all_frames, min_front_depth=0.5)
    print(f"FK world model: {report_fk['total_corrections']}/{report_fk['total_frames']} corrected")

    # Write VMD
    out_path = Path("imgToAction/outputs/vmd/front_depth_v9c.vmd")
    write_vmd(out_path, all_frames, model_name="Eula")
    print(f"Wrote {len(all_frames)} frames to {out_path}")

    # Verify with FK
    by_frame = defaultdict(dict)
    for f in all_frames:
        by_frame[f.frame][f.bone] = f.rotation

    probe = DEFAULT_TPOSE_PROBE
    rs = probe["right_shoulder"]; ls_p = probe["left_shoulder"]; waist = probe["waist"]; chin = probe["chin"]
    front = compute_front_axis(ls_p, rs, waist)

    for fn in [0, 50, 90, 150, 290]:
        if fn not in by_frame:
            continue
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

        wfdR = sum((wrR[i] - rs[i]) * front[i] for i in range(3))
        wfdL = sum((wrL[i] - ls_p[i]) * front[i] for i in range(3))
        wtcR = math.sqrt(sum((wrR[i] - chin[i])**2 for i in range(3)))

        print(f"  f{fn:3d}: R_wrist=[{wrR[0]:.2f},{wrR[1]:.2f},{wrR[2]:.2f}] fd={wfdR:.3f} chin_d={wtcR:.3f} | L_wrist=[{wrL[0]:.2f},{wrL[1]:.2f},{wrL[2]:.2f}] fd={wfdL:.3f}")


if __name__ == "__main__":
    main()
