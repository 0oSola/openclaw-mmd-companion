from __future__ import annotations

import asyncio
import contextlib
import inspect
from pathlib import Path
import re
import subprocess
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request, WebSocket
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketDisconnect

from app.services.codex_event_normalizer import normalize_codex_server_event
from app.services.codex_app_server_client import CodexAppServerError
from app.services.codex_worktree_manager import CodexWorktreeError


router = APIRouter(tags=["codex-interactive"])
_WORKSPACE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$")
_SECRET_KEY_RE = re.compile(r"(authorization|credential|password|secret|token|api[_-]?key)", re.IGNORECASE)
_SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|CREDENTIAL)[A-Z0-9_]*)=([^\s,;]+)"
)
_SECRET_TOKEN_RE = re.compile(r"\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b", re.IGNORECASE)
_SESSION_OUTPUT_PREVIEW_MAX_CHARS = 240


class CodexSessionCreateRequest(BaseModel):
    local_chat_session_id: str | None = Field(default=None, max_length=200)
    workspace_id: str = Field(min_length=1, max_length=120)
    mode: str = Field(default="read_only", max_length=40)
    sandbox: str | None = Field(default=None, max_length=80)


class CodexWorkspaceCreateRequest(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=120)
    path: str = Field(min_length=1, max_length=1000)


class CodexWorkspacePathPickRequest(BaseModel):
    initial_path: str | None = Field(default=None, max_length=1000)


class CodexApprovalDecisionRequest(BaseModel):
    decision: str = Field(max_length=40)


class CodexChecksRequest(BaseModel):
    checks: list[str] = Field(default_factory=lambda: ["api", "web_basic"])


class CodexApplyRequest(BaseModel):
    strategy: str = Field(default="patch_to_main_workspace", max_length=80)
    confirm: bool = False


class CodexDiscardRequest(BaseModel):
    remove_worktree: bool = True


def _bounded_session_output(value: object) -> str | None:
    text = " ".join(str(value or "").split())
    text = _SECRET_ASSIGNMENT_RE.sub(lambda match: f"{match.group(1)}=[redacted]", text)
    text = _SECRET_TOKEN_RE.sub("[redacted]", text)
    if not text:
        return None
    if len(text) <= _SESSION_OUTPUT_PREVIEW_MAX_CHARS:
        return text
    return f"{text[:_SESSION_OUTPUT_PREVIEW_MAX_CHARS]}..."


def _last_session_output_preview(request: Request, session_id: str) -> str | None:
    events = request.app.state.trace_store.list_recent_codex_events(session_id, limit=20)
    for event in reversed(events):
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        for key in ("text", "final_text", "error", "output", "stdout", "stderr"):
            preview = _bounded_session_output(payload.get(key))
            if preview:
                return preview
    return None


def _bounded_session_metadata(value: object) -> dict[str, str]:
    metadata = value if isinstance(value, dict) else {}
    output: dict[str, str] = {}
    for key in ("mode", "transport", "sandbox"):
        candidate = _bounded_session_output(metadata.get(key))
        if candidate:
            output[key] = candidate
    return output


def _not_found_if_disabled(request: Request | WebSocket) -> None:
    if not request.app.state.settings.codex_interactive_enabled:
        raise HTTPException(status_code=404, detail="Codex interactive is disabled")


def _require_codex_user(request: Request | WebSocket, user_id: str) -> str:
    resolved_user_id = user_id.strip()
    settings = request.app.state.settings
    if not resolved_user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    if resolved_user_id not in settings.admin_user_ids:
        raise HTTPException(status_code=403, detail="Admin permission required")
    if not settings.codex_allowed_users or resolved_user_id not in settings.codex_allowed_users:
        raise HTTPException(status_code=403, detail="Codex interactive user is not allowlisted")
    return resolved_user_id


def _normalize_workspace_id(workspace_id: str) -> str:
    resolved = workspace_id.strip()
    if not _WORKSPACE_ID_RE.match(resolved):
        raise HTTPException(status_code=400, detail="Codex workspace id must be a slug")
    return resolved


