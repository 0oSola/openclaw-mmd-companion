# Stage 2B-M1｜Face State 2 实时合成（固定帧）交付报告

- 日期：2026-08-31
- 票据分支：`codex/v14d-face-state2-runtime`　基线 base_commit=`589747f4d8270346dab08751fdd7bf7de3590894`
- 工作目录：`E:\codexWorktree\710d\MMD project`
- **最终状态：阻塞（Gate MAE 未达标，阈值未放宽）**。实时合成链已完整接线并通过配准与双纹理绑定 Gate，但完整 Face Gate 每通道 MAE 远超 ≤20/255，按票据规则不放宽阈值、交付阻塞证据。

---

## 修正轮（2026-09-01）：断点 A/B 修复 + WGSL 函数嵌套根因

### 已证实的三个断点（全部修复并回归）

1. **断点 A（fsBody 覆写从未写入）**：旧 override 用分号在注释后的切片标记，而真实编译器行格式是分号在注释前，endIdx<0 原样返回。新增 v14dState2OverrideFsBodyFixed（健壮行匹配，到行尾整行替换并保留 node 标签）。
2. **断点 B（applyStyleGroups 重绑丢失 binding(5)）**：assignDrawCallGroups 重建 bind group 时未携带 aux mask view。修复：__auxMaskView 并入 baseBindGroupEntries（binding 5），createMaterialBindGroup 仅在 baseEntries 无 binding5 时补 fallback，assignDrawCallGroups 重绑展开 baseBindGroupEntries 自动携带 mask。
3. **断点 C（WGSL 函数嵌套，Face graph 应用失败静默回退）**：assembleModule 把 V14D_STATE2_HELPERS_WGSL 插在 prelude（fragment fn fs 开头）之后，helper 函数被声明在 fs 函数体内（WGSL 不允许嵌套）→ 编译报 expected '}' for function body → faceResult.ok=false → 引擎回退原管线，live 公式从不渲染（v14dFaceStaticFaceApplied=false）。修复：helper 移到 prelude 之前注入。

### 修正轮证据链

- 红灯回归测试 web/scripts/gate-v14d-state2-override-regression.mjs：修复前 FAIL（断点 A/B 全红），修复后 OVERRIDEREGRESSION-OK 16 项全过（含断点 A2c fence 闭合、断点 A0b src 生效路径断言）。
- patch --verify：41 升至 56 项不变量恰好一次（新增断点 A/B 修正、换行语义、helper 注入位置、fence 闭合检查），exit 0。
- 运行时证据（PORT=3408，全新 NEXT_DIST_DIR）：v14dFaceStaticFaceApplied=true（修复前 false），console 无 WGSL 错误，三模式 faceApplied=true。

### 修正轮 Gate 数值（gate-final）

- 三模式 pre-tonemap HDR 均值（互异 通过）：normal=[0.885,0.598,0.556]、faceShadowOnly=[0.929,0.918,0.922]、finalFaceComposite=[0.842,0.528,0.470]（normal 不等于 shadow 不等于 composite，证明实时 override 生效且 shadow/composite 走不同公式）。
- **完整 Face Gate MAE 仍未达标（阈值 ≤20/255，未放宽）**：faceShadowOnly [88.20,90.23,71.00]、finalFaceComposite [75.58,34.53,31.98]。覆盖率=1.0、配准 ok、pageErrors=0、liveBound=true。
- 实时管线「结构生效」已证实（faceApplied=true、HDR 互异、用户路径三模式 faceApplied=true、USER-PATH-OK），但「与 Blender 参考逐像素对账」仍有系统偏差。

### 剩余根因候选（未验证，下一张票据）

