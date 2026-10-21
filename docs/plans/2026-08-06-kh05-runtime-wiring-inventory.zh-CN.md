# KH-05 运行时接线盘点与决策清单

- 状态：只读盘点快照（2026-08-06，Asia/Shanghai）
- 文档位置：本文件
- worktree：`C:\w\kh-05`
- 分支：`codex/kh-05-cutover`
- 前置清单：`docs/plans/2026-08-06-codex-author-knowledge-pipeline-progress.zh-CN.md`

> 本文件只记录已实际观察的事实。所有探测均为只读 GET 或只读 SQLite 查询，
> 没有触发任何写操作，也没有触碰真实数据库文件内容。

## 1. 结论摘要

KH-05 不能直接开工，有三个真实运行时缺口必须先有人决策或实现：

```text
1. OpenClaw Control Plane 服务可达，但 author-knowledge / project-knowledge /
   codex-review 三个命名空间端点实测全部 404，OpenClaw 侧服务端实现缺失或未注册。

2. memory-wiki 的规格 Vault 路径 D:/Obsidian/OpenClaw Wiki 在本机不存在；
   真实 Vault 在哪台机器、是否已配置 memory-wiki 插件，需要 OpenClaw 侧确认。

3. trace.db 确实损坏（integrity_check=malformed，quick_check 报 Tree 19 双重引用
   和游离页），但 51 张表和核心表可读；2026-07-10 已有一次成功恢复实验记录。
```

## 2. OpenClaw Control Plane 探测事实

服务地址（来自主工作区 `api/.env`）：

```text
OPENCLAW_CONTROL_PLANE_BASE_URL=http://10.11.252.164:8765
```

实测（只读 GET）：

| 路径 | 结果 |
|---|---|
| `GET /healthz` | 404 |
| `GET /` | 404 |
| `GET /v1/apps/mmd/codex-author-knowledge/workspaces/mmd-project/deliveries` | 404 |
| `GET /v1/apps/mmd/project-knowledge/runs` | 404 |
| `GET /v1/apps/mmd/codex-review/runs` | 404 |

含义：

- 服务进程存在且可连接；
- 但上述三个命名空间在 GET 下都不存在；
- 未测试 POST（会触发服务端副作用，超出只读盘点范围）；
- 本仓库 `openclaw/` 目录只有库、Skill 和测试，没有任何 HTTP 路由实现；
- `docs/plans/2026-07-14-openclaw-project-domain-knowledge-review-publish-spec.md`
  是 OpenClaw 侧实现的契约，但没有说明“已部署在哪、由谁维护”。

需要决策：OpenClaw 侧服务端实现由谁负责？是独立仓库/部署，还是本仓库需要新增
一个可挂载的 OpenClaw 运行时适配包？

## 3. memory-wiki 与 Obsidian Vault 事实

执行规格：`docs/plans/2026-06-09-openclaw-memory-wiki-obsidian-execution-spec.md`

规格中配置的 Vault：

```text
D:/Obsidian/OpenClaw Wiki
```

本机实测：

```text
D:/Obsidian/OpenClaw Wiki   不存在
D:/Obsidian                  不存在
```

含义：

- 该 Vault 不在本项目机器上，或从未创建；
- OpenClaw 运行在 `10.11.252.164`，Vault 可能只存在于 OpenClaw 侧机器；
- memory-wiki 插件（`wiki_status/search/get/apply/lint`）是否已配置，本仓库无法
  确认，需要 OpenClaw 侧提供状态证明。

需要决策：真实 Vault 在哪台机器？由谁创建 Git 仓库？`projects/{workspace_id}/domains/`
的 canonical 根目录由谁初始化？

## 4. SQLite P0 事实

目标库：`api/data/sqlite/trace.db`

文件状态：

```text
trace.db       961,359,872 字节（约 917 MiB），2026-08-06 15:07 仍在更新
trace.db-wal    4,132,392 字节
trace.db-shm       32,768 字节
```

只读检查结果：

```text
PRAGMA integrity_check
=> database disk image is malformed

PRAGMA quick_check
=> Tree 19 page 174806 cell 0: 2nd reference to page 174780
   Page 174785 ... 174805: never used
```

只读表访问：

```text
sqlite_master 可读，共 51 张表
codex_knowledge_extraction_outbox = 6 行（可读）
desktop_pet_sessions             = 182 行（可读）
```

