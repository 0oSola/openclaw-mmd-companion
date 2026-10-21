#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
import sys

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from fk_world_model import (  # noqa: E402
    IDENTITY_QUAT,
    PMX_BONE_POSITIONS,
    _quat_mul,
    _quat_slerp,
    fk_arm_chain,
)
from gen_elegant_thinking_generated import compute_elbow_angle, euler_quat, smoothstep  # noqa: E402
from gen_elegant_thinking_generated_v2 import (  # noqa: E402
    base_arm_points,
    bezier4,
    solve_reach_arm,
)
from skeleton_motion import length, sub  # noqa: E402
from vmd_io import BoneFrame, write_vmd  # noqa: E402


DEFAULT_NAME = "eula_elegant_thinking_generated_v13"

# Initial search seed. The final values are selected from rendered PMX probes,
# not from the generator's approximate FK alone.
DEFAULT_RIGHT_WRIST = [-1.35, 17.15, -3.20]
DEFAULT_RIGHT_ELBOW = [-2.20, 15.05, -1.75]
DEFAULT_RIGHT_WRIST_EULER = (-14.0, -50.0, -38.0)
DEFAULT_RIGHT_APPROACH_WRIST_EULER = (30.0, 60.0, -20.0)
DEFAULT_RIGHT_ROUTE_1_WRIST_EULER = DEFAULT_RIGHT_APPROACH_WRIST_EULER
DEFAULT_RIGHT_ROUTE_2_WRIST_EULER = DEFAULT_RIGHT_APPROACH_WRIST_EULER
DEFAULT_RIGHT_ROUTE_3_WRIST_EULER = DEFAULT_RIGHT_APPROACH_WRIST_EULER
DEFAULT_RIGHT_CORRIDOR_WRIST_EULER = DEFAULT_RIGHT_APPROACH_WRIST_EULER
DEFAULT_RIGHT_PRECONTACT_WRIST_EULER = (0.0, -60.0, -20.0)
DEFAULT_RIGHT_TWIST_EULER = (25.0, 0.0, 0.0)
DEFAULT_RIGHT_ROUTE_TWIST_EULER = (75.0, 0.0, 0.0)
RIGHT_PRECONTACT_WRIST_OFFSET = (0.0, -1.15, 0.0)
RIGHT_PRECONTACT_ELBOW_OFFSET = (0.0, -0.45, 0.0)
DEFAULT_NECK_EULER = (-14.0, -2.2, -0.35)
DEFAULT_HEAD_EULER = (-14.0, -4.7, -1.0)

# The hand must be curled before it enters the face contour. These windows are
# intentionally earlier than the arm reach window so the fingers do not sweep
# across the cheek as an open palm.
RIGHT_HAND_PRECURVE_FRAMES = (5, 28)
RIGHT_HAND_APPROACH_SHAPE_FRAMES = (20, 55)
RIGHT_HAND_CONTACT_SHAPE_FRAMES = (130, 150)
RIGHT_HAND_APPROACH_ORIENT_FRAMES = (20, 60)
# Each approach waypoint was selected from rendered PMX probes at the matching
# frame. The route keeps the whole hand contour compact while the arm parent
# orientation changes, instead of interpolating directly through a vertical palm.
RIGHT_WRIST_ORIENTATION_KEY_FRAMES = (0, 20, 60, 95, 100, 105, 110, 115, 125, 130, 140, 150)

LEFT_HOLD_WRIST = [2.28, 13.46, -0.97]
LEFT_HOLD_ELBOW = [3.70, 15.52, -0.35]
LEFT_WRIST_EULER = (-2.0, 6.0, -90.0)

DEFAULT_RIGHT_HAND_OVERRIDES = {
    "右親指０": (0.0, 24.0, -50.0),
    "右親指１": (0.0, 60.0, 0.0),
    "右親指２": (-30.0, 0.0, 0.0),
    "右中指１": (-98.0, 0.0, 0.0),
    "右薬指１": (-150.0, 0.0, 0.0),
    "右小指１": (-125.0, -40.0, -60.0),
}


