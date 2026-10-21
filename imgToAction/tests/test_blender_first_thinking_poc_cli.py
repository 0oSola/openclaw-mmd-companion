import importlib.util
import inspect
import math
from pathlib import Path
import shutil
import sys
import uuid

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "blender_first_thinking_poc.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("blender_first_thinking_poc", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def cli_tmp_path():
    path = PROJECT_ROOT / ".pytest-tmp" / f"blender-first-cli-{uuid.uuid4().hex}"
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def valid_cli(tmp_path):
    source_blend = tmp_path / "source.blend"
    source_blend.touch()
    vmd = tmp_path / "reference.vmd"
    vmd.touch()
    output_blend = tmp_path / "eula_elegant_thinking_blender_first_poc.blend"
    output_dir = tmp_path / "blender_first_thinking_poc"
    return [
        "blender.exe",
        "--background",
        str(source_blend),
        "--python",
        str(TOOL_PATH),
        "--",
        "--source-blend",
        str(source_blend),
        "--vmd",
        str(vmd),
        "--output-blend",
        str(output_blend),
        "--output-dir",
        str(output_dir),
        "--setup-only",
    ]


def valid_solve_cli(tmp_path):
    poc_blend = tmp_path / "eula_elegant_thinking_blender_first_poc.blend"
    poc_blend.touch()
    output_dir = tmp_path / "blender_first_thinking_poc"
    return [
        "blender.exe",
        "--background",
        str(poc_blend),
        "--python",
        str(TOOL_PATH),
        "--",
        "--source-blend",
        str(poc_blend),
        "--output-blend",
        str(poc_blend),
        "--output-dir",
        str(output_dir),
        "--search-static",
        "--run-id",
        "run-20260715-001",
    ]


def valid_select_cli(tmp_path):
    argv = valid_solve_cli(tmp_path)
    argv[argv.index("--search-static")] = "--select-static"
    argv.extend(["--source-candidate-id", "candidate_0042"])
    run_dir = Path(argv[argv.index("--output-dir") + 1]) / "runs" / "run-20260715-001"
    run_dir.mkdir(parents=True)
    (run_dir / "static_pose_metrics.json").write_text('{"candidates": []}', encoding="utf-8")
    return argv


def valid_gallery_cli(tmp_path):
    argv = valid_solve_cli(tmp_path)
    argv[argv.index("--search-static")] = "--orientation-gallery"
    argv[argv.index("run-20260715-001")] = "run-20260715-orientation-001"
    source_metrics = tmp_path / "source_static_metrics.json"
    source_metrics.write_text(
        '{"candidates":[{"source_candidate_id":"candidate_764","parameters":{}}],'
        '"semantic_finger_search":{"seed_metrics":{"candidate_764":{}}}}',
        encoding="utf-8",
    )
    argv.extend([
        "--source-candidate-id", "candidate_764",
        "--source-static-metrics", str(source_metrics),
    ])
    return argv


def valid_chin_support_cli(tmp_path):
    argv = valid_gallery_cli(tmp_path)
    argv[argv.index("--orientation-gallery")] = "--chin-support-refinement"
    argv[argv.index("run-20260715-orientation-001")] = "run-20260715-chin-support-001"
    argv.extend([
        "--orientation-source-id",
        "gallery_14_thumb_opposition_m15_sxp00_tzm10_thumb_opposed_base",
    ])
    gallery_metrics = tmp_path / "orientation_gallery_metrics.json"
    gallery_metrics.write_text(
        '{"variant_table":[{"source_id":'
        '"gallery_14_thumb_opposition_m15_sxp00_tzm10_thumb_opposed_base",'
        '"evaluated_pose_hash":"g14"}]}',
        encoding="utf-8",
    )
    argv.extend(["--orientation-gallery-metrics", str(gallery_metrics)])
    return argv


def valid_collision_severity_cli(tmp_path):
    argv = valid_gallery_cli(tmp_path)
    argv[argv.index("--orientation-gallery")] = "--collision-severity-diagnostic"
    argv[argv.index("run-20260715-orientation-001")] = "run-20260715-collision-severity-001"
    source_id_index = argv.index("--source-candidate-id")
    del argv[source_id_index:source_id_index + 2]
    return argv


def valid_sleeve_corrective_cli(tmp_path):
    argv = valid_collision_severity_cli(tmp_path)
    argv[argv.index("--collision-severity-diagnostic")] = "--sleeve-corrective-feasibility"
    argv[argv.index("run-20260715-collision-severity-001")] = "run-20260715-sleeve-corrective-001"
    return argv


def test_module_loads_without_blender_python():
    tool = load_tool()

    assert tool.bpy is None
    assert tool.REFERENCE_ACTION_NAME == "POC_v16_reference"


def test_proxy_bones_preserve_matching_source_rest_orientation():
    tool = load_tool()

    assert tool.PROXY_SOURCE_BONES == {
        "POC_右腕_CTRL": "右腕",
        "POC_右ひじ_CTRL": "右ひじ",
        "POC_右手_CTRL": "右手首",
    }


def test_sleeve_corrective_constraints_are_local_before_deltas():
    tool = load_tool()

    assert tool.SLEEVE_CORRECTIVE_BONES == ("右手捩1", "右手捩2", "右手捩3")
    assert set(tool.SLEEVE_CORRECTIVE_CONSTRAINT_SPECS) == set(tool.SLEEVE_CORRECTIVE_BONES)
    assert all(
        spec == {
            "owner_bone": bone_name,
            "owner_space": "LOCAL",
            "target_space": "LOCAL",
            "mix_mode": "BEFORE",
        }
        for bone_name, spec in tool.SLEEVE_CORRECTIVE_CONSTRAINT_SPECS.items()
    )


def test_chin_support_grid_reaches_measured_positive_y_contact_gap():
    tool = load_tool()

    offsets = {
        refinement.hand_target_offset
        for refinement in tool.chin_support_refinement_grid()
    }

    assert (0.0, 0.035, 0.0) in offsets
    assert (0.0, 0.05, 0.0) in offsets
    assert max(offset[1] for offset in offsets) == pytest.approx(0.06)
    assert all(abs(offset[0]) <= 0.006 for offset in offsets)
    assert all(abs(offset[2]) <= 0.006 for offset in offsets)
    assert any(
        refinement.hand_target_offset[1] >= 0.05
        and refinement.upper_chest_lean_deg == pytest.approx(-2.0)
        and refinement.shoulder_retract_deg == pytest.approx(1.5)
        and refinement.neck_toward_deg == pytest.approx(2.0)
        and refinement.head_toward_deg == pytest.approx(2.5)
        for refinement in tool.chin_support_refinement_grid()
    )


def test_proxy_elbow_uses_calibrated_one_direction_local_z_hinge():
    tool = load_tool()

    assert tool.ELBOW_HINGE_AXIS == "Z"
    assert tool.ELBOW_IK_LOCKS == {"X": True, "Y": True, "Z": False}
    assert tool.ELBOW_IK_MIN_DEG == -150.0
    assert tool.ELBOW_IK_MAX_DEG == 0.0
    assert tool.ELBOW_FLEX_MIN_DEG == -150.0
    assert tool.ELBOW_FLEX_MAX_DEG == -5.0
    assert tool.signed_elbow_flex_is_valid(-108.27) is True
    assert tool.signed_elbow_flex_is_valid(1.0) is False
    assert tool.signed_elbow_flex_is_valid(-170.0) is False


def test_deform_constraints_use_inverse_calibrated_proxy_subtargets():
    tool = load_tool()

    assert tool.CONSTRAINT_SPECS["upper"] == {
        "owner_bone": "右腕",
        "target_bone": "POC_右腕_CTRL",
        "constraint_type": "CHILD_OF",
        "rotation_axes": "XYZ",
        "calibrate_inverse": True,
    }
    assert tool.CONSTRAINT_SPECS["elbow"] == {
        "owner_bone": "右ひじ",
        "target_bone": "POC_右ひじ_CTRL",
        "constraint_type": "CHILD_OF",
        "rotation_axes": "XYZ",
        "calibrate_inverse": True,
    }
    for key in ("upper_twist", "hand_twist"):
        spec = tool.CONSTRAINT_SPECS[key]
        assert spec["target_bone"] == "POC_右手_CTRL"
        assert spec["constraint_type"] == "COPY_ROTATION"
        assert spec["owner_space"] == "LOCAL"
        assert spec["target_space"] == "LOCAL"
        assert spec["mix_mode"] == "ADD"
        assert spec["rotation_axes"] == "Y"
    assert tool.CONSTRAINT_SPECS["wrist"]["target_bone"] == "POC_右手_CTRL"
    assert tool.CONSTRAINT_SPECS["wrist"]["constraint_type"] == "COPY_ROTATION"
    assert tool.CONSTRAINT_SPECS["wrist"]["owner_space"] == "LOCAL"
    assert tool.CONSTRAINT_SPECS["wrist"]["target_space"] == "LOCAL"
    assert tool.CONSTRAINT_SPECS["wrist"]["mix_mode"] == "ADD"
    assert tool.CONSTRAINT_SPECS["wrist"]["rotation_axes"] == "XYZ"


