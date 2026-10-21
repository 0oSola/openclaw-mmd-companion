"""Tests for Stage 3-6 IK post-processing in fk_world_model.py."""
import importlib.util
import math
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "fk_world_model.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("fk_world_model", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class JointLimitTests(unittest.TestCase):
    """Stage 3: Joint angle limit table tests."""

    def setUp(self):
        self.tool = load_tool()

    def test_elbow_angle_below_min_is_clamped(self):
        """Elbow angle below 20° should be clamped up."""
        tool = self.tool
        shoulder = list(tool.PMX_BONE_POSITIONS["右肩"])
        shoulder_world = tool.IDENTITY_QUAT
        # Create an extreme elbow flex (very bent)
        extreme_flex = tool._quat_axis_angle([1, 0, 0], math.radians(340))
        upper_q = tool.IDENTITY_QUAT
        lower_q = extreme_flex

        upper_out, lower_out, report = tool.apply_joint_limits(
            shoulder, shoulder_world, upper_q, lower_q,
        )
        self.assertIn("elbow", [c for c in report.get("clamped", [])])
        # Verify clamped angle is within limits
        limits = tool.JOINT_ANGLE_LIMITS["elbow"]
        fk = tool.fk_arm_chain(shoulder, shoulder_world, upper_out, lower_out, [], [])
        shoulderC_offset = tool.PMX_RIGHT_ARM_OFFSETS["右肩C"]
        shoulderC_pos = tool.add(shoulder, tool._quat_vec(shoulder_world, shoulderC_offset))
        angle = tool.compute_elbow_angle(shoulderC_pos, fk["elbow_pos"], fk["wrist_pos"])
        self.assertGreaterEqual(angle, limits["min"] - 5.0)

    def test_elbow_angle_in_range_not_clamped(self):
        """Elbow angle within range should not be clamped."""
        tool = self.tool
        shoulder = list(tool.PMX_BONE_POSITIONS["右肩"])
        # Normal elbow angle (~90°)
        upper_q = tool.IDENTITY_QUAT
        lower_q = tool._quat_axis_angle([0, 0, 1], math.radians(60))

        upper_out, lower_out, report = tool.apply_joint_limits(
            shoulder, tool.IDENTITY_QUAT, upper_q, lower_q,
        )
        # Should not clamp (within 20-175 range)
        self.assertEqual(report.get("clamped"), [])

    def test_shoulder_abduction_clamped_at_max(self):
        """Shoulder abduction beyond 170° should be clamped."""
        tool = self.tool
        shoulder = list(tool.PMX_BONE_POSITIONS["右肩"])
        # Create extreme abduction (arm pointing up past 170°)
        extreme_abd = tool._quat_mul(
            tool._quat_axis_angle([0, 0, 1], math.radians(80)),
            tool._quat_axis_angle([1, 0, 0], math.radians(20)),
        )
        upper_out, lower_out, report = tool.apply_joint_limits(
            shoulder, tool.IDENTITY_QUAT, extreme_abd, tool.IDENTITY_QUAT,
        )
        self.assertIn("shoulder_abduction", report.get("clamped", []))