历史恢复证据（`api/data/sqlite/backups/`）：

```text
trace-db-pre-repair-20260710-115910/
  trace-latest-corrupt.db
  trace-latest-recovered.db
  trace-latest-recovered.report.json   integrity_check=[ok]
  trace-online.db
  trace-recovered.db
  trace-recovered.report.json          integrity_check=[ok]
  trace.db

trace-db-corrupt-20260715/
  trace.db
```

2026-07-10 的报告显示恢复成功：

- `codex_review_items`：1479 / 1479 恢复；
- `trace_events`：1,350,224 行；
- `integrity_check`：ok；
- `foreign_key_check_count`：0。

当前运行状态：

- FastAPI 正在 `127.0.0.1:8100` 监听（PID 49560），是写库进程；
- 多个 Electron（Pet）进程在运行；
- 因此 SQLite P0 的第 1 步“停止 FastAPI、Pet 和所有写库进程”尚未执行。

含义：

- 损坏范围有限（不是整库不可读），但仍在增长中的生产库上；
- 已有可复用的恢复实验流程，但没有当前库的恢复报告；
- 必须在停止写库进程后，对当前 DB/WAL/SHM 做新备份并重新做副本恢复实验。

## 5. Feature Flag 与 Worker 启动事实

主工作区 `api/.env`（token 值不在此记录）：

```text
CODEX_KNOWLEDGE_EXTRACTION_ENABLED=false
CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true
OPENCLAW_CONTROL_PLANE_BASE_URL=http://10.11.252.164:8765
```

未设置（默认关闭）：

```text
CODEX_AUTHOR_KNOWLEDGE_HANDOFF_ENABLED
CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_DELIVERY_ENABLED
DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED
CODEX_AUTHOR_KNOWLEDGE_HANDOFF_TOKEN
CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_TOKEN
```

`api/app/config.py` 事实：

- `OPENCLAW_CONTROL_PLANE_TOKEN` 未设置时回退到 `OPENCLAW_TOKEN`（已设置），
  因此 token 条件满足；
- `CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true` 时，v1 control-plane worker
  会启动（main.py 判定），但目前对端 `codex-review` 端点返回 404，实际调用会失败
  并重试；
- 新 author-knowledge delivery worker 需要同时满足：
  `CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_DELIVERY_ENABLED=true`、
  handoff store 存在、control-plane client 存在、token 非空。

## 6. 缺口清单（缺陷 → 影响 → 需要谁决策）

| # | 缺口 | 已观察证据 | 影响 | 需要决策 |
|---|---|---|---|---|
| 1 | OpenClaw 服务端无 author-knowledge 端点 | `GET /v1/apps/mmd/codex-author-knowledge/...` 404 | 即使打开 flag，delivery 也无法被 OpenClaw 接收 | 谁实现/部署 OpenClaw 侧路由 |
| 2 | OpenClaw 服务端无 project-knowledge 端点 | `GET /v1/apps/mmd/project-knowledge/runs` 404 | 无法执行双审核/Change Set 流程 | 是否沿用 07-14 spec 新建实现 |
| 3 | v1 codex-review 端点 404 | `GET /v1/apps/mmd/codex-review/runs` 404，但 v1 flag=true | 现有 v1 worker 持续失败 | 是否先停用 v1 flag |
| 4 | 真实 Vault 不存在于本机 | `D:/Obsidian/OpenClaw Wiki` 缺失 | 无法确认 memory-wiki 指向哪里 | OpenClaw 侧提供 Vault 位置与 Git 状态 |
| 5 | memory-wiki 插件状态未知 | 本仓库无插件配置或连通性证据 | exact publish 无法落地 | OpenClaw 侧提供 `wiki_status` 证据 |
| 6 | trace.db 当前损坏 | integrity_check=malformed | KH-05 启用前必须恢复 | 批准停止写库进程并做副本恢复 |
| 7 | 恢复流程需复跑 | 历史报告为 2026-07-10，当前库 961MB | 需要新的备份 + 副本实验 | 确认恢复目标表和废弃表清单 |
| 8 | 四条分支未合并 | worktree 各自独立 | 真实端到端无法在一条链上跑 | 确定合并策略 |
| 9 | OpenClaw Skill 注册方式未定 | 新 Skill 只有 `SKILL.md`，无 agents 元数据 | 无法确认审核工作流如何被 OpenClaw 加载 | OpenClaw 团队确认加载机制 |

