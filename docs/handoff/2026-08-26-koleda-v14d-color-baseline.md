# Koleda V14D Gate B 白光颜色基线验收报告

## 1. 结论

本次 Gate B 颜色基线验证**确实使用了白光场景**，而且 Web 与 Blender 两端都记录并执行了同一组白色场景参数：

- 主光颜色：`#ffffff`
- 世界光颜色：`#ffffff`
- 背景颜色：`#ffffff`
- 地面颜色字段：`#ffffff`
- 主光方位角：`10`
- 主光仰角：`55`
- 主光强度：`1.07`
- 环境光强度：`0.73`

最新真实 WebGPU 采集满足：

- `scene.valid=true`
- `scene.mismatches=[]`
- `roiReadback=true`
- `linearHdrReadback=true`
- `finalDisplayReadback=true`
- `materialMaskReadback=true`
- `vmdLoaded=true`
- `frame120Verified=true`
- `renderFrameStable=true`
- `renderLoopStopped=true`
- `nanCount=0`
- `infCount=0`
- `pageErrors=0`
- `failedRequests=0`

五个 ROI 的 BaseColor、Linear HDR、Final Display 共 15 个级别均为 `measured`。但是本票没有定义正式误差阈值，`formalThresholds=null`。因此本报告证明的是“白光场景下的三层颜色取证链路已建立并得到数值”，**不把诊断 epsilon 或当前误差数据冒充正式 Gate B 通过标准**。

按当前诊断顺序，首次观察到的分歧标记为：

```text
firstDivergenceStatus = observed
firstDivergenceLevel = baseColor
```

其含义是至少一个 ROI 在 BaseColor 级已经超过诊断 epsilon；这不是正式 Gate 阈值，也不等同于已经证明唯一根因。后续 Linear HDR 和 Final Display 的差异可能继续放大或受到各自渲染阶段影响。

## 2. 固定验收输入

| 项目 | 固定值 |
|---|---|
| PMX | `D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx` |
| VMD | `C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\koleda-v14d-authoritative-pose-f120.vmd` |
| Blender Blend | `C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend` |
| 画布 | `1280×720` |
| 帧率 | `30 FPS` |
| 固定帧 | `120` |
| 时间 | `4.0 秒` |
| Web 执行方式 | 停止实时循环，固定动作后执行 `renderFrame(0)` |
| Web 管线 | `reze-k3` |
| 诊断入口 | `/mmd-calibration-render?v14dColorBaseline=1` |
| Web 相机 FOV | `28.072486935852954` |
| Web 相机位置 | `[0.375, 16.6875, -12.75]` |
| Web 相机目标 | `[0.3786548, 16.68750004, -11.75000668]` |
| 相机状态 | 锁定 |

Web 端加载的 VMD 是权威动作文件的静态资源副本。Blender 端在后台进程的内存副本中从工作树临时路径导入 VMD，未保存或修改权威 Blend；这也是 Blender 基线 JSON 中 `vmdExists=false`（外部权威路径不存在）与 `vmdImportExists=true`（工作树临时副本存在）同时出现的原因。

## 3. 白光场景核对

### 3.1 WebGPU

Web 诊断结果来自：

`C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture\final-white-light-frame120-latest\white-light-frame120-diagnostic.json`

该文件的 `result.scene` 为：

```json
{
  "valid": true,
  "status": "ok",
  "mismatches": []
}
```

Web 端启动时使用 `REZE_K3_SCENE_DEFAULTS`，并在白光诊断模式下强制固定：

```text
sunColor       = #ffffff
worldColor     = #ffffff
backgroundColor= #ffffff
groundColor    = #ffffff
sunAzimuth     = 10
sunElevation   = 55
keyIntensity   = 1.07
ambientIntensity=0.73
```

### 3.2 Blender

Blender 基线元数据来自：

`C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture\blender-white-light-frame120-baseline.json`

Blender 后台脚本创建白色主光 `V14D_Baseline_WhiteSun`：

- 类型：`SUN`
- 颜色：`[1.0, 1.0, 1.0]`
- 能量：`1.0700000524520874`
- 方位角：`10.0`
- 仰角：`55.0`
- World 强度：`0.73`
- World 颜色：白色

Blender 该次取证没有保留原舞台地面几何，背景由白色 World 提供；ROI 使用材质 ID 与深度 mask 排除背景，因此地面/背景不会被当成白色衣物样本。`groundColor=#ffffff` 作为跨端场景字段保留，但不代表 Blender 侧存在可参与 ROI 的地面网格。

