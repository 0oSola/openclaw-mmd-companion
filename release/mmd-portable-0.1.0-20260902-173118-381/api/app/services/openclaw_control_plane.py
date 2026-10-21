from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from typing import Any

import httpx

from app.services.codex_review_memory_draft import validate_review_decision_payload
from app.services.codex_review_wiki_payload import build_codex_review_memory_wiki_payload
from app.services.domain_knowledge_control_plane import process_domain_knowledge_control_plane_once


_DEFAULT_TIMEZONE = timezone(timedelta(hours=8))
_MAX_EVIDENCE_ITEMS = 5
_MAX_EVIDENCE_EXCERPT_CHARS = 1000


class OpenClawControlPlaneError(RuntimeError):
    """Raised when OpenClaw control-plane sync fails."""


class OpenClawReviewControlPlaneClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str = "",
        timeout_seconds: int = 30,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout_seconds = timeout_seconds
        self.http_client = http_client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = http_client is None

    async def close(self) -> None:
        if self._owns_client:
            await self.http_client.aclose()

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    async def post_daily_snapshot(self, *, session_key: str, snapshot: dict[str, Any]) -> dict[str, Any]:
        response = await self.http_client.post(
            f"{self.base_url}/v1/apps/mmd/codex-review/runs/{session_key}/snapshot",
            headers=self._headers(),
            json=snapshot,
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            body = response.text.strip()
            detail = f"status {response.status_code}"
            if body:
                detail = f"{detail}: {body[:500]}"
            raise OpenClawControlPlaneError(detail)
        if not response.content:
            return {"status": "snapshot_received"}
        try:
            payload = response.json()
        except ValueError:
            return {"status": "snapshot_received", "raw_text": response.text[:500]}
        return payload if isinstance(payload, dict) else {"status": "snapshot_received", "payload": payload}

    async def get_commands(self, *, session_key: str, cursor: str | None = None) -> dict[str, Any]:
        params = {"cursor": cursor} if cursor else None
        response = await self.http_client.get(
            f"{self.base_url}/v1/apps/mmd/codex-review/runs/{session_key}/commands",
            headers=self._headers(),
            params=params,
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            body = response.text.strip()
            detail = f"status {response.status_code}"
            if body:
                detail = f"{detail}: {body[:500]}"
            raise OpenClawControlPlaneError(detail)
        if not response.content:
            return {"commands": [], "cursor": cursor}
        try:
            payload = response.json()
        except ValueError:
            return {"commands": [], "cursor": cursor, "raw_text": response.text[:500]}
        return payload if isinstance(payload, dict) else {"commands": [], "cursor": cursor, "payload": payload}

    async def post_command_result(self, *, command_id: str, result: dict[str, Any]) -> dict[str, Any]:
        response = await self.http_client.post(
            f"{self.base_url}/v1/apps/mmd/codex-review/commands/{command_id}/result",
            headers=self._headers(),
            json=result,
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            body = response.text.strip()
            detail = f"status {response.status_code}"
            if body:
                detail = f"{detail}: {body[:500]}"
            raise OpenClawControlPlaneError(detail)
        if not response.content:
            return {"status": "result_received"}
        try:
            payload = response.json()
        except ValueError:
            return {"status": "result_received", "raw_text": response.text[:500]}
        return payload if isinstance(payload, dict) else {"status": "result_received", "payload": payload}

    async def post_memory_payloads(self, *, session_key: str, payloads: list[dict[str, Any]]) -> dict[str, Any]:
        response = await self.http_client.post(
            f"{self.base_url}/v1/apps/mmd/codex-review/runs/{session_key}/memory-payloads",
            headers=self._headers(),
            json={"payloads": payloads},
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            body = response.text.strip()
            detail = f"status {response.status_code}"
            if body:
                detail = f"{detail}: {body[:500]}"
            raise OpenClawControlPlaneError(detail)
        if not response.content:
            return {"status": "memory_payloads_received"}
        try:
            payload = response.json()
        except ValueError:
            return {"status": "memory_payloads_received", "raw_text": response.text[:500]}
        return payload if isinstance(payload, dict) else {"status": "memory_payloads_received", "payload": payload}

    async def get_publish_status(self, *, session_key: str, cursor: str | None = None) -> dict[str, Any]:
        params = {"cursor": cursor} if cursor else None
        response = await self.http_client.get(
            f"{self.base_url}/v1/apps/mmd/codex-review/runs/{session_key}/publish-status",
            headers=self._headers(),
            params=params,
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            body = response.text.strip()
            detail = f"status {response.status_code}"
            if body:
                detail = f"{detail}: {body[:500]}"
            raise OpenClawControlPlaneError(detail)
        if not response.content:
            return {"items": [], "cursor": cursor}
        try:
            payload = response.json()
        except ValueError:
            return {"items": [], "cursor": cursor, "raw_text": response.text[:500]}
        return payload if isinstance(payload, dict) else {"items": [], "cursor": cursor, "payload": payload}

    async def post_project_knowledge_candidates(
        self,
        *,
        run_id: str,
        batch: dict[str, Any],
    ) -> dict[str, Any]:
        return await self._project_knowledge_request(
            "POST",
            f"/v1/apps/mmd/project-knowledge/runs/{run_id}/candidates",
            json_payload=batch,
            fallback={"status": "candidate_batch_received", "items": []},
        )

    async def get_project_knowledge_commands(
        self,
        *,
        run_id: str,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        return await self._project_knowledge_request(
            "GET",
            f"/v1/apps/mmd/project-knowledge/runs/{run_id}/commands",
            params={"cursor": cursor} if cursor else None,
            fallback={"commands": [], "cursor": cursor},
        )

    async def post_project_knowledge_command_result(
        self,
        *,
        command_id: str,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        return await self._project_knowledge_request(
            "POST",
            f"/v1/apps/mmd/project-knowledge/commands/{command_id}/result",
            json_payload=result,
            fallback={"status": "result_received"},
        )

    async def post_project_knowledge_publish_payloads(
        self,
        *,
        run_id: str,
        batch: dict[str, Any],
    ) -> dict[str, Any]:
        return await self._project_knowledge_request(
            "POST",
            f"/v1/apps/mmd/project-knowledge/runs/{run_id}/publish-payloads",
            json_payload=batch,
            fallback={"status": "publish_payloads_received", "items": []},
        )

    async def get_project_knowledge_publish_status(
        self,
        *,
        run_id: str,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        return await self._project_knowledge_request(
            "GET",
            f"/v1/apps/mmd/project-knowledge/runs/{run_id}/publish-status",
            params={"cursor": cursor} if cursor else None,
            fallback={"items": [], "cursor": cursor},
        )

    async def _project_knowledge_request(
        self,
        method: str,
        path: str,
        *,
        json_payload: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
        fallback: dict[str, Any],
    ) -> dict[str, Any]:
        response = await self.http_client.request(
            method,
            f"{self.base_url}{path}",
            headers=self._headers(),
            json=json_payload,
            params=params,
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            body = response.text.strip()
            detail = f"status {response.status_code}"
            if body:
                detail = f"{detail}: {body[:500]}"
            raise OpenClawControlPlaneError(detail)
        if not response.content:
            return dict(fallback)
        try:
            payload = response.json()
        except ValueError:
            return {**fallback, "raw_text": response.text[:500]}
        return payload if isinstance(payload, dict) else {**fallback, "payload": payload}


def codex_review_daily_session_key(review_date: str) -> str:
    return f"codex-review-daily:{review_date}"


def current_codex_review_date() -> str:
    return datetime.now(_DEFAULT_TIMEZONE).date().isoformat()


def _compact_text(value: Any, *, limit: int = 2000) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def _string_list(value: Any, *, limit: int = 20) -> list[str]:
    if not isinstance(value, list):
        return []
    items = []
    for item in value:
        text = _compact_text(item, limit=240)
        if text:
            items.append(text)
    return items[:limit]


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _bounded_fact_records(value: Any, *, limit: int = 8) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    records: list[dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        record: dict[str, Any] = {}
        for key, raw_value in raw.items():
            if isinstance(raw_value, str):
                record[str(key)] = _compact_text(raw_value, limit=500)
            elif isinstance(raw_value, (int, float, bool)) or raw_value is None:
                record[str(key)] = raw_value
            elif isinstance(raw_value, list):
                record[str(key)] = _string_list(raw_value, limit=10)
        records.append(record)
        if len(records) >= limit:
            break
    return records


def _bounded_evidence(details: dict[str, Any], evidence_refs: list[str]) -> list[dict[str, str]]:
    raw_items = details.get("evidence")
    if not isinstance(raw_items, list):
        return []
    refs = set(evidence_refs)
    evidence: list[dict[str, str]] = []
    for index, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            continue
        evidence_id = _compact_text(raw.get("id") or f"evidence_{index}", limit=160)
        if refs and evidence_id not in refs:
            continue
        evidence.append(
            {
                "id": evidence_id,
                "source": _compact_text(raw.get("source") or "codex_review_items", limit=160),
                "type": _compact_text(raw.get("type") or "evidence", limit=160),
                "excerpt": _compact_text(raw.get("excerpt"), limit=_MAX_EVIDENCE_EXCERPT_CHARS),
            }
        )
        if len(evidence) >= _MAX_EVIDENCE_ITEMS:
            break
    return evidence


def _draft_snapshot_item(item: dict[str, Any]) -> dict[str, Any]:
    details = item.get("details") if isinstance(item.get("details"), dict) else {}
    evidence_refs = _string_list(details.get("evidence_refs"))
    return {
        "id": str(item.get("id") or ""),
        "item_type": str(item.get("item_type") or ""),
        "title": _compact_text(item.get("title"), limit=240),
        "summary": _compact_text(item.get("summary")),
        "severity": item.get("severity"),
        "tags": _string_list(item.get("tags")),
        "priority_score": int(item.get("priority_score") or 0),
        "evidence_refs": evidence_refs,
        "bounded_evidence": _bounded_evidence(details, evidence_refs),
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
    }


def _top_review_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(item.get("id") or ""),
        "item_type": str(item.get("item_type") or ""),
        "title": _compact_text(item.get("title"), limit=240),
        "priority_score": int(item.get("priority_score") or 0),
    }


def _group_review_items_by_pet_session(items: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        pet_session_id = str(item.get("pet_session_id") or "")
        if not pet_session_id:
            continue
        grouped.setdefault(pet_session_id, []).append(item)
    return grouped


def _work_unit_snapshot_items(store: Any, items: list[dict[str, Any]], workspace_id: str | None) -> list[dict[str, Any]]:
    work_units: list[dict[str, Any]] = []
    for pet_session_id, grouped_items in _group_review_items_by_pet_session(items).items():
        pet_session = store.get_desktop_pet_session(pet_session_id) or {}
        metadata = _as_dict(pet_session.get("metadata"))
        facts = _as_dict(metadata.get("facts"))
        review_item_counts: dict[str, int] = {}
        for item in grouped_items:
            item_type = str(item.get("item_type") or "unknown")
            review_item_counts[item_type] = review_item_counts.get(item_type, 0) + 1
        work_units.append(
            {
                "pet_session_id": pet_session_id,
                "codex_session_id": str(pet_session.get("codex_session_id") or grouped_items[0].get("codex_session_id") or ""),
                "workspace_id": pet_session.get("workspace_id") or workspace_id,
                "title": _compact_text(pet_session.get("display_title") or grouped_items[0].get("title"), limit=240),
                "status": _compact_text(pet_session.get("last_status"), limit=80),
                "goal": _compact_text(pet_session.get("first_prompt_preview"), limit=500),
                "outcome": _compact_text(pet_session.get("last_summary"), limit=1000),
                "review_item_counts": review_item_counts,
                "top_review_items": [_top_review_item(item) for item in grouped_items[:5]],
                "changed_files": _string_list(facts.get("changed_files"), limit=20),
                "failed_commands": _bounded_fact_records(facts.get("failed_commands")),
                "successful_checks": _bounded_fact_records(facts.get("successful_checks")),
                "updated_at": pet_session.get("updated_at"),
            }
        )
    return work_units


def _first_detail_text(details: dict[str, Any], keys: tuple[str, ...], fallback: Any = "") -> str:
    for key in keys:
        text = _compact_text(details.get(key), limit=1000)
        if text:
            return text
    return _compact_text(fallback, limit=1000)


def _learning_candidate_item(item: dict[str, Any]) -> dict[str, Any]:
    details = _as_dict(item.get("details"))
    evidence_refs = _string_list(details.get("evidence_refs"))
    summary = _compact_text(item.get("summary"))
    confidence = details.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = None
    return {
        "id": str(item.get("id") or ""),
        "pet_session_id": str(item.get("pet_session_id") or ""),
        "codex_session_id": str(item.get("codex_session_id") or ""),
        "candidate_type": str(item.get("item_type") or ""),
        "title": _compact_text(item.get("title"), limit=240),
        "summary": summary,
        "problem": _first_detail_text(details, ("problem", "symptom", "description"), fallback=summary),
        "root_cause": _first_detail_text(details, ("root_cause", "cause")),
        "fix": _first_detail_text(details, ("fix", "result", "decision")),
        "prevention": _first_detail_text(details, ("prevention", "guardrail")),
        "lesson": _first_detail_text(details, ("lesson",), fallback=summary),
        "severity": item.get("severity"),
        "tags": _string_list(item.get("tags")),
        "confidence": confidence,
        "priority_score": int(item.get("priority_score") or 0),
        "evidence_refs": evidence_refs,
        "bounded_evidence": _bounded_evidence(details, evidence_refs),
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
    }


def _has_learning_candidate_content(candidate: dict[str, Any]) -> bool:
    for key in ("summary", "problem", "root_cause", "fix", "prevention", "lesson"):
        if _compact_text(candidate.get(key)):
            return True
    return bool(candidate.get("evidence_refs") or candidate.get("bounded_evidence"))


def _learning_candidate_items(items: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    candidate_types = {"blocker", "pitfall", "decision", "followup", "work_summary"}
    candidates: list[dict[str, Any]] = []
    for item in items:
        if str(item.get("item_type") or "") not in candidate_types:
            continue
        candidate = _learning_candidate_item(item)
        if not _has_learning_candidate_content(candidate):
            continue
        candidates.append(candidate)
        if len(candidates) >= limit:
            break
    return candidates


def _increment_count(counts: dict[str, int], key: Any) -> None:
    text = _compact_text(key, limit=120)
    if not text:
        return
    counts[text] = counts.get(text, 0) + 1


def _sorted_counts(counts: dict[str, int]) -> dict[str, int]:
    return {key: counts[key] for key in sorted(counts)}


def _rollup_top_tags(candidates: list[dict[str, Any]], *, limit: int = 10) -> list[dict[str, Any]]:
    counts: dict[str, int] = {}
    for candidate in candidates:
        for tag in candidate.get("tags") or []:
            _increment_count(counts, tag)
    return [
        {"tag": tag, "count": count}
        for tag, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
    ]


def _rollup_changed_files(work_units: list[dict[str, Any]], *, limit: int = 50) -> list[str]:
    files: list[str] = []
    for unit in work_units:
        for path in unit.get("changed_files") or []:
            text = _compact_text(path, limit=500)
            if text and text not in files:
                files.append(text)
            if len(files) >= limit:
                return files
    return files


def _snapshot_rollup(work_units: list[dict[str, Any]], learning_candidates: list[dict[str, Any]]) -> dict[str, Any]:
    work_status_counts: dict[str, int] = {}
    review_item_counts: dict[str, int] = {}
    learning_candidate_counts: dict[str, int] = {}
    failed_command_count = 0
    successful_check_count = 0
    for unit in work_units:
        _increment_count(work_status_counts, unit.get("status"))
        failed_command_count += len(unit.get("failed_commands") or [])
        successful_check_count += len(unit.get("successful_checks") or [])
        for item_type, count in _as_dict(unit.get("review_item_counts")).items():
            text = _compact_text(item_type, limit=120)
            if not text:
                continue
            try:
                increment = int(count)
            except (TypeError, ValueError):
                increment = 0
            review_item_counts[text] = review_item_counts.get(text, 0) + max(0, increment)
    for candidate in learning_candidates:
        _increment_count(learning_candidate_counts, candidate.get("candidate_type"))
    return {
        "work_unit_count": len(work_units),
        "work_status_counts": _sorted_counts(work_status_counts),
        "review_item_counts": _sorted_counts(review_item_counts),
        "learning_candidate_count": len(learning_candidates),
        "learning_candidate_counts": _sorted_counts(learning_candidate_counts),
        "high_priority_learning_candidate_count": sum(
            1 for candidate in learning_candidates if int(candidate.get("priority_score") or 0) >= 80
        ),
        "top_tags": _rollup_top_tags(learning_candidates),
        "changed_files": _rollup_changed_files(work_units),
        "failed_command_count": failed_command_count,
        "successful_check_count": successful_check_count,
    }


def _snapshot_cursor(snapshot: dict[str, Any]) -> str:
    stable = {
        "date": snapshot.get("date"),
        "workspace_id": snapshot.get("workspace_id"),
        "summary": snapshot.get("summary"),
        "draft_ids": [
            {
                "id": item.get("id"),
                "status": item.get("status"),
                "priority_score": item.get("priority_score"),
                "updated_at": item.get("updated_at"),
            }
            for item in snapshot.get("drafts") or []
            if isinstance(item, dict)
        ],
        "work_units": [
            {
                "pet_session_id": item.get("pet_session_id"),
                "updated_at": item.get("updated_at"),
            }
            for item in snapshot.get("work_units") or []
            if isinstance(item, dict)
        ],
        "learning_candidate_ids": [
            {
                "id": item.get("id"),
                "updated_at": item.get("updated_at"),
            }
            for item in snapshot.get("learning_candidates") or []
            if isinstance(item, dict)
        ],
    }
    digest = hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    return f"fastapi-review-state:{digest[:24]}"


def _now_control_plane_iso() -> str:
    return datetime.now(_DEFAULT_TIMEZONE).isoformat(timespec="seconds")


def apply_codex_review_decision_command(
    store: Any,
    command: dict[str, Any],
    *,
    default_workspace_id: str | None,
) -> dict[str, Any]:
    if str(command.get("type") or "") != "review_decision":
        raise ValueError(f"unsupported codex review command type: {command.get('type')}")
    item_id = _compact_text(command.get("item_id"), limit=160)
    if not item_id:
        raise ValueError("review_decision command requires item_id")
    action = _compact_text(command.get("action"), limit=40)
    if action not in {"accept", "edit_accept", "ignore", "snooze"}:
        raise ValueError(f"unsupported review_decision action: {action}")
    snooze_until = _compact_text(command.get("snooze_until"), limit=80)
    memory_draft = validate_review_decision_payload(
        action=action,
        edited_title=_compact_text(command.get("edited_title"), limit=240) or None,
        edited_summary=_compact_text(command.get("edited_summary"), limit=4000) or None,
        snooze_until=snooze_until,
        memory_draft=command.get("memory_draft"),
    )

    item = store.get_codex_review_item(item_id)
    if item is None:
        raise ValueError(f"codex review item not found: {item_id}")

    decided_by = _compact_text(command.get("decided_by"), limit=120) or "openclaw-control-plane"
    details_patch = {
        "decision": action,
        "decision_by": decided_by,
        "decision_notes": _compact_text(command.get("notes"), limit=2000) or None,
        "decision_target": _compact_text(command.get("target"), limit=120) or "openclaw_wiki",
        "decision_command_id": _compact_text(command.get("id") or command.get("command_id"), limit=180) or None,
        "decision_decided_at": _compact_text(command.get("decided_at"), limit=80) or None,
    }

    memory = None
    if action in {"accept", "edit_accept"}:
        status = "accepted" if action == "accept" else "edited_accepted"
        item = store.update_codex_review_item_status(item_id, status=status, details_patch=details_patch)
        title = _compact_text(command.get("edited_title"), limit=240) or item["title"]
        edited_summary = command.get("edited_summary")
        body = _compact_text(edited_summary, limit=4000) if edited_summary is not None else item.get("summary")
        memory = store.create_codex_review_memory_from_item(
            review_item_id=item_id,
            title=title,
            body=body,
            memory_draft=memory_draft,
            confirmed_by=decided_by,
            default_workspace_id=default_workspace_id,
        )
    elif action == "ignore":
        item = store.update_codex_review_item_status(item_id, status="ignored", details_patch=details_patch)
    else:
        details_patch["snooze_until"] = snooze_until
        item = store.update_codex_review_item_status(item_id, status="snoozed", details_patch=details_patch)

    return {
        "item_id": item_id,
        "item_status": item["status"] if item else None,
        "memory_id": memory["id"] if memory else None,
    }


def _command_result_payload(
    *,
    session_key: str,
    command_id: str,
    status: str,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "session_key": session_key,
        "command_id": command_id,
        "status": status,
        "result": result,
        "error": error,
        "completed_at": _now_control_plane_iso(),
    }


def build_codex_review_daily_snapshot(
    store: Any,
    *,
    review_date: str,
    workspace_id: str | None,
    limit: int = 20,
) -> dict[str, Any]:
    backlog_summary = store.get_codex_review_daily_summary(
        review_date=review_date,
        workspace_id=workspace_id,
        include_unscoped=workspace_id is not None,
    )
    review_day = datetime.strptime(review_date, "%Y-%m-%d").replace(tzinfo=_DEFAULT_TIMEZONE)
    updated_from_iso = review_day.astimezone(timezone.utc).isoformat()
    updated_before_iso = (review_day + timedelta(days=1)).astimezone(timezone.utc).isoformat()
    draft_items = store.list_codex_review_drafts(
        workspace_id=workspace_id,
        limit=limit,
        include_unscoped=workspace_id is not None,
        updated_from_iso=updated_from_iso,
        updated_before_iso=updated_before_iso,
    )
    drafts = [_draft_snapshot_item(item) for item in draft_items]
    work_units = _work_unit_snapshot_items(store, draft_items, workspace_id)
    learning_candidates = _learning_candidate_items(draft_items, limit)
    daily_high_priority_count = sum(1 for item in draft_items if int(item.get("priority_score") or 0) >= 80)
    pending_review_backlog = {
        "draft_count": int(backlog_summary.get("draft_count") or 0),
        "high_priority_count": int(backlog_summary.get("high_priority_count") or 0),
        "recommended_batch_size": int(backlog_summary.get("recommended_batch_size") or 0),
    }
    summary = {
        **backlog_summary,
        "draft_count": len(draft_items),
        "high_priority_count": daily_high_priority_count,
        "recommended_batch_size": min(3, len(draft_items)),
        "pending_backlog_count": pending_review_backlog["draft_count"],
        "pending_backlog_high_priority_count": pending_review_backlog["high_priority_count"],
    }
    snapshot = {
        "kind": "codex_review_daily_snapshot",
        "schema_version": 1,
        "date": review_date,
        "workspace_id": workspace_id,
        "summary": summary,
        "drafts": drafts,
        "daily_new_items": drafts,
        "pending_review_backlog": pending_review_backlog,
        "work_units": work_units,
        "learning_candidates": learning_candidates,
        "rollup": _snapshot_rollup(work_units, learning_candidates),
    }
    snapshot["cursor"] = _snapshot_cursor(snapshot)
    return snapshot


async def push_codex_review_daily_snapshot(
    app: Any,
    *,
    review_date: str | None = None,
) -> dict[str, Any]:
    settings = app.state.settings
    date = review_date or current_codex_review_date()
    workspace_id = getattr(settings, "codex_openclaw_control_plane_workspace_id", "") or None
    limit = int(getattr(settings, "codex_openclaw_control_plane_snapshot_limit", 20) or 20)
    snapshot = build_codex_review_daily_snapshot(
        app.state.trace_store,
        review_date=date,
        workspace_id=workspace_id,
        limit=limit,
    )
    session_key = codex_review_daily_session_key(date)
    submitted_state = app.state.trace_store.get_codex_review_control_plane_snapshot_state(session_key)
    if submitted_state is not None and submitted_state.get("snapshot_cursor") == snapshot["cursor"]:
        result = {
            "status": "snapshot_unchanged",
            "idempotent": True,
            "session_key": session_key,
            "snapshot_cursor": snapshot["cursor"],
            "snapshot": snapshot,
            "response": submitted_state.get("response") or {},
            "submitted_at": submitted_state.get("submitted_at"),
        }
        app.state.last_codex_review_control_plane_snapshot = result
        return result
    response = await app.state.openclaw_control_plane_client.post_daily_snapshot(
        session_key=session_key,
        snapshot=snapshot,
    )
    submitted_state = app.state.trace_store.mark_codex_review_control_plane_snapshot_submitted(
        session_key=session_key,
        snapshot_cursor=snapshot["cursor"],
        response=response,
    )
    result = {
        "status": str(response.get("status") or "snapshot_sent"),
        "idempotent": bool(response.get("idempotent")),
        "session_key": session_key,
        "snapshot_cursor": snapshot["cursor"],
        "snapshot": snapshot,
        "response": response,
        "submitted_at": submitted_state.get("submitted_at"),
    }
    app.state.last_codex_review_control_plane_snapshot = result
    return result


async def process_codex_review_commands(
    app: Any,
    *,
    review_date: str | None = None,
) -> dict[str, Any]:
    settings = app.state.settings
    date = review_date or current_codex_review_date()
    session_key = codex_review_daily_session_key(date)
    cursor = getattr(app.state, "last_codex_review_control_plane_command_cursor", None)
    response = await app.state.openclaw_control_plane_client.get_commands(
        session_key=session_key,
        cursor=cursor,
    )
    raw_commands = response.get("commands")
    if raw_commands is None:
        raw_commands = response.get("items")
    commands = [command for command in raw_commands if isinstance(command, dict)] if isinstance(raw_commands, list) else []
    processed = 0
    failed = 0
    results: list[dict[str, Any]] = []
    default_workspace_id = getattr(settings, "codex_openclaw_control_plane_workspace_id", "") or None
    for command in commands:
        command_id = _compact_text(command.get("id") or command.get("command_id"), limit=180)
        command_session_key = _compact_text(command.get("session_key"), limit=220) or session_key
        if not command_id:
            failed += 1
            results.append({"command_id": "", "status": "failed", "error": "command id is required"})
            continue
        try:
            if str(command.get("type") or "") != "review_decision":
                raise ValueError(f"unsupported codex review command type: {command.get('type')}")
            decision_result = apply_codex_review_decision_command(
                app.state.trace_store,
                command,
                default_workspace_id=default_workspace_id,
            )
            payload = _command_result_payload(
                session_key=command_session_key,
                command_id=command_id,
                status="succeeded",
                result=decision_result,
                error=None,
            )
            processed += 1
        except Exception as error:
            payload = _command_result_payload(
                session_key=command_session_key,
                command_id=command_id,
                status="failed",
                result=None,
                error=str(error),
            )
            failed += 1
        await app.state.openclaw_control_plane_client.post_command_result(
            command_id=command_id,
            result=payload,
        )
        results.append(payload)

    next_cursor = response.get("cursor") or response.get("next_cursor") or cursor
    app.state.last_codex_review_control_plane_command_cursor = next_cursor
    result = {
        "status": "commands_processed",
        "session_key": session_key,
        "cursor": next_cursor,
        "processed": processed,
        "failed": failed,
        "results": results,
        "response": response,
    }
    app.state.last_codex_review_control_plane_commands = result
    return result


async def push_codex_review_memory_payloads(
    app: Any,
    *,
    review_date: str | None = None,
) -> dict[str, Any]:
    settings = app.state.settings
    target = str(getattr(settings, "codex_review_memory_target", "openclaw_wiki") or "openclaw_wiki")
    date = review_date or current_codex_review_date()
    session_key = codex_review_daily_session_key(date)
    if target != "openclaw_wiki":
        result = {
            "status": "skipped",
            "session_key": session_key,
            "reason": f"unsupported memory target: {target}",
            "submitted": 0,
            "failed": 0,
        }
        app.state.last_codex_review_control_plane_memory_payloads = result
        return result

    workspace_id = getattr(settings, "codex_openclaw_control_plane_workspace_id", "") or None
    limit = int(getattr(settings, "codex_openclaw_control_plane_snapshot_limit", 20) or 20)
    memories = app.state.trace_store.list_codex_review_memory(
        workspace_id=workspace_id,
        export_status="pending",
        limit=limit,
    )
    payloads: list[dict[str, Any]] = []
    memory_ids: list[str] = []
    failed = 0
    items: list[dict[str, Any]] = []
    for memory in memories:
        memory_id = str(memory.get("id") or "")
        payload = build_codex_review_memory_wiki_payload(app.state.trace_store, memory_id)
        if payload is None:
            failed += 1
            app.state.trace_store.mark_codex_review_memory_export_failed(
                memory_id,
                error="codex review memory payload could not be built",
            )
            items.append({"memory_id": memory_id, "status": "failed"})
            continue
        payloads.append(payload)
        memory_ids.append(memory_id)
    if not payloads:
        result = {
            "status": "no_memory_payloads" if failed == 0 else "memory_payloads_failed",
            "session_key": session_key,
            "submitted": 0,
            "failed": failed,
            "items": items,
        }
        app.state.last_codex_review_control_plane_memory_payloads = result
        return result

    response = await app.state.openclaw_control_plane_client.post_memory_payloads(
        session_key=session_key,
        payloads=payloads,
    )
    for memory_id in memory_ids:
        app.state.trace_store.mark_codex_review_memory_export_submitted(memory_id)
        items.append({"memory_id": memory_id, "status": "submitted"})
    result = {
        "status": "memory_payloads_submitted",
        "session_key": session_key,
        "submitted": len(memory_ids),
        "failed": failed,
        "items": items,
        "response": response,
    }
    app.state.last_codex_review_control_plane_memory_payloads = result
    return result


async def process_codex_review_publish_status(
    app: Any,
    *,
    review_date: str | None = None,
) -> dict[str, Any]:
    settings = app.state.settings
    target = str(getattr(settings, "codex_review_memory_target", "openclaw_wiki") or "openclaw_wiki")
    date = review_date or current_codex_review_date()
    session_key = codex_review_daily_session_key(date)
    if target != "openclaw_wiki":
        result = {
            "status": "skipped",
            "session_key": session_key,
            "reason": f"unsupported memory target: {target}",
            "published": 0,
            "failed": 0,
            "waiting": 0,
        }
        app.state.last_codex_review_control_plane_publish_status = result
        return result

    cursor = getattr(app.state, "last_codex_review_control_plane_publish_cursor", None)
    response = await app.state.openclaw_control_plane_client.get_publish_status(
        session_key=session_key,
        cursor=cursor,
    )
    raw_items = response.get("items")
    items = [item for item in raw_items if isinstance(item, dict)] if isinstance(raw_items, list) else []
    published = 0
    failed = 0
    waiting = 0
    results: list[dict[str, Any]] = []
    for item in items:
        memory_id = _compact_text(item.get("memory_id"), limit=180)
        status = _compact_text(item.get("status"), limit=80)
        if not memory_id:
            failed += 1
            results.append({"memory_id": "", "status": "failed", "error": "memory_id is required"})
            continue
        if status == "published":
            document_id = (
                _compact_text(item.get("wiki_path"), limit=500)
                or _compact_text(item.get("commit"), limit=120)
                or memory_id
            )
            app.state.trace_store.mark_codex_review_memory_exported(memory_id, document_id=document_id)
            published += 1
            results.append({"memory_id": memory_id, "status": "published", "document_id": document_id})
        elif status == "failed":
            error = _compact_text(item.get("error"), limit=2000) or "OpenClaw memory wiki publish failed"
            app.state.trace_store.mark_codex_review_memory_export_failed(memory_id, error=error)
            failed += 1
            results.append({"memory_id": memory_id, "status": "failed", "error": error})
        else:
            waiting += 1
            results.append({"memory_id": memory_id, "status": status or "pending"})

    next_cursor = response.get("cursor") or response.get("next_cursor") or cursor
    app.state.last_codex_review_control_plane_publish_cursor = next_cursor
    result = {
        "status": "publish_status_processed",
        "session_key": session_key,
        "cursor": next_cursor,
        "published": published,
        "failed": failed,
        "waiting": waiting,
        "items": results,
        "response": response,
    }
    app.state.last_codex_review_control_plane_publish_status = result
    return result


async def run_codex_review_control_plane_worker(app: Any) -> None:
    settings = app.state.settings
    interval = float(getattr(settings, "codex_openclaw_control_plane_sync_interval_seconds", 60) or 60)
    while True:
        try:
            await push_codex_review_daily_snapshot(app)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            app.state.last_codex_review_control_plane_snapshot = {
                "status": "failed",
                "error": str(error),
            }
        try:
            await process_codex_review_commands(app)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            app.state.last_codex_review_control_plane_commands = {
                "status": "failed",
                "error": str(error),
            }
        try:
            await push_codex_review_memory_payloads(app)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            app.state.last_codex_review_control_plane_memory_payloads = {
                "status": "failed",
                "error": str(error),
            }
        try:
            await process_codex_review_publish_status(app)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            app.state.last_codex_review_control_plane_publish_status = {
                "status": "failed",
                "error": str(error),
            }
        if bool(getattr(settings, "domain_knowledge_control_plane_enabled", False)):
            try:
                app.state.last_domain_knowledge_control_plane = await process_domain_knowledge_control_plane_once(app)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                app.state.last_domain_knowledge_control_plane = {
                    "status": "failed",
                    "error": str(error),
                }
        await asyncio.sleep(interval)
