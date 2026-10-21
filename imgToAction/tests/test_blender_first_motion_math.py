import importlib.util
import math
from pathlib import Path
import sys

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "blender_first_motion_math.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("blender_first_motion_math", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def distance(left, right):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right, strict=True)))


def test_unreachable_target_can_be_clamped_or_rejected():
    tool = load_tool()

    clamped = tool.clamped_two_bone_reach(
        root=(0.0, 0.0, 0.0),
        target=(3.0, 0.0, 0.0),
        upper_length=1.0,
        lower_length=1.0,
    )

    assert clamped.reachable is False
    assert clamped.clamped is True
    assert clamped.end == pytest.approx((2.0, 0.0, 0.0))
    assert clamped.solved_distance == pytest.approx(2.0)

    with pytest.raises(tool.UnreachableTargetError, match="outside the two-bone reach interval"):
        tool.clamped_two_bone_reach(
            root=(0.0, 0.0, 0.0),
            target=(3.0, 0.0, 0.0),
            upper_length=1.0,
            lower_length=1.0,
            reject_unreachable=True,
        )


def test_two_bone_solution_preserves_both_segment_lengths():
    tool = load_tool()

    solution = tool.solve_two_bone(
        root=(0.0, 0.0, 0.0),
        target=(1.2, 0.4, 0.0),
        upper_length=1.0,
        lower_length=0.8,
        pole=(0.0, 0.0, 1.0),
    )

    assert distance(solution.root, solution.elbow) == pytest.approx(1.0)
    assert distance(solution.elbow, solution.end) == pytest.approx(0.8)


def test_elbow_candidate_is_selected_on_the_pole_facing_side():
    tool = load_tool()
    root = (0.0, 0.0, 0.0)
    target = (1.0, 0.0, 0.0)
    pole = (0.0, 0.0, 1.0)

    solution = tool.solve_two_bone(root, target, 1.0, 1.0, pole)

    projected_pole = tool.project_onto_plane(tool.vector_subtract(pole, root), target)
    elbow_offset = tool.project_onto_plane(tool.vector_subtract(solution.elbow, root), target)
    assert tool.dot(elbow_offset, projected_pole) > 0.0


def test_pole_facing_candidate_wins_when_previous_elbow_is_opposite():
    tool = load_tool()
    root = (0.0, 0.0, 0.0)
    target = (1.0, 0.0, 0.0)
    pole = (0.0, 0.0, 1.0)
    candidates = tool.elbow_candidates(root, target, 1.0, 1.0, pole)
    pole_opposite = min(candidates, key=lambda elbow: tool.elbow_side(root, target, elbow, pole))

    selected = tool.select_elbow_candidate(
        candidates,
        root,
        target,
        pole,
        previous_elbow=pole_opposite,
    )

    assert tool.elbow_side(root, target, selected, pole) > 0.0


def test_adjacent_targets_keep_the_same_elbow_side():
    tool = load_tool()
    root = (0.0, 0.0, 0.0)
    pole = (0.0, 0.0, 1.0)
    first = tool.solve_two_bone(root, (1.0, 0.0, 0.0), 1.0, 1.0, pole)
    second = tool.solve_two_bone(
        root,
        (1.0, 0.01, 0.0),
        1.0,
        1.0,
        pole,
        previous_elbow=first.elbow,
    )

    first_sign = tool.elbow_side(root, first.end, first.elbow, pole)
    second_sign = tool.elbow_side(root, second.end, second.elbow, pole)
    assert first_sign > 0.0
    assert second_sign > 0.0
    assert distance(first.elbow, second.elbow) < 0.05


@pytest.mark.parametrize("target_distance", [0.0, 0.5e-9])
def test_equal_length_chain_rejects_zero_axis_target(target_distance):
    tool = load_tool()

    with pytest.raises(tool.UnreachableTargetError, match="singular"):
        tool.solve_two_bone(
            root=(0.0, 0.0, 0.0),
            target=(target_distance, 0.0, 0.0),
            upper_length=1.0,
            lower_length=1.0,
            pole=(0.0, 0.0, 1.0),
        )


