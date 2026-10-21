# Codex Domain Knowledge Automatic Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Codex Knowledge synthesis outbox 自动接入 Concept Delta、固定版本 Repository Resolver、Deterministic Gate、Topic Identity、immutable candidate persistence 和 OpenClaw delivery。

**Architecture:** 新增一个 session pipeline 深模块，输入 bounded Codex session evidence，输出经过事实校验的 Domain Knowledge Candidate。现有 OpenClaw Skill 只生成不可信草稿；FastAPI 负责固定 revision、证据解析、状态 Gate、topic identity、版本和持久化。

**Tech Stack:** Python 3.11、FastAPI、Pydantic、SQLite、Git CLI、pytest、OpenClaw Skill/Control Plane

---

## File Structure

- Create: `api/app/services/domain_knowledge_session_pipeline.py`：session evidence 到 candidate/delivery 的唯一编排入口。
- Modify: `api/app/services/codex_knowledge_extraction.py`：构建 resolver-ready evidence pack，并在 synthesis 后调用 pipeline。
- Modify: `api/app/services/domain_knowledge_repository_resolver.py`：提供固定 revision 和 dirty-reference 检查结果。
- Modify: `api/app/services/domain_knowledge_gate.py`：支持 `needs_repository_revision`。
- Modify: `api/app/models/domain_knowledge.py`：收紧 topic kind，扩展 candidate status。
- Modify: `api/app/db/store.py`：negative evaluation、topic/candidate 查询和 backfill 状态。
- Modify: `api/app/config.py`、`api/app/main.py`、`api/app/routes/desktop_pet.py`：独立 feature flags 和 worker wiring。
- Modify: `api/app/routes/codex_knowledge.py`：手动 session/backfill API。
- Test: `api/tests/test_domain_knowledge_session_pipeline.py`：新增核心编排测试。
- Test: existing domain knowledge and extraction suites.
- Modify: `openclaw/skills/codex-session-knowledge-extraction/SKILL.md`：限定六类 topic 和 existing Evidence Reference。
- Modify: `docs/architecture/current-system-topology.md`：更新实际运行拓扑。

### Task 1: Tighten Domain Knowledge Contracts

**Files:**
- Modify: `api/app/models/domain_knowledge.py:10-220`
- Test: `api/tests/test_domain_knowledge_contracts.py`

- [ ] **Step 1: Write failing normalization and status tests**

```python
def test_domain_knowledge_draft_normalizes_legacy_topic_kinds():
    policy = DomainKnowledgeDraft.model_validate({**_draft(), "topic_kind": "policy"})
    decision = DomainKnowledgeDraft.model_validate({**_draft(), "topic_kind": "decision"})
    entity = DomainKnowledgeDraft.model_validate({**_draft(), "topic_kind": "entity"})

    assert policy.topic_kind == "rule"
    assert decision.topic_kind == "architecture_decision"
    assert entity.topic_kind == "concept"


def test_domain_knowledge_candidate_allows_repository_revision_block():
    candidate = _candidate()
    candidate["status"] = "needs_repository_revision"

    parsed = DomainKnowledgeCandidate.model_validate(candidate)

    assert parsed.status == "needs_repository_revision"
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_domain_knowledge_contracts.py -k "legacy_topic_kinds or repository_revision_block" -q
```

Expected: FAIL because `architecture_decision` and `needs_repository_revision` are not currently accepted.

- [ ] **Step 3: Implement six canonical topic kinds with input normalization**

```python
TopicKind = Literal[
    "concept",
    "rule",
    "workflow",
    "contract",
    "gate",
    "architecture_decision",
]

_LEGACY_TOPIC_KIND_MAP = {
    "entity": "concept",
    "relationship": "concept",
    "failure_classification": "concept",
    "policy": "rule",
    "decision": "architecture_decision",
}


class DomainKnowledgeDraft(DomainKnowledgeModel):
    schema_version: Literal[2]
    topic_id: str | None = Field(default=None, max_length=160)
    topic_identity_key: str = Field(min_length=1, max_length=500)
    topic_kind: TopicKind
    domain: str = Field(min_length=1, max_length=240)
    title: str = Field(min_length=1, max_length=240)
    aliases: list[str] = Field(default_factory=list, max_length=100)
    introduced_for: IntroducedFor
    meaning: KnowledgeMeaning
    technical_solution: TechnicalSolution
    failure_signals: list[str] = Field(default_factory=list, max_length=100)
    operational_appendix: OperationalAppendix | None = None
    source: KnowledgeSource
    evidence_refs: list[str] = Field(default_factory=list, max_length=300)
    open_questions: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("topic_kind", mode="before")
    @classmethod
    def _normalize_topic_kind(cls, value: Any) -> Any:
        text = str(value or "").strip()
        return _LEGACY_TOPIC_KIND_MAP.get(text, text)
```

向 `DomainKnowledgeCandidate.status` literal 增加 `needs_repository_revision`。

- [ ] **Step 4: Run contracts and Gate tests**

