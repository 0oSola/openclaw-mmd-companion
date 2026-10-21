# Codex Review 与项目领域知识严格分流设计

日期：2026-07-15

状态：待用户审核

适用范围：FastAPI、OpenClaw Control Plane、Codex 会话知识提炼、Obsidian Domain Wiki

## 1. 背景

当前 `codex_review_daily_snapshot.learning_candidates` 由 FastAPI 将
`codex_review_items` 中的 `work_summary`、`decision`、`followup`、
`pitfall` 和 `blocker` 机械投影而来。它们适合回答“这次工作发生了什么”，
但不能稳定回答以下长期知识问题：

1. 项目中存在什么领域概念、规则、流程、Contract、Gate 或架构决策？
2. 它们为了解决什么问题而引入？
3. 它们的定义、边界、非例、关系和不变量是什么？
4. 项目用什么技术方案实现它们？
5. 哪些固定版本的代码、测试和验证结果支持这些结论？

当前系统已经具备 Domain Knowledge v2 的基础模块，但自动闭环尚未接通：

- `codex_knowledge_extraction_outbox` 可以驱动 OpenClaw Skill 生成 v2 草稿；
- Repository Evidence Resolver、Concept Delta Collector、Deterministic Gate、
  Topic Identity Resolver 已存在；
- candidate revision、delivery、review ledger、Accepted Wiki Change Set、
  publication receipt 已存在；
- 但 Skill 输出目前只保存到 `codex_session_knowledge`，没有自动进入 Resolver、
  Gate、Topic Identity、candidate persistence 和 OpenClaw delivery。

因此，根因不是 v1 prompt 缺少几个字段，而是 Review Candidate 和 Domain
Knowledge Candidate 两个领域对象被混用。

## 2. 设计目标

本设计建立两条严格隔离的链路：

```text
Codex session evidence
├─ v1 Daily Review
│  └─ review_candidates
│     └─ 工作复盘、任务管理、补证据
│        └─ 永不直接进入 Obsidian
│
└─ v2 Domain Knowledge
   └─ Concept Delta + fixed-revision repository evidence
      └─ OpenClaw Skill synthesis
         └─ deterministic Gate + Topic Identity
            └─ OpenClaw content review + publication review
               └─ exact Accepted Wiki Change Set
                  └─ Obsidian canonical Domain Wiki
```

成功后的系统必须满足：

- 日常复盘不再伪装成长期知识；
- 领域知识必须包含问题、含义、边界、技术方案和代码/验证证据；
- LLM 只负责理解与表达，不负责创造事实定位；
- 未经 OpenClaw 双重审核的内容不能写入 Obsidian；
- 发布内容必须与用户批准的精确版本和 hash 完全一致。

## 3. 非目标

本次不做以下事情：

- 不把 v1 review prompt 改造成领域知识提炼器；
- 不把 followup、work summary 或普通错误自动升级为知识；
- 不让 OpenClaw 读取本地 Codex rollout、仓库或完整 transcript；
- 不让 LLM 创建文件路径、行号、commit、测试结果或 Evidence Reference；
- 不自动覆盖存在冲突的 Obsidian canonical Note；
- 不在第一轮一次性回溯全部历史会话和全部 backlog；
- 不把未提交工作区内容作为正式 Wiki 的权威代码证据。

## 4. 领域对象与职责

### 4.1 Review Candidate

Review Candidate 用于每日复盘和任务管理，可以包含：

- 工作总结；
- 决策记录；
- 待办事项；
- 问题和阻塞；
- 需要补充的执行证据。

它只能执行：

- `accept`：确认该复盘项已阅读或处理；
- `ignore`：忽略；
- `snooze`：稍后处理；
- `needs_evidence`：要求补充执行证据。

Review Candidate 必须带有 `knowledge_publishable=false`，不能创建 Wiki
memory、Accepted Wiki Change Set 或 Obsidian publication job。

### 4.2 Domain Knowledge Candidate

