from __future__ import annotations

from datetime import UTC, datetime, timedelta
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any
from uuid import uuid4


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _ensure_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return _ensure_utc(parsed)


def _normalize_message_content(value: str | None) -> str:
    return " ".join(str(value or "").split())


def _normalize_message_visibility(value: str | None) -> str:
    return "internal" if str(value or "").strip().lower() == "internal" else "chat"


_BRIDGE_ECHO_SUPPRESSION_WINDOW_SECONDS = 5 * 60
_BRIDGE_DUPLICATE_SUPPRESSION_WINDOW_SECONDS = 30
_BRIDGE_DUPLICATE_SYNC_SOURCES = {"realtime", "realtime_backfill"}
COMPANION_RENDER_PIPELINES = ("classic", "hero-shot", "genshin", "mio-reference", "reze-npr", "reze-design", "k3", "reze-k3")
_COMPANION_RENDER_PIPELINE_SET = set(COMPANION_RENDER_PIPELINES)
_COMPANION_RENDER_PIPELINE_SQL_VALUES = ", ".join(f"'{pipeline}'" for pipeline in COMPANION_RENDER_PIPELINES)
_DESKTOP_PET_FIRST_PROMPT_PREVIEW_MAX_LENGTH = 240
_DESKTOP_PET_LAST_SUMMARY_MAX_LENGTH = 1000


def _compact_text(value: Any, *, limit: int | None = None) -> str:
    text = " ".join(str(value or "").split()).strip()
    if limit is not None:
        return text[:limit]
    return text


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        text = _compact_text(item)
        if text:
            items.append(text)
    return items


def _first_nonempty_text(*values: Any, limit: int | None = None) -> str:
    for value in values:
        text = _compact_text(value, limit=limit)
        if text:
            return text
    return ""


def _knowledge_steps_from_text(value: Any) -> list[str]:
    text = _compact_text(value)
    return [text] if text else []


def _knowledge_step_records(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, Any]] = []
    for raw in value:
        if isinstance(raw, dict):
            item = {
                "order": raw.get("order"),
                "instruction": _compact_text(raw.get("instruction")),
                "commands": _string_list(raw.get("commands")),
                "file_refs": _string_list(raw.get("file_refs")),
                "evidence_refs": _string_list(raw.get("evidence_refs")),
            }
            if item["instruction"]:
                items.append(item)
        else:
            text = _compact_text(raw)
            if text:
                items.append({"order": len(items) + 1, "instruction": text, "commands": [], "file_refs": [], "evidence_refs": []})
    return items


