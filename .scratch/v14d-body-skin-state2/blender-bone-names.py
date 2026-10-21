# -*- coding: utf-8 -*-
# 导出 armature 骨骼名表（索引序 = PMX 骨骼序）到 JSON。只读。
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import bpy

def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    bpy.ops.wm.open_mainfile(filepath=args.blend)
    arm = bpy.data.objects.get("GirlsFrontline KoledaDefault_arm")
    names = [b.name for b in arm.data.bones]
    Path(args.out).write_text(json.dumps(names, ensure_ascii=False, indent=1), encoding="utf-8")
    print("bones", len(names))
    for i, n in enumerate(names):
        if any(k in n for k in ["首", "腕", "上半身", "手", "指", "親", "人差", "中指", "薬指", "小指"]):
            print(i, n)
    return 0

sys.exit(main())