RIGHT_HAND_PROFILES = {
    "rest": {
        "右親指０": (-18, -2, 0), "右親指１": (-15, 0, 0), "右親指２": (-10, 0, 0),
        "右人指１": (-18, 0, 0), "右人指２": (-12, 0, 0), "右人指３": (-8, 0, 0),
        "右中指１": (-22, 0, 0), "右中指２": (-16, 0, 0), "右中指３": (-10, 0, 0),
        "右薬指１": (-25, 0, 0), "右薬指２": (-18, 0, 0), "右薬指３": (-12, 0, 0),
        "右小指１": (-28, 0, 0), "右小指２": (-20, 0, 0), "右小指３": (-14, 0, 0),
    },
    "precurled": {
        "右親指０": (-45, -2, 0), "右親指１": (-38, 0, 0), "右親指２": (-25, 0, 0),
        "右人指１": (-55, 0, 0), "右人指２": (-45, 0, 0), "右人指３": (-32, 0, 0),
        "右中指１": (-65, 0, 0), "右中指２": (-55, 0, 0), "右中指３": (-42, 0, 0),
        "右薬指１": (-75, 0, 0), "右薬指２": (-65, 0, 0), "右薬指３": (-50, 0, 0),
        "右小指１": (-80, 0, 0), "右小指２": (-70, 0, 0), "右小指３": (-55, 0, 0),
    },
    "approach_compact": {
        "右親指０": (-62, -8, -18), "右親指１": (-52, 0, 0), "右親指２": (-38, 0, 0),
        "右人指１": (-82, 0, 0), "右人指２": (-76, 0, 0), "右人指３": (-62, 0, 0),
        "右中指１": (-96, 0, 0), "右中指２": (-90, 0, 0), "右中指３": (-76, 0, 0),
        "右薬指１": (-106, 0, 0), "右薬指２": (-100, 0, 0), "右薬指３": (-84, 0, 0),
        "右小指１": (-112, 0, 0), "右小指２": (-106, 0, 0), "右小指３": (-90, 0, 0),
    },
    "chin_dual_support": {
        "右親指０": (-58, -1, 0), "右親指１": (-50, 0, 0), "右親指２": (-34, 0, 0),
        "右人指１": (-72, 0, 0), "右人指２": (-58, 0, 0), "右人指３": (-42, 0, 0),
        "右中指１": (-88, 0, 0), "右中指２": (-76, 0, 0), "右中指３": (-62, 0, 0),
        "右薬指１": (-104, 0, 0), "右薬指２": (-94, 0, 0), "右薬指３": (-80, 0, 0),
        "右小指１": (-112, 0, 0), "右小指２": (-102, 0, 0), "右小指３": (-90, 0, 0),
    },
    # Keeps the v12 curl amount available as a probe baseline.
    "v12_chin_support": {
        "右親指０": (-58, -1, 0), "右親指１": (-50, 0, 0), "右親指２": (-34, 0, 0),
        "右人指１": (-72, 0, 0), "右人指２": (-58, 0, 0), "右人指３": (-42, 0, 0),
        "右中指１": (-82, 0, 0), "右中指２": (-72, 0, 0), "右中指３": (-58, 0, 0),
        "右薬指１": (-98, 0, 0), "右薬指２": (-90, 0, 0), "右薬指３": (-76, 0, 0),
        "右小指１": (-106, 0, 0), "右小指２": (-98, 0, 0), "右小指３": (-88, 0, 0),
    },
}

LEFT_AKIMBO_PROFILE = {
    "左親指０": (-62, 0, 0), "左親指１": (-58, 0, 0), "左親指２": (-45, 0, 0),
    "左人指１": (-56, 0, 0), "左人指２": (-48, 0, 0), "左人指３": (-36, 0, 0),
    "左中指１": (-60, 0, 0), "左中指２": (-52, 0, 0), "左中指３": (-38, 0, 0),
    "左薬指１": (-64, 0, 0), "左薬指２": (-54, 0, 0), "左薬指３": (-40, 0, 0),
    "左小指１": (-68, 0, 0), "左小指２": (-56, 0, 0), "左小指３": (-42, 0, 0),
}


