from __future__ import annotations

import json
import re
from typing import Any


_MAX_TEXT_CHARS = 4000
_MAX_EVIDENCE_EXCERPT_CHARS = 1000


def _compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _redact_sensitive_text(value: str) -> str:
    value = re.sub(
        r"\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)([\"']?)[^\s\"',;]+",
        r"\1[redacted]",
        value,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b", "[redacted]", value)


def _bounded_text(value: Any, limit: int = _MAX_TEXT_CHARS) -> str:
    text = str(value or "").replace("\r\n", "\n").strip()
    return _redact_sensitive_text(text)[:limit]


def _slug_path_part(value: Any, fallback: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "").strip()).strip("-")
    return text[:120] or fallback


def _frontmatter_value(value: Any) -> str:
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return "null"
    return str(value).replace("\n", " ")


def _evidence_items(review: dict[str, Any] | None, memory: dict[str, Any]) -> list[dict[str, str]]:
    details = (review or {}).get("details") if isinstance((review or {}).get("details"), dict) else {}
    raw_items = details.get("evidence") if isinstance(details, dict) else []
    refs = {str(item) for item in memory.get("evidence_refs") or []}
    items: list[dict[str, str]] = []
    if isinstance(raw_items, list):
        for index, raw in enumerate(raw_items):
            if not isinstance(raw, dict):
                continue
            evidence_id = str(raw.get("id") or f"evidence_{index}")
            if refs and evidence_id not in refs:
                continue
            items.append(
                {
                    "id": evidence_id,
                    "source": _compact_text(raw.get("source")) or "codex_review_items",
                    "type": _compact_text(raw.get("type")) or "evidence",
                    "excerpt": _bounded_text(raw.get("excerpt"), _MAX_EVIDENCE_EXCERPT_CHARS),
                }
            )
    if items:
        return items
    return [
        {
            "id": ref,
            "source": "codex_review_items.details",
            "type": "evidence_ref",
            "excerpt": "",
        }
        for ref in sorted(refs)
    ]


def _markdown_page(
    *,
    frontmatter: dict[str, Any],
    title: str,
    body: str,
    evidence: list[dict[str, str]],
    provenance: dict[str, Any],
) -> str:
    lines = ["---"]
    lines.extend(f"{key}: {_frontmatter_value(value)}" for key, value in frontmatter.items())
    lines.extend(["---", "", f"# {title}", "", body, ""])
    if evidence:
        lines.extend(["## Evidence", ""])
        for item in evidence:
            excerpt = item.get("excerpt") or ""
            lines.append(f"- `{item['id']}` ({item['source']}/{item['type']}): {excerpt}")
        lines.append("")
    lines.extend(
        [
            "## Provenance",
            "",
            f"- source_review_item_id: `{provenance['source_review_item_id']}`",
            f"- pet_session_id: `{provenance['pet_session_id']}`",
            f"- codex_session_id: `{provenance['codex_session_id']}`",
        ]
    )
    return "\n".join(lines).rstrip() + "\n"


def build_codex_review_memory_wiki_payload(store: Any, memory_id: str) -> dict[str, Any] | None:
    memory = store.get_codex_review_memory(memory_id)
    if memory is None:
        return None
    review = store.get_codex_review_item(str(memory["source_review_item_id"]))
    confirmed_at = str(memory.get("confirmed_at") or memory.get("created_at") or "")
    confirmed_date = confirmed_at[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", confirmed_at) else "undated"
    workspace_id = _slug_path_part(memory.get("workspace_id"), "unknown-workspace")
    wiki_path = f"sources/codex-review/{workspace_id}/{confirmed_date}/{memory['id']}.md"
    title = _bounded_text(memory.get("title"), 240) or "Codex review memory"
    body = _bounded_text(memory.get("body"))
    details = memory.get("details") if isinstance(memory.get("details"), dict) else {}
    tags = [str(item) for item in memory.get("tags") or []]
    evidence_refs = [str(item) for item in memory.get("evidence_refs") or []]
    frontmatter = {
        "id": memory["id"],
        "workspace_id": memory.get("workspace_id"),
        "memory_type": memory.get("memory_type"),
        "knowledge_kind": details.get("knowledge_kind"),
        "source_review_item_id": memory.get("source_review_item_id"),
        "pet_session_id": memory.get("pet_session_id"),
        "codex_session_id": memory.get("codex_session_id"),
        "confirmed_by": memory.get("confirmed_by"),
        "confirmed_at": memory.get("confirmed_at"),
        "version": memory.get("current_version"),
        "status": "accepted",
        "tags": tags,
        "evidence_refs": evidence_refs,
    }
    provenance = {
        "source_review_item_id": memory.get("source_review_item_id"),
        "source_hash": memory.get("source_hash"),
        "pet_session_id": memory.get("pet_session_id"),
        "codex_session_id": memory.get("codex_session_id"),
        "review_item_type": (review or {}).get("item_type"),
        "review_source": (review or {}).get("source"),
        "review_status": (review or {}).get("status"),
    }
    evidence = _evidence_items(review, memory)
    return {
        "kind": "codex_review_memory_wiki_payload",
        "schema_version": 1,
        "memory": {
            "id": memory["id"],
            "workspace_id": memory.get("workspace_id"),
            "memory_type": memory.get("memory_type"),
            "title": title,
            "body": body,
            "details": details,
            "tags": tags,
            "evidence_refs": evidence_refs,
            "source_review_item_id": memory.get("source_review_item_id"),
            "confirmed_by": memory.get("confirmed_by"),
            "confirmed_at": memory.get("confirmed_at"),
            "current_version": memory.get("current_version"),
        },
        "wiki": {
            "path": wiki_path,
            "frontmatter": frontmatter,
            "markdown": _markdown_page(
                frontmatter=frontmatter,
                title=title,
                body=body,
                evidence=evidence,
                provenance=provenance,
            ),
        },
        "evidence": evidence,
        "provenance": provenance,
    }