def test_palm_control_drives_proxy_hand_as_a_local_delta():
    tool = load_tool()

    assert tool.PALM_SPACE_NAME == "POC_手掌_SPACE"
    assert tool.CONSTRAINT_SPECS["palm_proxy"] == {
        "owner_bone": "POC_右手_CTRL",
        "target_control": "POC_手掌_ORIENTATION",
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "REPLACE",
    }
    assert 0.0 < tool.ENABLED_DELTA_LIMIT_DEG <= 10.0


def test_upper_body_compensation_controls_use_local_quaternion_delta_constraints():
    tool = load_tool()

    assert tool.COMPENSATION_CONTROL_PARENT_SPACE == "ARMATURE_LOCAL"
    assert tool.COMPENSATION_CONTROL_NAMES == {
        "upper_chest": "POC_上半身2_DELTA",
        "right_shoulder": "POC_右肩_DELTA",
        "neck": "POC_首_DELTA",
        "head": "POC_頭_DELTA",
    }
    assert tool.COMPENSATION_BONES == {
        "upper_chest": "上半身2",
        "right_shoulder": "右肩",
        "neck": "首",
        "head": "頭",
    }
    assert all(spec["owner_space"] == "LOCAL" for spec in tool.COMPENSATION_CONSTRAINT_SPECS.values())
    assert all(spec["target_space"] == "LOCAL" for spec in tool.COMPENSATION_CONSTRAINT_SPECS.values())
    assert all(spec["mix_mode"] == "BEFORE" for spec in tool.COMPENSATION_CONSTRAINT_SPECS.values())


def test_compensation_quaternion_limits_are_hard_and_combined_for_head_neck():
    tool = load_tool()

    assert tool.UPPER_CHEST_MAX_DEG == 4.0
    assert tool.RIGHT_SHOULDER_MAX_DEG == 3.0
    assert tool.NECK_HEAD_COMBINED_MAX_DEG == 5.0
    assert tool.quaternion_angle_degrees((math.cos(math.radians(2)), math.sin(math.radians(2)), 0, 0)) == pytest.approx(4.0)
    assert tool.validate_compensation_angles({
        "upper_chest": 4.0,
        "right_shoulder": 3.0,
        "neck": 2.0,
        "head": 3.0,
    }) == ()
    assert any("upper_chest" in reason for reason in tool.validate_compensation_angles({
        "upper_chest": 4.01,
        "right_shoulder": 0.0,
        "neck": 0.0,
        "head": 0.0,
    }))
    assert any("neck/head" in reason for reason in tool.validate_compensation_angles({
        "upper_chest": 0.0,
        "right_shoulder": 0.0,
        "neck": 2.1,
        "head": 3.0,
    }))


def test_compensation_grid_and_stages_are_deterministic_and_bounded():
    tool = load_tool()

    grid = tool.upper_body_compensation_grid()

    assert grid == tool.upper_body_compensation_grid()
    assert 20 <= len(grid) <= 100
    assert grid[0].is_identity
    assert max(abs(item.upper_chest_turn_deg) for item in grid) <= tool.UPPER_CHEST_MAX_DEG
    assert max(abs(item.upper_chest_lean_deg) for item in grid) <= tool.UPPER_CHEST_MAX_DEG
    assert max(abs(item.shoulder_retract_deg) for item in grid) <= tool.RIGHT_SHOULDER_MAX_DEG
    assert max(item.neck_toward_deg + item.head_toward_deg for item in grid) <= tool.NECK_HEAD_COMBINED_MAX_DEG
    assert 6 <= tool.COMPENSATION_STAGE_E_LIMIT <= tool.COMPENSATION_STAGE_D_LIMIT < len(grid) * tool.COMPENSATION_SEED_LIMIT


def test_protected_local_pose_hashes_detect_any_channel_change():
    tool = load_tool()
    baseline = {
        "下半身": tuple(float(index) for index in range(16)),
        "左腕": tuple(float(index) / 10 for index in range(16)),
    }

    expected = tool.protected_pose_hashes(baseline)
    unchanged = tool.protected_pose_hashes(dict(baseline))
    changed_pose = dict(baseline)
    changed_pose["左腕"] = (*baseline["左腕"][:-1], baseline["左腕"][-1] + 1e-4)

    assert tool.compare_protected_pose_hashes(expected, unchanged) == ()
    assert any("左腕" in reason for reason in tool.compare_protected_pose_hashes(
        expected, tool.protected_pose_hashes(changed_pose)
    ))


def test_compensation_improvement_requires_contact_anatomy_and_lower_collision_count():
    tool = load_tool()
    before = {
        "surface_contact_distance": 0.025,
        "contact_patch_count": 8,
        "elbow_angle_deg": 58.0,
        "head_collision_count": 0,
        "torso_penetration_count": 40,
    }
    improved = {**before, "torso_penetration_count": 0}
    lost_contact = {**improved, "contact_patch_count": 0}

    assert tool.compensation_improves_evidence(before, improved, warning_distance=0.03) is True
    assert tool.compensation_improves_evidence(before, lost_contact, warning_distance=0.03) is False


def test_compensation_seed_selection_keeps_near_contact_colliding_candidates():
    tool = load_tool()
    candidates = tuple(
        tool.StaticCandidate(
            f"candidate_{index}", 1.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0),
            0.0, (0.25, 0.5, 0.25),
        )
        for index in range(4)
    )
    records = [
        (candidates[0], {"source_candidate_id": "candidate_0", "score": 3.0, "metrics": {
            "surface_contact_distance": 0.021, "contact_patch_count": 35,
            "elbow_angle_deg": 46.0, "torso_penetration_count": 44,
        }}),
        (candidates[1], {"source_candidate_id": "candidate_1", "score": 1.0, "metrics": {
            "surface_contact_distance": 0.042, "contact_patch_count": 0,
            "elbow_angle_deg": 60.0, "torso_penetration_count": 0,
        }}),
        (candidates[2], {"source_candidate_id": "candidate_2", "score": 2.0, "metrics": {
            "surface_contact_distance": 0.029, "contact_patch_count": 6,
            "elbow_angle_deg": 55.0, "torso_penetration_count": 118,
        }}),
        (candidates[3], {"source_candidate_id": "candidate_3", "score": 0.5, "metrics": {
            "surface_contact_distance": 0.025, "contact_patch_count": 0,
            "elbow_angle_deg": 58.0, "torso_penetration_count": 0,
        }}),
    ]

    seeds = tool.compensation_seed_candidates(records, limit=3)

    assert [candidate.candidate_id for candidate, _record in seeds] == [
        "candidate_2", "candidate_0", "candidate_3",
    ]


def test_compensation_stage_survivors_are_bounded_and_use_stable_source_ids():
    tool = load_tool()
    compensation = tool.upper_body_compensation_grid()[1]
    assert tool.compensated_source_id("pole3d_0227", 1) == "pole3d_0227__comp_001"

    records = [
        (None, {"source_candidate_id": "a", "valid": True, "score": 9.0, "metrics": {
            "surface_contact_distance": 0.02, "contact_patch_count": 5, "elbow_angle_deg": 60.0,
        }}),
        (None, {"source_candidate_id": "b", "valid": True, "score": 1.0, "metrics": {
            "surface_contact_distance": 0.02, "contact_patch_count": 0, "elbow_angle_deg": 60.0,
        }}),
        (None, {"source_candidate_id": "c", "valid": True, "score": 2.0, "metrics": {
            "surface_contact_distance": 0.02, "contact_patch_count": 4, "elbow_angle_deg": 54.0,
        }}),
    ]

    survivors = tool.compensation_stage_survivors(records, limit=2)

    assert [record["source_candidate_id"] for _state, record in survivors] == ["a", "c"]
    assert compensation.is_identity is False


def test_compensation_stage_survivors_preserve_each_arm_seed():
    tool = load_tool()
    records = []
    for arm_id, scores in (("arm_a", (1.0, 2.0, 3.0)), ("arm_b", (100.0,))):
        for index, score in enumerate(scores):
            records.append((None, {
                "source_candidate_id": f"{arm_id}_{index}",
                "arm_source_candidate_id": arm_id,
                "valid": True,
                "score": score,
                "metrics": {
                    "surface_contact_distance": 0.02,
                    "contact_patch_count": 5,
                    "elbow_angle_deg": 60.0,
                },
            }))

    survivors = tool.compensation_stage_survivors(records, limit=2)

    assert {record["arm_source_candidate_id"] for _state, record in survivors} == {
        "arm_a", "arm_b",
    }


def test_compensation_stage_survivors_round_robin_seed_depth():
    tool = load_tool()
    records = []
    for arm_id, base_score in (("arm_a", 0.0), ("arm_b", 100.0)):
        for index in range(3):
            records.append((None, {
                "source_candidate_id": f"{arm_id}_{index}",
                "arm_source_candidate_id": arm_id,
                "valid": True,
                "score": base_score + index,
                "metrics": {
                    "surface_contact_distance": 0.02,
                    "contact_patch_count": 5,
                    "elbow_angle_deg": 60.0,
                },
            }))

    survivors = tool.compensation_stage_survivors(records, limit=4)

    counts = {arm_id: 0 for arm_id in ("arm_a", "arm_b")}
    for _state, record in survivors:
        counts[record["arm_source_candidate_id"]] += 1
    assert counts == {"arm_a": 2, "arm_b": 2}


