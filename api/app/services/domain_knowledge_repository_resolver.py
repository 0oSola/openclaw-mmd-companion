from __future__ import annotations

import ast
import hashlib
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import subprocess
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.domain_knowledge import EvidenceReference


_SECRET_PATH_PARTS = {
    ".env",
    ".env.local",
    ".env.production",
    "credentials",
    "credentials.json",
    "secrets",
    "secrets.json",
    "id_rsa",
    "id_ed25519",
}
_SECRET_CONTENT = re.compile(
    r"(?i)(?:api[_-]?key|access[_-]?token|secret|password|private[_-]?key)\s*[:=]\s*['\"]?[^\s'\"]{8,}"
)


class _ResolverModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceHint(_ResolverModel):
    role: str
    path: str
    symbol: str | None = Field(default=None, max_length=500)
    line_start: int | None = Field(default=None, ge=1)
    line_end: int | None = Field(default=None, ge=1)
    command: str | None = Field(default=None, max_length=4000)
    outcome: str | None = None
    exit_code: int | None = None
    source_event_ids: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        normalized = value.replace("\\", "/").strip()
        if (
            not normalized
            or normalized.startswith(("/", "~"))
            or PureWindowsPath(value).is_absolute()
            or ".." in PurePosixPath(normalized).parts
        ):
            raise ValueError("path must be workspace-relative")
        if any(part.casefold() in _SECRET_PATH_PARTS for part in PurePosixPath(normalized).parts):
            raise ValueError("secret-like path is not allowed")
        return normalized


class RepositoryEvidenceRequest(_ResolverModel):
    workspace_path: str
    repository_id: str = Field(min_length=1, max_length=160)
    revision: str = Field(min_length=1, max_length=160)
    hints: list[EvidenceHint] = Field(default_factory=list, max_length=50)
    max_snippet_lines: int = Field(default=200, ge=1, le=500)
    max_snippet_bytes: int = Field(default=32_000, ge=256, le=128_000)


def _git(repo: Path, *args: str, strip: bool = True) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise ValueError(detail or f"git {' '.join(args)} failed")
    return result.stdout.strip() if strip else result.stdout


def _fixed_revision(repo: Path, revision: str) -> str:
    try:
        return _git(repo, "rev-parse", "--verify", f"{revision}^{{commit}}")
    except ValueError as error:
        raise ValueError(f"repository revision is stale or invalid: {revision}") from error


def _read_blob(repo: Path, revision: str, path: str) -> tuple[str, str]:
    try:
        blob_sha = _git(repo, "rev-parse", f"{revision}:{path}")
        content = _git(repo, "show", f"{revision}:{path}", strip=False)
    except ValueError as error:
        raise ValueError(f"repository path not found at revision: {path}") from error
    return blob_sha, content


def _python_symbol_range(content: str, symbol: str) -> tuple[int, int] | None:
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return None
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == symbol:
            line_end = getattr(node, "end_lineno", None) or node.lineno
            return int(node.lineno), int(line_end)
    return None


def _generic_symbol_range(content: str, symbol: str) -> tuple[int, int] | None:
    pattern = re.compile(rf"\b{re.escape(symbol)}\b")
    for index, line in enumerate(content.splitlines(), start=1):
        if pattern.search(line):
            return index, index
    return None


def _resolve_range(content: str, hint: EvidenceHint) -> tuple[int, int]:
    lines = content.splitlines(keepends=True)
    if hint.symbol:
        symbol_range = (
            _python_symbol_range(content, hint.symbol)
            if hint.path.endswith(".py")
            else _generic_symbol_range(content, hint.symbol)
        )
        if symbol_range is None:
            raise ValueError(f"symbol not found at revision: {hint.symbol} in {hint.path}")
        return symbol_range
    if hint.line_start is not None or hint.line_end is not None:
        if hint.line_start is None or hint.line_end is None or hint.line_end < hint.line_start:
            raise ValueError("line_start and line_end must form a valid range")
        if hint.line_end > len(lines):
            raise ValueError(f"line range exceeds file at revision: {hint.path}")
        return hint.line_start, hint.line_end
    return 1, len(lines)


def _bounded_snippet(content: str, line_start: int, line_end: int, *, max_lines: int, max_bytes: int) -> str:
    if line_end - line_start + 1 > max_lines:
        raise ValueError("resolved snippet exceeds configured line limit")
    lines = content.splitlines(keepends=True)
    snippet = "".join(lines[line_start - 1 : line_end])
    if len(snippet.encode("utf-8")) > max_bytes:
        raise ValueError("resolved snippet exceeds configured byte limit")
    if _SECRET_CONTENT.search(snippet):
        raise ValueError("resolved snippet contains secret-like content")
    return snippet


def _evidence_ref_id(payload: dict[str, Any]) -> str:
    source = "\n".join(
        str(payload.get(key) or "")
        for key in ("repository_id", "revision", "role", "path", "symbol", "snippet_sha256", "command")
    )
    return f"evidence_ref_{hashlib.sha256(source.encode('utf-8')).hexdigest()[:24]}"


def resolve_repository_evidence(raw_request: dict[str, Any] | RepositoryEvidenceRequest) -> dict[str, Any]:
    request = (
        raw_request
        if isinstance(raw_request, RepositoryEvidenceRequest)
        else RepositoryEvidenceRequest.model_validate(raw_request)
    )
    repo = Path(request.workspace_path).expanduser().resolve()
    if not repo.is_dir():
        raise ValueError(f"repository workspace does not exist: {repo}")
    commit_sha = _fixed_revision(repo, request.revision)
    evidence_refs: list[dict[str, Any]] = []
    inspected_paths: set[str] = set()

    for hint in request.hints:
        blob_sha, content = _read_blob(repo, commit_sha, hint.path)
        line_start, line_end = _resolve_range(content, hint)
        snippet = _bounded_snippet(
            content,
            line_start,
            line_end,
            max_lines=request.max_snippet_lines,
            max_bytes=request.max_snippet_bytes,
        )
        snippet_sha256 = f"sha256:{hashlib.sha256(snippet.encode('utf-8')).hexdigest()}"
        raw_ref = {
            "ref_id": "pending",
            "role": hint.role,
            "authority": "authoritative",
            "repository_id": request.repository_id,
            "revision": commit_sha,
            "blob_sha": blob_sha,
            "path": hint.path,
            "symbol": hint.symbol,
            "line_start": line_start,
            "line_end": line_end,
            "snippet": snippet,
            "snippet_sha256": snippet_sha256,
            "resolver_uri": (
                f"repo://{request.repository_id}/{commit_sha}/{hint.path}#L{line_start}-L{line_end}"
            ),
            "command": hint.command,
            "outcome": hint.outcome,
            "exit_code": hint.exit_code,
            "source_event_ids": hint.source_event_ids,
        }
        raw_ref["ref_id"] = _evidence_ref_id(raw_ref)
        evidence_refs.append(EvidenceReference.model_validate(raw_ref).model_dump(mode="json"))
        inspected_paths.add(hint.path)

    return {
        "kind": "repository_evidence_pack",
        "schema_version": 1,
        "repository_snapshot": {
            "repository_id": request.repository_id,
            "commit_sha": commit_sha,
        },
        "evidence_refs": evidence_refs,
        "stats": {
            "files_inspected": len(inspected_paths),
            "evidence_count": len(evidence_refs),
        },
    }
