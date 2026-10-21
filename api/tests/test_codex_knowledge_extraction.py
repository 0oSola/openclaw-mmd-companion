from pathlib import Path
import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.db.store import TraceStore
from app.main import create_app
from app.services.codex_knowledge_extraction import (
    build_codex_knowledge_evidence_pack,
    enqueue_codex_knowledge_extraction,
    parse_openclaw_knowledge_response,
    process_next_codex_knowledge_extraction,
)
from app.services.codex_openclaw_review_sync import prepare_openclaw_evidence_pack


def _case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _store() -> TraceStore:
    path = _case_dir()
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def _seed_pet_session(store: TraceStore, *, status: str = "completed", metadata: dict | None = None) -> dict:
    return store.upsert_desktop_pet_session(
        pet_session_id="codex:knowledge-session",
        codex_session_id="knowledge-session",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Knowledge extraction",
        first_prompt_preview="总结这个会话里的方法论和规则概念",
        last_summary=(
            "确认 `active_element_size_authority_over_interior_repeat_consensus` 规则："
            "重复导航激活态尺寸必须优先于普通项共识，并补齐了定向测试。"
        ),
        last_status=status,
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata=metadata
        or {
            "session_parser_version": "codex-jsonl-stream-v2",
            "review_facts_version": "codex-review-facts-v2",
            "facts": {
                "work_items": [
                    {"kind": "goal", "text": "总结方法论", "timestamp": "2026-07-09T10:00:00+08:00"},
                    {"kind": "agent_update", "text": "提取概念定义和规则", "timestamp": "2026-07-09T10:01:00+08:00"},
                    {"kind": "file_change", "text": "更新 FastAPI knowledge extraction", "timestamp": "2026-07-09T10:02:00+08:00"},
                ],
                "methods": [
                    {
                        "kind": "command",
                        "name": "seed handoff test",
                        "command": "powershell -File tests\\test-seed-handoff.ps1",
                        "outcome": "success",
                        "exit_code": 0,
                    },
                    {"kind": "tool", "name": "apply_patch", "outcome": "completed"},
                ],
                "assistant_messages": ["这里应该沉淀为方法论、规则概念和验收 gate。"],
                "changed_files": ["api/app/services/codex_knowledge_extraction.py"],
                "successful_checks": [
                    {
                        "command": "powershell -File tests\\test-seed-handoff.ps1",
                        "check": "active element authority regression",
                        "exit_code": 0,
                    }
                ],
            }
        },
    )


class FakeOpenClawKnowledgeClient:
    def __init__(self, text: str):
        self.text = text
        self.calls = []

    async def generate_codex_knowledge(self, **kwargs):
        self.calls.append(kwargs)
        return self.text


def _app(store: TraceStore, client: FakeOpenClawKnowledgeClient, *, max_payload_chars: int | None = None):
    return SimpleNamespace(
        state=SimpleNamespace(
            trace_store=store,
            openclaw_client=client,
            settings=SimpleNamespace(
                admin_user_ids=["admin-1"],
                codex_knowledge_agent_id="codex-manager",
                codex_knowledge_channel="codex-pet",
                codex_knowledge_max_payload_chars=max_payload_chars,
                codex_knowledge_timeout_seconds=300,
                codex_knowledge_prompt_version="codex-knowledge-wiki-v2",
                codex_knowledge_skill_path=Path("openclaw/skills/codex-session-knowledge-extraction/SKILL.md"),
                codex_knowledge_dump_debug_files=False,
                data_dir=_case_dir(),
            ),
        )
    )


def test_enqueue_codex_knowledge_extraction_requires_reviewable_signal():
    store = _store()
    pet = _seed_pet_session(store, status="running")

    result = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=1,
        prompt_version="codex-knowledge-wiki-v2",
    )

    assert result["queued"] is False
    assert result["reason"] == "not_knowledge_candidate"
    assert result["reviewability"]["reviewable_status"] is False


