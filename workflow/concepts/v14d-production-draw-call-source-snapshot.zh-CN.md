# V14D 生产绘制调用几何源快照

## 中文名称

V14D 生产绘制调用几何源快照。

## 英文机器名

- 概念 id：v14d-production-draw-call-source-snapshot
- TypeScript 类型：V14dProductionDrawCallSourceSnapshot
- reze-engine 方法：getProductionDrawCallSourceSnapshot(captureId, frame)
- triUV 读取来源：production-draw-call-buffers

## 概念定义

生产绘制调用几何源快照，是 reze-engine 在同一 JavaScript realm 内向显式验收诊断暴露的、只读的生产绘制调用来源描述。它记录 material-ID pick 与正常生产绘制调用实际共同使用的 ModelInstance GPU 资源、draw range、绑定组、管线、渲染目标，以及蒙皮和 Morph 的变换来源；后续诊断 pass 可以直接复用快照中的 GPU 句柄生成 triId、插值 UV 和同像素身份证据。

快照不是新的渲染路径，也不是把 CPU 模型数组复制成一份“看起来相同”的诊断几何。它的权威性来自生产 draw call 的真实引用关系：vertexBuffer、indexBuffer、jointsBuffer、weightsBuffer、skinMatrixBuffer、pick per-frame/per-instance/per-material bind group，以及生产 draw call 的 count/firstIndex。可落盘的 audit 只保存身份、范围、格式、统计和布尔核对结果，不保存 GPU 句柄。

## 解决的问题

旧 triUV 诊断把 model.getVertices() 的 CPU 基础顶点与生产 material-ID pick 分开使用。生产路径的 GPU Morph 会原地写入 ModelInstance.vertexBuffer，生产 pick 又从该 buffer 绘制；CPU 基础顶点因此可能与生产像素不在同一几何状态。更早的零值读回探针还没有给源 GPUBuffer 声明 COPY_SRC，读回失败或不具备合法 WebGPU 语义，不能据此断言生产 vertexBuffer 为空。

本概念把“哪个数据是生产身份的权威”固定在生产 draw call seam：

1. 生产 material-ID pick 的材质身份仍来自实际 pick pipeline 和实际 per-material bind group。
2. triUV 诊断直接复用生产 draw call 的顶点、索引、joints、weights 和 skin matrix buffer。
3. GPU Morph 仍在生产 vertexBuffer 上原地计算；诊断只读该结果，不替换、不回写。
4. 同一次 captureId/frame 内，生产 pixel、material mask、triUV 和 source audit 必须可以相互核对。

## 适用范围

- 适用：/companion 的 reze-k3 / Reze WebGPU 验收诊断，以及同一引擎实例内需要证明生产 draw-call 几何身份的工具。
- 适用：Brows、Lashes 或后续其他材质槽的 material-ID + triUV 同像素诊断。
- 适用：生产 draw range、绑定组、主管线、pick 管线、HDR/mask resolve 纹理和蒙皮/Morph 来源的机器审计。
- 不适用：修改生产视觉公式、材质颜色、alpha 阈值、灯光、星空、曝光、gamma、tone mapping、相机或 PMX/VMD 数据。
- 不适用：把 CPU base 顶点、矩形 ROI、屏幕平移、mask 膨胀或 depthBias 当作生产几何源。
- 不适用：跨 JavaScript realm 序列化 GPUBuffer、GPUBindGroup 或 GPUTexture；这些句柄只在生成快照的同一 realm 内有效。

## 核心不变量

1. **显式请求**：快照方法只接受非空 captureId 和有限 frame；方法本身不触发渲染、不提交命令、不写入 buffer、不改变生产状态。
2. **来源身份**：每个实例必须给出 vertex、index、joints、weights、skinMatrices 的生产 GPUBuffer 引用，并以同一实例的 modelInstances[name] 引用逐项比较。
3. **合法读回**：需要被审计的生产源 buffer 必须声明 GPUBufferUsage.COPY_SRC；没有该 usage 时不得把读回的零值或异常包装成“源为空”。
4. **布局固定**：生产 vertex buffer 使用 float32x8（position3 + normal3 + uv2，stride 32）；joints 使用 uint16x4；weights 使用 unorm8x4；index 使用 uint32。诊断 pass 必须按此布局解释数据。
5. **draw range 一致**：每个正常 material draw 必须能按 count + firstIndex 找到对应 pick draw；drawIndex、pickDrawCallIndex、材质名、范围和 per-material bind group 必须可核对。
6. **绑定一致**：快照中的 pick pipeline 必须等于 engine.pickPipeline；per-frame、per-instance、per-material bind group layout 与实际 pick 绑定兼容；目标 draw 的主 bind group、pick bind group 和主管线身份必须可审计。
7. **变换来源完整**：skinMatrixSource 必须指向 model.getSkinMatrices -> skinMatrixBuffer；GPU Morph 模式必须记录 GPU morph compute writes vertexBuffer、Morph weights 读回状态、非零权重统计和 dispatch 是否仍 pending。
8. **同一渲染目标**：hdrResolveTexture 与 maskResolveTexture 的审计身份必须分别等于 engine.hdrResolveTexture 和 engine.maskResolveTexture；HDR 格式必须记录。
9. **审计可序列化**：audit 不包含 GPU 句柄，只保存 schemaVersion、captureId、frame、source、buffer 统计、索引完整性、draw range/绑定核对和渲染目标身份。
10. **默认生产不泄漏**：captureHairTriUv 只有在显式 acceptance probe 下暴露；sourceMode 默认是 production-draw-call，但默认生产入口不调用该 probe。
11. **负测必须改变来源语义**：cpu-base 仅可作为 wrong-source 负测，不能成为正常 fallback；material-swap 必须交换目标槽身份并由同像素 Gate 自然拒绝。
12. **不以辅助取景伪造身份**：验收探针的 cameraOrbit 只用于让目标材质进入画布；它不能改变生产相机默认值，也不能用屏幕平移、depthBias 或覆盖扩大来制造重叠。nearClipOverride 若启用，必须保存并恢复采集前的 near；回放完成或异常后必须复位验收取景。

