from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from openclaw.project_knowledge.review_publisher import (
    OpenClawKnowledgeReviewPublisher,
    OpenClawKnowledgeStore,
    TopicResolver,
    canonical_sha256,
)


EMPTY_SHA256 = "sha256:" + hashlib.sha256(b"").hexdigest()


def _delivery(*, delivery_id: str = "delivery-1", candidate_id: str = "candidate-1") -> dict:
    envelope = {
        "kind": "codex_author_knowledge_delivery",
        "schema_version": 1,
        "delivery_id": delivery_id,
        "workspace_key": "mmd-project",
        "candidate_payload": {
            "kind": "codex_knowledge_candidate_review",
            "schema_version": 1,
            "workspace_key": "mmd-project",
            "candidate_id": candidate_id,
            "candidate_revision": 1,
            "evidence_revision": 1,
            "candidate": {
                "local_id": "pet-input-routing",
                "title": "Pet 左键输入路由",
                "knowledge_kind_hint": "rule",
                "change_kind": "introduce",
                "author_summary": "点击和拖动必须分流。",
                "why_reusable": "透明窗口与原生事件会重复竞争。",
                "related_topic_hints": ["Pet 输入路由"],
                "term_changes": [],
                "pending_verification": [],
                "evidence_hints": {},
                "content": "# Pet 左键输入路由\n\n点击和拖动必须分流。\n",
            },
            "evidence": {
                "kind": "repository_evidence_pack",
                "evidence_refs": [
                    {
                        "role": "implementation",
                        "path": "desktop-pet/electron/main.ts",
                        "revision": "abc123",
                    }
                ],
            },
            "ownership": {
                "vault_topic_resolution": "openclaw",
                "content_review": "openclaw",
                "publication_review": "openclaw",
            },
        },
    }
    envelope["payload_sha256"] = canonical_sha256(envelope["candidate_payload"])
    envelope["idempotency_key"] = f"codex-author-knowledge:{delivery_id}"
    return envelope


def _approved_knowledge() -> dict:
    return {
        "schema_version": 2,
        "topic_id": None,
        "topic_identity_key": "mmd-project/pet/input-routing",
        "topic_kind": "rule",
        "domain": "desktop-pet",
        "title": "Pet 左键输入路由",
        "aliases": ["点击与拖动分流"],
        "introduced_for": {
            "problem": "静止点击被错误识别为拖动。",
            "context": "Desktop Pet 左键输入。",
            "failure_before_introduction": "点击和拖动事件互相竞争。",
        },
        "meaning": {
            "definition": "左键短按和窗口拖动必须由同一状态机分流。",
            "entities": [],
            "relationships": [],
            "boundaries": {
                "in_scope": ["左键短按", "窗口拖动"],
                "out_of_scope": ["右键菜单"],
                "non_examples": ["按下即拖动"],
                "confused_with": ["透明层 click"],
            },
            "invariants": ["超过位移阈值后才进入拖动。"],
        },
        "technical_solution": {
            "summary": "按下先记录候选，超过阈值才拖动。",
            "architecture_flow": [],
            "contract_refs": [],
            "implementation_refs": ["ref-implementation-1"],
            "test_refs": ["ref-test-1"],
            "validation_refs": [],
        },
        "failure_signals": ["静止点击导致窗口移动"],
        "operational_appendix": {"steps": [], "cautions": []},
        "source": {"concept_delta_ids": [], "codex_session_ids": [], "baseline_scan_ids": []},
        "evidence_refs": ["ref-implementation-1", "ref-test-1"],
        "open_questions": [],
    }