def test_enqueue_codex_knowledge_extraction_scores_and_queues_candidate():
    store = _store()
    pet = _seed_pet_session(store)

    result = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=5,
        prompt_version="codex-knowledge-wiki-v2",
    )

    assert result["queued"] is True
    assert result["reviewability"]["knowledge_candidate"] is True
    assert result["reviewability"]["signal_score"] >= 5
    job = result["job"]
    assert job["status"] == "pending"
    assert job["openclaw_session_key"] == "codex-knowledge:codex:knowledge-session"
    assert job["payload"]["kind"] == "codex_knowledge_evidence_pack"
    assert job["payload"]["prompt_version"] == "codex-knowledge-wiki-v2"
    assert any(ref["path"] == "tests\\test-seed-handoff.ps1" for ref in job["payload"]["code_index"])
    assert any(
        ref["symbol"] == "active_element_size_authority_over_interior_repeat_consensus"
        for ref in job["payload"]["code_index"]
    )


def test_parser_and_fact_versions_participate_in_knowledge_source_hash():
    store = _store()
    pet = _seed_pet_session(store)
    metadata = dict(pet["metadata"])
    metadata["session_parser_version"] = "codex-jsonl-window-v1"
    metadata["review_facts_version"] = "codex-review-facts-v1"
    _seed_pet_session(store, metadata=metadata)

    first = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=5,
        prompt_version="codex-knowledge-wiki-v2",
    )

    metadata["session_parser_version"] = "codex-jsonl-stream-v2"
    metadata["review_facts_version"] = "codex-review-facts-v2"
    _seed_pet_session(store, metadata=metadata)
    second = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=5,
        prompt_version="codex-knowledge-wiki-v2",
    )

    assert first["source_hash"] != second["source_hash"]
    assert first["job"]["id"] != second["job"]["id"]
    assert second["job"]["payload"]["session"]["session_parser_version"] == "codex-jsonl-stream-v2"
    assert second["job"]["payload"]["session"]["review_facts_version"] == "codex-review-facts-v2"


def test_codex_knowledge_skill_requires_wiki_gate_and_code_index():
    skill = Path("openclaw/skills/codex-session-knowledge-extraction/SKILL.md").read_text(encoding="utf-8")

    assert "The default result is `no_wiki`" in skill
    assert '"domain_knowledge_candidates"' in skill
    assert '"introduced_for"' in skill
    assert '"meaning"' in skill
    assert '"technical_solution"' in skill
    assert '"concept_delta_ids"' in skill
    assert "Deterministic Gate" in skill
    assert "needs_evidence" in skill
    assert "must not create or mutate Evidence Reference locator fields" in skill


def test_parse_domain_knowledge_v2_synthesis_response():
    parsed = parse_openclaw_knowledge_response(
        json.dumps(
            {
                "schema_version": 2,
                "disposition": "domain_knowledge_candidates",
                "assessment": {
                    "summary": "存在一条可进入确定性 Gate 的领域知识草稿。",
                    "candidate_count": 1,
                    "needs_human_review": True,
                    "evidence_refs": ["ref-code", "ref-validation"],
                },
                "candidates": [
                    {
                        "candidate_id": "motion-acceptance-gate",
                        "source_kind": "session_incremental",
                        "draft": {
                            "schema_version": 2,
                            "topic_id": None,
                            "topic_identity_key": "mmd-companion/motion-generation/motion-acceptance-gate",
                            "topic_kind": "gate",
                            "domain": "motion-generation",
                            "title": "动作生成验收 Gate",
                            "aliases": [],
                            "introduced_for": {
                                "problem": "阻止无效动作被接受。",
                                "context": "VMD 生成",
                                "failure_before_introduction": "肉眼检查会漏检。",
                            },
                            "meaning": {
                                "definition": "一组程序化动作验收规则。",
                                "entities": [],
                                "relationships": [],
                                "boundaries": {
                                    "in_scope": [],
                                    "out_of_scope": [],
                                    "non_examples": [],
                                    "confused_with": [],
                                },
                                "invariants": ["P0 失败阻断验收。"],
                            },
                            "technical_solution": {
                                "summary": "执行验收脚本。",
                                "architecture_flow": [],
                                "contract_refs": [],
                                "implementation_refs": ["ref-code"],
                                "test_refs": [],
                                "validation_refs": ["ref-validation"],
                            },
                            "failure_signals": [],
                            "operational_appendix": None,
                            "source": {
                                "concept_delta_ids": ["concept_delta_01"],
                                "codex_session_ids": ["019f-session"],
                                "baseline_scan_ids": [],
                            },
                            "evidence_refs": ["ref-code", "ref-validation"],
                            "open_questions": [],
                        },
                        "evidence_refs": ["ref-code", "ref-validation"],
                        "confidence": 0.8,
                    }
                ],
                "rejected_items": [],
            },
            ensure_ascii=False,
        )
    )

    assert parsed["schema_version"] == 2
    assert parsed["candidates"][0]["draft"]["topic_kind"] == "gate"
    assert parsed["candidates"][0]["evidence_refs"] == ["ref-code", "ref-validation"]