## 7. 建议的 KH-05 实施顺序（按依赖）

```text
阶段 A（外部协调，阻塞项）
  A1 确认 OpenClaw 侧由谁实现/部署 author-knowledge + project-knowledge 端点
  A2 确认真实 Vault 位置、Git 状态、memory-wiki 插件状态
  A3 确认 Skill 注册方式

阶段 B（本地 P0，可在 A 并行）
  B1 停止 FastAPI/Pet 等写库进程
  B2 备份 DB/WAL/SHM
  B3 在副本上复跑 2026-07-10 的恢复流程
  B4 产出当前库恢复报告（integrity_check=ok）
  B5 确认废弃 v1 派生表清单

阶段 C（代码切断）
  C1 Review accept 去知识副作用
  C2 v1 派生链停用（先关 CODEX_OPENCLAW_CONTROL_PLANE_ENABLED）
  C3 分阶段打开新 flag

阶段 D（端到端验收）
  D1 合并四条分支并回归
  D2 真实 Codex -> Pet -> FastAPI -> OpenClaw -> Obsidian 证书
```

## 8. 开放问题（需要用户/OpenClaw 回答）

1. OpenClaw Control Plane 服务端代码在哪个仓库？谁负责新增
   `codex-author-knowledge` 和 `project-knowledge` 路由？
2. `10.11.252.164:8765` 上 404 是“未实现”还是“路径/前缀不同”？能否提供
   当前 OpenClaw 服务端路由清单？
3. 真实 Obsidian Vault 的位置和 Git remote 是什么？
4. 是否授权在 KH-05 阶段停止本机 FastAPI 与 Pet 进程做 SQLite 恢复？
5. v1 `CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true` 是否可以现在关闭？
6. 四条 KH 分支的合并策略由谁确认（逐条合并 vs 集成分支）？

## 9. OpenClaw 侧实现确认单（新增 2026-08-06）

> 用途：把“OpenClaw 需要做什么”转成远程机器负责人可以直接回答的问题。
> 回答后，KH-05 才能确定交付物是“可部署应用包 + Skill + 插件配置”，
> 还是需要 OpenClaw 团队改服务端。

### 9.1 实现方式

**问题 O1：OpenClaw 平台支持哪些扩展方式？**

- 能否挂载自定义 HTTP 应用/路由（例如 `POST /v1/apps/mmd/...`）？
- 是否支持 MCP、插件或外部服务注册？
- 还是只能通过 Skill + 对话（`/v1/responses`）执行？

**问题 O2：如果支持挂载自定义应用，挂载在哪里？**

- OpenClaw 部署环境是否有应用/插件目录？
- 新增一个 HTTP 服务需要改 OpenClaw 核心源码，还是只新增外部应用包？
- 新增应用后是否需要重新构建/重启整个 OpenClaw？

### 9.2 现有端点状态

**问题 O3：请提供当前 Control Plane 已注册的路由清单。**

本项目实测（2026-08-06，只读 GET）：

```text
GET /healthz                                                    404
GET /                                                           404
GET /v1/apps/mmd/codex-author-knowledge/workspaces/mmd-project/deliveries  404
GET /v1/apps/mmd/project-knowledge/runs                         404
GET /v1/apps/mmd/codex-review/runs                              404
```

- 这些是“尚未实现”，还是“路径/前缀不同”？
- 现有 `codex-review` 端点实际挂在哪里？v1 worker 一直调用失败的根因是什么？

**问题 O4：author-knowledge 端点由谁实现？**

需要实现的端点至少包括：

```text
POST /v1/apps/mmd/codex-author-knowledge/workspaces/{workspace_key}/deliveries
GET  /v1/apps/mmd/codex-author-knowledge/workspaces/{workspace_key}/publish-status
```

- 由 OpenClaw 团队实现，还是由本项目提供一个可部署包？
- 实现语言/运行环境是否必须是 OpenClaw 内置技术栈，还是允许独立 Python 进程？

### 9.3 memory-wiki 与 Obsidian

**问题 O5：远程机器的 memory-wiki 插件是否已启用？**

