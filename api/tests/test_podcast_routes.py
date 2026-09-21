from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.voice_workflow_tts_client import VoiceWorkflowTtsError


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass(slots=True)
class FakePodcastTtsClient:
    http_client: httpx.AsyncClient
    timeout_seconds: int = 5
    base_url: str = "http://voice.local"
    refresh_calls: int = 0
    refresh_error: str | None = None

    def eula_storage_url(self, path: str) -> str:
        return f"{self.base_url}/api/v1/eula-storage-audio/{path.lstrip('/')}"

    async def refresh_daily_podcast(self) -> dict:
        self.refresh_calls += 1
        if self.refresh_error:
            raise VoiceWorkflowTtsError(self.refresh_error)
        return {"status": "accepted"}

    async def close(self) -> None:
        await self.http_client.aclose()


def _latest_payload(date: str = "2026-05-18") -> dict:
    compact = date.replace("-", "")
    return {
        "date": date,
        "metaPath": f"podcast/{date[0:4]}/{date[5:7]}/{date[8:10]}/podcast_{compact}.meta.json",
    }


def _meta_payload(date: str = "2026-05-18", *, with_audio: bool = True) -> dict:
    compact = date.replace("-", "")
    base_path = f"podcast/{date[0:4]}/{date[5:7]}/{date[8:10]}/podcast_{compact}"
    return {
        "ok": True,
        "date": date,
        "docUrl": "https://docs.local/daily",
        "docLinks": {"main": "https://docs.local/daily"},
        "counts": {"headlines": 3},
        "scriptChars": 1200,
        "updatedAt": "2026-05-18T09:00:00Z",
        "audio": {
            "oggPath": f"{base_path}.ogg" if with_audio else None,
            "wavPath": f"{base_path}.wav" if with_audio else None,
        },
    }


def _client(handler) -> TestClient:
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": [], "tts_service_enabled": True})
    transport = httpx.MockTransport(handler)
    app.state.tts_client = FakePodcastTtsClient(http_client=httpx.AsyncClient(transport=transport))
    return TestClient(app)


def _handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/v1/eula-storage-audio/podcast/latest.json":
        return httpx.Response(status_code=200, json=_latest_payload())
    if request.url.path.endswith("podcast_20260518.meta.json"):
        return httpx.Response(status_code=200, json=_meta_payload("2026-05-18"))
    if request.url.path.endswith("podcast_20260518.ogg"):
        return httpx.Response(
            status_code=206,
            content=b"ogg-range",
            headers={
                "content-type": "audio/ogg",
                "accept-ranges": "bytes",
                "content-range": "bytes 0-1023/1388346",
                "content-length": "9",
                "etag": '"podcast-ogg"',
            },
        )
    return httpx.Response(status_code=404)


def test_get_latest_podcast_returns_normalized_payload():
    client = _client(_handler)

    response = client.get("/podcasts/daily/latest", headers={"x-user-id": "u1"})

    assert response.status_code == 200
    assert response.json()["podcast"]["date"] == "2026-05-18"
    assert response.json()["podcast"]["audio"]["url"] == "/podcasts/daily/2026-05-18/audio?format=preferred"


def test_list_podcasts_defaults_to_30_days():
    client = _client(_handler)

    response = client.get("/podcasts/daily", headers={"x-user-id": "u1"})

    assert response.status_code == 200
    assert response.json()["days"] == 30
    assert [item["date"] for item in response.json()["items"]] == ["2026-05-18"]


def test_podcast_audio_proxy_preserves_audio_headers_and_range():
    client = _client(_handler)

    response = client.get(
        "/podcasts/daily/2026-05-18/audio?format=preferred",
        headers={"x-user-id": "u1", "Range": "bytes=0-1023"},
    )

    assert response.status_code == 206
    assert response.headers["content-type"] == "audio/ogg"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-range"] == "bytes 0-1023/1388346"
    assert response.content == b"ogg-range"


def test_podcast_audio_proxy_returns_404_when_no_audio():
    client = _client(_handler)

    response = client.get("/podcasts/daily/2026-05-17/audio?format=preferred", headers={"x-user-id": "u1"})

    assert response.status_code == 404


def test_podcast_audio_proxy_accepts_query_user_id_for_audio_elements():
    """<audio src> 无法携带请求头，播放器只能把身份放进查询参数。

    中间件放行 /podcasts/daily/ 前缀，归属校验由路由读 user_id 完成。
    """
    client = _client(_handler)

    response = client.get("/podcasts/daily/2026-05-18/audio?format=preferred&user_id=u1")

    assert response.status_code in {200, 206}
    assert response.headers["content-type"] == "audio/ogg"


def test_podcast_audio_proxy_rejects_missing_query_user_id():
    client = _client(_handler)

    response = client.get("/podcasts/daily/2026-05-18/audio?format=preferred")

    assert response.status_code == 401


def test_refresh_daily_podcast_triggers_voice_and_returns_latest_payload():
    client = _client(_handler)

    response = client.post("/podcasts/daily/refresh", headers={"x-user-id": "u1"})

    assert response.status_code == 200
    assert response.json()["podcast"]["date"] == "2026-05-18"
    assert response.json()["refresh"] == {
        "triggered": True,
        "cooldown_seconds": 10,
        "retry_after_seconds": 10,
        "error": None,
    }
    assert client.app.state.tts_client.refresh_calls == 1


def test_refresh_daily_podcast_cools_down_voice_requests_for_10_seconds():
    client = _client(_handler)

    first = client.post("/podcasts/daily/refresh", headers={"x-user-id": "u1"})
    second = client.post("/podcasts/daily/refresh", headers={"x-user-id": "u1"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["podcast"]["date"] == "2026-05-18"
    assert second.json()["refresh"]["triggered"] is False
    assert second.json()["refresh"]["cooldown_seconds"] == 10
    assert 1 <= second.json()["refresh"]["retry_after_seconds"] <= 10
    assert client.app.state.tts_client.refresh_calls == 1


def test_refresh_daily_podcast_returns_latest_payload_when_voice_refresh_fails():
    client = _client(_handler)

    client.app.state.tts_client.refresh_error = "daily generator unavailable"

    response = client.post("/podcasts/daily/refresh", headers={"x-user-id": "u1"})

    assert response.status_code == 200
    assert response.json()["podcast"]["date"] == "2026-05-18"
    assert response.json()["refresh"]["triggered"] is True
    assert response.json()["refresh"]["error"] == "daily generator unavailable"
