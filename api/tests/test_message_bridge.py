from __future__ import annotations

import asyncio
import contextlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from app.db.store import TraceStore
from app.services.message_bridge import ExternalMessage, ExternalSession, MessageBridgeService, OpenClawGatewayProvider


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _store() -> TraceStore:
    case_dir = _make_case_dir()
    return TraceStore(db_path=case_dir / "sqlite" / "trace.db", ndjson_dir=case_dir / "logs")


def _client_with_bridge() -> tuple[TestClient, object, FakeBridgeProvider]:
    provider = FakeBridgeProvider()
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": ["admin-1"]})
    app.state.message_bridge_service = MessageBridgeService(store=app.state.trace_store, provider=provider)
    client = TestClient(app)
    client.__enter__()
    return client, app, provider


def test_bridge_state_defaults_to_enabled_openclaw_feishu():
    store = _store()
    try:
        state = store.get_message_bridge_state("openclaw", "feishu")

        assert state["provider"] == "openclaw"
        assert state["channel"] == "feishu"
        assert state["enabled"] is True
        assert state["realtime_drive_character"] is True
        assert state["websocket_status"] == "disconnected"
        assert state["reconnect_attempts"] == 0
        assert state["last_error"] is None
    finally:
        store.close()


def test_bridge_default_binding_is_scoped_to_owner_workspace():
    store = _store()
    try:
        ctx = store.get_current_workspace_context("admin-1")
        session = store.create_session(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            title="用户746923",
        )

        binding = store.upsert_message_bridge_binding(
            workspace_id=ctx["workspace"]["id"],
            account_id=ctx["account"]["id"],
            local_session_id=session["id"],
            provider="openclaw",
            channel="feishu",
            external_session_key="agent:main:feishu:direct:ou_abc",
            external_display_name="用户746923",
            is_default=True,
            status="active",
        )

        fetched = store.get_default_message_bridge_binding(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            provider="openclaw",
            channel="feishu",
        )
        other = store.get_current_workspace_context("other-user")
        denied = store.get_default_message_bridge_binding(
            other["workspace"]["id"],
            other["account"]["id"],
            provider="openclaw",
            channel="feishu",
        )

        assert binding["external_session_key"] == "agent:main:feishu:direct:ou_abc"
        assert fetched["id"] == binding["id"]
        assert fetched["is_default"] is True
        assert denied is None
    finally:
        store.close()


def test_bridge_external_message_id_is_deduped_and_persisted():
    store = _store()
    try:
        ctx = store.get_current_workspace_context("admin-1")
        session = store.create_session(ctx["workspace"]["id"], ctx["account"]["id"])

        first = store.insert_message(
            ctx["workspace"]["id"],
            session["id"],
            ctx["account"]["id"],
            role="assistant",
            content="同步消息",
            openclaw_message_id="openclaw-msg-1",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": "agent:main:feishu:direct:ou_abc",
            },
        )
        duplicate = store.insert_message_if_external_missing(
            ctx["workspace"]["id"],
            session["id"],
            ctx["account"]["id"],
            role="assistant",
            content="同步消息",
            openclaw_message_id="openclaw-msg-1",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": "agent:main:feishu:direct:ou_abc",
            },
        )

        messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], session["id"])

        assert first["openclaw_message_id"] == "openclaw-msg-1"
        assert duplicate["id"] == first["id"]
        assert len(messages) == 1
        assert messages[0]["metadata"]["source"] == "message_bridge"
    finally:
        store.close()


def test_chat_list_suppresses_nearby_bridge_duplicates_with_different_external_ids():
    store = _store()
    try:
        ctx = store.get_current_workspace_context("admin-1")
        session = store.create_session(ctx["workspace"]["id"], ctx["account"]["id"])
        metadata = {
            "source": "message_bridge",
            "provider": "openclaw",
            "channel": "feishu",
            "external_session_key": "agent:main:feishu:direct:ou_abc",
            "synced_from": "realtime",
        }

        first = store.insert_message(
            ctx["workspace"]["id"],
            session["id"],
            ctx["account"]["id"],
            role="user",
            content="MMD test",
            openclaw_message_id="bridge-long-id",
            metadata={**metadata, "external_message_id": "bridge-long-id"},
        )
        second = store.insert_message(
            ctx["workspace"]["id"],
            session["id"],
            ctx["account"]["id"],
            role="user",
            content="MMD test",
            openclaw_message_id="bridge-short-id",
            metadata={**metadata, "external_message_id": "bridge-short-id"},
        )

        raw_messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], session["id"])
        chat_messages = store.list_messages_for_chat(ctx["workspace"]["id"], ctx["account"]["id"], session["id"])

        assert [message["id"] for message in raw_messages] == [first["id"], second["id"]]
        assert [message["id"] for message in chat_messages] == [first["id"]]
    finally:
        store.close()


