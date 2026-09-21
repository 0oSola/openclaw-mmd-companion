from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from tests.test_config_assets_trace_routes import _make_case_dir


def test_favoriting_keeps_all_model_paths_on_patch():
    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    first_rel = Path("RoleA/A.pmx")
    second_rel = Path("RoleB/B.pmx")
    for rel in (first_rel, second_rel):
        abs_path = mmd_root / rel
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(b"pmx")

    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(mmd_root),
        }
    )
    client = TestClient(app)

    upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        data={"user_id": "u1", "slot": "happy"},
        files={"file": ("wave.vmd", b"Vocaloid Motion Data 0002", "application/octet-stream")},
    )
    assert upload.status_code == 200
    asset_id = upload.json()["asset_id"]

    first = client.patch(
        f"/assets/vmd/{asset_id}",
        headers={"x-user-id": "u1"},
        json={"favorite": True, "model_relative_path": first_rel.as_posix()},
    )
    assert first.status_code == 200
    assert first.json()["favorite_model_paths"] == [first_rel.as_posix()]

    second = client.patch(
        f"/assets/vmd/{asset_id}",
        headers={"x-user-id": "u1"},
        json={"favorite": True, "model_relative_path": second_rel.as_posix()},
    )
    assert second.status_code == 200
    assert sorted(second.json()["favorite_model_paths"]) == sorted(
        [first_rel.as_posix(), second_rel.as_posix()]
    )

    listed = client.get("/assets/vmd?user_id=u1", headers={"x-user-id": "u1"})
    assert listed.status_code == 200
    listed_item = next(item for item in listed.json()["items"] if item["asset_id"] == asset_id)
    assert sorted(listed_item["favorite_model_paths"]) == sorted(
        [first_rel.as_posix(), second_rel.as_posix()]
    )
