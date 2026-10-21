#!/usr/bin/env python3
"""Generate comparison images and GIFs from twist test screenshots."""
import os
from PIL import Image, ImageDraw

base = "imgToAction/outputs/actions/20260702_twist_shot"
out_dir = "imgToAction/outputs/actions/20260702_twist_gif"
os.makedirs(out_dir, exist_ok=True)

angles = ["front", "right", "back", "left"]
thumb_w, thumb_h = 200, 300
label_h = 30

# 1. Wrist X-axis angle comparison (front view)
# Shows rest -> 15 -> 30 -> 45 -> 60 -> 90 degrees
def make_angle_comparison(bone_prefix, axis, angle_list, view_angle, label):
    images = []
    for angle in angle_list:
        sign = "p" if angle >= 0 else "n"
        name = f"{bone_prefix}_{axis}{sign}{abs(angle)}"
        fpath = os.path.join(base, name, view_angle, name + ".png")
        if os.path.exists(fpath):
            img = Image.open(fpath).resize((thumb_w, thumb_h))
            images.append((name, img))
    
    if not images:
        return None
    
    row_w = thumb_w * len(images)
    row = Image.new("RGB", (row_w, thumb_h + label_h), (255, 255, 255))
    draw = ImageDraw.Draw(row)
    draw.text((10, 5), label, fill=(0, 0, 0))
    for i, (name, img) in enumerate(images):
        row.paste(img, (i * thumb_w, label_h))
        draw.text((i * thumb_w + 5, label_h + thumb_h - 20), str(name.split("_")[-1]), fill=(255, 0, 0))
    return row

# Generate comparisons
comparisons = [
    # Right wrist X-axis progression (front)
    ("twist_r_wrist", "x", [0, 15, 30, 45, 60, 90], "front", "R wrist X-axis 0->90 (front)"),
    ("twist_r_wrist", "x", [0, -15, -30, -45, -60, -90], "front", "R wrist X-axis 0->-90 (front)"),
    # Right wrist X-axis (left view)
    ("twist_r_wrist", "x", [0, 45, 90, -45, -90], "left", "R wrist X-axis (left view)"),
    # Right elbow X-axis (front)
    ("twist_r_elbow", "x", [0, 45, 90, -45, -90], "front", "R elbow X-axis (front)"),
    # Left wrist X-axis (front)
    ("twist_l_wrist", "x", [0, 45, 90, -45, -90], "front", "L wrist X-axis (front)"),
    # Right wrist Y and Z (front)
    ("twist_r_wrist", "y", [45, -45], "front", "R wrist Y-axis +/-45 (front)"),
    ("twist_r_wrist", "z", [45, -45], "front", "R wrist Z-axis +/-45 (front)"),
]

# Handle rest as angle 0
def get_rest_img(view_angle):
    rest_name = "twist_rest"
    fpath = os.path.join(base, rest_name, view_angle, rest_name + ".png")
    if os.path.exists(fpath):
        return Image.open(fpath).resize((thumb_w, thumb_h))
    return Image.new("RGB", (thumb_w, thumb_h), (200, 200, 200))

rows = []
for prefix, axis, angles_list, view, label in comparisons:
    images = []
    for angle in angles_list:
        if angle == 0:
            img = get_rest_img(view)
            images.append(("rest", img))
        else:
            sign = "p" if angle >= 0 else "n"
            name = f"{prefix}_{axis}{sign}{abs(angle)}"
            fpath = os.path.join(base, name, view, name + ".png")
            if os.path.exists(fpath):
                img = Image.open(fpath).resize((thumb_w, thumb_h))
                images.append((str(angle), img))
            else:
                images.append((str(angle)+"(missing)", Image.new("RGB", (thumb_w, thumb_h), (200, 200, 200))))
    
    if not images:
        continue
    
    row_w = thumb_w * len(images)
    row = Image.new("RGB", (row_w, thumb_h + label_h), (255, 255, 255))
    draw = ImageDraw.Draw(row)
    draw.text((10, 5), label, fill=(0, 0, 0))
    for i, (name, img) in enumerate(images):
        row.paste(img, (i * thumb_w, label_h))
        draw.text((i * thumb_w + 5, label_h + thumb_h - 20), name, fill=(255, 0, 0))
    rows.append(row)

