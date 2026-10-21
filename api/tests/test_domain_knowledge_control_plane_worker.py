from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from app.db.store import TraceStore
from app.services.domain_knowledge_control_plane import (
    build_domain_knowledge_publish_payload,
    poll_domain_knowledge_review_commands,
    poll_domain_knowledge_publication_receipts,
    process_domain_knowledge_control_plane_once,
    push_pending_domain_knowledge_candidates,
    push_pending_domain_knowledge_change_sets,
)
from app.services.domain_knowledge_review_ledger import canonical_domain_knowledge_sha256


def _store() -> TraceStore:
    root = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=root / "sqlite" / "trace.db", ndjson_dir=root / "logs")


class _Client:
    def __init__(self) -> None:
        self.candidate_batches: list[tuple[str, dict]] = []
        self.command_results: list[tuple[str, dict]] = []
        self.publish_batches: list[tuple[str, dict]] = []
        self.commands_response: dict = {"commands": [], "cursor": None}
        self.publish_response: dict = {"items": [], "cursor": None}

    async def post_project_knowledge_candidates(self, *, run_id: str, batch: dict) -> dict:
        self.candidate_batches.append((run_id, batch))
        item = batch["items"][0]
        return {
            "status": "candidate_batch_received",
            "run_id": run_id,
            "items": [
                {
                    "candidate_id": item["candidate_id"],
                    "candidate_revision": item["candidate_revision"],
                    "status": "accepted",
                    "error": None,
                }
            ],
        }

    async def get_project_knowledge_commands(self, *, run_id: str, cursor: str | None = None) -> dict:
        assert cursor == "command-cursor-0"
        return self.commands_response

    async def post_project_knowledge_command_result(self, *, command_id: str, result: dict) -> dict:
        self.command_results.append((command_id, result))
        return {"status": "result_received"}

    async def post_project_knowledge_publish_payloads(self, *, run_id: str, batch: dict) -> dict:
        self.publish_batches.append((run_id, batch))
        ticket = batch["payloads"][0]["publish_ticket_id"]
        return {"status": "publish_payloads_received", "items": [{"publish_ticket_id": ticket, "status": "accepted"}]}

    async def get_project_knowledge_publish_status(self, *, run_id: str, cursor: str | None = None) -> dict:
        assert cursor == "publish-cursor-0"
        return self.publish_response


def test_pending_candidate_delivery_is_pushed_as_one_idempotent_v2_batch():
    store = _store()
    client = _Client()
    run_id = "project-knowledge:mmd-companion:incremental:2026-07-14"
    payload = {
        "candidate_id": "dkc_01",
        "candidate_revision": 1,
        "payload_sha256": "sha256:" + "3" * 64,
    }
    delivery = store.enqueue_domain_knowledge_candidate_delivery(
        run_id=run_id,
        candidate_id="dkc_01",
        candidate_revision=1,
        payload_hash=payload["payload_sha256"],
        payload=payload,
    )
    app = SimpleNamespace(state=SimpleNamespace(trace_store=store, openclaw_control_plane_client=client))

    result = asyncio.run(push_pending_domain_knowledge_candidates(app))

    assert result["status"] == "accepted"
    assert store.get_domain_knowledge_candidate_delivery(delivery["id"])["status"] == "accepted"
    sent_run_id, batch = client.candidate_batches[0]
    assert sent_run_id == run_id
    assert batch == {
        "kind": "project_domain_knowledge_candidate_batch",
        "schema_version": 1,
        "run_id": run_id,
        "workspace_id": "mmd-companion",
        "items": [payload],
        "idempotency_key": "knowledge-candidates:" + payload["payload_sha256"].removeprefix("sha256:"),
    }


