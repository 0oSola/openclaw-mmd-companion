from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import re
from typing import Any
from uuid import uuid4

from app.services.codex_review_fact_extractor import build_codex_review_evidence_pack


def _strip_json_fence(text: str) -> str:
    stripped = text.strip()
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else stripped


def parse_openclaw_review_response(text: str) -> dict[str, Any]:
    try:
        payload = json.loads(_strip_json_fence(text))
    except json.JSONDecodeError as error:
        raise ValueError(f"OpenClaw review response was not valid JSON: {error.msg}") from error
    if not isinstance(payload, dict):
        raise ValueError("OpenClaw review response must be a JSON object")
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("OpenClaw review response schema_version must be 1")
    payload = _normalize_openclaw_review_payload(payload)
    _validate_openclaw_review_shape(payload)
    return payload


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any, default: str = "") -> str:
    text = " ".join(str(value or "").split())
    return text or default


def _review_item_from_scalar(value: Any, *, title: str) -> dict[str, Any] | None:
    text = _text(value)
    if not text:
        return None
    return {"title": title, "summary": text}


def _normalize_work_summary(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    item = _review_item_from_scalar(value, title="Work Summary")
    return item or {}


def _normalize_review_items(value: Any, *, title: str) -> list[Any]:
    if value is None:
        return []
    raw_items = value if isinstance(value, list) else [value]
    items: list[Any] = []
    for item in raw_items:
        if isinstance(item, dict):
            items.append(item)
            continue
        scalar_item = _review_item_from_scalar(item, title=title)
        if scalar_item is not None:
            items.append(scalar_item)
    return items


def _normalize_management(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalize_openclaw_review_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    if "work_summary" in normalized:
        normalized["work_summary"] = _normalize_work_summary(normalized.get("work_summary"))
    for key, title in (
        ("pitfalls", "Pitfall"),
        ("decisions", "Decision"),
        ("followups", "Followup"),
        ("blockers", "Blocker"),
    ):
        if key in normalized:
            normalized[key] = _normalize_review_items(normalized.get(key), title=title)
    if "management" in normalized:
        normalized["management"] = _normalize_management(normalized.get("management"))
    return normalized


def _tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    tags = []
    for item in value:
        text = _text(item)
        if text and text not in tags:
            tags.append(text[:80])
    return tags[:20]


def _json_size(value: dict[str, Any]) -> int:
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


def _json_clone(value: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _truncate_text(value: Any, limit: int) -> Any:
    if not isinstance(value, str) or len(value) <= limit:
        return value
    return value[:limit]


def _truncate_review_text_fields(evidence_pack: dict[str, Any], limit: int) -> None:
    session = _as_dict(evidence_pack.get("session"))
    for key in ("display_title", "first_goal", "last_summary"):
        session[key] = _truncate_text(session.get(key), limit)

    facts = _as_dict(evidence_pack.get("facts"))
    facts["last_error"] = _truncate_text(facts.get("last_error"), limit)
    facts["last_output_excerpt"] = _truncate_text(facts.get("last_output_excerpt"), limit)
    for key in ("failed_commands", "successful_checks", "errors", "pending_approvals", "work_items", "methods"):
        for item in _as_list(facts.get(key)):
            if not isinstance(item, dict):
                continue
            for text_key in ("command", "excerpt", "title", "check", "text", "name", "kind", "source", "outcome"):
                item[text_key] = _truncate_text(item.get(text_key), limit)

    for item in _as_list(evidence_pack.get("evidence")):
        if isinstance(item, dict):
            item["excerpt"] = _truncate_text(item.get("excerpt"), limit)


def prepare_openclaw_evidence_pack(evidence_pack: dict[str, Any], max_payload_chars: int | None) -> dict[str, Any]:
    prepared = _json_clone(evidence_pack)
    if max_payload_chars is None or max_payload_chars <= 0:
        return prepared

    original_size = _json_size(prepared)
    transport = prepared.setdefault("transport", {})
    transport["max_payload_chars"] = max_payload_chars
    transport["original_payload_chars"] = original_size
    transport["truncated_for_openclaw"] = False
    if _json_size(prepared) <= max_payload_chars:
        return prepared

    transport["truncated_for_openclaw"] = True
    _truncate_review_text_fields(prepared, 500)
    for key in ("evidence",):
        items = _as_list(prepared.get(key))
        while items and _json_size(prepared) > max_payload_chars:
            items.pop()

    facts = _as_dict(prepared.get("facts"))
    for key in ("errors", "failed_commands", "successful_checks", "pending_approvals", "changed_files"):
        items = _as_list(facts.get(key))
        while items and _json_size(prepared) > max_payload_chars:
            items.pop()

    # Narrative fields are kept longest because they carry the session story OpenClaw
    # needs for summarization. Truncation priority (first dropped to last dropped):
    #   1. function_call_summaries and methods (lowest density once output is huge)
    #   2. work_items trimmed to a small spine
    #   3. assistant_messages truncated to shorter per-message limits
    #   4. user_messages trimmed (usually short, high value - keep last)
    for key in ("function_call_summaries", "methods"):
        items = _as_list(facts.get(key))
        while items and _json_size(prepared) > max_payload_chars:
            items.pop()

    if _json_size(prepared) <= max_payload_chars:
        return prepared

    work_items = _as_list(facts.get("work_items"))
    while len(work_items) > 4 and _json_size(prepared) > max_payload_chars:
        work_items.pop()
    facts["work_items"] = work_items

    if _json_size(prepared) <= max_payload_chars:
        return prepared

    # Truncate assistant_messages to shorter per-message limits before dropping user_messages.
    assistant_items = _as_list(facts.get("assistant_messages"))
    for truncate_len in (400, 200, 100):
        facts["assistant_messages"] = [_truncate_text(msg, truncate_len) for msg in assistant_items]
        if _json_size(prepared) <= max_payload_chars:
            return prepared

    # Now trim user_messages, keeping at least the first 2.
    user_items = _as_list(facts.get("user_messages"))
    while len(user_items) > 2 and _json_size(prepared) > max_payload_chars:
        user_items.pop()
    facts["user_messages"] = user_items
    while user_items and len(user_items) > 2 and _json_size(prepared) > max_payload_chars:
        user_items.pop()
    facts["user_messages"] = user_items

    if _json_size(prepared) <= max_payload_chars:
        return prepared

    # Drop assistant_messages one by one.
    assistant_items = _as_list(facts.get("assistant_messages"))
    while assistant_items and _json_size(prepared) > max_payload_chars:
        assistant_items.pop()
    facts["assistant_messages"] = assistant_items

    if _json_size(prepared) <= max_payload_chars:
        return prepared

    _truncate_review_text_fields(prepared, 240)
    facts["event_counts"] = {}
    if _json_size(prepared) <= max_payload_chars:
        return prepared

    session = _as_dict(prepared.get("session"))
    minimal = {
        "kind": prepared.get("kind") or "codex_review_evidence_pack",
        "schema_version": prepared.get("schema_version") or 1,
        "session": {
            "pet_session_id": session.get("pet_session_id"),
            "codex_session_id": session.get("codex_session_id"),
            "workspace_id": session.get("workspace_id"),
            "workspace_label": session.get("workspace_label"),
            "display_title": _truncate_text(session.get("display_title"), 120),
            "status": session.get("status"),
            "first_goal": _truncate_text(session.get("first_goal"), 240),
        },
        "facts": {
            "truncated_for_openclaw": True,
            "last_error": _truncate_text(facts.get("last_error"), 240),
        },
        "evidence": [],
        "code_index": _as_list(prepared.get("code_index")),
        "transport": transport,
    }
    code_index = _as_list(minimal.get("code_index"))
    while code_index and _json_size(minimal) > max_payload_chars:
        code_index.pop()
    return minimal


def _dump_codex_review_debug_file(data_dir: str | Path, outbox_id: str, suffix: str, payload: Any) -> None:
    root = Path(data_dir) / "openclaw" / "codex-review"
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{outbox_id}-{suffix}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _validate_openclaw_review_shape(payload: dict[str, Any]) -> None:
    required = {
        "work_summary": dict,
        "pitfalls": list,
        "decisions": list,
        "followups": list,
        "blockers": list,
        "management": dict,
    }
    for key, expected_type in required.items():
        if key not in payload:
            raise ValueError(f"OpenClaw review response missing required key: {key}")
        if not isinstance(payload[key], expected_type):
            raise ValueError(f"OpenClaw review response key {key} must be {expected_type.__name__}")


def _source_hash(item_type: str, item: dict[str, Any]) -> str:
    source = {
        "type": item_type,
        "title": item.get("title"),
        "evidence_refs": item.get("evidence_refs"),
    }
    return hashlib.sha256(json.dumps(source, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def _review_items_from_payload(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    items: list[tuple[str, dict[str, Any]]] = []
    work_summary = _as_dict(payload.get("work_summary"))
    if work_summary:
        items.append(("work_summary", work_summary))
    for item in _as_list(payload.get("pitfalls")):
        if isinstance(item, dict):
            items.append(("pitfall", item))
    for item in _as_list(payload.get("decisions")):
        if isinstance(item, dict):
            items.append(("decision", item))
    for item in _as_list(payload.get("followups")):
        if isinstance(item, dict):
            items.append(("followup", item))
    for item in _as_list(payload.get("blockers")):
        if isinstance(item, dict):
            items.append(("blocker", item))
    return items


def save_openclaw_review_payload(store: Any, outbox: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    saved = []
    for item_type, item in _review_items_from_payload(payload):
        title = _text(item.get("title"), default=item_type.replace("_", " ").title())
        summary = item.get("summary") or item.get("description") or item.get("decision") or item.get("result")
        review = store.create_codex_review_item(
            item_id=f"codex_review_{uuid4().hex}",
            pet_session_id=outbox["pet_session_id"],
            codex_session_id=outbox["codex_session_id"],
            item_type=item_type,
            title=title[:240],
            summary=str(summary)[:2000] if summary is not None else None,
            details=item,
            tags=_tags(item.get("tags")),
            severity=_text(item.get("severity")) or None,
            status="draft",
            source="openclaw",
            source_hash=_source_hash(item_type, item),
        )
        saved.append(review)
    return saved


def enqueue_codex_review_sync(store: Any, pet_session_id: str) -> dict[str, Any]:
    evidence_pack = build_codex_review_evidence_pack(store, pet_session_id)
    payload_json = json.dumps(evidence_pack, sort_keys=True, ensure_ascii=False)
    payload_hash = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
    return store.enqueue_codex_openclaw_sync(
        pet_session_id=pet_session_id,
        codex_session_id=evidence_pack["session"]["codex_session_id"],
        payload_hash=payload_hash,
        payload=evidence_pack,
        openclaw_session_key=f"codex-review:{pet_session_id}",
    )


async def process_next_codex_review_sync(app: Any) -> bool:
    store = app.state.trace_store
    now = datetime.now(UTC).isoformat()
    outbox = store.claim_next_codex_openclaw_sync(now_iso=now)
    if outbox is None:
        return False

    settings = app.state.settings
    try:
        evidence_pack = prepare_openclaw_evidence_pack(
            outbox["payload"],
            getattr(settings, "codex_openclaw_review_max_payload_chars", None),
        )
        if getattr(settings, "codex_openclaw_review_dump_debug_files", False):
            _dump_codex_review_debug_file(settings.data_dir, outbox["id"], "request", evidence_pack)
        response_text = await app.state.openclaw_client.generate_codex_review(
            user_id=(settings.admin_user_ids[0] if settings.admin_user_ids else "system"),
            session_key=outbox["openclaw_session_key"],
            evidence_pack=evidence_pack,
            agent_id=settings.codex_openclaw_review_agent_id,
            channel=settings.codex_openclaw_review_channel,
        )
        payload = parse_openclaw_review_response(response_text)
        if getattr(settings, "codex_openclaw_review_dump_debug_files", False):
            _dump_codex_review_debug_file(settings.data_dir, outbox["id"], "response", payload)
        save_openclaw_review_payload(store, outbox, payload)
        store.mark_codex_openclaw_sync_sent(outbox["id"])
        return True
    except Exception as error:
        store.mark_codex_openclaw_sync_failed(outbox["id"], last_error=str(error))
        return False


async def run_codex_review_sync_worker(app: Any) -> None:
    settings = app.state.settings
    interval = settings.codex_openclaw_review_sync_interval_seconds
    while True:
        try:
            await process_next_codex_review_sync(app)
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(interval)
