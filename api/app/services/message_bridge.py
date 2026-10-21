from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
import json
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

import websockets

from app.services.motion_resolution import resolve_motion_resolution
from app.services.response_parser import normalize_assistant_reply


@dataclass(frozen=True)
class ExternalSession:
    key: str
    display_name: str
    provider: str
    channel: str
    updated_at: int
    raw: dict[str, Any]


@dataclass(frozen=True)
class ExternalMessage:
    id: str | None
    role: str
    content: str
    timestamp: int | None
    raw: dict[str, Any]


class MessageBridgeProvider(Protocol):
    provider: str
    channel: str

    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def list_external_sessions(self) -> list[ExternalSession]: ...

    async def fetch_history(self, session_key: str, limit: int) -> list[ExternalMessage]: ...

    async def subscribe(self, session_key: str) -> None: ...

    async def unsubscribe(self, session_key: str) -> None: ...


class OpenClawGatewayProvider:
    provider = "openclaw"

    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        channel: str = "feishu",
        timeout_seconds: int = 15,
        origin: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.channel = channel
        self.timeout_seconds = timeout_seconds
        self.origin = origin or self.base_url
        self._ws = None
        self._next_id = 1
        self._event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._reader_task: asyncio.Task | None = None

    @property
    def websocket_url(self) -> str:
        parsed = urlparse(self.base_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        return urlunparse((scheme, parsed.netloc, parsed.path or "", "", "", ""))

    async def connect(self) -> None:
        if self._ws is None:
            self._ws = await websockets.connect(
                self.websocket_url,
                origin=self.origin,
                open_timeout=self.timeout_seconds,
                ping_interval=20,
                ping_timeout=20,
            )
        self._ensure_reader_task()
        response = await self._request(
            "connect",
            {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": "openclaw-control-ui",
                    "version": "mmd-companion",
                    "platform": "python",
                    "mode": "ui",
                    "instanceId": "mmd-companion-api",
                },
                "role": "operator",
                "scopes": [
                    "operator.admin",
                    "operator.read",
                    "operator.write",
                    "operator.approvals",
                    "operator.pairing",
                ],
                "caps": ["tool-events"],
                "auth": {"token": self.token},
                "userAgent": "mmd-companion-api",
                "locale": "zh-CN",
            },
        )
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))

    async def close(self) -> None:
        if self._reader_task is not None:
            self._reader_task.cancel()
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await self._reader_task
            self._reader_task = None
        for future in self._pending.values():
            if not future.done():
                future.cancel()
        self._pending.clear()
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    async def list_external_sessions(self) -> list[ExternalSession]:
        response = await self._request("sessions.list", {"includeGlobal": True, "includeUnknown": True, "limit": 200})
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))
        return self.parse_sessions(response.get("payload") or {})

    async def fetch_history(self, session_key: str, limit: int) -> list[ExternalMessage]:
        response = await self._request("chat.history", {"sessionKey": session_key, "limit": limit})
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))
        return self.parse_messages(response.get("payload") or {})

    async def subscribe(self, session_key: str) -> None:
        response = await self._request("sessions.messages.subscribe", {"key": session_key})
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))

    async def unsubscribe(self, session_key: str) -> None:
        response = await self._request("sessions.messages.unsubscribe", {"key": session_key})
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))

    async def receive_event(self) -> dict[str, Any]:
        if self._ws is None:
            raise RuntimeError("OpenClaw Gateway is not connected.")
        self._ensure_reader_task()
        return await self._event_queue.get()

    async def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if self._ws is None:
            raise RuntimeError("OpenClaw Gateway is not connected.")
        self._ensure_reader_task()
        request_id = str(self._next_id)
        self._next_id += 1
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        await self._ws.send(json.dumps({"type": "req", "id": request_id, "method": method, "params": params}))
        try:
            return await asyncio.wait_for(future, timeout=self.timeout_seconds)
        finally:
            self._pending.pop(request_id, None)

    def _ensure_reader_task(self) -> None:
        if self._reader_task is None or self._reader_task.done():
            self._reader_task = asyncio.create_task(self._read_messages())

    async def _read_messages(self) -> None:
        if self._ws is None:
            return
        try:
            while True:
                message = json.loads(await self._ws.recv())
                if message.get("type") == "res":
                    request_id = str(message.get("id") or "")
                    future = self._pending.get(request_id)
                    if future is not None and not future.done():
                        future.set_result(message)
                    continue
                if message.get("type") == "event":
                    self._event_queue.put_nowait(message)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(error)
            self._pending.clear()

    def parse_sessions(self, payload: dict[str, Any]) -> list[ExternalSession]:
        output: list[ExternalSession] = []
        for item in payload.get("sessions") or []:
            if not isinstance(item, dict):
                continue
            origin = item.get("origin") if isinstance(item.get("origin"), dict) else {}
            delivery = item.get("deliveryContext") if isinstance(item.get("deliveryContext"), dict) else {}
            channel = str(item.get("lastChannel") or delivery.get("channel") or origin.get("provider") or "")
            provider = str(origin.get("provider") or channel)
            if provider != self.channel and channel != self.channel:
                continue
            key = str(item.get("key") or "").strip()
            if not key:
                continue
            output.append(
                ExternalSession(
                    key=key,
                    display_name=str(item.get("displayName") or item.get("label") or key),
                    provider=provider,
                    channel=channel or self.channel,
                    updated_at=int(item.get("updatedAt") or 0),
                    raw=item,
                )
            )
        return output

    def parse_messages(self, payload: dict[str, Any]) -> list[ExternalMessage]:
        output: list[ExternalMessage] = []
        for item in payload.get("messages") or []:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "")
            content = item.get("content")
            if isinstance(content, list):
                content = "\n".join(str(part.get("text") or part.get("content") or "") for part in content if isinstance(part, dict))
            openclaw = item.get("__openclaw") if isinstance(item.get("__openclaw"), dict) else {}
            message_id = openclaw.get("id") or item.get("id") or item.get("message_id") or item.get("responseId") or item.get("toolCallId")
            output.append(
                ExternalMessage(
                    id=str(message_id) if message_id else None,
                    role=role,
                    content=str(content or ""),
                    timestamp=int(item.get("timestamp") or item.get("createdAt") or 0) or None,
                    raw=item,
                )
            )
        return output

    @staticmethod
    def _format_rpc_error(response: dict[str, Any]) -> str:
        error = response.get("error") if isinstance(response.get("error"), dict) else {}
        return str(error.get("message") or "OpenClaw Gateway RPC failed.")


