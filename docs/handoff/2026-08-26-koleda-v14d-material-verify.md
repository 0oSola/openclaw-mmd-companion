# 克莱妲 V14D → MMD Web 材质迁移可行性验证报告

日期：2026-08-26
工作目录：`C:\w\v14d-mat-verify`
分支：`codex/v14d-material-verify`
基线：`58a200fa4fd4edc0efb40a09e6c63951d491e659`

## 结论摘要

在当前已取得的结构审计与 Unlit 链路证据范围内，本票证明了“只迁移材质数据、保留 PMX + VMD + Morph + Physics 链路”具备可行的实现接缝；最终视觉一致性仍受 Gate A、Gate B 和精确 frame120 数值 Gate 约束。Blender V14D 与原始 Koleda PMX 在顶点、三角形顶点集合、UV、材质槽、顶点 Morph 数量和名称上保持等价；Blender 中的额外骨骼主要是导入辅助骨骼，不应写回 PMX。因此不需要重做几何或动画链。

最终推荐：**B. PMX + VMD + baked material + Web custom shader**。

原因是：

1. Hair / Skin / White Clothes 的 BaseColor 已能通过现有 PMX 材质绑定进入 WebGPU，并以诊断图直接显示。
2. 完整 V14D 还依赖 RMO、Normal、Face Shadow state mask、Toon Ramp、Hair Spec/Tangent 等现有基础 PMX 契约没有完整暴露的输入。
3. 所需扩展位于材质绑定和 shader 输入层，不需要修改 PMX loader 的骨骼、VMD、Morph、Physics 数据链。

本票没有把最终视觉一致性写成“已通过”。Gate A（彩点定位/静止稳定性）和 Gate B（BaseColor / Linear HDR / Final Display 的 ROI 数值基线）仍未完成；精确 frame120 的 Skeleton、Morph、Physics 数值 Gate 也仍未完成。

## 1. 范围、权威输入与边界

只在 `C:\w\v14d-mat-verify` 内写入。Blender 和原始资产均为只读输入。

权威输入：

- V14D Blender：`C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend`
- 权威姿势 manifest：`C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\koleda-v14d-authoritative-pose-f120.manifest.json`
- 权威 VMD：`C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\koleda-v14d-authoritative-pose-f120.vmd`
- 对应 Koleda PMX（只读）：`D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx`
- Blender / PMX 审计证据：`C:\w\v14d-mat-verify\docs\handoff\evidence\blender_headless_audit.json`、`C:\w\v14d-mat-verify\docs\handoff\evidence\pmx_audit.out.json`
- Blender MCP 快照：`C:\w\v14d-mat-verify\docs\handoff\evidence\blender_mcp_snapshot.json`、`C:\w\v14d-mat-verify\docs\handoff\evidence\blender_mcp_key_evidence.json`

明确没有做：

- 没有继续调灯、调 roughness、修改 `0.62/0.38` 或复现 Specular。
- 没有改骨骼、权重、Morph、VMD、Physics 或默认生产 shader 路径。
- 没有把当前相机下的头发高光烘进 BaseColor。
- 没有把临时浏览器资产、Chrome profile 或服务器脚本作为生产资产。

## 2. 八项确认矩阵

| 编号 | 确认项 | 状态 | 证据与边界 |
|---:|---|---|---|
| 1 | V14D 改动审计 | 部分通过 | 顶点、拓扑顶点集合、UV、材质槽、Morph 等价；法线存在 3 个零长度、切线存在 1 个零长度，且有 36 个法线比较误差大于 `1e-3`，不能宣称法线/切线完全 unchanged。 |
| 2 | Blender ↔ PMX 精确材质映射 | 通过 | 单一 mesh 的 27 个材质槽按 index 和连续面区间一一对应，见第 4 节。 |
| 3 | Bake / Dynamic 分类 | 通过 | 明确区分可烘焙、可参数化迁移和不能烘焙的视角/灯光相关项，见第 5 节。 |
| 4 | Texture Pack 与 manifest | 通过 | 已给出目录契约和 `koleda-v14d-material-manifest.json` 草案。 |
| 5 | 颜色空间取证 | 部分通过 | Blender AgX 参数、纹理 colorspace、Web sRGB texture/output 链路已记录；没有 Linear HDR readback，所以“第一次分歧”的精确级别尚未证明。 |
| 6 | Web / MMD 引擎能力盘点 | 通过 | 直接阅读 `reze-engine@0.26.0`；结论是“需要新增 shader 输入”，不是修改 PMX/VMD/Morph/Physics。 |
| 7 | Hair / Skin / White Clothes 最小 PoC | 链路通过，数值基线未通过 | Chrome WebGPU 已就绪，三个材质组均被命中，Unlit 直接显示 diffuse texture；没有 ROI 像素 readback，不能宣称数值颜色等价。 |
| 8 | VMD 完整性验证 | 部分通过 | VMD 文件结构、请求、模型加载和 WebGPU 渲染已确认；精确 frame120 的骨骼姿态、Morph 权重、Physics 和材质分配数值 Gate 未完成。 |