- 能否提供 `wiki_status` 的实际输出？
- `wiki_search`、`wiki_get`、`wiki_apply`、`wiki_lint` 是否可用？

**问题 O6：真实 Obsidian Vault 在哪里？**

- Vault 路径、Git 仓库地址、远程 remote 是什么？
- 是否已初始化 `projects/{workspace_id}/domains/` 目录？
- Obsidian 侧是否能看到 Vault 并正常编译？

### 9.4 Skill 注册

**问题 O7：新 Skill 如何注册到 OpenClaw？**

- 需要交付物是 `SKILL.md` 目录（含 agents 元数据），还是由 OpenClaw 侧从
  `openclaw/skills/` 同步？
- 当前 `codex-author-knowledge-review-publisher/SKILL.md` 缺少 `agents/openai.yaml`，
  是否需要补齐？
- OpenClaw 加载 Skill 后，审核交互是在对话中完成，还是由 HTTP 应用驱动？

### 9.5 回执与网络方向

**问题 O8：发布回执如何回到 FastAPI？**

当前 KH-04 实现是 OpenClaw 主动 `POST /codex/knowledge/publication-receipts`
到本机 FastAPI，但：

- OpenClaw 在远程，本机 FastAPI 是 `127.0.0.1:8100`；
- 既有规格要求“所有网络连接由 FastAPI 发起，OpenClaw 不反连本机”。

请确认采用哪种方式：

- 方式 A：FastAPI 主动轮询 OpenClaw 的 `publish-status`/receipt 端点（推荐，符合
  既有网络方向约束）；
- 方式 B：允许 OpenClaw 通过内网可路由地址访问 FastAPI（会推翻“不反连本机”约束）；
- 方式 C：其他现有机制。

### 9.6 交付与验收

**问题 O9：OpenClaw 侧实现完成后，如何验收？**

- OpenClaw 能否提供一个“shadow 模式”测试端点，让 FastAPI 推送候选但不写真实
  Vault？
- 是否能提供测试 Vault（disposable Git Vault）做 lint/commit/push 演练？
- 验收时 OpenClaw 侧由谁确认“双审核通过”？

### 9.7 优先级

**问题 O10：OpenClaw 侧实现的排期和依赖？**

- 是否依赖本仓库先合并 KH-01~KH-04 分支？
- 是否依赖 SQLite 恢复完成？
- 是否依赖 v1 `codex-review` 端点先修复或停用？

### 9.8 回答后应更新的交付物

回答以上问题后，本清单应更新为：

