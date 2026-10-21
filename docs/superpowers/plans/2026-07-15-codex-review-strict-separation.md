# Codex Review Strict Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 v1 Codex daily review 明确改为不可发布的 `review_candidates`，并停止由 review decision 自动创建或推送 Wiki memory。

**Architecture:** 保留现有 `codex_review_items` 和历史 `codex_review_memory` 作为 legacy 数据，但将 outbound snapshot 升级为 schema v2，并把所有新 review decision 限定为复盘状态变更。Domain Knowledge v2 继续使用独立 candidate/control-plane 契约。

**Tech Stack:** Python 3.11、FastAPI、Pydantic、SQLite、pytest、OpenClaw Control Plane HTTP client

---

## File Structure

- `api/app/services/openclaw_control_plane.py`：构建 schema v2 daily snapshot，处理不可发布 review decision，停止 legacy memory 自动推送。
- `api/app/routes/codex_review.py`：本地 review decision API 只更新 item，不创建 memory。
- `api/app/services/codex_review_memory_draft.py`：拒绝 v1 decision 携带 `memory_draft`。
- `api/tests/test_openclaw_control_plane_sync.py`：snapshot、command 和 worker 回归测试。
- `api/tests/test_codex_review_decision_routes.py`：本地 decision API 回归测试。
- `api/.env.example`、`.env.example`：标记 legacy review memory 功能只读保留。
- `docs/architecture/current-system-topology.md`：更新当前运行拓扑和契约语义。

### Task 1: Upgrade Daily Snapshot To Review Schema v2

**Files:**
- Modify: `api/app/services/openclaw_control_plane.py:404-520,650-704`
- Modify: `api/app/config.py`
- Test: `api/tests/test_openclaw_control_plane_sync.py:442-760`

- [ ] **Step 1: Write the failing snapshot contract test**

在 `api/tests/test_openclaw_control_plane_sync.py` 新增：

```python
def test_build_codex_review_daily_snapshot_v2_exposes_non_publishable_review_candidates():
    store = _store()
    review_item = _seed_review_item(
        store,
        item_type="decision",
        title="Keep review and knowledge separate",
        summary="Daily review records the decision but does not publish Wiki knowledge.",
        details={"decision": "Use separate control-plane contracts."},
        created_at="2026-07-15T01:00:00+00:00",
        updated_at="2026-07-15T01:00:00+00:00",
    )

    snapshot = build_codex_review_daily_snapshot(
        store,
        review_date="2026-07-15",
        workspace_id="mmd-companion",
        schema_version=2,
    )

    assert snapshot["schema_version"] == 2
    assert "learning_candidates" not in snapshot
    assert snapshot["review_candidates"] == [
        {
            "id": review_item["id"],
            "pet_session_id": review_item["pet_session_id"],
            "codex_session_id": review_item["codex_session_id"],
            "candidate_type": "decision",
            "title": "Keep review and knowledge separate",
            "summary": "Daily review records the decision but does not publish Wiki knowledge.",
            "problem": "Daily review records the decision but does not publish Wiki knowledge.",
            "root_cause": "",
            "fix": "Use separate control-plane contracts.",
            "prevention": "",
            "lesson": "Daily review records the decision but does not publish Wiki knowledge.",
            "severity": review_item["severity"],
            "tags": review_item["tags"],
            "confidence": None,
            "priority_score": review_item["priority_score"],
            "evidence_refs": [],
            "bounded_evidence": [],
            "knowledge_publishable": False,
            "created_at": review_item["created_at"],
            "updated_at": review_item["updated_at"],
        }
    ]
    assert snapshot["rollup"]["review_candidate_count"] == 1
    assert "learning_candidate_count" not in snapshot["rollup"]
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd api && python -m pytest tests/test_openclaw_control_plane_sync.py::test_build_codex_review_daily_snapshot_v2_exposes_non_publishable_review_candidates -q
```

Expected: FAIL because the snapshot still has schema v1 and `learning_candidates`.

- [ ] **Step 3: Rename the derived view and add the publication boundary**

在 `api/app/services/openclaw_control_plane.py` 将 helper 改为：

