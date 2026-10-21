# 运行中 Agent 会话与会话发现

## 中文名称与英文机器名

- 中文名称：运行中 Agent 会话
- 英文机器名：`ActiveAgentSession`
- 相关过程：会话发现（`AgentSessionDiscovery`）

## 概念定义

运行中 Agent 会话是机器或远程主机上已经启动、仍可通过事件、会话存储、进程或运行时接口观察到的编程助手会话。它可以由 Codex Desktop、Codex CLI、WSL CLI、Claude Code、Pet 自有 app-server 或受限远程主机创建，不要求由 Desktop Pet 启动。

会话发现是从多个 Agent Provider 收集这些会话事实，按稳定会话身份去重，补充运行方式、工作区、主机、状态和最近活动，并向 Pet 提供统一活动视图的过程。

## 解决的问题

当前 Pet 以当前选中的 `workspace` 和 `agent` 为入口，只扫描该上下文下的本地会话。这样会漏掉：

- 用户在另一个工作区打开的 Codex Desktop 会话；
- 用户从终端直接启动的 Codex CLI 或 WSL CLI；
- 用户未通过 Pet 启动的 Claude Code 会话；
- 运行在 `macCodex` 等远程主机上的 Agent；
- Pet 重启后仍在运行或刚刚完成的会话。

该概念把发现入口改为“会话事实”，把工作区变成会话属性，而不是发现前提。

## 适用与不适用场景

适用：

- Pet 启动、后台刷新或用户打开会话面板时，发现所有配置范围内的本地和远程会话；
- 需要同时展示多个工作区、多个 Agent 和多个运行方式；
- 需要把文件、进程、app-server 和 SSH 观察结果合并成一个会话对象；
- 需要向 FastAPI/OpenClaw 同步有界的会话摘要和状态。

不适用：

- 未经允许扫描整台机器、远程主机整个家目录或所有进程命令行；
- 保存完整 transcript、环境变量、token、私钥或完整命令输出；
- 把没有会话身份的孤立进程直接声称为已绑定 Agent 会话；
- 把远程项目目录发现等同于远程会话发现。

## 核心不变量

1. 会话发现不得依赖当前选中的工作区；工作区必须从会话元数据、远程 cwd 或受信运行时事实中生成。
2. 稳定会话身份优先使用 Agent 自己的 session id；同一会话被多个 Provider 观察到时只能生成一个展示对象，并保留多来源证据。
3. 文件更新时间、事件状态、进程存在和运行时心跳是不同证据，不能用任一单一信号替代全部活跃状态判断。
4. 进程存在不等于会话正在工作；文件更新时间也不等于进程仍连接。`running`、`idle`、`completed`、`failed`、`disconnected` 等状态必须有明确计算口径。
5. Codex Desktop 与 Codex CLI 即使共用 `.codex/sessions`，也必须通过 `originator`、运行时证据或主机信息尽可能区分；证据不足时标记来源不确定，不伪造精确来源。
6. 远程 `path` 只在远程 Provider 内消费，不得传给本地文件系统 API；远程 host identity 必须参与会话去重。
7. 对外只提供统一快照和订阅接口，Provider 的文件格式、进程命令、SSH 命令和 app-server 协议不得泄漏到 Pet UI 调用方。
8. 传给 FastAPI/OpenClaw 的内容必须是 bounded metadata/facts，不得把完整 transcript 变成新的持久化副本。

## 证据与计算口径

会话身份主键：

```text
host_identity + provider + agent_session_id
```

当 Agent 没有可用 session id 时，允许使用 `provider + normalized_workspace + started_at + bounded_title_hash` 生成低置信度候选，但必须标记为候选身份，不能覆盖有稳定 id 的记录。

Provider 证据优先级：

```text
app-server lifecycle/event
  > session file metadata/event stream
  > process/runtime observation
  > cached registry snapshot
```

活跃状态至少结合：

- 最近事件时间；
- 会话文件修改时间；
- 进程是否仍存在；
- app-server/远程连接是否存活；
- 最近事件是否为终态。

首期默认时间窗口建议为：

- 5 分钟内有非终态活动：`running` 或对应执行态；
- 超过活动窗口但仍有可识别会话：`idle`；
- 运行时退出且未收到终态：`disconnected`；
- 超过保留窗口的非活跃会话：`archived`。

这些窗口必须可注入时钟测试，最终数值不应散落在 UI 或 Provider 中。

## 正例

本机同时存在：

```text
Codex Desktop · D:\workspace\MMD project · running
Codex CLI     · D:\workspace\MMD project · waiting_approval
WSL Codex CLI · D:\workspace\Aether UI  · command_running
Claude Code   · D:\workspace\frontend   · idle
```

Pet 在没有选择任何工作区的情况下发现四条会话，按工作区和来源展示，并允许分别聚焦或恢复。

同一个 Codex session 同时被 JSONL 扫描器和进程增强器发现时，Pet 只显示一条记录，但保留 `session-file` 与 `process` 两类证据。

## 反例

- Pet 因用户选择了 `macCodex` 远程项目，就过滤掉本地 `D:\workspace\MMD project` 的 Codex Desktop 会话。
- 只因为 `ChatGPT.exe` 存在，就把所有最近 JSONL 会话归给同一个 Desktop 进程。
- 将 `/Users/sola/workspace/voice-workflow-service` 传给 Windows `fs.statSync`。
- 把 `desktop_pet_sessions` review registry 当成所有 Agent 的实时活动注册表。
- 为了显示最近输出，把完整 rollout transcript 写入 SQLite 或发送给 OpenClaw。

## 相关 contract/gate

- 统一会话发现快照与 Provider 接口；
- Pet Active Agents/More Sessions UI contract；
- `desktop_pet_sessions` 与新活动会话 registry 的分离 contract；
- 本地 Windows/WSL、Claude、远程 SSH 的 Provider 测试；
- 多工作区并发会话、去重、状态迁移和重启恢复 Gate；
- `desktop-pet` `npm run check`；
- API 相关 pytest 与真实 Windows 桌面验收。

## 失败后的修正路线

1. 本地会话文件存在但未发现：检查是否错误使用当前 workspace filter，随后检查 Provider 根目录和增量扫描缓存。
2. Desktop/CLI 来源无法区分：保留 `source=unknown`，增加进程或运行时证据，不根据猜测标记来源。
3. 进程存在但无 session id：显示“未绑定运行时”诊断项，不伪造会话记录。
4. 远程 SSH 不可用：保留最近成功缓存并明确标记 `cached_offline`，不得显示为实时运行。
5. API 不可用：Pet 继续使用本地发现快照，OpenClaw review/knowledge 同步进入待发送状态，不阻塞发现 UI。

## 与现有概念的关系

运行中 Agent 会话包含 Codex Desktop SSH 项目所代表的远程会话，但不替代远程项目目录。远程项目目录回答“远程有哪些可选仓库”，会话发现回答“哪些 Agent 正在这些仓库中运行”。

它也不同于“编程助手”：`agent=codex|claude` 是助手类型；`runtime=desktop|cli|wsl|remote|app-server` 是运行方式；同一 agent 可以有多个 runtime 和多个并发会话。
