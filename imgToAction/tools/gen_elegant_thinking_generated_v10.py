#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
import sys

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import gen_elegant_thinking_generated_v2 as v2  # noqa: E402
from gen_elegant_thinking_generated import euler_quat, smoothstep  # noqa: E402
from gen_elegant_thinking_generated_v3 import HAND_BONES, scaled_quat  # noqa: E402
from gen_elegant_thinking_generated_v9 import (  # noqa: E402
    DEFAULT_LEFT_WRIST_EULER,
    make_v9_hand_frames,
)
from vmd_io import BoneFrame  # noqa: E402
from vmd_io import write_vmd  # noqa: E402


DEFAULT_NAME = "eula_elegant_thinking_generated_v10"
DEFAULT_RIGHT_WRIST = [-0.45, 17.00, -2.55]
DEFAULT_RIGHT_ELBOW = [-1.15, 15.10, -3.00]
DEFAULT_RIGHT_WRIST_EULER = (-38.0, -16.0, -30.0)
RIGHT_WRIST_FACE_SWEEP_GUARD_EULER = (-45.0, -8.0, -18.0)
DEFAULT_LEFT_WRIST = [2.28, 13.46, -0.97]
DEFAULT_LEFT_ELBOW = [3.70, 15.52, -0.35]
DEFAULT_RIGHT_HAND_PROFILE = "compact"


RIGHT_HAND_PROFILES = {
    # v9 keeps the earlier thinking hand for comparison.
    "v9": None,
    # Keep the index/thumb readable for "thinking", but curl the middle/ring/pinky
    # into the palm so fingertips do not rise into the face.
    "compact": {
        "右親指０": (-58, -1, 0),
        "右親指１": (-50, 0, 0),
        "右親指２": (-34, 0, 0),
        "右人指１": (-72, 0, 0),
        "右人指２": (-58, 0, 0),
        "右人指３": (-42, 0, 0),
        "右中指１": (-82, 0, 0),
        "右中指２": (-72, 0, 0),
        "右中指３": (-58, 0, 0),
        "右薬指１": (-98, 0, 0),
        "右薬指２": (-90, 0, 0),
        "右薬指３": (-76, 0, 0),
        "右小指１": (-96, 0, 0),
        "右小指２": (-86, 0, 0),
        "右小指３": (-74, 0, 0),
    },
    # Compact thinking hand with the pinky tucked further in. This keeps the
    # ring/index contour near the chin while preventing the pinky knuckle from
    # becoming the highest visible point late in the hold.
    "chin_support": {
        "右親指０": (-58, -1, 0),
        "右親指１": (-50, 0, 0),
        "右親指２": (-34, 0, 0),
        "右人指１": (-72, 0, 0),
        "右人指２": (-58, 0, 0),
        "右人指３": (-42, 0, 0),
        "右中指１": (-82, 0, 0),
        "右中指２": (-72, 0, 0),
        "右中指３": (-58, 0, 0),
        "右薬指１": (-98, 0, 0),
        "右薬指２": (-90, 0, 0),
        "右薬指３": (-76, 0, 0),
        "右小指１": (-106, 0, 0),
        "右小指２": (-98, 0, 0),
        "右小指３": (-88, 0, 0),
    },
    # More open than compact; useful when compact reads too much like a fist.
    "soft": {
        "右親指０": (-58, -1, 0),
        "右親指１": (-50, 0, 0),
        "右親指２": (-34, 0, 0),
        "右人指１": (-60, 0, 0),
        "右人指２": (-46, 0, 0),
        "右人指３": (-28, 0, 0),
        "右中指１": (-76, 0, 0),
        "右中指２": (-64, 0, 0),
        "右中指３": (-48, 0, 0),
        "右薬指１": (-84, 0, 0),
        "右薬指２": (-72, 0, 0),
        "右薬指３": (-56, 0, 0),
        "右小指１": (-88, 0, 0),
        "右小指２": (-76, 0, 0),
        "右小指３": (-60, 0, 0),
    },
}


def parse_vec(value: str) -> list[float]:
    items = [float(item.strip()) for item in value.split(",")]
    if len(items) != 3:
        raise argparse.ArgumentTypeError("expected three comma-separated values")
    return items


