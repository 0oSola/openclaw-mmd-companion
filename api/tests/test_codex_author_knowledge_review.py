from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.main import create_app
from app.services.codex_author_knowledge_handoff_store import CodexAuthorKnowledgeHandoffStore


@pytest.fixture
def tmp_path():
    path = Path(tempfile.mkdtemp(prefix="codex-author-knowledge-review-"))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _sha256(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _seed_ready_candidate(store: CodexAuthorKnowledgeHandoffStore) -> tuple[str, int]:
    store.create_package(
        package_id="package-1",
        package_key="mmd-project:handoff-1:sha",
        handoff_id="handoff-1",
        workspace_key="mmd-project",
        package_sha256="package-sha",
        package_content_sha256="content-sha",
        ack_id="ack-1",
        payload={"kind": "codex_knowledge_handoff_package"},
        metadata={"workspace_key": "mmd-project"},
        candidates=[
            {
                "local_id": "pet-input-routing",
                "claim_sha256": "claim-sha",
                "content_sha256": "content-sha",
            }
        ],
    )
    with store._lock:
        row = store._conn.execute(
            """
            SELECT candidate_id, candidate_revision FROM knowledge_candidate_revision
            WHERE local_id = 'pet-input-routing' ORDER BY candidate_revision DESC LIMIT 1
            """
        ).fetchone()
        candidate_id = str(row["candidate_id"])
        candidate_revision = int(row["candidate_revision"])
        store._conn.execute(
            """
            UPDATE knowledge_candidate_revision SET status = 'ready_for_review'
            WHERE candidate_id = ? AND candidate_revision = ?
            """,
            (candidate_id, candidate_revision),
        )
        store._conn.commit()
    return candidate_id, candidate_revision


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


def _proposal(path: str = "projects/mmd-project/domains/desktop-pet/pet-input-routing.md") -> dict:
    markdown = "---\ntitle: Pet 左键输入路由\ntopic_kind: rule\ntopic_id: topic-pet-input-routing\n---\n\n# 正文\n"
    diff_body = {"format": "unified", "files": [{"path": path, "patch": "+ exact"}]}
    return {
        "publication_action": "create",
        "target": {
            "topic_id": "topic-pet-input-routing",
            "path": path,
            "base_git_revision": "vault-1",
        },
        "affected_files": [
            {
                "path": path,
                "operation": "create",
                "markdown": markdown,
                "result_content_sha256": _sha256(markdown),
                "patch": "+ exact",
            }
        ],
        "diff": {**diff_body, "sha256": _sha256(_canonical_json(diff_body))},
    }


def _receipt() -> dict:
    return {
        "kind": "project_domain_knowledge_publication_receipt",
        "schema_version": 1,
        "change_set_id": "change-set-1",
        "status": "failed",
        "publication_action": "create",
        "wiki_topic_id": None,
        "wiki_path": None,
        "published_content_sha256": None,
        "lint": {"status": "failed", "errors": ["post-apply failed"], "warnings": []},
        "git": {"commit_sha": None, "branch": None, "pushed": False},
        "error": "post-apply validation failed",
        "published_at": None,
    }


def test_claim_content_publication_receipt_flow(tmp_path: Path):
    with _client(tmp_path) as client:
        store: CodexAuthorKnowledgeHandoffStore = client.app.state.knowledge_handoff_store
        candidate_id, _ = _seed_ready_candidate(store)
        headers = {"x-codex-knowledge-openclaw-token": "openclaw-token"}

        claimed = client.post(
            "/codex/knowledge/review-claims",
            json={"workspace_key": "mmd-project", "claimed_by": "openclaw", "capacity": 1},
            headers=headers,
        )

        assert claimed.status_code == 200
        body = claimed.json()
        assert body["status"] == "claimed"
        assert body["candidate_id"] == candidate_id
        assert body["validation_policy"]["validation_policy_version"] == "vault-structure-v1"
        claim_id = body["claim_id"]

        content = client.post(
            f"/codex/knowledge/review-claims/{claim_id}/content-decision",
            json={"decision": "accept", "approved_knowledge": {"schema_version": 2, "title": "Pet 输入"}},
            headers=headers,
        )
        assert content.status_code == 200
        assert content.json()["status"] == "content_approved"

        publication = client.post(
            f"/codex/knowledge/review-claims/{claim_id}/publication-decision",
            json={"decision": "approve", "proposal": _proposal()},
            headers=headers,
        )
        assert publication.status_code == 200, publication.text
        assert publication.json()["status"] == "publication_approved"

        receipt = client.post(
            f"/codex/knowledge/review-claims/{claim_id}/receipt",
            json=_receipt(),
            headers=headers,
        )
        assert receipt.status_code == 200, receipt.text
        assert receipt.json()["status"] == "failed"

        duplicate = client.post(
            f"/codex/knowledge/review-claims/{claim_id}/receipt",
            json=_receipt(),
            headers=headers,
        )
        assert duplicate.json()["outcome"] == "duplicate"


def test_publication_proposal_hash_mismatch_is_rejected(tmp_path: Path):
    with _client(tmp_path) as client:
        store: CodexAuthorKnowledgeHandoffStore = client.app.state.knowledge_handoff_store
        _seed_ready_candidate(store)
        headers = {"x-codex-knowledge-openclaw-token": "openclaw-token"}
        claim_id = client.post(
            "/codex/knowledge/review-claims",
            json={"workspace_key": "mmd-project", "claimed_by": "openclaw"},
            headers=headers,
        ).json()["claim_id"]
        client.post(
            f"/codex/knowledge/review-claims/{claim_id}/content-decision",
            json={"decision": "accept", "approved_knowledge": {"schema_version": 2}},
            headers=headers,
        )

        proposal = _proposal()
        proposal["diff"]["sha256"] = "sha256:wrong"
        response = client.post(
            f"/codex/knowledge/review-claims/{claim_id}/publication-decision",
            json={"decision": "approve", "proposal": proposal},
            headers=headers,
        )

        assert response.status_code == 409
        assert "diff hash mismatch" in response.json()["detail"]


def test_claim_requires_openclaw_token(tmp_path: Path):
    with _client(tmp_path) as client:
        response = client.post(
            "/codex/knowledge/review-claims",
            json={"workspace_key": "mmd-project", "claimed_by": "openclaw"},
            headers={"x-codex-knowledge-openclaw-token": "wrong"},
        )
        assert response.status_code == 401


def test_expired_claim_is_released_back_to_queue(tmp_path: Path):
    with _client(tmp_path) as client:
        store: CodexAuthorKnowledgeHandoffStore = client.app.state.knowledge_handoff_store
        candidate_id, candidate_revision = _seed_ready_candidate(store)
        headers = {"x-codex-knowledge-openclaw-token": "openclaw-token"}
        claimed = client.post(
            "/codex/knowledge/review-claims",
            json={"workspace_key": "mmd-project", "claimed_by": "openclaw"},
            headers=headers,
        ).json()

        released = store.expire_stale_review_claims(now=datetime.now(UTC) + timedelta(hours=2))

        assert released == 1
        claim = store.get_review_claim(claimed["claim_id"])
        assert claim["status"] == "claim_expired"
        with store._lock:
            row = store._conn.execute(
                """
                SELECT status FROM knowledge_candidate_revision
                WHERE candidate_id = ? AND candidate_revision = ?
                """,
                (candidate_id, candidate_revision),
            ).fetchone()
        assert row["status"] == "ready_for_review"
