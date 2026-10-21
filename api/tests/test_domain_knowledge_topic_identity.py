from __future__ import annotations

from app.services.domain_knowledge_topic_identity import resolve_topic_identity


def _candidate(
    *,
    topic_id: str | None = None,
    title: str = "Motion Acceptance Gate",
    aliases=None,
    identity_key: str = "mmd-companion/motion-generation/motion-acceptance-gate",
) -> dict:
    return {
        "draft": {
            "topic_id": topic_id,
            "topic_identity_key": identity_key,
            "title": title,
            "aliases": aliases or [],
        }
    }


def _topics() -> list[dict]:
    return [
        {
            "topic_id": "dkt_gate",
            "topic_identity_key": "mmd-companion/motion-generation/motion-acceptance-gate",
            "title": "动作生成验收 Gate",
            "aliases": ["Motion Acceptance Gate", "动作验收门禁"],
            "prior_names": ["VMD Acceptance Gate"],
            "status": "active",
        },
        {
            "topic_id": "dkt_render_gate",
            "topic_identity_key": "mmd-companion/rendering/render-acceptance-gate",
            "title": "Render Acceptance Gate",
            "aliases": ["渲染验收 Gate"],
            "prior_names": [],
            "status": "active",
        },
    ]


def test_topic_id_has_priority_over_mutable_title_and_path():
    result = resolve_topic_identity(
        _candidate(topic_id="dkt_gate", title="Renamed title"),
        _topics(),
    )

    assert result == {
        "proposed_topic_id": "dkt_gate",
        "topic_identity_key": "mmd-companion/motion-generation/motion-acceptance-gate",
        "match_status": "single_match",
        "possible_topic_ids": ["dkt_gate"],
    }


def test_alias_and_prior_name_match_without_deriving_identity_from_title():
    alias = resolve_topic_identity(_candidate(title="动作验收门禁", identity_key="unresolved/alias"), _topics())
    prior_name = resolve_topic_identity(
        _candidate(title="VMD Acceptance Gate", identity_key="unresolved/prior-name"),
        _topics(),
    )

    assert alias["proposed_topic_id"] == "dkt_gate"
    assert prior_name["proposed_topic_id"] == "dkt_gate"
    assert alias["match_status"] == prior_name["match_status"] == "single_match"


def test_ambiguous_alias_returns_suggestions_without_auto_merge():
    topics = _topics()
    topics[1]["aliases"].append("Motion Acceptance Gate")

    result = resolve_topic_identity(_candidate(identity_key="unresolved/ambiguous"), topics)

    assert result["proposed_topic_id"] is None
    assert result["match_status"] == "multiple_matches"
    assert result["possible_topic_ids"] == ["dkt_gate", "dkt_render_gate"]


def test_unmatched_topic_is_classified_as_new_topic():
    result = resolve_topic_identity(
        {
            "draft": {
                "topic_id": None,
                "topic_identity_key": "mmd-companion/audio/podcast-waveform-contract",
                "title": "Podcast Waveform Contract",
                "aliases": [],
            }
        },
        _topics(),
    )

    assert result["match_status"] == "new_topic"
    assert result["possible_topic_ids"] == []
