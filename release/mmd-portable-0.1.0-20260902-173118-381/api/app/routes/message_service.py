from __future__ import annotations

import json
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import Response

from app.models.chat import OpenClawReply
from app.services.message_tts_reference import create_or_enqueue_message_tts_reference
from app.services.motion_resolution import list_available_favorite_motion_assets, resolve_motion_resolution
from app.services.openclaw_client import OpenClawInvocationError
from app.services.response_parser import normalize_assistant_reply
from app.services.voice_workflow_tts_client import VoiceWorkflowTtsError


router = APIRouter(tags=["message-service-v2"])


class SessionCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    selected_model_path: str | None = Field(default=None, max_length=1000)


class SessionPatchRequest(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    selected_model_path: str | None = Field(default=None, max_length=1000)


class MessageCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=5000)
    tts_enabled: bool = False
    selected_model_path: str | None = Field(default=None, max_length=1000)


class MotionContextExportRequest(BaseModel):
    selected_model_path: str = Field(min_length=1, max_length=1000)


def _require_user_id(x_user_id: str | None) -> str:
    user_id = (x_user_id or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="x-user-id header is required")
    return user_id


def _context(request: Request, x_user_id: str | None) -> dict:
    return request.app.state.trace_store.get_current_workspace_context(_require_user_id(x_user_id))


def _store(request: Request):
    return request.app.state.trace_store


def _require_admin(request: Request, user_id: str) -> None:
    if user_id not in request.app.state.settings.admin_user_ids:
        raise HTTPException(status_code=403, detail="Admin permission required")


def _message_response(message: dict) -> dict:
    return {
        "id": message["id"],
        "workspace_id": message["workspace_id"],
        "session_id": message["session_id"],
        "role": message["role"],
        "content": message["content"],
        "visibility": message.get("visibility", "chat"),
        "trace_id": message.get("trace_id"),
        "emotion": message.get("emotion"),
        "action": message.get("action"),
        "tts_emotion_label": message.get("tts_emotion_label"),
        "tts_pause_profile": message.get("tts_pause_profile"),
        "motion_plan": message.get("motion_plan"),
        "memory_ops": message.get("memory_ops", []),
        "metadata": message.get("metadata", {}),
        "motion_resolution": message.get("motion_resolution"),
        "tts": _tts_response(message.get("tts")),
        "created_at": message["created_at"],
        "deleted_at": message.get("deleted_at"),
    }


def _session_response(session: dict) -> dict:
    return {
        "id": session["id"],
        "workspace_id": session["workspace_id"],
        "account_id": session["account_id"],
        "openclaw_session_key": session["openclaw_session_key"],
        "title": session["title"],
        "title_source": session["title_source"],
        "selected_model_path": session.get("selected_model_path"),
        "created_at": session["created_at"],
        "updated_at": session["updated_at"],
        "deleted_at": session.get("deleted_at"),
    }


def _tts_response(tts: dict | None) -> dict | None:
    if not tts:
        return None
    return {
        "id": tts["id"],
        "provider": tts["provider"],
        "version": tts["version"],
        "status": tts["status"],
        "task_id": tts.get("task_id"),
        "remote_audio_url": tts.get("remote_audio_url"),
        "remote_audio_path": tts.get("remote_audio_path"),
        "proxy_audio_url": tts.get("proxy_audio_url"),
        "media_type": tts.get("media_type"),
        "duration_seconds": tts.get("duration_seconds"),
        "chunks_count": tts.get("chunks_count"),
        "error": tts.get("error"),
        "created_at": tts["created_at"],
        "completed_at": tts.get("completed_at"),
        "expires_at": tts.get("expires_at"),
        "updated_at": tts["updated_at"],
    }


def _history(messages: list[dict]) -> list[dict[str, str]]:
    output: list[dict[str, str]] = []
    for message in messages:
        if message["role"] in {"user", "assistant", "system"}:
            output.append({"role": message["role"], "content": message["content"]})
    return output


def _openclaw_http_stream_enabled(request: Request) -> bool:
    mode = str(getattr(request.app.state.settings, "openclaw_stream_mode", "") or "").strip().lower()
    return mode in {"http_sse", "sse", "stream", "streaming", "true", "1"}


def _is_complete_json_object(raw_text: str) -> bool:
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError:
        return False
    return isinstance(payload, dict) and isinstance(payload.get("text"), str) and bool(payload["text"].strip())


