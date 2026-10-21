from __future__ import annotations

import hashlib
import json
from typing import Any

from app.db.store import TraceStore
from app.models.domain_knowledge import ConceptDelta


_REQUIRES_AUTHOR_EXPLANATION = {"contract", "workflow", "rule", "gate", "policy"}


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256_text(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def collect_concept_deltas(store: TraceStore, session_evidence: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Persist explicit Concept Deltas and report required explanations that are absent.

    This collector deliberately does not infer definitions from prose. It accepts only
    structured payloads already present in session evidence.
    """

    stored: list[dict[str, Any]] = []
    covered_terms: set[str] = set()
    raw_items = _as_list(session_evidence.get("concept_deltas"))
    facts = session_evidence.get("facts") if isinstance(session_evidence.get("facts"), dict) else {}
    raw_items.extend(_as_list(facts.get("concept_deltas")))

    for raw_item in raw_items:
        wrapper = raw_item if isinstance(raw_item, dict) else {}
        raw_payload = wrapper.get("payload") if isinstance(wrapper.get("payload"), dict) else wrapper
        delta = ConceptDelta.model_validate(raw_payload)
        payload = delta.model_dump(mode="json")
        raw_author_text_value = wrapper.get("raw_author_text")
        raw_author_text = (
            raw_author_text_value
            if isinstance(raw_author_text_value, str) and raw_author_text_value
            else _canonical_json(payload)
        )
        canonical_payload = _canonical_json(payload)
        item = store.upsert_codex_concept_delta(
            payload=payload,
            raw_author_text=raw_author_text,
            source_hash=_sha256_text(canonical_payload),
            author_text_sha256=_sha256_text(raw_author_text),
        )
        stored.append(item)
        covered_terms.update(term.strip().casefold() for term in delta.terms if term.strip())

    findings: list[dict[str, Any]] = []
    for raw_change in _as_list(session_evidence.get("domain_term_changes")):
        change = raw_change if isinstance(raw_change, dict) else {}
        term = str(change.get("term") or "").strip()
        topic_kind = str(change.get("topic_kind") or "").strip().lower()
        if not term or topic_kind not in _REQUIRES_AUTHOR_EXPLANATION or term.casefold() in covered_terms:
            continue
        details = {
            "change_kind": str(change.get("change_kind") or "").strip() or None,
            "source_event_ids": [
                str(item) for item in _as_list(change.get("source_event_ids")) if str(item).strip()
            ],
            "reason": "Domain-changing term has no explicit Concept Delta.",
        }
        source_hash = _sha256_text(
            _canonical_json(
                {
                    "workspace_id": session_evidence.get("workspace_id"),
                    "codex_session_id": session_evidence.get("codex_session_id"),
                    "term": term,
                    "topic_kind": topic_kind,
                    "details": details,
                }
            )
        )
        findings.append(
            store.upsert_domain_term_coverage_finding(
                workspace_id=str(session_evidence.get("workspace_id") or "").strip(),
                codex_session_id=str(session_evidence.get("codex_session_id") or "").strip() or None,
                scan_id=None,
                term=term,
                topic_kind=topic_kind,
                classification="missing_author_explanation",
                source_hash=source_hash,
                details=details,
            )
        )

    return {"concept_deltas": stored, "coverage_findings": findings}

