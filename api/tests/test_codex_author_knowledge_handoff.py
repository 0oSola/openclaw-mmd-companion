from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
import hashlib
import json
import multiprocessing
from pathlib import Path
import shutil
import subprocess
import tempfile
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
import yaml

from app.main import create_app
from app.services.codex_author_knowledge_handoff import HandoffValidationError, _parse_marker, _redact_local_paths
from app.services.codex_author_knowledge_handoff_store import CodexAuthorKnowledgeHandoffStore


@pytest.fixture
def tmp_path():
    path = Path(tempfile.mkdtemp(prefix="codex-author-knowledge-"))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _save_evidence_in_process(db_path: str) -> int:
    store = CodexAuthorKnowledgeHandoffStore(Path(db_path))
    try:
        result = store.save_evidence_revision(
            candidate_id="candidate-process",
            candidate_revision=1,
            workspace_key="mmd-project",
            repository_id="mmd-project",
            revision=None,
            status="needs_repository_revision",
            payload={"kind": "repository_evidence_pack", "evidence_refs": []},
        )
        return int(result["evidence_revision"])
    finally:
        store.close()


def _manifest_hash(records: list[dict[str, object]]) -> str:
    return _sha256(json.dumps(records, ensure_ascii=False, separators=(",", ":")))


def _repo(tmp_path: Path) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "src").mkdir()
    (repo / "src" / "input.ts").write_text(
        "export function routeInput() { return 'drag-or-click'; }\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=repo, check=True)
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "test fixture"], cwd=repo, check=True)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    return repo, commit


def _client(
    tmp_path: Path,
    *,
    repo: Path | None = None,
    durable_refs: dict[str, str] | None = None,
    enabled: bool = True,
) -> TestClient:
    workspace_paths = {"mmd-project": str(repo)} if repo else {}
    app = create_app(
        {
            "data_dir": str(tmp_path / "data"),
            "codex_author_knowledge_handoff_enabled": enabled,
            "codex_author_knowledge_handoff_token": "test-transport-token",
            "codex_author_knowledge_openclaw_token": "test-openclaw-token",
            "codex_allowed_workspaces": ["mmd-project"],
            "codex_workspace_paths": workspace_paths,
            "codex_author_knowledge_durable_refs": durable_refs or {},
            "codex_author_knowledge_git_event_debounce_seconds": 0,
        }
    )
    client = TestClient(app)
    client.headers.update(
        {
            "x-codex-knowledge-transport-token": "test-transport-token",
            "x-codex-knowledge-openclaw-token": "test-openclaw-token",
        }
    )
    return client


def _post_handoff(client: TestClient, package: dict[str, object]):
    return client.post(
        "/codex/knowledge/handoffs",
        json=package,
        headers={"Idempotency-Key": f"{package['handoff_id']}:{package['package_sha256']}"},
    )


