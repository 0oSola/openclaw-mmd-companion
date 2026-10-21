"""Tests for the v13 procedural thinking-motion lifecycle."""
import math
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = PROJECT_ROOT / "imgToAction" / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import gen_elegant_thinking_generated_v13 as v13  # noqa: E402


def quaternion_angle(left, right):
    dot = abs(sum(a * b for a, b in zip(left, right)))
    return 2.0 * math.acos(max(-1.0, min(1.0, dot)))


class RightWristLifecycleTests(unittest.TestCase):
    @staticmethod
    def wrist_at(frame):
        return v13.make_right_wrist_rotation(
            frame,
            v13.DEFAULT_RIGHT_APPROACH_WRIST_EULER,
            v13.DEFAULT_RIGHT_ROUTE_1_WRIST_EULER,
            v13.DEFAULT_RIGHT_ROUTE_2_WRIST_EULER,
            v13.DEFAULT_RIGHT_ROUTE_3_WRIST_EULER,
            v13.DEFAULT_RIGHT_CORRIDOR_WRIST_EULER,
            v13.DEFAULT_RIGHT_PRECONTACT_WRIST_EULER,
            v13.DEFAULT_RIGHT_WRIST_EULER,
        )

    def test_approach_pose_is_reached_before_face_entry(self):
        actual = self.wrist_at(80)
        expected = v13.euler_quat(*v13.DEFAULT_RIGHT_APPROACH_WRIST_EULER)
        self.assertAlmostEqual(quaternion_angle(actual, expected), 0.0, places=7)

    def test_final_pose_is_reached_before_contact_lock(self):
        actual = self.wrist_at(150)
        expected = v13.euler_quat(*v13.DEFAULT_RIGHT_WRIST_EULER)
        self.assertAlmostEqual(quaternion_angle(actual, expected), 0.0, places=7)

    def test_rendered_safe_route_waypoints_are_exact(self):
        for frame, expected_euler in (
            (95, v13.DEFAULT_RIGHT_APPROACH_WRIST_EULER),
            (100, v13.DEFAULT_RIGHT_ROUTE_1_WRIST_EULER),
            (105, v13.DEFAULT_RIGHT_ROUTE_2_WRIST_EULER),
            (110, v13.DEFAULT_RIGHT_ROUTE_2_WRIST_EULER),
            (115, v13.DEFAULT_RIGHT_ROUTE_3_WRIST_EULER),
            (125, v13.DEFAULT_RIGHT_ROUTE_3_WRIST_EULER),
            (130, v13.DEFAULT_RIGHT_CORRIDOR_WRIST_EULER),
            (140, v13.DEFAULT_RIGHT_PRECONTACT_WRIST_EULER),
        ):
            actual = self.wrist_at(frame)
            expected = v13.euler_quat(*expected_euler)
            self.assertAlmostEqual(quaternion_angle(actual, expected), 0.0, places=7)

    def test_forearm_twist_matches_safe_route(self):
        for frame, expected_euler in (
            (95, v13.DEFAULT_RIGHT_ROUTE_TWIST_EULER),
            (105, v13.DEFAULT_RIGHT_ROUTE_TWIST_EULER),
            (110, v13.DEFAULT_RIGHT_ROUTE_TWIST_EULER),
            (115, v13.DEFAULT_RIGHT_ROUTE_TWIST_EULER),
            (130, v13.DEFAULT_RIGHT_ROUTE_TWIST_EULER),
            (140, v13.DEFAULT_RIGHT_TWIST_EULER),
            (150, v13.DEFAULT_RIGHT_TWIST_EULER),
        ):
            actual = v13.make_right_twist_rotation(
                frame,
                v13.DEFAULT_RIGHT_TWIST_EULER,
                v13.DEFAULT_RIGHT_ROUTE_TWIST_EULER,
            )
            expected = v13.euler_quat(*expected_euler)
            self.assertAlmostEqual(quaternion_angle(actual, expected), 0.0, places=7)


class RightHandLifecycleTests(unittest.TestCase):
    @staticmethod
    def rotation_at(frame, bone):
        return next(
            item.rotation
            for item in v13.make_hand_frames(
                frame,
                "chin_dual_support",
                v13.DEFAULT_RIGHT_HAND_OVERRIDES,
            )
            if item.bone == bone
        )

    def test_approach_reaches_compact_half_fist_before_face_entry(self):
        expected = v13.euler_quat(*v13.RIGHT_HAND_PROFILES["approach_compact"]["右人指１"])
        for frame in (82, 130):
            actual = self.rotation_at(frame, "右人指１")
            self.assertAlmostEqual(quaternion_angle(actual, expected), 0.0, places=7)

    def test_contact_frame_reaches_final_overridden_hand_shape(self):
        actual = self.rotation_at(150, "右薬指１")
        expected = v13.euler_quat(*v13.DEFAULT_RIGHT_HAND_OVERRIDES["右薬指１"])
        self.assertAlmostEqual(quaternion_angle(actual, expected), 0.0, places=7)


if __name__ == "__main__":
    unittest.main()