```text
1. OpenClaw 侧实现方式（O1/O2）→ 确定交付物形态；
2. 端点实现方与端点清单（O3/O4）→ 确定 OpenClaw 应用包范围；
3. memory-wiki/Vault 状态（O5/O6）→ 确定远程部署清单；
4. Skill 注册方式（O7）→ 确定需要补齐的文件；
5. 回执网络方向（O8）→ 确定 FastAPI 侧新增轮询 worker 还是允许反连；
6. 验收方式（O9/O10）→ 确定 KH-05 阶段 D 的端到端验收步骤。

## 10. OpenClaw 侧回答归档（2026-08-06 已收到）

> OpenClaw 侧已逐题回答 O1-O10。以下是归档摘要；完整原文以 OpenClaw 侧会话为准。

### 10.1 已确认事实

**O1/O2：扩展方式**

- OpenClaw 支持 Skill、MCP、Plugin、外部服务/sidecar、对话 API；
- 插件可用 `api.registerHttpRoute(...)` 挂 Gateway HTTP 路由，不必改 OpenClaw 核心源码；
- 当前 codex-review control-plane 是独立 Python sidecar：
  - 启动脚本：`scripts/codex_daily_review.py serve`
  - 服务：launchd `ai.openclaw.codex-review-control-plane`
  - 监听：`10.11.252.164:8765`
- 新插件通常需要 Gateway restart；sidecar 只需重启该服务。

**O3：当前已注册路由**

v1 codex-review（实测可用）：

```text
POST /v1/apps/mmd/codex-review/runs/{session_key}/snapshot
GET  /v1/apps/mmd/codex-review/runs/{session_key}/commands
POST /v1/apps/mmd/codex-review/commands/{command_id}/result
POST /v1/apps/mmd/codex-review/runs/{session_key}/memory-payloads
GET  /v1/apps/mmd/codex-review/runs/{session_key}/publish-status
```

v2 project-knowledge（实测可用）：

```text
POST /v1/apps/mmd/project-knowledge/runs/{run_id}/candidates
GET  /v1/apps/mmd/project-knowledge/runs/{run_id}/commands
POST /v1/apps/mmd/project-knowledge/commands/{command_id}/result
POST /v1/apps/mmd/project-knowledge/runs/{run_id}/publish-payloads
GET  /v1/apps/mmd/project-knowledge/runs/{run_id}/publish-status
```

我方 404 实测的解释：

- `/healthz`、`/`：确实未实现；
- `project-knowledge/runs`、`codex-review/runs`：缺 `{run_id}`/`{session_key}` 段，路径不完整；
- `codex-author-knowledge/...`：当前确实未实现/未挂载。

**O4：author-knowledge 端点**

- 未实现；OpenClaw 推荐由本项目提供 sidecar/可部署包，不需要等 OpenClaw 团队；
- 允许独立 Python 进程；
- 强烈建议不要新开 `codex-author-knowledge` 命名，优先收敛到已存在的
  `project-knowledge` v2 端点，避免“文档写 A、服务挂 B”的路径债。

**O5：memory-wiki**

- 插件：`memory-wiki`，enabled，`stock:memory-wiki/index.js`；
- `openclaw wiki status --json`：
  - vaultMode=isolated，renderMode=obsidian；
  - vaultPath=`/Users/sola/.openclaw/wiki/main`，vaultExists=true；
  - pageCounts：report=10，entity/concept/source/synthesis=0；
  - warnings 为空；
- CLI 可用：`openclaw wiki search/get/apply/lint/compile`；
- 注意：对话工具面没有一等 `wiki_apply` tool，需要专门插件/sidecar 调 CLI。

**O6：Obsidian Vault 现状**

存在三个易混淆位置：

1. OpenClaw wiki 当前 vault：可 compile、lint issueCount=0，但**不是 Git 仓库**；
2. Obsidian 默认 vault：是 Git 仓库（branch=main），但**没有 remote**；
3. domain-knowledge v2 生产配置：当前不存在配置文件，代码默认
   `enable_production=false`，没有 `projects/{workspace_id}/domains/` 目录。

结论：真实 production vault 尚未收口。

**O7：Skill 注册**

- 最小交付形态：`skill-dir/SKILL.md`，放 `~/.openclaw/workspace/skills/` 或
  `extraDirs`，新 session 或 Gateway restart 后加载；
- `agents/openai.yaml` 不是硬要求，但建议补齐 UI 元数据；
- 审核交互默认在对话中完成；HTTP 应用只负责候选/命令/回执流转，不直接驱动审核。

**O8：回执回传（已确认）**

- 选 A：FastAPI 主动轮询 OpenClaw 的 `publish-status` 端点；
- 不推荐 B（OpenClaw 反连本机），会推翻 2026-06-11 已定边界；
- 可用轮询端点：
  `GET /v1/apps/mmd/project-knowledge/runs/{run_id}/publish-status?cursor=...`

**O9：验收能力**

- 没有独立 shadow-mode 端点，但 v2 默认 `enable_production=false` 可作保护；
- 有 disposable Git vault 测试 harness（临时 vault + 本地 bare remote）可演练
  lint/commit/push；
- OpenClaw 侧 `domain_knowledge_publish.py` 支持完整 publish transaction；
- “双审核通过”口径：内容审核由用户/sola 在 OpenClaw 对话确认；发布审核由
  publication review command/payload 明确 approve。

**O10：排期与依赖**

- 不必等 KH-01~KH-04 全部合并即可做接口对齐；
- 不硬依赖 SQLite 恢复；v2 有自己的 `data/domain-knowledge-v2.db`；
- 不依赖 v1 codex-review 修复，建议 v1 保持兼容、不再扩展 author-knowledge 语义；
- 依赖：生产 vault 配置、endpoint 命名收敛、验收开关（disposable → production）。

### 10.2 OpenClaw 推荐路径

```text
A 回执模式（FastAPI 轮询）
+ 复用 project-knowledge v2 端点
+ disposable vault 验收
+ 最后绑定真实 Git vault
不新增第三套 codex-author-knowledge 路由名
```

### 10.3 需要拍板的架构冲突（重要）

OpenClaw 推荐的“复用 project-knowledge v2”与 2026-08-05 方案冻结的
“OpenClaw-owned Accepted Wiki Change Set”存在一个所有权差异：

```text
2026-08-05 方案（KH-04 设计）：
  OpenClaw 审核 -> OpenClaw 冻结 Change Set -> OpenClaw 自己发布
  FastAPI 只接收回执，不再次推送发布载荷