### 3.3 颜色管理

两端对照使用的 Blender 最终显示参考为：

- View Transform：`AgX`
- Look：`AgX - Medium High Contrast`
- Exposure：`-0.56`
- Gamma：`1.0`

BaseColor 与 Linear HDR 的 Blender 参考来自 Combined/OpenEXR Scene Linear；Final Display 的 Blender 参考来自最终 PNG。

## 4. 三层颜色对照定义

| 层级 | Web 取样来源 | Blender/PMX 对照 | 计算口径 |
|---|---|---|---|
| BaseColor | `v14dUnlit=1` 的 texture-only style groups HDR resolve readback | PMX/Blender 纹理直接采样 | 两端统一 sRGB → Linear 后计算绝对通道差 |
| Linear HDR | 恢复生产材质组后、tonemap 前的 HDR resolve 私有 readback | Blender Combined/OpenEXR Scene Linear | 记录的实际 Web 来源格式为 `rg11b10ufloat`；统一在线性空间比较 |
| Final Display | Web canvas PNG/2D sRGB readback | Blender `AgX + Look + Exposure -0.56 + Gamma 1.0` 最终 PNG | 线性 RGB 平均误差，并额外计算 CIEDE2000 mean/P95 |

Web readback 还包含：

- 1280×720 HDR readback，`rowPitch.hdr=10240`
- 1280×720 材质/深度 mask，`rowPitch.mask=5120`
- mask 来源：`engine-pick-material-id-depth`
- mask 格式：`rgba8unorm`
- 诊断 mask 逻辑：模型覆盖 alpha + 目标材质 ID + `depth24plus` 前景可见性

背景排除不使用“接近白色”判断。

## 5. ROI 定义

所有 ROI 的共同规则：

- 坐标空间：归一化屏幕坐标
- 当前使用矩形 `bounds`；`polygon` 保留为 `null`
- 边缘腐蚀：`2 px`
- 最小有效像素数：`64`
- 背景排除：只接受模型覆盖 alpha、目标材质 ID 匹配、并通过 `depth24plus` 前景可见性的像素
- 参考 mask 来源：Blender evaluated mesh 的 `polygon.material_index` + 软件 z-buffer

| ROI | PMX 材质 | Blender 材质 | Web 材质 | 归一化 bounds `[x,y,w,h]` | 对应像素 bounds `[x,y,w,h]` |
|---|---|---|---|---|---|
| `hair.front` | `HairA` | `PROTO_GF2_HairA` | `HairA` | `[0.3734375, 0.1652778, 0.2164063, 0.4638889]` | `[478, 119, 277, 334]` |
| `hair.back` | `HairB` | `PROTO_GF2_HairB` | `HairB` | `[0.3882813, 0.2638889, 0.2679688, 0.7361111]` | `[497, 190, 343, 530]` |
| `skin.face` | `Face` | `PROTO_V14D_GF2_Face` | `Face` | `[0.4453125, 0.3916667, 0.1304688, 0.1583333]` | `[570, 282, 167, 114]` |
| `clothes.chest` | `Cth1-Top` | `PROTO_GF2_Cth1-Top` | `Cth1-Top` | `[0.4085938, 0.6027778, 0.2320313, 0.3972222]` | `[523, 434, 297, 286]` |
| `clothes.leftSleeve` | `Cth1-Top` | `PROTO_GF2_Cth1-Top` | `Cth1-Top` | `[0.6859375, 0.9375, 0.0179688, 0.0625]` | `[878, 675, 23, 45]` |

`clothes.leftSleeve` 是角色左袖、画面右下方露出的袖片；画面左侧的大袖片属于角色右袖，不纳入该 ROI。

## 6. ROI 数值结果

误差单位为百分比。`平均误差` 和 `R/G/B` 均为绝对线性通道差 × 100。Final Display 额外给出 CIEDE2000 平均值与 P95。

