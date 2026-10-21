from __future__ import annotations

import hashlib
import json
from typing import Any

from app.models.domain_knowledge import DomainKnowledgeCandidate, EvidenceReference


_CONCEPT_DELTA_REQUIRED_TOPIC_KINDS = {"contract", "workflow", "rule", "gate", "policy"}


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _nonempty_text(value: Any) -> bool:
    return bool(str(value or "").strip())


def _append_reason(reasons: list[str], reason: str) -> None:
    if reason not in reasons:
        reasons.append(reason)


def _concept_delta_ids(items: list[dict[str, Any]]) -> set[str]:
    ids: set[str] = set()
    for item in items:
        payload = _as_dict(item.get("payload")) or item
        delta_id = str(payload.get("delta_id") or "").strip()
        if delta_id:
            ids.add(delta_id)
    return ids


def _cited_ref_ids(draft: dict[str, Any]) -> list[str]:
    technical = _as_dict(draft.get("technical_solution"))
    raw_ids: list[Any] = []
    raw_ids.extend(_as_list(draft.get("evidence_refs")))
    for key in ("contract_refs", "implementation_refs", "test_refs", "validation_refs"):
        raw_ids.extend(_as_list(technical.get(key)))
    result: list[str] = []
    for raw in raw_ids:
        ref_id = str(raw or "").strip()
        if ref_id and ref_id not in result:
            result.append(ref_id)
    return result


def evaluate_domain_knowledge_candidate(
    raw_candidate: dict[str, Any],
    evidence_pack: dict[str, Any],
    *,
    concept_deltas: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Reconcile an untrusted candidate against deterministic repository evidence."""

    raw_draft = _as_dict(raw_candidate.get("draft"))
    raw_meaning = _as_dict(raw_draft.get("meaning"))
    raw_boundaries = _as_dict(raw_meaning.get("boundaries"))
    candidate = DomainKnowledgeCandidate.model_validate(raw_candidate)
    normalized = candidate.model_dump(mode="json")
    draft = _as_dict(normalized.get("draft"))
    technical = _as_dict(draft.get("technical_solution"))
    reasons: list[str] = []

    canonical_refs: dict[str, dict[str, Any]] = {}
    for raw_ref in _as_list(evidence_pack.get("evidence_refs")):
        ref = EvidenceReference.model_validate(raw_ref).model_dump(mode="json")
        canonical_refs[ref["ref_id"]] = ref

    cited_ref_ids = _cited_ref_ids(draft)
    unknown_ref_ids = [ref_id for ref_id in cited_ref_ids if ref_id not in canonical_refs]
    if unknown_ref_ids:
        _append_reason(reasons, "unknown_evidence_ref")
    reconciled_refs = [canonical_refs[ref_id] for ref_id in cited_ref_ids if ref_id in canonical_refs]
    roles = {ref["role"] for ref in reconciled_refs}

    introduced_for = _as_dict(raw_draft.get("introduced_for"))
    problem_linked = all(
        _nonempty_text(introduced_for.get(key))
        for key in ("problem", "context", "failure_before_introduction")
    )
    definition_complete = _nonempty_text(raw_meaning.get("definition"))
    relationships_explicit = "relationships" in raw_meaning
    boundaries_explicit = "boundaries" in raw_meaning and all(
        key in raw_boundaries for key in ("in_scope", "out_of_scope", "non_examples", "confused_with")
    )
    invariants_explicit = "invariants" in raw_meaning
    contract_linked = "contract" in roles
    code_linked = "implementation" in roles
    test_or_validation_linked = bool({"test", "validation"} & roles)

    if not definition_complete:
        _append_reason(reasons, "missing_definition")
    if not problem_linked:
        _append_reason(reasons, "missing_introduction_problem")
    if not relationships_explicit:
        _append_reason(reasons, "missing_relationships")
    if not boundaries_explicit:
        _append_reason(reasons, "missing_boundaries")
    if not invariants_explicit:
        _append_reason(reasons, "missing_invariants")
    if not (contract_linked or code_linked):
        _append_reason(reasons, "missing_contract_or_implementation_evidence")
    if not test_or_validation_linked:
        _append_reason(reasons, "missing_test_or_validation_evidence")

    topic_kind = str(draft.get("topic_kind") or "")
    if topic_kind == "contract" and not contract_linked:
        _append_reason(reasons, "missing_contract_evidence")

    source = _as_dict(draft.get("source"))
    required_delta_ids = {
        str(item).strip() for item in _as_list(source.get("concept_delta_ids")) if str(item).strip()
    }
    available_delta_ids = _concept_delta_ids(concept_deltas or [])
    missing_concept_delta = topic_kind in _CONCEPT_DELTA_REQUIRED_TOPIC_KINDS and (
        not required_delta_ids or not required_delta_ids.issubset(available_delta_ids)
    )
    if missing_concept_delta:
        _append_reason(reasons, "missing_concept_delta")

    evidence_ready = not any(
        reason
        in {
            "unknown_evidence_ref",
            "missing_definition",
            "missing_introduction_problem",
            "missing_relationships",
            "missing_boundaries",
            "missing_invariants",
            "missing_contract_or_implementation_evidence",
            "missing_test_or_validation_evidence",
            "missing_contract_evidence",
        }
        for reason in reasons
    )
    verified = evidence_ready and not missing_concept_delta
    status = (
        "needs_author_explanation"
        if missing_concept_delta
        else "ready_for_review"
        if verified
        else "needs_evidence"
    )

    normalized["quality_gate"] = {
        "definition_complete": definition_complete,
        "problem_linked": problem_linked,
        "relationships_explicit": relationships_explicit,
        "boundaries_explicit": boundaries_explicit,
        "invariants_explicit": invariants_explicit,
        "contract_linked": contract_linked,
        "code_linked": code_linked,
        "test_or_validation_linked": test_or_validation_linked,
        "verified": verified,
    }
    normalized["status"] = status
    normalized["evidence_index"] = reconciled_refs
    normalized["content_hash"] = _canonical_hash(
        {
            "draft": normalized["draft"],
            "evidence_ref_ids": [ref["ref_id"] for ref in reconciled_refs],
        }
    )
    validated = DomainKnowledgeCandidate.model_validate(normalized).model_dump(mode="json")
    return {
        "status": status,
        "reason_codes": reasons,
        "unknown_evidence_ref_ids": unknown_ref_ids,
        "candidate": validated,
    }

