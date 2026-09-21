"""旧「优菈目录为唯一权威 + 递归复制到 _builtin」规则已被取代。

现在收藏按模型归属，文件只存一份；`_builtin` 只是共享素材，不再是收藏来源。
历史行为契约与替代概念见 `workflow/concepts/model-owned-favorite-motions.zh-CN.md`。
"""

from pathlib import Path

from test_message_service_v2 import _client, _make_case_dir


CANONICAL_FOLDER = "优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]"


def test_legacy_canonical_folder_does_not_grant_favorite_ownership():
    """目录名不再决定归属：直接在旧优菈目录放文件不会产生收藏。"""
    mmd_root = _make_case_dir() / "MMD"
    client, app = _client(app_overrides={"mmd_root_dir": str(mmd_root)})
    model = mmd_root / "优菈_by_原神_339146e6e418d79e85a515b26414c0b0" / "优菈.pmx"
    model.parent.mkdir(parents=True, exist_ok=True)
    model.write_bytes(b"pmx")

    canonical = mmd_root / "usage" / "vmd" / CANONICAL_FOLDER / "00_idle_loop" / "idle.vmd"
    canonical.parent.mkdir(parents=True, exist_ok=True)
    canonical.write_bytes(b"Vocaloid Motion Data 0002")

    from app.routes import assets as assets_module

    assets_module._MMD_SCAN_CACHE.clear()
    response = client.get("/assets/vmd", headers={"x-user-id": "u1"})

    assert response.status_code == 200
    items = response.json()["items"]
    # 动作被登记成素材，但没有被任何模型收藏。
    assert len(items) == 1
    assert items[0]["filename"] == "idle.vmd"
    assert items[0]["is_favorite"] is False
    assert items[0]["favorite_model_paths"] == []
    # 不再生成 `_builtin` 共享副本。
    assert not (mmd_root / "usage" / "vmd" / "_builtin" / "00_idle_loop" / "idle.vmd").exists()


def test_builtin_motions_are_shared_but_never_counted_as_favorites():
    """`_builtin` 下的共享动作对所有模型可见，但不属于任何模型的收藏。"""
    from app.services.motion_resolution import list_available_favorite_motion_assets

    mmd_root = _make_case_dir() / "MMD"
    client, app = _client(app_overrides={"mmd_root_dir": str(mmd_root)})
    model = mmd_root / "Koleda" / "Koleda.pmx"
    model.parent.mkdir(parents=True, exist_ok=True)
    model.write_bytes(b"pmx")

    shared = mmd_root / "usage" / "vmd" / "_builtin" / "shared_idle.vmd"
    shared.parent.mkdir(parents=True, exist_ok=True)
    shared.write_bytes(b"Vocaloid Motion Data 0002")

    from app.routes import assets as assets_module

    assets_module._MMD_SCAN_CACHE.clear()
    listed = client.get("/assets/vmd", headers={"x-user-id": "u1"})
    assert listed.status_code == 200
    item = listed.json()["items"][0]
    assert item["is_favorite"] is False

    store = app.state.trace_store
    assets = list_available_favorite_motion_assets(store, "u1", "Koleda/Koleda.pmx")
    # 共享素材参与可用动作集合，但不是收藏。
    assert [asset["filename"] for asset in assets] == ["shared_idle.vmd"]
    assert all(not asset.get("is_favorite") for asset in assets)