现有 project-knowledge sidecar（07-14 spec 实现）：
  OpenClaw 审核 -> 命令给 FastAPI -> FastAPI 持久化 Change Set
  -> FastAPI 把 publish payload 回推 OpenClaw -> OpenClaw 发布
  （这是 2026-08-05 方案明确要废弃的回跳模式）
```

因此“收敛到 project-knowledge”有两种解释，必须选一个：

- 解释 A：只复用端点命名/HTTP 形状，但 sidecar 内部升级为 KH-04 新状态机
  （OpenClaw 冻结 Change Set，FastAPI 不再回推 publish payload）；
- 解释 B：完整复用现有 sidecar 流程（FastAPI 冻结/授权 Change Set 后回推），
  即接受 07-14 所有权模型，等于放弃 2026-08-05 的“无回跳”冻结决策。

### 10.3.1 决策登记（2026-08-06 已确认）

用户通过“架构冲突决策建议”确认选择：

```text
解释 A
复用 OpenClaw 现有 project-knowledge v2 的接口能力和 sidecar 基础设施，
但内部状态机升级为 08-05 方案冻结的 OpenClaw-owned Change Set 模型。
```

理由（保留既有治理边界）：

- FastAPI 只回答“这个候选有没有资格进入审核”，不决定 Wiki 主题、目标页、diff 或发布动作；
- OpenClaw 回答“它在 Wiki 里应该成为什么”，并生成/冻结 Accepted Wiki Change Set；
- 用户批准最终知识变化；Publisher 只执行冻结变更；
- 现有 project-knowledge 端点复用，但 Change Set ownership、approval state、
  publish payload direction、receipt model 需要按新模型调整。

### 10.4 本仓库代码影响（按已确认的解释 A）

按“解释 A + OpenClaw 推荐”推进时，KH-04/KH-05 需要调整：

1. FastAPI delivery worker 从
   `post_codex_author_knowledge_deliveries()` 改为
   `post_project_knowledge_candidates()`，或保留客户端但换 URL；
2. 候选 payload 需要从 `codex_author_knowledge_delivery` 映射到
   `project_domain_knowledge_candidate_batch` 契约（run_id、candidate_id、
   source_hash、content_hash、trigger 等）；
3. FastAPI 新增/改造回执轮询 worker，从
   `GET project-knowledge/runs/{run_id}/publish-status` 拉回执并写入
   knowledge_handoff 审计镜像表（现有 domain_knowledge 轮询写的是旧
   trace.db 表，不能混用）；
4. `openclaw/project_knowledge/review_publisher.py` 的去向待定：
   - 按解释 A：它作为 OpenClaw sidecar 的核心库；需要补充
     project-knowledge candidate 入口适配，并把 Change Set 冻结留在 OpenClaw 侧；
5. 删除或废弃 `post_codex_author_knowledge_deliveries` 客户端与
   `codex-author-knowledge` 路由契约，避免路径债；
6. 新增 `agents/openai.yaml` 到新 Skill（UI 元数据，非硬要求）；
7. FastAPI 侧新增 `CODEX_AUTHOR_KNOWLEDGE_PROJECT_RUN_ID` 之类的 run_id
   策略（或复用现有 domain knowledge run_id 格式）。

### 10.5 仍需 OpenClaw 补充的信息

1. sidecar 的 project-knowledge 实现是否就是 07-14 spec 的完整实现？
   能否提供 `scripts/codex_daily_review.py`、`domain_knowledge_publish.py`
   的路径/版本，或开放源码只读访问？
2. sidecar 是否愿意升级为“OpenClaw 冻结 Change Set”的新状态机，还是坚持
   现有“FastAPI 回推 publish payload”流程？
3. 生产 vault 最终选哪个：
   - `/Users/sola/.openclaw/wiki/main`（可编译，非 Git）；
   - Obsidian 默认 vault（Git 无 remote）；
   - 新建专用 Git vault + remote + `projects/{workspace_id}/domains/`；
4. `enable_production=true` 由谁在何时打开？
5. 现有 `GET project-knowledge/runs/{run_id}/commands` 的 command schema
   是否与 07-14 spec 一致（供 FastAPI 轮询实现对齐）？

### 10.6 下一步（决策后更新）

```text
1. 所有权模型：已确认解释 A；
2. OpenClaw 补充 10.5 的信息（sidecar 源码/升级意愿/vault/command schema）；
3. KH-05 实施按 10.7 任务清单推进；
4. SQLite P0 可并行推进（先停写库进程，再做备份和副本恢复）。
```

### 10.7 KH-05 具体改造任务清单（解释 A 已确认）

> 状态标记：`可本地开始` = 不依赖 OpenClaw 补充；`依赖 OpenClaw` = 需先拿到
> 10.5 的回答或 sidecar 配合。

**T1：FastAPI delivery 端点收敛到 project-knowledge candidates**

- 状态：可本地开始
- 目标：`codex_author_knowledge_openclaw_delivery.py` 不再调用
  `post_codex_author_knowledge_deliveries`，改为
  `post_project_knowledge_candidates(run_id=..., batch=...)`；
- 涉及：
  - `api/app/services/codex_author_knowledge_openclaw_delivery.py`
  - `api/app/services/openclaw_control_plane.py`（客户端方法）
  - `api/app/services/codex_author_knowledge_handoff_store.py`（run_id 关联）
  - 对应测试
- 待定细节：run_id 策略（候选：
  `project-knowledge:{workspace_key}:author:{handoff_id}`，需与 OpenClaw command
  schema 对齐后再冻结）；候选 payload 从 `codex_author_knowledge_delivery`
  映射到 `project_domain_knowledge_candidate_batch`；
- 验收 Gate：单测断言请求体符合 07-14 candidate 契约；仓库不再出现
  `codex-author-knowledge/.../deliveries` URL（历史文档除外）。

**T2：FastAPI 回执轮询 worker**

- 状态：可本地开始
- 目标：FastAPI 主动轮询
  `GET project-knowledge/runs/{run_id}/publish-status?cursor=...`，
  把 receipt 写入 `knowledge_handoff.db` 独立审计镜像表；
- 涉及：
  - 新增或扩展 `api/app/services/codex_author_knowledge_openclaw_delivery.py`
    或独立 receipt polling worker；
  - `api/app/services/codex_author_knowledge_handoff_store.py`（cursor + 镜像幂等）；
  - `api/app/main.py`（worker 生命周期）；
  - 测试（fake OpenClaw publish-status）
- 验收 Gate：receipt 幂等写入；cursor 持久化；receipt hash 冲突拒绝；
  不写入旧 `trace.db` 表。

**T3：review_publisher 增加 project-knowledge 入口适配**

- 状态：依赖 OpenClaw（10.5#2：sidecar 是否升级）
- 目标：`openclaw/project_knowledge/review_publisher.py` 在保留现有状态机的同时，
  支持 `project_domain_knowledge_candidate_batch` 入口（或新增适配函数），
  使 sidecar 升级时可直接调用；Change Set 冻结保持 OpenClaw-owned；
- 验收 Gate：现有 11 项测试继续通过；新增 candidate batch 映射测试。

**T4：OpenClaw sidecar 升级（Change Set ownership 调整）**

- 状态：依赖 OpenClaw
- 目标：sidecar 内部按解释 A 调整：内容审核 → 主题解析 → 发布审核 →
  OpenClaw 冻结 Change Set → 自己发布；不再依赖 FastAPI 回推 publish payload；
  receipt 通过 `publish-status` 暴露给 FastAPI 轮询；
- 交付物：由本项目提供可部署包/sidecar 代码，或 OpenClaw 侧实现；
- 验收 Gate：disposable vault 上完成一次真实
  apply/lint/commit/push/receipt 全流程，且网络日志无 FastAPI→OpenClaw→FastAPI
  二次前向投递。

**T5：Skill 补齐并部署**

- 状态：可本地开始（补齐文件），远程部署依赖 OpenClaw
- 目标：新增
  `openclaw/skills/codex-author-knowledge-review-publisher/agents/openai.yaml`
  （display_name、short_description、default_prompt）；部署到
  `~/.openclaw/workspace/skills/`；
- 验收 Gate：远程 skill 列表可见；审核对话按 SKILL.md 执行。

**T6：生产 Vault 收口**

- 状态：依赖 OpenClaw/用户决策（10.5#3）
- 目标：选定生产 vault；初始化 `projects/{workspace_id}/domains/`；
  配置 Git remote；`enable_production=false` 保持到验收完成；
- 验收 Gate：`openclaw wiki status` 显示目标 vault；目录存在；remote 可访问。

**T7：disposable vault 验收**

- 状态：部分依赖 OpenClaw（测试 vault + sidecar 事务）
- 目标：用远程 disposable Git vault 演练
  preflight → apply → lint → compile → commit → push → receipt；
  覆盖 stale/hash/lint/push 失败场景；
- 验收 Gate：publish transaction 全绿；失败场景不回滚已提交内容；
  receipt hash 与 approved hash 一致。

**T8：废弃 author-knowledge 路由契约**

- 状态：可本地开始（随 T1/T2 一并处理）
- 目标：删除或标记废弃
  - `post_codex_author_knowledge_deliveries` 客户端；
  - SKILL.md 中 `codex-author-knowledge` 端点文档；
  - FastAPI `POST /publication-receipts` 保留为本地测试/兼容入口，
    但文档明确生产回执走 FastAPI 轮询；
- 验收 Gate：`rg codex-author-knowledge` 仅命中历史文档/注释，不命中活动代码。

**T9：v1 控制面处理**

- 状态：待用户决策
- 目标：v1 `codex-review` 保持兼容、不扩展新语义；是否关闭
  `CODEX_OPENCLAW_CONTROL_PLANE_ENABLED` 由用户决定；
- 验收 Gate：v1 worker 不再持续报端点错误（关闭）或明确保持兼容（不扩展）。

**T10：SQLite P0（并行，不阻塞 T1/T2）**

- 状态：备份与副本恢复实验已完成（2026-08-06），生产切换未执行
- 目标：按方案第 9 节执行：
  停 FastAPI/Pet → 备份 DB/WAL/SHM → 副本恢复实验 →
  `PRAGMA quick_check` + `integrity_check=ok` → 核心 API 烟测 → 回滚路径；
- 验收 Gate：恢复报告落盘；`enable` 前保持 knowledge flags 关闭。

### 10.9 T10 执行记录（2026-08-06）

已执行：

1. 确认写库进程：`python -m uvicorn app.main:app --port 8100`（PID 49560），
   已停止；
2. 备份三件套到 `api/data/sqlite/backups/trace-db-corrupt-20260806/`：
   `trace.db`（961,691,648 字节）、`trace.db-wal`、`trace.db-shm`；
3. 新增恢复工具 `scripts/sqlite_recovery.py`（逐表重建 + 只读挂载源库 +
   DETACH 后完整性检查）；
4. 在副本上恢复：跳过损坏表 `codex_knowledge_extraction_outbox`（rootpage 19，
   方案明确废弃），49 张表全部复制：

```text
trace_events            2,053,027 行
codex_review_items      1,895 行
desktop_pet_sessions      182 行
messages                5,034 行
...
quick_check:            ok
integrity_check:        ok
foreign_key_check_count: 0
```

5. 恢复报告：`api/data/sqlite/backups/trace-db-corrupt-20260806/trace-recovered.report.json`；
6. 副本只读烟测通过（messages/desktop_pet_sessions/codex_review_items 可查）；
7. FastAPI 已按原命令重启（PID 117504，`127.0.0.1:8100`），应用启动完成。

尚未执行（属于 KH-05 后续生产切换，需用户决策）：

- 把恢复后的库正式切换为 `trace.db`；
- 明确废弃 `codex_knowledge_extraction_outbox` 及相关 v1 派生表清单；
- 切换后再次执行 `PRAGMA integrity_check` 和核心 API 烟测；
- knowledge feature flags 保持关闭。

### 10.8 建议实施顺序

```text
第一批（本地可开始，不依赖 OpenClaw）：
  T1 -> T2 -> T8 -> T5（补齐文件）

第二批（依赖 OpenClaw 回答/配合）：
  T3 -> T4 -> T6 -> T7

并行：
  T10（SQLite P0，需授权停服务）
  T9（v1 flag 决策）
```
```
