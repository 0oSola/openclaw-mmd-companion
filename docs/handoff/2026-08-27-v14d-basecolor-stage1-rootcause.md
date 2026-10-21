# V14D Stage 1 — BaseColor 对齐：根因分析与修复报告

## 1. 结论

BaseColor 级偏差的**根因不是 Web 纹理采样/sRGB/UV/材质绑定错误**。Web 端 unlit 诊断图输出的就是 PMX diffuse 纹理的纯采样值，经逐通道定量核对，与"正确口径"的 Blender 参考高度一致。

偏差来自**两处口径问题**，叠加后被误判为"采样错误"：

1. **参考值口径错误**：Gate B 的 Blender 侧 BaseColor 参考，是把 Principled 的 Base Color 上游**整条节点树**接进 Emission 渲染出来的。这条链里包含：
   - 头发 `PROTO_HairTint`：MixRGB MULTIPLY 常量 `[0.84, 0.85, 0.96]`（linear），即 `BaseColor = 纹理 × tint`；
   - 衣服 `Cth1-Top`：`BaseColor = 纹理 × (rmo通道 × 0.62 + 0.38)`（空间变化，约 ×0.63–0.66）；
   - 面部：纹理 × `FaceWarm` 常量 `[1.0, 0.935, 0.89]` × 逐 texel 阴影 mask 混合。
   因此参考值是"被节点树压暗/染色后的渲染结果"，而 Web unlit 是纯纹理，二者本就不该相等。

2. **误差度量口径错误**：原指标是 `mean(逐像素 |像素值 − 单一常数参考|)`。当参考是单一常数而实际纹理在 ROI 内有空间变化时，这个指标天然等于"偏差 + 纹理方差"。对纹理多变的头发/胸口，方差项本身就高达 13–27%；只有颜色均匀的左袖方差接近 0，所以只有它显示 5.1%。

证据见第 3、4 节。

## 2. 固定输入

| 项目 | 值 |
|---|---|
| PMX | `D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx`（只读） |
| VMD | `koleda-v14d-authoritative-pose-f120.vmd`，固定 frame 120 / 4.0s |
| Web 管线 | `reze-k3`，`v14dColorBaseline=1`，1280×720，停止实时循环 `renderFrame(0)` |
| Blender | `D:\Blender\blender.exe` 5.1.1，EEVEE，白光场景 |

## 3. 根因证据链

### 3.1 Blender 节点树探针

脚本 `.scratch/probe-v14d-material-nodes.py` / `probe-v14d-material-constants.py` 直接读取 `.blend` 内存副本的材质节点（不改文件），结果：

| 材质 | Base Color 上游链 |
|---|---|
| `PROTO_GF2_HairA`/`HairB` | `图像纹理(hair_d, sRGB)` → `PROTO_HairTint`(MixRGB MULTIPLY, C2 常量 `[0.84,0.85,0.96]`) |
| `PROTO_GF2_Cth1-Top` | `图像纹理(cloth1_da, sRGB)` → MixRGB MULTIPLY，C2 = `运算.001(ADD)`: `分离颜色(rmo)×0.62 + 0.38` |
| `PROTO_V14D_GF2_Face` | `图像纹理(face_d, sRGB)` → `FaceWarm`(×`[1.0,0.935,0.89]`) → `NarrowApplyArtShadow`(×逐 texel 阴影混合) |

### 3.2 Web 实测 = 纯纹理（逐通道闭合）

临时探针 `measureV14dRoiActualMeans`（保留在 `v14dColorBaseline.ts`，默认只在诊断模式输出）记录 Web unlit 实际均值；Blender 侧用旧 EXR ÷ tint 反推纯纹理均值。二者逐通道对比：

| ROI | Web unlit sRGB | Blender 反推纯纹理 sRGB | 逐通道差 |
|---|---|---|---|
| hair.front | [0.6646, 0.6455, 0.7039] | [0.6558, 0.6373, 0.6966] | ≈1% |
| hair.back | [0.7547, 0.7331, 0.7866] | [0.7435, 0.7225, 0.7770] | ≈1.2% |
| clothes.chest | [0.6654, 0.6578, 0.6851] | [0.6637, 0.6564, 0.6856] | **<0.2%** |
| clothes.leftSleeve | [0.8053, 0.8085, 0.8235] | [0.7926, 0.7956, 0.8140] | ≈1.3% |

`clothes.chest`（原报告偏差最大 26.6%）纯纹理值与 Web 完全一致，证明 UV、材质绑定、sRGB 转换全部正确。

### 3.3 误差分解：方差项主导

用 Blender base EXR 逐像素计算 `mean|像素 − ROI均值|`（方差项），与原报告误差对比：

