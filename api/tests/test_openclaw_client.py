import asyncio
import json

import httpx
import pytest

from app.services.openclaw_client import OpenClawClient, OpenClawInvocationError


def test_openclaw_chat_uses_responses_only():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/v1/responses"):
            return httpx.Response(
                status_code=200,
                json={
                    "output_text": '{"text":"\\u6536\\u5230","emotion":"neutral","action":"nod","memory_ops":[]}'
                },
            )
        return httpx.Response(status_code=404, json={"error": "not found"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw/default",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[{"role": "user", "content": "\u4f60\u597d"}],
            )

    result = asyncio.run(run_case())

    assert calls == ["/v1/responses"]
    assert result.endpoint_used == "/v1/responses"
    parsed = json.loads(result.raw_text)
    assert parsed["text"] == "\u6536\u5230"


def test_openclaw_chat_surfaces_responses_failure_without_chat_completions_fallback():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(status_code=500, json={"error": "temporary failure"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw/default",
                timeout_seconds=15,
                http_client=http_client,
            )
            await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[{"role": "user", "content": "\u4f60\u597d"}],
            )

    with pytest.raises(OpenClawInvocationError) as error:
        asyncio.run(run_case())

    assert calls == ["/v1/responses", "/v1/responses"]
    assert "Server status 500" in str(error.value)


def test_openclaw_uses_gateway_model_without_backend_model_header():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "path": request.url.path,
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(
            status_code=200,
            json={
                "output_text": '{"text":"\\u6536\\u5230","emotion":"neutral","action":"nod","memory_ops":[]}'
            },
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="secret-token",
                model="minimax-portal/MiniMax-M2.7",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[],
            )

    result = asyncio.run(run_case())

    assert result.endpoint_used == "/v1/responses"
    assert len(calls) == 1
    request = calls[0]
    assert request["path"].endswith("/v1/responses")
    assert request["body"]["model"] == "openclaw"
    assert request["headers"]["authorization"] == "Bearer secret-token"
    assert request["headers"]["x-openclaw-agent-id"] == "main"
    assert "x-openclaw-model" not in request["headers"]
    assert (
        request["headers"]["x-openclaw-scopes"]
        == "operator.admin,operator.read,operator.write,operator.approvals,operator.pairing"
    )
    assert request["headers"]["x-openclaw-session-key"] == "agent:main:legacy:s1"


def test_openclaw_sends_feishu_message_channel_header():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append({"headers": dict(request.headers)})
        return httpx.Response(
            status_code=200,
            json={
                "output_text": '{"text":"ok","emotion":"neutral","action":"nod","memory_ops":[]}'
            },
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw",
                agent_id="main",
                message_channel="feishu",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[],
            )

    result = asyncio.run(run_case())

    assert result.endpoint_used == "/v1/responses"
    assert calls[0]["headers"]["x-openclaw-message-channel"] == "feishu"


def test_openclaw_stream_reply_yields_text_deltas():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append({"path": request.url.path, "body": json.loads(request.content.decode("utf-8"))})
        return httpx.Response(
            status_code=200,
            headers={"content-type": "text/event-stream"},
            content=(
                'data: {"type":"response.output_text.delta","delta":"A"}\n\n'
                'data: {"type":"response.output_text.delta","delta":"B"}\n\n'
                'data: {"type":"response.completed","response":{"status":"completed"}}\n\n'
            ).encode("utf-8"),
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            return [
                delta
                async for delta in client.stream_reply(
                    user_id="u1",
                    session_id="s1",
                    message="hello",
                    history=[],
                )
            ]

    assert asyncio.run(run_case()) == ["A", "B"]
    assert calls[0]["path"] == "/v1/responses"
    assert calls[0]["body"]["model"] == "openclaw"
    assert calls[0]["body"]["stream"] is True
    assert calls[0]["body"]["input"] == "hello"
    assert calls[0]["body"]["user"] == "u1"


def test_openclaw_stream_reply_raises_on_error_event():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=200,
            headers={"content-type": "text/event-stream"},
            content='data: {"type":"response.error","error":{"message":"bad stream"}}\n\n'.encode("utf-8"),
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            return [delta async for delta in client.stream_reply("u1", "s1", "hello", [])]

    with pytest.raises(OpenClawInvocationError, match="bad stream"):
        asyncio.run(run_case())


def test_openclaw_codex_review_uses_review_agent_channel_and_session_key():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "path": request.url.path,
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(status_code=200, json={"output_text": '{"schema_version":1}'})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="secret-token",
                model="openclaw",
                agent_id="main",
                message_channel="feishu",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_codex_review(
                user_id="admin-1",
                session_key="codex-review:codex:review-session",
                evidence_pack={"kind": "codex_review_evidence_pack", "evidence": []},
                agent_id="codex-manager",
                channel="codex-pet",
            )

    result = asyncio.run(run_case())

    assert result == '{"schema_version":1}'
    assert len(calls) == 1
    request = calls[0]
    assert request["path"].endswith("/v1/responses")
    assert request["headers"]["authorization"] == "Bearer secret-token"
    assert request["headers"]["x-openclaw-agent-id"] == "codex-manager"
    assert request["headers"]["x-openclaw-message-channel"] == "codex-pet"
    assert (
        request["headers"]["x-openclaw-session-key"]
        == "agent:codex-manager:legacy:codex-review-codex-review-session"
    )
    assert request["body"]["model"] == "openclaw"
    assert request["body"]["stream"] is False
    assert request["body"]["user"] == "admin-1"
    assert "codex_review_evidence_pack" in request["body"]["input"]
    assert "All user-facing text values MUST be Simplified Chinese" in request["body"]["input"]
    assert "Keep JSON keys, enum values, file paths, commands, code identifiers" in request["body"]["input"]
    assert '"work_summary": {"title": string, "summary": string | null' in request["body"]["input"]
    assert '"pitfalls": [{"title": string' in request["body"]["input"]
    assert '"management": {"importance": string | null' in request["body"]["input"]


def test_openclaw_codex_knowledge_uses_skill_contract_agent_channel_and_session_key():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "path": request.url.path,
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
                "timeout": request.extensions.get("timeout"),
            }
        )
        return httpx.Response(status_code=200, json={"output_text": '{"schema_version":1}'})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="secret-token",
                model="openclaw",
                agent_id="main",
                message_channel="feishu",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_codex_knowledge(
                user_id="admin-1",
                session_key="codex-knowledge:codex:knowledge-session",
                evidence_pack={"kind": "codex_knowledge_evidence_pack", "evidence": []},
                skill_instructions="Return no_wiki or publishable Wiki candidates with code references.",
                prompt_version="codex-knowledge-wiki-v2",
                agent_id="codex-manager",
                channel="codex-pet",
                timeout_seconds=300,
            )

    result = asyncio.run(run_case())

    assert result == '{"schema_version":1}'
    assert len(calls) == 1
    request = calls[0]
    assert request["path"].endswith("/v1/responses")
    assert request["headers"]["authorization"] == "Bearer secret-token"
    assert request["headers"]["x-openclaw-agent-id"] == "codex-manager"
    assert request["headers"]["x-openclaw-message-channel"] == "codex-pet"
    assert (
        request["headers"]["x-openclaw-session-key"]
        == "agent:codex-manager:legacy:codex-knowledge-codex-knowledge-session"
    )
    assert request["body"]["model"] == "openclaw"
    assert request["body"]["stream"] is False
    assert request["body"]["user"] == "admin-1"
    assert request["timeout"]["read"] == 300
    assert "codex-session-knowledge-extraction skill" in request["body"]["input"]
    assert "codex_knowledge_evidence_pack" in request["body"]["input"]
    assert "Return no_wiki or publishable Wiki candidates with code references." in request["body"]["input"]
    assert "codex-knowledge-wiki-v2" in request["body"]["input"]


