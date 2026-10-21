from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse, Response

from app.services.voice_workflow_tts_client import VoiceWorkflowTtsError


router = APIRouter(prefix="/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str = Field(default="default", max_length=120)
    session_id: str | None = Field(default=None, max_length=120)
    pause_profile: str = Field(default="podcast", pattern="^(podcast|none)$")


@router.post("/speak")
async def tts_speak(payload: TTSRequest, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    if not settings.tts_service_enabled:
        return JSONResponse(
            status_code=501,
            content={
                "configured": False,
                "message": "Server-side TTS is not configured. Use browser TTS or enable TTS_SERVICE_ENABLED.",
            },
        )

    try:
        speech = await request.app.state.tts_client.synthesize(
            text=payload.text,
            emotion_label=payload.voice,
            pause_profile=payload.pause_profile,
        )
    except VoiceWorkflowTtsError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    return Response(
        content=speech.audio,
        media_type=speech.media_type,
        headers={
            "x-tts-task-id": speech.task_id,
            "x-tts-audio-url": speech.audio_url,
        },
    )