def _proposal(task: dict, markdown: str) -> dict:
    document_hash = canonical_sha256(markdown)
    diff_body = {
        "format": "unified",
        "files": [{"path": "projects/mmd-project/domains/desktop-pet/pet-input-routing.md", "patch": "+ exact"}],
    }
    diff_hash = canonical_sha256(diff_body)
    return {
        "proposal_id": "proposal-1",
        "proposal_revision": 1,
        "candidate_id": task["candidate_id"],
        "candidate_revision": task["candidate_revision"],
        "input_payload_sha256": task["payload_hash"],
        "vault_revision": str((task.get("topic_resolution") or {}).get("vault_revision") or "vault-1"),
        "match_state": "new_topic",
        "publishable": True,
        "publication_action": "create",
        "target": {
            "topic_id": "topic-pet-input-routing",
            "path": "projects/mmd-project/domains/desktop-pet/pet-input-routing.md",
            "base_content_sha256": EMPTY_SHA256,
            "base_git_revision": "vault-1",
        },
        "affected_files": [
            {
                "role": "canonical_target",
                "path": "projects/mmd-project/domains/desktop-pet/pet-input-routing.md",
                "operation": "create",
                "base_content_sha256": EMPTY_SHA256,
                "result_content_sha256": document_hash,
                "markdown": markdown,
                "patch": "+ exact",
            }
        ],
        "document": {"markdown": markdown, "sha256": document_hash},
        "diff": {**diff_body, "sha256": diff_hash},
        "reason": "没有匹配的 canonical note。",
        "conflict_summary": [],
    }


class FakeMemoryWiki:
    def __init__(self, *, existing: dict[str, dict] | None = None, vault_revision: str = "vault-1"):
        self.pages = dict(existing or {})
        self.vault_revision = vault_revision
        self.applied: list[dict] = []
        self.commits: list[dict] = []
        self.restored: list[dict] = []
        self.get_calls: list[str] = []
        self.lint_calls = 0
        self.compile_calls = 0
        self.lint_status = "passed"
        self.commit_result = {"commit_sha": "vault-commit-1", "branch": "main", "pushed": True}
        self.dirty_paths: list[str] = []

    def status(self) -> dict:
        return {"vault_revision": self.vault_revision, "dirty_paths": list(self.dirty_paths)}

    def search(self, query: str) -> list[dict]:
        lowered = query.casefold()
        return [
            page
            for page in self.pages.values()
            if lowered in str(page.get("title", "")).casefold()
            or any(lowered in str(alias).casefold() for alias in page.get("aliases", []))
        ]

    def get(self, path: str) -> dict | None:
        self.get_calls.append(path)
        return self.pages.get(path)

    def apply_exact(self, *, files: list[dict], expected_vault_revision: str) -> dict:
        if expected_vault_revision != self.vault_revision:
            raise ValueError("vault revision is stale")
        self.applied.append({"files": files, "vault_revision": expected_vault_revision})
        self.dirty_paths = sorted(file["path"] for file in files)
        for file in files:
            self.pages[file["path"]] = {
                "path": file["path"],
                "title": file["path"].rsplit("/", 1)[-1].removesuffix(".md"),
                "content": file["markdown"],
                "content_sha256": file["result_content_sha256"],
            }
        diff_body = {
            "format": "unified",
            "files": [{"path": file["path"], "patch": file.get("patch", "")} for file in files],
        }
        return {"files": files, "diff_sha256": canonical_sha256(diff_body)}

    def restore_exact(self, *, snapshots: list[dict], expected_vault_revision: str) -> dict:
        if expected_vault_revision != self.vault_revision:
            raise ValueError("vault revision is stale")
        self.restored.append({"snapshots": snapshots, "vault_revision": expected_vault_revision})
        for snapshot in snapshots:
            if snapshot["exists"]:
                self.pages[snapshot["path"]] = snapshot["page"]
            else:
                self.pages.pop(snapshot["path"], None)
        self.dirty_paths = []
        return {"restored": [snapshot["path"] for snapshot in snapshots]}

    def lint(self, *, paths: list[str]) -> dict:
        self.lint_calls += 1
        return {
            "status": self.lint_status,
            "errors": [] if self.lint_status == "passed" else ["lint failed"],
            "warnings": [],
            "paths": paths,
        }

    def compile(self) -> dict:
        self.compile_calls += 1
        return {"status": "passed"}

    def commit_push(self, *, paths: list[str], message: str, trailers: dict[str, str]) -> dict:
        self.commits.append({"paths": paths, "message": message, "trailers": trailers})
        self.dirty_paths = []
        return dict(self.commit_result)


