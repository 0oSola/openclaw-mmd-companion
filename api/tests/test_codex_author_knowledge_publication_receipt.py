from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.main import create_app


@pytest.fixture
def tmp_path():
    path = Path(tempfile.mkdtemp(prefix="codex-author-knowledge-receipt-"))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _client(tmp_path: Path) -> TestClient:
    app = create_app(
        {
            "data_dir": str(tmp_path / "data"),
            "codex_author_knowledge_handoff_enabled": True,
            "codex_author_knowledge_handoff_token": "transport-token",
            "codex_author_knowledge_openclaw_token": "openclaw-token",
            "codex_allowed_workspaces": ["mmd-project"],
            # 这些用例只验证业务行为，不测认证；显式关掉 JWT，避免继承本地 api/.env
            # 的 JWT_SECRET 而把请求拦成 401。
            "jwt_secret": "",
        }
    )
    return TestClient(app, headers={"x-user-id": "u1"})


def _receipt(*, error: str = "wiki_lint_failed") -> dict:
    return {
        "kind": "project_domain_knowledge_publication_receipt",
        "schema_version": 1,
        "change_set_id": "change_set-test-1",
        "status": "failed",
        "publication_action": "create",
        "wiki_topic_id": "topic-test",
        "wiki_path": "projects/mmd-project/domains/test/topic.md",
        "published_content_sha256": None,
        "lint": {"status": "failed", "errors": [error], "warnings": []},
        "git": {"commit_sha": None, "branch": None, "pushed": False},
        "error": error,
        "published_at": None,
    }


def test_openclaw_publication_receipt_is_mirrored_idempotently(tmp_path: Path):
    with _client(tmp_path) as client:
        headers = {"x-codex-knowledge-openclaw-token": "openclaw-token"}

        first = client.post("/codex/knowledge/publication-receipts", json=_receipt(), headers=headers)
        duplicate = client.post("/codex/knowledge/publication-receipts", json=_receipt(), headers=headers)

        assert first.status_code == 200
        assert first.json()["outcome"] == "mirrored"
        assert duplicate.status_code == 200
        assert duplicate.json()["outcome"] == "duplicate"


def test_openclaw_publication_receipt_conflict_is_rejected(tmp_path: Path):
    with _client(tmp_path) as client:
        headers = {"x-codex-knowledge-openclaw-token": "openclaw-token"}
        assert client.post("/codex/knowledge/publication-receipts", json=_receipt(), headers=headers).status_code == 200

        changed = client.post(
            "/codex/knowledge/publication-receipts",
            json=_receipt(error="vault_git_push_failed_after_commit"),
            headers=headers,
        )

        assert changed.status_code == 409
        assert "immutable" in changed.json()["detail"]


def test_publication_receipt_requires_openclaw_audience_token(tmp_path: Path):
    with _client(tmp_path) as client:
        response = client.post(
            "/codex/knowledge/publication-receipts",
            json=_receipt(),
            headers={"x-codex-knowledge-openclaw-token": "transport-token"},
        )

        assert response.status_code == 401
