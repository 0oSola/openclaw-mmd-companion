from __future__ import annotations

import asyncio
import json

import httpx

from app.services.openclaw_control_plane import OpenClawReviewControlPlaneClient


def test_project_knowledge_control_plane_client_uses_v2_routes_and_payloads():
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "path": request.url.path,
                "query": request.url.query.decode(),
                "body": json.loads(request.content.decode("utf-8")) if request.content else None,
                "authorization": request.headers.get("authorization"),
            }
        )
        if request.url.path.endswith("/commands"):
            return httpx.Response(200, json={"commands": [], "cursor": "command-cursor-1"})
        if request.url.path.endswith("/publish-status"):
            return httpx.Response(200, json={"items": [], "cursor": "publish-cursor-1"})
        return httpx.Response(200, json={"status": "accepted"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawReviewControlPlaneClient(
                base_url="http://openclaw.local:8765",
                token="service-token",
                http_client=http_client,
            )
            run_id = "project-knowledge:mmd-companion:incremental:2026-07-14"
            await client.post_project_knowledge_candidates(
                run_id=run_id,
                batch={"kind": "project_domain_knowledge_candidate_batch", "run_id": run_id},
            )
            await client.get_project_knowledge_commands(run_id=run_id, cursor="command-cursor-0")
            await client.post_project_knowledge_command_result(
                command_id="openclaw_knowledge_cmd_01",
                result={"command_id": "openclaw_knowledge_cmd_01", "status": "succeeded"},
            )
            await client.post_project_knowledge_publish_payloads(
                run_id=run_id,
                batch={"kind": "project_domain_knowledge_wiki_payload_batch", "run_id": run_id},
            )
            await client.get_project_knowledge_publish_status(run_id=run_id, cursor="publish-cursor-0")

    asyncio.run(run_case())

    assert calls == [
        {
            "method": "POST",
            "path": "/v1/apps/mmd/project-knowledge/runs/project-knowledge:mmd-companion:incremental:2026-07-14/candidates",
            "query": "",
            "body": {
                "kind": "project_domain_knowledge_candidate_batch",
                "run_id": "project-knowledge:mmd-companion:incremental:2026-07-14",
            },
            "authorization": "Bearer service-token",
        },
        {
            "method": "GET",
            "path": "/v1/apps/mmd/project-knowledge/runs/project-knowledge:mmd-companion:incremental:2026-07-14/commands",
            "query": "cursor=command-cursor-0",
            "body": None,
            "authorization": "Bearer service-token",
        },
        {
            "method": "POST",
            "path": "/v1/apps/mmd/project-knowledge/commands/openclaw_knowledge_cmd_01/result",
            "query": "",
            "body": {"command_id": "openclaw_knowledge_cmd_01", "status": "succeeded"},
            "authorization": "Bearer service-token",
        },
        {
            "method": "POST",
            "path": "/v1/apps/mmd/project-knowledge/runs/project-knowledge:mmd-companion:incremental:2026-07-14/publish-payloads",
            "query": "",
            "body": {
                "kind": "project_domain_knowledge_wiki_payload_batch",
                "run_id": "project-knowledge:mmd-companion:incremental:2026-07-14",
            },
            "authorization": "Bearer service-token",
        },
        {
            "method": "GET",
            "path": "/v1/apps/mmd/project-knowledge/runs/project-knowledge:mmd-companion:incremental:2026-07-14/publish-status",
            "query": "cursor=publish-cursor-0",
            "body": None,
            "authorization": "Bearer service-token",
        },
    ]

