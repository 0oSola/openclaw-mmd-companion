/// <reference types="@webgpu/types" />

/**
 * Koleda V14D Face State 2 实时合成预览（固定初始状态，Stage 2B-M1）。
 *
 * 视觉常量全部来自权威 blend 取证，不在 Web 手调：
 *   blend: Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend
 *   sha256: 1139617cf24c8b0a79c0e5ad6549bf7696661cef6b5a4dc51dc209396a353cd4
 *   frame=120, fps=24, 640x640, AgX Medium High Contrast, exposure=-0.56, gamma=1.0
 *   State=2, LayerA=2, LayerB=2, BlendWeight=0
 *
 * 合成公式（线性空间，逐纹素；掩码 R/G/B 取自 State2 Non-Color 图，faceValid 恒 1）：
 *   warm   = faceD * [1, 0.935, 0.89]
 *   artW   = mask.R * (1 - mask.B)
 *   fringeW= mask.G * (1 - mask.B)
 *   art    = mix(white, [0.66,0.58,0.60], artW)
 *   fringe = mix(white, [0.70,0.64,0.69], fringeW)
 *   shadowFactor = art * fringe        // 乘法阴影因子（≈1 处无阴影）
 *   composite  = warm * shadowFactor   // 最终脸部线性色（BaseColor + State2, Blend 0）
 *   attenuation = 1 - shadowFactor     // 纯阴影衰减分量（0=无阴影，黑底）
 *
 * Stage 2B-M1（本票）：finalFaceComposite / faceShadowOnly 升级为**实时合成**——
 * Face 材质在 Web 线性空间逐像素从「原始 face_d + State2 packed mask + Blender
 * 节点常量」执行上式，不再使用整张预烘焙脸图。mask 纹理由引擎补丁五在
 * setupMaterialsForInstance（GPU 材质建立）前按逻辑路径创建，mipmap 禁用且按
 * 线性（非 sRGB 解码视图）采样，与 Blender Non-Color 语义一致。
 *
 * 三模式语义相互独立：
 *   normal            → 原始 face_d（未应用 State2 的现有 Web 脸部基线，单纹理）
 *   faceShadowOnly    → 实时 shadowFactor（State2 乘法阴影因子，≈1 处无阴影）
 *   finalFaceComposite→ 实时 composite（BaseColor + State2, Blend 0 实时合成）
 *
 * 资产政策（README：第三方资产不可再分发，仓库不捆绑）：仓库只保留可发布代码/脚本/文档。
 * 权威 PMX/纹理/VMD 与派生纹理均由用户本地源以 File 形式注入（采集脚本经 Node fs 从
 * 本地路径读取；用户经 folder file input 选择），引擎 files 变体用 createFileMapAssetReader
 * 完全局部解析，无网络请求、无 404、不全局包装 window.fetch。
 */

import type { MmdCameraSnapshot } from "@/lib/types";
import {
  V14D_AUTHORITY_PMX_FILE_NAME,
  V14D_FACE_MATERIAL_NAME,
  V14D_BODY_MATERIAL_NAME,
  V14D_HAIR_A_MATERIAL_NAME,
  V14D_HAIR_B_MATERIAL_NAME,
  V14D_HAIR_TINT,
  V14D_BODY_WARM,
} from "./v14dAuthority.js";

// 保留本模块既有导出面；值由纯 JS 权威模块统一提供，避免 TS/JS 双写漂移。
export {
  V14D_FACE_MATERIAL_NAME,
  V14D_BODY_MATERIAL_NAME,
  V14D_HAIR_A_MATERIAL_NAME,
  V14D_HAIR_B_MATERIAL_NAME,
  V14D_HAIR_TINT,
  V14D_BODY_WARM,
};

export const V14D_FACE_STATIC_FRAME = 120;
export const V14D_FACE_STATIC_FPS = 24;
export const V14D_FACE_STATIC_SECONDS = V14D_FACE_STATIC_FRAME / V14D_FACE_STATIC_FPS;
export const V14D_FACE_STATIC_SIZE = 640;
export const V14D_FACE_STATIC_STATE = 2;
export const V14D_FACE_STATIC_BLEND = 0;

