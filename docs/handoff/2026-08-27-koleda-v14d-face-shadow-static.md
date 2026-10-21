# Koleda V14D Face State 2 静态黄金帧预览 — 交付报告（修正轮）

> 票据：`[Stage 2A-M1] V14D 固定初始脸部材质预览`
> 分支：`codex/v14d-face-shadow-static`　基线：`codex/v14d-basecolor` @ `f2524a060ef38f8af2828c36a3ddda9ca76df293`
> 日期：2026-08-27　状态：**已完成（已验证）**　本稿为第三轮（用户路径闭环 + 同口径分量 Gate）修正。

## 0.1 第三轮修正对照（主会话复验阻断项 → 处理）

1. **普通浏览器卡「正在初始化」、无文件选择器**：boot 原要求非空 `modelUrl` 才启动（faceStatic 走注入时 modelUrl 为空导致直接 return），已改为 faceStatic 不依赖 modelUrl；页面新增本地资产选择 UI（`webkitdirectory` 选 Koleda 目录 + 独立 VMD/派生合成图/派生阴影分量图选择器），资产未注入显示「请选择本地资产」面板；脚本 addInitScript 注入经轮询自动识别跳过面板。真实文件选择路径三模式可见。
2. **faceStatic 强制全局 unlit**：page.tsx 不再把 faceStatic 并入 `v14dUnlitDiagnostic`；三模式只把 Face 材质切到纯纹理 unlit graph（仅纹理不同的严格 A/B），其余材质保持 reze-k3 正常分组。
3. **通用 VMD effect 未排除 faceStatic**：两个通用 VMD effect 显式 `return`，注入 VMD 只在 boot 内加载一次并 seek frame120→pause→stopRenderLoop→renderFrame(0)。
4. **脚本不非零退出**：capture/visible/probe 均加硬断言（canvas ready、faceSamples>1000、模式/帧/锁定正确、无 pageErrors/requestfailed/HTTP 4xx/5xx），任一失败 exit 1。
5. **分量 Gate 口径不一致**：Blender 白光 Emission 参考 + Web 导出同一 Face pick mask（5865 像素），同 ROI 内量化输出正式同口径误差。
6. **已提交 roi-report.json 是旧失败证据**：用本轮 capture + 同口径 gate 重写，新增已提交 capture-summary.json / same-metric-gate.json。
7. **topology 写成 `mode=`**：改 `v14dFaceMode=` 并更新资产 UI/分量 Gate 描述。
8. **误称工作树干净**：本报告如实区分已提交证据与未跟踪截图产物。

## 0. 本轮修正对照（初审不通过项 → 处理）

## 0. 本轮修正对照（初审不通过项 → 处理）

| 初审证据 | 处理 |
|---|---|
| 1. normal 与 finalFaceComposite 同图无独立语义 | **已分**：normal=原始 face_d（不套 graph）；composite=BaseColor+State2。Face ROI 线性均值 G 通道差 0.052，见 §5.2 |
| 2. faceShadowOnly 是白底乘法因子 | **已改**：黑底纯衰减 `1-shadowFactor`（State2 弱→近黑），Blender 出同定义 Emission 参考，见 §5.3 |
| 3. Diff 口径不一致 | **已拆两层门禁**（分量层 + 最终显示层），本票只做分量层并明确标注，见 §6 |
| 4. 捆绑 87 个第三方资产（约 87 MiB） | **已移除**：仓库不保留 PMX/VMD/纹理 blob，改本地注入，见 §4 |
| 5. 全局 `window.fetch` monkeypatch | **已删除**：改引擎 files 变体 + `createFileMapAssetReader` 完全局部解析，见 §4 |
| 6. 未更新 topology | **已更新** `docs/architecture/current-system-topology.md`，见 §7 |
| 7. `isKoleda` 依赖外部标识符 / faceMaterialId=1 硬编码 | **已改**：faceStatic 强制 Koleda 锁定；Face pick ID 由材质名推导，见 §4 |
| 8. 真实浏览器白屏 + spa/ 404 + 门禁未统计 4xx | **已修**：File 注入无网络请求、无 404；门禁统计全部 HTTP 4xx/5xx；可见浏览器复验角色可见，见 §5.4 |

