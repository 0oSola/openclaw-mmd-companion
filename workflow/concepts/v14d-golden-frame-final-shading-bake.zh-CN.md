# V14D 黄金帧最终着色烘焙

## 中文名称

V14D 黄金帧最终着色烘焙（逐材质独立绑定）

## 英文机器名

`bakedGolden`（诊断模式 `v14dFaceMode=bakedGolden`）；逐材质绑定描述 `V14D_BAKED_BINDINGS`；逐材质绑定门禁 `validateBakedBinding`。

## 概念定义

V14D 黄金帧最终着色烘焙是固定初始帧（frame120、Face State 2、Blend 0、相机锁定、暂停）下的一条**默认关闭**的视觉对齐诊断链路。它在**带 UI 的 Blender 会话**（非 `-b` 无头）中用 Cycles `bpy.ops.object.bake(type='COMBINED')` 把当前帧的最终可见着色——六 AREA 灯、世界光、Toon、Face Shadow(State2/Blend0)、材质响应与必要高光——固化成逐材质 UV 派生纹理（`baked_<材质>.png`），再在 Web 诊断入口对这些材质套纯纹理 unlit/passthrough graph 显示。

本概念的核心不变量是**逐材质独立绑定**：每个目标 PMX 材质必须各自解析到自己的烘焙资产，互不共享逻辑键、互不覆盖。

## 解决的问题

1. 无头环境 `bpy.ops.object.bake` `poll()` 恒 False，无法在 CI/无窗口会话做最终着色烘焙；带 UI 会话解除该硬阻塞。
2. 旧「反照率烘焙诊断」只固化 BaseColor 反照率、不含光照，实测 ROI MAE 不降反升；最终着色烘焙含全部光照，是闭合材质/光照视觉 Gate 的正确方向。
3. **重复逻辑键覆盖**（验收修正轮根因）：原实现把 Face/EyeWhite 共用 `face_d` 键、HairA/HairB 共用 `hair_d` 键、Top/Cape 共用 `cloth1_da` 键，而 reze-engine `asset-reader.ts` 的 `fileListToMap()` 用 `Map.set()` 后写覆盖前写，导致 EyeWhite 覆盖 Face（红黑脸）、HairB 覆盖 HairA、空 Cape 覆盖 Top（胸口近黑）。`faceApplied=true` 只证明 graph 应用，不能作为纹理注入通过证据。

## 适用场景

- 固定帧（frame120/State2/Blend0）的材质/光照视觉对齐诊断与验收。
- 需要在 Web 端核对 Blender 最终可见着色（六灯/世界光/Toon/Face Shadow）时。

## 不适用场景

- 动态五档、窄混合、迟滞或通用实时六灯（独立票据）。
- 默认生产渲染路径（默认仍为 `finalFaceComposite`，生产入口永远关闭）。
- 修改 PMX/VMD 文件、骨骼、权重、Morph、IK、Grant、Physics、VMD 播放时钟或 PMX 拓扑。

## 核心不变量

1. **唯一逻辑键**：每个烘焙文件以唯一逻辑路径 `Textures/v14d-baked/baked_<key>.png` 注入 fileMap，绝不复用原始纹理键（face_d/hair_d/cloth1_da 等）。禁止用重复 `webkitRelativePath` 冒充按槽绑定。
2. **逐材质独立绑定**：加载模型后按 PMX 材质名把该材质的 diffuse 纹理路径改写为对应烘焙键，引擎按路径独立解析。`Face`→`baked_face.png`、`EyeWhite`→`baked_eyeWhite.png`、…、`Cth1-Cape`→`baked_cape.png`，一一对应。
3. **逐材质绑定硬 Gate**：9 个目标材质（Face/EyeWhite/Eyes/Eyes+/HairA/HairB/BodySkin/Cth1-Top/Cth1-Cape）必须各自解析到预期烘焙文件，绑定材质数必须恰好等于 9。任何共享键覆盖、缺失文件、空 Cape 错误影响 Top 都必须 exit 1。
4. `baked_cape.png` 为空属预期（cape 在 frame120 相机内不可见、poly_count=0），不得据此判定烘焙资产缺失，也不得让它影响 Top。
5. 默认关闭；不得把失败实验设为默认；视觉 Gate 未通过时不得宣称「明显对齐完成」。

## 证据与计算口径

