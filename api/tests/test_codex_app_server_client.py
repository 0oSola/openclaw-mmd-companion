import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

from app.services.codex_app_server_client import CodexAppServerClient, CodexAppServerError


class FakeWriter:
    def __init__(self):
        self.lines: list[dict] = []
        self.closed = False

    def write(self, data: bytes) -> None:
        self.lines.append(json.loads(data.decode("utf-8")))

    async def drain(self) -> None:
        return None

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        return None


def _client_with_writer() -> tuple[CodexAppServerClient, FakeWriter]:
    writer = FakeWriter()
    client = CodexAppServerClient(
        codex_bin="codex",
        codex_home=Path("D:/codex-home"),
        request_timeout_seconds=2,
    )
    client.attach_writer_for_tests(writer)
    return client, writer


def test_request_matches_response_by_id():
    async def run_case():
        client, writer = _client_with_writer()
        task = asyncio.create_task(client.request("thread/list", {"limit": 1}))
        await asyncio.sleep(0)

        assert writer.lines == [{"id": "codex_req_1", "method": "thread/list", "params": {"limit": 1}}]
        await client.handle_message_for_tests({"id": "codex_req_1", "result": {"threads": []}})

        assert await task == {"threads": []}

    asyncio.run(run_case())


def test_request_raises_on_error_response():
    async def run_case():
        client, _ = _client_with_writer()
        task = asyncio.create_task(client.request("thread/list", {}))
        await asyncio.sleep(0)
        await client.handle_message_for_tests({"id": "codex_req_1", "error": {"message": "bad request"}})

        try:
            await task
        except CodexAppServerError as exc:
            assert "bad request" in str(exc)
        else:
            raise AssertionError("request should raise on app-server error")

    asyncio.run(run_case())


def test_notification_is_queued_for_streaming():
    async def run_case():
        client, _ = _client_with_writer()

        await client.handle_message_for_tests(
            {
                "method": "item/agentMessage/delta",
                "params": {"threadId": "thread-1", "turnId": "turn-1", "itemId": "item-1", "delta": "hello"},
            }
        )

        assert await client.next_event() == {
            "type": "text_delta",
            "turn_id": "turn-1",
            "text": "hello",
            "raw_method": "item/agentMessage/delta",
        }

    asyncio.run(run_case())


def test_command_approval_request_can_be_decided():
    async def run_case():
        client, writer = _client_with_writer()

        await client.handle_message_for_tests(
            {
                "id": "server_req_1",
                "method": "item/commandExecution/requestApproval",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "itemId": "item-1",
                    "approvalId": "approval-from-codex",
                    "command": "npm test",
                    "cwd": "D:/repo",
                    "reason": "needs command",
                },
            }
        )
        event = await client.next_event()

        assert event["type"] == "approval_required"
        assert event["approval_id"] == "approval-from-codex"
        assert event["action_type"] == "command"
        assert event["title"] == "Run command"
        assert event["detail"]["command"] == "npm test"

        await client.decide_approval("approval-from-codex", "approve_once")

        assert writer.lines[-1] == {
            "id": "server_req_1",
            "result": {"decision": "accept"},
        }

    asyncio.run(run_case())


def test_legacy_exec_approval_request_can_be_decided():
    async def run_case():
        client, writer = _client_with_writer()

        await client.handle_message_for_tests(
            {
                "id": "server_req_legacy",
                "method": "execCommandApproval",
                "params": {
                    "conversationId": "thread-1",
                    "callId": "call-1",
                    "approvalId": None,
                    "command": ["git", "status"],
                    "cwd": "D:/repo",
                    "reason": None,
                    "parsedCmd": [],
                },
            }
        )
        event = await client.next_event()

        assert event["approval_id"] == "server_req_legacy"
        assert event["detail"]["command"] == "git status"

        await client.decide_approval("server_req_legacy", "deny")

        assert writer.lines[-1] == {
            "id": "server_req_legacy",
            "result": {"decision": "denied"},
        }

    asyncio.run(run_case())


