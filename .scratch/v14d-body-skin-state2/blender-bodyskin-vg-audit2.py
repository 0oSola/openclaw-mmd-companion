# -*- coding: utf-8 -*-
# Stage 2B-M3.1 权威取证（只读）：BodySkin 顶点的主导骨骼顶点组。
# 检查 vertex_groups / armature modifier / pose bones 全链路。
from __future__ import annotations
import argparse, json, sys
from collections import defaultdict
from pathlib import Path
import bpy

MESH = "GirlsFrontline KoledaDefault_mesh"

def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    bpy.ops.wm.open_mainfile(filepath=args.blend)
    mesh = bpy.data.objects.get(MESH)
    md = mesh.data
    vg_names = [g.name for g in mesh.vertex_groups]
    print("vertex_groups count:", len(vg_names))
    print("vertex_groups sample:", vg_names[:20])
    print("modifiers:", [(m.name, m.type) for m in mesh.modifiers])
    # armature bones
    arm = next((m.object for m in mesh.modifiers if m.type == "ARMATURE"), None)
    bone_names = []
    if arm:
        bone_names = [b.name for b in arm.data.bones]
        print("armature:", arm.name, "bones:", len(bone_names))
        print("bone sample:", bone_names[:30])
    # 逐顶点主导组
    mat_slots = [m.name if m else None for m in md.materials]
    body_slot = next((i for i, n in enumerate(mat_slots) if n and "BodySkin" in n), None)
    body_verts = set()
    for poly in md.polygons:
        if poly.material_index == body_slot:
            body_verts.update(poly.vertices)
    dom = defaultdict(int)
    for vi in body_verts:
        v = md.vertices[vi]
        best_w, best_g = -1.0, -1
        for g in v.groups:
            if g.weight > best_w:
                best_w, best_g = g.weight, g.group
        name = vg_names[best_g] if 0 <= best_g < len(vg_names) else ("idx%d" % best_g)
        dom[name] += 1
    out = {
        "blend": str(Path(args.blend).resolve()),
        "vertexGroups": vg_names,
        "modifiers": [(m.name, m.type) for m in mesh.modifiers],
        "armature": arm.name if arm else None,
        "armatureBones": bone_names,
        "bodyVertexCount": len(body_verts),
        "dominantVertexGroups": dict(sorted(dom.items(), key=lambda kv: -kv[1])),
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("OK body verts=%d dominant groups:" % len(body_verts))
    for k, v in sorted(dom.items(), key=lambda kv: -kv[1])[:40]:
        print("  %s: %d" % (k, v))
    return 0

sys.exit(main())
