# 02 — 本地 Codex 全局会话发现

**What to build:** Pet 在不依赖当前选中工作区的情况下，自动发现 Windows Codex Desktop、Codex CLI 和 WSL Codex CLI 会话，并按会话自身的 cwd 生成工作区归属。

**Blocked by:** 01 — 会话发现契约与测试夹具

**Status:** completed

- [x] 扫描配置范围内的 Windows 和 WSL Codex session storage。
- [x] 同时发现多个工作区的会话，不受 `selectedWorkspacePath` 或远程项目选择影响。
- [x] 保留 Codex session id、originator、source、cli version、title、最近输出和状态。
- [x] 从 `session_meta.payload.id` 稳定获取 Codex Desktop `sessionID`，并以 `local:codex:<sessionID>` 作为统一记录身份。
- [x] 在 Pet 的 More Sessions/活动列表中显示至少两个不同工作区的本地 Codex 会话。
- [x] 对已有 Codex review upsert 保持兼容，不写入完整 transcript。

第一阶段现场验收：`2026-08-05` 在 `D:\workspace\MMD project` 发现 Codex Desktop 会话 `019fd15a-ae34-76d1-a99c-af48bf7b2ddf`，最近活动状态为 `command_running`。
