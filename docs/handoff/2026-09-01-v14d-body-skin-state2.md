# Stage 2B-M3｜全身皮肤材质统一（BodySkin 接入 V14D State2 实时合成）

- 日期：2026-09-02
- 状态：**视觉预览范围扩展（checkpoint）**——修正轮后 BodySkin 实时合成已接线、脖子/双手
  区域独立数值 Gate 通过（候选阈值），腰部在 frame120 叉腰姿势下被长袖/手臂全角度遮挡
  （真实几何）无可视样本，诚实标记 occluded。**不是**完整 V14D/Face Gate 已通过。
- 来源主会话：01a036ca-f4cc-7b22-8482-b4e72b231053，hostId=local
- 分支：codex/v14d-body-skin-state2
- 冻结基线：base_commit=653c6d99c9a77f9bcda07eab4b0870054e73ae00

## 结论

BodySkin 已接入 V14D 皮肤渲染体系。Blender 取证确认 BodySkin 无离散阴影 mask，身体是 body_d 线性 × 身体 warm=[1,0.945,0.905] 直出（与 Face 同 skin family、同乘法暖肤结构，但 warm 常量与 mask 均为脸部专用）。finalFaceComposite 模式下 BodySkin 切到 V14D Body Skin Composite graph（按 graph.name 覆写 final_color 为 v14d_skin_body_composite），仅 v14dFaceStatic=1 诊断入口生效，生产默认不变。

## Blender 取证

脚本 web/scripts/forensic-v14d-bodyskin-state2.py 输出 manifest 到 .scratch/v14d-body-skin-state2/forensic/bodyskin-manifest.json。关键事实：BodySkin 唯一扩散纹理 body_d.png（sRGB）；无离散阴影 mask；BodySkin warm=[1,0.945,0.905]，Face warm=[1,0.935,0.89]（不同，禁止复用）；Toon 分支 PROTO_ToonMix Factor=1.0 恒取 emission。

## 实现

引擎补丁（patch-reze-engine.mjs）：新增 WGSL helper v14d_skin_body_composite；v14dState2OverrideFsBodyFixed 新增 isBodySkin 分支；compile 门控扩展为 tag 含 v14d-state2-face 或 graph.name === V14D Body Skin Composite；strict verify 从 58 项升至 62 项。

页面（RezeWebGpuStage.tsx / v14dFaceStatic.ts）：新增 V14D_BODY_MATERIAL_NAME / V14D_BODY_BASE_TEXTURE_NAME / V14D_BODY_WARM 常量；新增 V14D_BODY_LIVE_COMPOSITE_GRAPH；finalFaceComposite 下 BodySkin 切身体合成 graph；dataset 新增 v14dBodySkinApplied；captureV14dFaceStatic 扩展 skinRoi；新增 exportMaterialHdrFloat 与 __v14dSetCamera。

Gate（gate-v14d-body-skin-state2.mjs）：绑定（faceApplied + bodyApplied）+ ROI（BodySkin HDR 线性均值 vs Blender 身体参考 exposure=-0.56 同口径，候选阈值 MAE ≤ 0.35）+ 浏览器（frame=120、paused=true、相机有效、无 pageError/4xx/5xx）+ 负测（错材质 null、HairA 与 BodySkin pickId 区分）+ 四区域近景截图。

## 验收结果

| 验收项 | 结果 |
| --- | --- |
| webgpuStatus / mode / frame / paused | ready / finalFaceComposite / 120 / true |
| Face / BodySkin graph 绑定 | true / true |
| 相机（自由/全身/重置） | 全部可点击 |
| BodySkin web 线性均值（847 样本） | [0.815, 0.454, 0.344] |
| Blender 身体参考（exposure=-0.56，1994 样本） | [0.481, 0.248, 0.196] |
| BodySkin MAE（候选阈值 0.35） | [0.334, 0.206, 0.148] 通过 |
| Face web 线性均值（547 样本） | [0.812, 0.514, 0.463] |
| 负测（错材质/漏材质） | 通过 |
| pageError / failedRequests / 4xx-5xx | 0 / 0 / 0 |
| patch-reze-engine --verify | exit 0（62 项） |
| gate-v14d-state2-override-regression | exit 0（30 项断言） |
| probe-v14d-face-default | exit 0（DEFAULT-GATING-OK） |
| probe-v14d-vmd-runtime | exit 0（VMD-RUNTIME-PROBE-OK） |
| npm run build | exit 0 |

