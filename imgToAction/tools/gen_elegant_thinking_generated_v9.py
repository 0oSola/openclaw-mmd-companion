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
from gen_elegant_thinking_generated_v3 import HAND_BONES, make_thinking_hand_frames, scaled_quat  # noqa: E402
from vmd_io import BoneFrame, write_vmd  # noqa: E402


DEFAULT_NAME = "eula_elegant_thinking_generated_v9"
DEFAULT_LEFT_WRIST_EULER = (-2.0, 6.0, -90.0)


def make_wrist_frames(frame_no: int, left_wrist_euler: tuple[float, float, float]) -> list[BoneFrame]:
    right_settle = smoothstep(78, 138, frame_no)
    left_settle = smoothstep(86, 158, frame_no)

    right = euler_quat(
        -12.0 * right_settle,
        -4.0 * right_settle,
        1.0 * right_settle,
    )
    left = euler_quat(*(value * left_settle for value in left_wrist_euler))
    return [
        BoneFrame("右手首", frame_no, (0.0, 0.0, 0.0), right),
        BoneFrame("左手首", frame_no, (0.0, 0.0, 0.0), left),
    ]


def make_v9_hand_frames(frame_no: int) -> list[BoneFrame]:
    # Keep the right thinking hand from v3, but make the left hand a compact
    # half-fist. A full -90 degree fist made the visible glove tips hang below
    # the waist; the wrist rotation now carries the half-fist upward/inward.
    frames = [frame for frame in make_thinking_hand_frames(frame_no) if not frame.bone.startswith("左")]
    left_blend = smoothstep(84, 168, frame_no)
    hold = smoothstep(118, 168, frame_no)
    pulse = math.sin((frame_no - 130) / 120.0 * math.pi * 2.0) * hold
    left_fingers = {
        "左親指０": (-62, 0, 0),
        "左親指１": (-58, 0, 0),
        "左親指２": (-45, 0, 0),
        "左人指１": (-56 + 0.8 * pulse, 0, 0),
        "左人指２": (-48, 0, 0),
        "左人指３": (-36, 0, 0),
        "左中指１": (-60, 0, 0),
        "左中指２": (-52, 0, 0),
        "左中指３": (-38, 0, 0),
        "左薬指１": (-64, 0, 0),
        "左薬指２": (-54, 0, 0),
        "左薬指３": (-40, 0, 0),
        "左小指１": (-68, 0, 0),
        "左小指２": (-56, 0, 0),
        "左小指３": (-42, 0, 0),
    }
    for bone, degrees in left_fingers.items():
        frames.append(BoneFrame(bone, frame_no, (0.0, 0.0, 0.0), scaled_quat(degrees, left_blend)))
    return frames


def generate(
    *,
    output_name: str = DEFAULT_NAME,
    left_wrist_euler: tuple[float, float, float] = DEFAULT_LEFT_WRIST_EULER,
) -> tuple[list[BoneFrame], dict, Path, Path]:
    out_path = Path("imgToAction/outputs/vmd") / f"{output_name}.vmd"
    manifest_path = Path("imgToAction/outputs/vmd") / f"{output_name}_manifest.json"
    frames, manifest = v2.generate(
        right_hold_wrist_override=[-0.78, 17.18, -2.28],
        right_hold_elbow_override=[-3.10, 16.08, -1.65],
        # Anchored to the rendered akimbo reference: wrist rests on the left
        # waist side and the elbow stays outside the wrist.
        left_hold_wrist_override=[2.28, 13.46, -0.97],
        left_hold_elbow_override=[3.70, 15.52, -0.35],
    )
    frame_numbers = sorted({frame.frame for frame in frames})
    kept = [frame for frame in frames if frame.bone not in HAND_BONES]
    for frame_no in frame_numbers:
        kept.extend(make_wrist_frames(frame_no, left_wrist_euler))
        kept.extend(make_v9_hand_frames(frame_no))
    kept.sort(key=lambda frame: (frame.frame, frame.bone))

    manifest["action"] = output_name
    manifest["output_vmd"] = str(out_path)
    manifest["definition"]["style"] = "优雅思考 v9 - 左手叉腰轮廓修正"
    manifest["definition"]["changes_from_v8"] = [
        "左腕和左肘目标改为对齐叉腰 reference 的腰侧接触关系",
        "左手腕 Z 旋转改为让拳面向上/向内贴腰，避免手指和袖口垂到髋/大腿侧",
        "左手从全握拳改为半握拳，减少手套最低轮廓下坠",
        "右手托下巴目标沿用 v8/v5 的下巴前方安全位置",
    ]
    manifest["definition"]["left_wrist_euler_deg"] = list(left_wrist_euler)
    manifest["definition"]["non_reuse_guarantee"] = (
        "未读取或复制任何现有 VMD；v9 使用程序化 IK 目标和手腕/手指旋转。"
        "叉腰 reference 仅用于确定验收目标区间。"
    )
    return kept, manifest, out_path, manifest_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--left-wrist-euler", default=",".join(str(v) for v in DEFAULT_LEFT_WRIST_EULER))
    args = parser.parse_args()

    values = tuple(float(item.strip()) for item in args.left_wrist_euler.split(","))
    if len(values) != 3:
        raise SystemExit("--left-wrist-euler must contain three comma-separated degrees")

    frames, manifest, out_path, manifest_path = generate(output_name=args.name, left_wrist_euler=values)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_vmd(out_path, frames, model_name="Eula")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    by_bone = defaultdict(int)
    for frame in frames:
        by_bone[frame.bone] += 1
    print(f"Wrote {len(frames)} bone frames to {out_path}")
    print(f"Wrote manifest to {manifest_path}")
    print(f"Bones: {len(by_bone)}, left wrist keyframes={by_bone['左手首']}, left index keyframes={by_bone['左人指１']}")


if __name__ == "__main__":
    main()
