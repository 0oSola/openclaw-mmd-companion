# 03 — Claude 与 Pet 运行时会话融合

**What to build:** 将 Claude Code 和 Pet 自有 Codex app-server 会话接入统一发现快照，使本地不同 Agent/runtime 可以同时展示和去重。

**Blocked by:** 02 — 本地 Codex 全局会话发现

**Status:** in-progress

- [x] Claude Code 会话使用自身 cwd 和 session id 进入统一列表。
- [x] Pet 自有 app-server 会话使用 lifecycle/event 状态进入统一列表。
- [x] UI 能区分 Codex Desktop、Codex CLI、WSL CLI、Claude Code 和 Pet app-server。
- [ ] 同一 session 被多个来源观察时只显示一条记录，并保留来源证据。
- [x] Provider 单独失败时不阻断其它 Provider 的发现结果。
