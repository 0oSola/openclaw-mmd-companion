# V14D Morph 取证默认外观锁隔离

## 中文名称

V14D Morph 取证默认外观锁隔离。

## 英文机器名

- 概念 id：v14d-morph-forensic-lock-isolation
- 失败分类：`H6_productionDefaultAppearanceLockInterference`
- 取证脚本：`web/scripts/repro-v14d-lashes-morph-offsets.mjs`

## 概念定义

Morph 取证默认外观锁隔离，是在显式生产验收探针内，把角色级默认外观规则与 Morph 顶点变形事实分开的诊断边界。探针先清除或挂起 VMD clip，记录默认外观锁对请求权重的控制结果；随后在每次真实生产 `model.update()` 完成后，仅对本次探针重新写入指定 Morph 权重，再执行生产 `renderFrame`、GPU Morph dispatch、队列完成等待和生产 `vertexBuffer` 只读读回。

该隔离不是生产运行时的新策略，也不是解除克莱妲默认闭眼语义。它只防止诊断脚本把“外观锁重新写回权重”误判为 PMX 偏移缺失，并把锁的存在、控制结果和绕过方式全部落盘。

## 解决的问题

克莱妲默认外观会在生产模型更新后强制写回 `まばたき=1`。如果探针请求开眼 `まばたき=0` 后直接读回，开眼与闭眼状态可能实际上是同一权重；此时 Lashes 读回的 position delta 为零，但零值来自探针输入被覆盖，不代表 PMX 偏移、顶点索引、GPU Morph 上传或 compute 应用丢失。

若不隔离，A（把引用顶点误算成非零）、B（PMX 到生产索引映射错误）和 C（引擎 Morph 数据链丢失）会被错误混成一个结论，甚至诱发放宽 `expectedAffectedSlots` 的危险修正。

## 适用范围

- 适用：显式 `?v14dAcceptanceProbe=1` 下的 PMX Morph 顶点级生产取证。
- 适用：需要同时核对 VMD/默认外观锁、runtime Morph、CSR、生产 draw range 和 GPU `vertexBuffer` 的探针。
- 适用：以 `H6_productionDefaultAppearanceLockInterference` 标记“输入控制被默认外观规则改变”的首个失真边界。
- 不适用：修改 `koledaDefaultAppearance.js`、`RezeWebGpuStage.tsx`、正式 G7 口径、`expectedAffectedSlots`、视觉公式或资产。
- 不适用：把“探针绕过锁”描述成生产默认外观语义已改变，或用它替代 VMD 插值验收。

## 核心不变量

1. **先记录控制再隔离**：探针必须记录请求权重、生产更新后的实际 runtime/effective 权重、被强制写回的 Morph 名称和 `confirmsProductionDefaultAppearanceLock`。
2. **只在探针覆盖**：权重覆盖适配器只能存在于取证脚本；生产源代码、Gate 和模型资产不得因本概念改动。
3. **生产路径不替换**：覆盖后仍调用生产 `model.update()`、`renderFrame`、GPU dispatch、`queue.onSubmittedWorkDone()` 和生产 draw-call `vertexBuffer` 读回。
4. **两路事实先于运行时结论**：PMX 二进制与 Blender CLI 必须先证明 Morph 类型、引用数、严格非零数、零/近零分桶、材质交集和索引映射。
5. **引用数不等于非零数**：`totalOffsetReferences`、`referencedVertexCount`、`strictNonZeroOffsetCount` 和 `strictNonZeroVertexCount` 必须分字段报告。
6. **CSR 按行边界恢复顶点**：CSR 必须用 `rowStart[vertex]..rowStart[vertex+1]` 产生真实 `vertex`，不得把列索引或空值当作顶点编号。
7. **首个丢失边界可为空**：隔离后若 CPU 期望与 GPU 实际一致，`firstLostBoundary.status` 必须为 `not-lost-after-probe-isolation`，不能为了保留“引擎故障”叙事伪造边界。
8. **不放宽 Gate**：即使原始 G7 因锁污染判红，也只能修探针隔离或拆分验收职责；不得降低 `expectedAffectedSlots` 或把“未测到”当作通过。

## 证据或计算口径

离线权威报告至少包含：PMX/Blend SHA256、PMX reader 完整消费、Morph type、offset 引用数与严格非零统计、三轴范围、零/近零桶、Brows/Lashes 材质集合、draw range 唯一顶点集合、Morph 与 draw 集合交/差集、Blender 轴向变换后的误差和 `mappingProof.consistent`。