def _package(
    tmp_path: Path,
    *,
    repo: Path | None = None,
    head_commit: str | None = None,
    dirty: bool = False,
    evidence_hints: object | None = None,
    author_summary: str = "统一 Pet 输入状态机，避免点击和拖动竞争。",
    pending_verification: list[str] | None = None,
    handoff_id: str | None = None,
    knowledge_kind_hint: str = "rule",
) -> dict[str, object]:
    handoff_id = handoff_id or f"kh_{uuid4().hex}"
    workspace_key = "mmd-project"
    candidate_path = "candidates/pet-left-click-routing.md"
    marker = f"""kind: codex_knowledge_marker
schema_version: 1
knowledge_candidates:
  - local_id: pet-left-click-routing
    title: Pet 左键输入路由
    knowledge_kind_hint: {knowledge_kind_hint}
    change_kind: introduce
    author_summary: {author_summary or '""'}
    why_reusable: 输入竞争会在透明窗口和原生事件并存时重复出现。
    artifact:
      path: {candidate_path}
      media_type: text/markdown
    related_topic_hints:
      - Pet 输入路由
    term_changes: []
    evidence_hints:
"""
    if isinstance(evidence_hints, dict):
        rendered_hints = yaml.safe_dump(
            evidence_hints,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        ).rstrip()
        marker += "\n".join(f"      {line}" for line in rendered_hints.splitlines()) + "\n"
    else:
        for hint in evidence_hints or []:
            marker += f"      - role: {hint['role']}\n"
            marker += f"        path: {hint['path']}\n"
            if hint.get("symbol"):
                marker += f"        symbol: {hint['symbol']}\n"
            if hint.get("command"):
                marker += f"        command: {hint['command']}\n"
    marker += "    pending_verification:\n"
    for item in pending_verification or []:
        marker += f"      - {item}\n"
    if not pending_verification:
        marker += "      []\n"

    handoff = "# Codex 会话交接：Pet 输入路由\n\n本轮明确点击与拖动的边界。\n"
    candidate = (
        "# Pet 左键输入路由\n\n"
        "## 核心结论\n\n"
        "点击和拖动必须通过统一输入状态机分流。\n"
    )
    artifact_contents = [
        ("handoff.md", "text/markdown", handoff),
        ("marker.yaml", "application/yaml", marker),
        (candidate_path, "text/markdown", candidate),
    ]
    artifact_records = [
        {
            "path": path,
            "media_type": media_type,
            "size": len(content.encode("utf-8")),
            "sha256": _sha256(content),
        }
        for path, media_type, content in artifact_contents
    ]
    package_sha256 = _manifest_hash(artifact_records)
    metadata = {
        "kind": "codex_knowledge_handoff_metadata",
        "schema_version": 1,
        "handoff_id": handoff_id,
        "source": {
            "session_id": "session-test",
            "turn_id": "turn-test",
            "cwd": str(repo) if repo else None,
            "final_message_sha256": _sha256(handoff),
        },
        "workspace": {"workspace_key": workspace_key},
        "repository_capture": {
            "detected": repo is not None,
            "root": str(repo) if repo else None,
            "head_commit": head_commit,
            "branch": "main" if repo else None,
            "dirty": dirty,
            "status_sha256": None,
        },
        "artifacts": artifact_records,
    }
    metadata_content = json.dumps(metadata, ensure_ascii=False, indent=2) + "\n"
    complete_content = (
        f"handoff_id: {handoff_id}\n"
        f"package_sha256: {package_sha256}\n"
        "completed_at: 2026-08-05T00:00:00.000Z\n"
    )
    files = [
        *[
            {
                "path": path,
                "media_type": media_type,
                "content": content,
                "size": len(content.encode("utf-8")),
                "sha256": _sha256(content),
            }
            for path, media_type, content in artifact_contents
        ],
        {
            "path": "metadata.json",
            "media_type": "application/json",
            "content": metadata_content,
            "size": len(metadata_content.encode("utf-8")),
            "sha256": _sha256(metadata_content),
        },
        {
            "path": ".complete",
            "media_type": "text/plain",
            "content": complete_content,
            "size": len(complete_content.encode("utf-8")),
            "sha256": _sha256(complete_content),
        },
    ]
    return {
        "kind": "codex_knowledge_handoff_package",
        "schema_version": 1,
        "handoff_id": handoff_id,
        "workspace_key": workspace_key,
        "package_sha256": package_sha256,
        "package_content_sha256": _manifest_hash(
            [
                {
                    "path": file["path"],
                    "media_type": file["media_type"],
                    "size": file["size"],
                    "sha256": file["sha256"],
                }
                for file in files
            ]
        ),
        "files": files,
    }


def test_handoff_receive_is_idempotent_and_returns_persistent_ack(tmp_path: Path):
    client = _client(tmp_path)
    package = _package(tmp_path)

    first = _post_handoff(client, package)
    second = _post_handoff(client, package)

    assert first.status_code == 200
    assert first.json()["outcome"] == "accepted"
    assert first.json()["ack_id"]
    assert second.status_code == 200
    assert second.json()["outcome"] == "duplicate"
    assert second.json()["ack_id"] == first.json()["ack_id"]

    snapshot = client.get("/codex/knowledge/handoffs")
    assert snapshot.status_code == 200
    assert len(snapshot.json()["items"]) == 1
    assert snapshot.json()["items"][0]["candidate_count"] == 1