def test_chat_list_suppresses_backfill_duplicate_after_poll_interval():
    store = _store()
    try:
        ctx = store.get_current_workspace_context("admin-1")
        session = store.create_session(ctx["workspace"]["id"], ctx["account"]["id"])
        external_session_key = "agent:main:feishu:direct:ou_abc"
        base_time = datetime.now(UTC) - timedelta(seconds=20)

        first = store.insert_message(
            ctx["workspace"]["id"],
            session["id"],
            ctx["account"]["id"],
            role="user",
            content="MMD test",
            openclaw_message_id="bridge-long-id",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": external_session_key,
                "synced_from": "realtime",
                "external_message_id": "bridge-long-id",
            },
        )
        second = store.insert_message(
            ctx["workspace"]["id"],
            session["id"],
            ctx["account"]["id"],
            role="user",
            content="MMD test",
            openclaw_message_id="bridge-short-id",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": external_session_key,
                "synced_from": "realtime_backfill",
                "external_message_id": "bridge-short-id",
            },
        )
        store._conn.execute(
            "UPDATE messages SET created_at = ? WHERE id = ?",
            (base_time.isoformat(), first["id"]),
        )
        store._conn.execute(
            "UPDATE messages SET created_at = ? WHERE id = ?",
            ((base_time + timedelta(seconds=15)).isoformat(), second["id"]),
        )
        store._conn.commit()

        raw_messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], session["id"])
        chat_messages = store.list_messages_for_chat(ctx["workspace"]["id"], ctx["account"]["id"], session["id"])

        assert [message["id"] for message in raw_messages] == [first["id"], second["id"]]
        assert [message["id"] for message in chat_messages] == [first["id"]]
    finally:
        store.close()


class FakeBridgeProvider:
    provider = "openclaw"
    channel = "feishu"

    def __init__(self):
        self.sessions = [
            ExternalSession(
                key="agent:main:feishu:direct:old",
                display_name="旧会话",
                provider="feishu",
                channel="feishu",
                updated_at=100,
                raw={},
            ),
            ExternalSession(
                key="agent:main:feishu:direct:new",
                display_name="最新会话",
                provider="feishu",
                channel="feishu",
                updated_at=200,
                raw={},
            ),
        ]
        self.history = {
            "agent:main:feishu:direct:new": [
                ExternalMessage(
                    id="tool-1",
                    role="toolResult",
                    content="internal",
                    timestamp=201,
                    raw={"role": "toolResult"},
                ),
                ExternalMessage(
                    id="user-1",
                    role="user",
                    content="你好",
                    timestamp=202,
                    raw={"role": "user"},
                ),
                ExternalMessage(
                    id="assistant-1",
                    role="assistant",
                    content='{"text":"你好呀","emotion":"happy","action":"wave","motion_plan":{"sequence":[]}}',
                    timestamp=203,
                    raw={"role": "assistant"},
                ),
            ]
        }
        self.subscribed = []
        self.unsubscribed = []
        self.events = asyncio.Queue()

    async def connect(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def list_external_sessions(self):
        return self.sessions

    async def fetch_history(self, session_key: str, limit: int):
        return self.history.get(session_key, [])[-limit:]

    async def subscribe(self, session_key: str) -> None:
        self.subscribed.append(session_key)
        return None

    async def unsubscribe(self, session_key: str) -> None:
        self.unsubscribed.append(session_key)
        return None

    async def receive_event(self):
        return await self.events.get()


def test_bridge_binds_latest_feishu_session_and_syncs_history():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)

        binding = service.sync_default_binding_for_user("admin-1")

        assert binding["external_session_key"] == "agent:main:feishu:direct:new"
        assert binding["external_display_name"] == "最新会话"

        ctx = store.get_current_workspace_context("admin-1")
        session = store.get_session(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])
        messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])

        assert session["openclaw_session_key"] == binding["external_session_key"]
        assert [message["role"] for message in messages] == ["user", "assistant"]
        assert messages[0]["content"] == "你好"
        assert messages[1]["content"] == "你好呀"
        assert messages[1]["emotion"] == "happy"
        assert messages[1]["action"] == "wave"
        assert messages[1]["metadata"]["source"] == "message_bridge"
        assert messages[1]["metadata"]["synced_from"] == "history"
        assert messages[1]["motion_resolution"]["status"] == "fallback_idle"

        events = store.query_events(trace_id=None, requester_user_id="admin-1", is_admin=False)
        stages = {event["stage"] for event in events}
        assert "message_bridge.openclaw.sessions.list" in stages
        assert "message_bridge.openclaw.session.bind" in stages
        assert "message_bridge.openclaw.history.load" in stages
        assert "message_bridge.openclaw.subscribe" in stages
        assert "message_bridge.openclaw.message.received" in stages
    finally:
        store.close()