- **UV/纹理空间配准**：face_d 与 mask 的 UV 在 Web 端采样坐标可能与 Blender 参考的像素坐标存在翻转/偏移。需 UV-direct 逐纹素对账（exportFaceUvPng）定位。
- **mask 采样坐标**：v14d_state2_sample_mask 用 diffuseSampler，若 mask UV 与 face_d UV 不同源需单独 sampler/变换。
- **通道口径**：参考帧为 EEVEE Emission 直出（Standard/exposure0/gamma1），与 Web pre-tonemap HDR 同口径线性；比值偏差（R 0.739 / G 0.878 / B 1.059）提示非均匀通道项，疑似 UV 错位或 mask 通道在 Blender 侧的取值口径（如 NarrowArtWeightFaceValid 的 faceValid 调制）与本票恒等假设不一致。

### 修正轮验收项（全部实跑）

- patch --verify → exit 0（56 项）。
- override 红灯回归 → OVERRIDEREGRESSION-OK（exit 0）。
- 默认入口 Gate → DEFAULT-GATING-OK（faceStaticCanvas=(unset)、assetsInjected=false）。
- 配准负测 camera-override=shift + negative → STATE2-LIVE-GATE-NEGATIVE-OK（10 项被拒，Gate 有判别力）。
- VMD runtime probe → VMD-RUNTIME-PROBE-OK（load/play/pause/seek，play 帧前进、pause 稳定、seek 到位 2.000s）。
- 真实用户路径 → USER-PATH-OK（三模式 faceApplied=true、faceSamples=4639、badge state=2/blend=0/locked/paused 正确）。

---

## 1. 唯一交付行为
把当前 finalFaceComposite 的“整张预烘焙脸图替换”升级为 Web 实时 State 2 合成：每个像素从原始 Face BaseColor + Blender State2 packed mask + 节点常量，在 Web 线性空间执行 warm/art/fringe 合成。State 固定 2、Blend 固定 0；未实现五档动态/Narrow Blend/Hysteresis（范围外）。

## 2. Blender 取证（权威来源，全部来自 .blend）
- 取证脚本：`web/scripts/forensic-v14d-face-state2.py` → `.scratch/v14d-face-state2-runtime/forensic-manifest.json`
- 权威 blend sha256 `1139617c…53cd4`（Blender 5.1.1 / AgX / fps 24）；Face 材质 `PROTO_V14D_GF2_Face`。
- BaseColor `c_Koleda_slg_face_d.png`：sRGB 1024×1024，源 sha256 `1e963c09…fd44e`。
- State2 mask `PROTO_V14D_FaceShadow_State2`（节点 `PROTO_V14D_MaskState2`）：Non-Color 1024×1024 packed，sha256 `42d2f95a…a103`。
- 通道含义：R=art 阴影权重，G=fringe 权重，B=narrow face-valid/protect（(1-B) 门控），alpha=faceValid（State2/Blend0 恒为 1）。
- 常量：warmColor=[1,0.935,0.890]、artShadowTint=[0.660,0.580,0.600]、fringeTint=[0.700,0.640,0.690]。
- 线性合成公式（线性空间；face_d 需 sRGB→linear，mask Non-Color 不解码）：
  - warm = faceD_linear * warmColor
  - art = mix(white, artShadowTint, R*(1-B))
  - fringe = mix(white, fringeTint, G*(1-B))
  - shadowFactor = art * fringe；composite = warm * shadowFactor
  - State2/Blend0 时 faceValid=1、FinalMixAlphaFaceValid 恒等，occlusion 链退化为 shadowFactor。
- Blender 参考图：`blender-ref-state2-final-composite.png` / `blender-ref-state2-shadow-factor.png`（`web/scripts/blender-ref-v14d-face-state2.py`，直接 warm×shadowTint×fringeTint 重建，与 NarrowFinalFaceColor 链数学等价）。

