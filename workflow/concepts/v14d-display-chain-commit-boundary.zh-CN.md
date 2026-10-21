# V14D 显示链提交边界

## 中文名称

V14D 显示链提交边界。

## 英文机器名

- 概念 id：`v14d-display-chain-commit-boundary`。
- 诊断接口：`installDisplayChainTrace`、`setDisplayChainTraceCapture`、`captureDisplayChainState`。
- 相关运行时方法：`applyStyleGroups`、`renderFrame`、`setPipeline`、`setBindGroup`、`drawIndexed`。

## 概念定义

显示链提交边界，是材质图变更从“运行时状态已经准备好”到“最终画布已经呈现新结果”之间必须经过的可验证边界。它从 graph/WGSL 编译与 WebGPU pipeline 安装开始，经过样式组对生产 draw-call 的重绑、实际 render pass 中的 `setPipeline`/`setBindGroup`/`drawIndexed`，再经过场景 pre-tonemap HDR 目标、HDR resolve、composite/tone mapping 和 swapchain canvas，才算一次完成的显示提交。

本概念强调：`applyStyleGroups` 返回成功或 compile/install pipeline 身份变化，只表示前置状态已变化；如果 render loop 被冻结且没有新的 `renderFrame`/command submission，最终 canvas 仍可能是旧帧。

## 解决的问题

它解决“编译成功但画面没有变化”被错误归因的问题。过去只看到 graph、WGSL 和 pipeline 安装成功，无法判断变化是在 draw-call 绑定前丢失、没有提交新帧、写入 HDR 后被覆盖，还是在 resolve/composite/canvas 阶段消失。显示链提交边界要求每一段都由对应观测侧的 `captureId`/`frame` 关联的机器证据覆盖，并用 `pairId` 把 identity、identity-control 与 sentinel 对照起来；`pairId` 不是一次 observed render 的身份。

## 定义与关系

一次显示链事务至少包含以下有向关系：

`graph/tint -> compile/install -> style-group/draw-call rebind -> actual draw -> HDR target -> resolve -> composite/tone mapping -> canvas`。

前一节点成功是后一节点的必要条件，但不是充分条件。尤其是 compile/install 与 actual draw 之间、actual draw 与最终 canvas 之间不能用同一个布尔值代替。

## 适用范围

- `/companion` 的 Reze WebGPU 舞台在显式 acceptance probe 下进行固定 frame120 的 Brows/Lashes 显示链诊断。
- 需要区分新旧 pipeline、bind group、draw range、HDR、resolve/composite 和最终 canvas 的材质变更诊断。
- 冻结 render loop 后，通过一次零增量 `renderFrame(0)` 验证“已安装状态是否真正进入画布”的最小回归。
- 后续材质槽或其他异步 GPU 状态替换，只要能提供同等的分段证据，也可复用本概念。

## 不适用范围与非例

- 不用于改变正式 Brows/Lashes identity tint、Face/BodySkin/HairA/HairB 公式、alpha 阈值、灯光、相机或 tone mapping。
- 不把 `page.screenshot`、材质计数、`OnComposite` 计数或 compile 日志单独当作显示链完成证明。
- 不把 acceptance probe 的局部 `renderFrame(0)` 推广为引擎所有调用方的自动刷新策略；生产 live loop 是否需要刷新必须由其自身提交契约决定。
- 不覆盖 Lashes 透明边缘 Gate、动态 Morph Gate 或 Brows/Lashes 逐槽 identity-target Gate。

## 核心不变量

1. 每个观测侧的 `captureId` 与 `frame` 必须同时关联该侧请求、实际 render trace、生产 draw-call 快照、HDR 统计和最终 canvas；对照关系另由 `pairId` 表示。
2. compile/install pipeline 身份与实际 `setPipeline` 身份必须分别记录；二者不一致时不得声称新 graph 已显示。
3. Brows/Lashes 的 material、draw range、bind group、生产 `drawIndex` 和实际 `drawOrder` 在 identity/sentinel 对照中必须可比；诊断不得通过改几何或改槽位制造差异。
4. `renderObserved` 只有在同一 captureId/frame 的真实 render trace 被观察到时才为真；apply 成功但没有提交新帧必须为假并阻断负测。
5. pre-tonemap HDR 与最终 canvas 都必须有目标槽统计；只证明中间目标或只证明最终截图都不足以定位全链路。
6. probe 默认关闭，只在 `?v14dAcceptanceProbe=1` 下挂载；卸载时必须恢复被包装的 engine 方法。
7. 目标 draw 的 `materialName`、`groupId`、`type`、`count`、`firstIndex` 与顺序组合必须唯一；Brows/Lashes 各恰好一个匹配，`drawIndex` 非空，且实际 `setPipeline` 必须等于该槽 compile/install pipeline。duplicate、ambiguous 或 unmatched 都必须机器失败。

