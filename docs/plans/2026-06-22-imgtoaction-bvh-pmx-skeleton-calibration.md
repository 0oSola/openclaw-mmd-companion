# ImgToAction BVH PMX Skeleton Calibration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a calibrated BVH-to-Eula-PMX retarget path so MoMask BVH local rotations are preserved instead of being reduced to world joint directions.

**Architecture:** Keep the existing position-based retargeter as a fallback, but add a calibrated retarget profile that maps BVH joints to PMX bones with explicit rest-pose correction quaternions. The new path reads BVH local/world transforms, converts source local rotations into PMX local bone space, writes VMD bone frames, and uses the existing render metrics to verify visual quality.

**Tech Stack:** Python 3.12, existing `imgToAction/tools` scripts, existing VMD writer, Node render metrics via `render-vmd-pose-check.mjs`, pytest and Node test runner.

---

## Scope

In scope:
- MoMask/HumanML-style BVH to Eula PMX only.
- Core body, upper body, arms, head, legs, feet.
- A JSON retarget profile checked into `imgToAction/config/`.
- Automated tests for quaternion math, profile loading, and VMD output.
- Render-quality comparison against the current BVH output.

Out of scope for the first pass:
- Fingers from BVH.
- Cloth/hair physics.
- Multi-model profile generation.
- Full PMX parser if existing render/runtime APIs can provide rest-pose landmarks.
- Perfect IK. Foot IK cleanup can be a later pass after local rotation preservation is working.

---

### Task 1: Define the Retarget Profile Contract

**Files:**
- Create: `imgToAction/config/retarget_profile.eula_from_humanml_bvh.json`
- Create: `imgToAction/tests/test_retarget_profile.py`

**Step 1: Write the failing test**

