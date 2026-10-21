from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


def _parse_admin_ids(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def _parse_csv(raw: object) -> list[str]:
    return [item.strip() for item in str(raw or "").split(",") if item.strip()]


def _parse_bool(raw: object, *, default: bool) -> bool:
    if raw is None:
        return default
    text = str(raw).strip().lower()
    if not text:
        return default
    return text in {"1", "true", "yes", "on"}


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        item = line.strip()
        if not item or item.startswith("#") or "=" not in item:
            continue
        key, raw_value = item.split("=", 1)
        values[key.strip()] = raw_value.strip().strip('"').strip("'")
    return values


def _resolve_setting_path(raw: str | Path, *, base_dir: Path) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = base_dir / path
    return path.resolve()


def _workspace_env_suffix(workspace_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", workspace_id).strip("_").upper()


@dataclass(slots=True)
class Settings:
    data_dir: Path
    openclaw_base_url: str
    openclaw_token: str
    openclaw_agent_id: str
    openclaw_model: str
    openclaw_message_channel: str
    openclaw_proxy_url: str
    openclaw_verify_ssl: bool
    openclaw_timeout_seconds: int
    openclaw_greeting_index_path: Path | None
    admin_user_ids: list[str]
    retention_days: int
    ndjson_compress_after_days: int
    mmd_root_dir: Path
    tts_service_enabled: bool
    tts_service_base_url: str
    tts_service_timeout_seconds: int
    tts_service_poll_interval_seconds: float
    tts_service_max_poll_attempts: int
    tts_sync_wait_seconds: float
    tts_job_worker_interval_seconds: float
    tts_job_lock_timeout_seconds: int
    message_service_tts_retention_days: int
    realtime_voice_enabled: bool
    realtime_voice_max_queue_size: int
    realtime_voice_chunk_timeout_seconds: int
    realtime_voice_circuit_failure_threshold: int
    realtime_voice_circuit_window_seconds: int
    realtime_voice_circuit_open_seconds: int
    realtime_voice_max_queue_wait_seconds: int
    openclaw_stream_mode: str
    codex_interactive_enabled: bool
    codex_bin: str
    codex_home: Path
    codex_transport: str
    codex_allowed_users: list[str]
    codex_allowed_workspaces: list[str]
    codex_workspace_paths: dict[str, Path]
    codex_default_sandbox: str
    codex_patch_sandbox: str
    codex_allow_danger_full_access: bool
    codex_allow_yolo: bool
    codex_use_worktree: bool
    codex_worktree_root: Path
    codex_branch_prefix: str
    codex_max_concurrent_sessions: int
    codex_session_idle_timeout_seconds: int
    codex_turn_timeout_seconds: int
    codex_process_start_timeout_seconds: int
    codex_wsl_enabled: bool
    codex_wsl_exec: str
    codex_max_prompt_chars: int
    codex_require_git_repo: bool
    codex_require_git_clean_for_apply: bool
    codex_require_human_approval: bool
    codex_trace_redact_secrets: bool
    codex_openclaw_review_enabled: bool
    codex_openclaw_review_agent_id: str
    codex_openclaw_review_channel: str
    codex_openclaw_review_sync_interval_seconds: float
    codex_openclaw_review_max_payload_chars: int
    codex_openclaw_review_dump_debug_files: bool
    codex_knowledge_extraction_enabled: bool
    codex_knowledge_agent_id: str
    codex_knowledge_channel: str
    codex_knowledge_sync_interval_seconds: float
    codex_knowledge_max_payload_chars: int
    codex_knowledge_min_signal_score: int
    codex_knowledge_timeout_seconds: int
    codex_knowledge_prompt_version: str
    codex_knowledge_skill_path: Path
    codex_knowledge_dump_debug_files: bool
    codex_openclaw_control_plane_enabled: bool
    codex_openclaw_control_plane_base_url: str
    codex_openclaw_control_plane_token: str
    codex_openclaw_control_plane_workspace_id: str
    codex_openclaw_control_plane_sync_interval_seconds: float
    codex_openclaw_control_plane_snapshot_limit: int
    codex_author_knowledge_handoff_enabled: bool
    codex_author_knowledge_openclaw_delivery_enabled: bool
    codex_author_knowledge_handoff_token: str
    codex_author_knowledge_openclaw_token: str
    codex_author_knowledge_whitelist_file: str
    codex_author_knowledge_reconciliation_interval_seconds: float
    codex_author_knowledge_durable_refs: dict[str, str]
    domain_knowledge_control_plane_enabled: bool
    codex_review_memory_enabled: bool
    codex_review_memory_export_root: Path
    codex_review_memory_target: str
    openkb_sync_enabled: bool
    openkb_base_url: str
    openkb_token: str

    @classmethod
    def from_env(cls, overrides: dict | None = None) -> "Settings":
        overrides = overrides or {}
        project_root = Path(__file__).resolve().parents[2]
        env_file = _read_env_file(project_root / "api" / ".env")

        def resolve_value(override_key: str, env_key: str, default: object = "") -> object:
            if override_key in overrides and overrides[override_key] is not None:
                return overrides[override_key]
            if env_key in os.environ and os.environ[env_key] != "":
                return os.environ[env_key]
            if env_key in env_file and env_file[env_key] != "":
                return env_file[env_key]
            return default

        root = _resolve_setting_path(
            resolve_value("data_dir", "API_DATA_DIR", "api/data"),
            base_dir=project_root,
        )
        mmd_root = _resolve_setting_path(
            resolve_value("mmd_root_dir", "MMD_ROOT_DIR", "MMD"),
            base_dir=project_root,
        )

        raw_greeting_index_path = str(
            resolve_value("openclaw_greeting_index_path", "OPENCLAW_GREETING_DASHBOARD_INDEX_PATH", "")
        ).strip()
        greeting_index_path = (
            _resolve_setting_path(raw_greeting_index_path, base_dir=project_root)
            if raw_greeting_index_path
            else root / "openclaw" / "greeting-dashboard-injections.jsonl"
        )

        ids = overrides.get("admin_user_ids")
        if ids is None:
            ids = _parse_admin_ids(str(resolve_value("admin_user_ids", "ADMIN_USER_IDS", "")))

        codex_allowed_users = overrides.get("codex_allowed_users")
        if codex_allowed_users is None:
            codex_allowed_users = _parse_csv(resolve_value("codex_allowed_users", "CODEX_ALLOWED_USERS", ""))

        codex_allowed_workspaces = overrides.get("codex_allowed_workspaces")
        if codex_allowed_workspaces is None:
            codex_allowed_workspaces = _parse_csv(
                resolve_value("codex_allowed_workspaces", "CODEX_ALLOWED_WORKSPACES", "")
            )

        raw_codex_workspace_paths = overrides.get("codex_workspace_paths") or {}
        codex_workspace_paths: dict[str, Path] = {}
        for workspace_id in codex_allowed_workspaces:
            raw_path = raw_codex_workspace_paths.get(workspace_id) if isinstance(raw_codex_workspace_paths, dict) else None
            if raw_path is None:
                env_key = f"CODEX_WORKSPACE_{_workspace_env_suffix(workspace_id)}"
                raw_path = resolve_value(f"codex_workspace_{workspace_id}", env_key, "")
            if str(raw_path or "").strip():
                codex_workspace_paths[workspace_id] = _resolve_setting_path(str(raw_path), base_dir=project_root)

        openclaw_token = str(resolve_value("openclaw_token", "OPENCLAW_TOKEN", ""))
        control_plane_token = str(
            resolve_value("codex_openclaw_control_plane_token", "OPENCLAW_CONTROL_PLANE_TOKEN", "")
        ).strip() or openclaw_token

        return cls(
            data_dir=root,
            openclaw_base_url=str(resolve_value("openclaw_base_url", "OPENCLAW_BASE_URL", "http://127.0.0.1:18789")).rstrip("/"),
            openclaw_token=openclaw_token,
            openclaw_agent_id=str(resolve_value("openclaw_agent_id", "OPENCLAW_AGENT_ID", "main")).strip(),
            openclaw_model=str(resolve_value("openclaw_model", "OPENCLAW_MODEL", "")).strip(),
            openclaw_message_channel=str(resolve_value("openclaw_message_channel", "OPENCLAW_MESSAGE_CHANNEL", "feishu")).strip(),
            openclaw_proxy_url=str(resolve_value("openclaw_proxy_url", "OPENCLAW_PROXY_URL", "")).strip(),
            openclaw_verify_ssl=_parse_bool(
                resolve_value("openclaw_verify_ssl", "OPENCLAW_VERIFY_SSL", True),
                default=True,
            ),
            openclaw_timeout_seconds=int(resolve_value("openclaw_timeout_seconds", "OPENCLAW_TIMEOUT_SECONDS", 120)),
            openclaw_greeting_index_path=greeting_index_path,
            admin_user_ids=list(ids),
            retention_days=int(resolve_value("retention_days", "RETENTION_DAYS", 30)),
            ndjson_compress_after_days=int(
                resolve_value("ndjson_compress_after_days", "NDJSON_COMPRESS_AFTER_DAYS", 7)
            ),
            mmd_root_dir=mmd_root,
            tts_service_enabled=_parse_bool(
                resolve_value("tts_service_enabled", "TTS_SERVICE_ENABLED", False),
                default=False,
            ),
            tts_service_base_url=str(
                resolve_value("tts_service_base_url", "TTS_SERVICE_BASE_URL", "http://10.11.252.164:5555")
            ).rstrip("/"),
            tts_service_timeout_seconds=int(resolve_value("tts_service_timeout_seconds", "TTS_SERVICE_TIMEOUT_SECONDS", 30)),
            tts_service_poll_interval_seconds=float(
                resolve_value("tts_service_poll_interval_seconds", "TTS_SERVICE_POLL_INTERVAL_SECONDS", 3)
            ),
            tts_service_max_poll_attempts=int(
                resolve_value("tts_service_max_poll_attempts", "TTS_SERVICE_MAX_POLL_ATTEMPTS", 40)
            ),
            tts_sync_wait_seconds=float(resolve_value("tts_sync_wait_seconds", "TTS_SYNC_WAIT_SECONDS", 8)),
            tts_job_worker_interval_seconds=float(
                resolve_value("tts_job_worker_interval_seconds", "TTS_JOB_WORKER_INTERVAL_SECONDS", 2)
            ),
            tts_job_lock_timeout_seconds=int(
                resolve_value("tts_job_lock_timeout_seconds", "TTS_JOB_LOCK_TIMEOUT_SECONDS", 30)
            ),
            message_service_tts_retention_days=int(
                resolve_value("message_service_tts_retention_days", "MESSAGE_SERVICE_TTS_RETENTION_DAYS", 14)
            ),
            realtime_voice_enabled=_parse_bool(
                resolve_value("realtime_voice_enabled", "REALTIME_VOICE_ENABLED", False),
                default=False,
            ),
            realtime_voice_max_queue_size=int(
                resolve_value("realtime_voice_max_queue_size", "REALTIME_VOICE_MAX_QUEUE_SIZE", 3)
            ),
            realtime_voice_chunk_timeout_seconds=int(
                resolve_value("realtime_voice_chunk_timeout_seconds", "REALTIME_VOICE_CHUNK_TIMEOUT_SECONDS", 30)
            ),
            realtime_voice_circuit_failure_threshold=int(
                resolve_value(
                    "realtime_voice_circuit_failure_threshold",
                    "REALTIME_VOICE_CIRCUIT_FAILURE_THRESHOLD",
                    5,
                )
            ),
            realtime_voice_circuit_window_seconds=int(
                resolve_value("realtime_voice_circuit_window_seconds", "REALTIME_VOICE_CIRCUIT_WINDOW_SECONDS", 60)
            ),
            realtime_voice_circuit_open_seconds=int(
                resolve_value("realtime_voice_circuit_open_seconds", "REALTIME_VOICE_CIRCUIT_OPEN_SECONDS", 120)
            ),
            realtime_voice_max_queue_wait_seconds=int(
                resolve_value("realtime_voice_max_queue_wait_seconds", "REALTIME_VOICE_MAX_QUEUE_WAIT_SECONDS", 120)
            ),
            openclaw_stream_mode=str(resolve_value("openclaw_stream_mode", "OPENCLAW_STREAM_MODE", "http_sse")).strip()
            or "http_sse",
            codex_interactive_enabled=_parse_bool(
                resolve_value("codex_interactive_enabled", "CODEX_INTERACTIVE_ENABLED", False),
                default=False,
            ),
            codex_bin=str(resolve_value("codex_bin", "CODEX_BIN", "codex")).strip() or "codex",
            codex_home=_resolve_setting_path(
                resolve_value("codex_home", "CODEX_HOME", root / "codex-home"),
                base_dir=project_root,
            ),
            codex_transport=str(resolve_value("codex_transport", "CODEX_TRANSPORT", "stdio")).strip() or "stdio",
            codex_allowed_users=list(codex_allowed_users),
            codex_allowed_workspaces=list(codex_allowed_workspaces),
            codex_workspace_paths=codex_workspace_paths,
            codex_default_sandbox=str(
                resolve_value("codex_default_sandbox", "CODEX_DEFAULT_SANDBOX", "read-only")
            ).strip()
            or "read-only",
            codex_patch_sandbox=str(
                resolve_value("codex_patch_sandbox", "CODEX_PATCH_SANDBOX", "workspace-write")
            ).strip()
            or "workspace-write",
            codex_allow_danger_full_access=_parse_bool(
                resolve_value("codex_allow_danger_full_access", "CODEX_ALLOW_DANGER_FULL_ACCESS", False),
                default=False,
            ),
            codex_allow_yolo=_parse_bool(
                resolve_value("codex_allow_yolo", "CODEX_ALLOW_YOLO", False),
                default=False,
            ),
            codex_use_worktree=_parse_bool(
                resolve_value("codex_use_worktree", "CODEX_USE_WORKTREE", True),
                default=True,
            ),
            codex_worktree_root=_resolve_setting_path(
                resolve_value("codex_worktree_root", "CODEX_WORKTREE_ROOT", root / "codex-worktrees"),
                base_dir=project_root,
            ),
            codex_branch_prefix=str(resolve_value("codex_branch_prefix", "CODEX_BRANCH_PREFIX", "codex/")).strip()
            or "codex/",
            codex_max_concurrent_sessions=int(
                resolve_value("codex_max_concurrent_sessions", "CODEX_MAX_CONCURRENT_SESSIONS", 1)
            ),
            codex_session_idle_timeout_seconds=int(
                resolve_value("codex_session_idle_timeout_seconds", "CODEX_SESSION_IDLE_TIMEOUT_SECONDS", 1800)
            ),
            codex_turn_timeout_seconds=int(
                resolve_value("codex_turn_timeout_seconds", "CODEX_TURN_TIMEOUT_SECONDS", 900)
            ),
            codex_process_start_timeout_seconds=int(
                resolve_value("codex_process_start_timeout_seconds", "CODEX_PROCESS_START_TIMEOUT_SECONDS", 30)
            ),
            codex_wsl_enabled=_parse_bool(
                resolve_value("codex_wsl_enabled", "CODEX_WSL_ENABLED", False),
                default=False,
            ),
            codex_wsl_exec=str(
                resolve_value("codex_wsl_exec", "CODEX_WSL_EXEC", "wsl.exe")
            ).strip() or "wsl.exe",
            codex_max_prompt_chars=int(resolve_value("codex_max_prompt_chars", "CODEX_MAX_PROMPT_CHARS", 12000)),
            codex_require_git_repo=_parse_bool(
                resolve_value("codex_require_git_repo", "CODEX_REQUIRE_GIT_REPO", True),
                default=True,
            ),
            codex_require_git_clean_for_apply=_parse_bool(
                resolve_value("codex_require_git_clean_for_apply", "CODEX_REQUIRE_GIT_CLEAN_FOR_APPLY", True),
                default=True,
            ),
            codex_require_human_approval=_parse_bool(
                resolve_value("codex_require_human_approval", "CODEX_REQUIRE_HUMAN_APPROVAL", True),
                default=True,
            ),
            codex_trace_redact_secrets=_parse_bool(
                resolve_value("codex_trace_redact_secrets", "CODEX_TRACE_REDACT_SECRETS", True),
                default=True,
            ),
            codex_openclaw_review_enabled=_parse_bool(
                resolve_value("codex_openclaw_review_enabled", "CODEX_OPENCLAW_REVIEW_ENABLED", False),
                default=False,
            ),
            codex_openclaw_review_agent_id=str(
                resolve_value("codex_openclaw_review_agent_id", "CODEX_OPENCLAW_REVIEW_AGENT_ID", "codex-manager")
            ).strip()
            or "codex-manager",
            codex_openclaw_review_channel=str(
                resolve_value("codex_openclaw_review_channel", "CODEX_OPENCLAW_REVIEW_CHANNEL", "codex-pet")
            ).strip()
            or "codex-pet",
            codex_openclaw_review_sync_interval_seconds=float(
                resolve_value(
                    "codex_openclaw_review_sync_interval_seconds",
                    "CODEX_OPENCLAW_REVIEW_SYNC_INTERVAL_SECONDS",
                    10,
                )
            ),
            codex_openclaw_review_max_payload_chars=int(
                resolve_value("codex_openclaw_review_max_payload_chars", "CODEX_OPENCLAW_REVIEW_MAX_PAYLOAD_CHARS", 8000)
            ),
            codex_openclaw_review_dump_debug_files=_parse_bool(
                resolve_value("codex_openclaw_review_dump_debug_files", "CODEX_OPENCLAW_REVIEW_DUMP_DEBUG_FILES", False),
                default=False,
            ),
            codex_knowledge_extraction_enabled=_parse_bool(
                resolve_value("codex_knowledge_extraction_enabled", "CODEX_KNOWLEDGE_EXTRACTION_ENABLED", False),
                default=False,
            ),
            codex_knowledge_agent_id=str(
                resolve_value("codex_knowledge_agent_id", "CODEX_KNOWLEDGE_AGENT_ID", "codex-manager")
            ).strip()
            or "codex-manager",
            codex_knowledge_channel=str(
                resolve_value("codex_knowledge_channel", "CODEX_KNOWLEDGE_CHANNEL", "codex-pet")
            ).strip()
            or "codex-pet",
            codex_knowledge_sync_interval_seconds=float(
                resolve_value("codex_knowledge_sync_interval_seconds", "CODEX_KNOWLEDGE_SYNC_INTERVAL_SECONDS", 10)
            ),
            codex_knowledge_max_payload_chars=int(
                resolve_value("codex_knowledge_max_payload_chars", "CODEX_KNOWLEDGE_MAX_PAYLOAD_CHARS", 12000)
            ),
            codex_knowledge_min_signal_score=int(
                resolve_value("codex_knowledge_min_signal_score", "CODEX_KNOWLEDGE_MIN_SIGNAL_SCORE", 5)
            ),
            codex_knowledge_timeout_seconds=int(
                resolve_value("codex_knowledge_timeout_seconds", "CODEX_KNOWLEDGE_TIMEOUT_SECONDS", 300)
            ),
            codex_knowledge_prompt_version=str(
                resolve_value(
                    "codex_knowledge_prompt_version",
                    "CODEX_KNOWLEDGE_PROMPT_VERSION",
                    "codex-domain-knowledge-v3",
                )
            ).strip()
            or "codex-domain-knowledge-v3",
            codex_knowledge_skill_path=_resolve_setting_path(
                resolve_value(
                    "codex_knowledge_skill_path",
                    "CODEX_KNOWLEDGE_SKILL_PATH",
                    "openclaw/skills/codex-session-knowledge-extraction/SKILL.md",
                ),
                base_dir=project_root,
            ),
            codex_knowledge_dump_debug_files=_parse_bool(
                resolve_value("codex_knowledge_dump_debug_files", "CODEX_KNOWLEDGE_DUMP_DEBUG_FILES", False),
                default=False,
            ),
            codex_openclaw_control_plane_enabled=_parse_bool(
                resolve_value(
                    "codex_openclaw_control_plane_enabled",
                    "CODEX_OPENCLAW_CONTROL_PLANE_ENABLED",
                    False,
                ),
                default=False,
            ),
            codex_openclaw_control_plane_base_url=str(
                resolve_value(
                    "codex_openclaw_control_plane_base_url",
                    "OPENCLAW_CONTROL_PLANE_BASE_URL",
                    "",
                )
            ).rstrip("/"),
            codex_openclaw_control_plane_token=control_plane_token,
            codex_openclaw_control_plane_workspace_id=str(
                resolve_value(
                    "codex_openclaw_control_plane_workspace_id",
                    "CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID",
                    "mmd-companion",
                )
            ).strip()
            or "mmd-companion",
            codex_openclaw_control_plane_sync_interval_seconds=float(
                resolve_value(
                    "codex_openclaw_control_plane_sync_interval_seconds",
                    "CODEX_OPENCLAW_CONTROL_PLANE_SYNC_INTERVAL_SECONDS",
                    60,
                )
            ),
            codex_openclaw_control_plane_snapshot_limit=int(
                resolve_value(
                    "codex_openclaw_control_plane_snapshot_limit",
                    "CODEX_OPENCLAW_CONTROL_PLANE_SNAPSHOT_LIMIT",
                    20,
                )
            ),
            domain_knowledge_control_plane_enabled=_parse_bool(
                resolve_value(
                    "domain_knowledge_control_plane_enabled",
                    "DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED",
                    False,
                ),
                default=False,
            ),
            codex_author_knowledge_handoff_enabled=_parse_bool(
                resolve_value(
                    "codex_author_knowledge_handoff_enabled",
                    "CODEX_AUTHOR_KNOWLEDGE_HANDOFF_ENABLED",
                    False,
                ),
                default=False,
            ),
            codex_author_knowledge_openclaw_delivery_enabled=_parse_bool(
                resolve_value(
                    "codex_author_knowledge_openclaw_delivery_enabled",
                    "CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_DELIVERY_ENABLED",
                    False,
                ),
                default=False,
            ),
            codex_author_knowledge_handoff_token=str(
                resolve_value(
                    "codex_author_knowledge_handoff_token",
                    "CODEX_AUTHOR_KNOWLEDGE_HANDOFF_TOKEN",
                    "",
                )
            ).strip(),
            codex_author_knowledge_openclaw_token=str(
                resolve_value(
                    "codex_author_knowledge_openclaw_token",
                    "CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_TOKEN",
                    "",
                )
            ).strip(),
            codex_author_knowledge_whitelist_file=str(
                resolve_value(
                    "codex_author_knowledge_whitelist_file",
                    "CODEX_AUTHOR_KNOWLEDGE_WHITELIST_FILE",
                    "knowledge_handoff/openclaw_whitelist.json",
                )
            ).strip(),
            codex_author_knowledge_reconciliation_interval_seconds=float(
                resolve_value(
                    "codex_author_knowledge_reconciliation_interval_seconds",
                    "CODEX_AUTHOR_KNOWLEDGE_RECONCILIATION_INTERVAL_SECONDS",
                    60,
                )
            ),
            codex_author_knowledge_durable_refs={
                workspace_id: str(
                    (
                        (overrides.get("codex_author_knowledge_durable_refs") or {}).get(workspace_id)
                        if isinstance(overrides.get("codex_author_knowledge_durable_refs") or {}, dict)
                        else None
                    )
                    or resolve_value(
                        f"codex_author_knowledge_durable_ref_{workspace_id}",
                        f"CODEX_AUTHOR_KNOWLEDGE_DURABLE_REF_{_workspace_env_suffix(workspace_id)}",
                        "",
                    )
                ).strip()
                for workspace_id in codex_allowed_workspaces
                if str(
                    (
                        (overrides.get("codex_author_knowledge_durable_refs") or {}).get(workspace_id)
                        if isinstance(overrides.get("codex_author_knowledge_durable_refs") or {}, dict)
                        else None
                    )
                    or resolve_value(
                        f"codex_author_knowledge_durable_ref_{workspace_id}",
                        f"CODEX_AUTHOR_KNOWLEDGE_DURABLE_REF_{_workspace_env_suffix(workspace_id)}",
                        "",
                    )
                ).strip()
            },
            codex_review_memory_enabled=_parse_bool(
                resolve_value("codex_review_memory_enabled", "CODEX_REVIEW_MEMORY_ENABLED", False),
                default=False,
            ),
            codex_review_memory_export_root=_resolve_setting_path(
                resolve_value(
                    "codex_review_memory_export_root",
                    "CODEX_REVIEW_MEMORY_EXPORT_ROOT",
                    "api/data/openkb/codex-review",
                ),
                base_dir=project_root,
            ),
            codex_review_memory_target=str(
                resolve_value("codex_review_memory_target", "CODEX_REVIEW_MEMORY_TARGET", "openclaw_wiki")
            ).strip()
            or "openclaw_wiki",
            openkb_sync_enabled=_parse_bool(
                resolve_value("openkb_sync_enabled", "OPENKB_SYNC_ENABLED", False),
                default=False,
            ),
            openkb_base_url=str(resolve_value("openkb_base_url", "OPENKB_BASE_URL", "")).rstrip("/"),
            openkb_token=str(resolve_value("openkb_token", "OPENKB_TOKEN", "")),
        )
