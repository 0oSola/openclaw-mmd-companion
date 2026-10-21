# Codex 作者知识交接管线整体进度清单

- 状态：盘点快照（2026-08-06，Asia/Shanghai）
- 文档位置：本文件
- 实施基线：`c344f94d7be13df63ddb8cfc2d956b36a3034f97`（KH-04 HEAD）
- 本盘点 worktree：`C:\w\kh-05`
- 本盘点分支：`codex/kh-05-cutover`
- 关联方案：`docs/plans/2026-08-05-codex-author-knowledge-handoff-pipeline-v2.zh-CN.md`
- 关联概念：`workflow/concepts/codex-author-knowledge-handoff.zh-CN.md`

> 说明：本清单只记录已核实事实。凡未实际运行或未验证的项目，一律标记为
> “未验证”，不写成已完成。

## 1. 一页结论

```text
KH-01 作者契约/Hook   已提交 + 测试通过
KH-02 Pet 扫描与运输  已提交 + 测试通过
KH-03 FastAPI Gate    已提交 + 测试通过
KH-04 OpenClaw 审核与发布 已提交 + 测试通过（运行时适配仍是缺口）
KH-05 切断/恢复/端到端    未开始
链路自检（2026-08-12）   Hook/Pet/FastAPI/Gate 实测通过；OpenClaw 审核未验证
```

当前最大风险不是缺代码，而是缺“真实运行时接线”：

1. OpenClaw 侧只有可持久化库、Skill 契约和注入式 fake 测试，没有真实 HTTP 路由和
   memory-wiki 适配器。
2. 真实 Obsidian Vault 尚未参与过一次发布。
3. 真实 SQLite 只读完整性检查结果为 `database disk image is malformed`，必须先备份
   并在副本上实验恢复，不能直接在生产库上操作。
4. 四条实施分支尚未合并到主集成链，端到端验收证书尚未产生。

## 2. 分支与提交事实

| 票据 | 分支 | worktree | HEAD | 相对基线 |
|---|---|---|---|---|
| KH-01 | `codex/kh-01-author-handoff` | `C:\w\kh-01` | `43ebf96b` | `cab8efa9` |
| KH-02 | `codex/kh-02-pet-transport` | `C:\w\kh-02` | `9e2b79d2` | `43ebf96b` |
| KH-03 | `codex/kh-03-fastapi-knowledge-gate` | `C:\w\kh-03` | `bfd96eac` | `9e2b79d2` |
| KH-04 | `codex/kh-04-openclaw-publisher` | `C:\w\kh-04` | `c344f94d` | `bfd96eac` |
| KH-05 | `codex/kh-05-cutover`（本盘点分支） | `C:\w\kh-05` | `c344f94d` | 尚未实施 |

提交链（父 → 子）：

```text
cab8efa9
  -> 43ebf96b (KH-01)
  -> 9e2b79d2 (KH-02)
  -> bfd96eac (KH-03)
  -> c344f94d (KH-04)
```

以上 KH-01 至 KH-04 worktree 在盘点时均为干净工作区（`git status --short` 无输出）。

## 3. 各票据交付与验证

### 3.1 KH-01：作者契约、Schema、Stop Hook、Validator、3+N 样例

交付（提交 `43ebf96b`）：

- `scripts/codex-knowledge-handoff/`：schema、`index.mjs`、`stop-hook.mjs`、
  `validate-response.mjs`、README 和完整测试；
- 真实样例 `desktop-pet-left-click-handoff.response.md`（两个独立 candidate）；
- 方案文档、概念登记、术语表、KH-02 至 KH-05 issue 草稿。

验证（2026-08-06 实际执行）：

```text
node scripts/codex-knowledge-handoff/codex-author-handoff.test.mjs
19 passed / 0 failed
```

覆盖：无载荷放行、3+N 原子落盘、非法 YAML、重复键、路径穿越、引用缺失、Evidence
Reference ID 伪造、Stop Hook 输入输出、中途写入失败清理、YAML anchors、多候选、
真实样例、同 handoff_id 冲突等。

### 3.2 KH-02：Pet Scanner 与运输

交付（提交 `9e2b79d2`）：

