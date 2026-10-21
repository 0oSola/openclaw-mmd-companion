from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.config import Settings
from app.db.store import TraceStore
from app.services.openclaw_control_plane import (
    OpenClawReviewControlPlaneClient,
    apply_codex_review_decision_command,
    build_codex_review_daily_snapshot,
    process_codex_review_commands,
    process_codex_review_publish_status,
    push_codex_review_daily_snapshot,
    push_codex_review_memory_payloads,
)


def _store() -> TraceStore:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _seed_pet_session(store: TraceStore, *, suffix: str = "snapshot") -> dict:
    return store.upsert_desktop_pet_session(
        pet_session_id=f"codex:{suffix}",
        codex_session_id=suffix,
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title=f"Snapshot {suffix}",
        first_prompt_preview="Review OpenClaw snapshot sync",
        last_summary="Snapshot summary",
        last_status="completed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )


def _seed_unscoped_pet_session(store: TraceStore, *, suffix: str = "legacy") -> dict:
    return store.upsert_desktop_pet_session(
        pet_session_id=f"codex:{suffix}",
        codex_session_id=suffix,
        workspace_id=None,
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title=f"Legacy {suffix}",
        first_prompt_preview="Review legacy OpenClaw snapshot sync",
        last_summary="Legacy snapshot summary",
        last_status="completed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )


def _seed_review_item(store: TraceStore, *, suffix: str = "snapshot", item_type: str = "pitfall") -> dict:
    pet = _seed_pet_session(store, suffix=suffix)
    item = store.create_codex_review_item(
        item_id=f"codex-review-{suffix}",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type=item_type,
        title=f"Review {suffix}",
        summary=f"Summary {suffix}",
        details={
            "evidence_refs": [f"ev_{suffix}"],
            "evidence": [
                {
                    "id": f"ev_{suffix}",
                    "source": "codex_events",
                    "type": "command_output",
                    "excerpt": "bounded evidence",
                }
            ],
        },
        tags=["codex"],
        severity="high",
        status="draft",
        source="openclaw",
        source_hash=f"snapshot-hash-{suffix}",
    )
    _set_review_item_updated_at(store, item["id"], "2026-06-12T02:00:00+00:00")
    return item


def _set_review_item_updated_at(store: TraceStore, item_id: str, value: str) -> None:
    store._conn.execute(
        "UPDATE codex_review_items SET created_at = ?, updated_at = ? WHERE id = ?",
        (value, value, item_id),
    )
    store._conn.commit()


def _memory_draft(evidence_ref: str = "ev_snapshot") -> dict:
    return {
        "knowledge_kind": "pitfall",
        "problem": "任务栏有缩略图，但实际桌面窗口没有恢复。",
        "root_cause": "session 到 hwnd 的绑定只存在内存中。",
        "when_to_use": "当 restore 命中陈旧任务栏缩略图时使用。",
        "prerequisites": ["知道 pet session id"],
        "steps": [
            {
                "order": 1,
                "instruction": "在关闭前保存 session-hwnd 映射，并在启动时优先恢复。",
                "commands": [],
                "file_refs": ["desktop-pet/src/window/sessionWindowBindings.ts"],
                "evidence_refs": [evidence_ref],
            }
        ],
        "verification": [
            {
                "order": 1,
                "instruction": "重启 Pet 后再次执行 restore。",
                "commands": ["pytest api/tests/test_desktop_pet_routes.py -q"],
                "expected_signal": "实际窗口可见且可聚焦。",
                "evidence_refs": [evidence_ref],
            }
        ],
        "cautions": ["不要跨 session 复用旧 hwnd。"],
        "source_summary": "Persist window binding before restart.",
        "open_questions": [],
        "confidence": 0.82,
    }


def _seed_unscoped_review_item(store: TraceStore, *, suffix: str = "legacy") -> dict:
    pet = _seed_unscoped_pet_session(store, suffix=suffix)
    item = store.create_codex_review_item(
        item_id=f"codex-review-{suffix}",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type="pitfall",
        title=f"Legacy Review {suffix}",
        summary=f"Legacy Summary {suffix}",
        details={"evidence_refs": [f"ev_{suffix}"]},
        tags=["codex"],
        severity="high",
        status="draft",
        source="openclaw",
        source_hash=f"legacy-snapshot-hash-{suffix}",
    )
    _set_review_item_updated_at(store, item["id"], "2026-06-12T02:00:00+00:00")
    return item


def test_control_plane_client_posts_daily_snapshot_to_run_url():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(status_code=200, json={"status": "snapshot_received"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawReviewControlPlaneClient(
                base_url="http://openclaw.local:8765",
                token="service-token",
                http_client=http_client,
            )
            return await client.post_daily_snapshot(
                session_key="codex-review-daily:2026-06-12",
                snapshot={"kind": "codex_review_daily_snapshot", "schema_version": 1},
            )

    result = asyncio.run(run_case())

    assert result["status"] == "snapshot_received"
    assert calls == [
        {
            "method": "POST",
            "url": "http://openclaw.local:8765/v1/apps/mmd/codex-review/runs/codex-review-daily:2026-06-12/snapshot",
            "headers": {
                **calls[0]["headers"],
                "authorization": "Bearer service-token",
                "content-type": "application/json",
            },
            "body": {"kind": "codex_review_daily_snapshot", "schema_version": 1},
        }
    ]


def test_control_plane_client_gets_commands_with_cursor():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": dict(request.headers),
            }
        )
        return httpx.Response(
            status_code=200,
            json={
                "commands": [
                    {
                        "id": "openclaw-review-cmd-1",
                        "session_key": "codex-review-daily:2026-06-12",
                        "type": "review_decision",
                        "item_id": "codex-review-snapshot",
                        "action": "accept",
                    }
                ],
                "cursor": "command-cursor-1",
            },
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawReviewControlPlaneClient(
                base_url="http://openclaw.local:8765/",
                token="service-token",
                http_client=http_client,
            )
            return await client.get_commands(
                session_key="codex-review-daily:2026-06-12",
                cursor="command-cursor-0",
            )

    result = asyncio.run(run_case())

    assert result["cursor"] == "command-cursor-1"
    assert result["commands"][0]["id"] == "openclaw-review-cmd-1"
    assert calls == [
        {
            "method": "GET",
            "url": "http://openclaw.local:8765/v1/apps/mmd/codex-review/runs/codex-review-daily:2026-06-12/commands?cursor=command-cursor-0",
            "headers": {
                **calls[0]["headers"],
                "authorization": "Bearer service-token",
                "content-type": "application/json",
            },
        }
    ]


def test_control_plane_client_posts_command_result():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(status_code=200, json={"status": "result_received"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawReviewControlPlaneClient(
                base_url="http://openclaw.local:8765",
                token="service-token",
                http_client=http_client,
            )
            return await client.post_command_result(
                command_id="openclaw-review-cmd-1",
                result={
                    "session_key": "codex-review-daily:2026-06-12",
                    "command_id": "openclaw-review-cmd-1",
                    "status": "succeeded",
                    "result": {"item_id": "codex-review-snapshot"},
                    "error": None,
                    "completed_at": "2026-06-12T10:00:00+08:00",
                },
            )

    result = asyncio.run(run_case())

    assert result["status"] == "result_received"
    assert calls == [
        {
            "method": "POST",
            "url": "http://openclaw.local:8765/v1/apps/mmd/codex-review/commands/openclaw-review-cmd-1/result",
            "headers": {
                **calls[0]["headers"],
                "authorization": "Bearer service-token",
                "content-type": "application/json",
            },
            "body": {
                "session_key": "codex-review-daily:2026-06-12",
                "command_id": "openclaw-review-cmd-1",
                "status": "succeeded",
                "result": {"item_id": "codex-review-snapshot"},
                "error": None,
                "completed_at": "2026-06-12T10:00:00+08:00",
            },
        }
    ]


def test_control_plane_client_posts_memory_payloads_to_run_url():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(status_code=200, json={"status": "memory_payloads_received"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawReviewControlPlaneClient(
                base_url="http://openclaw.local:8765",
                token="service-token",
                http_client=http_client,
            )
            return await client.post_memory_payloads(
                session_key="codex-review-daily:2026-06-12",
                payloads=[
                    {
                        "kind": "codex_review_memory_wiki_payload",
                        "schema_version": 1,
                        "memory": {"id": "codex_review_memory_1"},
                    }
                ],
            )

    result = asyncio.run(run_case())

    assert result["status"] == "memory_payloads_received"
    assert calls == [
        {
            "method": "POST",
            "url": "http://openclaw.local:8765/v1/apps/mmd/codex-review/runs/codex-review-daily:2026-06-12/memory-payloads",
            "headers": {
                **calls[0]["headers"],
                "authorization": "Bearer service-token",
                "content-type": "application/json",
            },
            "body": {
                "payloads": [
                    {
                        "kind": "codex_review_memory_wiki_payload",
                        "schema_version": 1,
                        "memory": {"id": "codex_review_memory_1"},
                    }
                ]
            },
        }
    ]


def test_control_plane_client_gets_publish_status_with_cursor():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": dict(request.headers),
            }
        )
        return httpx.Response(
            status_code=200,
            json={
                "session_key": "codex-review-daily:2026-06-12",
                "cursor": "publish-cursor-1",
                "status": "published",
                "items": [
                    {
                        "memory_id": "codex_review_memory_1",
                        "status": "published",
                        "wiki_path": "sources/codex-review/mmd-companion/2026-06-12/codex_review_memory_1.md",
                        "commit": "abc1234",
                        "error": None,
                    }
                ],
            },
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawReviewControlPlaneClient(
                base_url="http://openclaw.local:8765",
                token="service-token",
                http_client=http_client,
            )
            return await client.get_publish_status(
                session_key="codex-review-daily:2026-06-12",
                cursor="publish-cursor-0",
            )

    result = asyncio.run(run_case())

    assert result["cursor"] == "publish-cursor-1"
    assert result["items"][0]["status"] == "published"
    assert calls == [
        {
            "method": "GET",
            "url": "http://openclaw.local:8765/v1/apps/mmd/codex-review/runs/codex-review-daily:2026-06-12/publish-status?cursor=publish-cursor-0",
            "headers": {
                **calls[0]["headers"],
                "authorization": "Bearer service-token",
                "content-type": "application/json",
            },
        }
    ]


def test_build_codex_review_daily_snapshot_includes_summary_and_drafts():
    store = _store()
    _seed_review_item(store)

    snapshot = build_codex_review_daily_snapshot(
        store,
        review_date="2026-06-12",
        workspace_id="mmd-companion",
        limit=20,
    )

    assert snapshot["kind"] == "codex_review_daily_snapshot"
    assert snapshot["schema_version"] == 1
    assert snapshot["date"] == "2026-06-12"
    assert snapshot["workspace_id"] == "mmd-companion"
    assert snapshot["summary"]["draft_count"] == 1
    assert snapshot["summary"]["high_priority_count"] == 1
    assert snapshot["summary"]["recommended_batch_size"] == 1
    assert snapshot["drafts"][0]["id"] == "codex-review-snapshot"
    assert snapshot["drafts"][0]["title"] == "Review snapshot"
    assert snapshot["drafts"][0]["evidence_refs"] == ["ev_snapshot"]
    assert snapshot["drafts"][0]["bounded_evidence"] == [
        {
            "id": "ev_snapshot",
            "source": "codex_events",
            "type": "command_output",
            "excerpt": "bounded evidence",
        }
    ]
    assert snapshot["cursor"].startswith("fastapi-review-state:")


def test_build_daily_snapshot_separates_daily_increment_from_pending_backlog():
    store = _store()
    old_item = _seed_review_item(store, suffix="old-backlog")
    new_item = _seed_review_item(store, suffix="daily-new")
    _set_review_item_updated_at(store, old_item["id"], "2026-07-14T02:00:00+00:00")
    _set_review_item_updated_at(store, new_item["id"], "2026-07-15T02:00:00+00:00")

    today = build_codex_review_daily_snapshot(
        store,
        review_date="2026-07-15",
        workspace_id="mmd-companion",
        limit=20,
    )
    tomorrow = build_codex_review_daily_snapshot(
        store,
        review_date="2026-07-16",
        workspace_id="mmd-companion",
        limit=20,
    )

    assert [item["id"] for item in today["drafts"]] == [new_item["id"]]
    assert today["daily_new_items"] == today["drafts"]
    assert [item["pet_session_id"] for item in today["work_units"]] == ["codex:daily-new"]
    assert [item["id"] for item in today["learning_candidates"]] == [new_item["id"]]
    assert today["summary"]["draft_count"] == 1
    assert today["summary"]["pending_backlog_count"] == 2
    assert today["pending_review_backlog"] == {
        "draft_count": 2,
        "high_priority_count": 2,
        "recommended_batch_size": 2,
    }
    assert tomorrow["drafts"] == []
    assert tomorrow["daily_new_items"] == []
    assert tomorrow["work_units"] == []
    assert tomorrow["learning_candidates"] == []
    assert tomorrow["summary"]["draft_count"] == 0
    assert tomorrow["summary"]["pending_backlog_count"] == 2
    assert tomorrow["pending_review_backlog"]["draft_count"] == 2
    assert tomorrow["cursor"] != today["cursor"]


def test_build_codex_review_daily_snapshot_includes_legacy_unscoped_drafts():
    store = _store()
    _seed_unscoped_review_item(store)

    snapshot = build_codex_review_daily_snapshot(
        store,
        review_date="2026-06-12",
        workspace_id="mmd-companion",
        limit=20,
    )

    assert snapshot["workspace_id"] == "mmd-companion"
    assert snapshot["summary"]["draft_count"] == 1
    assert snapshot["summary"]["high_priority_count"] == 1
    assert snapshot["drafts"][0]["id"] == "codex-review-legacy"
    assert snapshot["drafts"][0]["title"] == "Legacy Review legacy"


def test_build_codex_review_daily_snapshot_includes_work_units():
    store = _store()
    _seed_review_item(store, suffix="work-unit", item_type="pitfall")

    snapshot = build_codex_review_daily_snapshot(
        store,
        review_date="2026-06-12",
        workspace_id="mmd-companion",
        limit=20,
    )

    assert snapshot["work_units"] == [
        {
            "pet_session_id": "codex:work-unit",
            "codex_session_id": "work-unit",
            "workspace_id": "mmd-companion",
            "title": "Snapshot work-unit",
            "status": "completed",
            "goal": "Review OpenClaw snapshot sync",
            "outcome": "Snapshot summary",
            "review_item_counts": {"pitfall": 1},
            "top_review_items": [
                {
                    "id": "codex-review-work-unit",
                    "item_type": "pitfall",
                    "title": "Review work-unit",
                    "priority_score": 90,
                }
            ],
            "changed_files": [],
            "failed_commands": [],
            "successful_checks": [],
            "updated_at": snapshot["work_units"][0]["updated_at"],
        }
    ]


def test_build_codex_review_daily_snapshot_includes_learning_candidates():
    store = _store()
    pet = _seed_pet_session(store, suffix="lesson")
    store.create_codex_review_item(
        item_id="codex-review-lesson",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type="pitfall",
        title="Schema drift broke Codex relay",
        summary="Regenerate pinned Codex app-server schemas after CLI upgrades.",
        details={
            "symptom": "Relay tests failed after Codex CLI update.",
            "root_cause": "Pinned schema bundle was stale.",
            "fix": "Run scripts/generate-codex-app-server-schema.ps1.",
            "prevention": "Run schema preflight before starting dev stack.",
            "confidence": 0.9,
            "evidence_refs": ["ev_lesson"],
            "evidence": [
                {
                    "id": "ev_lesson",
                    "source": "codex_events",
                    "type": "test_failure",
                    "excerpt": "Codex schema pin mismatch",
                }
            ],
        },
        tags=["codex", "schema"],
        severity="high",
        status="draft",
        source="openclaw",
        source_hash="lesson-hash",
    )
    _set_review_item_updated_at(store, "codex-review-lesson", "2026-06-12T02:00:00+00:00")

    snapshot = build_codex_review_daily_snapshot(
        store,
        review_date="2026-06-12",
        workspace_id="mmd-companion",
        limit=20,
    )

    assert snapshot["learning_candidates"] == [
        {
            "id": "codex-review-lesson",
            "pet_session_id": "codex:lesson",
            "codex_session_id": "lesson",
            "candidate_type": "pitfall",
            "title": "Schema drift broke Codex relay",
            "summary": "Regenerate pinned Codex app-server schemas after CLI upgrades.",
            "problem": "Relay tests failed after Codex CLI update.",
            "root_cause": "Pinned schema bundle was stale.",
            "fix": "Run scripts/generate-codex-app-server-schema.ps1.",
            "prevention": "Run schema preflight before starting dev stack.",
            "lesson": "Regenerate pinned Codex app-server schemas after CLI upgrades.",
            "severity": "high",
            "tags": ["codex", "schema"],
            "confidence": 0.9,
            "priority_score": 90,
            "evidence_refs": ["ev_lesson"],
            "bounded_evidence": [
                {
                    "id": "ev_lesson",
                    "source": "codex_events",
                    "type": "test_failure",
                    "excerpt": "Codex schema pin mismatch",
                }
            ],
            "created_at": snapshot["learning_candidates"][0]["created_at"],
            "updated_at": snapshot["learning_candidates"][0]["updated_at"],
        }
    ]


def test_build_codex_review_daily_snapshot_skips_empty_learning_candidates():
    store = _store()
    pet = _seed_pet_session(store, suffix="empty-lesson")
    store.create_codex_review_item(
        item_id="codex-review-empty-blocker",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type="blocker",
        title="Blocker",
        summary=None,
        details={},
        tags=[],
        severity=None,
        status="draft",
        source="openclaw",
        source_hash="empty-blocker-hash",
    )
    _set_review_item_updated_at(store, "codex-review-empty-blocker", "2026-06-12T02:00:00+00:00")
    store.create_codex_review_item(
        item_id="codex-review-useful-pitfall",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type="pitfall",
        title="Useful pitfall",
        summary="Keep the useful item.",
        details={"symptom": "A real issue happened."},
        tags=[],
        severity="medium",
        status="draft",
        source="openclaw",
        source_hash="useful-pitfall-hash",
    )
    _set_review_item_updated_at(store, "codex-review-useful-pitfall", "2026-06-12T02:00:00+00:00")

    snapshot = build_codex_review_daily_snapshot(
        store,
        review_date="2026-06-12",
        workspace_id="mmd-companion",
        limit=20,
    )

    assert [item["id"] for item in snapshot["drafts"]] == [
        "codex-review-empty-blocker",
        "codex-review-useful-pitfall",
    ]
    assert [item["id"] for item in snapshot["learning_candidates"]] == ["codex-review-useful-pitfall"]


def test_build_codex_review_daily_snapshot_includes_rollup():
    store = _store()
    pet = store.upsert_desktop_pet_session(
        pet_session_id="codex:rollup",
        codex_session_id="rollup",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Rollup session",
        first_prompt_preview="Summarize project work",
        last_summary="Implemented review rollup",
        last_status="completed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={
            "facts": {
                "changed_files": ["api/app/services/openclaw_control_plane.py"],
                "failed_commands": [{"command": "pytest old", "exit_code": 1, "excerpt": "old failure"}],
                "successful_checks": [{"command": "pytest new", "exit_code": 0, "excerpt": "passed"}],
            }
        },
    )
    for item_id, item_type, severity, tags in (
        ("codex-review-rollup-pitfall", "pitfall", "high", ["schema", "codex"]),
        ("codex-review-rollup-decision", "decision", None, ["schema"]),
        ("codex-review-rollup-followup", "followup", "medium", ["docs"]),
    ):
        store.create_codex_review_item(
            item_id=item_id,
            pet_session_id=pet["pet_session_id"],
            codex_session_id=pet["codex_session_id"],
            item_type=item_type,
            title=f"Rollup {item_type}",
            summary=f"Useful {item_type}",
            details={"symptom": f"{item_type} symptom"},
            tags=tags,
            severity=severity,
            status="draft",
            source="openclaw",
            source_hash=f"rollup-{item_type}-hash",
        )
        _set_review_item_updated_at(store, item_id, "2026-06-12T02:00:00+00:00")

    snapshot = build_codex_review_daily_snapshot(
        store,
        review_date="2026-06-12",
        workspace_id="mmd-companion",
        limit=20,
    )

    assert snapshot["rollup"] == {
        "work_unit_count": 1,
        "work_status_counts": {"completed": 1},
        "review_item_counts": {"decision": 1, "followup": 1, "pitfall": 1},
        "learning_candidate_count": 3,
        "learning_candidate_counts": {"decision": 1, "followup": 1, "pitfall": 1},
        "high_priority_learning_candidate_count": 1,
        "top_tags": [
            {"tag": "schema", "count": 2},
            {"tag": "codex", "count": 1},
            {"tag": "docs", "count": 1},
        ],
        "changed_files": ["api/app/services/openclaw_control_plane.py"],
        "failed_command_count": 1,
        "successful_check_count": 1,
    }


def test_push_codex_review_daily_snapshot_sends_today_run_to_control_plane():
    store = _store()
    _seed_review_item(store)

    class FakeControlPlaneClient:
        def __init__(self):
            self.calls = []

        async def post_daily_snapshot(self, *, session_key, snapshot):
            self.calls.append({"session_key": session_key, "snapshot": snapshot})
            return {"status": "snapshot_received"}

    client = FakeControlPlaneClient()
    app = SimpleNamespace(
        state=SimpleNamespace(
            trace_store=store,
            openclaw_control_plane_client=client,
            settings=SimpleNamespace(
                codex_openclaw_control_plane_workspace_id="mmd-companion",
                codex_openclaw_control_plane_snapshot_limit=20,
            ),
        )
    )

    result = asyncio.run(
        push_codex_review_daily_snapshot(
            app,
            review_date="2026-06-12",
        )
    )

    assert result["status"] == "snapshot_received"
    assert client.calls[0]["session_key"] == "codex-review-daily:2026-06-12"
    assert client.calls[0]["snapshot"]["summary"]["draft_count"] == 1


def test_push_daily_snapshot_skips_unchanged_cursor_after_store_reopen():
    store = _store()
    _seed_review_item(store, suffix="durable-snapshot")

    class FakeControlPlaneClient:
        def __init__(self):
            self.calls = []

        async def post_daily_snapshot(self, *, session_key, snapshot):
            self.calls.append({"session_key": session_key, "snapshot": snapshot})
            return {"status": "snapshot_received", "idempotent": True}

    client = FakeControlPlaneClient()
    settings = SimpleNamespace(
        codex_openclaw_control_plane_workspace_id="mmd-companion",
        codex_openclaw_control_plane_snapshot_limit=20,
    )
    first_app = SimpleNamespace(
        state=SimpleNamespace(
            trace_store=store,
            openclaw_control_plane_client=client,
            settings=settings,
        )
    )

    first = asyncio.run(push_codex_review_daily_snapshot(first_app, review_date="2026-07-15"))
    db_path = store.db_path
    ndjson_dir = store.ndjson_dir
    store.close()
    reopened = TraceStore(db_path=db_path, ndjson_dir=ndjson_dir)
    second_app = SimpleNamespace(
        state=SimpleNamespace(
            trace_store=reopened,
            openclaw_control_plane_client=client,
            settings=settings,
        )
    )

    second = asyncio.run(push_codex_review_daily_snapshot(second_app, review_date="2026-07-15"))

    assert first["status"] == "snapshot_received"
    assert len(client.calls) == 1
    assert second["status"] == "snapshot_unchanged"
    assert second["idempotent"] is True
    assert second["snapshot_cursor"] == first["snapshot_cursor"]
    assert reopened.get_codex_review_control_plane_snapshot_state(
        "codex-review-daily:2026-07-15"
    )["snapshot_cursor"] == first["snapshot_cursor"]


def test_push_daily_snapshot_retries_after_failure_and_resends_changed_cursor():
    store = _store()
    _seed_review_item(store, suffix="retry-snapshot")

    class FakeControlPlaneClient:
        def __init__(self):
            self.calls = []
            self.fail_next = True

        async def post_daily_snapshot(self, *, session_key, snapshot):
            self.calls.append({"session_key": session_key, "snapshot": snapshot})
            if self.fail_next:
                self.fail_next = False
                raise RuntimeError("temporary control-plane failure")
            return {"status": "snapshot_received"}

    client = FakeControlPlaneClient()
    app = SimpleNamespace(
        state=SimpleNamespace(
            trace_store=store,
            openclaw_control_plane_client=client,
            settings=SimpleNamespace(
                codex_openclaw_control_plane_workspace_id="mmd-companion",
                codex_openclaw_control_plane_snapshot_limit=20,
            ),
        )
    )

    with pytest.raises(RuntimeError, match="temporary control-plane failure"):
        asyncio.run(push_codex_review_daily_snapshot(app, review_date="2026-07-15"))

    first_success = asyncio.run(push_codex_review_daily_snapshot(app, review_date="2026-07-15"))
    _seed_review_item(store, suffix="changed-snapshot")
    changed = asyncio.run(push_codex_review_daily_snapshot(app, review_date="2026-07-15"))

    assert len(client.calls) == 3
    assert first_success["status"] == "snapshot_received"
    assert changed["status"] == "snapshot_received"
    assert changed["snapshot_cursor"] != first_success["snapshot_cursor"]


def test_apply_codex_review_decision_command_accepts_item_and_creates_memory():
    store = _store()
    item = _seed_review_item(store, suffix="command-accept")

    result = apply_codex_review_decision_command(
        store,
        {
            "id": "openclaw-review-cmd-accept",
            "type": "review_decision",
            "item_id": item["id"],
            "action": "accept",
            "target": "openclaw_wiki",
            "notes": "confirmed remotely",
            "decided_by": "admin-1",
            "decided_at": "2026-06-12T10:00:00+08:00",
        },
        default_workspace_id="mmd-companion",
    )

    assert result["item_id"] == item["id"]
    assert result["item_status"] == "accepted"
    assert result["memory_id"].startswith("codex_review_memory_")
    stored_item = store.get_codex_review_item(item["id"])
    assert stored_item["status"] == "accepted"
    assert stored_item["details"]["decision_command_id"] == "openclaw-review-cmd-accept"
    memory = store.get_codex_review_memory(result["memory_id"])
    assert memory["title"] == "Review command-accept"
    assert "## Problem" in memory["body"]
    assert "Summary command-accept" in memory["body"]
    assert memory["details"]["problem"] == "Summary command-accept"
    assert memory["workspace_id"] == "mmd-companion"


def test_apply_codex_review_decision_command_prefers_memory_draft():
    store = _store()
    item = _seed_review_item(store, suffix="command-draft")

    result = apply_codex_review_decision_command(
        store,
        {
            "id": "openclaw-review-cmd-draft",
            "type": "review_decision",
            "item_id": item["id"],
            "action": "edit_accept",
            "memory_draft": _memory_draft("ev_command-draft"),
            "edited_summary": "legacy fallback summary",
            "decided_by": "admin-1",
        },
        default_workspace_id="mmd-companion",
    )

    assert result["item_id"] == item["id"]
    assert result["item_status"] == "edited_accepted"
    memory = store.get_codex_review_memory(result["memory_id"])
    assert memory["details"]["problem"] == "任务栏有缩略图，但实际桌面窗口没有恢复。"
    assert memory["details"]["verification"][0]["expected_signal"] == "实际窗口可见且可聚焦。"
    assert "## Prerequisites" in memory["body"]
    assert "legacy fallback summary" not in memory["body"]


def test_apply_codex_review_decision_command_rejects_invalid_memory_draft():
    store = _store()
    item = _seed_review_item(store, suffix="command-invalid")

    try:
        apply_codex_review_decision_command(
            store,
            {
                "id": "openclaw-review-cmd-invalid",
                "type": "review_decision",
                "item_id": item["id"],
                "action": "accept",
                "memory_draft": {
                    "knowledge_kind": "pitfall",
                    "problem": "bad draft",
                    "when_to_use": "sometimes",
                    "steps": [],
                    "verification": [],
                    "source_summary": "summary",
                },
            },
            default_workspace_id="mmd-companion",
        )
    except ValueError as error:
        assert "steps" in str(error) or "verification" in str(error)
    else:
        raise AssertionError("expected invalid memory_draft to raise ValueError")


def test_apply_codex_review_decision_command_rejects_memory_draft_for_ignore_and_snooze():
    store = _store()
    ignored = _seed_review_item(store, suffix="command-ignore-draft")
    snoozed = _seed_review_item(store, suffix="command-snooze-draft")

    for command in (
        {
            "id": "openclaw-review-cmd-ignore-draft",
            "type": "review_decision",
            "item_id": ignored["id"],
            "action": "ignore",
            "memory_draft": _memory_draft("ev_command-ignore-draft"),
        },
        {
            "id": "openclaw-review-cmd-snooze-draft",
            "type": "review_decision",
            "item_id": snoozed["id"],
            "action": "snooze",
            "snooze_until": "2026-06-13T10:00:00+08:00",
            "memory_draft": _memory_draft("ev_command-snooze-draft"),
        },
    ):
        try:
            apply_codex_review_decision_command(
                store,
                command,
                default_workspace_id="mmd-companion",
            )
        except ValueError as error:
            assert "memory_draft" in str(error)
        else:
            raise AssertionError("expected memory_draft to be rejected for non-accept actions")


def test_apply_codex_review_decision_command_ignores_and_snoozes_without_memory():
    store = _store()
    ignored = _seed_review_item(store, suffix="command-ignore")
    snoozed = _seed_review_item(store, suffix="command-snooze")

    ignore_result = apply_codex_review_decision_command(
        store,
        {
            "id": "openclaw-review-cmd-ignore",
            "type": "review_decision",
            "item_id": ignored["id"],
            "action": "ignore",
            "notes": "noise",
            "decided_by": "admin-1",
        },
        default_workspace_id="mmd-companion",
    )
    snooze_result = apply_codex_review_decision_command(
        store,
        {
            "id": "openclaw-review-cmd-snooze",
            "type": "review_decision",
            "item_id": snoozed["id"],
            "action": "snooze",
            "snooze_until": "2026-06-13T10:00:00+08:00",
            "decided_by": "admin-1",
        },
        default_workspace_id="mmd-companion",
    )

    assert ignore_result == {
        "item_id": ignored["id"],
        "item_status": "ignored",
        "memory_id": None,
    }
    assert snooze_result == {
        "item_id": snoozed["id"],
        "item_status": "snoozed",
        "memory_id": None,
    }
    assert store.get_codex_review_memory_by_review_item(ignored["id"]) is None
    assert store.get_codex_review_item(snoozed["id"])["details"]["snooze_until"] == "2026-06-13T10:00:00+08:00"


def test_process_codex_review_commands_polls_applies_and_posts_results():
    store = _store()
    item = _seed_review_item(store, suffix="command-loop")

    class FakeControlPlaneClient:
        def __init__(self):
            self.get_calls = []
            self.result_calls = []

        async def get_commands(self, *, session_key, cursor=None):
            self.get_calls.append({"session_key": session_key, "cursor": cursor})
            return {
                "commands": [
                    {
                        "id": "openclaw-review-cmd-loop",
                        "session_key": session_key,
                        "type": "review_decision",
                        "item_id": item["id"],
                        "action": "accept",
                        "target": "openclaw_wiki",
                        "decided_by": "admin-1",
                    }
                ],
                "cursor": "command-cursor-1",
            }

        async def post_command_result(self, *, command_id, result):
            self.result_calls.append({"command_id": command_id, "result": result})
            return {"status": "result_received"}

    client = FakeControlPlaneClient()
    app = SimpleNamespace(
        state=SimpleNamespace(
            trace_store=store,
            openclaw_control_plane_client=client,
            settings=SimpleNamespace(
                codex_openclaw_control_plane_workspace_id="mmd-companion",
            ),
            last_codex_review_control_plane_command_cursor="command-cursor-0",
        )
    )

    result = asyncio.run(process_codex_review_commands(app, review_date="2026-06-12"))

    assert result["status"] == "commands_processed"
    assert result["session_key"] == "codex-review-daily:2026-06-12"
    assert result["processed"] == 1
    assert result["failed"] == 0
    assert app.state.last_codex_review_control_plane_command_cursor == "command-cursor-1"
    assert client.get_calls == [
        {
            "session_key": "codex-review-daily:2026-06-12",
            "cursor": "command-cursor-0",
        }
    ]
    assert client.result_calls[0]["command_id"] == "openclaw-review-cmd-loop"
    assert client.result_calls[0]["result"]["status"] == "succeeded"
    assert client.result_calls[0]["result"]["result"]["item_id"] == item["id"]
    assert store.get_codex_review_item(item["id"])["status"] == "accepted"


def test_push_codex_review_memory_payloads_posts_pending_memory_and_marks_submitted():
    store = _store()
    item = _seed_review_item(store, suffix="memory-push")
    memory = store.create_codex_review_memory_from_item(
        review_item_id=item["id"],
        title=item["title"],
        body=item["summary"],
        confirmed_by="admin-1",
        default_workspace_id="mmd-companion",
    )

    class FakeControlPlaneClient:
        def __init__(self):
            self.calls = []

        async def post_memory_payloads(self, *, session_key, payloads):
            self.calls.append({"session_key": session_key, "payloads": payloads})
            return {"status": "memory_payloads_received"}

    client = FakeControlPlaneClient()
    app = SimpleNamespace(
        state=SimpleNamespace(
            trace_store=store,
            openclaw_control_plane_client=client,
            settings=SimpleNamespace(
                codex_openclaw_control_plane_workspace_id="mmd-companion",
                codex_openclaw_control_plane_snapshot_limit=20,
                codex_review_memory_target="openclaw_wiki",
            ),
        )
    )

    result = asyncio.run(push_codex_review_memory_payloads(app, review_date="2026-06-12"))

    assert result["status"] == "memory_payloads_submitted"
    assert result["session_key"] == "codex-review-daily:2026-06-12"
    assert result["submitted"] == 1
    assert result["failed"] == 0
    assert client.calls[0]["session_key"] == "codex-review-daily:2026-06-12"
    assert client.calls[0]["payloads"][0]["memory"]["id"] == memory["id"]
    assert client.calls[0]["payloads"][0]["wiki"]["path"].endswith(f"/{memory['id']}.md")
    stored_memory = store.get_codex_review_memory(memory["id"])
    assert stored_memory["export_status"] == "submitted"
    assert stored_memory["export_error"] is None


def test_process_codex_review_publish_status_marks_memory_synced_or_failed():
    store = _store()
    published_item = _seed_review_item(store, suffix="publish-ok")
    failed_item = _seed_review_item(store, suffix="publish-failed")
    published_memory = store.create_codex_review_memory_from_item(
        review_item_id=published_item["id"],
        title=published_item["title"],
        body=published_item["summary"],
        confirmed_by="admin-1",
        default_workspace_id="mmd-companion",
    )
    failed_memory = store.create_codex_review_memory_from_item(
        review_item_id=failed_item["id"],
        title=failed_item["title"],
        body=failed_item["summary"],
        confirmed_by="admin-1",
        default_workspace_id="mmd-companion",
    )
    store.mark_codex_review_memory_export_submitted(published_memory["id"])
    store.mark_codex_review_memory_export_submitted(failed_memory["id"])

    class FakeControlPlaneClient:
        def __init__(self):
            self.calls = []

        async def get_publish_status(self, *, session_key, cursor=None):
            self.calls.append({"session_key": session_key, "cursor": cursor})
            return {
                "session_key": session_key,
                "cursor": "publish-cursor-1",
                "status": "published",
                "items": [
                    {
                        "memory_id": published_memory["id"],
                        "status": "published",
                        "wiki_path": f"sources/codex-review/mmd-companion/2026-06-12/{published_memory['id']}.md",
                        "commit": "abc1234",
                        "error": None,
                    },
                    {
                        "memory_id": failed_memory["id"],
                        "status": "failed",
                        "wiki_path": None,
                        "commit": None,
                        "error": "wiki_lint failed",
                    },
                ],
            }

    client = FakeControlPlaneClient()
    app = SimpleNamespace(
        state=SimpleNamespace(
            trace_store=store,
            openclaw_control_plane_client=client,
            last_codex_review_control_plane_publish_cursor="publish-cursor-0",
            settings=SimpleNamespace(
                codex_review_memory_target="openclaw_wiki",
            ),
        )
    )

    result = asyncio.run(process_codex_review_publish_status(app, review_date="2026-06-12"))

    assert result["status"] == "publish_status_processed"
    assert result["published"] == 1
    assert result["failed"] == 1
    assert app.state.last_codex_review_control_plane_publish_cursor == "publish-cursor-1"
    assert client.calls == [
        {
            "session_key": "codex-review-daily:2026-06-12",
            "cursor": "publish-cursor-0",
        }
    ]
    stored_published = store.get_codex_review_memory(published_memory["id"])
    stored_failed = store.get_codex_review_memory(failed_memory["id"])
    assert stored_published["export_status"] == "synced"
    assert stored_published["openkb_document_id"] == (
        f"sources/codex-review/mmd-companion/2026-06-12/{published_memory['id']}.md"
    )
    assert stored_failed["export_status"] == "export_failed"
    assert stored_failed["export_error"] == "wiki_lint failed"


def test_control_plane_settings_parse_env_and_reuse_openclaw_token(monkeypatch):
    monkeypatch.setenv("OPENCLAW_TOKEN", "shared-token")
    monkeypatch.setenv("CODEX_OPENCLAW_CONTROL_PLANE_ENABLED", "true")
    monkeypatch.setenv("OPENCLAW_CONTROL_PLANE_BASE_URL", "http://control.local:8765/")
    monkeypatch.delenv("OPENCLAW_CONTROL_PLANE_TOKEN", raising=False)
    monkeypatch.setenv("CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID", "review-ws")
    monkeypatch.setenv("CODEX_OPENCLAW_CONTROL_PLANE_SYNC_INTERVAL_SECONDS", "15")
    monkeypatch.setenv("CODEX_OPENCLAW_CONTROL_PLANE_SNAPSHOT_LIMIT", "7")
    monkeypatch.setenv("DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED", "true")

    settings = Settings.from_env()

    assert settings.codex_openclaw_control_plane_enabled is True
    assert settings.codex_openclaw_control_plane_base_url == "http://control.local:8765"
    assert settings.codex_openclaw_control_plane_token == "shared-token"
    assert settings.codex_openclaw_control_plane_workspace_id == "review-ws"
    assert settings.codex_openclaw_control_plane_sync_interval_seconds == 15
    assert settings.codex_openclaw_control_plane_snapshot_limit == 7
    assert settings.domain_knowledge_control_plane_enabled is True


def test_create_app_starts_control_plane_snapshot_worker_when_enabled(monkeypatch):
    async def fake_worker(app):
        app.state.control_plane_worker_started = True
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            app.state.control_plane_worker_cancelled = True
            raise

    monkeypatch.setattr(main_module, "run_codex_review_control_plane_worker", fake_worker)
    case_dir = _make_case_dir()
    app = main_module.create_app(
        {
            "data_dir": str(case_dir / "data"),
            "codex_openclaw_control_plane_enabled": True,
            "codex_openclaw_control_plane_base_url": "http://control.local:8765",
            "codex_openclaw_control_plane_token": "service-token",
            "codex_openclaw_control_plane_sync_interval_seconds": 60,
            "enable_codex_openclaw_control_plane_worker": True,
        }
    )

    with TestClient(app):
        assert app.state.openclaw_control_plane_client is not None
        assert app.state.control_plane_worker_started is True

    assert app.state.control_plane_worker_cancelled is True