```python
def _review_candidate_item(item: dict[str, Any]) -> dict[str, Any]:
    details = _as_dict(item.get("details"))
    evidence_refs = _string_list(details.get("evidence_refs"))
    summary = _compact_text(item.get("summary"))
    confidence = details.get("confidence")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        confidence = None
    return {
        "id": str(item.get("id") or ""),
        "pet_session_id": str(item.get("pet_session_id") or ""),
        "codex_session_id": str(item.get("codex_session_id") or ""),
        "candidate_type": str(item.get("item_type") or ""),
        "title": _compact_text(item.get("title"), limit=240),
        "summary": summary,
        "problem": _first_detail_text(details, ("problem", "symptom", "description"), fallback=summary),
        "root_cause": _first_detail_text(details, ("root_cause", "cause")),
        "fix": _first_detail_text(details, ("fix", "result", "decision")),
        "prevention": _first_detail_text(details, ("prevention", "guardrail")),
        "lesson": _first_detail_text(details, ("lesson",), fallback=summary),
        "severity": item.get("severity"),
        "tags": _string_list(item.get("tags")),
        "confidence": confidence,
        "priority_score": int(item.get("priority_score") or 0),
        "evidence_refs": evidence_refs,
        "bounded_evidence": _bounded_evidence(details, evidence_refs),
        "knowledge_publishable": False,
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
    }


def _has_review_candidate_content(candidate: dict[str, Any]) -> bool:
    return any(
        _compact_text(candidate.get(key))
        for key in ("summary", "problem", "root_cause", "fix", "prevention", "lesson")
    ) or bool(candidate.get("evidence_refs") or candidate.get("bounded_evidence"))


def _review_candidate_items(items: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    candidate_types = {"blocker", "pitfall", "decision", "followup", "work_summary"}
    candidates: list[dict[str, Any]] = []
    for item in items:
        if str(item.get("item_type") or "") not in candidate_types:
            continue
        candidate = _review_candidate_item(item)
        if not _has_review_candidate_content(candidate):
            continue
        candidates.append(candidate)
        if len(candidates) >= limit:
            break
    return candidates
```

同时将 `_snapshot_rollup` 参数和 key 改为 `review_candidates`、
`review_candidate_count`、`review_candidate_counts`、
`high_priority_review_candidate_count`，并在 snapshot 中写：

```python
review_candidates = _review_candidate_items(draft_items, limit)
snapshot = {
    "kind": "codex_review_daily_snapshot",
    "schema_version": 2,
    "date": review_date,
    "workspace_id": workspace_id,
    "summary": summary,
    "drafts": drafts,
    "daily_new_items": drafts,
    "pending_review_backlog": pending_review_backlog,
    "work_units": work_units,
    "review_candidates": review_candidates,
    "rollup": _snapshot_rollup(work_units, review_candidates),
}
```

`build_codex_review_daily_snapshot` 新增 `schema_version: int = 2` 参数。迁移期
`schema_version == 1` 时仅做 wire compatibility：

```python
if schema_version == 1:
    snapshot["schema_version"] = 1
    snapshot["learning_candidates"] = snapshot.pop("review_candidates")
```

legacy item 仍保留 `knowledge_publishable=false`。在 `Settings` 增加：

```python
codex_review_snapshot_v2_enabled: bool
```

并解析：

```python
codex_review_snapshot_v2_enabled=_parse_bool(
    resolve_value("codex_review_snapshot_v2_enabled", "CODEX_REVIEW_SNAPSHOT_V2_ENABLED", False),
    default=False,
),
```

`push_codex_review_daily_snapshot` 传入：

```python
schema_version = 2 if settings.codex_review_snapshot_v2_enabled else 1
snapshot = build_codex_review_daily_snapshot(
    app.state.trace_store,
    review_date=date,
    workspace_id=workspace_id,
    limit=limit,
    schema_version=schema_version,
)
```

- [ ] **Step 4: Update existing snapshot assertions**

在同一测试文件中机械更新现有断言：

```python
assert snapshot["schema_version"] == 2
assert snapshot["review_candidates"] == expected_candidates
assert "learning_candidates" not in snapshot
```

所有旧 `learning_candidate_*` rollup key 改为 `review_candidate_*`。

- [ ] **Step 5: Run the focused snapshot suite**

Run:

```bash
cd api && python -m pytest tests/test_openclaw_control_plane_sync.py -k "snapshot or rollup" -q
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add api/app/services/openclaw_control_plane.py api/app/config.py api/tests/test_openclaw_control_plane_sync.py
git commit -m "feat: separate daily review candidates from knowledge"
```

### Task 2: Stop New v1 Decisions From Creating Wiki Memory

**Files:**
- Modify: `api/app/routes/codex_review.py:16-140`
- Modify: `api/app/services/codex_review_memory_draft.py:135-154`
- Modify: `api/app/services/openclaw_control_plane.py:580-648`
- Test: `api/tests/test_codex_review_decision_routes.py`
- Test: `api/tests/test_openclaw_control_plane_sync.py:888-1055`

- [ ] **Step 1: Write failing local-route tests**

替换原“accept creates memory”断言并新增拒绝 legacy payload 的测试：

