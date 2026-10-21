# [Stage 2A-M1.1-R] V14D Face State 2 同 UV 逐纹素对齐 — 恢复验收报告（修正轮）

> 恢复票：`[Stage 2A-M1.1-R] V14D Face State 2 同 UV 逐纹素对齐恢复验收`
> 分支：`codex/v14d-face-uv-texel-align-recovery`　冻结基线：`b963575c08b58dda284db125840b92c98261c38f`
> 日期：2026-08-27　状态：**已完成（显示变换污染的诊断链修正完成；正式逐纹素 Gate 与 same-mask 同屏 Gate 均未通过；完整 Blender V14D 未完成）**

## 0. 修正轮说明（主会话验收未通过后的同失败族修正）

第一版恢复报告把 UV-direct Gate 的巨大误差归因于「Web/Blender 相机与姿态几何差异」。该结论
**错误，已撤回**：`uv-direct-gate.py` 的计算路径并不使用 Blender 相机或 Blender 屏幕投影——它读取
Web `web-face-uv.png`，用这些 Web UV 直接双线性采样原始 `face_d`/State2 mask，再与 Web 三模式
capture 比较。相机差异只能解释 Blender/Web 同屏 ROI（same-mask Gate）失败，**不能**解释同 Web UV 的
UV-direct 失败。

本修正轮定位并修复了真正的显示变换污染，并撤回原根因。

## 1. 真正的根因链（已逐项验证）

UV-direct Gate 的超限误差来自三处**显示/采样口径污染**，均在纹理采样域（本票边界内），非相机几何：

### 1.1 Web UV 来自最终 canvas 的显示色（主因，已修复）

`V14D_FACE_UV_DEBUG_GRAPH` 让 Face 材质 fragment 输出 `vec3f(input.uv, 0.0)`，但旧
`exportV14dFaceUvPng()` 调用 `readV14dCanvasDisplay(canvas)` 把**最终 canvas** 的 R/G 当 U/V。
reze composite（`reze-engine/src/shaders/passes/composite.ts:125-139`）对 HDR 统一做
bloom → exposure(exp2) → Filmic tonemap → color grading → gamma。故旧 `web-face-uv.png`
是**显示变换后的颜色**，不是原始插值 UV。

**修复**：uvDebug 模式下 Face 的 `vec3f(input.uv, 0.0)` 在场景 HDR pass 写入 pre-tonemap 的
`hdrResolveTexture`——其**源格式**随硬件为 `rg11b10ufloat` 或 `rgba16float`（`Engine.hdrFormat`），
诊断链先 blit 到 `rgba16float` **读回目标**再 COPY_SRC/readback。`exportV14dFaceUvPng` 改为经
`readV14dColorBaselineResolveTargets`（blit → COPY_SRC → GPU readback）读 HDR 的 R/G 通道，
得到无 tonemap/grade/gamma 污染的浮点 UV，并额外导出 `web-face-uv.float.json`（逐像素 float UV +
Face mask），PNG 仅供人眼检查。

**证据**：修正后脸部 UV 范围从被污染的旧值 `[0.455,0.847]×[0.553,0.796]` 变为真实插值
`[0.156,0.75]×[0.236,0.578]`，Face 像素数保持 5865（与 normal/composite 同一 Face pick mask）。

### 1.2 Web 三模式 capture 是 tonemap 后的显示值（次因，已修复）

旧 gate 拿 `page.screenshot`（tonemap 后的最终 canvas sRGB → 线性）对比未 tonemap 的 baker 链
参考，口径不一致。R 通道（高亮皮肤红 ~0.956 sRGB）被 Filmic tonemap 压缩最多（→0.871），
G/B 低值受影响小，造成 R-only 系统性偏差。

**修复**：capture 新增 `exportFaceHdrFloat`（同一 `readV14dColorBaselineResolveTargets` pre-tonemap
HDR readback），导出三模式 `face-static-<mode>.hdr.json`；gate 改用 pre-tonemap HDR 线性值与
baker 参考对账（同为未 tonemap 线性口径）。

**证据**：sRGB 字节域对比（无线性化）face_d 采样 `[0.956,0.802,0.776]` vs web canvas
`[0.871,0.798,0.780]`，R 系统偏低 0.085、G/B 几乎一致，证实 tonemap 压缩 R。改用 HDR 后
normal mean 从 `[0.172,0.024,0.020]` 降至 `[0.021,0.016,0.016]`。

### 1.3 脸部轮廓边缘误差与内部剩余残差（光栅域；根因部分为候选假设）

`hdrResolveTexture` 由 `sampleCount=4` 的 MSAA resolve 而来（`Engine.MULTISAMPLE_COUNT=4`，
生产固定配置，本票不改）。按脸部 mask 拆分边缘（4 邻域含非脸部，1174px）/内部（4691px）：
**边缘** mean err=0.088、p95=0.300——边缘像素子采样混入相邻背景/其他材质，为 MSAA 抗锯齿混合
（光栅域边界效应）。**内部** mean err=0.010、p95=0.021、p99=0.037。