def test_feature_flag_off_does_not_open_author_knowledge_store(tmp_path: Path):
    client = _client(tmp_path, enabled=False)
    package = _package(tmp_path)

    response = _post_handoff(client, package)

    assert response.status_code == 404
    assert not (tmp_path / "data" / "sqlite" / "knowledge_handoff.db").exists()


def test_transport_token_is_required_for_enabled_handoff_routes(tmp_path: Path):
    client = _client(tmp_path)
    client.headers.pop("x-codex-knowledge-transport-token")

    response = _post_handoff(client, _package(tmp_path))

    assert response.status_code == 401


def test_transport_token_cannot_ack_openclaw_delivery(tmp_path: Path):
    client = _client(tmp_path)
    client.headers.pop("x-codex-knowledge-openclaw-token")

    response = client.post(
        "/codex/knowledge/openclaw-deliveries/unknown/ack",
        json={"outcome": "accepted", "ack_id": "fake"},
    )

    assert response.status_code == 401


def test_bounded_delivery_redacts_windows_unc_paths():
    assert _redact_local_paths(r"\\server\share\folder with spaces\secret.md") == "[local-path]"
    assert _redact_local_paths(r"\\?\C:\workspace\secret.md") == "[local-path]"
    assert _redact_local_paths(r"C:\folder with spaces\secret.md") == "[local-path]"
    assert _redact_local_paths("/home/folder with spaces/secret.md") == "[local-path]"


def test_marker_duplicate_keys_are_rejected():
    with pytest.raises(HandoffValidationError, match="重复键"):
        _parse_marker("kind: codex_knowledge_marker\nkind: overwritten\n")


@pytest.mark.parametrize(
    "marker",
    [
        "kind: &marker codex_knowledge_marker\n",
        "kind: *marker\n",
        "kind: !!str codex_knowledge_marker\n",
        "kind: value\nother:\n  <<: {nested: value}\n",
    ],
)
def test_marker_yaml_unsafe_features_are_rejected(marker: str):
    with pytest.raises(HandoffValidationError, match="不允许"):
        _parse_marker(marker)


def test_object_shaped_evidence_hints_are_normalized_and_verified(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/main"})
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints={
            "repository": [
                {
                    "path": "src/input.ts",
                    "symbols": ["routeInput"],
                    "supports": ["点击和拖动通过统一状态机分流"],
                }
            ],
            "tests": [{"path": "src/input.ts", "symbols": ["routeInput"]}],
            "commands": [{"command": "git status --porcelain", "reported_exit_code": 0}],
            "runtime_observations": [
                {
                    "description": "在真实窗口中分别执行静止点击和拖动",
                    "reported_result": "点击切换一次动作，拖动不切换动作",
                }
            ],
        },
    )

    response = _post_handoff(client, package)

    assert response.status_code == 200
    candidate = response.json()["candidates"][0]
    assert candidate["gate_status"] == "ready_for_review"
    delivery = client.get("/codex/knowledge/openclaw-deliveries").json()["items"][0]
    assert delivery["payload"]["evidence"]["command_verifications"][0]["status"] == "verified"
    assert delivery["payload"]["candidate"]["evidence_hints"]["runtime_observations"][0]["description"].startswith(
        "在真实窗口"
    )


def test_invalid_package_is_rejected_before_persistence(tmp_path: Path):
    client = _client(tmp_path)
    package = _package(tmp_path)
    package["package_sha256"] = "0" * 64

    response = _post_handoff(client, package)

    assert response.status_code == 422
    assert response.json()["detail"]["reason_code"] == "package_hash_mismatch"
    assert client.get("/codex/knowledge/handoffs").json()["items"] == []


def test_gate_distinguishes_missing_revision_and_durable_ref(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    no_revision_client = _client(tmp_path / "no-revision", repo=repo)
    no_revision = _package(
        tmp_path,
        repo=repo,
        head_commit=None,
        dirty=True,
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
    )
    assert _post_handoff(no_revision_client, no_revision).json()["candidates"][0][
        "gate_status"
    ] == "needs_repository_revision"

    local_client = _client(tmp_path / "local", repo=repo)
    local = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
    )
    # 新语义：commit 挂在任意本地分支上即视为持久，未配置 durable ref 不再阻断。
    assert _post_handoff(local_client, local).json()["candidates"][0]["gate_status"] == (
        "ready_for_review"
    )