def parse_vec(value: str) -> list[float]:
    items = [float(item.strip()) for item in value.split(",")]
    if len(items) != 3:
        raise argparse.ArgumentTypeError("expected three comma-separated values")
    return items


def lerp_degrees(
    left: tuple[float, float, float],
    right: tuple[float, float, float],
    t: float,
) -> tuple[float, float, float]:
    return tuple(left[index] * (1.0 - t) + right[index] * t for index in range(3))


def smootherstep(edge0: float, edge1: float, value: float) -> float:
    if edge1 <= edge0:
        return 1.0 if value >= edge1 else 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def profile_degrees(
    left: dict[str, tuple[float, float, float]],
    right: dict[str, tuple[float, float, float]],
    t: float,
) -> dict[str, tuple[float, float, float]]:
    return {bone: lerp_degrees(left[bone], right[bone], t) for bone in left}


def interpolate_quaternion_waypoints(
    frame_no: int,
    key_frames: tuple[int, ...],
    eulers: tuple[tuple[float, float, float], ...],
    use_smoother: bool = False,
) -> tuple[float, float, float, float]:
    if len(key_frames) != len(eulers):
        raise ValueError("key_frames and eulers must have the same length")
    rotations = tuple(euler_quat(*euler) for euler in eulers)
    for index in range(1, len(key_frames)):
        end_frame = key_frames[index]
        if frame_no <= end_frame:
            start_frame = key_frames[index - 1]
            easing = smootherstep if use_smoother else smoothstep
            blend = easing(start_frame, end_frame, frame_no)
            return _quat_slerp(rotations[index - 1], rotations[index], blend)
    return rotations[-1]


def make_right_wrist_rotation(
    frame_no: int,
    approach_euler: tuple[float, float, float],
    route_1_euler: tuple[float, float, float],
    route_2_euler: tuple[float, float, float],
    route_3_euler: tuple[float, float, float],
    corridor_euler: tuple[float, float, float],
    precontact_euler: tuple[float, float, float],
    final_euler: tuple[float, float, float],
    key_frames: tuple[int, ...] = RIGHT_WRIST_ORIENTATION_KEY_FRAMES,
    waypoint_eulers: tuple[tuple[float, float, float], ...] | None = None,
    use_smoother: bool = False,
) -> tuple[float, float, float, float]:
    """Follow the rendered-safe wrist route, then settle at the chin."""
    eulers = waypoint_eulers or (
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        approach_euler,
        approach_euler,
        route_1_euler,
        route_2_euler,
        route_2_euler,
        route_3_euler,
        route_3_euler,
        corridor_euler,
        precontact_euler,
        final_euler,
    )
    return interpolate_quaternion_waypoints(frame_no, key_frames, eulers, use_smoother)


def make_right_twist_rotation(
    frame_no: int,
    final_euler: tuple[float, float, float],
    route_euler: tuple[float, float, float],
    key_frames: tuple[int, ...] = RIGHT_WRIST_ORIENTATION_KEY_FRAMES,
    waypoint_eulers: tuple[tuple[float, float, float], ...] | None = None,
    use_smoother: bool = False,
) -> tuple[float, float, float, float]:
    eulers = waypoint_eulers or (
        (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0),
        route_euler,
        route_euler,
        route_euler,
        route_euler,
        route_euler,
        route_euler,
        route_euler,
        route_euler,
        final_euler,
        final_euler,
    )
    return interpolate_quaternion_waypoints(frame_no, key_frames, eulers, use_smoother)


