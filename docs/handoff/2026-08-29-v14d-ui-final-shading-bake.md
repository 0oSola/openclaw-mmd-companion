# [Stage 2A-GF2] Blender UI 固定帧最终着色烘焙 — 交付报告（视觉 Gate 未通过）

日期：2026-08-29；工作树：`E:\codexWorktree\1ca8\MMD project`；分支：`codex/v14d-ui-final-shading-bake`；基线：`8d7d6d3f915996e7aac693807b0643db12dcb6a9`（HEAD 未变，本票改动未提交前均为工作区改动）。

## 正式结论

**视觉 Gate 未通过。本票不得宣称「明显对齐」或「已解决」。** 已建立一条可复现、默认关闭的最终着色烘焙诊断链路（环境 Gate / 烘焙资产 Gate 通过），但**烘焙显示相对权威参考的四 ROI 三通道 MAE 全部远超验收线**（每通道 ≤20/255 且相对基线下降 ≥50%），主验收未达成。

**验收修正轮（同日）**：主会话复跑发现原「按材质名/槽精确注入」不成立——`V14D_BAKED_MATERIAL_MAP` 中 Face/EyeWhite 共用 face_d 键、HairA/HairB 共用 hair_d 键、Top/Cape 共用 cloth1_da 键，`reze-engine/src/asset-reader.ts` `fileListToMap()` 对相同 webkitRelativePath 用 `Map.set()` 后写覆盖前写，实际 EyeWhite 覆盖 Face、HairB 覆盖 HairA、空 Cape 覆盖 Top（与并排图红黑脸/头发错误/胸口近黑完全吻合）。已改为**逐材质独立绑定**（唯一逻辑键 `Textures/v14d-baked/baked_<key>.png` 注入 + 加载后按 PMX 材质名改写 diffuse 纹理路径），新增逐材质绑定硬 Gate（9 材质缺一不可，`faceApplied` 不再作为注入通过证据）。修正后 Web 注入 Gate 通过、画面恢复正确材质映射，但四 ROI 仍超标（见下），视觉 Gate 维持未通过。

四 ROI 实测 MAE（0–255 域，`.scratch/v14d-ui-final-bake/roi-compare.json`）：

映射**修正后**四 ROI 实测 MAE（0–255 域，`.scratch/v14d-ui-final-bake/roi-compare-fixed.json`）：

| ROI | R | G | B | 判定 |
| --- | --- | --- | --- | --- |
| face | 115.39 | 112.92 | 100.52 | 未通过 |
| frontHair | 66.69 | 67.76 | 67.42 | 未通过 |
| backHair | 70.77 | 69.29 | 67.92 | 未通过 |
| chest | 71.20 | 69.55 | 70.16 | 未通过 |

并排与差异图：`.scratch/v14d-ui-final-bake/side-by-side.png`、`diff-x3.png`、`face-roi-crop.png`。

**第二次验收修正轮（同日，真实 GPU 绑定）**：主会话二次复跑由 reze-engine 源码证明——`engine.loadModel()` 在 `engine.ts:3018` await `addModel()`，`addModel()` 在 `:3040` 执行 `setupModelInstance()`，`setupMaterialsForInstance()` 在 `:3656` 根据当时的 `textures[diffuseTextureIndex].path` 上传 GPUTexture 并创建 draw-call bind group。此前在 `RezeWebGpuStage.tsx` 于 loadModel 返回后才改 `tex.path`，**不会重传 GPUTexture 或重建 bind group**，修正图实际是原 PMX 纹理的 unlit 画面（脸部近白），不是 baked 文件；且 `validateBakedBinding` 只校验自己写入的名单（自证）。本轮回改为**真实 GPU 绑定**：扩展 `web/scripts/patch-reze-engine.mjs` 给 files 版 `loadModel` 增加默认关闭的 `materialDiffuseOverrides`（材质名→唯一 logicalPath），在 `PmxLoader.loadFromReader()` 后、`setupMaterialsForInstance()` 前为每个目标材质**追加独立 texture entry 并改 diffuseTextureIndex**（不改磁盘 PMX/材质槽/拓扑/VMD）。绑定 Gate 改为读取引擎真实绑定状态 `canvas.dataset.v14dBakedActual`（materialName|diffuseTextureIndex|logicalPath，GPU 材质建立时的实际来源），逐项与 `V14D_BAKED_BINDINGS` 核对，并新增会失败的负测（Face 错绑 EyeWhite / 漏 Top 必 exit 1）。

