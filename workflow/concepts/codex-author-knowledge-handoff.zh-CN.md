# Codex 作者知识交接

## 中文名称

Codex 作者知识交接

## 必要的英文机器名

`CodexAuthorKnowledgeHandoff`

## 概念定义

Codex 作者知识交接是 Codex 在完成实质任务且形成稳定领域语义变化后，向后续知识治理
链提交的人读会话交接和结构化知识候选。一次交接形成一个不可变的 `3+N` 包：
`handoff.md`、`marker.yaml`、Hook 生成的 `metadata.json`、一个或多个
`candidates/*.md`，以及表示原子落盘完成的 `.complete`。

整个包的权威级别是“作者提案”，不是正式领域知识。只有经过 FastAPI 仓库证据解析和
Gate，再经 OpenClaw 内容审核、Vault 主题解析和发布审核后，才允许写入 Obsidian。

## 解决的问题

旧链路把会话复盘、知识价值判断和 Obsidian 发布混在一起，导致：

- Review `accept` 被错误解释为知识发布授权；
- OpenClaw 根据 Review 摘要替 Codex 猜测知识正文；
- marker 同时承担入口索引和完整知识正文；
- FastAPI 与 OpenClaw 之间出现审核和发布回跳；
- 原始会话材料可能直接污染 Obsidian；
- 未提交代码和固定仓库证据没有清晰版本边界。

作者知识交接把“作者声明”“仓库证明”“内容审核”“发布审核”和“规范知识”拆成不同
生命周期对象。

## 适用场景

- Codex 完成功能实现、架构设计、规则修改、契约调整或稳定故障分类；
- 本轮新增、修改或废弃可复用的领域语义；
- 能够说明问题、原因、边界、不变量和证据定位提示；
- 需要把知识候选交给 Pet、FastAPI 和 OpenClaw 继续治理。

## 不适用场景

- 普通问答、状态汇报或机械格式修改；
- 尚未稳定的排障猜想；
- 没有知识变化的普通 Codex 会话；
- 普通 Review `accept`；
- 直接向 Obsidian 写入原始会话总结；
- 用 candidate 代替最终 canonical Note。

## 核心不变量

1. 数据主链固定为 `Codex -> Pet -> FastAPI -> OpenClaw -> Obsidian`。
2. 没有稳定知识变化时不输出空 marker，也不创建空包。
3. 有效包至少包含一个 candidate，且每个 candidate 对应一个独立主要检索意图。
4. Codex 只提供作者解释和证据提示，不创建 Evidence Reference ID。
5. Hook 只校验、分割、注入来源和原子落盘，不做知识判断。
6. `.complete` 创建后包不可修改；补充内容必须形成新 revision。
7. Pet 只运输，不判断知识价值。
8. FastAPI 负责固定仓库证据和确定性 Gate，不解析 Vault 主题。
9. OpenClaw 负责内容审核、主题解析、发布审核、Change Set 冻结和发布。
10. Obsidian 只接收审核通过的规范知识，不接收原始 3+N 包。
11. 普通 Review `accept` 不能产生知识候选或 Obsidian 写入。
12. 发布回执回传 FastAPI 只用于审计，不能形成二次发布回跳。

## 结构和计算口径

### 作者包

```text
%CODEX_HOME%\knowledge-handoffs\<workspace-key>\<handoff-id>\
├── handoff.md
├── marker.yaml
├── metadata.json
├── candidates\
│   └── <candidate>.md
└── .complete
```

### 版本口径

- `candidate_revision`：作者知识主张的不可变版本；
- `evidence_revision`：FastAPI 在固定 Git revision 上解析出的证据版本；
- `topic_id`：OpenClaw Vault Topic Resolution 后确定的正式主题身份；
- `change_set_id`：第二次审核通过后冻结的精确发布对象。

提交或推送代码可以增加 evidence revision，但不能静默修改 candidate revision。

## 正例

- Codex 完成 Pet 左键输入修复后，生成“Pet 左键输入路由规则”和“WebGPU 舞台矩形
  契约”两个独立 candidate；