def test_reachability_and_clamping_are_consistent_near_max_boundary():
    tool = load_tool()
    inside = tool.clamped_two_bone_reach(
        root=(0.0, 0.0, 0.0),
        target=(2.0 - 0.5e-9, 0.0, 0.0),
        upper_length=1.0,
        lower_length=1.0,
    )
    outside = tool.clamped_two_bone_reach(
        root=(0.0, 0.0, 0.0),
        target=(2.0 + 0.5e-9, 0.0, 0.0),
        upper_length=1.0,
        lower_length=1.0,
    )

    assert inside.reachable is True
    assert inside.clamped is False
    assert inside.solved_distance == inside.original_distance
    assert outside.reachable is False
    assert outside.clamped is True
    assert outside.solved_distance == 2.0


def test_projection_and_signed_angle_use_tuple_vectors():
    tool = load_tool()

    assert tool.project_onto_plane((1.0, 2.0, 3.0), (0.0, 0.0, 1.0)) == pytest.approx((1.0, 2.0, 0.0))
    assert tool.signed_angle((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)) == pytest.approx(90.0)
    assert tool.signed_angle((1.0, 0.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, 1.0)) == pytest.approx(-90.0)


def test_surface_push_moves_penetrating_point_past_safety_margin():
    tool = load_tool()

    displacement = tool.required_surface_push(
        point=(-0.2, 0.0, 0.0),
        surface_point=(0.0, 0.0, 0.0),
        outward_normal=(1.0, 0.0, 0.0),
        safety_margin=0.05,
    )

    assert displacement == pytest.approx((0.25, 0.0, 0.0))


def test_surface_push_is_zero_when_point_already_has_clearance():
    tool = load_tool()

    displacement = tool.required_surface_push(
        point=(0.08, 0.0, 0.0),
        surface_point=(0.0, 0.0, 0.0),
        outward_normal=(1.0, 0.0, 0.0),
        safety_margin=0.05,
    )

    assert displacement == pytest.approx((0.0, 0.0, 0.0))


def test_corrective_field_diffuses_from_core_and_pins_outer_boundary():
    tool = load_tool()
    adjacency = {
        0: {1},
        1: {0, 2},
        2: {1, 3},
        3: {2, 4},
        4: {3},
    }

    field = tool.smooth_corrective_displacements(
        adjacency=adjacency,
        allowed_vertices={0, 1, 2, 3, 4},
        core_displacements={2: (1.0, 0.0, 0.0)},
        propagation_rings=2,
        iterations=80,
    )

    assert set(field) == {0, 1, 2, 3, 4}
    assert field[0] == pytest.approx((0.0, 0.0, 0.0))
    assert field[1] == pytest.approx((0.5, 0.0, 0.0), abs=1e-4)
    assert field[2] == pytest.approx((1.0, 0.0, 0.0))
    assert field[3] == pytest.approx((0.5, 0.0, 0.0), abs=1e-4)
    assert field[4] == pytest.approx((0.0, 0.0, 0.0))


def test_corrective_field_never_crosses_outside_allowed_sleeve_vertices():
    tool = load_tool()
    adjacency = {
        0: {1},
        1: {0, 2, 5},
        2: {1, 3},
        3: {2, 4},
        4: {3},
        5: {1},
    }

    field = tool.smooth_corrective_displacements(
        adjacency=adjacency,
        allowed_vertices={0, 1, 2, 3, 4},
        core_displacements={2: (0.0, 1.0, 0.0)},
        propagation_rings=2,
        iterations=20,
    )

    assert 5 not in field
    assert field[0] == pytest.approx((0.0, 0.0, 0.0))
    assert field[4] == pytest.approx((0.0, 0.0, 0.0))


def test_continuity_score_prefers_nearby_same_side_candidate():
    tool = load_tool()
    previous = (0.5, 0.0, 0.8)

    same_side = tool.continuity_score(
        candidate=(0.51, 0.01, 0.79),
        previous=previous,
        root=(0.0, 0.0, 0.0),
        end=(1.0, 0.0, 0.0),
    )
    flipped = tool.continuity_score(
        candidate=(0.5, 0.0, -0.8),
        previous=previous,
        root=(0.0, 0.0, 0.0),
        end=(1.0, 0.0, 0.0),
    )

    assert same_side < flipped


