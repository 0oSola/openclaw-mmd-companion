# MMD PMX Bone Calibration & World Coordinate Guide

> Generated: 2026-07-03
> Model: MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx
> Data source: T-pose probe (`tmp/tpose_probe/render_metrics.json`) + basic motion tests (262 VMDs, 1168 screenshots)

---

## 1. World Coordinate System

World coordinate system after PMX model rendering:

| Axis | Direction | Positive meaning |
|---|---|---|
| X | Left-Right | Positive = left side |
| Y | Up-Down | Positive = up |
| Z | Front-Back | Positive = forward |

**Front axis direction**: `(0, 0.14, 0.99)`

Nearly pure Z-positive, but with a 14° tilt on Y. The model's "forward" is not purely +Z — retargeter and IK post-processing must project onto this front axis rather than reading Z directly.

**PMX model space vs render world space**: Model space has scale=0.9 and Z-axis flip. The FK model in `fk_world_model.py` handles this transform.

---

## 2. T-pose Full Joint World Coordinates

| Bone | PMX Name | X | Y | Z | Description |
|---|---|---|---|---|---|
| Right wrist | 右手首 | -5.233 | 2.741 | 0.667 | Wrist end |
| Left wrist | 左手首 | 5.233 | 2.741 | 0.667 | Wrist end |
| Right shoulder | 右肩 | -0.247 | 6.038 | 0.900 | Scapula |
| Left shoulder | 左肩 | 0.247 | 6.038 | 0.900 | Scapula |
| Right elbow | 右ひじ | -3.365 | 4.117 | 0.587 | Elbow |
| Left elbow | 左ひじ | 3.365 | 4.117 | 0.587 | Elbow |
| Right hip | 右足 | -0.973 | 1.496 | 1.110 | Hip |
| Left hip | 左足 | 0.973 | 1.496 | 1.110 | Hip |
| Right knee | 右ひざ | -0.840 | -3.220 | 1.202 | Knee |
| Left knee | 左ひざ | 0.840 | -3.219 | 1.244 | Knee |
| Right ankle | 右足首 | -0.682 | -8.138 | 0.590 | Ankle |
| Left ankle | 左足首 | 0.682 | -8.131 | 0.590 | Ankle |
| Lower body | 下半身 | 0.000 | 2.448 | 1.408 | Waist |
| Center | センター | 0.000 | -1.178 | 0.696 | Model center |
| Chin | 頭 | 0.000 | 6.853 | 1.143 | Chin (head with offset) |

> Chin position sampled from head bone with localOffset=[0, -0.42, 0.18].

---

## 3. Bone Segment Lengths (World Units)

| Segment | Length | Calculation |
|---|---|---|
| Upper arm | 3.676 | Right shoulder -> right elbow distance |
| Forearm | 2.321 | Right elbow -> right wrist distance |
| Full arm | 5.997 | Upper arm + forearm |
| Thigh | ~4.697 | Right hip -> right knee distance |
| Shin | ~4.918 | Right knee -> right ankle distance |

Left-right symmetric (difference <0.005 world units).

---

## 4. T-pose Front Depth

Front depth = joint projection onto the front axis `(0, 0.14, 0.99)`.

| Body part | Front depth | Meaning |
|---|---|---|
| Right wrist | -0.693 | 0.69 units behind torso |
| Right elbow | -0.579 | 0.58 units behind torso |
| Right forearm mid | -0.636 | 0.64 units behind torso |

**Key conclusion**: In T-pose, the arms are slightly behind the torso plane (negative front depth). This is the root cause of the "wrist penetrating body" problem after BVH->PMX retargeting. IK post-processing targets correcting front depth from negative to positive (+0.6 or above).

---

## 5. T-pose Joint Angles

| Joint | Angle | Status |
|---|---|---|
| Right elbow | 171.67° | Slightly bent (not fully straight at 180°) |
| Left elbow | 171.66° | Slightly bent |
| Right knee | 171.79° | Slightly bent |
| Left knee | 170.80° | Slightly bent |
| Right shoulder-arm | 59.63° | Upper arm to torso angle |
| Left shoulder-arm | 59.63° | Symmetric |

---

## 6. Body Clearance Distances (World Units)

