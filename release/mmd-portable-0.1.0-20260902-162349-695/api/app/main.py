from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.db.store import TraceStore
from app.routes.assets import router as assets_router
from app.routes.chat import router as chat_router
from app.routes.codex_interactive import router as codex_interactive_router
from app.routes.codex_knowledge import router as codex_knowledge_router
from app.routes.codex_author_knowledge_handoff import router as codex_author_knowledge_handoff_router
from app.routes.codex_author_knowledge_review import router as codex_author_knowledge_review_router
from app.routes.codex_knowledge_whitelist_admin import router as codex_knowledge_whitelist_admin_router
from app.routes.codex_review import router as codex_review_router
from app.routes.config import router as config_router
from app.routes.desktop_pet import router as desktop_pet_router
from app.routes.health import router as health_router
from app.routes.message_bridge import router as message_bridge_router
from app.routes.message_service import router as message_service_router
from app.routes.openclaw_tools import router as openclaw_tools_router
from app.routes.podcasts import router as podcasts_router
from app.routes.realtime_voice import router as realtime_voice_router
from app.routes.trace import router as trace_router
from app.routes.tts import router as tts_router
from app.services.message_tts_reference import create_or_enqueue_message_tts_reference
from app.services.message_tts_worker import run_message_tts_worker
from app.services.codex_app_server_client import CodexAppServerClient
from app.services.codex_interactive_provider import CodexInteractiveProvider, DeterministicCodexInteractiveProvider
from app.services.codex_interactive_control import CodexInteractiveSessionControl
from app.services.codex_knowledge_extraction import run_codex_knowledge_extraction_worker
from app.services.codex_author_knowledge_handoff import run_codex_author_knowledge_reconciliation_worker
from app.services.codex_author_knowledge_handoff_store import CodexAuthorKnowledgeHandoffStore
from app.services.codex_knowledge_whitelist import CodexKnowledgeWhitelistStore
from app.services.codex_author_knowledge_openclaw_delivery import (
    run_codex_author_knowledge_openclaw_delivery_worker,
)
from app.services.codex_openclaw_review_sync import run_codex_review_sync_worker
from app.services.codex_worktree_manager import CodexWorktreeManager
from app.services.message_bridge import MessageBridgeService, OpenClawGatewayProvider
from app.services.openclaw_client import OpenClawClient
from app.services.openclaw_control_plane import (
    OpenClawReviewControlPlaneClient,
    run_codex_review_control_plane_worker,
)
from app.services.openkb_client import OpenKbClient
from app.services.daily_podcast import DailyPodcastRefreshCooldown
from app.services.realtime_voice import RealtimeVoiceChunkRegistry
from app.services.voice_workflow_tts_client import VoiceWorkflowTtsClient