def test_anatomical_score_rejects_hard_elbow_reversal():
    tool = load_tool()

    result = tool.score_anatomy(
        elbow_angle_deg=-2.0,
        wrist_swing_deg=10.0,
        forearm_twist_deg=20.0,
    )

    assert result.valid is False
    assert result.measurements["elbow_angle_deg"] == -2.0
    assert any("reversed" in reason for reason in result.reasons)


def test_elbow_and_wrist_comfort_ranges_have_no_penalty():
    tool = load_tool()

    result = tool.score_anatomy(
        elbow_angle_deg=75.0,
        wrist_swing_deg=20.0,
        forearm_twist_deg=30.0,
    )

    assert result.valid is True
    assert result.component_penalties["elbow"] == 0.0
    assert result.component_penalties["wrist_swing"] == 0.0
    assert result.component_penalties["forearm_twist"] == 0.0
    assert result.total_penalty == 0.0


def test_forearm_twist_allocation_is_bounded_and_preserves_requested_twist():
    tool = load_tool()

    allocation = tool.allocate_forearm_twist(110.0)

    assert allocation.forearm_twist_deg == tool.FOREARM_TWIST_HARD_MAX_DEG
    assert allocation.wrist_twist_deg == pytest.approx(110.0 - tool.FOREARM_TWIST_HARD_MAX_DEG)
    assert allocation.forearm_twist_deg + allocation.wrist_twist_deg == pytest.approx(110.0)


def test_soft_penalties_increase_toward_hard_limits():
    tool = load_tool()

    comfortable = tool.score_anatomy(75.0, 20.0, 30.0)
    near_limit = tool.score_anatomy(25.0, 50.0, 75.0)

    assert near_limit.valid is True
    assert near_limit.component_penalties["elbow"] > comfortable.component_penalties["elbow"]
    assert near_limit.component_penalties["wrist_swing"] > comfortable.component_penalties["wrist_swing"]
    assert near_limit.component_penalties["forearm_twist"] > comfortable.component_penalties["forearm_twist"]
    assert near_limit.total_penalty > comfortable.total_penalty
    assert any("comfort" in reason for reason in near_limit.reasons)


def candidate_score(tool, **overrides):
    measurements = {
        "elbow_angle_deg": 78.0,
        "signed_elbow_flex_deg": -102.0,
        "pole_side": 0.12,
        "wrist_swing_deg": 12.0,
        "wrist_twist_deg": 8.0,
        "forearm_twist_deg": 32.0,
        "contact_error": 0.006,
        "head_penetration_depth": 0.0,
        "head_collision_count": 0,
        "torso_penetration_count": 0,
        "minimum_clearance": 0.004,
        "continuity_distance": 0.015,
        "matrices_finite": True,
    }
    measurements.update(overrides)
    return tool.score_static_candidate(**measurements)


def test_neutral_wrist_outranks_folded_wrist_candidate():
    tool = load_tool()

    neutral = candidate_score(tool, wrist_swing_deg=10.0)
    folded = candidate_score(tool, wrist_swing_deg=48.0)

    assert neutral.valid is True
    assert folded.valid is True
    assert neutral.total_score < folded.total_score
    assert folded.component_penalties["wrist_swing"] > neutral.component_penalties["wrist_swing"]


def test_pole_facing_elbow_outranks_and_rejects_flipped_elbow():
    tool = load_tool()

    pole_facing = candidate_score(tool, pole_side=0.08)
    flipped = candidate_score(tool, pole_side=-0.01)

    assert pole_facing.valid is True
    assert flipped.valid is False
    assert math.isfinite(flipped.total_score)
    assert pole_facing.total_score < flipped.total_score
    assert any("pole-facing" in reason for reason in flipped.reasons)


def test_lower_jaw_contact_outranks_distant_contact():
    tool = load_tool()

    lower_jaw = candidate_score(tool, contact_error=0.004)
    distant = candidate_score(tool, contact_error=0.045)

    assert lower_jaw.valid is True
    assert distant.valid is True
    assert lower_jaw.total_score < distant.total_score
    assert distant.component_penalties["contact"] > lower_jaw.component_penalties["contact"]


def test_contact_above_thinking_maximum_is_hard_rejected_with_reason():
    tool = load_tool()

    result = candidate_score(tool, contact_error=0.0681)

    assert result.valid is False
    assert result.verdict == "FAIL"
    assert any("maximum" in reason and "contact" in reason.lower() for reason in result.reasons)


