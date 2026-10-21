from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import hashlib
from typing import Any

from app.models.domain_knowledge import PublicationReceipt
from app.services.codex_author_knowledge_handoff_store import (
    CodexAuthorKnowledgeHandoffStore,
)


def _sha256(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _run_id_for_delivery(delivery: dict[str, Any]) -> str:
    payload = delivery.get("payload") if isinstance(delivery.get("payload"), dict) else {}
    return (
        f"project-knowledge:{payload.get('workspace_key') or ''}:candidate:"
        f"{delivery['candidate_id']}:{delivery['candidate_revision']}"
    )


def _author_candidate_item(delivery: dict[str, Any]) -> dict[str, Any]:
    payload = delivery.get("payload") if isinstance(delivery.get("payload"), dict) else {}
    candidate = payload.get("candidate") if isinstance(payload.get("candidate"), dict) else {}
    evidence = payload.get("evidence") if isinstance(payload.get("evidence"), dict) else {}
    workspace_key = str(payload.get("workspace_key") or "")
    candidate_id = str(payload.get("candidate_id") or delivery.get("candidate_id") or "")
    candidate_revision = int(payload.get("candidate_revision") or delivery.get("candidate_revision") or 0)
    content = str(candidate.get("content") or "")
    author_summary = str(candidate.get("author_summary") or "").strip()
    why_reusable = str(candidate.get("why_reusable") or "").strip()
    local_id = str(candidate.get("local_id") or candidate_id)
    evidence_refs = evidence.get("evidence_refs") if isinstance(evidence.get("evidence_refs"), list) else []

    ref_ids: list[str] = []
    evidence_index: list[dict[str, Any]] = []
    implementation_refs: list[str] = []
    test_refs: list[str] = []
    repository_revision: str | None = None
    for index, raw_ref in enumerate(evidence_refs):
        if not isinstance(raw_ref, dict):
            continue
        role = str(raw_ref.get("role") or "implementation")
        ref_id = f"ref_author_{index}"
        ref_ids.append(ref_id)
        revision = str(raw_ref.get("revision") or "").strip() or None
        if repository_revision is None and revision:
            repository_revision = revision
        if role == "implementation":
            implementation_refs.append(ref_id)
        elif role in {"test", "validation"}:
            test_refs.append(ref_id)
        evidence_index.append(
            {
                "ref_id": ref_id,
                "role": role,
                "authority": "authoritative",
                "repository_id": workspace_key,
                "revision": revision,
                "blob_sha": None,
                "path": str(raw_ref.get("path") or ""),
                "symbol": raw_ref.get("symbol"),
                "line_start": raw_ref.get("line_start"),
                "line_end": raw_ref.get("line_end"),
                "snippet": raw_ref.get("snippet"),
                "snippet_sha256": None,
                "resolver_uri": None,
                "command": raw_ref.get("command"),
                "outcome": raw_ref.get("outcome"),
                "exit_code": raw_ref.get("exit_code"),
            }
        )

    pending_verification = candidate.get("pending_verification") or []
    knowledge = {
        "schema_version": 2,
        "topic_kind": candidate.get("knowledge_kind_hint") or "rule",
        "domain": workspace_key,
        "title": candidate.get("title") or local_id,
        "aliases": candidate.get("related_topic_hints") or [],
        "introduced_for": {
            "problem": author_summary,
            "context": why_reusable,
            "failure_before_introduction": "",
        },
        "meaning": {
            "definition": content[:4000],
            "entities": [],
            "relationships": [],
            "boundaries": {
                "in_scope": [],
                "out_of_scope": [],
                "non_examples": [],
                "confused_with": [],
            },
            "invariants": [],
        },
        "technical_solution": {
            "summary": author_summary,
            "architecture_flow": [],
            "contract_refs": [],
            "implementation_refs": implementation_refs,
            "test_refs": test_refs,
            "validation_refs": [],
        },
        "failure_signals": [],
        "operational_appendix": {"steps": [], "cautions": []},
        "source": {"concept_delta_ids": [], "codex_session_ids": [], "baseline_scan_ids": []},
        "evidence_refs": ref_ids,
        "open_questions": pending_verification if isinstance(pending_verification, list) else [],
    }
    return {
        "candidate_id": candidate_id,
        "candidate_revision": candidate_revision,
        "source_kind": "codex_author_handoff",
        "source_hash": str(delivery.get("payload_hash") or _sha256(content)),
        "content_hash": _sha256(content),
        "trigger": {
            "type": "codex_author_handoff",
            "pet_session_id": None,
            "codex_session_id": None,
            "concept_delta_ids": [],
        },
        "repository_snapshot": {
            "repository_id": workspace_key,
            "commit_sha": repository_revision,
        },
        "topic_match": {
            "proposed_topic_id": None,
            "topic_identity_key": f"{workspace_key}/{local_id}",
            "possible_topic_ids": [],
        },
        "knowledge": knowledge,
        "quality_gate": {
            "definition_complete": bool(content.strip()),
            "problem_linked": bool(author_summary or why_reusable),
            "relationships_explicit": False,
            "boundaries_explicit": False,
            "invariants_explicit": False,
            "contract_linked": False,
            "code_linked": bool(implementation_refs),
            "test_or_validation_linked": bool(test_refs),
            "verified": False,
        },
        "review_readiness": "ready_for_review",
        "evidence_index": evidence_index,
        "payload_sha256": str(delivery.get("payload_hash") or ""),
    }


async def push_next_codex_author_knowledge_delivery(app: Any) -> dict[str, Any]:
    store: CodexAuthorKnowledgeHandoffStore = app.state.knowledge_handoff_store
    delivery = store.claim_next_delivery(now=datetime.now(UTC))
    if delivery is None:
        return {"status": "no_pending_deliveries", "submitted": 0}
    run_id = _run_id_for_delivery(delivery)
    item = _author_candidate_item(delivery)
    payload_hash = str(delivery.get("payload_hash") or "")
    batch = {
        "kind": "project_domain_knowledge_candidate_batch",
        "schema_version": 1,
        "run_id": run_id,
        "workspace_id": item["repository_snapshot"]["repository_id"],
        "items": [item],
        "idempotency_key": "knowledge-candidates:" + payload_hash.removeprefix("sha256:"),
    }
    try:
        response = await app.state.openclaw_control_plane_client.post_project_knowledge_candidates(
            run_id=run_id,
            batch=batch,
        )
        items = response.get("items") if isinstance(response, dict) else None
        ack = next(
            (
                item
                for item in items or []
                if isinstance(item, dict)
                and item.get("candidate_id") == delivery["candidate_id"]
                and int(item.get("candidate_revision") or 0) == int(delivery["candidate_revision"])
            ),
            None,
        )
        if str((ack or {}).get("status") or "") not in {"accepted", "duplicate"}:
            raise ValueError(str((ack or {}).get("error") or "OpenClaw did not accept candidate"))
        acknowledged = store.acknowledge_delivery(
            delivery_id=delivery["delivery_id"],
            outcome=str((ack or {}).get("status") or "accepted"),
            ack_id=str((ack or {}).get("ack_id") or "") or None,
        )
        return {
            "status": "accepted",
            "submitted": 1,
            "delivery_id": delivery["delivery_id"],
            "response": response,
            "acknowledged": acknowledged,
        }
    except Exception as error:
        store.release_delivery(delivery_id=delivery["delivery_id"], error=str(error))
        raise


def _publication_receipt_from_status_item(item: dict[str, Any]) -> dict[str, Any] | None:
    status = str(item.get("status") or "")
    if status not in {"published", "failed", "conflict"}:
        return None
    change_set_id = str(item.get("change_set_id") or item.get("publish_ticket_id") or "").strip()
    if not change_set_id:
        return None
    lint = item.get("lint") if isinstance(item.get("lint"), dict) else {}
    git = item.get("git") if isinstance(item.get("git"), dict) else {}
    return {
        "kind": "project_domain_knowledge_publication_receipt",
        "schema_version": 1,
        "change_set_id": change_set_id,
        "status": status,
        "publication_action": str(item.get("action") or "create"),
        "wiki_topic_id": item.get("topic_id"),
        "wiki_path": item.get("target_path"),
        "published_content_sha256": item.get("published_document_sha256"),
        "lint": {
            "status": str(lint.get("status") or ("passed" if status == "published" else "failed")),
            "errors": lint.get("errors") or [],
            "warnings": lint.get("warnings") or [],
        },
        "git": {
            "commit_sha": git.get("commit_sha"),
            "branch": git.get("branch"),
            "pushed": bool(git.get("pushed")),
        },
        "error": item.get("error"),
        "published_at": item.get("updated_at"),
    }


async def poll_codex_author_knowledge_publication_receipts(app: Any) -> dict[str, Any]:
    store: CodexAuthorKnowledgeHandoffStore = app.state.knowledge_handoff_store
    client = app.state.openclaw_control_plane_client
    run_results: list[dict[str, Any]] = []
    for run_id in store.list_delivery_run_ids(limit=50):
        cursor_row = store.get_author_openclaw_cursor(run_id)
        current_cursor = (cursor_row or {}).get("publish_cursor")
        try:
            response = await client.get_project_knowledge_publish_status(
                run_id=run_id,
                cursor=current_cursor,
            )
        except Exception as error:
            run_results.append({"run_id": run_id, "error": str(error), "mirrored": 0})
            continue
        mirrored = 0
        skipped: list[str] = []
        for item in response.get("items") or []:
            if not isinstance(item, dict):
                continue
            receipt = _publication_receipt_from_status_item(item)
            if receipt is None:
                skipped.append(str(item.get("publish_ticket_id") or item.get("status") or "non_terminal"))
                continue
            try:
                PublicationReceipt.model_validate(receipt)
                store.mirror_publication_receipt(receipt=receipt)
                mirrored += 1
            except Exception as error:
                skipped.append(str(error))
        next_cursor = response.get("cursor") or response.get("next_cursor") or current_cursor
        store.update_author_openclaw_cursor(run_id=run_id, publish_cursor=next_cursor)
        run_results.append(
            {
                "run_id": run_id,
                "cursor": next_cursor,
                "mirrored": mirrored,
                "skipped": skipped,
            }
        )
    return {"status": "publication_receipts_polled", "runs": run_results}


async def run_codex_author_knowledge_openclaw_delivery_worker(app: Any) -> None:
    settings = app.state.settings
    interval = max(1.0, float(settings.codex_author_knowledge_reconciliation_interval_seconds))
    while True:
        try:
            await push_next_codex_author_knowledge_delivery(app)
        except Exception:
            pass
        try:
            await poll_codex_author_knowledge_publication_receipts(app)
        except Exception:
            pass
        await asyncio.sleep(interval)
