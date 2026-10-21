from __future__ import annotations

from typing import Any
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field, model_validator

from app.security import resolve_requester
from app.services.codex_openclaw_review_sync import enqueue_codex_review_sync
from app.services.codex_review_memory_draft import validate_review_decision_payload
from app.services.codex_review_memory_export import export_codex_review_memory_markdown
from app.services.codex_review_wiki_payload import build_codex_review_memory_wiki_payload
from app.services.openkb_client import OpenKbClient


router = APIRouter(prefix="/codex/reviews", tags=["codex-reviews"])


class CodexReviewDecisionPayload(BaseModel):
    action: Literal["accept", "edit_accept", "ignore", "snooze"]
    edited_title: str | None = Field(default=None, max_length=240)
    edited_summary: str | None = Field(default=None, max_length=4000)
    memory_draft: dict[str, Any] | None = None
    notes: str | None = Field(default=None, max_length=2000)
    snooze_until: str | None = Field(default=None, max_length=80)
    target: Literal["openclaw_wiki", "openkb", "markdown", "none"] = "openclaw_wiki"

    @model_validator(mode="after")
    def validate_action_payload(self):
        self.memory_draft = validate_review_decision_payload(
            action=self.action,
            edited_title=self.edited_title,
            edited_summary=self.edited_summary,
            snooze_until=self.snooze_until,
            memory_draft=self.memory_draft,
        )
        return self


class CodexReviewMemoryExportPayload(BaseModel):
    memory_ids: list[str] = Field(min_length=1, max_length=100)
    target: Literal["openkb", "markdown"] = "openkb"
    force: bool = False


def _require_admin(request: Request, x_user_id: str | None):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin:
        raise HTTPException(status_code=403, detail="Admin permission required")
    return requester


