from __future__ import annotations

from dataclasses import dataclass
import asyncio
import hashlib
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shlex
import subprocess
from typing import Any

import yaml

from app.services.codex_author_knowledge_handoff_store import CodexAuthorKnowledgeHandoffStore
from app.services.domain_knowledge_repository_resolver import (
    EvidenceHint,
    RepositoryEvidenceRequest,
    resolve_repository_evidence,
)


_WINDOWS_ABSOLUTE_PATH = re.compile(r"(?i)\b[A-Z]:[\\/][^\r\n`\"']+")
_UNC_ABSOLUTE_PATH = re.compile(r"(?i)(?<!\\)(?:\\\\\?\\|\\\\)[^\r\n`\"']+")
_POSIX_ABSOLUTE_PATH = re.compile(r"(?<![\w:])/(?!/)[^\r\n`\"']+")
_ALLOWED_TOP_LEVEL_FILES = {"handoff.md", "marker.yaml", "metadata.json", ".complete"}


class _UniqueKeySafeLoader(yaml.SafeLoader):
    pass


def _construct_unique_mapping(loader: _UniqueKeySafeLoader, node: yaml.MappingNode, deep: bool = False):
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key == "<<":
            raise HandoffValidationError("marker_yaml_unsafe", "marker.yaml 不允许 merge keys")
        if key in mapping:
            raise HandoffValidationError("marker_duplicate_key", f"marker.yaml 包含重复键：{key}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueKeySafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


class HandoffValidationError(ValueError):
    def __init__(self, reason_code: str, message: str):
        super().__init__(message)
        self.reason_code = reason_code


@dataclass(frozen=True)
class ValidatedPackage:
    payload: dict[str, Any]
    metadata: dict[str, Any]
    marker: dict[str, Any]
    candidates: list[dict[str, Any]]


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _manifest_hash(records: list[dict[str, Any]]) -> str:
    return _sha256_text(_canonical_json(records))


def _safe_relative_path(value: str) -> bool:
    normalized = value.replace("\\", "/").strip()
    if not normalized or normalized.startswith(("/", "~")):
        return False
    if PureWindowsPath(normalized).is_absolute():
        return False
    parts = PurePosixPath(normalized).parts
    return ".." not in parts and all(part not in {"", "."} for part in parts)


def _redact_local_paths(value: str) -> str:
    redacted = _UNC_ABSOLUTE_PATH.sub("[local-path]", value)
    redacted = _WINDOWS_ABSOLUTE_PATH.sub("[local-path]", redacted)
    return _POSIX_ABSOLUTE_PATH.sub("[local-path]", redacted)


def _redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_local_paths(value)
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _redact_value(item) for key, item in value.items()}
    return value


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _normalize_evidence_hints(raw: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Normalize the frozen object-shaped contract while retaining KH-02 list compatibility."""
    if isinstance(raw, list):
        file_hints = []
        command_hints = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            if item.get("path"):
                file_hints.append({key: value for key, value in item.items() if key != "command"})
            if item.get("command"):
                command_hints.append({"command": item["command"]})
        return file_hints, command_hints, []
    if not isinstance(raw, dict):
        return [], [], []

    file_hints: list[dict[str, Any]] = []
    for section, role in (("repository", "implementation"), ("tests", "test")):
        for item in _as_list(raw.get(section)):
            if not isinstance(item, dict) or not item.get("path"):
                continue
            symbols = [str(symbol).strip() for symbol in _as_list(item.get("symbols")) if str(symbol).strip()]
            if not symbols:
                file_hints.append(
                    {
                        "role": role,
                        "path": item["path"],
                        "line_start": item.get("line_start"),
                        "line_end": item.get("line_end"),
                    }
                )
                continue
            for symbol in symbols:
                file_hints.append(
                    {
                        "role": role,
                        "path": item["path"],
                        "symbol": symbol,
                    }
                )

    command_hints = [
        item
        for item in _as_list(raw.get("commands"))
        if isinstance(item, dict) and item.get("command")
    ]
    runtime_observations = [
        item
        for item in _as_list(raw.get("runtime_observations"))
        if isinstance(item, dict) and item.get("description")
    ]
    return file_hints, command_hints, runtime_observations


def _parse_metadata(content: str) -> dict[str, Any]:
    try:
        value = json.loads(content)
    except json.JSONDecodeError as error:
        raise HandoffValidationError("metadata_invalid", "metadata.json 不是有效 JSON") from error
    if not isinstance(value, dict):
        raise HandoffValidationError("metadata_invalid", "metadata.json 根节点必须是对象")
    return value


def _parse_marker(content: str) -> dict[str, Any]:
    try:
        for event in yaml.parse(content):
            if isinstance(event, yaml.events.AliasEvent) or getattr(event, "anchor", None):
                raise HandoffValidationError("marker_yaml_unsafe", "marker.yaml 不允许 aliases 或 anchors")
            if getattr(event, "tag", None):
                raise HandoffValidationError("marker_yaml_unsafe", "marker.yaml 不允许显式 YAML tags")
            if isinstance(event, yaml.events.ScalarEvent) and event.value == "<<":
                raise HandoffValidationError("marker_yaml_unsafe", "marker.yaml 不允许 merge keys")
        value = yaml.load(content, Loader=_UniqueKeySafeLoader)
    except HandoffValidationError:
        raise
    except yaml.YAMLError as error:
        raise HandoffValidationError("marker_invalid", "marker.yaml 不是有效 YAML") from error
    if not isinstance(value, dict):
        raise HandoffValidationError("marker_invalid", "marker.yaml 根节点必须是对象")
    return value


def _file_record(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise HandoffValidationError("file_record_invalid", "交接包包含非法文件记录")
    path = str(raw.get("path") or "").replace("\\", "/")
    media_type = str(raw.get("media_type") or "")
    content = raw.get("content")
    if not _safe_relative_path(path):
        raise HandoffValidationError("file_path_invalid", f"非法交接包路径：{path or '<empty>'}")
    if not isinstance(content, str):
        raise HandoffValidationError("file_content_invalid", f"文件内容必须是文本：{path}")
    size = raw.get("size")
    sha256 = str(raw.get("sha256") or "")
    actual_size = len(content.encode("utf-8"))
    actual_sha256 = _sha256_text(content)
    if size != actual_size or sha256 != actual_sha256:
        raise HandoffValidationError("file_hash_mismatch", f"文件 hash 或大小不匹配：{path}")
    return {
        "path": path,
        "media_type": media_type,
        "content": content,
        "size": actual_size,
        "sha256": actual_sha256,
    }


def _validate_package(payload: dict[str, Any]) -> ValidatedPackage:
    if payload.get("kind") != "codex_knowledge_handoff_package":
        raise HandoffValidationError("kind_invalid", "不是 Codex 作者交接包")
    if payload.get("schema_version") != 1:
        raise HandoffValidationError("schema_version_invalid", "交接包 schema_version 不受支持")
    handoff_id = str(payload.get("handoff_id") or "").strip()
    workspace_key = str(payload.get("workspace_key") or "").strip()
    package_sha256 = str(payload.get("package_sha256") or "").strip()
    package_content_sha256 = str(payload.get("package_content_sha256") or "").strip()
    if not handoff_id or not workspace_key or len(package_sha256) != 64 or len(package_content_sha256) != 64:
        raise HandoffValidationError("identity_invalid", "交接包身份字段不完整")
    raw_files = payload.get("files")
    if not isinstance(raw_files, list) or len(raw_files) < 5:
        raise HandoffValidationError("file_set_invalid", "交接包必须包含 3+N 文件、metadata.json 和 .complete")
    files = [_file_record(raw) for raw in raw_files]
    paths = [file["path"] for file in files]
    if len(paths) != len(set(paths)):
        raise HandoffValidationError("file_set_invalid", "交接包不能包含重复路径")
    expected_top_level = {"handoff.md", "marker.yaml", "metadata.json", ".complete"}
    candidate_paths = {
        path for path in paths if path.startswith("candidates/") and path.endswith(".md") and path.count("/") == 1
    }
    if not candidate_paths:
        raise HandoffValidationError("candidate_missing", "交接包必须包含 candidates/*.md")
    if not expected_top_level.issubset(paths) or any(
        path not in _ALLOWED_TOP_LEVEL_FILES and path not in candidate_paths for path in paths
    ):
        raise HandoffValidationError("file_set_invalid", "交接包文件清单不符合 3+N 契约")

    manifest_records = [
        {
            "path": file["path"],
            "media_type": file["media_type"],
            "size": file["size"],
            "sha256": file["sha256"],
        }
        for file in files
        if file["path"] not in {"metadata.json", ".complete"}
    ]
    if _manifest_hash(manifest_records) != package_sha256:
        raise HandoffValidationError("package_hash_mismatch", "package_sha256 与文件清单不一致")
    content_records = [
        {
            "path": file["path"],
            "media_type": file["media_type"],
            "size": file["size"],
            "sha256": file["sha256"],
        }
        for file in files
    ]
    if _manifest_hash(content_records) != package_content_sha256:
        raise HandoffValidationError("package_content_hash_mismatch", "package_content_sha256 与文件清单不一致")

    file_by_path = {file["path"]: file for file in files}
    complete = file_by_path[".complete"]["content"]
    complete_handoff = re.search(r"^handoff_id:\s*(\S+)\s*$", complete, flags=re.MULTILINE)
    complete_package = re.search(r"^package_sha256:\s*([a-f0-9]{64})\s*$", complete, flags=re.MULTILINE)
    if not complete_handoff or complete_handoff.group(1) != handoff_id:
        raise HandoffValidationError("complete_invalid", ".complete 的 handoff_id 不一致")
    if not complete_package or complete_package.group(1) != package_sha256:
        raise HandoffValidationError("complete_invalid", ".complete 的 package_sha256 不一致")

    metadata = _parse_metadata(file_by_path["metadata.json"]["content"])
    if metadata.get("handoff_id") != handoff_id:
        raise HandoffValidationError("metadata_identity_mismatch", "metadata.handoff_id 不一致")
    metadata_workspace = _as_dict(metadata.get("workspace")).get("workspace_key")
    if metadata_workspace != workspace_key:
        raise HandoffValidationError("metadata_identity_mismatch", "metadata.workspace.workspace_key 不一致")
    metadata_artifacts = _as_list(metadata.get("artifacts"))
    if metadata_artifacts != manifest_records:
        raise HandoffValidationError("metadata_artifacts_mismatch", "metadata.artifacts 与运输文件清单不一致")

    marker = _parse_marker(file_by_path["marker.yaml"]["content"])
    if marker.get("kind") != "codex_knowledge_marker" or marker.get("schema_version") != 1:
        raise HandoffValidationError("marker_invalid", "marker kind 或 schema_version 不受支持")
    marker_candidates = _as_list(marker.get("knowledge_candidates"))
    if not marker_candidates:
        raise HandoffValidationError("candidate_missing", "marker.yaml 没有 knowledge_candidates")
    candidate_by_path: dict[str, dict[str, Any]] = {}
    candidate_local_ids: set[str] = set()
    for raw_candidate in marker_candidates:
        candidate = _as_dict(raw_candidate)
        local_id = str(candidate.get("local_id") or "").strip()
        artifact = _as_dict(candidate.get("artifact"))
        artifact_path = str(artifact.get("path") or "").replace("\\", "/")
        if not local_id or artifact_path not in candidate_paths:
            raise HandoffValidationError("candidate_reference_invalid", "candidate 的 artifact 引用无效")
        if local_id in candidate_local_ids:
            raise HandoffValidationError("candidate_reference_invalid", "candidate local_id 不能重复")
        if artifact.get("media_type") != "text/markdown":
            raise HandoffValidationError("candidate_reference_invalid", "candidate 必须引用 Markdown")
        if artifact_path in candidate_by_path:
            raise HandoffValidationError("candidate_reference_invalid", "candidate artifact 不能重复")
        candidate_local_ids.add(local_id)
        candidate_by_path[artifact_path] = candidate

    candidates: list[dict[str, Any]] = []
    for artifact_path, candidate in candidate_by_path.items():
        if file_by_path[artifact_path]["media_type"] != "text/markdown":
            raise HandoffValidationError("candidate_reference_invalid", "candidate artifact 必须是 Markdown")
        content = file_by_path[artifact_path]["content"]
        raw_evidence_hints = candidate.get("evidence_hints")
        evidence_hints, command_hints, runtime_observations = _normalize_evidence_hints(
            raw_evidence_hints
        )
        claim_payload = {
            "local_id": str(candidate["local_id"]),
            "title": str(candidate.get("title") or ""),
            "knowledge_kind_hint": str(candidate.get("knowledge_kind_hint") or ""),
            "change_kind": str(candidate.get("change_kind") or ""),
            "author_summary": str(candidate.get("author_summary") or ""),
            "why_reusable": str(candidate.get("why_reusable") or ""),
            "related_topic_hints": _as_list(candidate.get("related_topic_hints")),
            "term_changes": _as_list(candidate.get("term_changes")),
            "author_evidence_hints": raw_evidence_hints,
            "evidence_hints": evidence_hints,
            "command_hints": command_hints,
            "runtime_observations": runtime_observations,
            "pending_verification": _as_list(candidate.get("pending_verification")),
            "content": content,
        }
        candidates.append(
            {
                "local_id": str(candidate["local_id"]),
                "title": str(candidate.get("title") or ""),
                "knowledge_kind_hint": str(candidate.get("knowledge_kind_hint") or ""),
                "change_kind": str(candidate.get("change_kind") or ""),
                "author_summary": str(candidate.get("author_summary") or ""),
                "why_reusable": str(candidate.get("why_reusable") or ""),
                "related_topic_hints": [
                    str(item) for item in _as_list(candidate.get("related_topic_hints")) if str(item).strip()
                ],
                "term_changes": _as_list(candidate.get("term_changes")),
                "author_evidence_hints": raw_evidence_hints,
                "evidence_hints": evidence_hints,
                "command_hints": command_hints,
                "runtime_observations": runtime_observations,
                "pending_verification": [
                    str(item) for item in _as_list(candidate.get("pending_verification")) if str(item).strip()
                ],
                "content": content,
                "content_sha256": file_by_path[artifact_path]["sha256"],
                "claim_sha256": _sha256_text(_canonical_json(claim_payload)),
                "artifact_path": artifact_path,
            }
        )
    if set(candidate_by_path) != candidate_paths:
        raise HandoffValidationError("candidate_reference_invalid", "所有 candidate 文件都必须由 marker.yaml 引用")
    return ValidatedPackage(payload=payload, metadata=metadata, marker=marker, candidates=candidates)


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        raise ValueError((result.stderr or result.stdout).strip() or "git command failed")
    return result.stdout.strip()


def _is_durable_revision(repo: Path, revision: str, durable_ref: str) -> bool:
    try:
        _git(repo, "rev-parse", "--verify", f"{revision}^{{commit}}")
        durable_commit = _git(repo, "rev-parse", "--verify", f"{durable_ref}^{{commit}}")
        result = subprocess.run(
            ["git", "merge-base", "--is-ancestor", revision, durable_commit],
            cwd=repo,
            capture_output=True,
        )
        return result.returncode == 0
    except ValueError:
        return False


def _verify_command_hints(
    *,
    repo: Path,
    revision: str,
    evidence_hints: list[Any],
) -> list[dict[str, Any]]:
    safe_git_commands = {
        ("git", "status", "--porcelain"),
        ("git", "status", "--porcelain=v1", "--untracked-files=all"),
        ("git", "rev-parse", "HEAD"),
    }
    verifications: list[dict[str, Any]] = []
    for raw_hint in evidence_hints:
        hint = _as_dict(raw_hint)
        command = str(hint.get("command") or "").strip()
        if not command:
            continue
        argv = shlex.split(command, posix=False)
        if not argv:
            raise ValueError("evidence command is empty")
        normalized_executable = argv[0].strip('"').casefold()
        if normalized_executable not in {"git", "git.exe"}:
            raise ValueError("evidence command executable must be the system git command")
        normalized_argv = ("git", *argv[1:])
        if normalized_argv not in safe_git_commands:
            raise ValueError("evidence command is not in the safe verification allowlist")
        if _git(repo, "rev-parse", "HEAD") != revision:
            raise ValueError("evidence command workspace HEAD does not match fixed revision")
        if _git(repo, "status", "--porcelain=v1", "--untracked-files=all"):
            raise ValueError("evidence command workspace is dirty")
        try:
            output = _git(repo, *normalized_argv[1:])
            exit_code = 0
        except ValueError as error:
            output = str(error)
            exit_code = 1
        verifications.append(
            {
                "command": _redact_local_paths(command),
                "exit_code": exit_code,
                "status": "verified" if exit_code == 0 else "failed",
                "output_sha256": f"sha256:{_sha256_text(output)}",
            }
        )
        if exit_code != 0:
            raise ValueError("evidence command returned a non-zero exit code")
    return verifications


def _repository_state(
    *,
    workspace_key: str,
    metadata: dict[str, Any],
    workspace_paths: dict[str, Path],
    durable_refs: dict[str, str],
    allow_recovery: bool,
) -> tuple[str, str | None, dict[str, Any]]:
    capture = _as_dict(metadata.get("repository_capture"))
    head_commit = str(capture.get("head_commit") or "").strip() or None
    repo_path = workspace_paths.get(workspace_key)
    actual_dirty: bool | None = None
    if allow_recovery and repo_path is not None:
        try:
            recovered_head = _git(repo_path, "rev-parse", "HEAD")
            recovered_status = _git(repo_path, "status", "--porcelain=v1", "--untracked-files=all")
            actual_dirty = bool(recovered_status)
            if recovered_head and not recovered_status:
                head_commit = recovered_head
                capture = {
                    **capture,
                    "detected": True,
                    "head_commit": recovered_head,
                    "dirty": False,
                }
        except ValueError:
            pass
    elif repo_path is not None:
        try:
            actual_dirty = bool(_git(repo_path, "status", "--porcelain=v1", "--untracked-files=all"))
        except ValueError:
            actual_dirty = True
    if actual_dirty:
        return (
            "needs_repository_revision",
            head_commit,
            {
                "repository_detected": bool(capture.get("detected")),
                "head_commit": head_commit,
                "dirty": True,
                "workspace_configured": repo_path is not None,
            },
        )
    if not capture.get("detected") or not head_commit or capture.get("dirty") or repo_path is None:
        return (
            "needs_repository_revision",
            head_commit,
            {
                "repository_detected": bool(capture.get("detected")),
                "head_commit": head_commit,
                "dirty": bool(capture.get("dirty")),
                "workspace_configured": repo_path is not None,
            },
        )
    durable_ref = str(durable_refs.get(workspace_key) or "").strip()
    if not durable_ref:
        return (
            "needs_durable_revision",
            head_commit,
            {"head_commit": head_commit, "durable_ref_configured": False},
        )
    if not _is_durable_revision(repo_path, head_commit, durable_ref):
        return (
            "needs_durable_revision",
            head_commit,
            {"head_commit": head_commit, "durable_ref": durable_ref, "durable_ref_contains_revision": False},
        )
    return (
        "revision_ready",
        head_commit,
        {"head_commit": head_commit, "durable_ref": durable_ref, "durable_ref_contains_revision": True},
    )


def _next_action(status: str) -> str:
    return {
        "needs_repository_revision": "commit_clean_workspace",
        "needs_durable_revision": "push_or_configure_durable_ref",
        "needs_evidence": "add_or_fix_repository_evidence",
        "needs_author_explanation": "create_author_supplement",
        "ready_for_review": "send_bounded_candidate_review",
    }.get(status, "inspect_gate_result")


def _candidate_delivery(
    *,
    package: ValidatedPackage,
    candidate: dict[str, Any],
    candidate_id: str,
    candidate_revision: int,
    evidence_revision: int,
    evidence_pack: dict[str, Any],
) -> dict[str, Any]:
    return {
        "kind": "codex_knowledge_candidate_review",
        "schema_version": 1,
        "workspace_key": package.payload["workspace_key"],
        "candidate_id": candidate_id,
        "candidate_revision": candidate_revision,
        "evidence_revision": evidence_revision,
        "candidate": {
            "local_id": candidate["local_id"],
            "title": _redact_local_paths(candidate["title"]),
            "knowledge_kind_hint": candidate["knowledge_kind_hint"],
            "change_kind": candidate["change_kind"],
            "author_summary": _redact_local_paths(candidate["author_summary"]),
            "why_reusable": _redact_local_paths(candidate["why_reusable"]),
            "related_topic_hints": [_redact_local_paths(item) for item in candidate["related_topic_hints"]],
            "term_changes": _redact_value(candidate.get("term_changes") or []),
            "pending_verification": [
                _redact_local_paths(item) for item in candidate.get("pending_verification", [])
            ],
            "evidence_hints": _redact_value(candidate.get("author_evidence_hints") or {}),
            "content": _redact_local_paths(candidate["content"]),
        },
        "evidence": _redact_value(evidence_pack),
        "ownership": {
            "vault_topic_resolution": "openclaw",
            "content_review": "openclaw",
            "publication_review": "openclaw",
        },
    }


def reconcile_candidate(
    *,
    store: CodexAuthorKnowledgeHandoffStore,
    candidate_row: dict[str, Any],
    package: ValidatedPackage,
    workspace_paths: dict[str, Path],
    durable_refs: dict[str, str],
    allow_recovery: bool = False,
) -> dict[str, Any]:
    candidate = candidate_row["payload"]
    candidate_id = str(candidate_row["candidate_id"])
    candidate_revision = int(candidate_row["candidate_revision"])
    repository_state, current_revision, blocking_object = _repository_state(
        workspace_key=str(candidate_row["workspace_key"]),
        metadata=package.metadata,
        workspace_paths=workspace_paths,
        durable_refs=durable_refs,
        allow_recovery=allow_recovery,
    )
    evidence_hints = candidate.get("evidence_hints") or []
    command_hints = candidate.get("command_hints") or []
    evidence_pack: dict[str, Any] = {
        "kind": "repository_evidence_pack",
        "schema_version": 1,
        "repository_snapshot": {
            "repository_id": candidate_row["workspace_key"],
            "commit_sha": current_revision,
        },
        "evidence_refs": [],
        "stats": {"files_inspected": 0, "evidence_count": 0},
        "command_verifications": [],
    }
    reasons: list[str] = []
    status = repository_state
    if status == "revision_ready":
        if not candidate.get("author_summary") or not candidate.get("why_reusable"):
            status = "needs_author_explanation"
            reasons.append("missing_author_explanation")
        elif not evidence_hints:
            status = "needs_evidence"
            reasons.append("missing_evidence_hints")
        elif candidate.get("pending_verification"):
            status = "needs_evidence"
            reasons.append("pending_verification")
        else:
            try:
                hints = [
                    EvidenceHint.model_validate(
                        {
                            **_as_dict(raw_hint),
                            "role": _as_dict(raw_hint).get("role") or "implementation",
                        }
                    )
                    for raw_hint in evidence_hints
                ]
                evidence_pack = resolve_repository_evidence(
                    RepositoryEvidenceRequest(
                        workspace_path=str(workspace_paths[candidate_row["workspace_key"]]),
                        repository_id=candidate_row["workspace_key"],
                        revision=current_revision or "",
                        hints=hints,
                    )
                )
                evidence_pack["command_verifications"] = _verify_command_hints(
                    repo=workspace_paths[candidate_row["workspace_key"]],
                    revision=current_revision or "",
                    evidence_hints=command_hints,
                )
            except Exception as error:
                status = "needs_evidence"
                reasons.append("repository_evidence_unresolved")
                blocking_object["error"] = _redact_local_paths(str(error))
            if not evidence_pack["evidence_refs"]:
                status = "needs_evidence"
                if "missing_evidence_refs" not in reasons:
                    reasons.append("missing_evidence_refs")
    if status == "revision_ready":
        status = "ready_for_review"
    if status == "needs_repository_revision" and not reasons:
        reasons.append("repository_revision_not_fixed")
    if status == "needs_durable_revision" and not reasons:
        reasons.append("durable_revision_not_reached")

    evidence_row = store.save_evidence_revision(
        candidate_id=candidate_id,
        candidate_revision=candidate_revision,
        workspace_key=candidate_row["workspace_key"],
        repository_id=candidate_row["workspace_key"],
        revision=current_revision,
        status=status,
        payload=evidence_pack,
    )
    evidence_revision = int(evidence_row["evidence_revision"])
    gate_payload = {
        "candidate_id": candidate_id,
        "candidate_revision": candidate_revision,
        "evidence_revision": evidence_revision,
        "status": status,
        "reason_codes": reasons,
        "evidence_revision_id": evidence_row["evidence_revision_id"],
        "blocking_object": blocking_object,
    }
    gate = store.save_gate_result(
        candidate_id=candidate_id,
        candidate_revision=candidate_revision,
        status=status,
        reason_codes=reasons,
        blocking_object=blocking_object,
        current_revision=current_revision,
        next_action=_next_action(status),
        payload=gate_payload,
    )
    delivery = None
    if status == "ready_for_review":
        delivery_payload = _candidate_delivery(
            package=package,
            candidate=candidate,
            candidate_id=candidate_id,
            candidate_revision=candidate_revision,
            evidence_revision=evidence_revision,
            evidence_pack=evidence_pack,
        )
        delivery = store.create_delivery(
            run_id=(
                f"project-knowledge:{candidate_row['workspace_key']}:candidate:"
                f"{candidate_id}:{candidate_revision}"
            ),
            candidate_id=candidate_id,
            candidate_revision=candidate_revision,
            evidence_revision=evidence_revision,
            payload=delivery_payload,
        )
    return {
        "candidate_id": candidate_id,
        "candidate_revision": candidate_revision,
        "gate_status": status,
        "reason_codes": reasons,
        "evidence_revision": evidence_revision,
        "delivery_id": delivery["delivery_id"] if delivery else None,
        "gate_id": gate["gate_id"],
    }


def receive_handoff(
    *,
    store: CodexAuthorKnowledgeHandoffStore,
    payload: dict[str, Any],
    idempotency_key: str | None,
    workspace_paths: dict[str, Path],
    durable_refs: dict[str, str],
) -> dict[str, Any]:
    package = _validate_package(payload)
    expected_idempotency_key = f"{payload['handoff_id']}:{payload['package_sha256']}"
    if not idempotency_key:
        raise HandoffValidationError("idempotency_key_missing", "必须提供 Idempotency-Key")
    if idempotency_key.strip() != expected_idempotency_key:
        raise HandoffValidationError("idempotency_key_mismatch", "Idempotency-Key 与交接包身份不一致")
    package_key = f"{payload['workspace_key']}:{payload['handoff_id']}:{payload['package_sha256']}"
    existing = store.find_package(package_key)
    if existing is not None:
        return {
            "outcome": "duplicate",
            "ack_id": existing["ack_id"],
            "package_id": existing["package_id"],
            "candidates": [
                {
                    "candidate_id": item["candidate_id"],
                    "candidate_revision": item["candidate_revision"],
                    "gate_status": item["status"],
                }
                for item in store.list_package_candidates(existing["package_id"])
            ],
        }
    package_id = "package_" + hashlib.sha256(package_key.encode("utf-8")).hexdigest()[:24]
    ack_id = "ack_" + hashlib.sha256(package_key.encode("utf-8")).hexdigest()[:32]
    created = store.create_package(
        package_id=package_id,
        package_key=package_key,
        handoff_id=payload["handoff_id"],
        workspace_key=payload["workspace_key"],
        package_sha256=payload["package_sha256"],
        package_content_sha256=payload["package_content_sha256"],
        ack_id=ack_id,
        payload=payload,
        metadata=package.metadata,
        candidates=package.candidates,
    )
    candidate_rows = [
        item for item in store.list_package_candidates(created["package_id"])
    ]
    results: list[dict[str, Any]] = []
    for candidate_row in candidate_rows:
        results.append(
            reconcile_candidate(
                store=store,
                candidate_row=candidate_row,
                package=package,
                workspace_paths=workspace_paths,
                durable_refs=durable_refs,
                allow_recovery=False,
            )
        )
    return {
        "outcome": "accepted",
        "ack_id": created["ack_id"],
        "package_id": created["package_id"],
        "candidates": results,
    }


def reconcile_workspace(
    *,
    store: CodexAuthorKnowledgeHandoffStore,
    workspace_key: str | None,
    workspace_paths: dict[str, Path],
    durable_refs: dict[str, str],
) -> dict[str, Any]:
    rows = store.list_candidate_revisions(workspace_key=workspace_key, limit=None)
    results: list[dict[str, Any]] = []
    packages: dict[str, ValidatedPackage] = {}
    for row in rows:
        if row["status"] == "delivered_to_openclaw":
            continue
        package_id = str(row["package_id"])
        package = packages.get(package_id)
        if package is None:
            stored_package = store.get_package(package_id)
            if stored_package is None:
                continue
            package = _validate_package(stored_package["payload"])
            packages[package_id] = package
        results.append(
            reconcile_candidate(
                store=store,
                candidate_row=row,
                package=package,
                workspace_paths=workspace_paths,
                durable_refs=durable_refs,
                allow_recovery=True,
            )
        )
    return {
        "status": "reconciled",
        "workspace_key": workspace_key,
        "reconciled": len(results),
        "results": results,
    }


async def run_codex_author_knowledge_reconciliation_worker(app: Any) -> None:
    """Git 提示只是加速器；此 worker 才是最终的周期性 reconciliation 兜底。"""

    settings = app.state.settings
    store = app.state.knowledge_handoff_store
    interval = max(1.0, float(settings.codex_author_knowledge_reconciliation_interval_seconds))
    while True:
        try:
            reconcile_workspace(
                store=store,
                workspace_key=None,
                workspace_paths=settings.codex_workspace_paths,
                durable_refs=settings.codex_author_knowledge_durable_refs,
            )
        except Exception:
            # Gate 结果必须保留在账本中；单次 worker 失败不能终止后续 reconciliation。
            pass
        await asyncio.sleep(interval)
