# 04 — 运行时增强与活跃状态生命周期

**What to build:** Pet 持续发现已经运行的 Agent，并结合文件、事件、进程和运行时信号判断 running、idle、completed、failed 和 disconnected。

**Blocked by:** 02 — 本地 Codex 全局会话发现；03 — Claude 与 Pet 运行时会话融合

**Status:** in-progress

- [x] Pet 启动后自动刷新全局会话，不要求用户先打开右键菜单或先选择工作区。
- [x] 进程观察能够补充 runtime、pid 和 startedAt，但不能凭孤立进程伪造 session。
- [x] 活跃状态使用集中计算规则和可注入时钟。
- [x] 支持多个工作区、多个 Agent、多个并发会话。
- [x] workspace/agent 切换不会让旧异步结果覆盖全局发现快照。
- [x] 扫描与刷新不进入原生菜单 popup 临界路径。

实现边界：当前进程观察器仅对 Windows 上已有的 app-server PID 做生命周期复核；它不会把无法关联稳定 session id 的普通 Codex Desktop、Codex CLI 或 Claude 进程转换成会话记录。PID 绑定会结合进程启动时间和会话创建时间做保守校验；非 Windows 平台和进程扫描失败不会把会话错误标记为已断开。远程主机进程 Provider、独立活动 registry 和更细粒度的跨 Provider session-id 关联仍属于后续阶段。