```bash
cd api && python -m pytest tests/test_domain_knowledge_contracts.py tests/test_domain_knowledge_gate.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add api/app/models/domain_knowledge.py api/tests/test_domain_knowledge_contracts.py
git commit -m "feat: define canonical domain knowledge topic kinds"
```

### Task 2: Persist Negative Evaluations And Query Candidate State

**Files:**
- Modify: `api/app/db/store.py:650-860,1900-2460`
- Test: `api/tests/test_domain_knowledge_persistence.py`

- [ ] **Step 1: Write failing persistence tests**

```python
def test_session_evaluation_is_idempotent_by_source_hash():
    store = _store()
    payload = {
        "workspace_id": "mmd-companion",
        "pet_session_id": "pet-1",
        "codex_session_id": "session-1",
        "source_hash": "sha256:" + "1" * 64,
        "disposition": "no_knowledge",
        "reason_codes": ["status_only"],
        "scanner_version": "codex-review-facts-v2",
        "skill_version": "codex-domain-knowledge-v3",
    }

    first = store.upsert_domain_knowledge_session_evaluation(**payload)
    second = store.upsert_domain_knowledge_session_evaluation(**payload)

    assert second["id"] == first["id"]
    assert second["reason_codes"] == ["status_only"]


def test_store_lists_topics_and_returns_current_candidate():
    store = _store()
    candidate = _candidate()
    store.persist_domain_knowledge_candidate(candidate)

    current = store.get_domain_knowledge_candidate(candidate["candidate_id"])

    assert current["current_revision"] == 1
    assert store.list_domain_knowledge_topics(workspace_id="mmd-companion") == []


def test_candidate_identity_keeps_topic_stable_across_source_revisions():
    store = _store()
    first = _candidate()
    second = deepcopy(first)
    second["candidate_revision"] = 2
    second["source_hash"] = "sha256:" + "9" * 64
    second["content_hash"] = "sha256:" + "8" * 64

    store.persist_domain_knowledge_candidate(first)
    store.persist_domain_knowledge_candidate(second)

    current = store.get_domain_knowledge_candidate(first["candidate_id"])
    assert current["current_revision"] == 2
    assert current["source_hash"] == second["source_hash"]
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_domain_knowledge_persistence.py -k "session_evaluation or lists_topics" -q
```

Expected: FAIL because these store APIs and table do not exist.

- [ ] **Step 3: Add the additive evaluation table**

在 store schema 初始化 SQL 中增加：

```sql
CREATE TABLE IF NOT EXISTS domain_knowledge_session_evaluations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    pet_session_id TEXT NOT NULL,
    codex_session_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    disposition TEXT NOT NULL,
    reason_codes_json TEXT NOT NULL DEFAULT '[]',
    scanner_version TEXT NOT NULL,
    skill_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(workspace_id, source_hash)
);
```

实现：

```python
def upsert_domain_knowledge_session_evaluation(
    self,
    *,
    workspace_id: str,
    pet_session_id: str,
    codex_session_id: str,
    source_hash: str,
    disposition: str,
    reason_codes: list[str],
    scanner_version: str,
    skill_version: str,
) -> dict[str, Any]:
    now = _utc_now_iso()
    evaluation_id = f"domain_knowledge_evaluation_{uuid4().hex}"
    self._conn.execute(
        """
        INSERT INTO domain_knowledge_session_evaluations (
            id, workspace_id, pet_session_id, codex_session_id, source_hash,
            disposition, reason_codes_json, scanner_version, skill_version,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, source_hash) DO UPDATE SET
            updated_at = domain_knowledge_session_evaluations.updated_at
        """,
        (
            evaluation_id,
            workspace_id,
            pet_session_id,
            codex_session_id,
            source_hash,
            disposition,
            json.dumps(reason_codes, ensure_ascii=False),
            scanner_version,
            skill_version,
            now,
            now,
        ),
    )
    self._conn.commit()
    row = self._conn.execute(
        "SELECT * FROM domain_knowledge_session_evaluations WHERE workspace_id = ? AND source_hash = ?",
        (workspace_id, source_hash),
    ).fetchone()
    item = dict(row)
    item["reason_codes"] = self._json_loads(item.pop("reason_codes_json"), [])
    return item
```

同时增加 `get_domain_knowledge_candidate(candidate_id)`、
`list_domain_knowledge_topics(workspace_id, limit=500)` 和
`list_domain_knowledge_session_evaluations(workspace_id, limit=500)`；JSON 字段在 row
adapter 中解码。

调整 `persist_domain_knowledge_candidate` 的 parent identity：稳定身份只包含
`workspace_id + source_kind + topic_identity_key`，不再把 `source_hash` 当成不可变身份。
新 revision 更新 parent 的 `source_hash/current_revision/status`：

```python
immutable_parent = (workspace_id, source_kind, topic_identity_key)
if immutable_parent != (
    current["workspace_id"],
    current["source_kind"],
    current["topic_identity_key"],
):
    raise ValueError(f"Domain Knowledge candidate {candidate_id} identity is immutable")

self._conn.execute(
    """
    UPDATE domain_knowledge_candidates
    SET source_hash = ?, current_revision = ?, status = ?, updated_at = ?
    WHERE candidate_id = ?
    """,
    (source_hash, candidate_revision, payload.get("status") or "draft", now, candidate_id),
)
```

