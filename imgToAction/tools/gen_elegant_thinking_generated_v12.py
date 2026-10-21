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

import gen_elegant_thinking_generated_v10 as v10  # noqa: E402
from vmd_io import write_vmd  # noqa: E402


DEFAULT_NAME = "eula_elegant_thinking_generated_v12"

# Chosen from the 2026-07-08 n probe:
# - keeps v11's anatomical right-arm chain (stable elbow angle ~=61 deg)
# - moves the compact hand contour just close enough to the chin
# - keeps a visible clearance below the upper face contour.
RIGHT_WRIST = [0.58, 17.055, -3.10]
RIGHT_ELBOW = [-2.25, 15.05, -1.75]
RIGHT_WRIST_EULER = (-20.0, -70.0, -80.0)
RIGHT_HAND_PROFILE = "chin_support"


def generate(output_name: str = DEFAULT_NAME):
    frames, manifest, out_path, manifest_path = v10.generate(
        output_name=output_name,
        right_wrist=RIGHT_WRIST,
        right_elbow=RIGHT_ELBOW,
        right_wrist_euler=RIGHT_WRIST_EULER,
        right_hand_profile=RIGHT_HAND_PROFILE,
    )
    manifest["definition"]["style"] = "优雅思考 v12 - 右手半握托下巴修正"
    manifest["definition"]["changes_from_v11"] = [
        "右臂稳定段沿用 v11 的解剖学链条，避免回到 v10 的硬折叠肘角",
        "右手从 soft 张掌改为 chin_support 半握，保留 ring/index 托下巴轮廓并额外收拢小指",
        "右腕目标从 [0.37, 17.015, -3.15] 微调到 [0.58, 17.055, -3.10]，让收拢后的 ring/index 轮廓接近下巴，同时肩-腕距离保持在解剖学下限上方",
        "右手首 Euler 保持 [-20, -70, -80]，避免 b/c 探针中指尖上翻进脸部上方",
        "新增 G14 右手手型语义 gate，阻断 v11 soft 这种张掌假通过；r 探针确认 f150-f210 稳定段全部通过",
    ]
    manifest["definition"]["right_hold_wrist_pmx"] = RIGHT_WRIST
    manifest["definition"]["right_hold_elbow_pmx"] = RIGHT_ELBOW
    manifest["definition"]["right_wrist_euler_deg"] = list(RIGHT_WRIST_EULER)
    manifest["definition"]["right_hand_profile"] = RIGHT_HAND_PROFILE
    manifest["definition"]["non_reuse_guarantee"] = (
        "未读取或复制任何现有 VMD；v12 在程序化 IK 生成链上重设右腕目标和右手手型。"
    )
    return frames, manifest, out_path, manifest_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default=DEFAULT_NAME)
    args = parser.parse_args()

    frames, manifest, out_path, manifest_path = generate(args.name)
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
