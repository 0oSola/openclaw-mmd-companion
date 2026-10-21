# Desktop Pet Codex 启动目标 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Desktop Pet 可持久化选择使用 VSCode + Codex CLI 或 Codex Desktop 新建 Codex 会话。

**Architecture:** 在菜单模型和本地设置中增加 `CodexLaunchTarget`，通过独立纯函数启动器构建 `codex://new?path=` deeplink。Electron 主进程根据当前 agent 与启动目标路由到现有 CLI launcher 或新 Desktop launcher。

**Tech Stack:** TypeScript、Electron、Vitest、Windows URI protocol

---

### Task 1: 设置与菜单模型

**Files:**
- Modify: `desktop-pet/electron/petMenuModel.ts`
- Modify: `desktop-pet/electron/petMenuModel.test.ts`
- Modify: `desktop-pet/electron/petSettingsStore.ts`
- Modify: `desktop-pet/electron/petSettingsStore.test.ts`

**Step 1:** 先写失败测试，覆盖默认 `vscode-cli`、两个 radio 菜单项、设置持久化和非法值丢弃。

**Step 2:** 运行：

```powershell
npm run test -- --run electron/petMenuModel.test.ts electron/petSettingsStore.test.ts
```

预期：因 `CodexLaunchTarget` 和菜单项尚不存在而失败。

**Step 3:** 最小实现枚举、动作、标签、菜单输入和设置归一化。

**Step 4:** 重跑测试并确认通过。

### Task 2: Codex Desktop 启动器

**Files:**
- Create: `desktop-pet/electron/codexDesktopLauncher.ts`
- Create: `desktop-pet/electron/codexDesktopLauncher.test.ts`

**Step 1:** 先写失败测试，期望构建 `codex://new?path=<URL 编码工作区>`，并验证 `openExternal` 被调用。

**Step 2:** 运行：

```powershell
npm run test -- --run electron/codexDesktopLauncher.test.ts
```

预期：模块不存在或导出不存在。

**Step 3:** 实现 URI 构建、工作区校验和可注入的 `openExternal`。

**Step 4:** 重跑测试并确认通过。

### Task 3: Electron 主进程路由

**Files:**
- Modify: `desktop-pet/electron/main.ts`
- Modify: `desktop-pet/electron/mainIntegration.test.ts`

**Step 1:** 先写失败测试，覆盖设置初始化、菜单传值、动作持久化、Desktop 分支和 CLI/Claude 保持原行为。

**Step 2:** 运行：

```powershell
npm run test -- --run electron/mainIntegration.test.ts
```

预期：缺少 Desktop launcher 和路由。

**Step 3:** 最小实现主进程状态和动作路由。

**Step 4:** 重跑测试并确认通过。

### Task 4: 架构与概念登记

**Files:**
- Modify: `docs/architecture/current-system-topology.md`
- Modify: `workflow/workflow-glossary.zh-CN.md`
- Create: `workflow/concepts/codex-launch-target.zh-CN.md`

**Step 1:** 登记“Codex 启动目标”的定义、适用边界、不变量、失败路线和相关测试。

**Step 2:** 更新当前系统拓扑中的菜单、设置和启动链路。

### Task 5: 完整验证与重启

**Step 1:** 运行：

```powershell
npm run check
```

预期：全部测试、类型检查和构建通过。

**Step 2:** 运行 `git diff --check`。

**Step 3:** 使用 `desktop-pet/start-pet.ps1` 无鼠标重启。

**Step 4:** 检查 Electron 进程响应和启动日志，不主动触发 Codex Desktop。