- [ ] **Step 4: Run persistence tests**

```bash
cd api && python -m pytest tests/test_domain_knowledge_persistence.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add api/app/db/store.py api/tests/test_domain_knowledge_persistence.py
git commit -m "feat: persist domain knowledge session evaluations"
```

### Task 3: Build Fixed-Revision Session Evidence

**Files:**
- Create: `api/app/services/domain_knowledge_session_pipeline.py`
- Modify: `api/app/services/domain_knowledge_repository_resolver.py`
- Test: `api/tests/test_domain_knowledge_session_pipeline.py`

- [ ] **Step 1: Write failing repository preparation tests**

```python
def test_prepare_session_input_resolves_clean_code_refs_at_head(tmp_path):
    repo, revision = _repo_fixture(tmp_path)
    store, pet = _session_store(repo, changed_files=["src/gate.py"])
    base_evidence = build_codex_knowledge_evidence_pack(store, pet["pet_session_id"])

    prepared = prepare_domain_knowledge_session_input(store, pet["pet_session_id"], base_evidence)

    assert prepared["repository_state"]["commit_sha"] == revision
    assert prepared["repository_state"]["dirty_referenced_paths"] == []
    assert prepared["repository_evidence"]["evidence_refs"][0]["path"] == "src/gate.py"
    assert prepared["source_hash"].startswith("sha256:")


def test_prepare_session_input_marks_dirty_referenced_paths(tmp_path):
    repo, _ = _repo_fixture(tmp_path)
    (repo / "src" / "gate.py").write_text("def changed():\n    return True\n", encoding="utf-8")
    store, pet = _session_store(repo, changed_files=["src/gate.py"])
    base_evidence = build_codex_knowledge_evidence_pack(store, pet["pet_session_id"])

    prepared = prepare_domain_knowledge_session_input(store, pet["pet_session_id"], base_evidence)

    assert prepared["repository_state"]["dirty_referenced_paths"] == ["src/gate.py"]
    assert prepared["repository_evidence"]["evidence_refs"] == []
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_domain_knowledge_session_pipeline.py -k "prepare_session_input" -q
```

Expected: FAIL because the pipeline module does not exist.

- [ ] **Step 3: Implement repository state and hint preparation**

创建 `domain_knowledge_session_pipeline.py`：

```python
from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any

from app.services.domain_knowledge_concept_delta import collect_concept_deltas
from app.services.domain_knowledge_repository_resolver import resolve_repository_evidence


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        raise ValueError((result.stderr or result.stdout).strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def _canonical_hash(value: Any) -> str:
    body = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


def _normalize_repo_path(repo: Path, raw_path: Any) -> str | None:
    text = str(raw_path or "").replace("\\", "/").strip()
    if not text:
        return None
    candidate = Path(text)
    if candidate.is_absolute():
        try:
            text = candidate.resolve().relative_to(repo).as_posix()
        except ValueError:
            return None
    path = Path(text)
    if ".." in path.parts or not (repo / path).exists():
        return None
    return path.as_posix()


def _resolver_hints(repo: Path, code_index: list[dict[str, Any]], dirty: set[str]) -> list[dict[str, Any]]:
    hints: list[dict[str, Any]] = []
    for ref in code_index:
        path = _normalize_repo_path(repo, ref.get("path"))
        if not path or path in dirty:
            continue
        role = "test" if ref.get("kind") == "test" else "implementation"
        hints.append(
            {
                "role": role,
                "path": path,
                "symbol": ref.get("symbol"),
                "command": ref.get("command"),
                "outcome": ref.get("outcome"),
                "exit_code": ref.get("exit_code"),
                "source_event_ids": ref.get("evidence_refs") or [],
            }
        )
    return hints[:50]


def prepare_domain_knowledge_session_input(
    store: Any,
    pet_session_id: str,
    base_evidence: dict[str, Any],
) -> dict[str, Any]:
    session = store.get_desktop_pet_session(pet_session_id)
    if session is None:
        raise ValueError(f"desktop pet session not found: {pet_session_id}")
    repo = Path(str(session.get("workspace_path") or "")).resolve()
    commit_sha = _git(repo, "rev-parse", "HEAD")
    dirty = {
        line[3:].replace("\\", "/")
        for line in _git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
        if len(line) > 3
    }
    evidence = json.loads(json.dumps(base_evidence, ensure_ascii=False))
    code_paths = {
        path
        for raw in evidence.get("code_index") or []
        if (path := _normalize_repo_path(repo, raw.get("path")))
    }
    dirty_referenced_paths = sorted(code_paths & dirty)
    hints = _resolver_hints(repo, evidence.get("code_index") or [], dirty)
    repository_evidence = resolve_repository_evidence(
        {
            "workspace_path": str(repo),
            "repository_id": str(session.get("workspace_id") or repo.name),
            "revision": commit_sha,
            "hints": hints,
        }
    )
    concept_result = collect_concept_deltas(
        store,
        {
            **evidence,
            "workspace_id": session.get("workspace_id"),
            "codex_session_id": session.get("codex_session_id"),
        },
    )
    prepared = {
        **evidence,
        "repository_state": {
            "commit_sha": commit_sha,
            "dirty_referenced_paths": dirty_referenced_paths,
        },
        "repository_evidence": repository_evidence,
        "concept_deltas": concept_result["concept_deltas"],
        "coverage_findings": concept_result["coverage_findings"],
    }
    prepared["source_hash"] = _canonical_hash(prepared)
    prepared["prepared_at"] = datetime.now(UTC).isoformat()
    return prepared
```