Test that the profile:
- Has `id = "eula_from_humanml_bvh"`.
- Has `source.type = "bvh"` and `source.skeleton = "humanml"`.
- Defines mappings for at least `Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `RightArm`, `RightForeArm`, `RightHand`, `LeftArm`, `LeftForeArm`, `LeftHand`, legs, and feet.
- Each mapped bone has `source_joint`, `pmx_bone`, `mode`, and `correction_quaternion`.
- Each `correction_quaternion` has 4 finite numbers and is normalized.

Run:

```powershell
pytest imgToAction\tests\test_retarget_profile.py -q
```

Expected: FAIL because the profile and loader do not exist.

**Step 2: Add minimal JSON profile**

Initial profile shape:

```json
{
  "id": "eula_from_humanml_bvh",
  "source": {
    "type": "bvh",
    "skeleton": "humanml",
    "rotation_order": "Zrotation,Yrotation,Xrotation"
  },
  "target": {
    "model_profile": "eula",
    "pmx": "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx"
  },
  "scale": {
    "source_unit": "meters",
    "target_unit": "mmd_model_units",
    "center_position_scale": 1.0
  },
  "bones": [
    {
      "source_joint": "RightArm",
      "pmx_bone": "右腕",
      "mode": "local_rotation",
      "correction_quaternion": [0.0, 0.0, 0.0, 1.0],
      "weight": 1.0
    }
  ]
}
```

Use identity corrections at first. This makes the contract test pass before real calibration values are filled.

**Step 3: Add a loader**

Create a small loader inside a new module in Task 2, or keep the JSON validation in the test until Task 2. Do not change retargeting yet.

**Step 4: Run test**

Run:

```powershell
pytest imgToAction\tests\test_retarget_profile.py -q
```

Expected: PASS.

---

### Task 2: Add Quaternion and Matrix Utilities

**Files:**
- Create: `imgToAction/tools/retarget_math.py`
- Create: `imgToAction/tests/test_retarget_math.py`

**Step 1: Write failing tests**

Test:
- Matrix-to-quaternion conversion returns normalized quaternions.
- Quaternion multiplication composes rotations.
- Quaternion inverse reverses a rotation.
- `q * identity == q`.
- `correction * source * inverse(correction)` preserves identity when source is identity.

Run:

```powershell
pytest imgToAction\tests\test_retarget_math.py -q
```

Expected: FAIL because `retarget_math.py` does not exist.

**Step 2: Implement minimal utilities**

Implement:
- `quat_normalize(q)`
- `quat_multiply(left, right)`
- `quat_inverse(q)`
- `quat_from_matrix3(matrix)`
- `quat_apply_correction(source_quat, correction_quat)`
- `is_finite_quat(q)`

The key operation for retargeting is:

```python
pmx_rotation = quat_multiply(
    correction,
    quat_multiply(source_local_rotation, quat_inverse(correction)),
)
```

This may later change to `target_rest_inverse * source_delta * target_rest`, but keep the correction operation explicit and tested first.

**Step 3: Run tests**

Run:

```powershell
pytest imgToAction\tests\test_retarget_math.py -q
```

Expected: PASS.

---

### Task 3: Preserve BVH Local Rotation in a Structured Motion Payload

**Files:**
- Modify: `imgToAction/tools/import_bvh_motion.py`
- Modify: `imgToAction/tests/test_import_bvh_motion.py`

**Step 1: Write failing test**

Extend the existing BVH test to assert that `bvh_to_motion_payload()` exposes:
- `frames[*].local.RightArm.rotation_matrix`
- `frames[*].local.RightArm.rotation_quaternion`
- `frames[*].world.RightArm.rotation_matrix`

Current code stores `world.rotation_matrix` and local Euler degrees, but not local rotation matrix/quaternion in a direct retarget-friendly form.

Run:

```powershell
pytest imgToAction\tests\test_import_bvh_motion.py -q
```

Expected: FAIL because local `rotation_matrix` / `rotation_quaternion` are missing.

**Step 2: Implement minimal payload additions**

In `_fk_joint_with_transforms()`, add:

```python
local_payload[joint.name]["rotation_matrix"] = _matrix_payload(local_rotation)
local_payload[joint.name]["rotation_quaternion"] = list(quat_from_matrix3(local_rotation))
world_payload[joint.name]["rotation_quaternion"] = list(quat_from_matrix3(world_rotation))
```

Import quaternion conversion from `retarget_math.py`.

**Step 3: Run test**

Run:

```powershell
pytest imgToAction\tests\test_import_bvh_motion.py -q
```

Expected: PASS.

---

### Task 4: Implement Calibrated BVH-to-VMD Retargeter

**Files:**
- Create: `imgToAction/tools/retarget_bvh_to_pmx_vmd.py`
- Create: `imgToAction/tests/test_retarget_bvh_to_pmx_vmd.py`

**Step 1: Write failing test**

Create a tiny synthetic `bvh_motion` payload with two frames and one rotating arm joint.

Assert:
- The retargeter reads a profile mapping `RightArm -> 右腕`.
- It writes VMD frames for the mapped PMX bone.
- A non-identity BVH local rotation produces a non-identity VMD quaternion.
- Identity correction preserves the source quaternion.

Run:

```powershell
pytest imgToAction\tests\test_retarget_bvh_to_pmx_vmd.py -q
```

Expected: FAIL because the module does not exist.

**Step 2: Implement profile loader**

Implement:
- `load_retarget_profile(path)`
- `validate_retarget_profile(profile)`
- `retarget_bvh_motion_to_bone_frames(motion_payload, profile)`
- `write_calibrated_bvh_vmd(motion_payload, profile, out, model_name="Eula")`

For each frame:
- Convert source frame index to VMD frame number with source FPS.
- For each profile bone mapping:
  - Read `local[source_joint].rotation_quaternion`.
  - Apply correction quaternion.
  - Write `BoneFrame(pmx_bone, frame_no, (0,0,0), pmx_rotation)`.
- For `Hips`/`センター`, write center position from source root after applying scale.

**Step 3: Keep old retargeter untouched**

Do not modify `retarget_skeleton_to_vmd.py` in this task. The new retargeter should be callable independently first.

**Step 4: Run test**

Run:

```powershell
pytest imgToAction\tests\test_retarget_bvh_to_pmx_vmd.py -q
```

Expected: PASS.

---

### Task 5: Add CLI Mode for Calibrated BVH Retargeting

**Files:**
- Modify: `imgToAction/tools/generate_action_vmd.py`
- Modify: `imgToAction/tests/test_generate_action_vmd.py`

**Step 1: Write failing test**

Add a unit test for:

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-bvh imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh `
  --retarget-profile imgToAction/config/retarget_profile.eula_from_humanml_bvh.json `
  --mode preserve-source-motion `
  --out tmp.vmd
