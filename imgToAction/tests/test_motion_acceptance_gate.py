"""Regression tests for the programmatic motion acceptance gate."""
import importlib.util
import math
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "motion_acceptance_gate.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("motion_acceptance_gate", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class QuaternionAngleTests(unittest.TestCase):
    def setUp(self):
        self.tool = load_tool()

    def test_identity_quaternions_have_zero_distance(self):
        identity = [0.0, 0.0, 0.0, 1.0]
        self.assertAlmostEqual(self.tool.quaternion_angle(identity, identity), 0.0, places=8)

    def test_opposite_quaternion_signs_are_same_rotation(self):
        q = [0.2, -0.3, 0.1, 0.9]
        negated = [-value for value in q]
        self.assertAlmostEqual(self.tool.quaternion_angle(q, negated), 0.0, places=8)

    def test_small_axis_rotation_returns_expected_angle(self):
        angle = 0.125
        rotated = [math.sin(angle / 2.0), 0.0, 0.0, math.cos(angle / 2.0)]
        identity = [0.0, 0.0, 0.0, 1.0]
        self.assertAlmostEqual(self.tool.quaternion_angle(identity, rotated), angle, places=8)


class LeftAkimboGateTests(unittest.TestCase):
    def setUp(self):
        self.tool = load_tool()

    @staticmethod
    def _frame(hand_points):
        joints = {
            "left_shoulder": [0.2484, 17.5602, -0.3612],
            "left_elbow": [3.7787, 15.5480, -0.3604],
            "left_wrist": [2.4453, 13.4747, -1.1178],
        }
        joints.update(hand_points)
        return {"index": 160, "joints": joints}

    def test_side_down_akimbo_contour_passes(self):
        frame = self._frame({
            "left_thumb_0": [2.0534, 13.3067, -1.4651],
            "left_index_2": [1.7567, 12.3994, -1.6706],
            "left_index_tip": [1.9927, 11.9250, -1.7002],
            "left_middle_tip": [2.0987, 11.6844, -1.5505],
            "left_ring_tip": [2.1271, 11.6503, -1.3596],
            "left_pinky_3": [2.0360, 12.1013, -0.9673],
        })

        result = self.tool.g7_left_arm([frame], left_arm_policy="akimbo")

        self.assertEqual(result.status, "PASS")
        self.assertEqual(result.details["observed_modes"][0]["mode"], "side_down")

    def test_cross_waist_contour_is_rejected_for_eula_mesh(self):
        frame = self._frame({
            "left_thumb_0": [1.8971, 13.9158, -1.1576],
            "left_index_1": [1.3429, 14.1259, -0.9250],
            "left_middle_tip": [0.5549, 13.6410, -0.2833],
            "left_ring_tip": [0.6425, 13.5577, -0.1290],
            "left_pinky_3": [1.2421, 13.6105, -0.0719],
        })

        result = self.tool.g7_left_arm([frame], left_arm_policy="akimbo")

        self.assertEqual(result.status, "FAIL")
        issues = {item["issue"] for item in result.details["violations"]}
        self.assertIn("left_akimbo_hand_contour_not_mesh_safe", issues)


class WristPalmAnatomyGateTests(unittest.TestCase):
    def setUp(self):
        self.tool = load_tool()

    @staticmethod
    def _frame(wrist_bend_degrees):
        radians = math.radians(wrist_bend_degrees)
        return {
            "index": 160,
            "joints": {
                "right_elbow": [0.0, 0.0, 0.0],
                "right_wrist": [1.0, 0.0, 0.0],
                "right_index_1": [1.0, 1.0, 0.0],
                "right_middle_1": [1.0 + math.cos(radians), math.sin(radians), 0.0],
                "right_pinky_1": [1.0, 0.0, 1.0],
                "chin": [2.0, 0.0, 0.0],
            },
        }

    def test_thinking_wrist_bend_above_55_degrees_is_rejected(self):
        result = self.tool.g17_wrist_palm_anatomy([self._frame(60.0)])

        self.assertEqual(result.status, "FAIL")
        self.assertEqual(result.details["wrist_bend_limit"], 55.0)
        issues = {item["issue"] for item in result.details["violations"]}
        self.assertIn("wrist_overbent", issues)

    def test_thinking_wrist_bend_below_55_degrees_passes(self):
        result = self.tool.g17_wrist_palm_anatomy([self._frame(52.0)])

        self.assertEqual(result.status, "PASS")


if __name__ == "__main__":
    unittest.main()