- [ ] **Step 4: Run pipeline repository tests**

```bash
cd api && python -m pytest tests/test_domain_knowledge_session_pipeline.py -k "prepare_session_input" -q
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add api/app/services/domain_knowledge_session_pipeline.py api/app/services/domain_knowledge_repository_resolver.py api/tests/test_domain_knowledge_session_pipeline.py
git commit -m "feat: prepare fixed revision domain knowledge evidence"
```

### Task 4: Materialize, Gate, Persist, And Deliver Candidates

**Files:**
- Modify: `api/app/services/domain_knowledge_session_pipeline.py`
- Modify: `api/app/services/domain_knowledge_gate.py`
- Test: `api/tests/test_domain_knowledge_session_pipeline.py`

- [ ] **Step 1: Write failing end-to-end materialization tests**

```python
def test_materialize_ready_candidate_persists_and_enqueues_delivery(tmp_path):
    store, prepared, synthesis = _ready_pipeline_fixture(tmp_path)

    result = materialize_domain_knowledge_synthesis(store, prepared, synthesis)

    assert result["disposition"] == "domain_knowledge_candidates"
    assert result["items"][0]["status"] == "ready_for_review"
    candidate = result["items"][0]["candidate"]
    assert candidate["candidate_id"].startswith("dkc_")
    assert candidate["topic_match"]["match_status"] == "new_topic"
    delivery = store.get_domain_knowledge_candidate_delivery_for_candidate(
        candidate["candidate_id"], candidate["candidate_revision"]
    )
    assert delivery["status"] == "pending"


def test_materialize_dirty_candidate_blocks_delivery(tmp_path):
    store, prepared, synthesis = _ready_pipeline_fixture(tmp_path)
    prepared["repository_state"]["dirty_referenced_paths"] = ["src/gate.py"]

    result = materialize_domain_knowledge_synthesis(store, prepared, synthesis)

    candidate = result["items"][0]["candidate"]
    assert candidate["status"] == "needs_repository_revision"
    assert store.get_domain_knowledge_candidate_delivery_for_candidate(
        candidate["candidate_id"], candidate["candidate_revision"]
    ) is None
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_domain_knowledge_session_pipeline.py -k "materialize" -q
```

Expected: FAIL because materialization does not exist.

- [ ] **Step 3: Implement stable identity and candidate construction**

追加到 pipeline module：

