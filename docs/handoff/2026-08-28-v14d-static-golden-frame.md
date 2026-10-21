# [Stage 2A-GF] V14D 固定初始帧构图对齐（材质/光照视觉 Gate 未通过）— 交付报告

日期：2026-08-28；工作树：`E:\codexWorktree\3137\MMD project`；分支：`codex/v14d-static-golden-frame`；基线：`adc1975ce95d9e3c48c29ee1ca5545a1390cf7dc`。

## 结论

**第一轮（相机/构图）达成，修正轮（角色最终外观）未闭合，本票以 checkpoint 交付。** Web 固定相机已按 Blender 权威 `.blend` 取证值重建，构图/角色尺寸/装备高度一致（数量级口径错位消除），Face State 2 合成真实作用于画面，诊断读回门控通过。但**主验收「肉眼明显视觉对齐」未达成**：修正轮实测并排 ROI MAE（0–255 域）face≈[63.6,58.8,53.4]、frontHair≈[39.9,37.3,35.5]、backHair≈[45.2,43.6,43.3]、chest≈[54.0,54.2,54.2]、full≈[31.5,31.2,31.8]，**与第一轮相比不降反升**，未达到「四 ROI 至少下降 50%、每通道 ≤20/255」的验收线。根因：剩余差异由**光照**主导（Blender 六 AREA 暖光+世界光 vs Web reze-k3 白光），而本修正轮的可见岛烘焙只固化了 **BaseColor 反照率**（其本身在两引擎中本就相同，不解决光照）；真正把六灯/世界光/Toon 固化进纹理的 Cycles `bpy.ops.object.bake` 在当前无头环境被禁用（poll 恒 False），发射/ID 图两条替代路线均被单变量实验排除。详见「修正轮烘焙尝试与阻塞」。

## 根因链与对齐依据（全部实测验证）

1. **单位口径**：reze-engine 以 PMX 单位渲染，不是米单位。CPU 皮肤后脸部世界包围盒实测 y≈15.8–17.6、z≈-1.8~-0.4（脸高约 1.79 PMX 单位）。上一票按米单位假设的相机/模型缩放不成立（`setModelTransform scale=12.5` 会让角色填满屏幕，该路线已弃用）。
2. **姿态朝向**：Web 与 Blender 骨骼局部旋转逐轴一致（头 [-2.4°, 2.3°, 5.0°] vs [2.4°, -1.2°, 5.4°]，镜像约定差异）；但 Web 头部姿态应用效果使脸部法线朝向 Blender 坐标系的 -Y（即 Web 的 +Z）一侧，故相机须从 Web 头正面取距。
3. **距离补偿**：Blender 投影头高约 12mm、Web 脸高约 14.3mm，存在剩余姿态差异；相机取 2× Blender 距离以把角色压到同一构图。
4. **显示变换**：faceStatic 分支把背景压到 `#050505`、地面与泛光关闭、`setViewTransformOptions({exposure:-0.56, gamma:1.0})`，对齐 Blender AgX Medium High Contrast 曝光 -0.56。

## Blender 权威取证（blender-golden-frame.py，Blender 5.1.1，约 23 秒）

- 产物：`.scratch/v14d-static-golden-frame/golden-frame.json`、`blender-golden-frame-final.png`（权威参考，frame120 + VMD import scale=0.08）。
- 相机 PROTO_GameCamera：location `[0.03, -1.02, 1.335]`m，rotX=90°/rotZ≈-0.21°，lens 72mm，sensor 36mm AUTO → 方形画幅下垂直视场角 28.0725°。
- 色彩管理：AgX Medium High Contrast，exposure=-0.56；灯光 6 盏 AREA（Key 370W 冷蓝 / Fill 56W / Rim 18W / Top 40W / 暖背景 ×2）+ 世界强度 0.042。
- 脸部投影 ROI（px）：[221.6, 201.06, 195.33, 214.65]，中心 (319, 308)；Blender 侧脸高约 0.12m（PMX 约 1.5）。

## Web 侧改动

| 文件 | 改动 |
| --- | --- |
| `web/src/features/stage/v14dFaceStatic.ts` | `V14D_FACE_STATIC_CAMERA` 更新为对齐值（fov 28.0725°、position [0.564, 18.55, -13.0]、target [0.564, 16.4125, -1.26]、locked）；新增 `worldPos`/`diffuseFlat` 调试模式类型 |
| `web/src/features/stage/RezeWebGpuStage.tsx` | faceStatic 分支覆盖显示变换（暗背景、无地面、关泛光、exposure -0.56/gamma 1.0）；新增 `v14dFaceStaticGated` prop 单独门控 capture/mask/HDR 导出；`__rezeEngineProbe()` 精简为最小字段（相机/模型变换/脸部 bbox）并在 cleanup 中删除防残留 |
| `web/src/features/stage/MMDStage.tsx` | 透传 `v14dFaceStaticGated` |
| `web/src/app/mmd-calibration-render/page.tsx` | faceStatic 默认模式改为 `finalFaceComposite`；MODE_LABEL 增加调试模式标签 |
| `web/scripts/capture-v14d-face-static.mjs` | 支持 `--mode=<名称>` 单模式采集 |
| `docs/architecture/current-system-topology.md` | 登记本票相机对齐结论（PMX 单位口径、姿态朝向、距离补偿、显示变换覆盖、ROI 数值） |

## 验收证据

