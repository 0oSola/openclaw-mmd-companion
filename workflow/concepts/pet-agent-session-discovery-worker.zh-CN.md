# Desktop Pet 会话发现 Worker

## 中文名称

Desktop Pet 会话发现 Worker。

## 必要的英文机器名

`agentSessionDiscoveryWorker`。

## 概念定义

会话发现 Worker 是由 Electron 主进程启动的独立 Node `Worker`，负责执行 Codex、Claude、Pet app-server 会话发现以及 Windows 进程增强。Worker 内可以进行同步 JSONL 文件读取、WSL 路径访问和 PowerShell 进程枚举；Electron 主进程只负责派发请求、接收可序列化结果、合并展示缓存和更新菜单/状态。

## 解决的问题

全局会话发现需要扫描多个 Provider 的目录和进程证据。扫描器包含同步文件系统操作，在 Electron 主进程执行时会阻塞窗口消息、IPC、原生拖动和菜单，表现为 Pet 窗口“未响应”。Worker 把这类阻塞风险限制在后台线程，使窗口交互和发现任务解耦。

## 定义与关系

- `main.ts` 是调度者和结果消费者，不再直接调用全局发现的同步扫描器。
- `agentSessionDiscoveryWorker.ts` 是 Worker 入口，调用既有 Provider 发现器并返回候选会话、进程观察和 Provider 错误。
- `agentSessionDiscovery.ts`、`codexSessionFiles.ts`、`claudeSessionFiles.ts` 和 `agentProcessScanner.ts` 是 Worker 内的证据生产者。
- `runAgentSessionDiscoveryInWorker()` 保证同一时间只有一个发现 Worker，并在 30 秒后终止超时 Worker。
- Worker 失败只影响本轮会话刷新，不得关闭 Pet 或阻塞主进程。

## 适用范围

- Pet 启动后的首次全局会话刷新。
- 15 秒周期刷新、菜单预热和需要全局 Agent 快照的本地状态更新。
- Codex/Claude JSONL 扫描、WSL 会话扫描、Pet app-server API 查询和 Windows 进程证据增强。

## 不适用范围与非例

- 当前工作区内的轻量状态读取不能因为本概念而改变为全局扫描。
- Electron 原生菜单构建、窗口拖动、IPC handler 和 MMD/WebGL 渲染不属于 Worker 的职责。
- 不得把 Worker 超时当作“没有会话”；调用方应保留旧缓存或显示刷新失败状态。

## 核心不变量

1. 同一时刻最多存在一个全局会话发现 Worker。
2. 同步扫描不得在 Electron 主进程调用栈中执行。
3. Worker 返回的数据必须是可结构化克隆的会话记录、进程观察和错误文本。
4. Worker 超时上限为 30 秒；终止后主进程仍必须可处理窗口交互。
5. 进程扫描未完成或失败时不能把缺失进程证据解释成断开状态。

## 证据与计算口径

Worker 结果由 `AgentSessionDiscoveryWorkerResult` 表示，包含 `candidates`、`processObservations`、`processScanCompleted` 和 `providerErrors`。主进程在接收后复用既有展示清洗、去重、排序和当前工作区 review upsert 规则。超时以 Worker 调度时的 30,000 毫秒定时器计算，不以单个 Provider 的内部耗时替代。

## 正例

WSL `CODEX_HOME/sessions` 访问缓慢时，Worker 最多运行 30 秒并被终止；Pet 主窗口仍能打开菜单、处理拖动和响应 IPC，日志记录本轮发现失败。

## 反例

在 `setInterval` 回调中直接调用 `scanRecentCodexSessionFiles()`，或为了避免错误把所有扫描移除并返回空列表；前者会复现未响应，后者会把“扫描失败”伪装成“无会话”。

## 相关 contract/gate

- `desktop-pet/electron/main.ts` 的 Worker 调度与超时边界。
- `desktop-pet/electron/agentSessionDiscoveryWorker.ts` 的结果结构和 Provider 错误分层。
- `desktop-pet/electron/mainIntegration.test.ts` 的“全局会话发现不在 Electron 主线程”回归检查。
- `desktop-pet` 的 `npm run check` 门禁。

## 失败后的修正路线

先确认 Worker 是否启动、是否在 30 秒内超时、Provider 错误是否被记录；再缩小具体 Provider 和路径。若 Worker 仍造成资源争用，应降低扫描频率或 Provider 上限；不得把扫描重新移回 Electron 主进程。若需要更细的进度反馈，应扩展可序列化 Worker 消息，而不是增加主线程同步日志或同步文件读取。

## 与现有概念的关系

该概念是“Pet 本地全局 Agent 会话发现”的执行隔离层，不改变会话身份、去重、展示清洗或 review registry 范围。它也不同于 MMD renderer Worker：前者处理文件/进程证据，后者若未来引入则处理图形资源或模型解析。

## 尚待验证

当前已在本机真实 Electron 冷启动、超过 15 秒刷新周期和 CDP IPC 响应上验证主进程不再卡死；尚未在不同 Windows 用户、超大 Claude 数据目录或多个并发 Pet 实例下做长时间资源曲线验收。

## 重新审查条件

当 Provider 扫描器改为纯异步、Electron 升级改变 Worker 模块加载方式、会话发现结果协议变化，或出现 Worker 超时导致菜单数据长期陈旧时，必须重新审查本概念、超时和缓存回退策略。
