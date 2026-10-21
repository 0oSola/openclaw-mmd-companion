# OpenClaw Agent Handoff：作者知识审核与发布

- 日期：2026-08-06
- 版本：v1（基于“Agent 无关知识管线简化方案 v3”）
- 交付对象：OpenClaw（远程机器，Obsidian 与 Vault 所在机器）
- 上游方案：`docs/plans/2026-08-06-agent-agnostic-knowledge-pipeline-simplification.zh-CN.md`
- 交付包：`deliverables/openclaw-agent-handoff-20260806/`（或同目录 zip）

## 1. 你要做的三件事

```text
1. 部署两个 Skill + validator CLI（本包提供）；
2. 配置三个连接：FastAPI 地址/token、Obsidian MCP、Vault Git 工作区；
3. 按审核流程执行：认领 → 内容确认 → 发布方案 + preflight →
   发布确认 → Obsidian MCP 写入 → post-apply → Git commit/push →
   回传 FastAPI。
```

你不需要：

- 实现或维护审核状态机（FastAPI 持有）；
- 定义校验规则（FastAPI 下发 `validation_policy`）；
- 维护知识语义、主题归属或 diff 生成规则（FastAPI 与人工确认负责）；
- 使用 memory-wiki 做发布事务（已退役，Git CLI 接管）。

## 2. 交付包内容

```text
openclaw-agent-handoff-20260806/
├── README.md                          # 本说明
├── skills/
│   ├── codex-author-knowledge-review-publisher/
│   │   ├── SKILL.md                   # 审核对话 + 回传流程
│   │   └── agents/openai.yaml
│   └── vault-publication-gate/
│       ├── SKILL.md                   # 发布门禁编排
│       ├── scripts/
│       │   └── validate_vault_publication.py
│       └── schemas/
│           ├── validation-policy.schema.json
│           └── validation-report.schema.json
```

部署位置：

```text
~/.openclaw/workspace/skills/
```

或配置的 `extraDirs`。新 session 或 Gateway restart 后加载。

## 3. 需要你确认/配置的连接

### 3.1 FastAPI 地址与认证（待用户提供）

```text
FASTAPI_BASE_URL=http://<内网IP或域名>:8100
FASTAPI_KNOWLEDGE_TOKEN=<由用户配置的 CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_TOKEN>
```

所有请求带：

```http
X-Codex-Knowledge-OpenClaw-Token: <token>
```

### 3.1.1 来源 IP 白名单（后台管理）

FastAPI 侧对 OpenClaw 审核接口启用来源 IP 白名单，作为 token 之外的第二层防线：

- 后台页面：`GET /admin/codex-knowledge/whitelist/`
- 管理 API：`GET/POST /admin/codex-knowledge/whitelist/api`，`DELETE /admin/codex-knowledge/whitelist/api/{cidr}`
- 鉴权：`X-User-Id` 必须是 `ADMIN_USER_IDS` 中配置的管理员
- 支持单 IP 与 CIDR（例如 `10.11.252.164` 或 `10.11.252.0/24`），新增后即时生效
- 落盘：`api/data/knowledge_handoff/openclaw_whitelist.json`

白名单为空时默认放行（兼容本地链路）；一旦添加任何条目，白名单之外来源的请求返回 `403`。
OpenClaw 机器实际出口 IP 需在首次联通前加入白名单，否则认领请求会被拒绝。

### 3.2 Obsidian MCP

- 确认你使用的 Obsidian MCP 实现与工具清单（至少需要：读笔记、搜索、写/更新笔记）；
- Obsidian MCP 写入的工作区必须与 Git CLI 操作的工作区是**同一个目录**。

### 3.3 Vault Git 工作区

- 确认生产 Vault 路径（由用户/OpenClaw 共同确定，待 D4 拍板）；
- Vault 必须是 Git 仓库（可先 `git init` + 配置 remote）；
- 发布前 Vault 不应有无关 dirty 文件；有则先人工处理。

## 4. 审核流程（完整）

```text
1. POST /codex/knowledge/review-claims
   → 认领一条候选，返回 claim_id、candidate、evidence、policy
2. 向用户展示候选（作者主张、证据、边界），等待内容确认
3. 用户确认后：
   POST /codex/knowledge/review-claims/{claim_id}/content-decision
   { "decision": "accept", "approved_knowledge": {...} }
4. 查询 Obsidian（MCP）确定目标页面，生成发布方案（目标路径、frontmatter、Markdown）
5. 执行 preflight 门禁：
   python skills/vault-publication-gate/scripts/validate_vault_publication.py \
     --policy validation-policy.json --stage preflight \
     --vault <vault-path> --target-files <生成的文件>
   通过后把发布方案展示给用户
6. 用户确认后：
   POST /codex/knowledge/review-claims/{claim_id}/publication-decision
   { "decision": "approve", "proposal": {...} }
7. 调用 Obsidian MCP 写入目标文件
8. 执行 post-apply 门禁：
   validate_vault_publication.py --stage post-apply \
     --policy ... --vault ... --allowed-paths <批准文件>
9. Git CLI：
   git status --porcelain   # 必须只有批准文件
   git add <批准文件>
   git commit -m "project knowledge publish: <publish_ticket_id>"
   git push
10. 回传发布回执：
    POST /codex/knowledge/review-claims/{claim_id}/receipt
    { "status": "published", "git": {...}, "hashes": {...}, "report": {...} }
```

