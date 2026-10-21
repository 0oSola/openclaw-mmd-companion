# Reze Design 舞台配置

## 中文名称

Reze Design 舞台配置。

## 英文机器名

`reze-design`。它是 `renderPipeline`（渲染管线）和 `RenderPipeline` 类型允许的枚举值。

## 概念定义

这是 Reze 风格材质与场景调试的舞台配置族。`reze-design` 是基于 MIT 许可 `reze-engine@0.26.0` 的独立 WebGPU 渲染配置，`reze-npr` 是保留既有 Three.js/WebGL MMD 运行时的实验性 Reze 呈现模式。两者均可使用用户截图中的编辑器入口与默认参数：白色主光强度 1.35、方位 55°、仰角 28°，`#fef2f2` 环境光强度 0.40，`#fef2e2` 泛光阈值 0.81、强度 0.09，相机距离 26.2、目标 `[0, 11.4, 0]`。MIO 星海继续作为页面背景。

## 解决的问题

### 2026-08-02 源码对齐修订

Reze Design 的默认舞台不再依据早期截图参数或页面 MIO 背景推断，而是以 `D:\workspace\reze-design\reze-design\lib\default-scene.ts` 的 bundled 默认场景为准。WebGPU 画布必须绘制原生 `#4b004f` 背景和独立实现的 `Shining Stars` WGSL 效果；世界光、太阳、Bloom、地面、网格和相机必须使用同一默认源。此规则仅适用于 `reze-design`，透明的 MIO 背景合成仍属于 `reze-npr`。

优菈收藏动作遵循 `EulaUniversalFavoriteMotions`：所有 PMX 可只读复用优菈收藏用于资源库、手动预览、点击动作和聊天解析，但不复制资产或改变收藏归属。默认待机仅使用 `00_idle_loop`，顺序为当前 PMX → 优菈 → 其它安全收藏 → procedural idle；招呼、思考、回答、个性和进场动作不得混入待机循环。

参考项目本体为 AGPL-3.0，但 `reze-engine` 为 MIT；当前实现只依赖后者、独立编写适配层，不复制参考编辑器源码。`RezeWebGpuStage` 真实调用 `Engine.init()`、`loadModel()`、`autoStyleGroups()`、`Model.loadVmd()` 和 `runRenderLoop()`，从而让合格的 PMX/VMD 使用 WebGPU 渲染。它与旧 Three.js `MMDCompanionRuntime` 并列存在，不能把 WebGPU 失败悄悄切成 Three.js 并仍标为 Reze Design。

当前主站还提供会话级实时调试：选择 `reze-design` 或 `reze-npr` 后，点击左侧主导航的“工具 / 立方体”按钮会直接呼出贴左侧全高的编辑器 Dock，工具轨提供“材质 / 场景”入口。场景页可调整主光、环境光、泛光、接地层和相机；材质页从已加载 PMX 的实际 mesh 读取材质，可临时修改可见性、透明度与发光强度，并按条目重置。普通模式的“工具”按钮仍按原有导航处理。

材质调试的预设映射改用引擎内建 WGSL 材质图：`默认`、`角色皮肤`、`面部`、`眼睛`、`头发`、`柔滑布料`、`金属`、`半透材质`会创建或更新当前 PMX 材质的 style group。引擎公开 API 当前不提供与 Three.js `MeshToonMaterial` 一对一的单项透明度/发光写入，因此 WebGPU 模式中这两个滑块必须禁用并说明限制。场景文档按“用户 + 模型路径”写入浏览器本地存储，可导入/导出 JSON，保存当前场景参数、调色、背景效果和稳定材质序号的预设分配。

工具轨还提供“资产 / 渲染”页。资产页除了主站模型目录外，还提供“导入本地 PMX 模型目录”：选择一个包含单个 PMX 和其全部贴图的目录后，浏览器将该目录的 `File[]` 和 PMX 主文件直接传给 `engine.loadModel({ files, pmxFile })`，不经过服务器上传，也不依赖 URL 推断贴图相对路径。导入内容只保留在当前浏览器会话，刷新页面后需要重新导入。渲染页目前可导出当前 WebGPU canvas 的 PNG。MIO 星海背景是页面 CSS 层，尚未和 WebGPU canvas 合成为同一张导出图；在合成路径实现前，PNG 和未来视频导出均不得声称包含该 CSS 背景。