```python
from app.models.domain_knowledge import DomainKnowledgeCandidate
from app.services.domain_knowledge_gate import evaluate_domain_knowledge_candidate
from app.services.domain_knowledge_topic_identity import resolve_topic_identity


def _candidate_id(workspace_id: str, identity_key: str) -> str:
    value = f"{workspace_id}\nsession_incremental\n{identity_key}"
    return "dkc_" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def _empty_quality_gate() -> dict[str, bool]:
    return {
        "definition_complete": False,
        "problem_linked": False,
        "relationships_explicit": False,
        "boundaries_explicit": False,
        "invariants_explicit": False,
        "contract_linked": False,
        "code_linked": False,
        "test_or_validation_linked": False,
        "verified": False,
    }


def _run_id(workspace_id: str, prepared_at: str) -> str:
    return f"project-knowledge:{workspace_id}:incremental:{prepared_at[:10]}"


def materialize_domain_knowledge_synthesis(
    store: Any,
    prepared: dict[str, Any],
    synthesis: dict[str, Any],
) -> dict[str, Any]:
    session = prepared.get("session") or {}
    workspace_id = str(session.get("workspace_id") or "")
    source_hash = str(prepared["source_hash"])
    if synthesis.get("disposition") == "no_wiki":
        evaluation = store.upsert_domain_knowledge_session_evaluation(
            workspace_id=workspace_id,
            pet_session_id=str(session.get("pet_session_id") or ""),
            codex_session_id=str(session.get("codex_session_id") or ""),
            source_hash=source_hash,
            disposition="no_knowledge",
            reason_codes=[
                str(item.get("reason_code") or "no_reusable_domain_knowledge")
                for item in synthesis.get("rejected_items") or []
                if isinstance(item, dict)
            ] or ["no_reusable_domain_knowledge"],
            scanner_version=str(session.get("review_facts_version") or "unknown"),
            skill_version=str(prepared.get("prompt_version") or "unknown"),
        )
        return {"disposition": "no_knowledge", "evaluation": evaluation, "items": []}

    repository_evidence = prepared.get("repository_evidence") or {}
    concept_deltas = prepared.get("concept_deltas") or []
    topic_index = store.list_domain_knowledge_topics(workspace_id=workspace_id)
    now = datetime.now(UTC).isoformat()
    results: list[dict[str, Any]] = []
    for raw in synthesis.get("candidates") or []:
        draft = raw["draft"]
        identity_key = str(draft["topic_identity_key"])
        candidate_id = _candidate_id(workspace_id, identity_key)
        parent = store.get_domain_knowledge_candidate(candidate_id)
        if parent and parent.get("source_hash") == source_hash:
            current = store.get_domain_knowledge_candidate_version(
                candidate_id,
                int(parent["current_revision"]),
            )
            results.append(
                {
                    "status": (current.get("payload") or {}).get("status"),
                    "reason_codes": ["source_hash_unchanged"],
                    "candidate": current.get("payload") or {},
                    "stored": current,
                    "delivery": store.get_domain_knowledge_candidate_delivery_for_candidate(
                        candidate_id,
                        int(parent["current_revision"]),
                    ),
                }
            )
            continue
        revision = int((parent or {}).get("current_revision") or 0) + 1
        candidate = {
            "kind": "project_domain_knowledge_candidate",
            "schema_version": 2,
            "candidate_id": candidate_id,
            "candidate_revision": revision,
            "workspace_id": workspace_id,
            "source_kind": "session_incremental",
            "source_hash": source_hash,
            "content_hash": "sha256:" + "0" * 64,
            "topic_match": {
                "proposed_topic_id": None,
                "topic_identity_key": identity_key,
                "match_status": "unresolved",
                "possible_topic_ids": [],
            },
            "draft": draft,
            "quality_gate": _empty_quality_gate(),
            "status": "draft",
            "conflicts": [],
            "evidence_index": [],
            "created_at": now,
            "updated_at": now,
        }
        gated = evaluate_domain_knowledge_candidate(
            candidate,
            repository_evidence,
            concept_deltas=concept_deltas,
        )
        normalized = gated["candidate"]
        if prepared.get("repository_state", {}).get("dirty_referenced_paths"):
            normalized["status"] = "needs_repository_revision"
            normalized["quality_gate"]["verified"] = False
        normalized["topic_match"] = resolve_topic_identity(normalized, topic_index)
        normalized = DomainKnowledgeCandidate.model_validate(normalized).model_dump(mode="json")
        stored = store.persist_domain_knowledge_candidate(normalized)
        delivery = None
        if normalized["status"] == "ready_for_review":
            run_id = _run_id(workspace_id, prepared["prepared_at"])
            delivery = store.enqueue_domain_knowledge_candidate_delivery(
                run_id=run_id,
                candidate_id=candidate_id,
                candidate_revision=revision,
                payload_hash=normalized["content_hash"],
                payload=normalized,
            )
        results.append(
            {
                "status": normalized["status"],
                "reason_codes": gated["reason_codes"],
                "candidate": normalized,
                "stored": stored,
                "delivery": delivery,
            }
        )
    return {"disposition": "domain_knowledge_candidates", "items": results}
```

- [ ] **Step 4: Update Gate for dirty repository evidence**

保持 Gate 本身只根据 canonical evidence 判定 `ready_for_review/needs_evidence/
needs_author_explanation`；由 pipeline 在 dirty reference 存在时覆盖为
`needs_repository_revision`。新增测试确保此覆盖发生在 persistence 前。

- [ ] **Step 5: Run pipeline, Gate, topic and persistence suites**

```bash
cd api && python -m pytest \
  tests/test_domain_knowledge_session_pipeline.py \
  tests/test_domain_knowledge_gate.py \
  tests/test_domain_knowledge_topic_identity.py \
  tests/test_domain_knowledge_persistence.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add api/app/services/domain_knowledge_session_pipeline.py api/app/services/domain_knowledge_gate.py api/tests/test_domain_knowledge_session_pipeline.py
git commit -m "feat: gate and persist session domain knowledge candidates"
```

### Task 5: Connect The Existing Synthesis Worker To The Pipeline

**Files:**
- Modify: `api/app/services/codex_knowledge_extraction.py:430-740`
- Test: `api/tests/test_codex_knowledge_extraction.py`

- [ ] **Step 1: Write failing worker integration tests**