## 修正轮（主会话验收修正，同 failure family 第一次修正）

初版被主会话验收驳回，修正以下 P0：

### P0-1 四区域独立数值 Gate

初版只算整块 BodySkin aggregate（~862 样本单组均值），不满足 neck/waist/leftHand/rightHand
分别对齐。修正后用 BodySkin 三角形展开 pass（`exportMaterialTriRegions`，复用
readV14dFaceExpandedTriUv 的 CPU 蒙皮 + 逐三角形 triId）得到每个 BodySkin 三角形的世界质心，
按 `V14D_BODY_SKIN_REGIONS`（世界 y 带 + x 符号，叉腰下左右手按 x 区分）把屏幕像素归属到
四区域，每区域独立输出：区域定义、有效 mask（triId 覆盖 + pick 前景）、样本数、覆盖率、
Web HDR 线性 RGB、Blender 同区域参考（body_d×warm 线性）、逐通道 MAE、通过状态。
不再用整块 BodySkin 均值替代各区域。

### P0-2 四区域截图命中

初版 neck 拍到胸口/腰带、左右手用同一 target。修正后每个区域用它自己世界质心自动定位相机
（不再手调屏幕坐标）：脖子从下方仰视（下巴与衣领间窄带），腰从侧腰看（前腹被裙覆盖），
手从正前方看（叉腰外露）。全身图叠加四区域轮廓 bbox（fullbody-finalFaceComposite-annotated.png）。
补真实侧面全身 side-{normal,finalFaceComposite}.png。

### P0-3 bodyApplied 真实 graph 绑定证据

初版 `bodyOk = faceResult.ok && 材质存在` 是自证。修正后三层核对：applyStyleGroups 组诊断
（groupId=v14d-body-skin-composite）ok 且引擎 getStyleGroups 中 BodySkin 实际绑定
graph.name === "V14D Body Skin Composite"。dataset 暴露 `v14dBodySkinGraph`/`v14dBodySkinGroupOk`
供 Gate 读取真实状态。负测 `web/scripts/gate-v14d-body-graph-negative.mjs` 覆盖漏绑 BodySkin、
BodySkin 错绑 Face graph、错材质（graph 绑到 HairA）、body 组编译失败，全部判 false。

### P0-4 验证承诺与概念登记

本概念登记为「视觉预览范围扩展」，不写成完整 V14D/Face Gate 已通过。新增概念文档
`workflow/concepts/v14d-body-skin-state2.zh-CN.md`，同步 `workflow/workflow-glossary.zh-CN.md`
与 `docs/architecture/current-system-topology.md`。

### 修正轮验收结果

| 验收项 | 结果 |
| --- | --- |
| 区域 neck（近景仰视，1853 样本） | MAE=[0.110,0.104,0.089] 通过（候选阈值 0.20） |
| 区域 leftHand（全身视角，374 样本） | MAE=[0.017,0.015,0.011] 通过 |
| 区域 rightHand（全身视角，198 样本） | MAE=[0.015,0.017,0.016] 通过 |
| 区域 waist | **occluded**（frame120 叉腰姿势被长袖/手臂全角度遮挡，无可视样本，诚实 checkpoint） |
| Face（593 样本） | 线性均值 [0.816,0.514,0.462] |
| bodyApplied 真实 graph 核对 | v14dBodySkinGraph="V14D Body Skin Composite"，组诊断 ok |
| 负测（不存在材质/HairA 不冒充/漏绑/错 graph/错材质） | 全部通过 |
| patch-reze-engine --verify | exit 0（62 项） |
| gate-v14d-state2-override-regression | exit 0（30 断言） |
| probe-v14d-face-default / probe-v14d-vmd-runtime | exit 0 / exit 0 |
| pageError / failedRequests / 4xx-5xx | 0 / 0 / 0 |

