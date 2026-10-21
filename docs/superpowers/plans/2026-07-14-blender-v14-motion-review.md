# Blender v14 Motion Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use Blender MCP and mmd_tools to inspect the Eula v14 thinking motion against the real PMX mesh, correct only evidenced defects, and retain Gate plus four-view visual proof.

**Architecture:** Import the complete PMX package and v14 VMD into an isolated Blender scene. Treat Blender as a mesh/anatomy diagnostic layer, while keeping `gen_elegant_thinking_generated_v14.py` as the authoritative procedural source; any accepted correction becomes a new VMD version instead of overwriting v14.

**Tech Stack:** Blender 5.1, Blender MCP, mmd_tools, Python VMD generator, motion acceptance Gate, Playwright four-view renderer.

---

### Task 1: Build the isolated Blender review scene

**Files:**
- Read: `MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx`
- Read: `imgToAction/outputs/vmd/eula_elegant_thinking_generated_v14.vmd`
- Create: `imgToAction/outputs/blender/eula_elegant_thinking_generated_v14_review.blend`

- [ ] Clear only the MCP-owned Blender scene.
- [ ] Import the PMX at mmd_tools scale `0.08`, preserving armature, mesh, morphs, display frames, and physics.
- [ ] Select the imported MMD root and import v14 with PMX bone mapping, scale `0.08`, and no frame margin.
- [ ] Confirm frame range `0-240`, 30 fps, one armature action, meshes, materials, and Japanese MMD bone metadata.
- [ ] Save the review `.blend` without modifying either source asset.

### Task 2: Produce Blender-side diagnostics

**Files:**
- Create: `imgToAction/outputs/blender/eula_elegant_thinking_generated_v14_diagnostics.json`

- [ ] Sample frames `0, 28, 60, 90, 122, 130, 137, 146, 150, 180, 210, 240`.
- [ ] Record world-space head, chin proxy, shoulders, elbows, wrists, finger tips, pelvis, knees, ankles, and feet.
- [ ] Record elbow angles, shoulder-wrist reach, wrist orientation deltas, contact drift, and frame-to-frame angular velocity.
- [ ] Evaluate the deformed mesh at contact frames and identify right-hand/head, right-forearm/chest, and left-hand/waist intersections.

### Task 3: Decide whether correction is required

**Files:**
- Read: `imgToAction/outputs/actions/elegant_thinking_generated_v14_professional_review/gate_report.json`
- Read: `imgToAction/outputs/actions/elegant_thinking_generated_v14_professional_review/professional_motion_metrics.md`

- [ ] Compare Blender mesh evidence with the existing `17 PASS / 1 WARN / 0 FAIL` baseline.
- [ ] Classify every finding as coordinate mismatch, anatomical violation, mesh-thickness collision, hand-shape issue, timing issue, or camera-only visual ambiguity.
- [ ] Keep v14 unchanged if Blender finds no P0 defect.
- [ ] If a P0 defect exists, define the smallest generator-level correction and create v15; do not hand-edit only the `.blend` action.

### Task 4: Regenerate and verify any corrected motion

**Files:**
- Modify only if required: `imgToAction/tools/gen_elegant_thinking_generated_v15.py`
- Create only if required: `imgToAction/outputs/vmd/eula_elegant_thinking_generated_v15.vmd`
- Test only if required: `imgToAction/tests/test_elegant_thinking_generated_v15.py`

- [ ] Add a failing regression assertion for each confirmed Blender defect.
- [ ] Generate the new VMD from the procedural source.
- [ ] Run the focused generator tests.
- [ ] Export rendered joint data and run `motion_acceptance_gate.py` with `--left-arm-policy akimbo`.
- [ ] Require all P0 gates to pass and fewer than three P1 warnings.

### Task 5: Produce final visual evidence

**Files:**
- Create: `imgToAction/outputs/actions/elegant_thinking_generated_v15_blender_review/` only if v15 is required
- Otherwise update diagnostics under: `imgToAction/outputs/blender/`

- [ ] Render front, left, right, and back views with the whole character visible.
- [ ] Generate per-view GIFs and a combined four-view GIF.
- [ ] Include a review table stating the action phase, observed effect, and correct/incorrect verdict for each sampled frame.
- [ ] Link Blender diagnostics, Gate report, screenshots, and GIFs in the final report.