真实绑定证据（`capture-fix-round3/capture-summary.json` bakedGolden.state.bakedActual）：9 个材质各自获得**独立追加的 diffuseTextureIndex 19–27**（原始 PMX 纹理为 0–18），最终 logicalPath 逐项等于预期烘焙键。**最终验收收尾（同日）**：(1) 修复 patch-reze-engine 幂等标记冲突——src/engine.ts 实现补丁与类型声明 target 曾共用 `materialDiffuseOverrides` marker，导致类型声明被跳过；现每个 target 用独立 marker（实现 `__mdoStart = texs.length`、类型完整字段声明），`--verify` 证明四处（src 实现/类型、dist 实现/类型）恰好各注入一次（首次完整注入+二次幂等）。(2) 强化真实绑定 Gate：九项 idx 必须为有限非负整数、互不相同，且排序后恰好覆盖引擎报告的追加纹理区间 `[start, start+count)`（补丁在 GPU 材质建立前把 `{start,count}` 写入 `model.__v14dBakedTextureRange`，页面输出 `v14dBakedTexStart/Count/Final`）；实测 start=19 count=9 final=28，9 材质 idx 19–27 连续覆盖，path 逐项匹配。(3) `--self-test-binding-gate` 增加共享 idx、负 idx、落在原始纹理区间三种负例，全部必拒；正常九个连续新增 idx 才通过。(4) 删除 bakedGolden 分支 loadModel 后再次 `tex.path=` 的冗余旧逻辑，只保留真实 pre-GPU override。证据 `capture-final-round/`。数值证据：bakedGolden 的 face `meanLinear` 由伪绑定的 `[0.642,0.642,0.643]`（原纹理近白 unlit）变为 `[0.503,0.214,0.177]`（烘焙纹理真实采样，含暖色调），直接证明烘焙图进入 GPU 采样。画面（`capture-fix-round3/face-static-bakedGolden.png`）肤色/衣服/头发均有烘焙明暗与高光层次。

真实 GPU 绑定修正后四 ROI 实测 MAE（0–255 域，`.scratch/v14d-ui-final-bake/roi-compare-round3.json`，`web/scripts/v14d-roi-compare.mjs`）：

| ROI | R | G | B | 判定 |
| --- | --- | --- | --- | --- |
| face | 111.57 | 81.67 | 70.68 | 未通过 |
| frontHair | 73.72 | 63.32 | 55.76 | 未通过 |
| backHair | 78.42 | 71.72 | 67.82 | 未通过 |
| chest | 85.20 | 83.04 | 81.58 | 未通过 |

真实绑定使多数通道 MAE 相对伪绑定明显下降（face G 112.92→81.67、B 100.52→70.68），证明真实绑定有效；但四 ROI 仍全部远超 ≤20/255 且未相对基线下降 ≥50%，**视觉 Gate 维持未通过**。剩余差异继续验证 Cycles/EEVEE 口径差异候选（须经 EEVEE 等价捕获单变量对照才可升级为已证明根因）。

## 已证明 vs 仅候选（严格区分）

