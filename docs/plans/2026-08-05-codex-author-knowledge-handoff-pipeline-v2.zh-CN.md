# Codex 作者知识交接与领域知识链路 v2 实施交接

日期：2026-08-05

状态：方案已由用户确认，待隔离实施

适用范围：Codex Desktop、Codex Stop Hook、Desktop Pet、FastAPI、OpenClaw、memory-wiki、Obsidian Git Vault

取代关系：

> 本文取代 `docs/plans/2026-08-04-codex-domain-knowledge-pipeline-handoff.zh-CN.md`
> 中关于 Review 来源/复盘层、FastAPI Topic Resolver、FastAPI Accepted Wiki Change Set
> 以及回跳式发布链的设计。旧文档只作为历史讨论输入，不再作为实施依据。

## 1. 已冻结的方案结论

本项目采用严格的单向知识收集链：

```text
Codex
  -> Pet
  -> FastAPI
  -> OpenClaw
  -> Obsidian
```

Codex Stop Hook 属于 Codex 边界内部的交接捕获机制，不是独立业务角色。

主链不得变形成：

```text
FastAPI -> OpenClaw -> FastAPI -> OpenClaw -> Obsidian
```

发布后的回执可以从 OpenClaw 异步镜像到 FastAPI，但只用于审计和状态观察，不允许
FastAPI 根据该回执重新向 OpenClaw 发起同一发布。

本方案同时冻结以下决定：

1. Codex 是知识候选的作者，OpenClaw 不再从普通 Review 摘要中替 Codex 生成知识正文。
2. 普通 Review `accept` 只确认并保存一次复盘事实，不产生知识候选，不写 Obsidian。
3. 只有形成稳定领域语义变化时，Codex 才输出知识交接；普通会话不输出空 marker。
4. 一次有效知识交接形成一个不可变的 `3+N` 作者交接包，且 `N >= 1`。
5. Pet 只扫描、排队、幂等运输，不判断知识价值。
6. FastAPI 是本地状态账本、仓库证据权威和确定性 Gate。
7. Vault 主题解析、两次用户审核、Accepted Wiki Change Set 冻结和发布均在 OpenClaw
   内部完成。
8. Obsidian 只保存审核通过的规范知识，不保存原始 handoff、marker、metadata 或
   candidate 作者原稿。
9. Review v1 派生知识、旧 outbox、Wiki payload、memory draft 和低价值历史记录不做
   回填或兼容迁移；原始 Session Evidence 和核心业务事实继续保留。
10. 当前损坏的 SQLite knowledge extraction outbox 必须先安全恢复或废弃，之后才能
    启用新链路。

## 2. 核心对象

### 2.1 作者交接包

存储位置：

```text
%CODEX_HOME%\knowledge-handoffs\<workspace-key>\<handoff-id>\
```

目录结构：

```text
<handoff-id>/
├── handoff.md
├── marker.yaml
├── metadata.json
├── candidates/
│   ├── <candidate-1>.md
│   └── <candidate-2>.md
└── .complete
```

职责：

| 文件 | 回答的问题 |
| --- | --- |
| `handoff.md` | 本次任务解决了什么、如何解决、验证到什么程度 |
| `marker.yaml` | 本包包含哪些知识候选及其作者提示 |
| `candidates/*.md` | 每条可独立审核、可复用的作者知识提案正文 |
| `metadata.json` | 交接来自哪个会话、工作区和捕获时仓库状态 |
| `.complete` | 全部校验、哈希和原子写入已经完成 |

包在 `.complete` 创建后不可修改。任何内容补充都必须生成新的 handoff package 和新的
candidate revision，禁止覆盖旧包。

### 2.2 知识候选

一条 candidate 对应一个独立的主要检索意图，并且必须能够被单独：

- 接受；
- 修改；
- 请求补证据；
- 暂缓；
- 拒绝；
- 与已有 Vault 主题匹配。

同一次会话中的不同知识身份必须拆开。例如 Desktop Pet 左键修复会拆成：

```text
candidates/pet-left-click-routing.md
candidates/webgpu-stage-rect-contract.md
```

candidate 是 `author_proposal`（作者提案），不是：

- 已验证知识；
- canonical knowledge；
- Obsidian 最终页面；
- 另一份会话修改流水账。