- Hook 生成 metadata 和哈希后原子写入 `.complete`；
- Pet 在 FastAPI离线时保留包，恢复后幂等上传；
- FastAPI 等待代码进入 durable ref 后更新 evidence revision；
- OpenClaw 在同一审核任务中分别确认知识内容和精确 Obsidian diff。

## 反例

- 用户接受一次 Review 后直接创建 Obsidian retrospective 或 canonical Note；
- marker 中填写 `target_path`、`suggested_action` 或 `topic_id`；
- FastAPI 先把候选交给 OpenClaw审核，再取回 Change Set，又发送给 OpenClaw发布；
- candidate 带 `canonical: true` 或声称已经成为正式知识；
- Pet 根据关键词决定候选类型或合并主题；
- 无知识变化时输出 `no_knowledge` marker。

## 相关 contract/gate

- `docs/plans/2026-08-05-codex-author-knowledge-handoff-pipeline-v2.zh-CN.md`
- Codex Stop Hook YAML schema 和 validator；
- FastAPI Repository Evidence Resolver；
- FastAPI Domain Knowledge Gate；
- OpenClaw 两阶段审核契约；
- memory-wiki exact apply/lint/commit/push 契约；
- SQLite 完整性恢复 Gate。

## 失败后的修正路线

1. YAML 或引用校验失败：Hook 阻止 Stop，Codex 修正后重新输出完整载荷。
2. Pet 上传失败：保留本地包并按幂等键重试。
3. 缺仓库 revision：FastAPI 保持 `needs_repository_revision` 并等待提交。
4. 缺持久锚定：保持 `needs_durable_revision`，不得发布。持久锚定的判定口径见
   下方“Git 锚定判定口径（2026-09-14 修订）”。

## Git 锚定判定口径（2026-09-14 修订）

原口径把“工作区此刻干净”与“知识的 commit 已入库”混为一谈，导致工作区长期有
未提交改动时全部候选被 `repository_revision_not_fixed` 卡死。修订后的判定顺序：

1. 候选捕获时带 `head_commit` 且未脏：直接校验该 commit；
2. 捕获时缺失或处于未提交状态：reconcile 时恢复锚定到工作区当前 HEAD，证据按
   该 commit 读 blob 复核，工作区此刻是否还有别的未提交改动不影响判定；
3. commit 不存在于仓库：`needs_repository_revision`；
4. commit 已入库但不在配置的 durable ref 中：放宽到“挂在任意本地分支上即视为
   持久”（feature 分支上的知识同样有效，分支合入后自动升级为 durable ref 锚定）；
   不挂在任何分支上的孤儿 commit 仍为 `needs_durable_revision`；
5. `failure_classification`（失败分类）类知识免仓库锚定：bad case 教训的时效性
   高于代码锚定，只要求作者说明完整并如实标注 `pending_verification`；
6. 证据命令复核在 `git worktree add --detach` 的临时工作树中执行，不依赖主工作区
   的清洁度。

配套防护：外部监视器推送的 git 事件按 30 秒防抖（可用
`CODEX_AUTHOR_KNOWLEDGE_GIT_EVENT_DEBOUNCE_SECONDS` 调整），且 reconcile 全链路
共享一把互斥锁，避免 git 进程洪峰拖垮 API。
5. 缺证据或作者解释：生成有界补充请求，由用户显式创建新的 Codex 任务。
6. 内容审核拒绝：保留审核事实，不进入 Vault Topic Resolution。
7. Vault base hash 变化：废弃旧 proposal，重新查询并生成新 diff。
8. lint、commit 或 push 失败：不得标记 published，保留失败阶段和可重试信息。

## 与现有概念的关系

- 它取代 Review Memory 作为知识入口的旧设计，但不删除 Session Evidence 和 Review
  决定本身。
- 它把现有 Domain Knowledge Candidate 的作者来源前移到 Codex。
- 它复用 FastAPI Repository Evidence Resolver 和 Gate，但把 Vault Topic Resolution
  和 Accepted Wiki Change Set 所有权移到 OpenClaw。
- memory-wiki 仍是 Obsidian 查询和发布接口，不是最终目的地或独立 Resolver。
