from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.services.voice_workflow_tts_client import VoiceWorkflowTtsChunk


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


class FakeRealtimeTtsClient:
    def __init__(self):
        self.chunk_calls = []
        self.cancel_calls = []
        self.http_client = httpx.AsyncClient(transport=httpx.MockTransport(self._handle_proxy))

    async def synthesize_chunk(
        self,
        *,
        text: str,
        emotion_label: str | None = None,
        pause_profile: str = "podcast",
        session_id: str | None = None,
        sequence: int | None = None,
    ):
        self.chunk_calls.append(
            {
                "text": text,
                "emotion_label": emotion_label,
                "pause_profile": pause_profile,
                "session_id": session_id,
                "sequence": sequence,
            }
        )
        seq = sequence or 1
        return VoiceWorkflowTtsChunk(
            session_id=session_id or "tts-session",
            sequence=seq,
            status="ready",
            audio_url=f"http://tts.local/audio/{session_id}/{seq:04d}.wav",
            duration_seconds=1.2,
            elapsed_seconds=0.8,
        )

    async def cancel_realtime(self, session_id: str):
        self.cancel_calls.append(session_id)
        return True

    def _handle_proxy(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/audio/"):
            return httpx.Response(status_code=200, content=b"chunk-audio", headers={"content-type": "audio/wav"})
        return httpx.Response(status_code=404)


class FailingRealtimeTtsClient(FakeRealtimeTtsClient):
    async def synthesize_chunk(
        self,
        *,
        text: str,
        emotion_label: str | None = None,
        pause_profile: str = "podcast",
        session_id: str | None = None,
        sequence: int | None = None,
    ):
        self.chunk_calls.append(
            {
                "text": text,
                "emotion_label": emotion_label,
                "pause_profile": pause_profile,
                "session_id": session_id,
                "sequence": sequence,
            }
        )
        raise RuntimeError("chunk backend crashed")


def _client() -> tuple[TestClient, object, FakeRealtimeTtsClient]:
    app = create_app(
        {
            "data_dir": str(_make_case_dir()),
            "admin_user_ids": [],
            "tts_service_enabled": True,
            "realtime_voice_enabled": True,
            "realtime_voice_max_queue_size": 3,
            # 这些用例只验证业务行为，不测认证；显式关掉 JWT，避免继承本地 api/.env
            # 的 JWT_SECRET 而把请求拦成 401。
            "jwt_secret": "",
        }
    )
    fake_tts = FakeRealtimeTtsClient()
    app.state.tts_client = fake_tts
    client = TestClient(app, headers={"x-user-id": "u1"})
    client.__enter__()
    return client, app, fake_tts


def test_voice_websocket_requires_query_user_id():
    client, _, _ = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/sessions/{session_id}/voice"):
            pass


def test_voice_websocket_rejects_unauthorized_session():
    client, _, _ = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/sessions/{session_id}/voice?user_id=u2"):
            pass


def test_voice_websocket_synthesize_emits_audio_ready_and_done():
    client, _, fake_tts = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    with client.websocket_connect(f"/ws/sessions/{session_id}/voice?user_id=u1") as websocket:
        websocket.send_json(
            {
                "type": "synthesize",
                "job_id": "job-1",
                "message_id": "msg-1",
                "text": "hello.",
                "emotion_label": "daily",
            }
        )

        assert websocket.receive_json() == {
            "type": "queued",
            "session_id": session_id,
            "message_id": "msg-1",
            "job_id": "job-1",
            "queue_position": 1,
        }
        assert websocket.receive_json() == {
            "type": "synthesis_started",
            "session_id": session_id,
            "message_id": "msg-1",
            "job_id": "job-1",
        }
        audio_ready = websocket.receive_json()
        assert audio_ready == {
            "type": "audio_ready",
            "session_id": session_id,
            "message_id": "msg-1",
            "job_id": "job-1",
            "sequence": 1,
            "text": "hello.",
            "audio_url": f"/tts/proxy/realtime/{session_id}/job-1/1",
            "duration": 1.2,
            "elapsed_seconds": 0.8,
        }
        assert websocket.receive_json() == {
            "type": "done",
            "session_id": session_id,
            "message_id": "msg-1",
            "job_id": "job-1",
        }

    assert fake_tts.chunk_calls == [
        {
            "text": "hello.",
            "emotion_label": "daily",
            "pause_profile": "podcast",
            "session_id": session_id,
            "sequence": 1,
        }
    ]


def test_voice_websocket_reports_unexpected_chunk_errors():
    client, app, _ = _client()
    failing_tts = FailingRealtimeTtsClient()
    app.state.tts_client = failing_tts
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    with client.websocket_connect(f"/ws/sessions/{session_id}/voice?user_id=u1") as websocket:
        websocket.send_json(
            {
                "type": "synthesize",
                "job_id": "job-1",
                "message_id": "msg-1",
                "text": "hello.",
            }
        )

        assert websocket.receive_json()["type"] == "queued"
        assert websocket.receive_json()["type"] == "synthesis_started"
        error = websocket.receive_json()

    assert error == {
        "type": "error",
        "session_id": session_id,
        "message_id": "msg-1",
        "job_id": "job-1",
        "detail": "Realtime voice synthesis failed unexpectedly.",
    }
    assert failing_tts.chunk_calls == [
        {
            "text": "hello.",
            "emotion_label": None,
            "pause_profile": "podcast",
            "session_id": session_id,
            "sequence": 1,
        }
    ]


def test_realtime_proxy_serves_registered_chunk_audio():
    client, app, _ = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]
    app.state.realtime_voice_registry.register(
        session_id=session_id,
        job_id="job-1",
        sequence=1,
        user_id="u1",
        remote_audio_url="http://tts.local/audio/session/0001.wav",
        media_type="audio/wav",
    )

    response = client.get(f"/tts/proxy/realtime/{session_id}/job-1/1?user_id=u1")

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == b"chunk-audio"
