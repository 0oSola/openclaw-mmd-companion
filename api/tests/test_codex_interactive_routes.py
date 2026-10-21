import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
import subprocess
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.services.codex_app_server_client import CodexAppServerError
from app.services.codex_interactive_provider import DeterministicCodexInteractiveProvider


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.rstrip("\n")


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _make_git_repo(workspace_path: Path) -> None:
    _git(workspace_path, "init")
    _git(workspace_path, "config", "user.email", "codex@example.test")
    _git(workspace_path, "config", "user.name", "Codex Test")
    (workspace_path / "README.md").write_text("hello\n", encoding="utf-8")
    _git(workspace_path, "add", "README.md")
    _git(workspace_path, "commit", "-m", "initial")


def _client(enabled: bool = True, allowed_users: list[str] | None = None) -> tuple[TestClient, object]:
    case_dir = _make_case_dir()
    workspace_path = case_dir / "repo"
    workspace_path.mkdir()
    _make_git_repo(workspace_path)
    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": ["admin-1"],
            "codex_interactive_enabled": enabled,
            "codex_allowed_users": allowed_users if allowed_users is not None else ["admin-1"],
            "codex_allowed_workspaces": ["mmd-companion"],
            "codex_workspace_paths": {"mmd-companion": str(workspace_path)},
            "codex_worktree_root": str(case_dir / "worktrees"),
            "codex_use_deterministic_provider": True,
            "codex_turn_timeout_seconds": 5,
            "codex_max_prompt_chars": 2000,
        }
    )
    client = TestClient(app)
    client.__enter__()
    return client, app


class FakeRouteProvider:
    def __init__(self):
        self.prepared: list[dict] = []
        self.streamed: list[dict] = []
        self.decisions: list[tuple[str, str, str]] = []
        self.cancelled: list[tuple[str, str]] = []
        self.closed: list[str] = []
        self.close_all_count = 0
        self.fail_turn = False
        self.session_closed_turn = False
        self.block_turn = False

    async def prepare_session(self, session: dict) -> dict:
        self.prepared.append(session)
        return {"codex_thread_id": "thread-from-provider", "codex_version": "codex-test/1.0", "process_id": 123}

    async def stream_turn(self, *, session: dict, turn_id: str, user_message: str, mode: str = "read_only"):
        self.streamed.append({"session": session, "turn_id": turn_id, "user_message": user_message, "mode": mode})
        if self.fail_turn:
            raise CodexAppServerError("app-server crashed")
        if self.session_closed_turn:
            yield {"type": "session_closed", "turn_id": turn_id, "reason": "process_stdout_closed", "exit_code": 1}
            return
        if self.block_turn:
            await asyncio.sleep(3600)
        yield {"type": "text_delta", "turn_id": turn_id, "text": "real output"}
        yield {"type": "turn_completed", "turn_id": turn_id, "final_text": "done"}

    async def decide_approval(self, session_id: str, approval_id: str, decision: str) -> None:
        self.decisions.append((session_id, approval_id, decision))

    async def cancel_turn(self, session_id: str, turn_id: str) -> None:
        self.cancelled.append((session_id, turn_id))

    async def close_session(self, session_id: str) -> None:
        self.closed.append(session_id)

    async def close_all_sessions(self) -> None:
        self.close_all_count += 1


def _client_with_provider(provider: FakeRouteProvider) -> tuple[TestClient, object]:
    client, app = _client()
    app.state.codex_interactive_provider = provider
    return client, app


def test_create_codex_session_rejects_when_disabled():
    client, _ = _client(enabled=False)

    response = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only", "sandbox": "read-only"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 404


