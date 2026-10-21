# Codex Concept Author Explanation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当 Domain Knowledge Gate 缺少 Concept Delta 时，恢复原 Codex thread，请概念创建者返回结构化作者解释，然后重新运行知识提炼。

**Architecture:** FastAPI 用 durable outbox 保存 author request，通过本地 Codex app-server `thread/resume` 恢复原 thread，并在 read-only sandbox 中发起只允许返回 Concept Delta JSON 的 turn。合法响应写入 Concept Delta store，并以新 source hash 重新 enqueue v2 extraction。

**Tech Stack:** Python 3.11、FastAPI、Codex app-server JSON-RPC、SQLite、Pydantic、pytest

---

## File Structure

- `api/app/codex_schema/methods.py`：增加 pinned `thread/resume` method。
- `api/app/services/codex_app_server_client.py`：提供 thread resume API。
- `api/app/services/codex_concept_author_explanation.py`：author request prompt、Codex turn 和 Concept Delta 编排。
- `api/app/db/store.py`：durable author request outbox。
- `api/app/services/domain_knowledge_session_pipeline.py`：`needs_author_explanation` 时入队。
- `api/app/config.py`、`api/app/main.py`：feature flag 和 worker lifecycle。
- `api/app/routes/codex_knowledge.py`：查询和重试 API。
- `api/tests/test_codex_app_server_client.py`、`api/tests/test_codex_concept_author_explanation.py`：回归测试。
- `docs/architecture/current-system-topology.md`：更新调用链。

### Task 1: Add Pinned Thread Resume Support

**Files:**
- Modify: `api/app/codex_schema/methods.py`
- Modify: `api/app/services/codex_app_server_client.py`
- Test: `api/tests/test_codex_app_server_client.py`

- [ ] **Step 1: Write the failing resume test**

```python
@pytest.mark.asyncio
async def test_resume_thread_sends_pinned_json_rpc_request():
    writer = FakeWriter()
    client = CodexAppServerClient(codex_bin="codex", codex_home=Path("/tmp/codex"))
    client.attach_writer_for_tests(writer)
    task = asyncio.create_task(
        client.resume_thread(
            thread_id="019f2891-4e16-7722-828b-74c1b9c23deb",
            cwd=Path("/workspace/mmd-project"),
            sandbox="read-only",
        )
    )
    request = json.loads(writer.messages[0])
    await client.handle_message_for_tests(
        {"id": request["id"], "result": {"thread": {"id": request["params"]["threadId"]}}}
    )

    result = await task
    assert request["method"] == "thread/resume"
    assert request["params"] == {
        "threadId": "019f2891-4e16-7722-828b-74c1b9c23deb",
        "cwd": "/workspace/mmd-project",
        "sandbox": "read-only",
        "approvalPolicy": "never",
        "approvalsReviewer": "user",
        "excludeTurns": True,
    }
    assert result["thread"]["id"] == request["params"]["threadId"]
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_codex_app_server_client.py -k "resume_thread" -q
```

Expected: FAIL because `THREAD_RESUME` and `resume_thread` do not exist.

- [ ] **Step 3: Implement the pinned method**

```python
class CLIENT_REQUEST_METHODS(StrEnum):
    INITIALIZE = "initialize"
    THREAD_START = "thread/start"
    THREAD_RESUME = "thread/resume"
    TURN_START = "turn/start"
    TURN_INTERRUPT = "turn/interrupt"
```

```python
async def resume_thread(self, *, thread_id: str, cwd: Path, sandbox: str) -> dict[str, Any]:
    response = await self.request(
        CLIENT_REQUEST_METHODS.THREAD_RESUME,
        {
            "threadId": thread_id,
            "cwd": str(Path(cwd)),
            "sandbox": sandbox,
            "approvalPolicy": "never",
            "approvalsReviewer": "user",
            "excludeTurns": True,
        },
    )
    thread = response.get("thread") if isinstance(response.get("thread"), dict) else {}
    self.thread_id = str(thread.get("id") or thread_id)
    return response
```

- [ ] **Step 4: Run and commit**

```bash
cd api && python -m pytest tests/test_codex_app_server_client.py -q
git add api/app/codex_schema/methods.py api/app/services/codex_app_server_client.py api/tests/test_codex_app_server_client.py
git commit -m "feat: resume codex threads for concept explanations"
```

### Task 2: Persist Durable Author Requests

**Files:**
- Modify: `api/app/db/store.py`
- Create: `api/tests/test_codex_concept_author_explanation.py`