def test_semantic_finger_controls_use_calibrated_local_delta_axes():
    tool = load_tool()

    assert tool.RIGHT_FINGER_BONES == (
        "右親指０", "右親指１", "右親指２",
        "右人指１", "右人指２", "右人指３",
        "右中指１", "右中指２", "右中指３",
        "右薬指１", "右薬指２", "右薬指３",
        "右小指１", "右小指２", "右小指３",
    )
    assert tool.FINGER_FLEXION_AXIS == "LOCAL_X_NEGATIVE"
    assert tool.FINGER_CONTROL_PARENT_SPACE == "ARMATURE_LOCAL"
    assert all(spec["owner_space"] == "LOCAL" for spec in tool.FINGER_CONSTRAINT_SPECS.values())
    assert all(spec["target_space"] == "LOCAL" for spec in tool.FINGER_CONSTRAINT_SPECS.values())
    assert all(spec["mix_mode"] == "BEFORE" for spec in tool.FINGER_CONSTRAINT_SPECS.values())


def test_semantic_finger_presets_are_bounded_and_progressively_relaxed():
    tool = load_tool()
    presets = tool.semantic_finger_presets()

    assert 4 <= len(presets) <= 16
    assert presets == tool.semantic_finger_presets()
    assert {preset.name for preset in presets} >= {"support_soft", "support_reach"}
    reach = next(preset for preset in presets if preset.name == "support_reach")
    assert all(value < 0.0 for value in reach.joint_targets_deg["右人指１"])
    for preset in presets:
        assert tool.validate_absolute_finger_targets(preset.joint_targets_deg) == ()
        middle = -preset.joint_targets_deg["右中指１"][0]
        ring = -preset.joint_targets_deg["右薬指１"][0]
        little = -preset.joint_targets_deg["右小指１"][0]
        assert middle <= ring <= little


def test_finger_pose_limits_reject_reverse_claw_and_excessive_spread():
    tool = load_tool()
    baseline = dict(tool.semantic_finger_presets()[0].joint_targets_deg)

    reverse = {**baseline, "右人指３": (35.0, 0.0, 0.0)}
    claw = {
        **baseline,
        "右中指１": (0.0, 0.0, 0.0),
        "右中指２": (-5.0, 0.0, 0.0),
        "右中指３": (-30.0, 0.0, 0.0),
    }
    spread = {**baseline, "右人指１": (0.0, 0.0, 16.0)}

    assert any("reverse" in reason for reason in tool.validate_absolute_finger_targets(reverse))
    assert any("claw" in reason for reason in tool.validate_absolute_finger_targets(claw))
    assert any("spread" in reason for reason in tool.validate_absolute_finger_targets(spread))


def test_absolute_finger_target_replaces_180_degree_v16_curl():
    tool = load_tool()
    baseline = (0.0, 1.0, 0.0, 0.0)
    half_angle = math.radians(-10.0) / 2.0
    target = (math.cos(half_angle), math.sin(half_angle), 0.0, 0.0)

    delta = tool.absolute_local_control_delta(target, baseline)
    final = tool.compose_before_local_delta(delta, baseline)

    assert tool.quaternion_distance_degrees(final, target) == pytest.approx(0.0, abs=1e-6)
    assert tool.quaternion_angle_degrees(delta) > 150.0


def test_absolute_finger_composition_order_is_target_times_baseline_inverse():
    tool = load_tool()
    baseline = (math.cos(math.radians(45)), math.sin(math.radians(45)), 0.0, 0.0)
    target = (math.cos(math.radians(10)), 0.0, math.sin(math.radians(10)), 0.0)

    delta = tool.absolute_local_control_delta(target, baseline)

    assert tool.quaternion_distance_degrees(
        tool.compose_before_local_delta(delta, baseline), target
    ) == pytest.approx(0.0, abs=1e-6)
    assert tool.quaternion_distance_degrees(
        tool.compose_before_local_delta(baseline, delta), target
    ) > 1.0


def test_final_absolute_angle_validation_ignores_large_corrective_delta():
    tool = load_tool()
    targets = dict(tool.semantic_finger_presets()[0].joint_targets_deg)
    assert tool.validate_absolute_finger_targets(targets) == ()

    fist_target = {**targets, "右薬指１": (-180.0, 0.0, 0.0)}
    assert any("absolute flex" in reason for reason in tool.validate_absolute_finger_targets(fist_target))


def test_finger_contact_improvement_requires_thumb_or_index_patch_without_collision():
    tool = load_tool()
    before = {
        "surface_contact_distance": 0.042,
        "thumb_index_contact_patch_count": 0,
        "head_collision_count": 0,
        "torso_penetration_count": 0,
    }
    improved = {
        "surface_contact_distance": 0.025,
        "thumb_index_contact_patch_count": 4,
        "head_collision_count": 0,
        "torso_penetration_count": 0,
    }

    assert tool.finger_contact_improves_evidence(before, improved, warning_distance=0.03)
    assert not tool.finger_contact_improves_evidence(
        before, {**improved, "head_collision_count": 1}, warning_distance=0.03
    )


def test_semantic_finger_search_grid_is_bounded():
    tool = load_tool()
    count = (
        len(tool.FINGER_SEED_IDS)
        * len(tool.finger_palm_refinements())
        * len(tool.semantic_finger_presets())
        * len(tool.finger_search_compensations())
    )

    assert count == 216
    assert 6 <= tool.FINGER_STAGE_SURVIVOR_LIMIT <= 48


def test_orientation_gallery_variants_are_deterministic_bounded_and_calibrated():
    tool = load_tool()
    variants = tool.orientation_gallery_variants()

    assert variants == tool.orientation_gallery_variants()
    assert 18 <= len(variants) <= 24
    assert len({variant.source_id for variant in variants}) == len(variants)
    assert all(sum(variant.twist_distribution) == pytest.approx(1.0) for variant in variants)
    assert all(min(variant.twist_distribution) >= 0.0 for variant in variants)
    assert all(tool.validate_absolute_finger_targets(variant.finger_targets_deg) == () for variant in variants)
    assert {variant.family for variant in variants} >= {
        "semi_closed_axial", "palm_tilt", "thumb_opposition", "index_alignment"
    }
    assert {variant.axial_angle_deg for variant in variants} <= {-30.0, -15.0, 0.0}
    assert any(variant.palm_swing_deg for variant in variants)
    assert any(variant.palm_tilt_deg for variant in variants)


def test_semiclosed_targets_have_progressive_half_curl_and_distinct_thumb_opposition():
    tool = load_tool()
    targets = tool.semi_closed_finger_targets()

    for name, pose in targets.items():
        assert tool.validate_absolute_finger_targets(pose) == (), name
        middle = -pose["右中指１"][0]
        ring = -pose["右薬指１"][0]
        little = -pose["右小指１"][0]
        assert 30.0 <= middle < ring < little <= 60.0
        assert -pose["右人指１"][0] <= 15.0
    assert targets["thumb_support"]["右親指０"] != targets["thumb_opposed"]["右親指０"]
    assert targets["thumb_support"]["右親指１"] != targets["thumb_opposed"]["右親指１"]


def test_nonaxial_palm_control_compensates_for_wrist_influence():
    tool = load_tool()

    assert tool.palm_control_nonaxial_degrees(6.0, 0.15) == pytest.approx(40.0)
    with pytest.raises(ValueError, match="wrist influence"):
        tool.palm_control_nonaxial_degrees(6.0, 0.0)


def test_gallery_pose_uniqueness_rejects_thumb_noop_and_duplicate_hash():
    tool = load_tool()
    half = math.radians(8.0) / 2.0
    identity = (1.0, 0.0, 0.0, 0.0)
    rotated = (math.cos(half), math.sin(half), 0.0, 0.0)
    base = {
        "comparison_group": "thumb_m30",
        "comparison_dimension": "thumb",
        "evaluated_finger_quaternions": {
            "右親指０": identity, "右親指１": identity, "右親指２": identity,
        },
        "fingertip_world": {"thumb": (0.0, 0.0, 0.0), "index": (1.0, 0.0, 0.0)},
        "palm_final_quaternion": identity,
    }
    distinct = [
        {**base, "source_id": "thumb_support", "evaluated_pose_hash": "a"},
        {
            **base,
            "source_id": "thumb_opposed",
            "evaluated_pose_hash": "b",
            "evaluated_finger_quaternions": {
                "右親指０": rotated, "右親指１": identity, "右親指２": identity,
            },
            "fingertip_world": {"thumb": (0.004, 0.0, 0.0), "index": (1.0, 0.0, 0.0)},
        },
    ]

    assert tool.orientation_gallery_pose_uniqueness_reasons(distinct) == ()
    noop = [{**record, "evaluated_pose_hash": "same"} for record in distinct]
    noop[1] = {
        **noop[1],
        "evaluated_finger_quaternions": base["evaluated_finger_quaternions"],
        "fingertip_world": base["fingertip_world"],
    }
    reasons = tool.orientation_gallery_pose_uniqueness_reasons(noop)
    assert any("pose hash" in reason.lower() for reason in reasons)
    assert any("thumb quaternion" in reason.lower() for reason in reasons)
    assert any("thumb tip" in reason.lower() for reason in reasons)