def test_bridge_default_binding_prefers_feishu_direct_over_generic_main_session():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        provider.sessions.insert(
            0,
            ExternalSession(
                key="agent:main:main",
                display_name="用户746923",
                provider="feishu",
                channel="feishu",
                updated_at=300,
                raw={},
            ),
        )
        service = MessageBridgeService(store=store, provider=provider)

        binding = service.sync_default_binding_for_user("admin-1")

        assert binding["external_session_key"] == "agent:main:feishu:direct:new"
        assert binding["external_display_name"] == "最新会话"
    finally:
        store.close()


def test_bridge_default_binding_keeps_existing_feishu_direct_session():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        provider.sessions.insert(
            0,
            ExternalSession(
                key="agent:main:main",
                display_name="用户746923",
                provider="feishu",
                channel="feishu",
                updated_at=300,
                raw={},
            ),
        )
        service = MessageBridgeService(store=store, provider=provider)
        ctx = store.get_current_workspace_context("admin-1")
        direct_session = store.create_session(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            title="旧会话",
            openclaw_session_key="agent:main:feishu:direct:old",
        )
        existing = store.upsert_message_bridge_binding(
            workspace_id=ctx["workspace"]["id"],
            account_id=ctx["account"]["id"],
            local_session_id=direct_session["id"],
            provider="openclaw",
            channel="feishu",
            external_session_key="agent:main:feishu:direct:old",
            external_display_name="旧会话",
            is_default=True,
            status="active",
        )

        binding = service.sync_default_binding_for_user("admin-1")

        assert binding["id"] == existing["id"]
        assert binding["external_session_key"] == "agent:main:feishu:direct:old"
        assert binding["local_session_id"] == direct_session["id"]
    finally:
        store.close()


def test_bridge_realtime_message_uses_idle_defaults_when_no_motion_fields():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        binding = service.sync_default_binding_for_user("admin-1")

        message = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="assistant-plain",
                role="assistant",
                content="普通回复",
                timestamp=300,
                raw={"role": "assistant"},
            ),
            source="realtime",
        )

        assert message["content"] == "普通回复"
        assert message["emotion"] == "neutral"
        assert message["action"] == "idle"
        assert message["metadata"]["synced_from"] == "realtime"
        assert message["motion_resolution"]["status"] == "fallback_idle"
    finally:
        store.close()


def test_bridge_realtime_thinking_message_resolves_selected_model_reference_vmd():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        ctx = store.get_current_workspace_context("admin-1")
        model_path = "Eula/Eula.pmx"
        session = store.create_session(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            selected_model_path=model_path,
            openclaw_session_key="agent:main:feishu:direct:think",
        )
        binding = store.upsert_message_bridge_binding(
            workspace_id=ctx["workspace"]["id"],
            account_id=ctx["account"]["id"],
            local_session_id=session["id"],
            provider="openclaw",
            channel="feishu",
            external_session_key="agent:main:feishu:direct:think",
            external_display_name="思考会话",
            is_default=True,
            status="active",
        )
        reference_asset = store.add_asset(
            user_id="admin-1",
            slot="neutral",
            filename="思考_100pct_reference.vmd",
            source_relative_path="usage/vmd/Eula[动作]/03_thinking_waiting/思考_100pct_reference.vmd",
            relative_path="usage/vmd/Eula[动作]/03_thinking_waiting/思考_100pct_reference.vmd",
            size_bytes=64,
        )
        store.update_asset(
            reference_asset["asset_id"],
            display_name="思考_100pct_reference.vmd",
            is_favorite=True,
            favorite_relative_path="usage/vmd/Eula[动作]/03_thinking_waiting/思考_100pct_reference.vmd",
            favorite_model_relative_path=model_path,
        )
        # 收藏归属以 asset_model_favorites 为准。
        store.add_model_favorite(
            "admin-1",
            model_path,
            reference_asset["asset_id"],
            display_name="思考_100pct_reference.vmd",
        )

        message = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="assistant-thinking",
                role="assistant",
                content=(
                    '{"text":"我先想一下。","emotion":"thinking","action":"think",'
                    '"motion_plan":{"sequence":[{"template":"thinking_tilt","duration_ms":1700,"intensity":0.6}]},'
                    '"memory_ops":[]}'
                ),
                timestamp=300,
                raw={"role": "assistant"},
            ),
            source="realtime",
        )

        assert message["content"] == "我先想一下。"
        assert message["emotion"] == "thinking"
        assert message["action"] == "think"
        assert message["motion_resolution"]["status"] == "matched"
        assert message["motion_resolution"]["selected_model_path"] == model_path
        assert message["motion_resolution"]["source_template"] == "thinking_tilt"
        assert message["motion_resolution"]["resolved_asset_id"] == reference_asset["asset_id"]
        assert message["motion_resolution"]["resolved_asset_url"] == f"/assets/vmd/file/{reference_asset['asset_id']}"
    finally:
        store.close()


