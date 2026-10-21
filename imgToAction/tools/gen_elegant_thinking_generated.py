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
    PMX_LEFT_ARM_OFFSETS,
    PMX_RIGHT_ARM_OFFSETS,
    _pmx_to_render,
    _quat_mul,
    _quat_slerp,
    _quat_vec,
    apply_joint_limits,
    apply_motion_smoothing_v2,
    clamp_elbow_angle,
    compute_front_axis,
    fabrik_two_bone_ik,
    fk_arm_chain,
)
from gen_v9e import quat_distribute, solve_natural_arm_down  # noqa: E402
from skeleton_motion import add, dot, length, mul, normalize, sub  # noqa: E402
from vmd_io import BoneFrame, write_vmd  # noqa: E402


VMD_FPS = 30
OUT_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated.vmd")
MANIFEST_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated_manifest.json")


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 1.0 if value >= edge1 else 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def axis_angle(axis_index: int, degrees: float) -> tuple[float, float, float, float]:
    radians = math.radians(degrees)
    half = radians * 0.5
    s = math.sin(half)
    if axis_index == 0:
        return (s, 0.0, 0.0, math.cos(half))
    if axis_index == 1:
        return (0.0, s, 0.0, math.cos(half))
    return (0.0, 0.0, s, math.cos(half))


def euler_quat(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> tuple[float, float, float, float]:
    quat = IDENTITY_QUAT
    for axis, degrees in enumerate((x, y, z)):
        if abs(degrees) > 1e-8:
            quat = _quat_mul(quat, axis_angle(axis, degrees))
    return quat


def render_point(pmx_point: list[float]) -> list[float]:
    point = _pmx_to_render(pmx_point)
    return [round(float(value), 4) for value in point]


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
        max_iterations=60,
        tolerance=0.005,
        arm_side=arm_side,
    )
    upper, lower, _ = apply_joint_limits(shoulder, shoulder_world, upper, lower, arm_side=arm_side)
    return clamp_elbow_angle(
        shoulder,
        shoulder_world,
        upper,
        lower,
        min_angle=32.0,
        max_angle=168.0,
        arm_side=arm_side,
    )


def make_finger_frames(frame_no: int, blend: float) -> list[BoneFrame]:
    # Subtle relaxed fingers: enough curvature to avoid a flat T-pose hand, not a fist.
    right_fingers = {
        "右親指０": (10, -6, 4),
        "右親指１": (12, 0, 0),
        "右人指１": (18, 0, 0),
        "右人指２": (8, 0, 0),
        "右中指１": (20, 0, 0),
        "右中指２": (9, 0, 0),
        "右薬指１": (22, 0, 0),
        "右薬指２": (10, 0, 0),
        "右小指１": (24, 0, 0),
        "右小指２": (11, 0, 0),
    }
    left_fingers = {
        "左親指０": (8, 5, -3),
        "左親指１": (10, 0, 0),
        "左人指１": (14, 0, 0),
        "左人指２": (6, 0, 0),
        "左中指１": (16, 0, 0),
        "左中指２": (7, 0, 0),
        "左薬指１": (18, 0, 0),
        "左薬指２": (8, 0, 0),
        "左小指１": (20, 0, 0),
        "左小指２": (9, 0, 0),
    }
    frames: list[BoneFrame] = []
    for bone, degrees in {**right_fingers, **left_fingers}.items():
        scaled = tuple(value * blend for value in degrees)
        frames.append(BoneFrame(bone, frame_no, (0.0, 0.0, 0.0), euler_quat(*scaled)))
    return frames


def compute_elbow_angle(shoulder: list[float], elbow: list[float], wrist: list[float]) -> float:
    upper = normalize(sub(elbow, shoulder))
    lower = normalize(sub(wrist, elbow))
    c = max(-1.0, min(1.0, dot(upper, lower)))
    return math.degrees(math.acos(c))