| ROI | 级别 | 样本数 | 有效数 | 有效率 | 平均误差 % | R % | G % | B % | ΔE2000 mean | ΔE2000 P95 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `hair.front` | BaseColor | 90090 | 20775 | 23.060273 | 13.835649 | 14.182020 | 13.832604 | 13.492324 | — | — |
| `hair.front` | Linear HDR | 90090 | 20775 | 23.060273 | 12.808338 | 12.906775 | 12.199222 | 13.319018 | — | — |
| `hair.front` | Final Display | 90090 | 20775 | 23.060273 | 21.673907 | 22.742969 | 20.423380 | 21.855370 | 14.008982 | 23.049970 |
| `hair.back` | BaseColor | 178314 | 49328 | 27.663560 | 14.833004 | 15.712845 | 15.222732 | 13.563437 | — | — |
| `hair.back` | Linear HDR | 178314 | 49328 | 27.663560 | 23.664784 | 24.858350 | 22.202692 | 23.933311 | — | — |
| `hair.back` | Final Display | 178314 | 49328 | 27.663560 | 32.954067 | 34.959176 | 31.396494 | 32.506532 | 17.566243 | 22.287599 |
| `skin.face` | BaseColor | 17930 | 7329 | 40.875627 | 10.468623 | 9.465678 | 10.794004 | 11.146188 | — | — |
| `skin.face` | Linear HDR | 17930 | 7329 | 40.875627 | 110.166833 | 160.644714 | 89.819812 | 80.035973 | — | — |
| `skin.face` | Final Display | 17930 | 7329 | 40.875627 | 48.034743 | 45.771606 | 49.026365 | 49.306258 | 19.780074 | 21.222106 |
| `clothes.chest` | BaseColor | 82626 | 47878 | 57.945441 | 26.645741 | 27.178397 | 26.868675 | 25.890150 | — | — |
| `clothes.chest` | Linear HDR | 82626 | 47878 | 57.945441 | 19.685974 | 20.082830 | 19.875434 | 19.099658 | — | — |
| `clothes.chest` | Final Display | 82626 | 47878 | 57.945441 | 25.168131 | 25.725348 | 25.453120 | 24.325924 | 18.420966 | 25.272947 |
| `clothes.leftSleeve` | BaseColor | 779 | 379 | 48.652118 | 5.130379 | 5.426208 | 5.329883 | 4.635046 | — | — |
| `clothes.leftSleeve` | Linear HDR | 779 | 379 | 48.652118 | 4.330796 | 4.319318 | 4.307953 | 4.365118 | — | — |
| `clothes.leftSleeve` | Final Display | 779 | 379 | 48.652118 | 18.331806 | 18.154042 | 18.081743 | 18.759632 | 9.090668 | 12.226111 |

## 7. 首次分歧与解释边界

当前诊断将级别按以下顺序检查：

```text
BaseColor → Linear HDR → Final Display
```

最新结果标记 `firstDivergenceLevel=baseColor`。这说明在 BaseColor 级已经出现超出诊断 epsilon 的 ROI 差异，优先提示继续检查纹理采样、材质索引、UV、贴图色彩空间与 sRGB/Linear 入口。

但本票没有正式 Gate 阈值，且当前数据中不同 ROI 在 Linear HDR 与 Final Display 的差异幅度也可能继续增大。因此：

1. `firstDivergenceLevel=baseColor` 是当前诊断算法的定位结果；
2. 它不是“BaseColor 已通过”或“Gate B 已失败”的正式判定；
3. 它也不是对所有 ROI 的单一物理根因证明；
4. 正式 Gate 结论必须先补充并批准 `formalThresholds`，再按每 ROI、每级别和最终显示 ΔE 逐项判定。

## 8. 实现范围与硬约束

已实现默认关闭的 `v14dColorBaseline=1` 诊断入口，贯通：

```text
mmd-calibration-render/page.tsx
  → MMDStage.tsx
  → RezeWebGpuStage.tsx
```

诊断模式完成：

- 固定 `reze-k3`
- 固定白色页面/场景背景
- 固定 1280×720
- 固定 VMD frame 120 / 4.0 秒
- 停止实时渲染循环
- 固定执行 `renderFrame(0)`
- BaseColor texture-only Unlit 采样
- Linear HDR tonemap 前 readback
- Final Display canvas readback
- 材质 ID + 深度前景 mask
- NaN/Inf 计数
- 三层 readback 格式与 row pitch 记录
- 五个 ROI 的统计与 CIEDE2000 mean/P95

生产默认行为仍保持关闭。没有修改：

- 骨骼
- 权重
- Morph
- VMD 内容
- Physics
- `0.62/0.38`
- 生产 shader 默认行为
- 默认生产灯光值
- Web RGB 手工补偿

## 9. 验证命令与结果

### 9.1 通过

```powershell
git diff --check
```

结果：通过。

```powershell
node --check web/scripts/capture-v14d-color-baseline.mjs
```

结果：通过。

```powershell
C:\Users\KSG\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m py_compile .scratch\recompute-v14d-color-baseline-roi.py .scratch\capture-v14d-blender-color-baseline.py
```

结果：通过。