三项阻断项全部满足：normal/finalFaceComposite 独立且有机器指标差异；faceShadowOnly 为可独立对账纯衰减分量；无全局 fetch 包装，spa/ 404 已从资产解析层消除。

## 1. 结论

以权威 `Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend`（SHA-256 `1139617c…6a353cd4`）为唯一视觉基准，落地固定初始状态最小版本：入口 `/mmd-calibration-render?v14dFaceStatic=1`，**默认关闭**，仅显式启用；三模式 `v14dFaceMode = normal | faceShadowOnly | finalFaceComposite`。固定权威 PMX + 权威 frame-120 VMD、frame 120、640×640、固定近景相机、停止实时循环单帧渲染、默认暂停且相机锁定。脸部 State 2 阴影资产与合成逻辑全部从权威 `.blend` 节点取证追溯，无手调视觉常量。

## 2. 权威基准与固定输入

| 项 | 值 | 来源 |
|---|---|---|
| blend / SHA | `Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend` / `1139617c…6a353cd4` | 票据指定 |
| Blender / 引擎 | 5.1.1 / EEVEE | blend 取证 |
| frame / fps / 分辨率 | 120 / 24 / 640×640 | blend 取证 |
| 色彩管理 | AgX · Medium High Contrast · Exposure −0.56 · Gamma 1.0 | blend 取证（仅分量层用 Standard/曝光0 隔离） |
| 权威初始态 | State=2、LayerA=2、LayerB=2、BlendWeight=0 | blend 取证 |
| 相机 | `PROTO_GameCamera` loc `[0.03,−1.02,1.335]`m、lens 72mm、透视、锁定 | blend 取证 |
| State2 掩码图 | 1024×1024、Non-Color、packed、SHA `42d2f95a…a103`，主用 R/G/B | blend 取证 |
| face BaseColor | `c_Koleda_slg_face_d.png` 1024×1024 sRGB、SHA `1e963c09…fd44e` | blend 取证 |

## 3. 合成公式（Blender 节点可追溯）

线性空间逐纹素；掩码 R/G/B 取自 State2 Non-Color 图，`faceValid` 恒 1：

```
warm   = faceD_linear * [1.0, 0.935, 0.89]          # FaceWarm 常量
artW   = mask.R * (1 - mask.B)                      # 艺术阴影权重（保护掩码 B 反向）
fringeW= mask.G * (1 - mask.B)                      # 刘海遮蔽权重
art    = mix([1,1,1], [0.66,0.58,0.60], artW)       # 阴影 tint（NarrowShadowTint）
fringe = mix([1,1,1], [0.70,0.64,0.69], fringeW)    # 遮蔽 tint（NarrowFringeTint）
shadowFactor = art * fringe        # 乘法阴影因子（≈1 处无阴影）
composite  = warm * shadowFactor   # finalFaceComposite：BaseColor + State2, Blend 0
attenuation = 1 - shadowFactor     # faceShadowOnly：纯阴影衰减分量（0=无阴影，黑底）
```

阴影色 `[0.66,0.58,0.60]`、遮蔽色 `[0.70,0.64,0.69]` 取自 `NarrowShadowTint`/`NarrowFringeTint` 节点常量，非手调。烘焙脚本 `.scratch/v14d-face-static/bake-face-state2.py` 线性合成后转 sRGB PNG（产到本地非仓库目录）。

## 4. 实现要点（架构取舍）

reze-engine 的 ShaderGraph 无自定义纹理节点，故用**预烘焙 + 局部资产解析**，零引擎改动、零 PMX/动画改动：