- `desktop-pet/electron/knowledgeHandoffTransport.ts`（1047 行）与对应测试；
- `desktop-pet/electron/main.ts` 接线；
- `desktop-pet/scripts/knowledge-handoff-git-hint.mjs` 与测试。

验证（2026-08-06 实际执行）：

```text
npx vitest run electron/knowledgeHandoffTransport.test.ts electron/mainIntegration.test.ts --reporter=dot
2 files passed, 53 tests passed

node desktop-pet/scripts/knowledge-handoff-git-hint-test.mjs
3 passed / 0 failed
```

测试运行期间出现一条预期外的运行提示：`Git event hint unavailable: fetch failed`，
这是测试环境没有 FastAPI 服务时的降级行为，不是测试失败；真实环境需要确认该提示
不会阻塞 Git 操作（代码路径有 try/catch，测试断言“hint failure does not block”通过）。

### 3.3 KH-03：FastAPI 接收、Evidence、Gate 与 reconciliation

交付（提交 `bfd96eac`）：

- `api/app/routes/codex_author_knowledge_handoff.py`；
- `api/app/services/codex_author_knowledge_handoff.py`（833 行）；
- `api/app/services/codex_author_knowledge_handoff_store.py`（独立 `knowledge_handoff.db`）；
- `api/app/config.py` 新增 flag 与 token；
- `api/tests/test_codex_author_knowledge_handoff.py`（658 行）。

验证（在 KH-04 worktree 上实际执行，代码链相同）：

```text
uv run --with-requirements api/requirements.txt pytest \
  api/tests/test_codex_author_knowledge_handoff.py \
  api/tests/test_codex_author_knowledge_openclaw_delivery.py \
  api/tests/test_codex_author_knowledge_openclaw_client.py \
  api/tests/test_domain_knowledge_repository_resolver.py \
  api/tests/test_domain_knowledge_gate.py \
  api/tests/test_domain_knowledge_persistence.py -q
38 passed / 0 failed
```

### 3.4 KH-04：OpenClaw 双审核与 Obsidian Publisher

交付（提交 `c344f94d`）：

- `openclaw/project_knowledge/review_publisher.py`（1023 行）：审核状态机、Topic
  Resolution、Accepted Wiki Change Set、exact Publisher、发布锁、receipt mirror；
- `openclaw/skills/codex-author-knowledge-review-publisher/SKILL.md`；
- FastAPI 回执审计路由与独立镜像表；
- `openclaw/tests/test_project_knowledge_review_publisher.py`（549 行）、
  `api/tests/test_codex_author_knowledge_publication_receipt.py`。

验证（2026-08-06 实际执行）：

```text
uv run --with-requirements api/requirements.txt pytest openclaw/tests/test_project_knowledge_review_publisher.py -q
11 passed / 0 failed

uv run --with-requirements api/requirements.txt pytest api/tests/test_codex_author_knowledge_publication_receipt.py -q
3 passed / 0 failed
```

双轴代码复核（Standards / Spec）：通过，无剩余阻断。

### 3.5 KH-05：旧链切断、SQLite 恢复、端到端启用

状态：未开始。本盘点 worktree `C:\w\kh-05` 已按隔离要求创建，可作为实施起点。

### 3.6 2026-08-12 链路自检证据清单（Codex → Hook → Pet → FastAPI）

目的：对已运行系统的第 0 至第 3 步做只读实测，确认 Hook 注册、Pet 投递、FastAPI 接收和
Gate 分流在真实运行路径上有效。本清单不包含 OpenClaw 认领、人工双审核、Obsidian 落盘
（第 4 步），这些仍待验证。

#### 证据 1：Stop Hook 已注册并启用

- `C:\Users\KSG\.codex\hooks.json` 的 Stop 事件第二条指向
  `codex-knowledge-handoff\stop-hook.mjs`；
- `C:\Users\KSG\.codex\config.toml` 中 `[hooks.state.'C:\Users\KSG\.codex\hooks.json:stop:1:0']`
  为 `enabled = true` 且已写入 `trusted_hash`。

#### 证据 2：Pet 真实投递（2026-08-07 / 2026-08-11）

队列文件：`C:\Users\KSG\AppData\Roaming\mmd-codex-desktop-pet\knowledge-handoff-transport\queue.json`