### 2.3 Candidate Revision 与 Evidence Revision

候选正文和仓库证据独立演进：

```text
candidate_revision
  = 作者知识主张的不可变版本

evidence_revision
  = FastAPI 在固定 Git revision 上解析出的证据版本
```

提交代码、推送分支或补充测试只增加 `evidence_revision`，不应静默改写原 candidate。
作者改变主张时才创建新的 candidate revision。

## 3. Codex 最终作者契约

### 3.1 触发条件

只有本次工作新增、修改或废弃稳定的以下领域语义时才输出机器载荷：

```text
concept
entity
relationship
rule
workflow
contract
gate
policy
architecture_decision
failure_classification
```

没有稳定知识变化时：

- 正常输出普通最终回复；
- 不输出 `no_knowledge`；
- 不创建 handoff package；
- 不让 FastAPI反复判断普通聊天是否是知识。

### 3.2 handoff.md 作者模板

人读正文固定优先回答“解决了什么”和“如何解决”：

```markdown
# Codex 会话交接：<任务名称>

## 1. 本轮结果
## 2. 原问题与影响
## 3. 根因
## 4. 解决方式
## 5. 修改前后行为
## 6. 验证结果
## 7. 范围边界与遗留风险
## 8. 可复用知识候选
```

约束：

1. 不按时间线复述整段会话；
2. 不堆砌全部修改文件；
3. 没有对应验证时不得写“已解决”；
4. 会话中出现过但本轮没有重新验证的历史需求不能标记为已完成；
5. 机器 ID、哈希和仓库快照不写进正文。

### 3.3 单 YAML 信封

Codex 最终回复的人读区域之后最多出现一个机器载荷区域。载荷使用 YAML 1.2 安全子集：

```yaml
kind: codex_knowledge_handoff_payload
schema_version: 1

marker:
  kind: codex_knowledge_marker
  schema_version: 1
  knowledge_candidates:
    - local_id: pet-left-click-routing
      title: Pet 左键输入路由
      knowledge_kind_hint: rule
      change_kind: introduce
      author_summary: 统一 Pet 左键点击与窗口拖动的输入语义。
      why_reusable: 相同输入竞争会在透明窗口、原生事件和渲染命中并存时重复出现。
      artifact:
        path: candidates/pet-left-click-routing.md
        media_type: text/markdown
      related_topic_hints:
        - Pet 输入路由
        - 点击与拖动分流
      term_changes: []
      evidence_hints: {}
      pending_verification: []

artifacts:
  - path: candidates/pet-left-click-routing.md
    media_type: text/markdown
    content: |-
      # Pet 左键输入路由

      ## 核心结论

      左键点击和窗口拖动必须由统一输入状态机分流。
```

Hook 只负责：

1. 找到固定载荷边界；
2. 安全解析一次 YAML；
3. 将人读区域原样保存为 `handoff.md`；
4. 将 `marker` 节点保存为 `marker.yaml`；
5. 将 `artifacts[].content` 保存为 candidate Markdown；
6. 注入真实来源 metadata；
7. 校验路径、引用、大小、数量和哈希；
8. 原子创建目录，最后写 `.complete`。

Hook 不负责：

- 改写作者正文；
- 判断知识是否正确；
- 创建 Evidence Reference；
- 决定 Obsidian 页面；
- 判断 create、update、merge 或 supersede。

### 3.4 marker.yaml 紧凑字段

每个 candidate 的允许字段为：

```yaml
local_id:
title:
knowledge_kind_hint:
change_kind:
author_summary:
why_reusable:
artifact:
related_topic_hints:
term_changes:
evidence_hints:
pending_verification:
```

不得出现：

```text
suggested_action
publication_action
topic_id
target_path
approval_status
canonical_status
handoff_id
Evidence Reference ID
```

`local_id` 只在当前包内唯一。`handoff_id` 由 Hook 创建；candidate ID 和 revision 由
FastAPI创建；`topic_id`、`change_set_id` 和 publication receipt ID 由 OpenClaw
发布阶段创建。

### 3.5 candidate 正文

candidate 使用无 frontmatter 的纯 Markdown。公共章节包括：

- 核心结论；
- 解决的问题；
- 定义与关系；
- 适用范围；
- 不适用范围与非例；
- 尚待验证；
- 重新审查条件；
- 证据定位提示。