- **真实绑定证据**：`canvas.dataset.v14dBakedActual`（RezeWebGpuStage 在 loadModel 返回后从 `model.getMaterials()/getTextures()` 读取的 `materialName|diffuseTextureIndex|logicalPath`）。这是 `setupMaterialsForInstance` 上传 GPUTexture/建 bind group 时的**实际来源**，非自证名单；capture 脚本 `validateBakedBinding()` 硬 Gate 逐项核对（材质名/独立追加的 diffuseTextureIndex/最终 logicalPath 与 V14D_BAKED_BINDINGS 完全一致）。 idx 必须为有限非负整数、互不相同，且排序后恰好覆盖引擎报告的追加纹理区间 [start, start+count)（补丁在 GPU 材质建立前写入 `model.__v14dBakedTextureRange`，页面输出 start/count/final）；负测覆盖错绑/漏绑/共享 idx/负 idx/落在原始区间。
- **负向证明**：`web/.scratch/v14d-ui-final-bake/binding-negative-proof.json` 记录修正前每个目标材质实际绑定的烘焙资产身份/哈希（EyeWhite 覆盖 Face、HairB 覆盖 HairA、空 Cape 覆盖 Top）。
- **视觉口径**：相对权威 EEVEE frame120 参考 `blender_ref_f120.png` 的四 ROI（face/frontHair/backHair/chest）三通道 MAE（0-255 域）。修正后数值存 `.scratch/v14d-ui-final-bake/roi-compare-fixed.json`。
- **三方口径差异（候选根因）**：权威基准为 EEVEE 光栅化；本票烘焙为 Cycles 路径追踪 COMBINED；Web 为 unlit/passthrough 忠实显示（exposure=0）。Cycles/EEVEE 口径差异须在**映射修正后**的对照中判断，修正前 ROI 由覆盖链主导、不能据此归因。

## 正例

- 9 个材质各自以唯一逻辑键注入，引擎在 GPU 材质建立前为每个目标材质追加独立 texture entry 并改 diffuseTextureIndex（`materialDiffuseOverrides`，默认关闭）；`v14dBakedActual` 逐项等于预期，`validateBakedBinding` 通过。
- `baked_cape.png` 为空但 Top 仍绑定到自己的 `baked_top.png`，不受影响。

## 反例

- Face/EyeWhite 共用 `face_d` 键注入（`Map.set` 覆盖，EyeWhite 覆盖 Face）。
- 用 `faceApplied=true` 作为纹理注入通过证据（它只证明 graph 应用）。
- 把 Cycles/EEVEE 口径差异称为「已证明主导根因」（映射修正前不能归因，修正后也仅为候选）。
- 视觉 Gate 未通过时宣称「黄金帧对齐成功」。

## 相关契约与门禁

- 绑定描述：`web/src/features/stage/v14dFaceStatic.ts` `V14D_BAKED_BINDINGS`。
- 绑定实现：`web/src/features/stage/RezeWebGpuStage.tsx`（bakedGolden 分支改写材质 diffuse 路径）。
- 逐材质绑定硬 Gate：`web/scripts/capture-v14d-face-static.mjs` `validateBakedBinding()`。
- 采集门禁：`npm run build`、capture（含 bakedGolden）、真实 user-path、default gate、VMD 三文件 diff。

## 失败后的修正路线

1. 红黑脸/头发错误/胸口近黑 → 检查是否存在重复逻辑键覆盖（`fileListToMap` `Map.set`），改为唯一逻辑键 + 逐材质改写。
2. 绑定 Gate 报材质缺失 → 检查 PMX 材质名与 `V14D_BAKED_BINDINGS` 是否一致、烘焙文件是否存在。
3. 视觉 Gate 仍未过（真实 GPU 绑定修正后）→ 继续验证 Cycles/EEVEE 口径差异候选（须经 EEVEE 等价捕获单变量对照才可升级为已证明根因），走下一 failure family：EEVEE 等价最终着色捕获，或 Web 实时六灯近似（均不在本票实施）。

## 与现有概念的关系

- 「黄金帧静态预览（v14dFaceStatic）」提供固定帧诊断入口与三模式（normal/faceShadowOnly/finalFaceComposite）；本概念是其下的第四种非默认模式 bakedGolden。
- 「最终着色烘焙」取代已作废的「反照率烘焙诊断（失败实验）」。
- 术语表 `workflow/workflow-glossary.zh-CN.md`「黄金帧最终着色烘焙（bakedGolden）」保存中文释义、允许/禁止用法与路由影响，本文件保存完整定义与不变量。
