
# V14D 全身皮肤 State 2 实时合成（固定帧）

- 中文名称：V14D 全身皮肤 State 2 实时合成（固定帧）
- 英文机器名：\`v14d-body-skin-state2\`（契约 / contract id）
- 票据：Stage 2B-M3（\`codex/v14d-body-skin-state2\`），修正轮（同 failure family 第一次修正）
- 状态：**视觉预览范围扩展（checkpoint）**——BodySkin 实时合成已接线、脖子/双手四区域独立数值
  Gate 通过（候选阈值），但腰部在 frame120 叉腰姿势下被长袖/手臂全角度遮挡（真实几何），
  无可视样本，诚实标记 occluded。**不是**完整 V14D/Face Gate 已通过。

## 概念定义

在 \`/mmd-calibration-render?v14dFaceStatic=1&v14dFaceMode=finalFaceComposite\` 诊断入口下，
把「只接入 Face 材质」扩展为「Face + BodySkin 同一 V14D skin family」：脖子、腰部露肤、
左右手/手指与脸部采用同一套线性色彩处理、warm skin tint、显示变换与材质响应。
身体区域**不套**脸部专用 State2 packed mask（该 mask 是脸部 UV 数据，禁止按票据直接套到
BodySkin UV）；按 Blender 权威取证，BodySkin 无离散阴影 mask，身体是
「body_d 线性 × 身体 warm=[1,0.945,0.905]」直出。

## 解决的问题

初版只把 Face 材质接入 V14D State2 实时合成，脖子/腰/手等可见皮肤与脸部肤色、明暗、质感
不统一。本概念把 BodySkin 切到与 Face 同 family 的实时合成 graph，使全身预览时肤色统一。

## 权威来源（全部来自 .blend 取证，不手调 RGB）

- 权威 Blender：\`Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend\`（sha256 \`1139617c…53cd4\`）。
- BodySkin 材质：\`PROTO_GF2_BodySkin\`；唯一扩散纹理 \`body_d.png\`（sRGB，1024×1024，
  源 sha256 \`5c4b02f3…abadc9\`）。
- 身体 warm 常量：PROTO_FaceWarm Color2 = **[1, 0.945, 0.905]**（与 Face 的 [1, 0.935, 0.89] **不同**，禁止复用）。
- BodySkin **无**离散阴影 mask（hasDiscreteShadowMask=false）；身体分支用「body_d × warm」等价分支。
- 手指/手背皮肤、脖子、腰/腹部露肤均由同一 BodySkin 材质承载。

## 适用与不适用

- 适用：\`v14dFaceStatic=1&v14dFaceMode=finalFaceComposite\` 固定 frame120 全身皮肤预览与
  四区域（neck/waist/leftHand/rightHand）独立数值对账。
- 不适用：生产默认 Reze K3 行为（本概念默认关闭）；五档状态、动态阴影、身体专用离散 mask
  （Blender 无此数据）；把白衣/头发/眼睛归入皮肤。

## 核心不变量

- 只在 \`v14dFaceStatic=1\` 诊断入口生效；生产默认 Reze K3 行为不变。
- BodySkin 按已取证材质名绑定（loadModel 阶段注入），不是 loadModel 后伪改 path。
- Face 继续应用 State2 packed mask；BodySkin 用身体分支（body_d × warm），不套脸部 mask。
- 不修改 PMX/VMD/骨骼/权重/Morph/IK/Grant/Physics/播放时钟/VMD 插值/拓扑/材质槽。
- \`bodyApplied\` 必须来自引擎真实 draw-call/material graph 状态（组诊断 ok 且实际绑定
  graph.name === "V14D Body Skin Composite"），不是「faceResult.ok && 材质存在」的自证。

## 证据与计算口径

- 取证 manifest：\`.scratch/v14d-body-skin-state2/forensic/bodyskin-manifest.json\`
  （脚本 \`web/scripts/forensic-v14d-bodyskin-state2.py\`）。
- Blender 三角形质心（frame120 应用 VMD）：\`.scratch/v14d-body-skin-state2/probe/blender-body-tris.json\`
  （3671 个 BodySkin 三角形世界质心，米制→PMX 单位换算 /0.08）。
- 四区域 Gate：\`web/scripts/gate-v14d-body-skin-state2.mjs\` → \`.scratch/v14d-body-skin-state2/gate/gate-report.json\`。
- 区域划分：BodySkin 三角形蒙皮后世界质心按 \`V14D_BODY_SKIN_REGIONS\`（世界 y 带 + x 符号）
  分区，映射回屏幕像素（triId per pixel + pick mask 前景）；非逐像素对齐（Web/Blender frame120
  姿态差已证），口径=材质级常量（body_d×warm）+ 区域语义分区。

## 正例 / 反例

- 正例：finalFaceComposite 下 BodySkin 绑定 "V14D Body Skin Composite" graph，
  neck/leftHand/rightHand 区域 HDR 线性均值与 body_d×warm 参考逐通道 MAE ≤ 候选阈值，
  \`v14dBodySkinGraph="V14D Body Skin Composite"\`、\`v14dBodySkinGroupOk=true\`。
- 反例：bodyApplied 用 faceResult.ok && 材质存在自证；漏绑 BodySkin；BodySkin 错绑 Face graph；
  把 HairA 当 BodySkin；waist 被遮挡时软通过（应诚实标记 occluded/checkpoint）。

## 相关 Gate 与失败路线

- Gate：\`web/scripts/gate-v14d-body-skin-state2.mjs\`（四区域独立数值 + 真实 graph 绑定 + 负测）。
- 负测：\`web/scripts/gate-v14d-body-graph-negative.mjs\`（漏绑/错 graph/错材质 → 核对失败）。
- 失败路线：某区域样本不足 → 诚实标记 occluded 并 exit 3（checkpoint），不得软通过；
  graph 绑定证据不符 → exit 1（fail）。

## 二次修正（同 failure family 最后一次修正）

### 同 UV 逐像素区域参考（替代整图均值）

初修四区域参考曾用整块 body_d×warm 全材质均值 `bodyDMeanLinear` 冒充区域参考（违反
验证承诺边界）。本修正改为每个正式 Web 像素带 triId+UV，在 body_d 同 UV 采样 × 身体
warm=[1,0.945,0.905] 得到逐像素参考，逐区域聚合出 refLinear/refSamples/逐像素 MAE/P95；
blenderTris 仅用于分区与质心定位，不再作为颜色参考。Face 补齐五区域统一 schema（区域定义/
有效 mask/coverage/同 UV 参考 refLinear/refSamples/逐通道 MAE/P95/状态），参考口径为
face_d×Face warm=[1,0.935,0.89] 基色×warm（不含脸部专用 State2 art/fringe）。waist 被遮挡时
保持 samples=0/status=occluded/checkpoint，不软通过。

### draw-call 级绑定证据与真实运行时负测

`bodyApplied` 不再只读 getStyleGroups 配置。引擎新增
`exportBodySkinDrawBinding()`（读 modelInstances→drawCalls→styleGroups→graph.name/pipeline），
dataset 暴露 `v14dBodySkinDrawCalls`/`v14dBodySkinDrawOnComposite`；Gate 核对每个 BodySkin
draw call 的实际 graph.name 与 pipeline 命中 "V14D Body Skin Composite"。负测改为真实浏览器
运行时 fault injection（URL 参数 `v14dBodyFault`=missing/wrongGraph/wrongMaterial，默认关闭）：
漏绑/错 graph/错材质 HairA 三种场景 Gate 均非零，正确绑定才为零。
`web/scripts/gate-v14d-body-graph-negative.mjs` 保留为静态辅助核对（不再作为正式负测）。