不同 `knowledge_kind_hint` 增加专属章节：

| 类型 | 专属内容 |
| --- | --- |
| concept/entity/relationship | 身份、生命周期、关系方向、基数和易混淆概念 |
| rule/policy | 决策规则、不变量、例外、优先级和正反例 |
| workflow | 输入、前置条件、阶段、角色、输出、失败返回、重试恢复 |
| contract | 生产者、消费者、输入输出、兼容性、失败行为和验证方式 |
| gate | 检查对象、阻断条件、原因码、修正路线和通过标准 |
| architecture_decision | 背景、备选项、选择、取舍、后果和反转条件 |
| failure_classification | 症状、判定标准、根因范围、排除项、修复和预防 |

模板措辞、字段顺序和大小限制由实施者在不改变上述语义边界的前提下确定，不再逐字段
请求用户确认。

### 3.6 evidence_hints

Codex 只报告证据定位提示：

```yaml
evidence_hints:
  repository:
    - path: desktop-pet/electron/main.ts
      symbols:
        - handleNativeMouseMove
      supports:
        - 超过位移阈值后才开始拖动
  tests:
    - path: desktop-pet/electron/main.test.ts
      test_names:
        - stationary click does not start drag
      supports:
        - 静止点击与拖动互斥
  commands:
    - command: npm test -- main.test.ts
      reported_exit_code: 0
      supports:
        - 输入路由回归测试通过
  runtime_observations:
    - description: 在真实透明窗口中分别执行静止点击和拖动
      reported_result: 点击切换一次动作，拖动不切换动作
      supports:
        - 真实桌面输入完成分流
```

`reported_*` 始终只是作者报告，FastAPI必须独立认证或标记无法认证。

### 3.7 Stop Hook 失败策略

```text
没有载荷
  -> 正常结束，不创建包

载荷有效
  -> 原子落盘，创建 .complete，允许结束

已声明载荷但无效
  -> 阻止 Stop，返回精确错误给 Codex
  -> 不留下半成品和 .complete
```

采用 YAML 1.2 safe mode，禁止 aliases、anchors、custom tags、merge keys、重复键、绝对
candidate 路径和 `..` 路径穿越。

## 4. metadata.json 边界

`metadata.json` 只保存 Hook 可确定的来源与完整性事实：

```json
{
  "kind": "codex_knowledge_handoff_metadata",
  "schema_version": 1,
  "handoff_id": "kh_...",
  "captured_at": "2026-08-05T00:00:00Z",
  "source": {
    "session_id": "...",
    "turn_id": "...",
    "cwd": "D:\\workspace\\MMD project",
    "final_message_sha256": "..."
  },
  "workspace": {
    "workspace_key": "mmd-project"
  },
  "repository_capture": {
    "detected": true,
    "root": "D:\\workspace\\MMD project",
    "head_commit": "...",
    "branch": "...",
    "dirty": true,
    "status_sha256": "..."
  },
  "artifacts": []
}
```

捕获时 `head_commit` 不是正式证据。绝对路径只允许在 Hook、Pet、FastAPI 本机边界中
使用；发送给 OpenClaw 时必须删除。

## 5. Pet 职责

Pet 是可靠运输器，不是知识 Agent。

负责：

1. 启动时扫描全部 `.complete` 包；
2. 运行时监听新增包；
3. 校验 manifest hash；
4. 使用 `handoff_id + package_sha256` 幂等上传；
5. FastAPI离线时保留本地队列并重试；
6. 收到持久化 ACK 后记录已送达；
7. 将 Git commit/checkout/push 事件作为加速提示发给 FastAPI。

不负责：

- 修改 candidate；
- 认证 Git 证据；
- 执行 Gate；
- 查询 Obsidian；
- 决定知识主题；
- 删除已经确认送达的原始包。

首期不要求 Pet 提供复杂知识 UI。状态观察可以复用现有诊断面板或日志。

## 6. FastAPI 职责

FastAPI 是 OpenClaw 之前的本地权威控制面。

### 6.1 持久化对象

建议新增或重构为：

```text
knowledge_handoff_package
knowledge_candidate_revision
knowledge_evidence_revision
knowledge_gate_result
knowledge_openclaw_delivery
knowledge_publication_receipt_mirror
```

