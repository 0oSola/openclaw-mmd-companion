# IK Post-Processing Stages 3-6 — Implementation Complete

> Date: 2026-07-03
> Worktree: imgtoaction-front-depth-gates
> File: imgToAction/tools/fk_world_model.py

## Summary

All 4 remaining IK post-processing stages have been implemented, integrated into the `apply_fk_world_model_correction` pipeline, and tested.

## Stage 3: Joint Angle Limit Table

**Functions added:**
- `JOINT_ANGLE_LIMITS` — dict with min/max angle (degrees) for elbow, knee, shoulder abduction, shoulder twist, wrist flex/deviation, spine flex/bend, neck flex
- `BONE_MAX_ANGULAR_VELOCITY` — per-bone max angular velocity (rad/frame) for motion smoothing
- `compute_shoulder_abduction_angle()` — measures upper arm to torso angle
- `apply_joint_limits()` — clamps elbow angle and shoulder abduction to anatomically plausible ranges

**Integration:** Called after IK correction in `apply_fk_world_model_correction` frame loop.

**Key limits:**
- Elbow: 20°–175° (T-pose ~172°)
- Shoulder abduction: 0°–170° (arm overhead limit)
- Knee: 15°–175°

## Stage 4: Enhanced Motion Smoothing

**Functions added:**
- `apply_motion_smoothing_v2()` — two-pass smoothing: velocity limiting + acceleration (jerk) limiting
- Uses per-bone max angular velocity (torso=0.15 rad/frame, arm=0.25, elbow=0.35, fingers=0.40)
- Acceleration pass limits velocity ratio to max_acceleration_ratio=2.0

**Integration:** Replaces `apply_motion_smoothing()` in `apply_fk_world_model_correction`.

**Improvement over v1:** Per-bone velocity limits (v1 used uniform 0.3) + acceleration limiting prevents jerk.

## Stage 5: Priority Constraint System

**Functions added:**
- `CONSTRAINT_PRIORITY` — priority ordering dict
- `apply_priority_constraints()` — applies constraints in priority order:
  1. Collision avoidance (front depth + torso clearance) — highest
  2. Joint angle limits
  3. Target position (FABRIK IK to chin) — reverted if it violates collision
  4. Path constraint (wrist stays in front)
  5. Motion smoothness — lowest

**Key behavior:** If IK target position violates collision constraints, the IK result is reverted and collision correction is re-applied. This ensures safety constraints always win over reachability.

**Integration:** Called after joint limits in `apply_fk_world_model_correction` frame loop.

## Stage 6: Full-Body Kinematic Chain — Torso Lean Compensation

**Functions added:**
- `apply_torso_lean_compensation()` — when wrist target exceeds arm reach, iteratively leans 上半身 + 上半身2 forward to reduce shoulder-to-target distance

**Parameters:**
- max_lean_degrees: 10° (conservative)
- lean_step: 0.5° per iteration
- Only activates when target distance > 95% of max arm reach

**Integration:** Called at the start of each frame in `apply_fk_world_model_correction`, before arm IK. Modifies shoulder position and torso bone rotations.

## Pipeline Order (apply_fk_world_model_correction)

```
For each frame:
  1. Stage 6: Torso lean compensation (if target beyond reach)
  2. Stage 0-2 (existing): FK check → front-depth correction → forearm correction
  3. Stage 3: Joint angle limits (elbow + shoulder)
  4. Stage 5: Priority constraints (collision > joint > target > path)
  5. Rebuild bone frames

After all frames:
  6. Stage 4: Motion smoothing v2 (velocity + acceleration)
```

## Tests

New test file: `imgToAction/tests/test_fk_stages_3_6.py` — 12 tests:

**JointLimitTests (3):**
- `test_elbow_angle_below_min_is_clamped` — 340° X rotation → angle < 20° → clamped
- `test_elbow_angle_in_range_not_clamped` — normal 60° Z rotation → not clamped
- `test_shoulder_abduction_clamped_at_max` — combined Z+X rotation → abd > 170° → clamped

**MotionSmoothingV2Tests (3):**
- `test_velocity_limiting_reduces_jitter` — 2.0 rad jump → smoothed
- `test_small_changes_not_modified` — 0.05 rad change → not smoothed
- `test_per_bone_velocity_differs` — torso < elbow velocity limit

**PriorityConstraintTests (3):**
- `test_collision_avoidance_highest_priority` — -90° X → collision detected
- `test_target_position_applied_when_close` — reachable target → IK applied
- `test_constraint_priority_ordering` — priority constants correctly ordered

**TorsoLeanTests (3):**
- `test_no_lean_when_target_reachable` — close target → no lean
- `test_lean_applied_when_target_beyond_reach` — far target → lean applied
- `test_lean_does_not_exceed_max` — very far target → lean capped at max

## Test Results

```
39 passed, 1 failed (pre-existing, unrelated)
```

The 1 failure (`test_arm_chain_local_rotations_reconstruct_world_rotation`) is in `test_retarget_skeleton_to_vmd.py` and tests the retargeter's local-to-world rotation reconstruction — it predates our changes and is unrelated to Stages 3-6.

## Files Modified

- `imgToAction/tools/fk_world_model.py` — +400 lines (Stage 3-6 functions + integration)
- `imgToAction/tests/test_fk_stages_3_6.py` — new test file, 12 tests
