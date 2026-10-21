from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import Settings, _parse_bool, _read_env_file
from app.security import resolve_requester
from app.services.openclaw_client import OpenClawClient


router = APIRouter(prefix="/config", tags=["config"])

OPENCLAW_ENV_KEYS = [
    "OPENCLAW_BASE_URL",
    "OPENCLAW_TOKEN",
    "OPENCLAW_AGENT_ID",
    "OPENCLAW_MODEL",
    "OPENCLAW_MESSAGE_CHANNEL",
    "OPENCLAW_PROXY_URL",
    "OPENCLAW_VERIFY_SSL",
    "OPENCLAW_TIMEOUT_SECONDS",
]


class OpenClawConfigPayload(BaseModel):
    base_url: str = Field(min_length=1)
    token: str | None = None
    agent_id: str = Field(default="main")
    model: str = Field(default="")
    message_channel: str = Field(default="feishu")
    proxy_url: str = Field(default="")
    verify_ssl: bool = True
    timeout_seconds: int = Field(default=120, ge=1, le=300)


def _openclaw_env_path() -> Path:
    return Path(__file__).resolve().parents[2] / ".env"


def _load_saved_openclaw_config() -> dict[str, Any]:
    env = _read_env_file(_openclaw_env_path())
    return {
        "base_url": str(env.get("OPENCLAW_BASE_URL", "http://127.0.0.1:18789")).rstrip("/"),
        "token_configured": bool(str(env.get("OPENCLAW_TOKEN", "")).strip()),
        "agent_id": str(env.get("OPENCLAW_AGENT_ID", "main")).strip() or "main",
        "model": str(env.get("OPENCLAW_MODEL", "")).strip(),
        "message_channel": str(env.get("OPENCLAW_MESSAGE_CHANNEL", "feishu")).strip() or "feishu",
        "proxy_url": str(env.get("OPENCLAW_PROXY_URL", "")).strip(),
        "verify_ssl": _parse_bool(env.get("OPENCLAW_VERIFY_SSL", True), default=True),
        "timeout_seconds": int(env.get("OPENCLAW_TIMEOUT_SECONDS", 120) or 120),
    }


def _save_openclaw_env(payload: OpenClawConfigPayload) -> dict[str, Any]:
    env_path = _openclaw_env_path()
    env_path.parent.mkdir(parents=True, exist_ok=True)
    previous_values = _read_env_file(env_path)

    next_values = {
        **previous_values,
        "OPENCLAW_BASE_URL": payload.base_url.rstrip("/"),
        "OPENCLAW_AGENT_ID": payload.agent_id.strip() or "main",
        "OPENCLAW_MODEL": payload.model.strip(),
        "OPENCLAW_MESSAGE_CHANNEL": payload.message_channel.strip() or "feishu",
        "OPENCLAW_PROXY_URL": payload.proxy_url.strip(),
        "OPENCLAW_VERIFY_SSL": "true" if payload.verify_ssl else "false",
        "OPENCLAW_TIMEOUT_SECONDS": str(payload.timeout_seconds),
    }
    if payload.token is not None:
        next_values["OPENCLAW_TOKEN"] = payload.token.strip()

    existing_lines = env_path.read_text(encoding="utf-8-sig").splitlines() if env_path.exists() else []
    updated_lines: list[str] = []
    seen_keys: set[str] = set()
    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            updated_lines.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in next_values:
            updated_lines.append(f"{key}={next_values[key]}")
            seen_keys.add(key)
            continue
        updated_lines.append(line)

    for key in OPENCLAW_ENV_KEYS:
        if key in seen_keys:
            continue
        if key not in next_values:
            continue
        updated_lines.append(f"{key}={next_values[key]}")

    env_path.write_text("\n".join(updated_lines).rstrip() + "\n", encoding="utf-8")
    return _load_saved_openclaw_config()