def _publisher(tmp_path: Path, wiki: FakeMemoryWiki | None = None):
    return OpenClawKnowledgeReviewPublisher(
        store=OpenClawKnowledgeStore(tmp_path / "openclaw-knowledge.db"),
        wiki=wiki or FakeMemoryWiki(),
    )


def test_delivery_ingest_is_idempotent_and_starts_content_review(tmp_path: Path):
    publisher = _publisher(tmp_path)
    try:
        first = publisher.ingest_delivery(_delivery())
        duplicate = publisher.ingest_delivery(_delivery())

        assert first["status"] == "content_review_pending"
        assert duplicate["status"] == "duplicate"
        assert first["review_task_id"] == duplicate["review_task_id"]

        changed = _delivery()
        changed["candidate_payload"]["candidate"]["author_summary"] = "changed"
        changed["payload_sha256"] = canonical_sha256(changed["candidate_payload"])
        with pytest.raises(ValueError, match="idempotency_conflict"):
            publisher.ingest_delivery(changed)
    finally:
        publisher.close()


def test_delivery_batch_returns_per_item_acceptance_and_duplicate_status(tmp_path: Path):
    publisher = _publisher(tmp_path)
    try:
        batch = {
            "kind": "codex_author_knowledge_delivery_batch",
            "schema_version": 1,
            "workspace_key": "mmd-project",
            "items": [_delivery()],
        }

        first = publisher.ingest_delivery_batch(batch)
        second = publisher.ingest_delivery_batch(batch)

        assert first["items"][0]["status"] == "accepted"
        assert second["items"][0]["status"] == "duplicate"
    finally:
        publisher.close()


def test_review_task_survives_openclaw_restart(tmp_path: Path):
    db_path = tmp_path / "openclaw-knowledge.db"
    first = OpenClawKnowledgeReviewPublisher(
        store=OpenClawKnowledgeStore(db_path),
        wiki=FakeMemoryWiki(),
    )
    task = first.ingest_delivery(_delivery())
    first.close()

    second = OpenClawKnowledgeReviewPublisher(
        store=OpenClawKnowledgeStore(db_path),
        wiki=FakeMemoryWiki(),
    )
    try:
        restored = second.get_review_task(task["review_task_id"])
        duplicate = second.ingest_delivery(_delivery())
        assert restored["status"] == "content_review_pending"
        assert duplicate["status"] == "duplicate"
    finally:
        second.close()


def test_publication_review_requires_content_review_and_exact_hashes(tmp_path: Path):
    publisher = _publisher(tmp_path)
    try:
        task = publisher.ingest_delivery(_delivery())
        with pytest.raises(ValueError, match="content review"):
            publisher.record_publication_review(
                task["review_task_id"],
                {
                    "decision": "approve",
                    "proposal": {},
                    "reviewer": {"user_id": "u1"},
                },
            )

        approved = publisher.record_content_review(
            task["review_task_id"],
            {
                "decision": "accept",
                "approved_knowledge": _approved_knowledge(),
                "reviewer": {"user_id": "u1"},
            },
        )
        assert approved["status"] == "publication_review_pending"
        current = publisher.get_review_task(task["review_task_id"])
        publisher.resolve_topic(task["review_task_id"])
        current = publisher.get_review_task(task["review_task_id"])
        markdown = "---\ntopic_id: topic-pet-input-routing\n---\n\n# Pet 左键输入路由\n"
        proposal = _proposal(current, markdown)
        created = publisher.record_publication_review(
            task["review_task_id"],
            {
                "decision": "approve",
                "proposal": proposal,
                "reviewer": {"user_id": "u1"},
            },
        )
        assert created["status"] == "accepted_change_set_pending"
        assert created["change_set"]["approved_document_sha256"] == canonical_sha256(markdown)
    finally:
        publisher.close()


