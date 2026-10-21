from __future__ import annotations

import asyncio
from uuid import uuid4


_EULA_STORAGE_MARKER = "eula_emotion_revelation/"
_EULA_DEFAULT_EMOTION_DIR = "关心温柔"
_VOICE_STORAGE_PROBE_ATTEMPTS = 3
_VOICE_STORAGE_PROBE_MAX_DELAY_SECONDS = 1.0


def _relative_eula_storage_path(value: object) -> str | None:
    text = str(value or "").strip().replace("\\", "/")
    if not text:
        return None
    marker_index = text.find(_EULA_STORAGE_MARKER)
    if marker_index >= 0:
        text = text[marker_index + len(_EULA_STORAGE_MARKER) :]
    else:
        if text.startswith(("/", "~/")) or (len(text) >= 2 and text[1] == ":"):
            return None
        stripped = text.strip("/")
        if not stripped:
            return None
        if "/" in stripped:
            text = stripped
        else:
            text = f"{_EULA_DEFAULT_EMOTION_DIR}/{stripped}"
    parts = [part for part in text.lstrip("/").split("/") if part]
    if not parts or any(part in {".", ".."} for part in parts):
        return None
    return "/".join(parts)


def _storage_audio_path_candidates(value: object) -> list[str]:
    path = _relative_eula_storage_path(value)
    if path is None:
        return []
    lowered = path.lower()
    if lowered.endswith(".meta.json"):
        return [f"{path[:-len('.meta.json')]}.wav"]
    if lowered.endswith(".txt"):
        return [f"{path.rsplit('.', 1)[0]}.wav"]
    if lowered.endswith((".wav", ".ogg")):
        candidates = [path]
        wav_path = f"{path.rsplit('.', 1)[0]}.wav"
        _add_candidate(candidates, wav_path)
        return candidates
    return []


def _add_candidate(candidates: list[str], value: str | None) -> None:
    if value and value not in candidates:
        candidates.append(value)


def _greeting_storage_audio_paths(message: dict) -> list[str]:
    metadata = message.get("metadata") or {}
    if not isinstance(metadata, dict):
        return []
    greeting_cron = metadata.get("greeting_cron")
    if not isinstance(greeting_cron, dict):
        return []

    candidates: list[str] = []
    for source in (greeting_cron, metadata.get("openclaw_metadata")):
        if not isinstance(source, dict):
            continue
        for key in ("audioFile", "audio_file"):
            for path in _storage_audio_path_candidates(source.get(key)):
                _add_candidate(candidates, path)
        for key in ("textFile", "text_file"):
            for path in _storage_audio_path_candidates(source.get(key)):
                _add_candidate(candidates, path)
    return candidates


def _voice_storage_audio_url(app, path: str) -> str | None:
    builder = getattr(app.state.tts_client, "eula_storage_url", None)
    if builder is None:
        return None
    return builder(path)


async def _referenceable_voice_storage_media_type(app, remote_audio_url: str) -> str | None:
    http_client = getattr(app.state.tts_client, "http_client", None)
    if http_client is None:
        return None
    try:
        response = await http_client.get(
            remote_audio_url,
            headers={"Range": "bytes=0-0"},
            timeout=app.state.settings.tts_service_timeout_seconds,
        )
    except Exception:
        return None
    if not response.is_success:
        return None
    media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    return media_type if media_type.startswith("audio/") else None


def _voice_storage_probe_delay_seconds(app, failed_attempt_index: int) -> float:
    poll_interval = float(getattr(app.state.settings, "tts_service_poll_interval_seconds", 0) or 0)
    base_delay_seconds = max(0.0, min(_VOICE_STORAGE_PROBE_MAX_DELAY_SECONDS, poll_interval))
    return base_delay_seconds * (failed_attempt_index + 1)


async def _probe_voice_storage_audio(app, remote_audio_url: str) -> str | None:
    for attempt in range(_VOICE_STORAGE_PROBE_ATTEMPTS):
        media_type = await _referenceable_voice_storage_media_type(app, remote_audio_url)
        if media_type is not None:
            return media_type
        delay_seconds = _voice_storage_probe_delay_seconds(app, attempt)
        if attempt < _VOICE_STORAGE_PROBE_ATTEMPTS - 1 and delay_seconds > 0:
            await asyncio.sleep(delay_seconds)
    return None


