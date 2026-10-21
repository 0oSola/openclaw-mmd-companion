from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from dataclasses import dataclass
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
from typing import Any

from app.codex_schema.methods import (
    CLIENT_NOTIFICATION_METHODS,
    CLIENT_REQUEST_METHODS,
    COMMAND_APPROVAL_REQUEST_METHODS,
    FILE_CHANGE_APPROVAL_REQUEST_METHODS,
    NEW_APPROVAL_REQUEST_METHODS,
)
from app.services.codex_event_normalizer import normalize_codex_server_event


class CodexAppServerError(RuntimeError):
    pass


_CODEX_APP_SERVER_SAFE_ENV_KEYS = (
    "APPDATA",
    "COMSPEC",
    "LOCALAPPDATA",
    "PATHEXT",
    "PROGRAMDATA",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
)


@dataclass(slots=True)
class _PendingApproval:
    request_id: str
    method: str
    approval_id: str


class CodexAppServerClient:
    def __init__(
        self,
        *,
        codex_bin: str,
        codex_home: Path,
        request_timeout_seconds: int = 30,
        process_start_timeout_seconds: int = 30,
        wsl_enabled: bool = False,
        wsl_exec: str = "wsl.exe",
    ):
        self.codex_bin = codex_bin
        self.codex_home = Path(codex_home)
        self.request_timeout_seconds = request_timeout_seconds
        self.process_start_timeout_seconds = process_start_timeout_seconds
        self.wsl_enabled = wsl_enabled
        self.wsl_exec = wsl_exec
        self.process: asyncio.subprocess.Process | None = None
        self._writer: Any = None
        self._next_request_number = 1
        self._pending_requests: dict[str, asyncio.Future] = {}
        self._pending_approvals: dict[str, _PendingApproval] = {}
        self._events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._reader_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None
        self.user_agent: str | None = None
        self.thread_id: str | None = None

    def build_env(self, source_env: dict[str, str] | None = None, *, codex_home: Path) -> dict[str, str]:
        source = source_env or os.environ
        # In WSL bridge mode, codex_home is a WSL path (e.g. /home/ksg/.codex).
        # Windows Path() would corrupt it, so pass the raw string directly.
        home_value = (
            str(codex_home).replace("\\", "/")
            if self.wsl_enabled
            else str(Path(codex_home))
        )
        env = {
            "PATH": source.get("PATH", ""),
            "HOME": home_value,
            "CODEX_HOME": home_value,
            "NO_COLOR": "1",
        }
        if self.wsl_enabled:
            # `wsl.exe` itself still needs the Windows system root to start
            # reliably. Do not forward the rest of the Windows-only environment
            # into the Linux Codex process, but preserve this launcher setting.
            system_root = source.get("SystemRoot")
            if system_root:
                env["SystemRoot"] = system_root
            return env
        for key in _CODEX_APP_SERVER_SAFE_ENV_KEYS:
            value = source.get(key)
            if value:
                env[key] = value
        return env

    def attach_writer_for_tests(self, writer: Any) -> None:
        self._writer = writer

    async def handle_message_for_tests(self, message: dict[str, Any]) -> None:
        await self._handle_message(message)

    async def start(self) -> None:
        if not self.wsl_enabled:
            self.codex_home.mkdir(parents=True, exist_ok=True)
        command = self._app_server_command()
        try:
            self.process = await asyncio.wait_for(
                asyncio.create_subprocess_exec(
                    *command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=self.build_env(codex_home=self.codex_home),
                ),
                timeout=self.process_start_timeout_seconds,
            )
        except (OSError, asyncio.TimeoutError) as exc:
            raise CodexAppServerError(f"Failed to start Codex app-server: {exc}") from exc
        if self.process.stdin is None or self.process.stdout is None:
            raise CodexAppServerError("Codex app-server stdio pipes were not created")
        self._writer = self.process.stdin
        self._reader_task = asyncio.create_task(self._read_stdout_loop(self.process.stdout))
        if self.process.stderr is not None:
            self._stderr_task = asyncio.create_task(self._read_stderr_loop(self.process.stderr))

    async def initialize(self) -> dict[str, Any]:
        response = await self.request(
            CLIENT_REQUEST_METHODS.INITIALIZE,
            {
                "clientInfo": {
                    "name": "mmd-companion",
                    "title": "MMD Companion",
                    "version": "0.1.0",
                },
                "capabilities": {
                    "experimentalApi": True,
                    "requestAttestation": False,
                    "optOutNotificationMethods": [],
                },
            },
        )
        self.user_agent = str(response.get("userAgent") or "")
        await self.notify(CLIENT_NOTIFICATION_METHODS.INITIALIZED)
        return response

    async def start_thread(self, *, cwd: Path, sandbox: str, approval_policy: str = "on-request") -> dict[str, Any]:
        response = await self.request(
            CLIENT_REQUEST_METHODS.THREAD_START,
            {
                "cwd": self._runtime_path(cwd),
                "approvalPolicy": approval_policy,
                "approvalsReviewer": "user",
                "sandbox": sandbox,
                "ephemeral": True,
                "serviceName": "mmd-companion",
                "threadSource": "user",
            },
        )
        thread = response.get("thread") if isinstance(response.get("thread"), dict) else {}
        self.thread_id = str(thread.get("id") or "")
        return response

    async def start_turn(self, *, thread_id: str, user_message: str, cwd: Path, sandbox_policy: dict[str, Any]) -> dict[str, Any]:
        runtime_sandbox_policy = dict(sandbox_policy)
        writable_roots = runtime_sandbox_policy.get("writableRoots")
        if isinstance(writable_roots, list):
            runtime_sandbox_policy["writableRoots"] = [
                self._runtime_path(root) if isinstance(root, (str, Path)) else root
                for root in writable_roots
            ]
        return await self.request(
            CLIENT_REQUEST_METHODS.TURN_START,
            {
                "threadId": thread_id,
                "input": [{"type": "text", "text": user_message, "text_elements": []}],
                "cwd": self._runtime_path(cwd),
                "approvalPolicy": "on-request",
                "approvalsReviewer": "user",
                "sandboxPolicy": runtime_sandbox_policy,
            },
        )

    async def interrupt_turn(self, *, thread_id: str, turn_id: str) -> dict[str, Any]:
        return await self.request(CLIENT_REQUEST_METHODS.TURN_INTERRUPT, {"threadId": thread_id, "turnId": turn_id})

    async def request(self, method: str, params: Any) -> Any:
        if self._writer is None:
            raise CodexAppServerError("Codex app-server is not started")
        request_id = f"codex_req_{self._next_request_number}"
        self._next_request_number += 1
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending_requests[request_id] = future
        await self._write_message({"id": request_id, "method": method, "params": params})
        try:
            return await asyncio.wait_for(future, timeout=self.request_timeout_seconds)
        except asyncio.TimeoutError as exc:
            self._pending_requests.pop(request_id, None)
            raise CodexAppServerError(f"Codex app-server request timed out: {method}") from exc

    async def notify(self, method: str, params: Any | None = None) -> None:
        message: dict[str, Any] = {"method": method}
        if params is not None:
            message["params"] = params
        await self._write_message(message)

    async def next_event(self) -> dict[str, Any]:
        return await self._events.get()

    async def events_until_turn_complete(
        self,
        *,
        codex_turn_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        while True:
            event = await self.next_event()
            if codex_turn_id:
                event_turn_id = str(event.get("turn_id") or "")
                if event_turn_id and event_turn_id != codex_turn_id:
                    continue
            yield event
            if event.get("type") in {"turn_completed", "turn_failed", "session_closed"}:
                return

    async def decide_approval(self, approval_id: str, decision: str) -> None:
        pending = self._pending_approvals.pop(approval_id, None)
        if pending is None:
            raise CodexAppServerError(f"Unknown Codex approval id: {approval_id}")
        await self._write_message(
            {
                "id": pending.request_id,
                "result": {"decision": self._approval_decision_for_method(pending.method, decision)},
            }
        )

    async def close(self) -> None:
        for task in (self._reader_task, self._stderr_task):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        if self._writer is not None:
            try:
                self._writer.close()
                wait_closed = getattr(self._writer, "wait_closed", None)
                if wait_closed is not None:
                    await wait_closed()
            except Exception:
                pass
        if self.process is not None and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()

    async def _read_stdout_loop(self, stdout: asyncio.StreamReader) -> None:
        try:
            while True:
                line = await stdout.readline()
                if not line:
                    break
                try:
                    message = json.loads(line.decode("utf-8"))
                except json.JSONDecodeError:
                    await self._events.put({"type": "raw_codex_event", "raw_method": "invalid_json", "payload": {}})
                    continue
                if isinstance(message, dict):
                    await self._handle_message(message)
        finally:
            exit_code = self.process.returncode if self.process is not None else None
            error = CodexAppServerError("Codex app-server process closed before responding")
            self._fail_pending_requests(error)
            await self._events.put({"type": "session_closed", "reason": "process_stdout_closed", "exit_code": exit_code})

    async def _read_stderr_loop(self, stderr: asyncio.StreamReader) -> None:
        while True:
            line = await stderr.readline()
            if not line:
                return

    async def _handle_message(self, message: dict[str, Any]) -> None:
        request_id = message.get("id")
        method = str(message.get("method") or "")
        if request_id is not None and not method:
            future = self._pending_requests.pop(str(request_id), None)
            if future is None:
                return
            if "error" in message:
                error = message.get("error")
                if isinstance(error, dict):
                    detail = str(error.get("message") or error)
                else:
                    detail = str(error)
                if not future.done():
                    future.set_exception(CodexAppServerError(detail))
                return
            if not future.done():
                future.set_result(message.get("result"))
            return

        if request_id is not None and method:
            await self._handle_server_request(str(request_id), method, message.get("params") or {})
            return

        if method:
            await self._events.put(normalize_codex_server_event(message))

    async def _handle_server_request(self, request_id: str, method: str, params: Any) -> None:
        if not isinstance(params, dict):
            await self._write_error(request_id, "Unsupported Codex app-server request")
            return

        if method in COMMAND_APPROVAL_REQUEST_METHODS:
            approval_id = str(params.get("approvalId") or request_id)
            command = params.get("command")
            if isinstance(command, list):
                command_text = " ".join(str(part) for part in command)
            else:
                command_text = str(command or "")
            turn_id = str(params.get("turnId") or "")
            self._pending_approvals[approval_id] = _PendingApproval(request_id, method, approval_id)
            await self._events.put(
                {
                    "type": "approval_required",
                    "turn_id": turn_id,
                    "approval_id": approval_id,
                    "action_type": "command",
                    "title": "Run command",
                    "detail": {
                        "command": command_text,
                        "cwd": str(params.get("cwd") or ""),
                        "reason": params.get("reason"),
                        "raw_method": method,
                    },
                }
            )
            return

        if method in FILE_CHANGE_APPROVAL_REQUEST_METHODS:
            approval_id = request_id
            turn_id = str(params.get("turnId") or "")
            self._pending_approvals[approval_id] = _PendingApproval(request_id, method, approval_id)
            await self._events.put(
                {
                    "type": "approval_required",
                    "turn_id": turn_id,
                    "approval_id": approval_id,
                    "action_type": "file_change",
                    "title": "Apply file changes",
                    "detail": {"reason": params.get("reason"), "grant_root": params.get("grantRoot"), "raw_method": method},
                }
            )
            return

        await self._write_error(request_id, "Unsupported Codex app-server request")

    def _approval_decision_for_method(self, method: str, decision: str) -> str:
        approved = decision == "approve_once"
        if method in NEW_APPROVAL_REQUEST_METHODS:
            return "accept" if approved else "decline"
        return "approved" if approved else "denied"

    def _runtime_path(self, value: str | Path) -> str:
        raw = str(value)
        if not self.wsl_enabled:
            return str(Path(value))
        normalized = raw.replace("\\", "/")
        if len(normalized) >= 3 and normalized[1] == ":" and normalized[2] == "/":
            return f"/mnt/{normalized[0].lower()}/{normalized[3:]}"
        return normalized

    async def _write_error(self, request_id: str, message: str) -> None:
        await self._write_message({"id": request_id, "error": {"message": message}})

    async def _write_message(self, message: dict[str, Any]) -> None:
        if self._writer is None:
            raise CodexAppServerError("Codex app-server is not started")
        self._writer.write((json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
        drain = getattr(self._writer, "drain", None)
        if drain is not None:
            await drain()

    def _app_server_command(self) -> list[str]:
        if self.wsl_enabled:
            return self._wsl_command()
        resolved = shutil.which(self.codex_bin) or self.codex_bin
        if os.name == "nt" and Path(resolved).suffix.lower() in {".bat", ".cmd"}:
            native_codex = self._windows_native_codex_from_shim(Path(resolved))
            if native_codex is not None:
                return [str(native_codex), "app-server", "--listen", "stdio://"]
            comspec = os.environ.get("ComSpec") or str(Path(os.environ.get("SystemRoot", "C:\\Windows")) / "System32" / "cmd.exe")
            command_line = subprocess.list2cmdline([resolved, "app-server", "--listen", "stdio://"])
            return [comspec, "/d", "/s", "/c", command_line]
        return [resolved, "app-server", "--listen", "stdio://"]

    def _wsl_command(self) -> list[str]:
        wsl_exec = shutil.which(self.wsl_exec) or self.wsl_exec
        codex_bin = self.codex_bin
        # Quote codex_bin for shell safety if it contains spaces or special chars
        if not codex_bin.isidentifier() and " " in codex_bin:
            codex_bin = shlex.quote(codex_bin)
        inner = f"{codex_bin} app-server --listen stdio://"
        return [wsl_exec, "--", "bash", "-lc", inner]

    def _windows_native_codex_from_shim(self, shim_path: Path) -> Path | None:
        package_root = shim_path.parent / "node_modules" / "@openai" / "codex"
        package_scope = package_root / "node_modules" / "@openai"
        if not package_scope.exists():
            return None
        for package in package_scope.glob("codex-win32-*"):
            for candidate in package.glob("vendor/**/codex.exe"):
                if candidate.is_file():
                    return candidate
        return None

    def _fail_pending_requests(self, error: Exception) -> None:
        pending = list(self._pending_requests.values())
        self._pending_requests.clear()
        for future in pending:
            if not future.done():
                future.set_exception(error)