def test_orphan_commit_not_on_any_branch_still_blocked(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    orphan = subprocess.check_output(
        ["git", "commit-tree", "-m", "orphan", f"{commit}^{{tree}}"],
        cwd=repo,
        text=True,
    ).strip()
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/main"})
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=orphan,
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
    )
    candidates = _post_handoff(client, package).json()["candidates"]
    assert candidates[0]["gate_status"] == "needs_durable_revision"


def test_reconciliation_recovers_missing_capture_after_commit_and_durable_ref(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/main"})
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=None,
        dirty=True,
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
    )

    initial = _post_handoff(client, package).json()
    reconciled = client.post(
        "/codex/knowledge/git-events",
        json={"workspace_key": "mmd-project", "event_type": "commit"},
    ).json()

    assert initial["candidates"][0]["gate_status"] == "needs_repository_revision"
    assert reconciled["results"][0]["gate_status"] == "ready_for_review"
    assert reconciled["results"][0]["evidence_revision"] == 2
    assert commit


def test_ready_gate_creates_bounded_delivery_without_vault_decisions(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    client = _client(
        tmp_path,
        repo=repo,
        durable_refs={"mmd-project": "refs/heads/main"},
    )
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints=[
            {
                "role": "implementation",
                "path": "src/input.ts",
                "symbol": "routeInput",
                "command": "git status --porcelain",
            }
        ],
    )

    response = _post_handoff(client, package)

    assert response.status_code == 200
    assert response.json()["candidates"][0]["gate_status"] == "ready_for_review"
    delivery = client.get("/codex/knowledge/openclaw-deliveries").json()["items"]
    assert len(delivery) == 1
    payload = delivery[0]["payload"]
    assert payload["kind"] == "codex_knowledge_candidate_review"
    assert "topic_id" not in json.dumps(payload)
    assert str(repo) not in json.dumps(payload)
    assert payload["candidate_revision"] == 1
    assert payload["evidence_revision"] == 1
    assert payload["evidence"]["command_verifications"][0]["status"] == "verified"


def test_new_author_package_creates_next_candidate_revision(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/main"})
    first = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
        handoff_id="kh_revision_1",
    )
    duplicate_claim = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
        handoff_id="kh_revision_same_claim",
    )
    second = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
        author_summary="第二版作者解释：统一输入状态机还需要在原生兜底路径保持同一阈值。",
        handoff_id="kh_revision_2",
    )

    assert _post_handoff(client, first).json()["candidates"][0]["candidate_revision"] == 1
    assert (
        _post_handoff(client, duplicate_claim).json()["candidates"][0]["candidate_revision"]
        == 1
    )
    assert _post_handoff(client, second).json()["candidates"][0]["candidate_revision"] == 2
    revisions = [item["candidate_revision"] for item in client.get("/codex/knowledge/openclaw-deliveries").json()["items"]]
    assert revisions == [1, 2]


def test_gate_reports_missing_author_explanation(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/main"})
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        author_summary="",
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
    )

    result = _post_handoff(client, package).json()["candidates"][0]

    assert result["gate_status"] == "needs_author_explanation"
    assert result["reason_codes"] == ["missing_author_explanation"]


def test_git_hint_and_reconciliation_are_idempotent(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/main"})
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
    )
    accepted = _post_handoff(client, package).json()

    first = client.post(
        "/codex/knowledge/git-events",
        json={"workspace_key": "mmd-project", "event_type": "commit"},
    )
    second = client.post(
        "/codex/knowledge/git-events",
        json={"workspace_key": "mmd-project", "event_type": "commit"},
    )

    assert accepted["candidates"][0]["gate_status"] == "ready_for_review"
    assert first.status_code == second.status_code == 200
    assert first.json()["reconciled"] == second.json()["reconciled"] == 1
    assert len(client.get("/codex/knowledge/openclaw-deliveries").json()["items"]) == 1


