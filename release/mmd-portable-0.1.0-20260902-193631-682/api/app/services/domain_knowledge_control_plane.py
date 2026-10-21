from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.services.domain_knowledge_review_ledger import (
    apply_domain_knowledge_publication_receipt,
    apply_domain_knowledge_review_command,
    canonical_domain_knowledge_sha256,
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _workspace_id_from_run_id(run_id: str) -> str:
    parts = str(run_id or "").split(":", 3)
    if len(parts) < 4 or parts[0] != "project-knowledge" or not parts[1]:
        raise ValueError("project knowledge run_id must contain a workspace id")
    return parts[1]


async def push_pending_domain_knowledge_candidates(app: Any) -> dict[str, Any]:
    store = app.state.trace_store
    delivery = store.claim_next_domain_knowledge_candidate_delivery(now_iso=_now_iso())
    if delivery is None:
        return {"status": "no_pending_candidates", "submitted": 0}
    payload = delivery.get("payload") or {}
    workspace_id = _workspace_id_from_run_id(delivery["run_id"])
    batch = {
        "kind": "project_domain_knowledge_candidate_batch",
        "schema_version": 1,
        "run_id": delivery["run_id"],
        "workspace_id": workspace_id,
        "items": [payload],
        "idempotency_key": "knowledge-candidates:"
        + str(delivery["payload_hash"]).removeprefix("sha256:"),
    }
    response = await app.state.openclaw_control_plane_client.post_project_knowledge_candidates(
        run_id=delivery["run_id"],
        batch=batch,
    )
    raw_items = response.get("items") if isinstance(response, dict) else None
    items = [item for item in raw_items if isinstance(item, dict)] if isinstance(raw_items, list) else []
    ack = next(
        (
            item
            for item in items
            if item.get("candidate_id") == delivery["candidate_id"]
            and int(item.get("candidate_revision") or 0) == int(delivery["candidate_revision"])
        ),
        None,
    )
    status = str((ack or {}).get("status") or "")
    if status not in {"accepted", "duplicate"}:
        raise ValueError(str((ack or {}).get("error") or "OpenClaw did not accept candidate delivery"))
    store.mark_domain_knowledge_candidate_delivery_accepted(delivery["id"])
    return {
        "status": "accepted",
        "submitted": 1,
        "delivery_id": delivery["id"],
        "response": response,
    }


def _command_result_payload(application: dict[str, Any]) -> dict[str, Any]:
    change_set = application.get("change_set") if isinstance(application.get("change_set"), dict) else None
    result: dict[str, Any] = {
        "application_status": "duplicate" if application.get("replayed") else "applied",
        "candidate_status": "approved" if change_set else "recorded",
        "accepted_version_id": None,
        "change_set_id": None,
        "publish_ticket_id": None,
        "topic_id": None,
        "expected_action": None,
        "expected_target_path": None,
        "expected_document_sha256": None,
        "expected_diff_sha256": None,
    }
    if change_set:
        ticket = "dkpt_" + canonical_domain_knowledge_sha256(change_set["change_set_id"])[7:31]
        result.update(
            {
                "accepted_version_id": f"dkv_{change_set['candidate_id']}_{change_set['candidate_revision']}",
                "change_set_id": change_set["change_set_id"],
                "publish_ticket_id": ticket,
                "topic_id": (change_set.get("target") or {}).get("topic_id"),
                "expected_action": change_set.get("publication_action"),
                "expected_target_path": (change_set.get("target") or {}).get("path"),
                "expected_document_sha256": change_set.get("approved_document_sha256"),
                "expected_diff_sha256": change_set.get("approved_diff_sha256"),
            }
        )
    return {
        "run_id": application.get("run_id"),
        "command_id": application.get("command_id"),
        "status": "succeeded",
        "result": result,
        "error": None,
        "completed_at": _now_iso(),
    }


async def poll_domain_knowledge_review_commands(app: Any, *, run_id: str) -> dict[str, Any]:
    store = app.state.trace_store
    cursors = store.get_domain_knowledge_control_plane_cursors(run_id)
    current_cursor = cursors.get("command_cursor")
    response = await app.state.openclaw_control_plane_client.get_project_knowledge_commands(
        run_id=run_id,
        cursor=current_cursor,
    )
    raw_commands = response.get("commands") if isinstance(response, dict) else None
    commands = [item for item in raw_commands if isinstance(item, dict)] if isinstance(raw_commands, list) else []
    results: list[dict[str, Any]] = []
    for command in commands:
        command_id = str(command.get("command_id") or command.get("id") or "").strip()
        if not command_id:
            raise ValueError("OpenClaw project knowledge command id is required")
        try:
            application = apply_domain_knowledge_review_command(
                store,
                run_id=run_id,
                command=command,
                cursor=current_cursor,
            )
            result = _command_result_payload(application)
        except Exception as error:
            result = {
                "run_id": run_id,
                "command_id": command_id,
                "status": "failed",
                "result": None,
                "error": str(error),
                "completed_at": _now_iso(),
            }
        await app.state.openclaw_control_plane_client.post_project_knowledge_command_result(
            command_id=command_id,
            result=result,
        )
        results.append(result)
    next_cursor = response.get("cursor") or response.get("next_cursor") or current_cursor
    store.update_domain_knowledge_control_plane_cursors(run_id=run_id, command_cursor=next_cursor)
    return {
        "status": "commands_processed",
        "run_id": run_id,
        "cursor": next_cursor,
        "processed": len(results),
        "results": results,
        "response": response,
    }


def build_domain_knowledge_publish_payload(
    change_set: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    target = change_set.get("target") if isinstance(change_set.get("target"), dict) else {}
    approved_diff = change_set.get("approved_diff") if isinstance(change_set.get("approved_diff"), dict) else {}
    diff_body = {"format": approved_diff.get("format"), "files": approved_diff.get("files") or []}
    if canonical_domain_knowledge_sha256(diff_body) != change_set.get("approved_diff_sha256"):
        raise ValueError("accepted change set diff hash does not match the exact approved diff")

    wiki_files: list[dict[str, Any]] = []
    for raw_file in change_set.get("approved_files") or []:
        if not isinstance(raw_file, dict):
            continue
        markdown = str(raw_file.get("markdown") or raw_file.get("content") or "")
        result_hash = str(raw_file.get("result_content_sha256") or raw_file.get("content_sha256") or "")
        if canonical_domain_knowledge_sha256(markdown) != result_hash:
            raise ValueError("accepted change set file hash does not match exact Markdown")
        path = str(raw_file.get("path") or "")
        wiki_files.append(
            {
                "role": raw_file.get("role") or ("canonical_target" if path == target.get("path") else "related"),
                "path": path,
                "operation": raw_file.get("operation")
                or ("create" if change_set.get("publication_action") == "create" else "modify"),
                "base_content_sha256": raw_file.get("base_content_sha256")
                or (target.get("base_content_sha256") if path == target.get("path") else None),
                "result_content_sha256": result_hash,
                "markdown": markdown,
            }
        )
    if not wiki_files:
        raise ValueError("accepted change set has no exact files to publish")

    evidence_index = candidate.get("evidence_index") if isinstance(candidate.get("evidence_index"), list) else []
    repository_commit = next(
        (str(item.get("revision")) for item in evidence_index if isinstance(item, dict) and item.get("revision")),
        None,
    )
    knowledge = change_set.get("approved_knowledge") or candidate.get("draft") or {}
    source = knowledge.get("source") if isinstance(knowledge, dict) and isinstance(knowledge.get("source"), dict) else {}
    publish_ticket_id = "dkpt_" + canonical_domain_knowledge_sha256(change_set["change_set_id"])[7:31]
    return {
        "publish_ticket_id": publish_ticket_id,
        "change_set_id": change_set["change_set_id"],
        "decision_command_id": change_set["decision_command_id"],
        "candidate_id": change_set["candidate_id"],
        "candidate_revision": change_set["candidate_revision"],
        "accepted_version_id": f"dkv_{change_set['candidate_id']}_{change_set['candidate_revision']}",
        "topic_id": target.get("topic_id"),
        "authorization": {
            "action": change_set.get("publication_action"),
            "target_path": target.get("path"),
            "base_content_sha256": target.get("base_content_sha256"),
            "base_git_revision": target.get("base_git_revision"),
            "approved_knowledge_sha256": change_set.get("approved_knowledge_sha256"),
            "approved_document_sha256": change_set.get("approved_document_sha256"),
            "approved_diff_sha256": change_set.get("approved_diff_sha256"),
            "approved_by": change_set.get("confirmed_by"),
            "approved_at": change_set.get("confirmed_at"),
        },
        "knowledge": knowledge,
        "wiki": {"files": wiki_files, "approved_diff": approved_diff},
        "evidence_index": evidence_index,
        "provenance": {
            "repository_commit": repository_commit,
            "codex_session_ids": source.get("codex_session_ids") or [],
            "concept_delta_ids": source.get("concept_delta_ids") or [],
            "baseline_scan_ids": source.get("baseline_scan_ids") or [],
        },
        "idempotency_key": f"knowledge-publish:{publish_ticket_id}",
    }


async def push_pending_domain_knowledge_change_sets(app: Any, *, run_id: str) -> dict[str, Any]:
    store = app.state.trace_store
    change_sets = store.list_pending_domain_knowledge_wiki_change_sets(run_id=run_id, limit=1)
    if not change_sets:
        return {"status": "no_pending_change_sets", "submitted": 0, "run_id": run_id}
    change_set = change_sets[0]
    candidate_version = store.get_domain_knowledge_candidate_version(
        change_set["candidate_id"],
        change_set["candidate_revision"],
    )
    if candidate_version is None:
        raise ValueError("accepted change set candidate revision is missing")
    payload = build_domain_knowledge_publish_payload(change_set, candidate_version.get("payload") or {})
    batch = {
        "kind": "project_domain_knowledge_wiki_payload_batch",
        "schema_version": 1,
        "run_id": run_id,
        "payloads": [payload],
    }
    response = await app.state.openclaw_control_plane_client.post_project_knowledge_publish_payloads(
        run_id=run_id,
        batch=batch,
    )
    raw_items = response.get("items") if isinstance(response, dict) else None
    items = [item for item in raw_items if isinstance(item, dict)] if isinstance(raw_items, list) else []
    ack = next(
        (item for item in items if item.get("publish_ticket_id") == payload["publish_ticket_id"]),
        None,
    )
    status = str((ack or {}).get("status") or "")
    if status not in {"accepted", "duplicate"}:
        raise ValueError(str((ack or {}).get("error") or "OpenClaw did not accept publish payload"))
    store.mark_domain_knowledge_wiki_change_set_publishing(change_set["change_set_id"])
    return {
        "status": "accepted",
        "submitted": 1,
        "run_id": run_id,
        "change_set_id": change_set["change_set_id"],
        "publish_ticket_id": payload["publish_ticket_id"],
        "response": response,
    }


async def poll_domain_knowledge_publication_receipts(app: Any, *, run_id: str) -> dict[str, Any]:
    store = app.state.trace_store
    current_cursor = store.get_domain_knowledge_control_plane_cursors(run_id).get("publish_cursor")
    response = await app.state.openclaw_control_plane_client.get_project_knowledge_publish_status(
        run_id=run_id,
        cursor=current_cursor,
    )
    raw_items = response.get("items") if isinstance(response, dict) else None
    items = [item for item in raw_items if isinstance(item, dict)] if isinstance(raw_items, list) else []
    applied: list[dict[str, Any]] = []
    for item in items:
        receipt = item.get("receipt") if isinstance(item.get("receipt"), dict) else item
        applied.append(apply_domain_knowledge_publication_receipt(store, receipt))
    next_cursor = response.get("cursor") or response.get("next_cursor") or current_cursor
    store.update_domain_knowledge_control_plane_cursors(run_id=run_id, publish_cursor=next_cursor)
    return {
        "status": "publication_receipts_processed",
        "run_id": run_id,
        "cursor": next_cursor,
        "processed": len(applied),
        "items": applied,
        "response": response,
    }


async def process_domain_knowledge_control_plane_once(app: Any) -> dict[str, Any]:
    candidate_result = await push_pending_domain_knowledge_candidates(app)
    run_results: list[dict[str, Any]] = []
    for run_id in app.state.trace_store.list_domain_knowledge_control_plane_run_ids(limit=20):
        commands = await poll_domain_knowledge_review_commands(app, run_id=run_id)
        change_sets = await push_pending_domain_knowledge_change_sets(app, run_id=run_id)
        receipts = await poll_domain_knowledge_publication_receipts(app, run_id=run_id)
        run_results.append(
            {
                "run_id": run_id,
                "commands": commands,
                "change_sets": change_sets,
                "receipts": receipts,
            }
        )
    return {
        "status": "domain_knowledge_control_plane_processed",
        "candidates": candidate_result,
        "runs": run_results,
    }