/** 权威脸部 diffuse 纹理文件名（原始 BaseColor），normal 模式直接用它。 */
export const V14D_FACE_BASE_TEXTURE_NAME = "c_Koleda_slg_face_d.png";
/**
 * Stage 2B-M3 全身皮肤统一：Blender 权威 blend 取证的 BodySkin 材质事实
 * （web/scripts/forensic-v14d-bodyskin-state2.py 输出 manifest，sha 见交付报告）。
 *
 * BodySkin 在 Blender 的 Surface 链（唯一扩散纹理 = body_d.png，sRGB，无离散阴影 mask）：
 *   body_d(sRGB→linear) ──► PROTO_FaceWarm(MULTIPLY × warm=[1,0.945,0.905])
 *       ──► 原理化 BSDF BaseColor + Emission(strength 0.04)
 *   Toon 分支（PROTO_ToonMix，Factor=1.0 恒取 emission 输入）：
 *       warm × ToonRamp(ShaderToRGB(Diffuse)) ──► Emission ──► AlphaMix
 * 关键取证结论：
 *   - BodySkin 的 warm 常量 = [1, 0.945, 0.905]，与 Face 的 [1, 0.935, 0.89] **不同**，
 *     禁止复用 Face 常量；两者属同一 V14D skin material family（同节点名/同乘法结构）。
 *   - BodySkin **没有**任何离散阴影 mask（hasDiscreteShadowMask=false），
 *     脸部专用 State2 packed mask 禁止按票据直接套到 BodySkin UV。
 *   - 本票身体分支按真实证据实现为「body_d 线性 × 身体 warm」直出，
 *     与脸部 finalFaceComposite（face_d × warm × shadowFactor(mask)）同族同口径：
 *     一致的线性色彩处理、暖肤 tint 乘法结构与显示变换；mask 项仅脸部专用。
 *   - 手指/手背皮肤、脖子、腰/腹部露肤均由同一 BodySkin 材质承载
 *     （材质 manifest 中仅 BodySkin 与 FingerNails 使用 body 纹理族；FingerNails
 *     用独立 body_zhijia01_da.png 美甲纹理，不属于皮肤，不纳入）。
 */

/**
 * Stage 2C-M1：HairA/HairB V1（V14D）头发材质迁移的权威 PMX 材质名。
 * Blender 权威侧为 PROTO_GF2_HairA / PROTO_GF2_HairB，BaseColor 同为
 * c_KoledaSSR01_slg_hair_d.png（sRGB）× 银白紫乘色 [0.84, 0.85, 0.96]
 * （PROTO_HairTint MIX_RGB MULTIPLY Factor=1），见
 * web/scripts/forensic-v14d-hair-state.py 输出 manifest。
 */
/** 引擎补丁 WGSL helper 函数名（graph 覆写表达式前缀，错 tint 负测按此前缀识别）。 */
export const V14D_HAIR_HELPER_FN = "v14d_hair_composite";
/** 权威身体皮肤 diffuse 纹理文件名（原始 BaseColor，body_d.png）。 */
export const V14D_BODY_BASE_TEXTURE_NAME = "body_d.png";

/**
 * Stage 2B-M3 修正轮：BodySkin 四区域语义分区（世界坐标，PMX 单位，frame120 姿态）。
 *
 * 分区依据：Blender 权威 blend frame120 下 PROTO_GF2_BodySkin 三角形质心实测
 * （probe/blender-body-tris.json，3671 三角形，Blender 米制高度 z∈[0.96,1.47]，
 *  x∈[-0.578,0.578]；PMX 单位 = 米 / 0.08，故高度 y∈[12.0,18.3]，x∈[-7.2,7.2]）。
 *
 * 叉腰姿势下两手/手腕位于腰两侧（y≈12.0..13.6），与腰部露肤 y 带重叠，
 * 必须按世界 x 符号区分左右手：PMX 左手在世界 x>0 侧，右手在 x<0 侧。
 * 区域不重叠，classifyV14dMaterialRegions 按数组顺序先命中先得。
 */
