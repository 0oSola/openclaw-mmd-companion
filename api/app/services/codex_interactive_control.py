from __future__ import annotations

from collections.abc import Awaitable, Callable
import asyncio
from typing import Any


CodexTurnCancellation = Callable[[], Awaitable[dict[str, Any]]]


class CodexInteractiveSessionControl:
    """Routes session-level controls to the WebSocket that owns the active turn."""

    def __init__(self) -> None:
        self._cancellers: dict[str, CodexTurnCancellation] = {}
        self._lock = asyncio.Lock()

    async def register(self, session_id: str, canceller: CodexTurnCancellation) -> None:
        async with self._lock:
            self._cancellers[session_id] = canceller

    async def unregister(self, session_id: str, canceller: CodexTurnCancellation) -> None:
        async with self._lock:
            if self._cancellers.get(session_id) is canceller:
                self._cancellers.pop(session_id, None)

    async def cancel(self, session_id: str) -> dict[str, Any]:
        async with self._lock:
            canceller = self._cancellers.get(session_id)
        if canceller is None:
            return {
                "session_id": session_id,
                "cancelled": False,
                "reason": "not-running",
                "message": "当前任务没有正在运行的回合",
            }
        return await canceller()
