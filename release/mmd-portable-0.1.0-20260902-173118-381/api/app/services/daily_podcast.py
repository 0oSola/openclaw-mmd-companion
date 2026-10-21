from __future__ import annotations

import asyncio
import math
import re
import time
from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime, timedelta
from typing import Any

import httpx

from app.services.voice_workflow_tts_client import VoiceWorkflowTtsClient, VoiceWorkflowTtsError


@dataclass(slots=True)
class PodcastAudio:
    url: str | None
    remote_url: str | None
    format: str | None
    bytes: int | None
    source: str | None


@dataclass(slots=True)
class DailyPodcast:
    date: str
    status: str
    doc_url: str | None
    doc_links: dict[str, str]
    audio: PodcastAudio
    counts: dict[str, int]
    script_chars: int | None
    updated_at: str | None
    audio_error: str | None
    meta_path: str | None


@dataclass(slots=True)
class DailyPodcastRefreshDecision:
    triggered: bool
    cooldown_seconds: int
    retry_after_seconds: int


class DailyPodcastRefreshCooldown:
    def __init__(self, *, cooldown_seconds: int = 10, now_factory=time.monotonic) -> None:
        self.cooldown_seconds = max(1, int(cooldown_seconds))
        self._now_factory = now_factory
        self._lock = asyncio.Lock()
        self._last_refresh_at: float | None = None

    async def reserve(self) -> DailyPodcastRefreshDecision:
        async with self._lock:
            now = self._now_factory()
            if self._last_refresh_at is not None:
                elapsed = now - self._last_refresh_at
                if elapsed < self.cooldown_seconds:
                    return DailyPodcastRefreshDecision(
                        triggered=False,
                        cooldown_seconds=self.cooldown_seconds,
                        retry_after_seconds=max(1, math.ceil(self.cooldown_seconds - elapsed)),
                    )
            self._last_refresh_at = now
            return DailyPodcastRefreshDecision(
                triggered=True,
                cooldown_seconds=self.cooldown_seconds,
                retry_after_seconds=self.cooldown_seconds,
            )


@dataclass(slots=True)
class _StorageResponse:
    response: httpx.Response | None
    error: str | None


def podcast_meta_storage_path(podcast_date: str) -> str:
    parsed = _parse_date(podcast_date)
    compact = parsed.strftime("%Y%m%d")
    return parsed.strftime(f"podcast/%Y/%m/%d/podcast_{compact}.meta.json")