```python
def test_accept_review_item_only_updates_review_status():
    client, item = _client_with_review_item()

    response = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={"action": "accept", "notes": "reviewed"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["item"]["status"] == "accepted"
    assert body["memory"] is None
    assert client.app.state.trace_store.get_codex_review_memory_by_review_item(item["id"]) is None


def test_review_decision_rejects_memory_draft_and_wiki_target():
    client, item = _client_with_review_item()

    response = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={
            "action": "accept",
            "memory_draft": _memory_draft(),
            "target": "openclaw_wiki",
        },
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422
    assert "Domain Knowledge" in response.text
```

- [ ] **Step 2: Run the route tests and verify RED**

```bash
cd api && python -m pytest tests/test_codex_review_decision_routes.py -q
```

Expected: FAIL because `accept` still creates `codex_review_memory`.

- [ ] **Step 3: Make v1 decision payload review-only**

将 `CodexReviewDecisionPayload` 改为：

```python
class CodexReviewDecisionPayload(BaseModel):
    action: Literal["accept", "edit_accept", "ignore", "snooze"]
    edited_title: str | None = Field(default=None, max_length=240)
    edited_summary: str | None = Field(default=None, max_length=4000)
    memory_draft: dict[str, Any] | None = None
    notes: str | None = Field(default=None, max_length=2000)
    snooze_until: str | None = Field(default=None, max_length=80)
    target: Literal["none"] = "none"

    @model_validator(mode="after")
    def validate_action_payload(self):
        if self.memory_draft is not None:
            raise ValueError(
                "Codex review decisions cannot publish knowledge; use Domain Knowledge review instead."
            )
        validate_review_decision_payload(
            action=self.action,
            edited_title=self.edited_title,
            edited_summary=self.edited_summary,
            snooze_until=self.snooze_until,
            memory_draft=None,
        )
        return self
```

在 `decide_codex_review_item` 中删除 `create_codex_review_memory_from_item` 调用，
保留 status 和编辑内容：

```python
memory = None
if payload.action in {"accept", "edit_accept"}:
    status = "accepted" if payload.action == "accept" else "edited_accepted"
    details_patch["edited_title"] = payload.edited_title
    details_patch["edited_summary"] = payload.edited_summary
    item = store.update_codex_review_item_status(item_id, status=status, details_patch=details_patch)
elif payload.action == "ignore":
    item = store.update_codex_review_item_status(item_id, status="ignored", details_patch=details_patch)
else:
    details_patch["snooze_until"] = payload.snooze_until
    item = store.update_codex_review_item_status(item_id, status="snoozed", details_patch=details_patch)
return {"item": item, "memory": memory}
```

- [ ] **Step 4: Make control-plane review commands review-only**

将 `apply_codex_review_decision_command` 的 accept 分支改为只更新 item：

```python
if memory_draft is not None:
    raise ValueError(
        "review_decision cannot carry memory_draft; use project knowledge review"
    )

if action in {"accept", "edit_accept"}:
    status = "accepted" if action == "accept" else "edited_accepted"
    details_patch["edited_title"] = edited_title
    details_patch["edited_summary"] = edited_summary
    item = store.update_codex_review_item_status(item_id, status=status, details_patch=details_patch)
elif action == "ignore":
    item = store.update_codex_review_item_status(item_id, status="ignored", details_patch=details_patch)
else:
    details_patch["snooze_until"] = snooze_until
    item = store.update_codex_review_item_status(item_id, status="snoozed", details_patch=details_patch)

return {"item_id": item_id, "item_status": item["status"] if item else None, "memory_id": None}
```

- [ ] **Step 5: Run local and control-plane decision tests**

```bash
cd api && python -m pytest \
  tests/test_codex_review_decision_routes.py \
  tests/test_openclaw_control_plane_sync.py \
  -k "decision_command or review_item" -q
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add api/app/routes/codex_review.py api/app/services/codex_review_memory_draft.py api/app/services/openclaw_control_plane.py api/tests/test_codex_review_decision_routes.py api/tests/test_openclaw_control_plane_sync.py
git commit -m "fix: prevent daily review from creating wiki memory"
```

### Task 3: Disable Automatic Legacy Memory Publication

**Files:**
- Modify: `api/app/services/openclaw_control_plane.py:978-1030`
- Test: `api/tests/test_openclaw_control_plane_sync.py:1116-1268`
- Modify: `api/.env.example`
- Modify: `.env.example`
- Modify: `docs/architecture/current-system-topology.md`

- [ ] **Step 1: Write a failing worker orchestration test**

