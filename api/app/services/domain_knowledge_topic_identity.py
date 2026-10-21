from __future__ import annotations

import re
from typing import Any

from app.models.domain_knowledge import TopicMatch


_TOKEN_PATTERN = re.compile(r"[\w\u4e00-\u9fff]+", flags=re.UNICODE)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _normalize_name(value: Any) -> str:
    return " ".join(_TOKEN_PATTERN.findall(str(value or "").casefold()))


def _topic_names(topic: dict[str, Any]) -> set[str]:
    values = [topic.get("title"), *_as_list(topic.get("aliases")), *_as_list(topic.get("prior_names"))]
    return {normalized for value in values if (normalized := _normalize_name(value))}


def _candidate_names(draft: dict[str, Any]) -> set[str]:
    values = [draft.get("title"), *_as_list(draft.get("aliases"))]
    return {normalized for value in values if (normalized := _normalize_name(value))}


def _semantic_tokens(value: Any) -> set[str]:
    return set(_normalize_name(value).split())


def _match_result(
    *,
    identity_key: str,
    status: str,
    topic_ids: list[str],
) -> dict[str, Any]:
    proposed = topic_ids[0] if status in {"single_match", "conflict"} and len(topic_ids) == 1 else None
    return TopicMatch.model_validate(
        {
            "proposed_topic_id": proposed,
            "topic_identity_key": identity_key,
            "match_status": status,
            "possible_topic_ids": topic_ids,
        }
    ).model_dump(mode="json")


def resolve_topic_identity(
    raw_candidate: dict[str, Any],
    canonical_topic_index: list[dict[str, Any]],
    *,
    semantic_suggestion_limit: int = 5,
) -> dict[str, Any]:
    draft = _as_dict(raw_candidate.get("draft"))
    identity_key = str(draft.get("topic_identity_key") or "").strip()
    requested_topic_id = str(draft.get("topic_id") or "").strip()
    topics = [item for item in canonical_topic_index if isinstance(item, dict) and item.get("topic_id")]

    if requested_topic_id:
        exact_id = [topic for topic in topics if str(topic.get("topic_id")) == requested_topic_id]
        if exact_id:
            status = "conflict" if str(exact_id[0].get("status")) == "conflict" else "single_match"
            return _match_result(identity_key=identity_key, status=status, topic_ids=[requested_topic_id])

    exact_identity = [
        topic
        for topic in topics
        if identity_key and str(topic.get("topic_identity_key") or "").strip() == identity_key
    ]
    if len(exact_identity) == 1:
        topic_id = str(exact_identity[0]["topic_id"])
        status = "conflict" if str(exact_identity[0].get("status")) == "conflict" else "single_match"
        return _match_result(identity_key=identity_key, status=status, topic_ids=[topic_id])
    if len(exact_identity) > 1:
        return _match_result(
            identity_key=identity_key,
            status="multiple_matches",
            topic_ids=[str(topic["topic_id"]) for topic in exact_identity],
        )

    names = _candidate_names(draft)
    alias_matches = [topic for topic in topics if names & _topic_names(topic)]
    if len(alias_matches) == 1:
        topic_id = str(alias_matches[0]["topic_id"])
        status = "conflict" if str(alias_matches[0].get("status")) == "conflict" else "single_match"
        return _match_result(identity_key=identity_key, status=status, topic_ids=[topic_id])
    if len(alias_matches) > 1:
        return _match_result(
            identity_key=identity_key,
            status="multiple_matches",
            topic_ids=[str(topic["topic_id"]) for topic in alias_matches],
        )

    candidate_tokens = _semantic_tokens(f"{identity_key} {draft.get('title') or ''}")
    suggestions: list[tuple[float, str]] = []
    for topic in topics:
        topic_tokens = _semantic_tokens(
            f"{topic.get('topic_identity_key') or ''} {topic.get('title') or ''} {' '.join(map(str, _as_list(topic.get('aliases'))))}"
        )
        union = candidate_tokens | topic_tokens
        score = len(candidate_tokens & topic_tokens) / len(union) if union else 0.0
        if score >= 0.75:
            suggestions.append((score, str(topic["topic_id"])))
    suggestions.sort(key=lambda item: (-item[0], item[1]))
    possible = [topic_id for _, topic_id in suggestions[: max(1, min(semantic_suggestion_limit, 20))]]
    return _match_result(identity_key=identity_key, status="new_topic", topic_ids=possible)