def make_hand_frames(
    frame_no: int,
    final_profile_name: str,
    final_overrides: dict[str, tuple[float, float, float]] | None = None,
    contact_shape_frames: tuple[int, int] = RIGHT_HAND_CONTACT_SHAPE_FRAMES,
    use_smoother_contact: bool = False,
) -> list[BoneFrame]:
    if final_profile_name not in RIGHT_HAND_PROFILES:
        raise ValueError(f"unknown right hand profile: {final_profile_name}")

    final_profile = dict(RIGHT_HAND_PROFILES[final_profile_name])
    final_profile.update(final_overrides or {})

    pre_t = smoothstep(*RIGHT_HAND_PRECURVE_FRAMES, frame_no)
    approach_t = smoothstep(*RIGHT_HAND_APPROACH_SHAPE_FRAMES, frame_no)
    contact_easing = smootherstep if use_smoother_contact else smoothstep
    contact_t = contact_easing(*contact_shape_frames, frame_no)
    right_degrees = profile_degrees(RIGHT_HAND_PROFILES["rest"], RIGHT_HAND_PROFILES["precurled"], pre_t)
    right_degrees = profile_degrees(right_degrees, RIGHT_HAND_PROFILES["approach_compact"], approach_t)
    right_degrees = profile_degrees(right_degrees, final_profile, contact_t)

    left_t = smoothstep(72, 155, frame_no)
    frames = [
        BoneFrame(bone, frame_no, (0.0, 0.0, 0.0), euler_quat(*degrees))
        for bone, degrees in right_degrees.items()
    ]
    frames.extend(
        BoneFrame(
            bone,
            frame_no,
            (0.0, 0.0, 0.0),
            euler_quat(*(value * left_t for value in degrees)),
        )
        for bone, degrees in LEFT_AKIMBO_PROFILE.items()
    )
    return frames


