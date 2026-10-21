"""Tests for the Blender-calibrated left akimbo correction."""
import importlib
import importlib.util
import math
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = PROJECT_ROOT / "imgToAction" / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import gen_elegant_thinking_generated_v14 as v14  # noqa: E402


def quaternion_angle(left, right):
    dot = abs(sum(a * b for a, b in zip(left, right)))
    return 2.0 * math.acos(max(-1.0, min(1.0, dot)))


class LeftArmConfigurationTests(unittest.TestCase):
    def test_v14_accepts_explicit_left_arm_configuration(self):
        frames, manifest, _, _ = v14.generate(
            output_name="v15_left_override_test",
            left_wrist=[2.50, 13.46, -0.97],
            left_wrist_euler=(-2.0, 6.0, 0.0),
        )

        self.assertEqual(manifest["definition"]["left_hold_wrist_pmx"], [2.50, 13.46, -0.97])
        self.assertEqual(manifest["definition"]["left_wrist_euler_deg"], [-2.0, 6.0, 0.0])
        actual = next(frame.rotation for frame in frames if frame.bone == "左手首" and frame.frame == 240)
        expected = v14.v13.euler_quat(-2.0, 6.0, 0.0)
        self.assertAlmostEqual(quaternion_angle(actual, expected), 0.0, places=7)
        self.assertGreater(manifest["metrics"][-1]["left_wrist_fk"][0], 2.4)

    def test_v14_default_left_arm_configuration_is_unchanged(self):
        _, manifest, _, _ = v14.generate(output_name="v14_left_default_test")

        self.assertEqual(manifest["definition"]["left_hold_wrist_pmx"], [2.28, 13.46, -0.97])
        self.assertEqual(manifest["definition"]["left_wrist_euler_deg"], [-2.0, 6.0, -90.0])


class BlenderCalibratedV15Tests(unittest.TestCase):
    def test_v15_uses_mesh_clear_left_akimbo_configuration(self):
        module_name = "gen_elegant_thinking_generated_v15"
        self.assertIsNotNone(importlib.util.find_spec(module_name))
        v15 = importlib.import_module(module_name)

        frames, manifest, out_path, _ = v15.generate()

        self.assertEqual(out_path.name, "eula_elegant_thinking_generated_v15.vmd")
        self.assertEqual(manifest["definition"]["left_hold_wrist_pmx"], [2.52, 13.46, -0.97])
        self.assertEqual(manifest["definition"]["left_wrist_euler_deg"], [-2.0, 6.0, 0.0])
        self.assertEqual(manifest["blender_mesh_calibration"]["stable_left_hand_torso_overlaps"], 0)
        self.assertEqual(manifest["blender_mesh_calibration"]["all_frame_full_body_overlaps"], 0)
        self.assertAlmostEqual(manifest["blender_mesh_calibration"]["stable_clearance_pmx"], 0.014774, places=6)
        actual = next(frame.rotation for frame in frames if frame.bone == "左手首" and frame.frame == 240)
        expected = v15.v14.v13.euler_quat(-2.0, 6.0, 0.0)
        self.assertAlmostEqual(quaternion_angle(actual, expected), 0.0, places=7)


if __name__ == "__main__":
    unittest.main()
