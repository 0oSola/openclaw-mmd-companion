# 检查顶点权重实际分布：随机取 BodySkin 顶点，列出其 groups（group index, weight）。
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import bpy

MESH = "GirlsFrontline KoledaDefault_mesh"

def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(); ap.add_argument("--blend", required=True); ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    bpy.ops.wm.open_mainfile(filepath=args.blend)
    mesh = bpy.data.objects.get(MESH); md = mesh.data
    vg = [g.name for g in mesh.vertex_groups]
    body_slot = next((i for i, m in enumerate(md.materials) if m and "BodySkin" in m.name), None)
    verts = []
    for poly in md.polygons:
        if poly.material_index == body_slot:
            verts.extend(poly.vertices)
    sample = sorted(set(verts))[:5]
    out = {"vgCount": len(vg), "vgFirst10": vg[:10]}
    for vi in sample:
        v = md.vertices[vi]
        out["vert%d" % vi] = [{"group": g.group, "name": vg[g.group] if g.group < len(vg) else "?", "weight": g.weight} for g in v.groups]
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0

sys.exit(main())