@router.post("/sessions/{pet_session_id}/enqueue")
def enqueue_codex_review_for_pet_session(
    request: Request,
    pet_session_id: str = Path(..., min_length=1, max_length=120),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    _require_admin(request, x_user_id)
    if not settings.codex_openclaw_review_enabled:
        raise HTTPException(status_code=404, detail="Codex OpenClaw review sync is disabled.")
    if not settings.openclaw_token:
        raise HTTPException(status_code=400, detail="OPENCLAW_TOKEN is required for Codex review sync.")
    try:
        return enqueue_codex_review_sync(request.app.state.trace_store, pet_session_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/drafts")
def list_codex_review_drafts(
    request: Request,
    workspace_id: str | None = Query(default=None, min_length=1, max_length=120),
    limit: int = Query(default=20, ge=1, le=100),
    x_user_id: str | None = Header(default=None),
):
    _require_admin(request, x_user_id)
    items = request.app.state.trace_store.list_codex_review_drafts(
        workspace_id=workspace_id,
        limit=limit,
    )
    return {"items": items, "limit": limit}


@router.get("/daily-summary")
def get_codex_review_daily_summary(
    request: Request,
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    workspace_id: str | None = Query(default=None, min_length=1, max_length=120),
    x_user_id: str | None = Header(default=None),
):
    _require_admin(request, x_user_id)
    return request.app.state.trace_store.get_codex_review_daily_summary(
        review_date=date,
        workspace_id=workspace_id,
    )


@router.post("/items/{item_id}/decision")
def decide_codex_review_item(
    payload: CodexReviewDecisionPayload,
    request: Request,
    item_id: str = Path(..., min_length=1, max_length=160),
    x_user_id: str | None = Header(default=None),
):
    requester = _require_admin(request, x_user_id)
    store = request.app.state.trace_store
    item = store.get_codex_review_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Codex review item not found.")

    details_patch = {
        "decision": payload.action,
        "decision_by": requester.user_id,
        "decision_notes": payload.notes,
        "decision_target": payload.target,
    }

    memory = None
    if payload.action in {"accept", "edit_accept"}:
        status = "accepted" if payload.action == "accept" else "edited_accepted"
        item = store.update_codex_review_item_status(item_id, status=status, details_patch=details_patch)
        title = payload.edited_title or item["title"]
        body = payload.edited_summary if payload.edited_summary is not None else item.get("summary")
        memory = store.create_codex_review_memory_from_item(
            review_item_id=item_id,
            title=title,
            body=body,
            memory_draft=payload.memory_draft,
            confirmed_by=requester.user_id,
            default_workspace_id=request.app.state.settings.codex_openclaw_control_plane_workspace_id,
        )
    elif payload.action == "ignore":
        item = store.update_codex_review_item_status(item_id, status="ignored", details_patch=details_patch)
    else:
        details_patch["snooze_until"] = payload.snooze_until
        item = store.update_codex_review_item_status(item_id, status="snoozed", details_patch=details_patch)

    return {"item": item, "memory": memory}


@router.get("/memory/{memory_id}/wiki-payload")
def get_codex_review_memory_wiki_payload(
    request: Request,
    memory_id: str = Path(..., min_length=1, max_length=180),
    x_user_id: str | None = Header(default=None),
):
    _require_admin(request, x_user_id)
    payload = build_codex_review_memory_wiki_payload(request.app.state.trace_store, memory_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Codex review memory not found.")
    return payload


@router.post("/memory/export")
async def export_codex_review_memory(
    payload: CodexReviewMemoryExportPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    _require_admin(request, x_user_id)
    store = request.app.state.trace_store
    settings = request.app.state.settings
    exported = 0
    failed = 0
    items = []
    for memory_id in payload.memory_ids:
        memory = store.get_codex_review_memory(memory_id)
        if memory is None:
            failed += 1
            items.append({"memory_id": memory_id, "target": payload.target, "status": "not_found"})
            continue
        if memory.get("export_status") == "synced" and not payload.force:
            exported += 1
            items.append(
                {
                    "memory_id": memory_id,
                    "target": payload.target,
                    "status": "already_synced",
                    "document_ref": memory.get("openkb_document_id"),
                }
            )
            continue
        try:
            result = export_codex_review_memory_markdown(memory, settings.codex_review_memory_export_root)
            item_status = result.status
            document_ref = result.document_ref
            if payload.target == "openkb" and settings.openkb_sync_enabled:
                if not settings.openkb_base_url:
                    raise ValueError("OPENKB_BASE_URL is required when OPENKB_SYNC_ENABLED=true.")
                openkb_client = getattr(request.app.state, "openkb_client", None)
                if openkb_client is None:
                    openkb_client = OpenKbClient(base_url=settings.openkb_base_url, token=settings.openkb_token)
                    request.app.state.openkb_client = openkb_client
                sync_result = await openkb_client.upsert_document(
                    document_id=memory_id,
                    title=memory["title"],
                    markdown=result.path.read_text(encoding="utf-8"),
                    metadata={
                        "workspace_id": memory.get("workspace_id"),
                        "memory_type": memory.get("memory_type"),
                        "source_review_item_id": memory.get("source_review_item_id"),
                        "pet_session_id": memory.get("pet_session_id"),
                        "codex_session_id": memory.get("codex_session_id"),
                        "version": memory.get("current_version"),
                        "tags": memory.get("tags") or [],
                        "evidence_refs": memory.get("evidence_refs") or [],
                        "markdown_ref": result.document_ref,
                    },
                )
                item_status = "synced_openkb"
                document_ref = sync_result.document_id
            store.mark_codex_review_memory_exported(memory_id, document_id=document_ref)
            exported += 1
            items.append(
                {
                    "memory_id": memory_id,
                    "target": payload.target,
                    "status": item_status,
                    "document_ref": document_ref,
                }
            )
        except Exception as error:
            failed += 1
            store.mark_codex_review_memory_export_failed(memory_id, error=str(error))
            items.append({"memory_id": memory_id, "target": payload.target, "status": "failed", "error": str(error)})
    return {"exported": exported, "failed": failed, "items": items}
