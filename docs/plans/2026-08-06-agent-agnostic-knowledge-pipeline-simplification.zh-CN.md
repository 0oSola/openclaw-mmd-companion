# Agent 无关的知识管线简化方案（v3）

- 状态：方向已由用户确认，待人工决策点拍板后实施
- 日期：2026-08-06
- 位置：`C:\w\kh-05`，分支 `codex/kh-05-cutover`
- 修订对象：`docs/plans/2026-08-05-codex-author-knowledge-handoff-pipeline-v2.zh-CN.md`
  中 OpenClaw 双审核/Publisher 部分

## 1. 一页结论

OpenClaw 不再实现复杂审核/发布状态机。知识管线收敛为：

```text
Codex（作者，3+N 包）
  → Pet（运输）
    → FastAPI（唯一权威控制面：接收 / Evidence / Gate / 候选账本 /
       审核队列 / 发布执行 / 回执审计）
        ├─ 审核界面层（可替换）：
        │    OpenClaw 对话 / Hermes / Web / Pet
        │    → 只做“展示候选 → 用户决策 → 回传决定”
        ├─ 发布适配器层（可替换）：
        │    Obsidian MCP / memory-wiki / 本地 Git Vault 适配器
        │    → 只做“写入精确 Markdown + lint + commit + push”
        └─ Obsidian Vault（唯一规范知识落盘点）
```

关键原则：

1. FastAPI 是唯一权威：所有候选、审核状态、批准、发布记录、回执都在 FastAPI；
2. 任何 agent 都不拥有知识语义，只负责“把候选给用户看、把用户决定传回来”；
3. 发布不绑定 OpenClaw：优先使用 Obsidian MCP / 本地 Git Vault 适配器，
   memory-wiki 作为可选后端；
4. 未来 Hermes 或其他 agent 接入时，只需实现一个很薄的审核界面适配器，
   不需要理解 Vault 主题、diff 或发布逻辑。

## 2. 为什么放弃 OpenClaw sidecar 复杂实现

原方案（KH-04 / 07-14 spec）要求 OpenClaw 侧实现：

- project-knowledge candidates/commands/publish-payloads/publish-status 状态机；
- 内容审核 + 发布审核 + Change Set 冻结 + memory-wiki 发布；
- 持久化 review runs、proposals、receipts。

这带来三个问题：

1. **绑定 OpenClaw**：发布语义、审核状态、Change Set 都长在 OpenClaw 侧，
   Hermes 或其他 agent 无法复用；
2. **双端复杂**：FastAPI 和 OpenClaw 各自维护状态机，还要对齐两套契约；
3. **运维重**：远程 sidecar 需要升级、重启、部署 Skill，且实测端点缺失。

新方案把这些职责收回 FastAPI，agent 只做“人工决策的搬运工”。

## 3. 新职责模型

| 层 | 职责 | 持有方 |
|---|---|---|
| 作者契约 | 3+N 包、marker、candidate 正文 | Codex |
| 运输 | 扫描、上传、幂等、ACK | Pet |
| 事实与 Gate | 接收、Evidence、确定性 Gate、候选 revision | FastAPI |
| 审核队列 | 待审核候选、审核状态、决定记录 | FastAPI |
| 人工决策 | 展示候选、内容确认、发布方案确认 | 用户（经任意 agent/UI） |
| 精确发布 | 生成 exact Markdown、结构门禁、commit、push | agent 机器本地执行（Obsidian MCP + Gate Skill + Git CLI）；FastAPI 裁决与审计 |
| 知识落盘 | Obsidian Vault + Git 历史 | Obsidian / Vault Git |
| 审计 | 回执、hash、不可变记录 | FastAPI |

## 4. 审核流程（简化后）

