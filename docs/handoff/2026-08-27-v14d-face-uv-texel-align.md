# [Stage 2A-M1.1] V14D Face State 2 同 UV 逐纹素对齐 — 交付报告

> 票据：`[Stage 2A-M1.1] V14D Face State 2 同 UV 逐纹素对齐`
> 分支：`codex/v14d-face-uv-texel-align`　基线：`codex/v14d-face-shadow-static` @ `6c002e726d68142848648bae1bb7d66ff72d2ed6`
> 日期：2026-08-27　状态：**已完成（已验证：逐纹素对账建立，根因定位为几何/姿态口径差异，超出本票纹理采样边界）**

## 1. 结论

建立了 Blender/Web 同一 Face UV、同一 texel、同一颜色空间的可重复对账管线，并按 `Base texture → warm tint → art/fringe mask → shadowFactor → final composite` 顺序定位了第一次分歧。**逐纹素对账确认：剩余差异的主导项不是纹理采样、过滤、mipmap 或颜色管理，而是 Web 固定相机与 Blender `PROTO_GameCamera` 的几何/姿态口径差异**——Web 脸部屏幕覆盖 149×100px（5865 像素），Blender 同脸部屏幕覆盖 780×862px（质心偏移 298px），同 UV 比较的是不同世界位置。该根因超出本票「纹理采样口径」边界，需后续票据先对齐相机/姿态几何。

本票未宣称 UV-direct Gate 通过（目标 ≤0.005/0.01 未达成），如实披露为**静态视觉部分通过**（对账管线建立、根因定位、全部辅助验收通过），完整 Blender V14D 最终视觉对齐未完成。

## 2. 逐纹素对账管线（UV-direct）

### 2.1 Blender 侧导出（`.scratch/v14d-face-static/uv-align/blender/`）

`blender-face-uv-export.py`（只读权威 `.blend`，不保存/不修改）导出：

| 产物 | 内容 | SHA-256 |
|---|---|---|
| `face-loops-uv.npy` | Face 材质 frame120 逐 loop 顶点 UV + 屏幕像素坐标（8214 个 loop） | `d8a85fee…fc6379` |
| `face-d-linear.npy` | face_d 1024×1024 场景线性像素快照 | `b362d534…dfed297` |
| `state2-mask-linear.npy` | State2 Non-Color 掩码 1024×1024 线性像素 | `49bb0104…038a52` |
| `blender-ref-normal.png` / `blender-ref-finalFaceComposite.png` | 白光 Emission 参考（Standard/曝光0/gamma1） | `e3635ce7…` / `22da96f9…` |
| `blender-uv-report.json` | 采样口径登记 | — |

采样口径登记（Blender 节点取证）：
- **face_d**：`c_Koleda_slg_face_d.png`，1024×1024，sRGB，`STRAIGHT` alpha，`Linear` 插值，`REPEAT` wrap。打包资产 SHA `1e963c09…` 与本地磁盘文件完全一致（资产漂移排除）。
- **State2 mask**：`PROTO_V14D_FaceShadow_State2`，1024×1024，Non-Color，`Linear` 插值，`EXTEND` wrap，SHA `42d2f95a…` 与磁盘文件一致。

### 2.2 Web 侧导出

新增只读诊断模式 `v14dFaceMode=uvDebug`（默认关闭、不改变三模式语义与生产渲染）：Face 材质切到几何 UV 调试图（`V14D_FACE_UV_DEBUG_GRAPH`，fragment 输出插值 `input.uv` 的 R=u、G=v），`window.__v14dFaceStatic.exportFaceUvPng()` 用与 `exportFaceMaskPng()` 相同的 Face pick mask 导出逐像素 UV PNG（`web/scripts/export-face-uv.mjs` → `.scratch/v14d-face-static/uv-align/web/web-face-uv.png`）。Web 脸部 UV 落在 `[0.455, 0.847] × [0.553, 0.796]`（脸部 UV 岛子区），非脸部像素为 0。

### 2.3 同 UV 逐纹素对账（`uv-direct-gate.py`）