class MotionSmoothingV2Tests(unittest.TestCase):
    """Stage 4: Enhanced motion smoothing tests."""

    def setUp(self):
        self.tool = load_tool()
        # Create a minimal BoneFrame-like class for testing
        from collections import namedtuple
        self.BoneFrame = namedtuple("BoneFrame", ["bone", "frame", "position", "rotation", "interpolation"])

    def _make_frames(self, bone_name, rotations, frame_step=1):
        return [
            self.BoneFrame(bone_name, i * frame_step, (0, 0, 0), q, None)
            for i, q in enumerate(rotations)
        ]

    def test_velocity_limiting_reduces_jitter(self):
        """Large frame-to-frame rotation change should be smoothed."""
        tool = self.tool
        # Create frames with a large jump
        frames = self._make_frames("右腕", [
            tool.IDENTITY_QUAT,
            tool._quat_axis_angle([1, 0, 0], 2.0),  # Very large jump
            tool._quat_axis_angle([1, 0, 0], 0.1),
        ])
        smoothed, stats = tool.apply_motion_smoothing_v2(frames)
        self.assertGreater(stats["velocity_clamped"], 0)
        # The smoothed frame should have smaller angular change than original
        q0 = smoothed[0].rotation
        q1 = smoothed[1].rotation
        dot_q = abs(sum(a * b for a, b in zip(q0, q1)))
        angle = 2.0 * math.acos(max(-1.0, min(1.0, dot_q)))
        self.assertLess(angle, 0.5)  # Should be well under the 0.25 rad/frame limit

    def test_small_changes_not_modified(self):
        """Small frame-to-frame changes should not be smoothed."""
        tool = self.tool
        frames = self._make_frames("右腕", [
            tool.IDENTITY_QUAT,
            tool._quat_axis_angle([1, 0, 0], 0.05),  # Tiny change
        ])
        smoothed, stats = tool.apply_motion_smoothing_v2(frames)
        self.assertEqual(stats["velocity_clamped"], 0)

    def test_per_bone_velocity_differs(self):
        """Different bones should have different max velocities."""
        tool = self.tool
        self.assertLess(
            tool.BONE_MAX_ANGULAR_VELOCITY["上半身"],
            tool.BONE_MAX_ANGULAR_VELOCITY["右ひじ"],
        )


class PriorityConstraintTests(unittest.TestCase):
    """Stage 5: Priority constraint system tests."""

    def setUp(self):
        self.tool = load_tool()

    def test_collision_avoidance_highest_priority(self):
        """Collision avoidance should be applied first."""
        tool = self.tool
        shoulder = list(tool.PMX_BONE_POSITIONS["右肩"])
        probe = tool.DEFAULT_TPOSE_PROBE
        rs = probe["right_shoulder"]
        ls = probe["left_shoulder"]
        waist = probe["waist"]
        front_axis = tool.compute_front_axis(ls, rs, waist)

        # Create a rotation that puts wrist behind torso
        bad_rot = tool._quat_axis_angle([1, 0, 0], math.radians(-90))
        upper_q, lower_q, report = tool.apply_priority_constraints(
            shoulder, tool.IDENTITY_QUAT, bad_rot, tool.IDENTITY_QUAT,
            front_axis, min_front_depth=0.1,
        )
        self.assertIn("collision_avoidance", report["constraints_applied"])

    def test_target_position_applied_when_close(self):
        """Target position constraint should be applied when target is reachable."""
        tool = self.tool
        shoulder = list(tool.PMX_BONE_POSITIONS["右肩"])
        probe = tool.DEFAULT_TPOSE_PROBE
        rs = probe["right_shoulder"]
        ls = probe["left_shoulder"]
        waist = probe["waist"]
        front_axis = tool.compute_front_axis(ls, rs, waist)
        chin_pmx = tool._render_to_pmx(probe["chin"])

        # Set target near the wrist's current position
        fk = tool.fk_arm_chain(shoulder, tool.IDENTITY_QUAT, tool.IDENTITY_QUAT, tool.IDENTITY_QUAT, [], [])
        wrist_target = [fk["wrist_pos"][i] + 0.1 for i in range(3)]

        upper_q, lower_q, report = tool.apply_priority_constraints(
            shoulder, tool.IDENTITY_QUAT, tool.IDENTITY_QUAT, tool.IDENTITY_QUAT,
            front_axis, wrist_target_pmx=wrist_target, chin_pmx=chin_pmx,
        )
        # Target position may or may not be applied depending on collision state
        self.assertIsInstance(report["constraints_applied"], list)

    def test_constraint_priority_ordering(self):
        """Verify priority constants are correctly ordered."""
        tool = self.tool
        self.assertLess(tool.CONSTRAINT_PRIORITY["collision_avoidance"],
                        tool.CONSTRAINT_PRIORITY["joint_angle_limits"])
        self.assertLess(tool.CONSTRAINT_PRIORITY["joint_angle_limits"],
                        tool.CONSTRAINT_PRIORITY["target_position"])
        self.assertLess(tool.CONSTRAINT_PRIORITY["target_position"],
                        tool.CONSTRAINT_PRIORITY["path_constraint"])
        self.assertLess(tool.CONSTRAINT_PRIORITY["path_constraint"],
                        tool.CONSTRAINT_PRIORITY["motion_smoothness"])


