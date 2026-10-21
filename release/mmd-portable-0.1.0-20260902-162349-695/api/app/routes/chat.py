from __future__ import annotations

from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from fastapi import APIRouter, Header, Request

from app.models.chat import ChatRequest, ChatResponse
from app.services.openclaw_client import OpenClawInvocationError
from app.services.response_parser import normalize_assistant_reply


router = APIRouter(tags=["chat"])


def _serialize_history(history: list) -> list[dict[str, str]]:
    output = []
    for msg in history:
        role = getattr(msg, "role", None)
        content = getattr(msg, "content", None)
        if role and content:
            output.append({"role": role, "content": content})
    return output


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    x_trace_id: str | None = Header(default=None),
) -> ChatResponse:
    trace_id = x_trace_id or str(uuid4())
    session_id = payload.session_id or str(uuid4())
    store = request.app.state.trace_store
    client = request.app.state.openclaw_client
    settings = request.app.state.settings

    started = perf_counter()
    store.insert_event(
        trace_id=trace_id,
        user_id=payload.user_id,
        session_id=session_id,
        stage="ingress",
        status="ok",
        latency_ms=None,
        payload={"message": payload.message},
    )

    try:
        reply = await client.generate_reply(
            user_id=payload.user_id,
            session_id=session_id,
            message=payload.message,
            history=_serialize_history(payload.history),
        )
        normalized = normalize_assistant_reply(reply.raw_text)
        latency = int((perf_counter() - started) * 1000)
        store.insert_chat_mirror(
            trace_id=trace_id,
            user_id=payload.user_id,
            request_payload=payload.model_dump(),
            raw_response=reply.raw_text,
            normalized_payload=normalized,
            endpoint_used=reply.endpoint_used,
            status="ok",
        )
        store.insert_event(
            trace_id=trace_id,
            user_id=payload.user_id,
            session_id=session_id,
            stage="egress",
            status="ok",
            latency_ms=latency,
            payload={"endpoint_used": reply.endpoint_used, "parse_mode": normalized["parse_mode"]},
        )
        request.app.state.last_cleanup_check = datetime.now(UTC)
        return ChatResponse(
            trace_id=trace_id,
            endpoint_used=reply.endpoint_used,
            degraded=False,
            **normalized,
        )
    except (OpenClawInvocationError, Exception) as error:
        fallback = {
            "text": "我现在连接模型服务遇到问题，我们稍后继续。",
            "emotion": "caring",
            "action": "comfort",
            "memory_ops": [],
            "parse_mode": "fallback_error",
        }
        store.insert_chat_mirror(
            trace_id=trace_id,
            user_id=payload.user_id,
            request_payload=payload.model_dump(),
            raw_response=str(error),
            normalized_payload=fallback,
            endpoint_used="fallback",
            status="error",
        )
        store.insert_retry_job(
            trace_id=trace_id,
            stage="chat",
            payload=payload.model_dump(),
            last_error=str(error),
        )
        store.insert_event(
            trace_id=trace_id,
            user_id=payload.user_id,
            session_id=session_id,
            stage="error",
            status="error",
            latency_ms=int((perf_counter() - started) * 1000),
            error_code=type(error).__name__,
            payload={"error": str(error)},
        )
        return ChatResponse(
            trace_id=trace_id,
            endpoint_used="fallback",
            degraded=True,
            fallback_reason=str(error),
            **fallback,
        )
    finally:
        store.cleanup(
            retention_days=settings.retention_days,
            compress_after_days=settings.ndjson_compress_after_days,
        )