export const V14D_BODY_SKIN_REGIONS = [
  // 修正轮实测（gate diag）：脖子可见皮肤 = 下巴与衣领之间颈侧窄带（y≈15.7..16.2；
  // 头前倾+衣领遮挡 y<15.7 的颈部三角形，正面全身视角下它们被 Face/衣领深度遮挡）。
  { id: "neck", yMin: 15.7, yMax: 16.2, xSide: "any" },
  // 腰部露肤 = 腰带上方可见带（y≈13.4..13.9；叉腰的手与腰带覆盖 y<13.4）。
  { id: "waist", yMin: 13.4, yMax: 13.9, xSide: "any" },
  // 左手/右手：叉腰姿势下两手在腰两侧（y≈12.0..13.6），按世界 x 符号区分。
  { id: "leftHand", yMin: 11.5, yMax: 13.9, xSide: "pos" },
  { id: "rightHand", yMin: 11.5, yMax: 13.9, xSide: "neg" },
] as const;

/**
 * Stage 2B-M3.1 修正轮：BodySkin 语义分区（版本化骨骼主导权重集合，版本 = v1）。
 *
 * 替代旧版 V14D_BODY_SKIN_REGIONS 的世界 y 带 + x 符号矩形分区（已验证问题：左手 y 带把
 * 腰腹皮肤计入，左右手与腰腹无法按几何语义准确区分）。本集合按「顶点主导骨骼」（蒙皮权重
 * 最大的骨骼）的 PMX 骨骼索引划分语义区域，骨骼索引序 = PMX 骨骼段顺序 = 权威 blend
 * armature 骨骼序（mmd_tools 按 PMX 序建骨骼，已交叉验证）。
 *
 * 语义稳定性证据：骨骼是拓扑/解剖语义单位（"首"=颈、"上半身"=躯干、"腕/手首/手指"=手），
 * 不随姿态/相机变化；同一 PMX 内骨骼索引固定。版本号 v1 记录集合内容，后续模型更换需同步
 * 升版本并重新核对索引。
 *
 * 骨骼索引为 reze-engine 运行时 skeleton.bones 顺序（= PMX 骨骼段顺序，401 骨骼）。
 * 实测 BodySkin 主导骨骼（frame120 叉腰，dominantBoneHistogram 取证）确认：颈部皮肤主导
 * 骨骼 = 8（首）；腰腹/躯干露肤 = 6（上半身）；左手皮肤 = 左手首(42)+左手指(59..73)；
 * 右手皮肤 = 右手首(57)+右手指(74..88)。腕/手捩骨（32..41 / 47..56）是手腕与前臂扭转，
 * 被袖口/手套覆盖，不计入"手"可见皮肤。
 *
 * 区域定义（machine id → 中文含义 → 主导骨骼索引集合）：
 *   neck      颈部     = { 8 }（首）
 *   torso     躯干/腰腹 = { 6 }（上半身；腰腹露肤主导骨骼）
 *   leftHand  左手     = { 42 } 左手首 + 左手指 59..73
 *   rightHand 右手     = { 57 } 右手首 + 右手指 74..88
 *   unassigned 未分区  = 其余主导骨骼（下半身/頭/裙/腿等，不计入四区域对账）
 */
export const V14D_BODY_SKIN_BONE_REGIONS_V1 = {
  version: 1,
  neck: [8],
  torso: [6],
  leftHand: [42, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73],
  rightHand: [57, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88],
} as const;

/**
 * Stage 2B-M3.1 修正轮（验收修正 5）：骨骼索引 → 期望语义骨名硬断言表。
 *
 * 骨骼索引序（joints 索引序 = reze-engine skeleton.bones 序）与骨名的对应是骨骼主导分区的
 * 正确性前提；模型/引擎若更换骨骼排序，索引会静默错配，分区随之静默错分。正式 Gate 必须按
 * 本表对 skeletonBoneNames 做硬断言：任一索引的实际骨名与期望不符即 Gate 失败（不软通过）。
 *
 * 期望模式（正则）：左右手指骨按「左/右 + 指名 + 段号」匹配（如 59 左中指１、74 右中指１）；
 * 6=上半身、8=首、42=左手首、57=右手首为精确字面名。
 * 实测自 .scratch/v14d-body-skin-state2/runtimeBoneNames.json（401 骨骼，本模型权威值）。
 */
