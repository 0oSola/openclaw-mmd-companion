# MMD project 桌面 pet 知识抓取报告

> 抓取时间：2026-08-19；数据源为本地 SQLite。这里只统计知识相关表，不把普通 review、会话或消息流水记录直接算作知识。

## 一、数量结论

| 类别 | 条目数 | 当前含义 |
|---|---:|---|
| 会话知识记录 | 5 | 1 条有内容，4 条为空/`no_wiki` 类型 |
| 已同步长期记忆 | 1 | 已确认并标记为 `synced` |
| 项目领域知识候选 | 1 | 当前为 `ready_for_review` |
| 作者知识交接候选 | 5 | 当前记录均为 `needs_repository_revision` |
| 作者交接包 | 3 | 状态均为 `received`，不是额外知识条目 |

**按“已成型或已同步”口径：2 条；另有 1 条待审核项目候选。**
**按“已被记录为知识候选/交接候选”宽口径：12 条（5 + 1 + 1 + 5），但其中大部分尚未正式发布。**

## 二、会话知识记录（5 条）

### 1. 有内容（候选知识）

- `id`：`codex_session_knowledge_bc1c0a2d932440c7900e031d6d77d46b`
- `pet_session_id`：`codex:019f2101-4f40-7c80-9c8a-117828ee1c88`
- 创建时间：`2026-07-10T07:24:06.635005+00:00`
- 领域：Aether UI Design-Screenshot-Pipeline
- 领域摘要：基于 Codex 视觉识别的设计稿到 React 站点的自动化流水线，涵盖 fresh-run 判定、视觉 seed 生成、IR 物化、layout contract 校验、gate 修正等阶段。本 session 聚焦于 theme `sword_home_codex_fresh16` 的 fresh restart 流程及 seed IR 结构分析。
- 可复用摘要：fresh-run precheck 的 strict_block_existing_artifacts 模式能有效阻止旧产物污染新 run；但 IR gate 对空 child_layout_groups 的校验存在漏洞，gate pass 不等于结构化完成。seed IR 需要同时包含 `semantic_dom_tree` 和非空的 `layout_contract.child_layout_groups` 才算质量合格。
- 使用时机：对任何 Aether UI theme 执行 design-screenshot-pipeline 前的 fresh-run 判定、旧产物清理、以及 seed IR 质量评估时
- 概念：8 条
- 规则：5 条
- 方法：2 条
- 失败分类：2 条
- 验证规则：2 条
- 主要标签：aether-ui, design-screenshot-pipeline, fresh-run, seed-ir, layout-contract, gate, child-layout-groups, codex
- 问题摘要：对 theme `sword_home_codex_fresh16` 执行 design-screenshot-pipeline 时，发现 `output/<theme>/` 下有完整旧产物阻断 fresh run，且当前 seed IR 的 `layout_contract.child_layout_groups` 为空，导致 gate 虚假通过但 feature-nav 结构化不完整。
- 注意事项：gate 通过 ≠ IR 结构化完整，需额外检查 child_layout_groups 非空；fresh restart 时不能复用任何旧 artifacts，必须从源设计图重新生成 seed；top nav / repeated items 必须在识别层就做 DOM-aligned hierarchy，不能靠下游修补；IR 文件可能很大（约 1MB），需用脚本定向抽取关键字段而非直接读取；任何 workflow 修改都需按 workflow-change-audit 审计要求收尾
- 未决问题：如何修复 gate 使其在 child_layout_groups 为空时报错而非通过；fresh seed 生成时如何确保 layout_contract 包含完整的 child_layout_groups；用户提到的「fast 模式」具体是什么，与当前 pipeline 的关系如何

### 2. 空记录 / no_wiki

- `id`：`codex_session_knowledge_a4d9739fdd8b4d6b80c75062c0c462f6`
- `pet_session_id`：`codex:019f63e9-5967-7042-a135-441c2a4ab598`
- 创建时间：`2026-07-15T10:02:51.329347+00:00`
- 摘要：无可复用知识内容；领域、概念、规则、方法、失败分类和验证规则均为空。

### 3. 空记录 / no_wiki

- `id`：`codex_session_knowledge_3d5710595aef493cac17a165dca5f7a3`
- `pet_session_id`：`codex:019f6463-e02f-7b91-8997-a94ce33236df`
- 创建时间：`2026-07-15T10:02:57.696910+00:00`
- 摘要：无可复用知识内容；领域、概念、规则、方法、失败分类和验证规则均为空。

### 4. 空记录 / no_wiki

- `id`：`codex_session_knowledge_33da9078389a4630bcb0f877157005d3`
- `pet_session_id`：`codex:019f64bc-e8a2-70a3-8584-53f2eab142ea`
- 创建时间：`2026-07-15T10:03:14.328148+00:00`
- 摘要：无可复用知识内容；领域、概念、规则、方法、失败分类和验证规则均为空。

### 5. 空记录 / no_wiki

- `id`：`codex_session_knowledge_270bdead0cc4418d88c85c46744ed5d0`
- `pet_session_id`：`codex:019f64e4-9832-7273-aaf7-a1bad3765552`
- 创建时间：`2026-07-15T10:03:22.653874+00:00`
- 摘要：无可复用知识内容；领域、概念、规则、方法、失败分类和验证规则均为空。

## 三、已确认长期记忆（1 条）

### Prompt fix not confirmed

- `id`：`codex_review_memory_8df1b15c65c94534b3956809d9d640fe`
- 类型：`blocker`
- 状态：`synced`
- 摘要/内容：The prompt change is still only described as upcoming.
- 标签：openclaw, prompt, schema
- 确认时间：`2026-06-18T09:28:50.142410+00:00`

