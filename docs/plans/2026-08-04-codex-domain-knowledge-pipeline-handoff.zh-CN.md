# Codex 复盘与领域知识链路实施交接

日期：2026-08-04

状态：待新会话实施

适用范围：`desktop-pet`、FastAPI、OpenClaw Control Plane、memory-wiki、Obsidian Git Vault

## 1. 新会话任务

把当前已经运行的 Codex Review 复盘链，与尚未闭环的 Domain Knowledge v2
领域知识链整理为两条职责清晰、可程序化验收的工作流，并完成以下目标：

1. `desktop-pet` 能从 Codex 会话中提取固定 marker 内的结构化知识交接；
2. FastAPI 能保存显式领域术语变化和概念变更说明（Concept Delta）；
3. Knowledge Extraction 不再停在 `codex_session_knowledge`，而是继续经过
   Repository Evidence Resolver、Domain Knowledge Gate、Topic Identity Resolver、
   candidate revision persistence 和 durable delivery；
4. 普通 Review Candidate 不再直接冒充 canonical domain knowledge；
5. 用户确认的复盘可以进入 Obsidian 的来源/复盘层，稳定知识只能通过 Domain
   Knowledge v2 双重审核进入 canonical Domain Wiki；
6. 发布必须使用 exact Accepted Wiki Change Set，并以 Publication Receipt 闭环；
7. 修复或安全迁移当前损坏的 SQLite knowledge extraction outbox 后，才允许启用自动抽取。

本任务不是重新写一个“总结 prompt”。核心工作是接通结构化采集、证据解析、确定性
Gate、主题身份和精确发布之间的编排。

## 2. 新会话启动顺序

新会话开始后按以下顺序执行：

1. 完整阅读根目录 `AGENTS.md`；
2. 阅读本交接文档；
3. 阅读：
   - `docs/architecture/current-system-topology.md`
   - `docs/plans/2026-07-14-project-domain-knowledge-wiki-execution-spec.md`
   - `docs/plans/2026-07-14-openclaw-project-domain-knowledge-review-publish-spec.md`
   - `docs/superpowers/specs/2026-07-15-codex-review-domain-knowledge-separation-design.md`
   - `docs/plans/2026-06-09-openclaw-memory-wiki-obsidian-execution-spec.md`
4. 加载并遵守 `handing-off-durable-knowledge` Skill，尤其是 marker、schema 和
   Evidence Reference ID 的权责限制；
5. 检查 `git status --short`，不要覆盖当前 Reze/MMD 渲染相关脏改动；
6. 按根目录 `AGENTS.md` 的 Windows 短路径约定，从已确认的干净 base commit 创建
   独立 worktree，例如：

   ```powershell
   git worktree add -b "codex/domain-knowledge-pipeline" "C:\w\dk-pipeline" "<clean-base-ref>"
   ```

7. 先完成 P0 SQLite 诊断与安全恢复，再实施会写入 knowledge outbox 的功能。

不得以主工作区当前脏状态作为新实现分支的 base，也不得自动清理或删除用户现有改动。

## 3. 已核实的当前状态

### 3.1 当前实际运行链

```text
Codex rollout JSONL
  -> desktop-pet full streaming scanner
  -> bounded metadata.facts / work_items / methods
  -> POST /desktop-pet/sessions
  -> desktop_pet_sessions
  -> codex_review_evidence_pack
  -> OpenClaw review synthesis
  -> codex_review_items
  -> daily review snapshot
  -> accept / edit_accept / ignore / snooze
  -> codex_review_memory
  -> codex_review_memory_wiki_payload
  -> OpenClaw memory-wiki
  -> Obsidian source page
```

这条链适合工作总结、踩坑、决策、阻塞和 Runbook 类复盘，但当前产物仍是按
日期/会话组织的 source page，不是带稳定 `topic_id` 的 canonical Domain Note。

### 3.2 当前配置

`api/.env` 当前确认：

```text
CODEX_OPENCLAW_REVIEW_ENABLED=true
CODEX_KNOWLEDGE_EXTRACTION_ENABLED=false
CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true
CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID=mmd-companion
```

`DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED` 未配置，当前使用默认值 `false`。

不得直接打开后两个 knowledge feature flag。当前 extraction outbox 存在数据库损坏，
且自动 v2 编排尚未实现。

### 3.3 运行时数据基线

2026-08-04 只读检查结果：

