#!/usr/bin/env python3
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
import sys

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import gen_elegant_thinking_generated_v13 as v13  # noqa: E402
from vmd_io import BoneFrame, write_vmd  # noqa: E402


DEFAULT_NAME = "eula_elegant_thinking_generated_v14"

FILTER_BONES = {"右手首", "右手捩"}
CONTOUR_TUCK_EULER = (0.0, 0.0, 5.0)


def smooth_contact_rotations(
    frames: list[BoneFrame],
    *,
    passes: int = 10,
    strength: float = 0.50,
) -> list[BoneFrame]:
    result = list(frames)
    for _ in range(passes):
        by_key = {(frame.bone, frame.frame): frame for frame in result if frame.bone in FILTER_BONES}
        updated = []
        for frame in result:
            if frame.bone not in FILTER_BONES or not (126 <= frame.frame < 150):
                updated.append(frame)
                continue
            previous = by_key.get((frame.bone, frame.frame - 1))
            following = by_key.get((frame.bone, frame.frame + 1))
            if not previous or not following:
                updated.append(frame)
                continue
            neighbor_mid = v13._quat_slerp(previous.rotation, following.rotation, 0.5)
            rotation = v13._quat_slerp(frame.rotation, neighbor_mid, strength)
            updated.append(BoneFrame(frame.bone, frame.frame, frame.position, rotation, frame.interpolation))
        result = updated
    return result


def apply_contour_tuck(frames: list[BoneFrame]) -> list[BoneFrame]:
    result = []
    for frame in frames:
        if frame.bone != "右手首" or frame.frame <= 130 or frame.frame >= 146:
            result.append(frame)
            continue
        if frame.frame <= 137:
            weight = v13.smootherstep(130, 137, frame.frame)
        else:
            weight = 1.0 - v13.smootherstep(137, 146, frame.frame)
        offset = v13.euler_quat(*(value * weight for value in CONTOUR_TUCK_EULER))
        rotation = v13._quat_mul(frame.rotation, offset)
        result.append(BoneFrame(frame.bone, frame.frame, frame.position, rotation, frame.interpolation))
    return result


def generate(
    output_name: str = DEFAULT_NAME,
    *,
    left_wrist: list[float] | None = None,
    left_elbow: list[float] | None = None,
    left_wrist_euler: tuple[float, float, float] = v13.LEFT_WRIST_EULER,
    right_wrist: list[float] | None = None,
    right_wrist_euler: tuple[float, float, float] = v13.DEFAULT_RIGHT_WRIST_EULER,
    right_twist_euler: tuple[float, float, float] = v13.DEFAULT_RIGHT_TWIST_EULER,
    right_hand_overrides: dict[str, tuple[float, float, float]] = v13.DEFAULT_RIGHT_HAND_OVERRIDES,
    neck_euler: tuple[float, float, float] = v13.DEFAULT_NECK_EULER,
    head_euler: tuple[float, float, float] = v13.DEFAULT_HEAD_EULER,
):
    frames, manifest, out_path, manifest_path = v13.generate(
        output_name=output_name,
        left_wrist=left_wrist,
        left_elbow=left_elbow,
        left_wrist_euler=left_wrist_euler,
        right_wrist=right_wrist,
        right_wrist_euler=right_wrist_euler,
        right_twist_euler=right_twist_euler,
        right_hand_overrides=right_hand_overrides,
        neck_euler=neck_euler,
        head_euler=head_euler,
        right_raise_frames=(28, 122),
        right_contact_frames=(130, 150),
        right_hand_contact_shape_frames=(130, 150),
        use_smoother_raise=True,
        use_smoother_hand_contact=False,
    )
    frames = smooth_contact_rotations(frames)
    frames = apply_contour_tuck(frames)
    manifest["definition"]["style"] = "优雅思考 v14 - 专业时序与关节错峰"
    manifest["definition"]["changes_from_v13"] = [
        "保留 v13 已渲染验证的安全翻腕路径，不用最短旋转穿过竖掌姿态",
        "对 f126-f149 的右手首和右手捩执行零相位邻域 SLERP，消除路径段落边界的 jerk",
        "右臂在 f122 到达预备位，f122-f130 保持蓄势，f130-f150 再托起到最终接触位",
        "最终手型从 f130 开始渐变，与腕部转向错峰并在 f150 完成",
        "保持 v13 已验收的最终腕位、肘位、手型和 f150-f240 接触锁定",
    ]
    manifest["definition"]["non_reuse_guarantee"] = (
        "未读取、复制或拼接任何现有 VMD；v14 只复用程序化生成器代码与已测量 PMX 几何，"
        "所有 0-240 帧重新计算。"
    )
    manifest["smoothing"] = {
        "mode": "analytic_quintic_overlapping_action",
        "post_smoothing_passes": 0,
        "right_raise_frames": [28, 122],
        "right_contact_frames": [130, 150],
        "right_hand_contact_shape_frames": [130, 150],
        "rotation_filter": {"frames": [126, 149], "passes": 10, "strength": 0.50},
        "contour_tuck": {"frames": [130, 146], "peak_frame": 137, "local_euler_deg": [0, 0, 5]},
        "contact_lock": "f150-f240 targets and torso pose remain fixed",
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
    print(f"Bones: {len(by_bone)}, right arm={by_bone['右腕']}, right wrist={by_bone['右手首']}")


if __name__ == "__main__":
    main()
