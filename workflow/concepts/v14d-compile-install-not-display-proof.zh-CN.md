# V14D 编译/安装非最终显示证明

## 中文名称

V14D 编译/安装非最终显示证明。

## 英文机器名

- 概念 id：`v14d-compile-install-not-display-proof`。
- 相关阶段：graph validation、WGSL compile、WebGPU pipeline install、实际 draw、HDR/resolve、composite、canvas。

## 概念定义

编译/安装非最终显示证明，是一条诊断规则：graph/WGSL 编译成功和 WebGPU pipeline 安装成功，只能证明着色器阶段可建立，不能证明目标 draw-call 实际绑定新 pipeline，也不能证明该结果写入并保留在最终 canvas。

## 解决的问题

它防止把“编译成功”误报为“视觉生效”。在异步样式组应用中，编译、安装、draw 绑定和画布提交是不同阶段；冻结 render loop 时，前置阶段可以成功而画布仍停留在上一帧。

## 定义与关系

该规则把 compile/install 视为显示链的必要前置证据，把实际 `setPipeline`/`setBindGroup`/`drawIndexed`、pre-tonemap HDR、resolve/composite 和最终 canvas 视为后续独立证据。任何后续证据缺失，都不能由前置成功状态补足。

## 适用范围

- WebGPU 材质图异步应用、样式组替换和固定帧验收。
- 解释 pipeline 身份变化但最终画布无变化的故障报告。
- 设计机器 Gate，使 stale rebind、未提交新帧和后续覆盖不能包装为通过。

## 不适用范围与非例

- 不用于推断具体根因；它规定证据边界，不替代显示链分段诊断。
- 不用于修改 shader 公式、pipeline cache 签名、alpha analyzer 或最终视觉阈值。
- 不把“截图文件已生成”当作 canvas 已使用新 draw 的证明。

## 核心不变量

1. compile/install 成功永远不能单独置 `visualApplied=true`。
2. actual draw pipeline 必须由 render trace 直接观察，而不是从 style group map 反推。
3. HDR 与 canvas 的比较必须绑定同一 captureId/frame；不能用跨帧数据拼接。
4. stale-render 负测即使 `applied.ok=true` 也必须被拒绝。

## 身份与生命周期

compile/install 结果属于一次异步样式组应用；actual draw 与 canvas 结果属于该应用之后某一次实际提交帧。二者通过 captureId/frame 和 pipeline 指纹关联，但生命周期不同，不能相互替代。

## 关系方向与基数

- 一个 compile/install 结果可以等待零个或多个 render frame；只有被实际新帧消费时才可产生显示证据。
- 一个 render frame 可以消费多个已安装 pipeline，但目标材质必须有自己的 draw 记录。
- 一个最终 canvas 观测必须来自一次已确认提交的下游结果，不得反向证明 compile/install 已被使用。

## 易混淆概念

- **显示链提交边界**：描述从 graph 到 canvas 的完整链路和首个丢失边界；本规则只强调 compile/install 的证据局限。
- **pipeline cache/signature**：解释是否复用安装对象的候选根因；即使 pipeline 新建成功，本规则仍要求观察实际 draw。
- **OnComposite**：绑定/分组计数；它不是 fragment 已执行或 canvas 已更新的证明。

## 证据或计算口径

本票固定复现中，identity pipeline 为 `gpu-1`，sentinel compile/install pipeline 为 `gpu-36`；健康路径实际 draw 观察到 `gpu-36`，Brows/Lashes HDR 与 canvas 红通道下降，目标画布 changedRatio 约 0.96。故障路径仍显示 sentinel compile/install 为 `gpu-36`，但 `renderObserved=false`，机器 exit 1。

## 正例

compile/install、actual draw、HDR 和 canvas 四类证据都存在，并且 sentinel 的实际 draw pipeline 等于 compile/install pipeline。

## 反例与非例

- 只读 `ApplyStyleGroupsResult.ok=true`。
- 只比较 `styleGroups.get(groupId).pipeline`。
- 只看两槽 OnComposite=1/1。
- 只读最终截图而没有同帧 draw/HDR 证据。

## 尚待验证

本规则已在固定 Brows/Lashes acceptance probe 中验证；其他材质槽、用户交互入口和跨浏览器后端仍需各自建立同等强度的显示链证据。

## 重新审查条件

当引擎改变异步 pipeline 安装、render-loop 调度、HDR resolve/composite 顺序，或任何验收脚本再次把 compile 成功当作最终视觉通过时，必须重新审查。

## 相关 contract/gate

- `v14d-display-chain-commit-boundary`。
- `v14d-brows-lashes-identity-tint`。
- `v14d-production-draw-call-source-snapshot`。
- `web/scripts/repro-v14d-brows-lashes-display-chain.mjs` 的健康与 `--fault-no-render` 负测。

## 失败后的修正路线

先保留前置 compile/install 证据，再补实际 draw trace；若 draw 已出现，沿 HDR→resolve→composite→canvas 检查覆盖；若 draw 未出现，检查 render-loop/`renderFrame`/command submission；若只有 analyzer 失败而显示链证据完整，才进入视觉目标或 Gate 口径调查。

## 与现有概念的关系

本规则细化 `reze-shader-workflow` 的异步应用约束，服务于 `v14d-display-chain-commit-boundary` 的证据分层，并不改变 Brows/Lashes 恒等 tint 或其他材质的正式语义。
