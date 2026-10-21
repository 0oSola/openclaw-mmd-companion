from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=5000)
    session_id: str | None = None
    history: list[ChatMessage] = Field(default_factory=list)


class MotionStep(BaseModel):
    template: str = Field(min_length=1, max_length=80)
    duration_ms: int = Field(ge=300, le=6000)
    intensity: float = Field(ge=0.1, le=1.0)


class MotionPlan(BaseModel):
    sequence: list[MotionStep] = Field(default_factory=list)


class ChatResponse(BaseModel):
    trace_id: str
    text: str
    emotion: str
    action: str
    motion_plan: MotionPlan | None = None
    memory_ops: list[dict[str, Any]]
    parse_mode: str
    endpoint_used: str
    degraded: bool = False
    fallback_reason: str | None = None


@dataclass(slots=True)
class OpenClawReply:
    raw_text: str
    endpoint_used: str
    status_code: int


@dataclass(slots=True)
class OpenClawSpeech:
    audio: bytes
    media_type: str
    endpoint_used: str
    status_code: int
