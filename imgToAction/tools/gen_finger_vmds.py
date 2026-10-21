#!/usr/bin/env python3
"""Generate finger test VMDs: 6-axis for each finger joint + fist combo."""
import struct, os, math

OUT_DIR = "imgToAction/outputs/vmd/basic_tests"
os.makedirs(OUT_DIR, exist_ok=True)

# Right hand finger bones (test right first, then left for mirror)
# Structure: (bone_name, test_id_prefix)
RIGHT_FINGER_BONES = [
    # Thumb
    ("右親指０", "r_thumb0"),
    ("右親指１", "r_thumb1"),
    ("右親指２", "r_thumb2"),
    # Index
    ("右人指１", "r_index1"),
    ("右人指２", "r_index2"),
    ("右人指３", "r_index3"),
    # Middle
    ("右中指１", "r_middle1"),
    ("右中指２", "r_middle2"),
    ("右中指３", "r_middle3"),
    # Ring
    ("右薬指１", "r_ring1"),
    ("右薬指２", "r_ring2"),
    ("右薬指３", "r_ring3"),
    # Pinky
    ("右小指１", "r_pinky1"),
    ("右小指２", "r_pinky2"),
    ("右小指３", "r_pinky3"),
]

LEFT_FINGER_BONES = [
    ("左親指０", "l_thumb0"),
    ("左親指１", "l_thumb1"),
    ("左親指２", "l_thumb2"),
    ("左人指１", "l_index1"),
    ("左人指２", "l_index2"),
    ("左人指３", "l_index3"),
    ("左中指１", "l_middle1"),
    ("左中指２", "l_middle2"),
    ("左中指３", "l_middle3"),
    ("左薬指１", "l_ring1"),
    ("左薬指２", "l_ring2"),
    ("左薬指３", "l_ring3"),
    ("左小指１", "l_pinky1"),
    ("左小指２", "l_pinky2"),
    ("左小指３", "l_pinky3"),
]

# Wrist twist bones
WRIST_BONES = [
    ("右手捩", "r_wrist_twist0"),
    ("右手捩1", "r_wrist_twist1"),
    ("右手捩2", "r_wrist_twist2"),
    ("右手捩3", "r_wrist_twist3"),
    ("左手捩", "l_wrist_twist0"),
    ("左手捩1", "l_wrist_twist1"),
    ("左手捩2", "l_wrist_twist2"),
    ("左手捩3", "l_wrist_twist3"),
]

AXES = [
    ("xp", "x", 45),
    ("xn", "x", -45),
    ("yp", "y", 45),
    ("yn", "y", -45),
    ("zp", "z", 45),
    ("zn", "z", -45),
]

def axis_to_quat(axis, angle_deg):
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

def write_vmd(filepath, bone_specs):
    """Write VMD with one or more bone motions. bone_specs = [(bone_name, quat), ...]"""
    header = b"Vocaloid Motion Data 0002" + b"\x00" * 5  # 30 bytes
    model_name = b"Eula\x00" * 4
    model_name = model_name[:20]
    
    # Each bone gets 2 frames (frame 1 and 30) with same rotation
    total_frames = len(bone_specs) * 2
    bone_count = struct.pack("<I", total_frames)
    
    bone_data = b""
    for bone_name, quat in bone_specs:
        for frame in (1, 30):
            name_bytes = bone_name.encode("shift-jis")[:15]
            name_bytes = name_bytes + b"\x00" * (15 - len(name_bytes))
            frame_num = struct.pack("<I", frame)
            pos = struct.pack("<fff", 0.0, 0.0, 0.0)
            rot = struct.pack("<ffff", quat[0], quat[1], quat[2], quat[3])
            interp = bytes([0,0,0,0,1,0,0,0, 0,0,0,0,1,0,0,0,
                           0,0,0,0,1,0,0,0, 0,0,0,0,1,0,0,0,
                           0,0,0,0,1,0,0,0, 0,0,0,0,1,0,0,0,
                           0,0,0,0,1,0,0,0, 0,0,0,0,1,0,0,0])
            bone_data += name_bytes + frame_num + pos + rot + interp
    
    morph_count = struct.pack("<I", 0)
    camera_count = struct.pack("<I", 0)
    light_count = struct.pack("<I", 0)
    
    with open(filepath, "wb") as f:
        f.write(header + model_name + bone_count + bone_data + morph_count + camera_count + light_count)

count = 0

# Single-bone axis tests
all_bones = RIGHT_FINGER_BONES + LEFT_FINGER_BONES + WRIST_BONES
for bone_name, test_id in all_bones:
    for axis_suffix, axis, angle in AXES:
        quat = axis_to_quat(axis, angle)
        filepath = os.path.join(OUT_DIR, f"basic_{test_id}_{axis_suffix}.vmd")
        write_vmd(filepath, [(bone_name, quat)])
        count += 1

# Fist combo: all right finger joints bend at once (X-axis -90°)
fist_bones = [
    ("右親指０", axis_to_quat("x", -45)),
    ("右親指１", axis_to_quat("x", -45)),
    ("右親指２", axis_to_quat("x", -45)),
    ("右人指１", axis_to_quat("x", -90)),
    ("右人指２", axis_to_quat("x", -90)),
    ("右人指３", axis_to_quat("x", -90)),
    ("右中指１", axis_to_quat("x", -90)),
    ("右中指２", axis_to_quat("x", -90)),
    ("右中指３", axis_to_quat("x", -90)),
    ("右薬指１", axis_to_quat("x", -90)),
    ("右薬指２", axis_to_quat("x", -90)),
    ("右薬指３", axis_to_quat("x", -90)),
    ("右小指１", axis_to_quat("x", -90)),
    ("右小指２", axis_to_quat("x", -90)),
    ("右小指３", axis_to_quat("x", -90)),
]
write_vmd(os.path.join(OUT_DIR, "basic_r_fist_xn90.vmd"), fist_bones)
count += 1

# Left fist
fist_bones_l = [
    (n.replace("右", "左"), q) for n, q in fist_bones
]
write_vmd(os.path.join(OUT_DIR, "basic_l_fist_xn90.vmd"), fist_bones_l)
count += 1

# Rest baseline
write_vmd(os.path.join(OUT_DIR, "basic_finger_rest.vmd"), [("右人指１", axis_to_quat(None, 0))])
count += 1

print(f"Generated {count} VMD files")