def test_openclaw_delivery_ack_is_idempotent_and_marks_gate_delivered(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/main"})
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
    )
    accepted = _post_handoff(client, package).json()
    delivery_id = accepted["candidates"][0]["delivery_id"]

    first = client.post(
        f"/codex/knowledge/openclaw-deliveries/{delivery_id}/ack",
        json={"outcome": "accepted", "ack_id": "openclaw-ack-1"},
    )
    second = client.post(
        f"/codex/knowledge/openclaw-deliveries/{delivery_id}/ack",
        json={"outcome": "duplicate", "ack_id": "openclaw-ack-1"},
    )

    assert first.status_code == second.status_code == 200
    assert first.json()["status"] == "delivered"
    assert second.json()["outcome"] == "duplicate"
    assert client.get("/codex/knowledge/openclaw-deliveries").json()["items"][0]["status"] == "delivered"
    reconciled = client.post(
        "/codex/knowledge/git-events",
        json={"workspace_key": "mmd-project", "event_type": "commit"},
    )
    assert reconciled.json()["reconciled"] == 0
    assert client.get("/codex/knowledge/openclaw-deliveries").json()["items"][0]["status"] == "delivered"


def test_concurrent_identical_evidence_reconciliation_reuses_one_revision(tmp_path: Path):
    client = _client(tmp_path)
    store = client.app.state.knowledge_handoff_store
    payload = {"kind": "repository_evidence_pack", "schema_version": 1, "evidence_refs": []}

    def save():
        return store.save_evidence_revision(
            candidate_id="candidate-concurrent",
            candidate_revision=1,
            workspace_key="mmd-project",
            repository_id="mmd-project",
            revision=None,
            status="needs_repository_revision",
            payload=payload,
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: save(), range(4)))

    assert {item["evidence_revision"] for item in results} == {1}


def test_cross_process_identical_evidence_reuses_one_revision(tmp_path: Path):
    db_path = tmp_path / "cross-process.db"
    store = CodexAuthorKnowledgeHandoffStore(db_path)
    store.close()
    context = multiprocessing.get_context("spawn")
    with ProcessPoolExecutor(max_workers=2, mp_context=context) as executor:
        results = list(executor.map(_save_evidence_in_process, [str(db_path), str(db_path)]))

    assert set(results) == {1}


def test_command_evidence_is_verified_in_detached_worktree_when_workspace_is_dirty(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/main"})
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints=[
            {
                "role": "test",
                "path": "src/input.ts",
                "symbol": "routeInput",
                "command": "git status --porcelain",
            }
        ],
    )
    (repo / "uncommitted.txt").write_text("dirty", encoding="utf-8")

    result = _post_handoff(client, package).json()["candidates"][0]

    # 新语义：证据命令在锚定 commit 的临时 detached worktree 中复核，
    # 主工作区的脏污不再阻断。
    assert result["gate_status"] == "ready_for_review"


def test_failure_classification_knowledge_is_revision_exempt(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    # durable ref 指向不存在的分支，普通知识会被 durable 判定卡住。
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/nonexistent"})
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        knowledge_kind_hint="failure_classification",
        evidence_hints=[{"role": "implementation", "path": "src/input.ts", "symbol": "routeInput"}],
    )
    candidates = _post_handoff(client, package).json()["candidates"]
    assert candidates[0]["gate_status"] == "ready_for_review"


def test_unsafe_command_evidence_is_not_executed(tmp_path: Path):
    repo, commit = _repo(tmp_path)
    client = _client(tmp_path, repo=repo, durable_refs={"mmd-project": "refs/heads/main"})
    package = _package(
        tmp_path,
        repo=repo,
        head_commit=commit,
        evidence_hints=[
            {
                "role": "test",
                "path": "src/input.ts",
                "symbol": "routeInput",
                "command": "python -c \"raise SystemExit(7)\"",
            }
        ],
    )

    result = _post_handoff(client, package).json()["candidates"][0]

    assert result["gate_status"] == "needs_evidence"
    assert "repository_evidence_unresolved" in result["reason_codes"]