def test_bridge_skips_empty_assistant_fallback_messages():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        binding = service.sync_default_binding_for_user("admin-1")

        message = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="assistant-empty",
                role="assistant",
                content="",
                timestamp=300,
                raw={"role": "assistant"},
            ),
            source="realtime",
        )
        messages = store.list_messages(binding["workspace_id"], binding["account_id"], binding["local_session_id"])

        assert message is None
        assert all(item.get("openclaw_message_id") != "assistant-empty" for item in messages)
        assert all(item["content"] != "I am here. Let's keep going." for item in messages)
    finally:
        store.close()


def test_bridge_control_messages_land_as_internal_and_stay_out_of_chat_list():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        binding = service.sync_default_binding_for_user("admin-1")

        system_message = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="system-compaction",
                role="system",
                content="Compaction",
                timestamp=301,
                raw={"role": "system"},
            ),
            source="realtime",
        )
        failed_turn = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="assistant-failed-turn",
                role="assistant",
                content="[assistant turn failed before producing content]",
                timestamp=302,
                raw={"role": "assistant"},
            ),
            source="realtime",
        )

        raw_messages = store.list_messages(binding["workspace_id"], binding["account_id"], binding["local_session_id"])
        chat_messages = store.list_messages_for_chat(
            binding["workspace_id"],
            binding["account_id"],
            binding["local_session_id"],
        )

        assert system_message is not None
        assert failed_turn is not None
        control_contents = {"Compaction", "[assistant turn failed before producing content]"}
        raw_control_messages = [message for message in raw_messages if message["content"] in control_contents]
        chat_control_messages = [message for message in chat_messages if message["content"] in control_contents]

        assert [(message["role"], message["content"], message.get("visibility")) for message in raw_control_messages] == [
            ("system", "Compaction", "internal"),
            ("assistant", "[assistant turn failed before producing content]", "internal"),
        ]
        assert chat_control_messages == []
    finally:
        store.close()


def test_bridge_preserves_openclaw_greeting_metadata_and_marks_auto_tts():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        binding = service.sync_default_binding_for_user("admin-1")

        message = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="openclaw-greeting-1",
                role="assistant",
                content="中午好，sola。",
                timestamp=int(datetime(2026, 5, 17, 4, 1, 52, tzinfo=UTC).timestamp() * 1000),
                raw={
                    "role": "assistant",
                    "openclawMetadata": {
                        "source": "greeting-cron",
                        "greetingType": "noon",
                        "audioFile": "/Users/sola/noon_20260517_1200.ogg",
                    },
                },
            ),
            source="realtime",
        )

        assert message["metadata"]["openclaw_metadata"]["source"] == "greeting-cron"
        assert message["metadata"]["greeting_cron"]["source"] == "openclaw_metadata"
        assert message["metadata"]["greeting_cron"]["greetingType"] == "noon"
        assert message["metadata"]["auto_tts"] is True
    finally:
        store.close()


def test_bridge_joins_greeting_side_index_by_session_text_and_time():
    case_dir = _make_case_dir()
    index_path = case_dir / "greeting-dashboard-injections.jsonl"
    index_path.write_text(
        json.dumps(
            {
                "ts": "2026-05-17T04:01:52.936Z",
                "source": "greeting-cron",
                "greetingType": "noon",
                "dashboardSessionKey": "agent:main:feishu:direct:new",
                "dashboardText": "中午好，sola。",
                "audioFile": "/Users/sola/noon_20260517_1200.ogg",
                "feishuMessageId": "om_noon",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    store = TraceStore(db_path=case_dir / "sqlite" / "trace.db", ndjson_dir=case_dir / "logs")
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider, greeting_index_path=index_path)
        binding = service.sync_default_binding_for_user("admin-1")

        message = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="dashboard-greeting-1",
                role="assistant",
                content="中午好，sola。",
                timestamp=int(datetime(2026, 5, 17, 4, 1, 40, tzinfo=UTC).timestamp() * 1000),
                raw={"role": "assistant"},
            ),
            source="realtime",
        )

        assert message["metadata"]["greeting_cron"]["source"] == "side_index"
        assert message["metadata"]["greeting_cron"]["greetingType"] == "noon"
        assert message["metadata"]["greeting_cron"]["feishuMessageId"] == "om_noon"
        assert message["metadata"]["auto_tts"] is True
    finally:
        store.close()