## 适用场景

- 主站 `/companion` 的 `reze-design` 与 `reze-npr` 渲染模式选择；
- desktop-pet 共享配置的 `render_pipeline`；
- `/mmd-calibration-render` 的 `renderPipeline=reze-design`；
- 需要 Reze Design 灯光/构图、同时保持 MIO 星海舞台视觉和现有 MMD 动作运行时的场景。
- 在主站高级功能中临时检查或调节当前 Reze Design 舞台和已加载 PMX 材质的场景。

## 不适用场景

- 不用于声称所有本地 PMX 都已经兼容 WebGPU；浏览器、PMX 解析、贴图路径、VMD、Grant 付与和物理必须分别在真实样例上验收；
- 不用于替换 `reze-npr`，后者仍是单独的实验性材质/灯光配置；
- 不用于改变模型、VMD、IK、Grant solver、物理、点击、语音口型或动作验收门禁。

## 核心不变量

1. `reze-design` 与 `reze-npr` 必须是独立的 `RenderPipeline` 枚举值，不能互相覆盖或替代其他现有配置。
2. `reze-design` 的角色 PMX/VMD 由 `RezeWebGpuStage` 和 `reze-engine` 处理；`reze-npr` 由 Three.js `MMDCompanionRuntime` 处理。两者共享编辑器入口，但运行时能力不可混同。
3. 背景必须由页面 `MioModeBackground` 提供，`reze-design` 的 WebGPU canvas 与 `reze-npr` 的 WebGL canvas 均保持透明；地面由各自运行时的 ground/shadow catcher 实现。
4. PMX 材质继续使用已验证的 Reze 风格材质分类，避免对角色资源引入新的加载或动作兼容性风险。
5. 主站、桌面 Pet、API 共享配置和校准入口必须接受同一个枚举值。
6. 实时调试只能修改当前 Reze 运行时的内存对象；重新加载模型、切换渲染模式或重置后必须恢复预设/材质初始值，且不得写入 PMX/VMD 或动作验收数据。
7. 持久化材质键不得使用运行时对象 ID；模型重载会新建对象，必须使用同一 PMX 稳定的材质序号。
8. 只有已映射到 reze-engine 内建图的材质预设可被选中和保存；未验证节点或背景着色器不能显示为已可执行功能。
9. 资产页必须复用既有模型选择与 VMD 导入 API；不能为编辑器另行加载模型或绕开 MMD runtime。
10. 静帧导出必须明确区分 WebGL 画布和页面 CSS 背景；在合成器实现前，只能导出前者。
11. 本地 PMX 导入必须同时选择 PMX 与其贴图；该文件集只可用于浏览器内存加载，不得自动上传、保存为共享模型或改变主站的默认模型选择。
12. Reze 编辑器 Dock 必须固定在完整视口高度，长场景控制或材质列表只能在编辑器主体滚动，不能被 Dock 外壳裁切。
13. `reze-npr` 的透明后处理链只允许使用保留 alpha 的通道；`UnrealBloomPass` 会以不透明基础材质回填最终帧，必须在透明舞台禁用，避免将 MIO CSS 背景变为黑色。
14. Reze 场景文档必须按用户、模型路径和渲染管线隔离。打开编辑器只能同步当前管线的相机默认值；不得将 Reze Design 的目标点 Y=11.4、距离=26.2 写入 Reze NPR，后者的默认目标点为 `[-1.2, 1.05, 0.45]`、距离为 31.5。

## 证据与计算口径

