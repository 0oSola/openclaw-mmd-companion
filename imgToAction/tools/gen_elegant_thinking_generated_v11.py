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


DEFAULT_NAME = "eula_elegant_thinking_generated_v11"

# Stable hold target chosen from the 2026-07-08 anatomy probe:
# - right elbow angle ~=65 deg instead of v10's ~=44 deg
# - wrist remains far enough from the shoulder to avoid hard folding
# - ring fingertip remains close enough to chin while hand contour stays below
#   the chin safety line.
RIGHT_WRIST = [0.37, 17.015, -3.15]
RIGHT_ELBOW = [-2.25, 15.05, -1.75]
RIGHT_WRIST_EULER = (-20.0, -70.0, -80.0)
RIGHT_HAND_PROFILE = "soft"


def generate(output_name: str = DEFAULT_NAME):
    frames, manifest, out_path, manifest_path = v10.generate(
        output_name=output_name,
        right_wrist=RIGHT_WRIST,
        right_elbow=RIGHT_ELBOW,
        right_wrist_euler=RIGHT_WRIST_EULER,
        right_hand_profile=RIGHT_HAND_PROFILE,
    )
    manifest["definition"]["style"] = "优雅思考 v11 - 右臂解剖学稳定段修正"
    manifest["definition"]["changes_from_v10"] = [
        "右腕从贴脸补偿改为两球交集区域: 肩-腕距离足够长，同时手部轮廓仍可接近下巴",
        "稳定段右肘角从 v10 的约44°提升到约65°，避免前臂硬折叠",
        "右手首 Euler 调整为 [-20, -70, -80]，右手使用 soft profile，让食指/环指尖参与下巴接触，同时压低手部最高轮廓",
        "左手叉腰目标沿用 v10 strict akimbo，不改动",
        "新增 G13 右臂解剖学自然度 gate 用于阻断稳定段硬折叠假通过",
    ]
    manifest["definition"]["right_hold_wrist_pmx"] = RIGHT_WRIST
    manifest["definition"]["right_hold_elbow_pmx"] = RIGHT_ELBOW
    manifest["definition"]["right_wrist_euler_deg"] = list(RIGHT_WRIST_EULER)
    manifest["definition"]["right_hand_profile"] = RIGHT_HAND_PROFILE
    manifest["definition"]["non_reuse_guarantee"] = (
        "未读取或复制任何现有 VMD；v11 在程序化 IK 生成链上重设右腕/右肘目标和手腕朝向。"
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