def generate() -> tuple[list[BoneFrame], dict]:
    frames: list[BoneFrame] = []
    frame_numbers = list(range(0, 211, 10))
    probe = DEFAULT_TPOSE_PROBE
    chin_pmx = [0.0, 18.42, -0.50]

    metrics = []
    for frame_no in frame_numbers:
        raise_blend = smoothstep(30, 88, frame_no)
        hold_blend = smoothstep(82, 115, frame_no)
        settle = smoothstep(110, 160, frame_no)
        breathe = math.sin(frame_no / 210.0 * math.pi * 2.0) * 0.6

        # Elegant thinking body line: tiny weight shift, tiny torso turn, head slightly down.
        center = (-0.10 * settle, 0.0, 0.0)
        lower_body = euler_quat(0.0, -2.0 * settle, -1.0 * settle)
        upper_body = euler_quat(-1.5 * settle, 2.5 * settle, 1.0 * settle)
        upper_body2 = euler_quat(-2.5 * settle, 3.0 * settle, 1.2 * settle)
        neck = euler_quat(-3.0 * settle, -4.0 * settle, -1.2 * settle)
        head = euler_quat(-7.5 * settle + breathe * 0.25, -7.0 * settle, -2.0 * settle)

        frames.append(BoneFrame("センター", frame_no, center, IDENTITY_QUAT))
        frames.append(BoneFrame("下半身", frame_no, (0, 0, 0), lower_body))
        frames.append(BoneFrame("上半身", frame_no, (0, 0, 0), upper_body))
        frames.append(BoneFrame("上半身2", frame_no, (0, 0, 0), upper_body2))
        frames.append(BoneFrame("首", frame_no, (0, 0, 0), neck))
        frames.append(BoneFrame("頭", frame_no, (0, 0, 0), head))
        frames.append(BoneFrame("右肩", frame_no, (0, 0, 0), euler_quat(0.0, 0.0, -4.0 * raise_blend)))
        frames.append(BoneFrame("左肩", frame_no, (0, 0, 0), euler_quat(0.0, 0.0, 2.5 * hold_blend)))

        shoulder_world = IDENTITY_QUAT
        for quat in (lower_body, upper_body, upper_body2):
            shoulder_world = _quat_mul(shoulder_world, quat)

        natural_r_upper, natural_r_lower = solve_natural_arm_down(
            list(PMX_BONE_POSITIONS["右肩"]),
            shoulder_world,
            "right",
        )
        natural_l_upper, natural_l_lower = solve_natural_arm_down(
            list(PMX_BONE_POSITIONS["左肩"]),
            shoulder_world,
            "left",
        )

        # Right hand approaches the front-right edge of the chin, staying in front of the head mesh.
        right_wrist_target = [
            chin_pmx[0] - 0.82,
            chin_pmx[1] - 0.34 + 0.04 * breathe,
            -2.34,
        ]
        right_elbow_hint = [
            -3.35,
            16.65 - 0.10 * settle,
            -1.72,
        ]
        reach_r_upper, reach_r_lower = solve_reach_arm(
            arm_side="right",
            shoulder_world=shoulder_world,
            target_wrist=right_wrist_target,
            target_elbow=right_elbow_hint,
        )
        r_upper = _quat_slerp(natural_r_upper, reach_r_upper, raise_blend)
        r_lower = _quat_slerp(natural_r_lower, reach_r_lower, raise_blend)

        # Left arm folds lightly across the waist as a support, but remains outside torso core.
        left_wrist_target = [
            1.20,
            14.35,
            -1.82,
        ]
        left_elbow_hint = [
            3.20,
            15.30,
            -1.20,
        ]
        reach_l_upper, reach_l_lower = solve_reach_arm(
            arm_side="left",
            shoulder_world=shoulder_world,
            target_wrist=left_wrist_target,
            target_elbow=left_elbow_hint,
        )
        l_upper = _quat_slerp(natural_l_upper, reach_l_upper, hold_blend)
        l_lower = _quat_slerp(natural_l_lower, reach_l_lower, hold_blend)

        frames.append(BoneFrame("右腕", frame_no, (0, 0, 0), r_upper))
        frames.append(BoneFrame("右ひじ", frame_no, (0, 0, 0), r_lower))
        frames.append(BoneFrame("左腕", frame_no, (0, 0, 0), l_upper))
        frames.append(BoneFrame("左ひじ", frame_no, (0, 0, 0), l_lower))
        frames.append(BoneFrame("右手首", frame_no, (0, 0, 0), euler_quat(4.0 * hold_blend, -7.0 * hold_blend, 10.0 * hold_blend)))
        frames.append(BoneFrame("左手首", frame_no, (0, 0, 0), euler_quat(2.0 * hold_blend, 4.0 * hold_blend, -7.0 * hold_blend)))

        # Stationary elegant stance.
        frames.append(BoneFrame("右足", frame_no, (0, 0, 0), euler_quat(0.0, -1.5 * settle, 0.0)))
        frames.append(BoneFrame("左足", frame_no, (0, 0, 0), euler_quat(0.0, 1.0 * settle, 0.0)))
        frames.append(BoneFrame("右ひざ", frame_no, (0, 0, 0), euler_quat(0.0, 0.0, -1.0 * settle)))
        frames.append(BoneFrame("左ひざ", frame_no, (0, 0, 0), euler_quat(0.0, 0.0, 0.8 * settle)))
        frames.append(BoneFrame("右足首", frame_no, (0, 0, 0), IDENTITY_QUAT))
        frames.append(BoneFrame("左足首", frame_no, (0, 0, 0), IDENTITY_QUAT))
        frames.extend(make_finger_frames(frame_no, hold_blend))

        fk_r = fk_arm_chain(list(PMX_BONE_POSITIONS["右肩"]), shoulder_world, r_upper, r_lower, [], [], arm_side="right")
        fk_l = fk_arm_chain(list(PMX_BONE_POSITIONS["左肩"]), shoulder_world, l_upper, l_lower, [], [], arm_side="left")
        r_wrist_render = _pmx_to_render(fk_r["wrist_pos"])
        l_wrist_render = _pmx_to_render(fk_l["wrist_pos"])
        r_elbow_render = _pmx_to_render(fk_r["elbow_pos"])
        l_elbow_render = _pmx_to_render(fk_l["elbow_pos"])
        front_axis = compute_front_axis(probe["left_shoulder"], probe["right_shoulder"], probe["waist"])
        r_fd = sum((r_wrist_render[i] - probe["right_shoulder"][i]) * front_axis[i] for i in range(3))
        l_fd = sum((l_wrist_render[i] - probe["left_shoulder"][i]) * front_axis[i] for i in range(3))
        r_chin_dist = length(sub(r_wrist_render, probe["chin"]))
        metrics.append(
            {
                "frame": frame_no,
                "raise_blend": round(raise_blend, 3),
                "hold_blend": round(hold_blend, 3),
                "right_wrist": render_point(fk_r["wrist_pos"]),
                "right_elbow": render_point(fk_r["elbow_pos"]),
                "left_wrist": render_point(fk_l["wrist_pos"]),
                "left_elbow": render_point(fk_l["elbow_pos"]),
                "right_wrist_front_depth": round(r_fd, 4),
                "left_wrist_front_depth": round(l_fd, 4),
                "right_wrist_to_chin": round(r_chin_dist, 4),
                "right_elbow_angle": round(compute_elbow_angle(list(PMX_BONE_POSITIONS["右肩"]), fk_r["elbow_pos"], fk_r["wrist_pos"]), 2),
                "left_elbow_angle": round(compute_elbow_angle(list(PMX_BONE_POSITIONS["左肩"]), fk_l["elbow_pos"], fk_l["wrist_pos"]), 2),
            }
        )

    # Limit frame-to-frame jumps while preserving the authored pose.
    smoothed, pass1 = apply_motion_smoothing_v2(frames)
    smoothed, pass2 = apply_motion_smoothing_v2(smoothed)
    manifest = {
        "action": "eula_elegant_thinking_generated",
        "generation": "procedural_from_scratch",
        "source_vmd": None,
        "output_vmd": str(OUT_PATH),
        "fps": VMD_FPS,
        "frame_range": [0, 210],
        "definition": {
            "style": "优雅思考",
            "phases": {
                "0-40": "自然站立",
                "40-90": "右手抬向下巴",
                "90-170": "右手停在下巴前方，左臂轻收支撑，头微低偏转",
                "170-210": "保持姿态并加入轻微呼吸感",
            },
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
