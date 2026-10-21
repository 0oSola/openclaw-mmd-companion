# 远程项目目录

## 中文名称与英文机器名

- 中文名称：远程项目目录
- 英文机器名：`RemoteProjectCatalog`

## 概念定义

远程项目目录是 Desktop Pet 对远程仓库发现、合并、缓存、选择和打开降级行为的统一模块。它把 Codex Desktop 正式项目注册表、受限系统 SSH Git 扫描和最近成功缓存合并为稳定的远程项目目标列表。

## 解决的问题

避免菜单直接理解 Codex Desktop 日志、SSH 命令、项目去重和打开协议；同时区分“已加入 Codex Desktop 的项目”和“仅通过 SSH 发现的 Git 仓库”。

## 适用与不适用场景

- 适用：Desktop Pet 需要列出、搜索、收藏、选择或刷新远程主机上的项目。
- 不适用：本地工作区选择、完整远程文件管理器、未受限的整机文件扫描。

## 核心不变量

- 项目目标身份使用主机配置身份与规范化远程路径，不使用自行猜测的打开 URL。
- Codex Desktop 正式 `projectId` 与 Pet 自己的 `projectKey` 不得混同。
- 系统 SSH 只扫描显式允许的绝对根目录，并设置深度、超时、输出和数量上限。
- Pet 不保存 SSH 密码、私钥正文或密钥口令。
- 未经真实导航验收，不得声称已一键打开远程 Codex Desktop 项目。

## 证据或计算口径

- 合并主键：`hostProfileId + normalizePosixPath(remotePath)`。
- 事实优先级：Codex Desktop 正式注册表 > 当前 SSH 扫描 > 最近成功缓存 > Desktop 日志历史。
- “获取所有项目”只表示配置扫描根与最大深度范围内的 Git 仓库，不表示整台远程机器的全部目录。

## 正例

Codex Desktop 注册表与 SSH 扫描同时发现 `/Users/sola/workspace/voice-workflow-service` 时，合并成一个 `desktop_registered` 项目，并保留正式 `projectId`。

## 反例

- 将任意日志 `cwd` 直接当成当前存在的 Git 仓库。
- 扫描 `/` 或整个 `/Users/sola`。
- 猜测 `codex://project?projectId=...` 并作为正式打开链接。

## 相关 contract/gate

- 数据契约：`RemoteProjectTarget`、`RemoteHostProfile`、`RemoteProjectCatalogSnapshot`。
- 安全 gate：SSH 非交互认证、允许根目录、最大深度、超时、输出上限、项目数量上限。
- 交互 gate：只有真实导航成功后才能显示“已打开远程项目”。

## 失败后的修正路线

- SSH 不可用：显示 Desktop 正式注册表与最近成功缓存。
- Desktop 注册表不可用：显示 SSH 扫描结果，并标记“尚未加入 Desktop”。
- 导航协议不可用：先由 Pet 原生确认框说明不能自动绑定或自动弹出项目选择器；用户取消时不执行打开，确认后复制远程路径并打开 `codex://threads/new` 未绑定新任务入口，再提示用户在 Codex Desktop 中手工打开项目选择器并粘贴，不伪造已经绑定成功。无参数 `codex://new` 和外部快捷键模拟都不属于有效降级路线。

## 与现有概念的关系

远程项目目录包含并统一消费“Codex Desktop SSH 项目”，但不替代本地 `selectedWorkspacePath`。它为未来官方远程导航 adapter 保留 seam，同时不依赖该 adapter 才能完成项目发现和选择。