### 6.2 接收和认证

1. 校验 3+N 包、文件清单和 SHA-256；
2. 不可变保存原始包；
3. 为每条 candidate 创建独立 revision；
4. 在固定 Git revision 上解析仓库文件、符号和测试；
5. 创建正式 Evidence Reference；
6. 检查 evidence commit 是否可达配置的 durable workspace ref；
7. 运行确定性 Gate；
8. 只向 OpenClaw发送候选级有界审核包。

FastAPI不执行 Vault Topic Resolution，不决定 Obsidian 目标路径，也不创建或执行
Accepted Wiki Change Set。

### 6.3 Gate 状态

```text
needs_repository_revision
needs_durable_revision
needs_evidence
needs_author_explanation
ready_for_review
delivered_to_openclaw
```

Gate 只检查是否具备进入下一阶段的最低条件，不判断该设计是否优秀。

处理路线：

- `needs_repository_revision`：等待提交并自动重新解析；
- `needs_durable_revision`：等待 commit 进入 workspace 配置的 durable ref；
- `needs_evidence`：形成有界补证据说明；
- `needs_author_explanation`：形成有界作者补充说明；
- `ready_for_review`：发送 OpenClaw 内容审核。

用户要求补充时，必须新建一个有明确范围的 Codex 任务，不能自动恢复旧会话，也不能
覆盖原 candidate。

### 6.4 Commit 后协调

采用：

```text
Git event hint
  + Pet 加速运输
  + FastAPI 周期性 reconciliation 兜底
```

Git Hook 只提供提示。FastAPI后台 Worker 定期重新检查处于
`needs_repository_revision` 或 `needs_durable_revision` 的记录，因此提示丢失也不会
永久卡住。

durable ref 必须按 workspace 显式配置。未配置时禁止自动把当前分支或 `origin/HEAD`
当作发布依据。

## 7. OpenClaw 与 Obsidian

### 7.1 单任务双批准

同一个 OpenClaw审核任务包含两个不可跳过的批准点：

```text
内容审核
  -> 用户确认作者知识主张是否成立

Vault 只读查询与 Topic Resolution
  -> 生成 create/update/merge/supersede 精确提案

发布审核
  -> 用户确认目标文件、完整 Markdown、MOC/关系更新和 full diff

冻结 Accepted Wiki Change Set
  -> exact apply
  -> lint
  -> Git commit/push
  -> Publication Receipt
```

中途可以退出后继续，但两次批准不得合并为一次模糊的“接受”。

### 7.2 Change Set 所有权

Accepted Wiki Change Set 由 OpenClaw 在第二次审核通过后冻结，并由同一 OpenClaw
业务节点内部的 Publisher 原样执行。

Publisher 不得：

- 临时改写正文；
- 更换目标文件；
- 多修改未批准页面；
- 重新决定 create/update/merge/supersede；
- 用新生成内容替换用户批准版本。

### 7.3 memory-wiki 与 Obsidian

最终落盘位置是 Obsidian Vault。

memory-wiki 是 OpenClaw 查询和发布 Obsidian 的能力接口，不是另一个知识目的地，也
不是独立的 Topic Resolver。

OpenClaw Topic Resolution 可以复用 memory-wiki 已有的：

- 标题和路径查询；
- frontmatter；
- aliases；
- 正文读取；
- wikilinks/backlinks；
- base hash；
- exact apply、lint、commit 和 push。

### 7.4 对 FastAPI 的回执

OpenClaw 发布后可以异步发送：

- 两次审核结果摘要；
- `change_set_id` 和 hash；
- 最终文件 hash；
- Vault Git commit；
- push 结果；
- Publication Receipt。

FastAPI只保存审计镜像，不根据回执重新进入发布路径。

## 8. Review v1 的切断策略

普通 Review 新语义：

```text
accept
  = 用户确认本次复盘描述正确
```

它不再代表：

```text
值得长期保存
知识发布授权
Obsidian 写入授权
```

新运行时应停止调用或退出主链：

```text
codex_review_memory
codex_review_memory_draft
codex_review_memory_wiki_payload
codex_knowledge_extraction_outbox
Review -> OpenClaw knowledge synthesis
Review accept -> memory-wiki
```