| Body part | Distance to torso core | Note |
|---|---|---|
| Right upper arm | 0.247 | Very close to torso |
| Right elbow | 3.415 | Safe |
| Right wrist | 5.278 | Safe |
| Left upper arm | 0.247 | Very close to torso |
| Left elbow | 3.415 | Symmetric |
| Left wrist | 5.278 | Symmetric |

**Note**: Upper arm clearance is only 0.247 — the arm is flush against the body side in T-pose. IK must avoid pushing the upper arm into the torso.

---

## 7. Stance Data

| Metric | Value |
|---|---|
| Right ankle world pos | (-0.682, -8.138, 0.590) |
| Left ankle world pos | (0.682, -8.131, 0.590) |
| Ankle span | 1.363 world units |
| Ankle midpoint | (0.000, -8.135, 0.590) |

Left-right ankle Y difference is 0.007 — essentially level. Model center at X=0.

---

## 8. Camera Parameters

Camera configuration used for T-pose probe (keep consistent for subsequent renders):

| Parameter | Value |
|---|---|
| FOV | 33° |
| Position | (-2.075, 0.017, 46.985) |
| Target | (-2.075, -2.772, 0.642) |
| Distance | ~46.4 |
| Locked | Yes |

Four-angle render azimuth offsets:
- front: 0°
- right: -90° (camera moves to right side)
- back: 180°
- left: +90° (camera moves to left side)

---

## 9. Calibrated Joints Overview

### 9.1 Main Bones (17 bones, 102 tests x 4 angles = 408 renders)

| Body part | Bone | Valid axes | Key finding |
|---|---|---|---|
| Right arm | 右腕 | -X, +Y(weak), -Y, +Z, -Z | +X invalid (forward raise needs -X or 90°+X) |
| Right elbow | 右ひじ | All 6 axes | +Z produces max bend |
| Right shoulder | 右肩 | -X, -Y, +Z, -Z | +X/+Y invalid |
| Left arm | 左腕 | -X, +Y, -Y(weak), +Z, -Z | +X invalid, Z mirrors right hand |
| Left elbow | 左ひじ | All 6 axes | Mirrors right hand |
| Left shoulder | 左肩 | -X, +Z, -Z | +X/+Y invalid |
| Right leg | 右足 | All 6 axes | +X forward, +Y abduction |
| Right knee | 右ひざ | +X, -X, +Z, -Z | Y axis weak |
| Right ankle | 右足首 | All 6 axes | Fixed via Grant solver |
| Left leg | 左足 | All 6 axes | Mirrors right leg |
| Left knee | 左ひざ | +X, -X, +Z, -Z | Y axis weak |
| Left ankle | 左足首 | All 6 axes | Fixed via Grant solver |
| Torso | 上半身 | +Z, -Z (effective) | X/Y weak, needs larger angles |
| Torso | 上半身2 | -X, +Z, -Z | Effective |
| Torso | 下半身 | X/Z effective, Y weak | Fixed via Grant solver |
| Head/Neck | 首 | All 6 axes | Fixed via Grant solver |
| Head/Neck | 頭 | All 6 axes (visual) | Metric changes small but screenshot MD5s all differ |

### 9.2 Finger Bones (30 joints + 8 twist = 230 VMDs x 4 angles = 920 screenshots)

| Finger | Joints | Hand | Valid axes | Occlusion |
|---|---|---|---|---|
| Thumb | 0,1,2 | Right | All 6 axes | Left view occluded |
| Thumb | 0,1,2 | Left | All 6 axes | Right view occluded |
| Index | 1,2,3 | Right | All 6 axes | Left view occluded |
| Index | 1 | Left | All 6 axes | Right view occluded |
| Index | 2,3 | Left | All 6 axes | Front+right view occluded |
| Middle | 1,2,3 | Right | All 6 axes | Left view occluded |
| Middle | 1 | Left | All 6 axes | Right view occluded |
| Middle | 2,3 | Left | All 6 axes | Front+right view occluded |
| Ring | 1,2,3 | Right | All 6 axes | Left view occluded |
| Ring | 1 | Left | All 6 axes | Right view occluded |
| Ring | 2,3 | Left | All 6 axes | Front+right view occluded |
| Pinky | 1,2,3 | Right | All 6 axes | Left view occluded |
| Pinky | 1 | Left | All 6 axes | Right view occluded |
| Pinky | 2,3 | Left | All 6 axes | Front+right view occluded |
| Wrist twist | 0,1,2,3 | Right | All 6 axes | Left view occluded |
| Wrist twist | 0,1,2,3 | Left | All 6 axes | Right view occluded |
| Fist | All fingers | Left/Right | Effective | Differs from baseline |