def _require_git_workspace(path: Path) -> Path:
    expanded = path.expanduser()
    if not expanded.is_absolute():
        raise HTTPException(status_code=400, detail="Codex workspace path must be absolute")
    if any(part == ".." for part in expanded.parts):
        raise HTTPException(status_code=400, detail="Codex workspace path must not contain traversal segments")
    resolved = expanded.resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=400, detail="Codex workspace path must be an existing directory")
    try:
        completed = subprocess.run(
            ["git", "-C", str(resolved), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail="git is required to register Codex workspaces") from exc
    if completed.returncode != 0:
        raise HTTPException(status_code=400, detail="Codex workspace path must be a git repository")
    git_root = completed.stdout.strip()
    if not git_root:
        raise HTTPException(status_code=400, detail="Codex workspace git root could not be resolved")
    workspace_root = Path(git_root).resolve()
    if workspace_root != resolved:
        raise HTTPException(status_code=400, detail="Codex workspace path must be a git repository root")
    return workspace_root


def _default_codex_workspace_path_picker(initial_path: str | None = None) -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:  # pragma: no cover - depends on local desktop Python install.
        raise RuntimeError("Local directory picker is unavailable") from exc

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    options: dict[str, str] = {"title": "Select Codex workspace repository"}
    if initial_path:
        initial_dir = Path(initial_path).expanduser()
        if initial_dir.exists() and initial_dir.is_dir():
            options["initialdir"] = str(initial_dir.resolve())
    try:
        selected = filedialog.askdirectory(**options)
        return selected or None
    finally:
        root.destroy()


async def _pick_codex_workspace_path(request: Request, initial_path: str | None) -> Path | None:
    picker = getattr(request.app.state, "codex_workspace_path_picker", None)
    try:
        if picker is None:
            selected = await asyncio.to_thread(_default_codex_workspace_path_picker, initial_path)
        else:
            selected = picker(initial_path=initial_path)
            if inspect.isawaitable(selected):
                selected = await selected
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not selected:
        return None
    resolved = Path(str(selected)).expanduser().resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=400, detail="Selected Codex workspace path must be an existing directory")
    return resolved


def _configured_workspace_items(request: Request | WebSocket) -> list[dict[str, str]]:
    settings = request.app.state.settings
    items: list[dict[str, str]] = []
    for workspace_id in settings.codex_allowed_workspaces:
        path = settings.codex_workspace_paths.get(workspace_id)
        if path is None:
            continue
        items.append({"id": workspace_id, "path": str(path.resolve()), "source": "env"})
    return items


def _codex_workspace_items(request: Request | WebSocket) -> list[dict[str, str]]:
    items = _configured_workspace_items(request)
    seen = {item["id"] for item in items}
    for workspace in request.app.state.trace_store.list_codex_workspaces():
        workspace_id = str(workspace["id"])
        if workspace_id in seen:
            continue
        items.append(
            {
                "id": workspace_id,
                "path": str(Path(str(workspace["path"])).resolve()),
                "source": str(workspace.get("source") or "ui"),
            }
        )
        seen.add(workspace_id)
    return items


def _workspace_path(request: Request | WebSocket, workspace_id: str) -> Path:
    workspace_id = _normalize_workspace_id(workspace_id)
    settings = request.app.state.settings
    if workspace_id in settings.codex_allowed_workspaces:
        path = settings.codex_workspace_paths.get(workspace_id)
        if path is None:
            raise HTTPException(status_code=400, detail="Codex workspace path is not configured")
        resolved = path.resolve()
        return _require_git_workspace(resolved) if settings.codex_require_git_repo else resolved

    workspace = request.app.state.trace_store.get_codex_workspace(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=403, detail="Codex workspace is not allowlisted")
    return _require_git_workspace(Path(str(workspace["path"])))