```text
1. FastAPI Gate 通过后，候选进入“待审核”队列；FastAPI DB 保存完整不可变事实：
   handoff package、candidate 原文、marker 声明、revision、hash、evidence、Gate；
2. OpenClaw（或其他 agent）主动认领一条：
   POST /knowledge-review/claims
   → FastAPI 单事务：选择最早 queued 候选 → 状态改 claimed →
     创建 lease（claim_id、claimed_by、lease_expires_at、heartbeat）
   → 返回完整审核上下文；无候选时返回空，不制造空审核会话；
3. OpenClaw 对话中向用户展示作者主张、证据摘要，进行第一次内容确认；
4. OpenClaw 查询 Obsidian（Obsidian MCP）生成发布方案；
5. OpenClaw 在本机执行 preflight 结构门禁（Vault Publication Gate Skill +
   确定性 validator CLI）；
6. 通过后向用户展示目标文件与完整 diff，进行第二次发布确认；
7. OpenClaw 调用 Obsidian MCP 写入 → 本机 post-apply 门禁 →
   Git CLI commit/push；
8. OpenClaw 把审核决定、检查报告、发布回执写回 FastAPI：
   POST /knowledge-review/{claim_id}/content-decision
   POST /knowledge-review/{claim_id}/publication-decision
   POST /knowledge-review/{claim_id}/publication-receipt
   POST /knowledge-review/{claim_id}/heartbeat
   POST /knowledge-review/{claim_id}/defer
9. FastAPI 校验报告（规则版本、批准范围、实际 diff hash、Git 结果），
   生成/确认 Accepted Wiki Change Set，推进状态并保存 receipt。
```

两次人工确认仍然保留（这是原方案的价值）：

- 第一次：确认“知识内容正确”；
- 第二次：确认“具体写哪个页面、最终 Markdown 和 diff 正确”。

两次确认可以合并为一次交互中的两个步骤，但 FastAPI 账本必须分别记录。

### 4.1 认领与租约（Lease）

- 认领必须是原子的：FastAPI 单事务完成“选择 + claimed + lease 创建”；
- OpenClaw 等待人工确认时通过 heartbeat 续租；
- 租约到期且进程中断后，FastAPI 把候选恢复为 `queued`，重新可认领；
- 恢复可认领不等于自动给用户发消息，不自动重复打扰。

队列状态：

```text
received → needs_evidence / ready_for_review → queued → claimed
→ awaiting_content_confirmation → content_approved
→ awaiting_publication_confirmation → publication_approved
→ publishing → published
旁路：rejected / deferred / superseded / claim_expired
```

### 4.2 网络方向（重要变更）

本模型下 OpenClaw 是 FastAPI 的客户端：主动拉取任务、处理、主动回传结果。
这推翻了之前“OpenClaw 不反连本机 FastAPI”的约束，需要 FastAPI 暴露
OpenClaw 可达的地址（内网/公网 + 独立 token 认证）。此变化记录为 D10。

## 5. 发布适配器（可替换）

FastAPI 定义统一发布端口：

```text
vault_status()
vault_search(query)
vault_get(path)
vault_apply_exact(files, expected_revision)
vault_restore_exact(snapshots, expected_revision)
vault_lint(paths)
vault_compile()
vault_commit_push(paths, message, trailers)
```

实现候选（已收敛，2026-08-06 澄清）：

| 适配器 | 优点 | 条件 |
|---|---|---|
| Obsidian MCP | 语义化读写/搜索/链接，agent 可复用 | 需要确认 MCP server 部署与工具面（read/write/search） |
| Git CLI 适配器 | 发布事务：status / allowlist add / commit / push / 失败不自动回滚 | FastAPI 能访问 Vault 的 Git 工作区（本机、网络挂载或 git clone 工作流） |
| 轻量 lint 脚本（可选） | frontmatter 必填、wikilink 可解析、Markdown 结构 | 自写校验脚本，不依赖 memory-wiki |
| ~~memory-wiki~~ | ~~已启用、CLI 可用~~ | **退役：内容操作交给 Obsidian MCP，发布事务交给 Git CLI** |

推荐组合：

```text
OpenClaw 机器本地执行：
  Obsidian MCP（内容读写/搜索）
  Vault Publication Gate Skill（编排 preflight/post-apply）
  确定性 validator CLI（路径/frontmatter/diff/hash/Git 工作树）
  Git CLI（status → add allowlist → commit → push）
FastAPI 统一：
  校验规则与规则版本（validation policy）
  检查结果与回执审计
  幂等与状态机
```

memory-wiki 不再进入主路径。

### 5.1 远程 Vault 执行方式（已收敛）

已确认：生产 Vault、Obsidian MCP、Git CLI 都在 OpenClaw 机器。

因此：