## 3. Web Shader / 引擎补丁
- 补丁：`web/scripts/patch-reze-engine.mjs`（默认关闭、严格 verify，`--verify` 41 项不变量恰好一次，exit 0）。注入：materialAuxTextures、bind group binding(5) mask（rgba8unorm、禁 mipmap、非 sRGB 视图）、`V14D_STATE2_HELPERS_WGSL`、`v14dState2OverrideFsBodyFixed`（按 graph.name 精确覆写 final_color）。
- Web 接线：`RezeWebGpuStage.tsx`（`V14D_FACE_LIVE_SHADOW_GRAPH` / `V14D_FACE_LIVE_COMPOSITE_GRAPH`、live dataset）、page.tsx、MMDStage.tsx、capture/gate 脚本。
- 只对 PMX 材质名 Face 生效；EyeWhite/Eyes/Eyes+/Hair/Body/Clothes 保持正常 reze-k3。不在 loadModel 后伪改 path；GPU 双纹理绑定在材质建立前闭合并有绑定证据。

## 4. 诊断视图与默认行为
- 三诊断视图：BaseColor（normal）/ State2 ShadowFactor（faceShadowOnly）/ State2 FinalComposite（finalFaceComposite），`.scratch/v14d-face-state2-runtime/probe/face-static-*.png` + `capture-summary.json`。
- 当前 UI 的“最终脸部合成”指向实时公式，不再指向预烘焙整图；bakedGolden 黄金帧烘焙标记为失败实验/内部诊断、默认不选中。
- 默认生产入口 Gate 通过（probe-v14d-face-default.mjs：faceStaticCanvas=(unset)、assetsInjected=false、probePresent=false、pageErrors=[]，===DEFAULT-GATING-OK===），诊断开关默认关闭、无新纹理/旁路泄漏。

## 5. Gate 数值（实跑，.scratch/v14d-face-state2-runtime/gate/gate-report.json）
- 配准：registration=ok，cameraFov=28.0725（与 V14D_FACE_STATIC_CAMERA 精确匹配），cameraPos=[0.564,18.55,-13]、cameraTarget=[0.564,16.4125,-1.26] 非空。
- 双纹理绑定 Gate：liveBound=true、liveMaskPath=Textures/v14d-state2-mask/state2.png、liveFaceDiffuse=Textures\\c_Koleda_slg_face_d.png。
- full Face 覆盖率=1.0（faceSamples=4639），pageErrors=0。
- **完整 Face Gate MAE（阈值 ≤20/255，未达）**：

| 模式 | full MAE [R,G,B]/255 | interior MAE | edge MAE | full P95 | 覆盖率 |
| --- | --- | --- | --- | --- | --- |
| faceShadowOnly | [58.41, 54.83, 62.96] | [59.80,55.75,62.05] | [54.83,52.45,65.30] | [107.09,127.46,136.67] | 1.0 |
| finalFaceComposite | [50.96, 26.51, 29.41] | [51.81,25.49,26.09] | [48.76,29.14,37.91] | [106.89,63.66,82.98] | 1.0 |

- 眼/口邻域 eyeWhite/eyes samples=0（本 PMX Face 材质区不含眼白/眼球几何，眼睛材质保持性应单列，本帧未采到），excludedPixels=404961（非 Face 区单列）。
- 负测（配准 Gate 判别力，均按预期判失败）：
  - `--camera-override=shift --negative`：cameraPos 平移至 [6.564,…]，registration=override-active、faceSamples=0（配准失败被正确判别）。
  - `--camera-override=null --negative`：相机解锁退回默认 fov=45，registration=override-active，faceSamples=830 但 MAE 全部 80-137（错位导致大误差被捕获）。

## 6. 阻塞根因分析（未解决，候选）
- 关键新证据：三模式 pre-tonemap HDR 读回 face 均值**完全相同** = [0.8852, 0.5981, 0.5556]（n=4639）。实时 override 生效时三模式应给出不同 face 值，故 strong 提示 `v14dState2OverrideFsBodyFixed` **未对 Face 生效**，输出落到同一原始 BaseColor。
- 色彩空间佐证：face_d 原始线性均值约 [0.509,0.232,0.197]；当前 Web face 输出 G/B 高于 face_d 线性值，而公式所有乘数 ≤1，数学上不可能，进一步提示 tex_color 实际并非线性解码值或 override 未接管。
- 未决矛盾：引擎 dist 中加入的 console 调试标记未出现在 Playwright console（其他 [reze] 日志正常），但 faceApplied=true（来自 faceResult.ok）。怀疑 applyStyleGroups 走 signature 缓存分支跳过 compileGraph，或运行时执行的不是含覆写注入的 bundle。
- 修正路线（下一票据）：核验引擎 compileAndInstallGroup 缓存是否跳过 compileGraph；确认 Next/webpack bundle 是否加载 slots/compile 注入；在 GPU 层对 Face 单独断言 override 后的 final_color 与公式预测一致。

