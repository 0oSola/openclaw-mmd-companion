# Codex 作者知识交接链路实施票据

本目录是 `2026-08-05-codex-author-knowledge-handoff-pipeline-v2.zh-CN.md`
对应的多会话实施票据集合。

## 当前状态

`KH-01` 已在独立 worktree `C:\w\kh-01` 完成实现和验证，但尚未在本票据整理动作中提交。
后续实施会话应以 KH-01 的已提交版本作为起点，不得从主工作区的脏改动重新创建基础。

后续票据必须按以下顺序执行：

```text
KH-01
  ↓
KH-02 Pet 扫描与运输
  ↓
KH-03 FastAPI 接收、证据、Gate 与 reconciliation
  ↓
KH-04 OpenClaw 双审核与 Obsidian 发布
  ↓
KH-05 旧链切断、SQLite 恢复与端到端启用
```

## 阻塞边

| 票据 | 必须先完成 | 不能提前做的事情 |
| --- | --- | --- |
| `KH-02` | KH-01 已提交 | 不读取普通 Review 记录，不判断知识价值 |
| `KH-03` | KH-02 已提交 | 不查询 Vault，不创建发布 Change Set，不触碰真实损坏 SQLite |
| `KH-04` | KH-03 已提交且能提供 `ready_for_review` | 不绕过 FastAPI，不把原始 3+N 包直接写入 Obsidian |
| `KH-05` | KH-04 已提交；SQLite 副本恢复通过 | 不在真实 DB 上直接修复，不提前启用 feature flags |

## 全局不变量

所有票据都必须保持：

```text
Codex → Pet → FastAPI → OpenClaw → Obsidian
```

- FastAPI 是仓库证据、状态账本和确定性 Gate 的所有者。
- OpenClaw 是内容审核、Vault 主题解析、发布审核、Accepted Wiki Change Set
  冻结和 Publisher 的所有者。
- Obsidian 只接收审核通过后的规范知识。
- 发布回执可以异步镜像回 FastAPI，但不得形成
  `FastAPI → OpenClaw → FastAPI → OpenClaw` 的二次发布回跳。
- knowledge feature flags 在 KH-05 的完整端到端验收前保持关闭。
- 不得把计划、fixture、测试 Vault 或 shadow candidate 写成真实完成证书。

## 新实施会话通用首条指令

```text
先完整阅读：
1. AGENTS.md
2. docs/plans/2026-08-05-codex-author-knowledge-handoff-pipeline-v2.zh-CN.md
3. docs/architecture/current-system-topology.md
4. workflow/concepts/codex-author-knowledge-handoff.zh-CN.md
5. 当前票据文件

本票据中的角色边界、单向数据流、3+N 作者契约和停止条件已经冻结。
不要重新设计这些内容。先检查主工作区 Git 状态和全部 worktree，
再从本票据指定的已提交 base commit 创建 C:\w\<短票据标识> 独立 worktree
和 codex/<分支名> 分支。

保持 knowledge feature flags 关闭；不得从主工作区复制脏改动；
不得修改真实 api/data/sqlite/trace.db。每阶段按：
问题证据 → 实现 → 测试/Gate → 结论边界
汇报。
```

