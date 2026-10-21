from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app


def _case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _client() -> TestClient:
    return TestClient(
        create_app(
            {
                "data_dir": str(_case_dir()),
                "admin_user_ids": ["admin-1"],
            }
        )
    )


def _pet_session_payload(**overrides):
    payload = {
        "pet_session_id": "pet-1",
        "codex_session_id": "11111111-1111-1111-1111-111111111111",
        "workspace_id": "mmd-companion",
        "workspace_path": "D:/workspace/MMD project",
        "codex_home": "C:/Users/KSG/.codex",
        "display_title": None,
        "first_prompt_preview": "fix login layout and run checks",
        "last_summary": None,
        "last_status": "waiting_approval",
        "launch_mode": "workspace-write",
        "remote_url": "ws://127.0.0.1:4501",
        "app_server_pid": 1234,
        "app_server_port": 4501,
        "metadata": {"approval_count": 1},
    }
    payload.update(overrides)
    return payload


def test_desktop_pet_sessions_default_missing_workspace_to_review_workspace():
    client = _client()

    response = client.post(
        "/desktop-pet/sessions",
        json=_pet_session_payload(workspace_id=None),
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["workspace_id"] == "mmd-companion"


def test_shared_config_round_trip():
    client = _client()

    default = client.get("/desktop-pet/shared-config", headers={"x-user-id": "admin-1"})

    assert default.status_code == 200
    assert default.json() == {
        "user_id": "admin-1",
        "selected_model_path": None,
        "render_pipeline": "classic",
        "reze_stage_document": None,
        "updated_at": None,
    }

    updated = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": "Eula/Eula.pmx", "render_pipeline": "genshin"},
        headers={"x-user-id": "admin-1"},
    )

    assert updated.status_code == 200
    assert updated.json()["selected_model_path"] == "Eula/Eula.pmx"
    assert updated.json()["render_pipeline"] == "genshin"
    assert updated.json()["updated_at"]


def test_shared_config_round_trips_reze_stage_document():
    client = _client()
    document = {
        "version": 1,
        "scene": {"worldColor": "#ffffff", "keyIntensity": 1.2},
        "materialPresets": {"reze:material:0": "柔滑布料"},
        "grade": "中性",
        "gradeIntensity": 0.8,
        "backgroundEffect": "Shining Stars",
    }

    response = client.put(
        "/desktop-pet/shared-config",
        json={
            "selected_model_path": "Koleda/Koleda.pmx",
            "render_pipeline": "reze-k3",
            "reze_stage_document": document,
        },
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["reze_stage_document"] == document


def test_shared_config_accepts_full_render_pipeline_contract():
    client = _client()

    for render_pipeline in ["mio-reference", "reze-npr", "reze-design", "k3", "reze-k3", "v14d-game", "gf2"]:
        response = client.put(
            "/desktop-pet/shared-config",
            json={"selected_model_path": "Eula/Eula.pmx", "render_pipeline": render_pipeline},
            headers={"x-user-id": "admin-1"},
        )

        assert response.status_code == 200
        assert response.json()["render_pipeline"] == render_pipeline
        assert response.json()["selected_model_path"] == "Eula/Eula.pmx"


def test_shared_config_uses_requester_not_payload_user():
    client = _client()

    response = client.put(
        "/desktop-pet/shared-config",
        json={
            "user_id": "admin-1",
            "selected_model_path": "Ayaka/Ayaka.pmx",
            "render_pipeline": "classic",
        },
        headers={"x-user-id": "user-2"},
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == "user-2"


def test_shared_config_store_value_error_returns_422(monkeypatch):
    client = _client()

    def fail_upsert_companion_shared_config(**_: object):
        raise ValueError("render_pipeline store failure")

    monkeypatch.setattr(
        client.app.state.trace_store,
        "upsert_companion_shared_config",
        fail_upsert_companion_shared_config,
    )

    response = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": "Eula/Eula.pmx", "render_pipeline": "classic"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422
    assert "render_pipeline store failure" in response.json()["detail"]


def test_shared_config_get_isolated_by_requester():
    client = _client()

    updated = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": "Eula/Eula.pmx", "render_pipeline": "genshin"},
        headers={"x-user-id": "user-1"},
    )
    assert updated.status_code == 200

    other_user = client.get("/desktop-pet/shared-config", headers={"x-user-id": "user-2"})

    assert other_user.status_code == 200
    assert other_user.json() == {
        "user_id": "user-2",
        "selected_model_path": None,
        "render_pipeline": "classic",
        "reze_stage_document": None,
        "updated_at": None,
    }


def test_shared_config_rejects_invalid_pipeline():
    client = _client()

    response = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": None, "render_pipeline": "unknown"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422


def test_desktop_pet_sessions_crud():
    client = _client()

    created = client.post(
        "/desktop-pet/sessions",
        json=_pet_session_payload(),
        headers={"x-user-id": "admin-1"},
    )

    assert created.status_code == 200
    assert created.json()["display_title"] == "fix login layout and run checks"

    listed = client.get("/desktop-pet/sessions?limit=5", headers={"x-user-id": "admin-1"})
    assert listed.status_code == 200
    assert listed.json()["sessions"][0]["pet_session_id"] == "pet-1"
    assert listed.json()["sessions"][0]["metadata"]["approval_count"] == 1

    deleted = client.delete("/desktop-pet/sessions/pet-1", headers={"x-user-id": "admin-1"})
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}


def test_desktop_pet_sessions_limit_is_bounded():
    client = _client()

    response = client.get("/desktop-pet/sessions?limit=500", headers={"x-user-id": "admin-1"})

    assert response.status_code == 200
    assert response.json()["limit"] == 50


def test_desktop_pet_sessions_rejects_oversized_metadata_without_storing():
    client = _client()

    response = client.post(
        "/desktop-pet/sessions",
        json=_pet_session_payload(pet_session_id="pet-oversized", metadata={"blob": "x" * 31000}),
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422

    listed = client.get("/desktop-pet/sessions?limit=5", headers={"x-user-id": "admin-1"})
    assert listed.status_code == 200
    assert listed.json()["sessions"] == []


def test_desktop_pet_sessions_rejects_display_title_over_store_limit():
    client = _client()

    response = client.post(
        "/desktop-pet/sessions",
        json=_pet_session_payload(display_title="x" * 49),
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422


def test_desktop_pet_sessions_require_user_header():
    client = _client()

    listed = client.get("/desktop-pet/sessions")
    created = client.post("/desktop-pet/sessions", json=_pet_session_payload())
    deleted = client.delete("/desktop-pet/sessions/pet-1")

    assert listed.status_code == 401
    assert created.status_code == 401
    assert deleted.status_code == 401


def test_desktop_pet_sessions_delete_rejects_too_long_pet_session_id():
    client = _client()

    response = client.delete(
        f"/desktop-pet/sessions/{'x' * 121}",
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422
