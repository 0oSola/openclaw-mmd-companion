from __future__ import annotations

import hashlib
import json
import secrets
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.models.domain_knowledge import PublicationReceipt
from app.security import resolve_requester
from app.services.codex_knowledge_whitelist import require_whitelisted_ip


router = APIRouter(prefix="/codex/knowledge", tags=["codex-author-knowledge-review"])


def _require_admin(request: Request, x_user_id: str | None):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin:
        raise HTTPException(status_code=403, detail="Admin permission required")
    return requester


@router.get("/review-summary")
def get_review_summary(
    request: Request,
    workspace_key: str | None = None,
    x_user_id: str | None = Header(default=None),
):
    """供 MMD 工作台查看知识审核队列汇总（待审核/已认领/需补充证据等数量）。"""
    _require_admin(request, x_user_id)
    store = getattr(request.app.state, "knowledge_handoff_store", None)
    if store is None:
        raise HTTPException(status_code=404, detail="Codex author knowledge handoff is disabled.")
    rows = store.list_candidate_revisions(workspace_key=workspace_key, limit=None)
    counts: dict[str, int] = {}
    for row in rows:
        status = str(row.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    pending = counts.get("ready_for_review", 0)
    return {
        "workspace_key": workspace_key,
        "total": len(rows),
        "pending": pending,
        "by_status": counts,
    }


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def _safe_relative_path(value: str) -> bool:
    normalized = str(value or "").replace("\\", "/").strip()
    return bool(
        normalized
        and not normalized.startswith(("/", "~"))
        and not PureWindowsPath(normalized).is_absolute()
        and ".." not in PurePosixPath(normalized).parts
    )


def _validation_policy(workspace_key: str) -> dict[str, Any]:
    return {
        "validation_policy_version": "vault-structure-v1",
        "allowed_roots": [f"projects/{workspace_key}/domains/"],
        "required_frontmatter": ["title", "topic_kind", "topic_id"],
        "forbid_path_traversal": True,
        "require_approved_file_allowlist": True,
        "require_clean_unrelated_diff": True,
    }


def _store_or_404(request: Request):
    store = getattr(request.app.state, "knowledge_handoff_store", None)
    if store is None:
        raise HTTPException(status_code=404, detail="Codex author knowledge handoff is disabled.")
    whitelist_store = getattr(request.app.state, "codex_knowledge_whitelist_store", None)
    require_whitelisted_ip(whitelist_store, request.client.host if request.client else "")
    transport_expected = request.app.state.settings.codex_author_knowledge_handoff_token
    openclaw_expected = request.app.state.settings.codex_author_knowledge_openclaw_token
    if (
        not transport_expected
        or not openclaw_expected
        or secrets.compare_digest(transport_expected, openclaw_expected)
    ):
        raise HTTPException(status_code=503, detail="Codex author knowledge audience tokens are not configured separately.")
    token = request.headers.get("x-codex-knowledge-openclaw-token")
    if not token or not secrets.compare_digest(token, openclaw_expected):
        raise HTTPException(status_code=401, detail="Codex author knowledge openclaw token is invalid.")
    return store


class ClaimPayload(BaseModel):
    workspace_key: str = Field(min_length=1, max_length=160)
    claimed_by: str = Field(min_length=1, max_length=120)
    capacity: int = Field(default=1, ge=1, le=1)


class HeartbeatPayload(BaseModel):
    claimed_by: str = Field(min_length=1, max_length=120)
    lease_seconds: int = Field(default=3600, ge=60, le=86400)


class ContentDecisionPayload(BaseModel):
    decision: str = Field(pattern="^(accept|edit_accept|reject|needs_evidence)$")
    approved_knowledge: dict[str, Any] | None = None
    notes: str | None = Field(default=None, max_length=4000)


class PublicationDecisionPayload(BaseModel):
    decision: str = Field(pattern="^(approve|revise|reject)$")
    proposal: dict[str, Any] | None = None


class ReceiptPayload(PublicationReceipt):
    validation_report: dict[str, Any] | None = None


def _validate_proposal(proposal: dict[str, Any]) -> None:
    if proposal.get("publication_action") not in {"create", "update", "merge", "supersede"}:
        raise ValueError("proposal publication_action is invalid")
    target = proposal.get("target") if isinstance(proposal.get("target"), dict) else {}
    target_path = str(target.get("path") or "")
    if not _safe_relative_path(target_path):
        raise ValueError("proposal target path is unsafe")
    affected = proposal.get("affected_files")
    if not isinstance(affected, list) or not affected:
        raise ValueError("proposal affected_files are required")
    paths: set[str] = set()
    for file in affected:
        if not isinstance(file, dict):
            raise ValueError("proposal affected file must be an object")
        path = str(file.get("path") or "")
        if not _safe_relative_path(path) or path in paths:
            raise ValueError("proposal affected path is unsafe or duplicated")
        paths.add(path)
        markdown = str(file.get("markdown") or "")
        if not markdown.strip():
            raise ValueError("proposal affected file Markdown is required")
        if file.get("result_content_sha256") != _sha256(markdown):
            raise ValueError("proposal affected file hash mismatch")
    if target_path not in paths:
        raise ValueError("proposal target file is missing from affected_files")
    diff = proposal.get("diff") if isinstance(proposal.get("diff"), dict) else {}
    diff_files = diff.get("files")
    if not isinstance(diff_files, list) or not diff_files:
        raise ValueError("proposal diff files are required")
    diff_body = {
        "format": "unified",
        "files": [
            {"path": str(file.get("path") or ""), "patch": str(file.get("patch") or "")}
            for file in diff_files
            if isinstance(file, dict)
        ],
    }
    if diff.get("sha256") != _sha256(_canonical_json(diff_body)):
        raise ValueError("proposal diff hash mismatch")
    diff_paths = {str(file.get("path") or "") for file in diff_files if isinstance(file, dict)}
    if diff_paths != paths:
        raise ValueError("proposal diff paths do not match affected files")


@router.post("/review-claims")
def claim_next_review(payload: ClaimPayload, request: Request):
    store = _store_or_404(request)
    try:
        claim = store.claim_next_review(
            workspace_key=payload.workspace_key,
            claimed_by=payload.claimed_by,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    if claim is None:
        return {"status": "no_candidates"}
    return {
        "status": "claimed",
        "claim_id": claim["claim_id"],
        "candidate_id": claim["candidate_id"],
        "candidate_revision": claim["candidate_revision"],
        "workspace_key": claim["workspace_key"],
        "lease_expires_at": claim["lease_expires_at"],
        "candidate": claim.get("candidate_payload"),
        "validation_policy": _validation_policy(claim["workspace_key"]),
    }


@router.post("/review-claims/{claim_id}/heartbeat")
def heartbeat_review_claim(claim_id: str, payload: HeartbeatPayload, request: Request):
    store = _store_or_404(request)
    try:
        claim = store.heartbeat_review_claim(
            claim_id=claim_id,
            claimed_by=payload.claimed_by,
            lease_seconds=payload.lease_seconds,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"claim_id": claim["claim_id"], "status": claim["status"], "lease_expires_at": claim["lease_expires_at"]}


@router.post("/review-claims/{claim_id}/defer")
def defer_review_claim(claim_id: str, payload: HeartbeatPayload, request: Request):
    store = _store_or_404(request)
    try:
        claim = store.defer_review_claim(claim_id=claim_id, claimed_by=payload.claimed_by)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"claim_id": claim["claim_id"], "status": claim["status"]}


@router.post("/review-claims/{claim_id}/content-decision")
def record_content_decision(claim_id: str, payload: ContentDecisionPayload, request: Request):
    store = _store_or_404(request)
    try:
        claim = store.record_content_decision(
            claim_id=claim_id,
            decision=payload.decision,
            approved_knowledge=payload.approved_knowledge,
            notes=payload.notes,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"claim_id": claim["claim_id"], "status": claim["status"]}


@router.post("/review-claims/{claim_id}/publication-decision")
def record_publication_decision(claim_id: str, payload: PublicationDecisionPayload, request: Request):
    store = _store_or_404(request)
    if payload.decision != "approve":
        return {"claim_id": claim_id, "status": "publication_not_approved"}
    if not isinstance(payload.proposal, dict):
        raise HTTPException(status_code=422, detail="publication approval requires a proposal")
    try:
        _validate_proposal(payload.proposal)
        claim = store.record_publication_decision(claim_id=claim_id, proposal=payload.proposal)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"claim_id": claim["claim_id"], "status": claim["status"]}


@router.post("/review-claims/{claim_id}/receipt")
def record_publication_receipt(claim_id: str, payload: ReceiptPayload, request: Request):
    store = _store_or_404(request)
    receipt = payload.model_dump(mode="json")
    receipt.pop("validation_report", None)
    try:
        claim = store.record_publication_receipt(claim_id=claim_id, receipt=receipt)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"claim_id": claim["claim_id"], "status": claim["status"], "outcome": claim.get("outcome", "recorded")}
