# Pet 运行中 Agent 会话发现规格

## Problem Statement

Desktop Pet 当前以用户选中的工作区和编程助手为扫描入口，只能可靠地读取当前上下文下的本地会话。用户在 Codex Desktop、Codex CLI、WSL CLI、Claude Code 或远程 macCodex 中启动的其它会话，可能已经存在并持续产生事件，但 Pet 不会自动发现，或者会因为当前远程项目选择而错误过滤本地会话。

这使 Pet 不能回答用户最基本的问题：“现在机器或远程主机上有哪些编程助手正在运行，它们分别处理什么工作区和任务？”

## Solution

新增统一的会话发现模块。它并行消费多个 Provider，收集本地会话文件、运行时事件、进程观察和受限远程会话事实，按稳定 session id 去重，反向生成工作区归属，计算活跃状态，并向 Pet UI 与 FastAPI 提供统一 bounded snapshot。

首期覆盖：

- Windows 本地 Codex Desktop；
- Windows 本地 Codex CLI；
- WSL Codex CLI；
- Claude Code；
- Pet 自有 Codex app-server 会话；
- 已配置并通过安全 Gate 的 macCodex 远程会话。

其它 Agent（如 Cursor、Windsurf、VS Code Agent）保留 Provider 扩展点，首期不声称已经支持。

## User Stories

1. 作为 Pet 用户，我希望不选择工作区也能看到当前运行中的会话，以便快速了解所有编码任务。
2. 作为 Pet 用户，我希望同时看到多个工作区的会话，以便不必反复切换上下文。
3. 作为 Pet 用户，我希望看到会话来自 Codex Desktop、Codex CLI、WSL CLI 还是 Claude Code，以便判断应该在哪里继续操作。
4. 作为 Pet 用户，我希望 Pet 能发现我直接从终端启动的 Codex CLI，而不要求该会话由 Pet 创建。
5. 作为 Pet 用户，我希望 Pet 能发现当前正在运行的 Codex Desktop 会话，即使 Pet 当前选择了另一个项目。
6. 作为 Pet 用户，我希望 Pet 能发现 WSL 中运行的 Codex CLI，并正确显示对应的 Windows 工作区。
7. 作为 Pet 用户，我希望 Pet 能发现 Claude Code 会话，并与 Codex 会话使用统一列表。
8. 作为 Pet 用户，我希望多个 Provider 同时观察同一 session 时只显示一条记录。
9. 作为 Pet 用户，我希望看到 running、command running、waiting approval、idle、completed、failed 和 disconnected 等状态。
10. 作为 Pet 用户，我希望 Pet 重启后仍能恢复最近活动会话的识别结果。
11. 作为 Pet 用户，我希望点击本地会话时能聚焦或恢复对应工具窗口。
12. 作为 Pet 用户，我希望远程会话明确显示主机和远程路径，而不是伪装成本地目录。
13. 作为 Pet 用户，我希望远程 SSH 暂时不可用时看到离线缓存标记，而不是错误地显示实时状态。
14. 作为 Pet 用户，我希望某个 Provider 出错时其它 Provider 仍然可用。
15. 作为项目维护者，我希望会话发现不阻塞原生右键菜单和 Pet 启动。
16. 作为项目维护者，我希望完整 transcript、token、私钥和完整命令输出不会被写入新的 registry。
17. 作为 OpenClaw review 链路，我希望收到 bounded session facts，而不是直接读取本机或远程 transcript。
18. 作为测试维护者，我希望可以用固定时间和测试 Provider 验证活跃状态与去重，而不依赖真实进程。

## Implementation Decisions

- 本轮垂直切片交付本地 Codex/Claude 文件 Provider、Pet app-server Provider 和统一菜单快照；进程增强、远程 Provider、独立活动 registry 仍是后续切片，不能按已接入能力验收。
- 会话发现对外形成一个深模块：调用方只知道刷新、读取快照和订阅变化；Provider 细节留在模块内部。
- 工作区由 session metadata、远程 cwd 或受信 runtime evidence 反向生成，不再作为发现前的全局过滤条件。
- Codex Desktop 与 Codex CLI 共用 `.codex/sessions` 时，优先使用 `originator`、`source`、进程和运行时证据区分；证据不足则使用 unknown，不猜测。
- Provider 采用可替换适配器：Codex local session、Claude local session、Pet app-server、local process enrichment、remote SSH/app-server。
- 稳定身份优先使用 `host_identity + provider + agent_session_id`。没有稳定 id 时只能生成低置信度候选身份。
- 活跃状态由事件、文件修改时间、进程、运行时心跳和终态共同计算，时间窗口集中在状态模块并可注入时钟。
- 进程观察只负责补充 runtime/pid/startedAt 等事实，不单独创建已绑定 session。
- 远程 Provider 只访问配置允许的主机、根目录和会话目录；远程 POSIX path 不进入 Windows 本地文件系统 API。
- 现有 `desktop_pet_sessions` 继续作为 Codex review metadata registry；本地全局发现快照在独立 registry 接入前只读展示，旧 review upsert 仅保留当前选中 Codex 工作区的兼容路径，避免观察其它工作区就改变既有 review 语义。
- 发送给 FastAPI/OpenClaw 的快照只保留 title、workspace、status、last activity、bounded output、changed files 和 evidence metadata。
- UI 按“活动优先、工作区分组、来源标记”展示；历史会话作为次级列表，不再以当前 workspace 作为唯一入口。

## Testing Decisions

- Provider 测试使用公开 discovery interface，不测试私有扫描实现细节。
- Codex/Claude 文件测试使用最小 JSONL fixture，覆盖不同 cwd、originator、状态事件和并发文件。
- 去重测试必须用“同一 session 被文件 Provider、进程 Provider 和 API Provider 同时发现”的独立预期数据。
- 状态测试使用 fake clock，覆盖 running → idle、running → completed、running → disconnected 和等待审批。
- 主进程集成测试验证 Pet 启动、renderer 完成加载、后台刷新、workspace 切换和旧异步结果隔离。
- API 测试验证活动 registry 的权限、bounded payload、幂等 upsert、过期状态和 Provider 故障隔离。
- 真实桌面验收至少覆盖本地 Codex Desktop、Codex CLI、WSL CLI、Claude Code 和多个工作区并发；远程验收单独覆盖 macCodex。
- 性能测试验证会话发现不发生在原生菜单 popup 临界路径内，并限制扫描文件数、输出大小、轮询频率和缓存增长。

## Out of Scope

- 首期不支持 Cursor、Windsurf、VS Code Agent 等没有已确认存储/运行时契约的工具。
- 不实现对 Codex Desktop 私有 IPC 或私有项目选择器的猜测性调用。
- 不把完整 transcript 同步到 Codex Desktop、FastAPI、SQLite 或 OpenClaw。
- 不实现远程主机的任意文件浏览器。
- 不改变现有 Codex interactive app-server 的 approval、diff、apply 安全边界。
- 不因为发现会话就自动向 Agent 发送消息、自动批准或自动恢复任务。

## Further Notes

实施必须在独立短路径 worktree 中进行。当前主工作区存在与本任务无关的未提交修改，不能作为实现工作区直接编辑。

实现顺序采用垂直切片：先让本地 Codex Desktop/CLI/WSL 全局发现可见，再加入 Claude/app-server、运行时增强、远程 Provider、持久化和 OpenClaw 同步。每个切片都必须有独立可运行的测试和可观察的用户行为。