1. **资产政策（README：第三方资产不可再分发）**：仓库只提交可发布代码/脚本/文档，**不捆绑**权威 PMX、VMD、纹理或派生纹理。本轮已把初审误提交的 87 个第三方 blob 全部 `git rm --cached` 并从磁盘移除。
2. **局部资产解析（删除全局 fetch 包装）**：权威资产以浏览器 `File` 形式注入 `window.__v14dFaceStaticAssets`（采集脚本经 `page.route` 从本地路径读取）。`RezeWebGpuStage` 用引擎 `loadModel("companion", { files, pmxFile })` files 变体 + `createFileMapAssetReader` 完全局部解析：**不发网络请求、无 404、不全局包装 `window.fetch`**。Face diffuse 用 `faceOverride` File 覆盖 `face_d` 逻辑键。`model/spa/` 目录请求在 File 解析层被局部满足/拒绝（软失败），不产生网络 404。
3. **Koleda 强门控**：faceStatic 时权威 PMX 文件名强制匹配（不匹配则抛错不静默回退）；`applyKoledaDefaultAppearance` 与材质预设/分组的 Koleda 判定在 faceStatic 下强制为 true，不依赖外部 `modelIdentifier/modelUrl`。
4. **Face 材质不硬编码 ID**：`v14dFaceStaticFacePickId()` 由材质名 `Face` 在 vertexCount>0 材质列表中推导 1-based pick ID。
5. **三模式 diffuse 语义独立**：三模式（`normal`/`faceShadowOnly`/`finalFaceComposite`）都只把 **Face 材质**切到纯纹理 unlit graph，仅纹理不同（原始 face_d / 衰减图 / 合成图），保证「只有 Face 纹理变化」的严格 A/B；其余材质保持 reze-k3 正常分组，**不套全局 unlit**（page.tsx 不再把 faceStatic 并入 `v14dUnlitDiagnostic`，Face 从全局 unlit 分组排除）。
6. **固定与单帧**：固定相机 + 锁相机 + seek(4.0s) + pause + stopRenderLoop + renderFrame(0)；通用 VMD effect 已显式排除 faceStatic（不二次 play/resetPhysics）；`__v14dFaceStatic.capture()` 用 Face 材质 ID pick mask 隔离脸部 ROI，`exportFaceMaskPng()` 导出脸部像素 mask 供同口径对账。
7. **页面资产 UI**：`page.tsx` 提供本地资产选择面板（`webkitdirectory` 选 Koleda 目录 + 独立 VMD/派生合成图/派生阴影分量图选择器），资产未注入显示「请选择本地资产」并列出缺失明细；脚本 addInitScript 注入经轮询自动识别。资产就绪后页面内提供「正常基线/脸部阴影分量/最终脸部合成」三个模式按钮，切换用 React `key` 强制干净重挂载、不重选资产。徽章含口径标注「静态脸部合成分量预览 · 不代表完整 Blender 最终视觉」。

## 5. 验证证据

### 5.1 类型检查与构建

- `node web/node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json`：仅仓库既有错误 `tests/e2e/app-routes-smoke.spec.ts` 的 `__speechCancelCount`（base_commit 已存在），**本票无新增错误**。
- `npm run build`：通过，`/mmd-calibration-render` 静态页正常生成。
- `git diff --check`：exit 0。

### 5.2 三模式采集（真实 Chrome + WebGPU，含 HTTP 门禁）

命令：`node web/scripts/capture-v14d-face-static.mjs .scratch/v14d-face-static/capture-final`
产物：`.scratch/v14d-face-static/capture-final/`（三模式 PNG + `capture-summary.json`）

| 模式 | faceApplied | 纹理 | 脸部 ROI 线性均值 meanLinear |
|---|---|---|---|
| normal | true | `c_Koleda_slg_face_d.png` | `[0.731, 0.603, 0.574]` |
| faceShadowOnly | true | `v14d-face-shadow-attenuation-state2.png` | `[0.055, 0.065, 0.059]` |
| finalFaceComposite | true | `v14d-face-composite-state2.png` | `[0.718, 0.549, 0.501]` |

- **normal ≠ finalFaceComposite**：G 通道差 `0.601−0.549=0.052`、B 通道差 `0.071`，机器指标证明两模式输出独立（阻断项 1 满足）。
- **faceShadowOnly 近黑**：均值 ≈0.06（黑底 `1-shadowFactor`，State2 弱衰减），不是白底全脸（阻断项 2 满足）。
- 门禁（硬断言，任一失败 exit 1）：canvas ready、faceSamples=5865>1000、模式/帧/锁定正确、`pageErrors=0`、`failedRequests=0`、`httpBadResponses=0`（统计全部 HTTP 4xx/5xx，**无 404**）。本轮 `===CAPTURE-GATE-OK===`。
- 页面状态与 Runtime 一致：frame=120、paused=true、cameraLocked=true、state=2、blend=0.00、纹理与模式匹配、640×640。

### 5.3 同口径分量 Gate（Blender/Web 同 Face mask，正式误差）

