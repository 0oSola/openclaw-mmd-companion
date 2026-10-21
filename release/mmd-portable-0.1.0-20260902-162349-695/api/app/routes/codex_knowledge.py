from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field

from app.security import resolve_requester
from app.services.codex_knowledge_extraction import enqueue_codex_knowledge_extraction


router = APIRouter(prefix="/codex/knowledge", tags=["codex-knowledge"])


class CodexKnowledgeExtractPayload(BaseModel):
    force: bool = True
    min_signal_score: int | None = Field(default=None, ge=0, le=100)


def _require_admin(request: Request, x_user_id: str | None):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin:
        raise HTTPException(status_code=403, detail="Admin permission required")
    return requester


@router.post("/sessions/{pet_session_id}/extract")
def extract_codex_session_knowledge(
    payload: CodexKnowledgeExtractPayload,
    request: Request,
    pet_session_id: str = Path(..., min_length=1, max_length=120),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    _require_admin(request, x_user_id)
    if not settings.codex_knowledge_extraction_enabled:
        raise HTTPException(status_code=404, detail="Codex knowledge extraction is disabled.")
    if not settings.openclaw_token:
        raise HTTPException(status_code=400, detail="OPENCLAW_TOKEN is required for Codex knowledge extraction.")
    try:
        return enqueue_codex_knowledge_extraction(
            request.app.state.trace_store,
            pet_session_id,
            min_signal_score=payload.min_signal_score
            if payload.min_signal_score is not None
            else settings.codex_knowledge_min_signal_score,
            prompt_version=settings.codex_knowledge_prompt_version,
            force=payload.force,
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/sessions/{pet_session_id}/latest")
def get_latest_codex_session_knowledge(
    request: Request,
    pet_session_id: str = Path(..., min_length=1, max_length=120),
    x_user_id: str | None = Header(default=None),
):
    _require_admin(request, x_user_id)
    item = request.app.state.trace_store.get_latest_codex_session_knowledge(pet_session_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Codex session knowledge not found.")
    return item


@router.get("/items")
def list_codex_session_knowledge(
    request: Request,
    workspace_id: str | None = Query(default=None, min_length=1, max_length=120),
    limit: int = Query(default=20, ge=1, le=100),
    x_user_id: str | None = Header(default=None),
):
    _require_admin(request, x_user_id)
    return {
        "items": request.app.state.trace_store.list_codex_session_knowledge(
            workspace_id=workspace_id,
            limit=limit,
        ),
        "limit": limit,
    }
