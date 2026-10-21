# KH-05：旧链切断、SQLite 安全恢复与端到端启用

## 票据状态

- 状态：`blocked_until_KH-04_and_sqlite_copy_recovery`
- 依赖：`KH-04`
- 额外前置条件：SQLite 副本恢复 Gate 通过
- 推荐独立 worktree：`C:\w\kh-05`
- 推荐分支：`codex/kh-05-cutover-e2e`

## 目标

在所有前置阶段已经通过后，切断旧 Review v1 知识副作用，安全处理损坏的 SQLite
派生 outbox，分阶段启用新链路，并取得真实：

```text
Codex → Pet → FastAPI → OpenClaw → Obsidian
```

端到端验收证书。

本票据是唯一允许处理旧链切换和启用边界的票据，但真实 SQLite 恢复必须严格按
“先备份、只在副本实验、证据通过后再切换”的顺序执行。

## 阶段 A：只读停线与基线

在任何数据库写入或 feature flag 修改前：

1. 停止 FastAPI、Pet 和所有可能写库的进程；
2. 记录完整 Git 状态、运行配置和当前 feature flags；
3. 备份 `trace.db`、WAL 和 SHM 到独立备份目录；
4. 对备份执行哈希和可恢复性记录；
5. 对真实数据库只做只读检查；
6. 确认新链路仍然关闭。

如果备份不完整、进程无法停止或数据库来源不清楚，必须停止票据，不得继续。

## 阶段 B：只在副本上恢复和验证 SQLite

只允许在副本上：

1. 创建干净的新数据库 schema；
2. 迁移可读的核心业务表和 Session Evidence；
3. 有证据地废弃旧 Review v1 派生表和损坏的
   `codex_knowledge_extraction_outbox`；
4. 不回填旧 Review candidate、Wiki payload、memory draft 或低价值历史记录；
5. 执行：

```sql
PRAGMA quick_check;
PRAGMA integrity_check;
```

6. 验证核心 API、Session Evidence 和 Review 决定仍可读取；
7. 记录迁移前后表清单、行数摘要、完整性结果和回滚路径。

副本恢复通过不等于真实数据库已经切换。没有明确的切换证据和可回滚备份，
不得覆盖或替换真实 `api/data/sqlite/trace.db`。

## 阶段 C：切断旧 Review v1 知识副作用

普通 Review 的新语义必须固定为：

```text
accept = 用户确认本次复盘描述正确
```

它不得再触发：

```text
codex_review_memory
codex_review_memory_draft
codex_review_memory_wiki_payload
codex_knowledge_extraction_outbox
Review → OpenClaw knowledge synthesis
Review accept → memory-wiki
```

应保留：

- Session Evidence；
- 用户 Review 决定；
- 核心会话、消息、账户和业务数据；
- 必要审计事实。

不实施：

- 历史 Review 记录回填；
- v1 candidate 到 v2 candidate 的自动迁移；
- 旧 Wiki source page 自动晋升为 canonical knowledge；
- 为旧链增加兼容读取器。

## 阶段 D：分阶段启用

启用必须具备可审计的阶段边界和回滚开关：

1. 所有 feature flags 默认保持关闭；
2. 先完成测试环境和副本数据库验收；
3. 先进行不写 Vault 的链路观察或等价安全阶段；
4. 观察 Pet、FastAPI Gate、OpenClaw 审核和 receipt mirror 的状态；
5. 确认旧 Review 路径无知识副作用后，才允许进入真实发布阶段；
6. 任何 Gate、SQLite、Vault、lint、commit、push 或回执异常都能回退到关闭状态。

不得通过修改默认配置、用户真实环境或未记录的临时变量绕过启用顺序。

## 阶段 E：真实端到端验收

必须使用真实 Codex 最终回复触发合法 3+N 包，不能只使用 fixture、shadow candidate
或模拟 Wiki 文件。

至少证明：

1. 有稳定知识变化的 Codex 回复生成合法 3+N 包；
2. 没有知识变化的普通会话不生成空包；
3. Pet 启动补扫、离线、重启和重复扫描不丢包、不重复；
4. FastAPI 保存 immutable package 和 candidate revision；
5. 未提交、仅本地提交、durable commit 的状态转换正确；
6. Repository Resolver 创建固定版本 Evidence Reference；
7. Gate 阻断状态和修正路线正确；
8. OpenClaw 完成两个独立批准；
9. OpenClaw 冻结并原样执行 Accepted Wiki Change Set；
10. Obsidian 只出现审核后的 canonical knowledge；
11. stale base hash、lint 失败和 push 失败均不会标记 published；
12. Publication Receipt 可审计且不会形成 FastAPI 回跳发布；
13. Review accept 不触发任何知识或 Wiki 副作用；
14. SQLite 完整性检查为 `ok`；
15. `docs/architecture/current-system-topology.md` 与实际运行系统一致。

## 非目标

- 不恢复历史低价值知识；
- 不把旧 outbox 数据强行转换成 v2 candidate；
- 不在真实数据库损坏未处理时开启新链；
- 不把单元测试结果当作真实端到端证书；
- 不把 OpenClaw 的 receipt mirror 当作新的发布触发器；
- 不在失败后删除备份、失败记录或审计证据。

## 失败与回滚

以下任一情况发生时，保持 feature flags 关闭并回滚到安全状态：

- SQLite 副本 integrity check 失败；
- 核心 Session Evidence 不可读；
- Review accept 仍产生旧知识副作用；
- Pet 出现重复或丢包；
- FastAPI Gate 错误放行；
- OpenClaw 只完成一次批准；
- Publisher 修改了批准内容；
- Obsidian 出现原始 3+N 文件；
- stale base、lint、commit 或 push 失败后仍标记 published；
- receipt mirror 触发回跳。

回滚必须说明：

- 已恢复到哪个 feature flag 状态；
- 哪个数据库或 Vault revision 是最后安全版本；
- 哪些包、candidate、evidence 或 receipt 需要重试；
- 如何证明没有二次发布。

## 验收 Gate

必须完成以下 Gate：

1. 阶段 A 的备份、停止写入和只读基线证据齐全；
2. 阶段 B 只在副本上完成恢复，且 `quick_check` 与 `integrity_check` 均为 `ok`；
3. 阶段 C 的 Review accept 无知识和 Wiki 副作用；
4. 阶段 D 的 feature flag 变更可审计、可回滚；
5. 阶段 E 的真实 Codex → Obsidian 端到端验收全部通过；
6. 任意失败路径均保持关闭状态，不得误标记 published。

## 需要提供的验收证据

- SQLite 备份路径、哈希、只读检查和副本恢复报告；
- 副本 `quick_check`/`integrity_check` 输出；
- 旧链切断测试；
- 分阶段 feature flag 变更和回滚记录；
- 一次真实 Codex → Obsidian 端到端证书；
- 失败路径和回滚演练证据；
- 最终拓扑文档差异；
- 明确列出尚未解决的外部依赖或人工操作。

## 交接要求

交给维护或发布会话时必须明确：

```text
真实数据库是否仍保持未切换；
当前 feature flag 状态和可用回滚点；
端到端证书覆盖的真实对象和未覆盖范围；
失败包、candidate、evidence 和 receipt 的重试方式；
旧链切断后仍保留的 Session Evidence 与审计事实。
```

## 完成判定

只有当本票据所有阶段和端到端证据齐全时，才能声称整条知识链路完成。
任何“计划已写入”“fixture 通过”“单元测试通过”都不能单独替代完成证书。