等待用户时每 60 秒调用一次 heartbeat 续租；需要暂停时调用 defer。

## 5. FastAPI API 契约

### 5.1 认领

```http
POST /codex/knowledge/review-claims
Content-Type: application/json
X-Codex-Knowledge-OpenClaw-Token: <token>
```

```json
{
  "workspace_key": "mmd-project",
  "claimed_by": "openclaw",
  "capacity": 1
}
```

响应：

```json
{
  "claim_id": "claim_...",
  "candidate_id": "candidate_...",
  "candidate_revision": 1,
  "status": "claimed",
  "lease_expires_at": "...",
  "candidate": { "...": "作者候选原文与证据" },
  "validation_policy": { "...": "版本化发布规则" }
}
```

无候选时返回 `{"status": "no_candidates"}`，不要制造空审核会话。

### 5.2 心跳 / 延期

```http
POST /codex/knowledge/review-claims/{claim_id}/heartbeat
POST /codex/knowledge/review-claims/{claim_id}/defer
```

### 5.3 内容决定（第一次确认）

```http
POST /codex/knowledge/review-claims/{claim_id}/content-decision
```

```json
{
  "decision": "accept | edit_accept | reject | needs_evidence",
  "approved_knowledge": { "...": "accept 时必填" },
  "notes": null
}
```

### 5.4 发布决定（第二次确认）

```http
POST /codex/knowledge/review-claims/{claim_id}/publication-decision
```

```json
{
  "decision": "approve | revise | reject",
  "proposal": {
    "publication_action": "create | update | merge | supersede",
    "target": {"topic_id": "...", "path": "projects/mmd-project/domains/...", "base_git_revision": "..."},
    "affected_files": [{"path": "...", "operation": "create", "markdown": "...", "result_content_sha256": "sha256:..."}],
    "diff": {"sha256": "sha256:..."}
  }
}
```

### 5.5 发布回执

```http
POST /codex/knowledge/review-claims/{claim_id}/receipt
```

```json
{
  "status": "published | failed | conflict",
  "publication_action": "create",
  "wiki_topic_id": "...",
  "wiki_path": "projects/mmd-project/domains/...",
  "published_content_sha256": "sha256:...",
  "lint": {"status": "passed", "errors": [], "warnings": []},
  "git": {"commit_sha": "...", "branch": "main", "pushed": true},
  "validation_report": { "..." : "validator CLI 输出" },
  "error": null
}
```

## 6. 校验规则与报告

FastAPI 在认领响应中下发 `validation_policy`，例如：

```json
{
  "validation_policy_version": "vault-structure-v1",
  "allowed_roots": ["projects/mmd-project/domains/"],
  "required_frontmatter": ["title", "topic_kind", "topic_id"],
  "forbid_path_traversal": true,
  "require_approved_file_allowlist": true,
  "require_clean_unrelated_diff": true
}
```

validator CLI 输出报告必须包含：

```json
{
  "policy_version": "vault-structure-v1",
  "check_stage": "preflight | post-apply",
  "checked_files": [],
  "approved_file_allowlist": [],
  "actual_changed_files": [],
  "document_hashes": {},
  "diff_hash": null,
  "errors": [],
  "warnings": [],
  "validator_version": "1",
  "executed_at": "..."
}
```

FastAPI 会校验：规则版本、检查范围、实际修改文件 == 批准范围、
post-apply diff hash == 第二次确认 diff hash、Git 提交内容一致。

## 7. 门禁失败处理

```text
preflight 失败
  → 不进入第二次确认
  → 展示错误，重新生成发布方案

post-apply 失败
  → 禁止 git commit/push
  → 修正或撤销本次写入（只动本次批准文件）
  → 重新执行检查

Git commit 已创建但 push 失败
  → 不自动 reset；保留 commit 信息
  → 回传 failed receipt，附 commit_sha
```

## 8. 验收清单

- [ ] FastAPI 认领接口返回候选与 policy（无候选时返回空）
- [ ] 内容确认后状态为 `content_approved`
- [ ] preflight 失败时无法进入第二次确认
- [ ] 发布确认后状态为 `publication_approved`
- [ ] Obsidian MCP 写入的文件出现在 Git 工作区且只有批准文件
- [ ] post-apply 报告的 diff hash 与批准 diff 一致
- [ ] commit/push 成功，回执 `status=published`
- [ ] FastAPI 收到回执并标记 `published`
- [ ] 租约过期后候选恢复 `queued`
- [ ] 任一失败场景未标记 `published`

## 9. 待用户/OpenClaw 共同确认

1. FastAPI 对外地址与 token（D10）；
2. Obsidian MCP 实现与工具清单（D3）；
3. 生产 Vault 路径与 Git remote（D4）；
4. 审核界面是否就用 OpenClaw 对话（D1，默认是）。