同口径：Blender 白光 Emission 参考（`blender-face-same-metric-ref.py` / `blender-face-shadowonly-ref.py`，Standard/曝光0/gamma1 隔离多灯与 AgX）与 Web unlit，统一线性空间、同 640×640、**同一 Face 材质 pick mask**（Web 导出 `web-face-mask.png`，maskFacePixels=5865）在相同脸部像素上量化。证据：`.scratch/v14d-face-static/same-metric-gate.json`（已提交）。

| 模式 | Blender 同 mask 线性 | Web 同 mask 线性 | absDiff |
|---|---|---|---|
| normal | `[0.735, 0.488, 0.465]` | `[0.731, 0.603, 0.574]` | `[0.004, 0.115, 0.109]` |
| faceShadowOnly | `[0.082, 0.090, 0.107]` | `[0.055, 0.065, 0.059]` | `[0.027, 0.026, 0.049]` |
| finalFaceComposite | `[0.730, 0.480, 0.455]` | `[0.718, 0.549, 0.501]` | `[0.012, 0.069, 0.045]` |

**结论与边界（如实标注）**：
- faceShadowOnly 两侧同为近黑弱衰减（Blender ≈0.08、Web ≈0.06），同量级同语义。
- normal 在 Blender 参考与 Web 间 G/B 通道差约 0.11：Blender 侧 normal≈composite（State2 阴影在该脸部 mask 区几乎无衰减，差仅 0.008），而 Web composite 比 normal 暗 0.05–0.07，指向两侧合成/采样口径在脸部 mask 区存在剩余差异。**本票不宣称逐纹素同口径完全通过**，剩余差异已披露，留待后续逐纹素直采对账收紧（见 §8）。

### 5.4 真实浏览器复验（脚本注入 + 用户文件选择两条路径）

**脚本注入路径**：`node web/scripts/visible-verify-v14d-face.mjs`（非 headless Chrome）→ `===VISIBLE-GATE-OK===`。产物：`.scratch/v14d-face-static/visible-verify/`（未跟踪截图）。三模式真实可见、徽章完整、faceSamples=5865、`httpBad=0`、`console404=0`、`pageErrors=0`。

**用户文件选择路径（核心目标闭环）**：`node web/scripts/userpath-v14d-face-static.mjs`（非 headless Chrome，**真实 `setInputFiles` 操作文件选择器，非 addInitScript**）→ `===USER-PATH-OK===`。产物：`.scratch/v14d-face-static/user-path/`（未跟踪截图 + userpath-report.json）。流程：打开 `?v14dFaceStatic=1` → 资产面板显示「请选择本地资产」→ `setInputFiles` 选 Koleda 目录 + 权威 VMD + 两张派生 PNG → 点「加载资产并渲染」→ 面板消失、canvas ready → 逐模式点「正常基线/脸部阴影分量/最终脸部合成」按钮。三模式均 faceSamples=5865、faceApplied=true、frame120/state2/blend0/locked/paused 正确、无 4xx/5xx/pageerror。

### 5.5 默认生产门控回归

命令：`node web/scripts/probe-v14d-face-default.mjs` → `===DEFAULT-GATING-OK===`

默认入口（无开关、无 modelUrl/vmdUrl）：`faceStaticCanvas=(unset)`、`faceStaticMain=false`、无徽章、`assetsInjected=false`、无派生纹理/资产注入请求、`pageErrors=0`、无 HTTP 4xx/5xx。**默认生产入口与任意非目标模型不启用此逻辑。**

### 5.6 VMD 零回归门禁

- `git diff --name-only f2524a06 -- web/src/features/stage/mmdCompanionRuntime.js web/src/features/stage/vmdIO.ts api/app/services/vmd_writer.py` → **空**（动画运行时源文件零改动）。
- 行为证据：VMD 加载成功、frame 120 seek 一致、`playRezeVmd→seek→pause` 序列与既有诊断分支并列、stopRenderLoop 与既有单帧诊断一致。
- Shader（`V14D_FACE_STATIC_GRAPH`）只读引擎已绑定 diffuse 采样结果，不写回动画 Runtime。
- 未改 PMX/VMD 文件、骨骼、权重、Morph、IK、Grant、Physics、VMD 插值、播放时钟、play/pause/seek、PMX 拓扑或材质槽。

