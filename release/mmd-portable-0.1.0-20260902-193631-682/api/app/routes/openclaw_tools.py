from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Path, Request

from app.routes.codex_interactive import (
    CodexApprovalDecisionRequest,
    CodexSessionCreateRequest,
    _decide_codex_approval,
    create_codex_interactive_session,
)
from app.security import resolve_requester


router = APIRouter(prefix="/openclaw/tools", tags=["openclaw-tools"])
_PREVIEW_LIMIT = 240


def _require_openclaw_codex_user(request: Request, x_user_id: str | None):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin:
        raise HTTPException(status_code=403, detail="Admin permission required")
    if settings.codex_allowed_users and requester.user_id not in settings.codex_allowed_users:
        raise HTTPException(status_code=403, detail="Codex interactive user is not allowlisted")
    if not settings.codex_interactive_enabled:
        raise HTTPException(status_code=404, detail="Codex interactive is disabled")
    return requester


def _bounded_text(value: Any, *, limit: int = _PREVIEW_LIMIT) -> str | None:
    text = " ".join(str(value or "").split())
    if not text:
        return None
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."


def _event_preview(event: dict[str, Any]) -> str | None:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    for key in ("text", "final_text", "error", "output", "stdout", "stderr"):
        preview = _bounded_text(payload.get(key))
        if preview:
            return preview
    return None


def _last_output_preview(events: list[dict[str, Any]]) -> str | None:
    for event in reversed(events):
        preview = _event_preview(event)
        if preview:
            return preview
    return None


def _approval_ref(approval: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": approval["id"],
        "action_type": approval["action_type"],
        "title": _bounded_text(approval.get("title"), limit=160) or "Approval required",
        "created_at": approval["created_at"],
    }


def _artifact_ref(artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": artifact["id"],
        "kind": artifact["kind"],
        "summary": _bounded_text(artifact.get("summary")),
        "content_ref": artifact.get("content_ref"),
        "created_at": artifact["created_at"],
    }


@router.post("/codex/sessions")
async def create_openclaw_codex_session(
    payload: CodexSessionCreateRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    requester = _require_openclaw_codex_user(request, x_user_id)
    created = await create_codex_interactive_session(payload, request, x_user_id=requester.user_id)
    return {
        "session_id": created["id"],
        "workspace_id": created["workspace_id"],
        "status": created["status"],
        "sandbox": created["sandbox"],
        "worktree_path": created.get("worktree_path"),
        "branch_name": created.get("branch_name"),
    }


@router.get("/codex/sessions/{session_id}/status")
async def get_openclaw_codex_session_status(
    request: Request,
    session_id: str = Path(..., min_length=1, max_length=160),
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_openclaw_codex_user(request, x_user_id)
    store = request.app.state.trace_store
    session = store.get_codex_interactive_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Codex session not found")
    events = store.list_codex_events(session_id)
    approvals = store.list_pending_codex_approvals(session_id)
    artifacts = store.list_codex_artifacts(session_id)
    return {
        "session_id": session["id"],
        "workspace_id": session["workspace_id"],
        "status": session["status"],
        "sandbox": session["sandbox_mode"],
        "mode": (session.get("metadata") or {}).get("mode"),
        "codex_thread_id": session.get("codex_thread_id"),
        "codex_version": session.get("codex_version"),
        "last_active_at": session.get("last_active_at"),
        "last_output_preview": _last_output_preview(events),
        "pending_approvals": [_approval_ref(item) for item in approvals[:5]],
        "latest_artifacts": [_artifact_ref(item) for item in artifacts[:5]],
        "recent_events": [
            {
                "event_type": item["event_type"],
                "sequence": item["sequence"],
                "created_at": item["created_at"],
            }
            for item in events[-5:]
        ],
    }


@router.post("/codex/approvals/{approval_id}/decision")
async def decide_openclaw_codex_approval(
    payload: CodexApprovalDecisionRequest,
    request: Request,
    approval_id: str = Path(..., min_length=1, max_length=160),
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    requester = _require_openclaw_codex_user(request, x_user_id)
    approval = request.app.state.trace_store.get_codex_approval(approval_id)
    if approval is None:
        raise HTTPException(status_code=404, detail="Codex approval not found")
    return await _decide_codex_approval(
        request,
        codex_session_id=approval["codex_session_id"],
        approval_id=approval_id,
        decision=payload.decision.strip(),
        user_id=requester.user_id,
    )