def test_openclaw_codex_knowledge_fallback_contract_uses_domain_knowledge_v2_schema():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(status_code=200, json={"output_text": '{"schema_version":1}'})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw",
                timeout_seconds=15,
                http_client=http_client,
            )
            await client.generate_codex_knowledge(
                user_id="admin-1",
                session_key="codex-knowledge:test",
                evidence_pack={"kind": "codex_knowledge_evidence_pack"},
                skill_instructions="",
                prompt_version="codex-domain-knowledge-v3",
                agent_id="codex-manager",
                channel="codex-pet",
            )

    asyncio.run(run_case())

    prompt = captured["body"]["input"]
    assert "disposition, assessment, candidates, and rejected_items" in prompt
    assert "Domain Knowledge v2" in prompt
    assert "Return no_wiki" in prompt


def test_openclaw_generates_speech_from_audio_speech_endpoint():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "path": request.url.path,
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(
            status_code=200,
            content=b"fake-mp3-bytes",
            headers={"content-type": "audio/mpeg"},
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="secret-token",
                model="minimax-portal/MiniMax-M2.7",
                agent_id="main",
                message_channel="feishu",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_speech(
                user_id="u1",
                session_id="s1",
                text="\u4f60\u597d",
                voice="default",
            )

    result = asyncio.run(run_case())

    assert result.endpoint_used == "/v1/audio/speech"
    assert result.audio == b"fake-mp3-bytes"
    assert result.media_type == "audio/mpeg"
    request = calls[0]
    assert request["path"].endswith("/v1/audio/speech")
    assert request["body"] == {
        "model": "openclaw",
        "input": "\u4f60\u597d",
        "voice": "default",
        "response_format": "mp3",
        "user": "u1",
    }
    assert request["headers"]["x-openclaw-agent-id"] == "main"
    assert request["headers"]["x-openclaw-message-channel"] == "feishu"
    assert request["headers"]["x-openclaw-session-key"] == "agent:main:legacy:s1"


def test_openclaw_404_returns_gateway_enablement_hint():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=404, text="Not Found")

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[],
            )

    with pytest.raises(OpenClawInvocationError) as error:
        asyncio.run(run_case())

    message = str(error.value)
    assert "404" in message
    assert "gateway.http.endpoints.responses.enabled" in message


