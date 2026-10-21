"""按人归并各入口身份，并解析出唯一的 OpenClaw 会话键。

一个人（本地账号）在网页、桌面与飞书等入口的对话必须落到同一条 OpenClaw 会话，
否则短期上下文互不可见、无法接着上一个入口的话题继续。渠道侧的会话键已经由消息
桥接保存在 message_bridge_bindings 中，这里直接复用，不再重复维护一份身份表。
"""

from __future__ import annotations

from typing import Any

from app.services.openclaw_client import OpenClawClient

PERSON_SESSION_KIND = "person"
BRIDGE_PROVIDER = "openclaw"
BRIDGE_CHANNEL = "feishu"


def default_person_session_key(agent_id: str | None, person_id: str) -> str:
    """没有任何渠道绑定时使用的按人派生会话键。"""
    resolved_agent = (agent_id or "").strip() or "main"
    resolved_person = (person_id or "").strip()
    if not resolved_person:
        raise ValueError("person_id is required to derive a session key")
    return f"agent:{resolved_agent}:{PERSON_SESSION_KIND}:{resolved_person}"


def session_key_agent_id(session_key: str) -> str:
    """取会话键中的智能体标识；不符合语法时返回空串。"""
    parts = (session_key or "").split(":")
    if len(parts) < 3 or parts[0] != "agent":
        return ""
    return parts[1].strip()


def resolve_person_session_key(
    store: Any,
    *,
    agent_id: str | None,
    person_id: str,
    workspace_id: str,
    account_id: str,
) -> str:
    """返回一个人唯一的 OpenClaw 会话键。

    优先采用该账号已绑定的渠道会话键，使新入口与飞书共用同一条会话、上下文无缝衔接；
    没有绑定、绑定键不符合上游语法或绑定键属于其它智能体时，回退到按人派生的键。
    """
    resolved_person = (person_id or "").strip()
    if not resolved_person:
        raise ValueError("person_id is required to resolve a session key")
    resolved_agent = (agent_id or "").strip() or "main"

    binding = store.get_default_message_bridge_binding(
        workspace_id,
        account_id,
        provider=BRIDGE_PROVIDER,
        channel=BRIDGE_CHANNEL,
    )
    candidate = str((binding or {}).get("external_session_key") or "").strip()
    if candidate and OpenClawClient.normalize_session_key(candidate, resolved_agent) == candidate:
        if session_key_agent_id(candidate) == resolved_agent:
            return candidate
    return default_person_session_key(agent_id, resolved_person)