已证明（有命令/产物/数值支撑）：
1. **环境 Gate 通过**：带 UI Blender 5.1.1 会话（MCP 连接，非 `-b`）中 `bpy.ops.object.bake` `poll()` 为 True；上一轮无头环境 `poll()` 恒 False 的硬阻塞被解除。证据 `cycles_check.json`。
2. **烘焙资产 Gate 通过（8/9 非空）**：face/eyeWhite/eyes/eyesPlus/body/top/hairA/hairB 共 8 个 Cycles COMBINED 烘焙产出非空 PNG，UV 逐纹素与原始纹理完全对齐（darkestRow 502 vs 503，证明无 V 翻转）。`baked_cape.png` 为**空图**（cape 在 frame120 相机内不可见、poly_count=0），属预期，不影响四 ROI。产物 `.scratch/v14d-ui-final-bake/baked-final/baked_*.png`，用户注入副本 `D:\mmd\克莱妲原皮\v14d-baked-final\`。
3. **Web 注入 Gate 通过（真实 GPU 绑定修正后）**：真实绑定硬 Gate 通过——读取引擎 GPU 材质建立时的实际绑定状态 `v14dBakedActual`，9 材质各自获得独立追加的 diffuseTextureIndex（19–27）且最终 logicalPath 逐项等于预期烘焙键；负测（Face 错绑 EyeWhite / 漏 Top）必 exit 1。unlit/passthrough 显示，frame120/state2/blend0/cameraLocked/paused 全部满足，pageErrors/failedRequests/httpBad=0。证据 `web/.scratch/v14d-ui-final-bake/capture-fix-round3/`。（注：此前基于自证名单的「映射修正后通过」不成立——loadModel 返回后改 path 不会重传 GPUTexture。）
4. **重复逻辑键覆盖是 Web 侧画面错误的直接根因（已证明）**：`fileListToMap()` `Map.set()` 后写覆盖前写，修正前 Face 实际绑定 `baked_eyeWhite.png`、HairA 绑定 `baked_hairB.png`、Cth1-Top 绑定空的 `baked_cape.png`（机器证据 `binding-negative-proof.json`）。

仅候选（未证明，不得当作根因结论）：
- Cycles 烘焙用的采样数（64）/去噪/色彩管理是否足以逼近 EEVEE；
- EEVEE 的 Toon/Face Shadow 与 Cycles 对 ShaderToRGB 的处理差异；
- Web 端 unlit/exposure=0 与 Blender AgX 显示变换的剩余口径差异。

## Cycles / EEVEE / Web 三方口径差异（候选根因，映射修正后对照）

- **权威基准（EEVEE）**：`Koleda_V14D_...blend` 的 frame120 EEVEE 渲染是票据指定的唯一视觉基准。
- **本票烘焙（Cycles）**：Cycles 是路径追踪器，对六 AREA 灯/世界光/Toon/Face Shadow 的积分方式与 EEVEE 光栅化不同；映射修正后的并排对照（`face-roi-crop-fixed.png`）显示 Web 脸色偏亮偏白、缺少 EEVEE 的暖色调与 State2 阴影层次。
- **Web（unlit/passthrough）**：忠实显示烘焙纹理（exposure=0），但纹理本身已是 Cycles 口径。

**注意**：Cycles/EEVEE 口径差异是在**映射修正后**的对照中暴露的，属于**候选根因**而非先前所称的「已证明主导根因」。修正前的 ROI 主要由重复键覆盖主导，不能据此归因 Cycles/EEVEE。要闭合视觉 Gate，纹理须来自 **EEVEE 等价的最终着色**（而非 Cycles），或在 Web 侧实时逼近 EEVEE 六灯——均为下一 failure family，本票不实施。

## 已验证 Gate / 测试 / 命令

- `npm run build`：通过（重试后；首次 ENOENT 为偶发 `.next-codex-build` 文件锁）。
- `npm run build` 前置 `patch-reze-engine.mjs`：幂等通过。
- 捕获 gate：`node web/scripts/capture-v14d-face-static.mjs --mode=bakedGolden` → `===CAPTURE-GATE-OK===`，faceApplied=true，faceSamples=4639，pageErrors/failedRequests/httpBad=0。

### 第二次验收修正轮（真实 GPU 绑定）复跑命令与结果

- 补丁幂等验证：`node web/scripts/patch-reze-engine.mjs --verify` → `===PATCH-VERIFY-OK===` exit 0（src/dist 实现与类型四处恰好各注入一次）。

以下全部在真实 GPU 绑定修正后复跑，dev server `PORT=3101 node ./scripts/run-next.mjs dev`（全量重建 `.next-codex-dev` 以纳入 node_modules 补丁）：

- 引擎补丁：`node web/scripts/patch-reze-engine.mjs` → 幂等注入 `materialDiffuseOverrides`（engine.ts/engine.js/engine.d.ts 三处），exit 0。
- 构建：`npm run build` → exit 0。
- 全模式 capture：`V14D_CAPTURE_BASE=http://127.0.0.1:3101/mmd-calibration-render node web/scripts/capture-v14d-face-static.mjs .scratch/v14d-ui-final-bake/capture-fix-round3` → `===CAPTURE-GATE-OK===` exit 0；normal/faceShadowOnly/finalFaceComposite/bakedGolden 四模式 pageErrors=0 failedRequests=0 httpBad=0；**真实绑定硬 Gate 通过**（bakedGolden.state.bakedActual 9 材质独立 diffuseTextureIndex 19–27 + 预期 logicalPath 逐项一致）。
- 绑定 Gate 负测：`node web/scripts/capture-v14d-face-static.mjs --self-test-binding-gate` → `===SELF-TEST-BINDING-GATE-OK===` exit 0（正常九项通过；Face 错绑 EyeWhite、漏绑 Top 均被拒绝 exit 1）。
- 真实 user-path：`V14D_CAPTURE_BASE=http://127.0.0.1:3101/mmd-calibration-render node web/scripts/userpath-v14d-face-static.mjs` → `===USER-PATH-OK===` exit 0（三模式 meanLinear 与 capture 一致）。
- 默认门控：`V14D_CAPTURE_ORIGIN=http://127.0.0.1:3101 node web/scripts/probe-v14d-face-default.mjs` → `===DEFAULT-GATING-OK===` exit 0（faceStaticMain=false、assetsInjected=false、pageErrors=[]，生产默认完全旁路）。
- VMD 三文件 diff：`git diff 8d7d6d3f -- mmdCompanionRuntime.js vmdIO.ts vmd_writer.py` → 0 行（无改动）。
- `git diff --check HEAD` → exit 0（无 EOF 空行/空白错误）。
- 四 ROI：`node web/scripts/v14d-roi-compare.mjs blender_ref_f120.png capture-fix-round3/face-static-bakedGolden.png roi-compare-round3.json` → 四 ROI 三通道 MAE 全部超标（见上表），视觉 Gate 未通过。
- 默认门控：`node web/scripts/probe-v14d-face-default.mjs`（V14D_CAPTURE_ORIGIN=3101）→ `===DEFAULT-GATING-OK===`（无 v14dFaceStatic=1 时诊断完全旁路）。
- VMD 三文件 diff：`git diff 8d7d6d3f -- mmdCompanionRuntime.js vmdIO.ts vmd_writer.py` 为空（动画运行时零回归）。
- tsc：仅 base_commit 已存在的 `tests/e2e/app-routes-smoke.spec.ts __speechCancelCount` 错误，与本票无关，本票改动无新增类型错误。