def test_openclaw_diagnose_reports_scope_probe_results():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "path": request.url.path,
                "headers": dict(request.headers),
            }
        )
        if request.method == "GET" and request.url.path.endswith("/v1/models"):
            return httpx.Response(status_code=200, json={"object": "list", "data": []})
        if request.method == "POST" and request.url.path.endswith("/v1/responses"):
            return httpx.Response(
                status_code=200,
                json={"output_text": '{"text":"ok","emotion":"neutral","action":"idle","memory_ops":[]}'},
            )
        return httpx.Response(status_code=404, json={"error": "not found"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="secret-token",
                model="minimax-portal/MiniMax-M2.7",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.diagnose()

    result = asyncio.run(run_case())

    assert result["ok"] is True
    assert result["scope_header_enabled"] is True
    assert result["proxy_configured"] is False
    assert result["probes"]["models"]["ok"] is True
    assert result["probes"]["responses"]["ok"] is True
    assert "chat_completions" not in result["probes"]
    assert result["recommendations"] == []
    assert calls[0]["headers"]["x-openclaw-scopes"] == (
        "operator.admin,operator.read,operator.write,operator.approvals,operator.pairing"
    )


def test_openclaw_diagnose_reports_failed_responses_probe_without_chat_probe_fallback():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/v1/models"):
            return httpx.Response(status_code=200, json={"object": "list", "data": []})
        if request.method == "POST" and request.url.path.endswith("/v1/responses"):
            return httpx.Response(status_code=500, json={"error": "temporary failure"})
        return httpx.Response(status_code=404, json={"error": "not found"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="secret-token",
                model="openclaw",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.diagnose()

    result = asyncio.run(run_case())

    assert result["ok"] is False
    assert result["probes"]["models"]["ok"] is True
    assert result["probes"]["responses"]["ok"] is False
    assert result["probes"]["responses"]["status_code"] == 500
    assert "chat_completions" not in result["probes"]


def test_openclaw_empty_timeout_errors_are_described_for_diagnostics_and_invocation():
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("")

    generate_calls = 0

    def generate_handler(_: httpx.Request) -> httpx.Response:
        nonlocal generate_calls
        generate_calls += 1
        raise httpx.ReadTimeout("")

    async def run_diagnose():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.diagnose()

    async def run_generate_reply():
        transport = httpx.MockTransport(generate_handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="hello",
                history=[],
            )

    result = asyncio.run(run_diagnose())
    details = [probe["detail"] for probe in result["probes"].values()]
    assert all("ReadTimeout" in detail for detail in details)

    with pytest.raises(OpenClawInvocationError) as error:
        asyncio.run(run_generate_reply())

    assert "ReadTimeout" in str(error.value)
    assert generate_calls == 1


def test_session_key_header_is_only_sent_for_well_formed_keys():
    """历史或非法会话标识必须被映射成合法键，避免上游以 500 拒绝。"""
    seen_sessions = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_sessions.append(request.headers.get("x-openclaw-session-key"))
        return httpx.Response(status_code=200, json={"output_text": '{"text":"ok"}'})

    async def run_case(session_id: str) -> None:
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="token",
                model="openclaw",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            await client.generate_reply(
                user_id="u1",
                session_id=session_id,
                message="hello",
                history=[],
            )

    asyncio.run(run_case("openclaw:placeholder-session"))
    asyncio.run(run_case("11111111-2222-3333-4444-555555555555"))
    asyncio.run(run_case("agent:main:companion-user:u1"))

    assert seen_sessions == [
        "agent:main:legacy:openclaw-placeholder-session",
        "agent:main:legacy:11111111-2222-3333-4444-555555555555",
        "agent:main:companion-user:u1",
    ]


def test_normalize_session_key_accepts_openclaw_grammar():
    assert OpenClawClient.normalize_session_key("agent:main:main") == "agent:main:main"
    assert (
        OpenClawClient.normalize_session_key(" agent:main:feishu:direct:ou_test ")
        == "agent:main:feishu:direct:ou_test"
    )
    assert (
        OpenClawClient.normalize_session_key("openclaw:abc")
        == "agent:main:legacy:openclaw-abc"
    )
    assert (
        OpenClawClient.normalize_session_key("s1", "codex-manager")
        == "agent:codex-manager:legacy:s1"
    )
    assert (
        OpenClawClient.normalize_session_key("agent::main")
        == "agent:main:legacy:agent--main"
    )
    assert OpenClawClient.normalize_session_key(None) is None
    assert OpenClawClient.normalize_session_key("   ") is None