def test_bridge_auto_tts_handler_runs_for_joined_greeting_without_existing_tts():
    async def run_case():
        case_dir = _make_case_dir()
        index_path = case_dir / "greeting-dashboard-injections.jsonl"
        index_path.write_text(
            json.dumps(
                {
                    "ts": "2026-05-17T04:01:52.936Z",
                    "source": "greeting-cron",
                    "greetingType": "noon",
                    "dashboardSessionKey": "agent:main:feishu:direct:new",
                    "dashboardText": "中午好，sola。",
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        store = TraceStore(db_path=case_dir / "sqlite" / "trace.db", ndjson_dir=case_dir / "logs")
        try:
            calls = []

            async def auto_tts_handler(message, binding, source):
                calls.append((message["id"], binding["external_session_key"], source))

            provider = FakeBridgeProvider()
            provider.history["agent:main:feishu:direct:new"].append(
                ExternalMessage(
                    id="dashboard-greeting-history",
                    role="assistant",
                    content="中午好，sola。",
                    timestamp=int(datetime(2026, 5, 17, 4, 1, 40, tzinfo=UTC).timestamp() * 1000),
                    raw={"role": "assistant"},
                )
            )
            service = MessageBridgeService(
                store=store,
                provider=provider,
                greeting_index_path=index_path,
                auto_tts_handler=auto_tts_handler,
            )

            await service.ensure_default_binding_for_user("admin-1")

            assert len(calls) == 1
            assert calls[0][1] == "agent:main:feishu:direct:new"
            assert calls[0][2] == "history"
        finally:
            store.close()

    asyncio.run(run_case())


def test_bridge_backfills_existing_greeting_messages_from_side_index_and_queues_tts():
    async def run_case():
        case_dir = _make_case_dir()
        index_path = case_dir / "greeting-dashboard-injections.jsonl"
        index_path.write_text(
            json.dumps(
                {
                    "ts": "2026-05-17T04:01:52.936Z",
                    "source": "greeting-cron",
                    "greetingType": "noon",
                    "dashboardSessionKey": "agent:main:feishu:direct:ou_test",
                    "dashboardText": "中午好，sola。",
                    "feishuMessageId": "om_noon",
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        store = TraceStore(db_path=case_dir / "sqlite" / "trace.db", ndjson_dir=case_dir / "logs")
        try:
            ctx = store.get_current_workspace_context("admin-1")
            session = store.create_session(
                ctx["workspace"]["id"],
                ctx["account"]["id"],
                title="Feishu",
                openclaw_session_key="agent:main:feishu:direct:ou_test",
            )
            message = store.insert_message(
                ctx["workspace"]["id"],
                session["id"],
                ctx["account"]["id"],
                role="assistant",
                content="中午好，sola。",
                openclaw_message_id="local-greeting",
                metadata={
                    "source": "message_bridge",
                    "provider": "openclaw",
                    "channel": "feishu",
                    "external_session_key": "agent:main:feishu:direct:ou_test",
                    "external_message_id": "local-greeting",
                    "synced_from": "realtime",
                },
            )
            calls = []

            async def auto_tts_handler(message, binding, source):
                calls.append((message["id"], binding["external_session_key"], source))

            service = MessageBridgeService(
                store=store,
                provider=FakeBridgeProvider(),
                greeting_index_path=index_path,
                auto_tts_handler=auto_tts_handler,
            )

            result = await service.backfill_greeting_metadata_for_user("admin-1")
            updated = store.get_message(ctx["workspace"]["id"], ctx["account"]["id"], message["id"])

            assert result["updated_count"] == 1
            assert updated["metadata"]["greeting_cron"]["source"] == "side_index"
            assert updated["metadata"]["greeting_cron"]["feishuMessageId"] == "om_noon"
            assert updated["metadata"]["auto_tts"] is True
            assert calls == [(message["id"], "agent:main:feishu:direct:ou_test", "side_index_backfill")]
        finally:
            store.close()

    asyncio.run(run_case())


def test_bridge_skips_realtime_echo_when_local_traced_message_exists():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        binding = service.sync_default_binding_for_user("admin-1")
        store.insert_message(
            binding["workspace_id"],
            binding["local_session_id"],
            binding["account_id"],
            role="user",
            content="hi",
            trace_id="trace-local",
        )

        inserted = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="bridge-user-echo",
                role="user",
                content="hi",
                timestamp=301,
                raw={"role": "user"},
            ),
            source="realtime",
        )
        messages = store.list_messages(binding["workspace_id"], binding["account_id"], binding["local_session_id"])
        user_messages = [message for message in messages if message["role"] == "user" and message["content"] == "hi"]

        assert inserted is None
        assert len(user_messages) == 1
        assert user_messages[0]["trace_id"] == "trace-local"
    finally:
        store.close()


def test_bridge_skips_nearby_duplicate_realtime_message_with_different_external_ids():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        binding = service.sync_default_binding_for_user("admin-1")

        first = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="bridge-long-id",
                role="user",
                content="MMD test",
                timestamp=301,
                raw={"role": "user"},
            ),
            source="realtime",
        )
        duplicate = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="bridge-short-id",
                role="user",
                content="MMD test",
                timestamp=302,
                raw={"role": "user"},
            ),
            source="realtime",
        )
        messages = store.list_messages(binding["workspace_id"], binding["account_id"], binding["local_session_id"])
        user_messages = [message for message in messages if message["role"] == "user" and message["content"] == "MMD test"]

        assert first is not None
        assert duplicate is None
        assert len(user_messages) == 1
    finally:
        store.close()


