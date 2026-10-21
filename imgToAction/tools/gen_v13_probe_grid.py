#!/usr/bin/env python3
from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path
import sys

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import gen_elegant_thinking_generated_v13 as v13  # noqa: E402
from vmd_io import write_vmd  # noqa: E402


def parse_float_list(value: str) -> list[float]:
    values = [float(item.strip()) for item in value.split(",") if item.strip()]
    if not values:
        raise argparse.ArgumentTypeError("expected at least one number")
    return values


def parse_str_list(value: str) -> list[str]:
    values = [item.strip() for item in value.split(",") if item.strip()]
    if not values:
        raise argparse.ArgumentTypeError("expected at least one value")
    return values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", default="v13_probe")
    parser.add_argument("--manifest", type=Path, default=Path("imgToAction/outputs/vmd/v13_probe_grid.json"))
    parser.add_argument("--wrist-x", type=parse_float_list, default=[v13.DEFAULT_RIGHT_WRIST[0]])
    parser.add_argument("--wrist-y", type=parse_float_list, default=[v13.DEFAULT_RIGHT_WRIST[1]])
    parser.add_argument("--wrist-z", type=parse_float_list, default=[v13.DEFAULT_RIGHT_WRIST[2]])
    parser.add_argument("--elbow-x", type=parse_float_list, default=[v13.DEFAULT_RIGHT_ELBOW[0]])
    parser.add_argument("--elbow-y", type=parse_float_list, default=[v13.DEFAULT_RIGHT_ELBOW[1]])
    parser.add_argument("--elbow-z", type=parse_float_list, default=[v13.DEFAULT_RIGHT_ELBOW[2]])
    parser.add_argument("--wrist-euler-x", type=parse_float_list, default=[v13.DEFAULT_RIGHT_WRIST_EULER[0]])
    parser.add_argument("--wrist-euler-y", type=parse_float_list, default=[v13.DEFAULT_RIGHT_WRIST_EULER[1]])
    parser.add_argument("--wrist-euler-z", type=parse_float_list, default=[v13.DEFAULT_RIGHT_WRIST_EULER[2]])
    parser.add_argument("--twist-x", type=parse_float_list, default=[v13.DEFAULT_RIGHT_TWIST_EULER[0]])
    parser.add_argument("--twist-y", type=parse_float_list, default=[v13.DEFAULT_RIGHT_TWIST_EULER[1]])
    parser.add_argument("--twist-z", type=parse_float_list, default=[v13.DEFAULT_RIGHT_TWIST_EULER[2]])
    parser.add_argument("--profiles", type=parse_str_list, default=["chin_dual_support"])
    parser.add_argument("--thumb0-x", type=parse_float_list)
    parser.add_argument("--thumb0-y", type=parse_float_list)
    parser.add_argument("--thumb0-z", type=parse_float_list)
    parser.add_argument("--thumb1-x", type=parse_float_list)
    parser.add_argument("--thumb1-y", type=parse_float_list)
    parser.add_argument("--thumb1-z", type=parse_float_list)
    parser.add_argument("--thumb2-x", type=parse_float_list)
    parser.add_argument("--thumb2-y", type=parse_float_list)
    parser.add_argument("--thumb2-z", type=parse_float_list)
    parser.add_argument("--middle1-x", type=parse_float_list)
    parser.add_argument("--ring1-x", type=parse_float_list)
    parser.add_argument("--pinky1-x", type=parse_float_list)
    parser.add_argument("--pinky1-y", type=parse_float_list)
    parser.add_argument("--pinky1-z", type=parse_float_list)
    parser.add_argument("--neck-x", type=parse_float_list, default=[v13.DEFAULT_NECK_EULER[0]])
    parser.add_argument("--neck-y", type=parse_float_list, default=[v13.DEFAULT_NECK_EULER[1]])
    parser.add_argument("--neck-z", type=parse_float_list, default=[v13.DEFAULT_NECK_EULER[2]])
    parser.add_argument("--head-x", type=parse_float_list, default=[v13.DEFAULT_HEAD_EULER[0]])
    parser.add_argument("--head-y", type=parse_float_list, default=[v13.DEFAULT_HEAD_EULER[1]])
    parser.add_argument("--head-z", type=parse_float_list, default=[v13.DEFAULT_HEAD_EULER[2]])
    args = parser.parse_args()

    combinations = itertools.product(
        args.wrist_x,
        args.wrist_y,
        args.wrist_z,
        args.elbow_x,
        args.elbow_y,
        args.elbow_z,
        args.wrist_euler_x,
        args.wrist_euler_y,
        args.wrist_euler_z,
        args.twist_x,
        args.twist_y,
        args.twist_z,
        args.profiles,
        args.thumb0_x or [None],
        args.thumb0_y or [None],
        args.thumb0_z or [None],
        args.thumb1_x or [None],
        args.thumb1_y or [None],
        args.thumb1_z or [None],
        args.thumb2_x or [None],
        args.thumb2_y or [None],
        args.thumb2_z or [None],
        args.middle1_x or [None],
        args.ring1_x or [None],
        args.pinky1_x or [None],
        args.pinky1_y or [None],
        args.pinky1_z or [None],
        args.neck_x,
        args.neck_y,
        args.neck_z,
        args.head_x,
        args.head_y,
        args.head_z,
    )
    candidates = []
    for index, values in enumerate(combinations):
        (
            wrist_x,
            wrist_y,
            wrist_z,
            elbow_x,
            elbow_y,
            elbow_z,
            wrist_euler_x,
            wrist_euler_y,
            wrist_euler_z,
            twist_x,
            twist_y,
            twist_z,
            profile,
            thumb0_x,
            thumb0_y,
            thumb0_z,
            thumb1_x,
            thumb1_y,
            thumb1_z,
            thumb2_x,
            thumb2_y,
            thumb2_z,
            middle1_x,
            ring1_x,
            pinky1_x,
            pinky1_y,
            pinky1_z,
            neck_x,
            neck_y,
            neck_z,
            head_x,
            head_y,
            head_z,
        ) = values
        final_profile = v13.RIGHT_HAND_PROFILES[profile]
        effective_profile = dict(final_profile)
        effective_profile.update(v13.DEFAULT_RIGHT_HAND_OVERRIDES)

        def override(bone: str, x, y, z):
            base = effective_profile[bone]
            return tuple(base[index] if value is None else value for index, value in enumerate((x, y, z)))

        right_hand_overrides = {
            "右親指０": override("右親指０", thumb0_x, thumb0_y, thumb0_z),
            "右親指１": override("右親指１", thumb1_x, thumb1_y, thumb1_z),
            "右親指２": override("右親指２", thumb2_x, thumb2_y, thumb2_z),
            "右中指１": override("右中指１", middle1_x, None, None),
            "右薬指１": override("右薬指１", ring1_x, None, None),
            "右小指１": override("右小指１", pinky1_x, pinky1_y, pinky1_z),
        }
        right_hand_overrides = {
            bone: degrees
            for bone, degrees in right_hand_overrides.items()
            if degrees != final_profile[bone]
        }
        name = f"{args.prefix}_{index:04d}"
        frames, manifest, out_path, manifest_path = v13.generate(
            output_name=name,
            right_wrist=[wrist_x, wrist_y, wrist_z],
            right_elbow=[elbow_x, elbow_y, elbow_z],
            right_wrist_euler=(wrist_euler_x, wrist_euler_y, wrist_euler_z),
            right_approach_wrist_euler=(wrist_euler_x, wrist_euler_y, wrist_euler_z),
            right_route_1_wrist_euler=(wrist_euler_x, wrist_euler_y, wrist_euler_z),
            right_route_2_wrist_euler=(wrist_euler_x, wrist_euler_y, wrist_euler_z),
            right_route_3_wrist_euler=(wrist_euler_x, wrist_euler_y, wrist_euler_z),
            right_corridor_wrist_euler=(wrist_euler_x, wrist_euler_y, wrist_euler_z),
            right_precontact_wrist_euler=(wrist_euler_x, wrist_euler_y, wrist_euler_z),
            right_twist_euler=(twist_x, twist_y, twist_z),
            right_route_twist_euler=(twist_x, twist_y, twist_z),
            right_hand_profile=profile,
            right_hand_overrides=right_hand_overrides,
            neck_euler=(neck_x, neck_y, neck_z),
            head_euler=(head_x, head_y, head_z),
        )
        write_vmd(out_path, frames, model_name="Eula")
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        candidates.append(
            {
                "name": name,
                "vmd": str(out_path),
                "manifest": str(manifest_path),
                "right_wrist": [wrist_x, wrist_y, wrist_z],
                "right_elbow": [elbow_x, elbow_y, elbow_z],
                "right_wrist_euler": [wrist_euler_x, wrist_euler_y, wrist_euler_z],
                "right_twist_euler": [twist_x, twist_y, twist_z],
                "right_hand_profile": profile,
                "right_hand_overrides": {bone: list(degrees) for bone, degrees in right_hand_overrides.items()},
                "neck_euler": [neck_x, neck_y, neck_z],
                "head_euler": [head_x, head_y, head_z],
            }
        )

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps({"frame": 160, "candidates": candidates}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(candidates)} probe VMDs")
    print(f"Wrote probe manifest to {args.manifest}")


if __name__ == "__main__":
    main()