Domain Knowledge Candidate 是面向一个稳定领域主题、一个主要检索意图的
未审核知识提案。允许的 `topic_kind` 只有：

- `concept`；
- `rule`；
- `workflow`；
- `contract`；
- `gate`；
- `architecture_decision`。

候选必须回答：

- 为什么引入；
- 定义和具体含义；
- 实体、关系、边界、非例和不变量；
- 技术方案；
- Contract、实现、测试和验证证据；
- 如何定位回固定版本的代码块。

### 4.3 Concept Delta

Concept Delta 是 Codex 对自己创建、重命名、澄清、废弃或替代的领域概念给出的
结构化作者解释。OpenClaw 不得代替 Codex 猜测概念含义。

当 `contract`、`workflow`、`rule`、`gate` 或 `policy` 类概念缺少 Concept
Delta 时，候选状态必须是 `needs_author_explanation`。系统应向 Codex 发起有界的
补充解释请求；无法恢复原会话时保留待解释状态，由用户决定重新询问或放弃。

`policy` 不作为独立的 `topic_kind` 发布；它在候选阶段统一归入 `rule`。

### 4.4 Evidence Reference

Evidence Reference 只能由 FastAPI Repository Resolver 在固定 Git revision 下
生成。最少包含：

- repository ID；
- commit SHA；
- blob SHA；
- workspace-relative path；
- symbol 或行号范围；
- bounded snippet；
- snippet SHA；
- role：`contract | implementation | test | validation`；
- 可选的验证命令和结果。

OpenClaw Skill 和用户只能选择或删除已有 Evidence Reference，不能修改其事实定位。

## 5. v1 Daily Review 契约

### 5.1 Snapshot v2

`codex_review_daily_snapshot` 升级为 schema v2：

```json
{
  "kind": "codex_review_daily_snapshot",
  "schema_version": 2,
  "date": "2026-07-15",
  "workspace_id": "mmd-companion",
  "summary": {},
  "drafts": [],
  "daily_new_items": [],
  "pending_review_backlog": {},
  "work_units": [],
  "review_candidates": [],
  "rollup": {}
}
```

schema v2 不再写入 `learning_candidates`。`review_candidates[*]` 必须包含：

```json
{
  "id": "review-item-id",
  "candidate_type": "decision",
  "title": "...",
  "summary": "...",
  "priority_score": 50,
  "evidence_refs": [],
  "knowledge_publishable": false
}
```

### 5.2 OpenClaw 兼容迁移

迁移采用“短期双读、单写”：

- FastAPI 只写 schema v2 `review_candidates`；
- OpenClaw 迁移期可以读取旧 schema v1 `learning_candidates`，但必须按复盘项处理；
- 两种 schema 均不得显示“知识接受”入口；
- v2 项目知识继续使用独立的
  `project_domain_knowledge_candidate_batch`；
- 确认 OpenClaw 连续正确处理 schema v2 后，删除 v1 reader。

### 5.3 v1 数据保留

现有 v1 backlog 不删除、不改写历史审核状态，只重新命名其外发语义。
历史 `learning_candidates` 不做字段级知识迁移。

已经存在的 `codex_review_memory`、历史版本和发布回执保留为 legacy archive，不删除、
不重写已经发生的历史事实。切换完成后，新的 v1 `accept` 不再创建
`codex_review_memory` 或 memory-wiki payload；只有 v2 Accepted Wiki Change Set
可以触发新的 Obsidian 发布。

## 6. v2 自动提炼触发

### 6.1 自动触发

Codex 会话进入 `completed`、`failed`、`waiting_approval` 或 `file_changed`
等 reviewable 状态时，FastAPI 执行低成本知识信号扫描。

只有检测到以下信号才进入完整提炼：

- 新增或改变领域概念；
- 项目规则、不变量或 Gate；
- 跨组件 Contract；
- 可复用且有边界的工作流；
- 包含取舍和替代方案的架构决策；
- 有明确根因、修复、预防和复用条件的项目特有故障方案。

普通文件修改、工作汇报、待办、工具缺失和无根因错误返回 `no_knowledge`。

