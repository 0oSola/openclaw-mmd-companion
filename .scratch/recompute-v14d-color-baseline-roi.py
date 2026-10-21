from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import OpenImageIO as oiio


OUT = Path(r"C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture")
WIDTH = 1280
HEIGHT = 720
EROSION = 2

ROI_BOUNDS = {
    "hair.front": [478, 119, 277, 334],
    "hair.back": [497, 190, 343, 530],
    "skin.face": [570, 282, 167, 114],
    "clothes.chest": [523, 434, 297, 286],
    # 角色左袖（肩.L）在该固定视角只露出画面右下的小片。
    "clothes.leftSleeve": [878, 675, 23, 45],
    # 观察者左侧、角色右袖的较大区域，仅用于语义对照。
    "clothes.viewerLeftSleeve": [225, 539, 221, 181],
}

LEVELS = {
    "baseColor": OUT / "blender-white-light-frame120-base-color-scene-linear.exr",
    "linearHdr": OUT / "blender-white-light-frame120-linear-hdr-scene-linear.exr",
    "finalDisplay": OUT / "blender-white-light-frame120-final-display.png",
}


def read_image(path: Path) -> np.ndarray:
    image_input = oiio.ImageInput.open(str(path))
    if image_input is None:
        raise RuntimeError(f"无法打开图像: {path}; {oiio.geterror()}")
    try:
        spec = image_input.spec()
        pixels = image_input.read_image(oiio.FLOAT)
        if pixels is None:
            raise RuntimeError(f"无法读取图像: {path}; {image_input.geterror()}")
        array = np.asarray(pixels, dtype=np.float64)
        if array.ndim != 3 or array.shape[0] != HEIGHT or array.shape[1] != WIDTH or array.shape[2] < 3:
            raise RuntimeError(f"图像尺寸/通道异常: {path}; shape={array.shape}")
        return array[:, :, :4] if array.shape[2] >= 4 else array[:, :, :3]
    finally:
        image_input.close()


def read_mask(path: Path) -> np.ndarray:
    image = read_image(path)
    return image[:, :, 1] >= 0.5


def linear_to_srgb(value: float) -> float:
    if not math.isfinite(value):
        return float("nan")
    value = max(0.0, value)
    if value <= 0.0031308:
        return value * 12.92
    return 1.055 * value ** (1.0 / 2.4) - 0.055


def bounds_mask(bounds: list[int], erosion: int) -> np.ndarray:
    x, y, width, height = bounds
    result = np.zeros((HEIGHT, WIDTH), dtype=bool)
    min_x = max(0, x + erosion)
    min_y = max(0, y + erosion)
    max_x = min(WIDTH, x + width - erosion - 1)
    max_y = min(HEIGHT, y + height - erosion - 1)
    if min_x <= max_x and min_y <= max_y:
        result[min_y : max_y + 1, min_x : max_x + 1] = True
    return result


def mean_for_roi(image: np.ndarray, mask: np.ndarray, bounds: list[int]) -> dict:
    enabled = mask & bounds_mask(bounds, EROSION)
    values = image[enabled, :3]
    finite_values = values[np.isfinite(values).all(axis=1)]
    mean = finite_values.mean(axis=0) if len(finite_values) else None
    return {
        "boundsPx": bounds,
        "edgeErosionPx": EROSION,
        "sampleCount": int(enabled.sum()),
        "validSampleCount": int(len(finite_values)),
        "validRate": float(len(finite_values) / enabled.sum()) if enabled.sum() else 0.0,
        "mean": [float(value) for value in mean] if mean is not None else None,
    }


def main() -> None:
    images = {level: read_image(path) for level, path in LEVELS.items()}
    result = {}
    for roi_id, bounds in ROI_BOUNDS.items():
        safe_id = roi_id.replace(".", "-")
        mask_name = roi_id if roi_id != "clothes.viewerLeftSleeve" else "clothes-leftSleeve"
        mask_path = OUT / f"blender-white-light-frame120-mask-{mask_name.replace('.', '-')}.png"
        if not mask_path.exists():
            if roi_id == "clothes.viewerLeftSleeve":
                mask_path = OUT / "blender-white-light-frame120-mask-clothes-leftSleeve.png"
            else:
                raise RuntimeError(f"缺少 mask: {mask_path}")
        mask = read_mask(mask_path)
        levels = {}
        for level, image in images.items():
            stats = mean_for_roi(image, mask, bounds)
            if stats["mean"] is not None and level in {"baseColor", "linearHdr"}:
                stats["meanSceneLinear"] = stats["mean"]
                stats["meanSrgb"] = [linear_to_srgb(value) for value in stats["mean"]]
            elif stats["mean"] is not None:
                stats["meanSrgb"] = stats["mean"]
            levels[level] = stats
        result[roi_id] = {
            "maskPath": str(mask_path),
            "levels": levels,
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