def generate(
    *,
    output_name: str = DEFAULT_NAME,
    right_wrist: list[float] = DEFAULT_RIGHT_WRIST,
    right_elbow: list[float] = DEFAULT_RIGHT_ELBOW,
    right_wrist_euler: tuple[float, float, float] = DEFAULT_RIGHT_WRIST_EULER,
    right_hand_profile: str = DEFAULT_RIGHT_HAND_PROFILE,
) -> tuple[list, dict, Path, Path]:
    out_path = Path("imgToAction/outputs/vmd") / f"{output_name}.vmd"
    manifest_path = Path("imgToAction/outputs/vmd") / f"{output_name}_manifest.json"
    frames, manifest = v2.generate(
        right_hold_wrist_override=right_wrist,
        right_hold_elbow_override=right_elbow,
        left_hold_wrist_override=DEFAULT_LEFT_WRIST,
        left_hold_elbow_override=DEFAULT_LEFT_ELBOW,
    )
    frame_numbers = sorted({frame.frame for frame in frames})
    kept = [frame for frame in frames if frame.bone not in HAND_BONES]
    for frame_no in frame_numbers:
        kept.extend(make_wrist_frames(frame_no, right_wrist_euler))
        kept.extend(make_v10_hand_frames(frame_no, right_hand_profile))
    kept.sort(key=lambda frame: (frame.frame, frame.bone))

    manifest["action"] = output_name
    manifest["output_vmd"] = str(out_path)
    manifest["definition"]["style"] = "优雅思考 v10 - 右臂自然弯曲修正"
    manifest["definition"]["changes_from_v9"] = [
        "左手叉腰沿用 v9 strict akimbo 目标，不改动",
        "右肘从外侧 X≈-3.0 收到稳定段实测 X≈-2.05，并打开肘角到 43° 以上，减少前臂硬折叠感",
        "右腕不再直接贴下巴，改为腕点保持 2.0 PMX 左右距离，由手指/掌部轮廓承担托下巴语义",
        "右手手型改为 compact profile，收拢中指/无名指/小指，防止指尖顶到脸部上方",
        "右臂轨迹仍由程序化 IK/FABRIK 生成，未复制任何现有 VMD",
    ]
    manifest["definition"]["right_hold_wrist_pmx"] = right_wrist
    manifest["definition"]["right_hold_elbow_pmx"] = right_elbow
    manifest["definition"]["right_wrist_euler_deg"] = list(right_wrist_euler)
    manifest["definition"]["right_hand_profile"] = right_hand_profile
    manifest["definition"]["left_hold_wrist_pmx"] = DEFAULT_LEFT_WRIST
    manifest["definition"]["left_hold_elbow_pmx"] = DEFAULT_LEFT_ELBOW
    manifest["definition"]["non_reuse_guarantee"] = (
        "未读取或复制任何现有 VMD；v10 在 v9 程序化动作基础上重设右腕/右肘 IK 目标。"
    )
    return kept, manifest, out_path, manifest_path


def make_v10_hand_frames(frame_no: int, right_hand_profile: str) -> list[BoneFrame]:
    if right_hand_profile not in RIGHT_HAND_PROFILES:
        raise ValueError(f"unknown right hand profile: {right_hand_profile}")
    if right_hand_profile == "v9":
        return make_v9_hand_frames(frame_no)

    left_frames = [frame for frame in make_v9_hand_frames(frame_no) if frame.bone.startswith("左")]
    # Close the thinking hand before it reaches the face. If the fingers are
    # still open around f110, the fingertips sweep upward across the face even
    # though the final hold pose is safe.
    right_blend = smoothstep(58, 118, frame_no)
    hold = smoothstep(118, 168, frame_no)
    pulse = math.sin((frame_no - 120) / 110.0 * math.pi * 2.0) * hold
    frames: list[BoneFrame] = []
    for bone, degrees in RIGHT_HAND_PROFILES[right_hand_profile].items():
        dx, dy, dz = degrees
        if bone == "右人指１":
            dx += 0.8 * pulse
        frames.append(BoneFrame(bone, frame_no, (0.0, 0.0, 0.0), scaled_quat((dx, dy, dz), right_blend)))
    frames.extend(left_frames)
    return frames


def make_wrist_frames(frame_no: int, right_wrist_euler: tuple[float, float, float]) -> list[BoneFrame]:
    right_settle = smoothstep(60, 118, frame_no)
    left_settle = smoothstep(86, 158, frame_no)
    face_sweep_guard = smoothstep(90, 108, frame_no) * (1.0 - smoothstep(110, 145, frame_no))
    right_values = [
        right_wrist_euler[index] * right_settle + RIGHT_WRIST_FACE_SWEEP_GUARD_EULER[index] * face_sweep_guard
        for index in range(3)
    ]
    right = euler_quat(*right_values)
    left = euler_quat(*(value * left_settle for value in DEFAULT_LEFT_WRIST_EULER))
    return [
        BoneFrame("右手首", frame_no, (0.0, 0.0, 0.0), right),
        BoneFrame("左手首", frame_no, (0.0, 0.0, 0.0), left),
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--right-wrist", type=parse_vec, default=DEFAULT_RIGHT_WRIST)
    parser.add_argument("--right-elbow", type=parse_vec, default=DEFAULT_RIGHT_ELBOW)
    parser.add_argument("--right-wrist-euler", type=parse_vec, default=list(DEFAULT_RIGHT_WRIST_EULER))
    parser.add_argument("--right-hand-profile", choices=sorted(RIGHT_HAND_PROFILES), default=DEFAULT_RIGHT_HAND_PROFILE)
    args = parser.parse_args()

    frames, manifest, out_path, manifest_path = generate(
        output_name=args.name,
        right_wrist=args.right_wrist,
        right_elbow=args.right_elbow,
        right_wrist_euler=tuple(args.right_wrist_euler),
        right_hand_profile=args.right_hand_profile,
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_vmd(out_path, frames, model_name="Eula")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    by_bone = defaultdict(int)
    for frame in frames:
        by_bone[frame.bone] += 1
    print(f"Wrote {len(frames)} bone frames to {out_path}")
    print(f"Wrote manifest to {manifest_path}")
    print(f"Bones: {len(by_bone)}, right arm keyframes={by_bone['右腕']}, right elbow keyframes={by_bone['右ひじ']}")


if __name__ == "__main__":
    main()