| 对象 | 当前状态 |
| --- | --- |
| FastAPI | `http://127.0.0.1:8100/healthz` 返回 `ok` |
| `desktop_pet_sessions` | 182 条 |
| 最近 Pet 会话上报 | 2026-07-27 约 04:00，Asia/Shanghai |
| Review outbox | 446 `sent`、72 `failed`、2 `sending` |
| Review draft | 753 条 |
| `codex_review_memory` | 1 条，`export_status=synced` |
| `codex_session_knowledge` | 5 条 |
| `codex_concept_deltas` | 0 条 |
| Domain Knowledge Candidate | 1 条手工 `manual` shadow candidate |
| Candidate delivery | 1 条，OpenClaw 已 `accepted` |
| Accepted Wiki Change Set | 0 条 |
| Publication Receipt | 0 条 |

检查时没有发现正在运行的 Electron Pet 主进程，只有 desktop-pet 的 Vite 开发进程。
因此 FastAPI 虽然仍在每天提交 Review snapshot，但没有持续采集新的 Pet/Codex 会话。

### 3.4 SQLite P0 风险

数据库：

```text
api/data/sqlite/trace.db
```

大小约 939 MB。只读执行：

```sql
PRAGMA quick_check(1);
```

返回：

```text
Tree 19 page 174806 cell 0: 2nd reference to page 174780
```

`sqlite_master.rootpage=19` 对应：

```text
codex_knowledge_extraction_outbox
```

对该表执行状态聚合会报：

```text
database disk image is malformed
```

表中约有 6 条记录。FastAPI health 正常不代表该 outbox 可安全使用。

P0 处理要求：

1. 先停止 FastAPI、Pet 和其他可能写入 `trace.db` 的进程；
2. 对原始 DB 创建只读、带时间戳的完整备份；
3. 所有恢复实验只针对副本或新数据库；
4. 优先选择“新库建 schema + 可读表迁移”的方式，不能在原库上冒险修改；
5. 明确记录六条损坏 outbox 任务的处理策略：恢复、重建、重新入队或有证据地废弃；
6. 恢复后执行完整 `PRAGMA quick_check`/`integrity_check`；
7. 新库通过后再切换运行时；
8. 不因本任务修复 knowledge outbox 而丢失消息、账户、会话、审批或其他业务表。

## 4. 已确认的断点

### 4.1 Pet 没有解析知识交接 marker

当前 `desktop-pet/electron/codexSessionFiles.ts` 只产生：

- user/assistant messages；
- function/tool call summaries；
- work items；
- methods；
- changed files；
- checks、errors、approvals。

它没有把 `codex-knowledge-handoff` 固定 marker 解析成结构化字段。当前 marker 内容最多
作为普通 assistant message 被保存，可能被限长或在 transport trimming 时丢失。

### 4.2 Concept Delta Collector 只存在于测试

`api/app/services/domain_knowledge_concept_delta.py` 已实现显式 Concept Delta 保存和
缺失作者解释检测，但生产代码没有调用 `collect_concept_deltas()`。

当前调用只出现在：

```text
api/tests/test_domain_knowledge_persistence.py
```

### 4.3 Knowledge worker 停在 raw synthesis

当前：

```text
codex_knowledge_extraction_outbox
  -> OpenClaw synthesis
  -> codex_session_knowledge
```

尚未继续进入：

```text
Concept Delta Collector
  -> fixed repository revision
  -> Repository Evidence Resolver
  -> Domain Knowledge Gate
  -> Topic Identity Resolver
  -> immutable candidate revision
  -> candidate delivery
```

现有 Resolver、Gate、Topic Identity、review ledger 和 control-plane transport 已实现，
但缺少生产编排模块。

### 4.4 Review 与 canonical knowledge 仍混流

当前 daily snapshot 仍为 schema v1，并外发 `learning_candidates`。当前
`accept/edit_accept` 会创建 `codex_review_memory`，然后发布日期型 Wiki source page。

目标是：

```text
Review Candidate
  = “这次发生了什么”

Domain Knowledge Candidate
  = “项目长期应当知道什么”
```

普通 Review accept 可以形成复盘来源页，但不能直接创建或覆盖 canonical Domain Note。

## 5. 目标拓扑

### 5.1 共享采集入口

```text
Codex rollout JSONL
  -> desktop-pet scanner
  -> Session Evidence
       session
       facts
       work_items
       methods
       domain_term_changes
       concept_deltas
  -> FastAPI ingestion
```

### 5.2 Review 复盘链

```text
Session Evidence
  -> Review Evidence Pack
  -> OpenClaw review synthesis
  -> Review Candidate
  -> human review
  -> accepted Retrospective / source page
```

该链回答：

- 做了什么；
- 哪些步骤失败；
- 如何修正；
- 还有什么待办；
- 是否值得晋升为稳定知识候选。

