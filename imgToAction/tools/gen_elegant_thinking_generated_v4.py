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


OUT_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated_v4.vmd")
MANIFEST_PATH = Path("imgToAction/outputs/vmd/eula_elegant_thinking_generated_v4_manifest.json")


def make_wrist_frames(frame_no: int) -> list[BoneFrame]:
    right_settle = smoothstep(78, 138, frame_no)
    left_settle = smoothstep(90, 168, frame_no)

    # The v3 palm looked high because the wrist was near the chin and the curled
    # fingers rose above the wrist. Keep the palm flatter and let the lowered IK
    # target provide the main correction.
    right = euler_quat(
        -7.0 * right_settle,
        -6.0 * right_settle,
        5.0 * right_settle,
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
    frames, manifest = v2.generate(
        right_hold_wrist_override=[-0.78, 17.58, -2.28],
        right_hold_elbow_override=[-3.10, 16.32, -1.65],
    )
    frame_numbers = sorted({frame.frame for frame in frames})
    kept = [frame for frame in frames if frame.bone not in HAND_BONES]
    for frame_no in frame_numbers:
        kept.extend(make_wrist_frames(frame_no))
        kept.extend(make_thinking_hand_frames(frame_no))
    kept.sort(key=lambda frame: (frame.frame, frame.bone))

    manifest["action"] = "eula_elegant_thinking_generated_v4"
    manifest["output_vmd"] = str(OUT_PATH)
    manifest["definition"]["style"] = "优雅思考 v4 - 掌心高度修正"
    manifest["definition"]["changes_from_v3"] = [
        "右手 hold IK 目标下移 0.66 PMX Y，抵消掌心/指节相对手腕的上抬",
        "右手腕从竖掌上翻改为更平的松拳托下巴",
        "保留 v3 手指闭合方向和左手握拳支撑",
    ]
    manifest["definition"]["non_reuse_guarantee"] = "未读取或复制任何现有 VMD；v4 在程序化 v2/v3 轨迹基础上修正右手目标和手腕旋转。"
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
    print(f"Bones: {len(by_bone)}, right wrist keyframes={by_bone['右手首']}, right index keyframes={by_bone['右人指１']}")


if __name__ == "__main__":
    main()