- 机器证据（frame120 / Face State 2 / Blend 0.00 / cameraLocked=true / paused=true / faceApplied=true）：`===CAPTURE-GATE-OK===`（三模式，faceSamples=4639），产物 `.scratch/v14d-static-golden-frame/capture-golden/`。
- 用户路径：真实 `setInputFiles` 三模式通过（`===USER-PATH-OK===`）。
- 默认入口门控：无 `v14dFaceStatic=1` 时诊断功能不启用（`===DEFAULT-GATING-OK===`）。
- Face State 2 合成生效：normal 与 finalFaceComposite 的脸部 meanLinear 分别为 [0.427,0.296,0.275] 与 [0.409,0.262,0.233]，合成纹理真实改变画面。
- 并排与差异图：`.scratch/v14d-static-golden-frame/side-by-side.png`（Blender | Web）、`diff-x3.png`、`before-after.png`（base 相机构图错位 vs 本票对齐后）。
- ROI 平均绝对差（0–255 域，`side-by-side-report.json`，finalFaceComposite）：face [46.6,44.95,44.01]、frontHair [33.8,37.5,40.1]、backHair [39.6,39.9,41.7]、chest [56.8,57,58.5]、full [29.7,30,31.2]。**构图对齐已达成，但材质/光照视觉 Gate 未通过**（数值差异主要是光照色调：Blender 多 AREA 暖光 vs reze-k3 白光）。修正轮 `bakedGolden`（反照率烘焙）实测 face [63.6,58.8,53.4] 等反而更高，进一步确认差异由光照而非反照率主导。
- `npm run build` 通过；VMD 动画运行时零回归：`git diff adc1975c -- mmdCompanionRuntime.js vmdIO.ts vmd_writer.py` 为空。

## 残留风险与未完成项

- 光照色调未完全对齐：Blender 六盏 AREA 暖光 + 世界强度 0.042 与 reze-k3 白光（sunAzimuth 10、sunElevation 55、key 1.07、ambient 0.73）存在差异，ROI 数值仍偏高；票据明确允许本票只做分量层、不迁移多灯/RMO/Normal/Toon。
- CPU 皮肤矩阵 Y 列与 Blender 约 0.84 PMX 单位差异（姿态应用深度差异），已通过 2× 距离补偿使构图一致；如需像素级同屏同 mask 对齐需另票处理姿态求解口径。
- 仓库既有 TypeScript 错误披露：`tests/e2e/app-routes-smoke.spec.ts` 引用 `__speechCancelCount` 在 base_commit 即存在，与本票无关，tsc 全量仍有该错误，未伪称全量通过。
- `.scratch/` 下大二进制（HDR JSON 等）不入版本，仅作本地证据。

## 修正轮烘焙尝试与阻塞（2026-08-28 第二轮）

目标：把 Blender 六 AREA+世界光+Toon 在 frame120 的最终可见着色固化进逐材质纹理，Web 侧 unlit 显示以对齐最终画面。三条路线均被实测排除：

1. **Cycles `bpy.ops.object.bake`（COMBINED/DIFFUSE）**：理论最优（把光照+材质固化进纹理），但当前无头环境（`blender -b`）下 `bpy.ops.object.bake` 的 `poll()` 恒为 False（C 层要求 UI 窗口上下文），经 `temp_override` 直接/间接上下文均无法绕过，最小复现（仅 Face 材质 + 64×64 测试图）确认。此为本环境的硬阻塞，非脚本逻辑问题。
2. **统一材质索引 ID 图反投影**：渲染「每材质恒定色=槽索引」的 ID 图，再按像素反查 UV 写回。实测 ID 图被抗锯齿/透明/次表面打散，R 通道不再等于槽索引（hair 区域像素值 14/18/30 而非纯 24），hair 仅 67/24 像素命中，不可用。
3. **逐材质发射法（albedo + uv + mask_\<safe\>）**：终端 BSDF→Emission(=BaseColor) 渲染反照率图，几何 UV 图，再逐材质单独发光（保留 alpha cutout）求可见像素，离线反投影。此路线**成功产出烘焙纹理**（`baked/baked_<safe>.png`，face/hairA/hairB/body/top/cape），Web 侧新增 `bakedGolden` 模式对六材质套纯纹理 unlit graph 显示。但**其只固化了 BaseColor 反照率，不含光照**；BaseColor 纹理在 Blender 与 Web 中本就相同，因此烘焙纹理≈原纹理，无法缩小光照差异。实测并排 ROI MAE 反而更高（Web unlit 比 reze-k3 白光更亮，偏离权威暖光画面）。

**结论**：要真正闭合光照，必须在带 UI 的 Blender 会话（`blender` 非 `-b`，或用户手动执行）中运行 Cycles COMBINED 烘焙，把六灯/世界光/Toon 固化进纹理；或在 Web 侧实时近似 Blender 六灯（逐材质光强/色温/方向），两者均超出本修正轮预算与环境能力。

## 使用方式

在 `/mmd-calibration-render?v14dFaceStatic=1`（可选 `v14dFaceMode=normal|faceShadowOnly|finalFaceComposite|bakedGolden`，**默认 `finalFaceComposite`**）打开「V14D 固定黄金帧」面板，选择本地 Koleda 模型目录 + 权威 VMD + 派生合成图即可查看；无需改代码。`bakedGolden` 为「反照率烘焙诊断（失败实验）」非默认模式，只固化 BaseColor 反照率、不含光照，**不得作为明显视觉对齐的通过状态**（见 `workflow/workflow-glossary.zh-CN.md`）。诊断采集（`web/scripts/capture-v14d-face-static.mjs`）与 `__rezeEngineProbe` 仅供调试，默认生产入口不泄漏。