def generate(
    *,
    output_name: str = DEFAULT_NAME,
    right_wrist: list[float] | None = None,
    right_elbow: list[float] | None = None,
    right_wrist_euler: tuple[float, float, float] = DEFAULT_RIGHT_WRIST_EULER,
    right_approach_wrist_euler: tuple[float, float, float] = DEFAULT_RIGHT_APPROACH_WRIST_EULER,
    right_route_1_wrist_euler: tuple[float, float, float] = DEFAULT_RIGHT_ROUTE_1_WRIST_EULER,
    right_route_2_wrist_euler: tuple[float, float, float] = DEFAULT_RIGHT_ROUTE_2_WRIST_EULER,
    right_route_3_wrist_euler: tuple[float, float, float] = DEFAULT_RIGHT_ROUTE_3_WRIST_EULER,
    right_corridor_wrist_euler: tuple[float, float, float] = DEFAULT_RIGHT_CORRIDOR_WRIST_EULER,
    right_precontact_wrist_euler: tuple[float, float, float] = DEFAULT_RIGHT_PRECONTACT_WRIST_EULER,
    right_twist_euler: tuple[float, float, float] = DEFAULT_RIGHT_TWIST_EULER,
    right_route_twist_euler: tuple[float, float, float] = DEFAULT_RIGHT_ROUTE_TWIST_EULER,
    right_hand_profile: str = "chin_dual_support",
    right_hand_overrides: dict[str, tuple[float, float, float]] = DEFAULT_RIGHT_HAND_OVERRIDES,
    left_wrist: list[float] | None = None,
    left_elbow: list[float] | None = None,
    left_wrist_euler: tuple[float, float, float] = LEFT_WRIST_EULER,
    neck_euler: tuple[float, float, float] = DEFAULT_NECK_EULER,
    head_euler: tuple[float, float, float] = DEFAULT_HEAD_EULER,
    right_raise_frames: tuple[int, int] = (28, 130),
    right_contact_frames: tuple[int, int] = (140, 150),
    right_hand_contact_shape_frames: tuple[int, int] = RIGHT_HAND_CONTACT_SHAPE_FRAMES,
    right_orientation_key_frames: tuple[int, ...] = RIGHT_WRIST_ORIENTATION_KEY_FRAMES,
    right_wrist_waypoint_eulers: tuple[tuple[float, float, float], ...] | None = None,
    right_twist_waypoint_eulers: tuple[tuple[float, float, float], ...] | None = None,
    use_smoother_raise: bool = False,
    use_smoother_orientation: bool = False,
    use_smoother_hand_contact: bool = False,
) -> tuple[list[BoneFrame], dict, Path, Path]:
    right_hold_wrist = list(right_wrist or DEFAULT_RIGHT_WRIST)
    right_hold_elbow = list(right_elbow or DEFAULT_RIGHT_ELBOW)
    left_hold_wrist = list(LEFT_HOLD_WRIST if left_wrist is None else left_wrist)
    left_hold_elbow = list(LEFT_HOLD_ELBOW if left_elbow is None else left_elbow)
    base = base_arm_points()
    frames: list[BoneFrame] = []
    metrics = []

    for frame_no in range(0, 241):
        body_t = smoothstep(0, 90, frame_no)
        right_raise_t = (
            smootherstep(*right_raise_frames, frame_no)
            if use_smoother_raise
            else smoothstep(*right_raise_frames, frame_no)
        )
        right_contact_t = smootherstep(*right_contact_frames, frame_no)
        left_t = smoothstep(52, 158, frame_no)
        left_orient_t = smoothstep(82, 158, frame_no)

        # A small pelvis/torso counter-rotation introduces weight and intention
        # without moving the feet or adding independent hold-phase oscillation.
        center = (-0.028 * body_t, 0.0, 0.0)
        lower_body = euler_quat(0.0, -0.30 * body_t, 0.35 * body_t)
        upper_body = euler_quat(-1.05 * body_t, 1.10 * body_t, 0.45 * body_t)
        upper_body2 = euler_quat(-1.65 * body_t, 1.85 * body_t, 0.80 * body_t)
        neck = euler_quat(*(value * body_t for value in neck_euler))
        head = euler_quat(*(value * body_t for value in head_euler))

        right_shoulder = euler_quat(0.0, 0.0, -1.6 * right_raise_t)
        left_shoulder = euler_quat(0.0, 0.0, 1.4 * left_t)
        torso_world = _quat_mul(_quat_mul(lower_body, upper_body), upper_body2)
        right_shoulder_world = _quat_mul(torso_world, right_shoulder)
        left_shoulder_world = _quat_mul(torso_world, left_shoulder)

        # The eased progress is used once, to evaluate the world-space path.
        # The IK result is written directly; there is no second quaternion
        # SLERP with the same progress value as in v2-v12.
        right_precontact_wrist = [
            right_hold_wrist[index] + RIGHT_PRECONTACT_WRIST_OFFSET[index]
            for index in range(3)
        ]
        right_precontact_elbow = [
            right_hold_elbow[index] + RIGHT_PRECONTACT_ELBOW_OFFSET[index]
            for index in range(3)
        ]
        right_wrist_raise_target = bezier4(
            base["right_wrist"],
            [base["right_wrist"][0] - 0.45, base["right_wrist"][1] + 0.65, base["right_wrist"][2] - 0.65],
            [right_precontact_wrist[0] - 0.75, right_precontact_wrist[1] - 0.35, right_precontact_wrist[2] - 0.35],
            right_precontact_wrist,
            right_raise_t,
        )
        right_elbow_raise_target = bezier4(
            base["right_elbow"],
            [base["right_elbow"][0] - 0.35, base["right_elbow"][1] + 0.35, base["right_elbow"][2] - 0.40],
            [right_precontact_elbow[0] - 0.40, right_precontact_elbow[1] - 0.30, right_precontact_elbow[2] - 0.25],
            right_precontact_elbow,
            right_raise_t,
        )
        right_wrist_target = list(lerp_degrees(
            tuple(right_wrist_raise_target),
            tuple(right_hold_wrist),
            right_contact_t,
        ))
        right_elbow_target = list(lerp_degrees(
            tuple(right_elbow_raise_target),
            tuple(right_hold_elbow),
            right_contact_t,
        ))
        right_upper, right_lower = solve_reach_arm(
            arm_side="right",
            shoulder_world=right_shoulder_world,
            target_wrist=right_wrist_target,
            target_elbow=right_elbow_target,
        )

        left_wrist_target = bezier4(
            base["left_wrist"],
            [base["left_wrist"][0] + 0.30, base["left_wrist"][1] + 0.55, base["left_wrist"][2] - 0.50],
            [2.85, 14.95, -1.55],
            left_hold_wrist,
            left_t,
        )
        left_elbow_target = bezier4(
            base["left_elbow"],
            [base["left_elbow"][0] + 0.45, base["left_elbow"][1] + 0.35, base["left_elbow"][2] - 0.25],
            [3.45, 15.25, -1.25],
            left_hold_elbow,
            left_t,
        )
        left_upper, left_lower = solve_reach_arm(
            arm_side="left",
            shoulder_world=left_shoulder_world,
            target_wrist=left_wrist_target,
            target_elbow=left_elbow_target,
        )

        right_wrist_rotation = make_right_wrist_rotation(
            frame_no,
            right_approach_wrist_euler,
            right_route_1_wrist_euler,
            right_route_2_wrist_euler,
            right_route_3_wrist_euler,
            right_corridor_wrist_euler,
            right_precontact_wrist_euler,
            right_wrist_euler,
            right_orientation_key_frames,
            right_wrist_waypoint_eulers,
            use_smoother_orientation,
        )
        right_twist_rotation = make_right_twist_rotation(
            frame_no,
            right_twist_euler,
            right_route_twist_euler,
            right_orientation_key_frames,
            right_twist_waypoint_eulers,
            use_smoother_orientation,
        )
        left_wrist_degrees = tuple(value * left_orient_t for value in left_wrist_euler)

        frames.extend(
            [
                BoneFrame("センター", frame_no, center, IDENTITY_QUAT),
                BoneFrame("下半身", frame_no, (0.0, 0.0, 0.0), lower_body),
                BoneFrame("上半身", frame_no, (0.0, 0.0, 0.0), upper_body),
                BoneFrame("上半身2", frame_no, (0.0, 0.0, 0.0), upper_body2),
                BoneFrame("首", frame_no, (0.0, 0.0, 0.0), neck),
                BoneFrame("頭", frame_no, (0.0, 0.0, 0.0), head),
                BoneFrame("右肩", frame_no, (0.0, 0.0, 0.0), right_shoulder),
                BoneFrame("左肩", frame_no, (0.0, 0.0, 0.0), left_shoulder),
                BoneFrame("右腕", frame_no, (0.0, 0.0, 0.0), right_upper),
                BoneFrame("右ひじ", frame_no, (0.0, 0.0, 0.0), right_lower),
                BoneFrame("右手捩", frame_no, (0.0, 0.0, 0.0), right_twist_rotation),
                BoneFrame("右手首", frame_no, (0.0, 0.0, 0.0), right_wrist_rotation),
                BoneFrame("左腕", frame_no, (0.0, 0.0, 0.0), left_upper),
                BoneFrame("左ひじ", frame_no, (0.0, 0.0, 0.0), left_lower),
                BoneFrame("左手首", frame_no, (0.0, 0.0, 0.0), euler_quat(*left_wrist_degrees)),
                BoneFrame("右足", frame_no, (0.0, 0.0, 0.0), IDENTITY_QUAT),
                BoneFrame("左足", frame_no, (0.0, 0.0, 0.0), IDENTITY_QUAT),
                BoneFrame("右ひざ", frame_no, (0.0, 0.0, 0.0), IDENTITY_QUAT),
                BoneFrame("左ひざ", frame_no, (0.0, 0.0, 0.0), IDENTITY_QUAT),
                BoneFrame("右足首", frame_no, (0.0, 0.0, 0.0), IDENTITY_QUAT),
                BoneFrame("左足首", frame_no, (0.0, 0.0, 0.0), IDENTITY_QUAT),
            ]
        )
        frames.extend(make_hand_frames(
            frame_no,
            right_hand_profile,
            right_hand_overrides,
            right_hand_contact_shape_frames,
            use_smoother_hand_contact,
        ))

        right_fk = fk_arm_chain(
            list(PMX_BONE_POSITIONS["右肩"]),
            right_shoulder_world,
            right_upper,
            right_lower,
            [],
            [],
            arm_side="right",
        )
        left_fk = fk_arm_chain(
            list(PMX_BONE_POSITIONS["左肩"]),
            left_shoulder_world,
            left_upper,
            left_lower,
            [],
            [],
            arm_side="left",
        )
        metrics.append(
            {
                "frame": frame_no,
                "right_raise_progress": round(right_raise_t, 4),
                "right_contact_progress": round(right_contact_t, 4),
                "left_progress": round(left_t, 4),
                "right_wrist_target": [round(value, 4) for value in right_wrist_target],
                "right_elbow_target": [round(value, 4) for value in right_elbow_target],
                "right_wrist_fk": [round(value, 4) for value in right_fk["wrist_pos"]],
                "right_elbow_fk": [round(value, 4) for value in right_fk["elbow_pos"]],
                "right_elbow_angle": round(
                    compute_elbow_angle(
                        list(PMX_BONE_POSITIONS["右肩"]),
                        right_fk["elbow_pos"],
                        right_fk["wrist_pos"],
                    ),
                    2,
                ),
                "right_shoulder_wrist_distance": round(
                    length(sub(right_fk["wrist_pos"], list(PMX_BONE_POSITIONS["右肩"]))),
                    4,
                ),
                "left_wrist_fk": [round(value, 4) for value in left_fk["wrist_pos"]],
            }
        )

    frames.sort(key=lambda frame: (frame.frame, frame.bone))
    out_path = Path("imgToAction/outputs/vmd") / f"{output_name}.vmd"
    manifest_path = Path("imgToAction/outputs/vmd") / f"{output_name}_manifest.json"
    manifest = {
        "action": output_name,
        "generation": "procedural_from_scratch",
        "source_vmd": None,
        "output_vmd": str(out_path),
        "frame_range": [0, 240],
        "keyframe_step": 1,
        "definition": {
            "style": "优雅思考 v13 - 解剖与接触生命周期重构",
            "changes_from_v12": [
                "右腕世界轨迹只使用一次 easing，IK 结果不再用同一进度二次 SLERP",
                "右手按 rest -> precurled -> chin_dual_support 三阶段闭合，在进入脸部轮廓前完成预弯",
                "前臂旋转可分配到右手捩，右手首只负责剩余屈伸与尺桡偏",
                "f150-f240 取消头、躯干和手臂之间的独立正弦摆动，稳定保持接触拓扑",
                "加入轻量骨盆与胸廓反向联动，脚、膝和脚踝保持锁定",
            ],
            "right_hold_wrist_pmx": right_hold_wrist,
            "right_hold_elbow_pmx": right_hold_elbow,
            "right_precontact_wrist_offset_pmx": list(RIGHT_PRECONTACT_WRIST_OFFSET),
            "right_precontact_elbow_offset_pmx": list(RIGHT_PRECONTACT_ELBOW_OFFSET),
            "right_wrist_euler_deg": list(right_wrist_euler),
            "right_approach_wrist_euler_deg": list(right_approach_wrist_euler),
            "right_route_1_wrist_euler_deg": list(right_route_1_wrist_euler),
            "right_route_2_wrist_euler_deg": list(right_route_2_wrist_euler),
            "right_route_3_wrist_euler_deg": list(right_route_3_wrist_euler),
            "right_corridor_wrist_euler_deg": list(right_corridor_wrist_euler),
            "right_precontact_wrist_euler_deg": list(right_precontact_wrist_euler),
            "right_twist_euler_deg": list(right_twist_euler),
            "right_route_twist_euler_deg": list(right_route_twist_euler),
            "right_hand_profile": right_hand_profile,
            "right_hand_overrides": {bone: list(degrees) for bone, degrees in right_hand_overrides.items()},
            "neck_euler_deg": list(neck_euler),
            "head_euler_deg": list(head_euler),
            "left_hold_wrist_pmx": left_hold_wrist,
            "left_hold_elbow_pmx": left_hold_elbow,
            "left_wrist_euler_deg": list(left_wrist_euler),
            "non_reuse_guarantee": (
                "未读取、复制或拼接任何现有 VMD；v13 仅使用 PMX 骨骼几何、程序化轨迹、"
                "两骨 IK 和手指关节角生成。"
            ),
        },
        "smoothing": {
            "mode": "analytic_single_easing",
            "post_smoothing_passes": 0,
            "contact_lock": "f150-f240 targets and torso pose remain fixed",
            "right_hand_lifecycle": {
                "precurve_frames": list(RIGHT_HAND_PRECURVE_FRAMES),
                "approach_shape_frames": list(RIGHT_HAND_APPROACH_SHAPE_FRAMES),
                "contact_shape_frames": list(right_hand_contact_shape_frames),
                "wrist_orientation_key_frames": list(right_orientation_key_frames),
            },
        },
        "metrics": metrics,
    }
    return frames, manifest, out_path, manifest_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--right-wrist", type=parse_vec, default=DEFAULT_RIGHT_WRIST)
    parser.add_argument("--right-elbow", type=parse_vec, default=DEFAULT_RIGHT_ELBOW)
    parser.add_argument("--right-wrist-euler", type=parse_vec, default=list(DEFAULT_RIGHT_WRIST_EULER))
    parser.add_argument(
        "--right-approach-wrist-euler",
        type=parse_vec,
        default=list(DEFAULT_RIGHT_APPROACH_WRIST_EULER),
    )
    parser.add_argument("--right-route-1-wrist-euler", type=parse_vec, default=list(DEFAULT_RIGHT_ROUTE_1_WRIST_EULER))
    parser.add_argument("--right-route-2-wrist-euler", type=parse_vec, default=list(DEFAULT_RIGHT_ROUTE_2_WRIST_EULER))
    parser.add_argument("--right-route-3-wrist-euler", type=parse_vec, default=list(DEFAULT_RIGHT_ROUTE_3_WRIST_EULER))
    parser.add_argument(
        "--right-corridor-wrist-euler",
        type=parse_vec,
        default=list(DEFAULT_RIGHT_CORRIDOR_WRIST_EULER),
    )
    parser.add_argument(
        "--right-precontact-wrist-euler",
        type=parse_vec,
        default=list(DEFAULT_RIGHT_PRECONTACT_WRIST_EULER),
    )
    parser.add_argument("--right-twist-euler", type=parse_vec, default=list(DEFAULT_RIGHT_TWIST_EULER))
    parser.add_argument(
        "--right-route-twist-euler",
        type=parse_vec,
        default=list(DEFAULT_RIGHT_ROUTE_TWIST_EULER),
    )
    parser.add_argument("--neck-euler", type=parse_vec, default=list(DEFAULT_NECK_EULER))
    parser.add_argument("--head-euler", type=parse_vec, default=list(DEFAULT_HEAD_EULER))
    parser.add_argument(
        "--right-hand-profile",
        choices=sorted(name for name in RIGHT_HAND_PROFILES if name not in {"rest", "precurled", "approach_compact"}),
        default="chin_dual_support",
    )
    args = parser.parse_args()

    frames, manifest, out_path, manifest_path = generate(
        output_name=args.name,
        right_wrist=list(args.right_wrist),
        right_elbow=list(args.right_elbow),
        right_wrist_euler=tuple(args.right_wrist_euler),
        right_approach_wrist_euler=tuple(args.right_approach_wrist_euler),
        right_route_1_wrist_euler=tuple(args.right_route_1_wrist_euler),
        right_route_2_wrist_euler=tuple(args.right_route_2_wrist_euler),
        right_route_3_wrist_euler=tuple(args.right_route_3_wrist_euler),
        right_corridor_wrist_euler=tuple(args.right_corridor_wrist_euler),
        right_precontact_wrist_euler=tuple(args.right_precontact_wrist_euler),
        right_twist_euler=tuple(args.right_twist_euler),
        right_route_twist_euler=tuple(args.right_route_twist_euler),
        right_hand_profile=args.right_hand_profile,
        neck_euler=tuple(args.neck_euler),
        head_euler=tuple(args.head_euler),
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_vmd(out_path, frames, model_name="Eula")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    by_bone = defaultdict(int)
    for frame in frames:
        by_bone[frame.bone] += 1
    print(f"Wrote {len(frames)} bone frames to {out_path}")
    print(f"Wrote manifest to {manifest_path}")
    print(
        f"Bones: {len(by_bone)}, right arm={by_bone['右腕']}, "
        f"right twist={by_bone['右手捩']}, right fingers={by_bone['右人指１']}"
    )


if __name__ == "__main__":
    main()