```python
def test_v2_worker_persists_ready_candidate_and_delivery(tmp_path):
    store, pet, client = _v2_worker_fixture(tmp_path)
    queued = enqueue_codex_knowledge_extraction(
        store,
        pet["pet_session_id"],
        min_signal_score=1,
        prompt_version="codex-domain-knowledge-v3",
    )

    processed = asyncio.run(process_next_codex_knowledge_extraction(_app(store, client)))

    assert processed is True
    knowledge = store.get_latest_codex_session_knowledge(pet["pet_session_id"])
    assert knowledge["disposition"] == "domain_knowledge_candidates"
    candidate_id = knowledge["domain_knowledge_candidates"][0]["candidate_id"]
    candidate = store.get_domain_knowledge_candidate(candidate_id)
    assert candidate["status"] == "ready_for_review"
    assert queued["job"]["payload"]["repository_evidence"]["evidence_refs"]


def test_v2_worker_records_no_knowledge_evaluation(tmp_path):
    store, pet, client = _no_wiki_worker_fixture(tmp_path)
    enqueue_codex_knowledge_extraction(store, pet["pet_session_id"], min_signal_score=1)

    assert asyncio.run(process_next_codex_knowledge_extraction(_app(store, client))) is True

    evaluations = store.list_domain_knowledge_session_evaluations(
        workspace_id="mmd-companion"
    )
    assert evaluations[0]["disposition"] == "no_knowledge"
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_codex_knowledge_extraction.py -k "ready_candidate_and_delivery or no_knowledge_evaluation" -q
```

Expected: FAIL because the worker only saves `codex_session_knowledge`.

- [ ] **Step 3: Prepare resolver-ready payload at enqueue time**

在 `enqueue_codex_knowledge_extraction` 中使用：

```python
from app.services.domain_knowledge_session_pipeline import prepare_domain_knowledge_session_input

base_evidence = build_codex_knowledge_evidence_pack(
    store,
    pet_session_id,
    min_signal_score=min_signal_score,
    prompt_version=prompt_version,
)
evidence_pack = prepare_domain_knowledge_session_input(store, pet_session_id, base_evidence)
reviewability = _as_dict(evidence_pack.get("reviewability"))
```

使用 `evidence_pack["source_hash"]` 作为 outbox source hash，不再对缺少 repository
revision 的旧 evidence pack 单独计算 hash。

- [ ] **Step 4: Materialize synthesis after parsing**

在 `process_next_codex_knowledge_extraction` 的 parse/reconcile 后调用：

```python
from app.services.domain_knowledge_session_pipeline import materialize_domain_knowledge_synthesis

payload = reconcile_openclaw_knowledge_code_index(
    parse_openclaw_knowledge_response(response_text),
    evidence_pack,
)
materialized = materialize_domain_knowledge_synthesis(store, evidence_pack, payload)
saved_payload = {
    **payload,
    "materialized": materialized,
    "candidates": [
        item["candidate"]
        for item in materialized.get("items") or []
        if isinstance(item, dict) and isinstance(item.get("candidate"), dict)
    ],
}
save_openclaw_knowledge_payload(store, outbox, saved_payload)
```

仅在 materialization 和 persistence 全部成功后标记 outbox succeeded。

- [ ] **Step 5: Run extraction and delivery tests**

```bash
cd api && python -m pytest \
  tests/test_codex_knowledge_extraction.py \
  tests/test_domain_knowledge_control_plane_worker.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add api/app/services/codex_knowledge_extraction.py api/tests/test_codex_knowledge_extraction.py
git commit -m "feat: bridge codex synthesis into domain knowledge delivery"
```

### Task 6: Add Independent Feature Flags And Worker Wiring

**Files:**
- Modify: `api/app/config.py`
- Modify: `api/app/main.py`
- Modify: `api/app/routes/desktop_pet.py`
- Modify: `api/app/routes/codex_knowledge.py`
- Modify: `api/.env.example`
- Modify: `.env.example`
- Test: `api/tests/test_codex_knowledge_extraction.py`
- Test: `api/tests/test_openclaw_control_plane_sync.py`

- [ ] **Step 1: Write failing settings and trigger tests**

```python
def test_domain_knowledge_feature_flags_default_off():
    settings = Settings.from_env({})
    assert settings.codex_domain_knowledge_auto_extraction_enabled is False
    assert settings.domain_knowledge_publication_enabled is False


def test_completed_session_auto_enqueues_only_when_auto_flag_enabled():
    disabled = _client(auto_extraction=False)
    enabled = _client(auto_extraction=True)

    _post_completed_session(disabled, pet_session_id="pet-disabled")
    _post_completed_session(enabled, pet_session_id="pet-enabled")

    assert disabled.app.state.trace_store.claim_next_codex_knowledge_extraction(
        now_iso="2099-01-01T00:00:00+00:00"
    ) is None
    assert enabled.app.state.trace_store.claim_next_codex_knowledge_extraction(
        now_iso="2099-01-01T00:00:00+00:00"
    ) is not None
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_codex_knowledge_extraction.py -k "feature_flags or auto_enqueues" -q
```

Expected: FAIL because the settings do not exist.

- [ ] **Step 3: Add settings**

在 `Settings` 中增加：

```python
codex_domain_knowledge_auto_extraction_enabled: bool
domain_knowledge_publication_enabled: bool
```

在 `from_env` 中解析：

```python
codex_domain_knowledge_auto_extraction_enabled=_parse_bool(
    resolve_value(
        "codex_domain_knowledge_auto_extraction_enabled",
        "CODEX_DOMAIN_KNOWLEDGE_AUTO_EXTRACTION_ENABLED",
        False,
    ),
    default=False,
),
domain_knowledge_publication_enabled=_parse_bool(
    resolve_value("domain_knowledge_publication_enabled", "DOMAIN_KNOWLEDGE_PUBLICATION_ENABLED", False),
    default=False,
),
```