## 身份与生命周期

`captureId`/`frame` 是一次诊断观测的逻辑身份，生命周期覆盖“请求显示 → 一次 render trace → 目标读取 → 报告落盘”；一次请求至多对应一个 observed render frame。`pairId` 只表示 identity、identity-control、sentinel 这一组固定场景对照，三侧必须使用彼此不同的 `captureId`；`requestSerial` 只用于阻止旧 trace 假阳性，不能承担跨观测身份。GPU 对象指纹（例如 `gpu-1`、`gpu-36`）只在同一页面 JavaScript realm 和同一次 probe 生命周期内稳定，不是跨运行的永久编号。组件卸载或 probe 关闭时，trace wrapper、当前请求和最近 trace 都必须清理。

## 关系方向与基数

- 一个 `captureId/frame` 请求至多对应一个被标记为 observed 的 render frame；没有 observed frame 时只能对应旧 trace 或空 trace。identity、identity-control、sentinel 的 `captureId` 必须各自唯一，`pairId` 只做组关联；不能用同一个 `captureId` 表示两次 observed render。
- 一个 render frame 可以包含多个 draw-call 和多个 pipeline bind；Brows 与 Lashes 各自应有目标 draw 记录。
- 一个实际 draw 必须对应一个实际 pipeline、一个 material bind group 和一个生产 draw range；compile/install 记录与实际 draw 记录是可核对但不合并的两类证据。目标 draw 的 range 候选不唯一或不存在时，必须标记为 ambiguous/unmatched 并拒绝报告。
- 一个 HDR/resolve/canvas 读取属于同一 render frame 的下游观测，不能跨帧拼接成“完成”证据。

## 易混淆概念

- **编译/安装非最终显示证明**：是本概念的前置判断规则，说明 compile/install 不能替代 draw/canvas 证据；显示链提交边界则描述完整的有向链和首个丢失位置。
- **生产绘制调用几何源快照**：证明 draw-call 使用的 GPU 几何、绑定和范围身份；它不证明该 draw 在本次新帧中已经被提交到 canvas。
- **恒等 tint 迁移**：定义 Brows/Lashes 的视觉目标为原色通过；它不意味着不会发生 pipeline 变更，也不免除显示链提交证据。

## 证据或计算口径

固定权威输入为 Koleda PMX、4 秒、30 FPS、frame 120、face 相机和 `pairId=v14d-bl-pair`。健康观测中 identity 使用 `captureId=v14d-bl-pair-identity`、sentinel 使用 `captureId=v14d-bl-pair-sentinel`，两者的 `requestSerial`/trace frame 分别独立记录；identity pipeline 为 `gpu-1`，sentinel compile/install 与实际 draw pipeline 为 `gpu-36`。本轮健康证据 `web/.scratch/repro-v14d-brows-lashes-display-chain/final-correction-healthy-dynamic-final/report.json` 的 `stageDeltas` 显示，Brows HDR resolve 红通道均值为 `0.162648 -> 0.026491`（绝对差 `0.136157`），Lashes 为 `0.077978 -> 0.019728`（绝对差 `0.05825`）；目标 canvas 采样 `10844`、变化比例 `0.918941`、RGB 绝对差均值 `41.792051`。固定 identity-control 作为同场景噪声基线，非目标区域 `meanAbsRgbSum=0.401686`、`changedRatio=0.005562`；identity→sentinel 非目标区域为 `0.600659`、`0.007`，超额为 `0.198973`、`0.001438`，均在诊断预算内。identity/sentinel composite pipeline 均为 `gpu-35`、gamma 均为 `1`，两侧 HDR NaN/Infinity 均为 `0`，三类页面/网络错误计数均为 `0`。

历史红灯 `report-red-before-fix.json` 的实际 `canvas meanAbsRgbSum=8.663076`、`changedRatio=0.268802`，不是严格 no-effect；它只能表述为“强 sentinel 未达到正式拒绝阈值，且缺少实际新帧 render 证明”。当前 `web/.scratch/repro-v14d-brows-lashes-display-chain/final-correction-fault-no-render-dynamic-final/report.json` 的 `--fault-no-render` 才是可重复的 no-commit 红能力：sentinel compile/install 已更新，但 `renderObserved=false`，trace 的 `captureId` 是旧的 identity-control 观测，HDR/canvas 保持上一提交帧，命令判定为 exit 1；该报告将 H1 标为 `confirmed`，H2–H5 标为 `not-evaluated`。

