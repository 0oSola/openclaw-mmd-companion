from __future__ import annotations

import asyncio
import json

import httpx

from app.services.openclaw_control_plane import OpenClawReviewControlPlaneClient


def test_author_knowledge_delivery_client_uses_project_knowledge_route():
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "authorization": request.headers.get("authorization"),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(status_code=200, json={"status": "candidate_batch_received", "items": []})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawReviewControlPlaneClient(
                base_url="http://openclaw.local:8765",
                token="service-token",
                http_client=http_client,
            )
            return await client.post_project_knowledge_candidates(
                run_id="project-knowledge:mmd-project:candidate:candidate-1:1",
                batch={
                    "kind": "project_domain_knowledge_candidate_batch",
                    "schema_version": 1,
                    "items": [],
                },
            )

    result = asyncio.run(run_case())

    assert result["status"] == "candidate_batch_received"
    assert calls == [
        {
            "method": "POST",
            "url": "http://openclaw.local:8765/v1/apps/mmd/project-knowledge/runs/project-knowledge:mmd-project:candidate:candidate-1:1/candidates",
            "authorization": "Bearer service-token",
            "body": {
                "kind": "project_domain_knowledge_candidate_batch",
                "schema_version": 1,
                "items": [],
            },
        }
    ]