## 接口契约

### 引擎快照

getProductionDrawCallSourceSnapshot(captureId, frame) 返回 schemaVersion=1、source=reze-engine-production-draw-call 的对象，至少包含：

- pick：生产 pick pipeline、per-frame bind group 及三类 bind group layout；
- renderTargets：生产 HDR resolve texture、material mask resolve texture 和 HDR format；
- instances：实例名、可见性、五类生产几何/变换 buffer、字节长度、顶点/索引格式、sourceIdentity、变换来源、pick per-instance bind group；
- drawCalls：材质名与索引、count、firstIndex、主 draw index、对应 pick draw index、主/ pick bind group、主 pipeline、groupId 和 graphName；
- pickDrawCalls：生产 pick 原始顺序中的材质、count、firstIndex、draw index、pick draw index 和 per-material bind group。

句柄字段只允许被同一 realm 的 readV14dProductionDrawCallSourceSnapshot 和 readV14dProductionSourceTriUv 消费。调用方不得把句柄写入 JSON、localStorage、共享配置或后端。

### triUV 诊断

readV14dProductionSourceTriUv 先按生产 pickDrawCalls 原顺序建立 depth prepass，再只对目标 draw call 拆成三索引小 draw，复用同一 vertex/index/joints/weights/skinMatrix buffer、同一 per-frame/per-instance bind group 和真实 per-material pick bind group。tri metadata 提供目标槽局部 triId 与 materialId；triUV pass 使用 equal 深度测试，depthBias.constant=0、slopeScale=0。返回的 triId、uv、faceMask 与生产材质 mask 使用同一画布尺寸和同一相机状态。

captureHairTriUv 在一个原子采集中返回 canvas、material-ID/depth、triUV、triangleUvs、captureId 和 captureEvidence。正常 sourceMode=production-draw-call；只有明确的 --neg-wrong-source 才允许 sourceMode=cpu-base。

### 错误分类

机器报告使用以下错误代码，不把不同 failure family 混成“对齐失败”：

- interface-unavailable：引擎没有暴露生产源快照接口；
- invalid-capture-request：captureId 为空或 frame 非有限数；
- snapshot-rejected：引擎无法建立生产 draw-call 与 pick draw 的一致快照；
- buffer-readback-failed：COPY_SRC 合约满足后 GPU buffer 读回失败；
- buffer-readback-incomplete：部分必需 buffer 未返回。

## 证据或计算口径

生产源 audit 从每个目标实例读回 vertex、index、joints、weights、skin matrices 和可用的 Morph weights，统计 byteLength、valueCount、finiteValueCount、nonZeroValueCount、nanCount、infCount、maxAbs；vertex 额外统计非零位置顶点数和 positionBounds。索引按 uint32 解释，检查所有 pick draw range 是否在 index 数组内，并检查被引用的最大顶点索引是否小于 vertexCount。

真实回放中的代表性证据如下：

- 实例 companion 的 geometry 为 vertexCount=60352、indexCount=235944、vertexStrideBytes=32、indexFormat=uint32、jointsFormat=uint16x4、weightsFormat=unorm8x4；
- Brows draw 为 count=312、firstIndex=9330，Lashes draw 为 count=1866、firstIndex=9642；两者 rangeMatchesPick、mainBindGroupMatchesEngine、pickBindGroupMatchesEngine 和 mainPipelinePresent 均为 true；
- vertex 源 nonZeroPositionVertexCount=60352，positionBounds 为 x∈[-7.3590,7.3590]、y∈[0.0127,19.9587]、z∈[-1.9377,5.4294]；
- skin matrix 来源为 model.getSkinMatrices -> skinMatrixBuffer，matrixCount=401，skinMatrix nonZeroValueCount=5147；
- Morph 模式为 gpu-compute-in-place，Morph weights 非零数为 1，morphDispatchPending=false，morphWeightsReadback=true；
- hdrResolveTexture 和 maskResolveTexture 均通过 sameAsEngine=true。