def _build_settings_with_openclaw_config(current: Settings, saved: dict[str, Any]) -> Settings:
    return Settings(
        data_dir=current.data_dir,
        openclaw_base_url=str(saved["base_url"]),
        openclaw_token=current.openclaw_token,
        openclaw_agent_id=str(saved["agent_id"]),
        openclaw_model=str(saved["model"]),
        openclaw_message_channel=str(saved["message_channel"]),
        openclaw_proxy_url=str(saved["proxy_url"]),
        openclaw_verify_ssl=bool(saved["verify_ssl"]),
        openclaw_timeout_seconds=int(saved["timeout_seconds"]),
        openclaw_greeting_index_path=current.openclaw_greeting_index_path,
        admin_user_ids=list(current.admin_user_ids),
        retention_days=current.retention_days,
        ndjson_compress_after_days=current.ndjson_compress_after_days,
        mmd_root_dir=current.mmd_root_dir,
        tts_service_enabled=current.tts_service_enabled,
        tts_service_base_url=current.tts_service_base_url,
        tts_service_timeout_seconds=current.tts_service_timeout_seconds,
        tts_service_poll_interval_seconds=current.tts_service_poll_interval_seconds,
        tts_service_max_poll_attempts=current.tts_service_max_poll_attempts,
        tts_sync_wait_seconds=current.tts_sync_wait_seconds,
        tts_job_worker_interval_seconds=current.tts_job_worker_interval_seconds,
        tts_job_lock_timeout_seconds=current.tts_job_lock_timeout_seconds,
        message_service_tts_retention_days=current.message_service_tts_retention_days,
        realtime_voice_enabled=current.realtime_voice_enabled,
        realtime_voice_max_queue_size=current.realtime_voice_max_queue_size,
        realtime_voice_chunk_timeout_seconds=current.realtime_voice_chunk_timeout_seconds,
        realtime_voice_circuit_failure_threshold=current.realtime_voice_circuit_failure_threshold,
        realtime_voice_circuit_window_seconds=current.realtime_voice_circuit_window_seconds,
        realtime_voice_circuit_open_seconds=current.realtime_voice_circuit_open_seconds,
        realtime_voice_max_queue_wait_seconds=current.realtime_voice_max_queue_wait_seconds,
        openclaw_stream_mode=current.openclaw_stream_mode,
        codex_interactive_enabled=current.codex_interactive_enabled,
        codex_bin=current.codex_bin,
        codex_home=current.codex_home,
        codex_transport=current.codex_transport,
        codex_allowed_users=list(current.codex_allowed_users),
        codex_allowed_workspaces=list(current.codex_allowed_workspaces),
        codex_workspace_paths=dict(current.codex_workspace_paths),
        codex_default_sandbox=current.codex_default_sandbox,
        codex_patch_sandbox=current.codex_patch_sandbox,
        codex_allow_danger_full_access=current.codex_allow_danger_full_access,
        codex_allow_yolo=current.codex_allow_yolo,
        codex_use_worktree=current.codex_use_worktree,
        codex_worktree_root=current.codex_worktree_root,
        codex_branch_prefix=current.codex_branch_prefix,
        codex_max_concurrent_sessions=current.codex_max_concurrent_sessions,
        codex_session_idle_timeout_seconds=current.codex_session_idle_timeout_seconds,
        codex_turn_timeout_seconds=current.codex_turn_timeout_seconds,
        codex_process_start_timeout_seconds=current.codex_process_start_timeout_seconds,
        codex_wsl_enabled=current.codex_wsl_enabled,
        codex_wsl_exec=current.codex_wsl_exec,
        codex_max_prompt_chars=current.codex_max_prompt_chars,
        codex_require_git_repo=current.codex_require_git_repo,
        codex_require_git_clean_for_apply=current.codex_require_git_clean_for_apply,
        codex_require_human_approval=current.codex_require_human_approval,
        codex_trace_redact_secrets=current.codex_trace_redact_secrets,
        codex_openclaw_review_enabled=current.codex_openclaw_review_enabled,
        codex_openclaw_review_agent_id=current.codex_openclaw_review_agent_id,
        codex_openclaw_review_channel=current.codex_openclaw_review_channel,
        codex_openclaw_review_sync_interval_seconds=current.codex_openclaw_review_sync_interval_seconds,
        codex_openclaw_review_max_payload_chars=current.codex_openclaw_review_max_payload_chars,
        codex_openclaw_review_dump_debug_files=current.codex_openclaw_review_dump_debug_files,
        codex_knowledge_extraction_enabled=current.codex_knowledge_extraction_enabled,
        codex_knowledge_agent_id=current.codex_knowledge_agent_id,
        codex_knowledge_channel=current.codex_knowledge_channel,
        codex_knowledge_sync_interval_seconds=current.codex_knowledge_sync_interval_seconds,
        codex_knowledge_max_payload_chars=current.codex_knowledge_max_payload_chars,
        codex_knowledge_min_signal_score=current.codex_knowledge_min_signal_score,
        codex_knowledge_timeout_seconds=current.codex_knowledge_timeout_seconds,
        codex_knowledge_prompt_version=current.codex_knowledge_prompt_version,
        codex_knowledge_skill_path=current.codex_knowledge_skill_path,
        codex_knowledge_dump_debug_files=current.codex_knowledge_dump_debug_files,
        codex_openclaw_control_plane_enabled=current.codex_openclaw_control_plane_enabled,
        codex_openclaw_control_plane_base_url=current.codex_openclaw_control_plane_base_url,
        codex_openclaw_control_plane_token=current.codex_openclaw_control_plane_token,
        codex_openclaw_control_plane_workspace_id=current.codex_openclaw_control_plane_workspace_id,
        codex_openclaw_control_plane_sync_interval_seconds=current.codex_openclaw_control_plane_sync_interval_seconds,
        codex_openclaw_control_plane_snapshot_limit=current.codex_openclaw_control_plane_snapshot_limit,
        codex_review_memory_enabled=current.codex_review_memory_enabled,
        codex_review_memory_export_root=current.codex_review_memory_export_root,
        codex_review_memory_target=current.codex_review_memory_target,
        openkb_sync_enabled=current.openkb_sync_enabled,
        openkb_base_url=current.openkb_base_url,
        openkb_token=current.openkb_token,
    )


