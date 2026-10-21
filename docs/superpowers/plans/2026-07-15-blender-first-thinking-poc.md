# Blender-First Thinking Motion POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible Blender-only A/B sample that tests whether a control rig can make the v16 right arm and thinking hand visibly more anatomical without exporting a VMD.

**Architecture:** Open the existing Eula review scene, import v16 as the reference action, and add a non-deforming two-segment proxy arm controlled by a hand target and elbow pole. Copy the solved rotations back to the PMX deform chain with explicit upper-arm, forearm-twist, and wrist distribution, then render the reference and corrected states through the same Blender cameras. Keep pure anatomical math outside `bpy` so it can be unit-tested normally; keep Blender scene construction and rendering in one headless entry point.

**Tech Stack:** Blender 5.1.1 for Windows, Blender Python API, mmd_tools, Python 3, pytest, Pillow, PMX mesh/BVH-tree geometry checks.

---

### Task 1: Add testable anatomical math primitives

**Files:**
- Create: `imgToAction/tools/blender_first_motion_math.py`
- Create: `imgToAction/tests/test_blender_first_motion_math.py`

- [ ] **Step 1: Write failing tests for two-bone reach and elbow-plane stability**

Test that the solver rejects unreachable targets cleanly, preserves segment lengths, selects the elbow on the pole-facing side, and does not flip when adjacent targets differ slightly.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `python -m pytest imgToAction/tests/test_blender_first_motion_math.py -q`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure vector and two-bone geometry helpers**

Implement tuple-based helpers for normalization, projection, signed angle, clamped two-bone reach, elbow candidate selection, and per-frame continuity scoring. Do not import `bpy` or `mathutils` in this module.

- [ ] **Step 4: Add failing tests for anatomical comfort scoring**

Cover hard elbow reversal rejection, elbow comfort range, wrist swing comfort, forearm twist allocation, and a penalty increase near the hard limits.

- [ ] **Step 5: Implement hard-limit and soft-comfort scoring**

Return structured results containing `valid`, component penalties, measurements, and human-readable reasons. Keep thresholds named and documented rather than embedding anonymous constants.

- [ ] **Step 6: Run the focused tests**

Run: `python -m pytest imgToAction/tests/test_blender_first_motion_math.py -q`

Expected: PASS.

- [ ] **Step 7: Commit the math layer**

```bash
git add imgToAction/tools/blender_first_motion_math.py imgToAction/tests/test_blender_first_motion_math.py
git commit -m "feat: add anatomical solver primitives"
```

### Task 2: Build the isolated Blender control-rig scene

**Files:**
- Create: `imgToAction/tools/blender_first_thinking_poc.py`
- Create: `imgToAction/tests/test_blender_first_thinking_poc_cli.py`
- Read: `imgToAction/outputs/blender/eula_elegant_thinking_generated_v15_review.blend`
- Read: `imgToAction/outputs/vmd/eula_elegant_thinking_generated_v16.vmd`
- Create: `imgToAction/outputs/blender/eula_elegant_thinking_blender_first_poc.blend`

- [ ] **Step 1: Write a failing CLI contract test**

Require arguments after Blender's `--` separator for source blend, v16 VMD, output blend, output directory, frame range, and `--setup-only`. Verify path validation and deterministic output names without launching Blender.

- [ ] **Step 2: Run the CLI test and verify it fails**

Run: `python -m pytest imgToAction/tests/test_blender_first_thinking_poc_cli.py -q`

Expected: FAIL because the entry point does not exist.

- [ ] **Step 3: Implement deterministic scene loading and v16 import**

Set the scene to frame `0` before importing because mmd_tools offsets VMD keys from the current scene frame. Select `优菈_arm`, import v16 through `bpy.ops.mmd_tools.import_vmd` with PMX mapping, scale `0.08`, margin `0`, and a new action. Rename the action `POC_v16_reference` and fail if the armature, required Japanese bone names, action, model mesh, or exact action range `0-240` is missing.