def test_contact_and_elbow_comfort_combination_outranks_low_elbow_contact():
    tool = load_tool()

    comfortable = candidate_score(tool, contact_error=0.025, elbow_angle_deg=62.0)
    low_elbow = candidate_score(tool, contact_error=0.020, elbow_angle_deg=49.0)

    assert comfortable.valid is True
    assert low_elbow.valid is True
    assert comfortable.total_score < low_elbow.total_score
    assert any("Elbow" in reason and "comfort" in reason for reason in low_elbow.reasons)


def test_nonpenetrating_candidate_outranks_and_rejects_face_penetration():
    tool = load_tool()

    clear = candidate_score(tool, head_penetration_depth=0.0)
    penetrating = candidate_score(tool, head_penetration_depth=0.003)

    assert clear.valid is True
    assert penetrating.valid is False
    assert math.isfinite(penetrating.total_score)
    assert clear.total_score < penetrating.total_score
    assert any("head penetration" in reason for reason in penetrating.reasons)


def test_head_collision_count_is_hard_rejected_even_without_signed_depth():
    tool = load_tool()

    result = candidate_score(tool, head_penetration_depth=0.0, head_collision_count=1)

    assert result.valid is False
    assert result.verdict == "FAIL"
    assert any("head collision" in reason.lower() for reason in result.reasons)


def test_continuous_candidate_outranks_and_rejects_large_discontinuity():
    tool = load_tool()

    continuous = candidate_score(tool, continuity_distance=0.01)
    discontinuous = candidate_score(tool, continuity_distance=0.25)

    assert continuous.valid is True
    assert discontinuous.valid is False
    assert continuous.total_score < discontinuous.total_score
    assert any("discontinuity" in reason for reason in discontinuous.reasons)


def test_nonfinite_candidate_measurement_is_rejected_without_raising():
    tool = load_tool()

    result = candidate_score(tool, contact_error=math.nan)

    assert result.valid is False
    assert math.isfinite(result.total_score)
    assert result.measurements["contact_error"] == 0.0
    assert any("non-finite" in reason for reason in result.reasons)


def test_named_warning_reasons_drive_warn_verdict():
    tool = load_tool()

    result = candidate_score(
        tool,
        contact_error=0.04,
        minimum_clearance=0.002,
        continuity_distance=0.04,
    )

    assert result.valid is True
    assert result.verdict == "WARN"
    assert any("contact warning" in reason.lower() for reason in result.reasons)
    assert any("clearance warning" in reason.lower() for reason in result.reasons)
    assert any("continuity warning" in reason.lower() for reason in result.reasons)


def test_closest_point_on_triangle_handles_touching_and_separated_points():
    tool = load_tool()
    triangle = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))

    touching = tool.closest_point_on_triangle((0.25, 0.25, 0.0), *triangle)
    separated = tool.closest_point_on_triangle((0.25, 0.25, 0.5), *triangle)

    assert touching.point == pytest.approx((0.25, 0.25, 0.0))
    assert touching.distance == pytest.approx(0.0)
    assert sum(touching.barycentric) == pytest.approx(1.0)
    assert separated.point == pytest.approx((0.25, 0.25, 0.0))
    assert separated.distance == pytest.approx(0.5)


def test_contact_band_is_derived_from_local_mesh_resolution():
    tool = load_tool()

    band = tool.derive_contact_band([0.001, 0.002, 0.002, 0.003])

    assert band.mesh_resolution == pytest.approx(0.002)
    assert band.target_distance == pytest.approx(0.003)
    assert band.warning_distance == pytest.approx(0.004)
    assert band.hard_max_distance == pytest.approx(0.006)
    assert band.region_radius == pytest.approx(0.024)


def test_surface_contact_classification_distinguishes_separation_and_intersection():
    tool = load_tool()
    band = tool.derive_contact_band([0.002, 0.002, 0.002])

    touching = tool.classify_surface_contact(0.0025, 0, band)
    separated = tool.classify_surface_contact(0.005, 0, band)
    intersecting = tool.classify_surface_contact(0.0, 1, band)

    assert touching == ("PASS", ())
    assert separated[0] == "WARN"
    assert any("surface distance" in reason for reason in separated[1])
    assert intersecting[0] == "FAIL"
    assert any("intersection" in reason for reason in intersecting[1])
