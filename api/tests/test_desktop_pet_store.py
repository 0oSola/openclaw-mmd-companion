from pathlib import Path
import sqlite3
from uuid import uuid4

from app.db.store import TraceStore


def _case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _store() -> TraceStore:
    path = _case_dir()
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def _upsert_pet_session(store: TraceStore, pet_session_id: str = "pet-1", **overrides):
    payload = {
        "pet_session_id": pet_session_id,
        "codex_session_id": "11111111-1111-1111-1111-111111111111",
        "workspace_id": "mmd-companion",
        "workspace_path": "D:/workspace/MMD project",
        "codex_home": "C:/Users/KSG/.codex",
        "display_title": "Readable title",
        "first_prompt_preview": "fix login layout and run checks",
        "last_summary": None,
        "last_status": "running",
        "launch_mode": "workspace-write",
        "remote_url": None,
        "app_server_pid": None,
        "app_server_port": None,
        "metadata": {},
    }
    payload.update(overrides)
    return store.upsert_desktop_pet_session(**payload)


def test_shared_companion_config_defaults_and_updates():
    store = _store()

    default = store.get_companion_shared_config("admin-1")

    assert default["user_id"] == "admin-1"
    assert default["selected_model_path"] is None
    assert default["render_pipeline"] == "classic"
    assert default["updated_at"] is None

    updated = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline="genshin",
    )

    assert updated["selected_model_path"] == "Eula/Eula.pmx"
    assert updated["render_pipeline"] == "genshin"
    assert updated["updated_at"]
    assert store.get_companion_shared_config("admin-1") == updated


def test_shared_companion_config_gf2_mode_roundtrip():
    store = _store()
    updated = store.upsert_companion_shared_config(
        user_id="gf2-stage", selected_model_path="克莱妲原皮/Koleda_v1.1_动作兼容.pmx",
        render_pipeline="gf2",
    )
    assert updated["render_pipeline"] == "gf2"
    assert store.get_companion_shared_config("gf2-stage") == updated


def test_shared_companion_config_rejects_unknown_render_pipeline():
    store = _store()

    try:
        store.upsert_companion_shared_config(
            user_id="admin-1",
            selected_model_path=None,
            render_pipeline="toon-unknown",
        )
    except ValueError as error:
        assert "render_pipeline" in str(error)
    else:
        raise AssertionError("expected invalid render pipeline to fail")


def test_shared_companion_config_normalizes_render_pipeline():
    store = _store()

    mio = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline=" mio-reference ",
    )

    assert mio["render_pipeline"] == "mio-reference"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "mio-reference"

    reze = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline=" REZE-NPR ",
    )

    assert reze["render_pipeline"] == "reze-npr"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "reze-npr"

    k3 = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline=" K3 ",
    )

    assert k3["render_pipeline"] == "k3"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "k3"

    reze_design = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline=" REZE-DESIGN ",
    )

    assert reze_design["render_pipeline"] == "reze-design"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "reze-design"

    reze_k3 = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline=" REZE-K3 ",
    )

    assert reze_k3["render_pipeline"] == "reze-k3"

    v14d_game = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline=" V14D-GAME ",
    )

    assert v14d_game["render_pipeline"] == "v14d-game"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "v14d-game"