旧 `CODEX_KNOWLEDGE_EXTRACTION_ENABLED` 在一个迁移版本内只作为 manual extraction
route 的兼容开关，不再控制自动触发。

- [ ] **Step 4: Wire triggers and publication safety**

`desktop_pet.py` 自动 enqueue 条件改为：

```python
if (
    settings.codex_domain_knowledge_auto_extraction_enabled
    and settings.openclaw_token
    and session.get("last_status") in _CODEX_REVIEWABLE_STATUSES
):
    enqueue_codex_knowledge_extraction(...)
```

`main.py` knowledge worker 使用同一 auto flag；Domain Knowledge control-plane worker
可以在 publication disabled 时继续投递 candidate 和处理 review command，但
`push_pending_domain_knowledge_change_sets` 必须返回：

```python
{
    "status": "publication_disabled",
    "submitted": 0,
    "run_id": run_id,
}
```

- [ ] **Step 5: Document env flags**

```dotenv
CODEX_REVIEW_SNAPSHOT_V2_ENABLED=false
CODEX_DOMAIN_KNOWLEDGE_AUTO_EXTRACTION_ENABLED=false
DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED=false
DOMAIN_KNOWLEDGE_PUBLICATION_ENABLED=false
```

- [ ] **Step 6: Run settings/startup/route tests**

```bash
cd api && python -m pytest \
  tests/test_codex_knowledge_extraction.py \
  tests/test_openclaw_control_plane_sync.py \
  tests/test_domain_knowledge_control_plane_worker.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add api/app/config.py api/app/main.py api/app/routes/desktop_pet.py api/app/routes/codex_knowledge.py api/app/services/domain_knowledge_control_plane.py api/.env.example .env.example api/tests/test_codex_knowledge_extraction.py api/tests/test_openclaw_control_plane_sync.py api/tests/test_domain_knowledge_control_plane_worker.py
git commit -m "feat: gate automatic domain knowledge extraction and publication"
```

### Task 7: Add Bounded Historical Backfill

**Files:**
- Modify: `api/app/routes/codex_knowledge.py`
- Modify: `api/app/db/store.py`
- Modify: `api/app/services/domain_knowledge_session_pipeline.py`
- Test: `api/tests/test_codex_knowledge_extraction.py`

- [ ] **Step 1: Write failing backfill route tests**

```python
def test_backfill_queues_named_session_then_recent_sessions():
    client = _backfill_client()
    _seed_backfill_sessions(client.app.state.trace_store)

    response = client.post(
        "/codex/knowledge/backfill",
        json={
            "codex_session_ids": ["019f2891-4e16-7722-828b-74c1b9c23deb"],
            "lookback_days": 7,
            "limit": 50,
        },
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["requested_session_ids"] == ["019f2891-4e16-7722-828b-74c1b9c23deb"]
    assert body["queued"] >= 1
    assert body["skipped"] >= 0
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_codex_knowledge_extraction.py::test_backfill_queues_named_session_then_recent_sessions -q
```

Expected: FAIL with 404 because the route does not exist.

- [ ] **Step 3: Add store query and route contract**

新增 store 方法：

```python
def list_reviewable_desktop_pet_sessions(
    self,
    *,
    codex_session_ids: list[str] | None = None,
    updated_from_iso: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    clauses = ["last_status IN ('completed', 'failed', 'waiting_approval', 'file_changed')"]
    params: list[Any] = []
    if codex_session_ids:
        placeholders = ",".join("?" for _ in codex_session_ids)
        clauses.append(f"codex_session_id IN ({placeholders})")
        params.extend(codex_session_ids)
    if updated_from_iso:
        clauses.append("updated_at >= ?")
        params.append(updated_from_iso)
    rows = self._conn.execute(
        f"SELECT * FROM desktop_pet_sessions WHERE {' AND '.join(clauses)} ORDER BY updated_at DESC LIMIT ?",
        (*params, max(1, min(int(limit), 500))),
    ).fetchall()
    return [self._desktop_pet_session_row(row) for row in rows]
```

新增 route model 和 endpoint：

```python
class CodexKnowledgeBackfillPayload(BaseModel):
    codex_session_ids: list[str] = Field(default_factory=list, max_length=100)
    lookback_days: int = Field(default=7, ge=1, le=365)
    limit: int = Field(default=50, ge=1, le=500)


@router.post("/backfill")
def backfill_codex_session_knowledge(...):
    _require_admin(request, x_user_id)
    updated_from = (datetime.now(UTC) - timedelta(days=payload.lookback_days)).isoformat()
    explicit = store.list_reviewable_desktop_pet_sessions(
        codex_session_ids=payload.codex_session_ids or None,
        limit=payload.limit,
    )
    recent = store.list_reviewable_desktop_pet_sessions(
        updated_from_iso=updated_from,
        limit=payload.limit,
    )
    sessions = {item["pet_session_id"]: item for item in [*explicit, *recent]}
    results = [
        enqueue_codex_knowledge_extraction(
            store,
            item["pet_session_id"],
            min_signal_score=settings.codex_knowledge_min_signal_score,
            prompt_version=settings.codex_knowledge_prompt_version,
        )
        for item in list(sessions.values())[: payload.limit]
    ]
    return {
        "requested_session_ids": payload.codex_session_ids,
        "queued": sum(1 for item in results if item.get("queued")),
        "skipped": sum(1 for item in results if not item.get("queued")),
        "items": results,
    }
```

