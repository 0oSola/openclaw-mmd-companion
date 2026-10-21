from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import uuid4

from app.models.domain_knowledge import (
    AcceptedWikiChangeSet,
    ContentReview,
    PublicationReceipt,
    PublicationReview,
    Reviewer,
    ReviewDecision,
)


_EMPTY_CONTENT_SHA256 = "sha256:" + hashlib.sha256(b"").hexdigest()


def canonical_domain_knowledge_sha256(value: Any) -> str:
    if isinstance(value, str):
        encoded = value.encode("utf-8")
    else:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _as_dict(value: Any, *, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} is required")
    return value


def _decision_payload(command: dict[str, Any]) -> dict[str, Any]:
    content = command.get("content_review") if isinstance(command.get("content_review"), dict) else {}
    publication = command.get("publication_review") if isinstance(command.get("publication_review"), dict) else {}
    reviewer = command.get("reviewer") if isinstance(command.get("reviewer"), dict) else {}
    return {
        "kind": "project_domain_knowledge_review_decision",
        "schema_version": 1,
        "command_id": command.get("command_id") or command.get("id"),
        "candidate_id": command.get("candidate_id"),
        "candidate_revision": command.get("candidate_revision"),
        "input_content_sha256": command.get("input_content_sha256") or command.get("input_payload_sha256"),
        "content_review": {name: content.get(name) for name in ContentReview.model_fields},
        "publication_review": {name: publication.get(name) for name in PublicationReview.model_fields},
        "reviewer": {name: reviewer.get(name) for name in Reviewer.model_fields},
        "idempotency_key": command.get("idempotency_key"),
    }