@router.get("/codex/workspaces")
async def list_codex_workspaces(
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    _require_codex_user(request, x_user_id or "")
    return {"workspaces": _codex_workspace_items(request)}


@router.post("/codex/workspaces")
async def create_codex_workspace(
    payload: CodexWorkspaceCreateRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    workspace_id = _normalize_workspace_id(payload.workspace_id)
    if workspace_id in request.app.state.settings.codex_allowed_workspaces:
        raise HTTPException(status_code=409, detail="Codex workspace is already configured by environment")
    workspace_path = _require_git_workspace(Path(payload.path))
    workspace = request.app.state.trace_store.upsert_codex_workspace(
        workspace_id=workspace_id,
        path=str(workspace_path),
        source="ui",
        created_by=user_id,
    )
    return {
        "workspace": {
            "id": workspace["id"],
            "path": workspace["path"],
            "source": workspace["source"],
        }
    }


@router.post("/codex/workspaces/path-picker")
async def pick_codex_workspace_path(
    payload: CodexWorkspacePathPickRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    _require_codex_user(request, x_user_id or "")
    selected = await _pick_codex_workspace_path(request, payload.initial_path)
    return {"path": str(selected) if selected else None}


def _require_session(request: Request, session_id: str, user_id: str) -> dict[str, Any]:
    session = request.app.state.trace_store.get_codex_interactive_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Codex session not found")
    if session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Codex session belongs to another user")
    return session


def _pending_approvals(request: Request, session_id: str) -> list[dict[str, Any]]:
    return request.app.state.trace_store.list_pending_codex_approvals(session_id)


def _block_pending_approvals(request: Request, session_id: str) -> None:
    if _pending_approvals(request, session_id):
        raise HTTPException(status_code=409, detail="Codex session has unresolved approvals")


def _event_type(event: dict[str, Any]) -> str:
    return str(event.get("type") or "unknown")


def _redact_codex_trace_payload(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if _SECRET_KEY_RE.search(str(key)):
                redacted[key] = "[REDACTED]" if item is not None else None
            else:
                redacted[key] = _redact_codex_trace_payload(item)
        return redacted
    if isinstance(value, list):
        return [_redact_codex_trace_payload(item) for item in value]
    if isinstance(value, str):
        return _SECRET_ASSIGNMENT_RE.sub(lambda match: f"{match.group(1)}=[REDACTED]", value)
    return value


def _codex_trace_stage(event: dict[str, Any]) -> tuple[str | None, str]:
    event_type = _event_type(event)
    if event_type == "session_ready":
        return "codex.session.ready", "ok"
    if event_type == "turn_started":
        return "codex.turn.start", "ok"
    if event_type == "turn_completed":
        return "codex.turn.completed", "ok"
    if event_type == "turn_failed":
        return "codex.turn.failed", "error"
    if event_type == "approval_required":
        return "codex.approval.required", "ok"
    if event_type == "approval_decided":
        return "codex.approval.decided", "ok"
    if event_type == "diff_ready":
        return "codex.diff.ready", "ok"
    if event_type == "checks_started":
        return "codex.checks.started", "ok"
    if event_type == "checks_completed":
        return "codex.checks.completed", "ok"
    if event_type == "apply_started":
        return "codex.apply.started", "ok"
    if event_type == "apply_completed":
        return "codex.apply.completed", "ok"
    if event_type == "apply_failed":
        return "codex.apply.failed", "error"
    if event_type == "process_exit":
        return "codex.process.exit", "error" if event.get("exit_code") else "ok"
    if event_type == "session_closed" and (
        str(event.get("reason") or "").startswith("process") or event.get("exit_code") is not None
    ):
        return "codex.process.exit", "error"
    if event_type in {
        "text_delta",
        "plan_delta",
        "command_started",
        "command_output",
        "file_changed",
        "turn_retrying",
        "raw_codex_event",
    }:
        return "codex.turn.event", "ok"
    return None, "ok"


def _insert_codex_trace(
    request: Request | WebSocket,
    session: dict[str, Any],
    *,
    stage: str,
    status: str,
    payload: dict[str, Any],
    error_code: str | None = None,
) -> None:
    settings = request.app.state.settings
    trace_payload = payload
    if settings.codex_trace_redact_secrets:
        trace_payload = _redact_codex_trace_payload(payload)
    request.app.state.trace_store.insert_event(
        trace_id=f"codex-{session['id']}",
        user_id=str(session["user_id"]),
        session_id=str(session["id"]),
        stage=stage,
        status=status,
        latency_ms=None,
        error_code=error_code,
        payload=trace_payload,
    )


def _insert_codex_trace_for_event(
    request: Request | WebSocket,
    session: dict[str, Any],
    event: dict[str, Any],
    *,
    turn_id: str | None = None,
) -> None:
    stage, status = _codex_trace_stage(event)
    if stage is None:
        return
    payload = {
        "codex_session_id": session["id"],
        "workspace_id": session["workspace_id"],
        "turn_id": turn_id or event.get("turn_id"),
        "event": event,
    }
    error_code = (str(event.get("error") or "") or None) if status == "error" else None
    _insert_codex_trace(request, session, stage=stage, status=status, error_code=error_code, payload=payload)


async def _close_idle_codex_sessions(request: Request) -> None:
    timeout_seconds = request.app.state.settings.codex_session_idle_timeout_seconds
    if timeout_seconds <= 0:
        return
    store = request.app.state.trace_store
    for idle_session in store.list_idle_codex_sessions(timeout_seconds):
        await request.app.state.codex_interactive_provider.close_session(idle_session["id"])
        error = f"Codex session idle timeout after {timeout_seconds} seconds."
        store.update_codex_interactive_session(idle_session["id"], status="closed", closed=True, error=error)
        event = {"type": "session_closed", "reason": "idle_timeout", "idle_timeout_seconds": timeout_seconds}
        store.append_codex_event(idle_session["id"], None, "session_closed", event)
        _insert_codex_trace(request, idle_session, stage="codex.session.failed", status="error", payload={**event, "error": error})


async def _enforce_codex_session_capacity(request: Request) -> None:
    await _close_idle_codex_sessions(request)
    maximum = max(1, int(request.app.state.settings.codex_max_concurrent_sessions))
    active = request.app.state.trace_store.count_active_codex_sessions()
    if active >= maximum:
        raise HTTPException(status_code=429, detail=f"Codex maximum concurrent sessions reached ({maximum})")


async def _decide_codex_approval(
    request: Request | WebSocket,
    *,
    codex_session_id: str,
    approval_id: str,
    decision: str,
    user_id: str,
) -> dict[str, Any]:
    if decision not in {"approve_once", "deny"}:
        raise HTTPException(status_code=400, detail="Unsupported Codex approval decision")
    store = request.app.state.trace_store
    approval = store.get_codex_approval(approval_id)
    if approval is None or approval["codex_session_id"] != codex_session_id:
        raise HTTPException(status_code=404, detail="Codex approval not found")

    decided = store.decide_codex_approval(
        approval_id,
        decision=decision,
        decided_by=user_id,
    )
    await request.app.state.codex_interactive_provider.decide_approval(codex_session_id, approval_id, decision)
    event = {
        "type": "approval_decided",
        "approval_id": approval_id,
        "decision": decision,
        "decided_by": user_id,
    }
    store.append_codex_event(codex_session_id, approval.get("turn_id"), "approval_decided", event)
    if not store.list_pending_codex_approvals(codex_session_id):
        store.update_codex_interactive_session(codex_session_id, status="ready")
    session = store.get_codex_interactive_session(codex_session_id)
    if session:
        _insert_codex_trace_for_event(request, session, event, turn_id=approval.get("turn_id"))
    return decided or {}


async def _close_unauthorized(websocket: WebSocket) -> None:
    await websocket.close(code=1008)


@router.post("/codex/interactive/sessions")
async def create_codex_interactive_session(
    payload: CodexSessionCreateRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    await _enforce_codex_session_capacity(request)
    workspace_path = _workspace_path(request, payload.workspace_id)
    mode = (payload.mode or "read_only").strip()
    if mode not in {"read_only", "review", "test", "patch"}:
        raise HTTPException(status_code=400, detail="Unsupported Codex mode")

    if mode == "patch":
        sandbox = (payload.sandbox or request.app.state.settings.codex_patch_sandbox).strip() or "workspace-write"
        if sandbox != "workspace-write":
            raise HTTPException(status_code=400, detail="Patch mode requires workspace-write sandbox")
    else:
        sandbox = (payload.sandbox or request.app.state.settings.codex_default_sandbox).strip() or "read-only"
        if sandbox != "read-only":
            raise HTTPException(status_code=400, detail="Read-only Codex modes require read-only sandbox")

    session_id = f"codex_sess_{uuid4().hex}"
    worktree_path: str | None = None
    branch_name: str | None = None
    if mode == "patch":
        if not request.app.state.settings.codex_use_worktree:
            raise HTTPException(status_code=400, detail="Patch mode requires Codex worktrees")
        try:
            created = request.app.state.codex_worktree_manager.create_worktree(workspace_path, session_id)
        except CodexWorktreeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        worktree_path = str(created.worktree_path)
        branch_name = created.branch_name

    session = request.app.state.trace_store.create_codex_interactive_session(
        session_id=session_id,
        local_chat_session_id=payload.local_chat_session_id,
        workspace_id=payload.workspace_id,
        user_id=user_id,
        workspace_path=str(workspace_path),
        worktree_path=worktree_path,
        branch_name=branch_name,
        codex_thread_id=None,
        codex_version=None,
        transport=request.app.state.settings.codex_transport,
        sandbox_mode=sandbox,
        status="ready",
        process_id=None,
        metadata={"mode": mode},
    )
    _insert_codex_trace(
        request,
        session,
        stage="codex.session.create",
        status="ok",
        payload={
            "codex_session_id": session_id,
            "workspace_id": payload.workspace_id,
            "mode": mode,
            "sandbox": sandbox,
            "transport": request.app.state.settings.codex_transport,
        },
    )
    try:
        prepared = await request.app.state.codex_interactive_provider.prepare_session(session)
    except CodexAppServerError as exc:
        failed = request.app.state.trace_store.update_codex_interactive_session(session_id, status="failed", error=str(exc)) or session
        _insert_codex_trace(
            request,
            failed,
            stage="codex.session.failed",
            status="error",
            error_code=type(exc).__name__,
            payload={"codex_session_id": session_id, "workspace_id": payload.workspace_id, "error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if prepared:
        session = request.app.state.trace_store.update_codex_interactive_session(
            session_id,
            codex_thread_id=prepared.get("codex_thread_id"),
            codex_version=prepared.get("codex_version"),
            process_id=prepared.get("process_id"),
        ) or session
    _insert_codex_trace(
        request,
        session,
        stage="codex.session.ready",
        status="ok",
        payload={
            "codex_session_id": session["id"],
            "workspace_id": session["workspace_id"],
            "codex_thread_id": session.get("codex_thread_id"),
            "codex_version": session.get("codex_version"),
            "process_id": session.get("process_id"),
        },
    )
    return {
        "id": session["id"],
        "workspace_id": session["workspace_id"],
        "worktree_path": session.get("worktree_path"),
        "branch_name": session.get("branch_name"),
        "status": session["status"],
        "sandbox": session["sandbox_mode"],
        "ws_url": f"/api/backend/ws/codex/interactive/{session['id']}?user_id={user_id}",
    }


@router.get("/codex/interactive/sessions")
def list_codex_interactive_sessions(
    request: Request,
    limit: int = 50,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    bounded_limit = max(1, min(int(limit), 50))
    sessions = request.app.state.trace_store.list_codex_interactive_sessions(
        user_id=user_id,
        limit=bounded_limit,
    )
    return {
        "sessions": [
            {
                "id": session["id"],
                "workspace_id": session["workspace_id"],
                "workspace_path": session["workspace_path"],
                "worktree_path": session.get("worktree_path"),
                "branch_name": session.get("branch_name"),
                "codex_thread_id": session.get("codex_thread_id"),
                "codex_version": session.get("codex_version"),
                "transport": session["transport"],
                "sandbox": session["sandbox_mode"],
                "status": session["status"],
                "process_id": session.get("process_id"),
                "created_at": session["created_at"],
                "last_active_at": session["last_active_at"],
                "closed_at": session.get("closed_at"),
                "error": _bounded_session_output(session.get("error")),
                "last_output_preview": _last_session_output_preview(request, session["id"]),
                "metadata": _bounded_session_metadata(session.get("metadata")),
            }
            for session in sessions
        ],
        "limit": bounded_limit,
    }


@router.get("/codex/interactive/{codex_session_id}/diff")
async def get_codex_interactive_diff(
    codex_session_id: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    session = _require_session(request, codex_session_id, user_id)
    if not session.get("worktree_path"):
        raise HTTPException(status_code=400, detail="Codex session has no worktree diff")

    try:
        diff = request.app.state.codex_worktree_manager.diff(Path(session["worktree_path"]))
    except CodexWorktreeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    artifact_id = f"codex_artifact_{uuid4().hex}"
    artifact = request.app.state.trace_store.create_codex_artifact(
        artifact_id=artifact_id,
        codex_session_id=codex_session_id,
        turn_id=None,
        kind="diff",
        path=None,
        content_ref=None,
        summary=diff.stat,
        metadata={"changed_files": diff.changed_files},
    )
    event = {
        "type": "diff_ready",
        "artifact_id": artifact["id"],
        "changed_files": diff.changed_files,
    }
    request.app.state.trace_store.append_codex_event(codex_session_id, None, "diff_ready", event)
    _insert_codex_trace_for_event(request, session, event)
    return {
        "session_id": codex_session_id,
        "base_workspace": session["workspace_path"],
        "worktree_path": session["worktree_path"],
        "changed_files": diff.changed_files,
        "stat": diff.stat,
        "patch": diff.patch,
        "artifact_id": artifact["id"],
    }


@router.post("/codex/interactive/{codex_session_id}/approvals/{approval_id}")
async def decide_codex_interactive_approval(
    codex_session_id: str,
    approval_id: str,
    payload: CodexApprovalDecisionRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    _require_session(request, codex_session_id, user_id)
    decision = payload.decision.strip()
    try:
        return await _decide_codex_approval(
            request,
            codex_session_id=codex_session_id,
            approval_id=approval_id,
            decision=decision,
            user_id=user_id,
        )
    except CodexAppServerError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/codex/interactive/{codex_session_id}/checks")
async def run_codex_interactive_checks(
    codex_session_id: str,
    payload: CodexChecksRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    session = _require_session(request, codex_session_id, user_id)
    _block_pending_approvals(request, codex_session_id)
    worktree_path = Path(session.get("worktree_path") or session["workspace_path"])
    requested_checks = payload.checks or ["api", "web_basic"]
    commands_by_check: dict[str, list[list[str]]] = getattr(request.app.state, "codex_check_commands", {})

    request.app.state.trace_store.append_codex_event(
        codex_session_id,
        None,
        "checks_started",
        {"type": "checks_started", "checks": requested_checks},
    )
    _insert_codex_trace_for_event(
        request,
        session,
        {"type": "checks_started", "checks": requested_checks},
    )
    results: list[dict[str, Any]] = []
    for check_name in requested_checks:
        commands = commands_by_check.get(check_name)
        if not commands:
            raise HTTPException(status_code=400, detail=f"Unknown Codex check: {check_name}")
        for command in commands:
            completed = subprocess.run(
                command,
                cwd=worktree_path,
                capture_output=True,
                text=True,
            )
            results.append(
                {
                    "check": check_name,
                    "command": command,
                    "exit_code": completed.returncode,
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                }
            )

    artifact = request.app.state.trace_store.create_codex_artifact(
        artifact_id=f"codex_artifact_{uuid4().hex}",
        codex_session_id=codex_session_id,
        turn_id=None,
        kind="checks",
        path=None,
        content_ref=None,
        summary=f"{len(results)} command(s) completed",
        metadata={"results": results},
    )
    event = {"type": "checks_completed", "artifact_id": artifact["id"], "results": results}
    request.app.state.trace_store.append_codex_event(codex_session_id, None, "checks_completed", event)
    _insert_codex_trace_for_event(request, session, event)
    return {"session_id": codex_session_id, "artifact_id": artifact["id"], "results": results}


@router.post("/codex/interactive/{codex_session_id}/apply")
async def apply_codex_interactive_session(
    codex_session_id: str,
    payload: CodexApplyRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    session = _require_session(request, codex_session_id, user_id)
    _block_pending_approvals(request, codex_session_id)
    if payload.strategy != "patch_to_main_workspace":
        raise HTTPException(status_code=400, detail="Unsupported Codex apply strategy")
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Codex apply requires explicit confirmation")
    if not session.get("worktree_path"):
        raise HTTPException(status_code=400, detail="Codex session has no worktree to apply")

    request.app.state.trace_store.append_codex_event(
        codex_session_id,
        None,
        "apply_started",
        {"type": "apply_started", "strategy": payload.strategy},
    )
    _insert_codex_trace_for_event(request, session, {"type": "apply_started", "strategy": payload.strategy})
    try:
        applied = request.app.state.codex_worktree_manager.apply_patch_to_workspace(
            Path(session["worktree_path"]),
            Path(session["workspace_path"]),
            confirm=True,
        )
    except CodexWorktreeError as exc:
        request.app.state.trace_store.append_codex_event(
            codex_session_id,
            None,
            "apply_failed",
            {"type": "apply_failed", "error": str(exc)},
        )
        _insert_codex_trace_for_event(request, session, {"type": "apply_failed", "error": str(exc)})
        status_code = 409 if "uncommitted changes" in str(exc) or "patch" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    artifact = request.app.state.trace_store.create_codex_artifact(
        artifact_id=f"codex_artifact_{uuid4().hex}",
        codex_session_id=codex_session_id,
        turn_id=None,
        kind="apply",
        path=None,
        content_ref=None,
        summary=f"Applied {len(applied.changed_files)} file(s)",
        metadata={"changed_files": applied.changed_files},
    )
    event = {
        "type": "apply_completed",
        "artifact_id": artifact["id"],
        "changed_files": applied.changed_files,
    }
    request.app.state.trace_store.append_codex_event(codex_session_id, None, "apply_completed", event)
    _insert_codex_trace_for_event(request, session, event)
    return {"session_id": codex_session_id, "artifact_id": artifact["id"], "applied": True, "changed_files": applied.changed_files}


@router.post("/codex/interactive/{codex_session_id}/discard")
async def discard_codex_interactive_session(
    codex_session_id: str,
    payload: CodexDiscardRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    session = _require_session(request, codex_session_id, user_id)
    if payload.remove_worktree and session.get("worktree_path"):
        try:
            request.app.state.codex_worktree_manager.discard_worktree(
                Path(session["workspace_path"]),
                Path(session["worktree_path"]),
            )
        except CodexWorktreeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    await request.app.state.codex_interactive_provider.close_session(codex_session_id)
    closed = request.app.state.trace_store.update_codex_interactive_session(codex_session_id, status="closed", closed=True)
    request.app.state.trace_store.append_codex_event(
        codex_session_id,
        None,
        "session_closed",
        {"type": "session_closed", "reason": "discarded"},
    )
    return {"session_id": codex_session_id, "status": closed["status"] if closed else "closed"}


@router.post("/codex/interactive/{codex_session_id}/cancel")
async def cancel_codex_interactive_session(
    codex_session_id: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    _require_session(request, codex_session_id, user_id)
    control = getattr(request.app.state, "codex_interactive_control", None)
    if control is None:
        return {
            "session_id": codex_session_id,
            "cancelled": False,
            "reason": "not-running",
            "message": "当前任务没有正在运行的回合",
        }
    return await control.cancel(codex_session_id)


@router.websocket("/ws/codex/interactive/{codex_session_id}")
async def codex_interactive_websocket(websocket: WebSocket, codex_session_id: str):
    try:
        _not_found_if_disabled(websocket)
        user_id = _require_codex_user(websocket, websocket.query_params.get("user_id") or "")
    except HTTPException:
        await _close_unauthorized(websocket)
        return

    store = websocket.app.state.trace_store
    session = store.get_codex_interactive_session(codex_session_id)
    if session is None or session["user_id"] != user_id:
        await _close_unauthorized(websocket)
        return

    await websocket.accept()
    active_task: asyncio.Task | None = None
    active_turn_id: str | None = None

    async def send_and_store(event: dict[str, Any], turn_id: str | None = None) -> None:
        normalized = normalize_codex_server_event(event)
        current_session = store.get_codex_interactive_session(codex_session_id) or session
        if normalized.get("type") == "approval_required" and normalized.get("approval_id"):
            approval_id = str(normalized["approval_id"])
            if store.get_codex_approval(approval_id) is None:
                store.create_codex_approval(
                    approval_id=approval_id,
                    codex_session_id=codex_session_id,
                    turn_id=turn_id or normalized.get("turn_id"),
                    external_approval_id=None,
                    action_type=str(normalized.get("action_type") or "unknown"),
                    title=str(normalized.get("title") or "Approval required"),
                    detail=normalized.get("detail") if isinstance(normalized.get("detail"), dict) else {},
                )
            store.update_codex_interactive_session(codex_session_id, status="waiting_approval")
        if normalized.get("type") in {"session_closed", "process_exit"}:
            reason = str(normalized.get("reason") or normalized.get("raw_method") or "process_exit")
            if reason.startswith("process") or normalized.get("exit_code") is not None or normalized.get("type") == "process_exit":
                store.update_codex_interactive_session(
                    codex_session_id,
                    status="failed",
                    error=f"Codex app-server process exited: {reason}",
                )
        store.append_codex_event(codex_session_id, turn_id, _event_type(normalized), normalized)
        _insert_codex_trace_for_event(websocket, current_session, normalized, turn_id=turn_id)
        await websocket.send_json(normalized)

    async def send_diff_ready(turn_id: str) -> None:
        current_session = store.get_codex_interactive_session(codex_session_id)
        if not current_session or not current_session.get("worktree_path"):
            return
        try:
            diff = websocket.app.state.codex_worktree_manager.diff(Path(current_session["worktree_path"]))
        except CodexWorktreeError as exc:
            await send_and_store({"type": "turn_failed", "turn_id": turn_id, "error": str(exc)}, turn_id)
            return
        artifact = store.create_codex_artifact(
            artifact_id=f"codex_artifact_{uuid4().hex}",
            codex_session_id=codex_session_id,
            turn_id=turn_id,
            kind="diff",
            path=None,
            content_ref=None,
            summary=diff.stat,
            metadata={"changed_files": diff.changed_files},
        )
        await send_and_store(
            {
                "type": "diff_ready",
                "turn_id": turn_id,
                "artifact_id": artifact["id"],
                "changed_files": diff.changed_files,
            },
            turn_id,
        )

    async def cancel_active_turn() -> dict[str, Any]:
        nonlocal active_turn_id
        turn_id = active_turn_id
        if not turn_id or (active_task is not None and active_task.done()):
            active_turn_id = None
            return {
                "session_id": codex_session_id,
                "cancelled": False,
                "reason": "not-running",
                "message": "当前任务没有正在运行的回合",
            }
        await websocket.app.state.codex_interactive_provider.cancel_turn(codex_session_id, turn_id)
        if active_task is not None and not active_task.done():
            active_task.cancel()
            await active_task
        elif active_turn_id:
            await send_and_store(
                {"type": "turn_failed", "turn_id": active_turn_id, "error": "Turn cancelled."},
                active_turn_id,
            )
        return {
            "session_id": codex_session_id,
            "cancelled": True,
            "turn_id": turn_id,
            "status": "cancelled",
        }

    async def run_turn(turn_id: str, user_message: str, mode: str) -> None:
        nonlocal active_turn_id
        try:
            current_session = store.get_codex_interactive_session(codex_session_id) or session
            async for event in websocket.app.state.codex_interactive_provider.stream_turn(
                session=current_session,
                turn_id=turn_id,
                user_message=user_message,
                mode=mode,
            ):
                await send_and_store(event, turn_id)
                if event.get("type") == "turn_started" and event.get("codex_turn_id"):
                    store.update_codex_turn(turn_id, status="running", codex_turn_id=str(event["codex_turn_id"]))
                elif event.get("type") == "turn_completed":
                    store.update_codex_turn(turn_id, status="completed", final_text=str(event.get("final_text") or ""))
                    store.update_codex_interactive_session(codex_session_id, status="ready")
                    if mode == "patch":
                        await send_diff_ready(turn_id)
                elif event.get("type") == "turn_failed":
                    store.update_codex_turn(turn_id, status="failed", error=str(event.get("error") or "Codex turn failed."))
                    store.update_codex_interactive_session(
                        codex_session_id,
                        status="failed",
                        error=str(event.get("error") or "Codex turn failed."),
                    )
                elif event.get("type") in {"session_closed", "process_exit"}:
                    error = f"Codex app-server process exited: {event.get('reason') or event.get('raw_method') or 'process_exit'}"
                    store.update_codex_turn(turn_id, status="failed", error=error)
                    store.update_codex_interactive_session(codex_session_id, status="failed", error=error)
        except asyncio.CancelledError:
            store.update_codex_turn(turn_id, status="cancelled", error="Turn cancelled.")
            store.update_codex_interactive_session(codex_session_id, status="ready")
            await send_and_store({"type": "turn_failed", "turn_id": turn_id, "error": "Turn cancelled."}, turn_id)
        except CodexAppServerError as exc:
            store.update_codex_turn(turn_id, status="failed", error=str(exc))
            store.update_codex_interactive_session(codex_session_id, status="failed", error=str(exc))
            await send_and_store({"type": "turn_failed", "turn_id": turn_id, "error": str(exc)}, turn_id)
        finally:
            if active_turn_id == turn_id:
                active_turn_id = None

    await send_and_store({"type": "session_ready", "session_id": codex_session_id, "thread_id": session.get("codex_thread_id")})
    control = getattr(websocket.app.state, "codex_interactive_control", None)
    if control is not None:
        await control.register(codex_session_id, cancel_active_turn)

    try:
        while True:
            payload = await websocket.receive_json()
            event_type = str(payload.get("type") or "").strip()
            if event_type == "close_session":
                if active_task and not active_task.done():
                    active_task.cancel()
                    await active_task
                await websocket.app.state.codex_interactive_provider.close_session(codex_session_id)
                store.update_codex_interactive_session(codex_session_id, status="closed", closed=True)
                await send_and_store({"type": "session_closed", "reason": "client_closed"})
                await websocket.close()
                return

            if event_type == "cancel_turn":
                await cancel_active_turn()
                continue

            if event_type == "approval_decision":
                approval_id = str(payload.get("approval_id") or "").strip()
                decision = str(payload.get("decision") or "").strip()
                if not approval_id:
                    await send_and_store({"type": "turn_failed", "error": "Codex approval_id is required."})
                    continue
                try:
                    decided = await _decide_codex_approval(
                        websocket,
                        codex_session_id=codex_session_id,
                        approval_id=approval_id,
                        decision=decision,
                        user_id=user_id,
                    )
                except HTTPException as exc:
                    await send_and_store({"type": "turn_failed", "error": str(exc.detail)})
                    continue
                except CodexAppServerError as exc:
                    await send_and_store({"type": "turn_failed", "error": str(exc)})
                    continue
                await websocket.send_json(
                    {
                        "type": "approval_decided",
                        "approval_id": approval_id,
                        "decision": decision,
                        "decided_by": decided.get("decided_by") or user_id,
                    }
                )
                continue

            if event_type != "user_message":
                await send_and_store({"type": "turn_failed", "error": "Unsupported Codex websocket event."})
                continue

            if active_task and not active_task.done():
                await send_and_store({"type": "turn_failed", "error": "A Codex turn is already running."})
                continue

            text = str(payload.get("text") or "").strip()
            if not text:
                await send_and_store({"type": "turn_failed", "error": "Codex message text is required."})
                continue
            if len(text) > websocket.app.state.settings.codex_max_prompt_chars:
                await send_and_store({"type": "turn_failed", "error": "Codex message is too long."})
                continue

            turn_id = f"codex_turn_{uuid4().hex}"
            active_turn_id = turn_id
            mode = str(payload.get("mode") or session.get("metadata", {}).get("mode") or "read_only")
            store.create_codex_turn(
                turn_id=turn_id,
                codex_session_id=codex_session_id,
                codex_turn_id=None,
                user_message=text,
                status="running",
                metadata={"mode": mode},
            )
            store.update_codex_interactive_session(codex_session_id, status="running")
            await send_and_store({"type": "turn_started", "turn_id": turn_id, "mode": mode}, turn_id)
            active_task = asyncio.create_task(run_turn(turn_id, text, mode))
    except WebSocketDisconnect:
        if active_task and not active_task.done():
            active_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await active_task
        await websocket.app.state.codex_interactive_provider.close_session(codex_session_id)
    finally:
        if control is not None:
            await control.unregister(codex_session_id, cancel_active_turn)
