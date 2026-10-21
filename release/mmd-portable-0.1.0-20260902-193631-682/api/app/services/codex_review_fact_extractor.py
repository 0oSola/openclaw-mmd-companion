from __future__ import annotations

import re
from typing import Any


_MAX_EXCERPT_CHARS = 1000
_MAX_CHANGED_FILES = 100
_MAX_EVIDENCE_ITEMS = 100
_MAX_WORK_ITEMS = 50
_MAX_METHODS = 50


def _compact_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _bounded_text(value: Any, limit: int = _MAX_EXCERPT_CHARS) -> str:
    text = str(value or "").replace("\r\n", "\n").strip()
    text = _redact_sensitive_text(text)
    return text[:limit]


def _redact_sensitive_text(value: str) -> str:
    value = re.sub(
        r"\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)([\"']?)[^\s\"',;]+",
        r"\1[redacted]",
        value,
        flags=re.IGNORECASE,
    )
    return re.sub(r"\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b", "[redacted]", value)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _command_text(value: Any) -> str | None:
    if isinstance(value, list):
        return " ".join(_compact_text(item) for item in value if _compact_text(item)) or None
    text = _compact_text(value)
    return text or None


def _add_unique_text(items: list[str], value: Any, *, limit: int = _MAX_CHANGED_FILES) -> None:
    text = _compact_text(value)
    if not text or text in items or len(items) >= limit:
        return
    items.append(text)


def _add_evidence(evidence: list[dict[str, Any]], item: dict[str, Any]) -> None:
    if len(evidence) >= _MAX_EVIDENCE_ITEMS:
        return
    evidence.append(item)


def _artifact_changed_files(artifact: dict[str, Any]) -> list[str]:
    metadata = _as_dict(artifact.get("metadata"))
    return [_compact_text(item) for item in _as_list(metadata.get("changed_files")) if _compact_text(item)]