def _validate_proposal(
    *,
    decision: ReviewDecision,
    proposal: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    publication = decision.publication_review
    if str(proposal.get("proposal_id") or "") != publication.proposal_id:
        raise ValueError("proposal id does not match publication review")
    if int(proposal.get("proposal_revision") or 0) != publication.proposal_revision:
        raise ValueError("proposal revision does not match publication review")
    if str(proposal.get("candidate_id") or "") != decision.candidate_id:
        raise ValueError("proposal candidate does not match review decision")
    if int(proposal.get("candidate_revision") or 0) != decision.candidate_revision:
        raise ValueError("proposal candidate revision does not match review decision")
    if str(proposal.get("publication_action") or "") != publication.action:
        raise ValueError("proposal action does not match publication review")

    target = _as_dict(proposal.get("target"), field="proposal target")
    if str(target.get("path") or "") != str(publication.target_path or ""):
        raise ValueError("proposal target path does not match publication review")
    if publication.action in {"update", "merge", "supersede"} and str(
        target.get("base_content_sha256") or ""
    ) != str(publication.base_content_sha256 or ""):
        raise ValueError("proposal base content hash does not match publication review")

    document = _as_dict(proposal.get("document"), field="proposal document")
    markdown = str(document.get("markdown") or "")
    document_hash = canonical_domain_knowledge_sha256(markdown)
    if document_hash != str(document.get("sha256") or "") or document_hash != str(
        publication.approved_document_sha256 or ""
    ):
        raise ValueError("proposal document hash does not match approved Markdown")

    diff = _as_dict(proposal.get("diff"), field="proposal diff")
    diff_body = {"format": diff.get("format"), "files": diff.get("files") or []}
    diff_hash = canonical_domain_knowledge_sha256(diff_body)
    if diff_hash != str(diff.get("sha256") or "") or diff_hash != str(
        publication.approved_diff_sha256 or ""
    ):
        raise ValueError("proposal diff hash does not match approved diff")

    affected_files = proposal.get("affected_files")
    if not isinstance(affected_files, list) or not affected_files:
        raise ValueError("approved proposal requires affected files")
    target_file = next(
        (item for item in affected_files if isinstance(item, dict) and item.get("path") == publication.target_path),
        None,
    )
    if target_file is None:
        raise ValueError("approved proposal does not contain the target file")
    if str(target_file.get("content") or "") != markdown:
        raise ValueError("approved target file differs from proposal document")
    if str(target_file.get("content_sha256") or "") != document_hash:
        raise ValueError("approved target file content hash differs from proposal document hash")
    return [dict(item) for item in affected_files if isinstance(item, dict)], markdown


def apply_domain_knowledge_review_command(
    store: Any,
    *,
    run_id: str,
    command: dict[str, Any],
    cursor: str | None,
) -> dict[str, Any]:
    decision = ReviewDecision.model_validate(_decision_payload(command))
    decision_payload = decision.model_dump(mode="json")
    command_payload_hash = canonical_domain_knowledge_sha256(command)

    candidate_version = store.get_domain_knowledge_candidate_version(
        decision.candidate_id,
        decision.candidate_revision,
    )
    if candidate_version is None:
        raise ValueError("candidate revision is stale or missing")
    candidate = candidate_version.get("payload") or {}
    if command.get("input_payload_sha256") and not command.get("input_content_sha256"):
        delivery = store.get_domain_knowledge_candidate_delivery_for_candidate(
            run_id=run_id,
            candidate_id=decision.candidate_id,
            candidate_revision=decision.candidate_revision,
        )
        if delivery is None or str(delivery.get("payload_hash") or "") != decision.input_content_sha256:
            raise ValueError("candidate payload hash does not match review input")
    elif str(candidate.get("content_hash") or "") != decision.input_content_sha256:
        raise ValueError("candidate content hash does not match review input")

    content = decision.content_review
    change_set_payload: dict[str, Any] | None = None
    if content.decision in {"accept", "edit_accept"}:
        approved_knowledge = content.approved_knowledge.model_dump(mode="json") if content.approved_knowledge else None
        if canonical_domain_knowledge_sha256(approved_knowledge) != content.approved_knowledge_sha256:
            raise ValueError("approved knowledge hash does not match approved content")

    publication = decision.publication_review
    if publication.decision == "approve":
        if content.decision not in {"accept", "edit_accept"} or content.approved_knowledge is None:
            raise ValueError("publication approval requires accepted content review")
        proposal = _as_dict(command.get("proposal"), field="proposal")
        approved_files, _ = _validate_proposal(decision=decision, proposal=proposal)
        target = _as_dict(proposal.get("target"), field="proposal target")
        topic_id = str(target.get("topic_id") or "").strip()
        if publication.action == "create":
            topic_id = topic_id or f"dkt_{uuid4().hex}"
            base_content_sha256 = str(target.get("base_content_sha256") or _EMPTY_CONTENT_SHA256)
        else:
            if not topic_id:
                raise ValueError("existing-page proposal requires a topic id")
            base_content_sha256 = str(publication.base_content_sha256 or "")
        change_set = AcceptedWikiChangeSet.model_validate(
            {
                "kind": "project_domain_knowledge_wiki_change_set",
                "schema_version": 1,
                "change_set_id": f"dkcs_{uuid4().hex}",
                "candidate_id": decision.candidate_id,
                "candidate_revision": decision.candidate_revision,
                "decision_command_id": decision.command_id,
                "publication_action": publication.action,
                "target": {
                    "topic_id": topic_id,
                    "path": publication.target_path,
                    "base_content_sha256": base_content_sha256,
                    "base_git_revision": target.get("base_git_revision"),
                },
                "approved_knowledge": content.approved_knowledge.model_dump(mode="json"),
                "approved_knowledge_sha256": content.approved_knowledge_sha256,
                "approved_files": approved_files,
                "approved_diff": proposal.get("diff"),
                "approved_document_sha256": publication.approved_document_sha256,
                "approved_diff_sha256": publication.approved_diff_sha256,
                "confirmed_by": decision.reviewer.user_id,
                "confirmed_at": decision.reviewer.confirmed_at,
                "publish_status": "pending",
            }
        )
        change_set_payload = change_set.model_dump(mode="json")

    result = {
        "run_id": run_id,
        "command_id": decision.command_id,
        "status": "accepted" if change_set_payload is not None else "recorded",
        "change_set": change_set_payload,
    }
    stored_result, replayed = store.persist_domain_knowledge_review_application(
        run_id=run_id,
        cursor=cursor,
        command_payload=command,
        command_payload_hash=command_payload_hash,
        decision_payload=decision_payload,
        change_set_payload=change_set_payload,
        result=result,
    )
    return {**stored_result, "replayed": replayed}


def apply_domain_knowledge_publication_receipt(store: Any, payload: dict[str, Any]) -> dict[str, Any]:
    receipt = PublicationReceipt.model_validate(payload)
    normalized = receipt.model_dump(mode="json")
    change_set = store.get_domain_knowledge_wiki_change_set(receipt.change_set_id)
    if change_set is None:
        raise ValueError("publication receipt refers to an unknown change set")
    if receipt.publication_action != change_set.get("publication_action"):
        raise ValueError("publication receipt action does not match the accepted change set")
    if receipt.status == "published":
        if receipt.published_content_sha256 != change_set.get("approved_document_sha256"):
            raise ValueError("published content hash does not match the approved document hash")
        target = change_set.get("target") or {}
        if receipt.wiki_topic_id != target.get("topic_id") or receipt.wiki_path != target.get("path"):
            raise ValueError("published target does not match the accepted change set")
    return store.persist_domain_knowledge_publication_receipt(normalized)