```

Assert:
- `bvh_motion.json` is written.
- `final_candidate.vmd` comes from calibrated BVH retargeter, not `retarget_skeleton_to_vmd.py`.
- `retarget_fidelity_report.json` records `retargeter = "calibrated_bvh_local_rotation"`.

Run:

```powershell
pytest imgToAction\tests\test_generate_action_vmd.py -q
```

Expected: FAIL because `--retarget-profile` is unsupported.

**Step 2: Add CLI argument**

Add:

```python
parser.add_argument("--retarget-profile", default="", help="Optional calibrated BVH-to-PMX retarget profile JSON.")
```

Pass it into `generate_action_vmd()`.

**Step 3: Route BVH preserve mode through calibrated retargeter**

When:
- `source_type == "bvh"`
- `mode == "preserve-source-motion"`
- `retarget_profile` is provided

Use:

```python
write_calibrated_bvh_vmd(bvh_motion_payload, profile, draft_vmd)
```

Keep action-fit mode on the existing path until calibrated preserve mode is verified.

**Step 4: Run tests**

Run:

```powershell
pytest imgToAction\tests\test_generate_action_vmd.py -q
```

Expected: PASS.

---

### Task 6: Generate First Real Calibration Corrections

**Files:**
- Modify: `imgToAction/config/retarget_profile.eula_from_humanml_bvh.json`
- Create: `imgToAction/tools/derive_retarget_corrections.py`
- Create: `imgToAction/tests/test_derive_retarget_corrections.py`

**Step 1: Decide calibration source**

Use two rest poses:
- BVH rest pose: derive from BVH hierarchy offsets with zero rotations.
- PMX rest pose: use the existing web runtime/model landmark export if it can expose bone world matrices; otherwise start with the already render-confirmed `BONE_TARGETS` rest axes as a provisional PMX rest basis.

First pass can derive corrections from directional axes:

```text
source bone rest direction -> target PMX bone rest direction
```

This preserves more than the current direction-only retarget because it applies correction to local rotations instead of recomputing rotations from endpoints.

**Step 2: Write failing test**

Given:
- source rest axis `[-1, 0, 0]`
- target rest axis `[0, 1, 0]`

Assert the derived correction rotates source rest to target rest and is normalized.

Run:

```powershell
pytest imgToAction\tests\test_derive_retarget_corrections.py -q
```

Expected: FAIL because script does not exist.

**Step 3: Implement derivation helper**

Implement:
- `quat_between_vectors(source, target)`
- `derive_direction_correction(source_rest_axis, target_rest_axis)`
- `update_profile_corrections(profile, correction_map)`

**Step 4: Fill corrections**

Use these initial rest axes:

```text
BVH RightArm / RightForeArm / RightHand: -X
BVH LeftArm / LeftForeArm / LeftHand: +X
BVH legs: -Y
BVH spine/head: +Y
PMX arms: use current BONE_TARGETS axes
PMX legs/spine/head: use current BONE_TARGETS axes
```

This gives a deterministic first calibrated profile. It is not perfect, but it is testable and better grounded than hard-coded endpoint-only retargeting.

**Step 5: Run tests**

Run:

```powershell
pytest imgToAction\tests\test_derive_retarget_corrections.py imgToAction\tests\test_retarget_profile.py -q
```

Expected: PASS.

---

### Task 7: Render Compare Current vs Calibrated Output

**Files:**
- No code change required unless render script needs a small CLI convenience.
- Outputs under: `imgToAction/outputs/actions/thinking_chin_edge/calibrated_bvh_smoke/`

**Step 1: Generate calibrated preserve VMD**

Run:

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-bvh imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh `
  --mode preserve-source-motion `
  --retarget-profile imgToAction/config/retarget_profile.eula_from_humanml_bvh.json `
  --run-dir imgToAction/outputs/actions/thinking_chin_edge/calibrated_bvh_smoke `
  --out imgToAction/outputs/vmd/eula_bvh_calibrated_preserve_smoke.vmd
```

Expected:
- CLI succeeds.
- `selection_report.json` says calibrated retargeter was used.
- VMD loads without parser errors.

**Step 2: Render current and calibrated VMD**

Make sure web dev server is running:

```powershell
npm --prefix web run dev
```

Render:

```powershell
node imgToAction/tools/render-vmd-pose-check.mjs `
  --vmd imgToAction/outputs/vmd/eula_bvh_calibrated_preserve_smoke.vmd `
  --out-dir imgToAction/outputs/actions/thinking_chin_edge/calibrated_bvh_smoke/render `
  --frames 0,30,60,90,120,178 `
  --render-pipeline genshin
```

Expected:
- `contact_sheet.png` exists.
- `render_metrics.json` has no missing landmark requests.
- No limb quality gate fails catastrophically.

**Step 3: Compare visually**

Open:

```text
imgToAction/outputs/actions/thinking_chin_edge/calibrated_bvh_smoke/render/contact_sheet.png
```

Compare against:

```text
imgToAction/outputs/actions/thinking_chin_edge/run_preserve_bvh/
imgToAction/outputs/actions/thinking_chin_edge/run_smoke_bvh/
```

Success criteria:
- Arms retain more of the MoMask/BVH timing and rotation character.
- Wrists/forearms twist less unnaturally.
- Shoulders do not collapse.
- Legs do not explode.
- It may still need foot IK cleanup.

---

### Task 8: Enable Calibrated Action-Fit After Preserve Mode Works

**Files:**
- Modify: `imgToAction/tools/generate_action_vmd.py`
- Modify: `imgToAction/tools/action_constraints.py` only if constraints need to work on motion payloads.
- Test: `imgToAction/tests/test_generate_action_vmd.py`

**Step 1: Keep action-fit disabled until preserve render is acceptable**

Do not combine calibrated local-rotation retargeting and current right-wrist IK until preserve mode looks sane. Otherwise it will be impossible to isolate whether bad output comes from retargeting or action constraints.

**Step 2: Write failing test**

Test calibrated action-fit:
- Uses calibrated retargeter for the draft.
- Applies right-wrist contact after the draft stage.
- Still writes `quality_report.json`.

**Step 3: Implement one of two paths**

Recommended first path:
- Generate calibrated `draft.vmd`.
- Apply existing overlay/constraint logic only where it writes VMD bone frames, not by mutating skeleton endpoints.

Fallback path:
- Keep calibrated preserve mode separate.
- For `thinking_chin_edge`, continue using current position-based action-fit until a VMD-space contact overlay exists.

**Step 4: Verify**

Run:

```powershell
pytest imgToAction\tests\test_generate_action_vmd.py -q
node --test imgToAction\tests\render-vmd-pose-check.test.mjs
```

Expected: PASS.

---

### Task 9: Update Documentation and Architecture

**Files:**
- Modify: `imgToAction/README.md`
- Modify: `docs/architecture/current-system-topology.md`
- Modify: `docs/plans/2026-06-17-imgtoaction-momask-to-vmd-design.md` only if keeping design docs current is desired.

**Step 1: Document the two retarget modes**

Add:

```text
preserve-source-motion + --retarget-profile
  Uses BVH local rotations and PMX calibration corrections.

action-fit without --retarget-profile
  Uses legacy skeleton endpoint retargeting plus action constraints.
```

**Step 2: Document known limits**

Include:
- First profile is Eula/HumanML only.
- Fingers remain preset overlay.
- Foot IK still needs a second pass.
- PMX rest-bone matrices are approximated until exported directly from runtime/PMX.

**Step 3: Update topology**

Because this changes runtime behavior and local tool topology, update:

```text
docs/architecture/current-system-topology.md
```

Mention:

```text
BVH -> bvh_motion local rotations -> retarget_profile corrections -> calibrated VMD
```

---

## Final Verification

Run the full relevant test set:

```powershell
pytest imgToAction\tests -q
node --test imgToAction\tests\*.test.mjs
```

Expected:
- Python tests pass.
- Node tests pass.
- Existing legacy path still passes.

Run a manual smoke render:

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-bvh imgToAction/samples/bvh/sample0_repeat0_len196_ik.bvh `
  --mode preserve-source-motion `
  --retarget-profile imgToAction/config/retarget_profile.eula_from_humanml_bvh.json `
  --out imgToAction/outputs/vmd/eula_bvh_calibrated_preserve_smoke.vmd
```

Then render the VMD and inspect `contact_sheet.png`.

The first acceptable milestone is not “perfect motion.” It is:

```text
The calibrated preserve-source-motion output visibly preserves BVH joint rotations better than the current endpoint-only retargeter, without severe limb flips or broken PMX loading.
```