### 6.2 手动触发

管理员可以指定 `pet_session_id` 或 `codex_session_id` 强制重新扫描历史会话。
强制扫描绕过信号分数，但不能绕过 Repository Resolver、Concept Delta 和 Gate。

### 6.3 幂等

提炼 source hash 必须包含：

- 规范化后的会话证据；
- parser/facts 版本；
- prompt/Skill 版本；
- repository revision；
- Concept Delta revision。

相同 source hash 不重复调用 OpenClaw Skill。任一输入变化时生成新的 candidate revision。

### 6.4 负向判定

`no_knowledge` 必须保存轻量记录：

- source hash；
- session IDs；
- scanner/Skill 版本；
- reason codes；
- evaluated_at。

不保存冗长推理文本，不进入 Obsidian。

## 7. v2 自动编排流程

### 7.1 主流程

```text
terminal/reviewable session
  -> bounded session evidence
  -> knowledge signal scan
  -> Concept Delta Collector
  -> fixed repository revision
  -> Repository Evidence Resolver
  -> OpenClaw Skill synthesis (untrusted draft)
  -> Evidence Reference reconciliation
  -> Deterministic Domain Knowledge Gate
  -> Topic Identity Resolver
  -> immutable candidate revision persistence
  -> durable OpenClaw candidate delivery
```

增量运行使用稳定 run ID：

```text
project-knowledge:{workspace_id}:incremental:{YYYY-MM-DD}
```

历史回溯使用：

```text
project-knowledge:{workspace_id}:backfill:{scan_id}
```

### 7.2 FastAPI 职责

FastAPI 负责：

- 会话证据收集和脱敏；
- Concept Delta 收集与缺失检测；
- 固定 Git revision；
- 生成 canonical Evidence Reference；
- 校验 Skill 输出引用；
- Gate、Topic Identity、candidate revision 和 delivery；
- review command、Accepted Wiki Change Set 和 publication receipt ledger。

### 7.3 OpenClaw Skill 职责

`codex-session-knowledge-extraction` Skill 负责：

- 基于有界证据做语义综合；
- 生成完整 Domain Knowledge Draft；
- 解释领域关系、边界和技术方案；
- 返回 `no_wiki` 或最多三个候选；
- 只引用输入已有 Evidence Reference ID。

Skill 输出始终是不可信草稿，不得自行决定 Gate、发布状态、Wiki 路径或代码 locator。

## 8. 确定性 Gate

只有同时满足下列条件，候选才能成为 `ready_for_review`：

1. `introduced_for.problem`、`context`、`failure_before_introduction` 完整；
2. definition 非空；
3. relationships 字段显式存在；
4. boundaries 明确包含 in-scope、out-of-scope、non-examples、confused-with；
5. invariants 字段显式存在；
6. 至少一个 `contract` 或 `implementation` 证据；
7. 至少一个 `test` 或 `validation` 证据；
8. 所有 Evidence Reference ID 均存在于 Resolver 输入；
9. 要求 Concept Delta 的 topic kind 已绑定有效 Concept Delta；
10. 代码和 Contract 已绑定固定 Git commit。

状态定义：

- `ready_for_review`：全部通过；
- `needs_evidence`：定义、边界、实现或验证证据不足；
- `needs_author_explanation`：缺少 Codex Concept Delta；
- `needs_repository_revision`：只存在未提交工作区内容；
- `no_knowledge`：没有领域知识信号；
- `rejected`：伪造引用、契约非法或用户拒绝。

`needs_*` 状态可以持久化和展示，但不能进入发布审核。

## 9. 未提交代码处理

未提交内容可以生成临时草稿和 content-addressed preview，但不能成为正式 Wiki 证据。

正式发布前必须重新绑定：

- commit SHA；
- blob SHA；
- 文件路径；
- symbol 或行号；
- snippet SHA。

在绑定完成前，候选状态为 `needs_repository_revision`。这避免 Wiki 引用一个之后无法
复现的工作区瞬时状态。

