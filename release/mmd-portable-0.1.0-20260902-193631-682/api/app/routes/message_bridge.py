from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel


router = APIRouter(prefix="/admin/message-bridge", tags=["message-bridge"])


class BridgeSettingsPatch(BaseModel):
    enabled: bool | None = None
    realtime_drive_character: bool | None = None


class BridgeDefaultBindingRequest(BaseModel):
    provider: str
    channel: str
    external_session_key: str


def _require_admin(request: Request, x_user_id: str | None) -> str:
    user_id = (x_user_id or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="x-user-id header is required")
    if user_id not in request.app.state.settings.admin_user_ids:
        raise HTTPException(status_code=403, detail="Admin permission required")
    return user_id


def _service(request: Request):
    service = getattr(request.app.state, "message_bridge_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="Message bridge is not configured")
    return service


def _binding_response(binding: dict[str, Any] | None) -> dict[str, Any] | None:
    if not binding:
        return None
    return {
        "id": binding["id"],
        "local_session_id": binding["local_session_id"],
        "provider": binding["provider"],
        "channel": binding["channel"],
        "external_session_key": binding["external_session_key"],
        "external_display_name": binding.get("external_display_name"),
        "is_default": binding["is_default"],
        "status": binding["status"],
        "last_history_sync_at": binding.get("last_history_sync_at"),
        "last_message_at": binding.get("last_message_at"),
        "updated_at": binding["updated_at"],
    }


@router.get("/status")
def get_bridge_status(request: Request, x_user_id: str | None = Header(default=None)):
    user_id = _require_admin(request, x_user_id)
    service = _service(request)
    ctx = request.app.state.trace_store.get_current_workspace_context(user_id)
    state = request.app.state.trace_store.get_message_bridge_state(service.provider.provider, service.provider.channel)
    binding = request.app.state.trace_store.get_default_message_bridge_binding(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        provider=service.provider.provider,
        channel=service.provider.channel,
    )
    return {
        "provider": service.provider.provider,
        "channel": service.provider.channel,
        "enabled": state["enabled"],
        "realtime_drive_character": state["realtime_drive_character"],
        "websocket_status": state["websocket_status"],
        "reconnect_attempts": state["reconnect_attempts"],
        "last_connected_at": state.get("last_connected_at"),
        "last_error": state.get("last_error"),
        "binding": _binding_response(binding),
    }


@router.patch("/settings")
async def patch_bridge_settings(
    payload: BridgeSettingsPatch,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    _require_admin(request, x_user_id)
    service = _service(request)
    state = request.app.state.trace_store.update_message_bridge_state(
        service.provider.provider,
        service.provider.channel,
        enabled=payload.enabled,
        realtime_drive_character=payload.realtime_drive_character,
        websocket_status="disabled" if payload.enabled is False else None,
        reconnect_attempts=0 if payload.enabled is False else None,
        last_error=None if payload.enabled is False else None,
    )
    if payload.enabled is False:
        try:
            await service.close_provider_async()
        except Exception:
            pass
    return state


@router.get("/openclaw/feishu/sessions")
async def list_openclaw_feishu_sessions(request: Request, x_user_id: str | None = Header(default=None)):
    user_id = _require_admin(request, x_user_id)
    service = _service(request)
    try:
        sessions = await service.list_external_sessions_isolated_async()
    except Exception as error:
        request.app.state.trace_store.insert_event(
            trace_id=str(uuid4()),
            user_id=user_id,
            session_id=None,
            stage="message_bridge.openclaw.sessions.list",
            status="error",
            latency_ms=None,
            error_code=type(error).__name__,
            payload={"detail": str(error), "source": "admin_session_list"},
        )
        raise HTTPException(
            status_code=502,
            detail=f"OpenClaw Gateway session list failed: {type(error).__name__}: {error}",
        ) from error
    return {
        "items": [
            {
                "provider": service.provider.provider,
                "channel": service.provider.channel,
                "external_session_key": session.key,
                "external_display_name": session.display_name,
                "updated_at": session.updated_at,
            }
            for session in sessions
        ]
    }


@router.post("/bindings/default")
async def set_default_bridge_binding(
    payload: BridgeDefaultBindingRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    user_id = _require_admin(request, x_user_id)
    service = _service(request)
    if payload.provider != service.provider.provider or payload.channel != service.provider.channel:
        raise HTTPException(status_code=400, detail="Unsupported bridge provider or channel")
    try:
        binding = await service.bind_external_session_for_user_async(user_id, payload.external_session_key)
    except RuntimeError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"binding": _binding_response(binding)}