复盘页不能直接承担稳定领域定义。

### 5.3 Domain Knowledge v2 主链

```text
Session Evidence
  + explicit Concept Delta
  + fixed-revision Repository Evidence
  -> OpenClaw semantic synthesis
  -> untrusted Domain Knowledge Draft
  -> Evidence Reference reconciliation
  -> deterministic Domain Knowledge Gate
  -> Topic Identity Resolver
  -> immutable Domain Knowledge Candidate revision
  -> durable OpenClaw candidate delivery
  -> content review
  -> publication review
  -> exact Accepted Wiki Change Set
  -> memory-wiki preflight/apply/lint
  -> Git commit/push
  -> Obsidian canonical Domain Note
  -> Publication Receipt
```

### 5.4 失败和修正路线

```text
缺 Concept Delta
  -> needs_author_explanation
  -> 请求 Codex 或用户补充

缺实现/测试/验证证据
  -> needs_evidence
  -> Resolver 补证据后重新 Gate

只有未提交代码
  -> needs_repository_revision
  -> 提交后绑定固定 revision

主题定义冲突
  -> conflict
  -> 零文件写入
  -> 用户选择 keep/update/merge/supersede

Vault base hash 变化
  -> 拒绝 stale proposal
  -> 重新生成 proposal 和完整 diff

lint/commit/push 失败
  -> 不得标记 published
  -> 保留失败阶段和可重试状态
```

## 6. 相关方与权责

| 相关方 | 负责 | 不负责 |
| --- | --- | --- |
| 用户/项目负责人 | 最终术语、内容、冲突和发布确认 | 手工生成底层 hash 或 locator |
| Codex | 完成任务；输出领域术语变化、Concept Delta、evidence hints | 创建 Evidence Reference ID；直接发布 Wiki |
| desktop-pet | 扫描、解析 marker、脱敏、限长、上传 | 真实性判断、主题合并、发布 |
| FastAPI | 状态事实源、持久化、幂等、Resolver、Gate、Topic Identity、ledger | 让未审核内容绕过 OpenClaw |
| Repository/Git | 固定 revision 的 Contract、代码、测试和 Git 事实 | 用未提交瞬时状态充当正式证据 |
| OpenClaw Knowledge Skill | 基于已有证据做语义综合 | 编造路径、行号、commit、测试结果 |
| OpenClaw Control Plane | 审核会话、proposal、命令队列、发布编排 | 直接读取本机 rollout 或仓库 |
| memory-wiki | exact apply、lint、MOC/backlink/dashboard | 接收未批准 candidate |
| Obsidian Vault | 人和 LLM 使用的规范知识表面 | 审核状态或运行事实源 |
| Git Remote | Vault 历史、同步和发布审计 | 自动解决无关脏改动或冲突 |

关键不变量：

1. Pet 只采集，不判断；
2. Codex 只提供作者解释和证据提示，不创建 Evidence Reference ID；
3. FastAPI Repository Resolver 才能创建正式 Evidence Reference；
4. OpenClaw Skill 只生成不可信草稿；
5. Gate 和 Topic Identity 由 FastAPI 确定性执行；
6. 用户只在 OpenClaw 完成人工审核；
7. memory-wiki 只发布 FastAPI 持久化的 exact Accepted Wiki Change Set；
8. Obsidian 不是会话数据库，也不是审核状态源。

## 7. Obsidian 目标结构

建议使用三层知识结构：

```text
projects/mmd-companion/
├── domain-knowledge-map.md
├── domains/
│   ├── rendering/
│   ├── motion-generation/
│   ├── codex-integration/
│   └── knowledge-pipeline/
├── retrospectives/
│   └── YYYY/
├── solution-evolution/
├── decisions/
├── sources/
│   └── codex-sessions/
└── _evidence/
```

语义分层：

1. 来源层：原始会话的有界证据和 provenance；
2. 复盘层：经过确认的工作总结、事故经过、踩坑和方案讨论；
3. Canonical Domain Wiki：稳定概念、规则、流程、Contract、Gate 和架构决策；
4. 综合层：MOC、方案演进、决策时间线、踩坑索引。

一个稳定 `topic_id` 对应一个 canonical Note。标题和路径可以变化，身份不能随日期、
session ID 或标题变化。

## 8. 分阶段实施票据

### 票据 P0：SQLite 安全恢复

目标：得到完整性检查通过的新数据库，并保留所有可恢复业务数据。

交付：

- 原库备份位置；
- 恢复/迁移脚本；
- 表级迁移结果；
- 六条 extraction outbox 记录的处理清单；
- 完整 integrity 报告；
- 运行时切换与回滚说明。

