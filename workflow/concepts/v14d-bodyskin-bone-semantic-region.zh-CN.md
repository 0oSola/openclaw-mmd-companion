# V14D BodySkin 骨骼主导语义分区（v14d-bodyskin-bone-semantic-region）

- 中文名称：BodySkin 骨骼主导语义分区
- 英文机器名：常量 V14D_BODY_SKIN_BONE_REGIONS_V1、函数 classifyV14dVerticesByBoneRegion、导出字段 boneRegionLabels
- 版本：v1（索引集合实测自 reze-engine 运行时 skeleton，401 骨骼，PMX 骨骼段序）。版本号与常量名 V14D_BODY_SKIN_BONE_REGIONS_V1 一致，为单一权威版本名。

## 概念定义

把 BodySkin 材质的每个三角形归属到语义区域（neck 颈部 / torso 躯干腰腹 / leftHand 左手 / rightHand 右手），归属依据是顶点主导骨骼：每个顶点取蒙皮权重最大的骨骼索引，三角形取其 3 顶点主导骨骼投票数最多的区域。骨骼索引到区域的映射是版本化常量 V14D_BODY_SKIN_BONE_REGIONS_V1。

## 解决的问题

旧版 V14D_BODY_SKIN_REGIONS 用「世界 y 带 + x 符号」矩形分区，已验证缺陷：左手 y 带（11.5..13.9）与腰腹露肤 y 带重叠，叉腰姿势下把腰腹皮肤错误计入左手区域，使左右手指标不可信。矩形分区只描述某个特定姿态下的世界坐标范围，不携带解剖语义。

## 适用与不适用

- 适用：BodySkin（PROTO_GF2_BodySkin）材质在任意姿态/相机下的语义区域归属。
- 不适用：Face、HairA、服装/手套等非 BodySkin 材质；不用于判断屏幕可见性（可见性由 pick mask 负责）。

## 核心不变量

1. 骨骼索引序 = reze-engine skeleton.bones 顺序 = PMX 骨骼段顺序；版本号 v1 与该索引集合绑定，模型或引擎更换骨骼排序必须升版本并重新核对索引（用 V14D_BODY_SKIN_BONE_NAME_ASSERT 硬断言表对 skeletonBoneNames 逐索引匹配，骨序漂移会被检出）。
2. 骨骼是解剖语义单位（首=颈、上半身=躯干、手首+手指=手），不随姿态/相机变化。
3. 区域集合互不重叠；一个骨骼索引至多属于一个区域。

## 区域定义（v1 实测）

| 区域 id | 中文 | 主导骨骼索引 | 实测 BodySkin 三角形数 |
| --- | --- | --- | --- |
| neck | 颈部 | 8（首） | 262 |
| torso | 躯干/腰腹 | 6（上半身） | 216 |
| leftHand | 左手 | 42（左手首）+ 59..73（左手指） | 882 |
| rightHand | 右手 | 57（右手首）+ 74..88（右手指） | 882 |

腕/手捩骨（左 32..41、右 47..56）是手腕与前臂扭转，被袖口/手套覆盖，不计入「手」可见皮肤。实测语义分区 y 范围：neck 15.84..16.53、torso 11.24..11.96、leftHand/rightHand 10.75..11.90——左右手 y 带与 torso 分离，不再像旧版那样重叠。

## 证据与计算口径

- 运行时主导骨骼直方图取证：exportMaterialTriRegions("BodySkin").dominantBoneHistogram。
- 骨骼名表：Blender armature 449 骨骼（含 _dummy_/_shadow_），reze-engine 运行时 skeleton 401 骨骼（去重后），二者骨骼名一致、索引序不同；本概念以运行时 401 骨骼序为准（joints 索引即该序）。
- 交叉验证：Blender PROTO_GF2_BodySkin 材质 2299 顶点主导顶点组含 頭/上半身/首/薬指３ 等，确认 BodySkin 覆盖颈/躯干/手（Blender 组序与 PMX 序不同，只用于语义存在性佐证）。

## 正例

- 左手区域只含主导骨骼为左手首/左手指的三角形；腰腹皮肤（主导骨骼=上半身 6）归属 torso。

## 反例

- 用世界 y 带 11.5..13.9 + x>0 框左手（旧版）：把 y 带重叠的腰腹皮肤计入左手。
- 用 Blender 顶点组索引直接当 PMX joints 索引：两套索引序不同，会错配。

## 相关 contract/gate

- Gate：web/scripts/gate-v14d-body-skin-state2.mjs（区域归属改用 boneRegionLabels）。
- 导出：RezeWebGpuStage.tsx 的 exportMaterialTriRegions 返回 boneRegionLabels/boneRegionIds/boneRegionVersion。

## 失败后的修正路线

- 若骨骼索引错配（区域样本为 0 或语义明显错位）：重新跑 .scratch/v14d-body-skin-state2/probe-bone-regions.mjs 导出 dominantBoneHistogram + skeletonBoneNames，核对 V14D_BODY_SKIN_BONE_REGIONS_V1 索引并升版本。

## 与现有概念的关系

- 替代/取代：V14D_BODY_SKIN_REGIONS（世界 y 带 + x 符号）作为正式归属依据已废弃；旧矩形分区仅作历史/legacy 诊断字段透传（regionLabels），不参与正式归属判定，不是兼容回退——正式 Gate 缺 boneRegionLabels 即失败。
- 上位概念：v14d-body-skin-state2（BodySkin 接入 V14D State2 实时合成）。
