# 06 — macCodex 远程会话发现

**What to build:** Pet 通过受限 SSH 或远程 app-server 发现 macCodex 上配置范围内的 Agent 会话，并在本地统一展示远程 host 与 cwd。

**Blocked by:** 04 — 运行时增强与活跃状态生命周期

**Status:** ready-for-agent

- [ ] 只访问已配置的远程 host、白名单根目录和受限会话目录。
- [ ] 远程 session identity 包含 host identity，避免与本地同 id 冲突。
- [ ] 远程实时成功、连接失败和离线缓存三种状态可区分。
- [ ] 远程 POSIX path 不进入本地文件系统 API。
- [ ] SSH 超时、输出上限、认证失败和远程命令失败均有可读修正路线。
