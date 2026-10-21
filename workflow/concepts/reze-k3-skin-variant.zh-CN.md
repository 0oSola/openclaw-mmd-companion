# Reze K3 皮肤变体（V14D 生产切换）

- 中文名称：Reze K3 皮肤变体
- 英文机器名：`rezeK3SkinVariant`（localStorage 字段 / prop）
- 枚举值：`original`（原始 Reze K3）/ `v1`（Reze K3 V1 皮肤预览（V14D））
- 票据：Reze K3 V1 舞台接入与 V14D 切换（`codex/reze-k3-v1-v14d-toggle`）
- 状态：**已实现（4/15：Face、BodySkin、HairA、HairB），/companion 舞台端到端验收通过（Stage 2C-M1 头发阶段 2026-09-03）**

## 概念定义

在同一 `/companion` 的 reze-k3 WebGPU 舞台运行时中，对克莱妲 Face/BodySkin 材质启用 V14D State2 实时合成；
自 Stage 2C-M1 起，V1 同时对 HairA/HairB 启用权威 BaseColor 乘色 graph（详见文末头发阶段），
形成两个用户可见且可持久选择的效果：

- **原始 Reze K3**：保持现有生产 reze-k3 材质、灯光、VMD 行为不变。
- **Reze K3 V1 皮肤预览（V14D）**：Face 应用 State2 实时合成图（face_d 线性 × warm
  × shadowFactor），BodySkin 应用暖肤合成（body_d 线性 × warm），HairA/HairB 应用
  `hair_d` 线性 × `[0.84,0.85,0.96]`；不使用 bakedGolden 或任何失败实验纹理，
  其余尚未迁移材质和明确排除的衣物/装备保持原始 Reze K3。

切换触发引擎 style group / shader graph 的真实重新编译与 draw-call 绑定，
不是改标签或 dataset。

## 迁移范围（15 槽最终目标 vs 已迁移 4/15）

本概念自 2026-09-02 皮肤阶段（Face + BodySkin，2/15）起步，Stage 2C-M1（2026-09-03）迁入 HairA/HairB 后已迁移 4/15；**不代表
全部角色材质迁移已完成**（其余 11 槽仍未迁移）。最终目标是「Reze K3 + V14D 角色外观材质（**15 槽**）」。

- **权威 15 槽清单（唯一权威，非 27/27、非"全部 PMX 材质"）**：Face、BodySkin、
  Brows、Lashes、Emotions、HairA、HairB、Eyes、EyeWhite、EyeShadow、Eyes+、
  UpperTeeth、LowerTeeth、Tongue、FingerNails。
- **本概念已迁移（4/15）**：Face、BodySkin、HairA、HairB。
- **尚未迁移（11/15，后续票据）**：Brows、Lashes、Emotions、Eyes、EyeWhite、
  EyeShadow、Eyes+、UpperTeeth、LowerTeeth、Tongue、FingerNails。
- **明确排除（永久保持原始 Reze K3，不在迁移范围）**：所有 Cth\* 衣物/披风/手套/
  裤/鞋/口罩/包（Cth1-Cape、Cth1-Cape2、Cth1-Glove、Cth1-Top、Cth2-Pants、
  Cth2-Pouch、Cth2-Shoes、Cth3-Mask、Cth4-Glove、Cth5-ShoesZip），以及 Glock、
  GunSilencer 武器装备。

「保留 Reze K3 灯光与星空背景」只约束**舞台环境**，不表示保留原 K3 的角色材质；
舞台环境与角色材质迁移范围相互独立。后续全材质票据的完成定义必须是 15 槽逐槽都有
机器可审计状态（已迁移 / 经权威证据确认等价 / 当前帧不可见但另有验证帧 / 明确阻塞），
任何槽不得缺项。

## 解决的问题

此前 V14D Face State2 + BodySkin 实时合成只在 `/mmd-calibration-render`
诊断入口可用，无法进入真实 `/companion` 生产舞台，也无法按用户偏好持久
选择。本概念把已验证的实时合成能力抽成生产舞台显式可选的皮肤变体，默认
关闭（original），不影响既有 reze-k3 行为。

## 适用与不适用场景

- **适用**：`/companion` + reze-k3 管线 + 权威克莱妲 PMX
  （`GirlsFrontline KoledaDefault.pmx`）+ 本地目录导入（localModelImport），
  且目录内包含权威 State2 mask
  （`v14d-01234-face-shadow-state-2.png`）。
