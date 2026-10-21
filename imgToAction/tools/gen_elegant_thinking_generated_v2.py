#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
import sys

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from fk_world_model import (  # noqa: E402
    DEFAULT_TPOSE_PROBE,
    IDENTITY_QUAT,
    PMX_BONE_POSITIONS,
    _pmx_to_render,
    _quat_mul,
    _quat_slerp,
    apply_joint_limits,
    apply_motion_smoothing_v2,
    clamp_elbow_angle,
    compute_front_axis,
    fabrik_two_bone_ik,
    fk_arm_chain,
)
from gen_elegant_thinking_generated import (  # noqa: E402
    compute_elbow_angle,
    euler_quat,
    make_finger_frames,
    render_point,
    smoothstep,
)
from gen_v9e import solve_natural_arm_down  # noqa: E402
from skeleton_motion import add, dot, length, mul, sub  # noqa: E402
from vmd_io import BoneFrame, write_vmd  # noqa: E402


OUT_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated_v2.vmd")
MANIFEST_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated_v2_manifest.json")


def lerp(left: list[float], right: list[float], t: float) -> list[float]:
    return [left[index] * (1.0 - t) + right[index] * t for index in range(3)]


def bezier4(p0: list[float], p1: list[float], p2: list[float], p3: list[float], t: float) -> list[float]:
    a = lerp(p0, p1, t)
    b = lerp(p1, p2, t)
    c = lerp(p2, p3, t)
    d = lerp(a, b, t)
    e = lerp(b, c, t)
    return lerp(d, e, t)


def solve_reach_arm(
    *,
    arm_side: str,
    shoulder_world: tuple[float, float, float, float],
    target_wrist: list[float],
    target_elbow: list[float],
) -> tuple[tuple[float, float, float, float], tuple[float, float, float, float]]:
    shoulder = list(PMX_BONE_POSITIONS["右肩" if arm_side == "right" else "左肩"])
    upper, lower, _report = fabrik_two_bone_ik(
        shoulder,
        shoulder_world,
        IDENTITY_QUAT,
        IDENTITY_QUAT,
        target_wrist,
        target_elbow,
        3.009,
        2.578,
        max_iterations=70,
        tolerance=0.005,
        arm_side=arm_side,
    )
    upper, lower, _ = apply_joint_limits(shoulder, shoulder_world, upper, lower, arm_side=arm_side)
    return clamp_elbow_angle(
        shoulder,
        shoulder_world,
        upper,
        lower,
        min_angle=35.0,
        max_angle=166.0,
        arm_side=arm_side,
    )


def solve_relaxed_arm_down(
    shoulder_pos: list[float],
    shoulder_world: tuple[float, float, float, float],
    arm_side: str,
) -> tuple[tuple[float, float, float, float], tuple[float, float, float, float]]:
    natural_upper, natural_lower = solve_natural_arm_down(shoulder_pos, shoulder_world, arm_side)
    natural_fk = fk_arm_chain(shoulder_pos, shoulder_world, natural_upper, natural_lower, [], [], arm_side=arm_side)
    bent_upper, bent_lower = solve_reach_arm(
        arm_side=arm_side,
        shoulder_world=shoulder_world,
        target_wrist=list(natural_fk["wrist_pos"]),
        target_elbow=list(natural_fk["elbow_pos"]),
    )
    # A small pre-bend makes the initial rest pose anatomical instead of locked straight.
    return (
        _quat_slerp(natural_upper, bent_upper, 0.32),
        _quat_slerp(natural_lower, bent_lower, 0.32),
    )


