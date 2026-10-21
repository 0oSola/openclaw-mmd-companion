from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Request, WebSocket
from starlette.responses import Response
from starlette.websockets import WebSocketDisconnect

from app.services.realtime_voice import (
    RealtimeVoiceJob,
    RealtimeVoiceQueue,
    split_assistant_text,
)
from app.services.voice_workflow_tts_client import VoiceWorkflowTtsError


router = APIRouter(tags=["realtime-voice"])


def _get_queue(request: Request | WebSocket, session_id: str) -> RealtimeVoiceQueue:
    queues = request.app.state.realtime_voice_queues
    queue = queues.get(session_id)
    if queue is None:
        queue = RealtimeVoiceQueue(max_size=request.app.state.settings.realtime_voice_max_queue_size)
        queues[session_id] = queue
    return queue


def _resolve_user_context(websocket: WebSocket, user_id: str):
    return websocket.app.state.trace_store.get_current_workspace_context(user_id)


async def _close_unauthorized(websocket: WebSocket) -> None:
    await websocket.close(code=1008)


@router.websocket("/ws/sessions/{session_id}/voice")
async def session_voice_websocket(websocket: WebSocket, session_id: str):
    user_id = (websocket.query_params.get("user_id") or "").strip()
    if not user_id:
        await _close_unauthorized(websocket)
        return

    settings = websocket.app.state.settings
    if not settings.realtime_voice_enabled or not settings.tts_service_enabled:
        await _close_unauthorized(websocket)
        return

    ctx = _resolve_user_context(websocket, user_id)
    store = websocket.app.state.trace_store
    session = store.get_session(ctx["workspace"]["id"], ctx["account"]["id"], session_id)
    if not session:
        await _close_unauthorized(websocket)
        return

    await websocket.accept()
    queue = _get_queue(websocket, session_id)

    try:
        while True:
            payload = await websocket.receive_json()
            event_type = str(payload.get("type") or "").strip()
            if event_type == "cancel":
                scope = str(payload.get("scope") or "all")
                if scope == "all":
                    queue.clear()
                await websocket.app.state.tts_client.cancel_realtime(session_id)
                await websocket.send_json({"type": "cancelled", "session_id": session_id, "scope": scope})
                continue
            if event_type != "synthesize":
                await websocket.send_json(
                    {"type": "error", "session_id": session_id, "detail": "Unsupported realtime voice event."}
                )
                continue

            job = RealtimeVoiceJob(
                job_id=str(payload.get("job_id") or uuid4()),
                message_id=str(payload.get("message_id") or ""),
                text=str(payload.get("text") or ""),
                emotion_label=(str(payload.get("emotion_label")).strip() if payload.get("emotion_label") else None),
            )
            result = queue.enqueue(job)
            if not result.accepted:
                await websocket.send_json(
                    {
                        "type": "rejected",
                        "session_id": session_id,
                        "message_id": job.message_id,
                        "job_id": job.job_id,
                        "reason": result.reason,
                        "fallback": result.fallback,
                    }
                )
                continue

            await websocket.send_json(
                {
                    "type": "queued",
                    "session_id": session_id,
                    "message_id": job.message_id,
                    "job_id": job.job_id,
                    "queue_position": result.queue_position,
                }
            )
            await _process_next_job(websocket, user_id=user_id, session_id=session_id, queue=queue)
    except WebSocketDisconnect:
        return


async def _process_next_job(websocket: WebSocket, *, user_id: str, session_id: str, queue: RealtimeVoiceQueue) -> None:
    job = queue.dequeue()
    if job is None:
        return
    try:
        await websocket.send_json(
            {
                "type": "synthesis_started",
                "session_id": session_id,
                "message_id": job.message_id,
                "job_id": job.job_id,
            }
        )
        segments = split_assistant_text(job.text)
        for index, segment in enumerate(segments, start=1):
            chunk = await websocket.app.state.tts_client.synthesize_chunk(
                text=segment,
                emotion_label=job.emotion_label,
                pause_profile="podcast",
                session_id=session_id,
                sequence=index,
            )
            websocket.app.state.realtime_voice_registry.register(
                session_id=session_id,
                job_id=job.job_id,
                sequence=index,
                user_id=user_id,
                remote_audio_url=chunk.audio_url,
                media_type="audio/wav",
            )
            await websocket.send_json(
                {
                    "type": "audio_ready",
                    "session_id": session_id,
                    "message_id": job.message_id,
                    "job_id": job.job_id,
                    "sequence": index,
                    "text": segment,
                    "audio_url": f"/tts/proxy/realtime/{session_id}/{job.job_id}/{index}",
                    "duration": chunk.duration_seconds,
                    "elapsed_seconds": chunk.elapsed_seconds,
                }
            )
        await websocket.send_json(
            {"type": "done", "session_id": session_id, "message_id": job.message_id, "job_id": job.job_id}
        )
    except VoiceWorkflowTtsError as error:
        await websocket.send_json(
            {
                "type": "error",
                "session_id": session_id,
                "message_id": job.message_id,
                "job_id": job.job_id,
                "detail": str(error),
            }
        )
    except WebSocketDisconnect:
        raise
    except Exception:
        await websocket.send_json(
            {
                "type": "error",
                "session_id": session_id,
                "message_id": job.message_id,
                "job_id": job.job_id,
                "detail": "Realtime voice synthesis failed unexpectedly.",
            }
        )
    finally:
        queue.complete_current()


@router.get("/tts/proxy/realtime/{session_id}/{job_id}/{sequence}")
async def realtime_voice_proxy(session_id: str, job_id: str, sequence: int, request: Request, user_id: str = ""):
    query_user_id = user_id.strip()
    if not query_user_id:
        return Response(status_code=403)

    ctx = request.app.state.trace_store.get_current_workspace_context(query_user_id)
    session = request.app.state.trace_store.get_session(ctx["workspace"]["id"], ctx["account"]["id"], session_id)
    if not session:
        return Response(status_code=404)

    reference = request.app.state.realtime_voice_registry.get(
        session_id=session_id,
        job_id=job_id,
        sequence=sequence,
    )
    if reference is None or reference.user_id != query_user_id:
        return Response(status_code=404)

    response = await request.app.state.tts_client.http_client.get(reference.remote_audio_url)
    if not response.is_success:
        return Response(status_code=response.status_code)
    media_type = response.headers.get("content-type", reference.media_type).split(";", 1)[0] or reference.media_type
    return Response(content=response.content, media_type=media_type)