async def _reload_openclaw_runtime(request: Request, payload: OpenClawConfigPayload, saved: dict[str, Any]) -> None:
    current_settings: Settings = request.app.state.settings
    next_token = current_settings.openclaw_token
    if payload.token is not None:
        next_token = payload.token.strip()
    else:
        next_token = str(_read_env_file(_openclaw_env_path()).get("OPENCLAW_TOKEN", next_token)).strip()

    next_settings = _build_settings_with_openclaw_config(current_settings, saved)
    next_settings.openclaw_token = next_token

    next_client = OpenClawClient(
        base_url=next_settings.openclaw_base_url,
        token=next_settings.openclaw_token,
        model=next_settings.openclaw_model,
        agent_id=next_settings.openclaw_agent_id,
        message_channel=next_settings.openclaw_message_channel,
        proxy_url=next_settings.openclaw_proxy_url,
        verify_ssl=next_settings.openclaw_verify_ssl,
        timeout_seconds=next_settings.openclaw_timeout_seconds,
    )

    previous_client = request.app.state.openclaw_client
    request.app.state.settings = next_settings
    request.app.state.openclaw_client = next_client
    await previous_client.close()


class MappingPayload(BaseModel):
    mappings: dict[str, dict[str, Any]] = Field(default_factory=dict)


@router.get("/openclaw")
def get_openclaw_config(request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can read OpenClaw settings.")
    return _load_saved_openclaw_config()


@router.put("/openclaw")
async def put_openclaw_config(
    payload: OpenClawConfigPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can modify OpenClaw settings.")
    saved = _save_openclaw_env(payload)
    await _reload_openclaw_runtime(request, payload, saved)
    return {
        **saved,
        "restart_required": False,
        "message": "Saved to api/.env and reloaded in the running API.",
    }


@router.get("/mapping/default")
def get_default_mappings(request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    resolve_requester(x_user_id, settings.admin_user_ids)
    store = request.app.state.trace_store
    return {"mappings": store.get_default_mappings()}


@router.put("/mapping/default")
def put_default_mappings(
    payload: MappingPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can modify default mappings.")
    store = request.app.state.trace_store
    store.set_default_mappings(payload.mappings)
    return {"mappings": store.get_default_mappings()}


@router.get("/mapping/user/{user_id}")
def get_user_mappings(user_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin and requester.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot read mappings for another user.")
    store = request.app.state.trace_store
    return {"mappings": store.get_user_mappings(user_id)}


@router.put("/mapping/user/{user_id}")
def put_user_mappings(
    user_id: str,
    payload: MappingPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin and requester.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot modify mappings for another user.")
    store = request.app.state.trace_store
    store.set_user_mappings(user_id, payload.mappings)
    return {"mappings": store.get_user_mappings(user_id)}


@router.get("/mapping/resolved/{user_id}")
def get_resolved_mappings(user_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin and requester.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot read resolved mappings for another user.")
    store = request.app.state.trace_store
    merged = store.get_default_mappings()
    merged.update(store.get_user_mappings(user_id))
    return {"mappings": merged}