保留：

- Session Evidence；
- 用户 Review 决定；
- 核心会话、消息、账户和业务数据；
- 必要审计事实。

不实施：

- 历史 Review 记录回填；
- v1 candidate 到 v2 candidate 的字段迁移；
- 旧 Wiki source page 到 canonical knowledge 的自动晋升；
- 兼容读取器。

## 9. SQLite P0

当前 `api/data/sqlite/trace.db` 的 `codex_knowledge_extraction_outbox` 所在页面已检测到
损坏。新链路启用前必须：

1. 停止 FastAPI、Pet 和所有写库进程；
2. 备份 DB、WAL 和 SHM；
3. 只在副本上执行恢复实验；
4. 新建干净数据库 schema；
5. 迁移可读的核心业务表和 Session Evidence；
6. 有证据地废弃旧 Review v1 派生表和损坏 outbox；
7. 执行 `PRAGMA quick_check` 和 `PRAGMA integrity_check`；
8. 核心 API 烟测通过后再切换；
9. 保留明确回滚路径；
10. 在完整链路验收前保持 knowledge feature flags 关闭。

## 10. 当前代码映射

可复用：

```text
api/app/services/domain_knowledge_repository_resolver.py
api/app/services/domain_knowledge_gate.py
api/app/services/openclaw_client.py
api/app/main.py 的后台 Worker 生命周期
```

需要替换或退出新主链：

```text
api/app/services/codex_knowledge_extraction.py
api/app/services/codex_review_memory_*.py
api/app/services/codex_review_wiki_payload.py
api/app/services/domain_knowledge_topic_identity.py 的 FastAPI 主题决策职责
api/app/services/domain_knowledge_review_ledger.py 的 FastAPI 审核所有权
api/app/services/domain_knowledge_control_plane.py 的回跳式发布流程
api/app/routes/codex_knowledge.py 的 Review 抽取接口
```

现有 `domain_knowledge_control_plane.py` 中的候选投递、审核命令轮询、FastAPI Change
Set 和再次发布不能直接沿用，因为它会形成 OpenClaw 前后回跳。

## 11. 实施票据

### KH-01：契约文档与 Stop Hook

交付：

- schema；
- 3+N 示例；
- YAML 安全解析器；
- Hook validator；
- 原子写入和 `.complete`；
- 安装/启用说明。

Gate：

- 无载荷；
- 单候选；
- 多候选；
- 非法 YAML；
- 重复键；
- 路径穿越；
- 引用缺失；
- 中途写入失败；
- 重复 Stop；
- candidate 内嵌代码围栏。

### KH-02：Pet Scanner 与运输

交付：

- 启动补扫；
- 文件监听；
- 幂等上传；
- 离线队列；
- ACK；
- Git 事件提示；
- 重启恢复。

### KH-03：FastAPI 接收、Evidence、Gate 与 reconciliation

交付：

- 新 API；
- 新持久化模型；
- immutable package/candidate revision；
- Repository Resolver 接线；
- durable ref 配置；
- reconciliation Worker；
- Gate；
- OpenClaw bounded delivery。

### KH-04：OpenClaw 双审核与 Obsidian Publisher

交付：

- 内容审核；
- memory-wiki Vault 查询；
- Topic Resolution；
- 精确 diff；
- 发布审核；
- OpenClaw-owned Accepted Wiki Change Set；
- exact apply/lint/commit/push；
- receipt mirror。

### KH-05：旧链切断、SQLite 恢复和端到端启用

交付：

- Review accept 去知识副作用；
- v1 派生链停用；
- 新数据库恢复；
- feature flag 分阶段启用；
- 真实 Codex -> Obsidian 端到端证书。

## 12. 实施隔离要求

当前主工作区存在大量未提交的 Reze、Pet 和 MMD 改动。实施会话必须：

1. 完整阅读根目录 `AGENTS.md`；
2. 检查 `git status --short` 和全部 worktree；
3. 选择已确认的干净 base commit；
4. 在 `C:\w\<短票据标识>` 创建独立分支和 worktree；
5. 不使用 Codex 默认长路径 worktree；
6. 不复制主工作区脏改动作为 base；
7. 每张实施票据使用独立短路径和独立 `codex/` 分支；
8. 不自动清理或删除用户已有 worktree。

