from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.responses import Response

from app.services.daily_podcast import DailyPodcast, DailyPodcastRefreshCooldown, DailyPodcastService
from app.services.voice_workflow_tts_client import VoiceWorkflowTtsError


router = APIRouter(prefix="/podcasts", tags=["podcasts"])


@router.get("/daily/latest")
async def get_latest_daily_podcast(request: Request):
    podcast = await _service(request).latest()
    return {"podcast": _serialize_podcast(podcast)}


@router.post("/daily/refresh")
async def refresh_daily_podcast(request: Request):
    service = _service(request)
    refresh = await _refresh_cooldown(request).reserve()
    refresh_error = None
    if refresh.triggered:
        try:
            await service.refresh_latest()
        except VoiceWorkflowTtsError as exc:
            refresh_error = str(exc)
    podcast = await service.latest()
    return {
        "podcast": _serialize_podcast(podcast),
        "refresh": {
            "triggered": refresh.triggered,
            "cooldown_seconds": refresh.cooldown_seconds,
            "retry_after_seconds": refresh.retry_after_seconds,
            "error": refresh_error,
        },
    }


@router.get("/daily")
async def list_daily_podcasts(request: Request, days: int = Query(default=30)):
    safe_days = min(90, max(1, days))
    items = await _service(request).list_recent(days=safe_days)
    return {"days": safe_days, "items": [_serialize_podcast(item) for item in items]}


@router.get("/daily/{date}")
async def get_daily_podcast(date: str, request: Request):
    podcast = await _service(request).by_date(date)
    return {"podcast": _serialize_podcast(podcast)}


@router.get("/daily/{date}/audio")
async def get_daily_podcast_audio(date: str, request: Request, format: str = "preferred"):
    podcast = await _service(request).by_date(date)
    if podcast.audio.remote_url is None:
        raise HTTPException(status_code=404, detail="Podcast audio not found.")

    headers = {}
    incoming_range = request.headers.get("range")
    if incoming_range:
        headers["Range"] = incoming_range

    tts_client = request.app.state.tts_client
    response = await tts_client.http_client.get(
        podcast.audio.remote_url,
        headers=headers,
        timeout=tts_client.timeout_seconds,
    )
    if not response.is_success:
        return Response(status_code=response.status_code)

    media_type = response.headers.get("content-type", podcast.audio.format or "application/octet-stream")
    media_type = media_type.split(";", 1)[0] or (podcast.audio.format or "application/octet-stream")
    preserved_headers = {
        name: value
        for name, value in response.headers.items()
        if name.lower() in {"accept-ranges", "content-range", "content-length", "last-modified", "etag"}
    }
    return Response(
        content=response.content,
        status_code=response.status_code,
        media_type=media_type,
        headers=preserved_headers,
    )


def _service(request: Request) -> DailyPodcastService:
    return DailyPodcastService(tts_client=request.app.state.tts_client)


def _refresh_cooldown(request: Request) -> DailyPodcastRefreshCooldown:
    existing = getattr(request.app.state, "daily_podcast_refresh_cooldown", None)
    if isinstance(existing, DailyPodcastRefreshCooldown):
        return existing
    cooldown = DailyPodcastRefreshCooldown(cooldown_seconds=10)
    request.app.state.daily_podcast_refresh_cooldown = cooldown
    return cooldown


def _serialize_podcast(podcast: DailyPodcast) -> dict:
    payload = asdict(podcast)
    payload.pop("meta_path", None)
    payload["audio"].pop("remote_url", None)
    return payload
