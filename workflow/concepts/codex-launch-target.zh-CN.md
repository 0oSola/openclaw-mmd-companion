# Codex 启动目标

## 中文名称

Codex 启动目标

## 英文机器名

`CodexLaunchTarget`

持久化字段为 `codexLaunchTarget`，允许值为 `vscode-cli` 与 `codex-desktop`。

## 概念定义

Codex 启动目标表示 Desktop Pet 在执行 Codex 会话的新建、历史恢复或活动会话聚焦时，应把动作交给哪一个用户可见工具。它与“编程助手”分离：编程助手决定使用 Codex 还是 Claude，启动目标只细分 Codex 的入口。

## 解决的问题

用户既需要保留 VSCode 内置终端中的 Codex CLI 工作流，也需要从 Pet 直接拉起 Codex Desktop 新任务。单一路线无法同时满足终端型和桌面任务型工作方式。

## 适用场景

- 当前编程助手为 Codex。
- 用户从 Pet 右键菜单新建会话、恢复最近会话，或聚焦活动会话。
- 需要在重启 Pet 后保留默认启动工具。

## 不适用场景

- 当前编程助手为 Claude。
- Pet app-server 会话已经由 Pet 自己管理。
- 在已存在的 Codex Desktop 任务中发送后续消息。
- 无提示自动提交 Codex Desktop 第一条消息。

## 核心不变量

1. 默认值必须为 `vscode-cli`，升级不得改变既有行为。
2. `vscode-cli` 对本地工作区必须复用 scoped VSCode workspace、terminal request 和 ACK 路线；对已选择的受限远程项目，必须通过 `macCodex-pet` 在 Windows Terminal 中启动 SSH PTY，并在白名单工程目录执行 `/Users/sola-codex/.local/bin/codex`。远程路径、SSH Host 和 Codex 路径不得来自未验证的界面输入。远程 CLI 会话不读取本机 `CODEX_HOME`，不得启动本地 JSONL watcher 或伪造远端完成状态。
3. `codex-desktop` 的新建动作对本地工作区打开 `codex://new?path=<工作区>`；恢复或聚焦已有会话打开 `codex://threads/<codex_session_id>`。对 Codex Desktop SSH 远程项目的新建动作必须先显示 Pet 原生确认框，说明不能自动绑定或自动弹出项目选择器。确认后先复制远程路径，再打开 `codex://threads/new` 未绑定入口，因为当前协议不接受远程 `hostId` 或 `projectId`。无参数 `codex://new` 是空路由，不得用于远程降级；外部项目选择器快捷键依赖窗口焦点，也不得作为正式路线。取消不得打开 Desktop。所有路线都不模拟键盘或鼠标，不自动发送第一条消息。
4. Desktop 启动失败时不得静默回退到 VSCode。
5. 该设置影响 Codex 的新建、历史恢复和活动会话聚焦；Claude、Pet app-server 会话和显式“打开 VSCode 工作区”不受影响。

## 证据与计算口径

- 设置证据：Electron `userData/pet-settings.json` 中的 `codexLaunchTarget`。
- 菜单证据：“Codex 启动工具”子菜单中唯一勾选的 radio 项。
- Desktop 路由证据：新建日志 `codex-desktop-launch:new-session-requested`；恢复日志 `codex-desktop-launch:restore-session-requested`；聚焦日志 `codex-desktop-launch:focus-active-session`。已有会话 URI 必须为 `codex://threads/<codex_session_id>`。
- CLI 路由证据：本地工作区为既有 `codex-launch:new-session-requested` 与 VSCode terminal request ACK；受限远程工作区为 Windows Terminal 对 `macCodex-pet` 的 SSH 启动请求。
- 完成口径：单元/集成测试通过只能证明路由与 URI 构造；用户真实点击后 Codex Desktop 显示绑定工作区的新任务界面，才构成端到端验收。

## 正例

用户选择 `codex-desktop`，当前工作区为 `D:\workspace\MMD project`，点击“新建 Codex 会话”后系统打开 `codex://new?path=...`，Codex Desktop 显示该工作区的新任务编辑界面。

用户选择 macCodex 远程项目后点击新建任务，Pet 先显示原生确认框并列出主机与路径，明确说明不会自动弹出项目选择器；用户确认后系统复制路径并打开 `codex://threads/new`，状态提示用户在 Codex Desktop 中手工打开项目选择器并粘贴，不声称已经完成远程绑定。用户取消时不打开 Desktop。

用户选择 `MoMask · macCodex（受限）` 且启动目标为 `vscode-cli`，Pet 只接受目录记录中的 `macCodex-pet` 与 `/Users/sola/workspace/MoMask`，通过 Windows Terminal 建立 PTY SSH 并执行该受限账号的 Codex CLI。该账号可以读写两个受限工程根，但不能读取 `sola` 的 `.ssh`、`.codex`、Documents 或整个家目录。

## 反例

- 选择 Codex Desktop 后仍打开 VSCode。
- 当前 agent 为 Claude 时尝试用 Codex Desktop 启动 Claude。
- Desktop 协议失败后无提示地改走 CLI。
- 未经用户确认直接为远程项目调用 `codex://new`，或状态卡暗示 Codex Desktop 还会额外弹出项目确认框。
- 声称 Pet 能自动弹出 Codex Desktop 远程项目选择器，或依赖焦点不确定的外部快捷键模拟。
- 把工作区原始字符串直接拼接到 URI，导致空格、`#` 或 `&` 截断。

## 相关契约与门禁

- `desktop-pet/electron/petSettingsStore.test.ts`
- `desktop-pet/electron/petMenuModel.test.ts`
- `desktop-pet/electron/codexDesktopLauncher.test.ts`
- `desktop-pet/electron/mainIntegration.test.ts`
- 完整门禁：`desktop-pet` 目录执行 `npm run check`

## 失败后的修正路线

1. URI 构造失败：检查 `URL`/`URLSearchParams` 编码测试。
2. Windows 未注册协议：确认 Codex Desktop 安装状态，不回退到其他工具。
3. 工作区未绑定：核对 `path` 查询参数和目录存在性。
4. 菜单选择未持久化：检查 `pet-settings.json` 归一化与 merge 写入。
5. 错误路由到 VSCode：检查 `agent` 与 `codexLaunchTarget` 的联合条件。
6. 远程 CLI 启动失败：检查 `macCodex-pet` OpenSSH Host、主机密钥、受限账号的目录 ACL 与远端 Codex 可执行文件；不得退回到 `sola` 账号。

## 与现有概念的关系

- “编程助手”决定 `codex` 或 `claude`。
- “Codex 环境”决定 CLI 使用 Windows 或 WSL，仅适用于 `vscode-cli`。
- “Codex 启动目标”决定 Codex 新建、恢复和活动会话聚焦使用 VSCode CLI 或 Codex Desktop；“编程助手”仍决定 Codex 或 Claude。
- “工作区选择”提供两种启动目标共同使用的 workspace path。