- [ ] **Step 4: Add a non-deforming proxy chain**

Create `POC_右腕_CTRL`, `POC_右ひじ_CTRL`, and `POC_右手_CTRL` from the PMX rest positions of `右腕`, `右ひじ`, and `右手首`. Parent the chain to the evaluated shoulder space, set `use_deform=False`, and add named hand-target, elbow-pole, palm-orientation, and chin-contact controls in a `POC_controls` collection.

- [ ] **Step 5: Add the Blender constraints**

Place a two-bone IK constraint on the proxy forearm, point it at the hand target, and use the elbow pole to lock the bend plane. Copy the proxy rotations to `右腕` and `右ひじ`; distribute forearm axial rotation through `右腕捩`, `右手捩`, and `右手首` with bounded influences instead of assigning all rotation to the wrist.

- [ ] **Step 6: Add anatomical assertions before saving**

At frame 150, verify segment-length preservation, elbow-facing sign, no negative elbow bend, expected control names, constraint targets, and finite evaluated matrices. Abort rather than saving a malformed rig.

- [ ] **Step 7: Run a headless setup smoke test**

Run:

```bash
"/mnt/d/Blender/blender.exe" --background \
  "D:\\workspace\\mmd project\\imgToAction\\outputs\\blender\\eula_elegant_thinking_generated_v15_review.blend" \
  --python "D:\\workspace\\mmd project\\imgToAction\\tools\\blender_first_thinking_poc.py" -- \
  --source-blend "D:\\workspace\\mmd project\\imgToAction\\outputs\\blender\\eula_elegant_thinking_generated_v15_review.blend" \
  --vmd "D:\\workspace\\mmd project\\imgToAction\\outputs\\vmd\\eula_elegant_thinking_generated_v16.vmd" \
  --output-blend "D:\\workspace\\mmd project\\imgToAction\\outputs\\blender\\eula_elegant_thinking_blender_first_poc.blend" \
  --output-dir "D:\\workspace\\mmd project\\imgToAction\\outputs\\actions\\blender_first_thinking_poc" \
  --setup-only
```

Expected: the output blend is saved, the reference action remains intact, and no VMD is written.

- [ ] **Step 8: Run normal CLI tests**

Run: `python -m pytest imgToAction/tests/test_blender_first_thinking_poc_cli.py -q`

Expected: PASS.

- [ ] **Step 9: Commit the scene builder**

```bash
git add imgToAction/tools/blender_first_thinking_poc.py imgToAction/tests/test_blender_first_thinking_poc_cli.py
git commit -m "feat: build Blender-first thinking control rig"
```

### Task 3: Solve and validate the frame 150 hero pose

**Files:**
- Modify: `imgToAction/tools/blender_first_thinking_poc.py`
- Create: `imgToAction/outputs/actions/blender_first_thinking_poc/candidates/`
- Create: `imgToAction/outputs/actions/blender_first_thinking_poc/static_pose_metrics.json`

- [ ] **Step 1: Add a failing candidate-score test**

Verify that a neutral wrist, pole-facing elbow, lower-jaw contact, and non-penetrating pose outrank a folded wrist or elbow-flipped pose.

- [ ] **Step 2: Add deterministic frame 150 candidate generation**

Sample a staged bounded grid around the calibrated lower-jaw contact for hand-target position, palm orientation, three-dimensional elbow-pole offset, twist allocation, semantic right-finger pose, and minimal upper-body compensation. Preserve the pelvis, left arm, and lower body. Permit at most 4 degrees on `上半身2`, 3 degrees on the right shoulder girdle, and 5 combined degrees on neck/head only after the arm-only search has proven collision-infeasible. Use calibrated local finger axes to let the thumb/index reach the jaw while the other fingers retain a relaxed progressive curl, so the wrist and sleeve do not need to enter the torso.

- [ ] **Step 3: Score candidates before rendering**

Reject hard anatomical failures. Rank remaining candidates by elbow comfort, wrist swing, twist distribution, contact error, frame-to-frame continuity from v16 frame 149, and separation from the torso/head proxy geometry.