def test_orientation_gallery_rejects_only_hard_anatomy_or_collision_failures():
    tool = load_tool()
    valid = {
        "matrices_finite": True,
        "signed_elbow_flex_deg": -116.0,
        "pole_side": 0.1,
        "wrist_swing_deg": 20.0,
        "wrist_twist_deg": 18.0,
        "forearm_twist_deg": 40.0,
        "head_collision_count": 0,
        "torso_penetration_count": 0,
    }

    assert tool.orientation_gallery_rejection_reasons(valid) == ()
    assert any("head" in reason.lower() for reason in tool.orientation_gallery_rejection_reasons(
        {**valid, "head_collision_count": 1}
    ))
    assert any("wrist twist" in reason.lower() for reason in tool.orientation_gallery_rejection_reasons(
        {**valid, "wrist_twist_deg": 41.0}
    ))
    assert tool.orientation_gallery_rejection_reasons({
        **valid,
        "surface_contact_distance": 1.0,
        "contact_patch_count": 0,
    }) == ()


def test_orientation_gallery_render_mapping_is_stable():
    tool = load_tool()
    variants = tool.orientation_gallery_variants()[:3]

    mapping = tool.orientation_gallery_render_mapping(variants)

    assert mapping[0] == {
        "gallery_index": 1,
        "source_id": variants[0].source_id,
        "closeup": f"orientation_gallery/variants/01_{variants[0].source_id}/upper_body_hand.png",
        "front": f"orientation_gallery/variants/01_{variants[0].source_id}/front.png",
        "right": f"orientation_gallery/variants/01_{variants[0].source_id}/right.png",
        "left": f"orientation_gallery/variants/01_{variants[0].source_id}/left.png",
    }
    assert [item["gallery_index"] for item in mapping] == [1, 2, 3]


def test_absolute_finger_stage_retains_contact_only_failures_for_refinement():
    tool = load_tool()
    records = [
        (("state_a",), {
            "arm_source_candidate_id": "candidate_764",
            "finger_stage_anatomy_valid": True,
            "valid": False,
            "score": 5.0,
            "source_candidate_id": "absolute_near_miss",
            "metrics": {
                "surface_contact_distance": 0.041,
                "thumb_index_contact_patch_count": 0,
            },
        }),
        (("state_b",), {
            "arm_source_candidate_id": "candidate_764",
            "finger_stage_anatomy_valid": False,
            "valid": False,
            "score": 1.0,
            "source_candidate_id": "anatomy_failure",
            "metrics": {
                "surface_contact_distance": 0.020,
                "thumb_index_contact_patch_count": 8,
            },
        }),
    ]

    survivors = tool.finger_stage_survivors(
        records, seed_ids=("candidate_764",), limit=8
    )

    assert [record["source_candidate_id"] for _state, record in survivors] == [
        "absolute_near_miss"
    ]


def test_absolute_finger_stage_diversifies_palm_orientations():
    tool = load_tool()
    records = []
    for palm_index, distance in enumerate((0.030, 0.060)):
        for rank in range(2):
            records.append(((palm_index, rank), {
                "arm_source_candidate_id": "candidate_764",
                "finger_stage_anatomy_valid": True,
                "score": distance + rank,
                "source_candidate_id": f"palm_{palm_index}_{rank}",
                "parameters": {"palm_refinement_deg": (palm_index * 3.0, 0.0, 0.0)},
                "metrics": {
                    "surface_contact_distance": distance + rank * 0.001,
                    "thumb_index_contact_patch_count": 0,
                },
            }))

    survivors = tool.finger_stage_survivors(
        records, seed_ids=("candidate_764",), limit=2
    )

    assert {record["parameters"]["palm_refinement_deg"] for _state, record in survivors} == {
        (0.0, 0.0, 0.0),
        (3.0, 0.0, 0.0),
    }


def test_semantic_diagnostic_falls_back_to_best_absolute_candidate():
    tool = load_tool()
    records = [
        (("far",), {
            "source_candidate_id": "absolute_far",
            "score": 2.0,
            "metrics": {
                "surface_contact_distance": 0.050,
                "thumb_index_contact_patch_count": 0,
            },
        }),
        (("near",), {
            "source_candidate_id": "absolute_near",
            "score": 3.0,
            "metrics": {
                "surface_contact_distance": 0.035,
                "thumb_index_contact_patch_count": 2,
            },
        }),
    ]

    _state, record = tool.semantic_diagnostic_candidate(
        records, preferred_source_id="legacy_additive_candidate"
    )

    assert record["source_candidate_id"] == "absolute_near"


def test_finger_reach_diagnostic_reports_geometry_shortfall():
    tool = load_tool()
    records = [{
        "source_candidate_id": "candidate_779__finger_p01_s02_c01",
        "metrics": {
            "surface_contact_distance": 0.0352,
            "contact_distance_by_source": {"thumb": 0.087, "index": 0.0352},
            "thumb_index_contact_patch_count": 0,
            "head_collision_count": 0,
            "torso_penetration_count": 0,
        },
    }]

    diagnostic = tool.finger_reach_diagnostic(records, warning_distance=0.0301)

    assert diagnostic["finger_length_or_orientation_insufficient"] is True
    assert diagnostic["distance_shortfall"] == pytest.approx(0.0051)


def test_dual_contact_requires_independent_index_and_thumb_surface_support():
    tool = load_tool()
    band = tool.derive_dual_contact_band(mesh_resolution=0.015, index_warning_distance=0.030)
    valid = {
        "contact_distance_by_source": {"index": 0.025, "thumb": 0.040},
        "contact_patch_by_source": {"index": 3, "thumb": 2},
        "thumb_support_patch_count": 2,
    }

    assert band.thumb_warning_distance == pytest.approx(0.045)
    assert tool.dual_contact_reasons(valid, band) == ()
    assert any("thumb" in reason.lower() for reason in tool.dual_contact_reasons(
        {**valid, "contact_distance_by_source": {"index": 0.025, "thumb": 0.060}}, band
    ))
    assert any("index" in reason.lower() for reason in tool.dual_contact_reasons(
        {**valid, "contact_patch_by_source": {"index": 0, "thumb": 2}}, band
    ))


def test_combined_dual_contact_refinement_is_bounded_by_head_and_finger_limits():
    tool = load_tool()
    refinements = tool.dual_contact_refinement_grid()

    assert 100 <= len(refinements) <= 400
    assert refinements == tool.dual_contact_refinement_grid()
    assert all(item.neck_toward_deg + item.head_toward_deg <= 5.0 for item in refinements)
    assert all(max(abs(value) for target in item.thumb_targets_deg.values() for value in target) <= 40.0 for item in refinements)
    assert all(max(abs(value) for value in item.palm_refinement_deg) <= 3.0 for item in refinements)


def test_sleeve_correction_grid_is_bounded_smooth_and_contains_identity():
    tool = load_tool()

    corrections = tool.sleeve_correction_grid()

    assert corrections == tool.sleeve_correction_grid()
    assert 100 <= len(corrections) <= 180
    assert corrections[0].swings_deg == ((0.0, 0.0),) * 3
    assert all(tool.sleeve_correction_reasons(item) == () for item in corrections)
    assert all(
        max(math.hypot(*swing) for swing in item.swings_deg)
        <= tool.SLEEVE_CORRECTIVE_MAX_DEG
        for item in corrections
    )


def test_sleeve_correction_rejects_abrupt_or_excessive_profiles():
    tool = load_tool()

    abrupt = tool.SleeveCorrection(((0.0, 0.0), (8.0, 0.0), (0.0, 0.0)))
    excessive = tool.SleeveCorrection(((9.0, 0.0), (8.0, 0.0), (7.0, 0.0)))

    assert any("smooth" in reason.lower() for reason in tool.sleeve_correction_reasons(abrupt))
    assert any("8" in reason for reason in tool.sleeve_correction_reasons(excessive))


def test_sleeve_primary_invariance_uses_named_tight_tolerances():
    tool = load_tool()
    valid = {
        "max_primary_position_drift": tool.SLEEVE_PRIMARY_POSITION_TOLERANCE * 0.5,
        "max_primary_rotation_drift_deg": tool.SLEEVE_PRIMARY_ROTATION_TOLERANCE_DEG * 0.5,
        "max_fingertip_drift": tool.SLEEVE_FINGERTIP_POSITION_TOLERANCE * 0.5,
        "contact_point_drift": tool.SLEEVE_CONTACT_POSITION_TOLERANCE * 0.5,
    }

    assert tool.sleeve_primary_drift_reasons(valid) == ()
    invalid = {**valid, "max_primary_position_drift": tool.SLEEVE_PRIMARY_POSITION_TOLERANCE * 2.0}
    assert any("primary" in reason.lower() for reason in tool.sleeve_primary_drift_reasons(invalid))