def test_unknown_server_request_is_rejected_instead_of_hanging():
    async def run_case():
        client, writer = _client_with_writer()

        await client.handle_message_for_tests({"id": "server_req_unknown", "method": "item/tool/call", "params": {}})

        assert writer.lines[-1]["id"] == "server_req_unknown"
        assert writer.lines[-1]["error"]["message"] == "Unsupported Codex app-server request"

    asyncio.run(run_case())


def test_process_stdout_close_fails_pending_request_and_emits_session_closed():
    async def run_case():
        client, writer = _client_with_writer()
        reader = asyncio.StreamReader()
        reader_task = asyncio.create_task(client._read_stdout_loop(reader))
        request_task = asyncio.create_task(client.request("thread/start", {}))
        await asyncio.sleep(0)

        assert writer.lines[-1]["method"] == "thread/start"
        reader.feed_eof()
        await reader_task

        try:
            await request_task
        except CodexAppServerError as exc:
            assert "process closed" in str(exc)
        else:
            raise AssertionError("request should fail when app-server stdout closes")

        assert await client.next_event() == {
            "type": "session_closed",
            "reason": "process_stdout_closed",
            "exit_code": None,
        }

    asyncio.run(run_case())


def test_events_until_turn_complete_continues_after_retriable_error():
    async def run_case():
        client, _ = _client_with_writer()

        await client.handle_message_for_tests(
            {
                "method": "error",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "willRetry": True,
                    "error": {"message": "Reconnecting... 1/5"},
                },
            }
        )
        await client.handle_message_for_tests(
            {
                "method": "turn/completed",
                "params": {"threadId": "thread-1", "turn": {"id": "turn-1", "items": []}},
            }
        )

        events = []
        async for event in client.events_until_turn_complete():
            events.append(event)

        assert [event["type"] for event in events] == ["turn_retrying", "turn_completed"]

    asyncio.run(run_case())


def test_events_until_turn_complete_ignores_events_from_previous_turn():
    async def run_case():
        client, _ = _client_with_writer()

        await client.handle_message_for_tests(
            {
                "method": "turn/completed",
                "params": {"threadId": "thread-1", "turn": {"id": "old-turn", "items": []}},
            }
        )
        await client.handle_message_for_tests(
            {
                "method": "turn/completed",
                "params": {"threadId": "thread-1", "turn": {"id": "new-turn", "items": []}},
            }
        )

        events = []
        async for event in client.events_until_turn_complete(codex_turn_id="new-turn"):
            events.append(event)

        assert events == [
            {
                "type": "turn_completed",
                "turn_id": "new-turn",
                "final_text": "",
                "raw_method": "turn/completed",
            }
        ]

    asyncio.run(run_case())


def test_windows_cmd_shim_resolves_to_packaged_native_executable():
    if os.name != "nt":
        return

    tmp_path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    tmp_path.mkdir(parents=True)
    shim = tmp_path / "codex.cmd"
    native = (
        tmp_path
        / "node_modules"
        / "@openai"
        / "codex"
        / "node_modules"
        / "@openai"
        / "codex-win32-x64"
        / "vendor"
        / "x86_64-pc-windows-msvc"
        / "bin"
        / "codex.exe"
    )
    native.parent.mkdir(parents=True)
    shim.write_text("@ECHO off\n", encoding="utf-8")
    native.write_text("", encoding="utf-8")
    client = CodexAppServerClient(codex_bin=str(shim), codex_home=tmp_path / "codex-home")

    assert client._app_server_command() == [str(native), "app-server", "--listen", "stdio://"]