def _knowledge_verification_records(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: list[dict[str, Any]] = []
    for raw in value:
        if isinstance(raw, dict):
            item = {
                "order": raw.get("order"),
                "instruction": _compact_text(raw.get("instruction")),
                "commands": _string_list(raw.get("commands")),
                "expected_signal": _compact_text(raw.get("expected_signal")),
                "evidence_refs": _string_list(raw.get("evidence_refs")),
            }
            if item["instruction"]:
                items.append(item)
        else:
            text = _compact_text(raw)
            if text:
                items.append(
                    {
                        "order": len(items) + 1,
                        "instruction": text,
                        "commands": [],
                        "expected_signal": "",
                        "evidence_refs": [],
                    }
                )
    return items


def _build_codex_review_memory_details(
    review: dict[str, Any],
    *,
    override_problem: str | None = None,
) -> dict[str, Any]:
    details = review.get("details") if isinstance(review.get("details"), dict) else {}
    explicit_override_problem = _compact_text(override_problem)
    original_summary = _compact_text(review.get("summary"))
    use_override_problem = bool(explicit_override_problem and explicit_override_problem != original_summary)
    problem = _first_nonempty_text(
        explicit_override_problem if use_override_problem else None,
        details.get("problem"),
        details.get("symptom"),
        review.get("summary"),
    )
    root_cause = _first_nonempty_text(details.get("root_cause"), details.get("cause"))
    steps = _knowledge_steps_from_text(_first_nonempty_text(details.get("fix"), details.get("decision"), details.get("result")))
    verification = _knowledge_steps_from_text(_first_nonempty_text(details.get("prevention"), details.get("guardrail")))
    if not steps:
        steps = ["Turn the accepted review item into an explicit procedure before exporting it."]
    if not verification:
        verification = ["Verify the procedure against the attached evidence before publishing it."]
    memory_type = _compact_text(review.get("item_type")) or "memory"
    return {
        "knowledge_kind": memory_type,
        "problem": problem,
        "root_cause": root_cause,
        "steps": steps,
        "verification": verification,
        "when_to_use": f"Use when handling accepted {memory_type} review items.",
        "source_summary": explicit_override_problem if use_override_problem else original_summary,
    }


def _render_codex_review_memory_body(title: str, details: dict[str, Any]) -> str:
    lines: list[str] = []
    problem = _compact_text(details.get("problem"))
    if problem:
        lines.extend(["## Problem", "", problem, ""])
    root_cause = _compact_text(details.get("root_cause"))
    if root_cause:
        lines.extend(["## Root Cause", "", root_cause, ""])
    when_to_use = _compact_text(details.get("when_to_use"))
    if when_to_use:
        lines.extend(["## When To Use", "", when_to_use, ""])
    prerequisites = _string_list(details.get("prerequisites"))
    if prerequisites:
        lines.extend(["## Prerequisites", ""])
        lines.extend(f"- {item}" for item in prerequisites)
        lines.append("")
    steps = _knowledge_step_records(details.get("steps"))
    if steps:
        lines.extend(["## Steps", ""])
        for step in steps:
            lines.append(f"{int(step.get('order') or 1)}. {step['instruction']}")
            for command in step.get("commands") or []:
                lines.append(f"   - Command: `{command}`")
            for file_ref in step.get("file_refs") or []:
                lines.append(f"   - File: `{file_ref}`")
            for evidence_ref in step.get("evidence_refs") or []:
                lines.append(f"   - Evidence: `{evidence_ref}`")
        lines.append("")
    verification = _knowledge_verification_records(details.get("verification"))
    if verification:
        lines.extend(["## Verification", ""])
        for step in verification:
            lines.append(f"{int(step.get('order') or 1)}. {step['instruction']}")
            for command in step.get("commands") or []:
                lines.append(f"   - Command: `{command}`")
            expected_signal = _compact_text(step.get("expected_signal"))
            if expected_signal:
                lines.append(f"   - Expected signal: {expected_signal}")
            for evidence_ref in step.get("evidence_refs") or []:
                lines.append(f"   - Evidence: `{evidence_ref}`")
        lines.append("")
    cautions = _string_list(details.get("cautions"))
    if cautions:
        lines.extend(["## Cautions", ""])
        lines.extend(f"- {item}" for item in cautions)
        lines.append("")
    open_questions = _string_list(details.get("open_questions"))
    if open_questions:
        lines.extend(["## Open Questions", ""])
        lines.extend(f"- {item}" for item in open_questions)
        lines.append("")
    source_summary = _compact_text(details.get("source_summary"))
    if source_summary:
        lines.extend(["## Source Summary", "", source_summary, ""])
    return "\n".join(lines).strip() + "\n"


class TraceStore:
    def __init__(self, db_path: Path, ndjson_dir: Path):
        self.db_path = Path(db_path)
        self.ndjson_dir = Path(ndjson_dir)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.ndjson_dir.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA busy_timeout = 5000")
        self._init_db()

    def close(self) -> None:
        self._conn.close()

    def _open_companion_shared_config_connection(self) -> sqlite3.Connection:
        """为 Pet 同步配置建立独立短连接，避免与长生命周期业务连接跨线程争用。"""
        connection = sqlite3.connect(self.db_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _init_db(self) -> None:
        cursor = self._conn.cursor()
        cursor.executescript(
            """
            CREATE TABLE IF NOT EXISTS trace_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                session_id TEXT,
                stage TEXT NOT NULL,
                status TEXT NOT NULL,
                latency_ms INTEGER,
                error_code TEXT,
                payload_json TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_mirror (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                request_json TEXT NOT NULL,
                raw_response TEXT,
                normalized_json TEXT,
                endpoint_used TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS retry_jobs (
                id TEXT PRIMARY KEY,
                trace_id TEXT NOT NULL,
                stage TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mapping_defaults (
                slot TEXT PRIMARY KEY,
                config_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mapping_user_override (
                user_id TEXT NOT NULL,
                slot TEXT NOT NULL,
                config_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, slot)
            );

            CREATE TABLE IF NOT EXISTS companion_shared_config (
                user_id TEXT PRIMARY KEY,
                selected_model_path TEXT,
                render_pipeline TEXT NOT NULL DEFAULT 'classic'
                    CHECK (render_pipeline IN ('classic', 'hero-shot', 'genshin', 'mio-reference', 'reze-npr', 'reze-design', 'k3', 'reze-k3')),
                reze_stage_document_json TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS desktop_pet_sessions (
                pet_session_id TEXT PRIMARY KEY,
                codex_session_id TEXT NOT NULL,
                workspace_id TEXT,
                workspace_path TEXT NOT NULL,
                codex_home TEXT,
                display_title TEXT NOT NULL,
                first_prompt_preview TEXT,
                last_summary TEXT,
                last_status TEXT NOT NULL,
                launch_mode TEXT NOT NULL,
                remote_url TEXT,
                app_server_pid INTEGER,
                app_server_port INTEGER,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_desktop_pet_sessions_last_seen
            ON desktop_pet_sessions(last_seen_at DESC);

            CREATE TABLE IF NOT EXISTS asset_registry (
                asset_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                slot TEXT NOT NULL,
                filename TEXT NOT NULL,
                display_name TEXT,
                source_relative_path TEXT,
                relative_path TEXT NOT NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                favorite_relative_path TEXT,
                favorite_model_relative_path TEXT,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                external_user_id TEXT NOT NULL UNIQUE,
                display_name TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                owner_account_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspace_members (
                workspace_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (workspace_id, account_id)
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                openclaw_session_key TEXT NOT NULL,
                title TEXT NOT NULL,
                title_source TEXT NOT NULL,
                selected_model_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                visibility TEXT NOT NULL DEFAULT 'chat',
                trace_id TEXT,
                openclaw_message_id TEXT,
                emotion TEXT,
                action TEXT,
                tts_emotion_label TEXT,
                tts_pause_profile TEXT,
                motion_plan_json TEXT,
                memory_ops_json TEXT,
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE IF NOT EXISTS message_tts (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                version INTEGER NOT NULL,
                status TEXT NOT NULL,
                task_id TEXT,
                remote_audio_url TEXT,
                remote_audio_path TEXT,
                media_type TEXT,
                duration_seconds REAL,
                chunks_count INTEGER,
                error TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                expires_at TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tts_jobs (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                message_tts_id TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT NOT NULL,
                locked_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS message_motion_resolution (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                selected_model_path TEXT,
                source_action TEXT,
                source_template TEXT,
                resolved_asset_id TEXT,
                resolved_asset_url TEXT,
                resolved_display_name TEXT,
                status TEXT NOT NULL,
                fallback_reason TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS motion_context_exports (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                model_key TEXT NOT NULL,
                model_display_name TEXT NOT NULL,
                export_json TEXT NOT NULL,
                motion_count INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS message_bridge_bindings (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                account_id TEXT NOT NULL,
                local_session_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                channel TEXT NOT NULL,
                external_session_key TEXT NOT NULL,
                external_display_name TEXT,
                is_default INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                last_history_sync_at TEXT,
                last_message_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(workspace_id, account_id, provider, channel, external_session_key)
            );

            CREATE TABLE IF NOT EXISTS message_bridge_state (
                provider TEXT NOT NULL,
                channel TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                realtime_drive_character INTEGER NOT NULL DEFAULT 1,
                websocket_status TEXT NOT NULL DEFAULT 'disconnected',
                reconnect_attempts INTEGER NOT NULL DEFAULT 0,
                last_connected_at TEXT,
                last_error TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(provider, channel)
            );

            CREATE TABLE IF NOT EXISTS codex_interactive_sessions (
                id TEXT PRIMARY KEY,
                local_chat_session_id TEXT,
                workspace_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                workspace_path TEXT NOT NULL,
                worktree_path TEXT,
                branch_name TEXT,
                codex_thread_id TEXT,
                codex_version TEXT,
                transport TEXT NOT NULL DEFAULT 'stdio',
                sandbox_mode TEXT NOT NULL DEFAULT 'read-only',
                status TEXT NOT NULL,
                process_id INTEGER,
                created_at TEXT NOT NULL,
                last_active_at TEXT NOT NULL,
                closed_at TEXT,
                error TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS codex_workspaces (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                source TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS codex_turns (
                id TEXT PRIMARY KEY,
                codex_session_id TEXT NOT NULL,
                codex_turn_id TEXT,
                user_message TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                final_text TEXT,
                error TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (codex_session_id) REFERENCES codex_interactive_sessions(id)
            );

            CREATE TABLE IF NOT EXISTS codex_events (
                id TEXT PRIMARY KEY,
                codex_session_id TEXT NOT NULL,
                turn_id TEXT,
                sequence INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (codex_session_id) REFERENCES codex_interactive_sessions(id)
            );

            CREATE INDEX IF NOT EXISTS idx_codex_events_session_sequence
            ON codex_events(codex_session_id, sequence);

            CREATE TABLE IF NOT EXISTS codex_approvals (
                id TEXT PRIMARY KEY,
                codex_session_id TEXT NOT NULL,
                turn_id TEXT,
                external_approval_id TEXT,
                action_type TEXT NOT NULL,
                title TEXT NOT NULL,
                detail_json TEXT NOT NULL,
                decision TEXT,
                decided_by TEXT,
                decided_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (codex_session_id) REFERENCES codex_interactive_sessions(id)
            );

            CREATE TABLE IF NOT EXISTS codex_artifacts (
                id TEXT PRIMARY KEY,
                codex_session_id TEXT NOT NULL,
                turn_id TEXT,
                kind TEXT NOT NULL,
                path TEXT,
                content_ref TEXT,
                summary TEXT,
                created_at TEXT NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                FOREIGN KEY (codex_session_id) REFERENCES codex_interactive_sessions(id)
            );

            CREATE TABLE IF NOT EXISTS codex_openclaw_sync_outbox (
                id TEXT PRIMARY KEY,
                pet_session_id TEXT NOT NULL,
                codex_session_id TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT,
                last_error TEXT,
                openclaw_session_key TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                sent_at TEXT,
                UNIQUE(pet_session_id, payload_hash)
            );

            CREATE INDEX IF NOT EXISTS idx_codex_openclaw_sync_outbox_pending
            ON codex_openclaw_sync_outbox(status, next_attempt_at, created_at);

            CREATE TABLE IF NOT EXISTS codex_knowledge_extraction_outbox (
                id TEXT PRIMARY KEY,
                pet_session_id TEXT NOT NULL,
                codex_session_id TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT,
                last_error TEXT,
                openclaw_session_key TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                UNIQUE(pet_session_id, source_hash)
            );

            CREATE INDEX IF NOT EXISTS idx_codex_knowledge_extraction_outbox_pending
            ON codex_knowledge_extraction_outbox(status, next_attempt_at, created_at);

            CREATE TABLE IF NOT EXISTS codex_session_knowledge (
                id TEXT PRIMARY KEY,
                workspace_id TEXT,
                pet_session_id TEXT NOT NULL,
                codex_session_id TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                extractor_version TEXT NOT NULL,
                domain_json TEXT NOT NULL DEFAULT '{}',
                concepts_json TEXT NOT NULL DEFAULT '[]',
                rule_concepts_json TEXT NOT NULL DEFAULT '[]',
                methodologies_json TEXT NOT NULL DEFAULT '[]',
                failure_taxonomy_json TEXT NOT NULL DEFAULT '[]',
                verification_rules_json TEXT NOT NULL DEFAULT '[]',
                timeline_json TEXT NOT NULL DEFAULT '[]',
                code_blocks_json TEXT NOT NULL DEFAULT '[]',
                reusable_summary_json TEXT NOT NULL DEFAULT '{}',
                raw_response_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(pet_session_id, source_hash)
            );

            CREATE INDEX IF NOT EXISTS idx_codex_session_knowledge_workspace
            ON codex_session_knowledge(workspace_id, created_at);

            CREATE TABLE IF NOT EXISTS codex_concept_deltas (
                id TEXT PRIMARY KEY,
                delta_id TEXT NOT NULL UNIQUE,
                workspace_id TEXT NOT NULL,
                codex_session_id TEXT NOT NULL,
                author TEXT NOT NULL,
                change_kind TEXT NOT NULL,
                terms_json TEXT NOT NULL DEFAULT '[]',
                source_hash TEXT NOT NULL,
                author_text_sha256 TEXT NOT NULL,
                raw_author_text TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(workspace_id, source_hash)
            );

            CREATE INDEX IF NOT EXISTS idx_codex_concept_deltas_session
            ON codex_concept_deltas(codex_session_id, created_at);

            CREATE TABLE IF NOT EXISTS domain_knowledge_evidence_refs (
                ref_id TEXT PRIMARY KEY,
                repository_id TEXT NOT NULL,
                revision TEXT NOT NULL,
                role TEXT NOT NULL,
                authority TEXT NOT NULL,
                locator_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(repository_id, revision, locator_hash)
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_topics (
                topic_id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                topic_identity_key TEXT NOT NULL,
                title TEXT NOT NULL,
                aliases_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL,
                current_candidate_id TEXT,
                current_candidate_revision INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(workspace_id, topic_identity_key)
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_candidates (
                candidate_id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                current_revision INTEGER NOT NULL,
                topic_identity_key TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(workspace_id, source_kind, source_hash)
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_candidate_versions (
                candidate_id TEXT NOT NULL,
                candidate_revision INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(candidate_id, candidate_revision)
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_candidate_evidence (
                candidate_id TEXT NOT NULL,
                candidate_revision INTEGER NOT NULL,
                ref_id TEXT NOT NULL,
                evidence_role TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(candidate_id, candidate_revision, ref_id)
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_review_decisions (
                command_id TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL,
                candidate_revision INTEGER NOT NULL,
                idempotency_key TEXT NOT NULL UNIQUE,
                payload_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_wiki_change_sets (
                change_set_id TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL,
                candidate_revision INTEGER NOT NULL,
                decision_command_id TEXT NOT NULL UNIQUE,
                approved_document_sha256 TEXT NOT NULL,
                publish_status TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_publication_receipts (
                change_set_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                published_content_sha256 TEXT,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_wiki_page_snapshots (
                id TEXT PRIMARY KEY,
                topic_id TEXT,
                path TEXT NOT NULL,
                git_revision TEXT NOT NULL,
                content_sha256 TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(path, git_revision, content_sha256)
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_scan_runs (
                scan_id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                revision TEXT NOT NULL,
                scope_json TEXT NOT NULL DEFAULT '{}',
                cursor_json TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS domain_term_coverage_findings (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                codex_session_id TEXT,
                scan_id TEXT,
                term TEXT NOT NULL,
                topic_kind TEXT,
                classification TEXT NOT NULL,
                status TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(workspace_id, codex_session_id, term, classification, source_hash)
            );

            CREATE INDEX IF NOT EXISTS idx_domain_term_coverage_session
            ON domain_term_coverage_findings(codex_session_id, status, created_at);

            CREATE TABLE IF NOT EXISTS domain_knowledge_extraction_outbox (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(workspace_id, source_kind, source_hash)
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_control_plane_commands (
                command_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                command_kind TEXT NOT NULL,
                cursor TEXT,
                payload_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                result_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS domain_knowledge_candidate_deliveries (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                candidate_id TEXT NOT NULL,
                candidate_revision INTEGER NOT NULL,
                payload_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(run_id, candidate_id, candidate_revision)
            );

            CREATE INDEX IF NOT EXISTS idx_domain_knowledge_candidate_deliveries_pending
            ON domain_knowledge_candidate_deliveries(status, next_attempt_at, created_at);

            CREATE TABLE IF NOT EXISTS domain_knowledge_control_plane_runs (
                run_id TEXT PRIMARY KEY,
                command_cursor TEXT,
                publish_cursor TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS codex_review_control_plane_snapshot_state (
                session_key TEXT PRIMARY KEY,
                snapshot_cursor TEXT NOT NULL,
                response_json TEXT NOT NULL DEFAULT '{}',
                submitted_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS codex_review_items (
                id TEXT PRIMARY KEY,
                pet_session_id TEXT NOT NULL,
                codex_session_id TEXT NOT NULL,
                item_type TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                details_json TEXT NOT NULL DEFAULT '{}',
                tags_json TEXT NOT NULL DEFAULT '[]',
                severity TEXT,
                status TEXT NOT NULL,
                source TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                reviewed_at TEXT,
                UNIQUE(pet_session_id, item_type, source_hash)
            );

            CREATE INDEX IF NOT EXISTS idx_codex_review_items_pet_session
            ON codex_review_items(pet_session_id, status, item_type, created_at);

            CREATE TABLE IF NOT EXISTS codex_review_memory (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                source_review_item_id TEXT NOT NULL UNIQUE,
                pet_session_id TEXT NOT NULL,
                codex_session_id TEXT NOT NULL,
                memory_type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}',
                tags_json TEXT NOT NULL DEFAULT '[]',
                evidence_refs_json TEXT NOT NULL DEFAULT '[]',
                source_hash TEXT NOT NULL,
                created_by TEXT NOT NULL,
                confirmed_by TEXT NOT NULL,
                confirmed_at TEXT NOT NULL,
                current_version INTEGER NOT NULL DEFAULT 1,
                export_status TEXT NOT NULL,
                openkb_document_id TEXT,
                export_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_codex_review_memory_workspace_status
            ON codex_review_memory(workspace_id, export_status, memory_type, created_at);

            CREATE TABLE IF NOT EXISTS codex_review_memory_versions (
                id TEXT PRIMARY KEY,
                memory_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}',
                edited_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(memory_id, version)
            );

            CREATE INDEX IF NOT EXISTS idx_codex_review_memory_versions_memory
            ON codex_review_memory_versions(memory_id, version);
            """
        )
        self._migrate_companion_shared_config_render_pipeline_check()
        shared_config_columns = {
            row["name"] for row in self._conn.execute("PRAGMA table_info(companion_shared_config)").fetchall()
        }
        self._add_column_if_missing(
            shared_config_columns,
            "reze_stage_document_json",
            "ALTER TABLE companion_shared_config ADD COLUMN reze_stage_document_json TEXT",
        )
        existing_columns = {
            row["name"] for row in self._conn.execute("PRAGMA table_info(asset_registry)").fetchall()
        }
        self._add_column_if_missing(existing_columns, "display_name", "ALTER TABLE asset_registry ADD COLUMN display_name TEXT")
        self._add_column_if_missing(
            existing_columns,
            "source_relative_path",
            "ALTER TABLE asset_registry ADD COLUMN source_relative_path TEXT",
        )
        self._add_column_if_missing(
            existing_columns,
            "is_favorite",
            "ALTER TABLE asset_registry ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
        )
        self._add_column_if_missing(
            existing_columns,
            "favorite_relative_path",
            "ALTER TABLE asset_registry ADD COLUMN favorite_relative_path TEXT",
        )
        self._add_column_if_missing(
            existing_columns,
            "favorite_model_relative_path",
            "ALTER TABLE asset_registry ADD COLUMN favorite_model_relative_path TEXT",
        )
        memory_columns = {
            row["name"] for row in self._conn.execute("PRAGMA table_info(codex_review_memory)").fetchall()
        }
        self._add_column_if_missing(
            memory_columns,
            "details_json",
            "ALTER TABLE codex_review_memory ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'",
        )
        memory_version_columns = {
            row["name"] for row in self._conn.execute("PRAGMA table_info(codex_review_memory_versions)").fetchall()
        }
        self._add_column_if_missing(
            memory_version_columns,
            "details_json",
            "ALTER TABLE codex_review_memory_versions ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'",
        )
        message_columns = {
            row["name"] for row in self._conn.execute("PRAGMA table_info(messages)").fetchall()
        }
        self._add_column_if_missing(
            message_columns,
            "visibility",
            "ALTER TABLE messages ADD COLUMN visibility TEXT NOT NULL DEFAULT 'chat'",
        )
        self._conn.execute(
            """
            UPDATE messages
            SET visibility = 'internal'
            WHERE visibility = 'chat'
              AND (
                (role = 'system' AND lower(trim(content)) = 'compaction')
                OR (role = 'assistant' AND trim(content) = '[assistant turn failed before producing content]')
              )
            """
        )
        self._conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_messages_chat_visible
            ON messages (workspace_id, account_id, session_id, deleted_at, visibility, created_at)
            """
        )
        self._conn.commit()

    def _migrate_companion_shared_config_render_pipeline_check(self) -> None:
        row = self._conn.execute(
            """
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table' AND name = 'companion_shared_config'
            """
        ).fetchone()
        schema_sql = str(row["sql"] or "") if row else ""
        if schema_sql and all(f"'{pipeline}'" in schema_sql for pipeline in COMPANION_RENDER_PIPELINES):
            return

        self._conn.execute("DROP TABLE IF EXISTS companion_shared_config_next")
        self._conn.execute(
            f"""
            CREATE TABLE companion_shared_config_next (
                user_id TEXT PRIMARY KEY,
                selected_model_path TEXT,
                render_pipeline TEXT NOT NULL DEFAULT 'classic'
                    CHECK (render_pipeline IN ({_COMPANION_RENDER_PIPELINE_SQL_VALUES})),
                reze_stage_document_json TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        self._conn.execute(
            f"""
            INSERT INTO companion_shared_config_next (
                user_id, selected_model_path, render_pipeline, reze_stage_document_json, updated_at
            )
            SELECT
                user_id,
                selected_model_path,
                lower(trim(render_pipeline)),
                NULL,
                updated_at
            FROM companion_shared_config
            WHERE lower(trim(render_pipeline)) IN ({_COMPANION_RENDER_PIPELINE_SQL_VALUES})
            """
        )
        self._conn.execute("DROP TABLE companion_shared_config")
        self._conn.execute("ALTER TABLE companion_shared_config_next RENAME TO companion_shared_config")

    @staticmethod
    def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
        return dict(row) if row else None

    @staticmethod
    def _json_loads(value: str | None, fallback: Any) -> Any:
        if not value:
            return fallback
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback

    def create_codex_interactive_session(
        self,
        *,
        session_id: str,
        local_chat_session_id: str | None,
        workspace_id: str,
        user_id: str,
        workspace_path: str,
        worktree_path: str | None,
        branch_name: str | None,
        codex_thread_id: str | None,
        codex_version: str | None,
        transport: str,
        sandbox_mode: str,
        status: str,
        process_id: int | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO codex_interactive_sessions (
                id, local_chat_session_id, workspace_id, user_id, workspace_path,
                worktree_path, branch_name, codex_thread_id, codex_version, transport,
                sandbox_mode, status, process_id, created_at, last_active_at, closed_at,
                error, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
            """,
            (
                session_id,
                local_chat_session_id,
                workspace_id,
                user_id,
                workspace_path,
                worktree_path,
                branch_name,
                codex_thread_id,
                codex_version,
                transport,
                sandbox_mode,
                status,
                process_id,
                now,
                now,
                json.dumps(metadata or {}, ensure_ascii=False),
            ),
        )
        self._conn.commit()
        return self.get_codex_interactive_session(session_id)  # type: ignore[return-value]

    def upsert_codex_workspace(
        self,
        *,
        workspace_id: str,
        path: str,
        source: str,
        created_by: str,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        current = self.get_codex_workspace(workspace_id)
        if current:
            self._conn.execute(
                """
                UPDATE codex_workspaces
                SET path = ?, source = ?, updated_at = ?
                WHERE id = ?
                """,
                (path, source, now, workspace_id),
            )
        else:
            self._conn.execute(
                """
                INSERT INTO codex_workspaces (
                    id, path, source, created_by, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (workspace_id, path, source, created_by, now, now),
            )
        self._conn.commit()
        return self.get_codex_workspace(workspace_id)  # type: ignore[return-value]

    def get_codex_workspace(self, workspace_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM codex_workspaces WHERE id = ?",
            (workspace_id,),
        ).fetchone()
        return self._row_to_dict(row)

    def list_codex_workspaces(self) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT *
            FROM codex_workspaces
            ORDER BY created_at ASC, id ASC
            """
        ).fetchall()
        return [dict(row) for row in rows]

    def get_codex_interactive_session(self, session_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM codex_interactive_sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        if not row:
            return None
        item = dict(row)
        item["metadata"] = self._json_loads(item.get("metadata_json"), {})
        return item

    def list_codex_interactive_sessions(
        self,
        *,
        user_id: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        bounded_limit = max(1, min(int(limit), 50))
        rows = self._conn.execute(
            """
            SELECT *
            FROM codex_interactive_sessions
            WHERE user_id = ?
            ORDER BY last_active_at DESC, id DESC
            LIMIT ?
            """,
            (user_id, bounded_limit),
        ).fetchall()
        sessions: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["metadata"] = self._json_loads(item.get("metadata_json"), {})
            sessions.append(item)
        return sessions

    def update_codex_interactive_session(
        self,
        session_id: str,
        *,
        status: str | None = None,
        codex_thread_id: str | None = None,
        codex_version: str | None = None,
        process_id: int | None = None,
        closed: bool = False,
        error: str | None = None,
    ) -> dict[str, Any] | None:
        current = self.get_codex_interactive_session(session_id)
        if current is None:
            return None
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE codex_interactive_sessions
            SET status = ?, codex_thread_id = COALESCE(?, codex_thread_id),
                codex_version = COALESCE(?, codex_version),
                process_id = COALESCE(?, process_id),
                last_active_at = ?, closed_at = ?, error = COALESCE(?, error)
            WHERE id = ?
            """,
            (
                status or current["status"],
                codex_thread_id,
                codex_version,
                process_id,
                now,
                now if closed else current.get("closed_at"),
                error,
                session_id,
            ),
        )
        self._conn.commit()
        return self.get_codex_interactive_session(session_id)

    def count_active_codex_sessions(self) -> int:
        row = self._conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM codex_interactive_sessions
            WHERE status NOT IN ('closed', 'failed')
            """
        ).fetchone()
        return int(row["count"] if row else 0)

    def list_idle_codex_sessions(self, idle_timeout_seconds: int) -> list[dict[str, Any]]:
        cutoff = datetime.now(UTC) - timedelta(seconds=max(0, idle_timeout_seconds))
        rows = self._conn.execute(
            """
            SELECT *
            FROM codex_interactive_sessions
            WHERE status NOT IN ('closed', 'failed') AND last_active_at < ?
            ORDER BY last_active_at ASC
            """,
            (cutoff.isoformat(),),
        ).fetchall()
        sessions = [dict(row) for row in rows]
        for session in sessions:
            session["metadata"] = self._json_loads(session.get("metadata_json"), {})
        return sessions

    def latest_codex_version(self) -> str | None:
        row = self._conn.execute(
            """
            SELECT codex_version
            FROM codex_interactive_sessions
            WHERE codex_version IS NOT NULL AND codex_version != ''
            ORDER BY last_active_at DESC
            LIMIT 1
            """
        ).fetchone()
        return str(row["codex_version"]) if row and row["codex_version"] else None

    def latest_codex_error(self) -> str | None:
        row = self._conn.execute(
            """
            SELECT error
            FROM codex_interactive_sessions
            ORDER BY last_active_at DESC
            LIMIT 1
            """
        ).fetchone()
        return str(row["error"]) if row and row["error"] else None

    def create_codex_turn(
        self,
        *,
        turn_id: str,
        codex_session_id: str,
        codex_turn_id: str | None,
        user_message: str,
        status: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO codex_turns (
                id, codex_session_id, codex_turn_id, user_message, status,
                started_at, completed_at, final_text, error, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
            """,
            (
                turn_id,
                codex_session_id,
                codex_turn_id,
                user_message,
                status,
                now,
                json.dumps(metadata or {}, ensure_ascii=False),
            ),
        )
        self._conn.commit()
        return self.get_codex_turn(turn_id)  # type: ignore[return-value]

    def get_codex_turn(self, turn_id: str) -> dict[str, Any] | None:
        row = self._conn.execute("SELECT * FROM codex_turns WHERE id = ?", (turn_id,)).fetchone()
        if not row:
            return None
        item = dict(row)
        item["metadata"] = self._json_loads(item.get("metadata_json"), {})
        return item

    def update_codex_turn(
        self,
        turn_id: str,
        *,
        status: str,
        codex_turn_id: str | None = None,
        final_text: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any] | None:
        completed_at = _utc_now_iso() if status in {"completed", "failed", "cancelled"} else None
        self._conn.execute(
            """
            UPDATE codex_turns
            SET status = ?, codex_turn_id = COALESCE(?, codex_turn_id),
                completed_at = COALESCE(?, completed_at), final_text = ?, error = ?
            WHERE id = ?
            """,
            (status, codex_turn_id, completed_at, final_text, error, turn_id),
        )
        self._conn.commit()
        return self.get_codex_turn(turn_id)

    def append_codex_event(
        self,
        codex_session_id: str,
        turn_id: str | None,
        event_type: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        row = self._conn.execute(
            "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM codex_events WHERE codex_session_id = ?",
            (codex_session_id,),
        ).fetchone()
        sequence = int(row["next_sequence"] if row else 1)
        event_id = str(uuid4())
        self._conn.execute(
            """
            INSERT INTO codex_events (
                id, codex_session_id, turn_id, sequence, event_type, payload_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                codex_session_id,
                turn_id,
                sequence,
                event_type,
                json.dumps(payload, ensure_ascii=False),
                _utc_now_iso(),
            ),
        )
        self._conn.commit()
        return self._row_to_dict(
            self._conn.execute("SELECT * FROM codex_events WHERE id = ?", (event_id,)).fetchone()
        )  # type: ignore[return-value]

    def list_codex_events(self, codex_session_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT *
            FROM codex_events
            WHERE codex_session_id = ?
            ORDER BY sequence ASC
            """,
            (codex_session_id,),
        ).fetchall()
        events = [dict(row) for row in rows]
        for event in events:
            event["payload"] = self._json_loads(event.get("payload_json"), {})
        return events

    def list_recent_codex_events(
        self,
        codex_session_id: str,
        *,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        bounded_limit = max(1, min(int(limit), 50))
        rows = self._conn.execute(
            """
            SELECT *
            FROM codex_events
            WHERE codex_session_id = ?
            ORDER BY sequence DESC
            LIMIT ?
            """,
            (codex_session_id, bounded_limit),
        ).fetchall()
        events = [dict(row) for row in reversed(rows)]
        for event in events:
            event["payload"] = self._json_loads(event.get("payload_json"), {})
        return events

    def create_codex_approval(
        self,
        *,
        approval_id: str,
        codex_session_id: str,
        turn_id: str | None,
        external_approval_id: str | None,
        action_type: str,
        title: str,
        detail: dict[str, Any],
    ) -> dict[str, Any]:
        self._conn.execute(
            """
            INSERT INTO codex_approvals (
                id, codex_session_id, turn_id, external_approval_id, action_type,
                title, detail_json, decision, decided_by, decided_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
            """,
            (
                approval_id,
                codex_session_id,
                turn_id,
                external_approval_id,
                action_type,
                title,
                json.dumps(detail, ensure_ascii=False),
                _utc_now_iso(),
            ),
        )
        self._conn.commit()
        return self.get_codex_approval(approval_id)  # type: ignore[return-value]

    def get_codex_approval(self, approval_id: str) -> dict[str, Any] | None:
        row = self._conn.execute("SELECT * FROM codex_approvals WHERE id = ?", (approval_id,)).fetchone()
        if not row:
            return None
        item = dict(row)
        item["detail"] = self._json_loads(item.get("detail_json"), {})
        return item

    def decide_codex_approval(self, approval_id: str, *, decision: str, decided_by: str) -> dict[str, Any] | None:
        self._conn.execute(
            """
            UPDATE codex_approvals
            SET decision = ?, decided_by = ?, decided_at = ?
            WHERE id = ?
            """,
            (decision, decided_by, _utc_now_iso(), approval_id),
        )
        self._conn.commit()
        return self.get_codex_approval(approval_id)

    def list_pending_codex_approvals(self, codex_session_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT *
            FROM codex_approvals
            WHERE codex_session_id = ? AND decision IS NULL
            ORDER BY created_at ASC
            """,
            (codex_session_id,),
        ).fetchall()
        approvals = [dict(row) for row in rows]
        for approval in approvals:
            approval["detail"] = self._json_loads(approval.get("detail_json"), {})
        return approvals

    def create_codex_artifact(
        self,
        *,
        artifact_id: str,
        codex_session_id: str,
        turn_id: str | None,
        kind: str,
        path: str | None,
        content_ref: str | None,
        summary: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._conn.execute(
            """
            INSERT INTO codex_artifacts (
                id, codex_session_id, turn_id, kind, path, content_ref,
                summary, created_at, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                artifact_id,
                codex_session_id,
                turn_id,
                kind,
                path,
                content_ref,
                summary,
                _utc_now_iso(),
                json.dumps(metadata or {}, ensure_ascii=False),
            ),
        )
        self._conn.commit()
        return self.get_codex_artifact(artifact_id)  # type: ignore[return-value]

    def get_codex_artifact(self, artifact_id: str) -> dict[str, Any] | None:
        row = self._conn.execute("SELECT * FROM codex_artifacts WHERE id = ?", (artifact_id,)).fetchone()
        if not row:
            return None
        item = dict(row)
        item["metadata"] = self._json_loads(item.get("metadata_json"), {})
        return item

    def list_codex_artifacts(self, codex_session_id: str, kind: str | None = None) -> list[dict[str, Any]]:
        if kind:
            rows = self._conn.execute(
                """
                SELECT *
                FROM codex_artifacts
                WHERE codex_session_id = ? AND kind = ?
                ORDER BY created_at DESC
                """,
                (codex_session_id, kind),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """
                SELECT *
                FROM codex_artifacts
                WHERE codex_session_id = ?
                ORDER BY created_at DESC
                """,
                (codex_session_id,),
            ).fetchall()
        artifacts = [dict(row) for row in rows]
        for artifact in artifacts:
            artifact["metadata"] = self._json_loads(artifact.get("metadata_json"), {})
        return artifacts

    def _codex_openclaw_outbox_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["payload"] = self._json_loads(item.pop("payload_json", None), {})
        return item

    def enqueue_codex_openclaw_sync(
        self,
        *,
        pet_session_id: str,
        codex_session_id: str,
        payload_hash: str,
        payload: dict[str, Any],
        openclaw_session_key: str,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        outbox_id = f"codex_openclaw_sync_{uuid4().hex}"
        self._conn.execute(
            """
            INSERT INTO codex_openclaw_sync_outbox (
                id, pet_session_id, codex_session_id, payload_hash, payload_json,
                status, attempt_count, next_attempt_at, last_error,
                openclaw_session_key, created_at, updated_at, sent_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?, ?, NULL)
            ON CONFLICT(pet_session_id, payload_hash) DO UPDATE SET
                updated_at = codex_openclaw_sync_outbox.updated_at
            """,
            (
                outbox_id,
                pet_session_id,
                codex_session_id,
                payload_hash,
                json.dumps(payload, ensure_ascii=False),
                now,
                openclaw_session_key,
                now,
                now,
            ),
        )
        self._conn.commit()
        row = self._conn.execute(
            """
            SELECT *
            FROM codex_openclaw_sync_outbox
            WHERE pet_session_id = ? AND payload_hash = ?
            """,
            (pet_session_id, payload_hash),
        ).fetchone()
        return self._codex_openclaw_outbox_row(row) or {}

    def get_codex_openclaw_sync_outbox(self, outbox_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM codex_openclaw_sync_outbox WHERE id = ?",
            (outbox_id,),
        ).fetchone()
        return self._codex_openclaw_outbox_row(row)

    def claim_next_codex_openclaw_sync(self, *, now_iso: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT *
            FROM codex_openclaw_sync_outbox
            WHERE status = 'pending'
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            """,
            (now_iso,),
        ).fetchone()
        if row is None:
            return None
        item = self._codex_openclaw_outbox_row(row)
        if item is None:
            return None
        self._conn.execute(
            """
            UPDATE codex_openclaw_sync_outbox
            SET status = 'sending',
                attempt_count = attempt_count + 1,
                updated_at = ?
            WHERE id = ?
            """,
            (now_iso, item["id"]),
        )
        self._conn.commit()
        return self.get_codex_openclaw_sync_outbox(item["id"])

    def mark_codex_openclaw_sync_sent(self, outbox_id: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE codex_openclaw_sync_outbox
            SET status = 'sent',
                last_error = NULL,
                sent_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (now, now, outbox_id),
        )
        self._conn.commit()
        return self.get_codex_openclaw_sync_outbox(outbox_id)

    def mark_codex_openclaw_sync_failed(self, outbox_id: str, *, last_error: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE codex_openclaw_sync_outbox
            SET status = 'failed',
                last_error = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (last_error, now, outbox_id),
        )
        self._conn.commit()
        return self.get_codex_openclaw_sync_outbox(outbox_id)

    def _codex_knowledge_extraction_outbox_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["payload"] = self._json_loads(item.pop("payload_json", None), {})
        return item

    def enqueue_codex_knowledge_extraction(
        self,
        *,
        pet_session_id: str,
        codex_session_id: str,
        source_hash: str,
        payload: dict[str, Any],
        openclaw_session_key: str,
        requeue_failed: bool = False,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        outbox_id = f"codex_knowledge_extraction_{uuid4().hex}"
        self._conn.execute(
            """
            INSERT INTO codex_knowledge_extraction_outbox (
                id, pet_session_id, codex_session_id, source_hash, payload_json,
                status, attempt_count, next_attempt_at, last_error,
                openclaw_session_key, created_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?, ?, NULL)
            ON CONFLICT(pet_session_id, source_hash) DO UPDATE SET
                updated_at = codex_knowledge_extraction_outbox.updated_at
            """,
            (
                outbox_id,
                pet_session_id,
                codex_session_id,
                source_hash,
                json.dumps(payload, ensure_ascii=False),
                now,
                openclaw_session_key,
                now,
                now,
            ),
        )
        self._conn.commit()
        row = self._conn.execute(
            """
            SELECT *
            FROM codex_knowledge_extraction_outbox
            WHERE pet_session_id = ? AND source_hash = ?
            """,
            (pet_session_id, source_hash),
        ).fetchone()
        item = self._codex_knowledge_extraction_outbox_row(row) or {}
        if requeue_failed and item.get("status") == "failed":
            self._conn.execute(
                """
                UPDATE codex_knowledge_extraction_outbox
                SET codex_session_id = ?,
                    payload_json = ?,
                    status = 'pending',
                    attempt_count = 0,
                    next_attempt_at = ?,
                    last_error = NULL,
                    openclaw_session_key = ?,
                    updated_at = ?,
                    completed_at = NULL
                WHERE id = ? AND status = 'failed'
                """,
                (
                    codex_session_id,
                    json.dumps(payload, ensure_ascii=False),
                    now,
                    openclaw_session_key,
                    now,
                    item["id"],
                ),
            )
            self._conn.commit()
            return self.get_codex_knowledge_extraction_outbox(item["id"]) or {}
        return item

    def get_codex_knowledge_extraction_outbox(self, outbox_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM codex_knowledge_extraction_outbox WHERE id = ?",
            (outbox_id,),
        ).fetchone()
        return self._codex_knowledge_extraction_outbox_row(row)

    def claim_next_codex_knowledge_extraction(self, *, now_iso: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT *
            FROM codex_knowledge_extraction_outbox
            WHERE status = 'pending'
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            """,
            (now_iso,),
        ).fetchone()
        if row is None:
            return None
        item = self._codex_knowledge_extraction_outbox_row(row)
        if item is None:
            return None
        self._conn.execute(
            """
            UPDATE codex_knowledge_extraction_outbox
            SET status = 'sending',
                attempt_count = attempt_count + 1,
                updated_at = ?
            WHERE id = ?
            """,
            (now_iso, item["id"]),
        )
        self._conn.commit()
        return self.get_codex_knowledge_extraction_outbox(item["id"])

    def mark_codex_knowledge_extraction_succeeded(self, outbox_id: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE codex_knowledge_extraction_outbox
            SET status = 'succeeded',
                last_error = NULL,
                completed_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (now, now, outbox_id),
        )
        self._conn.commit()
        return self.get_codex_knowledge_extraction_outbox(outbox_id)

    def mark_codex_knowledge_extraction_failed(self, outbox_id: str, *, last_error: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE codex_knowledge_extraction_outbox
            SET status = 'failed',
                last_error = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (last_error, now, outbox_id),
        )
        self._conn.commit()
        return self.get_codex_knowledge_extraction_outbox(outbox_id)

    def _codex_session_knowledge_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["domain"] = self._json_loads(item.pop("domain_json", None), {})
        item["concepts"] = self._json_loads(item.pop("concepts_json", None), [])
        item["rule_concepts"] = self._json_loads(item.pop("rule_concepts_json", None), [])
        item["methodologies"] = self._json_loads(item.pop("methodologies_json", None), [])
        item["failure_taxonomy"] = self._json_loads(item.pop("failure_taxonomy_json", None), [])
        item["verification_rules"] = self._json_loads(item.pop("verification_rules_json", None), [])
        item["timeline"] = self._json_loads(item.pop("timeline_json", None), [])
        item["code_blocks"] = self._json_loads(item.pop("code_blocks_json", None), [])
        item["reusable_summary"] = self._json_loads(item.pop("reusable_summary_json", None), {})
        raw_response = self._json_loads(item.pop("raw_response_json", None), {})
        item["raw_response"] = raw_response
        item["disposition"] = raw_response.get("disposition")
        item["assessment"] = raw_response.get("assessment") or {}
        item["wiki_candidates"] = raw_response.get("wiki_candidates") or []
        item["domain_knowledge_candidates"] = raw_response.get("candidates") or []
        item["rejected_items"] = raw_response.get("rejected_items") or []
        item["code_index"] = raw_response.get("code_index") or []
        return item

    def upsert_codex_session_knowledge(
        self,
        *,
        workspace_id: str | None,
        pet_session_id: str,
        codex_session_id: str,
        source_hash: str,
        extractor_version: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        knowledge_id = f"codex_session_knowledge_{uuid4().hex}"
        self._conn.execute(
            """
            INSERT INTO codex_session_knowledge (
                id, workspace_id, pet_session_id, codex_session_id, source_hash,
                extractor_version, domain_json, concepts_json, rule_concepts_json,
                methodologies_json, failure_taxonomy_json, verification_rules_json,
                timeline_json, code_blocks_json, reusable_summary_json, raw_response_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pet_session_id, source_hash) DO UPDATE SET
                workspace_id = excluded.workspace_id,
                codex_session_id = excluded.codex_session_id,
                extractor_version = excluded.extractor_version,
                domain_json = excluded.domain_json,
                concepts_json = excluded.concepts_json,
                rule_concepts_json = excluded.rule_concepts_json,
                methodologies_json = excluded.methodologies_json,
                failure_taxonomy_json = excluded.failure_taxonomy_json,
                verification_rules_json = excluded.verification_rules_json,
                timeline_json = excluded.timeline_json,
                code_blocks_json = excluded.code_blocks_json,
                reusable_summary_json = excluded.reusable_summary_json,
                raw_response_json = excluded.raw_response_json,
                updated_at = excluded.updated_at
            """,
            (
                knowledge_id,
                workspace_id,
                pet_session_id,
                codex_session_id,
                source_hash,
                extractor_version,
                json.dumps(payload.get("domain") or {}, ensure_ascii=False),
                json.dumps(payload.get("concepts") or [], ensure_ascii=False),
                json.dumps(payload.get("rule_concepts") or [], ensure_ascii=False),
                json.dumps(payload.get("methodologies") or [], ensure_ascii=False),
                json.dumps(payload.get("failure_taxonomy") or [], ensure_ascii=False),
                json.dumps(payload.get("verification_rules") or [], ensure_ascii=False),
                json.dumps(payload.get("timeline") or [], ensure_ascii=False),
                json.dumps(payload.get("code_blocks") or [], ensure_ascii=False),
                json.dumps(payload.get("reusable_summary") or {}, ensure_ascii=False),
                json.dumps(payload, ensure_ascii=False),
                now,
                now,
            ),
        )
        self._conn.commit()
        row = self._conn.execute(
            """
            SELECT *
            FROM codex_session_knowledge
            WHERE pet_session_id = ? AND source_hash = ?
            """,
            (pet_session_id, source_hash),
        ).fetchone()
        return self._codex_session_knowledge_row(row) or {}

    def get_latest_codex_session_knowledge(self, pet_session_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT *
            FROM codex_session_knowledge
            WHERE pet_session_id = ?
            ORDER BY updated_at DESC, created_at DESC, id ASC
            LIMIT 1
            """,
            (pet_session_id,),
        ).fetchone()
        return self._codex_session_knowledge_row(row)

    def list_codex_session_knowledge(
        self,
        *,
        pet_session_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if pet_session_id is not None:
            clauses.append("pet_session_id = ?")
            params.append(pet_session_id)
        if workspace_id is not None:
            clauses.append("workspace_id = ?")
            params.append(workspace_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        try:
            bounded_limit = max(1, min(int(limit), 100))
        except (TypeError, ValueError, OverflowError):
            bounded_limit = 50
        rows = self._conn.execute(
            f"""
            SELECT *
            FROM codex_session_knowledge
            {where}
            ORDER BY updated_at DESC, created_at DESC, id ASC
            LIMIT ?
            """,
            (*params, bounded_limit),
        ).fetchall()
        return [self._codex_session_knowledge_row(row) for row in rows if row is not None]

    def _codex_concept_delta_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["terms"] = self._json_loads(item.pop("terms_json", None), [])
        item["payload"] = self._json_loads(item.pop("payload_json", None), {})
        return item

    def upsert_codex_concept_delta(
        self,
        *,
        payload: dict[str, Any],
        raw_author_text: str,
        source_hash: str,
        author_text_sha256: str,
    ) -> dict[str, Any]:
        delta_id = str(payload.get("delta_id") or "").strip()
        if not delta_id:
            raise ValueError("Concept Delta delta_id is required")
        existing = self._conn.execute(
            "SELECT * FROM codex_concept_deltas WHERE delta_id = ?",
            (delta_id,),
        ).fetchone()
        if existing is not None:
            item = self._codex_concept_delta_row(existing) or {}
            if item.get("source_hash") != source_hash or item.get("author_text_sha256") != author_text_sha256:
                raise ValueError(f"Concept Delta {delta_id} is immutable")
            return item

        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO codex_concept_deltas (
                id, delta_id, workspace_id, codex_session_id, author,
                change_kind, terms_json, source_hash, author_text_sha256,
                raw_author_text, payload_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                delta_id,
                delta_id,
                payload["workspace_id"],
                payload["codex_session_id"],
                payload["author"],
                payload["change_kind"],
                json.dumps(payload.get("terms") or [], ensure_ascii=False),
                source_hash,
                author_text_sha256,
                raw_author_text,
                json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                now,
                now,
            ),
        )
        self._conn.commit()
        row = self._conn.execute(
            "SELECT * FROM codex_concept_deltas WHERE delta_id = ?",
            (delta_id,),
        ).fetchone()
        return self._codex_concept_delta_row(row) or {}

    def list_codex_concept_deltas(
        self,
        *,
        workspace_id: str | None = None,
        codex_session_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if workspace_id is not None:
            clauses.append("workspace_id = ?")
            params.append(workspace_id)
        if codex_session_id is not None:
            clauses.append("codex_session_id = ?")
            params.append(codex_session_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        bounded_limit = max(1, min(int(limit), 500))
        rows = self._conn.execute(
            f"""
            SELECT * FROM codex_concept_deltas
            {where}
            ORDER BY created_at ASC, delta_id ASC
            LIMIT ?
            """,
            (*params, bounded_limit),
        ).fetchall()
        return [item for row in rows if (item := self._codex_concept_delta_row(row)) is not None]

    def _domain_term_coverage_finding_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["details"] = self._json_loads(item.pop("details_json", None), {})
        return item

    def upsert_domain_term_coverage_finding(
        self,
        *,
        workspace_id: str,
        codex_session_id: str | None,
        scan_id: str | None,
        term: str,
        topic_kind: str | None,
        classification: str,
        source_hash: str,
        details: dict[str, Any],
        status: str = "open",
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        finding_id = f"domain_term_finding_{uuid4().hex}"
        self._conn.execute(
            """
            INSERT INTO domain_term_coverage_findings (
                id, workspace_id, codex_session_id, scan_id, term, topic_kind,
                classification, status, source_hash, details_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, codex_session_id, term, classification, source_hash) DO UPDATE SET
                updated_at = domain_term_coverage_findings.updated_at
            """,
            (
                finding_id,
                workspace_id,
                codex_session_id,
                scan_id,
                term,
                topic_kind,
                classification,
                status,
                source_hash,
                json.dumps(details, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                now,
                now,
            ),
        )
        self._conn.commit()
        row = self._conn.execute(
            """
            SELECT * FROM domain_term_coverage_findings
            WHERE workspace_id = ?
              AND codex_session_id IS ?
              AND term = ?
              AND classification = ?
              AND source_hash = ?
            """,
            (workspace_id, codex_session_id, term, classification, source_hash),
        ).fetchone()
        return self._domain_term_coverage_finding_row(row) or {}

    def list_domain_term_coverage_findings(
        self,
        *,
        workspace_id: str | None = None,
        codex_session_id: str | None = None,
        status: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if workspace_id is not None:
            clauses.append("workspace_id = ?")
            params.append(workspace_id)
        if codex_session_id is not None:
            clauses.append("codex_session_id = ?")
            params.append(codex_session_id)
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        bounded_limit = max(1, min(int(limit), 500))
        rows = self._conn.execute(
            f"""
            SELECT * FROM domain_term_coverage_findings
            {where}
            ORDER BY created_at ASC, id ASC
            LIMIT ?
            """,
            (*params, bounded_limit),
        ).fetchall()
        return [item for row in rows if (item := self._domain_term_coverage_finding_row(row)) is not None]

    def get_codex_review_control_plane_snapshot_state(self, session_key: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM codex_review_control_plane_snapshot_state WHERE session_key = ?",
            (session_key,),
        ).fetchone()
        if row is None:
            return None
        item = dict(row)
        item["response"] = self._json_loads(item.pop("response_json", None), {})
        return item

    def mark_codex_review_control_plane_snapshot_submitted(
        self,
        *,
        session_key: str,
        snapshot_cursor: str,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO codex_review_control_plane_snapshot_state (
                session_key, snapshot_cursor, response_json, submitted_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_key) DO UPDATE SET
                snapshot_cursor = excluded.snapshot_cursor,
                response_json = excluded.response_json,
                submitted_at = excluded.submitted_at,
                updated_at = excluded.updated_at
            """,
            (
                session_key,
                snapshot_cursor,
                json.dumps(response, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                now,
                now,
            ),
        )
        self._conn.commit()
        return self.get_codex_review_control_plane_snapshot_state(session_key) or {}

    @staticmethod
    def _domain_knowledge_payload_json(payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    def _domain_knowledge_candidate_version_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["payload"] = self._json_loads(item.pop("payload_json", None), {})
        return item

    def persist_domain_knowledge_candidate(self, payload: dict[str, Any]) -> dict[str, Any]:
        candidate_id = str(payload.get("candidate_id") or "").strip()
        candidate_revision = int(payload.get("candidate_revision") or 0)
        if not candidate_id or candidate_revision < 1:
            raise ValueError("candidate_id and candidate_revision are required")
        payload_json = self._domain_knowledge_payload_json(payload)
        existing_version = self._conn.execute(
            """
            SELECT * FROM domain_knowledge_candidate_versions
            WHERE candidate_id = ? AND candidate_revision = ?
            """,
            (candidate_id, candidate_revision),
        ).fetchone()
        if existing_version is not None:
            existing = self._domain_knowledge_candidate_version_row(existing_version) or {}
            if existing.get("content_hash") != payload.get("content_hash") or self._domain_knowledge_payload_json(
                existing.get("payload") or {}
            ) != payload_json:
                raise ValueError(f"Domain Knowledge candidate revision {candidate_id}:{candidate_revision} is immutable")
            return existing

        workspace_id = str(payload.get("workspace_id") or "").strip()
        source_kind = str(payload.get("source_kind") or "").strip()
        source_hash = str(payload.get("source_hash") or "").strip()
        topic_match = payload.get("topic_match") if isinstance(payload.get("topic_match"), dict) else {}
        topic_identity_key = str(topic_match.get("topic_identity_key") or "").strip()
        if not all((workspace_id, source_kind, source_hash, topic_identity_key, payload.get("content_hash"))):
            raise ValueError("candidate persistence fields are incomplete")

        now = _utc_now_iso()
        parent = self._conn.execute(
            "SELECT * FROM domain_knowledge_candidates WHERE candidate_id = ?",
            (candidate_id,),
        ).fetchone()
        if parent is not None:
            current = dict(parent)
            immutable_parent = (workspace_id, source_kind, source_hash, topic_identity_key)
            if immutable_parent != (
                current["workspace_id"],
                current["source_kind"],
                current["source_hash"],
                current["topic_identity_key"],
            ):
                raise ValueError(f"Domain Knowledge candidate {candidate_id} identity is immutable")
            if candidate_revision <= int(current["current_revision"]):
                raise ValueError(f"Domain Knowledge candidate revision {candidate_id}:{candidate_revision} is immutable")
        try:
            self._conn.execute("BEGIN")
            if parent is None:
                self._conn.execute(
                    """
                    INSERT INTO domain_knowledge_candidates (
                        candidate_id, workspace_id, source_kind, source_hash,
                        current_revision, topic_identity_key, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        candidate_id,
                        workspace_id,
                        source_kind,
                        source_hash,
                        candidate_revision,
                        topic_identity_key,
                        payload.get("status") or "draft",
                        now,
                        now,
                    ),
                )
            else:
                self._conn.execute(
                    """
                    UPDATE domain_knowledge_candidates
                    SET current_revision = ?, status = ?, updated_at = ?
                    WHERE candidate_id = ?
                    """,
                    (candidate_revision, payload.get("status") or "draft", now, candidate_id),
                )
            self._conn.execute(
                """
                INSERT INTO domain_knowledge_candidate_versions (
                    candidate_id, candidate_revision, content_hash, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (candidate_id, candidate_revision, payload["content_hash"], payload_json, now),
            )
            for raw_ref in payload.get("evidence_index") or []:
                if not isinstance(raw_ref, dict):
                    continue
                ref_id = str(raw_ref.get("ref_id") or "").strip()
                if not ref_id:
                    continue
                locator_payload = {
                    key: raw_ref.get(key)
                    for key in (
                        "repository_id",
                        "revision",
                        "role",
                        "path",
                        "symbol",
                        "line_start",
                        "line_end",
                        "snippet_sha256",
                        "resolver_uri",
                        "command",
                    )
                }
                locator_hash = "sha256:" + hashlib.sha256(
                    self._domain_knowledge_payload_json(locator_payload).encode("utf-8")
                ).hexdigest()
                ref_json = self._domain_knowledge_payload_json(raw_ref)
                existing_ref = self._conn.execute(
                    "SELECT payload_json FROM domain_knowledge_evidence_refs WHERE ref_id = ?",
                    (ref_id,),
                ).fetchone()
                if existing_ref is not None and str(existing_ref["payload_json"]) != ref_json:
                    raise ValueError(f"Domain Knowledge evidence reference {ref_id} is immutable")
                self._conn.execute(
                    """
                    INSERT OR IGNORE INTO domain_knowledge_evidence_refs (
                        ref_id, repository_id, revision, role, authority,
                        locator_hash, payload_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        ref_id,
                        raw_ref.get("repository_id"),
                        raw_ref.get("revision"),
                        raw_ref.get("role"),
                        raw_ref.get("authority"),
                        locator_hash,
                        ref_json,
                        now,
                    ),
                )
                self._conn.execute(
                    """
                    INSERT INTO domain_knowledge_candidate_evidence (
                        candidate_id, candidate_revision, ref_id, evidence_role, created_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (candidate_id, candidate_revision, ref_id, raw_ref.get("role"), now),
                )
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        return self.get_domain_knowledge_candidate_version(candidate_id, candidate_revision) or {}

    def get_domain_knowledge_candidate_version(
        self,
        candidate_id: str,
        candidate_revision: int,
    ) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM domain_knowledge_candidate_versions
            WHERE candidate_id = ? AND candidate_revision = ?
            """,
            (candidate_id, candidate_revision),
        ).fetchone()
        return self._domain_knowledge_candidate_version_row(row)

    def _domain_knowledge_candidate_delivery_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["payload"] = self._json_loads(item.pop("payload_json", None), {})
        return item

    def enqueue_domain_knowledge_candidate_delivery(
        self,
        *,
        run_id: str,
        candidate_id: str,
        candidate_revision: int,
        payload_hash: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        payload_json = self._domain_knowledge_payload_json(payload)
        existing_row = self._conn.execute(
            """
            SELECT * FROM domain_knowledge_candidate_deliveries
            WHERE run_id = ? AND candidate_id = ? AND candidate_revision = ?
            """,
            (run_id, candidate_id, candidate_revision),
        ).fetchone()
        if existing_row is not None:
            existing = self._domain_knowledge_candidate_delivery_row(existing_row) or {}
            if existing.get("payload_hash") != payload_hash or self._domain_knowledge_payload_json(
                existing.get("payload") or {}
            ) != payload_json:
                raise ValueError(f"Domain Knowledge candidate delivery {run_id}:{candidate_id}:{candidate_revision} is immutable")
            now = _utc_now_iso()
            self._conn.execute(
                """
                INSERT OR IGNORE INTO domain_knowledge_control_plane_runs (
                    run_id, command_cursor, publish_cursor, created_at, updated_at
                ) VALUES (?, NULL, NULL, ?, ?)
                """,
                (run_id, now, now),
            )
            self._conn.commit()
            return existing
        now = _utc_now_iso()
        delivery_id = f"domain_knowledge_delivery_{uuid4().hex}"
        self._conn.execute(
            """
            INSERT INTO domain_knowledge_candidate_deliveries (
                id, run_id, candidate_id, candidate_revision, payload_hash,
                payload_json, status, attempt_count, next_attempt_at,
                last_error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?)
            """,
            (
                delivery_id,
                run_id,
                candidate_id,
                candidate_revision,
                payload_hash,
                payload_json,
                now,
                now,
                now,
            ),
        )
        self._conn.execute(
            """
            INSERT OR IGNORE INTO domain_knowledge_control_plane_runs (
                run_id, command_cursor, publish_cursor, created_at, updated_at
            ) VALUES (?, NULL, NULL, ?, ?)
            """,
            (run_id, now, now),
        )
        self._conn.commit()
        return self.get_domain_knowledge_candidate_delivery(delivery_id) or {}

    def get_domain_knowledge_candidate_delivery(self, delivery_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM domain_knowledge_candidate_deliveries WHERE id = ?",
            (delivery_id,),
        ).fetchone()
        return self._domain_knowledge_candidate_delivery_row(row)

    def get_domain_knowledge_candidate_delivery_for_candidate(
        self,
        *,
        run_id: str,
        candidate_id: str,
        candidate_revision: int,
    ) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM domain_knowledge_candidate_deliveries
            WHERE run_id = ? AND candidate_id = ? AND candidate_revision = ?
            """,
            (run_id, candidate_id, candidate_revision),
        ).fetchone()
        return self._domain_knowledge_candidate_delivery_row(row)

    def claim_next_domain_knowledge_candidate_delivery(self, *, now_iso: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM domain_knowledge_candidate_deliveries
            WHERE status = 'pending'
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            """,
            (now_iso,),
        ).fetchone()
        item = self._domain_knowledge_candidate_delivery_row(row)
        if item is None:
            return None
        self._conn.execute(
            """
            UPDATE domain_knowledge_candidate_deliveries
            SET status = 'sending', attempt_count = attempt_count + 1, updated_at = ?
            WHERE id = ?
            """,
            (now_iso, item["id"]),
        )
        self._conn.commit()
        return self.get_domain_knowledge_candidate_delivery(item["id"])

    def mark_domain_knowledge_candidate_delivery_accepted(self, delivery_id: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE domain_knowledge_candidate_deliveries
            SET status = 'accepted', last_error = NULL, updated_at = ?
            WHERE id = ?
            """,
            (now, delivery_id),
        )
        self._conn.commit()
        return self.get_domain_knowledge_candidate_delivery(delivery_id)

    def get_domain_knowledge_control_plane_cursors(self, run_id: str) -> dict[str, Any]:
        row = self._conn.execute(
            "SELECT run_id, command_cursor, publish_cursor FROM domain_knowledge_control_plane_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if row is None:
            return {"run_id": run_id, "command_cursor": None, "publish_cursor": None}
        return dict(row)

    def list_domain_knowledge_control_plane_run_ids(self, *, limit: int = 20) -> list[str]:
        bounded_limit = max(1, min(int(limit), 100))
        rows = self._conn.execute(
            """
            SELECT run_id
            FROM domain_knowledge_control_plane_runs
            ORDER BY updated_at ASC, run_id ASC
            LIMIT ?
            """,
            (bounded_limit,),
        ).fetchall()
        return [str(row["run_id"]) for row in rows]

    def update_domain_knowledge_control_plane_cursors(
        self,
        *,
        run_id: str,
        command_cursor: str | None = None,
        publish_cursor: str | None = None,
    ) -> dict[str, Any]:
        current = self.get_domain_knowledge_control_plane_cursors(run_id)
        next_command_cursor = command_cursor if command_cursor is not None else current["command_cursor"]
        next_publish_cursor = publish_cursor if publish_cursor is not None else current["publish_cursor"]
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO domain_knowledge_control_plane_runs (
                run_id, command_cursor, publish_cursor, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET
                command_cursor = excluded.command_cursor,
                publish_cursor = excluded.publish_cursor,
                updated_at = excluded.updated_at
            """,
            (run_id, next_command_cursor, next_publish_cursor, now, now),
        )
        self._conn.commit()
        return self.get_domain_knowledge_control_plane_cursors(run_id)

    def _domain_knowledge_control_plane_command_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["payload"] = self._json_loads(item.pop("payload_json", None), {})
        item["result"] = self._json_loads(item.pop("result_json", None), None)
        return item

    def get_domain_knowledge_control_plane_command(self, command_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM domain_knowledge_control_plane_commands WHERE command_id = ?",
            (command_id,),
        ).fetchone()
        return self._domain_knowledge_control_plane_command_row(row)

    def _domain_knowledge_wiki_change_set_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["payload"] = self._json_loads(item.pop("payload_json", None), {})
        return item

    def get_domain_knowledge_wiki_change_set(self, change_set_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM domain_knowledge_wiki_change_sets WHERE change_set_id = ?",
            (change_set_id,),
        ).fetchone()
        item = self._domain_knowledge_wiki_change_set_row(row)
        if item is None:
            return None
        return {**(item.get("payload") or {}), **item}

    def list_pending_domain_knowledge_wiki_change_sets(
        self,
        *,
        run_id: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        bounded_limit = max(1, min(int(limit), 100))
        if run_id is None:
            rows = self._conn.execute(
                """
                SELECT * FROM domain_knowledge_wiki_change_sets
                WHERE publish_status = 'pending'
                ORDER BY created_at ASC, change_set_id ASC
                LIMIT ?
                """,
                (bounded_limit,),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """
                SELECT cs.*
                FROM domain_knowledge_wiki_change_sets cs
                JOIN domain_knowledge_control_plane_commands cmd
                  ON cmd.command_id = cs.decision_command_id
                WHERE cs.publish_status = 'pending' AND cmd.run_id = ?
                ORDER BY cs.created_at ASC, cs.change_set_id ASC
                LIMIT ?
                """,
                (run_id, bounded_limit),
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = self._domain_knowledge_wiki_change_set_row(row)
            if item is not None:
                items.append({**(item.get("payload") or {}), **item})
        return items

    def mark_domain_knowledge_wiki_change_set_publishing(self, change_set_id: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE domain_knowledge_wiki_change_sets
            SET publish_status = 'publishing', updated_at = ?
            WHERE change_set_id = ? AND publish_status IN ('pending', 'publishing')
            """,
            (now, change_set_id),
        )
        self._conn.commit()
        return self.get_domain_knowledge_wiki_change_set(change_set_id)

    def persist_domain_knowledge_review_application(
        self,
        *,
        run_id: str,
        cursor: str | None,
        command_payload: dict[str, Any],
        command_payload_hash: str,
        decision_payload: dict[str, Any],
        change_set_payload: dict[str, Any] | None,
        result: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        command_id = str(decision_payload.get("command_id") or "").strip()
        command_json = self._domain_knowledge_payload_json(command_payload)
        existing = self.get_domain_knowledge_control_plane_command(command_id)
        if existing is not None:
            if existing.get("payload_hash") != command_payload_hash or self._domain_knowledge_payload_json(
                existing.get("payload") or {}
            ) != command_json:
                raise ValueError(f"Domain Knowledge command {command_id} is immutable")
            return existing.get("result") or {}, True

        now = _utc_now_iso()
        decision_json = self._domain_knowledge_payload_json(decision_payload)
        result_json = self._domain_knowledge_payload_json(result)
        try:
            self._conn.execute("BEGIN")
            self._conn.execute(
                """
                INSERT INTO domain_knowledge_control_plane_commands (
                    command_id, run_id, command_kind, cursor, payload_hash,
                    payload_json, status, result_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    command_id,
                    run_id,
                    decision_payload.get("kind") or "project_domain_knowledge_review_decision",
                    cursor,
                    command_payload_hash,
                    command_json,
                    "applied",
                    result_json,
                    now,
                    now,
                ),
            )
            self._conn.execute(
                """
                INSERT INTO domain_knowledge_review_decisions (
                    command_id, candidate_id, candidate_revision, idempotency_key,
                    payload_hash, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    command_id,
                    decision_payload["candidate_id"],
                    decision_payload["candidate_revision"],
                    decision_payload["idempotency_key"],
                    command_payload_hash,
                    decision_json,
                    now,
                ),
            )
            if change_set_payload is not None:
                self._conn.execute(
                    """
                    INSERT INTO domain_knowledge_wiki_change_sets (
                        change_set_id, candidate_id, candidate_revision,
                        decision_command_id, approved_document_sha256,
                        publish_status, payload_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        change_set_payload["change_set_id"],
                        change_set_payload["candidate_id"],
                        change_set_payload["candidate_revision"],
                        command_id,
                        change_set_payload["approved_document_sha256"],
                        change_set_payload["publish_status"],
                        self._domain_knowledge_payload_json(change_set_payload),
                        now,
                        now,
                    ),
                )
            current = self.get_domain_knowledge_control_plane_cursors(run_id)
            self._conn.execute(
                """
                INSERT INTO domain_knowledge_control_plane_runs (
                    run_id, command_cursor, publish_cursor, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    command_cursor = excluded.command_cursor,
                    publish_cursor = excluded.publish_cursor,
                    updated_at = excluded.updated_at
                """,
                (run_id, cursor, current["publish_cursor"], now, now),
            )
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        return result, False

    def persist_domain_knowledge_publication_receipt(self, payload: dict[str, Any]) -> dict[str, Any]:
        change_set_id = str(payload.get("change_set_id") or "").strip()
        payload_json = self._domain_knowledge_payload_json(payload)
        existing = self._conn.execute(
            "SELECT payload_json FROM domain_knowledge_publication_receipts WHERE change_set_id = ?",
            (change_set_id,),
        ).fetchone()
        if existing is not None:
            existing_payload = self._json_loads(existing["payload_json"], {})
            if self._domain_knowledge_payload_json(existing_payload) != payload_json:
                raise ValueError(f"Domain Knowledge publication receipt {change_set_id} is immutable")
            return existing_payload
        now = _utc_now_iso()
        try:
            self._conn.execute("BEGIN")
            self._conn.execute(
                """
                INSERT INTO domain_knowledge_publication_receipts (
                    change_set_id, status, published_content_sha256,
                    payload_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    change_set_id,
                    payload["status"],
                    payload.get("published_content_sha256"),
                    payload_json,
                    now,
                    now,
                ),
            )
            self._conn.execute(
                """
                UPDATE domain_knowledge_wiki_change_sets
                SET publish_status = ?, updated_at = ?
                WHERE change_set_id = ?
                """,
                (payload["status"], now, change_set_id),
            )
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        return payload

    def create_codex_review_item(
        self,
        *,
        item_id: str,
        pet_session_id: str,
        codex_session_id: str,
        item_type: str,
        title: str,
        summary: str | None,
        details: dict[str, Any] | None,
        tags: list[str] | None,
        severity: str | None,
        status: str,
        source: str,
        source_hash: str,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO codex_review_items (
                id, pet_session_id, codex_session_id, item_type, title,
                summary, details_json, tags_json, severity, status, source,
                source_hash, created_at, updated_at, reviewed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(pet_session_id, item_type, source_hash) DO UPDATE SET
                title = excluded.title,
                summary = excluded.summary,
                details_json = excluded.details_json,
                tags_json = excluded.tags_json,
                severity = excluded.severity,
                status = excluded.status,
                source = excluded.source,
                updated_at = excluded.updated_at
            """,
            (
                item_id,
                pet_session_id,
                codex_session_id,
                item_type,
                title,
                summary,
                json.dumps(details or {}, ensure_ascii=False),
                json.dumps(tags or [], ensure_ascii=False),
                severity,
                status,
                source,
                source_hash,
                now,
                now,
            ),
        )
        self._conn.commit()
        row = self._conn.execute(
            """
            SELECT *
            FROM codex_review_items
            WHERE pet_session_id = ? AND item_type = ? AND source_hash = ?
            """,
            (pet_session_id, item_type, source_hash),
        ).fetchone()
        return self._codex_review_item_row(row) or {}

    def _codex_review_item_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["details"] = self._json_loads(item.pop("details_json", None), {})
        tags = self._json_loads(item.pop("tags_json", None), [])
        item["tags"] = tags if isinstance(tags, list) else []
        return item

    def list_codex_review_items(
        self,
        *,
        pet_session_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if pet_session_id is not None:
            clauses.append("pet_session_id = ?")
            params.append(pet_session_id)
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        try:
            bounded_limit = max(1, min(int(limit), 100))
        except (TypeError, ValueError, OverflowError):
            bounded_limit = 50
        rows = self._conn.execute(
            f"""
            SELECT *
            FROM codex_review_items
            {where}
            ORDER BY created_at ASC, id ASC
            LIMIT ?
            """,
            (*params, bounded_limit),
        ).fetchall()
        return [self._codex_review_item_row(row) for row in rows if row is not None]

    def get_codex_review_item(self, item_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM codex_review_items WHERE id = ?",
            (item_id,),
        ).fetchone()
        return self._codex_review_item_row(row)

    def update_codex_review_item_status(
        self,
        item_id: str,
        *,
        status: str,
        details_patch: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        item = self.get_codex_review_item(item_id)
        if item is None:
            return None
        now = _utc_now_iso()
        details = dict(item.get("details") or {})
        if details_patch:
            details.update(details_patch)
        self._conn.execute(
            """
            UPDATE codex_review_items
            SET status = ?,
                details_json = ?,
                reviewed_at = COALESCE(reviewed_at, ?),
                updated_at = ?
            WHERE id = ?
            """,
            (status, json.dumps(details, ensure_ascii=False), now, now, item_id),
        )
        self._conn.commit()
        return self.get_codex_review_item(item_id)

    @staticmethod
    def _codex_review_priority(item: dict[str, Any]) -> int:
        item_type = str(item.get("item_type") or "")
        severity = str(item.get("severity") or "").lower()
        if item_type == "blocker":
            return 100
        if item_type == "pitfall" and severity == "high":
            return 90
        if item_type == "pitfall" and severity == "medium":
            return 80
        if item_type == "pitfall":
            return 75
        if item_type == "decision":
            return 70
        if item_type == "followup":
            return 60
        return 40

    def list_codex_review_drafts(
        self,
        *,
        workspace_id: str | None = None,
        limit: int = 20,
        now_iso: str | None = None,
        include_unscoped: bool = False,
        updated_from_iso: str | None = None,
        updated_before_iso: str | None = None,
    ) -> list[dict[str, Any]]:
        try:
            bounded_limit = max(1, min(int(limit), 100))
        except (TypeError, ValueError, OverflowError):
            bounded_limit = 20
        clauses = ["ri.status IN ('draft', 'snoozed')"]
        params: list[Any] = []
        if updated_from_iso is not None:
            clauses.append("ri.updated_at >= ?")
            params.append(updated_from_iso)
        if updated_before_iso is not None:
            clauses.append("ri.updated_at < ?")
            params.append(updated_before_iso)
        rows = self._conn.execute(
            f"""
            SELECT ri.*, dps.workspace_id AS review_workspace_id
            FROM codex_review_items ri
            LEFT JOIN desktop_pet_sessions dps ON dps.pet_session_id = ri.pet_session_id
            WHERE {' AND '.join(clauses)}
            ORDER BY ri.created_at ASC, ri.id ASC
            """,
            params,
        ).fetchall()
        now = _parse_iso_datetime(now_iso or _utc_now_iso()) or datetime.now(UTC)
        items: list[dict[str, Any]] = []
        for row in rows:
            item = self._codex_review_item_row(row)
            if item is None:
                continue
            item["workspace_id"] = item.pop("review_workspace_id", None)
            item_workspace_id = item.get("workspace_id")
            if workspace_id is not None and item_workspace_id != workspace_id:
                if include_unscoped and item_workspace_id is None:
                    item["workspace_id"] = workspace_id
                else:
                    continue
            if item.get("status") == "snoozed":
                snooze_until = _parse_iso_datetime((item.get("details") or {}).get("snooze_until"))
                if snooze_until is not None and snooze_until > now:
                    continue
            item["priority_score"] = self._codex_review_priority(item)
            items.append(item)
        items.sort(key=lambda item: (-int(item["priority_score"]), str(item.get("created_at") or ""), str(item["id"])))
        return items[:bounded_limit]

    def get_codex_review_daily_summary(
        self,
        *,
        review_date: str,
        workspace_id: str | None = None,
        include_unscoped: bool = False,
    ) -> dict[str, Any]:
        drafts = self.list_codex_review_drafts(
            workspace_id=workspace_id,
            limit=100,
            include_unscoped=include_unscoped,
        )
        high_priority_count = sum(1 for item in drafts if int(item.get("priority_score") or 0) >= 80)
        clauses = [
            "substr(COALESCE(ri.reviewed_at, ''), 1, 10) = ?",
            "ri.status IN ('accepted', 'edited_accepted', 'ignored', 'snoozed')",
        ]
        params: list[Any] = [review_date]
        if workspace_id is not None:
            clauses.append("dps.workspace_id = ?")
            params.append(workspace_id)
        rows = self._conn.execute(
            f"""
            SELECT ri.status, COUNT(*) AS count
            FROM codex_review_items ri
            LEFT JOIN desktop_pet_sessions dps ON dps.pet_session_id = ri.pet_session_id
            WHERE {' AND '.join(clauses)}
            GROUP BY ri.status
            """,
            params,
        ).fetchall()
        counts = {str(row["status"]): int(row["count"]) for row in rows}
        accepted_today = counts.get("accepted", 0) + counts.get("edited_accepted", 0)
        draft_count = len(drafts)
        return {
            "date": review_date,
            "workspace_id": workspace_id,
            "draft_count": draft_count,
            "high_priority_count": high_priority_count,
            "accepted_today": accepted_today,
            "ignored_today": counts.get("ignored", 0),
            "snoozed_today": counts.get("snoozed", 0),
            "recommended_batch_size": min(3, draft_count),
        }

    def _codex_review_memory_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["details"] = self._json_loads(item.pop("details_json", None), {})
        tags = self._json_loads(item.pop("tags_json", None), [])
        evidence_refs = self._json_loads(item.pop("evidence_refs_json", None), [])
        item["tags"] = tags if isinstance(tags, list) else []
        item["evidence_refs"] = evidence_refs if isinstance(evidence_refs, list) else []
        return item

    def _codex_review_memory_version_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["details"] = self._json_loads(item.pop("details_json", None), {})
        return item

    def create_codex_review_memory_from_item(
        self,
        *,
        review_item_id: str,
        title: str,
        body: str | None,
        memory_draft: dict[str, Any] | None = None,
        confirmed_by: str,
        created_by: str | None = None,
        default_workspace_id: str | None = None,
    ) -> dict[str, Any]:
        existing = self._conn.execute(
            "SELECT * FROM codex_review_memory WHERE source_review_item_id = ?",
            (review_item_id,),
        ).fetchone()
        if existing is not None:
            return self._codex_review_memory_row(existing) or {}
        review = self.get_codex_review_item(review_item_id)
        if review is None:
            raise ValueError(f"codex review item not found: {review_item_id}")
        pet_session = self.get_desktop_pet_session(str(review["pet_session_id"]))
        workspace_id = str((pet_session or {}).get("workspace_id") or default_workspace_id or "unknown")
        review_details = review.get("details") or {}
        evidence_refs = review_details.get("evidence_refs") if isinstance(review_details, dict) else []
        if not isinstance(evidence_refs, list):
            evidence_refs = []
        now = _utc_now_iso()
        memory_id = f"codex_review_memory_{uuid4().hex}"
        memory_title = str(title or review.get("title") or review.get("item_type") or "Codex review memory")[:240]
        if isinstance(memory_draft, dict):
            memory_details = dict(memory_draft)
        else:
            memory_details = _build_codex_review_memory_details(
                review,
                override_problem=body if body is not None else None,
            )
        memory_body = _render_codex_review_memory_body(memory_title, memory_details)
        self._conn.execute(
            """
            INSERT INTO codex_review_memory (
                id, workspace_id, source_review_item_id, pet_session_id, codex_session_id,
                memory_type, title, body, details_json, tags_json, evidence_refs_json, source_hash,
                created_by, confirmed_by, confirmed_at, current_version, export_status,
                openkb_document_id, export_error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', NULL, NULL, ?, ?)
            """,
            (
                memory_id,
                workspace_id,
                review_item_id,
                review["pet_session_id"],
                review["codex_session_id"],
                review["item_type"],
                memory_title,
                memory_body,
                json.dumps(memory_details, ensure_ascii=False),
                json.dumps(review.get("tags") or [], ensure_ascii=False),
                json.dumps(evidence_refs, ensure_ascii=False),
                review["source_hash"],
                created_by or confirmed_by,
                confirmed_by,
                now,
                now,
                now,
            ),
        )
        self._conn.execute(
            """
            INSERT INTO codex_review_memory_versions (
                id, memory_id, version, title, body, details_json, edited_by, created_at
            ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
            """,
            (
                f"codex_review_memory_version_{uuid4().hex}",
                memory_id,
                memory_title,
                memory_body,
                json.dumps(memory_details, ensure_ascii=False),
                confirmed_by,
                now,
            ),
        )
        self._conn.commit()
        return self.get_codex_review_memory(memory_id) or {}

    def get_codex_review_memory(self, memory_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM codex_review_memory WHERE id = ?",
            (memory_id,),
        ).fetchone()
        return self._codex_review_memory_row(row)

    def get_codex_review_memory_by_review_item(self, review_item_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM codex_review_memory WHERE source_review_item_id = ?",
            (review_item_id,),
        ).fetchone()
        return self._codex_review_memory_row(row)

    def list_codex_review_memory(
        self,
        *,
        workspace_id: str | None = None,
        export_status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if workspace_id is not None:
            clauses.append("workspace_id = ?")
            params.append(workspace_id)
        if export_status is not None:
            clauses.append("export_status = ?")
            params.append(export_status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        try:
            bounded_limit = max(1, min(int(limit), 100))
        except (TypeError, ValueError, OverflowError):
            bounded_limit = 50
        rows = self._conn.execute(
            f"""
            SELECT *
            FROM codex_review_memory
            {where}
            ORDER BY created_at ASC, id ASC
            LIMIT ?
            """,
            (*params, bounded_limit),
        ).fetchall()
        return [self._codex_review_memory_row(row) for row in rows if row is not None]

    def append_codex_review_memory_version(
        self,
        memory_id: str,
        *,
        title: str,
        body: str,
        details: dict[str, Any] | None = None,
        edited_by: str,
    ) -> dict[str, Any]:
        memory = self.get_codex_review_memory(memory_id)
        if memory is None:
            raise ValueError(f"codex review memory not found: {memory_id}")
        next_version = int(memory.get("current_version") or 1) + 1
        now = _utc_now_iso()
        next_details = details if isinstance(details, dict) else dict(memory.get("details") or {})
        self._conn.execute(
            """
            INSERT INTO codex_review_memory_versions (
                id, memory_id, version, title, body, details_json, edited_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"codex_review_memory_version_{uuid4().hex}",
                memory_id,
                next_version,
                title,
                body,
                json.dumps(next_details, ensure_ascii=False),
                edited_by,
                now,
            ),
        )
        self._conn.execute(
            """
            UPDATE codex_review_memory
            SET title = ?,
                body = ?,
                details_json = ?,
                current_version = ?,
                export_status = 'pending',
                export_error = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (title, body, json.dumps(next_details, ensure_ascii=False), next_version, now, memory_id),
        )
        self._conn.commit()
        return self.get_codex_review_memory(memory_id) or {}

    def list_codex_review_memory_versions(self, memory_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT *
            FROM codex_review_memory_versions
            WHERE memory_id = ?
            ORDER BY version ASC
            """,
            (memory_id,),
        ).fetchall()
        return [self._codex_review_memory_version_row(row) for row in rows if row is not None]

    def mark_codex_review_memory_exported(self, memory_id: str, *, document_id: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE codex_review_memory
            SET export_status = 'synced',
                openkb_document_id = ?,
                export_error = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (document_id, now, memory_id),
        )
        self._conn.commit()
        return self.get_codex_review_memory(memory_id)

    def mark_codex_review_memory_export_submitted(self, memory_id: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE codex_review_memory
            SET export_status = 'submitted',
                export_error = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (now, memory_id),
        )
        self._conn.commit()
        return self.get_codex_review_memory(memory_id)

    def mark_codex_review_memory_export_failed(self, memory_id: str, *, error: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        # Don't overwrite terminal 'synced' state - a memory that was already
        # successfully published should not be regressed by a stale publish-status poll.
        self._conn.execute(
            """
            UPDATE codex_review_memory
            SET export_status = 'export_failed',
                export_error = ?,
                updated_at = ?
            WHERE id = ? AND export_status != 'synced'
            """,
            (error, now, memory_id),
        )
        self._conn.commit()
        return self.get_codex_review_memory(memory_id)

    def resolve_account(self, external_user_id: str) -> dict[str, Any]:
        external_user_id = external_user_id.strip()
        if not external_user_id:
            raise ValueError("external_user_id is required")
        now = _utc_now_iso()
        row = self._conn.execute(
            "SELECT * FROM accounts WHERE external_user_id = ?",
            (external_user_id,),
        ).fetchone()
        if row is None:
            account_id = str(uuid4())
            self._conn.execute(
                """
                INSERT INTO accounts (id, external_user_id, display_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (account_id, external_user_id, external_user_id, now, now),
            )
            row = self._conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
            self._conn.commit()
        account = dict(row)
        self.ensure_personal_workspace(account["id"], external_user_id)
        return account

    def ensure_personal_workspace(self, account_id: str, external_user_id: str) -> dict[str, Any]:
        row = self._conn.execute(
            """
            SELECT w.*
            FROM workspaces w
            JOIN workspace_members wm ON wm.workspace_id = w.id
            WHERE wm.account_id = ? AND w.kind = 'personal'
            ORDER BY w.created_at ASC
            LIMIT 1
            """,
            (account_id,),
        ).fetchone()
        if row:
            return dict(row)
        now = _utc_now_iso()
        workspace_id = str(uuid4())
        self._conn.execute(
            """
            INSERT INTO workspaces (id, name, kind, owner_account_id, created_at, updated_at)
            VALUES (?, ?, 'personal', ?, ?, ?)
            """,
            (workspace_id, f"{external_user_id}'s workspace", account_id, now, now),
        )
        self._conn.execute(
            """
            INSERT INTO workspace_members (workspace_id, account_id, role, created_at)
            VALUES (?, ?, 'owner', ?)
            """,
            (workspace_id, account_id, now),
        )
        self._conn.commit()
        return dict(self._conn.execute("SELECT * FROM workspaces WHERE id = ?", (workspace_id,)).fetchone())

    def get_current_workspace_context(self, external_user_id: str) -> dict[str, Any]:
        account = self.resolve_account(external_user_id)
        workspace = self.ensure_personal_workspace(account["id"], account["external_user_id"])
        membership = self._conn.execute(
            "SELECT * FROM workspace_members WHERE workspace_id = ? AND account_id = ?",
            (workspace["id"], account["id"]),
        ).fetchone()
        return {"account": account, "workspace": workspace, "membership": dict(membership)}

    def create_session(
        self,
        workspace_id: str,
        account_id: str,
        *,
        title: str | None = None,
        selected_model_path: str | None = None,
        openclaw_session_key: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        session_id = str(uuid4())
        resolved_openclaw_session_key = (
            openclaw_session_key or f"openclaw:{session_id}"
        ).strip() or f"openclaw:{session_id}"
        self._conn.execute(
            """
            INSERT INTO sessions (
                id, workspace_id, account_id, openclaw_session_key, title, title_source,
                selected_model_path, created_at, updated_at, deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (
                session_id,
                workspace_id,
                account_id,
                resolved_openclaw_session_key,
                (title or "新对话").strip() or "新对话",
                "manual" if title else "default",
                selected_model_path,
                now,
                now,
            ),
        )
        self._conn.commit()
        return self.get_session(workspace_id, account_id, session_id)  # type: ignore[return-value]

    def update_session_openclaw_session_key(
        self,
        workspace_id: str,
        account_id: str,
        session_id: str,
        openclaw_session_key: str,
    ) -> dict[str, Any] | None:
        session = self.get_session(workspace_id, account_id, session_id)
        resolved_openclaw_session_key = openclaw_session_key.strip()
        if session is None or not resolved_openclaw_session_key:
            return session
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE sessions
            SET openclaw_session_key = ?, updated_at = ?
            WHERE id = ? AND workspace_id = ? AND account_id = ?
            """,
            (resolved_openclaw_session_key, now, session_id, workspace_id, account_id),
        )
        self._conn.commit()
        return self.get_session(workspace_id, account_id, session_id)

    def list_sessions(self, workspace_id: str, account_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT * FROM sessions
            WHERE workspace_id = ? AND account_id = ? AND deleted_at IS NULL
            ORDER BY updated_at DESC
            """,
            (workspace_id, account_id),
        ).fetchall()
        return [dict(row) for row in rows]

    def get_session(self, workspace_id: str, account_id: str, session_id: str) -> dict[str, Any] | None:
        return self._row_to_dict(
            self._conn.execute(
                """
                SELECT * FROM sessions
                WHERE id = ? AND workspace_id = ? AND account_id = ? AND deleted_at IS NULL
                """,
                (session_id, workspace_id, account_id),
            ).fetchone()
        )

    def update_session(
        self,
        workspace_id: str,
        account_id: str,
        session_id: str,
        *,
        title: str | None = None,
        selected_model_path: str | None = None,
    ) -> dict[str, Any] | None:
        session = self.get_session(workspace_id, account_id, session_id)
        if session is None:
            return None
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE sessions
            SET title = ?, title_source = ?, selected_model_path = COALESCE(?, selected_model_path), updated_at = ?
            WHERE id = ? AND workspace_id = ? AND account_id = ?
            """,
            (
                (title or session["title"]).strip() or session["title"],
                "manual" if title else session["title_source"],
                selected_model_path,
                now,
                session_id,
                workspace_id,
                account_id,
            ),
        )
        self._conn.commit()
        return self.get_session(workspace_id, account_id, session_id)

    def soft_delete_session(self, workspace_id: str, account_id: str, session_id: str) -> dict[str, Any] | None:
        session = self.get_session(workspace_id, account_id, session_id)
        if session is None:
            return None
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE sessions SET deleted_at = ?, updated_at = ?
            WHERE id = ? AND workspace_id = ? AND account_id = ?
            """,
            (now, now, session_id, workspace_id, account_id),
        )
        self._conn.commit()
        session["deleted_at"] = now
        session["updated_at"] = now
        return session

    def insert_message(
        self,
        workspace_id: str,
        session_id: str,
        account_id: str,
        *,
        role: str,
        content: str,
        trace_id: str | None = None,
        openclaw_message_id: str | None = None,
        emotion: str | None = None,
        action: str | None = None,
        tts_emotion_label: str | None = None,
        tts_pause_profile: str | None = None,
        motion_plan: dict[str, Any] | None = None,
        memory_ops: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
        visibility: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        message_id = str(uuid4())
        resolved_visibility = _normalize_message_visibility(visibility)
        self._conn.execute(
            """
            INSERT INTO messages (
                id, workspace_id, session_id, account_id, role, content, visibility, trace_id, openclaw_message_id,
                emotion, action, tts_emotion_label, tts_pause_profile, motion_plan_json,
                memory_ops_json, metadata_json, created_at, deleted_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (
                message_id,
                workspace_id,
                session_id,
                account_id,
                role,
                content,
                resolved_visibility,
                trace_id,
                openclaw_message_id,
                emotion,
                action,
                tts_emotion_label,
                tts_pause_profile,
                json.dumps(motion_plan, ensure_ascii=False) if motion_plan is not None else None,
                json.dumps(memory_ops or [], ensure_ascii=False),
                json.dumps(metadata or {}, ensure_ascii=False),
                now,
            ),
        )
        self._conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ? AND workspace_id = ?",
            (now, session_id, workspace_id),
        )
        self._conn.commit()
        return self.get_message(workspace_id, account_id, message_id)  # type: ignore[return-value]

    def get_message_by_openclaw_message_id(
        self,
        workspace_id: str,
        account_id: str,
        session_id: str,
        openclaw_message_id: str,
    ) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM messages
            WHERE workspace_id = ? AND account_id = ? AND session_id = ?
              AND openclaw_message_id = ? AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1
            """,
            (workspace_id, account_id, session_id, openclaw_message_id),
        ).fetchone()
        return self._hydrate_message(row) if row else None

    def find_recent_traced_message_by_role_content(
        self,
        workspace_id: str,
        account_id: str,
        session_id: str,
        *,
        role: str,
        content: str,
        max_age_seconds: int = 120,
    ) -> dict[str, Any] | None:
        cutoff = (datetime.now(UTC) - timedelta(seconds=max_age_seconds)).isoformat()
        row = self._conn.execute(
            """
            SELECT * FROM messages
            WHERE workspace_id = ? AND account_id = ? AND session_id = ?
              AND role = ? AND content = ? AND trace_id IS NOT NULL
              AND created_at >= ? AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (workspace_id, account_id, session_id, role, content, cutoff),
        ).fetchone()
        return self._hydrate_message(row) if row else None

    def find_recent_message_bridge_duplicate(
        self,
        workspace_id: str,
        account_id: str,
        session_id: str,
        *,
        external_session_key: str,
        role: str,
        content: str,
        max_age_seconds: int = _BRIDGE_DUPLICATE_SUPPRESSION_WINDOW_SECONDS,
    ) -> dict[str, Any] | None:
        normalized_content = _normalize_message_content(content)
        if not normalized_content:
            return None
        cutoff = (datetime.now(UTC) - timedelta(seconds=max_age_seconds)).isoformat()
        rows = self._conn.execute(
            """
            SELECT * FROM messages
            WHERE workspace_id = ? AND account_id = ? AND session_id = ?
              AND role = ? AND trace_id IS NULL AND metadata_json IS NOT NULL
              AND created_at >= ? AND deleted_at IS NULL
            ORDER BY created_at DESC
            """,
            (workspace_id, account_id, session_id, role, cutoff),
        ).fetchall()
        for row in rows:
            metadata = self._json_loads(row["metadata_json"], {})
            if not self._is_message_bridge_duplicate_candidate(metadata, external_session_key):
                continue
            if _normalize_message_content(row["content"]) == normalized_content:
                return self._hydrate_message(row)
        return None

    def insert_message_if_external_missing(
        self,
        workspace_id: str,
        session_id: str,
        account_id: str,
        *,
        role: str,
        content: str,
        trace_id: str | None = None,
        openclaw_message_id: str | None = None,
        emotion: str | None = None,
        action: str | None = None,
        tts_emotion_label: str | None = None,
        tts_pause_profile: str | None = None,
        motion_plan: dict[str, Any] | None = None,
        memory_ops: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
        visibility: str | None = None,
    ) -> dict[str, Any]:
        if openclaw_message_id:
            existing = self.get_message_by_openclaw_message_id(
                workspace_id,
                account_id,
                session_id,
                openclaw_message_id,
            )
            if existing:
                return existing
        return self.insert_message(
            workspace_id,
            session_id,
            account_id,
            role=role,
            content=content,
            trace_id=trace_id,
            openclaw_message_id=openclaw_message_id,
            emotion=emotion,
            action=action,
            tts_emotion_label=tts_emotion_label,
            tts_pause_profile=tts_pause_profile,
            motion_plan=motion_plan,
            memory_ops=memory_ops,
            metadata=metadata,
            visibility=visibility,
        )

    def soft_delete_message_bridge_echoes(
        self,
        workspace_id: str,
        account_id: str,
        session_id: str,
        *,
        external_session_key: str,
        role_content_pairs: list[tuple[str, str]],
        created_after: str | None = None,
    ) -> int:
        expected = {(role, content) for role, content in role_content_pairs}
        if not expected:
            return 0
        params: list[Any] = [workspace_id, account_id, session_id]
        created_filter = ""
        if created_after:
            created_filter = "AND created_at >= ?"
            params.append(created_after)
        rows = self._conn.execute(
            f"""
            SELECT id, role, content, metadata_json
            FROM messages
            WHERE workspace_id = ? AND account_id = ? AND session_id = ?
              AND deleted_at IS NULL AND trace_id IS NULL
              AND metadata_json IS NOT NULL
              {created_filter}
            ORDER BY created_at ASC
            """,
            tuple(params),
        ).fetchall()
        message_ids: list[str] = []
        for row in rows:
            if (row["role"], row["content"]) not in expected:
                continue
            metadata = self._json_loads(row["metadata_json"], {})
            if not isinstance(metadata, dict):
                continue
            if metadata.get("source") != "message_bridge":
                continue
            if metadata.get("external_session_key") != external_session_key:
                continue
            message_ids.append(row["id"])
        if not message_ids:
            return 0
        now = _utc_now_iso()
        for message_id in message_ids:
            self._conn.execute(
                """
                UPDATE messages
                SET deleted_at = ?
                WHERE id = ? AND workspace_id = ? AND account_id = ?
                """,
                (now, message_id, workspace_id, account_id),
            )
        self._conn.commit()
        return len(message_ids)

    def _hydrate_message(self, row: sqlite3.Row) -> dict[str, Any]:
        message = dict(row)
        message["motion_plan"] = self._json_loads(message.pop("motion_plan_json", None), None)
        message["memory_ops"] = self._json_loads(message.pop("memory_ops_json", None), [])
        message["metadata"] = self._json_loads(message.pop("metadata_json", None), {})
        message["tts"] = self.get_message_tts(message["workspace_id"], message["id"])
        message["motion_resolution"] = self.get_message_motion_resolution(message["workspace_id"], message["id"])
        return message

    def list_messages(
        self,
        workspace_id: str,
        account_id: str,
        session_id: str,
        *,
        visibility: str | None = None,
    ) -> list[dict[str, Any]]:
        params: list[Any] = [workspace_id, account_id, session_id]
        visibility_filter = ""
        if visibility is not None:
            visibility_filter = "AND visibility = ?"
            params.append(_normalize_message_visibility(visibility))
        rows = self._conn.execute(
            f"""
            SELECT * FROM messages
            WHERE workspace_id = ? AND account_id = ? AND session_id = ? AND deleted_at IS NULL
              {visibility_filter}
            ORDER BY created_at ASC
            """,
            tuple(params),
        ).fetchall()
        return [self._hydrate_message(row) for row in rows]

    def list_messages_for_chat(self, workspace_id: str, account_id: str, session_id: str) -> list[dict[str, Any]]:
        messages = self._suppress_message_bridge_echoes(
            self.list_messages(workspace_id, account_id, session_id, visibility="chat")
        )
        return self._suppress_nearby_message_bridge_duplicates(messages)

    def _suppress_message_bridge_echoes(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        traced_messages: list[tuple[str, str, datetime]] = []
        for message in messages:
            if not message.get("trace_id"):
                continue
            content = _normalize_message_content(message.get("content"))
            created_at = _parse_iso_datetime(message.get("created_at"))
            if not content or created_at is None:
                continue
            traced_messages.append((str(message.get("role") or ""), content, created_at))
        if not traced_messages:
            return messages

        output: list[dict[str, Any]] = []
        for message in messages:
            metadata = message.get("metadata") or {}
            if (
                not message.get("trace_id")
                and isinstance(metadata, dict)
                and metadata.get("source") == "message_bridge"
                and self._matches_traced_message_echo(message, traced_messages)
            ):
                continue
            output.append(message)
        return output

    def _matches_traced_message_echo(
        self,
        message: dict[str, Any],
        traced_messages: list[tuple[str, str, datetime]],
    ) -> bool:
        content = _normalize_message_content(message.get("content"))
        created_at = _parse_iso_datetime(message.get("created_at"))
        if not content or created_at is None:
            return False
        role = str(message.get("role") or "")
        for traced_role, traced_content, traced_at in traced_messages:
            if role != traced_role or content != traced_content:
                continue
            age_seconds = abs((created_at - traced_at).total_seconds())
            if age_seconds <= _BRIDGE_ECHO_SUPPRESSION_WINDOW_SECONDS:
                return True
        return False

    def _suppress_nearby_message_bridge_duplicates(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        recent: dict[tuple[str, str, str], datetime] = {}
        for message in messages:
            metadata = message.get("metadata") or {}
            external_session_key = str(metadata.get("external_session_key") or "") if isinstance(metadata, dict) else ""
            if self._is_message_bridge_duplicate_candidate(metadata, external_session_key):
                content = _normalize_message_content(message.get("content"))
                created_at = _parse_iso_datetime(message.get("created_at"))
                role = str(message.get("role") or "")
                key = (external_session_key, role, content)
                previous_created_at = recent.get(key)
                if (
                    content
                    and created_at is not None
                    and previous_created_at is not None
                    and abs((created_at - previous_created_at).total_seconds()) <= _BRIDGE_DUPLICATE_SUPPRESSION_WINDOW_SECONDS
                ):
                    continue
                if content and created_at is not None:
                    recent[key] = created_at
            output.append(message)
        return output

    @staticmethod
    def _is_message_bridge_duplicate_candidate(metadata: Any, external_session_key: str) -> bool:
        if not isinstance(metadata, dict):
            return False
        if metadata.get("source") != "message_bridge":
            return False
        if metadata.get("external_session_key") != external_session_key:
            return False
        return str(metadata.get("synced_from") or "") in _BRIDGE_DUPLICATE_SYNC_SOURCES

    def find_message_bridge_session_by_external_key(
        self,
        workspace_id: str,
        account_id: str,
        *,
        provider: str,
        channel: str,
        external_session_key: str,
    ) -> dict[str, Any] | None:
        rows = self._conn.execute(
            """
            SELECT session_id, metadata_json
            FROM messages
            WHERE workspace_id = ? AND account_id = ? AND deleted_at IS NULL
              AND metadata_json IS NOT NULL
            ORDER BY created_at DESC
            """,
            (workspace_id, account_id),
        ).fetchall()
        for row in rows:
            metadata = self._json_loads(row["metadata_json"], {})
            if not isinstance(metadata, dict):
                continue
            if (
                metadata.get("source") == "message_bridge"
                and metadata.get("provider") == provider
                and metadata.get("channel") == channel
                and metadata.get("external_session_key") == external_session_key
            ):
                session = self.get_session(workspace_id, account_id, row["session_id"])
                if session:
                    return session
        return None

    def list_message_bridge_messages(
        self,
        workspace_id: str,
        account_id: str,
    ) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT *
            FROM messages
            WHERE workspace_id = ? AND account_id = ? AND deleted_at IS NULL
              AND metadata_json IS NOT NULL
            ORDER BY created_at ASC
            """,
            (workspace_id, account_id),
        ).fetchall()
        output: list[dict[str, Any]] = []
        for row in rows:
            metadata = self._json_loads(row["metadata_json"], {})
            if not isinstance(metadata, dict):
                continue
            if metadata.get("source") != "message_bridge":
                continue
            if not metadata.get("external_session_key"):
                continue
            output.append(self._hydrate_message(row))
        return output

    def get_latest_greeting_message(self, workspace_id: str, account_id: str) -> dict[str, Any] | None:
        rows = self._conn.execute(
            """
            SELECT *
            FROM messages
            WHERE workspace_id = ? AND account_id = ? AND deleted_at IS NULL
              AND role = 'assistant' AND metadata_json IS NOT NULL
            ORDER BY created_at DESC
            """,
            (workspace_id, account_id),
        ).fetchall()
        for row in rows:
            metadata = self._json_loads(row["metadata_json"], {})
            if not isinstance(metadata, dict):
                continue
            greeting_cron = metadata.get("greeting_cron")
            if metadata.get("auto_tts") is True or isinstance(greeting_cron, dict):
                return self._hydrate_message(row)
        return None

    def get_message(self, workspace_id: str, account_id: str, message_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM messages
            WHERE id = ? AND workspace_id = ? AND account_id = ? AND deleted_at IS NULL
            """,
            (message_id, workspace_id, account_id),
        ).fetchone()
        return self._hydrate_message(row) if row else None

    def update_message_metadata(
        self,
        workspace_id: str,
        account_id: str,
        message_id: str,
        metadata: dict[str, Any],
    ) -> dict[str, Any] | None:
        self._conn.execute(
            """
            UPDATE messages
            SET metadata_json = ?
            WHERE id = ? AND workspace_id = ? AND account_id = ? AND deleted_at IS NULL
            """,
            (json.dumps(metadata, ensure_ascii=False), message_id, workspace_id, account_id),
        )
        self._conn.commit()
        return self.get_message(workspace_id, account_id, message_id)

    def get_workspace_message(self, workspace_id: str, message_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM messages
            WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL
            """,
            (message_id, workspace_id),
        ).fetchone()
        return self._hydrate_message(row) if row else None

    def get_account_external_user_id(self, account_id: str) -> str | None:
        row = self._conn.execute(
            "SELECT external_user_id FROM accounts WHERE id = ?",
            (account_id,),
        ).fetchone()
        return str(row["external_user_id"]) if row and row["external_user_id"] else None

    def create_message_tts(
        self,
        workspace_id: str,
        message_id: str,
        *,
        status: str,
        task_id: str | None,
        remote_audio_url: str | None,
        media_type: str | None,
        duration_seconds: float | None = None,
        chunks_count: int | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        existing = self.get_message_tts(workspace_id, message_id)
        version = (existing["version"] + 1) if existing else 1
        tts_id = str(uuid4())
        self._conn.execute(
            """
            INSERT INTO message_tts (
                id, workspace_id, message_id, provider, version, status, task_id,
                remote_audio_url, remote_audio_path, media_type, duration_seconds,
                chunks_count, error, created_at, completed_at, expires_at, updated_at
            )
            VALUES (?, ?, ?, 'voice-workflow', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?)
            """,
            (
                tts_id,
                workspace_id,
                message_id,
                version,
                status,
                task_id,
                remote_audio_url,
                media_type,
                duration_seconds,
                chunks_count,
                error,
                now,
                now if status == "ready" else None,
                now,
            ),
        )
        self._conn.commit()
        return self.get_tts_by_id(workspace_id, tts_id)  # type: ignore[return-value]

    def get_message_tts(self, workspace_id: str, message_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM message_tts
            WHERE workspace_id = ? AND message_id = ?
            ORDER BY version DESC
            LIMIT 1
            """,
            (workspace_id, message_id),
        ).fetchone()
        tts = dict(row) if row else None
        if tts:
            tts["proxy_audio_url"] = f"/tts/proxy/{tts['id']}"
        return tts

    def get_tts_by_id(self, workspace_id: str, tts_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM message_tts WHERE workspace_id = ? AND id = ?",
            (workspace_id, tts_id),
        ).fetchone()
        tts = dict(row) if row else None
        if tts:
            tts["proxy_audio_url"] = f"/tts/proxy/{tts['id']}"
        return tts

    def finalize_message_tts(
        self,
        workspace_id: str,
        tts_id: str,
        *,
        status: str,
        remote_audio_url: str | None,
        media_type: str | None,
        duration_seconds: float | None = None,
        chunks_count: int | None = None,
        error: str | None = None,
    ) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE message_tts
            SET status = ?,
                remote_audio_url = COALESCE(?, remote_audio_url),
                media_type = COALESCE(?, media_type),
                duration_seconds = COALESCE(?, duration_seconds),
                chunks_count = COALESCE(?, chunks_count),
                error = ?,
                completed_at = CASE WHEN ? = 'ready' THEN ? ELSE completed_at END,
                updated_at = ?
            WHERE id = ? AND workspace_id = ?
            """,
            (
                status,
                remote_audio_url,
                media_type,
                duration_seconds,
                chunks_count,
                error,
                status,
                now,
                now,
                tts_id,
                workspace_id,
            ),
        )
        self._conn.commit()
        return self.get_tts_by_id(workspace_id, tts_id)

    def get_message_by_tts_id(self, workspace_id: str, account_id: str, tts_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT m.*
            FROM message_tts t
            JOIN messages m ON m.id = t.message_id
            WHERE t.id = ? AND t.workspace_id = ? AND m.account_id = ? AND m.deleted_at IS NULL
            """,
            (tts_id, workspace_id, account_id),
        ).fetchone()
        return self._hydrate_message(row) if row else None

    def update_tts_status(
        self,
        workspace_id: str,
        tts_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE message_tts
            SET status = ?, error = COALESCE(?, error), updated_at = ?
            WHERE id = ? AND workspace_id = ?
            """,
            (status, error, now, tts_id, workspace_id),
        )
        self._conn.commit()
        return self.get_tts_by_id(workspace_id, tts_id)

    def create_tts_job(
        self,
        workspace_id: str,
        message_id: str,
        message_tts_id: str,
        *,
        status: str = "pending",
        next_attempt_at: str | None = None,
    ) -> dict[str, Any]:
        job_id = str(uuid4())
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO tts_jobs (
                id, workspace_id, message_id, message_tts_id, status, attempts,
                next_attempt_at, locked_at, last_error, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?)
            """,
            (job_id, workspace_id, message_id, message_tts_id, status, next_attempt_at or now, now, now),
        )
        self._conn.commit()
        return self.get_tts_job(job_id)  # type: ignore[return-value]

    def get_tts_job(self, job_id: str) -> dict[str, Any] | None:
        row = self._conn.execute("SELECT * FROM tts_jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None

    def get_tts_job_by_message_tts_id(self, message_tts_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM tts_jobs
            WHERE message_tts_id = ? AND status IN ('pending', 'running')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (message_tts_id,),
        ).fetchone()
        return dict(row) if row else None

    def claim_next_tts_job(self, *, now_iso: str, lock_timeout_seconds: int) -> dict[str, Any] | None:
        stale_before = (_ensure_utc(datetime.fromisoformat(now_iso)) - timedelta(seconds=lock_timeout_seconds)).isoformat()
        row = self._conn.execute(
            """
            SELECT *
            FROM tts_jobs
            WHERE
                (status = 'pending' AND next_attempt_at <= ?)
                OR
                (status = 'running' AND (locked_at IS NULL OR locked_at <= ?))
            ORDER BY next_attempt_at ASC, created_at ASC
            LIMIT 1
            """,
            (now_iso, stale_before),
        ).fetchone()
        if not row:
            return None
        job_id = str(row["id"])
        self._conn.execute(
            """
            UPDATE tts_jobs
            SET status = 'running',
                attempts = attempts + 1,
                locked_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (now_iso, now_iso, job_id),
        )
        self._conn.commit()
        return self.get_tts_job(job_id)

    def complete_tts_job(self, job_id: str) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE tts_jobs
            SET status = 'completed', locked_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (now, job_id),
        )
        self._conn.commit()
        return self.get_tts_job(job_id)

    def reschedule_tts_job(self, job_id: str, *, next_attempt_at: str, last_error: str | None = None) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE tts_jobs
            SET status = 'pending',
                next_attempt_at = ?,
                locked_at = NULL,
                last_error = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (next_attempt_at, last_error, now, job_id),
        )
        self._conn.commit()
        return self.get_tts_job(job_id)

    def fail_tts_job(self, job_id: str, *, last_error: str | None = None) -> dict[str, Any] | None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE tts_jobs
            SET status = 'failed', locked_at = NULL, last_error = ?, updated_at = ?
            WHERE id = ?
            """,
            (last_error, now, job_id),
        )
        self._conn.commit()
        return self.get_tts_job(job_id)

    def cancel_tts_jobs_for_message(self, workspace_id: str, message_id: str) -> None:
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE tts_jobs
            SET status = 'cancelled', locked_at = NULL, updated_at = ?
            WHERE workspace_id = ? AND message_id = ? AND status IN ('pending', 'running')
            """,
            (now, workspace_id, message_id),
        )
        self._conn.commit()

    def cleanup_message_service(self, *, tts_retention_days: int, max_tts_attempts: int) -> dict[str, int]:
        cutoff = (datetime.now(UTC) - timedelta(days=tts_retention_days)).isoformat()
        soft_deleted_messages = self._conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM messages
            WHERE session_id IN (SELECT id FROM sessions WHERE deleted_at IS NOT NULL)
            """
        ).fetchone()["count"]
        soft_deleted_tts = self._conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM message_tts
            WHERE message_id IN (
                SELECT id FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE deleted_at IS NOT NULL)
            )
            """
        ).fetchone()["count"]
        old_terminal_tts = self._conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM message_tts
            WHERE status IN ('expired', 'failed') AND updated_at < ?
            """,
            (cutoff,),
        ).fetchone()["count"]
        orphan_tts_jobs = self._conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM tts_jobs
            WHERE message_tts_id NOT IN (SELECT id FROM message_tts)
            """
        ).fetchone()["count"]
        stale_pending_jobs = self._conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM tts_jobs
            WHERE status IN ('pending', 'running') AND attempts >= ?
            """,
            (max_tts_attempts,),
        ).fetchone()["count"]

        self._conn.execute(
            """
            DELETE FROM tts_jobs
            WHERE message_tts_id NOT IN (SELECT id FROM message_tts)
            """
        )
        self._conn.execute(
            """
            DELETE FROM message_tts
            WHERE message_id IN (
                SELECT id FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE deleted_at IS NOT NULL)
            )
            """
        )
        self._conn.execute(
            """
            DELETE FROM messages
            WHERE session_id IN (SELECT id FROM sessions WHERE deleted_at IS NOT NULL)
            """
        )
        self._conn.execute("DELETE FROM sessions WHERE deleted_at IS NOT NULL")
        self._conn.execute(
            """
            DELETE FROM message_tts
            WHERE status IN ('expired', 'failed') AND updated_at < ?
            """,
            (cutoff,),
        )
        self._conn.execute(
            """
            UPDATE tts_jobs
            SET status = 'failed', updated_at = ?, locked_at = NULL, last_error = COALESCE(last_error, 'max_attempts_exceeded')
            WHERE status IN ('pending', 'running') AND attempts >= ?
            """,
            (_utc_now_iso(), max_tts_attempts),
        )
        self._conn.commit()
        return {
            "deleted_soft_deleted_messages": int(soft_deleted_messages),
            "deleted_soft_deleted_tts": int(soft_deleted_tts),
            "deleted_old_terminal_tts": int(old_terminal_tts),
            "deleted_orphan_tts_jobs": int(orphan_tts_jobs),
            "failed_stale_pending_jobs": int(stale_pending_jobs),
        }

    def list_favorite_assets_for_model(self, user_id: str, model_relative_path: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT *
            FROM asset_registry
            WHERE user_id = ? AND is_favorite = 1 AND favorite_model_relative_path = ?
            ORDER BY created_at DESC
            """,
            (user_id, model_relative_path),
        ).fetchall()
        return [dict(row) for row in rows]

    def create_motion_context_export(
        self,
        workspace_id: str,
        account_id: str,
        *,
        model_key: str,
        model_display_name: str,
        export_json: dict[str, Any],
        motion_count: int,
    ) -> dict[str, Any]:
        export_id = str(uuid4())
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO motion_context_exports (
                id, workspace_id, account_id, model_key, model_display_name, export_json, motion_count, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (export_id, workspace_id, account_id, model_key, model_display_name, json.dumps(export_json, ensure_ascii=False), motion_count, now),
        )
        self._conn.commit()
        return self.get_latest_motion_context_export(workspace_id, account_id, model_key)  # type: ignore[return-value]

    def get_latest_motion_context_export(self, workspace_id: str, account_id: str, model_key: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT *
            FROM motion_context_exports
            WHERE workspace_id = ? AND account_id = ? AND model_key = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (workspace_id, account_id, model_key),
        ).fetchone()
        if not row:
            return None
        payload = dict(row)
        payload["export_json"] = self._json_loads(payload["export_json"], {})
        return payload

    def create_message_motion_resolution(
        self,
        workspace_id: str,
        message_id: str,
        *,
        selected_model_path: str | None,
        source_action: str | None,
        source_template: str | None,
        resolved_asset_id: str | None,
        resolved_asset_url: str | None,
        resolved_display_name: str | None,
        status: str,
        fallback_reason: str | None = None,
    ) -> dict[str, Any]:
        resolution_id = str(uuid4())
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO message_motion_resolution (
                id, workspace_id, message_id, selected_model_path, source_action, source_template,
                resolved_asset_id, resolved_asset_url, resolved_display_name, status, fallback_reason, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                resolution_id,
                workspace_id,
                message_id,
                selected_model_path,
                source_action,
                source_template,
                resolved_asset_id,
                resolved_asset_url,
                resolved_display_name,
                status,
                fallback_reason,
                now,
            ),
        )
        self._conn.commit()
        return self.get_message_motion_resolution(workspace_id, message_id)  # type: ignore[return-value]

    def get_message_motion_resolution(self, workspace_id: str, message_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT *
            FROM message_motion_resolution
            WHERE workspace_id = ? AND message_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (workspace_id, message_id),
        ).fetchone()
        return dict(row) if row else None

    @staticmethod
    def _hydrate_bridge_binding(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if not row:
            return None
        binding = dict(row)
        binding["is_default"] = bool(binding["is_default"])
        return binding

    @staticmethod
    def _hydrate_bridge_state(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if not row:
            return None
        state = dict(row)
        state["enabled"] = bool(state["enabled"])
        state["realtime_drive_character"] = bool(state["realtime_drive_character"])
        return state

    def get_message_bridge_state(self, provider: str, channel: str) -> dict[str, Any]:
        provider = provider.strip() or "openclaw"
        channel = channel.strip() or "feishu"
        row = self._conn.execute(
            "SELECT * FROM message_bridge_state WHERE provider = ? AND channel = ?",
            (provider, channel),
        ).fetchone()
        state = self._hydrate_bridge_state(row)
        if state:
            return state
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO message_bridge_state (
                provider, channel, enabled, realtime_drive_character, websocket_status,
                reconnect_attempts, last_connected_at, last_error, updated_at
            )
            VALUES (?, ?, 1, 1, 'disconnected', 0, NULL, NULL, ?)
            """,
            (provider, channel, now),
        )
        self._conn.commit()
        return self.get_message_bridge_state(provider, channel)

    def update_message_bridge_state(
        self,
        provider: str,
        channel: str,
        *,
        enabled: bool | None = None,
        realtime_drive_character: bool | None = None,
        websocket_status: str | None = None,
        reconnect_attempts: int | None = None,
        last_connected_at: str | None = None,
        last_error: str | None = None,
    ) -> dict[str, Any]:
        current = self.get_message_bridge_state(provider, channel)
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE message_bridge_state
            SET enabled = ?, realtime_drive_character = ?, websocket_status = ?,
                reconnect_attempts = ?, last_connected_at = COALESCE(?, last_connected_at),
                last_error = ?, updated_at = ?
            WHERE provider = ? AND channel = ?
            """,
            (
                int(current["enabled"] if enabled is None else enabled),
                int(current["realtime_drive_character"] if realtime_drive_character is None else realtime_drive_character),
                websocket_status or current["websocket_status"],
                current["reconnect_attempts"] if reconnect_attempts is None else reconnect_attempts,
                last_connected_at,
                last_error,
                now,
                provider,
                channel,
            ),
        )
        self._conn.commit()
        return self.get_message_bridge_state(provider, channel)

    def upsert_message_bridge_binding(
        self,
        *,
        workspace_id: str,
        account_id: str,
        local_session_id: str,
        provider: str,
        channel: str,
        external_session_key: str,
        external_display_name: str | None,
        is_default: bool,
        status: str,
        last_history_sync_at: str | None = None,
        last_message_at: str | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        if is_default:
            self._conn.execute(
                """
                UPDATE message_bridge_bindings
                SET is_default = 0, updated_at = ?
                WHERE workspace_id = ? AND account_id = ? AND provider = ? AND channel = ?
                """,
                (now, workspace_id, account_id, provider, channel),
            )
        existing = self._conn.execute(
            """
            SELECT * FROM message_bridge_bindings
            WHERE workspace_id = ? AND account_id = ? AND provider = ? AND channel = ?
              AND external_session_key = ?
            """,
            (workspace_id, account_id, provider, channel, external_session_key),
        ).fetchone()
        if existing:
            binding_id = existing["id"]
            self._conn.execute(
                """
                UPDATE message_bridge_bindings
                SET local_session_id = ?, external_display_name = ?, is_default = ?, status = ?,
                    last_history_sync_at = COALESCE(?, last_history_sync_at),
                    last_message_at = COALESCE(?, last_message_at),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    local_session_id,
                    external_display_name,
                    int(is_default),
                    status,
                    last_history_sync_at,
                    last_message_at,
                    now,
                    binding_id,
                ),
            )
        else:
            binding_id = str(uuid4())
            self._conn.execute(
                """
                INSERT INTO message_bridge_bindings (
                    id, workspace_id, account_id, local_session_id, provider, channel,
                    external_session_key, external_display_name, is_default, status,
                    last_history_sync_at, last_message_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    binding_id,
                    workspace_id,
                    account_id,
                    local_session_id,
                    provider,
                    channel,
                    external_session_key,
                    external_display_name,
                    int(is_default),
                    status,
                    last_history_sync_at,
                    last_message_at,
                    now,
                    now,
                ),
            )
        self._conn.commit()
        return self.get_message_bridge_binding(binding_id)  # type: ignore[return-value]

    def get_message_bridge_binding(self, binding_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM message_bridge_bindings WHERE id = ?",
            (binding_id,),
        ).fetchone()
        return self._hydrate_bridge_binding(row)

    def get_message_bridge_binding_by_external_key(
        self,
        workspace_id: str,
        account_id: str,
        *,
        provider: str,
        channel: str,
        external_session_key: str,
    ) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM message_bridge_bindings
            WHERE workspace_id = ? AND account_id = ? AND provider = ? AND channel = ?
              AND external_session_key = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (workspace_id, account_id, provider, channel, external_session_key),
        ).fetchone()
        return self._hydrate_bridge_binding(row)

    def get_default_message_bridge_binding(
        self,
        workspace_id: str,
        account_id: str,
        *,
        provider: str,
        channel: str,
    ) -> dict[str, Any] | None:
        row = self._conn.execute(
            """
            SELECT * FROM message_bridge_bindings
            WHERE workspace_id = ? AND account_id = ? AND provider = ? AND channel = ?
              AND is_default = 1
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (workspace_id, account_id, provider, channel),
        ).fetchone()
        return self._hydrate_bridge_binding(row)

    def list_message_bridge_bindings(self, workspace_id: str, account_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT * FROM message_bridge_bindings
            WHERE workspace_id = ? AND account_id = ?
            ORDER BY is_default DESC, updated_at DESC
            """,
            (workspace_id, account_id),
        ).fetchall()
        return [self._hydrate_bridge_binding(row) for row in rows if row]

    def update_message_bridge_binding_sync(
        self,
        binding_id: str,
        *,
        last_history_sync_at: str | None = None,
        last_message_at: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any] | None:
        current = self.get_message_bridge_binding(binding_id)
        if not current:
            return None
        now = _utc_now_iso()
        self._conn.execute(
            """
            UPDATE message_bridge_bindings
            SET last_history_sync_at = COALESCE(?, last_history_sync_at),
                last_message_at = COALESCE(?, last_message_at),
                status = COALESCE(?, status),
                updated_at = ?
            WHERE id = ?
            """,
            (last_history_sync_at, last_message_at, status, now, binding_id),
        )
        self._conn.commit()
        return self.get_message_bridge_binding(binding_id)

    def _add_column_if_missing(self, existing_columns: set[str], column_name: str, statement: str) -> None:
        if column_name in existing_columns:
            return
        try:
            self._conn.execute(statement)
        except sqlite3.OperationalError as exc:
            if "duplicate column name" not in str(exc).lower():
                raise

    def _append_ndjson(self, record: dict[str, Any], created_at: datetime) -> None:
        file_name = f"{created_at.date().isoformat()}.ndjson"
        path = self.ndjson_dir / file_name
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        with path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    def insert_event(
        self,
        trace_id: str,
        user_id: str,
        session_id: str | None,
        stage: str,
        status: str,
        latency_ms: int | None,
        payload: dict[str, Any],
        error_code: str | None = None,
        created_at: datetime | None = None,
    ) -> None:
        ts = _ensure_utc(created_at)
        payload_json = json.dumps(payload, ensure_ascii=False)
        self._conn.execute(
            """
            INSERT INTO trace_events
                (trace_id, user_id, session_id, stage, status, latency_ms, error_code, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                user_id,
                session_id,
                stage,
                status,
                latency_ms,
                error_code,
                payload_json,
                ts.isoformat(),
            ),
        )
        self._conn.commit()
        self._append_ndjson(
            {
                "type": "trace_event",
                "trace_id": trace_id,
                "user_id": user_id,
                "session_id": session_id,
                "stage": stage,
                "status": status,
                "latency_ms": latency_ms,
                "error_code": error_code,
                "payload": payload,
                "created_at": ts.isoformat(),
            },
            ts,
        )

    def insert_chat_mirror(
        self,
        trace_id: str,
        user_id: str,
        request_payload: dict[str, Any],
        raw_response: str,
        normalized_payload: dict[str, Any],
        endpoint_used: str,
        status: str,
        created_at: datetime | None = None,
    ) -> None:
        ts = _ensure_utc(created_at)
        req_json = json.dumps(request_payload, ensure_ascii=False)
        normalized_json = json.dumps(normalized_payload, ensure_ascii=False)
        self._conn.execute(
            """
            INSERT INTO chat_mirror
                (trace_id, user_id, request_json, raw_response, normalized_json, endpoint_used, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                user_id,
                req_json,
                raw_response,
                normalized_json,
                endpoint_used,
                status,
                ts.isoformat(),
            ),
        )
        self._conn.commit()
        self._append_ndjson(
            {
                "type": "chat_mirror",
                "trace_id": trace_id,
                "user_id": user_id,
                "request": request_payload,
                "raw_response": raw_response,
                "normalized": normalized_payload,
                "endpoint_used": endpoint_used,
                "status": status,
                "created_at": ts.isoformat(),
            },
            ts,
        )

    def insert_retry_job(self, trace_id: str, stage: str, payload: dict[str, Any], last_error: str) -> str:
        job_id = str(uuid4())
        ts = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO retry_jobs (id, trace_id, stage, payload_json, attempts, status, last_error, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?)
            """,
            (job_id, trace_id, stage, json.dumps(payload, ensure_ascii=False), last_error, ts, ts),
        )
        self._conn.commit()
        return job_id

    def query_events(
        self,
        trace_id: str | None,
        requester_user_id: str,
        is_admin: bool,
        user_id_filter: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        params: list[Any] = []
        where: list[str] = []
        if trace_id:
            where.append("trace_id = ?")
            params.append(trace_id)
        if is_admin:
            if user_id_filter:
                where.append("user_id = ?")
                params.append(user_id_filter)
        else:
            where.append("user_id = ?")
            params.append(requester_user_id)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        query = f"""
            SELECT trace_id, user_id, session_id, stage, status, latency_ms, error_code, payload_json, created_at
            FROM trace_events
            {where_sql}
            ORDER BY id DESC
            LIMIT ?
        """
        params.append(max(1, min(limit, 1000)))
        rows = self._conn.execute(query, params).fetchall()
        output = []
        for row in rows:
            payload = json.loads(row["payload_json"] or "{}")
            output.append(
                {
                    "trace_id": row["trace_id"],
                    "user_id": row["user_id"],
                    "session_id": row["session_id"],
                    "stage": row["stage"],
                    "status": row["status"],
                    "latency_ms": row["latency_ms"],
                    "error_code": row["error_code"],
                    "payload": payload,
                    "created_at": row["created_at"],
                }
            )
        return output

    def query_mirrors(
        self,
        trace_id: str | None,
        requester_user_id: str,
        is_admin: bool,
        user_id_filter: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        params: list[Any] = []
        where: list[str] = []
        if trace_id:
            where.append("trace_id = ?")
            params.append(trace_id)
        if is_admin:
            if user_id_filter:
                where.append("user_id = ?")
                params.append(user_id_filter)
        else:
            where.append("user_id = ?")
            params.append(requester_user_id)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        query = f"""
            SELECT trace_id, user_id, request_json, raw_response, normalized_json, endpoint_used, status, created_at
            FROM chat_mirror
            {where_sql}
            ORDER BY id DESC
            LIMIT ?
        """
        params.append(max(1, min(limit, 1000)))
        rows = self._conn.execute(query, params).fetchall()
        output = []
        for row in rows:
            output.append(
                {
                    "trace_id": row["trace_id"],
                    "user_id": row["user_id"],
                    "request": json.loads(row["request_json"] or "{}"),
                    "raw_response": row["raw_response"],
                    "normalized": json.loads(row["normalized_json"] or "{}"),
                    "endpoint_used": row["endpoint_used"],
                    "status": row["status"],
                    "created_at": row["created_at"],
                }
            )
        return output

    def set_default_mappings(self, mappings: dict[str, dict[str, str]]) -> None:
        now = _utc_now_iso()
        for slot, config in mappings.items():
            self._conn.execute(
                """
                INSERT INTO mapping_defaults (slot, config_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(slot) DO UPDATE SET config_json=excluded.config_json, updated_at=excluded.updated_at
                """,
                (slot, json.dumps(config, ensure_ascii=False), now),
            )
        self._conn.commit()

    def set_user_mappings(self, user_id: str, mappings: dict[str, dict[str, str]]) -> None:
        now = _utc_now_iso()
        for slot, config in mappings.items():
            self._conn.execute(
                """
                INSERT INTO mapping_user_override (user_id, slot, config_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, slot) DO UPDATE SET config_json=excluded.config_json, updated_at=excluded.updated_at
                """,
                (user_id, slot, json.dumps(config, ensure_ascii=False), now),
            )
        self._conn.commit()

    def get_default_mappings(self) -> dict[str, dict[str, str]]:
        rows = self._conn.execute("SELECT slot, config_json FROM mapping_defaults").fetchall()
        return {row["slot"]: json.loads(row["config_json"]) for row in rows}

    def get_user_mappings(self, user_id: str) -> dict[str, dict[str, str]]:
        rows = self._conn.execute(
            "SELECT slot, config_json FROM mapping_user_override WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {row["slot"]: json.loads(row["config_json"]) for row in rows}

    def get_companion_shared_config(self, user_id: str) -> dict[str, Any]:
        with self._open_companion_shared_config_connection() as connection:
            row = connection.execute(
                "SELECT * FROM companion_shared_config WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return {
                "user_id": user_id,
                "selected_model_path": None,
                "render_pipeline": "classic",
                "reze_stage_document": None,
                "updated_at": None,
            }
        item = dict(row)
        item["reze_stage_document"] = self._json_loads(item.pop("reze_stage_document_json", None), None)
        return item

    def upsert_companion_shared_config(
        self,
        *,
        user_id: str,
        selected_model_path: str | None,
        render_pipeline: str,
        reze_stage_document: dict[str, object] | None = None,
    ) -> dict[str, Any]:
        if not isinstance(render_pipeline, str):
            raise ValueError(f"render_pipeline must be one of {', '.join(COMPANION_RENDER_PIPELINES)}")
        normalized_pipeline = render_pipeline.strip().lower()
        if not normalized_pipeline or normalized_pipeline not in _COMPANION_RENDER_PIPELINE_SET:
            raise ValueError(f"render_pipeline must be one of {', '.join(COMPANION_RENDER_PIPELINES)}")
        now = _utc_now_iso()
        reze_stage_document_json = json.dumps(reze_stage_document, ensure_ascii=False) if reze_stage_document else None
        with self._open_companion_shared_config_connection() as connection:
            connection.execute(
                """
                INSERT INTO companion_shared_config (
                    user_id, selected_model_path, render_pipeline, reze_stage_document_json, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    selected_model_path = excluded.selected_model_path,
                    render_pipeline = excluded.render_pipeline,
                    reze_stage_document_json = excluded.reze_stage_document_json,
                    updated_at = excluded.updated_at
                """,
                (user_id, selected_model_path, normalized_pipeline, reze_stage_document_json, now),
            )
            connection.commit()
            row = connection.execute(
                "SELECT * FROM companion_shared_config WHERE user_id = ?",
                (user_id,),
            ).fetchone()
        if row:
            item = dict(row)
            item["reze_stage_document"] = self._json_loads(item.pop("reze_stage_document_json", None), None)
            return item
        return {
            "user_id": user_id,
            "selected_model_path": None,
            "render_pipeline": "classic",
            "reze_stage_document": None,
            "updated_at": None,
        }

    @staticmethod
    def _desktop_pet_display_title(
        *,
        display_title: str | None,
        first_prompt_preview: str | None,
        workspace_path: str,
        codex_session_id: str,
    ) -> str:
        for candidate in (display_title, first_prompt_preview):
            normalized = _normalize_message_content(candidate)
            if normalized:
                return normalized[:48]
        workspace_name = Path(workspace_path).name or "Codex session"
        short_id = codex_session_id.replace("-", "")[:8]
        return f"{workspace_name} {short_id}".strip()

    @staticmethod
    def _desktop_pet_optional_text(value: str | None, max_length: int) -> str | None:
        normalized = _normalize_message_content(value)
        return normalized[:max_length] if normalized else None

    @staticmethod
    def _desktop_pet_session_limit(limit: Any) -> int:
        try:
            value = int(limit)
        except (OverflowError, TypeError, ValueError):
            value = 10
        return max(1, min(value, 50))

    def _desktop_pet_session_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        metadata = self._json_loads(item.pop("metadata_json", None), {})
        item["metadata"] = metadata if isinstance(metadata, dict) else {}
        return item

    def upsert_desktop_pet_session(
        self,
        *,
        pet_session_id: str,
        codex_session_id: str,
        workspace_id: str | None,
        workspace_path: str,
        codex_home: str | None,
        display_title: str | None,
        first_prompt_preview: str | None,
        last_summary: str | None,
        last_status: str,
        launch_mode: str,
        remote_url: str | None,
        app_server_pid: int | None,
        app_server_port: int | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        normalized_first_prompt_preview = self._desktop_pet_optional_text(
            first_prompt_preview,
            _DESKTOP_PET_FIRST_PROMPT_PREVIEW_MAX_LENGTH,
        )
        normalized_last_summary = self._desktop_pet_optional_text(
            last_summary,
            _DESKTOP_PET_LAST_SUMMARY_MAX_LENGTH,
        )
        title = self._desktop_pet_display_title(
            display_title=display_title,
            first_prompt_preview=normalized_first_prompt_preview,
            workspace_path=workspace_path,
            codex_session_id=codex_session_id,
        )
        self._conn.execute(
            """
            INSERT INTO desktop_pet_sessions (
                pet_session_id, codex_session_id, workspace_id, workspace_path,
                codex_home, display_title, first_prompt_preview, last_summary,
                last_status, launch_mode, remote_url, app_server_pid,
                app_server_port, metadata_json, created_at, updated_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pet_session_id) DO UPDATE SET
                codex_session_id = excluded.codex_session_id,
                workspace_id = excluded.workspace_id,
                workspace_path = excluded.workspace_path,
                codex_home = excluded.codex_home,
                display_title = excluded.display_title,
                first_prompt_preview = excluded.first_prompt_preview,
                last_summary = excluded.last_summary,
                last_status = excluded.last_status,
                launch_mode = excluded.launch_mode,
                remote_url = excluded.remote_url,
                app_server_pid = excluded.app_server_pid,
                app_server_port = excluded.app_server_port,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at,
                last_seen_at = excluded.last_seen_at
            """,
            (
                pet_session_id,
                codex_session_id,
                workspace_id,
                workspace_path,
                codex_home,
                title,
                normalized_first_prompt_preview,
                normalized_last_summary,
                last_status,
                launch_mode,
                remote_url,
                app_server_pid,
                app_server_port,
                json.dumps(metadata or {}, ensure_ascii=False),
                now,
                now,
                now,
            ),
        )
        self._conn.commit()
        return self.get_desktop_pet_session(pet_session_id) or {}

    def get_desktop_pet_session(self, pet_session_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM desktop_pet_sessions WHERE pet_session_id = ?",
            (pet_session_id,),
        ).fetchone()
        return self._desktop_pet_session_row(row)

    def list_desktop_pet_sessions(self, limit: int = 10) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT * FROM desktop_pet_sessions
            ORDER BY last_seen_at DESC, updated_at DESC, created_at DESC, pet_session_id ASC
            LIMIT ?
            """,
            (self._desktop_pet_session_limit(limit),),
        ).fetchall()
        return [self._desktop_pet_session_row(row) for row in rows if row is not None]

    def delete_desktop_pet_session(self, pet_session_id: str) -> bool:
        cursor = self._conn.execute(
            "DELETE FROM desktop_pet_sessions WHERE pet_session_id = ?",
            (pet_session_id,),
        )
        self._conn.commit()
        return cursor.rowcount > 0

    def add_asset(
        self,
        user_id: str,
        slot: str,
        filename: str,
        source_relative_path: str | None,
        relative_path: str,
        size_bytes: int,
    ) -> dict[str, Any]:
        asset_id = str(uuid4())
        ts = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO asset_registry (
                asset_id, user_id, slot, filename, display_name, source_relative_path, relative_path, is_favorite, favorite_relative_path, favorite_model_relative_path, size_bytes, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
            """,
            (asset_id, user_id, slot, filename, filename, source_relative_path, relative_path, size_bytes, ts),
        )
        self._conn.commit()
        return {
            "asset_id": asset_id,
            "user_id": user_id,
            "slot": slot,
            "filename": filename,
            "display_name": filename,
            "source_relative_path": source_relative_path,
            "relative_path": relative_path,
            "is_favorite": False,
            "favorite_relative_path": None,
            "favorite_model_relative_path": None,
            "size_bytes": size_bytes,
            "created_at": ts,
        }

    def list_assets(self, requester_user_id: str, is_admin: bool, user_id_filter: str | None = None) -> list[dict[str, Any]]:
        if is_admin and user_id_filter:
            rows = self._conn.execute(
                "SELECT * FROM asset_registry WHERE user_id = ? ORDER BY created_at DESC",
                (user_id_filter,),
            ).fetchall()
        elif is_admin:
            rows = self._conn.execute("SELECT * FROM asset_registry ORDER BY created_at DESC").fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM asset_registry WHERE user_id = ? ORDER BY created_at DESC",
                (requester_user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        row = self._conn.execute("SELECT * FROM asset_registry WHERE asset_id = ?", (asset_id,)).fetchone()
        return dict(row) if row else None

    def get_asset_by_favorite_relative_path(self, user_id: str, favorite_relative_path: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM asset_registry WHERE user_id = ? AND favorite_relative_path = ?",
            (user_id, favorite_relative_path),
        ).fetchone()
        return dict(row) if row else None

    def update_asset(
        self,
        asset_id: str,
        *,
        display_name: str | None,
        is_favorite: bool,
        favorite_relative_path: str | None,
        favorite_model_relative_path: str | None,
    ) -> dict[str, Any] | None:
        self._conn.execute(
            """
            UPDATE asset_registry
            SET display_name = ?, is_favorite = ?, favorite_relative_path = ?, favorite_model_relative_path = ?
            WHERE asset_id = ?
            """,
            (display_name, 1 if is_favorite else 0, favorite_relative_path, favorite_model_relative_path, asset_id),
        )
        self._conn.commit()
        return self.get_asset(asset_id)

    def delete_asset(self, asset_id: str) -> None:
        self._conn.execute("DELETE FROM asset_registry WHERE asset_id = ?", (asset_id,))
        self._conn.commit()

    def cleanup(self, retention_days: int, compress_after_days: int) -> None:
        cutoff = datetime.now(UTC) - timedelta(days=retention_days)
        cutoff_iso = cutoff.isoformat()
        for table in ("trace_events", "chat_mirror", "retry_jobs"):
            self._conn.execute(f"DELETE FROM {table} WHERE created_at < ?", (cutoff_iso,))
        self._conn.commit()

        compress_cutoff = datetime.now(UTC).date() - timedelta(days=compress_after_days)
        for path in self.ndjson_dir.glob("*.ndjson"):
            try:
                file_date = datetime.strptime(path.stem, "%Y-%m-%d").date()
            except ValueError:
                continue
            if file_date > compress_cutoff:
                continue
            gz_path = path.with_suffix(path.suffix + ".gz")
            with path.open("rb") as src, gzip.open(gz_path, "wb") as dst:
                dst.write(src.read())
            path.unlink(missing_ok=True)