def test_sleeve_correction_ranking_prioritizes_zero_and_reduced_overlap():
    tool = load_tool()
    records = [
        {"source_id": "unchanged", "raw_overlap_count": 44, "max_penetration_depth": 0.01, "smoothness_penalty": 0.0},
        {"source_id": "reduced", "raw_overlap_count": 8, "max_penetration_depth": 0.02, "smoothness_penalty": 0.0},
        {"source_id": "zero", "raw_overlap_count": 0, "max_penetration_depth": 0.0, "smoothness_penalty": 1.0},
    ]

    ranked = sorted(records, key=tool.sleeve_correction_rank)

    assert [record["source_id"] for record in ranked] == ["zero", "reduced", "unchanged"]


def test_behavior_diagnostics_have_nonzero_bounded_thresholds():
    tool = load_tool()

    assert tool.HAND_TARGET_DIAGNOSTIC_OFFSET == (0.01, 0.0, 0.0)
    assert 0.0 < tool.HAND_RESPONSE_MIN_DEG < tool.HAND_RESPONSE_MAX_DEG <= 10.0
    assert tool.PALM_AXIAL_DIAGNOSTIC_DEG == 10.0
    assert 0.0 < tool.PALM_RESPONSE_TOLERANCE_DEG <= 1.0
    assert 0.0 < tool.PALM_OFF_AXIS_MAX_DEG <= 1.0


def test_backup_path_and_save_version_are_deterministic(cli_tmp_path):
    tool = load_tool()
    output = cli_tmp_path / tool.OUTPUT_BLEND_NAME

    assert tool.blender_backup_path(output) == Path(f"{output}1")
    assert tool.SAVE_VERSION_OVERRIDE == 0


def test_parse_blender_arguments_after_separator_with_deterministic_defaults(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_cli(cli_tmp_path))

    assert config.source_blend.name == "source.blend"
    assert config.vmd.name == "reference.vmd"
    assert config.output_blend.name == tool.OUTPUT_BLEND_NAME
    assert config.output_dir.name == tool.OUTPUT_DIRECTORY_NAME
    assert config.frame_start == 0
    assert config.frame_end == 240
    assert config.setup_only is True
    assert config.solve_static is False


def test_search_static_reuses_existing_poc_blend_without_vmd(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_solve_cli(cli_tmp_path))

    assert config.source_blend == config.output_blend
    assert config.source_blend.name == tool.OUTPUT_BLEND_NAME
    assert config.vmd is None
    assert config.setup_only is False
    assert config.search_static is True
    assert config.select_static is False
    assert config.run_id == "run-20260715-001"


def test_setup_search_and_select_modes_are_mutually_exclusive(cli_tmp_path):
    tool = load_tool()
    argv = valid_solve_cli(cli_tmp_path)
    argv.append("--setup-only")

    with pytest.raises(SystemExit):
        tool.parse_blender_args(argv)


def test_search_static_requires_opening_the_existing_poc_blend(cli_tmp_path):
    tool = load_tool()
    argv = valid_solve_cli(cli_tmp_path)
    other = cli_tmp_path / "other" / tool.OUTPUT_BLEND_NAME
    argv[argv.index("--output-blend") + 1] = str(other)

    with pytest.raises(ValueError, match="same existing POC blend"):
        tool.parse_blender_args(argv)


def test_select_static_requires_reviewed_source_candidate_and_existing_run(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_select_cli(cli_tmp_path))

    assert config.select_static is True
    assert config.search_static is False
    assert config.source_candidate_id == "candidate_0042"
    assert config.run_metrics_path.name == "static_pose_metrics.json"


def test_orientation_gallery_reuses_existing_poc_blend_and_requires_run_id(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_gallery_cli(cli_tmp_path))

    assert config.orientation_gallery is True
    assert config.search_static is False
    assert config.select_static is False
    assert config.run_id == "run-20260715-orientation-001"
    assert config.vmd is None
    assert config.source_candidate_id == "candidate_764"
    assert config.source_static_metrics.name == "source_static_metrics.json"


def test_orientation_gallery_run_paths_are_isolated(cli_tmp_path):
    tool = load_tool()
    output_dir = cli_tmp_path / tool.OUTPUT_DIRECTORY_NAME

    paths = tool.orientation_gallery_run_paths(output_dir, "run-20260715-orientation-001")

    assert paths.temporary.name == ".tmp-run-20260715-orientation-001"
    assert paths.final == output_dir / "runs" / "run-20260715-orientation-001"
    assert paths.metrics == paths.final / "orientation_gallery" / tool.ORIENTATION_GALLERY_METRICS_NAME


def test_chin_support_refinement_requires_exact_g14_and_isolated_run(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_chin_support_cli(cli_tmp_path))

    assert config.chin_support_refinement is True
    assert config.orientation_source_id == tool.G14_ORIENTATION_SOURCE_ID
    assert config.orientation_gallery_metrics.name == "orientation_gallery_metrics.json"
    paths = tool.chin_support_run_paths(config.output_dir, config.run_id)
    assert paths.metrics == paths.final / tool.CHIN_SUPPORT_METRICS_NAME


def test_collision_severity_mode_reuses_source_metrics_and_isolates_output(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_collision_severity_cli(cli_tmp_path))

    assert config.collision_severity_diagnostic is True
    paths = tool.collision_severity_run_paths(config.output_dir, config.run_id)
    assert paths.metrics == paths.final / tool.COLLISION_SEVERITY_METRICS_NAME


def test_sleeve_corrective_mode_reuses_source_metrics_and_isolates_output(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_sleeve_corrective_cli(cli_tmp_path))

    assert config.sleeve_corrective_feasibility is True
    paths = tool.sleeve_corrective_run_paths(config.output_dir, config.run_id)
    assert paths.metrics == paths.final / tool.SLEEVE_CORRECTIVE_METRICS_NAME


def test_collision_severity_record_selection_prefers_lowest_overlap_pole3d_compensation():
    tool = load_tool()
    stored = {
        "compensation_candidates": [
            {"source_candidate_id": "candidate_100__comp_001", "metrics": {"torso_penetration_count": 2, "surface_contact_distance": 0.01}},
            {"source_candidate_id": "pole3d_0227__comp_065", "metrics": {"torso_penetration_count": 89, "surface_contact_distance": 0.029}},
            {"source_candidate_id": "pole3d_0020__comp_065", "metrics": {"torso_penetration_count": 341, "surface_contact_distance": 0.026}},
        ]
    }

    selected = tool.collision_severity_source_records(stored)

    assert selected["compensated"]["source_candidate_id"] == "pole3d_0227__comp_065"


def test_selected_g14_orientation_reconstructs_exact_gallery_targets():
    tool = load_tool()

    variant = tool.selected_orientation_variant(tool.G14_ORIENTATION_SOURCE_ID)

    assert variant.source_id == tool.G14_ORIENTATION_SOURCE_ID
    assert variant.axial_angle_deg == pytest.approx(-15.0)
    assert variant.palm_swing_deg == pytest.approx(0.0)
    assert variant.palm_tilt_deg == pytest.approx(-10.0)
    assert variant.thumb_variant == "thumb_opposed"
    assert variant.index_variant == "base"
    assert variant.finger_targets_deg == tool.semi_closed_finger_targets()["thumb_opposed"]


def test_chin_support_semantics_accept_index_knuckle_patch_without_thumb_contact():
    tool = load_tool()
    band = tool.derive_chin_support_band(mesh_resolution=0.012, chin_warning_distance=0.030)
    metrics = {
        "index_support_surface_distance": 0.024,
        "index_support_patch_count": 6,
        "index_support_normal_opposition_error_deg": 18.0,
        "index_support_under_chin": True,
        "thumb_contour_bounded": True,
        "thumb_tip_surface_distance": 0.090,
    }

    assert band.support_warning_distance == pytest.approx(0.030)
    assert tool.chin_support_semantic_reasons(metrics, band) == ()


def test_chin_support_semantics_reject_fingertip_or_web_only_proximity():
    tool = load_tool()
    band = tool.derive_chin_support_band(mesh_resolution=0.012, chin_warning_distance=0.030)
    metrics = {
        "index_support_surface_distance": 0.050,
        "index_support_patch_count": 0,
        "index_support_normal_opposition_error_deg": 10.0,
        "index_support_under_chin": True,
        "thumb_contour_bounded": True,
        "web_support_patch_count": 8,
        "index_tip_surface_distance": 0.001,
        "thumb_tip_surface_distance": 0.001,
    }

    reasons = tool.chin_support_semantic_reasons(metrics, band)

    assert any("index support" in reason.lower() for reason in reasons)
    assert any("patch" in reason.lower() for reason in reasons)
    assert all("tip" not in reason.lower() for reason in reasons)
    assert all("web" not in reason.lower() for reason in reasons)