冻结帧故障观测为：sentinel graph/tint 与 compile/install 状态仍更新，pipeline 为 `gpu-36`，但 `renderObserved=false`，trace 仍是 identity-control capture，HDR/canvas 保持上一提交帧；故障命令必须 exit 1。报告的 `stageDeltas` 仍保存 HDR 槽、composite、最终 canvas 和非目标区域统计，但在没有 observed sentinel draw 时不得把 H2–H5 写成已证伪。统计允许受 MSAA/采样遮罩影响而有小幅样本数变化，但不得以样本不足掩盖 `renderObserved=false`。

## 正例

1. `applyStyleGroups` 成功后，冻结循环中只调用一次 `engine.renderFrame(0)`；`pairId` 保持一致，但 identity 与 sentinel 分别使用唯一 `captureId/frame`，并观察到实际 `setPipeline(gpu-36)`、Brows/Lashes draw、HDR 红通道下降和 canvas 差异，健康复现 exit 0。
2. 故障注入使用 `render=false`，即使 `applied.ok=true` 且 compile/install pipeline 已变化，只要没有真实新帧，报告 `renderObserved=false` 并 exit 1。

## 反例与非例

1. 只检查 graph name、WGSL 文本或 `applyStyleGroups.ok=true`，就声称错误 tint 已显示。
2. 只比较 canvas 截图而不记录实际 pipeline、bind group 和 draw range，无法区分后续 pass 覆盖与根本没有新 draw。
3. 通过改相机、屏幕平移、mask 膨胀、depthBias 或 analyzer 阈值让目标差异变大。
4. 把一次旧帧的 HDR 与另一次新帧的 canvas 拼成同一 capture 证据。

## 尚待验证

- 本票验证了显式 acceptance probe 的固定帧 Brows/Lashes 链路；完整用户图编辑器所有实时调用方在不同 render-loop 状态下的刷新语义仍需独立端到端覆盖。
- 本票没有闭合 Brows/Lashes 的逐槽 identity-target、Lashes 透明边缘和动态 Morph 正式 Gate。
- 不同浏览器/WebGPU 后端对 HDR readback 格式和异步队列时序的差异尚未作为跨平台矩阵验收。

## 重新审查条件

当 reze-engine 改变 `renderFrame`/`runRenderLoop`/`applyStyleGroups` 的时序、draw pass 或 composite 目标；当引入新的 HDR resolve/tone mapping pass；当 probe 的 wrapper 接口或 captureId/frame 契约变化；或再次出现“compile/install 成功但画布无效果”时，必须重新核对本概念。

## 相关 contract/gate

- `v14d-display-chain-commit-boundary`：本概念的机器检索与报告路由。
- `v14d-compile-install-not-display-proof`：compile/install 仅为必要前置证据的规则。
- `v14d-production-draw-call-source-snapshot`：生产 draw-call 几何、绑定与范围身份。
- `v14d-brows-lashes-identity-tint`：Brows/Lashes 恒等 tint 与材质槽语义。
- 本票最小复现：`web/scripts/repro-v14d-brows-lashes-display-chain.mjs`。

## 失败后的修正路线

1. 先确认 graph/tint、compile/install pipeline 与 `applyStyleGroups` 结果有效。
2. 再按每一侧自己的 `captureId/frame/requestSerial` 核对实际 `setPipeline`、material bind group、draw range、唯一 draw 身份和目标 draw 是否出现；用 `pairId` 关联两侧。
3. 若实际 draw 已出现，比较 pre-tonemap HDR、HDR resolve、composite/tone mapping 和最终 canvas，定位首个下降到旧值的阶段。
4. 若实际 draw 未出现，检查 render loop 是否已停止、是否有新的 `renderFrame`/command submission，以及是否发生 apply 后重建或模式恢复。
5. 修复后必须先保留红灯，再运行健康绿测和至少一个 stale-render 负测；不得修改正式视觉阈值来消除失败。

## 与现有概念的关系

本概念承接 `reze-shader-workflow` 对异步编译/安装和最后成功图的提交约束，把“提交成功”的观察范围从 pipeline 安装扩展到实际 draw 和最终 canvas。它复用 `v14d-production-draw-call-source-snapshot` 的生产 draw 身份、`v14d-brows-lashes-identity-tint` 的恒等目标语义，但不改变任何材质公式或正式视觉 Gate。
