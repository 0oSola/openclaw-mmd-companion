#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from motion_acceptance_gate import (  # noqa: E402
    BONE_NAME_MAP,
    CHIN_SURFACE,
    HAND_CONTOUR_CHIN_CLEARANCE,
    LEFT_HAND_CONTOUR_BONES,
    RIGHT_THINKING_ELBOW_ANGLE,
    RIGHT_THINKING_ELBOW_X_RANGE,
    RIGHT_THINKING_HAND_CHIN_DISTANCE_MAX,
    RIGHT_THINKING_WRIST_CHIN_DISTANCE,
    RIGHT_ARM_ANATOMY_ELBOW_ANGLE,
    RIGHT_ARM_ANATOMY_SHOULDER_WRIST_DISTANCE,
    RIGHT_HAND_SHAPE_FINGERTIP_Y_SPREAD_MAX,
    RIGHT_HAND_SHAPE_TOP_CLEARANCE_MIN,
    RIGHT_HAND_SHAPE_Y_EXTENT_MAX,
    RIGHT_HAND_CONTOUR_BONES,
    angle_between,
    dist,
    evaluate_left_akimbo_hand_contour,
    render_to_pmx,
    sub,
)


VIEWS = ("front", "left", "right", "back")
DEFAULT_SHEET_FRAMES = (0, 60, 120, 160, 200, 240)
DEFAULT_HAND_FRAMES = (120, 160, 200)


def parse_frame_list(value: str) -> tuple[int, ...]:
    frames = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        frames.append(int(item))
    if not frames:
        raise argparse.ArgumentTypeError("expected at least one frame")
    return tuple(frames)


def load_font(size: int = 22) -> ImageFont.ImageFont:
    candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    )
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def image_path(render_dir: Path, vmd_name: str, view: str, frame: int) -> Path:
    return render_dir / vmd_name / view / f"{vmd_name}_f{frame:03d}.png"


def screenshot_frames(render_dir: Path, vmd_name: str, view: str) -> list[int]:
    files = sorted((render_dir / vmd_name / view).glob(f"{vmd_name}_f*.png"))
    frames = []
    for file in files:
        stem = file.stem.rsplit("_f", 1)[-1]
        if stem.isdigit():
            frames.append(int(stem))
    return frames


def resize_to_width(image: Image.Image, width: int) -> Image.Image:
    ratio = width / image.width
    return image.resize((width, max(1, int(image.height * ratio))), Image.Resampling.LANCZOS)


def label_image(image: Image.Image, label: str, font: ImageFont.ImageFont) -> Image.Image:
    result = image.copy()
    draw = ImageDraw.Draw(result)
    pad = 8
    bbox = draw.textbbox((0, 0), label, font=font)
    draw.rectangle((0, 0, bbox[2] + pad * 2, bbox[3] + pad * 2), fill=(255, 255, 255, 220))
    draw.text((pad, pad), label, fill=(20, 20, 20), font=font)
    return result


def make_view_gifs(render_dir: Path, vmd_name: str, duration_ms: int) -> list[Path]:
    out_dir = render_dir / "gifs"
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = []
    for view in VIEWS:
        frames = screenshot_frames(render_dir, vmd_name, view)
        images = [resize_to_width(Image.open(image_path(render_dir, vmd_name, view, frame)).convert("RGB"), 360) for frame in frames]
        if not images:
            continue
        out_path = out_dir / f"{vmd_name}_{view}.gif"
        images[0].save(out_path, save_all=True, append_images=images[1:], duration=duration_ms, loop=0)
        outputs.append(out_path)
    return outputs


