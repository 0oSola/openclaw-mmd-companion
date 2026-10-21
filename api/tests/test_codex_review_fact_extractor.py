from pathlib import Path
from uuid import uuid4

from app.db.store import TraceStore
from app.services.codex_review_fact_extractor import build_codex_review_evidence_pack


def _store() -> TraceStore:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def test_build_evidence_pack_merges_pet_facts_codex_artifacts_events_and_approvals():
    store = _store()
    codex_session_id = "codex_sess_review"
    pet_session_id = f"codex:{codex_session_id}"
    store.upsert_desktop_pet_session(
        pet_session_id=pet_session_id,
        codex_session_id=codex_session_id,
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home="C:/Users/KSG/.codex",
        display_title="OpenClaw review sync",
        first_prompt_preview="Implement OpenClaw review sync",
        last_summary="Designed the review outbox flow.",
        last_status="failed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={
            "source": "codex-jsonl",
            "session_parser_version": "codex-jsonl-stream-v2",
            "review_facts_version": "codex-review-facts-v2",
            "last_output": "Exit code: 1\nschema mismatch",
            "facts": {
                "failed_commands": [
                    {
                        "command": "npm run build",
                        "exit_code": 1,
                        "excerpt": "Exit code: 1\nschema mismatch",
                    }
                ],
                "changed_files": ["desktop-pet/electron/main.ts"],
                "approvals": [{"title": "Allow command npm test?", "action_type": "command"}],
                "errors": [{"type": "turn_failed", "excerpt": "OpenClaw returned invalid JSON"}],
                "event_counts": {"turn_failed": 1},
                "work_items": [
                    {
                        "kind": "goal",
                        "source": "user",
                        "text": "Implement OpenClaw review sync",
                        "timestamp": "2026-06-03T11:15:48Z",
                    },
                    {
                        "kind": "agent_update",
                        "source": "assistant",
                        "text": "Designed the review outbox flow.",
                        "timestamp": "2026-06-03T11:16:15Z",
                    },
                ],
                "methods": [
                    {
                        "kind": "check",
                        "name": "shell_command",
                        "command": "npm run build",
                        "outcome": "failed",
                        "exit_code": 1,
                        "excerpt": "Exit code: 1\nschema mismatch",
                        "timestamp": "2026-06-03T11:15:55Z",
                    },
                    {
                        "kind": "check",
                        "name": "vitest",
                        "command": "npm test -- --run electron/codexSessionFiles.test.ts",
                        "outcome": "success",
                        "exit_code": None,
                        "excerpt": "10 tests passed",
                        "timestamp": "2026-06-03T11:16:10Z",
                    },
                ],
            },
        },
    )
    store.create_codex_interactive_session(
        session_id=codex_session_id,
        local_chat_session_id=None,
        workspace_id="mmd-companion",
        user_id="admin-1",
        workspace_path="D:/workspace/MMD project",
        worktree_path="D:/workspace/MMD project/api/data/codex-worktrees/codex_sess_review",
        branch_name="codex/codex_sess_review",
        codex_thread_id="thread-review",
        codex_version="codex-cli 0.137.0",
        transport="stdio",
        sandbox_mode="workspace-write",
        status="failed",
        process_id=None,
        metadata={"mode": "patch"},
    )
    store.append_codex_event(
        codex_session_id,
        None,
        "turn_failed",
        {"type": "turn_failed", "error": "Codex app-server process exited"},
    )
    store.append_codex_event(
        codex_session_id,
        None,
        "codex.apply.failed",
        {"type": "codex.apply.failed", "error": "git apply --check failed"},
    )
    store.create_codex_approval(
        approval_id="approval-review",
        codex_session_id=codex_session_id,
        turn_id=None,
        external_approval_id="external-approval",
        action_type="command",
        title="Run pytest",
        detail={"command": "pytest api/tests"},
    )
    store.create_codex_artifact(
        artifact_id="artifact-diff",
        codex_session_id=codex_session_id,
        turn_id=None,
        kind="diff",
        path=None,
        content_ref=None,
        summary="2 files changed",
        metadata={"changed_files": ["api/app/routes/desktop_pet.py"]},
    )
    store.create_codex_artifact(
        artifact_id="artifact-checks",
        codex_session_id=codex_session_id,
        turn_id=None,
        kind="checks",
        path=None,
        content_ref=None,
        summary="2 command(s) completed",
        metadata={
            "results": [
                {"check": "api", "command": ["pytest", "api/tests"], "exit_code": 0, "stdout": "ok", "stderr": ""},
                {"check": "web", "command": ["npm", "run", "build"], "exit_code": 1, "stdout": "", "stderr": "boom"},
            ]
        },
    )

    evidence_pack = build_codex_review_evidence_pack(store, pet_session_id)

    assert evidence_pack["kind"] == "codex_review_evidence_pack"
    assert evidence_pack["session"]["pet_session_id"] == pet_session_id
    assert evidence_pack["session"]["codex_session_id"] == codex_session_id
    assert evidence_pack["session"]["first_goal"] == "Implement OpenClaw review sync"
    assert evidence_pack["session"]["status"] == "failed"
    assert evidence_pack["session"]["session_parser_version"] == "codex-jsonl-stream-v2"
    assert evidence_pack["session"]["review_facts_version"] == "codex-review-facts-v2"
    assert evidence_pack["facts"]["changed_files"] == [
        "desktop-pet/electron/main.ts",
        "api/app/routes/desktop_pet.py",
    ]
    assert evidence_pack["facts"]["failed_commands"] == [
        {"command": "npm run build", "exit_code": 1, "excerpt": "Exit code: 1\nschema mismatch"},
        {"command": "npm run build", "exit_code": 1, "excerpt": "boom"},
    ]
    assert evidence_pack["facts"]["successful_checks"] == [
        {"check": "api", "command": "pytest api/tests", "excerpt": "ok"},
        {
            "check": "vitest",
            "command": "npm test -- --run electron/codexSessionFiles.test.ts",
            "excerpt": "10 tests passed",
        },
    ]
    assert evidence_pack["facts"]["pending_approvals"] == [
        {"id": "approval-review", "title": "Run pytest", "action_type": "command"}
    ]
    assert evidence_pack["facts"]["work_items"] == [
        {
            "kind": "goal",
            "source": "user",
            "text": "Implement OpenClaw review sync",
            "timestamp": "2026-06-03T11:15:48Z",
        },
        {
            "kind": "agent_update",
            "source": "assistant",
            "text": "Designed the review outbox flow.",
            "timestamp": "2026-06-03T11:16:15Z",
        },
    ]
    assert evidence_pack["facts"]["methods"] == [
        {
            "kind": "check",
            "name": "shell_command",
            "command": "npm run build",
            "outcome": "failed",
            "exit_code": 1,
            "excerpt": "Exit code: 1\nschema mismatch",
            "timestamp": "2026-06-03T11:15:55Z",
        },
        {
            "kind": "check",
            "name": "vitest",
            "command": "npm test -- --run electron/codexSessionFiles.test.ts",
            "outcome": "success",
            "exit_code": None,
            "excerpt": "10 tests passed",
            "timestamp": "2026-06-03T11:16:10Z",
        },
    ]
    assert evidence_pack["facts"]["apply_failed"] is True
    assert evidence_pack["facts"]["last_error"] == "git apply --check failed"
    assert {item["id"] for item in evidence_pack["evidence"]} >= {
        "pet_session",
        "pet_failed_command_0",
        "artifact_diff_artifact-diff",
        "artifact_checks_artifact-checks",
        "approval_approval-review",
        "event_turn_failed_1",
        "work_items",
        "methods",
    }