def _run_async(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    raise RuntimeError("MessageBridgeService sync helpers cannot run inside an active event loop.")


def _external_message_id(provider: str, session_key: str, message: ExternalMessage) -> str:
    if message.id:
        return message.id
    raw = message.raw or {}
    for key in ("id", "message_id", "responseId", "toolCallId"):
        value = raw.get(key)
        if value:
            return str(value)
    openclaw = raw.get("__openclaw")
    if isinstance(openclaw, dict):
        for key in ("id", "messageId", "eventId"):
            value = openclaw.get(key)
            if value:
                return str(value)
    fingerprint = f"{provider}|{session_key}|{message.role}|{message.timestamp}|{message.content}"
    return sha256(fingerprint.encode("utf-8")).hexdigest()


def _compact_message_text(value: object) -> str:
    return " ".join(str(value or "").split())


def _parse_side_index_time(value: object) -> datetime | None:
    if value is None:
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
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _message_timestamp_to_datetime(value: int | None) -> datetime | None:
    if value is None:
        return None
    seconds = float(value)
    if seconds > 10_000_000_000:
        seconds /= 1000
    try:
        return datetime.fromtimestamp(seconds, UTC)
    except (OSError, OverflowError, ValueError):
        return None


def _iso_to_epoch_millis(value: object) -> int | None:
    parsed = _parse_side_index_time(value)
    if parsed is None:
        return None
    return int(parsed.timestamp() * 1000)


def _extract_openclaw_metadata(raw: dict[str, Any]) -> dict[str, Any] | None:
    for key in ("openclawMetadata", "openclaw_metadata"):
        value = raw.get(key)
        if isinstance(value, dict):
            return dict(value)
    return None


def _chat_role(role: str) -> str | None:
    normalized = role.strip().lower()
    if normalized in {"user", "assistant", "system"}:
        return normalized
    return None


def _bridge_control_reason(role: str, content: str) -> str | None:
    compact = _compact_message_text(content).lower()
    if role == "system" and compact == "compaction":
        return "compaction"
    if role == "assistant" and compact == "[assistant turn failed before producing content]":
        return "assistant_turn_failed"
    return None


def _bridge_message_visibility(role: str, content: str) -> str:
    return "internal" if _bridge_control_reason(role, content) else "chat"


def _is_feishu_direct_session_key(session_key: str) -> bool:
    parts = session_key.strip().split(":")
    return len(parts) >= 5 and parts[0] == "agent" and parts[2] == "feishu" and parts[3] == "direct" and bool(parts[4])


def _normalize_bridge_message(message: ExternalMessage) -> dict[str, Any]:
    role = _chat_role(message.role)
    if role == "assistant":
        normalized = normalize_assistant_reply(message.content)
        if normalized.get("parse_mode") != "plain_text":
            return {
                "content": normalized["text"],
                "emotion": normalized.get("emotion") or "neutral",
                "action": normalized.get("action") or "idle",
                "motion_plan": normalized.get("motion_plan"),
                "memory_ops": normalized.get("memory_ops", []),
                "tts_emotion_label": normalized.get("tts_emotion_label"),
                "tts_pause_profile": normalized.get("tts_pause_profile"),
                "parse_mode": normalized.get("parse_mode"),
            }
    raw = message.raw or {}
    motion_plan = raw.get("motion_plan") if isinstance(raw.get("motion_plan"), dict) else None
    return {
        "content": message.content,
        "emotion": str(raw.get("emotion") or "neutral") if role == "assistant" else None,
        "action": str(raw.get("action") or "idle") if role == "assistant" else None,
        "motion_plan": motion_plan,
        "memory_ops": [],
        "tts_emotion_label": raw.get("tts_emotion_label"),
        "tts_pause_profile": raw.get("tts_pause_profile"),
        "parse_mode": "bridge_raw",
    }


class MessageBridgeService:
    def __init__(
        self,
        *,
        store,
        provider: MessageBridgeProvider,
        history_limit: int = 100,
        greeting_index_path: str | Path | None = None,
        auto_tts_handler: Callable[[dict[str, Any], dict[str, Any], str], Awaitable[None]] | None = None,
    ):
        self.store = store
        self.provider = provider
        self.history_limit = history_limit
        self.history_backfill_interval_seconds = 15.0
        self.greeting_index_path = Path(greeting_index_path) if greeting_index_path else None
        self.auto_tts_handler = auto_tts_handler

    def sync_default_binding_for_user(self, user_id: str) -> dict[str, Any]:
        return _run_async(self.ensure_default_binding_for_user(user_id))

    def close_provider(self) -> None:
        _run_async(self.provider.close())

    async def close_provider_async(self) -> None:
        await self.provider.close()

    async def ensure_default_binding_for_user(self, user_id: str) -> dict[str, Any]:
        ctx = self.store.get_current_workspace_context(user_id)
        state = self.store.get_message_bridge_state(self.provider.provider, self.provider.channel)
        if not state["enabled"]:
            raise RuntimeError("Message bridge is disabled.")

        feishu_sessions = await self.list_external_sessions_async()
        self._insert_event(
            user_id=user_id,
            session_id=None,
            stage="message_bridge.openclaw.sessions.list",
            status="ok",
            payload={"count": len(feishu_sessions)},
        )
        if not feishu_sessions:
            raise RuntimeError("No Feishu sessions found from bridge provider.")

        existing = self.store.get_default_message_bridge_binding(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            provider=self.provider.provider,
            channel=self.provider.channel,
        )
        existing_session = None
        if existing and _is_feishu_direct_session_key(existing["external_session_key"]):
            existing_session = next(
                (session for session in feishu_sessions if session.key == existing["external_session_key"]),
                None,
            )
        target = existing_session or feishu_sessions[0]
        session = self._resolve_local_session_for_external(ctx, target)
        binding = self.store.upsert_message_bridge_binding(
            workspace_id=ctx["workspace"]["id"],
            account_id=ctx["account"]["id"],
            local_session_id=session["id"],
            provider=self.provider.provider,
            channel=self.provider.channel,
            external_session_key=target.key,
            external_display_name=target.display_name,
            is_default=True,
            status="active",
        )
        if (
            not existing
            or existing["external_session_key"] != target.key
            or existing["local_session_id"] != session["id"]
        ):
            self._insert_event(
                user_id=user_id,
                session_id=session["id"],
                stage="message_bridge.openclaw.session.bind",
                status="ok",
                payload={
                    "external_session_key": target.key,
                    "external_display_name": target.display_name,
                },
            )

        await self.sync_history_async(binding, limit=self.history_limit, source="history")
        await self.provider.subscribe(binding["external_session_key"])
        self._insert_event(
            user_id=user_id,
            session_id=binding["local_session_id"],
            stage="message_bridge.openclaw.subscribe",
            status="ok",
            payload={"external_session_key": binding["external_session_key"]},
        )
        return self.store.get_message_bridge_binding(binding["id"]) or binding

    def list_external_sessions(self) -> list[ExternalSession]:
        return _run_async(self.list_external_sessions_async())

    async def list_external_sessions_async(self) -> list[ExternalSession]:
        sessions = await self.provider.list_external_sessions()
        return self._sort_external_sessions(sessions)

    async def list_external_sessions_isolated_async(self) -> list[ExternalSession]:
        provider = self._create_isolated_provider()
        if provider is None:
            return await self.list_external_sessions_async()
        try:
            await provider.connect()
            sessions = await provider.list_external_sessions()
            return self._sort_external_sessions(sessions)
        finally:
            with contextlib.suppress(Exception):
                await provider.close()

    async def fetch_history_isolated_async(self, session_key: str, limit: int) -> list[ExternalMessage]:
        provider = self._create_isolated_provider()
        if provider is None:
            return await self.provider.fetch_history(session_key, limit)
        try:
            await provider.connect()
            return await provider.fetch_history(session_key, limit)
        finally:
            with contextlib.suppress(Exception):
                await provider.close()

    def _create_isolated_provider(self) -> OpenClawGatewayProvider | None:
        if not isinstance(self.provider, OpenClawGatewayProvider):
            return None
        return OpenClawGatewayProvider(
            base_url=self.provider.base_url,
            token=self.provider.token,
            channel=self.provider.channel,
            timeout_seconds=self.provider.timeout_seconds,
            origin=self.provider.origin,
        )

    def _sort_external_sessions(self, sessions: list[ExternalSession]) -> list[ExternalSession]:
        return sorted(
            [
                session
                for session in sessions
                if session.channel == self.provider.channel or session.provider == self.provider.channel
            ],
            key=lambda item: (not _is_feishu_direct_session_key(item.key), -item.updated_at),
        )

    def bind_external_session_for_user(self, user_id: str, external_session_key: str) -> dict[str, Any]:
        return _run_async(self.bind_external_session_for_user_async(user_id, external_session_key))

    async def bind_external_session_for_user_async(self, user_id: str, external_session_key: str) -> dict[str, Any]:
        ctx = self.store.get_current_workspace_context(user_id)
        sessions = await self.list_external_sessions_isolated_async()
        target = next((session for session in sessions if session.key == external_session_key), None)
        if target is None:
            raise RuntimeError("External session not found.")
        previous = self.store.get_default_message_bridge_binding(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            provider=self.provider.provider,
            channel=self.provider.channel,
        )
        session = self._resolve_local_session_for_external(ctx, target)
        binding = self.store.upsert_message_bridge_binding(
            workspace_id=ctx["workspace"]["id"],
            account_id=ctx["account"]["id"],
            local_session_id=session["id"],
            provider=self.provider.provider,
            channel=self.provider.channel,
            external_session_key=target.key,
            external_display_name=target.display_name,
            is_default=True,
            status="active",
        )
        self._insert_event(
            user_id=user_id,
            session_id=session["id"],
            stage="message_bridge.openclaw.session.bind",
            status="ok",
            payload={
                "external_session_key": target.key,
                "external_display_name": target.display_name,
            },
        )
        await self.sync_history_async(binding, limit=self.history_limit, source="history", isolated=True)
        state = self.store.get_message_bridge_state(self.provider.provider, self.provider.channel)
        provider_connected = state["websocket_status"] == "connected" or not isinstance(self.provider, OpenClawGatewayProvider)
        if provider_connected and previous and previous["external_session_key"] != binding["external_session_key"]:
            unsubscribe = getattr(self.provider, "unsubscribe", None)
            if unsubscribe is not None:
                await self._refresh_subscription_link(
                    operation=unsubscribe,
                    user_id=user_id,
                    session_id=previous["local_session_id"],
                    stage="message_bridge.openclaw.unsubscribe",
                    external_session_key=previous["external_session_key"],
                )
        if provider_connected:
            await self._refresh_subscription_link(
                operation=self.provider.subscribe,
                user_id=user_id,
                session_id=binding["local_session_id"],
                stage="message_bridge.openclaw.subscribe",
                external_session_key=binding["external_session_key"],
            )
        return self.store.get_message_bridge_binding(binding["id"]) or binding

    async def _refresh_subscription_link(
        self,
        *,
        operation,
        user_id: str,
        session_id: str,
        stage: str,
        external_session_key: str,
    ) -> bool:
        try:
            await operation(external_session_key)
        except Exception as error:
            self.store.update_message_bridge_state(
                self.provider.provider,
                self.provider.channel,
                websocket_status="reconnecting",
                last_error=str(error),
            )
            self._insert_event(
                user_id=user_id,
                session_id=session_id,
                stage=stage,
                status="error",
                error_code=type(error).__name__,
                payload={
                    "external_session_key": external_session_key,
                    "error": str(error),
                },
            )
            with contextlib.suppress(Exception):
                await self.provider.close()
            return False
        self._insert_event(
            user_id=user_id,
            session_id=session_id,
            stage=stage,
            status="ok",
            payload={"external_session_key": external_session_key},
        )
        return True

    def _resolve_local_session_for_external(self, ctx: dict[str, Any], target: ExternalSession) -> dict[str, Any]:
        workspace_id = ctx["workspace"]["id"]
        account_id = ctx["account"]["id"]
        session = self.store.find_message_bridge_session_by_external_key(
            workspace_id,
            account_id,
            provider=self.provider.provider,
            channel=self.provider.channel,
            external_session_key=target.key,
        )
        if session:
            return self._ensure_session_targets_external_key(workspace_id, account_id, session, target.key)

        binding = self.store.get_message_bridge_binding_by_external_key(
            workspace_id,
            account_id,
            provider=self.provider.provider,
            channel=self.provider.channel,
            external_session_key=target.key,
        )
        if binding:
            session = self.store.get_session(workspace_id, account_id, binding["local_session_id"])
            if session:
                return self._ensure_session_targets_external_key(workspace_id, account_id, session, target.key)

        return self.store.create_session(
            workspace_id,
            account_id,
            title=target.display_name or "Feishu",
            openclaw_session_key=target.key,
        )

    def _ensure_local_session_targets_external(self, binding: dict[str, Any]) -> None:
        session = self.store.get_session(
            binding["workspace_id"],
            binding["account_id"],
            binding["local_session_id"],
        )
        if session:
            self._ensure_session_targets_external_key(
                binding["workspace_id"],
                binding["account_id"],
                session,
                binding["external_session_key"],
            )

    def _ensure_session_targets_external_key(
        self,
        workspace_id: str,
        account_id: str,
        session: dict[str, Any],
        external_session_key: str,
    ) -> dict[str, Any]:
        if session["openclaw_session_key"] == external_session_key:
            return session
        return self.store.update_session_openclaw_session_key(
            workspace_id,
            account_id,
            session["id"],
            external_session_key,
        ) or session

    def sync_history(self, binding: dict[str, Any], *, limit: int, source: str) -> list[dict[str, Any]]:
        return _run_async(self.sync_history_async(binding, limit=limit, source=source))

    async def sync_history_async(
        self,
        binding: dict[str, Any],
        *,
        limit: int,
        source: str,
        isolated: bool = False,
    ) -> list[dict[str, Any]]:
        if isolated:
            messages = await self.fetch_history_isolated_async(binding["external_session_key"], limit)
        else:
            messages = await self.provider.fetch_history(binding["external_session_key"], limit)
        inserted = []
        for external in messages:
            message = self.ingest_external_message(binding, external, source=source)
            if message is None:
                continue
            inserted.append(message)
            await self._maybe_enqueue_auto_tts(message, binding, source)
        self.store.update_message_bridge_binding_sync(binding["id"], last_history_sync_at=_utc_from_store())
        self._insert_event(
            user_id=self._binding_user_id(binding),
            session_id=binding["local_session_id"],
            stage="message_bridge.openclaw.history.load",
            status="ok",
            payload={
                "external_session_key": binding["external_session_key"],
                "count": len(messages),
                "inserted_count": len(inserted),
                "source": source,
            },
        )
        return inserted

    async def backfill_greeting_metadata_for_user(self, user_id: str) -> dict[str, Any]:
        ctx = self.store.get_current_workspace_context(user_id)
        messages = self.store.list_message_bridge_messages(ctx["workspace"]["id"], ctx["account"]["id"])
        updated_count = 0
        scanned_count = 0
        for message in messages:
            if message.get("role") != "assistant":
                continue
            metadata = message.get("metadata") or {}
            if not isinstance(metadata, dict):
                continue
            external_session_key = str(metadata.get("external_session_key") or "")
            if not external_session_key:
                continue
            scanned_count += 1
            binding = {
                "workspace_id": message["workspace_id"],
                "account_id": message["account_id"],
                "local_session_id": message["session_id"],
                "external_session_key": external_session_key,
            }
            external_id = str(metadata.get("external_message_id") or message.get("openclaw_message_id") or message["id"])
            external_message = ExternalMessage(
                id=external_id,
                role=str(message["role"]),
                content=str(message.get("content") or ""),
                timestamp=_iso_to_epoch_millis(message.get("created_at")),
                raw={},
            )
            matched = self._match_greeting_side_index_record(
                binding,
                external_message,
                external_id=external_id,
                normalized_content=str(message.get("content") or ""),
            )
            if matched is None:
                continue
            incoming = {
                "greeting_cron": {
                    **matched,
                    "source": "side_index",
                    "cronSource": matched.get("source") or "greeting-cron",
                },
                "auto_tts": True,
            }
            merged_metadata = self._merge_existing_message_metadata(metadata, incoming)
            updated = message
            if merged_metadata != metadata:
                updated = self.store.update_message_metadata(
                    message["workspace_id"],
                    message["account_id"],
                    message["id"],
                    merged_metadata,
                ) or message
                updated_count += 1
            await self._maybe_enqueue_auto_tts(updated, binding, "side_index_backfill")
        return {"scanned_count": scanned_count, "updated_count": updated_count}

    def ingest_external_message(
        self,
        binding: dict[str, Any],
        external_message: ExternalMessage,
        *,
        source: str,
    ) -> dict[str, Any] | None:
        role = _chat_role(external_message.role)
        if not role:
            return None
        normalized = _normalize_bridge_message(external_message)
        if role == "assistant" and normalized.get("parse_mode") == "empty":
            self._insert_event(
                user_id=self._binding_user_id(binding),
                session_id=binding["local_session_id"],
                stage="message_bridge.openclaw.message.skipped",
                status="ok",
                payload={
                    "external_session_key": binding["external_session_key"],
                    "external_message_id": _external_message_id(self.provider.provider, binding["external_session_key"], external_message),
                    "role": role,
                    "source": source,
                    "reason": "empty_assistant_message",
                },
            )
            return None
        if self.store.find_recent_traced_message_by_role_content(
            binding["workspace_id"],
            binding["account_id"],
            binding["local_session_id"],
            role=role,
            content=normalized["content"],
        ):
            self._insert_event(
                user_id=self._binding_user_id(binding),
                session_id=binding["local_session_id"],
                stage="message_bridge.openclaw.message.skipped",
                status="ok",
                payload={
                    "external_session_key": binding["external_session_key"],
                    "role": role,
                    "source": source,
                    "reason": "local_trace_echo",
                },
            )
            return None
        external_id = _external_message_id(self.provider.provider, binding["external_session_key"], external_message)
        visibility = _bridge_message_visibility(role, normalized["content"])
        metadata = self._metadata_for_external_message(
            binding,
            external_message,
            external_id=external_id,
            normalized_content=normalized["content"],
            source=source,
            role=role,
            visibility=visibility,
        )
        if source in {"realtime", "realtime_backfill"} and self.store.find_recent_message_bridge_duplicate(
            binding["workspace_id"],
            binding["account_id"],
            binding["local_session_id"],
            external_session_key=binding["external_session_key"],
            role=role,
            content=normalized["content"],
        ):
            self._insert_event(
                user_id=self._binding_user_id(binding),
                session_id=binding["local_session_id"],
                stage="message_bridge.openclaw.message.skipped",
                status="ok",
                payload={
                    "external_session_key": binding["external_session_key"],
                    "external_message_id": external_id,
                    "role": role,
                    "source": source,
                    "reason": "nearby_duplicate",
                },
            )
            return None
        message = self.store.insert_message_if_external_missing(
            binding["workspace_id"],
            binding["local_session_id"],
            binding["account_id"],
            role=role,
            content=normalized["content"],
            openclaw_message_id=external_id,
            emotion=normalized["emotion"],
            action=normalized["action"],
            tts_emotion_label=normalized.get("tts_emotion_label"),
            tts_pause_profile=normalized.get("tts_pause_profile"),
            motion_plan=normalized["motion_plan"],
            memory_ops=normalized["memory_ops"],
            metadata=metadata,
            visibility=visibility,
        )
        merged_metadata = self._merge_existing_message_metadata(message.get("metadata") or {}, metadata)
        if merged_metadata != (message.get("metadata") or {}):
            message = self.store.update_message_metadata(
                binding["workspace_id"],
                binding["account_id"],
                message["id"],
                merged_metadata,
            ) or message
        if role == "assistant" and not message.get("motion_resolution"):
            session = self.store.get_session(
                binding["workspace_id"],
                binding["account_id"],
                binding["local_session_id"],
            )
            selected_model_path = session.get("selected_model_path") if session else None
            resolution = (
                resolve_motion_resolution(
                    user_id=self._binding_user_id(binding),
                    selected_model_path=selected_model_path,
                    source_action=message.get("action"),
                    motion_plan=message.get("motion_plan"),
                    store=self.store,
                )
                if selected_model_path
                else {
                    "selected_model_path": None,
                    "source_action": message.get("action"),
                    "source_template": None,
                    "resolved_asset_id": None,
                    "resolved_asset_url": None,
                    "resolved_display_name": None,
                    "status": "fallback_idle",
                    "fallback_reason": "bridge_default_idle",
                }
            )
            message["motion_resolution"] = self.store.create_message_motion_resolution(
                binding["workspace_id"],
                message["id"],
                **resolution,
            )
        self.store.update_message_bridge_binding_sync(binding["id"], last_message_at=_utc_from_store())
        self._insert_event(
            user_id=self._binding_user_id(binding),
            session_id=binding["local_session_id"],
            stage="message_bridge.openclaw.message.received",
            status="ok",
            payload={
                "external_session_key": binding["external_session_key"],
                "external_message_id": external_id,
                "role": role,
                "source": source,
            },
        )
        return message

    async def run_forever(self, default_user_id: str) -> None:
        backoffs = [1, 2, 5, 10, 30]
        attempt = 0
        while True:
            try:
                state = self.store.get_message_bridge_state(self.provider.provider, self.provider.channel)
                if not state["enabled"]:
                    self.store.update_message_bridge_state(
                        self.provider.provider,
                        self.provider.channel,
                        websocket_status="disabled",
                        reconnect_attempts=0,
                        last_error=None,
                    )
                    with contextlib.suppress(Exception):
                        await self.provider.close()
                    await asyncio.sleep(5)
                    continue
                self.store.update_message_bridge_state(
                    self.provider.provider,
                    self.provider.channel,
                    websocket_status="reconnecting" if attempt else "disconnected",
                    reconnect_attempts=attempt,
                    last_error=None,
                )
                await self.provider.connect()
                self.store.update_message_bridge_state(
                    self.provider.provider,
                    self.provider.channel,
                    websocket_status="connected",
                    reconnect_attempts=attempt,
                    last_connected_at=_utc_from_store(),
                    last_error=None,
                )
                binding = await self.ensure_default_binding_for_user(default_user_id)
                if attempt:
                    await self.sync_history_async(binding, limit=20, source="reconnect_history")
                attempt = 0
                await self._consume_events(binding)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.store.update_message_bridge_state(
                    self.provider.provider,
                    self.provider.channel,
                    websocket_status="reconnecting",
                    reconnect_attempts=attempt + 1,
                    last_error=str(error),
                )
                with contextlib.suppress(Exception):
                    await self.provider.close()
                delay = backoffs[min(attempt, len(backoffs) - 1)]
                attempt += 1
                await asyncio.sleep(delay)

    async def _consume_events(self, binding: dict[str, Any], *, max_events: int | None = None) -> None:
        receive_event = getattr(self.provider, "receive_event", None)
        if receive_event is None:
            return
        consumed = 0
        active_binding = binding
        while max_events is None or consumed < max_events:
            state = self.store.get_message_bridge_state(self.provider.provider, self.provider.channel)
            if not state["enabled"]:
                self.store.update_message_bridge_state(
                    self.provider.provider,
                    self.provider.channel,
                    websocket_status="disabled",
                    last_error=None,
                )
                return
            try:
                event = await asyncio.wait_for(receive_event(), timeout=self.history_backfill_interval_seconds)
            except TimeoutError:
                latest_binding = self.store.get_default_message_bridge_binding(
                    active_binding["workspace_id"],
                    active_binding["account_id"],
                    provider=self.provider.provider,
                    channel=self.provider.channel,
                )
                if latest_binding:
                    active_binding = latest_binding
                await self.sync_history_async(active_binding, limit=20, source="realtime_backfill")
                continue
            consumed += 1
            if event.get("event") != "session.message":
                continue
            latest_binding = self.store.get_default_message_bridge_binding(
                active_binding["workspace_id"],
                active_binding["account_id"],
                provider=self.provider.provider,
                channel=self.provider.channel,
            )
            if latest_binding:
                active_binding = latest_binding
            payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
            external = self._external_message_from_event_payload(payload)
            if external is not None:
                message = self.ingest_external_message(active_binding, external, source="realtime")
                if message is not None:
                    await self._maybe_enqueue_auto_tts(message, active_binding, "realtime")

    @staticmethod
    def _external_message_from_event_payload(payload: dict[str, Any]) -> ExternalMessage | None:
        message = payload.get("message") if isinstance(payload.get("message"), dict) else payload
        if not isinstance(message, dict):
            return None
        provider = OpenClawGatewayProvider(base_url="http://localhost", token="")
        parsed = provider.parse_messages({"messages": [message]})
        return parsed[0] if parsed else None

    def _metadata_for_external_message(
        self,
        binding: dict[str, Any],
        external_message: ExternalMessage,
        *,
        external_id: str,
        normalized_content: str,
        source: str,
        role: str,
        visibility: str,
    ) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "source": "message_bridge",
            "provider": self.provider.provider,
            "channel": self.provider.channel,
            "external_session_key": binding["external_session_key"],
            "external_message_id": external_id,
            "synced_from": source,
            "parse_mode": _normalize_bridge_message(external_message).get("parse_mode"),
        }
        if visibility == "internal":
            metadata["visibility"] = "internal"
            control_reason = _bridge_control_reason(role, normalized_content)
            if control_reason:
                metadata["message_kind"] = "control"
                metadata["control_reason"] = control_reason
        openclaw_metadata = _extract_openclaw_metadata(external_message.raw or {})
        if openclaw_metadata:
            metadata["openclaw_metadata"] = openclaw_metadata
            if openclaw_metadata.get("source") == "greeting-cron":
                metadata["greeting_cron"] = {
                    **openclaw_metadata,
                    "source": "openclaw_metadata",
                    "cronSource": "greeting-cron",
                }
                metadata["auto_tts"] = True
        if "greeting_cron" not in metadata:
            side_index_match = self._match_greeting_side_index_record(
                binding,
                external_message,
                external_id=external_id,
                normalized_content=normalized_content,
            )
            if side_index_match is not None:
                metadata["greeting_cron"] = {
                    **side_index_match,
                    "source": "side_index",
                    "cronSource": side_index_match.get("source") or "greeting-cron",
                }
                metadata["auto_tts"] = True
        return metadata

    @staticmethod
    def _merge_existing_message_metadata(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        merged = dict(existing or {})
        for key, value in incoming.items():
            if key in {"openclaw_metadata", "greeting_cron", "auto_tts"}:
                merged[key] = value
            elif key not in merged:
                merged[key] = value
        return merged

    def _match_greeting_side_index_record(
        self,
        binding: dict[str, Any],
        external_message: ExternalMessage,
        *,
        external_id: str,
        normalized_content: str,
    ) -> dict[str, Any] | None:
        if _chat_role(external_message.role) != "assistant":
            return None
        records = self._load_greeting_side_index_records()
        if not records:
            return None
        session_key = binding["external_session_key"]
        message_time = _message_timestamp_to_datetime(external_message.timestamp)
        message_text = _compact_message_text(normalized_content)
        fallback_by_time: dict[str, Any] | None = None
        fallback_delta: float | None = None
        for record in records:
            if record.get("source") != "greeting-cron":
                continue
            if record.get("dashboardSessionKey") != session_key:
                continue
            record_ids = {
                str(record.get("dashboardMessageId") or ""),
                str(record.get("dashboard_message_id") or ""),
                str(record.get("feishuMessageId") or ""),
            }
            if external_id and external_id in record_ids:
                return dict(record)
            record_text = _compact_message_text(record.get("dashboardText") or record.get("text") or "")
            if record_text and record_text == message_text:
                return dict(record)
            record_time = _parse_side_index_time(record.get("ts"))
            if record_time is None or message_time is None:
                continue
            delta_seconds = abs((message_time - record_time).total_seconds())
            if delta_seconds <= 180 and (fallback_delta is None or delta_seconds < fallback_delta):
                fallback_by_time = dict(record)
                fallback_delta = delta_seconds
        return fallback_by_time

    def _load_greeting_side_index_records(self) -> list[dict[str, Any]]:
        path = self.greeting_index_path
        if path is None or not path.exists():
            return []
        records: list[dict[str, Any]] = []
        try:
            lines = path.read_text(encoding="utf-8-sig").splitlines()
        except OSError:
            return []
        for line in lines:
            item = line.strip()
            if not item:
                continue
            try:
                record = json.loads(item)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict):
                records.append(record)
        return records

    async def _maybe_enqueue_auto_tts(self, message: dict[str, Any], binding: dict[str, Any], source: str) -> None:
        if self.auto_tts_handler is None or message.get("role") != "assistant":
            return
        current = self.store.get_message(binding["workspace_id"], binding["account_id"], message["id"]) or message
        metadata = current.get("metadata") or {}
        if not isinstance(metadata, dict) or metadata.get("auto_tts") is not True:
            return
        if current.get("tts"):
            return
        await self.auto_tts_handler(current, binding, source)

    def _binding_user_id(self, binding: dict[str, Any]) -> str:
        return self.store.get_account_external_user_id(binding["account_id"]) or binding["account_id"]

    def _insert_event(
        self,
        *,
        user_id: str,
        session_id: str | None,
        stage: str,
        status: str,
        payload: dict[str, Any],
        error_code: str | None = None,
    ) -> None:
        self.store.insert_event(
            trace_id=f"message-bridge-{uuid4()}",
            user_id=user_id,
            session_id=session_id,
            stage=stage,
            status=status,
            latency_ms=None,
            payload={
                "provider": self.provider.provider,
                "channel": self.provider.channel,
                **payload,
            },
            error_code=error_code,
        )


def _utc_from_store() -> str:
    from app.db.store import _utc_now_iso

    return _utc_now_iso()
