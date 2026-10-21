from __future__ import annotations

import math
import struct
from pathlib import Path


VMD_HEADER = b"Vocaloid Motion Data 0002"
DEFAULT_INTERPOLATION = bytes([20, 20, 107, 107] * 16)


def _pad_sjis(text: str, length: int) -> bytes:
    encoded = text.encode("shift_jis", errors="ignore")
    return encoded[:length].ljust(length, b"\x00")


def _euler_deg_to_quaternion_xyz(rx_deg: float, ry_deg: float, rz_deg: float) -> tuple[float, float, float, float]:
    rx = math.radians(rx_deg) * 0.5
    ry = math.radians(ry_deg) * 0.5
    rz = math.radians(rz_deg) * 0.5

    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)

    qw = cx * cy * cz - sx * sy * sz
    qx = sx * cy * cz + cx * sy * sz
    qy = cx * sy * cz - sx * cy * sz
    qz = cx * cy * sz + sx * sy * cz
    return (qx, qy, qz, qw)


def build_mature_female_idle_motion() -> dict:
    bone_frames = [
        (0, "センター", (-0.65, 0.00, 0.15), (0.0, -1.0, -2.2)),
        (0, "下半身", (0.00, 0.00, 0.00), (1.2, -3.5, -6.0)),
        (0, "上半身", (0.00, 0.00, 0.00), (1.2, 1.6, 2.2)),
        (0, "上半身2", (0.00, 0.00, 0.00), (-0.6, 1.0, 1.4)),
        (0, "首", (0.00, 0.00, 0.00), (-0.2, 0.8, 0.6)),
        (0, "頭", (0.00, 0.00, 0.00), (0.4, 1.2, 0.4)),
        (0, "足IK_L", (0.00, 0.00, 0.00), (0.0, 0.0, 0.0)),
        (0, "足IK_R", (0.08, 0.00, -0.06), (0.0, 0.0, 0.0)),
        (30, "センター", (-0.68, 0.03, 0.16), (0.2, -1.2, -2.4)),
        (30, "下半身", (0.00, 0.00, 0.00), (1.5, -3.8, -6.4)),
        (30, "上半身", (0.00, 0.06, 0.00), (-0.8, 1.9, 2.5)),
        (30, "上半身2", (0.00, 0.04, 0.00), (-1.4, 1.4, 1.8)),
        (30, "首", (0.00, 0.00, 0.00), (-0.5, 1.0, 0.7)),
        (30, "頭", (0.00, 0.00, 0.00), (0.1, 1.4, 0.5)),
        (30, "足IK_L", (0.00, 0.00, 0.00), (0.0, 0.0, 0.0)),
        (30, "足IK_R", (0.10, 0.00, -0.05), (0.0, 0.0, 0.0)),
        (54, "首", (0.00, 0.00, 0.00), (-0.3, -0.2, 0.6)),
        (54, "頭", (0.00, 0.00, 0.00), (0.0, -0.8, 0.4)),
        (60, "センター", (-0.64, -0.01, 0.14), (-0.1, -0.9, -2.1)),
        (60, "下半身", (0.00, 0.00, 0.00), (1.0, -3.3, -5.8)),
        (60, "上半身", (0.00, 0.00, 0.00), (1.0, 1.5, 2.1)),
        (60, "上半身2", (0.00, 0.00, 0.00), (-0.4, 0.9, 1.3)),
        (60, "首", (0.00, 0.00, 0.00), (-0.2, -0.6, 0.5)),
        (60, "頭", (0.00, 0.00, 0.00), (0.2, -1.8, 0.3)),
        (60, "足IK_L", (0.00, 0.00, 0.00), (0.0, 0.0, 0.0)),
        (60, "足IK_R", (0.07, 0.00, -0.07), (0.0, 0.0, 0.0)),
        (66, "首", (0.00, 0.00, 0.00), (-0.2, 0.4, 0.6)),
        (66, "頭", (0.00, 0.00, 0.00), (0.3, 0.8, 0.4)),
        (90, "センター", (-0.67, 0.02, 0.15), (0.1, -1.1, -2.3)),
        (90, "下半身", (0.00, 0.00, 0.00), (1.3, -3.6, -6.2)),
        (90, "上半身", (0.00, 0.04, 0.00), (-0.5, 1.8, 2.4)),
        (90, "上半身2", (0.00, 0.03, 0.00), (-1.0, 1.2, 1.7)),
        (90, "首", (0.00, 0.00, 0.00), (-0.4, 0.9, 0.7)),
        (90, "頭", (0.00, 0.00, 0.00), (0.1, 1.3, 0.5)),
        (90, "足IK_L", (0.00, 0.00, 0.00), (0.0, 0.0, 0.0)),
        (90, "足IK_R", (0.09, 0.00, -0.05), (0.0, 0.0, 0.0)),
        (120, "センター", (-0.65, 0.00, 0.15), (0.0, -1.0, -2.2)),
        (120, "下半身", (0.00, 0.00, 0.00), (1.2, -3.5, -6.0)),
        (120, "上半身", (0.00, 0.00, 0.00), (1.2, 1.6, 2.2)),
        (120, "上半身2", (0.00, 0.00, 0.00), (-0.6, 1.0, 1.4)),
        (120, "首", (0.00, 0.00, 0.00), (-0.2, 0.8, 0.6)),
        (120, "頭", (0.00, 0.00, 0.00), (0.4, 1.2, 0.4)),
        (120, "足IK_L", (0.00, 0.00, 0.00), (0.0, 0.0, 0.0)),
        (120, "足IK_R", (0.08, 0.00, -0.06), (0.0, 0.0, 0.0)),
    ]
    morph_frames = [
        (0, "まばたき", 0.0),
        (58, "まばたき", 0.0),
        (60, "まばたき", 1.0),
        (62, "まばたき", 0.0),
        (120, "まばたき", 0.0),
    ]
    return {
        "model_name": "MatureIdleLoop",
        "bone_frames": [
            {
                "frame": frame,
                "name": name,
                "position": position,
                "rotation": rotation,
                "interpolation": DEFAULT_INTERPOLATION,
            }
            for frame, name, position, rotation in bone_frames
        ],
        "morph_frames": [
            {
                "frame": frame,
                "name": name,
                "weight": weight,
            }
            for frame, name, weight in morph_frames
        ],
    }


def write_vmd_file(output_path: str | Path, motion: dict) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("wb") as fh:
        fh.write(VMD_HEADER.ljust(30, b"\x00"))
        fh.write(_pad_sjis(motion["model_name"], 20))

        bone_frames = motion["bone_frames"]
        fh.write(struct.pack("<I", len(bone_frames)))
        for frame in bone_frames:
            fh.write(_pad_sjis(frame["name"], 15))
            fh.write(struct.pack("<I", frame["frame"]))
            fh.write(struct.pack("<3f", *frame["position"]))
            fh.write(struct.pack("<4f", *_euler_deg_to_quaternion_xyz(*frame["rotation"])))
            fh.write(frame.get("interpolation", DEFAULT_INTERPOLATION))

        morph_frames = motion["morph_frames"]
        fh.write(struct.pack("<I", len(morph_frames)))
        for frame in morph_frames:
            fh.write(_pad_sjis(frame["name"], 15))
            fh.write(struct.pack("<I", frame["frame"]))
            fh.write(struct.pack("<f", frame["weight"]))

        fh.write(struct.pack("<IIII", 0, 0, 0, 0))

    return output