export const V14D_BODY_SKIN_BONE_NAME_ASSERT: readonly (readonly [number, RegExp])[] = [
  [6, /^上半身$/],
  [8, /^首$/],
  [42, /^左手首$/],
  [57, /^右手首$/],
  ...([59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73] as const).map(
    (i) => [i, /^左[親中人小薬][指]?[0-9０-３]*$/] as const,
  ),
  ...([74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88] as const).map(
    (i) => [i, /^右[親中人小薬][指]?[0-9０-３]*$/] as const,
  ),
];
/** 语义区域 id 列表（展示/报告顺序固定）。 */
export const V14D_BODY_SKIN_BONE_REGION_IDS = ["neck", "torso", "leftHand", "rightHand"] as const;
export type V14dBodySkinBoneRegionId = (typeof V14D_BODY_SKIN_BONE_REGION_IDS)[number];
/** State2 packed mask 注入逻辑键（唯一，不顶替原始纹理；引擎补丁五按此前缀建立实时 mask 纹理）。 */
export const V14D_STATE2_MASK_LOGICAL_PATH = "Textures/v14d-state2-mask/state2.png";
/** 实时合成模式：faceShadowOnly=ShadowFactor 视图，finalFaceComposite=FinalComposite 视图。 */
export const V14D_FACE_LIVE_MODES = ["faceShadowOnly", "finalFaceComposite"] as const;

/** Blender 节点取证常量（见 web/scripts/forensic-v14d-face-state2.py 输出 manifest；不得手调）。 */
export const V14D_STATE2_CONSTANTS = {
  warm: [1.0, 0.935, 0.89],
  shadowTint: [0.66, 0.58, 0.60],
  fringeTint: [0.70, 0.64, 0.69],
  state: 2,
  blend: 0,
  maskImage: "PROTO_V14D_FaceShadow_State2",
  maskSha256: "42d2f95af877ebfa9d5266195742dca95fe0463a8cb093b24a14717d2c33a103",
  faceDSha256: "1e963c090272fb1102c4e5248cf98177ac6c7afe57eeff1e370e7b7f954fd44e",
} as const;

/**
 * 实时 State2 合成模式：Golden Frame 固定相机叠加。
 * 配准负测：v14dFaceCameraOverride=shift / null。
 *   - shift：相机 position/target 沿 +X 平移 6 PMX 单位，必须使配准 Gate 失败；
 *   - null ：强制不恢复相机（保持 boot 默认相机，fov/position/target 与权威不同）。
 * 采集脚本读取 canvas dataset 的实际 fov/position/target 上报 Gate；null 相机阻断 Gate。
 */
export type V14dFaceCameraOverride = "shift" | "null" | null;
export function v14dFaceCameraWithOverride(
  base: MmdCameraSnapshot,
  override: V14dFaceCameraOverride,
): MmdCameraSnapshot | null {
  if (override === "null") return null;
  if (override === "shift") {
    const dx = 6;
    return {
      ...base,
      position: [base.position[0] + dx, base.position[1], base.position[2]],
      target: [base.target[0] + dx, base.target[1], base.target[2]],
    };
  }
  return base;
}

/** 权威 PMX 与 VMD 的身份（强门控；来自权威 blend / 用户本地包取证）。 */
export const V14D_FACE_STATIC_AUTHORITY = {
  pmxFileName: V14D_AUTHORITY_PMX_FILE_NAME,
  vmdFileName: "koleda-v14d-authoritative-pose-f120.vmd",
  vmdSha256: "2536c886029af068878c674bf749a409fccaa3cad519fbcde4233bd7c3b3394d",
} as const;

/** 派生纹理文件名（本地生成，不提交仓库；由 bake-face-state2.py 产出）。 */
export const V14D_FACE_STATIC_DERIVED = {
  composite: "v14d-face-composite-state2.png",
  attenuation: "v14d-face-shadow-attenuation-state2.png",
} as const;