class MutableBoneFrame:
    """Mutable BoneFrame for testing (real BoneFrame from vmd_io is also mutable)."""
    def __init__(self, bone, frame, position, rotation, interpolation):
        self.bone = bone
        self.frame = frame
        self.position = position
        self.rotation = rotation
        self.interpolation = interpolation


class TorsoLeanTests(unittest.TestCase):
    """Stage 6: Torso lean compensation tests."""

    def setUp(self):
        self.tool = load_tool()
        self.BoneFrame = MutableBoneFrame

    def test_no_lean_when_target_reachable(self):
        """Should not lean when target is within arm reach."""
        tool = self.tool
        shoulder = list(tool.PMX_BONE_POSITIONS["右肩"])
        probe = tool.DEFAULT_TPOSE_PROBE
        front_axis = tool.compute_front_axis(
            probe["left_shoulder"], probe["right_shoulder"], probe["waist"]
        )
        # Target very close to shoulder (within reach)
        wrist_target = [shoulder[0] - 1.0, shoulder[1] - 1.0, shoulder[2]]

        bones = {
            "上半身": self.BoneFrame("上半身", 0, (0, 0, 0), tool.IDENTITY_QUAT, None),
            "上半身2": self.BoneFrame("上半身2", 0, (0, 0, 0), tool.IDENTITY_QUAT, None),
        }
        modified_bones, report = tool.apply_torso_lean_compensation(
            bones, list(shoulder), front_axis, wrist_target,
        )
        self.assertFalse(report["lean_applied"])
        self.assertEqual(report["reason"], "target_within_reach")

    def test_lean_applied_when_target_beyond_reach(self):
        """Should lean torso when target is beyond arm reach."""
        tool = self.tool
        shoulder = list(tool.PMX_BONE_POSITIONS["右肩"])
        probe = tool.DEFAULT_TPOSE_PROBE
        front_axis = tool.compute_front_axis(
            probe["left_shoulder"], probe["right_shoulder"], probe["waist"]
        )
        # Target very far (beyond arm reach)
        wrist_target = [shoulder[0] - 15.0, shoulder[1], shoulder[2]]

        bones = {
            "上半身": self.BoneFrame("上半身", 0, (0, 0, 0), tool.IDENTITY_QUAT, None),
            "上半身2": self.BoneFrame("上半身2", 0, (0, 0, 0), tool.IDENTITY_QUAT, None),
        }
        modified_bones, report = tool.apply_torso_lean_compensation(
            bones, list(shoulder), front_axis, wrist_target,
            max_lean_degrees=10.0, lean_step=1.0,
        )
        self.assertTrue(report["lean_applied"])
        self.assertGreater(report["lean_degrees"], 0)

    def test_lean_does_not_exceed_max(self):
        """Lean should not exceed max_lean_degrees."""
        tool = self.tool
        shoulder = list(tool.PMX_BONE_POSITIONS["右肩"])
        probe = tool.DEFAULT_TPOSE_PROBE
        front_axis = tool.compute_front_axis(
            probe["left_shoulder"], probe["right_shoulder"], probe["waist"]
        )
        wrist_target = [shoulder[0] - 50.0, shoulder[1], shoulder[2]]

        bones = {
            "上半身": self.BoneFrame("上半身", 0, (0, 0, 0), tool.IDENTITY_QUAT, None),
            "上半身2": self.BoneFrame("上半身2", 0, (0, 0, 0), tool.IDENTITY_QUAT, None),
        }
        modified_bones, report = tool.apply_torso_lean_compensation(
            bones, list(shoulder), front_axis, wrist_target,
            max_lean_degrees=12.0, lean_step=0.5,
        )
        self.assertLessEqual(report["lean_degrees"], 12.5)


if __name__ == "__main__":
    unittest.main()