def test_publisher_rejects_stale_vault_without_writing(tmp_path: Path):
    wiki = FakeMemoryWiki(vault_revision="vault-2")
    publisher = _publisher(tmp_path, wiki)
    try:
        task = publisher.ingest_delivery(_delivery())
        publisher.record_content_review(
            task["review_task_id"],
            {"decision": "accept", "approved_knowledge": _approved_knowledge(), "reviewer": {"user_id": "u1"}},
        )
        publisher.resolve_topic(task["review_task_id"])
        current = publisher.get_review_task(task["review_task_id"])
        markdown = "# Pet 左键输入路由\n"
        proposal = _proposal(current, markdown)
        accepted = publisher.record_publication_review(
            task["review_task_id"],
            {"decision": "approve", "proposal": proposal, "reviewer": {"user_id": "u1"}},
        )

        wiki.vault_revision = "vault-3"
        receipt = publisher.publish(accepted["change_set_id"])

        assert receipt["status"] == "conflict"
        assert wiki.applied == []
        assert wiki.commits == []
    finally:
        publisher.close()


def test_publisher_applies_exact_change_set_and_returns_receipt(tmp_path: Path):
    wiki = FakeMemoryWiki()
    publisher = _publisher(tmp_path, wiki)
    try:
        task = publisher.ingest_delivery(_delivery())
        publisher.record_content_review(
            task["review_task_id"],
            {"decision": "accept", "approved_knowledge": _approved_knowledge(), "reviewer": {"user_id": "u1"}},
        )
        publisher.resolve_topic(task["review_task_id"])
        current = publisher.get_review_task(task["review_task_id"])
        markdown = "# Pet 左键输入路由\n"
        proposal = _proposal(current, markdown)
        accepted = publisher.record_publication_review(
            task["review_task_id"],
            {"decision": "approve", "proposal": proposal, "reviewer": {"user_id": "u1"}},
        )

        receipt = publisher.publish(accepted["change_set_id"])

        assert receipt["status"] == "published"
        assert receipt["published_content_sha256"] == canonical_sha256(markdown)
        assert len(wiki.applied) == 1
        assert wiki.lint_calls == 1
        assert wiki.compile_calls == 1
        assert len(wiki.commits) == 1
    finally:
        publisher.close()


def test_lint_failure_rolls_back_exact_apply(tmp_path: Path):
    wiki = FakeMemoryWiki()
    wiki.lint_status = "failed"
    publisher = _publisher(tmp_path, wiki)
    target_path = "projects/mmd-project/domains/desktop-pet/pet-input-routing.md"
    try:
        task = publisher.ingest_delivery(_delivery())
        publisher.record_content_review(
            task["review_task_id"],
            {"decision": "accept", "approved_knowledge": _approved_knowledge(), "reviewer": {"user_id": "u1"}},
        )
        publisher.resolve_topic(task["review_task_id"])
        current = publisher.get_review_task(task["review_task_id"])
        accepted = publisher.record_publication_review(
            task["review_task_id"],
            {
                "decision": "approve",
                "proposal": _proposal(current, "# Pet 左键输入路由\n"),
                "reviewer": {"user_id": "u1"},
            },
        )

        receipt = publisher.publish(accepted["change_set_id"])

        assert receipt["status"] == "failed"
        assert target_path not in wiki.pages
        assert wiki.commits == []
    finally:
        publisher.close()


def test_push_failure_after_commit_does_not_reset_vault(tmp_path: Path):
    wiki = FakeMemoryWiki()
    wiki.commit_result = {"commit_sha": "vault-commit-2", "branch": "main", "pushed": False}
    publisher = _publisher(tmp_path, wiki)
    target_path = "projects/mmd-project/domains/desktop-pet/pet-input-routing.md"
    try:
        task = publisher.ingest_delivery(_delivery())
        publisher.record_content_review(
            task["review_task_id"],
            {"decision": "accept", "approved_knowledge": _approved_knowledge(), "reviewer": {"user_id": "u1"}},
        )
        publisher.resolve_topic(task["review_task_id"])
        current = publisher.get_review_task(task["review_task_id"])
        accepted = publisher.record_publication_review(
            task["review_task_id"],
            {
                "decision": "approve",
                "proposal": _proposal(current, "# Pet 左键输入路由\n"),
                "reviewer": {"user_id": "u1"},
            },
        )

        receipt = publisher.publish(accepted["change_set_id"])

        assert receipt["status"] == "failed"
        assert receipt["error"] == "vault_git_push_failed_after_commit"
        assert receipt["git"]["commit_sha"] == "vault-commit-2"
        assert target_path in wiki.pages
        assert wiki.restored == []
    finally:
        publisher.close()


