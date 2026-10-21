from __future__ import annotations

from copy import deepcopy

from app.services.domain_knowledge_gate import evaluate_domain_knowledge_candidate


def _ref(ref_id: str, role: str, path: str) -> dict:
    return {
        "ref_id": ref_id,
        "role": role,
        "authority": "authoritative",
        "repository_id": "mmd-project",
        "revision": "a" * 40,
        "blob_sha": "b" * 40,
        "path": path,
        "symbol": "main",
        "line_start": 1,
        "line_end": 2,
        "snippet": "def main():\n    pass\n",
        "snippet_sha256": "sha256:" + "c" * 64,
        "resolver_uri": f"repo://mmd-project/{'a' * 40}/{path}#L1-L2",
        "command": "python tools/check.py" if role == "validation" else None,
        "outcome": "success" if role == "validation" else None,
        "exit_code": 0 if role == "validation" else None,
        "source_event_ids": [],
    }


def _candidate() -> dict:
    return {
        "kind": "project_domain_knowledge_candidate",
        "schema_version": 2,
        "candidate_id": "dkc_01",
        "candidate_revision": 1,
        "workspace_id": "mmd-companion",
        "source_kind": "session_incremental",
        "source_hash": "sha256:" + "1" * 64,
        "content_hash": "sha256:" + "0" * 64,
        "topic_match": {
            "proposed_topic_id": None,
            "topic_identity_key": "mmd-companion/motion-generation/motion-acceptance-gate",
            "match_status": "unresolved",
            "possible_topic_ids": [],
        },
        "draft": {
            "schema_version": 2,
            "topic_id": None,
            "topic_identity_key": "mmd-companion/motion-generation/motion-acceptance-gate",
            "topic_kind": "gate",
            "domain": "motion-generation",
            "title": "动作生成验收 Gate",
            "aliases": [],
            "introduced_for": {
                "problem": "Prevent invalid generated motion from being accepted.",
                "context": "VMD generation and validation",
                "failure_before_introduction": "Visual inspection missed semantic failures.",
            },
            "meaning": {
                "definition": "A deterministic set of checks for generated motion.",
                "entities": [],
                "relationships": [],
                "boundaries": {
                    "in_scope": [],
                    "out_of_scope": [],
                    "non_examples": [],
                    "confused_with": [],
                },
                "invariants": ["P0 failures block acceptance."],
            },
            "technical_solution": {
                "summary": "Run a programmatic gate against exported joints.",
                "architecture_flow": [],
                "contract_refs": [],
                "implementation_refs": ["ref-code"],
                "test_refs": [],
                "validation_refs": ["ref-validation"],
            },
            "failure_signals": [],
            "operational_appendix": {"steps": [], "cautions": []},
            "source": {
                "concept_delta_ids": ["concept_delta_01"],
                "codex_session_ids": ["019f-session"],
                "baseline_scan_ids": [],
            },
            "evidence_refs": ["ref-code", "ref-validation"],
            "open_questions": [],
        },
        "quality_gate": {
            "definition_complete": False,
            "problem_linked": False,
            "relationships_explicit": False,
            "boundaries_explicit": False,
            "invariants_explicit": False,
            "contract_linked": False,
            "code_linked": False,
            "test_or_validation_linked": False,
            "verified": False,
        },
        "status": "draft",
        "conflicts": [],
        "evidence_index": [
            {**_ref("ref-code", "implementation", "fabricated/path.py"), "revision": "fake"}
        ],
        "created_at": "2026-07-14T12:00:00+08:00",
        "updated_at": "2026-07-14T12:00:00+08:00",
    }


def _pack() -> dict:
    return {
        "repository_snapshot": {"repository_id": "mmd-project", "commit_sha": "a" * 40},
        "evidence_refs": [
            _ref("ref-code", "implementation", "imgToAction/tools/motion_acceptance_gate.py"),
            _ref("ref-validation", "validation", "imgToAction/tools/motion_acceptance_gate.py"),
        ],
    }


def _delta() -> dict:
    return {
        "payload": {
            "delta_id": "concept_delta_01",
            "terms": ["motion acceptance gate"],
        }
    }


def test_gate_reconciles_locator_fields_and_marks_complete_candidate_ready():
    result = evaluate_domain_knowledge_candidate(_candidate(), _pack(), concept_deltas=[_delta()])

    assert result["status"] == "ready_for_review"
    assert result["reason_codes"] == []
    assert result["candidate"]["quality_gate"]["verified"] is True
    assert result["candidate"]["evidence_index"][0]["path"] == "imgToAction/tools/motion_acceptance_gate.py"
    assert result["candidate"]["evidence_index"][0]["revision"] == "a" * 40
    assert result["candidate"]["content_hash"] != "sha256:" + "0" * 64


def test_gate_blocks_unknown_evidence_ref_as_needs_evidence():
    candidate = _candidate()
    candidate["draft"]["technical_solution"]["implementation_refs"] = ["ref-invented"]
    candidate["draft"]["evidence_refs"] = ["ref-invented", "ref-validation"]

    result = evaluate_domain_knowledge_candidate(candidate, _pack(), concept_deltas=[_delta()])

    assert result["status"] == "needs_evidence"
    assert "unknown_evidence_ref" in result["reason_codes"]
    assert all(ref["ref_id"] != "ref-invented" for ref in result["candidate"]["evidence_index"])


def test_gate_requires_concept_delta_for_gate_and_contract_ref_for_contract_topic():
    missing_delta = evaluate_domain_knowledge_candidate(_candidate(), _pack(), concept_deltas=[])

    assert missing_delta["status"] == "needs_author_explanation"
    assert "missing_concept_delta" in missing_delta["reason_codes"]

    contract_candidate = deepcopy(_candidate())
    contract_candidate["draft"]["topic_kind"] = "contract"
    contract_candidate["draft"]["source"]["concept_delta_ids"] = ["concept_delta_01"]
    missing_contract_ref = evaluate_domain_knowledge_candidate(
        contract_candidate,
        _pack(),
        concept_deltas=[_delta()],
    )

    assert missing_contract_ref["status"] == "needs_evidence"
    assert "missing_contract_evidence" in missing_contract_ref["reason_codes"]


def test_gate_detects_omitted_invariant_section_even_when_model_has_defaults():
    candidate = _candidate()
    del candidate["draft"]["meaning"]["invariants"]

    result = evaluate_domain_knowledge_candidate(candidate, _pack(), concept_deltas=[_delta()])

    assert result["status"] == "needs_evidence"
    assert result["candidate"]["quality_gate"]["invariants_explicit"] is False
    assert "missing_invariants" in result["reason_codes"]