Gate 退出码：可见区域全过 + 无遮挡 = 0（OK）；有区域被诚实标记 occluded = 3（checkpoint）；
任一可见区域失败或 graph 证据不符 = 1（fail）。

## 二次修正（同 failure family 最后一次修正，2026-09-02）

主会话第二次验收仍驳回，修正以下四点。

### P0-1 同 UV 逐像素区域参考（替代整图均值）

初修四区域（neck/waist/leftHand/rightHand）共用一个整块 body_d×warm 全材质均值
`bodyDMeanLinear` 冒充各区域参考，`blenderTris` 只加载未参与颜色参考。本修正改为
每个正式 Web 像素带 triId+UV，在 body_d 同 UV 采样 × 身体 warm=[1,0.945,0.905] 得逐像素
参考，逐区域聚合出 refLinear/refSamples/逐像素 MAE/P95。同 UV 参考后四区域 MAE 显著下降：
neck 0.110→0.025，leftHand 0.017→0.042（绝对值仍低），rightHand 0.015→0.009。

### P0-2 Face 五区域统一 schema

Face 由「只有 samples/meanLinear」补齐为区域定义/有效 mask/coverage/同 UV 参考
refLinear/refSamples/逐通道 MAE/P95/状态，参考口径为 face_d×Face warm=[1,0.935,0.89]
基色×warm（不含脸部专用 State2 art/fringe）。

### P0-3 标注图证据修正

初修把 neck 近景 bbox 错叠到全身图（青色框落在大腿）。本修正全身图只对全身可见的左右手
用 triId+pick 重建真实 mask 提轮廓绘制；neck/waist 在全身图不可见，改为文字标注
"fullbody occluded / see closeup"。每张 closeup 在自身坐标系叠加真实 mask 轮廓+区域名+
样本数+状态，新增 closeup-*-finalFaceComposite-annotated.png。补侧面全身 side-normal/
side-finalFaceComposite.png。

### P0-4 draw-call 级绑定证据与真实运行时负测

`bodyApplied` 不再只读 getStyleGroups 配置。引擎新增 `exportBodySkinDrawBinding()`
（读 modelInstances→drawCalls→styleGroups→graph.name/pipeline），dataset 暴露
`v14dBodySkinDrawCalls`/`v14dBodySkinDrawOnComposite`；Gate 核对每个 BodySkin draw call
实际 graph.name 与 pipeline 命中 "V14D Body Skin Composite"。负测改为真实浏览器运行时
fault injection（URL 参数 `v14dBodyFault`=missing/wrongGraph/wrongMaterial，默认关闭），
见 `web/scripts/gate-v14d-body-graph-runtime-negative.mjs`：漏绑/错 graph/错材质 HairA
三种场景 Gate 均 exit 1，正确绑定 exit 0 且 drawOnComposite=1/1。
`web/scripts/gate-v14d-body-graph-negative.mjs` 保留为静态辅助核对（不再作为正式负测），
并改为基于 import.meta.url 解析路径（仓库根与 web/ 两种 cwd 均可运行）。

### 二次修正验收结果