## 3. V14D 改动审计

### 3.1 Geometry / UV / Material

| 项目 | Blender 取证 | 与 PMX 比较 | 判定 |
|---|---:|---:|---|
| 顶点 | 60,352 | PMX 60,352；位置最大绝对误差 `9.059906e-08`，平均 `2.437475e-08` | unchanged（在导入变换误差内） |
| 三角形 | 78,648；loop 235,944 | 顶点集合 78,648 / 78,648；顺序全部为反向绕序 | unchanged（轴序/绕序导入约定） |
| UVMap | corner 235,944 | 最大误差 0；采用 `Blender UV=(u, 1-v)` | unchanged |
| UV1 | corner 235,944；非 active | 保留；本次材质均使用 UVMap | unchanged / 未使用 |
| 材质槽 | 27 | PMX 27；面区间连续且按 index 对齐 | unchanged |
| 坐标变换 | — | `Blender position = PMX (x, z, y) * 0.08` | 迁移契约必须固定 |

三角形全部反向不是 V14D 重新建模的证据：在 PMX → Blender 的轴交换和绕序约定下，每个三角形的顶点集合完全一致。该结论不等于可以任意重排 PMX 三角形；Web 运行时继续使用原 PMX。

### 3.2 Bone / Weight / Morph

| 项目 | 取证 | 判定 |
|---|---|---|
| PMX 骨骼 | 401 | 运行时骨骼数据来源不变 |
| Blender Armature | 449，含 236 个按名称识别的导入辅助骨骼 | 额外骨骼解释为导入辅助，不写回 PMX |
| Armature modifier | `mmd_armature` | 仍由原 MMD Armature 驱动 |
| 权重 | PMX weight kind `0/1/2 = 22474/16824/21054`；Blender 顶点组计数保留 | 未发现 V14D 材质票据要求之外的权重改动 |
| Shape Key | Basis + 61 个非 Basis | 与 PMX 61 个顶点 Morph 名称全部匹配 |
| PMX 材质 Morph | `Mask_Off`、`Cape_Off` | 不属于 Blender Shape Key；保留 PMX 运行时契约 |

硬 Gate 规则：材质迁移只能替换或扩展材质输入；不得重新导出带有骨骼、权重、Morph 或材质分配变化的 PMX。

### 3.3 Normal / Custom Normal / Tangent

Blender 网格存在 `custom_normal`（`CORNER / INT16_2D`）和 `UVMap` 切线：

- Custom/corner normal 数量：235,944；零长度 3 个。
- Blender 与 PMX 导入法线比较：最大绝对误差 `0.9999557137`，平均 `3.7431816e-05`，大于 `1e-3` 的数量 36。
- Tangent 数量：235,944；零长度 1 个；handedness negative 80,243、positive 155,701。

因此正式分类为：**“未证明被 V14D 修改 / 存在法线与切线风险”**，而不是完全 unchanged。该风险会影响 Normal Map、Tangent-space Hair Anisotropy 和部分 Toon Normal 迁移，必须在实现完整 custom shader 前单独复核。

## 4. Blender ↔ PMX Material Mapping

映射依据是 PMX material index、Blender slot index、连续面区间和实际节点纹理路径；不按当前画面外观猜测。mesh 只有 `GirlsFrontline KoledaDefault_mesh`，所有材质使用 `UVMap`。

