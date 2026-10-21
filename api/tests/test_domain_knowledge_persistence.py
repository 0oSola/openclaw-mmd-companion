from __future__ import annotations

from pathlib import Path
import sqlite3
from uuid import uuid4

from app.db.store import TraceStore
from app.services.domain_knowledge_concept_delta import collect_concept_deltas


def _case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _store() -> TraceStore:
    path = _case_dir()
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def _delta() -> dict:
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
            "failure_before_introduction": "Visual checks missed semantic failures.",
        },
        "definitions": [
            {
                "term": "motion acceptance gate",
                "definition": "A deterministic acceptance decision for generated motion.",
            }
        ],
        "relationships": [],
        "boundaries": {
            "in_scope": [],
            "out_of_scope": [],
            "non_examples": [],
            "confused_with": [],
        },
        "invariants": ["P0 failures block acceptance."],
        "technical_solution_claims": [],
        "evidence_hints": [],
        "open_questions": [],
    }


def _candidate() -> dict:
    return {
        "kind": "project_domain_knowledge_candidate",
        "schema_version": 2,
        "candidate_id": "dkc_persistence_01",
        "candidate_revision": 1,
        "workspace_id": "mmd-companion",
        "source_kind": "manual",
        "source_hash": "sha256:" + "1" * 64,
        "content_hash": "sha256:" + "2" * 64,
        "topic_match": {
            "proposed_topic_id": None,
            "topic_identity_key": "mmd-companion/integration/outbound-control-plane",
            "match_status": "new_topic",
            "possible_topic_ids": [],
        },
        "draft": {
            "schema_version": 2,
            "topic_id": None,
            "topic_identity_key": "mmd-companion/integration/outbound-control-plane",
            "topic_kind": "decision",
            "domain": "integration",
            "title": "FastAPI 主动对接 OpenClaw 控制面",
            "aliases": [],
            "introduced_for": {
                "problem": "OpenClaw cannot safely call the local API.",
                "context": "Cross-machine review and publication.",
                "failure_before_introduction": "Inbound callbacks were not reliably reachable.",
            },
            "meaning": {
                "definition": "FastAPI initiates every control-plane request.",
                "entities": [],
                "relationships": [],
                "boundaries": {
                    "in_scope": [],
                    "out_of_scope": [],
                    "non_examples": [],
                    "confused_with": [],
                },
                "invariants": [],
            },
            "technical_solution": {
                "summary": "Use durable push/poll HTTP control-plane messages.",
                "architecture_flow": [],
                "contract_refs": [],
                "implementation_refs": [],
                "test_refs": [],
                "validation_refs": [],
            },
            "failure_signals": [],
            "operational_appendix": None,
            "source": {
                "concept_delta_ids": [],
                "codex_session_ids": [],
                "baseline_scan_ids": [],
            },
            "evidence_refs": [],
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
        "evidence_index": [],
        "created_at": "2026-07-14T12:00:00+08:00",
        "updated_at": "2026-07-14T12:00:00+08:00",
    }


def test_domain_knowledge_v2_tables_are_additive():
    store = _store()
    rows = sqlite3.connect(store.db_path).execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    tables = {row[0] for row in rows}

    assert {
        "codex_concept_deltas",
        "domain_knowledge_evidence_refs",
        "domain_knowledge_topics",
        "domain_knowledge_candidates",
        "domain_knowledge_candidate_versions",
        "domain_knowledge_candidate_evidence",
        "domain_knowledge_review_decisions",
        "domain_knowledge_wiki_change_sets",
        "domain_knowledge_publication_receipts",
        "domain_knowledge_wiki_page_snapshots",
        "domain_knowledge_scan_runs",
        "domain_term_coverage_findings",
        "domain_knowledge_extraction_outbox",
        "domain_knowledge_control_plane_commands",
        "domain_knowledge_candidate_deliveries",
        "domain_knowledge_control_plane_runs",
    }.issubset(tables)


def test_concept_delta_collection_persists_exact_author_payload_idempotently():
    store = _store()
    raw_author_text = '{"kind":"codex_concept_delta","delta_id":"concept_delta_01"}'

    first = collect_concept_deltas(
        store,
        {
            "workspace_id": "mmd-companion",
            "codex_session_id": "019f-session",
            "concept_deltas": [{"payload": _delta(), "raw_author_text": raw_author_text}],
            "domain_term_changes": [],
        },
    )
    second = collect_concept_deltas(
        store,
        {
            "workspace_id": "mmd-companion",
            "codex_session_id": "019f-session",
            "concept_deltas": [{"payload": _delta(), "raw_author_text": raw_author_text}],
            "domain_term_changes": [],
        },
    )

    assert first["concept_deltas"][0]["payload"] == _delta()
    assert first["concept_deltas"][0]["raw_author_text"] == raw_author_text
    assert first["concept_deltas"][0]["author_text_sha256"].startswith("sha256:")
    assert second["concept_deltas"][0]["id"] == first["concept_deltas"][0]["id"]
    assert len(store.list_codex_concept_deltas(codex_session_id="019f-session")) == 1


def test_missing_concept_delta_creates_coverage_finding_without_fabricating_delta():
    store = _store()

    result = collect_concept_deltas(
        store,
        {
            "workspace_id": "mmd-companion",
            "codex_session_id": "019f-session",
            "concept_deltas": [],
            "domain_term_changes": [
                {
                    "term": "motion acceptance gate",
                    "topic_kind": "gate",
                    "change_kind": "introduce",
                    "source_event_ids": ["event-1"],
                }
            ],
        },
    )

    assert result["concept_deltas"] == []
    assert result["coverage_findings"][0]["classification"] == "missing_author_explanation"
    assert result["coverage_findings"][0]["term"] == "motion acceptance gate"
    assert store.list_domain_term_coverage_findings(codex_session_id="019f-session")[0]["status"] == "open"


def test_candidate_delivery_and_control_plane_cursors_survive_store_reopen():
    store = _store()
    candidate = _candidate()
    stored = store.persist_domain_knowledge_candidate(candidate)
    delivery = store.enqueue_domain_knowledge_candidate_delivery(
        run_id="project-knowledge:mmd-companion:incremental:2026-07-14",
        candidate_id=candidate["candidate_id"],
        candidate_revision=1,
        payload_hash="sha256:" + "3" * 64,
        payload={"candidate_id": candidate["candidate_id"], "candidate_revision": 1},
    )
    claimed = store.claim_next_domain_knowledge_candidate_delivery(now_iso="2099-01-01T00:00:00+00:00")
    store.mark_domain_knowledge_candidate_delivery_accepted(delivery["id"])
    store.update_domain_knowledge_control_plane_cursors(
        run_id=delivery["run_id"],
        command_cursor="command-cursor-7",
        publish_cursor="publish-cursor-4",
    )
    db_path = store.db_path
    ndjson_dir = store.ndjson_dir
    store.close()

    reopened = TraceStore(db_path=db_path, ndjson_dir=ndjson_dir)

    assert stored["payload"] == candidate
    assert claimed["status"] == "sending"
    assert claimed["attempt_count"] == 1
    assert reopened.get_domain_knowledge_candidate_version(candidate["candidate_id"], 1)["payload"] == candidate
    assert reopened.get_domain_knowledge_candidate_delivery(delivery["id"])["status"] == "accepted"
    assert reopened.get_domain_knowledge_control_plane_cursors(delivery["run_id"]) == {
        "run_id": delivery["run_id"],
        "command_cursor": "command-cursor-7",
        "publish_cursor": "publish-cursor-4",
    }


def test_candidate_revision_and_delivery_payloads_are_immutable():
    store = _store()
    candidate = _candidate()
    store.persist_domain_knowledge_candidate(candidate)
    store.enqueue_domain_knowledge_candidate_delivery(
        run_id="project-knowledge:mmd-companion:incremental:2026-07-14",
        candidate_id=candidate["candidate_id"],
        candidate_revision=1,
        payload_hash="sha256:" + "3" * 64,
        payload={"candidate_id": candidate["candidate_id"], "candidate_revision": 1},
    )

    changed_candidate = {**candidate, "content_hash": "sha256:" + "9" * 64}
    try:
        store.persist_domain_knowledge_candidate(changed_candidate)
    except ValueError as error:
        assert "immutable" in str(error)
    else:
        raise AssertionError("candidate revision mutation must be rejected")

    try:
        store.enqueue_domain_knowledge_candidate_delivery(
            run_id="project-knowledge:mmd-companion:incremental:2026-07-14",
            candidate_id=candidate["candidate_id"],
            candidate_revision=1,
            payload_hash="sha256:" + "8" * 64,
            payload={"candidate_id": candidate["candidate_id"], "candidate_revision": 1, "changed": True},
        )
    except ValueError as error:
        assert "immutable" in str(error)
    else:
        raise AssertionError("candidate delivery mutation must be rejected")
