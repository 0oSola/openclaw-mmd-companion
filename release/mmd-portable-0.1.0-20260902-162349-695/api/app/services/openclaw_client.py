from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.models.chat import OpenClawReply, OpenClawSpeech


class OpenClawInvocationError(RuntimeError):
    """Raised when both OpenClaw endpoints fail."""


class OpenClawClient:
    OPERATOR_SCOPES = ",".join(
        [
            "operator.admin",
            "operator.read",
            "operator.write",
            "operator.approvals",
            "operator.pairing",
        ]
    )

    def __init__(
        self,
        base_url: str,
        token: str,
        model: str,
        agent_id: str = "main",
        message_channel: str = "feishu",
        proxy_url: str | None = None,
        verify_ssl: bool = True,
        timeout_seconds: int = 120,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.model = model.strip()
        self.agent_id = agent_id.strip()
        self.message_channel = message_channel.strip()
        self.proxy_url = (proxy_url or "").strip()
        self.verify_ssl = verify_ssl
        self.timeout_seconds = timeout_seconds
        self._external_client = http_client is not None
        if http_client is not None:
            self.http_client = http_client
        else:
            client_kwargs: dict[str, Any] = {
                "timeout": timeout_seconds,
                "verify": verify_ssl,
            }
            if self.proxy_url:
                client_kwargs["proxy"] = self.proxy_url
            self.http_client = httpx.AsyncClient(**client_kwargs)

    async def close(self) -> None:
        if not self._external_client:
            await self.http_client.aclose()

    def _resolve_request_target(self) -> tuple[str, str, str]:
        payload_model = "openclaw"
        agent_id = self.agent_id or "main"
        backend_model = ""
        raw_model = self.model

        if raw_model.startswith("openclaw:") or raw_model.startswith("agent:"):
            payload_model = raw_model
            return payload_model, "", ""
        if raw_model in {"openclaw", "agent"}:
            payload_model = raw_model
            return payload_model, agent_id, ""
        if raw_model.startswith("openclaw/"):
            legacy_agent = raw_model.split("/", 1)[1].strip()
            if legacy_agent and legacy_agent != "default":
                agent_id = legacy_agent
            return payload_model, agent_id, ""
        if raw_model:
            backend_model = raw_model
        return payload_model, agent_id, backend_model

    def _headers(
        self,
        session_id: str | None,
        *,
        agent_id_override: str | None = None,
        channel_override: str | None = None,
    ) -> dict[str, str]:
        _, agent_id, _ = self._resolve_request_target()
        if agent_id_override is not None:
            agent_id = agent_id_override.strip()
        message_channel = self.message_channel
        if channel_override is not None:
            message_channel = channel_override.strip()
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
            headers["x-openclaw-scopes"] = self.OPERATOR_SCOPES
        if agent_id:
            headers["x-openclaw-agent-id"] = agent_id
        if message_channel:
            headers["x-openclaw-message-channel"] = message_channel
        if session_id:
            headers["x-openclaw-session-key"] = session_id
        return headers

    @staticmethod
    def _truncate_detail(text: str, limit: int = 240) -> str:
        collapsed = " ".join(text.split())
        if len(collapsed) <= limit:
            return collapsed
        return f"{collapsed[: limit - 3]}..."

    def _diagnostic_probe_result(
        self,
        *,
        endpoint: str,
        ok: bool | None,
        status_code: int | None,
        detail: str,
    ) -> dict[str, Any]:
        return {
            "ok": ok,
            "status_code": status_code,
            "detail": self._truncate_detail(detail),
            "endpoint": endpoint,
        }

    @staticmethod
    def _describe_exception(error: BaseException) -> str:
        message = str(error).strip()
        if message:
            return message
        return type(error).__name__

    async def _probe_endpoint(
        self,
        endpoint: str,
        caller: Callable[[], Awaitable[httpx.Response]],
    ) -> dict[str, Any]:
        try:
            response = await caller()
        except Exception as error:
            return self._diagnostic_probe_result(
                endpoint=endpoint,
                ok=False,
                status_code=None,
                detail=self._describe_exception(error),
            )

        if response.is_success:
            return self._diagnostic_probe_result(
                endpoint=endpoint,
                ok=True,
                status_code=response.status_code,
                detail="ok",
            )

        body = response.text.strip() or "Unknown error."
        return self._diagnostic_probe_result(
            endpoint=endpoint,
            ok=False,
            status_code=response.status_code,
            detail=f"status {response.status_code}: {body}",
        )

    @staticmethod
    def _probe_needs_scope_fix(detail: str) -> bool:
        text = detail.lower()
        return "missing scope: operator.read" in text or "missing scope: operator.write" in text

    async def diagnose(self) -> dict[str, Any]:
        payload_model, _, _ = self._resolve_request_target()
        headers = self._headers(None)
        models_probe = await self._probe_endpoint(
            "/v1/models",
            lambda: self.http_client.get(
                f"{self.base_url}/v1/models",
                headers=headers,
                timeout=self.timeout_seconds,
            ),
        )
        responses_probe = await self._probe_endpoint(
            "/v1/responses",
            lambda: self.http_client.post(
                f"{self.base_url}/v1/responses",
                headers=headers,
                json={
                    "model": payload_model,
                    "input": "ping",
                    "stream": False,
                },
                timeout=self.timeout_seconds,
            ),
        )

        recommendations: list[str] = []
        probe_details = [models_probe["detail"], responses_probe["detail"]]
        if any(self._probe_needs_scope_fix(detail) for detail in probe_details):
            recommendations.append(
                "OpenClaw accepted the bearer token but denied operator scopes. "
                "Forward x-openclaw-scopes or rotate a token with operator.read/operator.write."
            )
        if any(
            probe["status_code"] == 404
            for probe in (models_probe, responses_probe)
            if probe["status_code"] is not None
        ):
            recommendations.append(
                "Ensure OPENCLAW_BASE_URL points at the Gateway port and "
                "gateway.http.endpoints.responses.enabled is enabled."
            )
        if any(
            "connection attempts failed" in detail.lower()
            or "timed out" in detail.lower()
            or "timeout" in detail.lower()
            or "refused" in detail.lower()
            for detail in probe_details
        ):
            recommendations.append(
                "OpenClaw was unreachable from the API process. Verify OPENCLAW_BASE_URL, "
                "OPENCLAW_PROXY_URL, firewall rules, and TLS settings."
            )

        return {
            "ok": models_probe["ok"] is True and responses_probe["ok"] is True,
            "base_url": self.base_url,
            "agent_id": self.agent_id or "main",
            "model": self.model,
            "proxy_configured": bool(self.proxy_url),
            "verify_ssl": self.verify_ssl,
            "scope_header_enabled": bool(self.token),
            "probes": {
                "models": models_probe,
                "responses": responses_probe,
            },
            "recommendations": recommendations,
        }

    async def _post_with_retry(
        self,
        endpoint: str,
        payload: dict[str, Any],
        headers: dict[str, str],
        *,
        timeout_seconds: float | None = None,
    ) -> httpx.Response:
        url = f"{self.base_url}{endpoint}"
        request_timeout = self.timeout_seconds if timeout_seconds is None else timeout_seconds
        last_error: Exception | None = None
        for _ in range(2):
            try:
                response = await self.http_client.post(
                    url,
                    json=payload,
                    headers=headers,
                    timeout=request_timeout,
                )
                if response.status_code >= 500:
                    last_error = RuntimeError(f"Server status {response.status_code}: {response.text}")
                    continue
                return response
            except httpx.ReadTimeout:
                raise
            except (httpx.HTTPError, RuntimeError) as error:
                last_error = error
        if last_error:
            raise last_error
        raise RuntimeError("OpenClaw request failed without response.")

    @staticmethod
    def _extract_responses_text(payload: dict[str, Any]) -> str:
        if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
            return payload["output_text"].strip()

        output = payload.get("output")
        if not isinstance(output, list):
            return ""
        chunks: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if part.get("type") == "output_text" and isinstance(text, str):
                    chunks.append(text)
        return "\n".join(chunks).strip()

    def _format_error(self, response: httpx.Response) -> str:
        text = response.text.strip() or "Unknown error."
        if response.status_code == 404:
            return (
                "OpenClaw HTTP endpoint returned 404. Ensure OPENCLAW_BASE_URL points at the Gateway port "
                "and enable gateway.http.endpoints.responses.enabled. "
                f"Response body: {text}"
            )
        return f"OpenClaw failed with status {response.status_code}: {text}"

    async def generate_reply(
        self,
        user_id: str,
        session_id: str | None,
        message: str,
        history: list[dict[str, str]],
    ) -> OpenClawReply:
        payload_model, _, _ = self._resolve_request_target()
        headers = self._headers(session_id)
        responses_payload = {
            "model": payload_model,
            "input": message,
            "user": user_id,
            "stream": False,
        }

        try:
            resp = await self._post_with_retry("/v1/responses", responses_payload, headers)
            if not resp.is_success:
                raise OpenClawInvocationError(self._format_error(resp))
            text = self._extract_responses_text(resp.json())
            if not text:
                raise OpenClawInvocationError("OpenClaw /v1/responses returned empty content.")
            return OpenClawReply(
                raw_text=text,
                endpoint_used="/v1/responses",
                status_code=resp.status_code,
            )
        except Exception as error:
            if isinstance(error, OpenClawInvocationError):
                raise
            raise OpenClawInvocationError(self._describe_exception(error)) from error

    async def generate_codex_review(
        self,
        *,
        user_id: str,
        session_key: str,
        evidence_pack: dict[str, Any],
        agent_id: str,
        channel: str,
    ) -> str:
        payload_model, _, _ = self._resolve_request_target()
        headers = self._headers(
            session_key,
            agent_id_override=agent_id,
            channel_override=channel,
        )
        prompt = (
            "You are a Codex session review assistant. Your job is to summarize what the Codex agent "
            "actually did in this session and extract reusable knowledge for the team.\n\n"
            "Use the evidence_pack below as your only source. The evidence_pack contains:\n"
            "- session.first_goal: the user's original request\n"
            "- session.last_summary: the agent's final output\n"
            "- facts.user_messages: the user's actual prompts (not injected system context)\n"
            "- facts.assistant_messages: the agent's reasoning and explanations throughout the session\n"
            "- facts.work_items: structured timeline of goals, agent updates, file changes, approvals, and errors\n"
            "- facts.methods: structured tool/command/check/approval methods with outcomes and bounded output excerpts\n"
            "- facts.function_call_summaries: what tools/commands were executed\n"
            "- facts.failed_commands, facts.errors: what went wrong\n"
            "- facts.changed_files, facts.pending_approvals: side effects\n\n"
            "Read user_messages and assistant_messages carefully — they are the primary source for "
            "understanding what was attempted, what decisions were made, and why. Do not just "
            "summarize the last output; reconstruct the session narrative from these messages.\n\n"
            "Return exactly one JSON object and no Markdown. Do not invent facts not present in the "
            "evidence. If evidence is insufficient for a field, use null for object values, empty "
            "arrays for lists, or lower confidence.\n"
            "All user-facing text values MUST be Simplified Chinese. This includes title, summary, "
            "goal, work_done, result, symptom, root_cause, fix, prevention, decision, description, "
            "importance, review_status, suggested_next_action, and user-facing tags. "
            "Keep JSON keys, enum values, file paths, commands, code identifiers, package names, "
            "and quoted error excerpts unchanged.\n\n"
            "Return JSON matching this shape:\n"
            '{\n'
            '  "schema_version": 1,\n'
            '  "work_summary": {"title": string, "summary": string | null, "goal": string | null, '
            '"work_done": [string], "result": string | null, "evidence_refs": [string], '
            '"confidence": number | null},\n'
            '  "pitfalls": [{"title": string, "summary": string | null, "symptom": string | null, '
            '"root_cause": string | null, "fix": string | null, "prevention": string | null, '
            '"severity": string | null, "tags": [string], "evidence_refs": [string], '
            '"confidence": number | null}],\n'
            '  "decisions": [{"title": string, "summary": string | null, "decision": string | null, '
            '"result": string | null, "tags": [string], "evidence_refs": [string], '
            '"confidence": number | null}],\n'
            '  "followups": [{"title": string, "summary": string | null, "description": string | null, '
            '"severity": string | null, "tags": [string], "evidence_refs": [string], '
            '"confidence": number | null}],\n'
            '  "blockers": [{"title": string, "summary": string | null, "description": string | null, '
            '"severity": string | null, "tags": [string], "evidence_refs": [string], '
            '"confidence": number | null}],\n'
            '  "management": {"importance": string | null, "review_status": string | null, '
            '"needs_human_review": boolean, "suggested_next_action": string | null, "tags": [string]}\n'
            '}\n\n'
            f"evidence_pack:\n{json.dumps(evidence_pack, ensure_ascii=False)}"
        )
        response = await self._post_with_retry(
            "/v1/responses",
            {
                "model": payload_model,
                "input": prompt,
                "user": user_id,
                "stream": False,
            },
            headers,
        )
        if not response.is_success:
            raise OpenClawInvocationError(self._format_error(response))
        text = self._extract_responses_text(response.json())
        if not text:
            raise OpenClawInvocationError("OpenClaw Codex review returned empty content.")
        return text

    async def generate_codex_knowledge(
        self,
        *,
        user_id: str,
        session_key: str,
        evidence_pack: dict[str, Any],
        skill_instructions: str,
        prompt_version: str,
        agent_id: str,
        channel: str,
        timeout_seconds: float | None = None,
    ) -> str:
        payload_model, _, _ = self._resolve_request_target()
        headers = self._headers(
            session_key,
            agent_id_override=agent_id,
            channel_override=channel,
        )
        skill_contract = skill_instructions.strip() or (
            "Use the Codex Session Domain Knowledge Synthesis contract for Domain Knowledge v2. "
            "Return one JSON object with schema_version, disposition, assessment, candidates, and rejected_items. "
            "Return no_wiki when the session has no durable, evidence-linked project domain topic."
        )
        prompt = (
            "You are OpenClaw executing the codex-session-knowledge-extraction skill for FastAPI.\n"
            "Use the skill contract below as the authoritative extraction rule. Use the evidence pack "
            "as your only source. Do not read local files, fetch URLs, resume Codex, approve actions, "
            "or invent missing facts.\n\n"
            f"prompt_version: {prompt_version}\n\n"
            f"skill_contract:\n{skill_contract}\n\n"
            f"evidence_pack:\n{json.dumps(evidence_pack, ensure_ascii=False)}"
        )
        response = await self._post_with_retry(
            "/v1/responses",
            {
                "model": payload_model,
                "input": prompt,
                "user": user_id,
                "stream": False,
            },
            headers,
            timeout_seconds=timeout_seconds,
        )
        if not response.is_success:
            raise OpenClawInvocationError(self._format_error(response))
        text = self._extract_responses_text(response.json())
        if not text:
            raise OpenClawInvocationError("OpenClaw Codex knowledge extraction returned empty content.")
        return text

    @staticmethod
    def _stream_error_message(event: dict[str, Any]) -> str:
        error = event.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("detail")
            if isinstance(message, str) and message.strip():
                return message.strip()
        if isinstance(error, str) and error.strip():
            return error.strip()
        message = event.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        return "OpenClaw stream returned an error event."

    async def stream_reply(
        self,
        user_id: str,
        session_id: str | None,
        message: str,
        history: list[dict[str, str]],
    ):
        payload_model, _, _ = self._resolve_request_target()
        headers = self._headers(session_id)
        payload = {
            "model": payload_model,
            "input": message,
            "user": user_id,
            "stream": True,
        }

        try:
            async with self.http_client.stream(
                "POST",
                f"{self.base_url}/v1/responses",
                json=payload,
                headers=headers,
                timeout=self.timeout_seconds,
            ) as response:
                if not response.is_success:
                    raise OpenClawInvocationError(self._format_error(response))

                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue

                    data = line.removeprefix("data:").strip()
                    if data == "[DONE]":
                        return

                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError as error:
                        raise OpenClawInvocationError("OpenClaw stream returned invalid JSON.") from error
                    if not isinstance(event, dict):
                        continue

                    event_type = event.get("type")
                    if event_type in {"response.error", "error"} or "error" in event:
                        raise OpenClawInvocationError(self._stream_error_message(event))
                    if event_type == "response.output_text.delta":
                        delta = event.get("delta")
                        if isinstance(delta, str) and delta:
                            yield delta
                        continue
                    if event_type in {"response.output_text.done", "response.completed"}:
                        return
        except Exception as error:
            if isinstance(error, OpenClawInvocationError):
                raise
            raise OpenClawInvocationError(self._describe_exception(error)) from error

    async def generate_speech(
        self,
        user_id: str,
        session_id: str | None,
        text: str,
        voice: str = "default",
    ) -> OpenClawSpeech:
        payload_model, _, _ = self._resolve_request_target()
        headers = self._headers(session_id)
        payload = {
            "model": payload_model,
            "input": text,
            "voice": voice or "default",
            "response_format": "mp3",
            "user": user_id,
        }
        try:
            response = await self._post_with_retry("/v1/audio/speech", payload, headers)
            if not response.is_success:
                raise OpenClawInvocationError(self._format_error(response))
            if not response.content:
                raise OpenClawInvocationError("OpenClaw TTS returned empty audio.")
            media_type = response.headers.get("content-type", "audio/mpeg").split(";", 1)[0] or "audio/mpeg"
            return OpenClawSpeech(
                audio=response.content,
                media_type=media_type,
                endpoint_used="/v1/audio/speech",
                status_code=response.status_code,
            )
        except Exception as error:
            if isinstance(error, OpenClawInvocationError):
                raise
            raise OpenClawInvocationError(self._describe_exception(error)) from error