- **不适用**：非克莱妲模型（隐藏/禁用 V1，安全回退 original）；reze-design、
  k3 或其他渲染管线（无泄漏）；诊断 `/mmd-calibration-render` 入口
  （faceStatic 开启时本开关被忽略，互斥）。

## 核心不变量

1. 持久化按「用户 + 模型 + reze-k3 管线」三维隔离
   （`mmd_reze_k3_skin_variant_v1:<userId>:reze-k3:<modelPath>`），
   默认 original；original 为默认值时清除存储键。
2. V1 只改 Face/BodySkin/HairA/HairB 四个材质的 graph 绑定；其余材质、灯光、
   背景、相机、VMD 播放/循环/结束回调与原始 Reze K3 完全一致。
3. 不改 PMX/VMD 文件、骨骼、权重、Morph、IK、Grant、Physics、插值/播放
   时钟、PMX 拓扑或材质槽。
4. State2 mask 缺失或资格不满足时安全回退 original，不抛错、不半成品渲染。

## 证据口径

- 运行时 canvas dataset：`v14dSkinVariant`（original/v1）、
  `v14dSkinVariantFaceGraph`、`v14dSkinVariantFace/Body/HairA/HairBDrawCalls`、
  `v14dSkinVariantFace/Body/HairA/HairBOnComposite`（draw-call 级真实绑定证据，
  HairA/HairB 分区各自核对 graph.name "V14D Hair V1 Composite"）。
- 验收需读取引擎 styleGroups/drawCalls 证明 Face/BodySkin/HairA/HairB graph 生效；
  错 graph、漏 mask、非克莱妲负测必须失败或安全回退。
- HairA/HairB 视觉目标使用权威公式 `targetLinear(uv)=srgbToLinear(hair_d(uv))×[0.84,0.85,0.96]`；
  舞台画布比较前转回显示字节。正式样本必须来自同一全画面
  `engine-pick-material-id-depth` pass 的对应 PMX materialId + 深度前景像素，矩形 ROI
  只限制空间范围，不能赋予槽位身份。
- `--neg-wrongtint` 是“预期拒绝”协议：analyzer 必须输出
  `negativeVerdict.status=rejected`、HairA/HairB 正式目标判据均为 false、
  `analysisFailures=[]` 与 `rejectionReason`，并以 exit=0 返回；配置错误、样本缺失、
  其他 Gate failure 或异常均不得包装成负测通过。

## 正例 / 反例

- 正例：克莱妲 + reze-k3 + localModelImport 含 State2 mask → 显示
  「原始 Reze K3 / Reze K3 V1 皮肤预览（V14D）」切换，选 V1 后脸部/脖子/手部皮肤
  真实变化，其余尚未迁移材质/衣服不变，刷新后按用户+模型恢复。
- 反例：非克莱妲模型选择 V1 → 不显示切换或安全回退 original；把
  bakedGolden 烘焙图或 AgX display-byte atlas 当作 V1 → 禁止。

## 相关 contract / gate

- 复用诊断入口的 State2/BodySkin Gate（`gate-v14d-face-state2-live.mjs`、
  `gate-v14d-body-skin-state2.mjs`）；生产切换需新增舞台切换探针。

## 失败后的修正路线

- V1 未生效（dataset=original 但用户选了 v1）：检查 localModelImport 是否
  含权威 PMX 与 State2 mask；检查 applyStyleGroups 返回与 console 警告。
- 脸部变化但 BodySkin 不变：读 `v14dSkinVariantBodyOnComposite` 是否
  等于 BodyDrawCalls；不等于则 BodySkin graph 未绑定成功。

## 生产舞台验收（2026-09-02 第四轮，历史快照）