- [ ] **Step 4: Run route and idempotency tests**

```bash
cd api && python -m pytest tests/test_codex_knowledge_extraction.py -k "backfill or source_hash" -q
```

Expected: PASS and repeated backfill does not create duplicate outbox rows.

- [ ] **Step 5: Commit Task 7**

```bash
git add api/app/routes/codex_knowledge.py api/app/db/store.py api/app/services/domain_knowledge_session_pipeline.py api/tests/test_codex_knowledge_extraction.py
git commit -m "feat: add bounded codex knowledge backfill"
```

### Task 8: Update Skill Contract, Topology, And Run Full Verification

**Files:**
- Modify: `openclaw/skills/codex-session-knowledge-extraction/SKILL.md`
- Modify: `docs/architecture/current-system-topology.md`
- Modify: `docs/plans/2026-07-14-project-domain-knowledge-wiki-execution-spec.md`
- Test: `api/tests/test_codex_knowledge_extraction.py`

- [ ] **Step 1: Add exact Skill contract assertions**

```python
def test_codex_knowledge_skill_separates_review_and_domain_knowledge():
    skill = Path("openclaw/skills/codex-session-knowledge-extraction/SKILL.md").read_text(encoding="utf-8")

    assert "Review Candidate is not Domain Knowledge" in skill
    assert "concept | rule | workflow | contract | gate | architecture_decision" in skill
    assert "must not invent Evidence Reference IDs" in skill
    assert "needs_repository_revision" in skill
    assert "daily review" in skill
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_codex_knowledge_extraction.py::test_codex_knowledge_skill_separates_review_and_domain_knowledge -q
```

Expected: FAIL until the Skill wording is updated.

- [ ] **Step 3: Update the Skill**

在 Skill 的 contract section 加入：

```markdown
Review Candidate is not Domain Knowledge. Never convert work summaries, followups,
empty blockers, or status-only decisions into a Domain Knowledge Candidate.

Allowed topic kinds are exactly:
`concept | rule | workflow | contract | gate | architecture_decision`.

You must not invent Evidence Reference IDs or any locator field. If fixed-revision
implementation and test/validation evidence is missing, return no candidate or a
draft that FastAPI will classify as `needs_evidence`/`needs_repository_revision`.
```

- [ ] **Step 4: Update topology to the actual post-change flow**

在 `docs/architecture/current-system-topology.md` 记录：

```text
reviewable session -> signal scan -> Concept Delta -> fixed Git revision ->
Repository Resolver -> OpenClaw synthesis -> deterministic Gate -> Topic Identity ->
candidate revision -> durable delivery -> OpenClaw double review -> exact publish.
```

同时删除“legacy synthesis outbox 尚未自动生成 v2 delivery”的旧描述，并记录三个
feature flag 及其默认关闭状态。

- [ ] **Step 5: Run full targeted verification**

```bash
cd api && python -m pytest \
  tests/test_codex_knowledge_extraction.py \
  tests/test_domain_knowledge_contracts.py \
  tests/test_domain_knowledge_persistence.py \
  tests/test_domain_knowledge_repository_resolver.py \
  tests/test_domain_knowledge_gate.py \
  tests/test_domain_knowledge_topic_identity.py \
  tests/test_domain_knowledge_review_ledger.py \
  tests/test_domain_knowledge_control_plane.py \
  tests/test_domain_knowledge_control_plane_worker.py \
  tests/test_domain_knowledge_session_pipeline.py -q
git diff --check
```

Expected: all tests PASS and no whitespace errors.

- [ ] **Step 6: Run the named sample in publication-disabled mode**

```bash
curl -X POST http://127.0.0.1:8000/codex/knowledge/backfill \
  -H 'Content-Type: application/json' \
  -H 'x-user-id: admin-1' \
  -d '{"codex_session_ids":["019f2891-4e16-7722-828b-74c1b9c23deb"],"lookback_days":7,"limit":50}'
```

Expected: response reports the named session as queued or idempotently skipped. With
`DOMAIN_KNOWLEDGE_PUBLICATION_ENABLED=false`, no Obsidian publish payload is sent.

- [ ] **Step 7: Commit Task 8**

```bash
git add openclaw/skills/codex-session-knowledge-extraction/SKILL.md docs/architecture/current-system-topology.md docs/plans/2026-07-14-project-domain-knowledge-wiki-execution-spec.md api/tests/test_codex_knowledge_extraction.py
git commit -m "docs: finalize automatic domain knowledge pipeline"
```
