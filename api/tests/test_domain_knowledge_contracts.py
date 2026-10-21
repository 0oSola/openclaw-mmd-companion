from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.domain_knowledge import (
    AcceptedWikiChangeSet,
    ConceptDelta,
    DomainKnowledgeCandidate,
    EvidenceReference,
    PublicationReceipt,
    ReviewDecision,
    WikiChangeProposal,
)


def _concept_delta_payload() -> dict:
    return {
        "kind": "codex_concept_delta",
        "schema_version": 1,
        "delta_id": "concept_delta_01",
        "workspace_id": "mmd-companion",
        "codex_session_id": "019f-session",
        "author": "codex",
        "change_kind": "introduce",
        "terms": ["motion acceptance gate"],
        "introduced_for": {
            "problem": "Prevent invalid generated motion from being accepted.",
            "context": "VMD generation and validation",
            "failure_before_introduction": "Visual plausibility missed semantic failures.",
        },
        "definitions": [
            {
                "term": "motion acceptance gate",
                "definition": "A deterministic set of checks for generated motion.",
            }
        ],
        "relationships": [],
        "boundaries": {
            "in_scope": ["generated VMD acceptance"],
            "out_of_scope": ["manual animation authoring"],
            "non_examples": [],
            "confused_with": [],
        },
        "invariants": ["P0 failures block acceptance."],
        "technical_solution_claims": [],
        "evidence_hints": [],
        "open_questions": [],
    }


def _evidence_payload(ref_id: str, role: str) -> dict:
    return {
        "ref_id": ref_id,
        "role": role,
        "authority": "authoritative",
        "repository_id": "mmd-project",
        "revision": "a" * 40,
        "blob_sha": "b" * 40,
        "path": "imgToAction/tools/motion_acceptance_gate.py",
        "symbol": "main",
        "line_start": 100,
        "line_end": 140,
        "snippet": "def main():\n    pass\n",
        "snippet_sha256": "sha256:" + "c" * 64,
        "resolver_uri": "repo://mmd-project/" + "a" * 40 + "/imgToAction/tools/motion_acceptance_gate.py#L100-L140",
        "command": None,
        "outcome": None,
        "exit_code": None,
        "source_event_ids": [],
    }


def _candidate_payload() -> dict:
    implementation = _evidence_payload("ref-implementation", "implementation")
    validation = _evidence_payload("ref-validation", "validation")
    validation.update(
        {
            "path": "imgToAction/docs/motion_acceptance_gate.md",
            "symbol": None,
            "line_start": 1,
            "line_end": 10,
            "command": "python imgToAction/tools/motion_acceptance_gate.py joints.json",
            "outcome": "success",
            "exit_code": 0,
        }
    )
    return {
        "kind": "project_domain_knowledge_candidate",
        "schema_version": 2,
        "candidate_id": "dkc_01",
        "candidate_revision": 1,
        "workspace_id": "mmd-companion",
        "source_kind": "session_incremental",
        "source_hash": "sha256:" + "1" * 64,
        "content_hash": "sha256:" + "2" * 64,
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
            "introduced_for": _concept_delta_payload()["introduced_for"],
            "meaning": {
                "definition": "A deterministic set of checks for generated motion.",
                "entities": [],
                "relationships": [],
                "boundaries": _concept_delta_payload()["boundaries"],
                "invariants": ["P0 failures block acceptance."],
            },
            "technical_solution": {
                "summary": "Run the acceptance script against exported joints.",
                "architecture_flow": [],
                "contract_refs": [],
                "implementation_refs": ["ref-implementation"],
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
            "evidence_refs": ["ref-implementation", "ref-validation"],
            "open_questions": [],
        },
        "quality_gate": {
            "definition_complete": True,
            "problem_linked": True,
            "relationships_explicit": True,
            "boundaries_explicit": True,
            "invariants_explicit": True,
            "contract_linked": False,
            "code_linked": True,
            "test_or_validation_linked": True,
            "verified": True,
        },
        "status": "ready_for_review",
        "conflicts": [],
        "evidence_index": [implementation, validation],
        "created_at": "2026-07-14T12:00:00+08:00",
        "updated_at": "2026-07-14T12:00:00+08:00",
    }


def test_concept_delta_preserves_author_text_and_rejects_unknown_change_kind():
    payload = _concept_delta_payload()
    delta = ConceptDelta.model_validate(payload)

    assert delta.model_dump(mode="json") == payload

    payload["change_kind"] = "rewrite"
    with pytest.raises(ValidationError):
        ConceptDelta.model_validate(payload)


def test_evidence_reference_rejects_absolute_paths_and_invalid_line_ranges():
    absolute = _evidence_payload("ref-code", "implementation")
    absolute["path"] = "/mnt/d/workspace/mmd project/api/app/main.py"
    with pytest.raises(ValidationError, match="workspace-relative"):
        EvidenceReference.model_validate(absolute)

    invalid_range = _evidence_payload("ref-code", "implementation")
    invalid_range["line_start"] = 20
    invalid_range["line_end"] = 10
    with pytest.raises(ValidationError, match="line_end"):
        EvidenceReference.model_validate(invalid_range)


def test_domain_knowledge_candidate_accepts_normative_v2_shape():
    candidate = DomainKnowledgeCandidate.model_validate(_candidate_payload())

    assert candidate.draft.topic_kind == "gate"
    assert candidate.evidence_index[0].revision == "a" * 40
    assert candidate.status == "ready_for_review"