/**
 * 黄金帧可见岛逐材质最终着色烘焙绑定（单一权威描述，消除 TS/MJS/渲染三处重复）。
 *
 * 每条形如 { key, pmxMaterial, bakedFile, logicalPath }：
 *   key         诊断键（face/hairA/...）；
 *   pmxMaterial PMX 材质名（引擎按名命中槽位，逐材质独立绑定）；
 *   bakedFile   本地烘焙文件名（用户目录注入，不提交仓库）；
 *   logicalPath 注入用的**唯一**逻辑路径（webkitRelativePath）。
 *
 * 不变量：logicalPath 全局唯一，绝不复用原始纹理键。原实现把 Face/EyeWhite 共用
 * face_d 键、HairA/HairB 共用 hair_d 键、Top/Cape 共用 cloth1_da 键，而
 * reze-engine asset-reader 的 fileListToMap() 用 Map.set 后写覆盖前写，导致
 * EyeWhite 覆盖 Face、HairB 覆盖 HairA、空 Cape 覆盖 Top（红黑脸/胸口近黑根因）。
 * 唯一逻辑键 + 加载后改写材质 diffuse 纹理路径才是真正的逐材质独立绑定。
 */
export type V14dBakedBinding = {
  readonly key: string;
  readonly pmxMaterial: string;
  readonly bakedFile: string;
  readonly logicalPath: string;
};

const baked = (key: string, pmxMaterial: string, bakedFile: string): V14dBakedBinding => ({
  key,
  pmxMaterial,
  bakedFile,
  logicalPath: "Textures/v14d-baked/" + bakedFile,
});

export const V14D_BAKED_BINDINGS: readonly V14dBakedBinding[] = [
  baked("face", "Face", "baked_face.png"),
  baked("eyeWhite", "EyeWhite", "baked_eyeWhite.png"),
  baked("eyes", "Eyes", "baked_eyes.png"),
  baked("eyesPlus", "Eyes+", "baked_eyesPlus.png"),
  baked("hairA", "HairA", "baked_hairA.png"),
  baked("hairB", "HairB", "baked_hairB.png"),
  baked("body", "BodySkin", "baked_body.png"),
  baked("top", "Cth1-Top", "baked_top.png"),
  baked("cape", "Cth1-Cape", "baked_cape.png"),
];

/** key -> 烘焙绑定（供 UI/脚本查找）。 */
export const V14D_BAKED_BY_KEY: Readonly<Record<string, V14dBakedBinding>> = Object.fromEntries(
  V14D_BAKED_BINDINGS.map((b) => [b.key, b]),
);

/** 烘焙文件名集合（UI 目录选择识别 baked_*.png）。 */
export const V14D_BAKED_TEXTURES: Readonly<Record<string, string>> = Object.fromEntries(
  V14D_BAKED_BINDINGS.map((b) => [b.key, b.bakedFile]),
);

/**
 * 三模式 -> Face 材质 diffuse 应使用的文件名。
 * normal 用 PMX 包内原始 face_d；另两模式用本地派生文件（覆盖 face_d 逻辑名）。
 */
export const V14D_FACE_STATIC_MODE_TEXTURE = {
  normal: V14D_FACE_BASE_TEXTURE_NAME,
  finalFaceComposite: V14D_FACE_STATIC_DERIVED.composite,
  faceShadowOnly: V14D_FACE_STATIC_DERIVED.attenuation,
} as const;

/**
 * 诊断模式：Face 材质输出插值 UV（R=u, G=v, B=0），不采样纹理。
 * 仅供 UV-direct 逐纹素对账；不改变三模式语义，默认关闭。
 */
export const V14D_FACE_UV_DEBUG_MODE = "uvDebug";
/** 黄金帧几何验证模式：所有材质输出 world_pos 颜色，肉眼核对相机/缩放。 */
export const V14D_FACE_STATIC_WORLD_POS_MODE = "worldPos";
/** 黄金帧材质验证模式：所有材质输出 material_diffuse 颜色（无光照）。 */
export const V14D_FACE_STATIC_DIFFUSE_MODE = "diffuseFlat";
/** 黄金帧烘焙模式：可见岛逐材质 unlit 显示 Blender frame120 烘焙纹理。 */
export const V14D_FACE_STATIC_BAKED_MODE = "bakedGolden";

export type V14dFaceStaticMode =
  | keyof typeof V14D_FACE_STATIC_MODE_TEXTURE
  | typeof V14D_FACE_UV_DEBUG_MODE
  | typeof V14D_FACE_STATIC_WORLD_POS_MODE
  | typeof V14D_FACE_STATIC_DIFFUSE_MODE
  | typeof V14D_FACE_STATIC_BAKED_MODE;