async def _create_voice_storage_tts_reference(
    app,
    message: dict,
    *,
    trace_user_id: str,
    trace_session_id: str,
    event_trace_id: str,
) -> dict | None:
    audio_paths = _greeting_storage_audio_paths(message)
    if not audio_paths:
        return None
    selected: tuple[str, str, str] | None = None
    for audio_path in audio_paths:
        remote_audio_url = _voice_storage_audio_url(app, audio_path)
        if remote_audio_url is None:
            continue
        media_type = await _probe_voice_storage_audio(app, remote_audio_url)
        if media_type is not None:
            selected = (audio_path, remote_audio_url, media_type)
            break
    if selected is None:
        return None
    audio_path, remote_audio_url, media_type = selected

    store = app.state.trace_store
    tts = store.create_message_tts(
        message["workspace_id"],
        message["id"],
        status="ready",
        task_id=f"eula-storage:{audio_path}",
        remote_audio_url=remote_audio_url,
        media_type=media_type,
    )
    store.insert_event(
        trace_id=event_trace_id,
        user_id=trace_user_id,
        session_id=trace_session_id,
        stage="message_service.tts.reference",
        status="ok",
        latency_ms=None,
        payload={
            "message_id": message["id"],
            "tts_id": tts["id"],
            "task_id": tts["task_id"],
            "remote_audio_url": remote_audio_url,
            "media_type": media_type,
            "source": "voice_storage_interface_5",
            "storage_path": audio_path,
        },
    )
    return tts


async def create_or_enqueue_message_tts_reference(
    app,
    message: dict,
    *,
    trace_user_id: str,
    trace_session_id: str,
    trace_id: str | None = None,
) -> dict:
    store = app.state.trace_store
    event_trace_id = trace_id or message.get("trace_id") or f"message-tts-{uuid4()}"
    storage_tts = await _create_voice_storage_tts_reference(
        app,
        message,
        trace_user_id=trace_user_id,
        trace_session_id=trace_session_id,
        event_trace_id=event_trace_id,
    )
    if storage_tts is not None:
        return storage_tts

    store.insert_event(
        trace_id=event_trace_id,
        user_id=trace_user_id,
        session_id=trace_session_id,
        stage="message_service.tts.submit",
        status="start",
        latency_ms=None,
        payload={
            "message_id": message["id"],
            "text_length": len(message["content"]),
            "emotion_label": message.get("tts_emotion_label"),
            "pause_profile": message.get("tts_pause_profile") or "podcast",
        },
    )
    task_id = await app.state.tts_client.submit_task(
        text=message["content"],
        emotion_label=message.get("tts_emotion_label"),
        pause_profile=message.get("tts_pause_profile") or "podcast",
    )
    store.insert_event(
        trace_id=event_trace_id,
        user_id=trace_user_id,
        session_id=trace_session_id,
        stage="message_service.tts.submit",
        status="ok",
        latency_ms=None,
        payload={"message_id": message["id"], "task_id": task_id},
    )
    speech = await app.state.tts_client.wait_for_reference(
        task_id,
        max_wait_seconds=app.state.settings.tts_sync_wait_seconds,
    )
    if speech is not None:
        tts = store.create_message_tts(
            message["workspace_id"],
            message["id"],
            status="ready",
            task_id=speech.task_id,
            remote_audio_url=speech.audio_url,
            media_type=speech.media_type,
            duration_seconds=speech.duration_seconds,
            chunks_count=speech.chunks_count,
        )
        store.insert_event(
            trace_id=event_trace_id,
            user_id=trace_user_id,
            session_id=trace_session_id,
            stage="message_service.tts.reference",
            status="ok",
            latency_ms=None,
            payload={
                "message_id": message["id"],
                "tts_id": tts["id"],
                "task_id": speech.task_id,
                "remote_audio_url": speech.audio_url,
                "media_type": speech.media_type,
                "duration_seconds": speech.duration_seconds,
                "chunks_count": speech.chunks_count,
                "source": "sync_wait",
            },
        )
        return tts

    tts = store.create_message_tts(
        message["workspace_id"],
        message["id"],
        status="pending",
        task_id=task_id,
        remote_audio_url=None,
        media_type=None,
    )
    store.cancel_tts_jobs_for_message(message["workspace_id"], message["id"])
    job = store.create_tts_job(message["workspace_id"], message["id"], tts["id"])
    store.insert_event(
        trace_id=event_trace_id,
        user_id=trace_user_id,
        session_id=trace_session_id,
        stage="message_service.tts.reference",
        status="pending",
        latency_ms=None,
        payload={
            "message_id": message["id"],
            "tts_id": tts["id"],
            "task_id": task_id,
            "job_id": job["id"],
            "source": "worker_queue",
        },
        error_code="tts_sync_wait_timeout",
    )
    return tts