def test_chin_support_semantics_enforce_normal_under_chin_and_thumb_contour():
    tool = load_tool()
    band = tool.derive_chin_support_band(mesh_resolution=0.012, chin_warning_distance=0.030)
    base = {
        "index_support_surface_distance": 0.020,
        "index_support_patch_count": 4,
        "index_support_normal_opposition_error_deg": tool.INDEX_SUPPORT_NORMAL_MAX_DEG + 0.1,
        "index_support_under_chin": False,
        "thumb_contour_bounded": False,
        "thumb_tip_surface_distance": 0.080,
    }

    reasons = tool.chin_support_semantic_reasons(base, band)

    assert any("normal" in reason.lower() for reason in reasons)
    assert any("under" in reason.lower() for reason in reasons)
    assert any("contour" in reason.lower() for reason in reasons)


def test_g14_chin_support_refinement_grid_is_small_bounded_and_deterministic():
    tool = load_tool()

    refinements = tool.chin_support_refinement_grid()

    assert refinements == tool.chin_support_refinement_grid()
    assert 24 <= len(refinements) <= 180
    assert all(abs(item.hand_target_offset[0]) <= 0.004 for item in refinements)
    assert all(-0.004 <= item.hand_target_offset[2] <= 0.004 for item in refinements)
    assert max(item.hand_target_offset[1] for item in refinements) == pytest.approx(0.06)
    assert all(item.neck_toward_deg + item.head_toward_deg <= 5.0 for item in refinements)
    assert any(item.neck_toward_deg + item.head_toward_deg == pytest.approx(4.5) for item in refinements)
    assert all(max(abs(value) for value in item.palm_refinement_deg) <= 4.0 for item in refinements)
    assert all(max(abs(value) for value in item.thumb_refinement_deg) <= 6.0 for item in refinements)


def test_index_knuckle_region_uses_index_one_two_faces_and_excludes_distal_tip():
    tool = load_tool()
    faces = ((0, 1, 2), (1, 2, 3), (2, 3, 4), (3, 4, 5))

    region = tool.index_knuckle_region_indices(
        index1_indices={0, 1, 2},
        index2_indices={2, 3, 4},
        index3_indices={5},
        faces=faces,
    )

    assert region["support_vertices"] == {0, 1, 2, 3, 4}
    assert 5 not in region["support_vertices"]
    assert region["support_faces"] == ((0, 1, 2), (1, 2, 3), (2, 3, 4))


def test_surface_normal_opposition_error_distinguishes_support_from_parallel_contact():
    tool = load_tool()

    assert tool.surface_normal_opposition_error((0, 0, 1), (0, 0, -1)) == pytest.approx(0.0)
    assert tool.surface_normal_opposition_error((0, 0, 1), (0, 0, 1)) == pytest.approx(180.0)
    assert tool.surface_normal_opposition_error((1, 0, 0), (0, 0, -1)) == pytest.approx(90.0)


def test_existing_surface_evidence_keeps_its_complete_return_path():
    tool = load_tool()
    source = inspect.getsource(tool._surface_contact_evidence_bvh)

    assert "for source, indices in groups.items()" in source
    assert '"surface_contact_distance"' in source
    assert "def _chin_support_surface_evidence" not in source


def test_gallery_source_lookup_maps_exact_candidate_and_seed_metrics():
    tool = load_tool()
    stored = {
        "candidates": [{
            "source_candidate_id": "candidate_764",
            "parameters": {
                "alignment_factor": 0.35,
                "hand_offset": [0.005, 0.0, 0.01],
                "palm_euler_deg": [15.0, -20.0, 10.0],
                "pole_offset": 0.16,
                "pole_offset_3d": [0.0, 0.0, 0.0],
                "twist_influences": [0.35, 0.5, 0.15],
            },
        }],
        "semantic_finger_search": {
            "seed_metrics": {
                "candidate_764": {
                    "hand_target_world": [-0.089, -0.226, 1.381],
                    "elbow_angle_deg": 59.61,
                    "pole_side": 0.1306,
                    "surface_contact_distance": 0.04153,
                },
            },
        },
    }

    candidate, metrics = tool.gallery_source_reference(stored, "candidate_764")

    assert candidate.candidate_id == "candidate_764"
    assert candidate.hand_offset == (0.005, 0.0, 0.01)
    assert candidate.pole_offset_3d == (0.0, 0.0, 0.0)
    assert metrics["surface_contact_distance"] == pytest.approx(0.04153)
    with pytest.raises(ValueError, match="candidate_missing"):
        tool.gallery_source_reference(stored, "candidate_missing")


def test_gallery_source_reproduction_checks_hand_wrist_elbow_pole_and_contact():
    tool = load_tool()
    expected = {
        "hand_target_world": (1.0, 2.0, 3.0),
        "wrist_world": (0.1, 0.2, 0.3),
        "elbow_angle_deg": 60.0,
        "pole_side": 0.13,
        "surface_contact_distance": 0.0415,
    }

    assert tool.gallery_source_reproduction_reasons(expected, dict(expected)) == ()
    drifted = {**expected, "wrist_world": (0.1, 0.2, 0.31)}
    assert any(
        "wrist" in reason.lower()
        for reason in tool.gallery_source_reproduction_reasons(expected, drifted)
    )


def test_chin_support_source_reference_reads_compensated_arm_record():
    tool = load_tool()
    stored = {
        "compensation_candidates": [{
            "source_candidate_id": "pole3d_0227__comp_065",
            "parameters": {
                "alignment_factor": 0.65,
                "hand_offset": [0.025, 0.0, -0.015],
                "palm_euler_deg": [20.0, -25.0, 12.0],
                "pole_offset": 0.0,
                "pole_offset_3d": [0.16, 0.16, 0.0],
                "twist_influences": [0.35, 0.5, 0.15],
                "compensation": {
                    "upper_chest_turn_deg": 0.0,
                    "upper_chest_lean_deg": -2.0,
                    "shoulder_retract_deg": 1.5,
                    "shoulder_elevate_deg": 0.0,
                    "neck_toward_deg": 2.0,
                    "head_toward_deg": 2.5,
                },
            },
            "metrics": {"elbow_angle_deg": 55.553, "surface_contact_distance": 0.029175},
        }],
    }

    candidate, compensation, metrics = tool.chin_support_source_reference(
        stored, "pole3d_0227__comp_065"
    )

    assert candidate.candidate_id == "pole3d_0227__comp_065"
    assert candidate.pole_offset_3d == (0.16, 0.16, 0.0)
    assert compensation.upper_chest_lean_deg == pytest.approx(-2.0)
    assert compensation.shoulder_retract_deg == pytest.approx(1.5)
    assert metrics["surface_contact_distance"] == pytest.approx(0.029175)

def test_run_paths_are_isolated_and_require_explicit_overwrite(cli_tmp_path):
    tool = load_tool()
    output_dir = cli_tmp_path / tool.OUTPUT_DIRECTORY_NAME

    paths = tool.static_run_paths(output_dir, "run-20260715-001")

    assert paths.temporary.name == ".tmp-run-20260715-001"
    assert paths.final == output_dir / "runs" / "run-20260715-001"
    assert paths.metrics == paths.final / tool.STATIC_METRICS_NAME


def test_invalid_or_existing_run_id_is_rejected_without_overwrite(cli_tmp_path):
    tool = load_tool()
    argv = valid_solve_cli(cli_tmp_path)
    argv[argv.index("--run-id") + 1] = "../escape"
    with pytest.raises(ValueError, match="run ID"):
        tool.parse_blender_args(argv)

    argv = valid_solve_cli(cli_tmp_path)
    run_dir = Path(argv[argv.index("--output-dir") + 1]) / "runs" / "run-20260715-001"
    run_dir.mkdir(parents=True)
    with pytest.raises(ValueError, match="already exists"):
        tool.parse_blender_args(argv)


def test_staged_search_caps_are_bounded():
    tool = load_tool()

    assert 6 <= tool.STAGE_C_SURVIVOR_LIMIT <= tool.STAGE_B_SURVIVOR_LIMIT
    assert tool.STAGE_C_SURVIVOR_LIMIT >= 18
    assert tool.STAGE_C_SURVIVOR_LIMIT == tool.STAGE_B_SURVIVOR_LIMIT
    assert tool.STAGE_B_SURVIVOR_LIMIT <= tool.STAGE_A_SURVIVOR_LIMIT < len(tool.static_candidate_grid())


def test_stage_a_survivors_preserve_each_contact_target_stratum():
    tool = load_tool()
    candidates = (
        tool.StaticCandidate("candidate_001", 0.35, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.0, (0.25, 0.5, 0.25)),
        tool.StaticCandidate("candidate_002", 0.35, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.0, (0.25, 0.5, 0.25)),
        tool.StaticCandidate("candidate_003", 1.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.0, (0.25, 0.5, 0.25)),
    )
    records = tuple(
        (candidate, {"valid": True, "score": score, "source_candidate_id": candidate.candidate_id})
        for candidate, score in zip(candidates, (1.0, 2.0, 100.0), strict=True)
    )

    survivors = tool.stage_a_survivors(records, limit=2)

    assert [candidate.candidate_id for candidate, _record in survivors] == [
        "candidate_001",
        "candidate_003",
    ]