export const V14D_FACE_STATIC_MODES: readonly V14dFaceStaticMode[] = [
  "normal",
  "faceShadowOnly",
  "finalFaceComposite",
];

export function isV14dFaceStaticMode(value: string | null): value is V14dFaceStaticMode {
  return (
    value === "normal" ||
    value === "faceShadowOnly" ||
    value === "finalFaceComposite" ||
    value === V14D_FACE_UV_DEBUG_MODE ||
    value === V14D_FACE_STATIC_WORLD_POS_MODE ||
    value === V14D_FACE_STATIC_DIFFUSE_MODE ||
    value === V14D_FACE_STATIC_BAKED_MODE
  );
}

/** 模式是否用派生纹理（normal 直接用 PMX 原始 face_d）。 */
export function v14dFaceStaticIsDerivedMode(mode: V14dFaceStaticMode): boolean {
  if (mode === V14D_FACE_UV_DEBUG_MODE || mode === V14D_FACE_STATIC_WORLD_POS_MODE || mode === V14D_FACE_STATIC_DIFFUSE_MODE) return false;
  return mode !== "normal";
}

/** 模式对应的 Face diffuse 文件名（用于徽章/capture 显示与 fileMap 键）。 */
export function v14dFaceStaticTextureName(mode: V14dFaceStaticMode): string {
  if (mode === V14D_FACE_UV_DEBUG_MODE) return "uv-debug";
  if (mode === V14D_FACE_STATIC_WORLD_POS_MODE) return "world-pos";
  if (mode === V14D_FACE_STATIC_DIFFUSE_MODE) return "diffuse-flat";
  if (mode === V14D_FACE_STATIC_BAKED_MODE) return "baked-golden";
  return V14D_FACE_STATIC_MODE_TEXTURE[mode];
}

/** 权威 frame-120 脸部 ROI（Blender 640x640 投影, blender-face-ref.py 计算），Web 归一化 [x,y,w,h]。 */
export const V14D_FACE_STATIC_ROI_NORM: readonly [number, number, number, number] = [
  0.3462, 0.3142, 0.3052, 0.3354,
];

/**
 * 权威近景相机（[Stage 2A-GF] 从 blend 取证 golden-frame.json）：
 * PROTO_GameCamera loc=[0.03,-1.02,1.335]m, rotX=90deg/rotZ≈-0.21deg, lens 72mm, sensor 36mm(AUTO)。
 * 引擎为垂直 FOV，square frame 下 vfov = 2*atan(36/(2*72)) = 28.0725°。
 * Blender 角色身高约 1.49m（米）；reze 侧模型实测以 PMX 单位渲染
 * （CPU 皮肤后脸部中心 [0.53,16.44,-1.17]，与 PMX bind 同单位），相机按
 * PMX 单位换算：Blender frame120 脸相对相机约 (x≈0, y≈0.10m, 前方 1.02m)，
 * 即 PMX 单位 (x≈0, y≈+1.25, 前方 12.75)；Web 相机 = 脸部中心 + 该偏移。
 * （注：CPU 皮肤矩阵的 Y 列与 Blender 有约 0.84 的既有差异，超出本票范围。）
 * 脸部相对相机偏移用 Blender 脸中心与相机的实际差值；但 Web 姿态脸部前倾更多，
 * 中心 z≈-1.26（Blender ≈0）。由于 Web/Blender 姿态存在差异（Web 头前倾更大，
 * 见 boneEulers 对比），相机 target 取 Web 实测脸部皮肤中位数，position 在
 * Blender 的 PMX 前方 12.75 单位处，保证脸在画面中心且不被相机压入体内。
 */
export const V14D_FACE_STATIC_CAMERA: MmdCameraSnapshot = {
  fov: 28.072486935852954,
  position: [0.564, 18.55, -13.0],
  target: [0.564, 16.4125, -1.26],
  locked: true,
};

/**
 * 固定帧全身检查机位：保持权威相机的正面方向和垂直 FOV，把轨道中心下移到
 * 角色中段并把距离扩到 38 PMX 单位，使约 y=0..18.5 的全身进入画面。
 * 仅供 v14dFaceStatic 交互预览，不参与任何像素 Gate 或生产默认相机。
 */