| ROI | 方差项 (%) | 原报告误差 (%) |
|---|---|---|
| hair.front | 13.41 | 13.84 |
| hair.back | 13.97 | 14.83 |
| skin.face | 8.38 | 10.47 |
| clothes.chest | 27.03 | 26.65 |
| clothes.leftSleeve | 5.87 | 5.13 |

方差项几乎完全解释原误差，证明旧指标测的是"纹理方差"而非"采样偏差"。

## 4. 修复内容

### 4.1 指标口径（`v14dColorBaseline.ts`）

BaseColor/Linear HDR 级的误差从 `mean(逐像素 |pixel − const|)` 改为 `|mean(pixel) − mean(reference)|`（ROI 均值对均值的偏差口径）。纹理空间方差不再计入"误差"。

### 4.2 参考值口径（Blender 采样脚本 + TS 参考常量）

- `.scratch/capture-v14d-blender-color-baseline.py`：unlit 材质的 Base Color 改为**直连第一个 sRGB 图像纹理节点**（`first_color_texture_socket` 深度优先追踪，跳过 tint/rmo/阴影节点树），输出纯纹理参考 EXR。
- `v14dColorBaseline.ts` 五个 ROI 的 `baseColorSrgb` 更新为 Blender 纯纹理渲染的 ROI 均值（sRGB）。

### 4.3 诊断探针（保留，默认仅诊断模式生效）

- `measureV14dRoiActualMeans`：输出 Web unlit 每 ROI 实际均值，便于后续回归取证。
- `compareRoiLevel` notes 增加 `actualLinearMean`/`expectedLinear`/`imageColorSpace`。

### 4.4 采集脚本可用性

- `capture-v14d-color-baseline.mjs` 支持 `V14D_CAPTURE_BASE` / `V14D_ASSET_BASE` 环境变量，便于在不同 worktree/端口下采集。
- Blender 脚本 `set_camera` 移到 VMD 导入前、改用 `bpy.data.objects` 取相机；`select_vmd_root` 用直接 `select_set` 替代 `bpy.ops.object.select_all`，规避 background 模式 depsgraph 偶发剔除对象的问题。

## 5. 验证结果（修复后）

采集：`.scratch/v14d-color-baseline-capture/post-fix-final/white-light-frame120-diagnostic.json`

| ROI | BaseColor 误差 %（偏差口径） | 判定 |
|---|---|---|
| hair.front | 0.98 | <3% 通过 |
| hair.back | 1.36 | <3% 通过 |
| skin.face | 1.95 | <3% 通过 |
| clothes.chest | 0.12 | <3% 通过 |
| clothes.leftSleeve | 1.73 | <3% 通过 |

**所有 ROI BaseColor 线性误差均 < 3%，达成候选阈值。**

### 回归

- `scene.valid=true`、`mismatches=[]`
- `frame120Verified=true`、`renderFrameStable=true`、VMD 加载、当前帧 120、`playing=false/paused=true`
- `nanCount=0`、`infCount=0`、`pageErrors=0`、`failedRequests=0`
- 骨骼/Morph/Physics/动画链未做任何修改（硬约束保持）

## 6. 影响范围

- 生产渲染路径**零改动**：所有改动都在 `v14dColorBaseline` 诊断通道（默认关闭）和 `.scratch` 采集脚本。
- 未修改 PMX loader、骨骼、权重、Morph、VMD 内容、IK、Physics、顶点拓扑、VMD 播放流程。

## 7. 残留风险与后续

1. **Linear HDR / Final Display 仍有误差**（尤其 `skin.face` Linear HDR 110%、`hair.back` 21%）。这超出本票 BaseColor 范围，是后续 Stage（灯光/材质着色/tonemap）要分别处理的，不在此归因。
2. 本票的 <3% 是**候选阈值**，正式 Gate B 阈值（`formalThresholds`）仍需审批后才生效。
3. `clothes.leftSleeve` 有效像素 379，样本量偏小；正式 Gate 若要求更高样本下限需重审。
4. 偏差口径假设 ROI 均值能代表材质颜色；若后续需要逐纹理精度，应升级为"Web 与 Blender 同一 UV 逐 texel 直采对齐"的取证方式。

## 8. 产物清单

- 修复代码：`web/src/features/stage/v14dColorBaseline.ts`、`web/src/features/stage/RezeWebGpuStage.tsx`、`web/scripts/capture-v14d-color-baseline.mjs`、`.scratch/capture-v14d-blender-color-baseline.py`
- 探针：`.scratch/probe-v14d-material-nodes.py`、`probe-v14d-material-constants.py`、`analyze-v14d-variance.py`、`recompute-pure-tex-ref.py`、`verify-v14d-web-texture-estimate.py`
- 采集数据：`.scratch/v14d-color-baseline-capture/pre-fix/`（修复前）、`post-fix-final/`（修复后）、`post-fix-blender/`（纯纹理 Blender 参考）
- 本报告
