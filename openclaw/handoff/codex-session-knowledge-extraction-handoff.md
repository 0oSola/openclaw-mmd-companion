# Codex Session Knowledge Extraction 交接说明

> 状态：Legacy / Review Memory v1-v2 抽取交接。不要把本文件作为新的项目领域知识 Wiki 审核发布合同。2026-07-14 起，OpenClaw 独立执行合同是 `docs/plans/2026-07-14-openclaw-project-domain-knowledge-review-publish-spec.md`；跨系统总合同是 `docs/plans/2026-07-14-project-domain-knowledge-wiki-execution-spec.md`。

交付对象：OpenClaw 团队

交付日期：2026-07-10

## 交付内容

本包包含：

1. `openclaw/skills/codex-session-knowledge-extraction/`
   - OpenClaw skill 原件。
   - 核心文件：`SKILL.md`
   - UI metadata：`agents/openai.yaml`
2. `openclaw/handoff/codex-session-knowledge-extraction-handoff.md`
   - 本交接说明。

## 目标

把 desktop-pet 收集到的 Codex 会话 bounded facts，交给 OpenClaw 筛选成少量可直接审核、可落盘 Wiki 的长期知识候选。

该链路不再输出概念百科或会话流水账，而是：

- 默认允许 `no_wiki`
- 最多三个独立、可读、可执行的 Wiki 候选
- 每个候选包含 `memory_draft`、质量 Gate、发布状态和证据引用
- 使用 `code_refs -> code_index` 标记脚本、测试、命令、文件、符号和证据代码片段
- 缺少最终成功证据时使用 `needs_evidence`，不能编造验证成功

## OpenClaw 侧需要做什么

把 skill 安装或注册到 OpenClaw 可加载的 skill 目录中：

```text
codex-session-knowledge-extraction/
  SKILL.md
  agents/openai.yaml
```

如果 OpenClaw 当前还没有原生 skill 加载能力，也可以先不安装。FastAPI 调 OpenClaw `/v1/responses` 时会把 `SKILL.md` 的完整内容作为 `skill_contract` 一并放进 prompt，保证输出 schema 不漂移。

## FastAPI 调用 OpenClaw 的方式

FastAPI 使用 OpenClaw Gateway `/v1/responses`。

请求头：

```text
Authorization: Bearer <OPENCLAW_TOKEN>
x-openclaw-agent-id: CODEX_KNOWLEDGE_AGENT_ID
x-openclaw-message-channel: CODEX_KNOWLEDGE_CHANNEL
x-openclaw-session-key: codex-knowledge:{pet_session_id}
```

默认配置：

```env
CODEX_KNOWLEDGE_EXTRACTION_ENABLED=false
CODEX_KNOWLEDGE_AGENT_ID=codex-manager
CODEX_KNOWLEDGE_CHANNEL=codex-pet
CODEX_KNOWLEDGE_SYNC_INTERVAL_SECONDS=10
CODEX_KNOWLEDGE_MAX_PAYLOAD_CHARS=12000
CODEX_KNOWLEDGE_MIN_SIGNAL_SCORE=5
CODEX_KNOWLEDGE_TIMEOUT_SECONDS=300
CODEX_KNOWLEDGE_PROMPT_VERSION=codex-knowledge-wiki-v2
CODEX_KNOWLEDGE_SKILL_PATH=openclaw/skills/codex-session-knowledge-extraction/SKILL.md
CODEX_KNOWLEDGE_DUMP_DEBUG_FILES=false
```

## 触发机制

desktop-pet 只上传 bounded facts，不上传完整 transcript。

FastAPI 自动触发条件：

1. `CODEX_KNOWLEDGE_EXTRACTION_ENABLED=true`
2. `OPENCLAW_TOKEN` 已配置
3. Codex session status 属于：
   - `completed`
   - `failed`
   - `waiting_approval`
   - `file_changed`
4. 会话知识信号分数 `signal_score >= CODEX_KNOWLEDGE_MIN_SIGNAL_SCORE`

信号分数来源：

- 终态/可复盘状态
- `facts.work_items` 数量
- `facts.methods` 数量
- changed files
- successful checks
- failed commands / errors
- last summary
- 中英文关键词，例如：方法、方法论、规则、概念、定义、领域、知识、复盘、根因、约束、验证、验收、架构、pipeline、contract、pattern

手动触发 API：

```http
POST /codex/knowledge/sessions/{pet_session_id}/extract
```

默认 `force=true`。`force` 只绕过信号分数，不绕过 feature flag 或 token 要求。

读取结果 API：

```http
GET /codex/knowledge/sessions/{pet_session_id}/latest
GET /codex/knowledge/items?workspace_id=mmd-companion&limit=20
```

## 输入数据契约

OpenClaw 会收到 `codex_knowledge_evidence_pack`，大致结构如下：

