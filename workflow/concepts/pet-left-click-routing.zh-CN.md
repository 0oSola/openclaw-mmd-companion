# Pet 左键输入路由

## 中文名称

Pet 左键输入路由

## 必要的英文机器名

`PetLeftClickRouting`

## 概念定义

Pet 左键输入路由是透明 Electron Pet 对左键短按、窗口拖动和相机调整进行统一分流的输入规则。按下时只记录点击候选；在“拖动整个应用”模式下，只有指针位移超过 6px 才建立窗口拖动，未超过阈值的抬起才进入角色命中和动作选择。“调整相机”模式不建立窗口拖动，但保留静止短按动作，移动交给相机交互。

## 解决的问题

透明分层窗口可能只把鼠标消息交给原生窗口或渲染子窗口；如果渲染层、原生层和 MMDStage 各自处理点击，就会出现点击被当成拖动、拖动结束误切动作、DPI 坐标抖动误判以及 WebGPU 舞台矩形为空等问题。

## 适用场景

- `desktop-pet` 的默认 `window-drag` 交互模式。
- `desktop-pet` 的 `camera-adjust` 交互模式。
- WebGPU Pet 舞台的原生点击兜底。

## 不适用场景

- 主站 `/companion` 的普通 MMD 舞台点击规则。
- 右键原生菜单路由。
- Pet 窗口边缘 resize。

## 核心不变量

1. 左键按下不能立即启动窗口拖动。
2. 移动距离不超过 6px 的短按最多产生一次动作选择。
3. 移动距离超过 6px 后只能进入拖动/相机交互，不能因拖动结束产生动作选择。
4. 原生阈值判定使用 `WM_MOUSEMOVE` 的窗口内坐标，不能用多显示器/DPI 易抖动的屏幕坐标判定短按。
5. Pet 的动作点击统一由外层输入路由处理，`MMDStage` 内部点击捕获不能再次处理同一 Pet 输入。
6. WebGPU 没有 Three.js 容器时，`MMDStage.getStageRect()` 必须回退到 `RezeWebGpuStage` 的画布矩形。

## 证据或计算口径

- 阈值计算：`Math.hypot(deltaX, deltaY) > 6` 才视为移动。
- 渲染层实现：`desktop-pet/src/App.tsx`、`desktop-pet/src/window/petWindowEvents.ts`。
- 原生层实现：`desktop-pet/electron/main.ts`、`desktop-pet/electron/nativeMouseInput.ts`。
- WebGPU 舞台矩形回退：`web/src/features/stage/MMDStage.tsx`。

## 正例

- 按下后在原地抬起：选择一条动作并播放。
- 按下后移动 7px：启动窗口拖动，抬起时不选择动作。
- 原生透明窗口没有 DOM pointerup：原生静止候选发送 `pet:native-left-click`，仍能选择动作。

## 反例

- `pointerdown` 立即发送 `pet:window-drag:start`。
- 透明层无条件使用 `click` 选择动作。
- MMDStage 内部点击捕获和 Pet 外层路由同时处理同一拖动。
- 用 `screen.getCursorScreenPoint()` 的 DPI 换算差异判断静止点击。

## 相关 contract/gate

- `desktop-pet/electron/nativeMouseInput.test.ts`
- `desktop-pet/src/window/petWindowEvents.test.ts`
- `desktop-pet/src/App.integration.test.ts`
- `desktop-pet/src/mmd/mmdStageHandle.integration.test.ts`
- `desktop-pet/electron/mainIntegration.test.ts`
- `docs/architecture/current-system-topology.md` 的 16.4 节

## 失败后的修正路线

1. 先确认是否产生了原生点击候选或外层指针候选。
2. 再确认是否越过 6px 阈值并启动了拖动。
3. 若静止点击命中失败，检查 `hitTestCharacterAtClientPoint()` 和 `getStageRect()`。
4. 若拖动后仍切动作，检查是否存在未纳入外层路由的 `click` 或 MMDStage 内部捕获入口。
5. 修复后必须通过 desktop-pet 全量测试、类型检查、构建和一次真实桌面输入验收。

## 与现有概念的关系

Pet 左键输入路由复用 `PetInteractionMode`、`MMDStage` 命中接口和 `stageCharacterClick` 动作选择器，但不改变主站舞台的点击语义；它只定义 Desktop Pet 的输入职责边界。
