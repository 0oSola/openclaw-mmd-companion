from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Any


@dataclass(slots=True)
class CodexMemoryExportResult:
    memory_id: str
    status: str
    document_ref: str
    path: Path


def _slugify(value: str, fallback: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip().lower()).strip("-")
    return text[:80] or fallback


def _frontmatter_value(value: Any) -> str:
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return "null"
    return str(value).replace("\n", " ")


def export_codex_review_memory_markdown(memory: dict[str, Any], export_root: str | Path) -> CodexMemoryExportResult:
    memory_id = str(memory["id"])
    workspace_id = str(memory.get("workspace_id") or "unknown")
    memory_type = str(memory.get("memory_type") or "memory")
    title = str(memory.get("title") or memory_type)
    body = str(memory.get("body") or "")
    details = memory.get("details") if isinstance(memory.get("details"), dict) else {}
    version = int(memory.get("current_version") or 1)
    category = {
        "work_summary": "summaries",
        "pitfall": "pitfalls",
        "decision": "decisions",
        "followup": "followups",
        "blocker": "blockers",
    }.get(memory_type, "memory")
    slug = _slugify(title, memory_id)
    root = Path(export_root)
    path = root / workspace_id / category / f"{slug}-{memory_id[-8:]}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    frontmatter = {
        "id": memory_id,
        "workspace_id": workspace_id,
        "type": memory_type,
        "knowledge_kind": details.get("knowledge_kind"),
        "source_review_item_id": memory.get("source_review_item_id"),
        "pet_session_id": memory.get("pet_session_id"),
        "codex_session_id": memory.get("codex_session_id"),
        "version": version,
        "status": "accepted",
        "tags": memory.get("tags") or [],
        "evidence_refs": memory.get("evidence_refs") or [],
        "confirmed_at": memory.get("confirmed_at"),
    }
    lines = ["---"]
    lines.extend(f"{key}: {_frontmatter_value(value)}" for key, value in frontmatter.items())
    lines.extend(["---", "", f"# {title}", "", body.rstrip(), ""])
    path.write_text("\n".join(lines), encoding="utf-8")
    return CodexMemoryExportResult(
        memory_id=memory_id,
        status="synced_markdown",
        document_ref=str(path.relative_to(root)).replace("\\", "/"),
        path=path,
    )
