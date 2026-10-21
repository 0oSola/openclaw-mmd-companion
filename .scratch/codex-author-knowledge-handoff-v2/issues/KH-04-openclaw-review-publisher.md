# KH-04：OpenClaw 双审核与 Obsidian Publisher

## 票据状态

- 状态：`blocked_until_KH-03`
- 依赖：`KH-03`
- 被阻塞的后续票据：`KH-05`
- 推荐独立 worktree：`C:\w\kh-04`
- 推荐分支：`codex/kh-04-openclaw-publisher`

## 目标

在同一个 OpenClaw 业务节点内部完成：

```text
FastAPI bounded delivery
  ↓
内容审核
  ↓
Vault 只读查询与 Topic Resolution
  ↓
生成精确发布提案
  ↓
发布审核
  ↓
冻结 Accepted Wiki Change Set
  ↓
exact apply → lint → commit → push
  ↓
Publication Receipt
```

最终写入目标是 Obsidian Vault。memory-wiki 只是 OpenClaw 查询和发布 Obsidian
的能力接口，不是第二个知识目的地，也不是独立的 Topic Resolver 服务。

## 双批准模型

同一个 OpenClaw 审核任务必须有两个不可跳过、可分别中断和恢复的批准点。

### 第一次：内容审核

用户确认：

- candidate 描述的问题、根因和解决方案是否成立；
- 适用范围、非适用范围和不变量是否足够；
- 证据是否支持作者主张；
- 是否接受、修改、补证据、暂缓或拒绝。

通过结果只能表示：

```text
content_approved
```

不能直接写入 Obsidian。

### 第二次：发布审核

OpenClaw 读取 Vault 后，用户确认：

- 主题身份和现有页面匹配是否正确；
- create、update、merge、supersede 提案是否正确；
- 目标文件、完整 Markdown、frontmatter、aliases、wikilinks、MOC 和关系更新；
- 完整 diff、base hash 和影响范围；
- 是否允许执行本次精确变更。

通过后才冻结：

```text
Accepted Wiki Change Set
```

## Topic Resolution 边界

OpenClaw 可以复用 memory-wiki 的：

- 标题和路径查询；
- frontmatter；
- aliases；
- 正文读取；
- wikilinks/backlinks；
- base hash；
- exact apply、lint、commit、push。

OpenClaw需要明确处理：

```text
no_match
single_match
multiple_matches
semantic_conflict
```

Codex 的 `related_topic_hints` 只是检索提示，不是目标路径、topic_id 或发布动作。
FastAPI 不得提前决定这些字段。

## Accepted Wiki Change Set 和 Publisher

Change Set 必须是第二次审核通过时冻结的不可变对象，至少包含：

- change_set_id；
- candidate_revision；
- evidence_revision；
- 目标文件清单；
- 每个文件的 base hash；
- 批准后的完整内容或精确 patch；
- diff hash；
- 需要同步的 MOC、aliases 和关系文件；
- 两次批准事实；
- 执行约束和失败状态。

Publisher 只能原样执行冻结对象，禁止：

- 临时重写正文；
- 更换目标文件；
- 增加未批准页面；
- 重新决定 create/update/merge/supersede；
- 用新的生成内容替换用户批准内容；
- 将 handoff、marker、metadata 或 candidate 原稿写入 Obsidian。

执行顺序：

```text
校验 base hash
  → exact apply
  → lint
  → Git commit
  → push
  → 生成 Publication Receipt
```

任一步骤失败都不能标记 `published`。Vault base hash 变化时，旧 proposal 必须失效，
重新查询并生成新的 diff，不能在旧批准上强行应用。

## FastAPI 回执镜像

发布完成后可以向 FastAPI 异步发送：

- 两次审核结果摘要；
- change_set_id 和 hash；
- 最终文件 hash；
- Vault Git commit；
- push 结果；
- Publication Receipt。

回执是审计和状态观察，不是新的发布命令。不得形成：

```text
FastAPI → OpenClaw → FastAPI → OpenClaw
```

## 非目标

- 不从普通 Review 摘要生成知识正文；
- 不接受 Review `accept` 作为知识批准；
- 不让 FastAPI拥有 Vault Topic Resolution 或 Change Set；
- 不把原始 3+N 包直接落盘到 Obsidian；
- 不做 SQLite 恢复；
- 不在本票据完成真实全链路启用；
- 不在 feature flags 关闭前声称真实发布完成。

## 验收 Gate

必须覆盖：

1. 内容审核未通过时不会生成发布提案；
2. 内容审核通过但发布审核未通过时不会写 Vault；
3. no match、single match、multiple matches 和 semantic conflict 路线正确；
4. 用户批准的完整 diff、目标文件和 base hash 被冻结；
5. Publisher 不能临时改变冻结内容；
6. stale base hash 会废弃旧 proposal；
7. lint、commit、push 任一步失败都不会标记 published；
8. 测试 Vault 不包含 handoff、marker、metadata 或 candidate 原稿；
9. memory-wiki 只作为 Obsidian 接口，不新增第二落盘目的地；
10. receipt mirror 不会触发 FastAPI 二次发布；
11. 两次审核可以中断后继续，但不能合并成一次模糊 accept；
12. 真实端到端启用仍由 KH-05 负责。

## 需要提供的验收证据

- OpenClaw 审核状态机和恢复状态；
- memory-wiki 查询、diff、exact apply 和发布失败测试；
- 四种主题匹配路线的测试结果；
- Accepted Wiki Change Set 脱敏样例；
- 发布 receipt 样例；
- 测试 Vault 内容清单；
- 明确说明 KH-05 前仍未启用真实链路。

## 交接要求

交给 KH-05 时必须明确：

```text
两次审核各自的状态和批准证据；
Accepted Wiki Change Set 的不可变字段；
Publisher 的 exact apply 约束；
stale base、lint、commit、push 的回滚和重试路线；
receipt mirror 的接口和禁止回跳保证。
```