Gate：

```text
PRAGMA quick_check;
```

返回 `ok`，且现有 FastAPI 核心 API 烟测通过。

### 票据 P1：Pet marker 解析和上传契约

主要文件：

```text
desktop-pet/electron/codexSessionFiles.ts
desktop-pet/electron/codexSessionFiles.test.ts
api/app/routes/desktop_pet.py
api/tests/test_desktop_pet_routes.py
api/tests/test_codex_review_fact_extractor.py
```

要求：

1. 只接受唯一、完整、合法的固定 marker JSON；
2. 从 assistant output 中提取，但不把整个 transcript 上传；
3. 注入或覆盖真实 workspace/session identity，不能信任模型自填 session ID；
4. `source_event_ids` 保留为空数组或只使用 scanner 真实事件 ID；
5. 非法 marker 记录 bounded diagnostic，不阻断普通 Review 上报；
6. payload 限长与 secret redaction 同时覆盖 handoff 字段；
7. 相同 session + payload hash 幂等。

Gate：

- marker 正例；
- marker 缺失；
- 多 marker；
- 非法 JSON；
- 超限；
- secret redaction；
- 重复扫描；
- 普通 Review session 不受影响。

### 票据 P2：FastAPI 领域知识编排

主要文件：

```text
api/app/services/codex_knowledge_extraction.py
api/app/services/domain_knowledge_concept_delta.py
api/app/services/domain_knowledge_repository_resolver.py
api/app/services/domain_knowledge_gate.py
api/app/services/domain_knowledge_topic_identity.py
api/app/services/domain_knowledge_control_plane.py
api/app/db/store.py
api/app/main.py
```

建议形成一个小接口、深实现的编排模块。接口只接收稳定 session identifier 或标准化
Session Evidence，内部隐藏：

```text
collect deltas
fix revision
resolve evidence
synthesize
reconcile
gate
resolve topic
persist revision
enqueue delivery
```

要求：

1. `no_knowledge` 也持久化轻量负向判定，避免反复调用 LLM；
2. source hash 包含 parser/facts/prompt/Skill/repository/concept delta revision；
3. Skill 输出不能直接设置 Gate、发布状态、Wiki path 或 locator；
4. unknown Evidence Reference 100% 拒绝；
5. `needs_*` 状态可保存但不能 delivery 到发布路径；
6. candidate revision 不可变；
7. delivery durable、幂等、可恢复。

Gate：

- 完整候选；
- `no_knowledge`；
- 缺 Concept Delta；
- 缺实现证据；
- 缺测试/验证证据；
- 未知 ref；
- 同 source hash 去重；
- 输入改变后 candidate revision 增加；
- restart 后 pending delivery 可继续处理。

### 票据 P3：Review 与 Domain Knowledge 严格分流

主要文件：

```text
api/app/services/openclaw_control_plane.py
api/app/routes/codex_review.py
api/app/services/codex_review_wiki_payload.py
api/app/db/store.py
```

要求：

1. Review snapshot 升级为明确的 review candidate 语义；
2. 每条 Review Candidate 显式 `knowledge_publishable=false`；
3. 普通 Review accept 不创建 canonical Domain Note；
4. 用户确认的复盘可以创建 retrospective/source artifact；
5. “晋升为知识候选”是显式动作，并重新经过完整 v2 Resolver/Gate；
6. 保留旧 `codex_review_memory`、版本和 source pages 作为兼容历史；
7. 不静默改写历史审核事实。

Gate：

- Review accept 不创建 v2 canonical candidate；
- Review snapshot 不出现误导性的知识发布操作；
- explicit promotion 生成 `legacy_import` 或 `manual` v2 candidate；
- 历史 Review API 和数据仍可读取。

### 票据 P4：Obsidian canonical publication

主要文件：

```text
api/app/services/domain_knowledge_review_ledger.py
api/app/services/domain_knowledge_control_plane.py
api/app/models/domain_knowledge.py
```

OpenClaw 侧按：

```text
docs/plans/2026-07-14-openclaw-project-domain-knowledge-review-publish-spec.md
```

实施。

要求：

1. 内容审核和发布审核均通过后才创建 change set；
2. change set 保存 exact Markdown、affected files、full diff 和 hashes；
3. create/update/merge/supersede 必须经过 base-hash preflight；
4. conflict proposal 写零个文件；
5. memory-wiki apply 和 lint 通过后再 commit；
6. Git push 成功并返回 receipt 后，FastAPI 才标记 published；
7. 同一 publish ticket 重放不能产生第二次写入或 commit；
8. canonical Note 使用稳定 `topic_id`，并更新 MOC/relations。