## 10. Topic Identity 与冲突

Topic Identity Resolver 按以下顺序匹配：

1. `topic_id`；
2. `topic_identity_key`；
3. aliases 和 prior names；
4. 语义相似建议。

语义相似只提供建议，不能自动决定身份。

- 唯一明确匹配：生成 `update` 提案；
- 多个匹配：`multiple_matches`，由用户选择；
- 定义、边界或不变量冲突：生成零写入的 `conflict` 提案；
- 无匹配：生成 `create` 提案。

冲突审核必须并排展示现有定义、新定义、双方证据和完整 diff。用户可选择 keep、
update、merge、supersede、needs evidence 或 reject。

## 11. OpenClaw 审核

### 11.1 两类审核入口

日常复盘命令：

- `复盘 N`；
- `接受 N`；
- `忽略 N`；
- `稍后 N`；
- `证据 N`。

项目知识命令：

- `知识 N`；
- `知识接受 N`；
- `知识修改 N`；
- `知识补证据 N`；
- `知识拒绝 N`；
- `知识发布 N`。

两类编号独立维护。日常复盘消息必须明确说明“不会进入 Obsidian”。

### 11.2 双重审核

项目知识必须经过两个独立确认：

1. 内容审核：定义、引入原因、边界、不变量、技术方案和证据；
2. 发布审核：action、target path、完整 Markdown、affected files 和 full diff。

只有两者都通过，FastAPI 才创建不可变的 Accepted Wiki Change Set。

### 11.3 用户编辑边界

用户可以编辑标题、表述、结构和 Wiki 链接，也可以选择或删除已有证据。

用户不能编辑 commit、blob、路径、symbol、行号、测试结果和 Evidence Reference ID。
定义、边界、不变量或技术结论发生修改时必须重新运行 Gate；证据不再支持结论时退回
`needs_evidence`。

### 11.4 提醒策略

候选实时入队，OpenClaw 批量提醒：

- 每日固定时间生成审核摘要；
- 一次最多优先展示三个 `ready_for_review` 候选；
- 优先级为 Contract/Gate/规则、跨模块架构决策、新概念、工作流和故障方案；
- `needs_author_explanation` 与 `needs_evidence` 单独进入补证据队列。

## 12. Obsidian 结构

建议 Vault 结构：

```text
Domain Wiki/
├── MOC/
│   └── mmd-companion.md
├── Concepts/
├── Rules/
├── Workflows/
├── Contracts/
├── Gates/
├── Architecture Decisions/
└── _Evidence/
```

一个稳定 `topic_id` 对应一篇 canonical Note。标题和路径可变，身份不变。

每篇 Note 必须包含：

- 为什么引入；
- 定义和具体含义；
- 边界、非例和不变量；
- 实体与关系；
- 技术方案；
- Contract、实现、测试和验证引用；
- 验证方式；
- 相关领域知识；
- 来源和修订历史。

`_Evidence` 只存必要的证据索引或快照元数据，不复制完整源码。会话记录只作为
provenance，不作为 canonical Note 正文。

## 13. 知识版本生命周期

- `topic_id` 永久稳定；
- 每次输入变化产生新的 immutable `candidate_revision`；
- 小幅澄清或实现引用更新使用 `update`；
- 核心定义或适用边界被替代时使用 `supersede`；
- 历史版本不物理删除；
- 页面记录当前版本、生效 revision、supersedes/superseded_by、变更原因和代码 revision；
- 同一主题的多次会话更新同一 canonical Note，不生成重复页面。

## 14. 历史数据迁移

历史 v1 review item 不直接转换为 v2 candidate。迁移必须从原始会话重新开始：

```text
review item
  -> pet_session_id / codex_session_id
  -> original bounded session evidence
  -> complete v2 extraction and Gate
```

找不到原始会话或固定仓库 revision 时，记录 `legacy_evidence_unavailable`。

首轮范围：

1. 会话 `019f2891-4e16-7722-828b-74c1b9c23deb`；
2. 最近七天证据完整的 reviewable 会话；
3. 稳定后按周扩大回溯；
4. 新会话从功能启用后实时处理。

