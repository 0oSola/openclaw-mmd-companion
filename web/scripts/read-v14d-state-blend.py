#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读取 V14D 权威 blend 的 Face 材质 State/Blend 节点契约（frame 120）。

本脚本只读（不渲染、不保存），在 Blender background 进程中：
  1. 设置 frame=120 并执行 blend 内 V14D 迟滞运行时入口；
  2. 自省 Face 材质与 State01234/LayerA/LayerB/BlendWeight 四个 VALUE 节点；
  3. 输出 g0-state-blend.json，供 G0（decode-face-roi.mjs）校验
     State=2、BlendWeight=0 的权威帧契约。

只读：不调用任何 save 操作，源 blend 不被保存或覆盖。

用法：
  blender --background <authority.blend> --python this.py -- --output <out.json>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy

# 复用已验收的中心 gate 自省模块（位于外部权威实验目录）。
CENTER_GATE_DIR = r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow"
if CENTER_GATE_DIR not in sys.path:
    sys.path.insert(0, CENTER_GATE_DIR)
import render_v14d_hysteresis_center_gate as center_gate  # noqa: E402


def cli_arguments() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def main() -> int:
    parser = argparse.ArgumentParser(description="V14D Face State/Blend 节点取证（只读）")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(cli_arguments())

    bpy.context.scene.frame_set(120)
    bpy.context.view_layer.update()

    material, users = center_gate.find_face_material()
    runtime_text, runtime_source = center_gate.find_runtime_text()
    runtime = center_gate.execute_runtime_text(runtime_source, runtime_text.name)
    # 0 度方位角应是 State 2, Blend 0（权威帧契约）。
    try:
        computed_state = int(round(float(runtime["hysteresis_state_from_azimuth"](0.0, None))))
    except Exception:
        computed_state = None

    key_nodes = {
        "state": center_gate.find_unique_node(
            material, "State01234", str(runtime.get("STATE_NODE_NAME", "") or ""), ("state01234",)
        ),
        "layerA": center_gate.find_unique_node(
            material, "LayerA", str(runtime.get("LAYER_A_NODE_NAME", "") or ""), ("layera",)
        ),
        "layerB": center_gate.find_unique_node(
            material, "LayerB", str(runtime.get("LAYER_B_NODE_NAME", "") or ""), ("layerb",)
        ),
        "blendWeight": center_gate.find_unique_node(
            material, "BlendWeight", str(runtime.get("BLEND_WEIGHT_NODE_NAME", "") or ""), ("blendweight",)
        ),
    }
    rec = {
        "frame": 120,
        "faceMaterial": material.name,
        "renderUsers": [o.name for o in users],
        "computedStateAtAzimuth0": computed_state,
        "keyNodes": {
            role: (center_gate.value_node_record(node) if node.type == "VALUE" else center_gate.node_record(node))
            for role, node in key_nodes.items()
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(center_gate.json_safe(rec), indent=2, ensure_ascii=False), encoding="utf-8")
    print("===G0-STATE-BLEND===", json.dumps({
        "state": rec["keyNodes"]["state"].get("value"),
        "blendWeight": rec["keyNodes"]["blendWeight"].get("value"),
        "computedState": computed_state,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