## 四、项目领域知识候选（1 条）

### mmd-companion/integration/fastapi-outbound-openclaw-control-plane

- `candidate_id`：`dkc_outbound_control_plane_20260715_01`
- 状态：`ready_for_review`
- 当前修订：`1`
- 摘要：由 FastAPI 作为唯一跨机请求发起方，向 OpenClaw Control Plane 推送候选和结果，并轮询审核命令及发布回执的集成决策。
- 核心不变量：所有本地到远端网络请求由 FastAPI 发起。；OpenClaw 审核队列不直接获得本机仓库访问权。
- 适用范围：候选推送；审核命令轮询；命令结果回传；发布状态轮询
- 待验证/失败信号：HTTP status 非 2xx；cursor 未推进；命令重复应用

## 五、作者知识交接候选（5 条）

### 1. OpenClaw 来源白名单管理

- `local_id`：`openclaw-source-whitelist-admin`
- `candidate_id`：`candidate_7f09279d5590a36518d34dfc`
- 类型提示：`gate`
- 状态：`needs_repository_revision`
- 摘要：OpenClaw 审核接口来源白名单由 FastAPI 后台动态管理，未命中来源 403。
- 为什么可复用：后续接入 Hermes 等其他作者代理时，来源白名单需要按代理出口 IP 配置。
- 创建时间：`2026-08-07T06:02:35.832905+00:00`
- 待验证：OpenClaw 出口 IP 变化场景的 CIDR 规划

### 2. 知识交接包 sha256 字段契约

- `local_id`：`handoff-package-sha256-contract`
- `candidate_id`：`candidate_c0a307ad7002c1a3472b0c89`
- 类型提示：`contract`
- 状态：`needs_repository_revision`
- 摘要：交接包 .complete 与 metadata.artifacts 的 sha256 使用裸 64 位 hex。
- 为什么可复用：后续接入其它作者代理或交接包工具时，必须沿用同一 sha256 格式契约。
- 创建时间：`2026-08-07T06:02:35.832905+00:00`

### 3. Codex 作者知识交接触发规则

- `local_id`：`codex-knowledge-handoff-trigger`
- `candidate_id`：`candidate_d3863d4fd5822b5e31ca0e06`
- 类型提示：`rule`
- 状态：`needs_repository_revision`
- 摘要：每个实质任务准备最终回复前执行五项轻量知识变化判定，全部命中后才加载完整作者知识交接 Skill。
- 为什么可复用：该分层同时避免普通任务承担完整交接成本，并降低稳定知识变化因为 Skill 未加载而漏采的风险。
- 创建时间：`2026-08-11T09:43:17.221199+00:00`
- 待验证：Pet 到 FastAPI、OpenClaw 和 Obsidian 的生产端到端链路尚未在本轮重新验收

### 4. Codex 作者知识资产部署契约

- `local_id`：`codex-knowledge-assets-deployment`
- `candidate_id`：`candidate_eda462a0fc9f603cd11641a0`
- 类型提示：`contract`
- 状态：`needs_repository_revision`
- 摘要：仓库目录是 Hook、Skill 和轻量判定指令的唯一权威源，用户级 CODEX_HOME 只作为经过 staging、测试和哈希验证的运行副本。
- 为什么可复用：统一部署契约可以防止 Hook、Skill 和全局指令独立修改后发生格式漂移，并为升级失败提供可验证回滚路线。
- 创建时间：`2026-08-11T09:43:17.221199+00:00`
- 待验证：尚未验证其他操作系统或其他 CODEX_HOME 布局下的部署兼容性

### 5. 五档美术脸阴影

- `local_id`：`art-directed-face-shadow-states`
- `candidate_id`：`candidate_1c376172ad4b6cd220ac811e`
- 类型提示：`concept`
- 状态：`needs_repository_revision`
- 摘要：根据主光在头部局部空间中的左右方位，从五张独立美术遮罩中选择脸部主阴影形状，仅在相邻状态边界附近窄范围混合。
- 为什么可复用：后续 Blender 标定、Reze-K3 WebGPU 实现和其他二次元角色脸部渲染都需要共享相同的选档语义、遮罩通道和验证边界。
- 创建时间：`2026-08-11T11:21:02.997146+00:00`
- 待验证：五张真实克莱妲脸部遮罩尚未绘制；Blender V14D 渲染及表情验证尚未完成；Reze-K3 WebGPU 图集采样和跨实现视觉 Gate 尚未完成

## 六、交接与发布状态

- 交接包：3 个，状态均为 `received`。
- OpenClaw 交付记录：15 条，状态均为 `pending`，尚无 `ack_id`。
- 本地 publication receipt mirror：0 条。

| Gate 状态 | 数量 |
|---|---:|
| `needs_evidence` | 3 |
| `needs_repository_revision` | 5 |
| `ready_for_review` | 1 |

## 七、未计入知识条目的本地记录

| 表 | 数量 | 说明 |
|---|---:|---|
| `codex_review_items` | 1895 | Codex review 条目/流水，不等于已确认知识 |
| `desktop_pet_sessions` | 182 | Pet/Codex 会话，不等于知识 |
| `messages` | 6377 | 对话消息，不等于知识 |

## 八、解释

目前最稳妥的结论是：pet 已经抓到 12 条“知识相关记录”，但真正已成型或已同步的只有 2 条；1 条项目领域候选待审核，5 条作者交接候选都被仓库 revision 固定性门禁挡住，4 条会话知识记录没有提炼出可复用内容。
