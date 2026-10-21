from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


TOOL_PATH = (
    Path(__file__).resolve().parents[1]
    / "tools"
    / "blender_sleeve_corrective_morph.py"
)


def load_tool():
    spec = importlib.util.spec_from_file_location(
        "blender_sleeve_corrective_morph", TOOL_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def valid_cli(tmp_path: Path) -> list[str]:
    blend = tmp_path / "thinking.blend"
    blend.write_bytes(b"BLENDER")
    metrics = tmp_path / "static_pose_metrics.json"
    metrics.write_text(
        json.dumps({"candidate_table": [{"source_id": "candidate_4330"}]}),
        encoding="utf-8",
    )
    output_dir = tmp_path / "morph-runs"
    return [
        "--source-blend",
        str(blend),
        "--source-static-metrics",
        str(metrics),
        "--source-candidate-id",
        "candidate_4330",
        "--output-dir",
        str(output_dir),
        "--run-id",
        "run-20260715-morph-001",
    ]


def test_module_loads_without_blender_python():
    tool = load_tool()

    assert tool.bpy is None
    assert tool.SHAPE_KEY_NAME == "思考_右袖修正"
    assert tool.ALLOWED_VERTEX_GROUPS == ("右手捩1", "右手捩2", "右手捩3")


def test_parse_args_after_blender_separator_and_build_isolated_paths(tmp_path):
    tool = load_tool()
    argv = ["blender", "--background", "thinking.blend", "--", *valid_cli(tmp_path)]

    config = tool.parse_args(argv)
    paths = tool.run_paths(config.output_dir, config.run_id)

    assert config.source_candidate_id == "candidate_4330"
    assert config.max_iterations == 16
    assert paths.temporary.name == ".tmp-run-20260715-morph-001"
    assert paths.final.name == "run-20260715-morph-001"
    assert paths.metrics == paths.final / "sleeve_corrective_morph_metrics.json"


def test_parse_args_rejects_existing_run_without_overwrite(tmp_path):
    tool = load_tool()
    argv = valid_cli(tmp_path)
    config = tool.parse_args(argv)
    tool.run_paths(config.output_dir, config.run_id).final.mkdir(parents=True)

    with pytest.raises(ValueError, match="already exists"):
        tool.parse_args(argv)


def test_find_source_candidate_accepts_common_metric_tables_and_rejects_missing():
    tool = load_tool()
    metrics = {
        "candidates": [{"source_candidate_id": "candidate_764"}],
        "candidate_table": [{"source_id": "candidate_4330", "score": 1.0}],
    }

    record = tool.find_source_candidate(metrics, "candidate_4330")

    assert record["score"] == 1.0
    with pytest.raises(ValueError, match="not found"):
        tool.find_source_candidate(metrics, "candidate_9999")


def test_compensation_source_resolves_arm_candidate_and_upper_body_parameters():
    tool = load_tool()
    record = {
        "source_candidate_id": "pole3d_0227__comp_065",
        "arm_source_candidate_id": "pole3d_0227",
        "parameters": {
            "compensation": {
                "upper_chest_turn_deg": 0.0,
                "upper_chest_lean_deg": -2.0,
                "shoulder_retract_deg": 1.5,
                "shoulder_elevate_deg": 0.0,
                "neck_toward_deg": 2.0,
                "head_toward_deg": 2.5,
            }
        },
        "metrics": {
            "collision_after_compensation": {
                "torso_collision_attribution": {
                    "counts_by_moving_region": {"forearm": 69, "hand": 20},
                    "counts_by_moving_group": {"右手捩2": 56, "右中指３": 20},
                }
            }
        },
    }
    metrics = {"compensation_candidates": [record]}

    resolved = tool.resolve_source_pose(metrics, "pole3d_0227__comp_065")

    assert resolved.arm_candidate_id == "pole3d_0227"
    assert resolved.compensation["upper_chest_lean_deg"] == -2.0
    assert resolved.expected_focused_overlap == 69
    assert resolved.excluded_hand_overlap == 20
    assert "右中指３" not in tool.ALLOWED_VERTEX_GROUPS


def test_weighted_vertex_whitelist_uses_only_allowed_groups_above_threshold():
    tool = load_tool()
    memberships = {
        0: ((1, 0.8),),
        1: ((2, 0.21), (9, 0.9)),
        2: ((3, 0.19),),
        3: ((9, 1.0),),
    }

    result = tool.weighted_vertex_indices(memberships, {1, 2, 3}, 0.2)

    assert result == {0, 1}


def test_boundary_vertices_are_fixed_when_an_edge_leaves_allowed_region():
    tool = load_tool()
    allowed = {0, 1, 2, 3}
    edges = ((0, 1), (1, 2), (2, 3), (3, 4))

    adjacency, boundary = tool.allowed_adjacency_and_boundary(allowed, edges)

    assert adjacency[2] == {1, 3}
    assert boundary == {3}


def test_adjacency_diffusion_preserves_seed_direction_and_fixed_boundary():
    tool = load_tool()
    adjacency = {
        0: {1},
        1: {0, 2},
        2: {1, 3},
        3: {2},
    }
    seeds = {0: (0.0, 0.0, 1.0)}

    result = tool.diffuse_world_displacements(
        seeds,
        adjacency,
        fixed={3},
        iterations=3,
        decay=0.5,
    )

    assert result[0][2] == pytest.approx(1.0)
    assert 0.0 < result[1][2] < result[0][2]
    assert result[3] == (0.0, 0.0, 0.0)


def test_batch_xyz_epsilon_samples_build_per_vertex_jacobians():
    tool = load_tool()
    base = {4: (1.0, 2.0, 3.0), 7: (-1.0, 0.0, 5.0)}
    samples = {
        "x": {4: (1.002, 2.0, 3.0), 7: (-0.998, 0.0, 5.0)},
        "y": {4: (1.0, 2.004, 3.0), 7: (-1.0, 0.004, 5.0)},
        "z": {4: (1.0, 2.0, 3.006), 7: (-1.0, 0.0, 5.006)},
    }

    jacobians = tool.jacobians_from_batch_samples(base, samples, epsilon=0.002)

    expected = ((1.0, 0.0, 0.0), (0.0, 2.0, 0.0), (0.0, 0.0, 3.0))
    for index in (4, 7):
        for actual_row, expected_row in zip(jacobians[index], expected, strict=True):
            assert actual_row == pytest.approx(expected_row)


def test_local_delta_solver_inverts_shape_key_to_world_jacobian():
    tool = load_tool()
    jacobian = ((2.0, 0.0, 0.0), (0.0, 4.0, 0.0), (0.0, 0.0, 5.0))

    delta = tool.solve_local_delta(jacobian, (0.02, -0.04, 0.05))

    assert delta == pytest.approx((0.01, -0.01, 0.01))


def test_local_delta_solver_rejects_singular_jacobian():
    tool = load_tool()

    with pytest.raises(ValueError, match="singular"):
        tool.solve_local_delta(
            ((1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
            (1.0, 0.0, 0.0),
        )


def test_triangle_overlap_keeps_a_small_outward_push_after_vertices_clear_margin():
    tool = load_tool()

    assert tool.outward_push_distance(-0.01, 0.003, intersecting=True) == pytest.approx(
        0.013
    )
    assert tool.outward_push_distance(0.005, 0.003, intersecting=True) == pytest.approx(
        0.0015
    )
    assert tool.outward_push_distance(0.005, 0.003, intersecting=False) == 0.0


def test_morph_quality_rejects_inverted_or_excessively_displaced_mesh():
    tool = load_tool()

    reasons = tool.morph_quality_reasons(
        shape_evidence={"reasons": ["Sleeve corrective mesh contains inverted faces"]},
        max_world_displacement=0.04,
        median_mesh_edge=0.01,
    )

    assert any("inverted" in reason for reason in reasons)
    assert any("three median" in reason for reason in reasons)


def test_morph_quality_accepts_bounded_shape_without_topology_warnings():
    tool = load_tool()

    assert tool.morph_quality_reasons(
        shape_evidence={"reasons": []},
        max_world_displacement=0.02,
        median_mesh_edge=0.01,
    ) == ()


def test_minimum_clear_scale_binary_searches_first_collision_free_value():
    tool = load_tool()

    scale = tool.minimum_clear_scale(lambda value: value >= 0.625, steps=14)

    assert 0.625 <= scale < 0.626


def test_minimum_clear_scale_requires_full_morph_to_be_collision_free():
    tool = load_tool()

    with pytest.raises(ValueError, match="full morph"):
        tool.minimum_clear_scale(lambda _value: False)


def test_laplacian_smoothing_reduces_local_spike_and_keeps_boundary_zero():
    tool = load_tool()
    adjacency = {0: {1}, 1: {0, 2}, 2: {1, 3}, 3: {2}}
    deltas = {
        0: (0.0, 0.0, 0.0),
        1: (0.0, 0.0, 1.0),
        2: (0.0, 0.0, 0.0),
        3: (0.0, 0.0, 0.0),
    }

    result = tool.laplacian_smooth_deltas(
        deltas, adjacency, fixed={0, 3}, iterations=2, strength=0.5
    )

    assert result[0] == (0.0, 0.0, 0.0)
    assert result[3] == (0.0, 0.0, 0.0)
    assert 0.0 < result[1][2] < 1.0
    assert result[2][2] > 0.0


def test_topology_support_expansion_stays_inside_forearm_eligible_vertices():
    tool = load_tool()
    edges = ((0, 1), (1, 2), (2, 3), (3, 4), (2, 9))

    expanded = tool.expand_topology_support(
        core={1}, eligible={0, 1, 2, 3, 4}, edges=edges, rings=2
    )

    assert expanded == {0, 1, 2, 3}
    assert 9 not in expanded