- 目标默认参数来源：`D:\workspace\reze-design\reze-design\lib\default-scene.ts` 与 `hooks\use-engine.ts`。
- 主光位置以用户截图的 `azimuth=55`、`elevation=28` 转换为 Three.js 定向光位置；该转换只服务于视觉近似，不改变 PMX 坐标或骨骼坐标系。
- WebGPU 实现位于 `web/src/features/stage/RezeWebGpuStage.tsx`；MIO 背景由 `web/src/app/companion/MioModeBackground.tsx` 提供。
- 本地导入入口位于 `web/src/app/companion/page.tsx` 的“导入本地 PMX 模型目录”，`MMDStage` 将文件集传给 `RezeWebGpuStage`，后者调用 reze-engine 的文件映射加载 API。
- 调试接口由 `MMDStage` 转发到当前 Reze 运行时：`setSceneDebugSettings()`、`resetSceneDebugSettings()`、`getMaterialDebugEntries()`、`updateMaterialDebug()` 与 `resetMaterialDebug()`；左侧立方体按钮只在 `renderPipeline` 为 `reze-design` 或 `reze-npr` 时打开编辑器。场景存储键由 `rezeEditorStorageKey(userId, modelPath, pipeline)` 生成，防止跨管线相机配置污染。
- NPR 透明后处理实现位于 `web/src/features/stage/mmdCompanionRuntime.js` 的 `setupPostprocessing()`、`shouldUseBloom()` 与 `createColorGradeShader()`；编辑器视口/滚动约束位于 `web/src/app/globals.css`。

## 正例

用户在主站选择“Reze Design”，浏览器支持 WebGPU 且 PMX 被引擎成功解析；舞台使用截图中的 Reze 灯光和构图，同时显示 MIO 星海背景及 reze-engine 接地效果，角色播放已验证的 VMD。

用户在主站选择“Reze NPR”，点击左侧“工具 / 立方体”按钮，再点击编辑器内的“材质”或“场景”；材质页可读取当前 Three.js PMX 材质，场景页显示并可调节截图对应的灯光、泛光、地面和相机参数。

用户在高级功能打开“材质”页，刷新并读取当前 PMX 的实际材质，临时将一项材质透明度改为 `0.5`，或在“场景”页将泛光强度实时调高后点击“恢复默认”；这些更改会在当前画面生效，但刷新/重新加载后不会改变任何资产文件。

## 反例

把左侧“工具 / 立方体”按钮只绑定为 `reze-design`、把 WebGPU 画布存在描述为“当前 PMX 已渲染成功”、把 reze-engine 说成嵌入 `MMDCompanionRuntime`、把临时材质调试说成已保存进 PMX、把 WebGPU 物理说成 Three.js Grant solver，或将 `reze-design` 用作 `reze-npr` 的别名，均不符合本概念。

## 相关契约与门禁

- 契约：`RenderPipeline` 类型、`CompanionSharedConfigPayload.render_pipeline`、`COMPANION_RENDER_PIPELINES` 和 `/desktop-pet/shared-config`。
- 验证：web 生产构建、desktop-pet API/存储测试、隔离页面的实际 WebGL 初始化。
- 动作验收门禁保持不变；需要动作发布时仍按 `imgToAction/docs/motion_acceptance_gate.md` 和四视角网格复核执行。

## 失败后的修正路线

1. 如果 API 拒绝该值，检查 Python `Literal`、`COMPANION_RENDER_PIPELINES` 与 SQLite check 迁移是否同时更新。
2. 如果页面不能选择或校准入口回退，检查 `RenderPipeline`、`normalizeRenderPipeline()` 和 `readRenderPipeline()`。
3. 如果调试器没有材质条目，先确认模型已完成加载，再点击“刷新材质”；切换模型后旧条目必须丢弃，不能复用旧材质 ID。
4. 如果控制条变化未反映到画面，先确认左侧“工具 / 立方体”编辑器已打开；再检查 `MMDStage` 的接口转发，以及 `RezeWebGpuStage` 或 `MMDCompanionRuntime` 的场景参数调用；不要从 React 直接操作渲染对象。若打开编辑器后角色消失，先核对场景文档键是否包含当前管线，以及目标点/距离是否属于该管线默认相机。
5. 如果舞台提示 WebGPU、PMX 或 VMD 错误，保存错误文本和使用的模型路径；回到既有 `reze-npr` 或 `classic` 对照。不能把失败自动降级为 `reze-design` 的 Three.js 成功结果。
6. 如果本地导入提示缺失贴图，重新选择含 PMX 和完整贴图子目录的模型根目录；不要只选择单独的 PMX 文件。若包含多个 PMX，必须拆分为一次一个模型目录后再导入。
7. 如果视觉偏离目标，调节对应 Reze 配置中的舞台灯光、相机和后期参数，或检查 MIO 背景的叠放条件；透明舞台出现黑底时，先检查是否误启用了 `UnrealBloomPass`，再检查 RenderPass 清屏 alpha 与调色输出 alpha；不要将视觉补丁混入骨骼或动作逻辑。
8. 如果编辑器底部控制或材质条目不可见，检查 Dock 外壳、调试器与内容主体是否都存在 `min-height: 0`，且仅内容主体拥有 `overflow-y: auto`；不要用增加固定高度掩盖裁切。