def test_prepared_knowledge_pack_preserves_indexable_test_references():
    store = _store()
    pet = _seed_pet_session(store)
    raw = build_codex_knowledge_evidence_pack(
        store,
        pet["pet_session_id"],
        prompt_version="codex-knowledge-wiki-v2",
    )

    prepared = prepare_openclaw_evidence_pack(raw, 4000)

    assert len(json.dumps(prepared, ensure_ascii=False).encode("utf-8")) <= 4000
    assert any(ref["path"] == "tests\\test-seed-handoff.ps1" for ref in prepared["code_index"])


def test_process_next_codex_knowledge_extraction_saves_structured_knowledge():
    store = _store()
    pet = _seed_pet_session(store)
    enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=5,
        prompt_version="codex-knowledge-wiki-v2",
    )
    client = FakeOpenClawKnowledgeClient(
        """
        ```json
        {
          "schema_version": 1,
          "disposition": "wiki_candidates",
          "assessment": {
            "summary": "这个会话包含一条可复用的布局识别规则。",
            "candidate_count": 1,
            "needs_human_review": true,
            "evidence_refs": ["session.last_summary"]
          },
          "wiki_candidates": [
            {
              "candidate_id": "active-element-size-authority",
              "destination": "wiki_methodology",
              "publish_status": "needs_evidence",
              "memory_draft": {
                "knowledge_kind": "rule",
                "title": "重复导航项中激活态尺寸不能被普通项共识覆盖",
                "problem": "普通项尺寸共识可能覆盖具有直接视觉证据的激活项边界。",
                "root_cause": "激活项主体与装饰层没有分离。",
                "when_to_use": "识别带 active 状态的重复导航、标签页或菜单项时。",
                "prerequisites": [],
                "decision_or_rule": "active_element_bounds 优先于 interior_repeat_item_consensus。",
                "steps": [
                  {
                    "order": 1,
                    "instruction": "分别记录激活项主体与装饰层边界。",
                    "rationale": "防止 decorator 被当作 hit box。",
                    "commands": [],
                    "file_refs": ["tests/test-seed-handoff.ps1"],
                    "code_refs": ["code-b86b79717b3d"],
                    "evidence_refs": ["session.last_summary"]
                  }
                ],
                "verification": [
                  {
                    "order": 1,
                    "check": "运行 active element authority 定向回归。",
                    "commands": ["powershell -File tests/test-seed-handoff.ps1"],
                    "expected_signal": "退出码为 0。",
                    "code_refs": ["code-b86b79717b3d"],
                    "evidence_refs": ["facts.successful_checks[0]"]
                  }
                ],
                "failure_signals": ["激活项被普通项共识静默覆盖。"],
                "cautions": ["decorator 不能替代主体边界。"],
                "open_questions": ["需要确认下游 materializer 已消费该字段。"],
                "source_summary": "会话实现了激活态尺寸权威规则和对应 seed gate。",
                "tags": ["layout-contract", "active-state"]
              },
              "quality_gate": {
                "resolved": true,
                "actionable": true,
                "self_contained": true,
                "reusable": true,
                "durable": true,
                "novel": true,
                "verified": false,
                "code_linked": true
              },
              "scores": {
                "reusability": 0.9,
                "novelty": 0.75,
                "actionability": 0.9,
                "durability": 0.85,
                "evidence_quality": 0.6,
                "confidence": 0.78
              },
              "code_refs": ["code-b86b79717b3d"],
              "evidence_refs": ["session.last_summary", "facts.successful_checks[0]"]
            }
          ],
          "rejected_items": [
            {
              "title": "任务执行流水账",
              "reason_code": "status_only",
              "reason": "不具备独立复用价值。",
              "evidence_refs": ["facts.work_items"]
            }
          ],
          "code_index": [
            {
              "ref_id": "code-b86b79717b3d",
              "kind": "test",
              "path": "tests/test-seed-handoff.ps1",
              "symbol": null,
              "line_start": null,
              "line_end": null,
              "command": "powershell -File tests/test-seed-handoff.ps1",
              "language": "powershell",
              "snippet": null,
              "purpose": "验证激活态尺寸权威规则。",
              "outcome": "success",
              "exit_code": 0,
              "evidence_refs": ["facts.successful_checks[0]"]
            }
          ]
        }
        ```
        """
    )

    processed = asyncio.run(process_next_codex_knowledge_extraction(_app(store, client)))

    assert processed is True
    assert client.calls[0]["session_key"] == "codex-knowledge:codex:knowledge-session"
    assert client.calls[0]["agent_id"] == "codex-manager"
    assert client.calls[0]["channel"] == "codex-pet"
    assert client.calls[0]["timeout_seconds"] == 300
    assert "Codex Session Domain Knowledge Synthesis" in client.calls[0]["skill_instructions"]
    knowledge = store.get_latest_codex_session_knowledge(pet["pet_session_id"])
    assert knowledge is not None
    assert knowledge["disposition"] == "wiki_candidates"
    assert knowledge["wiki_candidates"][0]["memory_draft"]["title"] == "重复导航项中激活态尺寸不能被普通项共识覆盖"
    assert knowledge["code_index"][0]["path"] == "tests\\test-seed-handoff.ps1"
    job = store.list_codex_session_knowledge(pet_session_id=pet["pet_session_id"])[0]
    assert job["wiki_candidates"][0]["publish_status"] == "needs_evidence"


