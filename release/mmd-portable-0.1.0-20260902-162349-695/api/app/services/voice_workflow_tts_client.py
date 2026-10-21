from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx


_EULA_STORAGE_MARKER = "eula_emotion_revelation/"


class VoiceWorkflowTtsError(RuntimeError):
    """Raised when the voice workflow TTS service cannot produce audio."""


@dataclass(slots=True)
class VoiceWorkflowTtsAudio:
    audio: bytes
    media_type: str
    task_id: str
    audio_url: str


@dataclass(slots=True)
class VoiceWorkflowTtsReference:
    media_type: str
    task_id: str
    audio_url: str
    duration_seconds: float | None = None
    chunks_count: int | None = None


@dataclass(slots=True)
class VoiceWorkflowTtsChunk:
    session_id: str
    sequence: int
    status: str
    audio_url: str
    duration_seconds: float | None = None
    elapsed_seconds: float | None = None


class VoiceWorkflowTtsClient:
    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: int = 30,
        poll_interval_seconds: float = 3,
        max_poll_attempts: int = 40,
        daily_podcast_refresh_path: str = "/api/v1/podcast/daily/refresh",
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.poll_interval_seconds = poll_interval_seconds
        self.max_poll_attempts = max_poll_attempts
        self.daily_podcast_refresh_path = (
            daily_podcast_refresh_path
            if daily_podcast_refresh_path.startswith("/")
            else f"/{daily_podcast_refresh_path}"
        )
        self._external_client = http_client is not None
        self.http_client = http_client or httpx.AsyncClient(timeout=timeout_seconds)

    async def close(self) -> None:
        if not self._external_client:
            await self.http_client.aclose()

    @staticmethod
    def _format_response_error(service: str, response: httpx.Response) -> str:
        body = response.text.strip() or "Unknown error."
        return f"{service} failed with status {response.status_code}: {body}"

    @staticmethod
    def _normalize_emotion_label(emotion_label: str | None) -> str | None:
        if not emotion_label:
            return None
        label = emotion_label.strip()
        if not label or label == "default":
            return None
        return label

    async def submit_task(self, *, text: str, emotion_label: str | None, pause_profile: str) -> str:
        payload: dict[str, Any] = {
            "text": text,
            "pause_profile": pause_profile or "podcast",
        }
        normalized_label = self._normalize_emotion_label(emotion_label)
        if normalized_label:
            payload["emotion_label"] = normalized_label

        response = await self.http_client.post(
            f"{self.base_url}/api/v1/tts",
            json=payload,
            timeout=self.timeout_seconds,
        )
        if response.status_code != 202:
            raise VoiceWorkflowTtsError(self._format_response_error("Voice workflow TTS submit", response))

        data = response.json()
        task_id = data.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise VoiceWorkflowTtsError("Voice workflow TTS submit returned no task_id.")
        return task_id

    async def get_task_status(self, task_id: str) -> dict[str, Any]:
        response = await self.http_client.get(
            f"{self.base_url}/api/v1/tasks/{task_id}",
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            raise VoiceWorkflowTtsError(self._format_response_error("Voice workflow TTS task status", response))
        return response.json()

    def build_reference(self, task_id: str, task: dict[str, Any]) -> VoiceWorkflowTtsReference:
        status = str(task.get("status") or "").strip().lower()
        if status == "failed":
            raise VoiceWorkflowTtsError(str(task.get("error") or "Voice workflow TTS task failed."))
        if status != "completed":
            raise VoiceWorkflowTtsError(f"Voice workflow TTS task {task_id} is not completed.")

        audio_url = task.get("audio_url")
        if not isinstance(audio_url, str) or not audio_url:
            raise VoiceWorkflowTtsError(f"Voice workflow TTS task {task_id} completed without audio_url.")
        media_type = str(task.get("media_type") or task.get("content_type") or "audio/wav")
        duration = task.get("duration_seconds")
        chunks_count = task.get("chunks_count")
        return VoiceWorkflowTtsReference(
            media_type=media_type,
            task_id=task_id,
            audio_url=self._absolute_audio_url(audio_url),
            duration_seconds=duration if isinstance(duration, (int, float)) else None,
            chunks_count=chunks_count if isinstance(chunks_count, int) else None,
        )

    async def wait_for_reference(
        self,
        task_id: str,
        *,
        max_wait_seconds: float | None = None,
    ) -> VoiceWorkflowTtsReference | None:
        attempts = 0
        started = asyncio.get_running_loop().time()
        while True:
            task = await self.get_task_status(task_id)
            status = str(task.get("status") or "").strip().lower()
            if status == "completed":
                return self.build_reference(task_id, task)
            if status == "failed":
                raise VoiceWorkflowTtsError(str(task.get("error") or "Voice workflow TTS task failed."))

            attempts += 1
            if max_wait_seconds is None:
                if attempts >= self.max_poll_attempts:
                    raise VoiceWorkflowTtsError(f"Voice workflow TTS task {task_id} did not complete before timeout.")
            else:
                if asyncio.get_running_loop().time() - started >= max_wait_seconds:
                    return None

            await asyncio.sleep(self.poll_interval_seconds)

    async def _download(self, audio_url: str) -> tuple[bytes, str]:
        request_url = self._absolute_audio_url(audio_url)
        response = await self.http_client.get(request_url, timeout=self.timeout_seconds)
        if not response.is_success:
            raise VoiceWorkflowTtsError(self._format_response_error("Voice workflow TTS audio download", response))
        if not response.content:
            raise VoiceWorkflowTtsError("Voice workflow TTS returned empty audio.")
        media_type = response.headers.get("content-type", "audio/wav").split(";", 1)[0] or "audio/wav"
        return response.content, media_type

    def _absolute_audio_url(self, audio_url: str) -> str:
        if audio_url.startswith(("http://", "https://")):
            return audio_url
        if not audio_url.startswith("/"):
            audio_url = f"/{audio_url}"
        return f"{self.base_url}{audio_url}"

    @staticmethod
    def normalize_eula_storage_path(path: str) -> str:
        normalized = str(path or "").strip().replace("\\", "/")
        if not normalized:
            raise VoiceWorkflowTtsError("Voice workflow Eula storage path is empty.")
        marker_index = normalized.find(_EULA_STORAGE_MARKER)
        if marker_index >= 0:
            normalized = normalized[marker_index + len(_EULA_STORAGE_MARKER) :]
        normalized = normalized.lstrip("/")
        parts = [part for part in normalized.split("/") if part]
        if not parts or any(part in {".", ".."} for part in parts):
            raise VoiceWorkflowTtsError(f"Voice workflow Eula storage path is invalid: {path}")
        return "/".join(parts)

    def eula_storage_url(self, path: str) -> str:
        relative_path = self.normalize_eula_storage_path(path)
        encoded_path = quote(relative_path, safe="/")
        return f"{self.base_url}/api/v1/eula-storage-audio/{encoded_path}"

    async def synthesize_chunk(
        self,
        *,
        text: str,
        emotion_label: str | None = None,
        pause_profile: str = "podcast",
        session_id: str | None = None,
        sequence: int | None = None,
    ) -> VoiceWorkflowTtsChunk:
        payload: dict[str, Any] = {
            "text": text,
            "pause_profile": pause_profile or "podcast",
        }
        normalized_label = self._normalize_emotion_label(emotion_label)
        if normalized_label:
            payload["emotion_label"] = normalized_label
        if session_id:
            payload["session_id"] = session_id
        if sequence is not None:
            payload["sequence"] = sequence

        response = await self.http_client.post(
            f"{self.base_url}/api/v1/tts/chunk",
            json=payload,
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            raise VoiceWorkflowTtsError(self._format_response_error("Voice workflow TTS chunk", response))

        data = response.json()
        audio_url = data.get("audio_url")
        if not isinstance(audio_url, str) or not audio_url:
            raise VoiceWorkflowTtsError("Voice workflow TTS chunk returned no audio_url.")

        response_session_id = data.get("session_id")
        response_sequence = data.get("sequence")
        duration = data.get("duration", data.get("duration_seconds"))
        elapsed = data.get("elapsed_seconds")
        return VoiceWorkflowTtsChunk(
            session_id=response_session_id if isinstance(response_session_id, str) else (session_id or ""),
            sequence=response_sequence if isinstance(response_sequence, int) else (sequence or 1),
            status=str(data.get("status") or "ready"),
            audio_url=self._absolute_audio_url(audio_url),
            duration_seconds=duration if isinstance(duration, (int, float)) else None,
            elapsed_seconds=elapsed if isinstance(elapsed, (int, float)) else None,
        )

    async def cancel_realtime(self, session_id: str) -> bool:
        safe_session_id = session_id.strip()
        if not safe_session_id:
            raise VoiceWorkflowTtsError("Voice workflow TTS realtime cancel requires session_id.")
        response = await self.http_client.post(
            f"{self.base_url}/api/v1/tts/realtime/{safe_session_id}/cancel",
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            raise VoiceWorkflowTtsError(self._format_response_error("Voice workflow TTS realtime cancel", response))
        data = response.json()
        return bool(data.get("cancelled"))

    async def refresh_daily_podcast(self) -> dict[str, Any]:
        response = await self.http_client.post(
            f"{self.base_url}{self.daily_podcast_refresh_path}",
            timeout=self.timeout_seconds,
        )
        if response.status_code not in {200, 202}:
            raise VoiceWorkflowTtsError(self._format_response_error("Voice workflow daily podcast refresh", response))
        try:
            data = response.json()
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    async def synthesize_reference(
        self,
        *,
        text: str,
        emotion_label: str | None = None,
        pause_profile: str = "podcast",
    ) -> VoiceWorkflowTtsReference:
        task_id = await self.submit_task(text=text, emotion_label=emotion_label, pause_profile=pause_profile)
        reference = await self.wait_for_reference(task_id, max_wait_seconds=None)
        if reference is None:
            raise VoiceWorkflowTtsError(f"Voice workflow TTS task {task_id} did not complete before timeout.")
        return reference

    async def synthesize(
        self,
        *,
        text: str,
        emotion_label: str | None = None,
        pause_profile: str = "podcast",
    ) -> VoiceWorkflowTtsAudio:
        task_id = await self.submit_task(text=text, emotion_label=emotion_label, pause_profile=pause_profile)
        reference = await self.wait_for_reference(task_id, max_wait_seconds=None)
        if reference is None:
            raise VoiceWorkflowTtsError(f"Voice workflow TTS task {task_id} did not complete before timeout.")
        audio, media_type = await self._download(reference.audio_url)
        return VoiceWorkflowTtsAudio(
            audio=audio,
            media_type=media_type,
            task_id=task_id,
            audio_url=reference.audio_url,
        )