| index | PMX material | Blender material | mesh / submesh（Blender faces） | BaseColor | Sphere | Toon ramp |
|---:|---|---|---|---|---|---|
| 0 | `Face` | `PROTO_V14D_GF2_Face` | `GirlsFrontline KoledaDefault_mesh / 0–2737` | `c_Koleda_slg_face_d.png` | `spa\skin.png` | `spa\skintoon.bmp` |
| 1 | `UpperTeeth` | `PROTO_GF2_UpperTeeth` | `/ 2738–2777` | `c_Koleda_slg_face_d.png` | — | — |
| 2 | `LowerTeeth` | `PROTO_GF2_LowerTeeth` | `/ 2778–2817` | `c_Koleda_slg_face_d.png` | — | — |
| 3 | `Tongue` | `PROTO_GF2_Tongue` | `/ 2818–2977` | `c_Koleda_slg_face_d.png` | — | — |
| 4 | `EyeWhite` | `PROTO_GF2_EyeWhite` | `/ 2978–3109` | `c_Koleda_slg_face_d.png` | — | — |
| 5 | `Brows` | `PROTO_GF2_Brows` | `/ 3110–3213` | `c_Koleda_slg_face_d.png` | — | — |
| 6 | `Lashes` | `PROTO_GF2_Lashes` | `/ 3214–3835` | `c_Koleda_slg_face_d.png` | — | — |
| 7 | `Eyes` | `PROTO_GF2_Eyes` | `/ 3836–3979` | `c_Koleda_slg_eye_d.png` | — | — |
| 8 | `Eyes+` | `PROTO_GF2_Eyes+` | `/ 3980–4123` | `c_Koleda_slg_eyeblend.png` | — | — |
| 9 | `BodySkin` | `PROTO_GF2_BodySkin` | `/ 4124–7794` | `body_d.png` | `spa\skin.png` | `spa\skintoon.bmp` |
| 10 | `FingerNails` | `PROTO_GF2_FingerNails` | `/ 7795–8282` | `body_zhijia01_da.png` | — | — |
| 11 | `Cth1-Top` | `PROTO_GF2_Cth1-Top` | `/ 8283–23042` | `c_KoledaSSR01_slg_cloth1_da.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 12 | `Cth1-Glove` | `PROTO_GF2_Cth1-Glove` | `/ 23043–27272` | `c_KoledaSSR01_slg_cloth1_da.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 13 | `Cth4-Glove` | `PROTO_GF2_Cth4-Glove` | `/ 27273–30269` | `c_KoledaSSR01_slg_cloth4_d.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 14 | `Cth2-Shoes` | `PROTO_GF2_Cth2-Shoes` | `/ 30270–36543` | `c_KoledaSSR01_slg_cloth2_d.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 15 | `Cth5-ShoesZip` | `PROTO_GF2_Cth5-ShoesZip` | `/ 36544–36643` | `c_KoledaSSR01_slg_cloth5_d.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 16 | `Cth2-Pants` | `PROTO_GF2_Cth2-Pants` | `/ 36644–44076` | `c_KoledaSSR01_slg_cloth2_d.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 17 | `Cth2-Pouch` | `PROTO_GF2_Cth2-Pouch` | `/ 44077–47990` | `c_KoledaSSR01_slg_cloth2_d.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 18 | `Cth3-Mask` | `PROTO_GF2_Cth3-Mask` | `/ 47991–50124` | `c_KoledaSSR01_slg_cloth3_d.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 19 | `Glock` | `PROTO_GF2_Glock` | `/ 50125–54382` | `c_KoledaSSR01_slg_glock_d.png` | — | — |
| 20 | `GunSilencer` | `PROTO_GF2_GunSilencer` | `/ 54383–55640` | `cw_WeaponPart_2_gunsilencer_3_WL_d.png` | — | — |
| 21 | `Cth1-Cape` | `PROTO_GF2_Cth1-Cape` | `/ 55641–60636` | `c_KoledaSSR01_slg_cloth1_da.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 22 | `Cth1-Cape2` | `PROTO_GF2_Cth1-Cape2` | `/ 60637–63468` | `c_KoledaSSR01_slg_cloth1_da.png` | `spa\SSShine2.png` | `spa\SToon03.png` |
| 23 | `HairA` | `PROTO_GF2_HairA` | `/ 63469–73534` | `c_KoledaSSR01_slg_hair_d.png` | — | — |
| 24 | `HairB` | `PROTO_GF2_HairB` | `/ 73535–78038` | `c_KoledaSSR01_slg_hair_d.png` | — | — |
| 25 | `EyeShadow` | `PROTO_GF2_EyeShadow` | `/ 78039–78118` | `c_Koleda_slg_eyeblend.png` | — | — |
| 26 | `Emotions` | `PROTO_GF2_Emotions` | `/ 78119–78647` | `extra.png` | — | — |

补充：Blender 节点中另有 `c_KoledaSSR01_slg_cloth1_rmo.png`、`c_KoledaSSR01_slg_cloth1_n.png` 和 `c_KoledaSSR01_slg_hair_spc.png` 等声明输入，但当前图像尺寸为 `0×0`、`has_data=false`；manifest 因此必须保留“已声明但为空”状态，不能把它们伪装成已经有效的纹理。

## 5. Blender Node Graph 与 Bake / Dynamic 分类

### 5.1 已观察到的节点结构

- `BodySkin`：`body_d.png`（sRGB）经过固定肤色乘色 `[1.0, 0.945, 0.905, 1.0]`；Roughness `0.75`、Specular IOR Level `0.18`、Subsurface Weight `0.012`、Emission Strength `0.04`。BaseColor 同时进入 Principled Base Color 和 Emission；另有 Toon Diffuse → Shader to RGB → Toon Ramp → Toon Emission。
- `Cth1-Top`：BaseColor `c_KoledaSSR01_slg_cloth1_da.png`（sRGB）；RMO `Non-Color` 的 Red → Roughness、Green → Metallic、Blue 进入颜色混合支路；Normal `Non-Color` 同时进入 Principled 和 Toon Diffuse，但当前 RMO/Normal 为空。
- `HairA / HairB`：BaseColor `c_KoledaSSR01_slg_hair_d.png`（sRGB）经过固定银白紫乘色 `[0.84, 0.85, 0.96, 1.0]`；使用 Blender Tangent；Hair Spec 为 `Non-Color`，但当前为空；Anisotropic `0.72`；无直接 Normal Map 连接；另有 Toon Ramp。
- V14D Face Shadow：节点含 `PROTO_V14D_UV`、五个 `MaskState0..4`、`LayerA`、`LayerB`、`BlendWeight`、最终 mask 混合和窄混合脸色输出。状态纹理为 `Non-Color`，不是普通 BaseColor。

### 5.2 分类表

| 分类 | 可以放入的内容 | 迁移规则 |
|---|---|---|
| A. 可烘焙 | BaseColor；固定肤色/发色乘色；固定 AO / 固定 mask；固定 Toon Ramp；不依赖相机、灯光、时间的固定组合 | 可生成新的纹理，但必须保留原 UV 和材质 index；不能烘焙当前视角高光。 |
| B. 可参数化迁移 | Roughness、Metallic、Normal、Emission、Toon Ramp、RMO 通道映射、V14D state mask / LayerA / LayerB / BlendWeight、各向异性方向/强度 | 作为材质 manifest 输入和 custom shader 输入；不要把随视角变化的结果固化成颜色。 |
| C. 不能烘焙 | Fresnel、视角相关 Specular、动态灯光、动态阴影、Anisotropy 产生的动态高光、当前相机下的发丝高光形状 | 保留为 Web shader / runtime lighting；本票禁止复现 Specular。 |

### 5.3 最小材质数据契约

每个材质至少需要：

```text
materialIndex + materialName
meshObject + faceRange/submesh
uvSet
baseColor (sRGB)
alpha/cutout policy
optional rmo (Non-Color; channel mapping is explicit)
optional normal (Non-Color; tangent convention is explicit)
optional toonRamp (role colorspace is explicit)
optional sphere (role colorspace is explicit)
optional hairSpec (Non-Color)
optional faceShadowStates[0..4] (Non-Color)
shaderVariant / graph id
```

其中 `materialIndex`、`mesh/submesh` 和 `uvSet` 是不可省略的绑定身份；不能仅用“白衣”“头发”等外观标签替代。

## 6. 建议 Texture Pack 与 manifest

建议包结构：

```text
koleda-v14d-material/
├─ material-manifest.json
└─ textures/
   ├─ basecolor/
   ├─ rmo/
   ├─ normal/
   ├─ toon/
   ├─ sphere/
   ├─ hair/
   └─ face-shadow/
      ├─ state-0/
      ├─ state-1/
      ├─ state-2/
      ├─ state-3/
      └─ state-4/