## 13. 缺陷、TODO 与验收证据

| 当前缺陷 | TODO | 验收证据 |
| --- | --- | --- |
| Review accept 隐式进入知识链 | 切断 Review 与 Knowledge 触发 | accept 后只有 Review 决定，无 knowledge outbox/candidate/wiki payload |
| OpenClaw 从 Review 摘要生成知识 | Codex 直接生成 3+N 包 | 真实 Stop 生成两个可读、独立 candidate |
| Marker 同时承担索引和正文 | marker 与 candidate 分离 | marker 紧凑，candidate 可单独审核 |
| FastAPI 与 OpenClaw 回跳 | Change Set 和发布归 OpenClaw | 网络与状态日志不存在二次前向投递 |
| 未提交代码无法固定证据 | candidate/evidence revision 分离 | dirty -> local commit -> durable ref 状态正确转换 |
| Git 提示可能丢失 | 周期性 reconciliation | 删除一次提示后仍能自动恢复 |
| SQLite 旧 outbox 损坏 | 新库恢复并废弃旧派生表 | integrity check 为 `ok`，核心 Session Evidence 可读 |
| 原始包可能污染 Vault | 只发布 canonical output | 测试 Vault 不包含 handoff、marker、metadata 或 candidate 原稿 |

## 14. 完成标准

只有以下全部成立，才能声明链路完成：

1. 真实 Codex 最终回复产生合法 3+N 包；
2. 无知识变化的普通会话不产生空包；
3. Pet 离线、重启和重复扫描不丢包、不重复；
4. FastAPI 保存 immutable package 和 candidate revision；
5. 未提交、仅本地提交、durable commit 的状态转换正确；
6. Repository Resolver 创建固定版本 Evidence Reference；
7. Gate 的阻断状态和修正路线正确；
8. OpenClaw 同一任务完成两个独立批准；
9. OpenClaw 冻结并原样执行 Accepted Wiki Change Set；
10. Obsidian 只出现审核后的 canonical knowledge；
11. Vault stale base hash、lint 失败和 push 失败均不会标记 published；
12. Publication Receipt 可审计且不会造成 FastAPI 回跳发布；
13. Review accept 不再触发任何知识或 Wiki 副作用；
14. SQLite 完整性检查为 `ok`；
15. `docs/architecture/current-system-topology.md` 与最终运行系统同步；
16. 提供一个真实 Codex -> Pet -> FastAPI -> OpenClaw -> Obsidian 端到端验收证书。

单元测试、fixture、shadow candidate 或模拟 Wiki 文件不能替代真实端到端验收。

## 15. 新实施会话首条指令

```text
阅读：

1. AGENTS.md
2. docs/plans/2026-08-05-codex-author-knowledge-handoff-pipeline-v2.zh-CN.md
3. docs/architecture/current-system-topology.md
4. 文档中列出的现有 Domain Knowledge、OpenClaw 和 memory-wiki 规格

本方案已由用户确认，不再重新讨论已冻结的角色边界和 3+N 作者契约。

先只读复核当前工作区、Git worktree、feature flags、SQLite 损坏状态和相关代码断点。
然后按 AGENTS.md 创建 C:\w\... 短路径独立 worktree。

实施顺序为 KH-01 -> KH-02 -> KH-03 -> KH-04 -> KH-05。
首轮只开始 KH-01；完成对应测试和 Gate 后汇报，不得直接在当前脏主工作区修改，
不得在 SQLite 恢复和真实端到端验收前启用 knowledge feature flags，也不得把计划
写成已实现。
```

## 16. 当前结论边界

已经完成：

- 多轮架构澄清；
- 作者交接包、marker、candidate、metadata 和 Hook 边界确认；
- Pet、FastAPI、OpenClaw、memory-wiki、Obsidian 权责确认；
- 严格单向数据流确认；
- 双批准点确认；
- Review v1 干净切断策略确认；
- 实施票据和验收标准确认。

尚未实施或验证：

- Stop Hook 和 YAML validator；
- Pet 扫描与运输；
- FastAPI 新持久化和编排；
- OpenClaw 新审核工作流；
- Obsidian exact publication；
- SQLite 恢复；
- 真实端到端。

本文是已确认的实施交接与验收契约，不是完成证书。
