from __future__ import annotations

import json
import unicodedata
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.security import require_auth
from app.services.codex_knowledge_extraction import enqueue_codex_knowledge_extraction
from app.services.codex_openclaw_review_sync import enqueue_codex_review_sync


router = APIRouter(prefix="/desktop-pet", tags=["desktop-pet"])
_DESKTOP_PET_METADATA_MAX_CHARS = 30000
_CODEX_REVIEWABLE_STATUSES = {"completed", "failed", "waiting_approval", "file_changed"}


class CompanionSharedConfigPayload(BaseModel):
    selected_model_path: str | None = Field(default=None, max_length=1000)
    render_pipeline: Literal["classic", "hero-shot", "genshin", "mio-reference", "reze-npr", "reze-design", "k3", "reze-k3", "v14d-game", "gf2"] = "classic"
    reze_stage_document: dict[str, object] | None = None


def _eye_model_path(value: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 1000:
        raise ValueError("需要完整模型路径")
    normalized = unicodedata.normalize("NFC", value.replace("\\", "/"))
    if normalized != normalized.strip() or normalized.startswith("/") or ":" in normalized or any(ord(x) < 32 for x in normalized) or any(x in ("", ".", "..") for x in normalized.split("/")) or not normalized.lower().endswith((".pmx", ".pmd")):
        raise ValueError("模型路径非法")
    return normalized


class EyeSettingsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    model_path: str
    closed_eye: Literal["reference", "open", "motion", "closed"]

    @field_validator("model_path")
    @classmethod
    def validate_model_path(cls, value: str) -> str:
        return _eye_model_path(value)


def _eye_requester(request: Request):
    # 复用原JWT中间件；不以任意x-user-id降级保存来源。
    requester = require_auth(request)
    if getattr(request.state, "authenticated_user_id", None) != requester.user_id:
        raise HTTPException(status_code=401, detail="眼部配置需要已验证登录")
    return requester


@router.get("/eye-settings")
def get_eye_settings(request: Request, model_path: str):
    requester = _eye_requester(request)
    if list(request.query_params.keys()) != ["model_path"] or len(request.query_params.multi_items()) != 1:
        raise HTTPException(status_code=400, detail="眼部读取只接收一个完整模型参数")
    try:
        model_path = _eye_model_path(model_path)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return request.app.state.trace_store.get_companion_eye_settings(requester.user_id, model_path)


@router.put("/eye-settings")
def put_eye_settings(payload: EyeSettingsPayload, request: Request, if_none_match: str | None = Header(default=None)):
    requester = _eye_requester(request)
    if if_none_match not in (None, "*"):
        raise HTTPException(status_code=400, detail="仅支持首次初始化If-None-Match: *")
    try:
        return request.app.state.trace_store.save_companion_eye_settings(requester.user_id, payload.model_path, payload.closed_eye, only_if_absent=if_none_match == "*")
    except FileExistsError as error:
        raise HTTPException(status_code=412, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


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
    require_auth(request)
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
    require_auth(request)
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
    require_auth(request)
    return {"deleted": request.app.state.trace_store.delete_desktop_pet_session(pet_session_id)}


@router.get("/shared-config")
def get_shared_config(request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = require_auth(request)
    return request.app.state.trace_store.get_companion_shared_config(requester.user_id)


@router.put("/shared-config")
def put_shared_config(
    payload: CompanionSharedConfigPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = require_auth(request)
    try:
        return request.app.state.trace_store.upsert_companion_shared_config(
            user_id=requester.user_id,
            selected_model_path=payload.selected_model_path,
            render_pipeline=payload.render_pipeline,
            reze_stage_document=payload.reze_stage_document,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