- [ ] **Step 1: Write the failing outbox test**

```python
def test_author_request_is_idempotent_and_claimable():
    store = _store()
    payload = {
        "workspace_id": "mmd-companion",
        "pet_session_id": "pet-1",
        "codex_session_id": "019f-session",
        "source_hash": "sha256:" + "1" * 64,
        "terms": ["motion acceptance gate"],
        "request": {"workspace_path": "/workspace/mmd-project"},
    }
    first = store.enqueue_codex_concept_author_request(**payload)
    second = store.enqueue_codex_concept_author_request(**payload)
    claimed = store.claim_next_codex_concept_author_request(now_iso="2099-01-01T00:00:00+00:00")

    assert second["id"] == first["id"]
    assert claimed["status"] == "sending"
    assert claimed["attempt_count"] == 1
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_codex_concept_author_explanation.py -q
```

Expected: FAIL because the table and methods do not exist.

- [ ] **Step 3: Add the table and store methods**

```sql
CREATE TABLE IF NOT EXISTS codex_concept_author_requests (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    pet_session_id TEXT NOT NULL,
    codex_session_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    terms_json TEXT NOT NULL DEFAULT '[]',
    request_json TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    response_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE(workspace_id, codex_session_id, source_hash)
);
```

实现 `enqueue/get/list/claim/mark_succeeded/mark_failed/requeue`。所有 row adapter
必须解码 `terms_json`、`request_json` 和 `response_json`；claim 将 pending 行原子更新为
`sending` 并增加 `attempt_count`。

- [ ] **Step 4: Run and commit**

```bash
cd api && python -m pytest tests/test_codex_concept_author_explanation.py -q
git add api/app/db/store.py api/tests/test_codex_concept_author_explanation.py
git commit -m "feat: persist codex concept author requests"
```

### Task 3: Ask Codex, Validate Delta, And Requeue Extraction

**Files:**
- Create: `api/app/services/codex_concept_author_explanation.py`
- Modify: `api/app/services/domain_knowledge_session_pipeline.py`
- Test: `api/tests/test_codex_concept_author_explanation.py`

- [ ] **Step 1: Write the failing worker test**

```python
@pytest.mark.asyncio
async def test_author_worker_saves_delta_and_requeues_extraction():
    store, request = _claimed_request()
    client = FakeAuthorCodexClient(final_text=json.dumps(_concept_delta()))
    app = _app(store, client)

    processed = await process_next_codex_concept_author_request(app)

    assert processed is True
    assert client.resume_calls[0]["thread_id"] == request["codex_session_id"]
    assert store.list_codex_concept_deltas(codex_session_id=request["codex_session_id"])
    assert store.get_codex_concept_author_request(request["id"])["status"] == "succeeded"
    assert store.claim_next_codex_knowledge_extraction(
        now_iso="2099-01-01T00:00:00+00:00"
    ) is not None
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_codex_concept_author_explanation.py -k "worker_saves" -q
```

Expected: FAIL because the worker does not exist.

- [ ] **Step 3: Implement the bounded prompt and worker**

```python
def build_concept_author_prompt(request: dict[str, Any]) -> str:
    terms = ", ".join(request.get("terms") or [])
    return (
        "你是这些项目领域名词的创建者。只返回一个 JSON object，不要 Markdown。\n"
        "返回 kind=codex_concept_delta、schema_version=1，并填写 introduced_for、"
        "definitions、relationships、boundaries、invariants、technical_solution_claims、"
        "evidence_hints 和 open_questions。\n"
        f"workspace_id={request['workspace_id']}\n"
        f"codex_session_id={request['codex_session_id']}\n"
        f"terms={terms}\n"
        "不得修改代码、运行命令或请求权限；只解释原会话创建的概念。"
    )
```

worker 必须执行以下完整顺序：

