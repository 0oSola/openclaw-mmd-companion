from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace

from app.services.codex_author_knowledge_handoff_store import (
    CodexAuthorKnowledgeHandoffStore,
)
from app.services.codex_author_knowledge_openclaw_delivery import (
    poll_codex_author_knowledge_publication_receipts,
    push_next_codex_author_knowledge_delivery,
)


class FakeControlPlane:
    def __init__(self):
        self.batches: list[dict] = []
        self.publish_responses: dict[str, dict] = {}

    async def post_project_knowledge_candidates(self, *, run_id: str, batch: dict):
        self.batches.append({"run_id": run_id, "batch": batch})
        item = batch["items"][0]
        return {
            "status": "candidate_batch_received",
            "items": [
                {
                    "candidate_id": item["candidate_id"],
                    "candidate_revision": item["candidate_revision"],
                    "status": "accepted",
                    "error": None,
                }
            ],
        }

    async def get_project_knowledge_publish_status(self, *, run_id: str, cursor: str | None = None):
        return self.publish_responses.get(run_id, {"run_id": run_id, "cursor": cursor, "items": []})


def test_pending_delivery_is_pushed_as_bounded_openclaw_envelope():
    root = Path(tempfile.mkdtemp(prefix="kh04-delivery-"))
    try:
        store = CodexAuthorKnowledgeHandoffStore(root / "knowledge.db")
        store.create_delivery(
            run_id="project-knowledge:mmd-project:candidate:candidate-1:1",
            candidate_id="candidate-1",
            candidate_revision=1,
            evidence_revision=1,
            payload={
                "kind": "codex_knowledge_candidate_review",
                "schema_version": 1,
                "workspace_key": "mmd-project",
                "candidate_id": "candidate-1",
                "candidate_revision": 1,
                "evidence_revision": 1,
                "candidate": {
                    "local_id": "pet-input-routing",
                    "title": "Pet 输入路由",
                    "knowledge_kind_hint": "rule",
                    "author_summary": "统一输入路由。",
                    "content": "# bounded",
                },
            },
        )
        control_plane = FakeControlPlane()
        app = SimpleNamespace(
            state=SimpleNamespace(
                knowledge_handoff_store=store,
                openclaw_control_plane_client=control_plane,
            )
        )

        result = asyncio.run(push_next_codex_author_knowledge_delivery(app))

        assert result["status"] == "accepted"
        assert control_plane.batches[0]["run_id"] == "project-knowledge:mmd-project:candidate:candidate-1:1"
        batch = control_plane.batches[0]["batch"]
        assert batch["kind"] == "project_domain_knowledge_candidate_batch"
        assert batch["workspace_id"] == "mmd-project"
        item = batch["items"][0]
        assert item["candidate_id"] == "candidate-1"
        assert item["candidate_revision"] == 1
        assert item["source_kind"] == "codex_author_handoff"
        assert item["review_readiness"] == "ready_for_review"
        assert item["knowledge"]["title"] == "Pet 输入路由"
        assert item["knowledge"]["meaning"]["definition"] == "# bounded"
        assert item["payload_sha256"] == store.list_deliveries(limit=10)[0]["payload_hash"]
        assert store.list_deliveries(limit=10)[0]["status"] == "delivered"
        store.close()
    finally:
        shutil.rmtree(root, ignore_errors=True)


def test_publication_receipts_are_polled_and_mirrored_to_audit_store():
    root = Path(tempfile.mkdtemp(prefix="kh04-receipt-poll-"))
    try:
        store = CodexAuthorKnowledgeHandoffStore(root / "knowledge.db")
        store.create_delivery(
            run_id="project-knowledge:mmd-project:candidate:candidate-1:1",
            candidate_id="candidate-1",
            candidate_revision=1,
            evidence_revision=1,
            payload={"kind": "codex_knowledge_candidate_review", "workspace_key": "mmd-project"},
        )
        control_plane = FakeControlPlane()
        control_plane.publish_responses["project-knowledge:mmd-project:candidate:candidate-1:1"] = {
            "run_id": "project-knowledge:mmd-project:candidate:candidate-1:1",
            "cursor": "cursor-2",
            "items": [
                {
                    "publish_ticket_id": "ticket-1",
                    "change_set_id": "change_set-1",
                    "candidate_id": "candidate-1",
                    "candidate_revision": 1,
                    "status": "published",
                    "action": "create",
                    "topic_id": "topic-1",
                    "target_path": "projects/mmd-project/domains/test/topic.md",
                    "approved_document_sha256": "sha256:abc",
                    "published_document_sha256": "sha256:abc",
                    "lint": {"status": "passed", "errors": [], "warnings": []},
                    "git": {"commit_sha": "vault-1", "remote": "origin", "branch": "main", "pushed": True},
                    "error": None,
                    "updated_at": "2026-08-06T12:00:00+08:00",
                }
            ],
        }
        app = SimpleNamespace(
            state=SimpleNamespace(
                knowledge_handoff_store=store,
                openclaw_control_plane_client=control_plane,
            )
        )

        result = asyncio.run(poll_codex_author_knowledge_publication_receipts(app))

        assert result["status"] == "publication_receipts_polled"
        assert result["runs"][0]["mirrored"] == 1
        assert result["runs"][0]["cursor"] == "cursor-2"
        cursor = store.get_author_openclaw_cursor("project-knowledge:mmd-project:candidate:candidate-1:1")
        assert cursor["publish_cursor"] == "cursor-2"
        store.close()
    finally:
        shutil.rmtree(root, ignore_errors=True)
