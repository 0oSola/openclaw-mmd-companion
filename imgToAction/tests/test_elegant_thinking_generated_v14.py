"""Tests for the v14 overlapping-action timing."""
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


class ProfessionalTimingTests(unittest.TestCase):
    def test_waypoint_timelines_match(self):
        self.assertEqual(v14.FILTER_BONES, {"右手首", "右手捩"})
        self.assertEqual(v14.CONTOUR_TUCK_EULER, (0.0, 0.0, 5.0))

    def test_final_wrist_pose_is_unchanged(self):
        frames, _, _, _ = v14.generate("v14_test_final")
        actual = next(frame.rotation for frame in frames if frame.bone == "右手首" and frame.frame == 150)
        expected = v14.v13.euler_quat(*v14.v13.DEFAULT_RIGHT_WRIST_EULER)
        self.assertAlmostEqual(quaternion_angle(actual, expected), 0.0, places=7)

    def test_wrist_flip_is_underway_before_contact_lock(self):
        frames, _, _, _ = v14.generate("v14_test_mid")
        at_140 = next(frame.rotation for frame in frames if frame.bone == "右手首" and frame.frame == 140)
        approach = v14.v13.euler_quat(*v14.v13.DEFAULT_RIGHT_APPROACH_WRIST_EULER)
        self.assertGreater(quaternion_angle(at_140, approach), math.radians(40.0))


if __name__ == "__main__":
    unittest.main()