```json
{
  "kind": "codex_knowledge_evidence_pack",
  "schema_version": 1,
  "prompt_version": "codex-knowledge-wiki-v2",
  "skill": {
    "name": "codex-session-knowledge-extraction",
    "prompt_version": "codex-knowledge-wiki-v2"
  },
  "reviewability": {
    "reviewable_status": true,
    "knowledge_candidate": true,
    "signal_score": 8,
    "min_signal_score": 5,
    "matched_keywords": ["方法论", "规则", "验证"],
    "reasons": ["reviewable_status", "work_items", "methods", "knowledge_keywords"]
  },
  "session": {
    "pet_session_id": "codex:<id>",
    "codex_session_id": "<id>",
    "workspace_id": "mmd-companion",
    "status": "completed",
    "first_goal": "用户原始目标",
    "last_summary": "会话最后摘要"
  },
  "facts": {
    "work_items": [],
    "methods": [],
    "user_messages": [],
    "assistant_messages": [],
    "changed_files": [],
    "failed_commands": [],
    "successful_checks": [],
    "errors": []
  },
  "evidence": [],
  "code_index": [
    {
      "ref_id": "code-...",
      "kind": "test",
      "path": "tests/test-example.ps1",
      "command": "powershell -File tests/test-example.ps1",
      "outcome": "success",
      "exit_code": 0,
      "evidence_refs": ["facts.successful_checks[0]"]
    }
  ]
}
```

字段优先级以 skill 中 `Evidence Priority` 为准。

## OpenClaw 输出要求

OpenClaw 必须返回单个 JSON object，不要 Markdown。

必须包含：

```json
{
  "schema_version": 1,
  "disposition": "no_wiki | wiki_candidates",
  "assessment": {},
  "wiki_candidates": [],
  "rejected_items": [],
  "code_index": []
}
```

要求：

- JSON key、enum、文件路径、命令、代码标识保持英文或原文。
- 用户可读 prose 必须是简体中文。
- 默认返回 `no_wiki`，只有自包含、可执行、可复用且耐久的内容才生成候选。
- 每个候选必须包含面向人的 `memory_draft`，而不是 concepts/timeline 列表。
- 不要编造 evidence 中不存在的命令、文件、符号、代码、行号、根因或结论。
- `code_refs` 必须能解析到顶层 `code_index[*].ref_id`。
- `publish_status=ready` 必须有成功验证证据；缺失时使用 `needs_evidence`。
- 任务进度、一次性维护噪音、重复现有 Skill 的规则应进入 `rejected_items`。

FastAPI 会保存到 SQLite：

```text
codex_knowledge_extraction_outbox
codex_session_knowledge
```

## 安全边界

OpenClaw 不需要也不应该：

- 读取用户本机 Codex rollout 文件
- 读取完整 transcript
- 访问本地 FastAPI
- resume Codex
- approve/deny 操作
- apply patch
- 访问本机文件系统

FastAPI 只向 OpenClaw outbound 推送脱敏 bounded evidence pack。

## 验收命令

在 MMD project 仓库内已执行并通过：

```bash
python3 /home/ksg/.codex/skills/.system/skill-creator/scripts/quick_validate.py openclaw/skills/codex-session-knowledge-extraction
python3 -m py_compile api/app/services/codex_knowledge_extraction.py api/app/routes/codex_knowledge.py api/app/services/openclaw_client.py api/app/config.py api/app/main.py api/app/db/store.py api/app/routes/desktop_pet.py api/app/routes/config.py
python3 -m pytest api/tests/test_codex_knowledge_extraction.py api/tests/test_openclaw_client.py api/tests/test_desktop_pet_routes.py api/tests/test_codex_openclaw_review_sync.py api/tests/test_codex_review_fact_extractor.py api/tests/test_config_assets_trace_routes.py -q
npm run test -- codexSessionFiles.test.ts claudeSessionFiles.test.ts
npm run typecheck
npm run build
```

结果摘要：

- skill validator：通过
- Python 编译检查：通过
- FastAPI 目标测试：60 passed
- desktop-pet scanner 测试：15 passed
- desktop-pet typecheck/build：通过
- 真实 OpenClaw `codex-knowledge-wiki-v2` 前向测试：通过
  - 只生成 1 条 active element size authority Wiki 候选
  - `publish_status=needs_evidence`
  - 仅引用 `tests/test-codex-visual-recognition-seed-handoff.ps1`
  - 无关的 `scripts/validate-workflow-docs.mjs` 被归入 `rejected_items(temporary_noise)`
  - FastAPI reconciliation 保证输出 code ref 使用输入 `code_index` 的原始 path、command、snippet、outcome 和 exit code

`npm run build` 有 Vite 既有大 chunk warning，不影响本交付链路。

## OpenClaw 侧联调检查清单

1. 确认 skill 可安装或 FastAPI prompt fallback 可生效。
2. 用一条真实 `codex_knowledge_evidence_pack` 调 `/v1/responses`。
3. 确认返回是纯 JSON object。
4. 确认 `schema_version=1`。
5. 确认输出是 `no_wiki` 或最多三个 `wiki_candidates`。
6. 确认候选包含 `memory_draft`、`quality_gate`、`publish_status` 和 `code_refs`。
7. 确认所有 `code_refs` 都能解析到 `code_index`，且路径、命令、符号和代码片段来自 evidence。
8. 确认缺少成功验证时返回 `needs_evidence`，不会伪造 `ready`。
9. 确认用户可读字段是简体中文。
10. 确认没有要求读取本机文件或完整 transcript。
11. 确认 FastAPI worker 能把结果写入 `codex_session_knowledge.raw_response`，并从 latest/items API 暴露候选和代码索引。
