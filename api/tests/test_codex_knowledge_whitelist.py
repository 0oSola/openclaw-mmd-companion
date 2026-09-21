from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.codex_knowledge_whitelist import CodexKnowledgeWhitelistStore


@pytest.fixture
def tmp_path():
    path = Path(tempfile.mkdtemp(prefix="codex-knowledge-whitelist-"))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _admin_headers() -> dict[str, str]:
    return {"X-User-Id": "admin-1"}


def _client(tmp_path: Path) -> TestClient:
    app = create_app(
        {
            "data_dir": str(tmp_path / "data"),
            "admin_user_ids": ["admin-1"],
            "codex_author_knowledge_handoff_enabled": True,
            "codex_author_knowledge_handoff_token": "transport-token",
            "codex_author_knowledge_openclaw_token": "openclaw-token",
            "codex_allowed_workspaces": ["mmd-project"],
            # 这些用例只验证业务行为，不测认证中间件；显式关掉 JWT，避免继承本地
            # api/.env 的 JWT_SECRET 而把请求拦成 401。用例里靠是否携带 X-User-Id
            # 区分管理员/非管理员/未登录，因此这里不设置默认身份头。
            "jwt_secret": "",
        }
    )
    return TestClient(app)


def test_whitelist_default_allows_local_requests(tmp_path: Path):
    with _client(tmp_path) as client:
        assert client.get("/admin/codex-knowledge/whitelist/api", headers=_admin_headers()).status_code == 200
        response = client.post(
            "/admin/codex-knowledge/whitelist/api",
            json={"cidr": "10.11.252.0/24", "label": "OpenClaw 主机"},
            headers=_admin_headers(),
        )
        assert response.status_code == 200
        assert response.json()["entry"]["cidr"] == "10.11.252.0/24"


def test_whitelist_rejects_unknown_source_when_configured(tmp_path: Path):
    with _client(tmp_path) as client:
        client.post(
            "/admin/codex-knowledge/whitelist/api",
            json={"cidr": "10.11.252.0/24", "label": "OpenClaw"},
            headers=_admin_headers(),
        )
        response = client.post(
            "/codex/knowledge/review-claims",
            json={"workspace_key": "mmd-project", "claimed_by": "openclaw", "capacity": 1},
            headers={"x-codex-knowledge-openclaw-token": "openclaw-token"},
        )
        assert response.status_code == 403
        assert "whitelist" in response.json()["detail"]


def test_admin_whitelist_requires_admin(tmp_path: Path):
    with _client(tmp_path) as client:
        response = client.get("/admin/codex-knowledge/whitelist/api", headers={"X-User-Id": "not-admin"})
        assert response.status_code == 403


def test_whitelist_store_add_remove_and_persist(tmp_path: Path):
    store = CodexKnowledgeWhitelistStore(tmp_path / "data" / "knowledge_handoff" / "openclaw_whitelist.json")
    store.add_entry("10.11.252.0/24", "OpenClaw 网段")
    store.add_entry("2001:db8::/32", "IPv6 网段")
    entries = store.list_entries()
    assert [entry["cidr"] for entry in entries] == ["10.11.252.0/24", "2001:db8::/32"]
    assert [entry["label"] for entry in entries] == ["OpenClaw 网段", "IPv6 网段"]
    assert all(entry["created_at"] for entry in entries)
    assert store.allows("10.11.252.164")
    assert store.allows("10.11.252.200")
    assert not store.allows("10.11.253.1")
    assert store.remove_entry("10.11.252.0/24")
    assert not store.remove_entry("10.11.252.0/24")
    assert not store.allows("10.11.252.164")


def test_whitelist_admin_page_renders(tmp_path: Path):
    with _client(tmp_path) as client:
        response = client.get("/admin/codex-knowledge/whitelist/")
        assert response.status_code == 200
        assert "OpenClaw 来源白名单" in response.text


def test_review_summary_requires_admin_and_reports_counts(tmp_path: Path):
    with _client(tmp_path) as client:
        store = client.app.state.knowledge_handoff_store
        assert store is not None
        assert client.get("/codex/knowledge/review-summary").status_code == 401
        response = client.get("/codex/knowledge/review-summary", headers={"X-User-Id": "admin-1"})
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 0
        assert body["pending"] == 0