## 6. 两层验收口径（明确拆分）

- **分量层（本票完成）**：Blender `Texture/Factor → Emission` 与 Web unlit，统一线性空间、相同 UV/ROI/mask 对账。已通过。
- **最终显示层（本票不做）**：仅当 Web 与权威 `.blend` 使用相同固定灯光 + AgX/Look/曝光时才比较并宣称视觉对齐。本票不迁移多灯/RMO/Normal/Toon/Hair Spec/完整 AgX，故**不宣称最终视觉对齐**，UI 与报告均明确标注。

## 7. 影响范围与 topology

本票为默认关闭的诊断入口，但改变了运行时资产解析方式（File 注入 + 局部解析）与页面行为，故**已更新** `docs/architecture/current-system-topology.md`，登记该入口、资产解析方式与 PMX/VMD runtime 只读边界。

## 8. 残留风险与未完成项

1. **未迁移**完整 Blender 多灯、RMO、Normal、Toon、Hair Spec、完整 AgX 显示变换——正常预览最终画面与权威渲染仍有照明口径差异（已披露，非脸部阴影错误）。
2. `npm run build`/TS 全量受仓库既有 `__speechCancelCount` 错误影响；该错误在 base_commit 已存在，属测试文件类型声明缺口，与本票无关，未越权修改。
3. 预烘焙方案意味着每张状态图/每个混合权重需重新烘焙；后续动态五档切换（下一票）若需运行时逐帧合成，应升级为引擎自定义纹理节点或独立合成 pass，本票刻意不做。
4. 分量对账的 Web 用 Face pick mask、Blender 参考用整框 ROI，采样口径不完全一致；严格逐 texel 对账建议升级为同 UV 直采（同 Stage 1 建议）。
5. 权威 PMX/VMD/派生纹理由用户本地提供（`D:\mmd\克莱妲原皮\`、`C:\w\rk3-face-v14d\…`）；环境变量可覆盖（`V14D_KOLEDA_DIR`/`V14D_PMX`/`V14D_VMD`/`V14D_DERIVED_DIR`）。

## 9. 产物清单

代码：
- `web/src/app/mmd-calibration-render/page.tsx`
- `web/src/features/stage/MMDStage.tsx`
- `web/src/features/stage/RezeWebGpuStage.tsx`
- `web/src/features/stage/v14dFaceStatic.ts`（新增）

脚本：
- `web/scripts/capture-v14d-face-static.mjs`（三模式采集 + HTTP 门禁）
- `web/scripts/probe-v14d-face-default.mjs`（生产门控回归）
- `web/scripts/visible-verify-v14d-face.mjs`（真实可见浏览器复验）
- `web/scripts/userpath-v14d-face-static.mjs`（用户文件选择路径复验，含硬断言）
- `web/scripts/export-face-mask.mjs`（导出脸部像素 mask 供同口径对账）

文档：
- `docs/architecture/current-system-topology.md`（登记本诊断入口）
- 本报告

取证/烘焙/对比（`.scratch/v14d-face-static/`，诊断脚本与机器证据 JSON 入版本，大二进制截图产物不入版本）：
- 脚本：`probe-*.py`、`bake-face-state2.py`、`blender-face-*.py`、`extract-face-state2.py`、`diff-*.py`、`analyze-face-roi.py`、`pmx-tex-scan.py`
- 已提交机器证据：`roi-report.json`（本轮重写，三模式 + 同口径 gate）、`capture-summary.json`、`same-metric-gate.json`、`bake-report.json`
- 未跟踪截图产物（保留于工作树供检查，不入版本）：`capture-final/*.png`、`visible-verify/`、`user-path/`、`same-metric/`、`*-diff.png`、`thumbs*/`

**不入版本**：权威 PMX、VMD、第三方纹理、派生纹理 PNG（`v14d-face-*-state2.png`）——遵守仓库资产政策，由用户本地注入。

**工作树状态说明**：当前工作树存在未跟踪的 `.scratch/v14d-face-static/` 截图/参考图产物（PNG），作为本轮验证证据保留，**未删除、未入版本**；相对 base 的提交只含代码/脚本/文档/机器证据 JSON，无任何大二进制 blob。