## 15. 安全与最小披露

- 只发送与候选主题直接相关的有界证据；
- 只使用仓库相对路径；
- 不发送完整 transcript、绝对路径、环境变量值、凭据或无关命令输出；
- snippet 受行数和字节数限制；
- 命中 secret-like 内容时中止该证据并进入 `needs_evidence`；
- Obsidian 保存稳定定位和必要摘要，不复制大段源码；
- 原始会话证据只留在本地 FastAPI 数据层。

## 16. 持久化、幂等与恢复

以下阶段分别使用 durable outbox/ledger：

- extraction；
- candidate delivery；
- review command；
- publish payload；
- publication receipt。

要求：

- 每阶段使用稳定幂等键；
- HTTP `200 + idempotent=true` 视为成功；
- 网络失败退避重试，业务校验失败不无限重试；
- sending/publishing 超过租约可安全重新认领；
- cursor 只在整批数据成功持久化后推进；
- 发布前校验 candidate revision、change set、Markdown hash、diff hash 和 Vault base revision；
- 已写入 Vault 但 receipt 丢失时，通过文件 hash 和 Git commit 恢复并补发 receipt；
- 所有失败保存 stage、error code、attempt count 和最后响应。

## 17. 功能开关与上线顺序

新增或明确以下独立开关：

- `CODEX_REVIEW_SNAPSHOT_V2_ENABLED`；
- `CODEX_DOMAIN_KNOWLEDGE_AUTO_EXTRACTION_ENABLED`；
- `DOMAIN_KNOWLEDGE_PUBLICATION_ENABLED`。

上线顺序：

1. 启用 snapshot v2，确认日常复盘不再出现知识操作；
2. 启用自动提炼，但只生成候选；
3. 检查样例和最近七天候选质量；
4. 完成一次 OpenClaw 内容审核和发布审核；
5. 最后启用 Obsidian publication。

## 18. 验收标准

### 18.1 v1

- snapshot v2 只包含 `review_candidates`；
- 所有 review candidate 均为 `knowledge_publishable=false`；
- daily review 不再创建 memory-wiki payload；
- OpenClaw 不显示“知识接受”。

### 18.2 v2 extraction

- 指定样例会话生成结构完整候选或明确 `no_knowledge`；
- 相同 source hash 不重复提炼；
- 伪造或未知 Evidence Reference 拒绝率为 100%；
- 缺 Concept Delta 时为 `needs_author_explanation`；
- 未提交代码引用时为 `needs_repository_revision`；
- 缺实现或验证证据时不得进入 `ready_for_review`。

### 18.3 review and publish

- OpenClaw 重启后候选、审核和 cursor 不丢失；
- content review 和 publication review 独立；
- accepted change set 与用户批准的内容、文件和 diff hash 完全一致；
- stale Vault base revision 阻止写入；
- Obsidian 写入或 Git push 失败时不得标记 published；
- receipt 重放幂等，不重复写文件。

## 19. 可观测性

至少记录：

- 扫描会话数；
- `no_knowledge`、`needs_evidence`、`needs_author_explanation`、
  `needs_repository_revision`、`ready_for_review` 数量；
- Skill 调用成功率和延迟；
- Gate reason code 分布；
- candidate delivery/review/publish 重试次数；
- 最终审核接受率和发布率；
- source hash 去重命中数；
- OpenClaw idempotent ack 数量。

## 20. 文档替代关系

`docs/plans/2026-07-15-codex-review-knowledge-extraction-upgrade.md` 中“增强 v1
prompt 并把 review item 变成可复用知识”的方案被本设计取代。

v1 prompt 仍可修复空 blocker 或无意义摘要，但不得承担 Domain Knowledge
synthesis。Domain Knowledge 的权威执行契约继续以本设计、
`docs/plans/2026-07-14-project-domain-knowledge-wiki-execution-spec.md` 和独立的
OpenClaw review/publish spec 为准。