runtime 报告至少包含：runtime loader Morph 与 PMX 行对账、`rowStart` CSR 反演结果、生产 draw source audit、权重上传/dispatch 状态、`vertexBuffer` 位置 delta、重复读回一致性、默认外观锁控制证据、`firstLostBoundary`、H1-H6 假设状态和最终结论。

本票权威样例中，PMX 顶点数为 60352；Brows draw 为 `firstIndex=9330,count=312,uniqueVertices=82`；Lashes draw 为 `firstIndex=9642,count=1866,uniqueVertices=506`。`まばたき` 为 846 条引用、846 个严格非零顶点，其中 Lashes 交集 506、Brows 交集 0；`笑い` 为 862 条引用、862 个严格非零顶点，其中 Lashes 交集 506、Brows 交集 0。PMX、Blender、runtime Morph 与生产 draw 索引一致；隔离后两种 Morph 的 Lashes GPU 读回均为 506/506 移动。

## 正例

1. 探针请求 `まばたき=0,笑い=0`，生产更新后观测到 `まばたき` 被写回 1、`笑い` 保持 0；报告标记 H6 confirmed。覆盖适配器只在探针 `model.update` 返回后重写请求值，随后 GPU Lashes 读回与 PMX 期望一致。
2. `rowStart` 为 `[0,2,2,3,3]` 时，Morph 列表属于顶点 0 和 2 的记录必须还原为 `vertex=0`、`vertex=2`，而不是 `vertex=null` 或 `colMorph`。

## 反例与负测

1. 只把 PMX Morph 引用数 846/862 写成“Lashes 受影响顶点数”，不计算严格非零和材质交集；该报告不能证明 506。
2. 不清除/挂起 clip，也不记录默认外观锁，直接把开眼状态的零 delta 归因于 GPU Morph；该路线属于 H6 未检查，结论无效。
3. 在生产代码中永久取消克莱妲闭眼锁，或在正式 Gate 中降低 `expectedAffectedSlots`；这改变了产品语义，违反本概念边界。
4. 用 CPU `model.getVertices()` 或屏幕像素质心代替生产 GPU `vertexBuffer`；这不能定位 PMX parser→model→GPU buffer→compute→draw 的边界。

## 相关 contract、Gate 与失败修正路线

- contract：Stage 2C-M2a.4 Lashes Morph 偏移权威取证。
- 相关 Gate：G7 Brows/Lashes Morph 稳定性；G5 负责 VMD 原生播放/插值链，不由本隔离概念代替。
- 相关实现：`web/src/features/stage/koledaDefaultAppearance.js`、`web/src/features/stage/RezeWebGpuStage.tsx`、`web/scripts/repro-v14d-lashes-morph-offsets.mjs`。
- 回归命令：`uv run python web/scripts/forensic-v14d-lashes-morph-offsets.py --self-test`、`node --test web/tests/v14d-lashes-morph-forensic.test.mjs`，以及当前票据的 PMX/Blender/runtime probe。

固定修正顺序为：

1. 先运行红测并确认请求权重是否被 clip 或默认外观锁改写；
2. 记录 H6 控制证据并在显式 probe 内隔离；
3. 再用 PMX 二进制与 Blender CLI 核对 Morph 偏移和 PMX→生产索引；
4. 再用 CSR、weightsData、dispatch、生产 vertexBuffer 和重复读回定位首个丢失边界；
5. 只有隔离后仍不一致，才进入引擎 Morph 输入/compute 诊断；不得先改 Gate 或生产语义。

## 与现有概念的关系

- 承接“克莱妲默认外观”（`KoledaDefaultAppearance`）：默认外观规则仍是生产语义，本概念只记录并隔离其对诊断输入的影响。
- 与“V14D 生产绘制调用几何源快照”协同：前者提供生产 draw-call GPU 几何来源，本概念保证 Morph 权重输入没有被隐式外观规则污染。
- 与“V14D Brows/Lashes 恒等 tint 迁移”协同：本概念证明 Brows/Lashes 的 Morph 几何身份，不改变恒等 tint 或材质 graph。
- 属于 `reze-k3` 诊断基础设施，不改变默认生产入口、模型、VMD、灯光、相机或视觉公式。
