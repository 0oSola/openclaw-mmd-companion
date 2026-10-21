# Pet 窗口边界持久化

## 中文名称

Pet 窗口边界持久化

## 必要的英文机器名

不新增独立机器名；实现字段使用 `windowBounds`，存储文件为 `pet-settings.json`。

## 概念定义

Pet 窗口边界持久化是 Desktop Pet 对窗口屏幕位置和可见尺寸的保存与恢复规则。主进程从 Electron `BrowserWindow.getBounds()` 读取 `x`、`y`、`width`、`height`，写入 Electron `app.getPath("userData")` 下的 `pet-settings.json`；启动时读取并经过显示器可见区域校正，再在透明无边框窗口创建后调用一次 `setBounds()`，确保构造阶段的最小尺寸不会覆盖用户保存的尺寸。

## 解决的问题

透明无边框 BrowserWindow 在创建阶段可能暂时使用最小窗口边界，导致设置文件虽然有历史尺寸，但下一次打开仍显示为最小窗口。

## 适用场景

- Desktop Pet 的主窗口。
- Windows 多显示器和不同显示器工作区。
- 正常移动、缩放、关闭和重新启动。

## 不适用场景

- 独立的上下文菜单窗口。
- 主站页面窗口。
- MMD 相机位置或场景参数。

## 核心不变量

1. 窗口关闭前保存最新的 Electron `getBounds()`。
2. 启动恢复使用同一份 `windowBounds`，不能依赖 renderer localStorage。
3. 透明窗口构造后必须再次应用解析后的边界。
4. 保存位置不可见时可以校正到当前显示器工作区，但尺寸不能无故回退到最小值。
5. 窗口边界持久化不能覆盖相机快照或共享主站配置。

## 证据或计算口径

- 存储：`desktop-pet/electron/petSettingsStore.ts`。
- 启动选项：`desktop-pet/electron/petWindowOptions.ts`。
- 创建与恢复：`desktop-pet/electron/main.ts` 的 `createPetWindow()`。
- 保存入口：`resize`、`resized`、`move`、`moved` 和 `close` 事件。
- 回归测试：`desktop-pet/electron/mainIntegration.test.ts`、`desktop-pet/electron/petWindowOptions.test.ts`、`desktop-pet/electron/petSettingsStore.test.ts`。

## 正例

- 用户把 Pet 调整为自定义尺寸并关闭，重启后恢复相同的 Electron 窗口边界。
- 初始透明窗口被 Electron 创建为最小尺寸时，创建后的 `setBounds()` 将其恢复为保存尺寸。

## 反例

- 只在设置文件中写入尺寸，但不在 BrowserWindow 创建后重新应用。
- 用 Win32 外框读数替代 Electron `getBounds()` 作为跨 DPI 的存储格式。
- 把窗口尺寸写入相机 localStorage。

## 相关 contract/gate

- `desktop-pet/electron/mainIntegration.test.ts`
- `desktop-pet/electron/petWindowOptions.test.ts`
- `desktop-pet/electron/petSettingsStore.test.ts`
- `desktop-pet` 的 `npm run test`、`npm run typecheck`、`npm run build`

## 失败后的修正路线

1. 读取 `pet-settings.json`，确认 `windowBounds` 是否为最新值。
2. 检查 `createPetBrowserWindowOptions()` 的解析结果。
3. 检查 `new BrowserWindow()` 后是否再次调用 `setBounds()`。
4. 检查 resize/move/close 事件是否触发以及写入是否失败。
5. 在真实 Electron 重启链路中比较创建后和 renderer 加载后的 `getBounds()`。

## 与现有概念的关系

该概念只负责窗口外框边界；Pet 相机调整退出保护负责 renderer 相机快照，二者使用不同存储介质和恢复路径。