def test_rank_source_mapping_is_stable_and_rejects_gaps():
    tool = load_tool()
    records = [
        {"rank": 1, "source_candidate_id": "candidate_010"},
        {"rank": 2, "source_candidate_id": "candidate_003"},
    ]

    assert tool.rank_source_mapping(records) == {
        "candidate_001": "candidate_010",
        "candidate_002": "candidate_003",
    }
    with pytest.raises(ValueError, match="contiguous"):
        tool.rank_source_mapping([{"rank": 2, "source_candidate_id": "candidate_003"}])


def test_render_rank_assignment_is_contiguous_and_mutates_only_rank():
    tool = load_tool()
    records = [{"source_candidate_id": "candidate_010"}, {"source_candidate_id": "candidate_003"}]

    tool.assign_render_ranks(records)

    assert [record["rank"] for record in records] == [1, 2]
    assert [record["source_candidate_id"] for record in records] == ["candidate_010", "candidate_003"]


def test_candidate_state_and_remeasurement_comparisons_are_explicit():
    tool = load_tool()
    baseline = {"hand": (1.0, 2.0, 3.0), "enabled": 0.0}

    assert tool.compare_static_state(baseline, dict(baseline), tolerance=1e-6) == ()
    assert tool.compare_static_state(baseline, {"hand": (1.0, 2.0, 3.01), "enabled": 0.0}, tolerance=1e-3)

    stored = {"surface_contact_distance": 0.002, "elbow_angle_deg": 60.0}
    measured = {"surface_contact_distance": 0.0020001, "elbow_angle_deg": 60.0001}
    assert tool.compare_selected_metrics(stored, measured) == ()
    measured["surface_contact_distance"] = 0.02
    assert any("surface_contact_distance" in reason for reason in tool.compare_selected_metrics(stored, measured))

    stored = {"hand_contact_world": (0.0, 0.0, 0.0)}
    measured = {"hand_contact_world": (0.0, 0.0, 0.01)}
    assert any("hand_contact_world" in reason for reason in tool.compare_selected_metrics(stored, measured))


def test_static_selection_requires_contact_patch_margin_and_clear_geometry():
    tool = load_tool()
    metrics = {
        "surface_contact_distance": 0.02,
        "contact_patch_count": 3,
        "surface_intersection_count": 0,
        "head_collision_count": 0,
        "torso_penetration_count": 0,
        "minimum_clearance": tool._load_motion_math().CLEARANCE_COMFORT_DISTANCE,
        "continuity_distance": tool._load_motion_math().CONTINUITY_COMFORT_DISTANCE,
        "elbow_angle_deg": 60.0,
    }

    assert tool.static_selection_eligibility(metrics, warning_distance=0.03) == ()
    metrics["contact_patch_count"] = 0
    assert any("patch" in reason for reason in tool.static_selection_eligibility(metrics, 0.03))
    metrics["contact_patch_count"] = 3
    metrics["surface_contact_distance"] = 0.031
    assert any("warning" in reason for reason in tool.static_selection_eligibility(metrics, 0.03))
    metrics["surface_contact_distance"] = 0.02
    metrics["minimum_clearance"] = 0.001
    assert any("clearance" in reason.lower() for reason in tool.static_selection_eligibility(metrics, 0.03))
    metrics["minimum_clearance"] = tool._load_motion_math().CLEARANCE_COMFORT_DISTANCE
    metrics["elbow_angle_deg"] = 50.0
    assert any("elbow" in reason.lower() for reason in tool.static_selection_eligibility(metrics, 0.03))


def test_lower_chin_region_uses_bounded_local_head_topology():
    tool = load_tool()
    vertices = (
        (0.0, 0.0, 0.0),
        (1.0, 0.0, 0.0),
        (1.0, 1.0, 0.0),
        (0.0, 1.0, 0.0),
        (5.0, 5.0, 0.0),
    )
    polygons = ((0, 1, 2), (0, 2, 3), (2, 4, 3))

    region = tool.lower_chin_surface_region(
        vertices,
        polygons,
        anchor=(0.5, 0.5, 0.01),
        radius=1.0,
    )

    assert region["triangle_indices"] == (0, 1)
    assert region["triangle_count"] == 2
    assert region["vertex_count"] == 4
    assert len(region["edge_lengths"]) == 6


def test_surface_contact_evidence_distinguishes_touch_separation_and_intersection():
    tool = load_tool()
    vertices = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    triangles = ((0, 1, 2),)

    touching = tool.measure_triangle_surface_contact(
        {"thumb": ((0.25, 0.25, 0.0),)}, vertices, triangles, patch_distance=0.02
    )
    separated = tool.measure_triangle_surface_contact(
        {"index": ((0.25, 0.25, 0.1),)}, vertices, triangles, patch_distance=0.02
    )
    intersecting = tool.measure_triangle_surface_contact(
        {"side_palm": ((0.25, 0.25, -0.01),)}, vertices, triangles, patch_distance=0.02
    )

    assert touching["surface_contact_distance"] == pytest.approx(0.0)
    assert touching["contact_patch_count"] == 1
    assert touching["hand_contact_world"] == pytest.approx((0.25, 0.25, 0.0))
    assert touching["nearest_chin_surface_world"] == pytest.approx((0.25, 0.25, 0.0))
    assert separated["surface_contact_distance"] == pytest.approx(0.1)
    assert intersecting["surface_intersection_count"] == 1
    assert intersecting["contact_source"] == "side_palm"


def test_pmx_chin_surface_converts_to_verified_blender_rest_point():
    tool = load_tool()

    assert tool.PMX_CHIN_SURFACE == (0.0, 18.44, -0.50)
    assert tool.pmx_point_to_blender_rest(tool.PMX_CHIN_SURFACE) == pytest.approx(
        (0.0, -0.04, 1.4752)
    )


def test_static_candidate_grid_is_deterministic_bounded_and_complete():
    tool = load_tool()

    first = tool.static_candidate_grid()
    second = tool.static_candidate_grid()

    assert first == second
    assert len(first) >= 900
    assert len({candidate.candidate_id for candidate in first}) == len(first)
    assert all(
        candidate.candidate_id == f"candidate_{index:03d}"
        for index, candidate in enumerate(first[:4860], 1)
    )
    assert max(candidate.alignment_factor for candidate in first) == pytest.approx(1.0)
    assert min(candidate.alignment_factor for candidate in first) <= 0.4
    assert all(max(abs(value) for value in candidate.hand_offset) <= 0.04 for candidate in first)
    assert max(max(abs(value) for value in candidate.palm_euler_deg) for candidate in first) >= 35.0
    assert all(abs(candidate.pole_offset) <= 0.18 for candidate in first)
    assert all(sum(candidate.twist_influences) == pytest.approx(1.0) for candidate in first)


def test_pole_basis_is_chain_relative_orthonormal_and_semantically_oriented():
    tool = load_tool()

    basis = tool.pole_search_basis(
        shoulder=(0.0, 0.0, 0.0),
        wrist=(1.0, 0.2, 0.1),
        base_pole=(0.2, -1.0, 0.4),
    )

    axes = tuple(basis[name] for name in ("outward_lateral", "forward_depth", "vertical"))
    assert all(sum(value * value for value in axis) == pytest.approx(1.0) for axis in axes)
    assert sum(a * b for a, b in zip(axes[0], axes[1], strict=True)) == pytest.approx(0.0, abs=1e-6)
    assert sum(a * b for a, b in zip(axes[0], axes[2], strict=True)) == pytest.approx(0.0, abs=1e-6)
    assert sum(a * b for a, b in zip(axes[1], axes[2], strict=True)) == pytest.approx(0.0, abs=1e-6)
    assert basis["derivation"] == "shoulder_wrist_chain"


def test_pole_offset_grid_is_bounded_3d_and_preserves_legacy_candidates():
    tool = load_tool()

    offsets = tool.pole_offset_grid()
    candidates = tool.static_candidate_grid()

    assert offsets == tool.pole_offset_grid()
    assert (0.0, 0.0, 0.0) in offsets
    assert 7 <= len(offsets) <= 20
    assert any(offset[0] != 0.0 for offset in offsets)
    assert any(offset[1] != 0.0 for offset in offsets)
    assert any(offset[2] != 0.0 for offset in offsets)
    assert all(max(abs(value) for value in offset) <= 0.18 for offset in offsets)
    assert max(max(abs(value) for value in offset) for offset in offsets) == pytest.approx(0.16)
    assert candidates[4329].candidate_id == "candidate_4330"
    assert candidates[4329].search_family == "legacy_scalar"
    assert any(candidate.search_family == "pole_3d" for candidate in candidates)
    assert any(
        candidate.search_family == "pole_3d"
        and candidate.alignment_factor == pytest.approx(0.65)
        and candidate.hand_offset == (0.025, 0.0, -0.015)
        for candidate in candidates
    )
    assert len(candidates) < 7000


