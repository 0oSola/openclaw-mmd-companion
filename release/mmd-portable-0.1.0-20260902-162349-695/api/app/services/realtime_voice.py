from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from time import monotonic


SENTENCE_BOUNDARIES = set("。！？!?；;，,、\n")


def split_assistant_text(text: str, *, max_chars: int = 25, min_segment_chars: int = 10) -> list[str]:
    normalized = " ".join((text or "").split())
    if not normalized:
        return []

    segments: list[str] = []
    current: list[str] = []

    def flush() -> None:
        segment = "".join(current).strip()
        current.clear()
        if segment:
            segments.append(segment)

    for char in normalized:
        current.append(char)
        if char in SENTENCE_BOUNDARIES:
            flush()
            continue
        if len(current) >= max_chars:
            flush()

    flush()

    return segments


@dataclass(slots=True)
class RealtimeVoiceJob:
    job_id: str
    message_id: str
    text: str
    emotion_label: str | None = None


@dataclass(slots=True)
class RealtimeVoiceQueueResult:
    accepted: bool
    job: RealtimeVoiceJob | None = None
    queue_position: int | None = None
    reason: str | None = None
    fallback: str | None = None


class RealtimeVoiceQueue:
    def __init__(self, *, max_size: int) -> None:
        self.max_size = max(1, max_size)
        self._pending: deque[RealtimeVoiceJob] = deque()
        self.current_job: RealtimeVoiceJob | None = None

    def __len__(self) -> int:
        return len(self._pending) + (1 if self.current_job else 0)

    def enqueue(self, job: RealtimeVoiceJob) -> RealtimeVoiceQueueResult:
        if len(self) >= self.max_size:
            return RealtimeVoiceQueueResult(
                accepted=False,
                job=job,
                reason="queue_full",
                fallback="message_tts",
            )
        self._pending.append(job)
        return RealtimeVoiceQueueResult(accepted=True, job=job, queue_position=len(self._pending))

    def dequeue(self) -> RealtimeVoiceJob | None:
        if self.current_job is not None or not self._pending:
            return None
        self.current_job = self._pending.popleft()
        return self.current_job

    def complete_current(self) -> None:
        self.current_job = None

    def clear(self) -> None:
        self._pending.clear()
        self.current_job = None


@dataclass(slots=True)
class RealtimeVoiceChunkReference:
    session_id: str
    job_id: str
    sequence: int
    user_id: str
    remote_audio_url: str
    media_type: str = "audio/wav"


class RealtimeVoiceChunkRegistry:
    def __init__(self) -> None:
        self._items: dict[tuple[str, str, int], RealtimeVoiceChunkReference] = {}

    def register(
        self,
        *,
        session_id: str,
        job_id: str,
        sequence: int,
        user_id: str,
        remote_audio_url: str,
        media_type: str = "audio/wav",
    ) -> RealtimeVoiceChunkReference:
        reference = RealtimeVoiceChunkReference(
            session_id=session_id,
            job_id=job_id,
            sequence=sequence,
            user_id=user_id,
            remote_audio_url=remote_audio_url,
            media_type=media_type,
        )
        self._items[(session_id, job_id, sequence)] = reference
        return reference

    def get(self, *, session_id: str, job_id: str, sequence: int) -> RealtimeVoiceChunkReference | None:
        return self._items.get((session_id, job_id, sequence))


@dataclass(slots=True)
class CircuitDecision:
    accepted: bool
    state: str
    reason: str | None = None
    fallback: str | None = None


class SessionCircuitBreaker:
    def __init__(
        self,
        *,
        failure_threshold: int,
        window_seconds: int,
        open_seconds: int,
        now_fn: Callable[[], float] = monotonic,
    ) -> None:
        self.failure_threshold = max(1, failure_threshold)
        self.window_seconds = max(1, window_seconds)
        self.open_seconds = max(1, open_seconds)
        self.now_fn = now_fn
        self.state = "closed"
        self._failures: deque[tuple[float, str]] = deque()
        self._opened_at: float | None = None
        self._half_open_probe_in_progress = False

    def _prune_failures(self) -> None:
        cutoff = self.now_fn() - self.window_seconds
        while self._failures and self._failures[0][0] < cutoff:
            self._failures.popleft()

    def can_accept(self) -> CircuitDecision:
        if self.state == "closed":
            return CircuitDecision(accepted=True, state=self.state)

        now = self.now_fn()
        if self.state == "open":
            if self._opened_at is not None and now - self._opened_at >= self.open_seconds:
                self.state = "half_open"
                self._half_open_probe_in_progress = False
            else:
                return CircuitDecision(
                    accepted=False,
                    state=self.state,
                    reason="circuit_open",
                    fallback="message_tts",
                )

        if self.state == "half_open":
            if self._half_open_probe_in_progress:
                return CircuitDecision(
                    accepted=False,
                    state=self.state,
                    reason="circuit_open",
                    fallback="message_tts",
                )
            self._half_open_probe_in_progress = True
            return CircuitDecision(accepted=True, state=self.state)

        return CircuitDecision(accepted=True, state=self.state)

    def record_failure(self, reason: str) -> None:
        now = self.now_fn()
        if self.state == "half_open":
            self.state = "open"
            self._opened_at = now
            self._half_open_probe_in_progress = False
            return

        self._failures.append((now, reason))
        self._prune_failures()
        if len(self._failures) >= self.failure_threshold:
            self.state = "open"
            self._opened_at = now
            self._half_open_probe_in_progress = False

    def record_success(self) -> None:
        if self.state == "half_open":
            self.state = "closed"
            self._failures.clear()
            self._opened_at = None
            self._half_open_probe_in_progress = False