class DailyPodcastService:
    def __init__(self, *, tts_client: VoiceWorkflowTtsClient) -> None:
        self.tts_client = tts_client

    async def refresh_latest(self) -> dict[str, Any]:
        refresh = getattr(self.tts_client, "refresh_daily_podcast", None)
        if not callable(refresh):
            raise VoiceWorkflowTtsError("Voice Workflow client does not support daily podcast refresh.")
        result = await refresh()
        return result if isinstance(result, dict) else {}

    async def latest(self) -> DailyPodcast:
        latest, error = await self._fetch_json("podcast/latest.json")
        if error:
            podcast_date = Date.today().isoformat()
            return _failed_podcast(podcast_date, podcast_meta_storage_path(podcast_date), error)
        podcast_date = _string_or_none(latest.get("date"))
        meta_path = _string_or_none(latest.get("metaPath"))
        if not podcast_date and meta_path:
            podcast_date = _date_from_meta_path(meta_path)
        podcast_date = podcast_date or Date.today().isoformat()
        return await self._load_by_meta_path(podcast_date, meta_path or podcast_meta_storage_path(podcast_date))

    async def by_date(self, date: str) -> DailyPodcast:
        podcast_date = _parse_date(date).isoformat()
        return await self._load_by_meta_path(podcast_date, podcast_meta_storage_path(podcast_date))

    async def list_recent(self, *, days: int = 30) -> list[DailyPodcast]:
        latest, error = await self._fetch_json("podcast/latest.json")
        if error:
            return []
        latest_date = _string_or_none(latest.get("date"))
        meta_path = _string_or_none(latest.get("metaPath"))
        if not latest_date and meta_path:
            latest_date = _date_from_meta_path(meta_path)
        if not latest_date:
            return []
        start_date = _parse_date(latest_date)
        safe_days = max(1, days)
        items: list[DailyPodcast] = []
        for offset in range(safe_days):
            current_date = (start_date - timedelta(days=offset)).isoformat()
            item = await self.by_date(current_date)
            if item.status != "missing":
                items.append(item)
        return items

    async def _load_by_meta_path(self, podcast_date: str, meta_path: str) -> DailyPodcast:
        result = await self._get(meta_path)
        if result.error:
            return _failed_podcast(podcast_date, meta_path, result.error)
        response = result.response
        if response is None:
            return _failed_podcast(podcast_date, meta_path, "Voice Workflow request failed")
        if response.status_code == 404:
            return _missing_podcast(podcast_date, meta_path)
        if not response.is_success:
            return _failed_podcast(podcast_date, meta_path, f"meta returned HTTP {response.status_code}")

        try:
            meta = response.json()
        except ValueError:
            return _failed_podcast(podcast_date, meta_path, "meta returned invalid JSON")

        return await self._from_meta(podcast_date, meta_path, meta)

    async def _from_meta(self, podcast_date: str, meta_path: str, meta: dict[str, Any]) -> DailyPodcast:
        artifacts = meta.get("artifacts") if isinstance(meta.get("artifacts"), dict) else {}
        audio_meta = _dict_or_empty(meta.get("audio")) or _dict_or_empty(artifacts.get("audio"))
        ogg_path = _string_or_none(audio_meta.get("oggPath"))
        wav_path = _string_or_none(audio_meta.get("wavPath"))
        audio = await self._select_audio(podcast_date, ogg_path=ogg_path, wav_path=wav_path)
        doc_url = _string_or_none(meta.get("docUrl")) or _string_or_none(artifacts.get("docUrl"))
        ok = bool(meta.get("ok", False))

        if audio.url:
            status = "ready"
            audio_error = None
        elif doc_url:
            status = "partial"
            audio_error = "audio unavailable"
        elif not ok:
            status = "failed"
            audio_error = _string_or_none(meta.get("error"))
        else:
            status = "failed"
            audio_error = "podcast has no document or audio"

        return DailyPodcast(
            date=_string_or_none(meta.get("date")) or podcast_date,
            status=status,
            doc_url=doc_url,
            doc_links=_string_dict(meta.get("docLinks")),
            audio=audio,
            counts=_int_dict(meta.get("counts")),
            script_chars=_int_or_none(meta.get("scriptChars")),
            updated_at=_string_or_none(meta.get("updatedAt")),
            audio_error=audio_error,
            meta_path=meta_path,
        )

    async def _select_audio(self, podcast_date: str, *, ogg_path: str | None, wav_path: str | None) -> PodcastAudio:
        for source, path in (("ogg", ogg_path), ("wav", wav_path)):
            if not path:
                continue
            probed = await self._probe_audio(podcast_date, source=source, path=path)
            if probed is not None:
                return probed
        return PodcastAudio(url=None, remote_url=None, format=None, bytes=None, source=None)

    async def _probe_audio(self, podcast_date: str, *, source: str, path: str) -> PodcastAudio | None:
        url = self.tts_client.eula_storage_url(_normalize_storage_path(path))
        try:
            response = await self.tts_client.http_client.get(
                url,
                headers={"Range": "bytes=0-1023"},
                timeout=self.tts_client.timeout_seconds,
            )
        except httpx.HTTPError:
            return None

        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if not response.is_success or not content_type.startswith("audio/"):
            return None

        return PodcastAudio(
            url=f"/podcasts/daily/{podcast_date}/audio?format=preferred",
            remote_url=url,
            format=content_type,
            bytes=_audio_total_bytes(response.headers),
            source=source,
        )

    async def _fetch_json(self, path: str) -> tuple[dict[str, Any], str | None]:
        result = await self._get(path)
        if result.error:
            return {}, result.error
        response = result.response
        if response is None:
            return {}, "Voice Workflow request failed"
        if not response.is_success:
            return {}, None
        try:
            data = response.json()
        except ValueError:
            return {}, None
        return data if isinstance(data, dict) else {}, None

    async def _get(self, path: str) -> _StorageResponse:
        try:
            response = await self.tts_client.http_client.get(
                self.tts_client.eula_storage_url(_normalize_storage_path(path)),
                timeout=self.tts_client.timeout_seconds,
            )
        except httpx.HTTPError as exc:
            return _StorageResponse(response=None, error=_request_error(exc))
        return _StorageResponse(response=response, error=None)


def _missing_podcast(podcast_date: str, meta_path: str | None) -> DailyPodcast:
    return DailyPodcast(
        date=podcast_date,
        status="missing",
        doc_url=None,
        doc_links={},
        audio=PodcastAudio(url=None, remote_url=None, format=None, bytes=None, source=None),
        counts={},
        script_chars=None,
        updated_at=None,
        audio_error=None,
        meta_path=meta_path,
    )


def _failed_podcast(podcast_date: str, meta_path: str | None, error: str) -> DailyPodcast:
    return DailyPodcast(
        date=podcast_date,
        status="failed",
        doc_url=None,
        doc_links={},
        audio=PodcastAudio(url=None, remote_url=None, format=None, bytes=None, source=None),
        counts={},
        script_chars=None,
        updated_at=None,
        audio_error=error,
        meta_path=meta_path,
    )


def _request_error(exc: httpx.HTTPError) -> str:
    detail = str(exc).strip()
    return f"Voice Workflow request failed: {detail}" if detail else "Voice Workflow request failed"


def _normalize_storage_path(path: str) -> str:
    if path.startswith(("http://", "https://")):
        return path
    normalized = path.replace("\\", "/")
    marker = "/podcast/"
    marker_index = normalized.find(marker)
    if marker_index >= 0:
        return normalized[marker_index + 1 :]
    if normalized.startswith("podcast/"):
        return normalized
    return normalized.lstrip("/")


def _audio_total_bytes(headers: httpx.Headers) -> int | None:
    content_range = headers.get("content-range")
    if content_range:
        match = re.search(r"/(\d+)\s*$", content_range)
        if match:
            return int(match.group(1))

    content_length = headers.get("content-length")
    if content_length and content_length.isdigit():
        return int(content_length)
    return None


def _parse_date(raw: str) -> Date:
    return datetime.strptime(raw, "%Y-%m-%d").date()


def _date_from_meta_path(path: str) -> str | None:
    match = re.search(r"podcast_(\d{4})(\d{2})(\d{2})\.meta\.json$", path)
    if not match:
        return None
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"


def _string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def _string_dict(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in value.items() if isinstance(item, str)}


def _int_dict(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in value.items() if isinstance(item, int)}