```

每个纹理条目必须声明 `role`、`path`、`colorspace`、`status` 和尺寸；RMO 通道必须声明具体语义；不存在或空图像必须使用 `declared-but-empty`，不能静默回退成 BaseColor。

禁止出现名为 `final-display-bake` 的生产输入：Blender 当前 AgX 画面不是材质 BaseColor，不能把相机下的高光、动态阴影或色调映射结果烘进 BaseColor。

机器可读草案见：

`C:\w\v14d-mat-verify\docs\handoff\koleda-v14d-material-manifest.json`

## 7. 颜色空间取证与“第一次分歧”结论

### 7.1 Blender 侧

Blender 5.1.1、场景 `Scene`、frame 120、EEVEE：

| 参数 | 实测值 |
|---|---|
| Display Device | `null`（当前证据没有读到有效字符串，不能猜） |
| View Transform | `AgX` |
| Look | `AgX - Medium High Contrast` |
| Exposure | `-0.56` |
| Gamma | `1.0` |
| World Color | `[0.0508761, 0.0508761, 0.0508761]` |

已加载的 BaseColor / 普通颜色纹理为 `sRGB`。RMO、Normal、Hair Spec、V14D Face Shadow state 为 `Non-Color`。`SSShine2.png` 为 `Linear Rec.709`，`SToon03.png` 为 `sRGB`。PMX 的 `skin.png` 在 Blender snapshot 中未作为图像节点载入，不能从当前 Blender 证据推断其 colorspace。

### 7.2 Web 侧

当前 `reze-engine@0.26.0` 的基本链路是：

```text
浏览器图像解码（colorSpaceConversion: "none"）
→ WebGPU rgba8unorm-srgb texture
→ shader 采样时的 sRGB → Linear 语义
→ Linear shader 运算 / HDR（现有诊断图不含灯光）
→ render target rgba8unorm-srgb
→ sRGB Canvas
```

诊断图没有手工重复 sRGB decode；否则会发生双重解码。

### 7.3 明确回答

当前证据可以**排除“Web 在 BaseColor 纹理绑定阶段就已经明显双重解码”**：Unlit 诊断使用现有 `rgba8unorm-srgb` 绑定，实际 Chrome WebGPU ready，且没有手工 decode。

但本票没有 Linear HDR readback，也没有把 Blender AgX 的 display transform 在 Web 侧逐项复刻。因此“Web 和 Blender 第一次开始不同”的精确级别**尚未被证明**。目前只能把差异起点缩小为：

```text
纹理 sRGB 语义之后的 shader / HDR 合成 / tone mapping / display transform
```

其中最优先怀疑的是 Blender 的 `AgX + Look + Exposure` 与当前 Web 输出链路不一致；这是待验证假设，不是 Gate B 通过结论。

## 8. reze-engine / MMD Web 能力盘点

读取版本：`reze-engine@0.26.0`。主要证据文件：

- `web/node_modules/reze-engine/dist/engine.js`
- `web/node_modules/reze-engine/dist/pmx-loader.js`
- `web/node_modules/reze-engine/dist/model.d.ts`
- `web/node_modules/reze-engine/dist/graph/schema.d.ts`
- `web/node_modules/reze-engine/dist/graph/style-group.d.ts`

| 能力 | 当前能力 | V14D 结论 |
|---|---|---|
| 每材质独立 BaseColor | 有；PMX `diffuseTextureIndex` 每材质绑定 | Hair / Skin / White Clothes 的 BaseColor PoC 无需 loader 改动 |
| Normal texture | 类型字段存在，但 basic PMX loader 固定 `normalTextureIndex=-1` | 完整 V14D 需要新增材质输入 |
| Tangent | 顶点渲染路径有切线相关能力，style graph 可扩展；但没有 V14D Hair Tangent/Anisotropy 材质契约 | 需要 custom shader 输入和切线异常复核 |
| Roughness / Metallic | 基础材质 uniform / style group 可承载参数 | RMO 通道映射需要新增 binding 或 graph 输入 |
| Toon texture / ramp | PMX loader 有 toon slot；engine 预留 toon binding，`ShaderGraph` 可扩展 | V14D 特殊 ramp / Face Shadow state 不能只依赖默认 PMX ramp |
| Sphere texture | PMX sphere slot 绑定存在，binding 3；`sphereMode=1/2` 支持 | `SSShine2` 的 Linear Rec.709 角色需要显式 colorspace 语义；当前有缺失路径 404 |
| Texture colorspace 配置 | 纹理创建统一使用 `rgba8unorm-srgb`；未发现按角色切换 colorspace 的基础契约 | Linear sphere / Non-Color mask 不能安全地全部复用 sRGB 纹理格式 |
| 单材质可扩展 texture 数 | 基础 bind group 已有 diffuse / material uniform / toon / sphere / style uniform；无任意纹理数组；graph 限制 `MAX_NODES=64`、`MAX_PARAMS=16` | RMO / Normal / state mask / Hair Spec 需扩展 material binding 或 shader 输入 |
| 是否需要 patch reze-engine | BaseColor Unlit PoC 不需要；完整 V14D 需要新增材质 binding / shader 输入 | 四选一结论：**需要新增 shader 输入** |
| 是否影响 PMX loader / VMD / Morph / Physics | 不影响；扩展边界在材质绑定和渲染 graph | 运行时动画链保持原样 |

## 9. 最小 PoC：Hair / Skin / White Clothes

### 9.1 实现

新增临时 query 参数：

```text
v14dUnlit=1
```

诊断 graph 名称：`V14D Material Unlit Diagnostic`。它只输出引擎已经绑定的 PMX diffuse texture，不引入灯光、法线、sphere、toon、Fresnel 或高光；默认不带该参数时生产路径不变。

材质组：

- `v14d-unlit-body-skin` → `BodySkin`
- `v14d-unlit-white-clothes` → `Cth1-Top`
- `v14d-unlit-hair` → `HairA`, `HairB`

修改文件：

- `web/src/app/mmd-calibration-render/page.tsx`
- `web/src/features/stage/MMDStage.tsx`
- `web/src/features/stage/RezeWebGpuStage.tsx`

### 9.2 实际浏览器证据

系统 Chrome headful WebGPU 页面使用：

```text
http://127.0.0.1:3100/mmd-calibration-render?modelUrl=<PMX URL>&renderPipeline=reze-k3&v14dUnlit=1
```

页面标记已确认：

```text
data-webgpu-status="ready"
data-webgpu-detail="WebGPU 已就绪 · 27 个 PMX 材质 · V14D Unlit 诊断"
data-v14d-unlit-graph="V14D Material Unlit Diagnostic"
data-v14d-unlit-groups="v14d-unlit-body-skin,v14d-unlit-white-clothes,v14d-unlit-hair"
data-v14d-unlit-unknown-materials=""
```

截图证据：

- `C:\w\v14d-mat-verify\docs\handoff\evidence\koleda-v14d-unlit-ready.png`
- `C:\w\v14d-mat-verify\docs\handoff\evidence\koleda-v14d-frame120-vmd-early.png`
- `C:\w\v14d-mat-verify\docs\handoff\evidence\koleda-v14d-frame120-vmd-late.png`

结果：三个目标材质组均成功命中，Unlit 画面没有复现白袖/胸口 RGB 彩点，也没有观察到明显双重 sRGB decode。这个结果证明“现有 PMX diffuse 绑定 + style group 诊断图”可用于材质迁移第一阶段；它不证明最终 PBR / Toon / V14D Face Shadow 的像素一致。

## 10. Gate A / Gate B

### Gate A — Render Integrity

状态：**未通过 / 未完成**。

- Unlit PoC 未复现 RGB 彩点。
- 尚无 NaN/Inf 的 GPU readback 证据。
- 尚未完成静止 frame120 连续捕获的随机闪烁统计。
- 尚未执行完整诊断矩阵：`BaseColor/Unlit → Normal 可视化 → Diffuse-only → PBR no specular → Specular-only → HDR pre-tonemap → Final`。
- 因此不能报告彩点第一次出现于哪一级，也不能排除生产路径仍存在彩点。

### Gate B — Color Baseline

状态：**未完成**。

缺失：

- Hair / Skin / White Clothes 的可靠 ROI 定义与像素采样；
- BaseColor、Linear HDR、Final Display 三级 readback；
- Blender 对应 ROI 的线性值和 Web tone mapping 对照；
- 误差阈值与连续帧统计。

当前只能报告链路级结果，不能报告三材质颜色误差数值。

## 11. VMD 完整性边界

权威 VMD：

- 文件长度：5,980 bytes
- SHA-256：`2536c886029af068878c674bf749a409fccaa3cad519fbcde4233bd7c3b3394d`
- 骨骼帧：53，全部 frame 120
- Morph 帧：1，名称 `まばたき`，frame 120，权重 1

浏览器已确认：

```text
data-webgpu-status="ready"
data-active-vmd-url="http://127.0.0.1:3200/koleda-v14d-authoritative-pose-f120.vmd"
```

已确认 VMD 请求、模型加载和 WebGPU 渲染没有因 Unlit 材质诊断失败。截图在播放启动后的约 2.5 秒和 4.3 秒捕获，不能作为精确 frame 120 数值证明。未完成项：

- 精确 frame 120 的 Skeleton 骨骼变换 readback；
- `まばたき=1` 的 Morph runtime 权重 readback；
- Physics settle / rigid body 状态；
- Mesh pose 与材质 assignment 的逐项对照；
- 材质切换前后的 VMD / Morph / Physics 不变量自动断言。

## 12. 推荐架构与后续验收顺序

推荐保持：

```text
原 PMX
  + 原 VMD / Morph / Physics
  + V14D material-manifest.json
  + BaseColor / RMO / Normal / FaceShadow / Toon / HairSpec texture pack
  + Web custom shader / style graph