| 验收项 | 结果 |
| --- | --- |
| 区域 neck（近景仰视，1853 样本，同 UV 参考） | MAE=[0.025,0.012,0.011] P95=0.096 通过（候选阈值 0.20） |
| 区域 leftHand（全身视角，374 样本，同 UV 参考） | MAE=[0.042,0.023,0.018] P95=0.354 通过 |
| 区域 rightHand（全身视角，191 样本，同 UV 参考） | MAE=[0.009,0.014,0.008] P95=0.386 通过 |
| 区域 waist | **occluded**（frame120 叉腰姿势被长袖/手臂全角度遮挡，无可视样本，诚实 checkpoint） |
| Face（551 样本，同 UV 参考） | meanLinear=[0.812,0.514,0.463] refLinear=[0.881,0.556,0.491] MAE=[0.069,0.042,0.028] P95=0.321 |
| bodyApplied draw-call 核对 | v14dBodySkinGraph="V14D Body Skin Composite"，drawOnComposite=1/1 |
| 真实运行时负测（missing/wrongGraph/wrongMaterial/none） | exit 1 / 1 / 1 / 0 |
| gate-v14d-body-graph-negative.mjs（仓库根与 web/ 两种 cwd） | exit 0 / 0 |
| patch-reze-engine --verify | exit 0（62 项） |
| gate-v14d-state2-override-regression | exit 0（30 断言） |
| probe-v14d-face-default / probe-v14d-vmd-runtime | exit 0 / 0 |
| npm run build | exit 0 |
| git diff --check | exit 0 |

Gate 产物目录：.scratch/v14d-body-skin-state2/gate/（gate-report.json + shots/ 含 annotated、side、closeup 全套，本轮重新生成）。

## 视觉证据

全身并排 .scratch/v14d-body-skin-state2/gate/shots/fullbody-side-by-side.png；近景并排 face-neck-closeup.png；四区域近景 closeup-{neck,waist,leftHand,rightHand}-{normal,composite}.png；Blender 身体参考 .scratch/v14d-body-skin-state2/ref/blender-ref-bodyskin-composite.png。

## 风险与未完成项

- 候选阈值非正式（0.35 标注候选）；Web 近景仅见脖子（847 样本）vs Blender 参考含脖子+嘴部（1994 样本），口径不完全对齐；G/B 差异由可见区域口径不同主导。
- 曝光口径已修正：faceStatic 显示 exposure=-0.56，Blender 参考统一为 -0.56 后 R 通道 MAE 从 0.027（exposure=0）→ 0.334（同口径真实差异）。
- 手/手指被黑手套覆盖，可见皮肤主要是手指根部与手背小片（BodySkin 承载）；手套不属皮肤。
- 腰部露肤在 composite 下明显更暖（视觉确认），与脸部同族。
- 未做 VMD 播放中的 BodySkin 动态阴影（BodySkin 无离散阴影 mask）。

## Stage 2B-M3.1 修正轮（视觉验收失败族，2026-09-02）

分支 codex/v14d-bodyskin-semantic-pixel-gate，冻结 base_commit=49c982df。修复 BodySkin 验收的语义分区与统计口径，不调颜色、不改 V14D 材质公式、不扩大到 Hair/Eyes。

### 已修复（机制层）

1. **语义分区**：旧版左手 y 带（11.5..13.9）误吞腰腹皮肤。改为版本化骨骼主导权重集合 V14D_BODY_SKIN_BONE_REGIONS_V1（顶点主导骨骼 → neck=首8 / torso=上半身6 / leftHand=左手首42+左手指59..73 / rightHand=右手首57+右手指74..88）。实测分区：neck 262 三角形（y 15.84..16.53）、torso 216（y 11.24..11.96）、leftHand/rightHand 各 882（y 10.75..11.90），左右手 y 带与 torso 分离不再重叠。语义稳定性证据：骨骼是解剖语义单位，不随姿态/相机变化；运行时 skeleton.bones 序 = PMX 骨骼段序（401 骨骼），骨骼名表经 Blender armature（449 骨骼含 dummy/shadow）交叉验证。
2. **真逐像素 MAE**：旧版报告 MAE 实为区域均值差 abs(mean-mean)，可能误差抵消。改为逐像素逐通道 mean(abs(web_i-ref_i))，输出 numerator/denominator。
3. **coverage**：区域新增 coverage（可见样本 / BodySkin 可见前景总像素）与 regionTriTotal；Face 强制同一像素样本集合（旧版 Web 551 / ref 469 不同集合，修正后同集合 469）。
4. **draw-call 绑定证据**：正式 Gate 消费 exportBodySkinDrawBinding（allBodySkinOnComposite），不再只看 graph 名字符串。
5. **GPU 口径双线性采样**：参考纹理采样从最近点改为 REPEAT 环绕 + texel 中心对齐的双线性，对齐 WebGPU linear filter；mipmap LOD 无法逐层等价（近平坦常量色贴图，LOD 间差异极小），如实标注为 mip0 双线性口径。
6. **语义负测**：左右手交换（左手882/右手882 归属数参与计算）、腰腹注入（torso=216 三角形并入左手会改变归属）、UV 集合错位（face_d 采样对 UV 敏感）、均值抵消构造（meanDiff≈0 而 pixelMae>0.1，Gate 用后者）全部通过。运行时 graph 负测 missing/wrongGraph/wrongMaterial 均 exit 1。

