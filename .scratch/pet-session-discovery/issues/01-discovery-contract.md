# 01 — 会话发现契约与测试夹具

**What to build:** 建立运行中 Agent 会话和会话发现的统一契约，使后续 Provider 可以通过一个稳定接口向 Pet 提供会话快照。

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] 登记运行中 Agent 会话与会话发现的中文概念、机器名、边界和不变量。
- [x] 定义统一 session identity、agent、runtime、host、workspace、state、activity 和 bounded context 字段。
- [x] 定义 Provider 成功、部分失败、无稳定 session id 和远程离线的结果形状。
- [x] 提供固定时钟、最小 JSONL 和重复来源测试夹具。
- [x] 不改变现有 Pet 菜单行为，现有测试保持通过。