对每个脸部像素，用 Web 侧实际插值 UV 双线性采样权威 face_d/State2 mask（PNG 字节口径，与 Web 引擎实际收到的内容一致），重算 baker 链得到 normal/attenuation/composite 参考值，与 Web 实际捕获值逐像素对比。只统计 Face pick mask 内 5865 像素，不混入背景/边缘/其他材质。

## 3. 首次分歧定位（Base → composite 逐级）

按链顺序量化，**第一次分歧出现在 baseTexture 层**（`uv-direct-gate.json`）：

| 层级 | refMeanLinear | webMeanLinear | meanAbsLinearDiff |
|---|---|---|---|
| baseTexture | [0.601, 0.319, 0.270] | [0.731, 0.603, 0.574] | [0.232, 0.300, 0.316] |
| warmTint | [0.601, 0.298, 0.240] | [0.731, 0.564, 0.510] | [0.232, 0.281, 0.281] |
| shadowFactor | [0.984, 0.980, 0.981] | [0.945, 0.935, 0.941] | [0.051, 0.060, 0.054] |
| composite | [0.588, 0.290, 0.234] | [0.718, 0.549, 0.501] | [0.225, 0.278, 0.279] |

**UV-direct Gate 未通过**：三模式每通道 meanAbsLinearDiff 均远超 0.005、P95 远超 0.01。但后续单变量实验证明该差异不是采样口径问题。

## 4. 根因排除链（逐项单变量实验）

对 baseTexture 层差异，逐项排除了所有采样口径嫌疑：

| 嫌疑 | 实验 | 结果 | 证据 |
|---|---|---|---|
| 资产漂移 | Blender 打包 face_d SHA vs 本地磁盘 | 完全一致（`1e963c09…`） | `blender-uv-report.json` |
| mipmap 三线性过滤 | 逐像素 mip 选择重采样 | 均值不变（[0.895,0.668,0.635]），无法复现 Web 值 | `mip-isolation.json` |
| 8-bit UV 量化 | ±0.5/255 UV 扰动重采样 | 摆动仅 0.002，不足以解释 0.16+ 差异 | `geometry-check.json` |
| UV 系统性偏移 | UV 域 ±4 纹素平移扫描 | 无法收敛（最佳 score 0.34 vs 默认 0.55） | `geometry-check.json` |
| 浏览器颜色管理 | Chrome `createImageBitmap` 三种 colorSpaceConversion 解码 | 三模式一致且 = PIL 字节 `[224,181,173]`，颜色管理排除 | `face-tex-colorspace-audit.json` |
| alpha 预乘 | premultiplyAlpha none/default/premultiply | 三模式一致，alpha=255（Chrome 当不透明） | `face-tex-premultiply-audit.json` |
| **几何/姿态错位** | Web vs Blender 脸部屏幕覆盖 | **宽 5.2×、高 8.6×、质心偏移 298px，Blender 脸部溢出屏幕** | `camera-compare.json` |

**根因结论**：两相机 fov 相同（28.07°，Blender 72mm/36mm 传感器换算一致），但 position/target 不同——Web 用固定 snapshot `[0.375, 16.6875, -12.75]` → `[0.375, 16.6875, -12.125]`，Blender 用 `PROTO_GameCamera loc=[0.03, -1.02, 1.335]`。脸部在两套几何下的屏幕投影严重不同，同 UV 逐纹素比较的是不同世界位置。这超出本票「纹理采样口径」边界，需后续票据先对齐相机/姿态几何（包括 VMD scale/骨骼映射一致性）。

## 5. 工程验收