def test_parse_openclaw_knowledge_response_rejects_invalid_json():
    with pytest.raises(ValueError, match="valid JSON"):
        parse_openclaw_knowledge_response("not json")


def test_parse_openclaw_knowledge_response_rejects_unknown_code_reference():
    payload = {
        "schema_version": 1,
        "disposition": "wiki_candidates",
        "assessment": {"candidate_count": 1},
        "wiki_candidates": [
            {
                "candidate_id": "candidate",
                "publish_status": "needs_review",
                "memory_draft": {
                    "title": "Candidate",
                    "problem": "Problem",
                    "when_to_use": "When",
                    "decision_or_rule": "Rule",
                    "steps": [],
                    "verification": [{"order": 1, "check": "Check"}],
                    "source_summary": "Source",
                },
                "quality_gate": {"verified": False},
                "code_refs": ["missing-ref"],
            }
        ],
        "rejected_items": [],
        "code_index": [],
    }

    with pytest.raises(ValueError, match="unknown code_refs"):
        parse_openclaw_knowledge_response(json.dumps(payload))


def test_parse_openclaw_knowledge_response_accepts_no_wiki():
    payload = {
        "schema_version": 1,
        "disposition": "no_wiki",
        "assessment": {"candidate_count": 0, "summary": "没有可复用的 Wiki 内容。"},
        "wiki_candidates": [],
        "rejected_items": [
            {
                "title": "任务进度",
                "reason_code": "status_only",
                "reason": "仅描述当前任务完成情况。",
                "evidence_refs": ["session.last_summary"],
            }
        ],
        "code_index": [],
    }

    parsed = parse_openclaw_knowledge_response(json.dumps(payload, ensure_ascii=False))

    assert parsed["disposition"] == "no_wiki"
    assert parsed["wiki_candidates"] == []


