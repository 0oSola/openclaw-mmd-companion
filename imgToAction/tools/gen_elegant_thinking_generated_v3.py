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

import gen_elegant_thinking_generated_v2 as v2  # noqa: E402
from gen_elegant_thinking_generated import euler_quat, smoothstep  # noqa: E402
from vmd_io import BoneFrame, write_vmd  # noqa: E402


OUT_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated_v3.vmd")
MANIFEST_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated_v3_manifest.json")

FINGER_BONES = {
    "右親指０", "右親指１", "右親指２",
    "右人指１", "右人指２", "右人指３",
    "右中指１", "右中指２", "右中指３",
    "右薬指１", "右薬指２", "右薬指３",
    "右小指１", "右小指２", "右小指３",
    "左親指０", "左親指１", "左親指２",
    "左人指１", "左人指２", "左人指３",
    "左中指１", "左中指２", "左中指３",
    "左薬指１", "左薬指２", "左薬指３",
    "左小指１", "左小指２", "左小指３",
}

HAND_BONES = FINGER_BONES | {"右手首", "左手首"}


def scaled_quat(degrees: tuple[float, float, float], blend: float) -> tuple[float, float, float, float]:
    return euler_quat(*(value * blend for value in degrees))


def make_thinking_hand_frames(frame_no: int) -> list[BoneFrame]:
    right_blend = smoothstep(68, 145, frame_no)
    left_blend = smoothstep(84, 168, frame_no)
    hold = smoothstep(118, 168, frame_no)
    pulse = math.sin((frame_no - 120) / 110.0 * math.pi * 2.0) * hold

    # Finger calibration showed fist/curl uses negative X. V2 used positive X,
    # which opened fingers into a claw-like silhouette.
    right_fingers = {
        "右親指０": (-58, -1, 0),
        "右親指１": (-50, 0, 0),
        "右親指２": (-32, 0, 0),
        "右人指１": (-66 + 1.0 * pulse, 0, 0),
        "右人指２": (-52, 0, 0),
        "右人指３": (-34, 0, 0),
        "右中指１": (-70, 0, 0),
        "右中指２": (-56, 0, 0),
        "右中指３": (-36, 0, 0),
        "右薬指１": (-74, 0, 0),
        "右薬指２": (-58, 0, 0),
        "右薬指３": (-38, 0, 0),
        "右小指１": (-78, 0, 0),
        "右小指２": (-60, 0, 0),
        "右小指３": (-40, 0, 0),
    }
    left_fingers = {
        "左親指０": (-90, 0, 0),
        "左親指１": (-90, 0, 0),
        "左親指２": (-90, 0, 0),
        "左人指１": (-90, 0, 0),
        "左人指２": (-90, 0, 0),
        "左人指３": (-90, 0, 0),
        "左中指１": (-90, 0, 0),
        "左中指２": (-90, 0, 0),
        "左中指３": (-90, 0, 0),
        "左薬指１": (-90, 0, 0),
        "左薬指２": (-90, 0, 0),
        "左薬指３": (-90, 0, 0),
        "左小指１": (-90, 0, 0),
        "左小指２": (-90, 0, 0),
        "左小指３": (-90, 0, 0),
    }

    frames: list[BoneFrame] = []
    for bone, degrees in right_fingers.items():
        frames.append(BoneFrame(bone, frame_no, (0.0, 0.0, 0.0), scaled_quat(degrees, right_blend)))
    for bone, degrees in left_fingers.items():
        frames.append(BoneFrame(bone, frame_no, (0.0, 0.0, 0.0), scaled_quat(degrees, left_blend)))
    return frames


def make_wrist_frames(frame_no: int) -> list[BoneFrame]:
    right_settle = smoothstep(78, 138, frame_no)
    left_settle = smoothstep(90, 168, frame_no)
    hold = smoothstep(118, 168, frame_no)
    wave = math.sin((frame_no - 120) / 120.0 * math.pi * 2.0) * hold

    right = euler_quat(
        -4.0 * right_settle + 0.5 * wave,
        -10.0 * right_settle,
        12.0 * right_settle + 0.6 * wave,
    )
    left = euler_quat(
        -3.0 * left_settle,
        8.0 * left_settle,
        -10.0 * left_settle,
    )
    return [
        BoneFrame("右手首", frame_no, (0.0, 0.0, 0.0), right),
        BoneFrame("左手首", frame_no, (0.0, 0.0, 0.0), left),
    ]


def generate() -> tuple[list[BoneFrame], dict]:
    frames, manifest = v2.generate()
    frame_numbers = sorted({frame.frame for frame in frames})
    kept = [frame for frame in frames if frame.bone not in HAND_BONES]
    for frame_no in frame_numbers:
        kept.extend(make_wrist_frames(frame_no))
        kept.extend(make_thinking_hand_frames(frame_no))
    kept.sort(key=lambda frame: (frame.frame, frame.bone))

    manifest["action"] = "eula_elegant_thinking_generated_v3"
    manifest["output_vmd"] = str(OUT_PATH)
    manifest["definition"]["style"] = "优雅思考 v3 - 手指修正"
    manifest["definition"]["changes_from_v2"] = [
        "手指弯曲方向由 +X 改为 -X，符合握拳基准测试",
        "右手食指保持较直，其他手指半收，增强思考手型可读性",
        "左手改为半握支撑，避免五指张开成爪形",
        "右手腕旋转加大，使手指轮廓更容易从袖口旁露出",
    ]
    manifest["definition"]["non_reuse_guarantee"] = "未读取或复制任何现有 VMD；v3 只在 v2 程序化轨迹基础上替换手腕/手指关键帧。"
    return kept, manifest


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
    print(f"Bones: {len(by_bone)}, right index keyframes={by_bone['右人指１']}, left index keyframes={by_bone['左人指１']}")


if __name__ == "__main__":
    main()