| handoff_id | status | attempts | ack_id | lastError |
|---|---|---|---|---|
| kh_299d5318… | delivered | 1 | ack_9ff7f226… | 空 |
| kh_8f57fca8… | delivered | 1 | ack_64ea1be5… | 空 |
| kh_06c548c0… | delivered | 1 | ack_fb43126a… | 空 |

三条记录均为首次尝试即成功，无重试错误。

#### 证据 3：FastAPI 接收与 Gate 分流

`http://127.0.0.1:8100`（本机只读 GET）：

- `/healthz` → 200；
- `GET /codex/knowledge/handoffs`（transport token）→ 200，共 3 个包；
- `GET /codex/knowledge/openclaw-deliveries`（OpenClaw token）→ 200，共 15 条 delivery，
  全部 `status=pending`、`attempt_count=0`、`ack_id=null`（OpenClaw 尚未认领）。

Gate 分流与候选对应：

| 包（handoff_id） | 候选 local_id | 类型 | pending_verification | 是否生成 delivery |
|---|---|---|---|---|
| kh_06c548c0… | art-directed-face-shadow-states | concept | 非空 | 否（needs_evidence） |
| kh_8f57fca8… | codex-knowledge-handoff-trigger | rule | 非空 | 否 |
| kh_8f57fca8… | codex-knowledge-assets-deployment | contract | 非空 | 否 |
| kh_299d5318… | openclaw-source-whitelist-admin | gate | 非空 | 否 |
| kh_299d5318… | handoff-package-sha256-contract | contract | 空 | 是（rev1、rev2 均有 delivery） |

即：真实运行中只有 `pending_verification` 为空的候选通过 Gate 并生成 delivery，其余四个
带验证缺口的候选全部进入 `needs_evidence`，与设计一致。

#### 证据 4：白名单与开关事实

- `api/data/knowledge_handoff/openclaw_whitelist.json` 当前包含
  `10.11.252.164/32`（OpenClaw）与 `127.0.0.1/32`（本地回环）；
- `api/.env`：`CODEX_AUTHOR_KNOWLEDGE_HANDOFF_ENABLED=true`、
  `CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_DELIVERY_ENABLED=false`（仅控制旧 sidecar worker；
  `review-claims` 路由不依赖该开关）、transport/OpenClaw token 均已配置。

#### 观察项（待确认，不阻断本清单）

`handoff-package-sha256-contract` 同一候选同一 revision（rev2）在 2026-08-07 至
2026-08-11 期间累计生成 13 条 `pending` delivery，疑似 reconciliation 重复创建 delivery。
认领走 `knowledge_candidate_revision` 队列，不直接消费 delivery 表，因此不阻断审核，
但会堆积 pending 记录，需单独核查是否需要按 `(candidate_id, candidate_revision)` 幂等去重。

#### 结论边界

- 第 0 至第 3 步（Hook → Pet → FastAPI → Gate）已有真实运行证据；
- 第 4 步（OpenClaw 认领 → 人工双审核 → Obsidian MCP → Git commit/push → 回执）仍未验证，
  完成标准 16 的端到端证书尚未产生；
- 真实 SQLite `trace.db` 仍为 malformed，但作者知识链使用独立的
  `api/data/sqlite/knowledge_handoff.db`，本清单的实测结果证明该独立库可用。

## 4. 方案完成标准（16 条）映射