async def _request_openclaw_reply(
    request: Request,
    *,
    user_id: str,
    session_id: str | None,
    message: str,
    history: list[dict[str, str]],
) -> OpenClawReply:
    if not _openclaw_http_stream_enabled(request):
        return await request.app.state.openclaw_client.generate_reply(
            user_id=user_id,
            session_id=session_id,
            message=message,
            history=history,
        )

    chunks: list[str] = []
    try:
        async for delta in request.app.state.openclaw_client.stream_reply(
            user_id=user_id,
            session_id=session_id,
            message=message,
            history=history,
        ):
            chunks.append(delta)
            raw_text = "".join(chunks).strip()
            if _is_complete_json_object(raw_text):
                return OpenClawReply(raw_text=raw_text, endpoint_used="/v1/responses?stream=true", status_code=200)
    except OpenClawInvocationError:
        raw_text = "".join(chunks).strip()
        if raw_text:
            return OpenClawReply(raw_text=raw_text, endpoint_used="/v1/responses?stream=true;partial=true", status_code=206)
        raise

    raw_text = "".join(chunks).strip()
    if not raw_text:
        raise OpenClawInvocationError("OpenClaw stream returned empty content.")
    return OpenClawReply(raw_text=raw_text, endpoint_used="/v1/responses?stream=true", status_code=200)


def _make_session_title(content: str) -> str:
    collapsed = " ".join(content.split())
    if not collapsed:
        return "新对话"
    return collapsed[:30]


def _model_display_name(model_path: str) -> str:
    return Path(model_path).stem or model_path