def test_shared_companion_config_migrates_old_render_pipeline_check_constraint():
    path = _case_dir()
    db_path = path / "sqlite" / "trace.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE companion_shared_config (
                user_id TEXT PRIMARY KEY,
                selected_model_path TEXT,
                render_pipeline TEXT NOT NULL DEFAULT 'classic'
                    CHECK (render_pipeline IN ('classic', 'genshin')),
                reze_stage_document_json TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT INTO companion_shared_config (
                user_id, selected_model_path, render_pipeline, reze_stage_document_json, updated_at
            ) VALUES ('admin-1', 'Eula/Eula.pmx', 'genshin', '{"name":"legacy"}', '2026-01-01T00:00:00+00:00')
            """
        )
        conn.commit()
    finally:
        conn.close()

    store = TraceStore(db_path=db_path, ndjson_dir=path / "logs")

    migrated = store.get_companion_shared_config("admin-1")
    assert migrated["render_pipeline"] == "genshin"
    assert migrated["reze_stage_document"] == {"name": "legacy"}

    updated = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline="reze-k3",
    )

    assert updated["render_pipeline"] == "reze-k3"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "reze-k3"


def test_shared_companion_config_migrates_legacy_rows_without_scene_document_column():
    path = _case_dir()
    db_path = path / "sqlite" / "trace.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE companion_shared_config (
                user_id TEXT PRIMARY KEY,
                selected_model_path TEXT,
                render_pipeline TEXT NOT NULL DEFAULT 'classic',
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.executemany(
            """
            INSERT INTO companion_shared_config (
                user_id, selected_model_path, render_pipeline, updated_at
            ) VALUES (?, ?, ?, ?)
            """,
            [
                ("known", "koleda/koleda.pmx", "genshin", "2026-01-01T00:00:00+00:00"),
                ("unknown", "legacy/legacy.pmx", "legacy-stage", "2026-01-02T00:00:00+00:00"),
                ("blank", "blank/blank.pmx", "   ", "2026-01-03T00:00:00+00:00"),
            ],
        )
        conn.commit()
    finally:
        conn.close()

    store = TraceStore(db_path=db_path, ndjson_dir=path / "logs")

    assert store.get_companion_shared_config("known") == {
        "user_id": "known",
        "selected_model_path": "koleda/koleda.pmx",
        "render_pipeline": "genshin",
        "reze_stage_document": None,
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    assert store.get_companion_shared_config("unknown")["render_pipeline"] == "classic"
    assert store.get_companion_shared_config("unknown")["selected_model_path"] == "legacy/legacy.pmx"
    assert store.get_companion_shared_config("unknown")["updated_at"] == "2026-01-02T00:00:00+00:00"
    assert store.get_companion_shared_config("blank")["render_pipeline"] == "classic"
    assert store.get_companion_shared_config("blank")["selected_model_path"] == "blank/blank.pmx"

    schema = store._conn.execute("SELECT sql FROM sqlite_master WHERE name = 'companion_shared_config'").fetchone()[0]
    assert "'v14d-game'" in schema
    assert "reze_stage_document_json" in schema


def test_shared_companion_config_rejects_blank_render_pipeline_values():
    store = _store()

    for render_pipeline in [None, "", "   "]:
        try:
            store.upsert_companion_shared_config(
                user_id="admin-1",
                selected_model_path=None,
                render_pipeline=render_pipeline,  # type: ignore[arg-type]
            )
        except ValueError as error:
            assert "render_pipeline" in str(error)
        else:
            raise AssertionError(f"expected {render_pipeline!r} render pipeline to fail")


def test_desktop_pet_session_registry_round_trip_and_sorting():
    store = _store()

    first = store.upsert_desktop_pet_session(
        pet_session_id="pet-1",
        codex_session_id="11111111-1111-1111-1111-111111111111",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home="C:/Users/KSG/.codex",
        display_title=None,
        first_prompt_preview="fix login layout and run checks",
        last_summary=None,
        last_status="running",
        launch_mode="workspace-write",
        remote_url="ws://127.0.0.1:4501",
        app_server_pid=1234,
        app_server_port=4501,
        metadata={"approval_count": 0},
    )
    second = store.upsert_desktop_pet_session(
        pet_session_id="pet-2",
        codex_session_id="22222222-2222-2222-2222-222222222222",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home="C:/Users/KSG/.codex",
        display_title="Codex Console integration",
        first_prompt_preview=None,
        last_summary="Added status bridge.",
        last_status="completed",
        launch_mode="read-only",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )

    assert first["display_title"] == "fix login layout and run checks"
    assert second["display_title"] == "Codex Console integration"
    sessions = store.list_desktop_pet_sessions(limit=10)
    assert [item["pet_session_id"] for item in sessions] == ["pet-2", "pet-1"]
    assert sessions[0]["metadata"] == {}


def test_desktop_pet_session_registry_delete_only_removes_registry_row():
    store = _store()
    store.upsert_desktop_pet_session(
        pet_session_id="pet-1",
        codex_session_id="11111111-1111-1111-1111-111111111111",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Readable title",
        first_prompt_preview=None,
        last_summary=None,
        last_status="failed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )

    assert store.delete_desktop_pet_session("pet-1") is True
    assert store.get_desktop_pet_session("pet-1") is None
    assert store.delete_desktop_pet_session("pet-1") is False


def test_desktop_pet_session_registry_round_trips_non_empty_metadata():
    store = _store()

    item = _upsert_pet_session(store, metadata={"approval_count": 2})

    assert item["metadata"] == {"approval_count": 2}
    assert store.get_desktop_pet_session("pet-1")["metadata"] == {"approval_count": 2}


def test_desktop_pet_session_registry_preserves_created_at_on_upsert():
    store = _store()

    first = _upsert_pet_session(store)
    second = _upsert_pet_session(
        store,
        last_status="completed",
        last_summary="Done.",
        metadata={"approval_count": 2},
    )

    assert second["created_at"] == first["created_at"]
    assert second["updated_at"]
    assert second["last_status"] == "completed"


def test_desktop_pet_session_registry_list_limit_bounds_are_robust():
    store = _store()
    for index in range(55):
        _upsert_pet_session(
            store,
            pet_session_id=f"pet-{index:02d}",
            codex_session_id=f"11111111-1111-1111-1111-{index:012d}",
        )

    assert len(store.list_desktop_pet_sessions(limit=0)) == 1
    assert len(store.list_desktop_pet_sessions(limit=None)) == 10  # type: ignore[arg-type]
    assert len(store.list_desktop_pet_sessions(limit=-20)) == 1
    assert len(store.list_desktop_pet_sessions(limit=500)) == 50
    invalid_limit_items = store.list_desktop_pet_sessions(limit="bad")  # type: ignore[arg-type]
    assert 1 <= len(invalid_limit_items) <= 50
    infinite_limit_items = store.list_desktop_pet_sessions(limit=float("inf"))  # type: ignore[arg-type]
    assert 1 <= len(infinite_limit_items) <= 50


def test_desktop_pet_session_registry_ordering_is_stable_for_equal_timestamps():
    store = _store()
    _upsert_pet_session(store, pet_session_id="pet-b")
    _upsert_pet_session(store, pet_session_id="pet-a")
    tie_timestamp = "2026-01-01T00:00:00+00:00"
    store._conn.execute(
        """
        UPDATE desktop_pet_sessions
        SET last_seen_at = ?, updated_at = ?, created_at = ?
        WHERE pet_session_id IN ('pet-a', 'pet-b')
        """,
        (tie_timestamp, tie_timestamp, tie_timestamp),
    )
    store._conn.commit()

    sessions = store.list_desktop_pet_sessions(limit=10)

    assert [item["pet_session_id"] for item in sessions] == ["pet-a", "pet-b"]


def test_desktop_pet_session_registry_truncates_prompt_preview_and_summary():
    store = _store()
    long_preview = f"  {'p' * 300}  "
    long_summary = f"  {'s' * 1200}  "

    item = _upsert_pet_session(
        store,
        display_title=None,
        first_prompt_preview=long_preview,
        last_summary=long_summary,
    )

    assert item["display_title"] == "p" * 48
    assert item["first_prompt_preview"] == "p" * 240
    assert item["last_summary"] == "s" * 1000


def test_desktop_pet_session_registry_non_dict_metadata_json_returns_empty_dict():
    store = _store()
    _upsert_pet_session(store, metadata={"approval_count": 2})
    store._conn.execute(
        "UPDATE desktop_pet_sessions SET metadata_json = ? WHERE pet_session_id = ?",
        ('["not", "metadata"]', "pet-1"),
    )
    store._conn.commit()

    assert store.get_desktop_pet_session("pet-1")["metadata"] == {}

    store._conn.execute(
        "UPDATE desktop_pet_sessions SET metadata_json = ? WHERE pet_session_id = ?",
        ("not-json", "pet-1"),
    )
    store._conn.commit()

    assert store.get_desktop_pet_session("pet-1")["metadata"] == {}
