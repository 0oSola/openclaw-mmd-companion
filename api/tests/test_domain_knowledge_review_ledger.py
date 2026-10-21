from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest

from app.db.store import TraceStore
from app.services.domain_knowledge_review_ledger import (
    apply_domain_knowledge_publication_receipt,
    apply_domain_knowledge_review_command,
    canonical_domain_knowledge_sha256,
)


def _store() -> TraceStore:
    root = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=root / "sqlite" / "trace.db", ndjson_dir=root / "logs")


def _draft() -> dict:
    return {
        "schema_version": 2,
        "topic_id": None,
        "topic_identity_key": "mmd-companion/integration/outbound-control-plane",
        "topic_kind": "decision",
        "domain": "integration",
        "title": "FastAPI 主动对接 OpenClaw 控制面",
        "aliases": ["Outbound OpenClaw Control Plane Sync"],
        "introduced_for": {
            "problem": "OpenClaw cannot safely call the local API.",
            "context": "Cross-machine review and publication.",
            "failure_before_introduction": "Inbound callbacks were not reliably reachable.",
        },
        "meaning": {
            "definition": "FastAPI initiates every control-plane request.",
            "entities": ["FastAPI", "OpenClaw Control Plane"],
            "relationships": ["FastAPI pushes and polls; OpenClaw reviews and publishes."],
            "boundaries": {
                "in_scope": ["candidate push", "command polling", "receipt polling"],
                "out_of_scope": ["OpenClaw reading the local repository"],
                "non_examples": ["browser direct access"],
                "confused_with": ["OpenClaw Gateway generation API"],
            },
            "invariants": ["FastAPI initiates all cross-machine requests."],
        },
        "technical_solution": {
            "summary": "Use durable push/poll HTTP control-plane messages.",
            "architecture_flow": ["FastAPI -> OpenClaw", "FastAPI <- OpenClaw poll"],
            "contract_refs": [],
            "implementation_refs": [],
            "test_refs": [],
            "validation_refs": [],
        },
        "failure_signals": ["stale cursor", "hash mismatch"],
        "operational_appendix": None,
        "source": {
            "concept_delta_ids": [],
            "codex_session_ids": [],
            "baseline_scan_ids": [],
        },
        "evidence_refs": [],
        "open_questions": [],
    }


def _candidate() -> dict:
    draft = _draft()
    return {
        "kind": "project_domain_knowledge_candidate",
        "schema_version": 2,
        "candidate_id": "dkc_review_ledger_01",
        "candidate_revision": 1,
        "workspace_id": "mmd-companion",
        "source_kind": "manual",
        "source_hash": "sha256:" + "1" * 64,
        "content_hash": canonical_domain_knowledge_sha256({"draft": draft, "evidence_ref_ids": []}),
        "topic_match": {
            "proposed_topic_id": None,
            "topic_identity_key": draft["topic_identity_key"],
            "match_status": "new_topic",
            "possible_topic_ids": [],
        },
        "draft": draft,
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
        "evidence_index": [],
        "created_at": "2026-07-14T12:00:00+08:00",
        "updated_at": "2026-07-14T12:00:00+08:00",
    }


def _command(candidate: dict) -> dict:
    markdown = "---\ntopic_id: pending\n---\n\n# FastAPI 主动对接 OpenClaw 控制面\n"
    document_sha = canonical_domain_knowledge_sha256(markdown)
    affected_files = [
        {
            "path": "projects/mmd-companion/domains/integration/outbound-control-plane.md",
            "content": markdown,
            "content_sha256": document_sha,
        }
    ]
    diff_body = {
        "format": "unified",
        "files": [
            {
                "path": affected_files[0]["path"],
                "patch": "--- /dev/null\n+++ b/outbound-control-plane.md\n@@ -0,0 +1,5 @@\n+---\n",
            }
        ],
    }
    diff_sha = canonical_domain_knowledge_sha256(diff_body)
    approved_knowledge = deepcopy(candidate["draft"])
    approved_knowledge_sha = canonical_domain_knowledge_sha256(approved_knowledge)
    return {
        "kind": "project_domain_knowledge_review_decision",
        "schema_version": 1,
        "command_id": "openclaw_knowledge_cmd_01",
        "candidate_id": candidate["candidate_id"],
        "candidate_revision": 1,
        "input_content_sha256": candidate["content_hash"],
        "content_review": {
            "decision": "accept",
            "approved_knowledge": approved_knowledge,
            "approved_knowledge_sha256": approved_knowledge_sha,
            "missing_evidence_requests": [],
            "notes": None,
        },
        "publication_review": {
            "decision": "approve",
            "proposal_id": "dkp_01",
            "proposal_revision": 1,
            "action": "create",
            "target_path": affected_files[0]["path"],
            "base_content_sha256": None,
            "approved_document_sha256": document_sha,
            "approved_diff_sha256": diff_sha,
        },
        "reviewer": {
            "user_id": "admin-1",
            "channel": "openclaw",
            "confirmed_at": "2026-07-14T12:10:00+08:00",
        },
        "idempotency_key": "knowledge-review:sha256:" + "4" * 64,
        "proposal": {
            "proposal_id": "dkp_01",
            "proposal_revision": 1,
            "candidate_id": candidate["candidate_id"],
            "candidate_revision": 1,
            "publication_action": "create",
            "target": {
                "topic_id": None,
                "path": affected_files[0]["path"],
                "base_content_sha256": None,
                "base_git_revision": "vault-head-01",
            },
            "affected_files": affected_files,
            "document": {"markdown": markdown, "sha256": document_sha},
            "diff": {**diff_body, "sha256": diff_sha},
        },
    }


