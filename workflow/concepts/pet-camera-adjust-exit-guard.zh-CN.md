# Pet 相机调整退出保护

## 中文名称

Pet 相机调整退出保护

## 必要的英文机器名

`PetCameraAdjustExitGuard`

## 概念定义

Pet 相机调整退出保护是 Desktop Pet 在 `camera-adjust` 模式下维持相机操作连续性的交互规则：renderer 捕获阶段和 Electron `webContents` 事件先阻止默认上下文菜单，Electron 主进程再拒绝所有统一右键菜单入口；renderer 在舞台上提供独立的“保存并退出相机”悬浮按钮。按钮先把交互模式切回 `window-drag`，既有模式切换保存链路再捕获当前相机快照、按模型和渲染管线隔离写入本地存储、锁定相机并恢复窗口拖动；renderer 在 `beforeunload` 和 `pagehide` 前也会保存当前快照，覆盖直接关闭 Pet 的路径。Three.js 和 Reze WebGPU 都必须提供有效的实时 `captureCamera()`，并在启动时应用传入的 `cameraSnapshot`。

## 解决的问题

相机拖动、滚轮缩放或旋转过程中弹出右键菜单会抢占输入焦点，导致用户无法连续调整构图，也缺少不依赖右键菜单的退出路径。若按钮点击同时进入角色点击或窗口拖动候选，还会把保存退出误判为动作或窗口移动。

## 适用场景

- `desktop-pet` 的 `camera-adjust` 模式。
- Three.js/MMD 与 Reze WebGPU 两类 Pet 舞台的相机交互。
- Windows 原生 `WM_RBUTTONUP`、Electron `webContents` 右键和统一上下文菜单入口。

## 不适用场景

- 主站 `/companion` 的相机编辑面板。
- `window-drag` 模式下的正常右键菜单。
- 不涉及 Pet 相机状态的普通角色动作点击。

## 核心不变量

1. `camera-adjust` 模式下，任何右键菜单入口都不得创建 Pet 上下文菜单。
2. “保存并退出相机”按钮必须处于独立的非拖动命中区域，不能进入角色点击或窗口拖动候选。
3. 退出动作必须回到 `window-drag`，并复用已有相机快照保存链路，不创建第二套存储格式。
4. 保存的相机快照必须继续按 `selectedModel.relative_path + render_pipeline` 隔离，不能写入共享配置或主站相机状态。
5. 保存成功后运行时相机必须锁定；保存失败时不得伪造持久化成功。
6. 关闭 renderer 前必须尽力保存当前相机快照，不能要求用户必须先点击退出相机按钮。
7. Reze WebGPU 的相机快照必须来自引擎当前 orbit 状态，不能用 `null` 或仅保存静态场景默认值替代。

## 证据或计算口径

- 右键入口保护：`desktop-pet/electron/interactionMode.ts` 的 `shouldOpenPetContextMenu()` 与 `desktop-pet/electron/main.ts` 的 `openPetContextMenu()`。
- 默认菜单阻断：`desktop-pet/src/App.tsx` 的 `contextmenu` 捕获监听与 `desktop-pet/electron/main.ts` 的 `event.preventDefault()`。
- renderer 退出按钮：`desktop-pet/src/App.tsx` 的 `handleSaveAndExitCamera()` 与 `data-testid="pet-camera-save-exit"`。
- 持久化路线：`desktop-pet/src/App.tsx` 的 `persistCurrentPetCameraSnapshot()`、`beforeunload/pagehide` 监听、`shouldPersistPetCameraOnModeChange()` 分支和 `desktop-pet/src/mmd/petCameraState.ts`。
- Reze 实现：`web/src/features/stage/RezeWebGpuStage.tsx` 的 `captureRezeCameraSnapshot()`、`applyRezeCameraSnapshot()` 和 `cameraSnapshot` 启动恢复。
- 回归验证：`desktop-pet/electron/interactionMode.test.ts`、`desktop-pet/electron/mainIntegration.test.ts`、`desktop-pet/src/App.integration.test.ts`。
- 运行时验证：Electron 调试窗口中按钮可见、点击后 renderer/main mode 均为 `window-drag`，相机模式右键后无菜单窗口创建。

## 正例

- 从右键菜单进入 `camera-adjust` 后，拖动/缩放相机，点击右上角“Save & Exit Camera”，相机保存并回到窗口拖动。
- 相机模式中触发 Windows 原生右键或 Electron `webContents` 右键，主进程记录忽略事件但不弹菜单。
- 按钮点击时不会产生角色动作波纹，也不会调用窗口拖动 IPC。

## 反例

- 相机调整过程中仍然弹出 Codex/Workspace 右键菜单。
- 退出按钮只隐藏 UI，不切换主进程交互模式。
- 退出按钮点击被文档级 pointer 候选当成角色点击或窗口拖动。
- 为按钮新增另一份相机存储格式，导致启动恢复与退出保存不一致。

## 相关 contract/gate

- `desktop-pet/electron/interactionMode.test.ts`
- `desktop-pet/electron/mainIntegration.test.ts`
- `desktop-pet/src/App.integration.test.ts`
- `desktop-pet` 的 `npm test`、`npm run typecheck`、`npm run build`
- `docs/architecture/current-system-topology.md` 的 16.6 节

## 失败后的修正路线

1. 先确认当前 renderer 和 Electron 主进程的交互模式是否都为 `camera-adjust`。
2. 若仍弹菜单，检查所有右键入口是否都经过 `openPetContextMenu()` 和 `shouldOpenPetContextMenu()`。
3. 若按钮不可见或不可点击，检查按钮层级、`pointer-events`、`-webkit-app-region` 和透明 hit surface 的覆盖关系。
4. 若按钮点击误触发动作或拖动，检查 `.pet-camera-save-exit` 是否仍在文档级 pointer 候选排除名单中。
5. 若退出后构图未恢复，检查 `captureCamera()`、`preparePetCameraSnapshotForStorage()`、模型/管线存储键和相机锁定顺序；Reze 管线还要检查引擎 orbit 状态是否被捕获和应用。
6. 若直接关闭后构图未恢复，检查 `beforeunload/pagehide` 监听是否注册、renderer 是否已完成模型加载，以及 localStorage 是否可写。
7. 修复后重新运行桌面 Pet 全量测试、类型检查、构建，并进行一次真实 Electron 输入验收。

## 与现有概念的关系

Pet 相机调整退出保护复用 `PetInteractionMode`、`PetLeftClickRouting` 和既有 Pet 相机快照存储，不改变主站相机语义。它补充的是 `camera-adjust` 模式的右键菜单阻断、显式退出入口和输入命中边界。