def test_bridge_skips_backfill_duplicate_after_poll_interval():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        binding = service.sync_default_binding_for_user("admin-1")

        first = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="bridge-long-id",
                role="user",
                content="MMD test",
                timestamp=301,
                raw={"role": "user"},
            ),
            source="realtime",
        )
        store._conn.execute(
            "UPDATE messages SET created_at = ? WHERE id = ?",
            ((datetime.now(UTC) - timedelta(seconds=15)).isoformat(), first["id"]),
        )
        store._conn.commit()
        duplicate = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="bridge-short-id",
                role="user",
                content="MMD test",
                timestamp=316,
                raw={"role": "user"},
            ),
            source="realtime_backfill",
        )
        messages = store.list_messages(binding["workspace_id"], binding["account_id"], binding["local_session_id"])
        user_messages = [message for message in messages if message["role"] == "user" and message["content"] == "MMD test"]

        assert first is not None
        assert duplicate is None
        assert len(user_messages) == 1
    finally:
        store.close()


def test_bridge_repairs_existing_binding_session_key_to_feishu_session():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        ctx = store.get_current_workspace_context("admin-1")
        stale_session = store.create_session(ctx["workspace"]["id"], ctx["account"]["id"], title="最新会话")
        binding = store.upsert_message_bridge_binding(
            workspace_id=ctx["workspace"]["id"],
            account_id=ctx["account"]["id"],
            local_session_id=stale_session["id"],
            provider="openclaw",
            channel="feishu",
            external_session_key="agent:main:feishu:direct:new",
            external_display_name="最新会话",
            is_default=True,
            status="active",
        )

        repaired = service.sync_default_binding_for_user("admin-1")
        session = store.get_session(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])

        assert repaired["id"] == binding["id"]
        assert session["openclaw_session_key"] == "agent:main:feishu:direct:new"
    finally:
        store.close()


def test_bridge_switch_reuses_existing_local_session_with_external_messages():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        ctx = store.get_current_workspace_context("admin-1")
        reused_session = store.create_session(ctx["workspace"]["id"], ctx["account"]["id"], title="旧会话")
        store.insert_message(
            ctx["workspace"]["id"],
            reused_session["id"],
            ctx["account"]["id"],
            role="assistant",
            content="already synced",
            openclaw_message_id="old-assistant-1",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": "agent:main:feishu:direct:old",
                "external_message_id": "old-assistant-1",
                "synced_from": "history",
            },
        )
        service.sync_default_binding_for_user("admin-1")

        binding = service.bind_external_session_for_user("admin-1", "agent:main:feishu:direct:old")
        session = store.get_session(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])
        messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])

        assert binding["local_session_id"] == reused_session["id"]
        assert session["openclaw_session_key"] == "agent:main:feishu:direct:old"
        assert [message["content"] for message in messages] == ["already synced"]
    finally:
        store.close()


def test_bridge_switch_prefers_existing_messages_over_empty_binding_session():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        ctx = store.get_current_workspace_context("admin-1")
        reused_session = store.create_session(ctx["workspace"]["id"], ctx["account"]["id"], title="旧会话")
        empty_session = store.create_session(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            title="旧会话 empty",
            openclaw_session_key="agent:main:feishu:direct:old",
        )
        store.insert_message(
            ctx["workspace"]["id"],
            reused_session["id"],
            ctx["account"]["id"],
            role="assistant",
            content="historical local message",
            openclaw_message_id="old-assistant-2",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": "agent:main:feishu:direct:old",
                "external_message_id": "old-assistant-2",
                "synced_from": "history",
            },
        )
        store.upsert_message_bridge_binding(
            workspace_id=ctx["workspace"]["id"],
            account_id=ctx["account"]["id"],
            local_session_id=empty_session["id"],
            provider="openclaw",
            channel="feishu",
            external_session_key="agent:main:feishu:direct:old",
            external_display_name="旧会话",
            is_default=True,
            status="active",
        )

        binding = service.bind_external_session_for_user("admin-1", "agent:main:feishu:direct:old")
        session = store.get_session(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])
        messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])

        assert binding["local_session_id"] == reused_session["id"]
        assert session["openclaw_session_key"] == "agent:main:feishu:direct:old"
        assert [message["content"] for message in messages] == ["historical local message"]
    finally:
        store.close()


