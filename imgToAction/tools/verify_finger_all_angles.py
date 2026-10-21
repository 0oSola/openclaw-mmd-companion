import os, json
from collections import defaultdict

shot_dir = "imgToAction/outputs/actions/20260702_finger_shot"
angles = ["front", "left", "right", "back"]

with open("imgToAction/outputs/actions/20260702_finger_metrics/all_metrics.json") as f:
    metrics = json.load(f)

vmd_names = [m["vmd"] for m in metrics]

results = []
for vmd in vmd_names:
    parts = vmd.replace("basic_", "")
    for suffix in ["_xp", "_xn", "_yp", "_yn", "_zp", "_zn"]:
        if parts.endswith(suffix):
            bone_id = parts[:-len(suffix)]
            axis = suffix[1:]
            break
    else:
        bone_id = parts
        axis = ""
    angle_results = {}
    for angle in angles:
        if axis:
            filepath = os.path.join(shot_dir, bone_id, angle, f"basic_{bone_id}_{axis}.png")
        else:
            filepath = os.path.join(shot_dir, bone_id, angle, f"basic_{bone_id}_xn90.png")
        angle_results[angle] = os.path.getsize(filepath) if os.path.exists(filepath) else None
    results.append({"vmd": vmd, "bone_id": bone_id, "axis": axis, "sizes": angle_results})

bone_groups = defaultdict(list)
for r in results:
    bone_groups[r["bone_id"]].append(r)

problem_bones = ["l_index2", "l_index3", "l_middle2", "l_middle3", "l_ring2", "l_ring3", "l_pinky2", "l_pinky3", "l_pinky1"]
for bone_id in problem_bones:
    if bone_id in bone_groups:
        entries = bone_groups[bone_id]
        print(f"=== {bone_id} ===")
        for angle in angles:
            sizes = [e["sizes"].get(angle) for e in entries]
            sizes_valid = [s for s in sizes if s is not None]
            if len(sizes_valid) >= 2:
                unique = len(set(sizes_valid))
                status = "EFFECTIVE" if unique > 1 else "SAME(ineffective)"
                print(f"  {angle}: {unique} unique sizes -> {status}")
        print()