## 与现有概念的关系

`reze-design` 复用 `reze-npr` 的 PMX 材质分类，但二者是不同的渲染配置。它与 `k3`、`mio-reference`、`reze-k3` 等同属 `renderPipeline` 的并列值；不改变 MMD 动作验收 Gate 或骨骼坐标系统。

## 2026-08-03 增补：`reze-k3` 并列舞台模式

`reze-k3` 是本轮新增的并列 `RenderPipeline` 枚举值，运行时底座与 `reze-design` 相同——复用 `RezeWebGpuStage`（reze-engine WebGPU），材质走九个内置 WGSL 图，场景走引擎 world/sun/bloom/ground/camera。它与 `reze-design` 的差别仅在语义定位：`reze-design` 以参考工程默认场景（`#4b004f` 紫红底 + Shining Stars + `#ed6aff` 世界光）为构图基准，`reze-k3` 则是"复刻 reze-design 项目 MMD 渲染能力"的承接位，两者共享同一套编辑器 Dock、本地 PMX 导入和场景文档存储（按 `userId + modelPath + pipeline` 隔离，互不影响）。

**透明背景差异**：`reze-k3` 的 WebGPU 画布透明（`setBackgroundColor(null)` + 引擎构造 `background: null`），不绘制 `#4b004f` 紫红底，由页面 `MioModeBackground` 星海 CSS 背景透出；`MioModeBackground` 的激活条件因此追加 `reze-k3`。`reze-design` 仍保持不透明紫红底。两模式的 Shining Stars 星空效果均保留（画在 WebGPU 透明层上，叠加于 MIO 背景之上）。`RezeWebGpuStage` 新增 `transparentBackground` prop，由 `MMDStage` 按管线（`reze-k3` → true）传入，同时作用于引擎构造参数和 `applySceneSettings()` 的 `setBackgroundColor`。

与 `reze-design` 一样，`reze-k3` 在主站开放编辑器 Dock（材质 / 场景 / 资产 / 渲染四页），支持本地 PMX 目录导入和 PNG 导出；浏览器无 WebGPU 时舞台内显示错误，用户手动切回 `reze-npr` 恢复。桌面 Pet 的 `/desktop-pet/shared-config` 已接受 `reze-k3`，同步主站配置后会复用 `MMDStage` 的 WebGPU 分支加载。

**VMD URL 绝对化修复（2026-08-03）**：`MMDStage` 传给 `RezeWebGpuStage` 的 `interaction.vmdUrl` 此前未像 Three.js 分支那样调用 `toAbsolute()`，导致 `loadVmd` 把相对路径 `/assets/vmd/file/...` 请求到 web 前端（3100）而非 API（8100），返回 404 并把整个 WebGPU 舞台标记为 error。现已在 `MMDStage` 构造 `webGpuInteraction`（对 vmdUrl 做 `toAbsolute`）统一传给两处 WebGPU 分支；该修复同时作用于 `reze-design` 和 `reze-k3`。

核心不变量追加：

15. `reze-k3` 与 `reze-design` 必须是独立的 `RenderPipeline` 枚举值，共享 WebGPU 运行时底座但场景文档、相机快照按管线隔离，不得互相覆盖。
16. `reze-k3` 必须写入并可由 `/desktop-pet/shared-config` 读取；API 层 `Literal`、`COMPANION_RENDER_PIPELINES`、SQLite CHECK 必须同步接受该值。
17. `reze-k3` 的 WebGPU 画布必须透明并叠加 `MioModeBackground`；不得像 `reze-design` 那样绘制不透明背景色。
18. 传给 `RezeWebGpuStage` 的 VMD URL 必须先 `toAbsolute`；相对路径会被请求到 web 前端导致 404。

## 2026-08-03 增补：`reze-k3` 独立默认场景（ak-12）