def test_collision_attribution_reports_regions_polygons_points_and_bbox():
    tool = load_tool()
    moving = (
        {"polygon_index": 10, "vertices": (0, 1, 2), "region": "forearm", "group": "右ひじ"},
        {"polygon_index": 11, "vertices": (3, 4, 5), "region": "hand", "group": "右手首"},
    )
    torso = (
        {"polygon_index": 20, "vertices": (6, 7, 8), "region": "torso", "group": "上半身2"},
    )
    vertices = (
        (0.0, 0.0, 0.0), (0.1, 0.0, 0.0), (0.0, 0.1, 0.0),
        (1.0, 1.0, 1.0), (1.1, 1.0, 1.0), (1.0, 1.1, 1.0),
        (0.02, 0.02, 0.0), (0.12, 0.02, 0.0), (0.02, 0.12, 0.0),
    )

    evidence = tool.attribute_collision_pairs(((0, 0),), moving, torso, vertices)

    assert evidence["counts_by_moving_region"] == {"forearm": 1}
    assert evidence["counts_by_moving_group"] == {"右ひじ": 1}
    assert evidence["counts_by_torso_group"] == {"上半身2": 1}
    assert evidence["counts_by_pair"] == {"forearm:右ひじ -> torso:上半身2": 1}
    assert evidence["representative_pairs"][0]["moving_polygon_index"] == 10
    assert evidence["representative_pairs"][0]["torso_polygon_index"] == 20
    assert evidence["representative_pairs"][0]["moving_world_point"] == pytest.approx((1 / 30, 1 / 30, 0.0))
    assert evidence["overlap_bbox"]["min"] == pytest.approx((0.0, 0.0, 0.0))
    assert evidence["overlap_bbox"]["max"] == pytest.approx((0.12, 0.12, 0.0))


def test_penetration_depth_summary_reports_percentiles_and_pmx_units():
    tool = load_tool()

    summary = tool.summarize_penetration_depths((0.001, 0.002, 0.003, 0.010))

    assert summary["sample_count"] == 4
    assert summary["median_blender"] == pytest.approx(0.0025)
    assert summary["p95_blender"] == pytest.approx(0.00895)
    assert summary["max_blender"] == pytest.approx(0.010)
    assert summary["median_pmx"] == pytest.approx(0.03125)
    assert summary["max_pmx"] == pytest.approx(0.125)


def test_collision_area_evidence_uses_unique_polygons_and_moving_area_ratio():
    tool = load_tool()
    vertices = (
        (0.0, 0.0, 0.0), (2.0, 0.0, 0.0), (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0), (2.0, 0.0, 1.0), (0.0, 1.0, 1.0),
        (3.0, 0.0, 0.0), (5.0, 0.0, 0.0), (3.0, 1.0, 0.0),
    )
    moving = (
        {"polygon_index": 10, "vertices": (0, 1, 2), "region": "forearm", "group": "右ひじ"},
        {"polygon_index": 11, "vertices": (6, 7, 8), "region": "forearm", "group": "右ひじ"},
    )
    target = (
        {"polygon_index": 20, "vertices": (3, 4, 5), "region": "torso", "group": "上半身2"},
    )

    evidence = tool.collision_area_evidence(((0, 0), (0, 0)), moving, target, vertices)

    assert evidence["moving_intersecting_area_blender2"] == pytest.approx(1.0)
    assert evidence["target_intersecting_area_blender2"] == pytest.approx(1.0)
    assert evidence["moving_region_area_blender2"] == pytest.approx(2.0)
    assert evidence["moving_intersection_area_ratio"] == pytest.approx(0.5)
    assert evidence["moving_intersecting_area_pmx2"] == pytest.approx(156.25)


def test_overlap_bbox_and_silhouette_summary_are_explicit():
    tool = load_tool()

    bbox = tool.overlap_bbox_evidence(((1.0, 2.0, 3.0), (4.0, 6.0, 8.0)))
    silhouette = tool.classify_silhouette_visibility({
        "front": (False, False),
        "left": (True, False),
        "right": (False,),
    })

    assert bbox["dimensions"] == pytest.approx((3.0, 4.0, 5.0))
    assert bbox["center"] == pytest.approx((2.5, 4.0, 5.5))
    assert silhouette["front"]["classification"] == "internal_or_covered"
    assert silhouette["left"]["classification"] == "reaches_visible_outer_surface"
    assert silhouette["overall"] == "visible_from_some_review_views"


def test_severity_scale_comparison_reports_ratios_without_acceptance_verdict():
    tool = load_tool()

    comparison = tool.compare_penetration_scales(
        max_depth=0.004,
        median_mesh_edge=0.010,
        sleeve_thickness=0.020,
        chest_thickness=0.040,
    )

    assert comparison["depth_to_median_edge_ratio"] == pytest.approx(0.4)
    assert comparison["depth_to_sleeve_thickness_ratio"] == pytest.approx(0.2)
    assert comparison["depth_to_chest_thickness_ratio"] == pytest.approx(0.1)
    assert "verdict" not in comparison


def test_candidate_render_names_cover_top_six_full_body_views():
    tool = load_tool()

    names = tool.candidate_render_names(6)

    assert len(names) == 24
    assert names[0] == "candidate_001/front.png"
    assert names[-1] == "candidate_006/back.png"


def test_render_artifact_paths_include_candidate_root(cli_tmp_path):
    tool = load_tool()
    run_dir = cli_tmp_path / "run"

    paths = tool.render_artifact_paths(run_dir, 1)

    assert paths[0] == run_dir / "candidates" / "candidate_001" / "front.png"
    assert paths[-1] == run_dir / "candidates" / "candidate_001" / "back.png"


def test_static_search_policy_promotes_blocked_diagnostics_without_ranked_renders():
    tool = load_tool()

    blocked = tool.static_search_policy(collision_clear_count=0, selection_eligible_count=0)
    insufficient = tool.static_search_policy(collision_clear_count=8, selection_eligible_count=1)
    review = tool.static_search_policy(collision_clear_count=8, selection_eligible_count=6)

    assert blocked == {
        "selection_status": "BLOCKED_NEEDS_CONTEXT",
        "ranked_render_count": 0,
    }
    assert insufficient == blocked
    assert review == {
        "selection_status": "NEEDS_CONTEXT",
        "ranked_render_count": 6,
    }


def test_collision_face_classification_rejects_partial_and_adjacent_faces():
    tool = load_tool()

    assert tool.polygon_belongs_to_region((1, 2, 3), {1, 2, 3}, set()) is True
    assert tool.polygon_belongs_to_region((1, 2, 4), {1, 2, 3}, set()) is False
    assert tool.polygon_belongs_to_region((1, 2, 3), {1, 2, 3}, {3}) is False


def test_contact_alignment_grid_covers_full_calibrated_delta():
    tool = load_tool()

    variants = tool.contact_target_variants()

    assert any(factor == pytest.approx(1.0) and offset == (0.0, 0.0, 0.0) for factor, offset in variants)
    assert any(factor <= 0.4 and offset[2] >= 0.01 for factor, offset in variants)
    assert any(factor <= 0.4 and offset[0] <= -0.01 and offset[2] >= 0.01 for factor, offset in variants)
    assert all(0.0 < factor <= 1.0 for factor, _offset in variants)
    assert all(max(abs(value) for value in offset) <= 0.04 for _factor, offset in variants)


def test_finger_only_head_collision_is_not_overridden_by_clear_palm():
    tool = load_tool()

    evidence = tool.combine_head_collision_evidence(
        palm_intersections=0,
        finger_intersections=2,
        full_hand_intersections=2,
        signed_penetration_depth=0.003,
    )

    assert evidence["collision_count"] == 2
    assert evidence["penetration_depth"] == pytest.approx(0.003)
    assert evidence["sources"] == ("fingers", "full_hand")


def test_parse_blender_arguments_requires_separator(cli_tmp_path):
    tool = load_tool()
    argv = valid_cli(cli_tmp_path)
    argv.remove("--")

    with pytest.raises(ValueError, match="after Blender's -- separator"):
        tool.parse_blender_args(argv)


def test_parse_blender_arguments_accepts_explicit_frame_range(cli_tmp_path):
    tool = load_tool()
    argv = valid_cli(cli_tmp_path)
    argv[-1:-1] = ["--frame-start", "90", "--frame-end", "170"]

    config = tool.parse_blender_args(argv)

    assert (config.frame_start, config.frame_end) == (90, 170)


@pytest.mark.parametrize(
    ("argument", "replacement", "message"),
    [
        ("--source-blend", "missing.blend", "Source blend does not exist"),
        ("--vmd", "missing.vmd", "Reference VMD does not exist"),
        ("--output-blend", "wrong-name.blend", "Output blend must be named"),
        ("--output-dir", "wrong-output-directory", "Output directory must be named"),
    ],
)
def test_path_and_output_name_validation(cli_tmp_path, argument, replacement, message):
    tool = load_tool()
    argv = valid_cli(cli_tmp_path)
    argv[argv.index(argument) + 1] = str(cli_tmp_path / replacement)

    with pytest.raises(ValueError, match=message):
        tool.parse_blender_args(argv)


def test_frame_range_must_be_ordered_and_non_negative(cli_tmp_path):
    tool = load_tool()
    argv = valid_cli(cli_tmp_path)
    argv[-1:-1] = ["--frame-start", "170", "--frame-end", "90"]

    with pytest.raises(ValueError, match="valid non-negative interval"):
        tool.parse_blender_args(argv)