```python
async def collect_final_agent_message(client: Any, turn: dict[str, Any]) -> str:
    chunks: list[str] = []
    async for event in client.events_until_turn_complete():
        event_type = str(event.get("type") or "")
        if event_type == "text_delta":
            chunks.append(str(event.get("delta") or event.get("text") or ""))
        elif event_type in {"turn_failed", "session_closed"}:
            raise ValueError(str(event.get("error") or event_type))
    text = "".join(chunks).strip()
    if not text:
        raise ValueError(f"Codex author explanation turn produced no text: {turn}")
    return text


request = store.claim_next_codex_concept_author_request(now_iso=datetime.now(UTC).isoformat())
client = app.state.codex_author_client_factory()
await client.start()
await client.initialize()
await client.resume_thread(
    thread_id=request["codex_session_id"],
    cwd=Path(request["request"]["workspace_path"]),
    sandbox="read-only",
)
turn = await client.start_turn(
    thread_id=request["codex_session_id"],
    user_message=build_concept_author_prompt(request),
    cwd=Path(request["request"]["workspace_path"]),
    sandbox_policy={"type": "readOnly"},
)
response_text = await collect_final_agent_message(client, turn)
delta = ConceptDelta.model_validate(json.loads(response_text)).model_dump(mode="json")
collect_concept_deltas(
    store,
    {
        "workspace_id": request["workspace_id"],
        "codex_session_id": request["codex_session_id"],
        "concept_deltas": [{"payload": delta, "raw_author_text": response_text}],
        "domain_term_changes": [],
    },
)
store.mark_codex_concept_author_request_succeeded(request["id"], response=delta)
enqueue_codex_knowledge_extraction(store, request["pet_session_id"], force=True)
```

异常时保存异常类型或文本并标记 failed；finally 中关闭 client。
`materialize_domain_knowledge_synthesis` 遇到 `needs_author_explanation` 时 enqueue
request，terms 来自 draft title、aliases 和对应 coverage finding。

- [ ] **Step 4: Run and commit**

```bash
cd api && python -m pytest tests/test_codex_concept_author_explanation.py tests/test_domain_knowledge_session_pipeline.py -q
git add api/app/services/codex_concept_author_explanation.py api/app/services/domain_knowledge_session_pipeline.py api/tests/test_codex_concept_author_explanation.py
git commit -m "feat: request missing concept explanations from codex"
```

### Task 4: Wire Feature Flag, Retry API, And Topology

**Files:**
- Modify: `api/app/config.py`
- Modify: `api/app/main.py`
- Modify: `api/app/routes/codex_knowledge.py`
- Modify: `api/.env.example`
- Modify: `.env.example`
- Modify: `docs/architecture/current-system-topology.md`
- Test: `api/tests/test_codex_concept_author_explanation.py`

- [ ] **Step 1: Write failing settings and retry tests**

```python
def test_author_explanation_worker_defaults_off():
    assert Settings.from_env({}).codex_concept_author_explanation_enabled is False


def test_admin_can_retry_failed_author_request():
    client, request = _client_with_failed_request()
    response = client.post(
        f"/codex/knowledge/author-requests/{request['id']}/retry",
        headers={"x-user-id": "admin-1"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "pending"
```

- [ ] **Step 2: Run and verify RED**

```bash
cd api && python -m pytest tests/test_codex_concept_author_explanation.py -k "defaults_off or retry_failed" -q
```

Expected: FAIL because settings and routes do not exist.

- [ ] **Step 3: Add configuration and routes**

```python
codex_concept_author_explanation_enabled: bool
codex_concept_author_explanation_interval_seconds: float
```

```dotenv
CODEX_CONCEPT_AUTHOR_EXPLANATION_ENABLED=false
CODEX_CONCEPT_AUTHOR_EXPLANATION_INTERVAL_SECONDS=10
```

增加：

```python
@router.get("/author-requests")
def list_author_requests(...):
    _require_admin(request, x_user_id)
    return {"items": request.app.state.trace_store.list_codex_concept_author_requests(limit=limit)}


@router.post("/author-requests/{request_id}/retry")
def retry_author_request(...):
    _require_admin(request, x_user_id)
    item = request.app.state.trace_store.requeue_codex_concept_author_request(request_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Concept author request not found.")
    return item
```

`main.py` 在 flag 和本地 Codex prerequisites 可用时启动 worker，shutdown 时 cancel。

- [ ] **Step 4: Update topology and run verification**

```bash
cd api && python -m pytest \
  tests/test_codex_app_server_client.py \
  tests/test_codex_concept_author_explanation.py \
  tests/test_domain_knowledge_session_pipeline.py \
  tests/test_codex_knowledge_extraction.py -q
git diff --check
```

Expected: all tests PASS and no whitespace errors.

- [ ] **Step 5: Commit Task 4**

```bash
git add api/app/config.py api/app/main.py api/app/routes/codex_knowledge.py api/.env.example .env.example docs/architecture/current-system-topology.md api/tests/test_codex_concept_author_explanation.py
git commit -m "feat: operate codex concept author explanation worker"
```