此前 `reze-k3` 复用 `REZE_DESIGN_SCENE_DEFAULTS`（reze-design 的紫调舞台：相机距离 26.2、目标点 Y 11.4、`#4b004f` 底、`#ed6aff` 世界光）。本轮引入独立的 `REZE_K3_SCENE_DEFAULTS`（`web/src/features/stage/rezeDesignDefaults.ts`），数值取自 `MMD_stage/ak-12.json` 的 `scene` 字段：明亮中性光（白主光 1.07、白世界光 0.73、白地面），相机距离 21.2、目标点 `[-2.1, 12.3, 2.2]`，主光方位 10°、仰角 55°。`getRezeSceneDebugDefaults` 现在按管线分流：`reze-npr` → NPR 默认、`reze-k3` → ak-12 默认、其余（`reze-design`）→ Reze Design 默认。场景文档仍按 `userId + modelPath + pipeline` 隔离，三条管线互不影响；`reze-k3` 画布透明，白底/白地面仅作为光照与地面代理，最终由页面 MIO 星海 CSS 背景透出。

核心不变量追加：

19. `reze-k3` 必须使用独立的 ak-12 默认场景，不得回退到 `REZE_DESIGN_SCENE_DEFAULTS`；三条 Reze 管线的默认场景各自独立。

## 2026-08-03 增补：材质面板重叠修复

Reze 编辑器「材质」页的 `.mio-reze-material-browser`（样式组树 + 素材库 + 选中材质检查器）此前缺少 `overflow-y: auto`。当内容总高（常超过 1100px）大于编辑器 dock 可用高度（约 790px）时，grid 行溢出，材质叶与底部检查器（含透明度/发光强度/重置按钮）相互叠在一起且无法点击（检查器拦截指针事件）。本轮给该容器加 `overflow-y: auto`，使其在内容超高时自身滚动，材质树与检查器按文档流顺排、底部「重置此材质」可达，不再重叠裁切。

核心不变量追加：

20. `.mio-reze-material-browser` 必须保持 `overflow-y: auto`；内容超高时靠容器自身滚动，不得让 grid 行溢出压到选中材质检查器。

## 2026-08-04 增补：WebGPU VMD 最新请求保护

`reze-design` 与 `reze-k3` 的 VMD 预览是异步加载流程。每次待机、手动预览或重复点击同一动作时，`RezeWebGpuStage` 都必须分配递增请求号；`loadVmd()` 返回后，只有请求号仍是最新值时才可调用 `show()`、`play()`、更新当前 VMD URL 并重置物理。这样用户刚点击的预览不会被先前开始、后完成的待机或旧预览覆盖。

核心不变量追加：

21. WebGPU VMD 加载只能由最新请求提交到模型；过期请求必须在 `loadVmd()` 完成后静默退出，不能回写姿势、当前 URL、物理或错误状态。
22. 手动重复点击同一 VMD 必须产生新的请求号并从第一帧重新播放；不能只因 URL 未改变而跳过。

## 2026-08-04 增补：局部骨骼 VMD 姿势保留

部分收藏 VMD 只含一小组骨骼轨道，例如 `cheer (37).vmd`。`reze-engine` 的公开 `Model.show()` 和 `Model.play()` 会先清空所有本地骨骼变换；若局部 VMD 没有覆盖上半身、手臂或裙摆等骨骼，模型会退回 PMX 绑定 T 姿势。已有动作姿势时，`RezeWebGpuStage` 必须通过引擎的动画状态切换到新 clip，让引擎仅写入 VMD 实际提供的轨道；首次加载仍走公开模型方法以建立初始姿势。

核心不变量追加：

23. WebGPU 舞台切换局部骨骼 VMD 时不得清空未被该 VMD 轨道覆盖的骨骼；正常站姿或当前待机姿势必须保留。

## 2026-08-04 增补：单次 VMD 完成后的待机恢复

reze-engine 的 `animationState.setOnEnd()` 是 WebGPU 单次 VMD 的权威结束信号。`RezeWebGpuStage` 必须把当前 VMD 的结束事件转发给 `CompanionPage` 的 `onInteractionComplete`；页面状态机随后按既有优先级恢复收藏待机循环，只有找不到可用待机 VMD 时才恢复程序化待机。WebGPU 分支不得让动作停在最终帧，也不得自行伪造另一套待机策略。

核心不变量追加：

24. reze-design 与 reze-k3 的单次 VMD 结束必须回传现有舞台状态机；恢复逻辑与 Three.js 分支使用同一套收藏待机选择规则。