## 7. VMD 零回归
- 实跑默认非诊断入口 load→play→pause→seek（probe-v14d-vmd-runtime.mjs）：play 帧前进 t0=0.781s→t1=1.312s、pause 稳定 time=1.312s、seek 到位 time=2.000s（期望 2.000s），===VMD-RUNTIME-PROBE-OK===。
- 未修改 PMX/VMD、骨骼、权重、Morph、IK、Grant、Physics、播放时钟、插值、拓扑或材质槽。
- `git diff --name-only <base> -- web/src/features/stage/mmdCompanionRuntime.js web/src/features/stage/vmdIO.ts` 为空（动画运行时零 diff）。

## 8. 实际运行命令与结果
- patch strict verify：`node web/scripts/patch-reze-engine.mjs --verify` → exit 0，===PATCH-VERIFY-OK=== 41 项。
- node/python 语法 / 类型：`npx tsc --noEmit` → 我修改的文件 0 错误；仅剩 `tests/e2e/app-routes-smoke.spec.ts` 的 `__speechCancelCount` 错误，为基线既有（本票据未改该文件）。
- 构建：`npm run build` → exit 0。
- Blender 取证：forensic + blender-ref 脚本实跑出 manifest 与两张参考 PNG。
- 三诊断视图 capture：probe/capture-summary.json + 四模式 PNG（normal/faceShadowOnly/finalFaceComposite/bakedGolden）。
- 真实 GPU 双纹理绑定 Gate：通过（liveBound=true）。
- 完整 Face Gate：实跑出数但 MAE 未达标（见第 5 节）。
- 错误相机/平移负测：通过（配准判别失败）。
- 默认入口 Gate：通过（DEFAULT-GATING-OK）。
- VMD runtime probe：通过（VMD-RUNTIME-PROBE-OK）。
- `git diff --check` → exit 0（仅 LF→CRLF 提示，无冲突标记/空白错误）。

## 9. 修改文件
- 修改：`web/scripts/patch-reze-engine.mjs`、web/scripts/capture-v14d-face-static.mjs、web/src/app/mmd-calibration-render/page.tsx、web/src/features/stage/MMDStage.tsx、web/src/features/stage/RezeWebGpuStage.tsx、web/src/features/stage/v14dFaceStatic.ts、docs/architecture/current-system-topology.md、workflow/workflow-glossary.zh-CN.md。
- 新增：`web/scripts/forensic-v14d-face-state2.py`、web/scripts/blender-ref-v14d-face-state2.py、web/scripts/gate-v14d-face-state2-live.mjs、workflow/concepts/v14d-face-state2-live-composite.zh-CN.md、本报告。
- 未提交：第三方 PMX/VMD/PNG、.scratch 证据（大 PNG 不提交）、node_modules reze-engine dist 补丁（由 patch 脚本在 predev/prebuild 重打）。

## 10. 未完成项 / 风险
- 完整 Face Gate MAE 未达标，实时合成未宣称完成（阻塞）。
- 根因（override 未生效 / 缓存分支 / bundle 未加载注入）未最终定位，需在下一票据修正。
- 眼/口邻域眼睛材质保持性因本帧 Face 区无眼白/眼球样本未采到，需后续单列验证。

证据根目录：`.scratch/v14d-face-state2-runtime/`（gate/gate-report.json、gate/*-web.png、probe/*、forensic-manifest.json、blender-ref-*.png、负测 gate-neg-shift/gate-neg-null）。
