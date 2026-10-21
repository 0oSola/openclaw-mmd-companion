from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Path, Request
from pydantic import BaseModel, Field, field_validator

from app.security import resolve_requester
from app.services.codex_knowledge_extraction import enqueue_codex_knowledge_extraction
from app.services.codex_openclaw_review_sync import enqueue_codex_review_sync


router = APIRouter(prefix="/desktop-pet", tags=["desktop-pet"])
_DESKTOP_PET_METADATA_MAX_CHARS = 30000
_CODEX_REVIEWABLE_STATUSES = {"completed", "failed", "waiting_approval", "file_changed"}


class CompanionSharedConfigPayload(BaseModel):
    selected_model_path: str | None = Field(default=None, max_length=1000)
    render_pipeline: Literal["classic", "hero-shot", "genshin", "mio-reference", "reze-npr", "reze-design", "k3", "reze-k3"] = "classic"
    reze_stage_document: dict[str, object] | None = None


class DesktopPetSessionPayload(BaseModel):
    pet_session_id: str = Field(min_length=1, max_length=120)
    codex_session_id: str = Field(min_length=1, max_length=200)
    workspace_id: str | None = Field(default=None, max_length=120)
    workspace_path: str = Field(min_length=1, max_length=2000)
    codex_home: str | None = Field(default=None, max_length=2000)
    display_title: str | None = Field(default=None, max_length=48)
    first_prompt_preview: str | None = Field(default=None, max_length=240)
    last_summary: str | None = Field(default=None, max_length=1000)
    last_status: str = Field(default="starting", max_length=80)
    launch_mode: str = Field(default="workspace-write", max_length=80)
    remote_url: str | None = Field(default=None, max_length=500)
    app_server_pid: int | None = None
    app_server_port: int | None = Field(default=None, ge=1, le=65535)
    metadata: dict[str, object] = Field(default_factory=dict)

    @field_validator("metadata")
    @classmethod
    def validate_metadata_size(cls, value: dict[str, object]) -> dict[str, object]:
        try:
            metadata_json = json.dumps(value, ensure_ascii=False)
        except TypeError as error:
            raise ValueError("metadata must be JSON serializable") from error
        if len(metadata_json) > _DESKTOP_PET_METADATA_MAX_CHARS:
            raise ValueError(f"metadata JSON must be at most {_DESKTOP_PET_METADATA_MAX_CHARS} characters")
        return value


@router.get("/sessions")
def list_pet_sessions(
    request: Request,
    limit: int = 10,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    resolve_requester(x_user_id, settings.admin_user_ids)
    bounded_limit = max(1, min(int(limit), 50))
    return {
        "sessions": request.app.state.trace_store.list_desktop_pet_sessions(limit=bounded_limit),
        "limit": bounded_limit,
    }


@router.post("/sessions")
def upsert_pet_session(
    payload: DesktopPetSessionPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    resolve_requester(x_user_id, settings.admin_user_ids)
    session_payload = payload.model_dump()
    if not session_payload.get("workspace_id"):
        session_payload["workspace_id"] = settings.codex_openclaw_control_plane_workspace_id
    session = request.app.state.trace_store.upsert_desktop_pet_session(**session_payload)
    if (
        settings.codex_openclaw_review_enabled
        and settings.openclaw_token
        and session.get("last_status") in _CODEX_REVIEWABLE_STATUSES
    ):
        enqueue_codex_review_sync(request.app.state.trace_store, session["pet_session_id"])
    if (
        settings.codex_knowledge_extraction_enabled
        and settings.openclaw_token
        and session.get("last_status") in _CODEX_REVIEWABLE_STATUSES
    ):
        enqueue_codex_knowledge_extraction(
            request.app.state.trace_store,
            session["pet_session_id"],
            min_signal_score=settings.codex_knowledge_min_signal_score,
            prompt_version=settings.codex_knowledge_prompt_version,
        )
    return session


@router.delete("/sessions/{pet_session_id}")
def delete_pet_session(
    request: Request,
    pet_session_id: str = Path(..., min_length=1, max_length=120),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    resolve_requester(x_user_id, settings.admin_user_ids)
    return {"deleted": request.app.state.trace_store.delete_desktop_pet_session(pet_session_id)}


@router.get("/shared-config")
def get_shared_config(request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    return request.app.state.trace_store.get_companion_shared_config(requester.user_id)


@router.put("/shared-config")
def put_shared_config(
    payload: CompanionSharedConfigPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    try:
        return request.app.state.trace_store.upsert_companion_shared_config(
            user_id=requester.user_id,
            selected_model_path=payload.selected_model_path,
            render_pipeline=payload.render_pipeline,
            reze_stage_document=payload.reze_stage_document,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