def base_arm_points() -> dict[str, list[float]]:
    shoulder_world = IDENTITY_QUAT
    r_upper, r_lower = solve_relaxed_arm_down(list(PMX_BONE_POSITIONS["右肩"]), shoulder_world, "right")
    l_upper, l_lower = solve_relaxed_arm_down(list(PMX_BONE_POSITIONS["左肩"]), shoulder_world, "left")
    r_fk = fk_arm_chain(list(PMX_BONE_POSITIONS["右肩"]), shoulder_world, r_upper, r_lower, [], [], arm_side="right")
    l_fk = fk_arm_chain(list(PMX_BONE_POSITIONS["左肩"]), shoulder_world, l_upper, l_lower, [], [], arm_side="left")
    return {
        "right_wrist": list(r_fk["wrist_pos"]),
        "right_elbow": list(r_fk["elbow_pos"]),
        "left_wrist": list(l_fk["wrist_pos"]),
        "left_elbow": list(l_fk["elbow_pos"]),
    }


def generate(
    *,
    right_hold_wrist_override: list[float] | None = None,
    right_hold_elbow_override: list[float] | None = None,
    left_hold_wrist_override: list[float] | None = None,
    left_hold_elbow_override: list[float] | None = None,
) -> tuple[list[BoneFrame], dict]:
    frames: list[BoneFrame] = []
    metrics = []
    probe = DEFAULT_TPOSE_PROBE
    base = base_arm_points()

    # PMX local convention: +X model left, +Y up, -Z model front.
    right_hold_wrist = right_hold_wrist_override or [-0.78, 18.02, -2.28]
    right_hold_elbow = right_hold_elbow_override or [-3.10, 16.55, -1.65]
    left_hold_wrist = left_hold_wrist_override or [1.20, 14.35, -1.86]
    left_hold_elbow = left_hold_elbow_override or [3.05, 15.25, -1.18]

    frame_numbers = list(range(0, 241, 5))
    for frame_no in frame_numbers:
        pre = smoothstep(0, 80, frame_no)
        arm_t = smoothstep(28, 128, frame_no)
        left_t = smoothstep(52, 158, frame_no)
        hold = smoothstep(118, 168, frame_no)
        wave = math.sin((frame_no - 120) / 120.0 * math.pi * 2.0) * hold
        wave2 = math.sin((frame_no - 110) / 95.0 * math.pi * 2.0 + 0.9) * hold

        # Pre-motion starts in head/chest before the arm, so the pose reads as intentional.
        center = (-0.025 * pre + 0.01 * wave, 0.0, 0.0)
        lower_body = IDENTITY_QUAT
        upper_body = euler_quat(-0.8 * pre + 0.10 * wave, 1.0 * pre, 0.35 * pre)
        upper_body2 = euler_quat(-1.35 * pre + 0.18 * wave, 1.7 * pre + 0.15 * wave2, 0.55 * pre)
        neck = euler_quat(-1.9 * pre + 0.20 * wave2, -2.4 * pre, -0.45 * pre)
        head = euler_quat(-4.9 * pre + 0.55 * wave, -5.0 * pre + 0.35 * wave2, -1.2 * pre)

        r_shoulder = euler_quat(0.0, 0.0, -1.8 * arm_t)
        l_shoulder = euler_quat(0.0, 0.0, 1.4 * left_t)
        torso_world = _quat_mul(_quat_mul(lower_body, upper_body), upper_body2)
        r_shoulder_world = _quat_mul(torso_world, r_shoulder)
        l_shoulder_world = _quat_mul(torso_world, l_shoulder)

        natural_r_upper, natural_r_lower = solve_relaxed_arm_down(list(PMX_BONE_POSITIONS["右肩"]), r_shoulder_world, "right")
        natural_l_upper, natural_l_lower = solve_relaxed_arm_down(list(PMX_BONE_POSITIONS["左肩"]), l_shoulder_world, "left")

        # Right wrist follows an arc: out/front first, then inward toward the chin side.
        r_wrist_target = bezier4(
            base["right_wrist"],
            add(base["right_wrist"], [-0.95, 1.25, -0.85]),
            [-2.35, 17.70, -2.85],
            right_hold_wrist,
            arm_t,
        )
        r_elbow_target = bezier4(
            base["right_elbow"],
            add(base["right_elbow"], [-0.75, 0.80, -0.45]),
            [-3.55, 16.15, -1.95],
            right_hold_elbow,
            arm_t,
        )
        if hold > 0:
            r_wrist_target = add(r_wrist_target, [0.025 * wave2, 0.030 * wave, -0.025 * wave2])
            r_elbow_target = add(r_elbow_target, [0.020 * wave, 0.020 * wave2, -0.015 * wave])
        reach_r_upper, reach_r_lower = solve_reach_arm(
            arm_side="right",
            shoulder_world=r_shoulder_world,
            target_wrist=r_wrist_target,
            target_elbow=r_elbow_target,
        )
        r_upper = _quat_slerp(natural_r_upper, reach_r_upper, arm_t)
        r_lower = _quat_slerp(natural_r_lower, reach_r_lower, arm_t)

        # Left arm starts later and travels slowly into a waist support pose.
        l_wrist_target = bezier4(
            base["left_wrist"],
            add(base["left_wrist"], [0.35, 0.70, -0.55]),
            [2.70, 15.05, -1.70],
            left_hold_wrist,
            left_t,
        )
        l_elbow_target = bezier4(
            base["left_elbow"],
            add(base["left_elbow"], [0.55, 0.50, -0.35]),
            [3.45, 15.30, -1.35],
            left_hold_elbow,
            left_t,
        )
        if hold > 0:
            l_wrist_target = add(l_wrist_target, [0.012 * wave, 0.014 * wave2, -0.012 * wave])
        reach_l_upper, reach_l_lower = solve_reach_arm(
            arm_side="left",
            shoulder_world=l_shoulder_world,
            target_wrist=l_wrist_target,
            target_elbow=l_elbow_target,
        )
        l_upper = _quat_slerp(natural_l_upper, reach_l_upper, left_t)
        l_lower = _quat_slerp(natural_l_lower, reach_l_lower, left_t)

        finger_blend = smoothstep(72, 145, frame_no)
        wrist_settle = smoothstep(78, 138, frame_no)
        frames.extend(
            [
                BoneFrame("センター", frame_no, center, IDENTITY_QUAT),
                BoneFrame("下半身", frame_no, (0, 0, 0), lower_body),
                BoneFrame("上半身", frame_no, (0, 0, 0), upper_body),
                BoneFrame("上半身2", frame_no, (0, 0, 0), upper_body2),
                BoneFrame("首", frame_no, (0, 0, 0), neck),
                BoneFrame("頭", frame_no, (0, 0, 0), head),
                BoneFrame("右肩", frame_no, (0, 0, 0), r_shoulder),
                BoneFrame("左肩", frame_no, (0, 0, 0), l_shoulder),
                BoneFrame("右腕", frame_no, (0, 0, 0), r_upper),
                BoneFrame("右ひじ", frame_no, (0, 0, 0), r_lower),
                BoneFrame("左腕", frame_no, (0, 0, 0), l_upper),
                BoneFrame("左ひじ", frame_no, (0, 0, 0), l_lower),
                BoneFrame("右手首", frame_no, (0, 0, 0), euler_quat(3.2 * wrist_settle, -5.5 * wrist_settle + 0.7 * wave, 7.0 * wrist_settle)),
                BoneFrame("左手首", frame_no, (0, 0, 0), euler_quat(1.2 * left_t, 3.0 * left_t, -5.5 * left_t)),
                BoneFrame("右足", frame_no, (0, 0, 0), IDENTITY_QUAT),
                BoneFrame("左足", frame_no, (0, 0, 0), IDENTITY_QUAT),
                BoneFrame("右ひざ", frame_no, (0, 0, 0), IDENTITY_QUAT),
                BoneFrame("左ひざ", frame_no, (0, 0, 0), IDENTITY_QUAT),
                BoneFrame("右足首", frame_no, (0, 0, 0), IDENTITY_QUAT),
                BoneFrame("左足首", frame_no, (0, 0, 0), IDENTITY_QUAT),
            ]
        )
        frames.extend(make_finger_frames(frame_no, finger_blend))

        fk_r = fk_arm_chain(list(PMX_BONE_POSITIONS["右肩"]), r_shoulder_world, r_upper, r_lower, [], [], arm_side="right")
        fk_l = fk_arm_chain(list(PMX_BONE_POSITIONS["左肩"]), l_shoulder_world, l_upper, l_lower, [], [], arm_side="left")
        r_wrist_render = _pmx_to_render(fk_r["wrist_pos"])
        l_wrist_render = _pmx_to_render(fk_l["wrist_pos"])
        front_axis = compute_front_axis(probe["left_shoulder"], probe["right_shoulder"], probe["waist"])
        r_fd = sum((r_wrist_render[i] - probe["right_shoulder"][i]) * front_axis[i] for i in range(3))
        l_fd = sum((l_wrist_render[i] - probe["left_shoulder"][i]) * front_axis[i] for i in range(3))
        metrics.append(
            {
                "frame": frame_no,
                "pre_blend": round(pre, 3),
                "arm_blend": round(arm_t, 3),
                "left_blend": round(left_t, 3),
                "hold_blend": round(hold, 3),
                "right_wrist": render_point(fk_r["wrist_pos"]),
                "right_elbow": render_point(fk_r["elbow_pos"]),
                "left_wrist": render_point(fk_l["wrist_pos"]),
                "left_elbow": render_point(fk_l["elbow_pos"]),
                "right_wrist_front_depth": round(r_fd, 4),
                "left_wrist_front_depth": round(l_fd, 4),
                "right_wrist_to_chin": round(length(sub(r_wrist_render, probe["chin"])), 4),
                "right_elbow_angle": round(compute_elbow_angle(list(PMX_BONE_POSITIONS["右肩"]), fk_r["elbow_pos"], fk_r["wrist_pos"]), 2),
                "left_elbow_angle": round(compute_elbow_angle(list(PMX_BONE_POSITIONS["左肩"]), fk_l["elbow_pos"], fk_l["wrist_pos"]), 2),
            }
        )

    smoothed, pass1 = apply_motion_smoothing_v2(frames)
    smoothed, pass2 = apply_motion_smoothing_v2(smoothed)
    manifest = {
        "action": "eula_elegant_thinking_generated_v2",
        "generation": "procedural_from_scratch",
        "source_vmd": None,
        "output_vmd": str(OUT_PATH),
        "frame_range": [0, 240],
        "keyframe_step": 5,
        "definition": {
            "style": "优雅思考 v2",
            "changes_from_v1": [
                "右手由直达目标改为贝塞尔弧线",
                "头胸预动早于手臂",
                "左右臂错峰启动",
                "hold 阶段加入头胸和手腕微动",
                "下半身和脚踝锁定为 identity",
            ],
            "non_reuse_guarantee": "未读取或复制任何现有 VMD；只使用 PMX 骨骼坐标、T-pose 探测数据和程序化 IK 目标。",
        },
        "smoothing": {
            "pass1": pass1,
            "pass2": pass2,
        },
        "metrics": metrics,
    }
    return smoothed, manifest


def main() -> None:
    frames, manifest = generate()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_vmd(OUT_PATH, frames, model_name="Eula")
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    by_bone = defaultdict(int)
    for frame in frames:
        by_bone[frame.bone] += 1
    print(f"Wrote {len(frames)} bone frames to {OUT_PATH}")
    print(f"Wrote manifest to {MANIFEST_PATH}")
    print(f"Bones: {len(by_bone)}, keyframes per main bone: 右腕={by_bone['右腕']}, 右ひじ={by_bone['右ひじ']}, 左腕={by_bone['左腕']}")


if __name__ == "__main__":
    main()
