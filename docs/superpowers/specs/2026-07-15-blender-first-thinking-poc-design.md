# Blender-First Thinking Motion Feasibility Design

## Objective

Validate whether a Blender control-rig workflow can visibly improve the right-arm and right-hand anatomy of the existing Eula elegant-thinking v16 motion before investing in a complete v17 pipeline.

The proof of concept is successful only when the Blender-first result is visibly better than v16, satisfies anatomical constraints, and has no relevant real-mesh penetration. Blender preview is the first review artifact; VMD export is deferred until user approval.

## Scope

- Use the existing Eula PMX, source BVH timing, and v16 motion as the A/B baseline.
- Correct the right shoulder-to-hand chain first, then allow bounded shoulder-girdle, upper-chest, neck, and head compensation when the PMX sleeve thickness makes an arm-only solution geometrically impossible.
- Build a stable pose at frame 150 and a short transition covering frames 90-170.
- Preserve the existing left hand, pelvis, lower body, global timing, and overall motion intent.
- Do not overwrite v16 and do not export a new VMD before visual approval.

## Motion Intent

The right hand uses a light thinking contact rather than placing the entire palm against the face:

- The thumb inside edge lightly supports the underside of the chin.
- The index finger follows the jaw side without covering the central cheek.
- The remaining fingers form a relaxed, progressively curved shape.
- The palm faces diagonally inward and downward.
- The wrist remains near neutral; reach comes primarily from shoulder, elbow, and forearm rotation.
- The elbow remains slightly separated from the torso so the shoulder-elbow-wrist-chin silhouette is continuous.

The complete future motion retains the agreed left-leg weight bias, left-hand akimbo pose, subtle S-curve, and overlapping pelvis, chest, head, and arm timing. Those whole-body refinements are outside this feasibility sample unless required to preserve the existing pose.

## Solver Architecture

The Blender scene becomes an active solving layer rather than a diagnostic-only layer:

1. Import or open the existing Eula PMX review scene and v16 reference action.
2. Add isolated control objects for the right hand target, elbow pole, palm orientation, and chin contact.
3. Drive the upper arm and forearm with a two-bone IK chain and a stable elbow plane.
4. Distribute palm rotation across forearm twist and wrist instead of concentrating it on the wrist bone.
5. Apply hard anatomical limits and softer comfort-zone penalties.
6. Validate the evaluated PMX mesh around the hand, face, forearm, sleeve, chest, and neck.
7. Bake only after the Blender preview passes user review.

The bounded upper-body compensation limits are:

- `上半身2` rotation: at most 4 degrees from the v16 baseline.
- Right shoulder-girdle compensation: at most 3 degrees from the v16 baseline.
- Combined neck/head compensation toward the hand: at most 5 degrees from the v16 baseline.
- Pelvis, left arm, and lower body remain unchanged.

The right-hand pose is part of the contact solve rather than being inherited unchanged from v16. Thumb and index controls may extend toward the lower jaw while the middle, ring, and little fingers retain a relaxed progressive curl. Finger deltas must use calibrated PMX local axes and remain inside the verified finger-motion ranges.

When the anatomical arm pose is correct but the model's thick sleeve intersects the torso, existing weighted auxiliary bones such as `右手捩1/2/3` may be used as bounded clothing corrective bones. Corrective motion must not change shoulder, elbow, wrist, finger, or contact-point transforms, and must remain exportable through ordinary VMD bone frames.

If bounded corrective bones cannot remove the sleeve collision, create a derived PMX copy with a vertex morph named `思考_右袖修正`. The morph may move only the collision-affected right-sleeve vertices, must preserve the original PMX unchanged, and must be zero outside the thinking-contact phase. Morph generation must smooth displacement across the sleeve while pinning the unaffected boundary and must pass the same real-mesh collision and silhouette review.

Blender native IK, pole, local rotation limits, and tracking constraints provide the control rig. Python supplies coupled anatomical checks, swing-twist evaluation, comfort-zone scoring, reproducible scene construction, measurements, and rendering.

## Constraint Priority

Conflicts are resolved in this order:

1. Prevent joint reversal, impossible combined rotations, and material mesh penetration.
2. Preserve stable feet and credible body support inherited from the baseline.
3. Preserve thinking-contact and akimbo semantics.
4. Preserve continuous shoulder, elbow, forearm, wrist, and palm silhouettes.
5. Preserve smooth timing and contact stability.
6. Match the original BVH joint positions where compatible with the above constraints.

Joint validity uses two layers:

- Hard anatomical limits reject impossible poses.
- Soft comfort zones cause the solver to redistribute motion through the shoulder, elbow, forearm twist, and wrist before approaching a joint extreme.

## A/B Evidence

The review package contains:

- A static four-view comparison at frame 150.
- A synchronized frame 90-170 comparison GIF.
- One combined layout with v16 on the left and Blender-first on the right; each side includes front, left, right, and back views.
- Matching camera, framing, frame range, and playback rate for both variants.
- A metrics table covering elbow angle, wrist swing and twist, contact drift, and real-mesh clearance.
- An anatomical verdict identifying every failed or warned constraint.

The whole character remains visible in every view. Close-up evidence may be added, but it cannot replace the four full-body views.

## Acceptance Criteria

The Blender-first hypothesis is validated only if all of the following hold:

- The forearm-to-palm silhouette is visibly continuous, without a broken-wrist appearance.
- The elbow bends in a stable human direction without flipping or hyperextension.
- Wrist swing remains in the comfort region and forearm twist carries the required palm rotation.
- The thumb or index-side contact stays at the lower jaw without the palm entering the face.
- No relevant hand-head, forearm-chest, sleeve-torso, or neck penetration exists in the evaluated mesh.
- The Blender-first result is visibly better than v16 in the synchronized A/B review.
- Programmatic checks pass, and the user accepts the visual result.

If the static pose cannot satisfy these criteria, the experiment stops before animation work. If the static pose passes but the short transition fails, the experiment is recorded as insufficient for a reusable pipeline. A programmatic pass cannot override a failed visual review.

## Deliverables And Deferrals

Initial deliverables:

- Reproducible Blender Python setup and measurement scripts.
- A separate proof-of-concept `.blend` file.
- Frame 150 four-view A/B screenshots.
- Frame 90-170 synchronized A/B GIF.
- Metrics and anatomical review report.

Deferred until user approval:

- Baking the corrected action to PMX deform bones.
- Exporting a test VMD.
- Building the complete frame 0-240 v17 motion.
- Generalizing calibration to additional PMX models.
