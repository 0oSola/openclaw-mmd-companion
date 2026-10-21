#!/usr/bin/env python3
"""Generate test VMDs for lower body bones with rest + 90° rotation frames."""
import struct, os, math

OUT_DIR = "imgToAction/outputs/vmd/basic_tests"
os.makedirs(OUT_DIR, exist_ok=True)

# Bone rotation tests: (filename_suffix, bone_name_jp, axis, angle_deg)
TESTS = [
    # Right ankle - X axis (pitch / toe up-down)
    ("r_ankle_rest", "右足首", None, 0),
    ("r_ankle_x90", "右足首", "x", 90),
    ("r_ankle_xn90", "右足首", "x", -90),
    # Right hip (thigh) - X axis (front-back swing)
    ("r_hip_rest", "右足", None, 0),
    ("r_hip_x90", "右足", "x", 90),
    ("r_hip_xn90", "右足", "x", -90),
    # Right knee - X axis
    ("r_knee_rest", "右ひざ", None, 0),
    ("r_knee_x90", "右ひざ", "x", 90),
    ("r_knee_xn90", "右ひざ", "x", -90),
    # Left ankle for comparison
    ("l_ankle_rest", "左足首", None, 0),
    ("l_ankle_x90", "左足首", "x", 90),
]

def axis_to_quat(axis, angle_deg):
    """Convert axis+angle to quaternion (x,y,z,w)."""
    if axis is None:
        return (0.0, 0.0, 0.0, 1.0)
    a = math.radians(angle_deg)
    h = a / 2.0
    s = math.sin(h)
    c = math.cos(h)
    if axis == "x": return (s, 0.0, 0.0, c)
    if axis == "y": return (0.0, s, 0.0, c)
    if axis == "z": return (0.0, 0.0, s, c)
    return (0.0, 0.0, 0.0, 1.0)

def write_vmd(filepath, bone_name, quat, frames=(1, 30)):
    """Write a minimal VMD with one bone motion at given frames."""
    # VMD header
    header = b"Vocaloid Motion Data 0002" + b"\x00" * 5  # 30 bytes magic
    model_name = b"Eula\x00" * 4  # 20 bytes, shift-jis padded
    model_name = model_name[:20]
    
    # Bone motion count: 2 frames
    bone_count = struct.pack("<I", len(frames))
    
    bone_data = b""
    for frame in frames:
        name_bytes = bone_name.encode("shift-jis")[:15]
        name_bytes = name_bytes + b"\x00" * (15 - len(name_bytes))
        frame_num = struct.pack("<I", frame)
        pos = struct.pack("<fff", 0.0, 0.0, 0.0)
        rot = struct.pack("<ffff", quat[0], quat[1], quat[2], quat[3])
        # 64 bytes of interpolation (default)
        interp = bytes([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
                       0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
                       0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
                       0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0])
        bone_data += name_bytes + frame_num + pos + rot + interp
    
    # No morphs, no camera, no light
    morph_count = struct.pack("<I", 0)
    camera_count = struct.pack("<I", 0)
    light_count = struct.pack("<I", 0)
    
    with open(filepath, "wb") as f:
        f.write(header + model_name + bone_count + bone_data + morph_count + camera_count + light_count)
    
    print(f"Wrote {filepath}: bone={bone_name} quat={quat} frames={frames}")

for suffix, bone, axis, angle in TESTS:
    quat = axis_to_quat(axis, angle)
    filepath = os.path.join(OUT_DIR, f"basic_{suffix}.vmd")
    write_vmd(filepath, bone, quat)

print(f"\nGenerated {len(TESTS)} VMD files")