def test_bridge_admin_status_and_settings_routes_are_admin_only():
    client, app, _ = _client_with_bridge()
    try:
        app.state.message_bridge_service.sync_default_binding_for_user("admin-1")

        denied = client.get("/admin/message-bridge/status", headers={"x-user-id": "u1"})
        status = client.get("/admin/message-bridge/status", headers={"x-user-id": "admin-1"})
        patched = client.patch(
            "/admin/message-bridge/settings",
            headers={"x-user-id": "admin-1"},
            json={"enabled": False, "realtime_drive_character": False},
        )

        assert denied.status_code == 403
        assert status.status_code == 200
        assert status.json()["provider"] == "openclaw"
        assert status.json()["channel"] == "feishu"
        assert status.json()["binding"]["external_display_name"] == "最新会话"
        assert patched.status_code == 200
        assert patched.json()["enabled"] is False
        assert patched.json()["realtime_drive_character"] is False
    finally:
        client.__exit__(None, None, None)


def test_bridge_admin_can_list_feishu_sessions_and_switch_default_binding():
    client, app, provider = _client_with_bridge()
    try:
        app.state.message_bridge_service.sync_default_binding_for_user("admin-1")

        sessions = client.get("/admin/message-bridge/openclaw/feishu/sessions", headers={"x-user-id": "admin-1"})
        switched = client.post(
            "/admin/message-bridge/bindings/default",
            headers={"x-user-id": "admin-1"},
            json={
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": "agent:main:feishu:direct:old",
            },
        )

        assert sessions.status_code == 200
        assert [item["external_session_key"] for item in sessions.json()["items"]] == [
            "agent:main:feishu:direct:new",
            "agent:main:feishu:direct:old",
        ]
        assert switched.status_code == 200
        assert switched.json()["binding"]["external_session_key"] == "agent:main:feishu:direct:old"
        assert provider.unsubscribed == ["agent:main:feishu:direct:new"]
    finally:
        client.__exit__(None, None, None)


def test_bridge_session_list_returns_bad_gateway_when_openclaw_gateway_times_out():
    provider = FakeBridgeProvider()
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": ["admin-1"]})
    app.state.message_bridge_service = MessageBridgeService(store=app.state.trace_store, provider=provider)

    async def fail_list_external_sessions():
        raise TimeoutError("timed out during opening handshake")

    provider.list_external_sessions = fail_list_external_sessions
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/admin/message-bridge/openclaw/feishu/sessions", headers={"x-user-id": "admin-1"})

    assert response.status_code == 502
    assert "timed out during opening handshake" in response.json()["detail"]


def test_bridge_switch_keeps_binding_when_subscription_refresh_fails():
    async def run_case():
        store = _store()
        try:
            provider = FakeBridgeProvider()
            service = MessageBridgeService(store=store, provider=provider)
            store.update_message_bridge_state("openclaw", "feishu", websocket_status="connected")

            async def fail_subscribe(session_key: str) -> None:
                provider.subscribed.append(session_key)
                raise RuntimeError("subscribe failed")

            close_calls = []

            async def close_provider() -> None:
                close_calls.append("closed")

            provider.subscribe = fail_subscribe
            provider.close = close_provider

            binding = await service.bind_external_session_for_user_async("admin-1", "agent:main:feishu:direct:old")
            state = store.get_message_bridge_state("openclaw", "feishu")
            events = store.query_events(trace_id=None, requester_user_id="admin-1", is_admin=False)

            assert binding["external_session_key"] == "agent:main:feishu:direct:old"
            assert state["websocket_status"] == "reconnecting"
            assert state["last_error"] == "subscribe failed"
            assert close_calls == ["closed"]
            assert any(
                event["stage"] == "message_bridge.openclaw.subscribe"
                and event["status"] == "error"
                and event["error_code"] == "RuntimeError"
                for event in events
            )
        finally:
            store.close()

    asyncio.run(run_case())


def test_bridge_consumer_stops_when_bridge_is_disabled():
    async def run_case():
        store = _store()
        try:
            provider = FakeBridgeProvider()
            service = MessageBridgeService(store=store, provider=provider)
            binding = await service.ensure_default_binding_for_user("admin-1")
            store.update_message_bridge_state("openclaw", "feishu", enabled=False)

            await service._consume_events(binding)

            ctx = store.get_current_workspace_context("admin-1")
            messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])
            assert len(messages) == 2
        finally:
            store.close()

    asyncio.run(run_case())


def test_bridge_consumer_uses_latest_binding_after_switch():
    async def run_case():
        store = _store()
        try:
            provider = FakeBridgeProvider()
            service = MessageBridgeService(store=store, provider=provider)
            old_binding = await service.ensure_default_binding_for_user("admin-1")
            new_binding = await service.bind_external_session_for_user_async("admin-1", "agent:main:feishu:direct:old")

            await provider.events.put(
                {
                    "event": "session.message",
                    "payload": {
                        "message": {
                            "id": "assistant-after-switch",
                            "role": "assistant",
                            "content": "switched",
                            "timestamp": 400,
                        }
                    },
                }
            )
            await provider.events.put({"event": "bridge.test.stop", "payload": {}})
            await service._consume_events(old_binding, max_events=2)

            ctx = store.get_current_workspace_context("admin-1")
            old_messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], old_binding["local_session_id"])
            new_messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], new_binding["local_session_id"])
            assert all(message["content"] != "switched" for message in old_messages)
            assert any(message["content"] == "switched" for message in new_messages)
        finally:
            store.close()

    asyncio.run(run_case())


