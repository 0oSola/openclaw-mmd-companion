# Codex 作者知识交接 Stop Hook

该目录提供 Codex Stop Hook 的作者交接捕获器。它只在最终回复包含：

```text
<!-- CODEX_KNOWLEDGE_HANDOFF_START -->
...
<!-- CODEX_KNOWLEDGE_HANDOFF_END -->
```

时工作；普通最终回复直接放行。

## 本地验证

```powershell
npm install
npm test
```

## 安装到用户级 Codex Hook

先在目标 `CODEX_HOME` 下安装该目录及其依赖，再把以下命令作为 Stop Hook 注册：

```text
node "<CODEX_HOME>\hooks\codex-knowledge-handoff\stop-hook.mjs"
```

当前实施票据不会自动修改 `C:\Users\KSG\.codex\hooks.json`，也不会启用全局 Hook。
启用前必须先通过本目录测试，并在隔离测试工作区验证无载荷、有效载荷和非法载荷三条
路径。

有效作者载荷必须由 Stop 事件提供真实 `session_id` 和 `turn_id`；缺少来源身份时会
阻止结束，避免重复 Stop 或跨会话复用同一个包。

安装后的包默认写入：

```text
<CODEX_HOME>\knowledge-handoffs\<workspace-key>\<handoff-id>\
```

运行时依赖 `yaml` 包的 YAML 1.2 safe mode；不要把 `node_modules` 复制进 Git。