def test_env_whitelist_excludes_project_secrets():
    client = CodexAppServerClient(codex_bin="codex", codex_home=Path("D:/codex-home"))
    env = client.build_env(
        {
            "PATH": "D:/bin",
            "HOME": "C:/Users/test",
            "SystemRoot": "C:/Windows",
            "WINDIR": "C:/Windows",
            "COMSPEC": "C:/Windows/System32/cmd.exe",
            "PATHEXT": ".COM;.EXE;.BAT;.CMD",
            "TEMP": "C:/Temp",
            "TMP": "C:/Tmp",
            "USERPROFILE": "C:/Users/test",
            "APPDATA": "C:/Users/test/AppData/Roaming",
            "LOCALAPPDATA": "C:/Users/test/AppData/Local",
            "PROGRAMDATA": "C:/ProgramData",
            "OPENCLAW_TOKEN": "secret",
            "OPENAI_API_KEY": "secret",
            "TTS_SERVICE_BASE_URL": "http://voice.local",
            "DATABASE_URL": "sqlite:///secret.db",
        },
        codex_home=Path("D:/codex-home"),
    )

    resolved_home = str(Path("D:/codex-home"))
    assert env == {
        "PATH": "D:/bin",
        "HOME": resolved_home,
        "CODEX_HOME": resolved_home,
        "NO_COLOR": "1",
        "APPDATA": "C:/Users/test/AppData/Roaming",
        "COMSPEC": "C:/Windows/System32/cmd.exe",
        "LOCALAPPDATA": "C:/Users/test/AppData/Local",
        "PATHEXT": ".COM;.EXE;.BAT;.CMD",
        "PROGRAMDATA": "C:/ProgramData",
        "SystemRoot": "C:/Windows",
        "TEMP": "C:/Temp",
        "TMP": "C:/Tmp",
        "USERPROFILE": "C:/Users/test",
        "WINDIR": "C:/Windows",
    }


def test_wsl_bridge_command_uses_wsl_exe():
    client = CodexAppServerClient(
        codex_bin="codex",
        codex_home=Path("/home/ksg/.codex"),
        wsl_enabled=True,
        wsl_exec="wsl.exe",
    )
    cmd = client._app_server_command()
    assert cmd[0].endswith("wsl.exe") or cmd[0] == "wsl.exe"
    assert cmd[1:4] == ["--", "bash", "-lc"]
    assert cmd[4] == "codex app-server --listen stdio://"


def test_wsl_bridge_env_excludes_windows_keys():
    client = CodexAppServerClient(
        codex_bin="codex",
        codex_home=Path("/home/ksg/.codex"),
        wsl_enabled=True,
    )
    env = client.build_env(
        {
            "PATH": "/usr/bin:/bin",
            "SystemRoot": "C:/Windows",
            "WINDIR": "C:/Windows",
            "OPENCLAW_TOKEN": "secret",
        },
        codex_home=Path("/home/ksg/.codex"),
    )
    # In WSL mode, the raw path string is used directly (not Path-resolved)
    assert env["HOME"] == "/home/ksg/.codex"
    assert env["CODEX_HOME"] == "/home/ksg/.codex"
    assert env["NO_COLOR"] == "1"
    assert env["SystemRoot"] == "C:/Windows"
    assert "WINDIR" not in env
    assert "OPENCLAW_TOKEN" not in env


def test_wsl_runtime_path_converts_windows_workspace_paths():
    client = CodexAppServerClient(
        codex_bin="codex",
        codex_home=Path("/home/ksg/.codex"),
        wsl_enabled=True,
    )

    assert client._runtime_path(Path(r"D:\workspace\MMD project")) == "/mnt/d/workspace/MMD project"
    assert client._runtime_path("/mnt/d/workspace/MMD project") == "/mnt/d/workspace/MMD project"


def test_wsl_start_turn_converts_cwd_and_writable_roots():
    async def run_case():
        client, writer = _client_with_writer()
        client.wsl_enabled = True
        task = asyncio.create_task(
            client.start_turn(
                thread_id="thread-1",
                user_message="inspect",
                cwd=Path(r"D:\workspace\MMD project"),
                sandbox_policy={
                    "type": "workspaceWrite",
                    "writableRoots": [r"D:\workspace\MMD project"],
                    "networkAccess": False,
                },
            )
        )
        await asyncio.sleep(0)

        assert writer.lines[-1]["params"]["cwd"] == "/mnt/d/workspace/MMD project"
        assert writer.lines[-1]["params"]["sandboxPolicy"]["writableRoots"] == [
            "/mnt/d/workspace/MMD project"
        ]
        await client.handle_message_for_tests(
            {"id": "codex_req_1", "result": {"turn": {"id": "turn-1"}}}
        )
        assert await task == {"turn": {"id": "turn-1"}}

    asyncio.run(run_case())