同一回放的像素结果是 Brows production=257、triUV=257、overlap=257、overlapRatio=1、centroidShiftPx=0；Lashes production=9320、triUV=9320、overlap=9320、overlapRatio=1、centroidShiftPx=0。该结果只证明本票的 production-draw-call 同源接口和像素身份闭环，不扩张到未声明的视觉 Gate。

## 正例

1. captureId=1、frame=120 的 production-draw-call 快照中，Brows/Lashes 的 draw range 与 pick 一致，五类 buffer 引用与 modelInstances[name] 一致，顶点源非零，索引完整，蒙皮/Morph/resolve 纹理证据完整；同一次 captureHairTriUv 中两个槽位均 overlapRatio=1、centroidShiftPx=0。
2. patch-reze-engine.mjs 在 clean reze-engine fixture 上首次和二次运行均幂等成功，src、dist、d.ts 均得到同一生产源接口，缺 anchor、缺文件和重复 marker 都硬失败。

## 反例与负测

1. **旧 CPU base 来源**：sourceMode=cpu-base。报告中 Lashes production 约 9321、triUV 约 6026、overlap 约 21、质心偏移约 92px；命令 exit=1，证明旧错源会被同像素 Gate 检出。
2. **材质槽交换**：materialIdSwap=true。Brows/Lashes 的生产与 triUV 槽身份不一致，两个槽 overlap=0；命令 exit=1，negativeVerdict.status=rejected 且审计证据仍完整。
3. **无 COPY_SRC 的旧读回**：只移除源 buffer 的 COPY_SRC 后尝试映射读回。该探针属于接口/读回失败，不能解释为“生产顶点全零”，必须报告 buffer-readback-failed 或 buffer-readback-incomplete。
4. **伪造来源身份**：只复制 model.getVertices()、只改 sourceIdentity 字符串、只比较材质计数或只使用 ROI。它们都没有证明生产 draw call 的 GPU 引用关系，不能通过 productionSourceIdentity。
5. **隐式视觉补偿**：增加 depthBias、扩大 mask、平移屏幕或放宽重叠阈值。即使像素数量增加，也不属于本接口的有效修复，验收必须拒绝。

## 相关 contract、Gate 与失败修正路线

- contract：v14d-production-draw-call-source-snapshot。
- 引擎接线：web/scripts/patch-reze-engine.mjs；目标为 reze-engine src/engine.ts、dist/engine.js、dist/engine.d.ts 的生产源接口与 COPY_SRC usage。
- 诊断接线：web/src/features/stage/v14dColorBaseline.ts；同帧接线：web/src/features/stage/RezeWebGpuStage.tsx 的 captureHairTriUv。
- 回归命令：node scripts/patch-reze-engine.mjs --self-test、node scripts/patch-reze-engine.mjs --verify、node scripts/repro-reze-production-vertex-source.mjs。
- 正式像素 Gate：Brows/Lashes 的 production material-ID 与 production-source triUV 同像素重叠比至少 0.6、质心偏移不超过 3px；Brows control 必须保持通过。
- 负测 Gate：--neg-wrong-source 与 --neg-mat-swap 均必须 exit=1，negativeVerdict.status=rejected，且失败原因不是接口缺失或读回异常。

修正顺序固定为：

1. 先确认 source interface 可用、captureId/frame 同步且错误分类明确；
2. 再核对 ModelInstance 五类 buffer 引用、COPY_SRC usage、顶点布局、index range 和 draw/pick 对应关系；
3. 再核对 GPU Morph、Morph weights、skin matrices 和 dispatch barrier；
4. 再核对 per-frame/per-instance/per-material bind group、pick pipeline、HDR/mask resolve texture；
5. 最后才分析 triUV 像素指标。不得先改阈值、视觉公式、alpha、相机默认值或资产。

## 与现有概念的关系

- 承接 v14d-hair-triuv-pixel-gate 的原子同帧证据要求，把 triUV 的几何来源从“诊断自行展开”收紧为“生产 draw-call 真实来源”。
- 为 v14d-brows-lashes-identity-tint 提供生产材质身份和恒等目标的同像素证据；它不改变恒等 tint 的视觉语义。
- 与 v14d-face-uv-visibility-gate 共用 material-ID、深度和 triUV 的审计思想，但本概念的重点是 reze-engine 生产 GPU buffer/bind group 身份，不承担 Blender/Web 姿态一致性。
- 属于 reze-k3-skin-variant 的诊断基础设施；默认生产舞台不启用，不改变 Face、BodySkin、HairA、HairB 或其他槽位的视觉公式。

## 失败后的修正路线

若 productionSourceIdentity 或 nonZeroVertexSource 失败，先检查引擎补丁是否从 clean fixture 正确注入 COPY_SRC 和快照方法；若 drawCallBindingsMatchPick 失败，检查 assignDrawCallGroups、pickDrawCalls 与 styleGroups 的重绑定关系；若 skinSourcePresent 或 morphSourcePresent 失败，检查 GPU Morph 输出 buffer、Morph weights 和 skin matrix 上传/flush；若 captureEvidenceChecks 失败，检查同一 captureId/frame 的原子采集边界。只有这些前置证据全部通过后，才允许讨论 Brows/Lashes 的像素对齐指标。
