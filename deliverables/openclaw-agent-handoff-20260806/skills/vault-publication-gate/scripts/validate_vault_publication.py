#!/usr/bin/env python3
"""Deterministic Vault publication validator for the OpenClaw agent handoff.

Stages:
  preflight  - validate proposal paths, frontmatter, hashes and diff before
               the second (publication) user confirmation.
  post-apply - validate the real Git worktree after Obsidian MCP writes and
               before git commit/push: allowlist, unrelated dirty files,
               document hashes and diff hash.

Usage:
  python validate_vault_publication.py \
    --policy validation-policy.json \
    --stage preflight \
    --proposal proposal.json \
    --vault <vault-path>

  python validate_vault_publication.py \
    --policy validation-policy.json \
    --stage post-apply \
    --vault <vault-path> \
    --allowed-paths projects/mmd-project/domains/a.md \
    --expected-diff-sha256 sha256:...
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

VALIDATOR_VERSION = "1"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _safe_vault_path(value: str) -> bool:
    normalized = str(value or "").replace("\\", "/").strip()
    if (
        not normalized
        or normalized.startswith(("/", "~"))
        or PureWindowsPath(normalized).is_absolute()
        or ".." in PurePosixPath(normalized).parts
    ):
        return False
    return True


def _load_json(path: str | None) -> dict[str, Any] | None:
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, ValueError) as error:
        raise ValueError(f"cannot load {path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be a JSON object")
    return value


def _parse_frontmatter(markdown: str) -> tuple[dict[str, Any], str]:
    if not markdown.startswith("---"):
        return {}, markdown
    end = markdown.find("\n---", 3)
    if end < 0:
        return {}, markdown
    block = markdown[3:end].strip()
    body = markdown[end + 4 :].lstrip("\n")
    try:
        import yaml  # type: ignore

        parsed = yaml.safe_load(block)
        if isinstance(parsed, dict):
            return parsed, body
    except ImportError:
        pass
    fields: dict[str, Any] = {}
    for line in block.splitlines():
        match = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line.strip())
        if match:
            value = match.group(2).strip().strip("\"'")
            fields[match.group(1)] = value
    return fields, body


def _diff_body(files: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "format": "unified",
        "files": [
            {"path": str(file.get("path") or ""), "patch": str(file.get("patch") or "")}
            for file in files
            if isinstance(file, dict)
        ],
    }


def _git_status(vault: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=vault,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError(f"git status failed: {error}") from error
    if result.returncode != 0:
        raise ValueError(f"git status failed: {result.stderr.strip()}")
    paths: list[str] = []
    for line in result.stdout.splitlines():
        if len(line) > 3:
            raw = line[3:].strip().strip('"').replace("\\", "/")
            candidate = vault / raw
            if candidate.is_dir():
                paths.extend(
                    str(path.relative_to(vault)).replace("\\", "/")
                    for path in candidate.rglob("*")
                    if path.is_file()
                )
            else:
                paths.append(raw)
    return paths


def _validate_policy(policy: dict[str, Any]) -> tuple[list[str], list[str], bool, bool, bool, str]:
    errors: list[str] = []
    warnings: list[str] = []
    version = str(policy.get("validation_policy_version") or "")
    if not version:
        errors.append("policy.validation_policy_version is required")
    roots = policy.get("allowed_roots") or []
    if not isinstance(roots, list) or not roots:
        errors.append("policy.allowed_roots must be a non-empty list")
    required = policy.get("required_frontmatter") or []
    if not isinstance(required, list):
        errors.append("policy.required_frontmatter must be a list")
    forbid_traversal = bool(policy.get("forbid_path_traversal", True))
    require_allowlist = bool(policy.get("require_approved_file_allowlist", True))
    require_clean = bool(policy.get("require_clean_unrelated_diff", True))
    return roots, required, forbid_traversal, require_allowlist, require_clean, version


def _check_path(path: str, roots: list[str], forbid_traversal: bool) -> list[str]:
    errors: list[str] = []
    normalized = str(path or "").replace("\\", "/").strip().rstrip("/")
    if not normalized:
        errors.append(f"empty target path: {path!r}")
        return errors
    if forbid_traversal and not _safe_vault_path(normalized):
        errors.append(f"unsafe target path: {path}")
        return errors
    if roots and not any(normalized == root or normalized.startswith(root.rstrip("/") + "/") for root in roots):
        errors.append(f"target path outside allowed_roots: {path}")
    return errors


def _frontmatter_errors(markdown: str, path: str, required: list[str]) -> list[str]:
    if not markdown.strip():
        return [f"target file has empty content: {path}"]
    fields, _ = _parse_frontmatter(markdown)
    errors: list[str] = []
    for key in required:
        if not str(fields.get(key) or "").strip():
            errors.append(f"missing required frontmatter '{key}' in {path}")
    return errors


def _preflight(
    *,
    policy: dict[str, Any],
    proposal: dict[str, Any],
) -> dict[str, Any]:
    roots, required, forbid_traversal, _, _, version = _validate_policy(policy)
    errors: list[str] = []
    warnings: list[str] = []
    files = proposal.get("affected_files") or []
    if not isinstance(files, list) or not files:
        errors.append("proposal.affected_files must be a non-empty list")
        files = []
    checked: list[str] = []
    document_hashes: dict[str, str] = {}
    seen: set[str] = set()
    for file in files:
        if not isinstance(file, dict):
            continue
        path = str(file.get("path") or "")
        if path in seen:
            errors.append(f"duplicate affected path: {path}")
        seen.add(path)
        checked.append(path)
        errors.extend(_check_path(path, roots, forbid_traversal))
        markdown = str(file.get("markdown") or "")
        errors.extend(_frontmatter_errors(markdown, path, required))
        document_hashes[path] = _sha256(markdown)
    diff = proposal.get("diff") or {}
    diff_files = diff.get("files") if isinstance(diff.get("files"), list) else files
    diff_body = _diff_body(diff_files)
    actual_diff_sha256 = _sha256(_canonical_json(diff_body))
    expected_diff_sha256 = str(diff.get("sha256") or "")
    if expected_diff_sha256 and expected_diff_sha256 != actual_diff_sha256:
        errors.append(
            f"proposal diff hash mismatch: expected {expected_diff_sha256}, actual {actual_diff_sha256}"
        )
    return {
        "policy_version": version,
        "check_stage": "preflight",
        "checked_files": sorted(checked),
        "approved_file_allowlist": sorted(checked),
        "actual_changed_files": [],
        "document_hashes": document_hashes,
        "diff_hash": actual_diff_sha256,
        "errors": errors,
        "warnings": warnings,
        "validator_version": VALIDATOR_VERSION,
        "executed_at": _now_iso(),
    }


def _post_apply(
    *,
    policy: dict[str, Any],
    vault: Path,
    allowed_paths: list[str],
    expected_diff_sha256: str | None,
) -> dict[str, Any]:
    roots, required, forbid_traversal, require_allowlist, require_clean, version = _validate_policy(policy)
    errors: list[str] = []
    warnings: list[str] = []
    allowlist = sorted({str(p).replace("\\", "/").strip() for p in allowed_paths if str(p).strip()})
    for path in allowlist:
        errors.extend(_check_path(path, roots, forbid_traversal))
    actual = sorted(set(_git_status(vault)))
    if require_allowlist and actual != allowlist:
        errors.append(
            "git worktree changes do not match approved allowlist: "
            f"actual={actual} approved={allowlist}"
        )
    if require_clean:
        unrelated = sorted(set(actual) - set(allowlist))
        if unrelated:
            errors.append(f"unrelated dirty files present: {unrelated}")
    document_hashes: dict[str, str] = {}
    for path in allowlist:
        target = (vault / path).resolve()
        if not str(target).startswith(str(vault.resolve())):
            errors.append(f"resolved path escapes vault: {path}")
            continue
        if not target.exists():
            errors.append(f"approved file missing after apply: {path}")
            continue
        content = target.read_text(encoding="utf-8")
        document_hashes[path] = _sha256(content)
        errors.extend(_frontmatter_errors(content, path, required))
    if expected_diff_sha256:
        diff_files = [
            {"path": path, "patch": target.read_text(encoding="utf-8") if (vault / path).exists() else ""}
            for path in allowlist
        ]
        actual_diff_sha256 = _sha256(_canonical_json(_diff_body(diff_files)))
        if actual_diff_sha256 != expected_diff_sha256:
            errors.append(
                f"post-apply diff hash mismatch: expected {expected_diff_sha256}, actual {actual_diff_sha256}"
            )
    return {
        "policy_version": version,
        "check_stage": "post-apply",
        "checked_files": allowlist,
        "approved_file_allowlist": allowlist,
        "actual_changed_files": actual,
        "document_hashes": document_hashes,
        "diff_hash": expected_diff_sha256,
        "errors": errors,
        "warnings": warnings,
        "validator_version": VALIDATOR_VERSION,
        "executed_at": _now_iso(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", required=True)
    parser.add_argument("--stage", required=True, choices=("preflight", "post-apply"))
    parser.add_argument("--vault", required=True)
    parser.add_argument("--proposal")
    parser.add_argument("--allowed-paths", nargs="*", default=[])
    parser.add_argument("--expected-diff-sha256")
    args = parser.parse_args()
    try:
        policy = _load_json(args.policy) or {}
        vault = Path(args.vault).resolve()
        if not vault.exists():
            raise ValueError(f"vault path does not exist: {vault}")
        if args.stage == "preflight":
            proposal = _load_json(args.proposal) or {}
            report = _preflight(policy=policy, proposal=proposal)
        else:
            report = _post_apply(
                policy=policy,
                vault=vault,
                allowed_paths=args.allowed_paths,
                expected_diff_sha256=args.expected_diff_sha256,
            )
    except Exception as error:
        report = {
            "policy_version": None,
            "check_stage": args.stage,
            "checked_files": [],
            "approved_file_allowlist": [],
            "actual_changed_files": [],
            "document_hashes": {},
            "diff_hash": None,
            "errors": [f"{type(error).__name__}: {error}"],
            "warnings": [],
            "validator_version": VALIDATOR_VERSION,
            "executed_at": _now_iso(),
        }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not report["errors"] else 1


if __name__ == "__main__":
    sys.exit(main())