def create_app(overrides: dict | None = None) -> FastAPI:
    settings = Settings.from_env(overrides)
    db_path = settings.data_dir / "sqlite" / "trace.db"
    ndjson_dir = settings.data_dir / "logs"
    trace_store = TraceStore(db_path=db_path, ndjson_dir=ndjson_dir)
    knowledge_handoff_store = (
        CodexAuthorKnowledgeHandoffStore(settings.data_dir / "sqlite" / "knowledge_handoff.db")
        if settings.codex_author_knowledge_handoff_enabled
        else None
    )
    knowledge_whitelist_store = (
        CodexKnowledgeWhitelistStore(
            settings.data_dir / settings.codex_author_knowledge_whitelist_file
        )
        if settings.codex_author_knowledge_handoff_enabled
        else None
    )
    openclaw_client = OpenClawClient(
        base_url=settings.openclaw_base_url,
        token=settings.openclaw_token,
        model=settings.openclaw_model,
        agent_id=settings.openclaw_agent_id,
        message_channel=settings.openclaw_message_channel,
        proxy_url=settings.openclaw_proxy_url,
        verify_ssl=settings.openclaw_verify_ssl,
        timeout_seconds=settings.openclaw_timeout_seconds,
    )
    tts_client = VoiceWorkflowTtsClient(
        base_url=settings.tts_service_base_url,
        timeout_seconds=settings.tts_service_timeout_seconds,
        poll_interval_seconds=settings.tts_service_poll_interval_seconds,
        max_poll_attempts=settings.tts_service_max_poll_attempts,
    )
    message_bridge_provider = OpenClawGatewayProvider(
        base_url=settings.openclaw_base_url,
        token=settings.openclaw_token,
        channel=settings.openclaw_message_channel or "feishu",
        timeout_seconds=settings.openclaw_timeout_seconds,
        origin=settings.openclaw_base_url,
    )
    openclaw_control_plane_client = (
        OpenClawReviewControlPlaneClient(
            base_url=settings.codex_openclaw_control_plane_base_url,
            token=settings.codex_openclaw_control_plane_token,
            timeout_seconds=settings.openclaw_timeout_seconds,
        )
        if settings.codex_openclaw_control_plane_base_url
        else None
    )
    message_bridge_service = MessageBridgeService(store=trace_store, provider=message_bridge_provider)
    openkb_client = (
        OpenKbClient(
            base_url=settings.openkb_base_url,
            token=settings.openkb_token,
        )
        if settings.openkb_sync_enabled and settings.openkb_base_url
        else None
    )
    if overrides and overrides.get("codex_use_deterministic_provider"):
        codex_interactive_provider = DeterministicCodexInteractiveProvider()
    else:
        codex_interactive_provider = CodexInteractiveProvider(
            client_factory=lambda: CodexAppServerClient(
                codex_bin=settings.codex_bin,
                codex_home=settings.codex_home,
                request_timeout_seconds=settings.codex_turn_timeout_seconds,
                process_start_timeout_seconds=settings.codex_process_start_timeout_seconds,
                wsl_enabled=settings.codex_wsl_enabled,
                wsl_exec=settings.codex_wsl_exec,
            ),
            turn_timeout_seconds=settings.codex_turn_timeout_seconds,
        )
    codex_worktree_manager = CodexWorktreeManager(
        worktree_root=settings.codex_worktree_root,
        branch_prefix=settings.codex_branch_prefix,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        worker_task = None
        bridge_task = None
        codex_review_task = None
        codex_knowledge_task = None
        codex_author_knowledge_reconciliation_task = None
        codex_author_knowledge_openclaw_delivery_task = None
        codex_review_control_plane_task = None
        if settings.tts_service_enabled:
            worker_task = asyncio.create_task(run_message_tts_worker(app))
        should_start_bridge = (
            bool(settings.admin_user_ids)
            and bool(settings.openclaw_token)
            and (overrides is None or bool(overrides.get("enable_message_bridge_worker")))
        )
        if should_start_bridge:
            bridge_task = asyncio.create_task(
                app.state.message_bridge_service.run_forever(settings.admin_user_ids[0])
            )
        should_start_codex_review_worker = (
            settings.codex_openclaw_review_enabled
            and bool(settings.openclaw_token)
            and (overrides is None or bool(overrides.get("enable_codex_openclaw_review_worker")))
        )
        if should_start_codex_review_worker:
            codex_review_task = asyncio.create_task(run_codex_review_sync_worker(app))
        should_start_codex_knowledge_worker = (
            settings.codex_knowledge_extraction_enabled
            and bool(settings.openclaw_token)
            and (overrides is None or bool(overrides.get("enable_codex_knowledge_extraction_worker")))
        )
        if should_start_codex_knowledge_worker:
            codex_knowledge_task = asyncio.create_task(run_codex_knowledge_extraction_worker(app))
        if knowledge_handoff_store is not None:
            codex_author_knowledge_reconciliation_task = asyncio.create_task(
                run_codex_author_knowledge_reconciliation_worker(app)
            )
        should_start_codex_author_knowledge_openclaw_delivery = (
            settings.codex_author_knowledge_openclaw_delivery_enabled
            and knowledge_handoff_store is not None
            and app.state.openclaw_control_plane_client is not None
            and bool(settings.codex_openclaw_control_plane_token)
        )
        if should_start_codex_author_knowledge_openclaw_delivery:
            codex_author_knowledge_openclaw_delivery_task = asyncio.create_task(
                run_codex_author_knowledge_openclaw_delivery_worker(app)
            )
        should_start_codex_review_control_plane_worker = (
            settings.codex_openclaw_control_plane_enabled
            and app.state.openclaw_control_plane_client is not None
            and bool(settings.codex_openclaw_control_plane_token)
            and (overrides is None or bool(overrides.get("enable_codex_openclaw_control_plane_worker")))
        )
        if should_start_codex_review_control_plane_worker:
            codex_review_control_plane_task = asyncio.create_task(run_codex_review_control_plane_worker(app))
        try:
            yield
        finally:
            if worker_task is not None:
                worker_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await worker_task
            if bridge_task is not None:
                bridge_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await bridge_task
            if codex_review_task is not None:
                codex_review_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await codex_review_task
            if codex_knowledge_task is not None:
                codex_knowledge_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await codex_knowledge_task
            if codex_author_knowledge_reconciliation_task is not None:
                codex_author_knowledge_reconciliation_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await codex_author_knowledge_reconciliation_task
            if codex_author_knowledge_openclaw_delivery_task is not None:
                codex_author_knowledge_openclaw_delivery_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await codex_author_knowledge_openclaw_delivery_task
            if codex_review_control_plane_task is not None:
                codex_review_control_plane_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await codex_review_control_plane_task
            close_codex = getattr(app.state.codex_interactive_provider, "close_all_sessions", None)
            if close_codex is not None:
                await close_codex()
        await app.state.tts_client.close()
        await app.state.openclaw_client.close()
        control_plane_close = getattr(getattr(app.state, "openclaw_control_plane_client", None), "close", None)
        if control_plane_close is not None:
            await control_plane_close()
        openkb_close = getattr(getattr(app.state, "openkb_client", None), "close", None)
        if openkb_close is not None:
            await openkb_close()
        await app.state.message_bridge_service.provider.close()
        if app.state.knowledge_handoff_store is not None:
            app.state.knowledge_handoff_store.close()
        if app.state.codex_knowledge_whitelist_store is not None:
            app.state.codex_knowledge_whitelist_store.close()
        app.state.trace_store.close()

    app = FastAPI(title="MMD Companion API", version="0.1.0", lifespan=lifespan)

    async def enqueue_bridge_auto_tts(message: dict, binding: dict, source: str) -> None:
        if not settings.tts_service_enabled:
            return
        trace_user_id = trace_store.get_account_external_user_id(binding["account_id"]) or binding["account_id"]
        trace_id = f"message-bridge-auto-tts-{message['id']}"
        try:
            await create_or_enqueue_message_tts_reference(
                app,
                message,
                trace_user_id=trace_user_id,
                trace_session_id=binding["local_session_id"],
                trace_id=trace_id,
            )
        except Exception as error:
            trace_store.create_message_tts(
                message["workspace_id"],
                message["id"],
                status="failed",
                task_id=None,
                remote_audio_url=None,
                media_type=None,
                error=str(error),
            )
            trace_store.insert_event(
                trace_id=trace_id,
                user_id=trace_user_id,
                session_id=binding["local_session_id"],
                stage="message_bridge.tts.auto",
                status="error",
                latency_ms=None,
                error_code=type(error).__name__,
                payload={
                    "message_id": message["id"],
                    "external_session_key": binding["external_session_key"],
                    "source": source,
                    "error": str(error),
                },
            )

    message_bridge_service.greeting_index_path = settings.openclaw_greeting_index_path
    message_bridge_service.auto_tts_handler = enqueue_bridge_auto_tts

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = settings
    app.state.trace_store = trace_store
    app.state.knowledge_handoff_store = knowledge_handoff_store
    app.state.codex_knowledge_whitelist_store = knowledge_whitelist_store
    app.state.openclaw_client = openclaw_client
    app.state.openclaw_control_plane_client = openclaw_control_plane_client
    app.state.openkb_client = openkb_client
    app.state.tts_client = tts_client
    app.state.message_bridge_service = message_bridge_service
    app.state.codex_interactive_provider = codex_interactive_provider
    app.state.codex_interactive_control = CodexInteractiveSessionControl()
    app.state.codex_worktree_manager = codex_worktree_manager
    app.state.codex_check_commands = {
        "api": [["pytest", "api/tests", "-q"]],
        "web_basic": [["npm", "--prefix", "web", "run", "check:basic"]],
    }
    app.state.daily_podcast_refresh_cooldown = DailyPodcastRefreshCooldown(cooldown_seconds=10)
    app.state.realtime_voice_registry = RealtimeVoiceChunkRegistry()
    app.state.realtime_voice_queues = {}
    app.state.last_cleanup_check = datetime.now(UTC)
    app.state.last_codex_review_control_plane_snapshot = None

    app.include_router(health_router)
    app.include_router(chat_router)
    app.include_router(codex_interactive_router)
    app.include_router(codex_knowledge_router)
    app.include_router(codex_author_knowledge_handoff_router)
    app.include_router(codex_author_knowledge_review_router)
    app.include_router(codex_knowledge_whitelist_admin_router)
    app.include_router(codex_review_router)
    app.include_router(openclaw_tools_router)
    app.include_router(message_bridge_router)
    app.include_router(message_service_router)
    app.include_router(podcasts_router)
    app.include_router(realtime_voice_router)
    app.include_router(trace_router)
    app.include_router(config_router)
    app.include_router(desktop_pet_router)
    app.include_router(assets_router)
    app.include_router(tts_router)
    return app


app = create_app()