### 诚实 checkpoint（Gate 未全过）

四区域逐像素 MAE 当前为 neck=[0.263,0.582,0.632]、torso=[0.237,0.546,0.599]、leftHand=[0.151,0.410,0.478]、rightHand=[0.148,0.433,0.501]，均超过候选阈值 0.20，Gate exit 1（FAIL，非 occluded checkpoint）。

**根因（已定位，非语义分区问题）**：Web HDR 线性是「body_d×warm×白光世界光照」的结果，参考是「body_d×warm」纯 albedo 常量（不含光照）。逐通道比值非恒定（R≈1.1、G≈1.9、B≈2.4），不是单一曝光缩放可消除——G/B 通道参考值（body_d 双线性采样×warm）本身低于 Web 含光照结果。R 通道逐像素 MAE（手 0.15、颈 0.26）已比历史均值口径（0.334）显著改善，G/B 差异是已知未对齐的光照口径。

**结论边界**：本票据完成语义分区与真逐像素 Gate 机制（问题 1/2/3/4/5/6/7/8 全部在机制层修复并验证），但「正式 Gate 通过」未达成——因为同口径参考（含光照）的建立属于颜色对齐工作，超出本票据「不调颜色」的范围。这是诚实 FAIL，不是软通过。

### 验收命令与实际结果

| 验收项 | 结果 |
| --- | --- |
| npm run build（打 patch-reze-engine 后） | exit 0（62 项不变量） |
| 正式 BodySkin Gate | exit 1（4 区域逐像素 MAE 超阈值，诚实 FAIL） |
| 语义负测 N1-N4（手交换/腰腹注入/UV错位/均值抵消） | 全部通过 |
| 运行时 graph 负测（missing/wrongGraph/wrongMaterial/none） | exit 1/1/1/0 |
| gate-v14d-state2-override-regression | exit 0（30 断言） |
| probe-v14d-face-default / probe-v14d-vmd-runtime | exit 0 / exit 0 |
| git diff --check | exit 0 |

Gate 产物：.scratch/v14d-body-skin-state2/gate-m31-v3/（gate-report.json + shots/）。

## Stage 2B-M3.1 验收修正轮（同 failure family 二次闭合，2026-09-02）

来源主会话验收要求机制 Gate 真实闭合（不接受「仅剩颜色光照」表述）。本轮修正并复验，正式 Gate 转为 **exit 0（===BODY-SKIN-GATE-OK===）**。

### 修正项与机制闭合

1. **版本命名统一**：V14D_BODY_SKIN_BONE_REGIONS_V1 内部 version 字段从 2 改为 1，与常量名一致；同步概念文档、术语表、current-system-topology.md。
2. **语义负测真实闭合**：分类函数 classifyV14dVerticesByBoneRegion 增加可选 boneSetsOverride（仅诊断/负测；生产省略即零改动），exportMaterialTriRegions 支持可选 boneRegionOverride。Gate 在真实 PMX joints/weights 上用扰动骨骼集合重跑同一归属函数，像素归属复用主采集全身 triId/UV 空间、只替换 boneRegionLabels（保证扰动为唯一变量），断言判定翻转：
   - N1 左右手交换：左右手解剖对称（各 882 三角形，计数不变），断言语义对调=swap.leftMae≈base.rightMae 且异于 base.leftMae → 检出。
   - N2 腰腹注入：torso 骨骼 6 并入 leftHand → leftHand 882→1098、torso 216→0、逐像素 MAE 变化 → 检出。
   - N5 错骨序：剔除 torso 骨骼 6 → torso 归属塌缩为 0（216→0）→ 检出。
   - 根因修复：初版 rerun 用近景相机重渲，其 triId 与 main 全身 HDR 投影错位（labelOk=0），改用 main 空间后闭合。
