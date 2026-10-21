# 列出所有材质槽 + 每个材质顶点的主导骨骼（顶点组）分布 top5。
from __future__ import annotations
import argparse, json, sys
from collections import defaultdict
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
    result = {}
    for si, mat in enumerate(md.materials):
        name = mat.name if mat else "?"
        verts = set()
        for poly in md.polygons:
            if poly.material_index == si:
                verts.update(poly.vertices)
        if not verts: continue
        dom = defaultdict(int)
        for vi in verts:
            v = md.vertices[vi]
            bw, bg = -1.0, -1
            for g in v.groups:
                if g.group < 400 and g.weight > bw:  # skip mmd_edge_scale(401)/mmd_vertex_order(402)
                    bw, bg = g.weight, g.group
            if bg >= 0:
                dom[vg[bg]] += 1
        top = dict(sorted(dom.items(), key=lambda kv: -kv[1])[:6])
        result[name] = {"verts": len(verts), "dominantBones": top}
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    for name, info in result.items():
        print(name, info["verts"], info["dominantBones"])
    return 0

sys.exit(main())
