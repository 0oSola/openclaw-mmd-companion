from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from app.models.chat import OpenClawReply


class FakeOpenClawClient:
    async def generate_reply(self, user_id, session_id, message, history):
        return OpenClawReply(
            raw_text='{"text":"Hello back","emotion":"happy","action":"wave","memory_ops":[]}',
            endpoint_used="/v1/responses",
            status_code=200,
        )


def _make_case_dir() -> Path:
    path = Path("D:/workspace/MMD project/api/tests_runtime") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_chat_endpoint_returns_normalized_payload():
    case_dir = _make_case_dir()
    app = create_app(
        {
            "data_dir": str(case_dir),
            "admin_user_ids": ["admin-1"],
            # 这些用例只验证业务行为，不测认证；显式关掉 JWT，避免继承
            # 本地 api/.env 里的 JWT_SECRET 而把请求拦成 401。
            "jwt_secret": "",
        }
    )
    app.state.openclaw_client = FakeOpenClawClient()
    client = TestClient(app, headers={"x-user-id": "u1"})

    response = client.post(
        "/chat",
        json={"user_id": "u1", "message": "hello", "session_id": "s1", "history": []},
        headers={"x-trace-id": "trace-abc"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["trace_id"] == "trace-abc"
    assert payload["text"] == "Hello back"
    assert payload["emotion"] == "happy"
    assert payload["action"] == "wave"
    assert payload["motion_plan"] == {
        "sequence": [
            {"template": "greet_wave", "duration_ms": 1600, "intensity": 0.7},
            {"template": "listen_lean", "duration_ms": 1800, "intensity": 0.45},
        ]
    }
    assert payload["parse_mode"] == "json_raw"

    trace_events = client.get("/trace/events", headers={"x-user-id": "u1"})
    assert trace_events.status_code == 200
    assert any(item["trace_id"] == "trace-abc" for item in trace_events.json()["items"])