票据 `codex/reze-k3-v1-stage-visual-acceptance`，交付 `docs/handoff/2026-09-02-reze-k3-v1-stage-visual-acceptance.md`。
在保留 K3 灯光/星空/自由相机/动态 VMD 的前提下，G1-G6 六项运行时 Gate 全过 + 独立工程门禁（当时统称 G1-G7）；该轮 V1 仅 Face/BodySkin 走 V14D 合成
（皮肤阶段，其余 13 槽未迁移）。第三轮修正主会话 P0：(a) G3 收敛引入 V14D 目标参考色比比较
（original 0.196→V1 0.141，drop 28.2%，含错误颜色负测）；(b) 恢复通用 VMD effect 的
`engine.resetPhysics()` 并抽共享函数 `loadVmdThroughInteractionPath`（effect 与探针同路径，
effect 计数=5）；(c) G5 完整结束改为硬证据（完成回调计数自增 + nearTail，含提前停止负测）；
(d) 场景不变性在 original/V1 两侧逐字段硬断言。第四轮继续收口：(e) 共享函数把请求守卫作为
guard 回调传入、在任何副作用前硬检查（竞态回归 A慢/B快 下旧请求无副作用退出）；(f) 完成回调
先验证 currentName===finishedName 再计数，并把身份/模型校验放到任何 clear/count/loop/reset/complete
副作用之前（pause/seek 取消完成兜底；过期完成回调负测证明其不得清当前 fallback、计数不增、当前
动作后续仍正常完成）。验收探针 `__rezeStageProbe` 仅在 `?v14dAcceptanceProbe=1` 显式开关下挂载，
含负测钩子 `applyBadSkinGraph`/`fireStaleFinish`/`vmdFallbackState`。环境为存根端到端
（API 后端本机不可达，route 存根 bootstrap）。**截至该验收时为皮肤阶段 2/15（历史快照）；当前状态见本文开头与下方 Stage 2C-M1（4/15），全材质迁移（15 槽）仍未完成。**

## 与现有概念的关系

- 基于 `v14d-face-state2-live-composite` 与 `v14d-body-skin-state2`
  的实时合成图，但语义从「诊断入口固定帧」转为「生产舞台可选变体」；
  两者共享引擎补丁五的 WGSL 覆写（按 graph.name + tags），不复制公式常量。

## Stage 2C-M1 头发阶段（2026-09-03，当前权威）

票据 `codex/v14d-hairab-stage` 把 HairA/HairB 两个 PMX 材质槽迁移进 V1：
新增引擎独立 `V14D_HAIR_HELPER_WGSL` 常量（`v14d_hair_composite(base)=base×
[0.84,0.85,0.96]`，常量来自权威 blend 取证 `web/scripts/forensic-v14d-hair-state.py`
输出 `web/.scratch/v14d-hairab/hair-forensic.json`），assembleModule 新增
`includeV14dHairHelper` 参数单独注入（不连带 State2 mask 声明/binding 5，hair graph
无需 mask 即可编译），compile 按 graph.name "V14D Hair V1 Composite" 覆写
final_color。生产 V1 把 HairA/HairB 抽出绑定到 `V14D_HAIR_V1_COMPOSITE_GRAPH`
（renderClass=hair）。头发视角相关部分（Anisotropic 0.7200000286、Roughness/Specular
MapRange 参数、ToonRamp 三段参数、ShaderToRGB/Tangent/Alpha 链）按 A/B/C 分类为 C
（不能烘焙/不固化视角高光），本阶段只迁移 BaseColor 乘色。

验收：真实 `/companion` 舞台 G1-G6 全过，HairA/HairB draw-call 各 1/1 命中
V14D Hair V1 Composite。最终回放 HairA materialId=24、samples=4,189、coverage=0.037214、
targetMean=[136.05,129.45,154.60]、origMae=40.879、v1Mae=32.181、drop=0.2128；HairB
materialId=25、samples=15,426、slotPixels=15,495、coverage=0.096902、targetMean=[141.89,135.47,161.77]、
origMae=53.705、v1Mae=39.132、drop=0.2714。正式阈值为每槽 samples≥30、drop>0.05、
v1Mae<90，变化阈值为 mae>1 且 maxMeanDiff>1。样本由
`engine-pick-material-id-depth` 对应材质身份掩码提供，错槽交换负测样本严格互换。
wrongTint `[1.35,0.25,0.25]` 的 HairA 正式误差为 53.535（drop=-0.3096），HairB 为 51.806
（drop=0.0354）；analyzer exit=0，`negativeVerdict.status=rejected`，HairA/HairB 正式目标判据
均 false 且无 failures；accept 能区分预期拒绝与负测失效。场景快照逐字段覆盖 settings、grade、
backgroundEffect、transparentBackground、viewTransform（exposure/gamma/look），前刘海/后长发近景
与差异图已产出。
交付报告 `docs/handoff/2026-09-03-reze-k3-v1-hairab-stage.md`。
