from __future__ import annotations

from typing import Any

import secrets

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.models.domain_knowledge import PublicationReceipt
from app.services.codex_author_knowledge_handoff import (
    HandoffValidationError,
    receive_handoff,
    reconcile_workspace,
)


router = APIRouter(prefix="/codex/knowledge", tags=["codex-author-knowledge-handoff"])


class GitEventPayload(BaseModel):
    workspace_key: str = Field(min_length=1, max_length=160)
    event_type: str = Field(min_length=1, max_length=80)


class OpenClawDeliveryAckPayload(BaseModel):
    outcome: str = Field(min_length=1, max_length=40)
    ack_id: str | None = Field(default=None, max_length=200)


class PublicationReceiptPayload(PublicationReceipt):
    """OpenClaw publication receipt mirrored for audit; it never re-enters delivery."""


def _store_or_404(request: Request, token: str | None, *, audience: str):
    store = getattr(request.app.state, "knowledge_handoff_store", None)
    if store is None:
        raise HTTPException(status_code=404, detail="Codex author knowledge handoff is disabled.")
    transport_expected = request.app.state.settings.codex_author_knowledge_handoff_token
    openclaw_expected = request.app.state.settings.codex_author_knowledge_openclaw_token
    if (
        not transport_expected
        or not openclaw_expected
        or secrets.compare_digest(transport_expected, openclaw_expected)
    ):
        raise HTTPException(status_code=503, detail="Codex author knowledge audience tokens are not configured separately.")
    expected = (
        openclaw_expected
        if audience == "openclaw"
        else transport_expected
    )
    if not expected or not token or not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail=f"Codex author knowledge {audience} token is invalid.")
    return store


@router.post("/handoffs")
def receive_author_knowledge_handoff(
    payload: dict[str, Any],
    request: Request,
    x_codex_knowledge_transport_token: str | None = Header(default=None),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    store = _store_or_404(request, x_codex_knowledge_transport_token, audience="transport")
    try:
        return receive_handoff(
            store=store,
            payload=payload,
            idempotency_key=idempotency_key,
            workspace_paths=request.app.state.settings.codex_workspace_paths,
            durable_refs=request.app.state.settings.codex_author_knowledge_durable_refs,
        )
    except HandoffValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={"reason_code": error.reason_code, "message": str(error)},
        ) from error


@router.get("/handoffs")
def list_author_knowledge_handoffs(
    request: Request,
    limit: int = 100,
    x_codex_knowledge_transport_token: str | None = Header(default=None),
):
    store = _store_or_404(request, x_codex_knowledge_transport_token, audience="transport")
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 100")
    items = []
    for item in store.list_handoffs(limit=limit):
        items.append(
            {
                "package_id": item["package_id"],
                "handoff_id": item["handoff_id"],
                "workspace_key": item["workspace_key"],
                "package_sha256": item["package_sha256"],
                "package_content_sha256": item["package_content_sha256"],
                "ack_id": item["ack_id"],
                "status": item["status"],
                "candidate_count": item["candidate_count"],
                "created_at": item["created_at"],
                "updated_at": item["updated_at"],
            }
        )
    return {"items": items, "limit": limit}


@router.post("/git-events")
def receive_git_event(
    payload: GitEventPayload,
    request: Request,
    x_codex_knowledge_transport_token: str | None = Header(default=None),
):
    store = _store_or_404(request, x_codex_knowledge_transport_token, audience="transport")
    result = reconcile_workspace(
        store=store,
        workspace_key=payload.workspace_key,
        workspace_paths=request.app.state.settings.codex_workspace_paths,
        durable_refs=request.app.state.settings.codex_author_knowledge_durable_refs,
    )
    return {
        "status": "accepted",
        "workspace_key": payload.workspace_key,
        "event_type": payload.event_type,
        "reconciled": result["reconciled"],
        "results": result["results"],
    }


@router.post("/reconcile")
def reconcile_author_knowledge(
    request: Request,
    workspace_key: str | None = None,
    x_codex_knowledge_transport_token: str | None = Header(default=None),
):
    store = _store_or_404(request, x_codex_knowledge_transport_token, audience="transport")
    return reconcile_workspace(
        store=store,
        workspace_key=workspace_key,
        workspace_paths=request.app.state.settings.codex_workspace_paths,
        durable_refs=request.app.state.settings.codex_author_knowledge_durable_refs,
    )


@router.get("/openclaw-deliveries")
def list_openclaw_deliveries(
    request: Request,
    limit: int = 100,
    x_codex_knowledge_openclaw_token: str | None = Header(default=None),
):
    store = _store_or_404(request, x_codex_knowledge_openclaw_token, audience="openclaw")
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 100")
    return {"items": store.list_deliveries(limit=limit), "limit": limit}


@router.post("/openclaw-deliveries/{delivery_id}/ack")
def acknowledge_openclaw_delivery(
    delivery_id: str,
    payload: OpenClawDeliveryAckPayload,
    request: Request,
    x_codex_knowledge_openclaw_token: str | None = Header(default=None),
):
    store = _store_or_404(request, x_codex_knowledge_openclaw_token, audience="openclaw")
    try:
        return store.acknowledge_delivery(
            delivery_id=delivery_id,
            outcome=payload.outcome,
            ack_id=payload.ack_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/publication-receipts")
def mirror_publication_receipt(
    payload: PublicationReceiptPayload,
    request: Request,
    x_codex_knowledge_openclaw_token: str | None = Header(default=None),
):
    store = _store_or_404(request, x_codex_knowledge_openclaw_token, audience="openclaw")
    try:
        return store.mirror_publication_receipt(receipt=payload.model_dump(mode="json"))
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