def test_review_command_validates_exact_proposal_and_replays_original_change_set():
    store = _store()
    candidate = _candidate()
    store.persist_domain_knowledge_candidate(candidate)
    command = _command(candidate)

    first = apply_domain_knowledge_review_command(
        store,
        run_id="project-knowledge:mmd-companion:incremental:2026-07-14",
        command=command,
        cursor="command-cursor-1",
    )
    second = apply_domain_knowledge_review_command(
        store,
        run_id="project-knowledge:mmd-companion:incremental:2026-07-14",
        command=command,
        cursor="command-cursor-1",
    )

    assert first["status"] == "accepted"
    assert first["replayed"] is False
    assert first["change_set"]["decision_command_id"] == command["command_id"]
    assert first["change_set"]["approved_files"] == command["proposal"]["affected_files"]
    assert first["change_set"]["target"]["topic_id"].startswith("dkt_")
    assert first["change_set"]["target"]["base_git_revision"] == "vault-head-01"
    assert first["change_set"]["approved_diff"] == command["proposal"]["diff"]
    assert second == {**first, "replayed": True}
    assert store.get_domain_knowledge_control_plane_cursors(first["run_id"])["command_cursor"] == "command-cursor-1"


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda command: command["proposal"]["document"].update(markdown="changed"), "document hash"),
        (lambda command: command["proposal"]["diff"]["files"][0].update(patch="changed"), "diff hash"),
        (lambda command: command["publication_review"].update(proposal_revision=2), "proposal revision"),
        (lambda command: command.update(candidate_revision=2), "candidate revision"),
    ],
)
def test_review_command_rejects_stale_or_hash_mismatched_proposal(mutate, message):
    store = _store()
    candidate = _candidate()
    store.persist_domain_knowledge_candidate(candidate)
    command = _command(candidate)
    mutate(command)

    with pytest.raises(ValueError, match=message):
        apply_domain_knowledge_review_command(
            store,
            run_id="project-knowledge:mmd-companion:incremental:2026-07-14",
            command=command,
            cursor="command-cursor-1",
        )


def test_same_command_id_with_different_payload_is_rejected():
    store = _store()
    candidate = _candidate()
    store.persist_domain_knowledge_candidate(candidate)
    command = _command(candidate)
    apply_domain_knowledge_review_command(store, run_id="run-1", command=command, cursor="cursor-1")
    changed = deepcopy(command)
    changed["reviewer"]["user_id"] = "admin-2"

    with pytest.raises(ValueError, match="immutable"):
        apply_domain_knowledge_review_command(store, run_id="run-1", command=changed, cursor="cursor-1")


def test_openclaw_wire_command_is_normalized_without_weakening_payload_hash_validation():
    store = _store()
    candidate = _candidate()
    store.persist_domain_knowledge_candidate(candidate)
    delivery_hash = "sha256:" + "7" * 64
    store.enqueue_domain_knowledge_candidate_delivery(
        run_id="run-1",
        candidate_id=candidate["candidate_id"],
        candidate_revision=1,
        payload_hash=delivery_hash,
        payload={"candidate_id": candidate["candidate_id"], "candidate_revision": 1},
    )
    command = _command(candidate)
    command["id"] = command.pop("command_id")
    command["type"] = "project_knowledge_review_decision"
    command["input_payload_sha256"] = delivery_hash
    command.pop("input_content_sha256")
    command.pop("kind")
    command.pop("schema_version")
    command["publication_review"]["base_git_revision"] = "vault-head-01"
    command["reviewer"]["message_id"] = "msg-01"

    result = apply_domain_knowledge_review_command(store, run_id="run-1", command=command, cursor="cursor-1")

    assert result["status"] == "accepted"
    assert result["command_id"] == "openclaw_knowledge_cmd_01"


def test_publication_receipt_must_match_approved_document_hash():
    store = _store()
    candidate = _candidate()
    store.persist_domain_knowledge_candidate(candidate)
    result = apply_domain_knowledge_review_command(
        store,
        run_id="run-1",
        command=_command(candidate),
        cursor="cursor-1",
    )
    change_set = result["change_set"]
    receipt = {
        "kind": "project_domain_knowledge_publication_receipt",
        "schema_version": 1,
        "change_set_id": change_set["change_set_id"],
        "status": "published",
        "publication_action": "create",
        "wiki_topic_id": change_set["target"]["topic_id"],
        "wiki_path": change_set["target"]["path"],
        "published_content_sha256": "sha256:" + "9" * 64,
        "lint": {"status": "passed", "errors": [], "warnings": []},
        "git": {"commit_sha": "vault-commit-1", "branch": "main", "pushed": True},
        "error": None,
        "published_at": "2026-07-14T12:15:00+08:00",
    }

    with pytest.raises(ValueError, match="published content hash"):
        apply_domain_knowledge_publication_receipt(store, receipt)

    receipt["published_content_sha256"] = change_set["approved_document_sha256"]
    applied = apply_domain_knowledge_publication_receipt(store, receipt)

    assert applied["status"] == "published"
    assert store.get_domain_knowledge_wiki_change_set(change_set["change_set_id"])["publish_status"] == "published"