Gate：

- 一个真实 create；
- 一个真实 update；
- stale base hash；
- lint failure；
- push failure；
- receipt ACK 丢失后恢复；
- repeated payload 幂等；
- published hash 等于 approved hash。

### 票据 P5：真实端到端与历史回填

先用一个新的真实 Codex 会话跑通：

```text
Codex handoff
  -> Pet upload
  -> Concept Delta persistence
  -> Repository Evidence
  -> Gate
  -> candidate delivery
  -> OpenClaw 双重审核
  -> Accepted Wiki Change Set
  -> Obsidian
  -> receipt
```

完整通过后，再对最近七天、证据完整的 reviewable sessions 做 bounded backfill。

不得把历史 `codex_review_items` 直接字段转换为 v2 candidate。回填必须回到原始
session evidence 并重新执行 v2 流程。

## 9. 相关测试

desktop-pet：

```text
desktop-pet/electron/codexSessionFiles.test.ts
```

FastAPI：

```text
api/tests/test_desktop_pet_routes.py
api/tests/test_codex_review_fact_extractor.py
api/tests/test_codex_knowledge_extraction.py
api/tests/test_domain_knowledge_contracts.py
api/tests/test_domain_knowledge_persistence.py
api/tests/test_domain_knowledge_repository_resolver.py
api/tests/test_domain_knowledge_gate.py
api/tests/test_domain_knowledge_topic_identity.py
api/tests/test_domain_knowledge_review_ledger.py
api/tests/test_domain_knowledge_control_plane.py
api/tests/test_domain_knowledge_control_plane_worker.py
api/tests/test_openclaw_control_plane_sync.py
api/tests/test_codex_review_daily_summary.py
api/tests/test_codex_review_decision_routes.py
api/tests/test_codex_review_wiki_payload.py
```

测试命令应根据项目现有 package/pytest 配置确定。最终报告必须列出实际执行命令、
通过数、失败数和未覆盖范围，不能只写“测试通过”。

## 10. 完成标准

只有以下全部成立，才能表述“链路已完成”：

1. 新真实 Codex 会话中的 marker 被 Pet 稳定解析；
2. `codex_concept_deltas` 出现真实、幂等的记录；
3. Repository Resolver 生成固定 revision 的正式 Evidence Reference；
4. 候选经过确定性 Gate，状态与缺失项一致；
5. 相同主题跨会话更新同一 `topic_id`；
6. Review Candidate 没有绕过 v2 进入 canonical Wiki；
7. OpenClaw 显示内容、动作、目标文件和完整 diff；
8. FastAPI 创建 exact Accepted Wiki Change Set；
9. memory-wiki apply/lint/commit/push 全部成功；
10. FastAPI 收到并验证 Publication Receipt；
11. Obsidian 可以通过 MOC、aliases 和 relations 找到该知识；
12. SQLite 完整性检查为 `ok`；
13. 重启和幂等重放不会产生重复 candidate、page、decision 或 commit；
14. `docs/architecture/current-system-topology.md` 与实际运行配置同步更新。

单元测试、fixture 或 shadow candidate 不能替代真实端到端验收。

## 11. 当前结论边界

已经验证：

- 当前 Review 链的实际代码和运行配置；
- Pet scanner 的 bounded facts 行为；
- Knowledge worker 的当前终点；
- Concept Delta Collector 未接入生产；
- v2 Resolver/Gate/Topic Identity/ledger/control-plane 模块存在；
- 当前 feature flags；
- 当前 SQLite knowledge outbox 损坏；
- 当前数据库中没有完整 v2 publication receipt。

尚未验证：

- marker 解析实现；
- 自动 v2 编排；
- Review 分流改造；
- 新 Obsidian 三层目录和 MOC 更新；
- 真实双重审核；
- exact change-set 的最终 memory-wiki 发布；
- Git push 和 receipt 全闭环。

因此本文件是实施交接和验收契约，不是完成证书。

## 12. 新会话建议首条指令

可在新会话中直接使用：

> 阅读 `docs/plans/2026-08-04-codex-domain-knowledge-pipeline-handoff.zh-CN.md`
> 和其中列出的权威文档。先只读核验 P0 SQLite 状态、当前 feature flags、Pet marker
> 缺口以及 v2 编排断点，然后按 Windows 短路径约定创建独立 worktree。先完成 P0
> 和 P1，运行对应 Gate 并汇报证据；不要修改或覆盖主工作区现有 Reze/MMD 脏改动，
> 不要在数据库恢复和真实端到端验收前启用自动 Knowledge Extraction 或声称链路完成。
