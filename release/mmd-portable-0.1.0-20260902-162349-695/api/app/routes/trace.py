from __future__ import annotations

from fastapi import APIRouter, Header, Query, Request

from app.security import resolve_requester


router = APIRouter(prefix="/trace", tags=["trace"])


@router.get("/events")
def list_trace_events(
    request: Request,
    trace_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    store = request.app.state.trace_store
    items = store.query_events(
        trace_id=trace_id,
        requester_user_id=requester.user_id,
        is_admin=requester.is_admin,
        user_id_filter=user_id,
        limit=limit,
    )
    return {
        "items": items,
        "requester": {
            "user_id": requester.user_id,
            "is_admin": requester.is_admin,
            "effective_user_id": user_id if requester.is_admin and user_id else requester.user_id,
        },
    }


@router.get("/mirrors")
def list_chat_mirrors(
    request: Request,
    trace_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    store = request.app.state.trace_store
    items = store.query_mirrors(
        trace_id=trace_id,
        requester_user_id=requester.user_id,
        is_admin=requester.is_admin,
        user_id_filter=user_id,
        limit=limit,
    )
    return {
        "items": items,
        "requester": {
            "user_id": requester.user_id,
            "is_admin": requester.is_admin,
            "effective_user_id": user_id if requester.is_admin and user_id else requester.user_id,
        },
    }

