# -*- coding: utf-8 -*-
# Stage 2B-M3.1 权威取证（只读）：读 BodySkin 材质槽的顶点→主导顶点组（骨骼）
# 分布，输出 JSON。不修改 .blend。
# 用法:
#   blender.exe --background --python blender-bodyskin-vg-audit.py -- +#     --blend <权威.blend> --out <audit.json>
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
    if mesh is None or mesh.type != "MESH":
        print("FATAL: mesh not found", MESH)
        return 2

    # BodySkin 材质槽名
    mat_slots = [m.name if m else None for m in mesh.data.materials]
    body_slot = next((i for i, n in enumerate(mat_slots) if n and "BodySkin" in n), None)
    if body_slot is None:
        print("FATAL: BodySkin material slot not found; slots:", mat_slots)
        return 2

    vg_names = [g.name for g in mesh.vertex_groups]
    # 收集 BodySkin 三角形引用的顶点
    body_verts = set()
    for poly in mesh.data.polygons:
        if poly.material_index == body_slot:
            for vi in poly.vertices:
                body_verts.add(vi)

    dom = defaultdict(int)
    region_map = defaultdict(set)  # vg -> set of verts
    for vi in body_verts:
        v = mesh.data.vertices[vi]
        best_w, best_g = -1.0, -1
        for g in v.groups:
            if g.weight > best_w:
                best_w, best_g = g.weight, g.group
        name = vg_names[best_g] if 0 <= best_g < len(vg_names) else ("idx%d" % best_g)
        dom[name] += 1
        region_map[name].add(vi)

    out = {
        "blend": str(Path(args.blend).resolve()),
        "mesh": MESH,
        "materialSlots": mat_slots,
        "bodySlot": body_slot,
        "bodyVertexCount": len(body_verts),
        "bodyPolyCount": sum(1 for p in mesh.data.polygons if p.material_index == body_slot),
        "dominantVertexGroups": {k: v for k, v in sorted(dom.items(), key=lambda kv: -kv[1])},
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("OK body verts=%d polys=%d vgroups=%d" % (len(body_verts), out["bodyPolyCount"], len(dom)))
    for k, v in sorted(dom.items(), key=lambda kv: -kv[1]):
        print("  %s: %d" % (k, v))
    return 0

sys.exit(main())
