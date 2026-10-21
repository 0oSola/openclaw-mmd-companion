#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
import sys

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import gen_elegant_thinking_generated_v15 as v15  # noqa: E402
from vmd_io import write_vmd  # noqa: E402


DEFAULT_NAME = "eula_elegant_thinking_generated_v16"
RIGHT_ANATOMICAL_WRIST = [-1.35, 17.16, -3.20]
RIGHT_ANATOMICAL_WRIST_EULER = (-14.0, -40.0, -38.0)
RIGHT_ANATOMICAL_TWIST_EULER = (25.0, 0.0, 0.0)
RIGHT_ANATOMICAL_NECK_EULER = (-14.0, -2.0, -0.35)
RIGHT_ANATOMICAL_HEAD_EULER = (-14.0, 5.0, -1.0)
RIGHT_ANATOMICAL_HAND_OVERRIDES = {
    **v15.v14.v13.DEFAULT_RIGHT_HAND_OVERRIDES,
    "右親指０": (0.0, 28.0, -50.0),
    "右中指１": (-128.0, 0.0, 0.0),
    "右薬指１": (-180.0, 5.0, 0.0),
    "右小指１": (-125.0, -40.0, -65.0),
}


def generate(output_name: str = DEFAULT_NAME):
    frames, manifest, out_path, manifest_path = v15.generate(
        output_name=output_name,
        right_wrist=RIGHT_ANATOMICAL_WRIST,
        right_wrist_euler=RIGHT_ANATOMICAL_WRIST_EULER,
        right_twist_euler=RIGHT_ANATOMICAL_TWIST_EULER,
        right_hand_overrides=RIGHT_ANATOMICAL_HAND_OVERRIDES,
        neck_euler=RIGHT_ANATOMICAL_NECK_EULER,
        head_euler=RIGHT_ANATOMICAL_HEAD_EULER,
    )
    manifest["definition"]["style"] = "优雅思考 v16 - 右腕解剖修正"
    manifest["definition"]["changes_from_v15"] = [
        "将右手首 Y 偏转从 -50 度降到 -40 度，把稳定段腕弯曲从 59.5 度降到 52.7 度",
        "保持 v15 的肩、肘、腕伸展距离，避免为了修腕把右臂重新折叠",
        "微调拇指、中指、无名指和小指，使五指轮廓与双点接触同时满足 Gate",
        "头部向支撑手轻转 9.7 度，形成自然的头手联动接触",
        "保留 v15 已通过 Blender 网格检查的左手 side_down 叉腰姿势",
    ]
    manifest["definition"]["non_reuse_guarantee"] = (
        "未读取、复制或拼接任何现有 VMD；v16 从程序化生成链重新计算全部 0-240 帧，"
        "右腕参数来自 PMX 渲染探针和 G12/G14/G16/G17 联合筛选。"
    )
    manifest["anatomical_wrist_correction"] = {
        "baseline_v15_wrist_bend_deg": 59.5,
        "probe_wrist_bend_deg": 52.7,
        "baseline_v15_palm_normal_chin_angle_deg": 66.9,
        "probe_palm_normal_chin_angle_deg": 63.7,
        "target_wrist_bend_max_deg": 55.0,
        "selected_right_wrist_pmx": RIGHT_ANATOMICAL_WRIST,
        "selected_right_wrist_euler_deg": list(RIGHT_ANATOMICAL_WRIST_EULER),
        "selected_right_twist_euler_deg": list(RIGHT_ANATOMICAL_TWIST_EULER),
        "selected_neck_euler_deg": list(RIGHT_ANATOMICAL_NECK_EULER),
        "selected_head_euler_deg": list(RIGHT_ANATOMICAL_HEAD_EULER),
        "probe": "imgToAction/outputs/actions/v16_ring_axis_probe_grid/v16_ring_axis_probe_0003/rendered_bone_frames.json",
    }
    return frames, manifest, out_path, manifest_path


def main() -> None:
    frames, manifest, out_path, manifest_path = generate()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_vmd(out_path, frames, model_name="Eula")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    by_bone = defaultdict(int)
    for frame in frames:
        by_bone[frame.bone] += 1
    print(f"Wrote {len(frames)} bone frames to {out_path}")
    print(f"Wrote manifest to {manifest_path}")
    print(f"Bones: {len(by_bone)}, right wrist={by_bone['右手首']}, right twist={by_bone['右手捩']}")


if __name__ == "__main__":
    main()