**内部剩余残差（normal/composite ~0.005–0.008）的根因尚未证明，列为候选假设**：
已用单变量实验排除两个候选——(a) MSAA 4 子采样平均模拟反而使残差略增（0.0052→0.0059），
不能解释；(b) 亚纹素 UV 偏移扫描（±1 纹素，步 0.25）无收敛性偏移（最佳 0.006 vs 无偏移 0.0066）。
当前候选假设：引擎 face_d 用 `rgba8unorm-srgb` 格式，GPU 硬件在采样时查表/分段近似做
sRGB→linear，与 gate 的 PIL 精确公式 `((c+0.055)/1.055)^2.4` 存在末位精度差。**未验证**，
需独立实验确认，本票预算内不再扩大调查。

## 2. 检查点（checkpoint）审查（无未授权改动）

审查范围命令：`git diff 6c002e72..b963575c`（完整范围，26 文件，1805 insertions / 8 deletions）。

- **无二进制/资产改动**：`git diff 6c002e72..b963575c --name-only -- "*.pmx" "*.vmd" "*.png" "*.blend"`
  为空。
- 4 个源码文件改动均为诊断性：新增 `uvDebug` 模式与导出钩子；`V14D_FACE_STATIC_MODES` 数组
  仍只含三模式，`uvDebug` 不在数组、默认不暴露。
- 未发现未授权动画/PMX/生产默认行为改动。

## 3. 复跑结果（修正后口径）

### UV-direct Gate（正式口径：全 Face 每通道 mean≤0.005 / p95≤0.01）

**正式 Gate（全 Face，5865px）——未通过（`pass.all=false`，进程 exit 1）：**

| 模式 | meanAbsLinearDiff | p95AbsLinearDiff |
|---|---|---|
| normal | [0.0208, 0.0155, 0.0155] | [0.1645, 0.0959, 0.0619] |
| faceShadowOnly | [0.0079, 0.0075, 0.0091] | [0.0404, 0.0415, 0.0477] |
| finalFaceComposite | [0.0189, 0.0126, 0.0116] | [0.1461, 0.0800, 0.0346] |

**辅助诊断（内部/边缘拆分，仅定位误差空间分布，不重定义通过口径）：**

| 域 | 模式 | meanAbsLinearDiff | p95AbsLinearDiff |
|---|---|---|---|
| 内部（4691px） | normal | [0.0052, 0.0061, 0.0085] | [0.0135, 0.0164, 0.0208] |
| | faceShadowOnly | [0.0021, 0.0023, 0.0022] | [0.0069, 0.0081, 0.0076] |
| | finalFaceComposite | [0.0052, 0.0056, 0.0070] | [0.0119, 0.0137, 0.0157] |
| 边缘（1174px） | normal | ≈0.088（max 通道均值） | ≈0.300 |

- 正式全 Face Gate 三模式均未达标。
- 辅助诊断显示 faceShadowOnly 内部像素各通道最低（mean≤0.0023、p95≤0.0081），normal/composite
  内部 mean≈0.005–0.0085、p95≈0.012–0.021；这些辅助指标**不替代正式 Gate 判定**。
- 内部剩余残差根因为候选假设（见 §1.3），未证明。

### same-mask Gate（Blender/Web 同屏 ROI，目标 ≤0.03）

normal G/B absDiff≈0.119/0.121，composite≈0.076/0.067，**未通过**。此 Gate 比较 Blender 参考渲染与
Web 捕获的**同屏**像素，其差异由 Web 固定相机 vs Blender `PROTO_GameCamera` 的几何/姿态口径
解释（脸部屏幕覆盖宽 5.2×/高 8.6×/质心偏移 298px，Blender 脸部溢出屏幕）——这是**独立的
Blender/Web 同屏视觉 Gate 问题**，与 UV-direct（同 Web UV 纹理域）是不同域。

### 单变量复核（修正后口径）

- **V 轴原点**：V noflip [0.172,0.024,0.020] / V flip [0.172,0.086,0.083] / U flip [0.172,0.025,0.020]
  → 当前 V 原点约定正确，翻转会显著变差。
- **wrap**：face_d 为 REPEAT，gate 双线性用 mod 匹配；脸部 UV 岛在 [0,1] 内，wrap 不触发。
- **mipmap/filter**：mip 级 0–4 重采样 R 通道稳定 ~0.17（旧口径）/~0.021（HDR 口径），mip 级影响
  可忽略；引擎材质 sampler 为 linear/linear/linear（trilinear）。
- **量化**：浮点 UV 替代 8-bit PNG 后消除 UV 量化误差；诊断链的**读回目标**格式为 rgba16float
  （源 `hdrResolveTexture` 随硬件为 rg11b10ufloat/rgba16float，统一 blit 到该读回目标）。
- **颜色管理/预乘**：Chrome `createImageBitmap` 三种 colorSpaceConversion 与 PIL 解码在脸部 UV 区
  均值差异 < 0.5/255（容差内近似一致，非字节级完全一致）；premultiplyAlpha 三模式一致、alpha=255。

