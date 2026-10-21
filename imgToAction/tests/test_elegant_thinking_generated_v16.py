"""Tests for the anatomically corrected right wrist in v16."""
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


def quaternion_angle(left, right):
    dot = abs(sum(a * b for a, b in zip(left, right)))
    return 2.0 * math.acos(max(-1.0, min(1.0, dot)))


class AnatomicalWristV16Tests(unittest.TestCase):
    def test_v16_reduces_wrist_bend_without_shortening_arm_reach(self):
        module_name = "gen_elegant_thinking_generated_v16"
        self.assertIsNotNone(importlib.util.find_spec(module_name))
        v16 = importlib.import_module(module_name)

        frames, manifest, out_path, _ = v16.generate()

        self.assertEqual(out_path.name, "eula_elegant_thinking_generated_v16.vmd")
        self.assertEqual(manifest["definition"]["right_hold_wrist_pmx"], [-1.35, 17.16, -3.2])
        self.assertEqual(manifest["definition"]["right_wrist_euler_deg"], [-14.0, -40.0, -38.0])
        self.assertEqual(manifest["definition"]["right_twist_euler_deg"], [25.0, 0.0, 0.0])
        self.assertEqual(manifest["definition"]["right_hand_overrides"]["右親指０"], [0.0, 28.0, -50.0])
        self.assertEqual(manifest["definition"]["right_hand_overrides"]["右中指１"], [-128.0, 0.0, 0.0])
        self.assertEqual(manifest["definition"]["right_hand_overrides"]["右薬指１"], [-180.0, 5.0, 0.0])
        self.assertEqual(manifest["definition"]["right_hand_overrides"]["右小指１"], [-125.0, -40.0, -65.0])
        self.assertEqual(manifest["definition"]["neck_euler_deg"], [-14.0, -2.0, -0.35])
        self.assertEqual(manifest["definition"]["head_euler_deg"], [-14.0, 5.0, -1.0])
        self.assertEqual(manifest["definition"]["left_hold_wrist_pmx"], [2.52, 13.46, -0.97])
        self.assertEqual(manifest["anatomical_wrist_correction"]["target_wrist_bend_max_deg"], 55.0)

        wrist = next(frame.rotation for frame in frames if frame.bone == "右手首" and frame.frame == 240)
        twist = next(frame.rotation for frame in frames if frame.bone == "右手捩" and frame.frame == 240)
        expected_wrist = v16.v15.v14.v13.euler_quat(-14.0, -40.0, -38.0)
        expected_twist = v16.v15.v14.v13.euler_quat(25.0, 0.0, 0.0)
        self.assertAlmostEqual(quaternion_angle(wrist, expected_wrist), 0.0, places=7)
        self.assertAlmostEqual(quaternion_angle(twist, expected_twist), 0.0, places=7)


if __name__ == "__main__":
    unittest.main()
