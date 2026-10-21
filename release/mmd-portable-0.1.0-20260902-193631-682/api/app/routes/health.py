from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request


router = APIRouter(tags=["health"])


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/healthz/openclaw")
async def openclaw_health(request: Request) -> dict[str, Any]:
    client = request.app.state.openclaw_client
    return await client.diagnose()


def _require_admin(request: Request, x_user_id: str | None) -> str:
    user_id = (x_user_id or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="x-user-id header is required")
    if user_id not in request.app.state.settings.admin_user_ids:
        raise HTTPException(status_code=403, detail="Admin permission required")
    return user_id


def _json_loads(value: str | None) -> Any:
    if not value:
        return {}
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {}


def _count_rows(conn, table: str, where_sql: str = "", params: tuple[Any, ...] = ()) -> int:
    row = conn.execute(f"SELECT COUNT(*) AS count FROM {table} {where_sql}", params).fetchone()
    return int(row["count"] if row else 0)


def _counts_by_status(conn, table: str) -> dict[str, int]:
    rows = conn.execute(f"SELECT status, COUNT(*) AS count FROM {table} GROUP BY status ORDER BY status ASC").fetchall()
    return {str(row["status"]): int(row["count"]) for row in rows}


def _latest_bridge_message(conn, binding: dict[str, Any] | None) -> dict[str, Any] | None:
    if not binding:
        return None
    row = conn.execute(
        """
        SELECT id, role, content, openclaw_message_id, metadata_json, created_at
        FROM messages
        WHERE workspace_id = ? AND account_id = ? AND session_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (binding["workspace_id"], binding["account_id"], binding["local_session_id"]),
    ).fetchone()
    if not row:
        return None
    metadata = _json_loads(row["metadata_json"])
    content = str(row["content"] or "")
    return {
        "id": row["id"],
        "role": row["role"],
        "content_preview": content[:160],
        "openclaw_message_id": row["openclaw_message_id"],
        "source": metadata.get("source"),
        "synced_from": metadata.get("synced_from"),
        "external_session_key": metadata.get("external_session_key"),
        "created_at": row["created_at"],
    }


def _latest_session(conn, binding: dict[str, Any] | None) -> dict[str, Any] | None:
    if not binding:
        return None
    row = conn.execute(
        """
        SELECT id, title, title_source, openclaw_session_key, selected_model_path, updated_at
        FROM sessions
        WHERE id = ? AND workspace_id = ? AND account_id = ? AND deleted_at IS NULL
        LIMIT 1
        """,
        (binding["local_session_id"], binding["workspace_id"], binding["account_id"]),
    ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "title": row["title"],
        "title_source": row["title_source"],
        "openclaw_session_key": row["openclaw_session_key"],
        "selected_model_path": row["selected_model_path"],
        "updated_at": row["updated_at"],
    }


def _bridge_binding_payload(binding: dict[str, Any] | None) -> dict[str, Any] | None:
    if not binding:
        return None
    return {
        "id": binding["id"],
        "local_session_id": binding["local_session_id"],
        "provider": binding["provider"],
        "channel": binding["channel"],
        "external_session_key": binding["external_session_key"],
        "external_display_name": binding.get("external_display_name"),
        "is_default": binding["is_default"],
        "status": binding["status"],
        "last_history_sync_at": binding.get("last_history_sync_at"),
        "last_message_at": binding.get("last_message_at"),
        "updated_at": binding["updated_at"],
    }


def _recent_errors(store, user_id: str) -> list[dict[str, Any]]:
    events = store.query_events(trace_id=None, requester_user_id=user_id, is_admin=True, limit=80)
    return [
        event
        for event in events
        if event.get("status") == "error" or event.get("error_code")
    ][:12]


def _bridge_warnings(status: dict[str, Any], recent_errors: list[dict[str, Any]]) -> list[str]:
    warnings: list[str] = []
    if not status.get("enabled"):
        warnings.append("Message bridge is disabled.")
    if status.get("websocket_status") not in {"connected", "subscribed"}:
        warnings.append(f"Message bridge websocket status is {status.get('websocket_status')}.")
    for event in recent_errors:
        stage = str(event.get("stage") or "")
        detail = json.dumps(event.get("payload") or {}, ensure_ascii=False)
        if "message_bridge" in stage and "sessions.list" in stage:
            warnings.append("OpenClaw Feishu session list has recent errors; local bridge status remains readable.")
            break
        if "timed out during opening handshake" in detail:
            warnings.append("OpenClaw gateway websocket handshake timed out recently.")
            break
    return warnings


def _codex_workspaces(settings, store) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for workspace_id in settings.codex_allowed_workspaces:
        path = settings.codex_workspace_paths.get(workspace_id)
        if path is None:
            continue
        items.append({"id": workspace_id, "path": str(path.resolve()), "source": "env"})
        seen.add(workspace_id)
    for workspace in store.list_codex_workspaces():
        workspace_id = str(workspace["id"])
        if workspace_id in seen:
            continue
        items.append(
            {
                "id": workspace_id,
                "path": str(Path(str(workspace["path"])).resolve()),
                "source": str(workspace.get("source") or "ui"),
            }
        )
        seen.add(workspace_id)
    return items


@router.get("/admin/runtime-health")
def runtime_health(request: Request, x_user_id: str | None = Header(default=None)) -> dict[str, Any]:
    user_id = _require_admin(request, x_user_id)
    settings = request.app.state.settings
    store = request.app.state.trace_store
    service = getattr(request.app.state, "message_bridge_service", None)
    provider = getattr(getattr(service, "provider", None), "provider", "openclaw")
    channel = getattr(getattr(service, "provider", None), "channel", settings.openclaw_message_channel or "feishu")
    conn = store._conn

    ctx = store.get_current_workspace_context(user_id)
    bridge_status = store.get_message_bridge_state(provider, channel)
    binding = store.get_default_message_bridge_binding(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        provider=provider,
        channel=channel,
    )
    recent_errors = _recent_errors(store, user_id)
    codex_provider = getattr(request.app.state, "codex_interactive_provider", None)
    codex_provider_health = {}
    if codex_provider is not None and hasattr(codex_provider, "runtime_health"):
        codex_provider_health = codex_provider.runtime_health()
    codex_version = codex_provider_health.get("codex_version") or store.latest_codex_version()
    codex_last_error = codex_provider_health.get("last_error") or store.latest_codex_error()

    return {
        "ok": True,
        "generated_at": datetime.now(UTC).isoformat(),
        "api": {
            "pid": os.getpid(),
            "data_dir": str(settings.data_dir),
            "sqlite_path": str(store.db_path),
            "ndjson_dir": str(store.ndjson_dir),
        },
        "openclaw": {
            "base_url": settings.openclaw_base_url,
            "agent_id": settings.openclaw_agent_id,
            "model": settings.openclaw_model,
            "message_channel": settings.openclaw_message_channel,
            "stream_mode": settings.openclaw_stream_mode,
            "token_configured": bool(settings.openclaw_token),
            "proxy_configured": bool(settings.openclaw_proxy_url),
            "verify_ssl": settings.openclaw_verify_ssl,
            "timeout_seconds": settings.openclaw_timeout_seconds,
        },
        "message_bridge": {
            "provider": provider,
            "channel": channel,
            "status": bridge_status,
            "binding": _bridge_binding_payload(binding),
            "local_session": _latest_session(conn, binding),
            "latest_message": _latest_bridge_message(conn, binding),
            "warnings": _bridge_warnings(bridge_status, recent_errors),
        },
        "tts": {
            "enabled": settings.tts_service_enabled,
            "base_url": settings.tts_service_base_url,
            "timeout_seconds": settings.tts_service_timeout_seconds,
            "poll_interval_seconds": settings.tts_service_poll_interval_seconds,
            "max_poll_attempts": settings.tts_service_max_poll_attempts,
            "message_tts_by_status": _counts_by_status(conn, "message_tts"),
            "jobs_by_status": _counts_by_status(conn, "tts_jobs"),
        },
        "codex": {
            "enabled": settings.codex_interactive_enabled,
            "codex_bin": settings.codex_bin,
            "codex_version": codex_version,
            "transport": settings.codex_transport,
            "active_sessions": store.count_active_codex_sessions(),
            "allowed_workspaces": settings.codex_allowed_workspaces,
            "workspaces": _codex_workspaces(settings, store),
            "last_error": codex_last_error,
        },
        "database": {
            "account_count": _count_rows(conn, "accounts"),
            "workspace_count": _count_rows(conn, "workspaces"),
            "session_count": _count_rows(conn, "sessions", "WHERE deleted_at IS NULL"),
            "message_count": _count_rows(conn, "messages", "WHERE deleted_at IS NULL"),
            "bridge_message_count": _count_rows(conn, "messages", "WHERE metadata_json LIKE ?", ("%message_bridge%",)),
            "trace_event_count": _count_rows(conn, "trace_events"),
        },
        "recent_errors": recent_errors,
    }