def test_failed_codex_knowledge_job_requires_forced_requeue():
    store = _store()
    pet = _seed_pet_session(store)
    first = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=5,
        prompt_version="codex-knowledge-wiki-v2",
    )
    claimed = store.claim_next_codex_knowledge_extraction(now_iso="2099-01-01T00:00:00+00:00")
    assert claimed is not None
    store.mark_codex_knowledge_extraction_failed(claimed["id"], last_error="temporary failure")

    automatic_retry = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=5,
        prompt_version="codex-knowledge-wiki-v2",
    )

    assert automatic_retry["queued"] is False
    assert automatic_retry["job"]["id"] == first["job"]["id"]
    assert automatic_retry["job"]["status"] == "failed"
    assert automatic_retry["job"]["attempt_count"] == 1
    assert automatic_retry["job"]["last_error"] == "temporary failure"


def test_force_requeues_failed_codex_knowledge_job_with_same_source_hash():
    store = _store()
    pet = _seed_pet_session(store)
    first = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=100,
        prompt_version="codex-knowledge-wiki-v2",
        force=True,
    )
    claimed = store.claim_next_codex_knowledge_extraction(now_iso="2099-01-01T00:00:00+00:00")
    assert claimed is not None
    store.mark_codex_knowledge_extraction_failed(claimed["id"], last_error="ReadTimeout")

    retried = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=100,
        prompt_version="codex-knowledge-wiki-v2",
        force=True,
    )

    assert retried["queued"] is True
    assert retried["source_hash"] == first["source_hash"]
    assert retried["job"]["id"] == first["job"]["id"]
    assert retried["job"]["status"] == "pending"
    assert retried["job"]["attempt_count"] == 0
    assert retried["job"]["last_error"] is None


def test_worker_records_exception_type_when_error_message_is_empty():
    class TimeoutOpenClawKnowledgeClient:
        async def generate_codex_knowledge(self, **kwargs):
            raise httpx.ReadTimeout("")

    store = _store()
    pet = _seed_pet_session(store)
    queued = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=5,
        prompt_version="codex-knowledge-wiki-v2",
    )

    processed = asyncio.run(
        process_next_codex_knowledge_extraction(_app(store, TimeoutOpenClawKnowledgeClient()))
    )

    assert processed is False
    job = store.get_codex_knowledge_extraction_outbox(queued["job"]["id"])
    assert job is not None
    assert job["status"] == "failed"
    assert job["last_error"] == "ReadTimeout"


def test_manual_codex_knowledge_route_queues_forced_extraction():
    client = TestClient(
        create_app(
            {
                "data_dir": str(_case_dir()),
                "admin_user_ids": ["admin-1"],
                "openclaw_token": "secret-token",
                "codex_knowledge_extraction_enabled": True,
                "codex_knowledge_min_signal_score": 100,
            }
        )
    )
    created = client.post(
        "/desktop-pet/sessions",
        json={
            "pet_session_id": "pet-manual",
            "codex_session_id": "manual-session",
            "workspace_id": "mmd-companion",
            "workspace_path": "D:/workspace/MMD project",
            "codex_home": None,
            "display_title": "Manual knowledge",
            "first_prompt_preview": "short task",
            "last_summary": "done",
            "last_status": "completed",
            "launch_mode": "workspace-write",
            "remote_url": None,
            "app_server_pid": None,
            "app_server_port": None,
            "metadata": {"facts": {"work_items": [{"kind": "goal", "text": "short"}]}},
        },
        headers={"x-user-id": "admin-1"},
    )
    assert created.status_code == 200

    response = client.post(
        "/codex/knowledge/sessions/pet-manual/extract",
        json={},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["queued"] is True
    assert body["reviewability"]["forced"] is True
    assert body["job"]["payload"]["kind"] == "codex_knowledge_evidence_pack"