def test_command_cursor_advances_only_after_every_command_result_is_acknowledged(monkeypatch):
    store = _store()
    client = _Client()
    run_id = "project-knowledge:mmd-companion:incremental:2026-07-14"
    store.update_domain_knowledge_control_plane_cursors(run_id=run_id, command_cursor="command-cursor-0")
    client.commands_response = {
        "commands": [
            {"id": "cmd-1", "type": "project_knowledge_review_decision"},
            {"id": "cmd-2", "type": "project_knowledge_review_decision"},
        ],
        "cursor": "command-cursor-2",
    }
    applied: list[tuple[str, str | None]] = []

    def fake_apply(store_arg, *, run_id: str, command: dict, cursor: str | None):
        applied.append((command["id"], cursor))
        return {
            "run_id": run_id,
            "command_id": command["id"],
            "status": "recorded",
            "change_set": None,
            "replayed": False,
        }

    monkeypatch.setattr(
        "app.services.domain_knowledge_control_plane.apply_domain_knowledge_review_command",
        fake_apply,
    )
    app = SimpleNamespace(state=SimpleNamespace(trace_store=store, openclaw_control_plane_client=client))

    result = asyncio.run(poll_domain_knowledge_review_commands(app, run_id=run_id))

    assert applied == [("cmd-1", "command-cursor-0"), ("cmd-2", "command-cursor-0")]
    assert [item[0] for item in client.command_results] == ["cmd-1", "cmd-2"]
    assert all(item[1]["status"] == "succeeded" for item in client.command_results)
    assert result["cursor"] == "command-cursor-2"
    assert store.get_domain_knowledge_control_plane_cursors(run_id)["command_cursor"] == "command-cursor-2"


def test_publish_payload_contains_exact_reviewed_files_diff_and_revision_fingerprint():
    markdown = "# Approved\n"
    document_sha = canonical_domain_knowledge_sha256(markdown)
    diff = {
        "format": "unified",
        "files": [{"path": "projects/mmd-companion/domains/integration/topic.md", "patch": "@@ -0,0 +1 @@"}],
    }
    diff["sha256"] = canonical_domain_knowledge_sha256(diff)
    change_set = {
        "change_set_id": "dkcs_01",
        "candidate_id": "dkc_01",
        "candidate_revision": 1,
        "decision_command_id": "cmd-1",
        "publication_action": "create",
        "target": {
            "topic_id": "dkt_01",
            "path": "projects/mmd-companion/domains/integration/topic.md",
            "base_content_sha256": canonical_domain_knowledge_sha256(""),
            "base_git_revision": "vault-head-01",
        },
        "approved_knowledge": {"source": {"concept_delta_ids": [], "codex_session_ids": [], "baseline_scan_ids": []}},
        "approved_knowledge_sha256": "sha256:" + "4" * 64,
        "approved_files": [
            {
                "path": "projects/mmd-companion/domains/integration/topic.md",
                "content": markdown,
                "content_sha256": document_sha,
            }
        ],
        "approved_diff": diff,
        "approved_document_sha256": document_sha,
        "approved_diff_sha256": diff["sha256"],
        "confirmed_by": "admin-1",
        "confirmed_at": "2026-07-14T12:10:00+08:00",
    }
    candidate = {
        "evidence_index": [{"revision": "repository-head-01", "ref_id": "ref-1"}],
        "draft": change_set["approved_knowledge"],
    }

    payload = build_domain_knowledge_publish_payload(change_set, candidate)

    assert payload["authorization"]["base_git_revision"] == "vault-head-01"
    assert payload["authorization"]["approved_document_sha256"] == document_sha
    assert payload["wiki"]["files"][0]["markdown"] == markdown
    assert payload["wiki"]["approved_diff"] == diff
    assert payload["evidence_index"] == candidate["evidence_index"]
    assert payload["provenance"]["repository_commit"] == "repository-head-01"