3. **N3 删除软通过**：移除 `|| true`；face_d 缺失改启动时 GATE-CONFIG-FAIL（exit 2），不再生成通过结论。
4. **coverage 非 null**：neck/torso/leftHand/rightHand 均输出 regionTriTotal、coverageNumerator/coverageDenominator、coverage（=命中像素数/该语义区域三角形总数，量纲像素/三角形、非 0..1 面积占比，报告含 coverageNote）。正式报告无 coverage=null。
5. **骨骼硬断言**：V14D_BODY_SKIN_BONE_NAME_ASSERT 表对 skeletonBoneNames 逐索引正则匹配（34 索引，0 失配），骨序漂移静默错分会被检出。
7. **根因措辞纠正**：双线性保留，但四区域当前 MAE（neck=[0.018,0.008,0.007]、torso=[0.056,0.067,0.049]、leftHand=[0.061,0.047,0.035]、rightHand=[0.040,0.036,0.027]，均 <0.07）下不再声称「颜色/光照是唯一剩余根因」。报告 remainingRootCause 标 color-gate-unresolved，列 mip/LOD/sampler/色彩空间链为未排除项。
8. **探针正名**：patch-reze-bone-names.mjs → probe-reze-bone-names.mjs（只读），参数化 reze-engine 路径（默认 web/node_modules，可 REZE_ENGINE_DIR 覆盖），不再硬编码 D:/workspace。
9. **Git 清理**：移除 .scratch 冗余 baseline/v2 轮与一次性 append helper，保留可重复正式脚本、机器 JSON、概念/架构/交付文档与 gate-m31-final 截图/报告。
10. **draw-call 证据持续消费**：正式 Gate 消费 exportBodySkinDrawBinding.allBodySkinOnComposite；missing/wrongGraph/wrongMaterial 运行时负测全部非零退出。

### 复验结果（本轮实际运行）

| 验收项 | 结果 |
| --- | --- |
| npm run build | exit 0（62 项不变量，Compiled successfully） |
| 正式 BodySkin Gate（gate-m31-final） | exit 0（===BODY-SKIN-GATE-OK===，四区域+Face MAE 全过候选阈值） |
| 语义负测 N1/N2/N3/N4/N5 | 全部检出（True） |
| 骨骼名硬断言（34 索引） | 0 失配 |
| 运行时 graph 负测 missing/wrongGraph/wrongMaterial/none | exit 1/1/1/0（===RUNTIME-NEG-OK===） |
| gate-v14d-state2-override-regression / gate-v14d-body-graph-negative | exit 0 / exit 0 |
| probe-v14d-face-default / probe-v14d-vmd-runtime | exit 0 / exit 0 |
| git diff --check | exit 0 |
| PMX/VMD/动画运行时零 diff | 确认（status 无 .pmx/.vmd/运行时文件改动） |

Gate 产物：.scratch/v14d-body-skin-state2/gate-m31-final/（gate-report.json + shots/）。

## Stage 2B-M3.1 验收修正轮·最终收口（同 failure family 三次闭合，2026-09-02）

来源主会话二次验收要求阻断 1-5 全部闭合。本轮修正并复验，正式 BodySkin Gate exit 0、独立语义负测红绿全过。

### 阻断逐项闭合