def test_conflict_proposal_is_non_publishable_and_has_zero_affected_files():
    proposal = WikiChangeProposal.model_validate(
        {
            "proposal_id": "dkp_01",
            "proposal_revision": 1,
            "candidate_id": "dkc_01",
            "candidate_revision": 1,
            "match_state": "conflict",
            "publishable": False,
            "publication_action": "none",
            "target": None,
            "affected_files": [],
            "proposed_markdown": "",
            "proposed_content_sha256": "sha256:" + "0" * 64,
            "diff": {"format": "unified", "files": [], "sha256": "sha256:" + "0" * 64},
            "conflict_summary": ["Definitions disagree."],
            "created_at": "2026-07-14T12:05:00+08:00",
        }
    )

    assert proposal.publication_action == "none"

    invalid = proposal.model_dump(mode="json")
    invalid["affected_files"] = [{"path": "domains/topic.md", "content": "unsafe"}]
    with pytest.raises(ValidationError, match="zero affected files"):
        WikiChangeProposal.model_validate(invalid)


def test_publishable_create_requires_target_path_without_existing_page_hash():
    proposal = WikiChangeProposal.model_validate(
        {
            "proposal_id": "dkp_create",
            "proposal_revision": 1,
            "candidate_id": "dkc_01",
            "candidate_revision": 1,
            "match_state": "new_topic",
            "publishable": True,
            "publication_action": "create",
            "target": {
                "topic_id": None,
                "path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
                "base_content_sha256": None,
                "base_git_revision": "a" * 40,
            },
            "affected_files": [{"path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md"}],
            "proposed_markdown": "---\n...",
            "proposed_content_sha256": "sha256:" + "4" * 64,
            "diff": {"format": "unified", "files": [], "sha256": "sha256:" + "5" * 64},
            "conflict_summary": [],
            "created_at": "2026-07-14T12:05:00+08:00",
        }
    )

    assert proposal.target is not None
    assert proposal.target.base_content_sha256 is None

    invalid = proposal.model_dump(mode="json")
    invalid["target"] = None
    with pytest.raises(ValidationError, match="requires a target"):
        WikiChangeProposal.model_validate(invalid)


def test_review_decision_keeps_content_and_publication_reviews_separate():
    decision = ReviewDecision.model_validate(
        {
            "kind": "project_domain_knowledge_review_decision",
            "schema_version": 1,
            "command_id": "openclaw_knowledge_cmd_01",
            "candidate_id": "dkc_01",
            "candidate_revision": 1,
            "input_content_sha256": "sha256:" + "1" * 64,
            "content_review": {
                "decision": "accept",
                "approved_knowledge": _candidate_payload()["draft"],
                "approved_knowledge_sha256": "sha256:" + "2" * 64,
                "missing_evidence_requests": [],
                "notes": None,
            },
            "publication_review": {
                "decision": "approve",
                "proposal_id": "dkp_01",
                "proposal_revision": 1,
                "action": "update",
                "target_path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
                "base_content_sha256": "sha256:" + "3" * 64,
                "approved_document_sha256": "sha256:" + "4" * 64,
                "approved_diff_sha256": "sha256:" + "5" * 64,
            },
            "reviewer": {
                "user_id": "admin-1",
                "channel": "openclaw",
                "confirmed_at": "2026-07-14T12:10:00+08:00",
            },
            "idempotency_key": "knowledge-review:sha256:" + "6" * 64,
        }
    )

    assert decision.content_review.decision == "accept"
    assert decision.publication_review.decision == "approve"


def test_accepted_change_set_and_receipt_bind_exact_document_hash():
    change_set = AcceptedWikiChangeSet.model_validate(
        {
            "kind": "project_domain_knowledge_wiki_change_set",
            "schema_version": 1,
            "change_set_id": "dkcs_01",
            "candidate_id": "dkc_01",
            "candidate_revision": 1,
            "decision_command_id": "openclaw_knowledge_cmd_01",
            "publication_action": "update",
            "target": {
                "topic_id": "dkt_01",
                "path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
                "base_content_sha256": "sha256:" + "3" * 64,
                "base_git_revision": "a" * 40,
            },
            "approved_knowledge": _candidate_payload()["draft"],
            "approved_knowledge_sha256": "sha256:" + "2" * 64,
            "approved_files": [{"path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md"}],
            "approved_diff": {
                "format": "unified",
                "files": [],
                "sha256": "sha256:" + "5" * 64,
            },
            "approved_document_sha256": "sha256:" + "4" * 64,
            "approved_diff_sha256": "sha256:" + "5" * 64,
            "confirmed_by": "admin-1",
            "confirmed_at": "2026-07-14T12:10:00+08:00",
            "publish_status": "pending",
        }
    )
    receipt = PublicationReceipt.model_validate(
        {
            "kind": "project_domain_knowledge_publication_receipt",
            "schema_version": 1,
            "change_set_id": change_set.change_set_id,
            "status": "published",
            "publication_action": "update",
            "wiki_topic_id": "dkt_01",
            "wiki_path": "projects/mmd-companion/domains/motion-generation/motion-acceptance-gate.md",
            "published_content_sha256": change_set.approved_document_sha256,
            "lint": {"status": "passed", "errors": [], "warnings": []},
            "git": {"commit_sha": "a" * 40, "branch": "main", "pushed": True},
            "error": None,
            "published_at": "2026-07-14T12:15:00+08:00",
        }
    )

    assert receipt.published_content_sha256 == change_set.approved_document_sha256

    invalid = receipt.model_dump(mode="json")
    invalid["git"]["pushed"] = False
    with pytest.raises(ValidationError, match="published receipt"):
        PublicationReceipt.model_validate(invalid)