def test_pending_change_set_is_pushed_and_marked_publishing(monkeypatch):
    run_id = "run-1"
    change_set = {"change_set_id": "dkcs_01", "candidate_id": "dkc_01", "candidate_revision": 1}
    candidate = {"draft": {}, "evidence_index": []}

    class Store:
        def __init__(self):
            self.marked: list[str] = []

        def list_pending_domain_knowledge_wiki_change_sets(self, *, run_id: str, limit: int = 20):
            assert run_id == "run-1"
            return [change_set]

        def get_domain_knowledge_candidate_version(self, candidate_id: str, candidate_revision: int):
            return {"payload": candidate}

        def mark_domain_knowledge_wiki_change_set_publishing(self, change_set_id: str):
            self.marked.append(change_set_id)

    store = Store()
    client = _Client()
    expected_payload = {"publish_ticket_id": "dkpt_01", "change_set_id": "dkcs_01"}
    monkeypatch.setattr(
        "app.services.domain_knowledge_control_plane.build_domain_knowledge_publish_payload",
        lambda change_set_arg, candidate_arg: expected_payload,
    )
    app = SimpleNamespace(state=SimpleNamespace(trace_store=store, openclaw_control_plane_client=client))

    result = asyncio.run(push_pending_domain_knowledge_change_sets(app, run_id=run_id))

    assert result["status"] == "accepted"
    assert store.marked == ["dkcs_01"]
    assert client.publish_batches[0] == (
        run_id,
        {
            "kind": "project_domain_knowledge_wiki_payload_batch",
            "schema_version": 1,
            "run_id": run_id,
            "payloads": [expected_payload],
        },
    )


def test_publication_cursor_advances_after_receipts_are_persisted(monkeypatch):
    run_id = "run-1"
    receipt = {"kind": "project_domain_knowledge_publication_receipt", "change_set_id": "dkcs_01"}

    class Store:
        def __init__(self):
            self.cursor = {"run_id": run_id, "command_cursor": None, "publish_cursor": "publish-cursor-0"}

        def get_domain_knowledge_control_plane_cursors(self, requested_run_id: str):
            assert requested_run_id == run_id
            return dict(self.cursor)

        def update_domain_knowledge_control_plane_cursors(self, *, run_id: str, publish_cursor: str):
            self.cursor["publish_cursor"] = publish_cursor
            return dict(self.cursor)

    stored: list[dict] = []
    store = Store()
    client = _Client()
    client.publish_response = {"items": [{"receipt": receipt}], "cursor": "publish-cursor-1"}
    monkeypatch.setattr(
        "app.services.domain_knowledge_control_plane.apply_domain_knowledge_publication_receipt",
        lambda store_arg, payload: stored.append(payload) or payload,
    )
    app = SimpleNamespace(state=SimpleNamespace(trace_store=store, openclaw_control_plane_client=client))

    result = asyncio.run(poll_domain_knowledge_publication_receipts(app, run_id=run_id))

    assert stored == [receipt]
    assert result["cursor"] == "publish-cursor-1"
    assert store.cursor["publish_cursor"] == "publish-cursor-1"


def test_one_control_plane_cycle_processes_all_durable_run_ids(monkeypatch):
    calls: list[tuple[str, str | None]] = []

    class Store:
        def list_domain_knowledge_control_plane_run_ids(self, *, limit: int = 20):
            return ["run-1", "run-2"]

    async def fake_candidates(app):
        calls.append(("candidates", None))
        return {"status": "no_pending_candidates"}

    async def fake_commands(app, *, run_id: str):
        calls.append(("commands", run_id))
        return {"status": "commands_processed"}

    async def fake_change_sets(app, *, run_id: str):
        calls.append(("change_sets", run_id))
        return {"status": "no_pending_change_sets"}

    async def fake_receipts(app, *, run_id: str):
        calls.append(("receipts", run_id))
        return {"status": "publication_receipts_processed"}

    monkeypatch.setattr("app.services.domain_knowledge_control_plane.push_pending_domain_knowledge_candidates", fake_candidates)
    monkeypatch.setattr("app.services.domain_knowledge_control_plane.poll_domain_knowledge_review_commands", fake_commands)
    monkeypatch.setattr("app.services.domain_knowledge_control_plane.push_pending_domain_knowledge_change_sets", fake_change_sets)
    monkeypatch.setattr("app.services.domain_knowledge_control_plane.poll_domain_knowledge_publication_receipts", fake_receipts)
    app = SimpleNamespace(state=SimpleNamespace(trace_store=Store()))

    asyncio.run(process_domain_knowledge_control_plane_once(app))

    assert calls == [
        ("candidates", None),
        ("commands", "run-1"),
        ("change_sets", "run-1"),
        ("receipts", "run-1"),
        ("commands", "run-2"),
        ("change_sets", "run-2"),
        ("receipts", "run-2"),
    ]