- [ ] **Step 4: Render the highest-ranked static candidates**

Render front, left, right, and back views with a full-body orthographic camera plus an optional hand close-up. Store the top candidates under stable numbered directories and write their complete parameter and score records.

- [ ] **Step 5: Inspect candidate images and select one evidence-based pose**

Use the rendered four views to reject candidates with broken silhouettes, face occlusion, implausible palm facing, sleeve collapse, or visually incorrect contact even if their numeric score is lower.

- [ ] **Step 6: Run evaluated-mesh collision checks**

Build BVH trees from the evaluated `优菈_mesh`. Compare the right-hand/forearm vertex groups against head, neck, chest, and torso polygons while excluding adjacent right-arm polygons. Record intersection count and minimum clearance.

- [ ] **Step 6a: Apply bounded sleeve corrective bones when required**

If a contact-valid arm pose is anatomically correct but `右手捩1/2/3`-weighted sleeve geometry intersects `上半身2`, search small calibrated local rotations on those auxiliary bones. Require zero shoulder/elbow/wrist/finger/contact transform drift and reject any corrective deformation that creates a visible sleeve collapse or new collision.

- [ ] **Step 6b: Generate a derived-PMX sleeve corrective morph when bones are insufficient**

Keep the source PMX untouched. On a copied model, create `思考_右袖修正` from the collision-attributed `右手捩1/2/3` sleeve vertices, push them out of `上半身2` with a geometry-derived safety margin, smooth the displacement while pinning unaffected boundaries, and verify morph values `0` and `1`. Export the derived PMX only after Blender mesh validation; continue to defer VMD export until visual approval.

- [ ] **Step 7: Save the selected static pose and metrics**

Write the chosen controls into the POC blend and produce `static_pose_metrics.json` with explicit PASS, WARN, or FAIL verdicts. Stop here if the hero pose is not visibly better than v16.

- [ ] **Step 8: Run focused tests and the setup smoke test again**

Expected: unit tests pass and the saved frame 150 pose reproduces identically in a fresh Blender process.

- [ ] **Step 9: Commit the static-pose solver**

```bash
git add imgToAction/tools/blender_first_thinking_poc.py imgToAction/tests/test_blender_first_motion_math.py
git commit -m "feat: solve Blender-first thinking hero pose"
```

### Task 4: Build the frame 90-170 transition

**Files:**
- Modify: `imgToAction/tools/blender_first_thinking_poc.py`
- Create: `imgToAction/outputs/actions/blender_first_thinking_poc/transition_metrics.json`

- [ ] **Step 1: Add failing continuity tests**

Test that target interpolation is monotonic near contact, angular velocity remains bounded, the elbow-plane sign never changes, and contact drift remains bounded during the hold segment.

- [ ] **Step 2: Key the control-rig influences and targets**

Keep v16 unchanged at frame 90, blend into the corrected chain with eased overlapping motion, reach the selected contact near frame 150, and hold through frame 170. The head and torso stay on the v16 action for this POC.

- [ ] **Step 3: Add per-frame anatomical validation**

Evaluate every frame from 90 through 170. Stop on hard-limit violations, elbow flips, non-finite transforms, excessive wrist swing, or mesh penetration; report soft-comfort warnings separately.

- [ ] **Step 4: Add transition mesh sampling**

Run full mesh checks at least at frames `90, 110, 130, 140, 150, 160, 170`, and proxy distance checks on every frame. Record maximum angular velocity and the frame where it occurs.

- [ ] **Step 5: Save the reproducible transition**

Store all control keyframes and constraints in the POC blend. Do not bake PMX bones and do not call the VMD exporter.

- [ ] **Step 6: Run focused tests**

Run:

