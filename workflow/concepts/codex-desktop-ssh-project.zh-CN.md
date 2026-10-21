# Codex Desktop SSH 项目

## 中文名称与英文机器名

- 中文名称：Codex Desktop SSH 项目
- 英文机器名：`CodexDesktopProject`

## 概念定义

Codex Desktop SSH 项目是 Codex Desktop 自己登记并通过 SSH 管理的远程项目对象。其身份由 `projectId`、`projectKind`、`hostId` 和远程 `path` 共同表达，显示信息可使用 `label` 与 `hostDisplayName`。

## 解决的问题

让 `desktop-pet` 能选择 Codex Desktop 的远程项目，而不会把远端 Unix 路径误当作 Windows 本地目录，也不会把 Codex Desktop SSH 连接误建模为 VS Code Remote-SSH。

## 适用与不适用场景

- 适用：Codex Desktop 日志或已确认的 Desktop 项目数据中出现 `hostId=remote-ssh-codex-managed:<name>` 的项目。
- 不适用：仅存在 VS Code `vscode-remote://` URI、但没有 Codex Desktop 项目证据的工作区；普通本地目录仍使用本地工作区模型。

## 核心不变量

- `projectKind` 为 `remote` 时，`path` 是远程 cwd，不得执行本地 `statSync`。
- `hostId` 必须保留 Codex Desktop 的主机身份，不得改写为 VS Code authority 或普通 SSH 主机字符串。
- 选择远程项目时使用独立的 `selectedCodexDesktopProject` 设置，不覆盖本地 `selectedWorkspacePath`。
- 未确认官方远程新任务协议前，不得伪造 app-server IPC 或声称已直接创建远程任务。

## 证据与计算口径

当前发现器从 Codex Desktop 日志中的线程记录提取 `hostId`、`cwd` 和可用的 `projectId`；缺少 `projectId` 时仅生成稳定的本地候选标识。发现结果不是 Codex Desktop 私有项目注册表的等价替代，需把该边界保留在实现和验收报告中。

## 正例与反例

正例：

```json
{
  "projectId": "eed427f0-87cd-4179-a070-acedbd2dca98",
  "projectKind": "remote",
  "label": "voice-workflow-service",
  "path": "/Users/sola/workspace/voice-workflow-service",
  "hostId": "remote-ssh-codex-managed:macCodex",
  "hostDisplayName": "macCodex"
}
```

反例：把 `/Users/sola/workspace/voice-workflow-service` 传给 Windows `fs.statSync`，或转换成 `vscode-remote://ssh-remote+macCodex/...` 后声称它就是 Codex Desktop 项目。

## 相关 contract/gate 与失败修正路线

- 相关 contract：`selectedCodexDesktopProject` 设置结构、`CodexRemoteWorkspace` 菜单数据结构。
- 相关验收：`PET-INT-084`、`PET-INT-086`，以及真实 Codex Desktop 菜单手工验收。
- 失败修正：若日志无法发现项目，提示刷新/先在 Codex Desktop 打开项目；若远程新任务协议仍未确认，只打开 `codex://` 并提示用户在 Desktop 中选择项目，不退回 VS Code Remote-SSH。

## 与现有概念的关系

该概念与本地 `selectedWorkspacePath` 并列，与历史 VS Code Remote-SSH URI 发现逻辑兼容但不等同。它属于 Codex Desktop 外部应用集成边界，而不是后端 `/codex/workspaces` 本地路径登记模型。