def test_bridge_consumer_backfills_history_when_realtime_subscription_misses_event():
    async def run_case():
        store = _store()
        try:
            provider = FakeBridgeProvider()
            service = MessageBridgeService(store=store, provider=provider)
            service.history_backfill_interval_seconds = 0.01
            binding = await service.ensure_default_binding_for_user("admin-1")
            provider.history["agent:main:feishu:direct:new"].append(
                ExternalMessage(
                    id="dashboard-late-message",
                    role="user",
                    content="dashboard late message",
                    timestamp=250,
                    raw={"role": "user"},
                )
            )

            async def wait_for_backfill():
                while True:
                    messages = store.list_messages(
                        binding["workspace_id"],
                        binding["account_id"],
                        binding["local_session_id"],
                    )
                    if any(message["content"] == "dashboard late message" for message in messages):
                        return
                    await asyncio.sleep(0.01)

            task = asyncio.create_task(service._consume_events(binding))
            try:
                await asyncio.wait_for(wait_for_backfill(), timeout=1)
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        finally:
            store.close()

    asyncio.run(run_case())


def test_openclaw_provider_queues_events_while_waiting_for_rpc_response():
    class FakeWebSocket:
        def __init__(self):
            self.sent = []
            self.messages = asyncio.Queue()

        async def send(self, payload):
            self.sent.append(json.loads(payload))

        async def recv(self):
            return await self.messages.get()

    async def run_case():
        provider = OpenClawGatewayProvider(base_url="http://openclaw.local", token="token")
        ws = FakeWebSocket()
        provider._ws = ws
        await ws.messages.put(json.dumps({"type": "event", "event": "session.message", "payload": {"message": {"id": "m1"}}}))
        await ws.messages.put(json.dumps({"type": "res", "id": "1", "ok": True, "payload": {"sessions": []}}))

        response = await provider._request("sessions.list", {})
        event = await provider.receive_event()

        assert response["ok"] is True
        assert event["event"] == "session.message"

    asyncio.run(run_case())


def test_openclaw_provider_allows_rpc_while_receive_event_is_waiting():
    class FakeWebSocket:
        def __init__(self):
            self.sent = []
            self.messages = asyncio.Queue()

        async def send(self, payload):
            self.sent.append(json.loads(payload))

        async def recv(self):
            return await self.messages.get()

    async def run_case():
        provider = OpenClawGatewayProvider(base_url="http://openclaw.local", token="token")
        ws = FakeWebSocket()
        provider._ws = ws

        receive_task = asyncio.create_task(provider.receive_event())
        await asyncio.sleep(0)
        request_task = asyncio.create_task(provider._request("sessions.list", {}))
        await asyncio.sleep(0)
        await ws.messages.put(json.dumps({"type": "res", "id": "1", "ok": True, "payload": {"sessions": []}}))
        await ws.messages.put(json.dumps({"type": "event", "event": "session.message", "payload": {"message": {"id": "m2"}}}))

        response = await asyncio.wait_for(request_task, timeout=1)
        event = await asyncio.wait_for(receive_task, timeout=1)

        assert response["ok"] is True
        assert event["event"] == "session.message"

    asyncio.run(run_case())


def test_openclaw_provider_parses_feishu_sessions_and_messages():
    provider = OpenClawGatewayProvider(
        base_url="http://openclaw.local",
        token="token",
        channel="feishu",
        timeout_seconds=1,
    )

    sessions = provider.parse_sessions(
        {
            "sessions": [
                {
                    "key": "agent:main:feishu:direct:ou_1",
                    "displayName": "用户1",
                    "updatedAt": 20,
                    "origin": {"provider": "feishu"},
                    "lastChannel": "feishu",
                },
                {
                    "key": "agent:main:other",
                    "displayName": "Other",
                    "updatedAt": 30,
                    "origin": {"provider": "web"},
                },
            ]
        }
    )
    messages = provider.parse_messages(
        {
            "messages": [
                {
                    "role": "assistant",
                    "content": "你好",
                    "timestamp": 123,
                    "responseId": "resp-1",
                    "__openclaw": {"id": "oc-1"},
                }
            ]
        }
    )

    assert len(sessions) == 1
    assert sessions[0].key == "agent:main:feishu:direct:ou_1"
    assert sessions[0].display_name == "用户1"
    assert sessions[0].updated_at == 20
    assert messages == [
        ExternalMessage(
            id="oc-1",
            role="assistant",
            content="你好",
            timestamp=123,
            raw={
                "role": "assistant",
                "content": "你好",
                "timestamp": 123,
                "responseId": "resp-1",
                "__openclaw": {"id": "oc-1"},
            },
        )
    ]
