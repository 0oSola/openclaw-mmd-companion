# -*- coding: utf-8 -*-
"""回归测试：MMD_ROOT_DIR 里的 junction / symlink 必须照常放行。

背景：真实 MMD 目录里 `克莱妲原皮` 是指向 `D:/mmd/克莱妲原皮` 的 junction。
旧实现先 resolve() 再判断路径是否在根目录内，解析后路径跑到根目录之外，
于是模型加载、模型校验和收藏全部返回 400。

越界判定必须在 resolve 之前完成，这样 junction 放行、`..` 与绝对路径仍然被拒。
"""
import os
import subprocess
from pathlib import Path

import pytest

from test_message_service_v2 import _client, _make_case_dir, _reset_mmd_scan_cache


def _make_directory_link(link: Path, target: Path) -> str:
    """建立指向 target 的目录链接；Windows 优先用 junction（无需管理员权限）。

    返回实际创建的类型，两种都不可用时返回空字符串。
    """
    link.parent.mkdir(parents=True, exist_ok=True)
    target.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return "junction"
    try:
        os.symlink(target, link, target_is_directory=True)
        return "symlink"
    except (OSError, NotImplementedError):
        return ""


def test_mmd_root_linked_model_is_listable_loadable_and_favoritable():
    """junction 指向根目录之外的模型，仍必须能列出、能加载、能收藏。"""
    case = _make_case_dir()
    mmd_root = case / "MMD"
    mmd_root.mkdir(parents=True, exist_ok=True)

    external = case / "external_store" / "KoledaSkin"
    external.mkdir(parents=True, exist_ok=True)
    (external / "GirlsFrontline KoledaDefault.pmx").write_bytes(b"pmx" * 100)

    link = mmd_root / "克莱妲原皮"
    kind = _make_directory_link(link, external)
    if not kind:
        pytest.skip("当前环境无法创建 junction 或 symlink")

    client, app = _client(app_overrides={"mmd_root_dir": str(mmd_root)})
    _reset_mmd_scan_cache()
    rel = "克莱妲原皮/GirlsFrontline KoledaDefault.pmx"

    # 1. 模型能被列出（说明扫描走得通）
    models = client.get("/assets/mmd/models").json()["items"]
    assert rel in [m["relative_path"] for m in models], f"junction 模型未出现在列表里（{kind}）"

    # 2. 模型能加载 —— 这条以前是 400 Invalid path.
    served = client.get(f"/assets/mmd/{rel}", headers={"x-user-id": "u1"})
    assert served.status_code == 200, f"junction 模型无法加载: {served.status_code} {served.text[:200]}"

    # 3. 模型校验能通过
    validated = client.get(
        "/assets/mmd/validate", params={"model_path": rel}, headers={"x-user-id": "u1"}
    )
    assert validated.status_code == 200, f"junction 模型校验失败: {validated.text[:200]}"

    # 4. 收藏能写入并归属到该模型
    asset = app.state.trace_store.add_asset(
        user_id="u1",
        slot="neutral",
        filename="idle.vmd",
        source_relative_path="vmd/idle.vmd",
        relative_path="vmd/idle.vmd",
        size_bytes=4096,
    )
    fav = client.patch(
        f"/assets/vmd/{asset['asset_id']}",
        headers={"x-user-id": "u1"},
        json={"favorite": True, "model_relative_path": rel},
    )
    assert fav.status_code == 200, f"junction 模型收藏失败: {fav.status_code} {fav.text[:200]}"
    assert fav.json()["favorite_model_paths"] == [rel]

    # 5. 按模型取回时能看到自己那份收藏
    listed = client.get(
        "/assets/vmd",
        params={"user_id": "u1", "model_relative_path": rel},
        headers={"x-user-id": "u1"},
    ).json()["items"]
    hit = [i for i in listed if i["asset_id"] == asset["asset_id"]]
    assert hit and hit[0]["favorite_model_paths"] == [rel]


@pytest.mark.parametrize(
    "bad_path",
    [
        "../web/package.json",
        "../../windows/win.ini",
        "Ayaka/../../web/package.json",
        "D:/windows/win.ini",
        "/windows/win.ini",
        "..\\web\\package.json",
    ],
)
def test_mmd_request_path_still_rejects_traversal(bad_path):
    """放行 junction 不能顺手把越界路径也放进来。"""
    mmd_root = _make_case_dir() / "MMD"
    (mmd_root / "Ayaka").mkdir(parents=True, exist_ok=True)
    client, _app = _client(app_overrides={"mmd_root_dir": str(mmd_root)})

    validated = client.get(
        "/assets/mmd/validate", params={"model_path": bad_path}, headers={"x-user-id": "u1"}
    )
    assert validated.status_code == 400, f"越界路径未被拦住: {bad_path} -> {validated.status_code}"

    served = client.get(f"/assets/mmd/{bad_path}", headers={"x-user-id": "u1"})
    assert served.status_code in (400, 404), f"越界路径未被拦住: {bad_path} -> {served.status_code}"