## 4. 工程验收（本修正轮实跑）

- **TypeScript**：`tsc --noEmit -p web/tsconfig.json` **无新增 TypeScript 错误**；仅剩仓库既有
  `__speechCancelCount` 错误（`web/tests/e2e/app-routes-smoke.spec.ts`，base_commit 已存在）。
- **构建**：`npm run build` 通过，`/mmd-calibration-render` 静态页正常生成。
- **三模式 capture**：`capture-v14d-face-static.mjs` → `===CAPTURE-GATE-OK===`（faceSamples=5865、
  pageErrors=0、failedRequests=0、httpBad=0），并生成三模式 `face-static-<mode>.hdr.json`。
- **真实用户路径**：`userpath-v14d-face-static.mjs` → `===USER-PATH-OK===`（三模式 faceApplied=true、
  frame120/state2/blend0/locked/paused 正确）。
- **默认入口隔离**：`probe-v14d-face-default.mjs` → `===DEFAULT-GATING-OK===`（无开关不启用、
  无注入、无派生纹理请求、无 4xx/5xx）。
- **UV 导出**：`export-face-uv.mjs` → 导出 pre-tonemap HDR 浮点 UV + mask json + 预览 PNG。

## 5. 验收边界（如实披露，不宣称通过）

- **显示变换污染的诊断链修正完成：是。** 旧版两处 tonemap/canvas-UV 反推污染已定位并修复为
  pre-tonemap HDR 浮点 readback；gate 进程退出码现反映正式 Gate 状态（未过 exit 1），正式路径
  无静默 fallback，capture 缺正式浮点证据即失败。
- **正式逐纹素 Gate（全 Face UV-direct）通过：否。** 三模式 `pass.all=false`（mean/p95 超
  0.005/0.01），进程 exit 1。
- **same-mask 同屏 Gate 通过：否。** normal G/B≈0.119/0.121、composite≈0.076/0.067，超 0.03 目标；
  由 Web 固定相机 vs Blender `PROTO_GameCamera` 几何/姿态口径解释（独立问题，与 UV-direct 不同域）。
- **完整 Blender V14D 未完成：是。** 未迁移多灯/RMO/Normal/Toon/Hair Spec/完整 AgX，
  且相机/姿态几何未对齐。

### 精度预算与阻塞证据

- **UV-direct**：正式全 Face 未达标。边缘 p95 高（0.06–0.30）为 MSAA 4x resolve 轮廓抗锯齿混合
  （光栅域，生产固定配置），已在 `uv-direct-gate.json` 的 `gateEdge`/`gateInterior` 拆分披露；
  内部剩余残差（normal/composite p95≈0.012–0.021）根因为候选假设（§1.3），未证明。
- **same-mask**：几何/姿态口径阻塞，证据 `camera-compare.json`、`geometry-check.json`、
  `same-mask-gate.json`，需独立票据对齐相机/姿态几何。

## 6. 用户可复验入口

- 预览 URL：`http://127.0.0.1:3000/mmd-calibration-render`（`web` 下 `npm run dev`）。
- 资产选择步骤：选择 `D:\mmd\克莱妲原皮` 的 PMX + `Textures` 与权威 VMD
  `koleda-v14d-authoritative-pose-f120.vmd`；URL 加 `v14dFaceStatic=1&v14dFaceMode=normal|
  faceShadowOnly|finalFaceComposite`（或 `uvDebug` 诊断）即锁定 frame120/state2/blend0/相机锁定/
  动画暂停。
- 截图/证据路径：`.scratch/v14d-face-static/capture-final/face-static-*.png`（三模式 tonemap 后
  显示）与 `face-static-*.hdr.json`（pre-tonemap 浮点）、`uv-align/uv-direct-diff-*.png`（差值热图）、
  `uv-align/web/web-face-uv.float.json`（浮点 UV）、`uv-align/blender/blender-ref-*.png`（Blender 参考）。

## 7. 硬约束遵守

未修改 PMX/VMD 文件、骨骼、权重、Morph、IK、Grant、Physics、VMD 插值、播放时钟、
seek/play/pause 语义、PMX 拓扑或材质槽；未改变默认生产渲染行为（MSAA/tonemap/composite 均未动）；
未用全局 `window.fetch` monkeypatch（web 脚本用 Playwright route + `__v14dFaceStaticAssets` 局部注入）；
`v14dFaceStatic` 与 `uvDebug` 均默认关闭。未清理未跟踪 PNG/npy 证据，未提交第三方资产/PMX/VMD/
派生大图。

## 8. 后续（超出本票边界）

1. **UV-direct 内部剩余残差根因定位**：当前为候选假设（`rgba8unorm-srgb` 硬件解码精度），
   需独立单变量实验证明或排除；在证明前不得写成已确认根因。
2. **same-mask 同屏 Gate**：新票据对齐 Web 固定相机与 Blender `PROTO_GameCamera` 的
   position/target/姿态（含 VMD scale/骨骼映射一致性），再复跑同屏对账。
