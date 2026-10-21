# 07 — 活动会话 Registry 与 OpenClaw 同步

**What to build:** 为所有 Agent 的活动会话增加独立的 bounded registry，并把稳定摘要接入现有 OpenClaw review/knowledge 链路，同时保持现有 Codex review registry 语义不变。

**Blocked by:** 03 — Claude 与 Pet 运行时会话融合；04 — 运行时增强与活跃状态生命周期

**Status:** ready-for-agent

- [ ] 新 registry 保存 agent、runtime、host、workspace、state、last activity 和 bounded context。
- [ ] API 路由具备 requester identity、幂等 upsert、限长和故障隔离。
- [ ] 不把完整 transcript、token、私钥或完整命令输出写入 registry。
- [ ] OpenClaw 只接收 bounded snapshot/facts，不读取本机或远程文件。
- [ ] 现有 `desktop_pet_sessions` Codex review API 与历史数据保持兼容。
