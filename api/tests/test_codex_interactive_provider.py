import asyncio
from pathlib import Path

from app.services.codex_interactive_provider import CodexInteractiveProvider


class FakeCodexAppServerClient:
    instances: list["FakeCodexAppServerClient"] = []

    def __init__(self):
        self.started = False
        self.initialized = False
        self.thread_starts: list[dict] = []
        self.turn_starts: list[dict] = []
        self.interrupts: list[dict] = []
        self.decisions: list[tuple[str, str]] = []
        self.closed = False
        self.thread_id = f"thread-{len(self.instances) + 1}"
        self.events: asyncio.Queue[dict] = asyncio.Queue()
        self.hang_turn = False
        self.instances.append(self)

    async def start(self) -> None:
        self.started = True

    async def initialize(self) -> dict:
        self.initialized = True
        return {"userAgent": "codex-test/1.0"}

    async def start_thread(self, *, cwd: Path, sandbox: str, approval_policy: str = "on-request") -> dict:
        self.thread_starts.append({"cwd": cwd, "sandbox": sandbox, "approval_policy": approval_policy})
        return {"thread": {"id": self.thread_id}, "model": "gpt-test"}

    async def start_turn(self, *, thread_id: str, user_message: str, cwd: Path, sandbox_policy: dict) -> dict:
        codex_turn_id = f"codex-turn-{len(self.turn_starts) + 1}"
        self.turn_starts.append(
            {
                "thread_id": thread_id,
                "user_message": user_message,
                "cwd": cwd,
                "sandbox_policy": sandbox_policy,
            }
        )
        if self.hang_turn:
            return {"turn": {"id": codex_turn_id}}
        await self.events.put({"type": "turn_started", "turn_id": codex_turn_id})
        await self.events.put({"type": "text_delta", "turn_id": codex_turn_id, "text": user_message})
        await self.events.put({"type": "turn_completed", "turn_id": codex_turn_id, "final_text": "done"})
        return {"turn": {"id": codex_turn_id}}

    async def events_until_turn_complete(self, *, codex_turn_id: str | None = None):
        while True:
            event = await self.events.get()
            yield event
            if event["type"] in {"turn_completed", "turn_failed", "session_closed"}:
                return

    async def interrupt_turn(self, *, thread_id: str, turn_id: str) -> dict:
        self.interrupts.append({"thread_id": thread_id, "turn_id": turn_id})
        return {}

    async def decide_approval(self, approval_id: str, decision: str) -> None:
        self.decisions.append((approval_id, decision))

    async def close(self) -> None:
        self.closed = True


def _provider() -> CodexInteractiveProvider:
    FakeCodexAppServerClient.instances.clear()
    return CodexInteractiveProvider(client_factory=FakeCodexAppServerClient)


def _session(*, mode: str, workspace_path: str = "D:/repo", worktree_path: str | None = None) -> dict:
    return {
        "id": f"codex_sess_{mode}",
        "workspace_path": workspace_path,
        "worktree_path": worktree_path,
        "sandbox_mode": "workspace-write" if mode == "patch" else "read-only",
        "metadata": {"mode": mode},
    }


def test_prepare_read_only_session_starts_thread_in_workspace():
    async def run_case():
        provider = _provider()
        prepared = await provider.prepare_session(_session(mode="read_only"))
        client = FakeCodexAppServerClient.instances[0]

        assert client.started is True
        assert client.initialized is True
        assert client.thread_starts == [
            {"cwd": Path("D:/repo"), "sandbox": "read-only", "approval_policy": "on-request"}
        ]
        assert prepared["codex_thread_id"] == "thread-1"
        assert prepared["codex_version"] == "codex-test/1.0"

    asyncio.run(run_case())


def test_prepare_patch_session_starts_thread_in_worktree():
    async def run_case():
        provider = _provider()
        await provider.prepare_session(_session(mode="patch", worktree_path="D:/repo/.worktrees/codex_sess_patch"))
        client = FakeCodexAppServerClient.instances[0]

        assert client.thread_starts[0]["cwd"] == Path("D:/repo/.worktrees/codex_sess_patch")
        assert client.thread_starts[0]["sandbox"] == "workspace-write"

    asyncio.run(run_case())


