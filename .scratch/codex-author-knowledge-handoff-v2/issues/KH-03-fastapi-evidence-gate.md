# KH-03：FastAPI 接收、仓库证据、Gate 与 reconciliation

## 票据状态

- 状态：`blocked_until_KH-02`
- 依赖：`KH-02`
- 被阻塞的后续票据：`KH-04`
- 推荐独立 worktree：`C:\w\kh-03`
- 推荐分支：`codex/kh-03-fastapi-knowledge-gate`

## 目标

把 FastAPI 建成 Pet 之后、OpenClaw 之前的本地权威控制面：

```text
Pet
  ↓
FastAPI 保存不可变原始包
  ↓
创建 candidate revision
  ↓
解析固定仓库证据
  ↓
运行确定性 Gate
  ↓
只投递 ready_for_review 的候选级审核包给 OpenClaw
```

## 持久化对象

实现或重构出以下生命周期对象。具体表结构可以复用现有 store 约定，
但不得把它们重新塞回旧 Review v1 派生表：

```text
knowledge_handoff_package
knowledge_candidate_revision
knowledge_evidence_revision
knowledge_gate_result
knowledge_openclaw_delivery
knowledge_publication_receipt_mirror
```

原始 3+N 包和 candidate revision 必须不可变。作者补充或修改主张时生成新
candidate revision；仅提交代码、推送分支或补充可认证测试时，只增加
evidence revision，不静默覆盖作者主张。

## 接收职责

FastAPI 必须：

1. 接收 KH-02 的完整包和幂等键；
2. 校验 `.complete`、文件清单、包级 SHA-256 和 candidate 引用；
3. 对重复包返回稳定的 duplicate/已接收结果，不重复创建业务对象；
4. 将本机绝对路径隔离在 FastAPI 内部，不发送给 OpenClaw；
5. 为每个 candidate 创建独立 revision；
6. 保存来源 session、turn、workspace 和 Hook 完整性信息；
7. 记录接收、解析、Gate、投递和回执状态。

FastAPI 不能把接收成功解释为知识正确、审核通过或允许写入 Obsidian。

## Repository Evidence Resolver

在固定 Git revision 上确定性解析作者的 `evidence_hints`：

- 文件是否存在；
- 指定符号或测试是否存在；
- 报告的命令是否可复核；
- 当前 revision 是否是合法 Git revision；
- revision 是否可达 workspace 配置的 durable ref；
- 证据内容或引用的 SHA-256。

状态转换至少要区分：

```text
未提交或没有固定 revision
  → needs_repository_revision

已有本地 commit，但未进入 durable ref
  → needs_durable_revision

revision 已固定，但文件、符号或测试证据不足
  → needs_evidence

仓库证据足够，但作者解释缺失
  → needs_author_explanation

最低条件全部满足
  → ready_for_review
```

捕获时 metadata 中的 `head_commit` 只是来源事实，不得自动当作正式 Evidence
Reference。Evidence Reference 由 FastAPI 在可复核 revision 上创建。

## Gate 所有权和失败路线

Gate 只做确定性最低条件检查，不判断知识设计是否优秀、不判断 Vault 归属，
也不替作者生成 candidate。

必须支持这些状态：

```text
needs_repository_revision
needs_durable_revision
needs_evidence
needs_author_explanation
ready_for_review
delivered_to_openclaw
```

失败状态必须包含稳定原因码、阻断对象、当前 revision 和下一条修正路线。
用户要求作者补充时，只生成有边界的补充任务描述；不得自动恢复旧 Codex 会话，
不得覆盖旧 candidate。

## OpenClaw 投递边界

只有 `ready_for_review` 的 candidate 才能投递给 OpenClaw。投递内容应为：

- candidate 正文；
- marker 作者提示；
- 经过 FastAPI 认证的 Evidence Reference；
- candidate/evidence revision；
- 审核所需的最小上下文。

不得投递：

- 本机绝对路径；
- 原始 SQLite 行或旧 outbox 内容；
- 未经认证的“作者声称测试通过”；
- FastAPI 对 Vault 目标路径、topic_id 或 create/update/merge/supersede 的决定；
- FastAPI 创建或执行的 Accepted Wiki Change Set。

主链只能是：

```text
FastAPI → OpenClaw
```

OpenClaw 发布后的 receipt 可以单独镜像回 FastAPI，但 FastAPI 不能根据回执重新
向 OpenClaw 发起同一发布。

## Commit 后协调与 reconciliation

实现 Git event hint 接收和后台 reconciliation：

- Git Hook/事件只作为加速提示；
- 定期 Worker 扫描 `needs_repository_revision` 和 `needs_durable_revision`；
- 提示丢失后，周期性检查仍能推进状态；
- 未配置 durable ref 时，禁止使用当前分支或 `origin/HEAD` 冒充；
- 重复事件、重启和并发 Worker 必须幂等。

## 非目标

- 不实现 Vault Topic Resolution；
- 不实现用户内容审核；
- 不实现发布审核；
- 不冻结 Accepted Wiki Change Set；
- 不直接写 Obsidian；
- 不恢复或改写真实 `api/data/sqlite/trace.db`；
- 不启用 knowledge feature flags；
- 不迁移旧 Review v1 candidate、Wiki payload 或历史 outbox。

## 验收 Gate

必须覆盖：

1. 新 API 能安全接收 KH-02 发送的包并返回持久化 ACK；
2. 重复包、重复 candidate 和重复 delivery 不重复创建；
3. 原始包和 candidate revision 创建后不可变；
4. dirty 工作区、local commit、durable ref 三种状态转换正确；
5. 文件、符号、测试命令和 hash 证据可复核；
6. 缺证据和缺作者解释进入正确阻断状态；
7. Gate 通过后只生成候选级 bounded delivery；
8. Gate 不包含 Vault topic 决策；
9. OpenClaw 发布回执只形成审计镜像，不造成回跳；
10. Git 提示删除后 reconciliation 仍可恢复；
11. 新旧 Worker 并行时不会发送旧 Review v1 knowledge payload；
12. 所有测试使用临时/测试数据库，不能改变真实损坏 SQLite。

## 需要提供的验收证据

- API 路由、数据模型、Resolver、Gate 和 Worker 路径；
- 迁移或 schema 变更说明；
- 接收、幂等、revision、Gate 和 reconciliation 测试输出；
- 每个 Gate 状态的样例记录；
- OpenClaw bounded delivery 的脱敏样例；
- 明确说明真实 SQLite 尚未恢复、真实 OpenClaw 尚未发布。

## 交接要求

交给 KH-04 时必须明确：

```text
OpenClaw 收到的最小输入契约；
candidate_revision 与 evidence_revision 的关系；
FastAPI 不拥有的 Vault/发布字段；
回执镜像接口及其不可回跳约束；
ready_for_review 到 delivered_to_openclaw 的幂等语义。
```