```

实现顺序：

1. 先把 27 个 material index 和 UVMap 绑定固化为 manifest contract。
2. 先完成 BaseColor + alpha/cutout 的线性采样和 ROI readback。
3. 加入 RMO / Normal / Toon / Sphere 的显式 colorspace 与 channel mapping。
4. 加入 Face Shadow state 选择、LayerA/LayerB/BlendWeight。
5. 最后再处理 Hair Tangent / Anisotropy 等视角相关项；不得用当前视角烘焙替代。
6. 每一步都重跑精确 frame120 的 Skeleton / Morph / Physics / Mesh pose / Material assignment Gate。
7. Gate A 必须先定位 RGB 彩点首次出现阶段，再决定是否进入生产 shader 修复票据；本票不修复彩点本身。

## 13. 实际命令与结果

已执行并成功：

```powershell
cd C:\w\v14d-mat-verify\web
npm ci
```

结果：安装成功，`reze-engine=0.26.0`。

已执行的 Blender / PMX 审计：

```powershell
blender -b -P C:\w\v14d-mat-verify\docs\handoff\evidence\blender_headless_audit.py
```

结果：headless 读取 V14D `.blend` 并输出审计 JSON；未写入权威 Blender。

已执行的 WebGPU 临时验证：

```powershell
node ./scripts/run-next.mjs dev -H 127.0.0.1 -p 3100
node .scratch\static-server.mjs .scratch\koleda-assets 3200
```

结果：系统 Chrome headful WebGPU ready；Playwright Chromium headless 没有 WebGPU adapter，因此不作为 WebGPU 证据。

已知非本票基线问题：

- `npm run check:basic` 失败于既有断言仍要求 `/applySceneSettings\(initialSettings\)/`，源码实际为 `applySceneSettings(settingsRef.current)`；未为此票修复。
- `npx tsc --noEmit --pretty false` 失败于既有 `tests/e2e/app-routes-smoke.spec.ts` 中 3 处 `Window.__speechCancelCount` 类型错误；未为此票修复。

## 14. 交付文件

- 本报告：`C:\w\v14d-mat-verify\docs\handoff\2026-08-26-koleda-v14d-material-verify.md`
- 材质清单草案：`C:\w\v14d-mat-verify\docs\handoff\koleda-v14d-material-manifest.json`
- Web PoC：`web/src/app/mmd-calibration-render/page.tsx`、`web/src/features/stage/MMDStage.tsx`、`web/src/features/stage/RezeWebGpuStage.tsx`
- 审计证据：`docs\handoff\evidence\blender_headless_audit.json`、`docs\handoff\evidence\pmx_audit.out.json`、`docs\handoff\evidence\blender_mcp_key_evidence.json`
- 截图证据：`docs\handoff\evidence\koleda-v14d-unlit-ready.png`、`docs\handoff\evidence\koleda-v14d-frame120-vmd-early.png`、`docs\handoff\evidence\koleda-v14d-frame120-vmd-late.png`