- **TypeScript**：`node web/node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json` 仅剩仓库既有 `__speechCancelCount` 错误（`tests/e2e/app-routes-smoke.spec.ts`，base_commit 已存在），本票无新增错误。
- **构建**：`npm run build` 通过，`/mmd-calibration-render` 静态页正常生成。
- **三模式 capture**：`node web/scripts/capture-v14d-face-static.mjs` → `===CAPTURE-GATE-OK===`，faceSamples=5865、pageErrors=0、failedRequests=0、httpBad=0，三模式 meanLinear 与上一票完全一致。
- **真实用户路径**：`node web/scripts/userpath-v14d-face-static.mjs` → `===USER-PATH-OK===`，三模式均 faceSamples=5865、faceApplied=true、frame120/state2/blend0/locked/paused 正确。
- **默认入口隔离**：`node web/scripts/probe-v14d-face-default.mjs` → `===DEFAULT-GATING-OK===`，无开关时 faceStatic 不启用、无资产注入、无派生纹理请求、无 4xx/5xx。
- **同 mask Gate**（`same-mask-gate.json`）：复现上一票差异（normal G/B absDiff≈0.119/0.121，finalFaceComposite≈0.076/0.067），差异稳定且已定位为几何口径。
- **uvDebug 工具链**：`node web/scripts/export-face-uv.mjs` → `uv exported`，脸部 UV 范围与非脸部零值断言通过。

## 6. 边界声明

- **逐纹素对账通过**：否（UV-direct Gate 未达成 ≤0.005/0.01，根因是几何口径）。
- **静态视觉部分通过**：是（对账管线建立、根因定位、全部辅助验收通过、无生产回归）。
- **完整 Blender V14D 未完成**：是（未迁移多灯/RMO/Normal/Toon/Hair Spec/完整 AgX，且相机/姿态几何未对齐）。

## 7. 硬约束遵守

未修改 PMX/VMD 文件、骨骼、权重、Morph、IK、Grant、Physics、VMD 插值、播放时钟、seek/play/pause 语义、PMX 拓扑或材质槽；未改变默认生产渲染行为；未使用全局 `window.fetch` monkeypatch；`v14dFaceStatic` 与 `uvDebug` 均默认关闭。保留用户与其他任务改动，未清理来源 worktree 的未跟踪证据。

## 8. 产物清单

代码（允许修改范围内）：
- `web/src/features/stage/v14dFaceStatic.ts`（新增 `uvDebug` 模式与 `exportFaceUvPng` 类型）
- `web/src/features/stage/RezeWebGpuStage.tsx`（UV 调试图 + `exportFaceUvPng` 实现）
- `web/src/app/mmd-calibration-render/page.tsx`（uvDebug 模式标签/接线）
- `web/src/features/stage/MMDStage.tsx`（uvDebug 模式类型）
- `web/scripts/export-face-uv.mjs`（UV 导出脚本，新增）
- `web/scripts/face-tex-audit.mjs` / `face-tex-colorspace-audit.mjs` / `face-tex-premultiply-audit.mjs`（纹理/颜色管理审计，新增）
- `docs/architecture/current-system-topology.md`（登记 uvDebug 诊断能力与几何口径结论）

诊断脚本与机器证据（`.scratch/v14d-face-static/uv-align/`，JSON 入版本，大二进制截图不入版本）：
- `blender-face-uv-export.py`、`uv-direct-gate.py`、`mip-isolation.py`、`geometry-check.py`、`colorspace-isolation.py`、`camera-compare.py`、`same-mask-gate.py`
- 机器证据 JSON：`blender-uv-report.json`、`uv-direct-gate.json`、`mip-isolation.json`、`geometry-check.json`、`colorspace-isolation.json`、`camera-compare.json`、`same-mask-gate.json`、`face-tex-audit.json`、`face-tex-colorspace-audit.json`
- 截图产物（未跟踪，不入版本）：`uv-direct-diff-*.png`、`web-uv-sampled-*.png`、`web-face-uv.png`、`blender-ref-*.png`、捕获/用户路径截图

**不入版本**：权威 PMX、VMD、第三方纹理、派生纹理 PNG（遵守仓库资产政策）。

## 9. 后续建议（超出本票边界）

闭合 Blender/Web 脸部颜色口径需先对齐相机/姿态几何：统一 Web 固定相机与 Blender `PROTO_GameCamera` 的 position/target/姿态（含 VMD scale 与骨骼映射一致性验证），再复跑本票 UV-direct 对账。该项属于新的独立票据。