## 改动边界核验

- 修改文件：`web/src/features/stage/v14dFaceStatic.ts`、`RezeWebGpuStage.tsx`、`web/src/app/mmd-calibration-render/page.tsx`、`web/scripts/capture-v14d-face-static.mjs`、`workflow/workflow-glossary.zh-CN.md`（全部在授权范围）。
- 未改动：PMX/VMD 文件、骨骼/权重/Morph/IK/Grant/Physics、VMD 插值/播放时钟/seek/play/pause、PMX 拓扑、默认生产渲染。
- `.scratch/` 与 `web/.scratch/` 证据不入版本（未跟踪）。
- 默认 `finalFaceComposite` 保持不变；`bakedGolden` 为非默认诊断模式；生产默认入口永远关闭。

## 残留风险与未完成项

- **视觉 Gate 未通过**：映射修正后四 ROI 仍全部超标（候选根因为 Cycles/EEVEE 口径差异）。
- **baked_cape.png 为空**（cape 在 frame120 相机内不可见，poly_count=0），属预期；逐材质绑定 Gate 已确保空 Cape 不影响 Top。
- Web 端 `bakedGolden` 因视觉 Gate 未通过，**不应作为对齐通过状态**；管线保留作诊断 checkpoint。

## 下一 failure family 的最小建议边界（不在本票实施）

1. **EEVEE 等价最终着色捕获**：在带 UI Blender 会话中，用 EEVEE（非 Cycles）把最终着色固化进纹理——例如逐材质渲染到 UV 空间的发射/捕获，或用 EEVEE 的 `bpy.ops.render` 反投影；关键是让烘焙纹理与权威 EEVEE 基准同口径。
2. **Web 实时六灯近似**：在 reze-k3 中按 Blender 六 AREA 灯的方向/色温/强度做实时近似（不烘焙），使 Web 直接逼近 EEVEE 画面。这是独立票据，需重新做灯光取证。
