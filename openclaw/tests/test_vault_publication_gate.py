from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "skills" / "vault-publication-gate" / "scripts" / "validate_vault_publication.py"


def _sha256(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _policy() -> dict:
    return {
        "validation_policy_version": "vault-structure-v1",
        "allowed_roots": ["projects/mmd-project/domains/"],
        "required_frontmatter": ["title", "topic_kind", "topic_id"],
        "forbid_path_traversal": True,
        "require_approved_file_allowlist": True,
        "require_clean_unrelated_diff": True,
    }


def _proposal(*, path: str = "projects/mmd-project/domains/desktop-pet/pet-input-routing.md", good: bool = True) -> dict:
    markdown = (
        "---\ntitle: Pet 左键输入路由\ntopic_kind: rule\ntopic_id: topic-pet-input-routing\n---\n\n"
        "# Pet 左键输入路由\n\n正文。\n"
        if good
        else "# 缺 frontmatter 的正文\n"
    )
    diff_body = {
        "format": "unified",
        "files": [{"path": path, "patch": "+ exact"}],
    }
    return {
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


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["python", str(SCRIPT), *args],
        capture_output=True,
        text=True,
        timeout=60,
    )


def _write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def _git_repo(root: Path) -> Path:
    vault = root / "vault"
    vault.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=vault, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=vault, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=vault, check=True)
    return vault


def test_preflight_passes_for_valid_proposal(tmp_path: Path):
    policy_path = tmp_path / "policy.json"
    proposal_path = tmp_path / "proposal.json"
    _write_json(policy_path, _policy())
    _write_json(proposal_path, _proposal())

    result = _run("--policy", str(policy_path), "--stage", "preflight", "--proposal", str(proposal_path), "--vault", str(tmp_path))

    assert result.returncode == 0, result.stdout
    report = json.loads(result.stdout)
    assert report["check_stage"] == "preflight"
    assert report["errors"] == []
    assert report["diff_hash"].startswith("sha256:")


def test_preflight_rejects_unsafe_path_and_missing_frontmatter(tmp_path: Path):
    policy_path = tmp_path / "policy.json"
    proposal_path = tmp_path / "proposal.json"
    _write_json(policy_path, _policy())
    bad = _proposal(path="../../outside.md", good=False)
    _write_json(proposal_path, bad)

    result = _run("--policy", str(policy_path), "--stage", "preflight", "--proposal", str(proposal_path), "--vault", str(tmp_path))

    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert any("outside allowed_roots" in error or "unsafe" in error for error in report["errors"])
    assert any("missing required frontmatter" in error for error in report["errors"])


def test_post_apply_passes_when_changes_match_allowlist(tmp_path: Path):
    vault = _git_repo(tmp_path)
    target = vault / "projects" / "mmd-project" / "domains" / "desktop-pet"
    target.mkdir(parents=True)
    path = "projects/mmd-project/domains/desktop-pet/pet-input-routing.md"
    (vault / path).write_text(
        "---\ntitle: Pet 左键输入路由\ntopic_kind: rule\ntopic_id: topic-pet-input-routing\n---\n\n# 正文\n",
        encoding="utf-8",
    )
    policy_path = tmp_path / "policy.json"
    _write_json(policy_path, _policy())

    result = _run(
        "--policy", str(policy_path),
        "--stage", "post-apply",
        "--vault", str(vault),
        "--allowed-paths", path,
    )

    assert result.returncode == 0, result.stdout
    report = json.loads(result.stdout)
    assert report["actual_changed_files"] == [path]
    assert report["errors"] == []


def test_post_apply_rejects_unrelated_dirty_file(tmp_path: Path):
    vault = _git_repo(tmp_path)
    target = vault / "projects" / "mmd-project" / "domains" / "desktop-pet"
    target.mkdir(parents=True)
    path = "projects/mmd-project/domains/desktop-pet/pet-input-routing.md"
    (vault / path).write_text(
        "---\ntitle: Pet 左键输入路由\ntopic_kind: rule\ntopic_id: topic-pet-input-routing\n---\n\n# 正文\n",
        encoding="utf-8",
    )
    (vault / "unrelated.md").write_text("unrelated", encoding="utf-8")
    policy_path = tmp_path / "policy.json"
    _write_json(policy_path, _policy())

    result = _run(
        "--policy", str(policy_path),
        "--stage", "post-apply",
        "--vault", str(vault),
        "--allowed-paths", path,
    )

    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert any("do not match approved allowlist" in error for error in report["errors"])