- Obsidian MCP、validator CLI、Git CLI 在 OpenClaw 机器本地执行；
- FastAPI 不直接访问 Vault 文件，只下发规则、接收检查报告并裁决；
- 唯一前提：Obsidian MCP 写入的工作区与 Git CLI 操作的工作区是同一目录。

### 5.2 memory-wiki 退役边界

memory-wiki 的 `wiki_status/search/get/apply/lint/compile` 职责按以下方式接管：

| memory-wiki 能力 | 接管者 |
|---|---|
| search/get（内容查询） | Obsidian MCP |
| apply（写入页面） | Obsidian MCP |
| lint | Vault Publication Gate Skill 内的确定性 validator CLI（FastAPI 下发规则） |
| compile | Obsidian 自动索引（打开时）；不阻塞发布 |
| status（Vault 脏状态） | Git CLI `git status --porcelain` |
| Git commit/push | Git CLI |

## 6. OpenClaw 的角色（大幅简化）

OpenClaw 只做两件事：

1. 审核对话：主动认领候选，向用户展示并回传两次决定；
2. 发布执行（本机适配器）：Obsidian MCP 写入 + Gate Skill 门禁 +
   validator CLI 检查 + Git CLI commit/push，再把回执写回 FastAPI。

OpenClaw 是第一个“审核 + 发布执行 agent”，但适配器是通用工具，
Hermes 或其他 agent 可通过同一套 API 和工具复用相同流程。

不再需要：

- project-knowledge candidates/commands/publish-payloads/publish-status；
- OpenClaw 侧持久化 review runs、proposals、receipts；
- Change Set 冻结（改由 FastAPI 冻结）；
- OpenClaw Skill 里的复杂发布状态机。

## 7. Hermes 及其他 agent 接入方式

接入一个新的 agent（如 Hermes）只需要实现一个薄适配器：

```text
1. 认领：POST /knowledge-review/claims
2. 展示给用户（内容 + 证据 + 发布方案）
3. 回传两次决定：content-decision / publication-decision
4. 在可访问 Vault 的机器上复用发布适配器：
   Obsidian MCP + Gate Skill + validator CLI + Git CLI
5. 回传检查报告与发布回执
```

agent 不需要：

- 理解知识语义或维护审核状态（FastAPI 持有）；
- 自己定义校验规则（FastAPI 下发 validation policy）；
- 自己实现 Git 发布事务（复用通用适配器与 Gate Skill）。

这就是“agent 无关”的实现方式：审核界面和发布执行者都可替换，
权威、规则和审计留在 FastAPI。

## 8. 对已实现代码的影响

### 保留

- KH-01：作者契约、Hook、validator、3+N 样例；
- KH-02：Pet 扫描与运输；
- KH-03：FastAPI 接收、Evidence、Gate、candidate revision、独立账本；
- SQLite P0 备份与副本恢复工具（`scripts/sqlite_recovery.py`）。

### 改造

| 现有实现 | 新方案中的处理 |
|---|---|
| `codex_author_knowledge_openclaw_delivery.py`（T1/T2 project-knowledge 收敛） | 改造为“审核队列 + claim/decision 回传 API”；回执轮询不再需要，改为 OpenClaw 主动回传 receipt |
| `openclaw/project_knowledge/review_publisher.py` | 降级为参考实现，不进入生产主链 |
| `openclaw/skills/codex-author-knowledge-review-publisher/SKILL.md` | 简化为“审核对话 + 回传决定”契约，删除发布状态机与 memory-wiki 依赖说明 |
| FastAPI `POST /publication-receipts` | 并入 claim receipt 回传契约，保留为审计/兼容入口 |

### 新增

- 审核队列 + claim/lease/heartbeat/defer API（FastAPI）；
- 两次决定与发布回执回传 API（FastAPI）；
- validation policy 下发与检查报告校验（FastAPI）；
- `Accepted Wiki Change Set` 冻结与 receipt 审计（FastAPI）；
- Vault Publication Gate Skill + 确定性 validator CLI（OpenClaw 机器）；
- Obsidian MCP + Git CLI 发布执行（OpenClaw 机器本地）；
- OpenClaw 审核/发布 Skill（第一版）。

## 9. 需要人工决策的点

以下决策由你拍板，拍板后我再更新任务清单并开始实施：

**D1：审核界面第一版用哪个？**