if rows:
    total_h = sum(r.height for r in rows)
    max_w = max(r.width for r in rows)
    final = Image.new("RGB", (max_w, total_h), (255, 255, 255))
    y = 0
    for r in rows:
        final.paste(r, (0, y))
        y += r.height
    out_path = os.path.join(base, "twist_comparison.png")
    final.save(out_path)
    print(f"Saved comparison: {out_path}")

# 2. Generate GIFs from sequence frames
seq_names = ["twist_r_wrist_xseq30", "twist_r_wrist_yseq30", "twist_r_wrist_zseq30"]
for seq_name in seq_names:
    seq_dir = os.path.join(base, seq_name)
    if not os.path.isdir(seq_dir):
        print(f"SKIP {seq_name} (directory not found)")
        continue
    
    # Collect frames from front angle
    front_dir = os.path.join(seq_dir, "front")
    if not os.path.isdir(front_dir):
        print(f"SKIP {seq_name}/front (not found)")
        continue
    
    frames = []
    frame_files = sorted([f for f in os.listdir(front_dir) if f.endswith(".png")])
    for ff in frame_files:
        img = Image.open(os.path.join(front_dir, ff)).resize((400, 600))
        frames.append(img)
    
    if frames:
        # 4-angle GIF: 2x2 grid
        gif_frames = []
        for fi in range(len(frames)):
            grid = Image.new("RGB", (800, 1200), (255, 255, 255))
            draw = ImageDraw.Draw(grid)
            for j, angle in enumerate(angles):
                adir = os.path.join(seq_dir, angle)
                if os.path.isdir(adir):
                    aff = sorted([f for f in os.listdir(adir) if f.endswith(".png")])
                    if fi < len(aff):
                        img = Image.open(os.path.join(adir, aff[fi])).resize((400, 600))
                        x = (j % 2) * 400
                        y_pos = (j // 2) * 600
                        grid.paste(img, (x, y_pos))
                        draw.text((x + 5, y_pos + 5), angle, fill=(255, 255, 0))
            gif_frames.append(grid)
        
        out_path = os.path.join(out_dir, seq_name + "_4angle.gif")
        gif_frames[0].save(out_path, save_all=True, append_images=gif_frames[1:], duration=150, loop=0)
        print(f"Saved GIF: {out_path} ({len(gif_frames)} frames)")

# 3. Generate data table
import json
table_path = os.path.join(base, "twist_metrics.json")
metrics = []

test_specs = [
    # (vmd_name, bone, input_rotation, description)
    ("twist_rest", "右腕", "rest(0)", "基线"),
    ("twist_r_wrist_xp15", "右腕", "X=+15", "手腕X轴+15度"),
    ("twist_r_wrist_xp30", "右腕", "X=+30", "手腕X轴+30度"),
    ("twist_r_wrist_xp45", "右腕", "X=+45", "手腕X轴+45度"),
    ("twist_r_wrist_xp60", "右腕", "X=+60", "手腕X轴+60度"),
    ("twist_r_wrist_xp90", "右腕", "X=+90", "手腕X轴+90度"),
    ("twist_r_wrist_xn15", "右腕", "X=-15", "手腕X轴-15度"),
    ("twist_r_wrist_xn30", "右腕", "X=-30", "手腕X轴-30度"),
    ("twist_r_wrist_xn45", "右腕", "X=-45", "手腕X轴-45度"),
    ("twist_r_wrist_xn60", "右腕", "X=-60", "手腕X轴-60度"),
    ("twist_r_wrist_xn90", "右腕", "X=-90", "手腕X轴-90度"),
    ("twist_r_elbow_xp15", "右ひじ", "X=+15", "手肘X轴+15度"),
    ("twist_r_elbow_xp30", "右ひじ", "X=+30", "手肘X轴+30度"),
    ("twist_r_elbow_xp45", "右ひじ", "X=+45", "手肘X轴+45度"),
    ("twist_r_elbow_xp60", "右ひじ", "X=+60", "手肘X轴+60度"),
    ("twist_r_elbow_xp90", "右ひじ", "X=+90", "手肘X轴+90度"),
    ("twist_r_elbow_xn15", "右ひじ", "X=-15", "手肘X轴-15度"),
    ("twist_r_elbow_xn30", "右ひじ", "X=-30", "手肘X轴-30度"),
    ("twist_r_elbow_xn45", "右ひじ", "X=-45", "手肘X轴-45度"),
    ("twist_r_elbow_xn60", "右ひじ", "X=-60", "手肘X轴-60度"),
    ("twist_r_elbow_xn90", "右ひじ", "X=-90", "手肘X轴-90度"),
    ("twist_r_wrist_yp45", "右腕", "Y=+45", "手腕Y轴+45度"),
    ("twist_r_wrist_yn45", "右腕", "Y=-45", "手腕Y轴-45度"),
    ("twist_r_wrist_zp45", "右腕", "Z=+45", "手腕Z轴+45度"),
    ("twist_r_wrist_zn45", "右腕", "Z=-45", "手腕Z轴-45度"),
    ("twist_l_wrist_xp45", "左腕", "X=+45", "左手腕X轴+45度"),
    ("twist_l_wrist_xp90", "左腕", "X=+90", "左手腕X轴+90度"),
    ("twist_l_wrist_xn45", "左腕", "X=-45", "左手腕X轴-45度"),
    ("twist_l_wrist_xn90", "左腕", "X=-90", "左手腕X轴-90度"),
]

# Get baseline file sizes
baseline_sizes = {}
rest_dir = os.path.join(base, "twist_rest")
if os.path.isdir(rest_dir):
    for angle in angles:
        rp = os.path.join(rest_dir, angle, "twist_rest.png")
        if os.path.exists(rp):
            baseline_sizes[angle] = os.path.getsize(rp)

for vmd_name, bone, rotation, desc in test_specs:
    vmd_dir = os.path.join(base, vmd_name)
    if not os.path.isdir(vmd_dir):
        metrics.append({"vmd": vmd_name, "bone": bone, "rotation": rotation, "desc": desc, "status": "NOT_RENDERED"})
        continue
    
    angle_sizes = {}
    has_change = False
    for angle in angles:
        fp = os.path.join(vmd_dir, angle, vmd_name + ".png")
        if os.path.exists(fp):
            size = os.path.getsize(fp)
            angle_sizes[angle] = size
            if angle in baseline_sizes and size != baseline_sizes[angle]:
                has_change = True
        else:
            angle_sizes[angle] = None
    
    verdict = "有效" if has_change else ("基线" if vmd_name == "twist_rest" else "无变化")
    metrics.append({
        "vmd": vmd_name,
        "bone": bone,
        "rotation": rotation,
        "desc": desc,
        "sizes": angle_sizes,
        "baseline": baseline_sizes,
        "verdict": verdict
    })

with open(table_path, "w", encoding="utf-8") as f:
    json.dump(metrics, f, indent=2, ensure_ascii=False)
print(f"Saved metrics: {table_path} ({len(metrics)} entries)")

# Print markdown table
print("\n## 前臂扭转测试数据表\n")
print("| 文件夹 | 骨骼 | 输入旋转 | 说明 | front | left | right | back | 判定 |")
print("|---|---|---|---|---|---|---|---|---|")
for m in metrics:
    if m["status"] == "NOT_RENDERED":
        print(f"| {m['vmd']} | {m['bone']} | {m['rotation']} | {m['desc']} | - | - | - | - | 未渲染 |")
    else:
        sizes = m.get("sizes", {})
        s_str = " | ".join([str(sizes.get(a, "-") or "-") for a in angles])
        print(f"| {m['vmd']} | {m['bone']} | {m['rotation']} | {m['desc']} | {sizes.get('front','-')} | {sizes.get('left','-')} | {sizes.get('right','-')} | {sizes.get('back','-')} | {m['verdict']} |")