def _dedupe_strings(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = value.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        output.append(text)
    return output


def _match_tokens(asset: dict) -> list[str]:
    display_name = str(asset.get("display_name") or asset.get("filename") or "").strip()
    filename = str(asset.get("filename") or "").strip()
    return _dedupe_strings(
        [
            str(asset.get("asset_id") or ""),
            Path(display_name).stem,
            display_name,
            filename,
        ]
    )


def _build_motion_context_export_payload(model_path: str, assets: list[dict]) -> dict:
    motions = []
    for asset in assets:
        display_name = str(asset.get("display_name") or asset.get("filename") or "").strip()
        filename = str(asset.get("filename") or "").strip()
        motions.append(
            {
                "motion_key": asset["asset_id"],
                "asset_id": asset["asset_id"],
                "display_name": display_name,
                "filename": filename,
                "source_name": Path(filename).stem,
                "match_names": _match_tokens(asset),
                "emotion": asset["slot"],
                "action": asset["asset_id"],
                "safe_for_chat": True,
            }
        )
    return {
        "schema": "mmd.favorite_motions.v1",
        "model": {"model_key": model_path, "display_name": _model_display_name(model_path)},
        "motions": motions,
        "fallback": {"action": "idle", "description": "If nothing matches, fallback to idle."},
        "instruction": "Prefer returning action as motion_key.",
    }


async def _create_ready_tts_reference(request: Request, message: dict) -> dict:
    speech = await request.app.state.tts_client.synthesize_reference(
        text=message["content"],
        emotion_label=message.get("tts_emotion_label"),
        pause_profile=message.get("tts_pause_profile") or "podcast",
    )
    return _store(request).create_message_tts(
        message["workspace_id"],
        message["id"],
        status="ready",
        task_id=speech.task_id,
        remote_audio_url=speech.audio_url,
        media_type=speech.media_type,
        duration_seconds=speech.duration_seconds,
        chunks_count=speech.chunks_count,
    )


async def _create_or_enqueue_tts_reference(
    request: Request,
    message: dict,
    *,
    trace_user_id: str,
    trace_session_id: str,
) -> dict:
    return await create_or_enqueue_message_tts_reference(
        request.app,
        message,
        trace_user_id=trace_user_id,
        trace_session_id=trace_session_id,
    )


@router.get("/workspaces/current")
async def get_current_workspace(request: Request, x_user_id: str | None = Header(default=None)):
    ctx = _context(request, x_user_id)
    return {"account": ctx["account"], "workspace": ctx["workspace"], "membership": ctx["membership"]}


@router.get("/sessions")
async def list_sessions(request: Request, x_user_id: str | None = Header(default=None)):
    ctx = _context(request, x_user_id)
    sessions = _store(request).list_sessions(ctx["workspace"]["id"], ctx["account"]["id"])
    return {"items": [_session_response(session) for session in sessions]}


@router.post("/sessions")
async def create_session(
    payload: SessionCreateRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    ctx = _context(request, x_user_id)
    session = _store(request).create_session(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        title=payload.title,
        selected_model_path=payload.selected_model_path,
    )
    return {"session": _session_response(session)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    ctx = _context(request, x_user_id)
    session = _store(request).get_session(ctx["workspace"]["id"], ctx["account"]["id"], session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session": _session_response(session)}


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: str,
    payload: SessionPatchRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    ctx = _context(request, x_user_id)
    session = _store(request).update_session(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        session_id,
        title=payload.title,
        selected_model_path=payload.selected_model_path,
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session": _session_response(session)}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    ctx = _context(request, x_user_id)
    session = _store(request).soft_delete_session(ctx["workspace"]["id"], ctx["account"]["id"], session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session": _session_response(session)}


@router.get("/sessions/{session_id}/messages")
async def list_messages(session_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    ctx = _context(request, x_user_id)
    store = _store(request)
    session = store.get_session(ctx["workspace"]["id"], ctx["account"]["id"], session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = store.list_messages_for_chat(ctx["workspace"]["id"], ctx["account"]["id"], session_id)
    return {"items": [_message_response(message) for message in messages]}


@router.get("/messages/greetings/latest")
async def get_latest_greeting_message(request: Request, x_user_id: str | None = Header(default=None)):
    ctx = _context(request, x_user_id)
    message = _store(request).get_latest_greeting_message(ctx["workspace"]["id"], ctx["account"]["id"])
    if not message:
        raise HTTPException(status_code=404, detail="Greeting message not found")
    return {"message": _message_response(message)}


@router.get("/messages/{message_id}")
async def get_message(message_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    ctx = _context(request, x_user_id)
    message = _store(request).get_message(ctx["workspace"]["id"], ctx["account"]["id"], message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"message": _message_response(message)}


@router.post("/sessions/{session_id}/messages")
async def create_message(
    session_id: str,
    payload: MessageCreateRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
    x_trace_id: str | None = Header(default=None),
):
    ctx = _context(request, x_user_id)
    store = _store(request)
    session = store.get_session(ctx["workspace"]["id"], ctx["account"]["id"], session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    trace_id = x_trace_id or str(uuid4())
    started = perf_counter()
    request.app.state.trace_store.insert_event(
        trace_id=trace_id,
        user_id=ctx["account"]["external_user_id"],
        session_id=session_id,
        stage="message_service.ingress",
        status="ok",
        latency_ms=None,
        payload={
            "content_length": len(payload.content),
            "tts_enabled": payload.tts_enabled,
            "selected_model_path": payload.selected_model_path,
        },
    )
    user_message = store.insert_message(
        ctx["workspace"]["id"],
        session_id,
        ctx["account"]["id"],
        role="user",
        content=payload.content,
        trace_id=trace_id,
        metadata={"selected_model_path": payload.selected_model_path},
    )
    if session["title_source"] == "default":
        session = store.update_session(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            session_id,
            title=_make_session_title(payload.content),
            selected_model_path=payload.selected_model_path,
        )
    elif payload.selected_model_path:
        session = store.update_session(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            session_id,
            selected_model_path=payload.selected_model_path,
        )

    prior_messages = store.list_messages_for_chat(ctx["workspace"]["id"], ctx["account"]["id"], session_id)
    history = _history([message for message in prior_messages if message["id"] != user_message["id"]])
    openclaw_started = perf_counter()
    request.app.state.trace_store.insert_event(
        trace_id=trace_id,
        user_id=ctx["account"]["external_user_id"],
        session_id=session_id,
        stage="message_service.openclaw.request",
        status="start",
        latency_ms=None,
        payload={
            "message_id": user_message["id"],
            "history_count": len(history),
            "openclaw_session_key": session["openclaw_session_key"],
        },
    )
    try:
        reply = await _request_openclaw_reply(
            request,
            user_id=ctx["account"]["external_user_id"],
            session_id=session["openclaw_session_key"],
            message=payload.content,
            history=history,
        )
        normalized = normalize_assistant_reply(reply.raw_text)
        endpoint_used = reply.endpoint_used
        degraded = False
        request.app.state.trace_store.insert_chat_mirror(
            trace_id=trace_id,
            user_id=ctx["account"]["external_user_id"],
            request_payload={
                "content": payload.content,
                "history": history,
                "openclaw_session_key": session["openclaw_session_key"],
            },
            raw_response=reply.raw_text,
            normalized_payload=normalized,
            endpoint_used=reply.endpoint_used,
            status="ok",
        )
        request.app.state.trace_store.insert_event(
            trace_id=trace_id,
            user_id=ctx["account"]["external_user_id"],
            session_id=session_id,
            stage="message_service.openclaw.response",
            status="ok",
            latency_ms=int((perf_counter() - openclaw_started) * 1000),
            payload={
                "endpoint_used": reply.endpoint_used,
                "parse_mode": normalized.get("parse_mode"),
                "degraded": False,
            },
        )
    except (OpenClawInvocationError, Exception) as error:
        normalized = {
            "text": "我现在连接模型服务遇到问题，我们稍后继续。",
            "emotion": "caring",
            "action": "comfort",
            "motion_plan": None,
            "memory_ops": [],
            "tts_emotion_label": None,
            "tts_pause_profile": "podcast",
            "parse_mode": "fallback_error",
        }
        endpoint_used = "fallback"
        degraded = True
        store.insert_retry_job(trace_id=trace_id, stage="message_service.chat", payload=payload.model_dump(), last_error=str(error))
        request.app.state.trace_store.insert_chat_mirror(
            trace_id=trace_id,
            user_id=ctx["account"]["external_user_id"],
            request_payload={
                "content": payload.content,
                "history": history,
                "openclaw_session_key": session["openclaw_session_key"],
            },
            raw_response=str(error),
            normalized_payload=normalized,
            endpoint_used="fallback",
            status="error",
        )
        request.app.state.trace_store.insert_event(
            trace_id=trace_id,
            user_id=ctx["account"]["external_user_id"],
            session_id=session_id,
            stage="message_service.openclaw.response",
            status="error",
            latency_ms=int((perf_counter() - openclaw_started) * 1000),
            error_code=type(error).__name__,
            payload={"error": str(error), "endpoint_used": "fallback"},
        )

    assistant_message = store.insert_message(
        ctx["workspace"]["id"],
        session_id,
        ctx["account"]["id"],
        role="assistant",
        content=normalized["text"],
        trace_id=trace_id,
        emotion=normalized.get("emotion"),
        action=normalized.get("action"),
        tts_emotion_label=normalized.get("tts_emotion_label"),
        tts_pause_profile=normalized.get("tts_pause_profile"),
        motion_plan=normalized.get("motion_plan"),
        memory_ops=normalized.get("memory_ops", []),
        metadata={
            "parse_mode": normalized.get("parse_mode"),
            "endpoint_used": endpoint_used,
            "degraded": degraded,
        },
    )
    pruned_bridge_echoes = store.soft_delete_message_bridge_echoes(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        session_id,
        external_session_key=session["openclaw_session_key"],
        role_content_pairs=[
            ("user", payload.content),
            ("assistant", assistant_message["content"]),
        ],
        created_after=user_message["created_at"],
    )
    if pruned_bridge_echoes:
        request.app.state.trace_store.insert_event(
            trace_id=trace_id,
            user_id=ctx["account"]["external_user_id"],
            session_id=session_id,
            stage="message_service.bridge_echo_prune",
            status="ok",
            latency_ms=None,
            payload={"count": pruned_bridge_echoes, "openclaw_session_key": session["openclaw_session_key"]},
        )
    assistant_message["motion_resolution"] = store.create_message_motion_resolution(
        ctx["workspace"]["id"],
        assistant_message["id"],
        **resolve_motion_resolution(
            user_id=ctx["account"]["external_user_id"],
            selected_model_path=payload.selected_model_path or session.get("selected_model_path"),
            source_action=assistant_message.get("action"),
            motion_plan=assistant_message.get("motion_plan"),
            store=store,
        ),
    )

    if payload.tts_enabled and request.app.state.settings.tts_service_enabled:
        try:
            tts = await _create_or_enqueue_tts_reference(
                request,
                assistant_message,
                trace_user_id=ctx["account"]["external_user_id"],
                trace_session_id=session_id,
            )
        except VoiceWorkflowTtsError as error:
            tts = store.create_message_tts(
                ctx["workspace"]["id"],
                assistant_message["id"],
                status="failed",
                task_id=None,
                remote_audio_url=None,
                media_type=None,
                error=str(error),
            )
            request.app.state.trace_store.insert_event(
                trace_id=trace_id,
                user_id=ctx["account"]["external_user_id"],
                session_id=session_id,
                stage="message_service.tts.reference",
                status="error",
                latency_ms=None,
                error_code=type(error).__name__,
                payload={"message_id": assistant_message["id"], "error": str(error)},
            )
        assistant_message["tts"] = tts

    request.app.state.trace_store.insert_event(
        trace_id=trace_id,
        user_id=ctx["account"]["external_user_id"],
        session_id=session_id,
        stage="message_service.egress",
        status="ok",
        latency_ms=int((perf_counter() - started) * 1000),
        payload={"tts_enabled": payload.tts_enabled, "endpoint_used": endpoint_used},
    )
    latest_session = store.get_session(ctx["workspace"]["id"], ctx["account"]["id"], session_id) or session
    return {
        "session": _session_response(latest_session),
        "user_message": _message_response(user_message),
        "assistant_message": _message_response(assistant_message),
    }


@router.post("/messages/{message_id}/tts/regenerate")
async def regenerate_message_tts(
    message_id: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    ctx = _context(request, x_user_id)
    message = _store(request).get_message(ctx["workspace"]["id"], ctx["account"]["id"], message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    if message["role"] != "assistant":
        raise HTTPException(status_code=400, detail="Only assistant messages can have TTS")
    if not request.app.state.settings.tts_service_enabled:
        raise HTTPException(status_code=501, detail="TTS service is not configured")
    _store(request).cancel_tts_jobs_for_message(ctx["workspace"]["id"], message["id"])
    try:
        await _create_or_enqueue_tts_reference(
            request,
            message,
            trace_user_id=ctx["account"]["external_user_id"],
            trace_session_id=message["session_id"],
        )
    except VoiceWorkflowTtsError as error:
        _store(request).create_message_tts(
            ctx["workspace"]["id"],
            message["id"],
            status="failed",
            task_id=None,
            remote_audio_url=None,
            media_type=None,
            error=str(error),
        )
    updated = _store(request).get_message(ctx["workspace"]["id"], ctx["account"]["id"], message_id)
    return {"message": _message_response(updated)}


@router.post("/message-tts/{tts_id}/mark-expired")
async def mark_tts_expired(
    tts_id: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    ctx = _context(request, x_user_id)
    message = _store(request).get_message_by_tts_id(ctx["workspace"]["id"], ctx["account"]["id"], tts_id)
    if not message:
        raise HTTPException(status_code=404, detail="TTS reference not found")
    tts = _store(request).update_tts_status(ctx["workspace"]["id"], tts_id, status="expired")
    return {"tts": _tts_response(tts)}


@router.post("/motion-context/exports")
async def create_motion_context_export(
    payload: MotionContextExportRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    ctx = _context(request, x_user_id)
    store = _store(request)
    assets = list_available_favorite_motion_assets(store, ctx["account"]["external_user_id"], payload.selected_model_path)
    export_json = _build_motion_context_export_payload(payload.selected_model_path, assets)
    export_row = store.create_motion_context_export(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        model_key=payload.selected_model_path,
        model_display_name=_model_display_name(payload.selected_model_path),
        export_json=export_json,
        motion_count=len(assets),
    )
    return export_row


@router.get("/motion-context/exports/latest")
async def get_latest_motion_context_export(
    model_key: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    ctx = _context(request, x_user_id)
    export_row = _store(request).get_latest_motion_context_export(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        model_key,
    )
    if not export_row:
        raise HTTPException(status_code=404, detail="Motion context export not found")
    return export_row


@router.get("/tts/proxy/{tts_id}")
async def proxy_tts_audio(
    tts_id: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
    user_id: str = "",
):
    ctx = _context(request, x_user_id or user_id)
    message = _store(request).get_message_by_tts_id(ctx["workspace"]["id"], ctx["account"]["id"], tts_id)
    if not message:
        raise HTTPException(status_code=404, detail="TTS reference not found")
    tts = message.get("tts")
    if not tts or not tts.get("remote_audio_url"):
        raise HTTPException(status_code=404, detail="Remote audio reference not found")

    response = await request.app.state.tts_client.http_client.get(str(tts["remote_audio_url"]))
    if response.status_code in {404, 410}:
        _store(request).update_tts_status(ctx["workspace"]["id"], tts_id, status="expired")
        raise HTTPException(status_code=response.status_code, detail="Remote audio expired")
    if not response.is_success:
        raise HTTPException(status_code=502, detail=f"Remote audio proxy failed with status {response.status_code}")

    media_type = response.headers.get("content-type", tts.get("media_type") or "audio/wav")
    return Response(content=response.content, media_type=media_type)


@router.post("/admin/message-service/cleanup")
async def cleanup_message_service_admin(
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    user_id = _require_user_id(x_user_id)
    _require_admin(request, user_id)
    counts = _store(request).cleanup_message_service(
        tts_retention_days=request.app.state.settings.message_service_tts_retention_days,
        max_tts_attempts=request.app.state.settings.tts_service_max_poll_attempts,
    )
    return {"ok": True, "counts": counts}
