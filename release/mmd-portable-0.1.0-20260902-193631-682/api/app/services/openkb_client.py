from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(slots=True)
class OpenKbSyncResult:
    document_id: str
    status: str


class OpenKbClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str = "",
        http_client: httpx.AsyncClient | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.http_client = http_client or httpx.AsyncClient()
        self._owns_client = http_client is None

    async def close(self) -> None:
        if self._owns_client:
            await self.http_client.aclose()

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    async def upsert_document(
        self,
        *,
        document_id: str,
        title: str,
        markdown: str,
        metadata: dict[str, Any],
    ) -> OpenKbSyncResult:
        response = await self.http_client.put(
            f"{self.base_url}/documents/{document_id}",
            headers=self._headers(),
            json={
                "title": title,
                "markdown": markdown,
                "metadata": metadata,
            },
        )
        response.raise_for_status()
        payload = response.json()
        return OpenKbSyncResult(
            document_id=str(payload.get("document_id") or document_id),
            status=str(payload.get("status") or "synced"),
        )