- A. OpenClaw 对话（推荐，已有用户习惯，先做薄适配器）；
- B. Web/Pet 页面（FastAPI 自带审核 UI，agent 无关但开发量大）；
- C. 两者都要。

**D2：发布适配器第一版用哪个？**

- A. Obsidian MCP（内容读写/搜索）+ Git CLI（发布事务）（推荐，已澄清）；
- B. 仅 Git CLI + 文件路径（不用 MCP，最简）；
- C. 保留 memory-wiki 仅做 Git 事务（不推荐，绑定 OpenClaw）。

**D3：Obsidian MCP 是否已部署？**

- 当前仓库内没有 Obsidian MCP 配置；本地只有 `obsidian-vault` skill（直接操作
  `D:\Obsidian Vault\AI Research` 路径）。如果已有 MCP server，请提供配置/工具清单；
  如果没有，第一版先走本地 Git Vault 适配器。

**D4：生产 Vault 用哪个？**

- 本机 `D:\Obsidian Vault\AI Research`（现有 skill 指向）；
- OpenClaw 远程 `/Users/sola/.openclaw/wiki/main`（非 Git）；
- Obsidian 默认 vault（Git 无 remote）；
- 新建专用 Git vault。

**D5：刚提交的 T1/T2（project-knowledge 收敛）如何处理？**

- A. 改造为“FastAPI 审核队列 + 发布器”（推荐，符合新方向）；
- B. 保留推送 OpenClaw 的 delivery 作为可选审核通道，新增审核 API 并存。

**D6：内容审核与发布审核是否保持两次确认？**

- A. 保持两次（推荐，保留原方案价值）；
- B. 合并为一次确认（更快，但发布风险更高）。

**D7：Hermes 接入范围？**

- A. 只做审核展示/回传（推荐）；
- B. 允许 Hermes 也执行发布（不推荐，权威分散）。

**D8：轻量 lint 是否纳入第一版？**

- 已收敛：FastAPI 统一管理规则与检查结果；OpenClaw 机器上由
  `Vault Publication Gate Skill` 编排、确定性 `validator CLI` 执行；
- 保留两个门禁点：preflight（第二次确认前）与 post-apply（commit 前）；
- 规则以版本化 `validation_policy` 下发：allowed_roots、required_frontmatter、
  forbid_path_traversal、require_approved_file_allowlist、
  require_clean_unrelated_diff。

**D9：远程 Vault 的 Git 访问方式？**

- 已收敛：Obsidian MCP、validator CLI、Git CLI 都在 OpenClaw 机器本地执行，
  指向同一 Vault 工作区；FastAPI 不直接访问 Vault 文件。

**D10：网络方向（新增）**

OpenClaw 需要能主动访问 FastAPI（拉取任务 + 回传结果）。请确认：

- FastAPI 对外地址（内网 IP/域名 + 端口）；
- 是否使用独立 `CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_TOKEN` 认证（配置项已预留）；
- 是否接受推翻“OpenClaw 不反连 FastAPI”的旧约束。

## 10. 简化后的实施任务（D1-D10 拍板后细化）

```text
S1 FastAPI 审核队列 + claim/lease/heartbeat/defer API
S2 FastAPI 两次决定回传 API 与 Accepted Wiki Change Set 冻结
S3 FastAPI validation policy 下发与检查报告校验/审计
S4 Vault Publication Gate Skill + validator CLI（preflight/post-apply）
S5 Obsidian MCP + Git CLI 发布执行（OpenClaw 机器本地）
S6 OpenClaw 审核/发布 Skill（第一版）与回执回传
S7 清理 project-knowledge 依赖（按 D5）
S8 SQLite 生产切换（备份/副本已就绪，切换需确认）
S9 v1 切断、flags 分阶段启用、真实端到端验收
```

## 11. 与旧方案的关系

- 保留：作者契约、Pet 运输、FastAPI Gate、两次人工确认、exact 发布、
  receipt 审计、SQLite P0；
- 废弃：OpenClaw sidecar 双审核状态机、project-knowledge 控制面依赖、
  OpenClaw-owned Change Set（改为 FastAPI 冻结）、memory-wiki 主路径；
- 新增：agent 无关的审核认领/回传端口、可替换发布适配器
  （Obsidian MCP + Gate Skill + Git CLI）、FastAPI 规则权威。