export const V14D_FACE_STATIC_FULL_BODY_CAMERA: MmdCameraSnapshot = {
  fov: V14D_FACE_STATIC_CAMERA.fov,
  position: [0.564, 15.8, -38.66],
  target: [0.564, 9.0, -1.26],
  locked: true,
};

/** 画布 dataset 标记键名（供 capture 脚本与报告读取）。 */
export const V14D_FACE_STATIC_DATASET = {
  enabled: "v14dFaceStatic",
  mode: "v14dFaceStaticMode",
  frame: "v14dFaceStaticFrame",
  state: "v14dFaceStaticState",
  blend: "v14dFaceStaticBlend",
  cameraLocked: "v14dFaceStaticCameraLocked",
  cameraFov: "v14dFaceStaticCameraFov",
  cameraPos: "v14dFaceStaticCameraPos",
  paused: "v14dFaceStaticPaused",
  texture: "v14dFaceStaticTexture",
  faceMaterialApplied: "v14dFaceStaticFaceApplied",
  faceMaterialIndex: "v14dFaceStaticFaceIndex",
  /** Stage 2B-M3：BodySkin 是否绑定身体暖肤合成 graph（"true"/"false"）。 */
  bodyMaterialApplied: "v14dBodySkinApplied",
  authority: "v14dFaceStaticAuthority",
} as const;

/**
 * 从 PMX 材质列表按权威材质名推导 Face 在"vertexCount>0 材质"中的 1-based pick ID。
 * 引擎 pick mask 的 materialId 只统计 vertexCount>0 的材质（1-based，0=无命中）。
 * 返回 null 表示未找到（门控失败，不硬编码回退）。
 */
export function v14dFaceStaticFacePickId(
  materials: readonly { name: string; vertexCount: number }[],
  faceName: string = V14D_FACE_MATERIAL_NAME,
): number | null {
  let pickId = 0;
  for (const mat of materials) {
    if (mat.vertexCount <= 0) continue;
    pickId += 1;
    if (mat.name === faceName) return pickId;
  }
  return null;
}

/** 按材质名推导 pick ID（同 v14dFaceStaticFacePickId 口径；用于 BodySkin 等非 Face 材质）。 */
export const v14dFaceStaticMaterialPickId = v14dFaceStaticFacePickId;

/**
 * faceStatic 资产注入（引擎 files 变体完全局部解析，不全局包装 fetch、无网络 404）。
 * 采集脚本经 page.route 把权威 PMX/纹理/VMD 从本地文件读成 File[] 注入
 * window.__v14dFaceStaticAssets；Face diffuse 用 faceOverride File 覆盖 face_d 逻辑名。
 * 用户场景可由 folder file input 选择权威 Koleda 目录得到同样的 File 列表。
 */
export type V14dFaceStaticAssetSource = {
  /** 权威 Koleda PMX 及其全部纹理/依赖的 File 列表（webkitRelativePath 保留相对路径）。 */
  modelFiles: File[];
  /** 权威 PMX File（modelFiles 中的 .pmx）。 */
  pmxFile: File;
  /** 权威 VMD File（frame120 姿态）。 */
  vmdFile: File;
  /** Face diffuse override（单一来源场景：normal=原始 face_d；composite/shadow=派生图，webkitRelativePath=face_d 键）。 */
  faceOverride: File | null;
  /** State2 packed mask File（实时合成模式注入，webkitRelativePath=V14D_STATE2_MASK_LOGICAL_PATH）。 */
  state2Mask?: File | null;
  /** 三模式各自的 Face diffuse 纹理（页面 UI 一次提供三张，运行时按模式选用；与 faceOverride 二选一）。 */
  faceTextures?: Partial<Record<V14dFaceStaticMode, File>>;
  /** 黄金帧烘焙纹理（bakedGolden 模式）：逐材质 baked_* File。真实 GPU 绑定由引擎
   *  materialDiffuseOverrides 在 setupMaterialsForInstance 前改 diffuseTextureIndex 完成；
   *  唯一逻辑键见 V14D_BAKED_BINDINGS[].logicalPath。 */
  bakedTextures?: Partial<Record<keyof typeof V14D_BAKED_TEXTURES, File>>;
};