```python
def test_review_control_plane_worker_does_not_push_legacy_memory(monkeypatch):
    calls = []

    async def fake_snapshot(app):
        calls.append("snapshot")

    async def fake_commands(app):
        calls.append("commands")

    async def forbidden_memory_push(app):
        raise AssertionError("legacy memory push must not run")

    async def forbidden_publish_poll(app):
        raise AssertionError("legacy publish poll must not run")

    monkeypatch.setattr("app.services.openclaw_control_plane.push_codex_review_daily_snapshot", fake_snapshot)
    monkeypatch.setattr("app.services.openclaw_control_plane.process_codex_review_commands", fake_commands)
    monkeypatch.setattr("app.services.openclaw_control_plane.push_codex_review_memory_payloads", forbidden_memory_push)
    monkeypatch.setattr("app.services.openclaw_control_plane.process_codex_review_publish_status", forbidden_publish_poll)
    monkeypatch.setattr("app.services.openclaw_control_plane.asyncio.sleep", _cancel_after_one_cycle)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run_codex_review_control_plane_worker(_worker_app()))

    assert calls == ["snapshot", "commands"]
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_openclaw_control_plane_sync.py::test_review_control_plane_worker_does_not_push_legacy_memory -q
```

Expected: FAIL because the worker still invokes legacy memory push and publish polling.

- [ ] **Step 3: Remove automatic legacy publication from the loop**

在 `run_codex_review_control_plane_worker` 中删除：

```python
await push_codex_review_memory_payloads(app)
await process_codex_review_publish_status(app)
```

保留 legacy read/export routes 和表，供历史审计与显式人工导出，不再由后台 worker 扫描。

- [ ] **Step 4: Document the legacy boundary**

在两个 env example 中将 `CODEX_REVIEW_MEMORY_ENABLED` 注释为：

```dotenv
# Legacy archive/manual export only. New daily review decisions never create Wiki memory.
CODEX_REVIEW_MEMORY_ENABLED=false
CODEX_REVIEW_SNAPSHOT_V2_ENABLED=false
```

在 `docs/architecture/current-system-topology.md` 更新 Daily Review 段落：

```text
schema v2 使用 review_candidates；这些对象 knowledge_publishable=false。
新的 accept/edit_accept 只更新 review item 状态，不创建 codex_review_memory。
历史 codex_review_memory 保留为 legacy archive，后台 worker 不再自动发布。
```

- [ ] **Step 5: Run the full v1 review suite**

```bash
cd api && python -m pytest \
  tests/test_openclaw_control_plane_sync.py \
  tests/test_codex_review_decision_routes.py \
  tests/test_codex_review_memory_store.py \
  tests/test_codex_review_memory_export.py \
  tests/test_codex_review_wiki_payload.py -q
```

Expected: PASS. Legacy store/export tests remain valid; only automatic creation/push behavior changes.

- [ ] **Step 6: Commit Task 3**

```bash
git add api/app/services/openclaw_control_plane.py api/tests/test_openclaw_control_plane_sync.py api/.env.example .env.example docs/architecture/current-system-topology.md
git commit -m "chore: archive legacy codex review memory flow"
```

### Task 4: FastAPI/OpenClaw Snapshot v2 Acceptance

**Files:**
- Modify: `docs/plans/2026-06-15-openclaw-codex-review-consumption-spec.md`
- Test: `api/tests/test_openclaw_control_plane_sync.py`

- [ ] **Step 1: Add an exact outbound payload fixture test**

```python
def test_push_codex_review_daily_snapshot_posts_schema_v2_review_candidates():
    app, client = _control_plane_app_with_daily_review()

    result = asyncio.run(push_codex_review_daily_snapshot(app, review_date="2026-07-15"))

    sent = client.snapshot_calls[0]["snapshot"]
    assert result["status"] in {"accepted", "snapshot_sent"}
    assert sent["schema_version"] == 2
    assert "review_candidates" in sent
    assert "learning_candidates" not in sent
    assert all(item["knowledge_publishable"] is False for item in sent["review_candidates"])
```

- [ ] **Step 2: Run and verify the fixture passes after Tasks 1-3**

```bash
cd api && python -m pytest tests/test_openclaw_control_plane_sync.py::test_push_codex_review_daily_snapshot_posts_schema_v2_review_candidates -q
```

Expected: PASS.

- [ ] **Step 3: Update the standalone OpenClaw consumption contract**

将文档中的 snapshot 示例更新为：

```json
{
  "kind": "codex_review_daily_snapshot",
  "schema_version": 2,
  "review_candidates": [
    {
      "id": "review-item-id",
      "candidate_type": "decision",
      "knowledge_publishable": false
    }
  ]
}
```

明确 OpenClaw 可以临时双读 schema v1，但两种版本均不得生成知识发布命令。

- [ ] **Step 4: Run final plan verification**

```bash
cd api && python -m pytest tests/test_openclaw_control_plane_sync.py tests/test_codex_review_decision_routes.py -q
git diff --check
```

Expected: all tests PASS and `git diff --check` produces no output.

- [ ] **Step 5: Commit Task 4**

```bash
git add api/tests/test_openclaw_control_plane_sync.py docs/plans/2026-06-15-openclaw-codex-review-consumption-spec.md
git commit -m "docs: publish codex daily review schema v2 contract"
```
