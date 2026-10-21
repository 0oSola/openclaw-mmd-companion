# KH-02：Pet 扫描与交接包运输

## 票据状态

- 状态：`ready`
- 依赖：`KH-01`
- 被阻塞的后续票据：`KH-03`
- 推荐独立 worktree：`C:\w\kh-02`
- 推荐分支：`codex/kh-02-pet-transport`

## 目标

让 Pet 成为作者交接包的可靠运输器：

```text
%CODEX_HOME%\knowledge-handoffs\
        ↓
Pet 扫描、校验、排队、上传
        ↓
FastAPI 接收
```

Pet 只负责发现和可靠运输，不判断候选是否有知识价值，也不改变作者内容。

## 已确认的行为

Pet 必须支持：

1. 启动时扫描所有已完成的 `.complete` 包；
2. 运行时监听新增或完成的交接包；
3. 校验包清单和 manifest hash；
4. 使用 `handoff_id + package_sha256` 作为幂等上传键；
5. FastAPI 不可用时保存本地离线队列并按退避策略重试；
6. 只有收到 FastAPI 的持久化 ACK 后，才记录为已送达；
7. 将 commit、checkout、push 等 Git 事件作为加速提示发送给 FastAPI；
8. Pet 重启后恢复未完成队列，不丢包、不重复上传；
9. 已送达原始包仍然保留，不能由 Pet 自动删除。

## 实现边界

### Pet 允许做的事情

- 读取本机 `%CODEX_HOME%\knowledge-handoffs`；
- 识别 `.complete` 已存在且目录结构完整的包；
- 计算或复核包级 SHA-256；
- 保存本地运输状态和重试信息；
- 调用 FastAPI 的交接包接收接口；
- 发送 Git 事件提示；
- 输出诊断日志或复用现有诊断面板。

### Pet 禁止做的事情

- 修改 `handoff.md`、`marker.yaml`、`metadata.json` 或 candidate；
- 认证 Git commit 是否可达 durable ref；
- 创建 Evidence Reference；
- 执行 FastAPI Gate；
- 查询 Obsidian 或 memory-wiki；
- 决定新建、更新、合并或替代哪个知识主题；
- 根据关键词给 candidate 分类；
- 删除已送达的作者原始包；
- 直接调用 OpenClaw。

## 运输契约要求

KH-02 必须把运输边界做成独立适配器，使 KH-03 可以实现对应 FastAPI 接收端。
至少要固定以下语义：

```text
请求：
  handoff_id
  package_sha256
  workspace_key
  完整 3+N 包内容或受控的包文件映射

响应：
  accepted / duplicate / rejected
  服务端持久化确认标识
  可重试或不可重试的错误原因
```

具体 HTTP 路径和编码方式可以依据现有 API 约定确定，但不能把运输成功
等同于 Gate 通过或 OpenClaw 审核通过。

ACK 只有在 FastAPI 已经安全保存完整原始包后才可返回。网络响应成功但没有
持久化 ACK 时，Pet 必须保留队列项并重试。

## 非目标

- 不实现 FastAPI 的数据库模型；
- 不实现 Repository Evidence Resolver；
- 不实现 Gate；
- 不实现 OpenClaw 审核或 Obsidian 发布；
- 不处理旧 `codex_knowledge_extraction_outbox`；
- 不启用 knowledge feature flags；
- 不把 Git 提示当作唯一可靠触发来源。

## 验收 Gate

必须有自动化测试和可复核证据覆盖：

1. 启动补扫能发现历史 `.complete` 包；
2. 新包只在 `.complete` 出现后进入队列；
3. 同一 `handoff_id + package_sha256` 重复扫描只产生一次有效上传；
4. 包 hash 不一致会拒绝发送并保留错误状态；
5. FastAPI 离线时队列持久化，重启后继续发送；
6. 超时、连接失败和 5xx 会重试，明确的 4xx 不会无限重试；
7. ACK 前不能标记 delivered；
8. 重复 ACK 和重复响应不会破坏状态；
9. Git 事件提示丢失时，运输仍然依赖后续 reconciliation，而不是永久卡住；
10. 已送达包和失败包都不会被自动删除；
11. 扫描和运输日志不包含发送给 OpenClaw 的未脱敏本机绝对路径；
12. 运输链路不会直接访问 OpenClaw。

## 需要提供的验收证据

- Pet 扫描器、队列和运输适配器的文件路径；
- 请求、ACK、重试和幂等状态的测试输出；
- 断网、重启、重复扫描三组测试结果；
- Git 事件提示丢失后的恢复测试结果；
- `git diff --check` 和相关测试命令；
- 明确说明尚未实现 FastAPI Gate、OpenClaw 审核和真实端到端。

## 交接要求

完成后提交本票据所需代码和测试，并在交接中写明：

```text
KH-03 可以依赖的运输请求/ACK 契约；
KH-03 必须提供的服务端接口；
仍然未解决的网络、权限或路径风险；
启动新 Pet 实例时必须保持关闭的 feature flags。
```