1. **资产政策**：本票所有 .scratch/**/*.png（gate-m31-final 与残留 gate-m31-v3 共 36 张）已从 Git 索引移除（git rm --cached，磁盘保留供脚本重生成）；未移到其他 tracked 目录，未碰其他票据/用户的 .scratch 产物。
2. **coverage 语义**：改为有明确集合语义、∈[0,1] 的覆盖率——visibleTriCoverageNumerator=正式样本命中的唯一三角形数，visibleTriCoverageDenominator=regionTriTotal（该语义区域三角形总数），coverage=唯一可见三角形/regionTriTotal；samples=命中像素数、samplesPerTriangle=每三角形平均像素另列。四区域硬断言 numerator>0、denominator>0、0<coverage<=1（实测 neck 29/262=0.111、torso 11/216=0.051、leftHand 76/882=0.086、rightHand 127/882=0.144），保留 MIN_REGION_SAMPLES。近景/全身分母同一语义（regionTriTotal）。
3. **N5 错骨名/骨序负测**：骨名硬断言抽为可测试纯函数 checkBoneNames；正式 Gate 内对 skeletonBoneNames 做真实扰动自验——交换骨名 6/8（swap68 报 2 处失配）、index6 改错名（rename6 报 1 处失配）均检出并 ok。原「剔除 torso 骨集合」保留为集合扰动（boneSetRemoval），不再命名 boneOrderDrift。
4. **正式路径不回退旧坏分区**：regionIdOf 与全身 labelOf 均硬要求 boneRegionLabels（缺失即返回 null→Gate 失败），不再回退旧世界坐标矩形分区；正式 Gate 硬断言 boneRegionLabels 非空、boneRegionIds 顺序=neck,torso,leftHand,rightHand、boneRegionVersion=1。旧 regionLabels 仅作 legacy 诊断透传。
5. **报告状态一致**：remainingRootCause(color-gate-unresolved) 移除，改 colorGate.status=candidate-color-gate-passed；mip/LOD/sampler/色彩空间链放入 limitations/unexcludedRisks，不再同时宣称 unresolved 与 complete。

### N1/N2 红绿进程退出码自验（独立脚本）

新增 web/scripts/gate-v14d-body-skin-semantic-negative.mjs：每场景起独立页面，在真实 PMX joints/weights 上用扰动骨骼集合重跑 exportMaterialTriRegions 分类，healthy（权威集合）期望 exit0、hand-swap/torso-inject/wrong-bone-name/wrong-bone-order 期望 exit1（非零拒绝）。实测 ===SEMANTIC-NEG-OK===：healthy gateExit=0、hand-swap=1（交换后语义对调 swap.leftHand=base.rightHand=882）、torso-inject=1（leftHand 882→1098、torso 216→0）、wrong-bone-name=1（rename6 1 处失配）、wrong-bone-order=1（swap68 2 处失配）。

### 复验命令与实际退出码（本轮实际运行）

| 验收项 | 结果 |
| --- | --- |
| npm run build | exit 0（62 项不变量，Compiled successfully） |
| 正式 BodySkin Gate（gate-m31-final） | exit 0（===BODY-SKIN-GATE-OK===；coverage 边界硬断言全过；错骨名/错骨序自验检出；正式归属硬要求 boneRegionLabels/Ids/version=1） |
| 独立语义负测 gate-v14d-body-skin-semantic-negative | exit 0（===SEMANTIC-NEG-OK===，healthy 0、四扰动全非零拒绝） |
| N3 配置失败负测（V14D_FACE_D=不存在） | exit 2（GATE-CONFIG-FAIL: face_d 不存在） |
| 运行时 graph 负测 missing/wrongGraph/wrongMaterial/none | exit 1/1/1/0（===RUNTIME-NEG-OK===） |
| probe-v14d-face-default / probe-v14d-vmd-runtime | exit 0 / exit 0 |
| git diff --check | exit 0 |
| PMX/VMD/动画运行时零 diff | 确认（git status 无 .pmx/.vmd/运行时文件改动） |

Gate 产物：.scratch/v14d-body-skin-state2/gate-m31-final/gate-report.json（机器 JSON；PNG 截图未入版本，可按脚本在本地重生成）。

## 交付握手

完成后停止写入、释放单写者租约，并向来源主会话发送结构化交付。
