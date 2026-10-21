#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
import sys

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import gen_elegant_thinking_generated_v2 as v2  # noqa: E402
from gen_elegant_thinking_generated_v3 import HAND_BONES, make_thinking_hand_frames  # noqa: E402
from gen_elegant_thinking_generated import euler_quat, smoothstep  # noqa: E402
from vmd_io import BoneFrame, write_vmd  # noqa: E402


OUT_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated_v8.vmd")
MANIFEST_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated_v8_manifest.json")


def make_wrist_frames(frame_no: int) -> list[BoneFrame]:
    right_settle = smoothstep(78, 138, frame_no)
    left_settle = smoothstep(86, 158, frame_no)

    right = euler_quat(
        -12.0 * right_settle,
        -4.0 * right_settle,
        1.0 * right_settle,
    )
    left = euler_quat(
        -2.0 * left_settle,
        6.0 * left_settle,
        -8.0 * left_settle,
    )
    return [
        BoneFrame("右手首", frame_no, (0.0, 0.0, 0.0), right),
        BoneFrame("左手首", frame_no, (0.0, 0.0, 0.0), left),
    ]


def generate() -> tuple[list[BoneFrame], dict]:
    frames, manifest = v2.generate(
        right_hold_wrist_override=[-0.78, 17.18, -2.28],
        right_hold_elbow_override=[-3.10, 16.08, -1.65],
        left_hold_wrist_override=[2.35, 14.25, -0.45],
        left_hold_elbow_override=[4.05, 15.55, -0.25],
    )
    frame_numbers = sorted({frame.frame for frame in frames})
    kept = [frame for frame in frames if frame.bone not in HAND_BONES]
    for frame_no in frame_numbers:
        kept.extend(make_wrist_frames(frame_no))
        kept.extend(make_thinking_hand_frames(frame_no))
    kept.sort(key=lambda frame: (frame.frame, frame.bone))

    manifest["action"] = "eula_elegant_thinking_generated_v8"
    manifest["output_vmd"] = str(OUT_PATH)
    manifest["definition"]["style"] = "优雅思考 v8 - 左手腰线接触修正"
    manifest["definition"]["changes_from_v7"] = [
        "保留 v7 右手下巴前方位置和左手平拳旋转",
        "左腕目标从髋侧上移到腰线，让手套最低轮廓离开大腿上沿",
        "左腕 X 从 2.72 内收到 2.35，让拳面贴近腰部侧面而不是悬在身体外侧",
        "左肘同步内收并上移，保持叉腰外张但不过度外扩",
    ]
    manifest["definition"]["non_reuse_guarantee"] = "未读取或复制任何现有 VMD；v8 在程序化 v7 轨迹基础上重设左腕/左肘 IK 目标。"
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
    print(f"Bones: {len(by_bone)}, left wrist keyframes={by_bone['左手首']}, left index keyframes={by_bone['左人指１']}")


if __name__ == "__main__":
    main()
