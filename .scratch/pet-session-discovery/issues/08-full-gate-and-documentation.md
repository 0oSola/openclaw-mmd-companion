# 08 — 全链路 Gate 与架构文档

**What to build:** 完成全局会话发现的性能、安全、并发、远程和真实桌面验收，并使系统拓扑、概念文档、测试报告与实际运行行为一致。

**Blocked by:** 02、03、04、05、06、07

**Status:** ready-for-agent

- [ ] `desktop-pet` 测试、类型检查和构建全部通过。
- [ ] API 相关 pytest 和 registry contract 测试全部通过。
- [ ] 真实 Windows 验收覆盖 Codex Desktop、Codex CLI、WSL CLI、Claude Code 和多个工作区。
- [ ] macCodex 远程会话验收覆盖实时、离线和安全边界。
- [ ] 证明菜单 popup 不被扫描阻塞，扫描范围、轮询、缓存和输出均有上限。
- [ ] 更新当前系统拓扑、工作流术语表、概念文档和验收证据。