def _bounded_work_items(value: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for raw in _as_list(value):
        record = _as_dict(raw)
        text = _bounded_text(record.get("text"), 500)
        if not text:
            continue
        items.append(
            {
                "kind": _compact_text(record.get("kind")) or "work_item",
                "source": _compact_text(record.get("source")) or None,
                "text": text,
                "timestamp": _compact_text(record.get("timestamp")) or None,
            }
        )
        if len(items) >= _MAX_WORK_ITEMS:
            break
    return items


def _bounded_methods(value: Any) -> list[dict[str, Any]]:
    methods: list[dict[str, Any]] = []
    for raw in _as_list(value):
        record = _as_dict(raw)
        name = _compact_text(record.get("name")) or "unknown"
        try:
            exit_code = int(record.get("exit_code")) if record.get("exit_code") is not None else None
        except (TypeError, ValueError):
            exit_code = None
        methods.append(
            {
                "kind": _compact_text(record.get("kind")) or "tool",
                "name": name,
                "command": _bounded_text(_command_text(record.get("command")), 500) or None,
                "outcome": _compact_text(record.get("outcome")) or "unknown",
                "exit_code": exit_code,
                "excerpt": _bounded_text(record.get("excerpt"), 500) or None,
                "timestamp": _compact_text(record.get("timestamp")) or None,
            }
        )
        if len(methods) >= _MAX_METHODS:
            break
    return methods


def _work_item_evidence_excerpt(work_items: list[dict[str, Any]]) -> str | None:
    pieces = [
        f"{item.get('kind')}: {item.get('text')}"
        for item in work_items
        if _compact_text(item.get("text"))
    ]
    return " | ".join(pieces)[:3000] if pieces else None


def _method_evidence_excerpt(methods: list[dict[str, Any]]) -> str | None:
    pieces: list[str] = []
    for item in methods:
        label = _compact_text(item.get("command")) or _compact_text(item.get("name"))
        if not label:
            continue
        outcome = _compact_text(item.get("outcome"))
        pieces.append(f"{item.get('kind')}: {label}" + (f" ({outcome})" if outcome else ""))
    return " | ".join(pieces)[:3000] if pieces else None


def _event_payload(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload")
    if isinstance(payload, dict):
        return payload
    return {}


def build_codex_review_evidence_pack(store: Any, pet_session_id: str) -> dict[str, Any]:
    pet_session = store.get_desktop_pet_session(pet_session_id)
    if pet_session is None:
        raise ValueError(f"desktop pet session not found: {pet_session_id}")

    codex_session_id = str(pet_session["codex_session_id"])
    metadata = _as_dict(pet_session.get("metadata"))
    pet_facts = _as_dict(metadata.get("facts"))
    artifacts = store.list_codex_artifacts(codex_session_id)
    events = store.list_codex_events(codex_session_id)
    pending_approvals = store.list_pending_codex_approvals(codex_session_id)

    changed_files: list[str] = []
    failed_commands: list[dict[str, Any]] = []
    successful_checks: list[dict[str, Any]] = []
    pending_approval_facts: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    evidence: list[dict[str, Any]] = []
    apply_failed = False

    _add_evidence(
        evidence,
        {
            "id": "pet_session",
            "source": "desktop_pet_sessions",
            "type": "session_summary",
            "excerpt": _bounded_text(pet_session.get("last_summary") or pet_session.get("first_prompt_preview")),
        },
    )

    for path in _as_list(pet_facts.get("changed_files")):
        _add_unique_text(changed_files, path)

    for index, item in enumerate(_as_list(pet_facts.get("failed_commands"))):
        record = _as_dict(item)
        command = _command_text(record.get("command"))
        try:
            exit_code = int(record.get("exit_code"))
        except (TypeError, ValueError):
            continue
        excerpt = _bounded_text(record.get("excerpt"))
        failed_commands.append({"command": command, "exit_code": exit_code, "excerpt": excerpt})
        _add_evidence(
            evidence,
            {
                "id": f"pet_failed_command_{index}",
                "source": "desktop_pet_sessions.metadata.facts",
                "type": "failed_command",
                "excerpt": excerpt,
            },
        )

    for item in _as_list(pet_facts.get("errors")):
        record = _as_dict(item)
        excerpt = _bounded_text(record.get("excerpt"))
        if excerpt:
            errors.append({"type": _compact_text(record.get("type")) or "error", "excerpt": excerpt})

    for artifact in artifacts:
        artifact_id = str(artifact.get("id") or "")
        kind = str(artifact.get("kind") or "")
        summary = _bounded_text(artifact.get("summary"), 500)
        for path in _artifact_changed_files(artifact):
            _add_unique_text(changed_files, path)
        _add_evidence(
            evidence,
            {
                "id": f"artifact_{kind}_{artifact_id}",
                "source": "codex_artifacts",
                "type": kind,
                "excerpt": summary,
                "artifact_id": artifact_id,
            },
        )
        if kind != "checks":
            continue
        for result in _as_list(_as_dict(artifact.get("metadata")).get("results")):
            result_record = _as_dict(result)
            try:
                exit_code = int(result_record.get("exit_code"))
            except (TypeError, ValueError):
                continue
            command = _command_text(result_record.get("command"))
            excerpt = _bounded_text(result_record.get("stderr") or result_record.get("stdout"))
            if exit_code == 0:
                successful_checks.append(
                    {
                        "check": _compact_text(result_record.get("check")) or "check",
                        "command": command,
                        "excerpt": excerpt,
                    }
                )
            else:
                failed_commands.append({"command": command, "exit_code": exit_code, "excerpt": excerpt})

    last_error = None
    for index, event in enumerate(events, start=1):
        event_type = str(event.get("event_type") or "")
        payload = _event_payload(event)
        if re.search(r"apply.*failed", event_type, re.IGNORECASE):
            apply_failed = True
        if not re.search(r"failed|error|process_exit", event_type, re.IGNORECASE):
            continue
        excerpt = _bounded_text(payload.get("error") or payload.get("message") or payload.get("reason"))
        if excerpt:
            last_error = excerpt
            errors.append({"type": event_type, "excerpt": excerpt})
            _add_evidence(
                evidence,
                {
                    "id": f"event_{event_type}_{index}",
                    "source": "codex_events",
                    "type": event_type,
                    "excerpt": excerpt,
                },
            )

    for approval in pending_approvals:
        item = {
            "id": str(approval.get("id")),
            "title": _compact_text(approval.get("title")) or "Approval request",
            "action_type": _compact_text(approval.get("action_type")) or None,
        }
        pending_approval_facts.append(item)
        _add_evidence(
            evidence,
            {
                "id": f"approval_{item['id']}",
                "source": "codex_approvals",
                "type": "pending_approval",
                "excerpt": item["title"],
            },
        )

    user_messages = [
        _bounded_text(msg, 500) for msg in _as_list(pet_facts.get("user_messages")) if _compact_text(msg)
    ]
    assistant_messages = [
        _bounded_text(msg, 800) for msg in _as_list(pet_facts.get("assistant_messages")) if _compact_text(msg)
    ]
    function_call_summaries = [
        {
            "name": _compact_text(_as_dict(item).get("name")) or "unknown",
            "command": _compact_text(_as_dict(item).get("command")) or None,
        }
        for item in _as_list(pet_facts.get("function_call_summaries"))
        if _compact_text(_as_dict(item).get("name"))
    ]
    work_items = _bounded_work_items(pet_facts.get("work_items"))
    methods = _bounded_methods(pet_facts.get("methods"))
    for method in methods:
        if method.get("kind") != "check" or method.get("outcome") != "success":
            continue
        check = _compact_text(method.get("name")) or "check"
        command = _command_text(method.get("command"))
        if any(item.get("check") == check and item.get("command") == command for item in successful_checks):
            continue
        successful_checks.append(
            {
                "check": check,
                "command": command,
                "excerpt": _bounded_text(method.get("excerpt")),
            }
        )

    _add_evidence(
        evidence,
        {
            "id": "user_messages",
            "source": "desktop_pet_sessions.metadata.facts",
            "type": "user_messages",
            "excerpt": " | ".join(user_messages)[:2000] if user_messages else None,
        },
    )
    _add_evidence(
        evidence,
        {
            "id": "assistant_messages",
            "source": "desktop_pet_sessions.metadata.facts",
            "type": "assistant_messages",
            "excerpt": " | ".join(assistant_messages)[:3000] if assistant_messages else None,
        },
    )
    _add_evidence(
        evidence,
        {
            "id": "work_items",
            "source": "desktop_pet_sessions.metadata.facts",
            "type": "work_items",
            "excerpt": _work_item_evidence_excerpt(work_items),
        },
    )
    _add_evidence(
        evidence,
        {
            "id": "methods",
            "source": "desktop_pet_sessions.metadata.facts",
            "type": "methods",
            "excerpt": _method_evidence_excerpt(methods),
        },
    )

    return {
        "kind": "codex_review_evidence_pack",
        "schema_version": 1,
        "session": {
            "pet_session_id": pet_session["pet_session_id"],
            "codex_session_id": codex_session_id,
            "workspace_id": pet_session.get("workspace_id"),
            "workspace_label": _compact_text(pet_session.get("workspace_id")) or "workspace",
            "display_title": pet_session.get("display_title"),
            "status": pet_session.get("last_status"),
            "first_goal": pet_session.get("first_prompt_preview"),
            "last_summary": pet_session.get("last_summary"),
            "last_event_at": metadata.get("last_event_at"),
            "session_parser_version": _compact_text(metadata.get("session_parser_version")) or None,
            "review_facts_version": _compact_text(metadata.get("review_facts_version")) or None,
        },
        "facts": {
            "changed_files": changed_files,
            "failed_commands": failed_commands,
            "successful_checks": successful_checks,
            "pending_approvals": pending_approval_facts,
            "errors": errors,
            "apply_failed": apply_failed,
            "last_error": last_error,
            "last_output_excerpt": _bounded_text(metadata.get("last_output")),
            "event_counts": _as_dict(pet_facts.get("event_counts")),
            "user_messages": user_messages,
            "assistant_messages": assistant_messages,
            "function_call_summaries": function_call_summaries,
            "work_items": work_items,
            "methods": methods,
        },
        "evidence": evidence,
    }