```bash
python -m pytest \
  imgToAction/tests/test_blender_first_motion_math.py \
  imgToAction/tests/test_blender_first_thinking_poc_cli.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit the transition**

```bash
git add imgToAction/tools/blender_first_thinking_poc.py imgToAction/tests
git commit -m "feat: animate Blender-first thinking transition"
```

### Task 5: Render synchronized Blender A/B evidence

**Files:**
- Create: `imgToAction/tools/make_blender_first_ab_review.py`
- Create: `imgToAction/tests/test_make_blender_first_ab_review.py`
- Create: `imgToAction/outputs/actions/blender_first_thinking_poc/reference/`
- Create: `imgToAction/outputs/actions/blender_first_thinking_poc/corrected/`
- Create: `imgToAction/outputs/actions/blender_first_thinking_poc/review/`

- [ ] **Step 1: Write failing image-layout tests**

Use temporary generated images to verify deterministic ordering: v16 on the left, Blender-first on the right, and front/left/right/back views in the same positions for every frame.

- [ ] **Step 2: Render both states through identical Blender settings**

For the reference pass, disable POC constraint influences and use `POC_v16_reference`. For the corrected pass, enable the control rig. Render frame 150 and frames 90-170 at the same resolution, orthographic scale, lighting, view transforms, frame step, and four camera transforms.

- [ ] **Step 3: Compose the static A/B sheet**

Create one labeled image showing all four views for both variants, while retaining the individual full-resolution screenshots.

- [ ] **Step 4: Compose the synchronized A/B GIF**

Create one GIF with v16 on the left and Blender-first on the right. Each side contains the same four-view grid and frame label. Use matching frame timing and no independent loops.

- [ ] **Step 5: Write the review table**

Include elbow angle, wrist swing, forearm twist, contact error, collision count, minimum mesh clearance, angular velocity, and explicit correct/incorrect verdicts for both variants.

- [ ] **Step 6: Run image tests and artifact integrity checks**

Run: `python -m pytest imgToAction/tests/test_make_blender_first_ab_review.py -q`

Verify every expected PNG exists, dimensions match, the GIF contains more than one frame, and no image is byte-identical between the reference and corrected frame 150 passes.

- [ ] **Step 7: Commit the evidence tooling**

```bash
git add imgToAction/tools/make_blender_first_ab_review.py imgToAction/tests/test_make_blender_first_ab_review.py
git commit -m "feat: generate Blender-first A/B review evidence"
```

### Task 6: Document and perform the final feasibility review

**Files:**
- Modify: `docs/architecture/current-system-topology.md`
- Create: `imgToAction/outputs/actions/blender_first_thinking_poc/review/feasibility_report.md`
- Read: `docs/superpowers/specs/2026-07-15-blender-first-thinking-poc-design.md`

- [ ] **Step 1: Update architecture documentation**

Document the experimental Blender-first path, Windows Blender headless invocation from WSL, the proxy control-chain boundary, generated evidence locations, and the explicit rule that VMD export is deferred pending user approval.

- [ ] **Step 2: Run all focused tests**

Run:

```bash
python -m pytest \
  imgToAction/tests/test_blender_first_motion_math.py \
  imgToAction/tests/test_blender_first_thinking_poc_cli.py \
  imgToAction/tests/test_make_blender_first_ab_review.py -q
```

Expected: PASS.

- [ ] **Step 3: Reproduce the complete POC from the checked-in scripts**

Run Blender headlessly from the unchanged v15 review blend and v16 VMD. Confirm the output blend, metrics, screenshots, and GIF are regenerated without MCP or manual Blender interaction.

- [ ] **Step 4: Verify no VMD was produced or modified**

Check repository status and output timestamps. The experiment must not create `v17.vmd` or modify v16.

- [ ] **Step 5: Write the feasibility verdict**

State whether the static pose passed, whether the transition passed, which constraints improved, which defects remain, and whether the evidence supports continuing to full v17.

- [ ] **Step 6: Commit documentation and final report**

```bash
git add docs/architecture/current-system-topology.md imgToAction/outputs/actions/blender_first_thinking_poc/review/feasibility_report.md
git commit -m "docs: record Blender-first motion feasibility result"
```
