from __future__ import annotations

import hashlib
from pathlib import Path
import subprocess
from uuid import uuid4

import pytest

from app.services.domain_knowledge_repository_resolver import resolve_repository_evidence


def _run(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _repo() -> tuple[Path, str]:
    root = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex / "repo"
    root.mkdir(parents=True)
    _run(root, "init")
    _run(root, "config", "user.email", "codex@example.test")
    _run(root, "config", "user.name", "Codex Test")
    (root / "docs").mkdir()
    (root / "src").mkdir()
    (root / "tests").mkdir()
    (root / "tools").mkdir()
    (root / "docs" / "motion_contract.md").write_text(
        "# Motion Contract\n\nP0 failures block acceptance.\n",
        encoding="utf-8",
    )
    (root / "src" / "gate.py").write_text(
        "def unrelated():\n    return False\n\n\ndef evaluate_gate(report):\n    return not report.get('p0_failures')\n",
        encoding="utf-8",
    )
    (root / "tests" / "test_gate.py").write_text(
        "def test_p0_failure_blocks():\n    assert True\n",
        encoding="utf-8",
    )
    (root / "tools" / "validate_gate.py").write_text(
        "def main():\n    print('validated')\n",
        encoding="utf-8",
    )
    _run(root, "add", ".")
    _run(root, "commit", "-m", "seed resolver fixture")
    return root, _run(root, "rev-parse", "HEAD")


def _request(repo: Path, revision: str) -> dict:
    return {
        "workspace_path": str(repo),
        "repository_id": "resolver-fixture",
        "revision": revision,
        "hints": [
            {
                "role": "contract",
                "path": "docs/motion_contract.md",
                "line_start": 1,
                "line_end": 3,
            },
            {
                "role": "implementation",
                "path": "src/gate.py",
                "symbol": "evaluate_gate",
            },
            {
                "role": "test",
                "path": "tests/test_gate.py",
                "symbol": "test_p0_failure_blocks",
            },
            {
                "role": "validation",
                "path": "tools/validate_gate.py",
                "symbol": "main",
                "command": "python tools/validate_gate.py",
                "outcome": "success",
                "exit_code": 0,
            },
        ],
    }


def test_resolver_reads_exact_git_revision_and_builds_canonical_evidence_refs():
    repo, revision = _repo()
    (repo / "src" / "gate.py").write_text("BROKEN WORKTREE CONTENT\n", encoding="utf-8")

    pack = resolve_repository_evidence(_request(repo, revision))

    assert pack["repository_snapshot"] == {
        "repository_id": "resolver-fixture",
        "commit_sha": revision,
    }
    assert [ref["role"] for ref in pack["evidence_refs"]] == [
        "contract",
        "implementation",
        "test",
        "validation",
    ]
    implementation = pack["evidence_refs"][1]
    assert implementation["path"] == "src/gate.py"
    assert "evaluate_gate" in implementation["snippet"]
    assert "BROKEN WORKTREE" not in implementation["snippet"]
    assert implementation["blob_sha"] == _run(repo, "rev-parse", f"{revision}:src/gate.py")
    assert implementation["snippet_sha256"] == "sha256:" + hashlib.sha256(
        implementation["snippet"].encode("utf-8")
    ).hexdigest()
    assert implementation["resolver_uri"].startswith(f"repo://resolver-fixture/{revision}/src/gate.py#L")


def test_symbol_snippet_hash_survives_unrelated_line_movement():
    repo, first_revision = _repo()
    first = resolve_repository_evidence(
        {
            **_request(repo, first_revision),
            "hints": [{"role": "implementation", "path": "src/gate.py", "symbol": "evaluate_gate"}],
        }
    )["evidence_refs"][0]
    original = (repo / "src" / "gate.py").read_text(encoding="utf-8")
    (repo / "src" / "gate.py").write_text("# moved down\n# another line\n" + original, encoding="utf-8")
    _run(repo, "add", "src/gate.py")
    _run(repo, "commit", "-m", "move symbol without changing it")
    second_revision = _run(repo, "rev-parse", "HEAD")

    second = resolve_repository_evidence(
        {
            **_request(repo, second_revision),
            "hints": [{"role": "implementation", "path": "src/gate.py", "symbol": "evaluate_gate"}],
        }
    )["evidence_refs"][0]

    assert first["line_start"] != second["line_start"]
    assert first["snippet_sha256"] == second["snippet_sha256"]


def test_resolver_rejects_stale_revision_missing_file_and_secret_paths():
    repo, revision = _repo()
    with pytest.raises(ValueError, match="revision"):
        resolve_repository_evidence({**_request(repo, "deadbeef"), "hints": []})

    with pytest.raises(ValueError, match="not found"):
        resolve_repository_evidence(
            {**_request(repo, revision), "hints": [{"role": "implementation", "path": "src/missing.py"}]}
        )

    with pytest.raises(ValueError, match="secret-like"):
        resolve_repository_evidence(
            {**_request(repo, revision), "hints": [{"role": "implementation", "path": ".env"}]}
        )


def test_resolver_preserves_leading_blank_lines_for_exact_line_hints():
    repo, _ = _repo()
    (repo / "docs" / "leading_contract.md").write_text(
        "\n# Leading Contract\nExact rule.\n",
        encoding="utf-8",
    )
    _run(repo, "add", "docs/leading_contract.md")
    _run(repo, "commit", "-m", "add leading-line fixture")
    revision = _run(repo, "rev-parse", "HEAD")

    ref = resolve_repository_evidence(
        {
            **_request(repo, revision),
            "hints": [
                {
                    "role": "contract",
                    "path": "docs/leading_contract.md",
                    "line_start": 2,
                    "line_end": 3,
                }
            ],
        }
    )["evidence_refs"][0]

    assert ref["line_start"] == 2
    assert ref["snippet"] == "# Leading Contract\nExact rule.\n"
