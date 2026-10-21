---
name: vault-publication-gate
description: Use after an author knowledge publication proposal is drafted and after Obsidian MCP writes, to run deterministic preflight/post-apply checks against FastAPI's versioned validation policy before Git commit/push.
---

# Vault Publication Gate

## 定位

这是发布门禁的编排 Skill。它不负责判断知识好坏，也不代替 FastAPI 裁决；
它只负责在正确时机调用确定性 validator CLI，并把报告回传给 FastAPI。

## 两个门禁点

### 1. preflight（第二次发布确认之前）

```text
OpenClaw 生成发布方案（目标文件、frontmatter、Markdown、diff）
  → 本 Skill 执行 preflight
  → 通过后才把方案展示给用户做第二次确认
```

检查内容（由 validator CLI 完成）：

- 目标路径安全、在 `allowed_roots` 内；
- frontmatter 必填字段完整；
- Markdown 非空；
- proposal diff hash 与 FastAPI 计算一致。

### 2. post-apply（Obsidian MCP 写入后、Git commit 前）

```text
Obsidian MCP 写入
  → 本 Skill 执行 post-apply
  → 通过后才执行 git add/commit/push
```

检查内容：

- Git 工作树实际变更 == 批准 allowlist；
- 无无关 dirty 文件；
- 批准文件存在、hash 与批准一致；
- frontmatter 仍合法；
- 实际 diff hash == 第二次确认的 diff hash。

## 执行命令

```bash
python skills/vault-publication-gate/scripts/validate_vault_publication.py \
  --policy <policy.json> \
  --stage preflight \
  --proposal <proposal.json> \
  --vault <vault-path>

python skills/vault-publication-gate/scripts/validate_vault_publication.py \
  --policy <policy.json> \
  --stage post-apply \
  --vault <vault-path> \
  --allowed-paths <批准文件1> <批准文件2> \
  --expected-diff-sha256 <sha256:...>
```

退出码：`0` 通过；`1` 失败（报告在 stdout）。

## 失败处理

```text
preflight 失败
  → 不进入第二次确认
  → 展示 errors，重新生成发布方案

post-apply 失败
  → 禁止 git commit/push
  → 只撤销/修正本次批准文件
  → 重新执行检查
```

## 输出要求

把 validator 的完整 JSON 报告原样放进回执：

```json
{
  "policy_version": "...",
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

不要只回传 `{"passed": true}`；FastAPI 需要完整字段做审计。