def make_4view_gif(render_dir: Path, vmd_name: str, duration_ms: int) -> Path:
    out_dir = render_dir / "gifs"
    out_dir.mkdir(parents=True, exist_ok=True)
    frames = screenshot_frames(render_dir, vmd_name, "front")
    font = load_font(18)
    grids = []
    for frame in frames:
        cells = []
        for view in VIEWS:
            path = image_path(render_dir, vmd_name, view, frame)
            if not path.exists():
                continue
            img = resize_to_width(Image.open(path).convert("RGB"), 260)
            cells.append(label_image(img, f"{view} f{frame:03d}", font))
        if len(cells) != 4:
            continue
        cell_w = max(cell.width for cell in cells)
        cell_h = max(cell.height for cell in cells)
        grid = Image.new("RGB", (cell_w * 2, cell_h * 2), "white")
        for index, cell in enumerate(cells):
            x = (index % 2) * cell_w
            y = (index // 2) * cell_h
            grid.paste(cell, (x, y))
        grids.append(grid)
    out_path = out_dir / f"{vmd_name}_4view.gif"
    if grids:
        grids[0].save(out_path, save_all=True, append_images=grids[1:], duration=duration_ms, loop=0)
    return out_path


def make_review_sheet(render_dir: Path, vmd_name: str, frames: tuple[int, ...]) -> Path:
    font = load_font(18)
    thumb_w = 220
    cells = []
    for frame in frames:
        row = []
        for view in VIEWS:
            path = image_path(render_dir, vmd_name, view, frame)
            if not path.exists():
                continue
            img = resize_to_width(Image.open(path).convert("RGB"), thumb_w)
            row.append(label_image(img, f"{view} f{frame:03d}", font))
        if len(row) == 4:
            cells.append(row)

    if not cells:
        raise RuntimeError("No screenshots found for review sheet")

    cell_w = max(cell.width for row in cells for cell in row)
    cell_h = max(cell.height for row in cells for cell in row)
    sheet = Image.new("RGB", (cell_w * 4, cell_h * len(cells)), "white")
    for r, row in enumerate(cells):
        for c, cell in enumerate(row):
            sheet.paste(cell, (c * cell_w, r * cell_h))
    out_path = render_dir / f"{vmd_name}_review_sheet.png"
    sheet.save(out_path)
    return out_path


def make_hand_review_sheet(render_dir: Path, vmd_name: str, frames: tuple[int, ...]) -> Path:
    font = load_font(18)
    cells = []
    for frame in frames:
        row = []
        for view in ("front", "left", "right"):
            path = image_path(render_dir, vmd_name, view, frame)
            if not path.exists():
                continue
            img = Image.open(path).convert("RGB")
            left = int(img.width * 0.22)
            top = int(img.height * 0.03)
            right = int(img.width * 0.88)
            bottom = int(img.height * 0.48)
            crop = img.crop((left, top, right, bottom))
            row.append(label_image(resize_to_width(crop, 360), f"{view} f{frame:03d}", font))
        if len(row) == 3:
            cells.append(row)

    if not cells:
        raise RuntimeError("No screenshots found for hand review sheet")

    cell_w = max(cell.width for row in cells for cell in row)
    cell_h = max(cell.height for row in cells for cell in row)
    sheet = Image.new("RGB", (cell_w * 3, cell_h * len(cells)), "white")
    for r, row in enumerate(cells):
        for c, cell in enumerate(row):
            sheet.paste(cell, (c * cell_w, r * cell_h))
    out_path = render_dir / f"{vmd_name}_hand_review_sheet.png"
    sheet.save(out_path)
    return out_path


def normalize_joints(raw_joints: dict[str, list[float]]) -> dict[str, list[float]]:
    normalized = {}
    for bone_name, pos in raw_joints.items():
        standard = BONE_NAME_MAP.get(bone_name, bone_name)
        if pos and len(pos) >= 3:
            normalized[standard] = render_to_pmx(pos)
    return normalized


def make_contour_table(render_dir: Path) -> Path:
    frames = json.loads((render_dir / "rendered_bone_frames.json").read_text(encoding="utf-8"))
    limit_y = CHIN_SURFACE[1] - HAND_CONTOUR_CHIN_CLEARANCE
    rows = [
        "| 帧 | 右手腕Y | 最高代理骨 | 最高Y | 安全线Y | 余量 | 判定 |",
        "|---:|---:|---|---:|---:|---:|---|",
    ]
    for frame in frames:
        index = int(frame.get("index", 0))
        if not (110 <= index <= 210):
            continue
        joints = normalize_joints(frame.get("joints", {}))
        samples = [(bone, joints[bone]) for bone in RIGHT_HAND_CONTOUR_BONES if bone in joints]
        if not samples:
            rows.append(f"| {index} | - | 缺失 | - | {limit_y:.3f} | - | 错误 |")
            continue
        max_bone, max_pos = max(samples, key=lambda item: item[1][1])
        wrist_y = joints.get("right_wrist", [0.0, 0.0, 0.0])[1]
        clearance = limit_y - max_pos[1]
        verdict = "正确" if clearance >= -1e-6 else "错误"
        rows.append(
            f"| {index} | {wrist_y:.3f} | `{max_bone}` | {max_pos[1]:.3f} | "
            f"{limit_y:.3f} | {clearance:.3f} | {verdict} |"
        )
    out_path = render_dir / "hand_contour_metrics_table.md"
    out_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return out_path


def make_left_akimbo_table(render_dir: Path) -> Path:
    frames = json.loads((render_dir / "rendered_bone_frames.json").read_text(encoding="utf-8"))
    rows = [
        "| 帧 | 左腕XYZ | 左肘角 | 手部X范围 | 手部Y范围 | 手部Z范围 | 指尖下垂量 | 模式 | 判定 |",
        "|---:|---|---:|---|---|---|---:|---|---|",
    ]
    for frame in frames:
        index = int(frame.get("index", 0))
        if not (150 <= index <= 210):
            continue
        joints = normalize_joints(frame.get("joints", {}))
        required = ("left_shoulder", "left_elbow", "left_wrist")
        if not all(key in joints for key in required):
            rows.append(f"| {index} | 缺失 | - | - | - | - | - | 错误 |")
            continue
        wrist = joints["left_wrist"]
        elbow = joints["left_elbow"]
        shoulder = joints["left_shoulder"]
        samples = [joints[bone] for bone in LEFT_HAND_CONTOUR_BONES if bone in joints]
        if len(samples) < 6:
            rows.append(f"| {index} | {[round(v, 3) for v in wrist]} | - | 缺失 | 缺失 | 缺失 | - | 错误 |")
            continue
        min_x = min(pos[0] for pos in samples)
        max_x = max(pos[0] for pos in samples)
        min_y = min(pos[1] for pos in samples)
        max_y = max(pos[1] for pos in samples)
        min_z = min(pos[2] for pos in samples)
        max_z = max(pos[2] for pos in samples)
        contour = evaluate_left_akimbo_hand_contour(wrist, samples)
        elbow_angle = angle_between(sub(shoulder, elbow), sub(wrist, elbow))
        ok = (
            2.0 <= wrist[0] <= 2.65
            and 13.0 <= wrist[1] <= 13.95
            and -1.25 <= wrist[2] <= -0.55
            and elbow[0] >= wrist[0] + 1.0
            and 70.0 <= elbow_angle <= 120.0
            and contour["valid"]
        )
        rows.append(
            f"| {index} | {[round(v, 3) for v in wrist]} | {elbow_angle:.1f} | "
            f"{min_x:.3f}-{max_x:.3f} | {min_y:.3f}-{max_y:.3f} | {min_z:.3f}-{max_z:.3f} | "
            f"{contour['finger_drop']:.3f} | `{contour['mode'] or 'invalid'}` | {'正确' if ok else '错误'} |"
        )
    out_path = render_dir / "left_akimbo_metrics_table.md"
    out_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return out_path


def make_right_thinking_table(render_dir: Path) -> Path:
    frames = json.loads((render_dir / "rendered_bone_frames.json").read_text(encoding="utf-8"))
    rows = [
        "| 帧 | 右肘角 | 腕-下巴 | 最近手骨 | 最近手骨-下巴 | 右肘X | 判定 |",
        "|---:|---:|---:|---|---:|---:|---|",
    ]
    for frame in frames:
        index = int(frame.get("index", 0))
        if not (150 <= index <= 210):
            continue
        joints = normalize_joints(frame.get("joints", {}))
        required = ("right_shoulder", "right_elbow", "right_wrist")
        if not all(key in joints for key in required):
            rows.append(f"| {index} | 缺失 | - | - | - | - | 错误 |")
            continue
        shoulder = joints["right_shoulder"]
        elbow = joints["right_elbow"]
        wrist = joints["right_wrist"]
        chin = joints.get("chin", [0.0, 18.87, -1.41])
        samples = [(bone, joints[bone]) for bone in RIGHT_HAND_CONTOUR_BONES if bone in joints]
        if len(samples) < 6:
            rows.append(f"| {index} | - | - | 缺失 | - | {elbow[0]:.3f} | 错误 |")
            continue
        nearest_bone, nearest_pos = min(samples, key=lambda item: dist(item[1], chin))
        elbow_angle = angle_between(sub(shoulder, elbow), sub(wrist, elbow))
        wrist_chin = dist(wrist, chin)
        hand_chin = dist(nearest_pos, chin)
        ok = (
            RIGHT_THINKING_ELBOW_ANGLE[0] <= elbow_angle <= RIGHT_THINKING_ELBOW_ANGLE[1]
            and RIGHT_THINKING_WRIST_CHIN_DISTANCE[0] <= wrist_chin <= RIGHT_THINKING_WRIST_CHIN_DISTANCE[1]
            and hand_chin <= RIGHT_THINKING_HAND_CHIN_DISTANCE_MAX
            and RIGHT_THINKING_ELBOW_X_RANGE[0] <= elbow[0] <= RIGHT_THINKING_ELBOW_X_RANGE[1]
        )
        rows.append(
            f"| {index} | {elbow_angle:.1f} | {wrist_chin:.3f} | `{nearest_bone}` | "
            f"{hand_chin:.3f} | {elbow[0]:.3f} | {'正确' if ok else '错误'} |"
        )
    out_path = render_dir / "right_thinking_semantics_table.md"
    out_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return out_path


def make_right_arm_anatomy_table(render_dir: Path) -> Path:
    frames = json.loads((render_dir / "rendered_bone_frames.json").read_text(encoding="utf-8"))
    rows = [
        "| 帧 | 右肘角 | 肩-腕距离 | 右肘XYZ | 右腕XYZ | 判定 |",
        "|---:|---:|---:|---|---|---|",
    ]
    for frame in frames:
        index = int(frame.get("index", 0))
        if not (150 <= index <= 210):
            continue
        joints = normalize_joints(frame.get("joints", {}))
        required = ("right_shoulder", "right_elbow", "right_wrist")
        if not all(key in joints for key in required):
            rows.append(f"| {index} | 缺失 | 缺失 | - | - | 错误 |")
            continue
        shoulder = joints["right_shoulder"]
        elbow = joints["right_elbow"]
        wrist = joints["right_wrist"]
        elbow_angle = angle_between(sub(shoulder, elbow), sub(wrist, elbow))
        shoulder_wrist = dist(shoulder, wrist)
        ok = (
            RIGHT_ARM_ANATOMY_ELBOW_ANGLE[0] <= elbow_angle <= RIGHT_ARM_ANATOMY_ELBOW_ANGLE[1]
            and RIGHT_ARM_ANATOMY_SHOULDER_WRIST_DISTANCE[0] <= shoulder_wrist <= RIGHT_ARM_ANATOMY_SHOULDER_WRIST_DISTANCE[1]
        )
        rows.append(
            f"| {index} | {elbow_angle:.1f} | {shoulder_wrist:.3f} | "
            f"{[round(v, 3) for v in elbow]} | {[round(v, 3) for v in wrist]} | "
            f"{'正确' if ok else '错误'} |"
        )
    out_path = render_dir / "right_arm_anatomy_table.md"
    out_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return out_path


def make_right_hand_shape_table(render_dir: Path) -> Path:
    frames = json.loads((render_dir / "rendered_bone_frames.json").read_text(encoding="utf-8"))
    limit_y = CHIN_SURFACE[1] - HAND_CONTOUR_CHIN_CLEARANCE
    fingertip_bones = (
        "right_thumb_tip",
        "right_index_tip",
        "right_middle_tip",
        "right_ring_tip",
        "right_pinky_tip",
    )
    rows = [
        "| 帧 | 指尖Y展开 | 整手Y高度 | 最高代理骨 | 最高Y | 顶部余量 | 判定 |",
        "|---:|---:|---:|---|---:|---:|---|",
    ]
    for frame in frames:
        index = int(frame.get("index", 0))
        if not (150 <= index <= 210):
            continue
        joints = normalize_joints(frame.get("joints", {}))
        samples = [(bone, joints[bone]) for bone in RIGHT_HAND_CONTOUR_BONES if bone in joints]
        tips = [(bone, joints[bone]) for bone in fingertip_bones if bone in joints]
        if len(samples) < 6 or len(tips) < 4:
            rows.append(f"| {index} | 缺失 | 缺失 | 缺失 | - | - | 错误 |")
            continue
        ys = [pos[1] for _, pos in samples]
        tip_ys = [pos[1] for _, pos in tips]
        max_bone, max_pos = max(samples, key=lambda item: item[1][1])
        fingertip_y_spread = max(tip_ys) - min(tip_ys)
        hand_y_extent = max(ys) - min(ys)
        top_clearance = limit_y - max_pos[1]
        ok = (
            fingertip_y_spread <= RIGHT_HAND_SHAPE_FINGERTIP_Y_SPREAD_MAX
            and hand_y_extent <= RIGHT_HAND_SHAPE_Y_EXTENT_MAX
            and top_clearance >= RIGHT_HAND_SHAPE_TOP_CLEARANCE_MIN
        )
        rows.append(
            f"| {index} | {fingertip_y_spread:.3f} | {hand_y_extent:.3f} | `{max_bone}` | "
            f"{max_pos[1]:.3f} | {top_clearance:.3f} | {'正确' if ok else '错误'} |"
        )
    out_path = render_dir / "right_hand_shape_table.md"
    out_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--render-dir", required=True, type=Path)
    parser.add_argument("--vmd-name", required=True)
    parser.add_argument("--duration", type=int, default=120)
    parser.add_argument("--frames", type=parse_frame_list, default=DEFAULT_SHEET_FRAMES)
    parser.add_argument("--hand-frames", type=parse_frame_list, default=DEFAULT_HAND_FRAMES)
    args = parser.parse_args()

    render_dir = args.render_dir
    vmd_name = args.vmd_name
    outputs = []
    outputs.extend(make_view_gifs(render_dir, vmd_name, args.duration))
    outputs.append(make_4view_gif(render_dir, vmd_name, args.duration))
    outputs.append(make_review_sheet(render_dir, vmd_name, args.frames))
    outputs.append(make_hand_review_sheet(render_dir, vmd_name, args.hand_frames))
    outputs.append(make_contour_table(render_dir))
    outputs.append(make_left_akimbo_table(render_dir))
    outputs.append(make_right_thinking_table(render_dir))
    outputs.append(make_right_arm_anatomy_table(render_dir))
    outputs.append(make_right_hand_shape_table(render_dir))
    for output in outputs:
        print(output)


if __name__ == "__main__":
    main()
