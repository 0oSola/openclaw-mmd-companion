# 项目级 Blender MCP 接入

## 中文名称

项目级 Blender MCP 接入

## 英文机器名

`ProjectLocalBlenderMcp`

## 概念定义

项目级 Blender MCP 接入表示：当前 MMD 项目通过根目录 `.codex/config.toml` 单独启用 Blender 官方 Lab MCP 服务端，不把该服务写入 Codex 用户级全局 MCP 配置。Codex 使用项目专用 Python 运行时启动 `blender-mcp`，服务端通过 stdio 接收 MCP 请求，再经 `127.0.0.1:9876` 连接 Blender 5.1.1 中启用的官方扩展 `bl_ext.user_default.mcp`。

## 解决的问题

项目需要用 Blender 对 PMX/VMD 动作做真实变形网格、姿势和碰撞审查，但全局启用会把 Blender 工具暴露给不相关项目，旧的第三方 `blenderMCP-addon` 还会与官方桥接争用同一个本地端口。项目级配置、专用运行时和单一端口所有者共同收敛了这两个风险。

## 适用场景

- 当前 Codex 工作目录是 `D:\workspace\MMD project`。
- 需要对 PMX/VMD 导入、骨架姿势、网格碰撞或 Blender 离线动作修正做开发期诊断。
- Blender 5.1.1 已启动，官方 MCP 扩展已启用并能监听 `127.0.0.1:9876`。

## 不适用场景

- FastAPI、Next.js 或桌面 Pet 的生产运行链路。
- 其他项目的 Codex 任务。
- 以 MCP 工具结果替代动作验收 Gate、真实变形网格逐帧碰撞检查或正/左/右/后四视角视觉审核。
- 同时启用第三方 `blenderMCP-addon` 与官方扩展。

## 核心不变量

1. `blender_lab` 只能存在于本项目 `.codex/config.toml` 的项目配置层，不得追加到用户级 `C:\Users\KSG\.codex\config.toml`。
2. 官方 Blender 扩展 `bl_ext.user_default.mcp` 是 `127.0.0.1:9876` 的唯一桥接所有者；旧的 `blenderMCP-addon` 必须保持停用。
3. 官方 Python 服务端使用项目专用运行时，并将 `mcp` 固定为兼容官方入口的 `1.29.0`；不能让依赖解析到不兼容的 `mcp 2.0.0`。
4. 使用 MCP 工具前必须确认 Blender 实例正在运行且官方扩展已启用；服务端启动成功不等于 Blender 桥接已连接。
5. MCP 只提供开发期 Blender 操作和诊断能力，动作发布仍必须经过 `imgToAction/tools/motion_acceptance_gate.py` 以及四视角截图/GIF 和必要的网格碰撞审核。

## 证据与计算口径

- 项目配置：`.codex/config.toml` 的 `[mcp_servers.blender_lab]`。
- 服务端运行时：`C:\Users\KSG\.codex\project-mcp\mmd-project-blender-lab\venv\Scripts\blender-mcp.exe`。
- Blender 扩展状态：`bpy.context.preferences.addons` 包含 `bl_ext.user_default.mcp`，不包含 `blenderMCP-addon`。
- 连接证据：MCP `initialize`、`tools/list` 和 `tools/call(get_objects_summary)` 成功；后者返回默认场景中的 Cube、Light 和 Camera。
- 端口证据：Blender 官方桥接绑定 `127.0.0.1:9876`，同一时刻不得存在第二个桥接进程。

## 正例

从 `D:\workspace\MMD project` 启动 Codex 后，项目配置加载 `blender_lab`；Blender 5.1.1 启动官方扩展，MCP 服务端调用 `get_objects_summary` 返回当前场景对象，然后继续进行 PMX/VMD 网格审查。

## 反例

- 用 `codex mcp add` 把 Blender MCP 写入用户级全局配置，再声称它只对本项目启用。
- 官方扩展和 `blenderMCP-addon` 同时启动，导致 `9876` 端口冲突。
- 直接使用会解析到 `mcp 2.0.0` 的未锁定运行时，并把 `ModuleNotFoundError: mcp.server.fastmcp` 当成 Blender 本身故障。
- MCP 返回了骨骼代理数据，就跳过真实网格检查和动作验收 Gate。

## 相关契约与门禁

- `.codex/config.toml`
- `docs/architecture/current-system-topology.md` 第 16.1 节
- `imgToAction/tools/motion_acceptance_gate.py`
- `imgToAction/docs/motion_acceptance_gate.md`
- `imgToAction/docs/pmx_geometry_reference.md`
- `imgToAction/docs/mmd-bone-coordinate-system.md`

## 失败后的修正路线

1. `codex mcp list` 看不到 `blender_lab`：确认任务工作目录位于项目根目录，并检查 `.codex/config.toml` 的项目层加载。
2. 服务端入口导入失败：检查项目专用运行时的 `mcp` 版本，恢复到 `1.29.0`，不要升级到 `2.x`。
3. 无法连接 Blender：启动 Blender 5.1.1 并启用官方扩展，确认 `127.0.0.1:9876` 监听。
4. 端口冲突：停用旧的 `blenderMCP-addon` 或其他占用者，只保留官方扩展作为桥接。
5. MCP 诊断通过但动作发布失败：回到 `motion_acceptance_gate.py`、四视角截图/GIF 和变形网格碰撞路线，不把 MCP 连接成功当成动作验收通过。

## 与现有概念的关系

- “Blender MCP”是服务能力的总称；“项目级 Blender MCP 接入”进一步限定配置层、运行时和端口所有者。
- “动作生成验收 Gate”是发布阻断规则，项目级 Blender MCP 只能提供辅助证据，不能替代它。
- “Blender-first 思考动作 POC”消费该接入进行网格和姿势诊断，但其程序化生成脚本与 VMD 仍是动作源。