Finger bones have flags=0x0, direct vertex weight binding, no Grant system.

### 9.3 Forearm Twist (32 VMDs x 4 angles = 236 screenshots + 3 GIFs)

| Bone | Test angles | Conclusion |
|---|---|---|
| Right wrist | X: +/-15,30,45,60,90 | Effective, twist bones auto-follow |
| Right elbow | X: +/-15,30,45,60,90 | Effective, but less twist transfer |
| Right wrist | Y: +/-45 | Effective |
| Right wrist | Z: +/-45 | Effective |
| Left wrist | X: +/-45,90 | Effective |
| Right wrist seq | X/Y/Z 0->90->-90->0 | 10 frames x 4 angles GIF generated |

---

## 10. Axis Mapping Key Conclusions

### 10.1 Axis Inversion

| Bone | Axis | Expected | Actual | Impact |
|---|---|---|---|---|
| Right upper arm | +Z | Abduction | Adduction | Retargeter must negate Z |
| Right upper arm | +X | Forward raise | No effect | 45° no effect, 90° effective (threshold issue) |
| Right shoulder | +X | Forward raise | No effect | Scapula limitation |
| Right shoulder | +Y | External rotation | No effect | Scapula limitation |

### 10.2 Left-Right Mirror Symmetry

| Bone pair | Mirror axis | Description |
|---|---|---|
| Right/Left upper arm | Z axis | Right +Z=adduction, Left +Z=abduction |
| Right/Left shoulder | Z axis | Right +Z=adduction, Left +Z=abduction |
| Right/Left hip | Y axis | Right +Y=abduction, Left +Y=adduction |

### 10.3 Grant (Inheritance) Bone System

The following bones use the Grant system, with vertex weights bound to 'D' suffix deform bones:

| Control bone | Deform bone | Vertex count |
|---|---|---|
| 右足首 (R ankle) | 右足首D | 561 |
| 右足 (R foot) | 右足D | 1371 |
| 左足首 (L ankle) | 左足首D | 561 |
| 左足 (L foot) | 左足D | 1371 |

Calibration mode must call `grantSolver.update()`, otherwise control bone rotation does not transfer to deform bones, appearing as "invalid".

Fix location: `web/src/features/stage/mmdCompanionRuntime.js` in `seekVmdFrame` and `renderFrame` calibration branches.

---

## 11. IK Post-Processing Status

### 11.1 FABRIK Two-Bone IK Results

| Metric | V1 (original) | FABRIK IK |
|---|---|---|
| Chin distance (hold_max) | 52.75px | 14.00px |
| Chin min distance | 27.50px | 0.73px |
| Frame 0 wrist front depth | -1.023 | +0.613 |
| Frame 90 wrist front depth | -2.685 | +0.615 |
| Frame 120 wrist front depth | -1.026 | +0.627 |
| Frame 90 elbow front depth | -0.925 | +0.202 |
| Failed quality gates | 7/20 | 5/20 |

### 11.2 Quality Gates Still Failing

1. `elbow_angles_plausible_all_frames` — IK may produce unnatural elbow angles
2. `thinking_hand_chain_stays_in_front_of_torso` — f178 elbow front depth=-0.063
3. `limb_endpoints/segments_clear_torso_core` — torso clearance insufficient
4. `overall_motion_quality` — aggregate gate
5. Motion smoothness — inter-frame jitter not handled

### 11.3 Remaining Stages

| Stage | Content | Goal |
|---|---|---|
| Stage 3 | Joint angle limit table | Prevent implausible elbow/shoulder rotations | Done (20260703) |
| Stage 4 | Motion smoothing (SLERP + accel) | Limit per-frame angular velocity + jerk | Done (20260703) |
| Stage 5 | Priority constraint system | Collision > joint > target > path > smooth | Done (20260703) |
| Stage 6 | Full-body kinematic chain | Torso lean compensation | Done (20260703) |

