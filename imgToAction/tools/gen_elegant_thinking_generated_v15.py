#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
import sys

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import gen_elegant_thinking_generated_v14 as v14  # noqa: E402
from vmd_io import write_vmd  # noqa: E402


DEFAULT_NAME = "eula_elegant_thinking_generated_v15"

LEFT_MESH_CLEAR_WRIST = [2.52, 13.46, -0.97]
LEFT_MESH_CLEAR_WRIST_EULER = (-2.0, 6.0, 0.0)


def generate(
    output_name: str = DEFAULT_NAME,
    *,
    right_wrist: list[float] | None = None,
    right_wrist_euler: tuple[float, float, float] = v14.v13.DEFAULT_RIGHT_WRIST_EULER,
    right_twist_euler: tuple[float, float, float] = v14.v13.DEFAULT_RIGHT_TWIST_EULER,
    right_hand_overrides: dict[str, tuple[float, float, float]] = v14.v13.DEFAULT_RIGHT_HAND_OVERRIDES,
    neck_euler: tuple[float, float, float] = v14.v13.DEFAULT_NECK_EULER,
    head_euler: tuple[float, float, float] = v14.v13.DEFAULT_HEAD_EULER,
):
    frames, manifest, out_path, manifest_path = v14.generate(
        output_name=output_name,
        left_wrist=LEFT_MESH_CLEAR_WRIST,
        left_wrist_euler=LEFT_MESH_CLEAR_WRIST_EULER,
        right_wrist=right_wrist,
        right_wrist_euler=right_wrist_euler,
        right_twist_euler=right_twist_euler,
        right_hand_overrides=right_hand_overrides,
        neck_euler=neck_euler,
        head_euler=head_euler,
    )
    manifest["definition"]["style"] = "优雅思考 v15 - Blender 网格净空校准"
    manifest["definition"]["changes_from_v14"] = [
        "保留 v14 的右手托下巴、右臂专业时序、头颈和下半身动作",
        "左腕目标 X 从 2.28 外移到 2.52 PMX，避开优菈腰身和髋侧金属装饰的真实网格厚度",
        "左手首 Z 从 -90 度改为 0 度，使手指沿髋部向下而不是横向插入腰部",
        "Blender f160 稳定姿势中左手/躯干三角面重叠从 145 组降为 0 组",
    ]
    manifest["definition"]["non_reuse_guarantee"] = (
        "未读取、复制或拼接任何现有 VMD；v15 从 v14 程序化生成链重新计算全部 0-240 帧，"
        "左手修正参数来自 Blender 对当前 PMX 变形网格的碰撞搜索。"
    )
    manifest["blender_mesh_calibration"] = {
        "review_frame": 160,
        "baseline_v14_left_hand_torso_overlaps": 145,
        "stable_left_hand_torso_overlaps": 0,
        "all_frame_full_body_overlaps": 0,
        "stable_clearance_pmx": 0.014774,
        "selected_left_hold_wrist_pmx": LEFT_MESH_CLEAR_WRIST,
        "selected_left_wrist_euler_deg": list(LEFT_MESH_CLEAR_WRIST_EULER),
        "search_results": "imgToAction/outputs/blender/v15_left_akimbo_refine/blender_full_body_results_f160.json",
        "full_path_validation": "imgToAction/outputs/blender/v15_left_akimbo_refine/refine_x252_zp000_full_path.json",
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
    print(f"Bones: {len(by_bone)}, left arm={by_bone['左腕']}, left wrist={by_bone['左手首']}")


if __name__ == "__main__":
    main()