def test_publication_receipt_is_mirrored_as_audit_backflow(tmp_path: Path):
    mirrors: list[dict] = []
    wiki = FakeMemoryWiki()
    publisher = OpenClawKnowledgeReviewPublisher(
        store=OpenClawKnowledgeStore(tmp_path / "openclaw-knowledge.db"),
        wiki=wiki,
        receipt_mirror=mirrors.append,
    )
    try:
        task = publisher.ingest_delivery(_delivery())
        publisher.record_content_review(
            task["review_task_id"],
            {"decision": "accept", "approved_knowledge": _approved_knowledge(), "reviewer": {"user_id": "u1"}},
        )
        publisher.resolve_topic(task["review_task_id"])
        current = publisher.get_review_task(task["review_task_id"])
        accepted = publisher.record_publication_review(
            task["review_task_id"],
            {
                "decision": "approve",
                "proposal": _proposal(current, "# Pet 左键输入路由\n"),
                "reviewer": {"user_id": "u1"},
            },
        )

        receipt = publisher.publish(accepted["change_set_id"])

        assert receipt["mirror_status"] == "mirrored"
        assert len(mirrors) == 1
        assert "mirror_status" not in mirrors[0]
        assert publisher.store.list_pending_receipt_mirrors() == []
    finally:
        publisher.close()


def test_content_reapproval_invalidates_old_publication_proposal(tmp_path: Path):
    publisher = _publisher(tmp_path)
    try:
        task = publisher.ingest_delivery(_delivery())
        publisher.record_content_review(
            task["review_task_id"],
            {"decision": "accept", "approved_knowledge": _approved_knowledge(), "reviewer": {"user_id": "u1"}},
        )
        publisher.resolve_topic(task["review_task_id"])

        publisher.record_content_review(
            task["review_task_id"],
            {
                "decision": "edit_accept",
                "approved_knowledge": {**_approved_knowledge(), "title": "Pet 左键输入路由（修订）"},
                "reviewer": {"user_id": "u2"},
            },
        )
        refreshed = publisher.get_review_task(task["review_task_id"])

        assert refreshed["status"] == "publication_review_pending"
        assert refreshed["topic_resolution"] is None
        assert refreshed["proposal"] is None
        assert refreshed["change_set"] is None
        assert refreshed["receipt"] is None
    finally:
        publisher.close()


def test_topic_resolver_distinguishes_no_match_single_and_multiple(tmp_path: Path):
    publisher = _publisher(
        tmp_path,
        FakeMemoryWiki(
            existing={
                "projects/mmd-project/domains/desktop-pet/pet-input-routing.md": {
                    "path": "projects/mmd-project/domains/desktop-pet/pet-input-routing.md",
                    "title": "Pet 左键输入路由",
                    "aliases": ["点击与拖动分流"],
                    "topic_id": "topic-1",
                    "content_sha256": EMPTY_SHA256,
                }
            }
        ),
    )
    try:
        task = publisher.ingest_delivery(_delivery())
        result = TopicResolver(publisher.wiki).resolve(task["candidate_payload"])
        assert result["match_state"] == "single_match"
        assert result["possible_topic_ids"] == ["topic-1"]
        assert result["pages"][0]["content_sha256"] == EMPTY_SHA256
        assert publisher.wiki.get_calls == [
            "projects/mmd-project/domains/desktop-pet/pet-input-routing.md"
        ]
    finally:
        publisher.close()