```powershell
cd C:\w\v14d-gate-b\web
node scripts/capture-v14d-color-baseline.mjs C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture\final-white-light-frame120-latest
```

结果：真实 Chrome `headless:false` + `--enable-unsafe-webgpu` 采集成功；WebGPU ready；白光场景匹配；VMD frame 120 稳定；三层 readback 与材质/深度 mask 成功；15 个级别均为 `measured`。

```powershell
cd C:\w\v14d-gate-b\web
npm run build
```

结果：通过。Next.js 生产构建完成，`/mmd-calibration-render` 静态页面生成成功。

### 9.2 已知失败

```powershell
cd C:\w\v14d-gate-b\web
npm run check:basic
```

结果：失败于仓库旧断言仍期待：

```text
const initialSettings = sceneSettings ?? DEFAULT_SETTINGS
```

当前源码保留的是：

```text
const initialSettings = sceneSettings ?? pipelineDefaultSettings
```

这是为保留无显式场景参数时的原有管线默认行为；本票不修改该旧测试断言。

```powershell
cd C:\w\v14d-gate-b\web
npx tsc --noEmit
```

结果：失败于仓库已有的 `Window.__speechCancelCount` 类型声明问题：

```text
tests/e2e/app-routes-smoke.spec.ts(478,12)
tests/e2e/app-routes-smoke.spec.ts(480,14)
tests/e2e/app-routes-smoke.spec.ts(580,54)

Property '__speechCancelCount' does not exist on type 'Window'
```

### 9.3 采集期间的非阻断警告

静态资源服务器对 `http://127.0.0.1:3220/spa/` 记录了 404 警告。该路径不是本次 PMX、VMD 或主纹理的必需输入；主资源已加载，最新诊断结果仍为 `pageErrors=0`、`failedRequests=0`。该警告应在后续静态资产服务器整理时单独处理，不作为本次颜色基线的成功证据或失败证据。

## 10. 产物

源码：

- `C:\w\v14d-gate-b\web\src\app\mmd-calibration-render\page.tsx`
- `C:\w\v14d-gate-b\web\src\features\stage\MMDStage.tsx`
- `C:\w\v14d-gate-b\web\src\features\stage\RezeWebGpuStage.tsx`
- `C:\w\v14d-gate-b\web\src\features\stage\v14dColorBaseline.ts`

脚本：

- `C:\w\v14d-gate-b\web\scripts\capture-v14d-color-baseline.mjs`
- `C:\w\v14d-gate-b\.scratch\capture-v14d-blender-color-baseline.py`
- `C:\w\v14d-gate-b\.scratch\recompute-v14d-color-baseline-roi.py`

配置与报告：

- `C:\w\v14d-gate-b\docs\handoff\koleda-v14d-color-baseline-roi.json`
- `C:\w\v14d-gate-b\docs\handoff\2026-08-26-koleda-v14d-color-baseline.md`

最新 Web 原始诊断与截图：

- `C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture\final-white-light-frame120-latest\white-light-frame120-diagnostic.json`
- `C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture\final-white-light-frame120-latest\white-light-frame120-final-display.png`

Blender 白光基线元数据与参考文件：

- `C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture\blender-white-light-frame120-baseline.json`
- `C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture\blender-white-light-frame120-final-display.png`
- `C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture\blender-white-light-frame120-base-color-scene-linear.exr`
- `C:\w\v14d-gate-b\.scratch\v14d-color-baseline-capture\blender-white-light-frame120-linear-hdr-scene-linear.exr`

## 11. 未完成项与风险

1. 尚未定义或批准正式 Gate B 误差阈值；`formalThresholds` 必须保持 `null`，直到阈值来源与验收口径明确。
2. BaseColor 已观察到诊断分歧，下一步应在不改变灯光、骨骼、权重、Morph、VMD、Physics 和生产 shader 默认行为的前提下，优先核对纹理颜色空间、UV/材质索引和 Web/Blender 纹理直接采样的等价性。
3. `skin.face` 的 Linear HDR 差异显著高于其他 ROI，需单独做材质/着色分支的最小单变量复验；当前报告不把它归因到灯光。
4. `clothes.leftSleeve` 有效样本数为 `379`，高于最小值 `64`，但远少于胸部 ROI；如果后续正式 Gate 要求更高样本下限，应重新审核该 ROI 的稳定性。
5. `/spa/` 404 警告应由静态资产服务器清理，但当前不阻断本次主资源采集。
6. `check:basic` 与 `tsc --noEmit` 的仓库已有失败仍需另票修复；本票没有扩大范围处理。