def test_list_codex_interactive_sessions_returns_bounded_session_snapshot():
    client, app = _client()

    created = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only", "sandbox": "read-only"},
        headers={"x-user-id": "admin-1"},
    )
    assert created.status_code == 200
    app.state.trace_store.append_codex_event(
        created.json()["id"],
        None,
        "text_delta",
        {"text": "bounded runtime output password=hunter2 api_key=sk-live-secret-value"},
    )

    response = client.get(
        "/codex/interactive/sessions?limit=999",
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["limit"] == 50
    assert payload["sessions"][0]["id"] == created.json()["id"]
    assert payload["sessions"][0]["workspace_path"].endswith("\\repo")
    assert payload["sessions"][0]["status"] == "ready"
    assert payload["sessions"][0]["last_output_preview"] == (
        "bounded runtime output password=[redacted] api_key=[redacted]"
    )
    assert "metadata" in payload["sessions"][0]


def test_list_codex_interactive_sessions_requires_codex_user():
    client, _ = _client()

    response = client.get(
        "/codex/interactive/sessions",
        headers={"x-user-id": "not-allowed"},
    )

    assert response.status_code == 403


def test_create_codex_session_requires_allowlisted_admin():
    client, _ = _client(enabled=True, allowed_users=["sola"])

    response = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only", "sandbox": "read-only"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 403


def test_create_codex_session_returns_ready_read_only_session():
    client, _ = _client()

    response = client.post(
        "/codex/interactive/sessions",
        json={"local_chat_session_id": "chat-1", "workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"].startswith("codex_sess_")
    assert payload["workspace_id"] == "mmd-companion"
    assert payload["status"] == "ready"
    assert payload["sandbox"] == "read-only"
    assert payload["ws_url"].startswith(f"/api/backend/ws/codex/interactive/{payload['id']}?user_id=admin-1")


def test_codex_workspaces_can_be_listed_and_created_for_session_selection():
    client, app = _client()
    extra_workspace_path = Path(app.state.settings.data_dir).parent / "extra-repo"
    extra_workspace_path.mkdir()
    _make_git_repo(extra_workspace_path)

    listed = client.get("/codex/workspaces", headers={"x-user-id": "admin-1"})
    assert listed.status_code == 200
    assert listed.json()["workspaces"][0]["id"] == "mmd-companion"

    created = client.post(
        "/codex/workspaces",
        json={"workspace_id": "extra-repo", "path": str(extra_workspace_path)},
        headers={"x-user-id": "admin-1"},
    )

    assert created.status_code == 200
    workspace = created.json()["workspace"]
    assert workspace["id"] == "extra-repo"
    assert workspace["source"] == "ui"
    assert Path(workspace["path"]) == extra_workspace_path.resolve()

    response = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "extra-repo", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["workspace_id"] == "extra-repo"
    session = app.state.trace_store.get_codex_interactive_session(response.json()["id"])
    assert Path(session["workspace_path"]) == extra_workspace_path.resolve()


def test_codex_workspace_create_rejects_non_git_directory():
    client, app = _client()
    non_git_path = Path(app.state.settings.data_dir).parent / "not-a-repo"
    non_git_path.mkdir()

    response = client.post(
        "/codex/workspaces",
        json={"workspace_id": "not-a-repo", "path": str(non_git_path)},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 400
    assert "git" in response.json()["detail"].lower()


def test_codex_workspace_path_picker_returns_selected_local_path():
    client, app = _client()
    selected_path = Path(app.state.settings.data_dir).parent / "selected-repo"
    selected_path.mkdir()

    app.state.codex_workspace_path_picker = lambda initial_path=None: str(selected_path)

    response = client.post(
        "/codex/workspaces/path-picker",
        json={"initial_path": str(selected_path.parent)},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert Path(response.json()["path"]) == selected_path.resolve()


def test_codex_workspace_path_picker_returns_null_when_cancelled():
    client, app = _client()
    app.state.codex_workspace_path_picker = lambda initial_path=None: None

    response = client.post(
        "/codex/workspaces/path-picker",
        json={},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["path"] is None


def test_create_patch_session_creates_workspace_write_worktree():
    client, _ = _client()

    response = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sandbox"] == "workspace-write"
    assert payload["branch_name"].startswith("codex/codex_sess_")
    assert Path(payload["worktree_path"]).exists()
    assert _git(Path(payload["worktree_path"]), "branch", "--show-current") == payload["branch_name"]


def test_create_session_prepares_provider_and_persists_codex_thread():
    provider = FakeRouteProvider()
    client, app = _client_with_provider(provider)

    response = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    session_id = response.json()["id"]
    session = app.state.trace_store.get_codex_interactive_session(session_id)
    assert provider.prepared[0]["id"] == session_id
    assert session["codex_thread_id"] == "thread-from-provider"
    assert session["codex_version"] == "codex-test/1.0"
    assert session["process_id"] == 123


def test_create_session_enforces_max_concurrent_sessions():
    client, _ = _client()

    first = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    )
    second = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    )

    assert first.status_code == 200
    assert second.status_code == 429
    assert "maximum" in second.json()["detail"].lower()


def test_create_session_closes_idle_sessions_before_enforcing_limit():
    provider = FakeRouteProvider()
    client, app = _client_with_provider(provider)
    first = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()
    old = (datetime.now(UTC) - timedelta(seconds=3600)).isoformat()
    app.state.trace_store._conn.execute(
        "UPDATE codex_interactive_sessions SET last_active_at = ? WHERE id = ?",
        (old, first["id"]),
    )
    app.state.trace_store._conn.commit()
    app.state.settings.codex_session_idle_timeout_seconds = 30

    second = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    )

    assert second.status_code == 200
    assert provider.closed == [first["id"]]
    assert app.state.trace_store.get_codex_interactive_session(first["id"])["status"] == "closed"


def test_fastapi_shutdown_closes_active_codex_runtimes():
    provider = FakeRouteProvider()
    client, app = _client_with_provider(provider)
    client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    )

    client.__exit__(None, None, None)

    assert provider.close_all_count == 1


def test_codex_diff_endpoint_returns_patch_and_persists_artifact():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    worktree_path = Path(session["worktree_path"])
    (worktree_path / "README.md").write_text("hello\ncodex\n", encoding="utf-8")

    response = client.get(f"/codex/interactive/{session['id']}/diff", headers={"x-user-id": "admin-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["changed_files"] == ["README.md"]
    assert "diff --git a/README.md b/README.md" in payload["patch"]
    artifacts = app.state.trace_store.list_codex_artifacts(session["id"], kind="diff")
    assert artifacts[0]["metadata"]["changed_files"] == ["README.md"]


def test_codex_approval_decision_endpoint_persists_decision_event():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    approval = app.state.trace_store.create_codex_approval(
        approval_id="approval-1",
        codex_session_id=session["id"],
        turn_id=None,
        external_approval_id=None,
        action_type="command",
        title="Run command",
        detail={"command": "git status"},
    )

    response = client.post(
        f"/codex/interactive/{session['id']}/approvals/{approval['id']}",
        json={"decision": "deny"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["decision"] == "deny"
    assert app.state.trace_store.get_codex_approval("approval-1")["decided_by"] == "admin-1"
    assert app.state.trace_store.list_codex_events(session["id"])[-1]["event_type"] == "approval_decided"
    traces = app.state.trace_store.query_events(trace_id=None, requester_user_id="admin-1", is_admin=True, limit=20)
    assert any(event["stage"] == "codex.approval.decided" for event in traces)


def test_codex_approval_decision_forwards_to_provider():
    provider = FakeRouteProvider()
    client, app = _client_with_provider(provider)
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    app.state.trace_store.create_codex_approval(
        approval_id="approval-forward",
        codex_session_id=session["id"],
        turn_id=None,
        external_approval_id=None,
        action_type="command",
        title="Run command",
        detail={},
    )

    response = client.post(
        f"/codex/interactive/{session['id']}/approvals/approval-forward",
        json={"decision": "approve_once"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert provider.decisions == [(session["id"], "approval-forward", "approve_once")]


def test_codex_checks_are_blocked_by_pending_approval_and_record_artifact():
    client, app = _client()
    app.state.codex_check_commands = {"api": [["git", "status", "--short"]]}
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    app.state.trace_store.create_codex_approval(
        approval_id="approval-pending",
        codex_session_id=session["id"],
        turn_id=None,
        external_approval_id=None,
        action_type="command",
        title="Run command",
        detail={},
    )

    blocked = client.post(
        f"/codex/interactive/{session['id']}/checks",
        json={"checks": ["api"]},
        headers={"x-user-id": "admin-1"},
    )
    assert blocked.status_code == 409

    app.state.trace_store.decide_codex_approval("approval-pending", decision="approve_once", decided_by="admin-1")
    response = client.post(
        f"/codex/interactive/{session['id']}/checks",
        json={"checks": ["api"]},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"][0]["check"] == "api"
    assert payload["results"][0]["exit_code"] == 0
    assert app.state.trace_store.list_codex_artifacts(session["id"], kind="checks")


def test_codex_apply_requires_confirm_clean_workspace_and_applies_patch():
    client, app = _client()
    app.state.codex_check_commands = {"api": [["git", "status", "--short"]]}
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    worktree_path = Path(session["worktree_path"])
    workspace_path = Path(app.state.trace_store.get_codex_interactive_session(session["id"])["workspace_path"])
    (worktree_path / "README.md").write_text("hello\napplied\n", encoding="utf-8")

    unconfirmed = client.post(
        f"/codex/interactive/{session['id']}/apply",
        json={"strategy": "patch_to_main_workspace", "confirm": False},
        headers={"x-user-id": "admin-1"},
    )
    assert unconfirmed.status_code == 400

    (workspace_path / "dirty.txt").write_text("dirty\n", encoding="utf-8")
    dirty = client.post(
        f"/codex/interactive/{session['id']}/apply",
        json={"strategy": "patch_to_main_workspace", "confirm": True},
        headers={"x-user-id": "admin-1"},
    )
    assert dirty.status_code == 409
    (workspace_path / "dirty.txt").unlink()

    response = client.post(
        f"/codex/interactive/{session['id']}/apply",
        json={"strategy": "patch_to_main_workspace", "confirm": True},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["applied"] is True
    assert (workspace_path / "README.md").read_text(encoding="utf-8") == "hello\napplied\n"
    assert app.state.trace_store.list_codex_artifacts(session["id"], kind="apply")


def test_codex_discard_closes_session_and_removes_worktree():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    worktree_path = Path(session["worktree_path"])

    response = client.post(
        f"/codex/interactive/{session['id']}/discard",
        json={"remove_worktree": True},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    assert not worktree_path.exists()
    assert app.state.trace_store.get_codex_interactive_session(session["id"])["status"] == "closed"


def test_codex_websocket_streams_turn_and_persists_events():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json() == {"type": "session_ready", "session_id": session["id"], "thread_id": None}
        websocket.send_json({"type": "user_message", "text": "explain message service", "mode": "read_only"})
        turn_started = websocket.receive_json()
        text_delta = websocket.receive_json()
        completed = websocket.receive_json()

    assert turn_started["type"] == "turn_started"
    assert text_delta == {
        "type": "text_delta",
        "turn_id": turn_started["turn_id"],
        "text": "Codex read-only analysis queued for: explain message service",
    }
    assert completed == {
        "type": "turn_completed",
        "turn_id": turn_started["turn_id"],
        "final_text": "Read-only Codex turn completed.",
    }
    events = app.state.trace_store.list_codex_events(session["id"])
    assert [event["event_type"] for event in events] == [
        "session_ready",
        "turn_started",
        "text_delta",
        "turn_completed",
    ]
    traces = app.state.trace_store.query_events(trace_id=None, requester_user_id="admin-1", is_admin=True, limit=20)
    stages = [event["stage"] for event in traces]
    assert "codex.turn.start" in stages
    assert "codex.turn.event" in stages
    assert "codex.turn.completed" in stages


def test_codex_trace_events_are_redacted_before_sqlite_and_ndjson_persistence():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        websocket.receive_json()
        websocket.send_json({"type": "user_message", "text": "inspect OPENCLAW_TOKEN=super-secret", "mode": "read_only"})
        websocket.receive_json()
        websocket.receive_json()
        websocket.receive_json()

    traces = app.state.trace_store.query_events(trace_id=None, requester_user_id="admin-1", is_admin=True, limit=30)
    serialized = "\n".join(str(event["payload"]) for event in traces if event["stage"].startswith("codex."))
    assert "super-secret" not in serialized
    assert "[REDACTED]" in serialized

    ndjson = "\n".join(path.read_text(encoding="utf-8") for path in app.state.trace_store.ndjson_dir.glob("*.ndjson"))
    assert "super-secret" not in ndjson
    assert "[REDACTED]" in ndjson


def test_codex_websocket_can_cancel_running_turn():
    client, _ = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json()["type"] == "session_ready"
        websocket.send_json({"type": "user_message", "text": "slow analysis", "mode": "read_only"})
        turn_started = websocket.receive_json()
        websocket.send_json({"type": "cancel_turn"})
        cancelled = websocket.receive_json()

    assert turn_started["type"] == "turn_started"
    assert cancelled == {
        "type": "turn_failed",
        "turn_id": turn_started["turn_id"],
        "error": "Turn cancelled.",
    }


def test_codex_patch_websocket_persists_approval_required_event():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json()["type"] == "session_ready"
        websocket.send_json({"type": "user_message", "text": "modify README", "mode": "patch"})
        turn_started = websocket.receive_json()
        command_started = websocket.receive_json()
        command_output = websocket.receive_json()
        file_changed = websocket.receive_json()
        approval_required = websocket.receive_json()

    assert turn_started["type"] == "turn_started"
    assert command_started["type"] == "command_started"
    assert command_output["type"] == "command_output"
    assert file_changed == {
        "type": "file_changed",
        "turn_id": turn_started["turn_id"],
        "path": "README.md",
        "change_type": "modified",
    }
    assert approval_required["type"] == "approval_required"
    approvals = app.state.trace_store.list_pending_codex_approvals(session["id"])
    assert approvals[0]["id"] == approval_required["approval_id"]
    assert approvals[0]["action_type"] == "command"


def test_codex_websocket_approval_decision_persists_and_forwards_to_provider():
    provider = FakeRouteProvider()
    client, app = _client_with_provider(provider)
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    app.state.trace_store.create_codex_approval(
        approval_id="approval-ws",
        codex_session_id=session["id"],
        turn_id="turn-from-codex",
        external_approval_id=None,
        action_type="command",
        title="Run command",
        detail={"command": "git status"},
    )

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json()["type"] == "session_ready"
        websocket.send_json({"type": "approval_decision", "approval_id": "approval-ws", "decision": "approve_once"})
        decided = websocket.receive_json()

    assert decided == {
        "type": "approval_decided",
        "approval_id": "approval-ws",
        "decision": "approve_once",
        "decided_by": "admin-1",
    }
    assert provider.decisions == [(session["id"], "approval-ws", "approve_once")]
    assert app.state.trace_store.get_codex_approval("approval-ws")["decision"] == "approve_once"


def test_codex_patch_websocket_emits_diff_ready_after_turn_completion():
    provider = FakeRouteProvider()
    client, _ = _client_with_provider(provider)
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    worktree_path = Path(session["worktree_path"])
    (worktree_path / "README.md").write_text("hello\nchanged by provider\n", encoding="utf-8")

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json()["thread_id"] == "thread-from-provider"
        websocket.send_json({"type": "user_message", "text": "modify README", "mode": "patch"})
        turn_started = websocket.receive_json()
        text_delta = websocket.receive_json()
        completed = websocket.receive_json()
        diff_ready = websocket.receive_json()

    assert turn_started["type"] == "turn_started"
    assert text_delta["text"] == "real output"
    assert completed["type"] == "turn_completed"
    assert diff_ready["type"] == "diff_ready"
    assert diff_ready["changed_files"] == ["README.md"]


def test_codex_websocket_marks_turn_failed_when_provider_crashes():
    provider = FakeRouteProvider()
    provider.fail_turn = True
    client, app = _client_with_provider(provider)
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json()["type"] == "session_ready"
        websocket.send_json({"type": "user_message", "text": "crash", "mode": "read_only"})
        turn_started = websocket.receive_json()
        failed = websocket.receive_json()

    assert turn_started["type"] == "turn_started"
    assert failed == {
        "type": "turn_failed",
        "turn_id": turn_started["turn_id"],
        "error": "app-server crashed",
    }
    turn = app.state.trace_store.get_codex_turn(turn_started["turn_id"])
    assert turn["status"] == "failed"
    assert app.state.trace_store.get_codex_interactive_session(session["id"])["status"] == "failed"


def test_codex_websocket_process_close_marks_session_failed_and_health_last_error():
    provider = FakeRouteProvider()
    provider.session_closed_turn = True
    client, app = _client_with_provider(provider)
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json()["type"] == "session_ready"
        websocket.send_json({"type": "user_message", "text": "crash", "mode": "read_only"})
        turn_started = websocket.receive_json()
        closed = websocket.receive_json()

    assert turn_started["type"] == "turn_started"
    assert closed["type"] == "session_closed"
    stored_session = app.state.trace_store.get_codex_interactive_session(session["id"])
    assert stored_session["status"] == "failed"
    assert "process_stdout_closed" in stored_session["error"]

    health = client.get("/admin/runtime-health", headers={"x-user-id": "admin-1"}).json()
    assert "process_stdout_closed" in health["codex"]["last_error"]


def test_codex_websocket_cancel_and_close_forward_to_provider():
    provider = FakeRouteProvider()
    provider.block_turn = True
    client, _ = _client_with_provider(provider)
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json()["type"] == "session_ready"
        websocket.send_json({"type": "user_message", "text": "slow", "mode": "read_only"})
        turn_started = websocket.receive_json()
        websocket.send_json({"type": "cancel_turn"})
        websocket.receive_json()
        websocket.send_json({"type": "close_session"})
        closed = websocket.receive_json()
        while closed["type"] != "session_closed":
            closed = websocket.receive_json()

    assert provider.cancelled == [(session["id"], turn_started["turn_id"])]
    assert provider.closed == [session["id"]]
    assert closed["type"] == "session_closed"


def test_codex_http_cancel_controls_turn_owned_by_another_websocket():
    provider = FakeRouteProvider()
    provider.block_turn = True
    client, _ = _client_with_provider(provider)
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as owner:
        assert owner.receive_json()["type"] == "session_ready"
        owner.send_json({"type": "user_message", "text": "slow", "mode": "read_only"})
        turn_started = owner.receive_json()

        response = client.post(
            f"/codex/interactive/{session['id']}/cancel",
            headers={"x-user-id": "admin-1"},
        )
        assert response.status_code == 200
        assert response.json() == {
            "session_id": session["id"],
            "cancelled": True,
            "turn_id": turn_started["turn_id"],
            "status": "cancelled",
        }
        assert owner.receive_json() == {
            "type": "turn_failed",
            "turn_id": turn_started["turn_id"],
            "error": "Turn cancelled.",
        }

    assert provider.cancelled == [(session["id"], turn_started["turn_id"])]


def test_codex_websocket_rejects_wrong_user():
    client, _ = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=sola"):
            pass