### Stages 3-6 Implementation Details (20260703)

Stage 3 Joint Angle Limit Table:
- Elbow 20-175deg, shoulder abduction 0-170deg, knee 15-175deg
- apply_joint_limits() clamps rotations outside anatomical ranges after IK correction
- Per-bone max angular velocity: torso 0.15 rad/frame, upper arm 0.25, forearm 0.35, fingers 0.40

Stage 4 Enhanced Motion Smoothing:
- apply_motion_smoothing_v2() two-pass: velocity limiting + acceleration limiting
- Per-bone max angular velocity (different from v1 uniform 0.3)
- Acceleration pass prevents jerk (max_acceleration_ratio=2.0)

Stage 5 Priority Constraint System:
- apply_priority_constraints() applies constraints in priority order:
  1. Collision avoidance (front depth + torso clearance) highest priority
  2. Joint angle limits
  3. Target position (FABRIK IK to chin) reverted if collision violated
  4. Path constraint (wrist stays in front)
  5. Motion smoothness lowest priority

Stage 6 Torso Lean Compensation:
- apply_torso_lean_compensation() when wrist target exceeds arm reach
- Iteratively leans upper body forward (max 10deg, step 0.5deg)
- Modifies shoulder position to bring target into reach

Implementation: worktree imgtoaction-front-depth-gates
- Code: imgToAction/tools/fk_world_model.py (+400 lines)
- Tests: imgToAction/tests/test_fk_stages_3_6.py (12 tests, all pass)
- Docs: docs/plans/2026-07-03-ik-stages-3-6-complete.md

---

## 12. File Location Index

### Data Files
- T-pose probe data: `tmp/tpose_probe/render_metrics.json`
- Combined metrics JSON: `imgToAction/outputs/actions/20260702_finger_shot/combined_metrics.json`
- Finger metrics JSON: `imgToAction/outputs/actions/20260702_finger_metrics/all_metrics.json`
- Twist metrics JSON: `imgToAction/outputs/actions/20260702_twist_gif/twist_metrics.json`

### Documentation
- Full bone coordinate system doc: `imgToAction/docs/mmd-bone-coordinate-system.md`
- Finger data table: `imgToAction/docs/finger_metrics_table.md`
- Twist data table: `imgToAction/docs/twist_metrics_table.md`
- This guide (Chinese): `imgToAction/docs/mmd-calibration-guide.md`
- This guide (English): `imgToAction/docs/mmd-calibration-guide-en.md`

### Screenshots
- Finger 4-angle screenshots: `imgToAction/outputs/actions/20260702_finger_shot/{bone_id}/{front,right,back,left}/`
- Twist 4-angle screenshots: `imgToAction/outputs/actions/20260702_twist_shot/{vmd_name}/{front,right,back,left}/`
- Main bone 4-angle screenshots: `imgToAction/outputs/actions/20260702_axis_shot/{bone_id}/{front,left,right,back}/`

### GIFs
- Finger group GIFs: `imgToAction/outputs/actions/20260702_finger_gif/{finger_group}_4angle.gif`
- Twist sequence GIFs: `imgToAction/outputs/actions/20260702_twist_gif/twist_r_wrist_{x,y,z}seq30_4angle.gif`
- Main bone GIFs: `imgToAction/outputs/actions/20260702_axis_gif/{bone_id}_4angle.gif`

### VMD Files
- Basic test VMDs: `imgToAction/outputs/vmd/basic_tests/basic_{test_name}.vmd`
- T-pose probe VMD: `imgToAction/outputs/vmd/tpose_probe.vmd`
- FABRIK IK result VMD: `imgToAction/outputs/vmd/front_depth_fabrik.vmd`

### Code
- FK world model + IK solver: `imgToAction/tools/fk_world_model.py`
- VMD generator: `imgToAction/tools/generate_action_vmd.py`
- Finger VMD generator: `imgToAction/tools/gen_finger_vmds.py`
- Render scripts: `imgToAction/tools/multi-angle-render.mjs`, `render-twist-tests.mjs`
- Grant solver fix: `web/src/features/stage/mmdCompanionRuntime.js` (seekVmdFrame, renderFrame)