| # | 完成标准 | 当前状态 |
|---|---|---|
| 1 | 真实 Codex 最终回复产生合法 3+N 包 | 未验证（Hook 已实现并单测通过，未接入真实 Stop） |
| 2 | 无知识变化会话不产生空包 | 已由 KH-01 测试覆盖（无载荷放行），未做真实会话验证 |
| 3 | Pet 离线、重启、重复扫描不丢包不重复 | 代码已实现并有单测，未做真实 Pet 运行验证 |
| 4 | FastAPI 保存 immutable package/candidate revision | 已实现并有 API 测试，未做真实运行验证 |
| 5 | 未提交/本地提交/durable commit 状态转换 | 已实现并有测试，未做真实 Git 场景验证 |
| 6 | Repository Resolver 创建固定版本 Evidence Reference | 已实现并有测试，未做真实仓库验证 |
| 7 | Gate 阻断状态和修正路线正确 | 已实现并有测试 |
| 8 | OpenClaw 同一任务完成两个独立批准 | 已实现并有测试，真实审核界面未验证 |
| 9 | OpenClaw 冻结并原样执行 Accepted Wiki Change Set | 已实现并有 fake memory-wiki 测试，真实 memory-wiki 未验证 |
| 10 | Obsidian 只出现审核后的 canonical knowledge | 未验证（真实 Vault 未参与） |
| 11 | Vault stale/hash/lint/push 失败不标记 published | 已实现并有 fake 测试 |
| 12 | Publication Receipt 可审计且不回跳发布 | 已实现并有测试 |
| 13 | Review accept 不再触发任何知识/Wiki 副作用 | 未实施（KH-05 第一项） |
| 14 | SQLite 完整性检查为 `ok` | **当前为 malformed，未恢复** |
| 15 | 架构文档与最终运行系统同步 | 部分同步；运行时适配完成后需再更新 |
| 16 | 真实 Codex → Pet → FastAPI → OpenClaw → Obsidian 证书 | 未完成 |

## 5. 当前运行配置事实

主工作区 `api/.env`（盘点时）：

```text
CODEX_KNOWLEDGE_EXTRACTION_ENABLED=false
CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true   # 旧 v1 控制面仍在运行
```

未设置（即使用默认关闭）：

- `CODEX_AUTHOR_KNOWLEDGE_HANDOFF_ENABLED`
- `CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_DELIVERY_ENABLED`
- `DOMAIN_KNOWLEDGE_CONTROL_PLANE_ENABLED`
- `CODEX_AUTHOR_KNOWLEDGE_HANDOFF_TOKEN`
- `CODEX_AUTHOR_KNOWLEDGE_OPENCLAW_TOKEN`

含义：新管线当前没有进入任何真实运行路径；旧 v1 OpenClaw 控制面仍开启。

## 6. SQLite 事实

只读检查（2026-08-06 实际执行）：

```text
PRAGMA integrity_check
结果：database disk image is malformed
```

处理约束（来自 AGENTS.md 与方案）：

- 不直接操作真实 `trace.db`；
- 必须先备份；
- 恢复实验只能在副本上做；
- P0 恢复另行票据，且实验通过后才能进入 KH-05 切换。

## 7. KH-05 待办检查单

每个 TODO 均给出“缺陷 → 动作 → 验收证据”。

| 缺陷 | 动作 | 验收证据 |
|---|---|---|
| Review accept 仍隐式触发知识/Wiki 副作用 | 切断 Review 决定与 knowledge outbox/candidate/wiki payload 的调用 | accept 后只写 Review 决定；无 knowledge 派生记录 |
| v1 派生链仍在运行（旧控制面 flag=true） | 停用或按分阶段计划替换 v1 派生 worker 与表 | 旧 worker 不产生新行；新 flag 按阶段打开 |
| 真实 SQLite malformed | 备份 → 副本实验恢复 → 验证 integrity_check=ok | 副本恢复通过；生产切换有回滚方案 |
| 新管线 flags 全部关闭 | 分阶段启用 handoff、delivery、gate 等 flag | 每阶段有独立验收，未完成的阶段不打开 |
| OpenClaw 无真实 HTTP 路由/memory-wiki 适配器 | 实现或部署运行时适配器并接入 review_publisher | 真实 OpenClaw 收到 delivery；真实 memory-wiki 执行 apply/lint/commit/push |
| 无真实端到端证书 | 执行一次真实 Codex → Pet → FastAPI → OpenClaw → Obsidian | 提供 16 条完成标准对应的真实验收记录 |
| 四条实施分支未合并 | 先确定合并策略（逐条合并或集成分支），再让 KH-05 落在同一链上 | 集成链可运行；合并后回归测试通过 |

## 8. 开放问题

1. OpenClaw 运行时适配器由哪个票据实现？KH-05 还是单独票据？
2. 四条分支的合并策略由谁确认？
3. 真实 Vault 的 canonical knowledge root 在运行时如何配置？
4. SQLite 恢复是否需要新的独立 P0 票据？由谁授权在副本上实验？
5. `CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true` 的 v1 控制面何时停用，是否会影响当前
   Daily Review 链路？