def test_stream_turn_reuses_thread_and_sends_sandbox_policy():
    async def run_case():
        provider = _provider()
        session = _session(mode="patch", worktree_path="D:/repo/.worktrees/codex_sess_patch")
        await provider.prepare_session(session)

        first = [event async for event in provider.stream_turn(session=session, turn_id="turn-1", user_message="first")]
        second = [event async for event in provider.stream_turn(session=session, turn_id="turn-2", user_message="second")]
        client = FakeCodexAppServerClient.instances[0]

        assert [event["type"] for event in first] == ["turn_started", "text_delta", "turn_completed"]
        assert [event["turn_id"] for event in first] == ["turn-1", "turn-1", "turn-1"]
        assert first[0]["codex_turn_id"] == "codex-turn-1"
        assert [event["type"] for event in second] == ["turn_started", "text_delta", "turn_completed"]
        assert [event["turn_id"] for event in second] == ["turn-2", "turn-2", "turn-2"]
        assert [item["thread_id"] for item in client.turn_starts] == ["thread-1", "thread-1"]
        assert client.turn_starts[0]["sandbox_policy"] == {
            "type": "workspaceWrite",
            "writableRoots": ["D:\\repo\\.worktrees\\codex_sess_patch"],
            "networkAccess": False,
            "excludeTmpdirEnvVar": False,
            "excludeSlashTmp": False,
        }

    asyncio.run(run_case())


def test_cancel_and_approval_decisions_are_forwarded():
    async def run_case():
        provider = _provider()
        session = _session(mode="read_only")
        await provider.prepare_session(session)
        provider._runtimes[session["id"]].active_turn_ids["turn-1"] = "codex-turn-1"

        await provider.cancel_turn(session["id"], "turn-1")
        await provider.decide_approval(session["id"], "approval-1", "deny")
        await provider.close_session(session["id"])
        client = FakeCodexAppServerClient.instances[0]

        assert client.interrupts == [{"thread_id": "thread-1", "turn_id": "codex-turn-1"}]
        assert client.decisions == [("approval-1", "deny")]
        assert client.closed is True

    asyncio.run(run_case())


def test_session_close_during_turn_yields_turn_failed():
    async def run_case():
        provider = _provider()
        session = _session(mode="read_only")
        await provider.prepare_session(session)
        client = FakeCodexAppServerClient.instances[0]

        async def start_turn_with_close(**kwargs):
            client.turn_starts.append(kwargs)
            await client.events.put({"type": "session_closed", "reason": "process_stdout_closed"})
            return {"turn": {"id": "codex-turn-crash"}}

        client.start_turn = start_turn_with_close

        events = [event async for event in provider.stream_turn(session=session, turn_id="turn-1", user_message="boom")]

        assert events == [
            {
                "type": "turn_failed",
                "turn_id": "turn-1",
                "error": "Codex app-server session closed before the turn completed.",
            },
            {
                "type": "session_closed",
                "reason": "process_stdout_closed",
                "turn_id": "turn-1",
                "codex_turn_id": "codex-turn-crash",
            },
        ]

    asyncio.run(run_case())


def test_turn_event_timeout_yields_stable_failure_and_records_last_error():
    async def run_case():
        provider = CodexInteractiveProvider(client_factory=FakeCodexAppServerClient, turn_timeout_seconds=0.01)
        session = _session(mode="read_only", workspace_path="D:/repo-timeout")
        await provider.prepare_session(session)
        client = FakeCodexAppServerClient.instances[-1]
        client.hang_turn = True

        events = [event async for event in provider.stream_turn(session=session, turn_id="turn-timeout", user_message="hang")]

        assert events == [
            {
                "type": "turn_failed",
                "turn_id": "turn-timeout",
                "error": "Codex turn timed out.",
            }
        ]
        assert provider.runtime_health()["last_error"] == "Codex turn timed out."

    asyncio.run(run_case())


def test_close_all_sessions_closes_active_clients():
    async def run_case():
        provider = _provider()
        await provider.prepare_session(_session(mode="read_only", workspace_path="D:/repo-one"))
        await provider.prepare_session(_session(mode="patch", workspace_path="D:/repo-two", worktree_path="D:/repo-two-wt"))

        await provider.close_all_sessions()

        assert [client.closed for client in FakeCodexAppServerClient.instances] == [True, True]
        assert provider.runtime_health()["active_sessions"] == 0

    asyncio.run(run_case())
