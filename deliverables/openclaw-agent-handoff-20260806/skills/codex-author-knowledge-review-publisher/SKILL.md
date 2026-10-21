---
name: codex-author-knowledge-review-publisher
description: Use when OpenClaw must review a Codex author knowledge candidate claimed from FastAPI, ask the user for content and publication confirmation, publish through Obsidian MCP plus Git CLI with the vault-publication-gate skill, and return decisions and receipts to FastAPI.
---

# Codex 作者知识审核与发布

## 外部链路

```text
Codex → Pet → FastAPI（队列/权威）→ OpenClaw（认领 + 审核 + 本机发布）
  → Obsidian MCP → Vault Publication Gate → Git CLI → Obsidian Vault
  → OpenClaw 回传决定与回执 → FastAPI（审计）
```

FastAPI 持有队列、规则与审计；OpenClaw 是审核界面和发布执行者。

## 审核流程

### 1. 认领

```http
POST {FASTAPI_BASE_URL}/codex/knowledge/review-claims
X-Codex-Knowledge-OpenClaw-Token: <token>
```

```json
{
  "workspace_key": "mmd-project",
  "claimed_by": "openclaw",
  "capacity": 1
}
```

响应包含 `claim_id`、候选、证据和 `validation_policy`。无候选时返回
`{"status": "no_candidates"}`，不制造空审核会话。

等待用户时每 60 秒：

```http
POST {FASTAPI_BASE_URL}/codex/knowledge/review-claims/{claim_id}/heartbeat
```

### 2. 第一次内容确认

向用户展示作者主张、证据摘要和边界，用户确认后回传：

```http
POST {FASTAPI_BASE_URL}/codex/knowledge/review-claims/{claim_id}/content-decision
```

```json
{
  "decision": "accept | edit_accept | reject | needs_evidence",
  "approved_knowledge": { "...": "accept 时必填" }
}
```

### 3. 发布方案与 preflight

- 用 Obsidian MCP 查询 Vault，确定目标页面；
- 生成发布方案（目标路径、frontmatter、Markdown、diff）；
- 调用 `vault-publication-gate` Skill 执行 preflight；
- 通过后才把完整 diff 展示给用户。

### 4. 第二次发布确认

```http
POST {FASTAPI_BASE_URL}/codex/knowledge/review-claims/{claim_id}/publication-decision
```

```json
{
  "decision": "approve",
  "proposal": {
    "publication_action": "create | update | merge | supersede",
    "target": {"topic_id": "...", "path": "...", "base_git_revision": "..."},
    "affected_files": [{"path": "...", "operation": "create", "markdown": "...", "result_content_sha256": "sha256:..."}],
    "diff": {"sha256": "sha256:..."}
  }
}
```

### 5. 发布

```text
Obsidian MCP 写入批准文件
  → vault-publication-gate post-apply
  → git status --porcelain（必须只有批准文件）
  → git add <批准文件>
  → git commit（带审计 trailer）
  → git push
```

commit trailer：

```text
Project-Knowledge-Publish-Ticket: <publish_ticket_id>
Project-Knowledge-Change-Set: <change_set_id>
Project-Knowledge-Decision: <decision_command_id>
```

### 6. 回传回执

```http
POST {FASTAPI_BASE_URL}/codex/knowledge/review-claims/{claim_id}/receipt
```

```json
{
  "status": "published | failed | conflict",
  "publication_action": "create",
  "wiki_topic_id": "...",
  "wiki_path": "...",
  "published_content_sha256": "sha256:...",
  "lint": {"status": "passed", "errors": [], "warnings": []},
  "git": {"commit_sha": "...", "branch": "main", "pushed": true},
  "validation_report": { "...": "validator CLI 完整输出" },
  "error": null
}
```

## 失败处理

- preflight 失败：不进入第二次确认；
- post-apply 失败：禁止 commit/push；
- Git commit 已创建但 push 失败：不自动 reset，保留 commit，回传 failed receipt；
- 任一失败都不标记 `published`。

## 实现边界

- 本 Skill 只编排流程；确定性检查由 `vault-publication-gate/scripts/validate_vault_publication.py`
  执行；
- 发布事务使用 Obsidian MCP + Git CLI，不使用 memory-wiki；
- FastAPI 是队列、规则和审计的唯一权威。
