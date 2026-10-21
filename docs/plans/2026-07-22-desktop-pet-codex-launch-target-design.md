# Desktop Pet Codex 启动目标设计

## 目标

Desktop Pet 为 Codex 提供两个可持久化选择的启动目标：

- `vscode-cli`：通过独立 VSCode 工作区窗口和 VSCode Helper 启动 Codex CLI。
- `codex-desktop`：通过 Windows 已注册的 `codex://` 协议打开 Codex Desktop 新任务编辑界面。

默认值保持 `vscode-cli`，避免升级后改变现有启动行为。

## 交互

右键菜单增加“Codex 启动工具”单选子菜单。用户选择后写入 Electron `userData/pet-settings.json`，Pet 重启后继续使用该选择。

“新建 Codex 会话”读取当前选择：

- `vscode-cli`：复用现有 `launchNewCodexSession()`、scoped terminal request、ACK 和 JSONL watcher。
- `codex-desktop`：打开 `codex://new?path=<当前工作区>`。Codex Desktop 显示绑定该工作区的新任务编辑界面；用户发送第一条消息后任务才正式创建。

该选择只影响 Codex 的新建会话。Claude 新建会话与历史会话恢复暂时保持现有 VSCode/CLI 链路。

## 组件与数据流

1. `petMenuModel.ts` 定义 `CodexLaunchTarget`、枚举值、菜单标签和 `codex-launch-target` 动作。
2. `petSettingsStore.ts` 负责校验、读取和写入 `codexLaunchTarget`。
3. 新增 `codexDesktopLauncher.ts`，只负责构建安全编码的 deeplink 并调用注入的 `openExternal`。
4. `main.ts` 在启动时读取设置，在菜单模型中传入当前值，并在动作分发时持久化选择。
5. `new-session` 分支仅当当前 agent 为 `codex` 且目标为 `codex-desktop` 时调用 Desktop launcher；其他情况保持原路径。

## 错误与状态

Codex Desktop 启动成功时发布 `launched` 状态并向 renderer 发送原有 `new-session` 菜单动作。协议打开失败时发布 `failed`，记录 `codex-desktop-launch:new-session-error`，不自动回退 VSCode，避免用户选择与实际启动工具不一致。

## 验证

- 设置读取、非法值丢弃、合并写入。
- 菜单默认值、单选状态和中英文标签。
- deeplink 的 Windows 路径、空格、`#`、`&` 等字符编码。
- 主进程 Codex Desktop/VSCode/Claude 三条分支。
- 完整 `npm run check`。
- 无鼠标重启后检查进程与启动日志；真实 Codex Desktop 拉起由用户点击菜单验收。
