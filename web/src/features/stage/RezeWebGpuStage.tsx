"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  BODY_GRAPH,
  CLOTH_SMOOTH_GRAPH,
  DEFAULT_GRAPH,
  Engine,
  EYE_GRAPH,
  FACE_GRAPH,
  HAIR_GRAPH,
  METAL_GRAPH,
  Vec3,
  type ShaderGraph,
} from "reze-engine";

import type { MmdCameraSnapshot } from "@/lib/types";
import type { MMDStageHandle } from "@/features/stage/MMDStage";
import {
  type RezeBackgroundEffect,
  REZE_DESIGN_SCENE_DEFAULTS,
  REZE_K3_SCENE_DEFAULTS,
  REZE_SHINING_STARS_WGSL,
  resolveRezeGrade,
  type RezeGradePreset,
  type RezeSceneDebugSettings,
} from "@/features/stage/rezeDesignDefaults";
import { createRezeVmdRequestGuard } from "@/features/stage/rezeVmdRequestGuard.js";
import {
  applyRezeVmdIkPolicy,
  fetchRezeVmdIkPolicy,
  playRezeVmd,
  resetRezeModelToBindPose,
  setRezeVmdCompletionHandler,
} from "@/features/stage/rezeVmdPlayback.js";
import {
  captureV14dHairRuntimeState,
  restoreV14dHairRuntimeState,
  V14D_HAIR_AUTHORITATIVE_CAPTURE,
} from "@/features/stage/v14dHairCaptureState.js";
import {
  isKoledaMaskMaterialName,
  isKoledaModelIdentifier,
  selectKoledaClosedEyeMorphNames,
} from "@/features/stage/koledaDefaultAppearance.js";
import {
  analyzeV14dColorBaselineRois,
  createV14dColorBaselineResult,
  flushV14dDiagnosticBarrier,
  computeV14dMaterialWorldTriCentroids,
  classifyV14dMaterialRegions,
  classifyV14dVerticesByBoneRegion,
  makeV14dLinearImage,
  measureV14dRoiActualMeans,
  readV14dCanvasDisplay,
  readV14dColorBaselineMaterialMask,
  readV14dFaceExpandedTriUv,
  readV14dFaceExpandedTriUvDepth,
  readV14dFaceTriUvMask,
  readV14dProductionDrawCallSourceSnapshot,
  readV14dProductionSourceTriUv,
  readV14dColorBaselineResolveTargets,
  srgbToLinear,
  validateV14dColorBaselineScene,
  V14D_COLOR_BASELINE_CAMERA,
  V14D_COLOR_BASELINE_EPSILON,
  V14D_COLOR_BASELINE_FRAME,
  V14D_COLOR_BASELINE_FPS,
  V14D_COLOR_BASELINE_HEIGHT,
  V14D_COLOR_BASELINE_ROIS,
  V14D_COLOR_BASELINE_SECONDS,
  V14D_COLOR_BASELINE_WIDTH,
  type V14dAnimationEvidence,
  type V14dAnimationProgressEvidence,
  type V14dColorBaselineResult,
  type V14dHairTriUvSourceMode,
  type V14dNormalizedImage,
} from "@/features/stage/v14dColorBaseline";
import {
  findV14dDisplayChainDrawMatch,
  makeV14dDisplayChainDrawIdentityKey,
} from "@/features/stage/v14dDisplayChainEvidence.mjs";
import {
  V14D_FACE_MATERIAL_NAME,
  V14D_FACE_BASE_TEXTURE_NAME,
  V14D_FACE_STATIC_AUTHORITY,
  V14D_BAKED_BINDINGS,
  V14D_FACE_STATIC_BLEND,
  V14D_FACE_STATIC_CAMERA,
  V14D_FACE_STATIC_DATASET,
  V14D_FACE_STATIC_FPS,
  V14D_FACE_STATIC_FRAME,
  V14D_FACE_STATIC_ROI_NORM,
  V14D_FACE_STATIC_SECONDS,
  V14D_FACE_STATIC_SIZE,
  V14D_FACE_STATIC_STATE,
  v14dFaceStaticFacePickId,
  v14dFaceStaticTextureName,
  v14dFaceCameraWithOverride,
  v14dFaceStaticMaterialPickId,
  V14D_BODY_MATERIAL_NAME,
  V14D_HAIR_A_MATERIAL_NAME,
  V14D_HAIR_B_MATERIAL_NAME,
  V14D_BODY_SKIN_REGIONS,
  V14D_BODY_SKIN_BONE_REGIONS_V1,
  V14D_BODY_SKIN_BONE_REGION_IDS,
  V14D_STATE2_MASK_LOGICAL_PATH,
  type V14dFaceStaticAssetSource,
  type V14dFaceStaticMode,
  type V14dFaceCameraOverride,
} from "@/features/stage/v14dFaceStatic";
import {
  evaluateRezeK3V1Eligibility,
  resolveRezeK3SkinVariantActivation,
} from "@/features/stage/rezeSkinVariantPreference.js";
import {
  buildV14dSkinVariantStyleGroups,
  collectV14dSkinVariantBindingCounts,
  perturbV14dSkinVariantStyleGroups,
  V14D_BODY_LIVE_COMPOSITE_GRAPH,
  V14D_BODY_V1_COMPOSITE_GRAPH,
  V14D_FACE_V1_COMPOSITE_GRAPH,
  V14D_HAIR_V1_COMPOSITE_GRAPH,
  type BadSkinGraphKind,
} from "@/features/stage/v14dSkinVariantGraphs.js";

// RezeK3SkinVariant 共享类型权威：rezeSkinVariantPreference.types.d.ts（P0 第 3 项）。
import type { RezeK3SkinVariant } from "@/features/stage/rezeSkinVariantPreference.js";

declare global {
  interface Window {
    __v14dColorBaseline?: {
      capture: () => Promise<V14dColorBaselineResult>;
      getResult: () => V14dColorBaselineResult | null;
    };
    __v14dFaceStatic?: {
      capture: () => Promise<V14dFaceStaticCapture>;
      exportFaceMaskPng: () => Promise<string | null>;
      exportFaceUvPng: () => Promise<{
        png: string;
        width: number;
        height: number;
        faceMaterialId: number;
        uv: Float32Array;
        faceMask: Uint8Array;
      } | null>;
      /** 导出当前模式的 pre-tonemap HDR（线性、未过 composite tonemap/grade/gamma）
       *  逐像素浮点 RGB 与 Face mask，供 UV-direct Gate 用同口径线性值对账。 */
      exportFaceHdrFloat: () => Promise<{
        width: number;
        height: number;
        faceMaterialId: number;
        rgb: Float32Array;
        faceMask: Uint8Array;
      } | null>;
      /** 导出当前模式的最终显示字节（canvas sRGB 8-bit，已过 composite 显示变换）
       *  逐像素 RGB 与 Face mask。display-passthrough 下这些字节应与注入的
       *  显示域纹理字节一致（G1 色块 / G4 AgX 显示字节闭环的正式输入）。 */
      exportFaceDisplayCapture: () => Promise<{
        width: number;
        height: number;
        faceMaterialId: number;
        /** 逐像素最终显示字节 RGB（canvas sRGB 8-bit, length=width*height*3）。 */
        displayRgb: Uint8Array;
        /** 逐像素是否命中 Face 材质（0/1，未腐蚀）。 */
        faceMask: Uint8Array;
      } | null>;
      /** 逐像素导出任一 Face 材质名对应的 pick mask（供 Gate 划分保持性子区）。 */
      exportMaterialMaskByName: (materialName: string) => Promise<Uint8Array | null>;
      /** Stage 2B-M3：按材质名导出 pre-tonemap HDR 线性 RGB + 材质 pick mask（BodySkin ROI 对账）。 */
      exportMaterialHdrFloat: (materialName: string) => Promise<{
        width: number;
        height: number;
        materialName: string;
        pickId: number;
        rgb: Float32Array;
        mask: Uint8Array;
      } | null>;
      /**
       * Stage 2B-M3 修正轮（P0-4）：BodySkin 实际 draw-call 绑定证据（非 style-group 配置自证）。
       * 从引擎 modelInstances 读 BodySkin 材质的每个 draw call 的 groupId、该组的 compiled
       * pipeline 标识与 graph.name，证明 BodySkin 实际 draw call 走的是 V14D Body Skin Composite
       * pipeline（不是仅配置了 style-group）。漏绑/错 graph/错材质时 groupId/pipeline/graphName 不符。
       */
      exportBodySkinDrawBinding: () => {
        drawCalls: { materialName: string; groupId: string | null; hasPipeline: boolean; graphName: string | null }[];
        /** BodySkin 全部 draw call 都绑定到 V14D Body Skin Composite graph 且有 compiled pipeline。 */
        allBodySkinOnComposite: boolean;
      } | null;
      /** Stage 2B-M3 修正轮：三角形语义区域（triId+uv per pixel、世界质心、区域标签）。 */
      exportMaterialTriRegions: (
        materialName: string,
        /** 可选骨骼区域集合覆盖（仅 BodySkin 诊断/负测；生产省略，等价权威集合）。 */
        boneRegionOverride?: readonly (readonly number[])[],
      ) => Promise<{
        width: number;
        height: number;
        materialName: string;
        triCount: number;
        triId: Int32Array;
        uv: Float32Array;
        faceMask: Uint8Array;
        centroids: Float32Array;
        regionLabels: Int32Array;
        /** Stage 2B-M3.1：骨骼主导语义区域标签（BodySkin 专用；其余材质为 null）。 */
        boneRegionLabels: Int32Array | null;
        /** 与 boneRegionLabels 对应的区域 id 数组（标签值 = 该数组下标）。 */
        boneRegionIds: string[] | null;
        /** 骨骼区域集合版本（V14D_BODY_SKIN_BONE_REGIONS_V1.version）。 */
        boneRegionVersion: number | null;
        /** 诊断：运行时 skeleton 骨骼名表（索引序 = joints 索引序）。 */
        skeletonBoneNames: string[] | null;
        dominantBoneHistogram: Record<string, number> | null;
        regionDefs: { id: string; yMin: number; yMax: number; xSide: string }[];
      } | null>;
      /** 逐像素导出 Face 三角形 ID + 插值 UV（Stage 2B-M2 同口径对账，诊断专用）。 */
      exportFaceTriUv: () => Promise<{
        width: number;
        height: number;
        faceMaterialId: number;
        faceMaterialIndex: number;
        faceMaterialFirstIndex: number;
        faceTriangleCount: number;
        camera: { view: number[]; projection: number[] } | null;
        triId: Int32Array;
        uv: Float32Array;
        faceMask: Uint8Array;
      } | null>;
    };
    /** faceStatic 注入的权威资产集（File 形式，引擎 files 变体局部解析）。 */
    __v14dFaceStaticAssets?: V14dFaceStaticAssetSource;
  }
}

export type V14dFaceStaticCapture = {
  mode: V14dFaceStaticMode;
  frame: number;
  state: number;
  blend: number;
  cameraLocked: boolean;
  paused: boolean;
  texture: string;
  width: number;
  height: number;
  /** Face 材质名映射推导出的 pick ID；门控失败时为 null，不硬编码。 */
  faceMaterialId: number | null;
  faceMaterialName: string;
  /** 权威资产门控是否通过（PMX/VMD/派生纹理可追溯）。 */
  authorityOk: boolean;
  roi: { px: [number, number, number, number]; samples: number; faceSamples: number };
  /** 脸部 ROI (Face 材质 ID + 模型覆盖 + 深度前景) 的显示 sRGB 与线性均值。 */
  meanSrgb: [number, number, number] | null;
  meanLinear: [number, number, number] | null;
  /**
   * Stage 2B-M3：全身皮肤 ROI（Face + BodySkin）逐材质线性均值。
   * 每个 key=PMX 材质名（"Face"/"BodySkin"），值含 pickId/样本数/显示 sRGB 均值/
   * 线性均值与归一化屏幕 bbox（供身体四个近景 ROI 定位）。
   */
  skinRoi?: Record<string, {
    pickId: number;
    samples: number;
    meanSrgb: [number, number, number];
    meanLinear: [number, number, number];
    /** 该材质可见像素的归一化 bbox [x,y,w,h]（0..1）。 */
    bboxNorm: [number, number, number, number];
  }>;
  /**
   * Stage 2B-M3 修正轮：BodySkin 四区域语义统计（脖子/腰/左手/右手）。
   * 区域由三角形蒙皮后世界质心按 V14D_BODY_SKIN_REGIONS 划分（世界 y 带 + x 符号），
   * 再映射回屏幕像素 mask（可见三角形覆盖的像素）。每个区域独立给出样本数、
   * 覆盖率（区域像素/区域三角形可见像素）、显示 sRGB 与线性均值、屏幕 bbox。
   * 不是整块 BodySkin 均值；样本不足的区域如实缺失，不软通过。
   */
  bodySkinRegions?: Record<string, {
    /** 该区域的语义定义（世界坐标带 + x 符号）。 */
    def: { id: string; yMin: number; yMax: number; xSide: string };
    /** 该区域覆盖的三角形数（世界坐标分区命中）。 */
    triangles: number;
    /** 该区域三角形覆盖的屏幕像素数。 */
    samples: number;
    /** 覆盖率 = 区域可见像素 / 该材质总可见像素。 */
    coverage: number;
    meanSrgb: [number, number, number];
    meanLinear: [number, number, number];
    bboxNorm: [number, number, number, number];
  }>;
  error?: string;
};

type RezeStageProps = {
  modelUrl: string;
  modelIdentifier?: string;
  localModelImport?: {
    revision: number;
    files: File[];
    pmxFile: File;
  } | null;
  interaction: {
    mode?: "procedural" | "vmd";
    vmdUrl?: string;
    vmdLoopUrls?: string[];
    vmdLoopEmotionByUrl?: Record<string, string>;
    standbyVmdUrl?: string;
    loopGapMs?: number;
    loopMode?: "random" | "sequential";
    lockLowerBody?: boolean;
    disableCrossfade?: boolean;
    playbackRate?: number;
    vmdRequestId?: number;
  };
  backgroundEffect?: RezeBackgroundEffect;
  grade?: RezeGradePreset;
  gradeIntensity?: number;
  sceneSettings?: RezeSceneDebugSettings;
  /**
   * WebGPU 管线的默认场景。reze-k3 用明亮中性光（与 companion 页面一致），
   * reze-design 保持紫调舞台；上层显式传入 sceneSettings 时此预设被覆盖。
   */
  scenePreset?: "reze-design" | "reze-k3";
  /** 仅用于 V14D 材质迁移取证；默认关闭，不改变生产渲染路径。 */
  v14dUnlitDiagnostic?: boolean;
  /** 仅用于 V14D 三层颜色基线取证；默认关闭，不改变生产渲染路径。 */
  v14dColorBaseline?: boolean;
  /** 仅用于 V14D Face State 2 静态黄金帧预览；默认关闭，不改变生产渲染路径。 */
  v14dFaceStatic?: boolean;
  v14dFaceStaticMode?: V14dFaceStaticMode;
  /** 配准负测：shift=相机平移 +X 6 PMX 单位；null=不恢复相机（保持 boot 默认）。 */
  v14dFaceCameraOverride?: V14dFaceCameraOverride;
  /** 黄金帧诊断 ROI/pick/HDR 取样门控（仅 faceStatic 页面启用；与组件门控分离）。 */
  v14dFaceStaticGated?: boolean;
  /**
   * 生产 V1（V14D）皮肤变体开关（仅 reze-k3 + 权威克莱妲生效）。
   * "v1" 时在同一舞台运行时中启用 State2 实时合成（Face finalComposite +
   * BodySkin warm composite）；默认 "original" 保持现有生产渲染不变。
   * 与诊断 v14dFaceStatic 路径互斥：faceStatic 开启时本开关被忽略。
   */
  v14dSkinVariant?: RezeK3SkinVariant;
  /** true 时 WebGPU 画布透明，由页面 MIO CSS 背景透出；false 用场景背景色。 */
  transparentBackground?: boolean;
  cameraSnapshot?: MmdCameraSnapshot | null;
  onReadyChange?: (ready: boolean, detail?: string) => void;
  onInteractionComplete?: () => void;
  onInteractionError?: (error: { type: "vmd"; vmdUrl: string }) => void;
  onInteractionStarted?: () => void;
};

const DEFAULT_SETTINGS = REZE_DESIGN_SCENE_DEFAULTS;

function serializeV14dCaptureError(error: unknown, fallbackCode: string, fallbackClass: string) {
  const diagnostic = error as { code?: unknown; failureClass?: unknown } | null;
  return {
    error: error instanceof Error ? error.message : String(error),
    errorCode: typeof diagnostic?.code === "string" ? diagnostic.code : fallbackCode,
    errorClass: typeof diagnostic?.failureClass === "string" ? diagnostic.failureClass : fallbackClass,
  };
}

const MATERIAL_GRAPHS: Record<string, ShaderGraph> = {
  "默认": DEFAULT_GRAPH,
  "角色皮肤": BODY_GRAPH,
  "面部": FACE_GRAPH,
  "眼睛": EYE_GRAPH,
  "头发": HAIR_GRAPH,
  "柔滑布料": CLOTH_SMOOTH_GRAPH,
  "金属": METAL_GRAPH,
  "半透材质": CLOTH_SMOOTH_GRAPH,
};

/**
 * V14D 最小迁移 PoC 的诊断图。
 *
 * 这个图只把引擎已经绑定的 PMX diffuse texture 原样输出，不引入灯光、
 * 法线、球面贴图、toon、Fresnel 或材质高光。纹理绑定本身使用
 * `rgba8unorm-srgb`，因此这里不能再次手工做 sRGB 解码。
 */
const V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D Material Unlit Diagnostic",
  tags: ["diagnostic", "v14d", "unlit"],
  nodes: [{ id: "tex", type: "texture" }],
  links: [],
  output: { node: "tex", socket: "color" },
};

const V14D_UNLIT_MATERIAL_GROUPS = [
  {
    id: "v14d-unlit-body-skin",
    label: "V14D Unlit Skin",
    materials: ["BodySkin", "Face"],
  },
  {
    id: "v14d-unlit-white-clothes",
    label: "V14D Unlit White Clothes",
    materials: ["Cth1-Top"],
  },
  {
    id: "v14d-unlit-hair",
    label: "V14D Unlit Hair",
    materials: ["HairA", "HairB"],
    renderClass: "hair" as const,
  },
] as const;

/**
 * V14D Face State 2 静态预览图：只输出引擎已绑定的 Face diffuse 纹理
 * （该纹理由自定义 AssetReader 在 faceStatic 模式下重定向到预烘焙合成图）。
 * 与 Stage 1 unlit 同口径 —— 纯纹理采样，无灯光/法线/toon/AgX。
 */
const V14D_FACE_STATIC_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D Face Static State2",
  tags: ["diagnostic", "v14d", "face-static"],
  nodes: [{ id: "tex", type: "texture" }],
  links: [],
  output: { node: "tex", socket: "color" },
};

/**
 * V14D Face 静态 UV 调试图：只输出 Face 材质的插值 UV（R=u, G=v, B=0）。
 * 与 V14D_FACE_STATIC_GRAPH 同一条渲染管线、同一几何/相机/pick mask，
 * 只是 fragment 用 `input.uv` 替代纹理采样，供 UV-direct 逐纹素对账读取
 * 每个脸部像素在 Web 侧实际使用的 UV 坐标。仅诊断，不改变生产渲染。
 */
const V14D_FACE_UV_DEBUG_GRAPH_LEGACY: ShaderGraph = {
  version: 1,
  name: "V14D Face UV Debug",
  tags: ["diagnostic", "v14d", "face-static", "uv"],
  nodes: [{ id: "uv", type: "geometry" }],
  links: [],
  output: { node: "uv", socket: "uv" },
};

/**
 * 黄金帧几何验证图：所有材质统一输出 world_pos 归一化颜色
 * （(worldPos*0.05+0.5) 映射到可见色），用于肉眼核对相机/缩放对齐结果。
 * 只读几何节点，不采样纹理、不受材质影响。
 */
const V14D_FACE_STATIC_WORLD_POS_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D GF World Pos Debug",
  tags: ["diagnostic", "v14d", "face-static", "worldpos"],
  nodes: [{ id: "geo", type: "geometry" }],
  links: [],
  output: { node: "geo", socket: "world_pos" },
};

/**
 * 黄金帧材质验证图：所有材质统一输出 material_diffuse（无光照），
 * 用于区分「几何/相机没对齐」与「光照/材质输出为黑」。
 */
const V14D_FACE_STATIC_DIFFUSE_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D GF Diffuse Flat",
  tags: ["diagnostic", "v14d", "face-static", "diffuse"],
  nodes: [{ id: "mat", type: "material_diffuse" }],
  links: [],
  output: { node: "mat", socket: "color" },
};

/**
 * V14D State2 实时合成图（Stage 2B-M1）：Face 材质逐像素从「原始 face_d +
 * State2 packed mask（group(2) binding(5)，rgba8unorm 线性视图）」实时执行
 * Blender 取证的 warm/art/fringe 合成，不使用整张预烘焙脸图。输出视图为
 * shadowFactor（乘法阴影因子）；合成图见 V14D_FACE_LIVE_COMPOSITE_GRAPH。
 * helper 由引擎补丁五在编译 tags 含 v14d-state2-face 的 graph 时注入。
 */
const V14D_FACE_LIVE_SHADOW_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D Face State2 Live ShadowFactor",
  tags: ["diagnostic", "v14d", "face-static", "v14d-state2-face"],
  nodes: [
    { id: "warm", type: "rgb", inputs: { color: [1.0, 0.935, 0.89] } },
  ],
  links: [],
  output: { node: "warm", socket: "color" },
};

// 实时视图 graph 的最终输出由引擎补丁五按 graph.name 精确覆写
// （v14dState2OverrideFsBody）：ShadowFactor → v14d_state2_view_shadow()，
// Composite → v14d_state2_view_composite()。warm rgb 节点只是编译占位，
// 不在最终 WGSL 生效；公式常量由引擎补丁五的 WGSL helper 提供（权威 blend 取证）。

/**
 * V14D State2 实时 FinalComposite 视图：face_d（线性解码）× warm × shadowFactor。
 */
const V14D_FACE_LIVE_COMPOSITE_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D Face State2 Live Composite",
  tags: ["diagnostic", "v14d", "face-static", "v14d-state2-face"],
  nodes: [
    { id: "warm", type: "rgb", inputs: { color: [1.0, 0.935, 0.89] } },
  ],
  links: [],
  output: { node: "warm", socket: "color" },
};

// 生产 V1 graph 常量、style group 构建与负测扰动收敛到 v14dSkinVariantGraphs.js
// 纯模块（2026-09-03 修正轮抽出），供 node --test 直接驱动负测、消除 boot/探针
// 两处 draw-call 深遍历重复。生产接线（applyStyleGroups/dataset 证据）留在本组件。

/**
 * 从已有 localModelImport（用户选择的克莱妲模型目录 File[]）解析 V1 资产：
 * 复用目录内全部文件，只额外定位 State2 mask（按 webkitRelativePath 后缀匹配
 * 权威 mask 文件名 v14d-01234-face-shadow-state-2.png）。mask 缺失返回 null，
 * 由调用方安全回退 original。不引入全局 fetch monkeypatch，不重复选 PMX/纹理。
 */
function resolveV14dV1AssetsFromImport(localModelImport: {
  files: File[];
  pmxFile: File;
}): { files: File[]; pmxFile: File; state2Mask: File } | null {
  // 资格判定收敛为单一领域谓词 evaluateRezeK3V1Eligibility（P0-2/P1），
  // 不再在此重复 PMX/mask 两套检查。
  const eligibility = evaluateRezeK3V1Eligibility(localModelImport);
  if (!eligibility.eligible || !eligibility.state2Mask) return null;
  const maskFile = eligibility.state2Mask;
  // 以唯一逻辑键重建 mask File，引擎补丁按此前缀建立独立 rgba8unorm 纹理。
  const state2Mask = new File([maskFile], "state2.png", { type: "image/png" });
  Object.defineProperty(state2Mask, "webkitRelativePath", { value: V14D_STATE2_MASK_LOGICAL_PATH });
  return {
    files: [...localModelImport.files, state2Mask],
    pmxFile: localModelImport.pmxFile,
    state2Mask,
  };
}

type RezeStyleGroup = ReturnType<Engine["getStyleGroups"]>[number];

function buildV14dUnlitStyleGroups(
  originalGroups: readonly RezeStyleGroup[],
  modelMaterialNames: ReadonlySet<string>,
  excludeFace = false,
) {
  const targetMaterials = new Set<string>(
    V14D_UNLIT_MATERIAL_GROUPS.flatMap((group) => group.materials),
  );
  // faceStatic：Face 由 face-static 块单独套纯纹理 graph（三模式 A/B），
  // 不进入全局 unlit 分组。
  if (excludeFace) targetMaterials.delete(V14D_FACE_MATERIAL_NAME);
  const retainedGroups = originalGroups
    .map((group) => ({
      ...group,
      materials: group.materials.filter((materialName) => !targetMaterials.has(materialName)),
    }))
    .filter((group) => group.materials.length > 0);
  const appliedGroups: string[] = [];
  const unknownMaterials: string[] = [];
  const unlitGroups: RezeStyleGroup[] = [];

  for (const group of V14D_UNLIT_MATERIAL_GROUPS) {
    const matchedMaterials = group.materials.filter((materialName) => modelMaterialNames.has(materialName));
    unknownMaterials.push(...group.materials.filter((materialName) => !modelMaterialNames.has(materialName)));
    if (!matchedMaterials.length) continue;
    unlitGroups.push({
      id: group.id,
      label: group.label,
      materials: matchedMaterials,
      graph: V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH,
      ...("renderClass" in group && group.renderClass ? { renderClass: group.renderClass } : {}),
    });
    appliedGroups.push(group.id);
  }

  return {
    groups: [...retainedGroups, ...unlitGroups],
    appliedGroups,
    unknownMaterials,
  };
}

async function applyV14dUnlitStyleGroups(
  engine: Engine,
  modelMaterialNames: ReadonlySet<string>,
  originalGroups: readonly RezeStyleGroup[],
) {
  const plan = buildV14dUnlitStyleGroups(originalGroups, modelMaterialNames);
  const result = await engine.applyStyleGroups("companion", plan.groups);
  if (!result.ok) {
    const diagnostics = result.groups
      .flatMap((group) => group.diagnostics.map((diagnostic) => diagnostic.message))
      .join("; ");
    throw new Error(`V14D Unlit 诊断图编译失败：${diagnostics || "unknown error"}`);
  }
  return {
    ...plan,
    result,
  };
}

function hexToLinearVec3(hex: string): Vec3 {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean, 16);
  const channel = (shift: number) => {
    const srgb = ((value >> shift) & 0xff) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return new Vec3(channel(16), channel(8), channel(0));
}

function hexToSrgbVec3(hex: string): Vec3 {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean, 16);
  return new Vec3(((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255);
}

function azElToDirection(azimuth: number, elevation: number): Vec3 {
  const azimuthRad = (azimuth * Math.PI) / 180;
  const elevationRad = (elevation * Math.PI) / 180;
  return new Vec3(
    -Math.cos(elevationRad) * Math.sin(azimuthRad),
    -Math.sin(elevationRad),
    -Math.cos(elevationRad) * Math.cos(azimuthRad),
  );
}

function stableMaterialId(index: number): string {
  return `reze:material:${index}`;
}

type RezeCameraRuntime = {
  alpha: number;
  beta: number;
  radius: number;
  target: { x: number; y: number; z: number };
  fov: number;
  getPosition: () => { x: number; y: number; z: number };
  setInputLocked: (locked: boolean) => void;
};

function readRezeCamera(engine: Engine | null): RezeCameraRuntime | null {
  const camera = (engine as unknown as { camera?: RezeCameraRuntime } | null)?.camera;
  if (
    !camera ||
    typeof camera.getPosition !== "function" ||
    typeof camera.setInputLocked !== "function" ||
    !Number.isFinite(camera.radius) ||
    !Number.isFinite(camera.alpha) ||
    !Number.isFinite(camera.beta)
  ) {
    return null;
  }
  return camera;
}

function captureRezeCameraSnapshot(engine: Engine | null): MmdCameraSnapshot | null {
  const camera = readRezeCamera(engine);
  if (!camera) return null;
  const position = camera.getPosition();
  const target = camera.target;
  const fov = Number.isFinite(camera.fov) ? (camera.fov * 180) / Math.PI : 45;
  if (
    ![position.x, position.y, position.z, target.x, target.y, target.z, fov].every(Number.isFinite)
  ) {
    return null;
  }
  return {
    fov,
    position: [position.x, position.y, position.z],
    target: [target.x, target.y, target.z],
    locked: false,
  };
}

function applyRezeCameraSnapshot(engine: Engine | null, snapshot: MmdCameraSnapshot | null): boolean {
  if (!snapshot) return false;
  const camera = readRezeCamera(engine);
  if (!camera) return false;
  const [positionX, positionY, positionZ] = snapshot.position;
  const [targetX, targetY, targetZ] = snapshot.target;
  const offsetX = positionX - targetX;
  const offsetY = positionY - targetY;
  const offsetZ = positionZ - targetZ;
  const distance = Math.hypot(offsetX, offsetY, offsetZ);
  if (!Number.isFinite(distance) || distance <= 0) return false;
  const beta = Math.acos(Math.max(-1, Math.min(1, offsetY / distance)));
  const alpha = Math.atan2(offsetX, offsetZ);
  if (!Number.isFinite(alpha) || !Number.isFinite(beta)) return false;

  engine?.setCameraTarget(new Vec3(targetX, targetY, targetZ));
  engine?.setCameraDistance(distance);
  engine?.setCameraAlpha(alpha);
  engine?.setCameraBeta(beta);
  if (Number.isFinite(snapshot.fov)) {
    camera.fov = (snapshot.fov * Math.PI) / 180;
  }
  return true;
}

function isKoledaFaceOrBodyMaterialName(materialName: string): boolean {
  const name = materialName.toLowerCase();
  return (
    name.includes("body") ||
    name.includes("face") ||
    name.includes("skin") ||
    name.includes("肌") ||
    name.includes("皮肤") ||
    name.includes("顔") ||
    name.includes("颜") ||
    name.includes("顏") ||
    name.includes("脸") ||
    name.includes("臉")
  );
}

function createEmptyV14dColorBaselineReadback(): V14dColorBaselineResult["readback"] {
  return {
    roiReadback: false,
    linearHdrReadback: false,
    finalDisplayReadback: false,
    materialMaskReadback: false,
    materialMaskSource: null,
    materialMaskSourceFormat: null,
    baseColorSource: null,
    linearHdrSource: null,
    hdrSourceFormat: null,
    maskSourceFormat: null,
    width: V14D_COLOR_BASELINE_WIDTH,
    height: V14D_COLOR_BASELINE_HEIGHT,
    rowPitch: { hdr: null, mask: null },
    nanCount: null,
    infCount: null,
  };
}

function readV14dAnimationProgress(
  model: Awaited<ReturnType<Engine["loadModel"]>> | null,
): V14dAnimationProgressEvidence | null {
  if (!model || typeof model.getAnimationProgress !== "function") return null;
  const progress = model.getAnimationProgress();
  const currentSeconds = Number(progress.current);
  const durationSeconds = Number(progress.duration);
  const percentage = Number(progress.percentage);
  if (![currentSeconds, durationSeconds, percentage].every(Number.isFinite)) return null;
  const currentFrame = currentSeconds * V14D_COLOR_BASELINE_FPS;
  return {
    animationName: progress.animationName ?? null,
    currentSeconds,
    durationSeconds,
    percentage,
    currentFrame,
    expectedFrame: V14D_COLOR_BASELINE_FRAME,
    frameError: currentFrame - V14D_COLOR_BASELINE_FRAME,
    looping: Boolean(progress.looping),
    playing: Boolean(progress.playing),
    paused: Boolean(progress.paused),
  };
}

function createV14dAnimationEvidence(
  beforeRenderFrame: V14dAnimationProgressEvidence | null,
  afterBaseColorRenderFrame: V14dAnimationProgressEvidence | null,
  afterLinearHdrRenderFrame: V14dAnimationProgressEvidence | null,
): V14dAnimationEvidence {
  const samples = [
    beforeRenderFrame,
    afterBaseColorRenderFrame,
    afterLinearHdrRenderFrame,
  ].filter((sample): sample is V14dAnimationProgressEvidence => sample !== null);
  const renderFrameStable =
    samples.length >= 2 &&
    samples.every((sample) => Math.abs(sample.frameError) <= V14D_COLOR_BASELINE_EPSILON) &&
    samples.every(
      (sample) =>
        Math.abs(sample.currentSeconds - samples[0].currentSeconds) <= V14D_COLOR_BASELINE_EPSILON,
    );
  return {
    beforeRenderFrame,
    afterBaseColorRenderFrame,
    afterLinearHdrRenderFrame,
    expectedFrame: V14D_COLOR_BASELINE_FRAME,
    fps: V14D_COLOR_BASELINE_FPS,
    renderFrameStable,
    frame120Verified:
      samples.length > 0 &&
      samples.every((sample) => Math.abs(sample.frameError) <= V14D_COLOR_BASELINE_EPSILON) &&
      samples.every((sample) => sample.paused && !sample.playing),
  };
}

export const RezeWebGpuStage = forwardRef<MMDStageHandle, RezeStageProps>(function RezeWebGpuStage(
  { modelUrl, modelIdentifier = "", localModelImport = null, interaction, backgroundEffect = "Shining Stars", grade = "中性", gradeIntensity = 1, sceneSettings, scenePreset = "reze-design", v14dUnlitDiagnostic = false, v14dColorBaseline = false, v14dFaceStatic = false, v14dFaceStaticMode = "normal", v14dFaceStaticGated = false, v14dFaceCameraOverride = null, transparentBackground = false, cameraSnapshot = null, onReadyChange, onInteractionComplete, onInteractionError, onInteractionStarted, v14dSkinVariant = "original" },
  ref,
) {
  const pipelineDefaultSettings = scenePreset === "reze-k3" ? REZE_K3_SCENE_DEFAULTS : DEFAULT_SETTINGS;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<{ state: "loading" | "ready" | "error"; detail: string }>({
    state: "loading",
    detail: "正在初始化 reze-engine WebGPU…",
  });
  const engineRef = useRef<Engine | null>(null);
  const engineReadyRef = useRef(false);
  const defaultIkEnabledRef = useRef(true);
  const settingsRef = useRef<RezeSceneDebugSettings>(DEFAULT_SETTINGS);
  const cameraSnapshotRef = useRef<MmdCameraSnapshot | null>(cameraSnapshot);
  const modelRef = useRef<Awaited<ReturnType<Engine["loadModel"]>> | null>(null);
  const materialStateRef = useRef(new Map<string, { visible: boolean; preset: string }>());
  const currentVmdUrlRef = useRef("");
  // 进度镜像 rAF 清理句柄（验收探针用，effect 卸载时取消循环）。
  const vmdPlaybackMirrorCleanupRef = useRef<(() => void) | null>(null);
  // 验收探针竞态守卫令牌（仅验收路径使用）：最后一次 playVmd(raceKey) 的令牌，
  // 用于判定较慢完成的旧请求并让其在任何副作用前无副作用退出。
  const vmdProbeRaceTokenRef = useRef<{ key: string } | null>(null);
  const lastLoopVmdUrlRef = useRef("");
  const vmdCompletionFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vmdRequestGuardRef = useRef(createRezeVmdRequestGuard());
  const vmdIkPolicyCacheRef = useRef(new Map<string, ReturnType<typeof fetchRezeVmdIkPolicy>>());
  const v14dColorBaselineRef = useRef(v14dColorBaseline);
  const v14dFaceStaticRef = useRef(v14dFaceStatic);
  const v14dFaceCameraFreeRef = useRef(false);
  // 黄金帧组件/材质门控（Face unlit graph、暗背景等）与诊断 ROI 门控分离：
  // 画面始终按票据纵切渲染；pick/HDR 诊断只在显式诊断模式下启用，避免
  // 远景可见构图的取样口径被锁定在近景脸部 ROI 上。
  const v14dFaceStaticGatedRef = useRef(v14dFaceStaticGated);
  const baselineOriginalStyleGroupsRef = useRef<RezeStyleGroup[] | null>(null);
  const baselineResultRef = useRef<V14dColorBaselineResult | null>(null);
  const baselineCapturePromiseRef = useRef<Promise<V14dColorBaselineResult> | null>(null);
  const baselineCaptureFnRef = useRef<(() => Promise<V14dColorBaselineResult>) | null>(null);
  const baselineVmdLoadedRef = useRef(false);
  const hairTriUvCaptureIdRef = useRef(0);
  const interactionRef = useRef(interaction);
  const backgroundEffectRef = useRef<RezeBackgroundEffect>(backgroundEffect);
  const gradeRef = useRef<RezeGradePreset>(grade);
  const gradeIntensityRef = useRef(gradeIntensity);
  const transparentBackgroundRef = useRef(transparentBackground);
  const onReadyChangeRef = useRef(onReadyChange);
  const onInteractionCompleteRef = useRef(onInteractionComplete);
  const onInteractionErrorRef = useRef(onInteractionError);
  onInteractionErrorRef.current = onInteractionError;
  const onInteractionStartedRef = useRef(onInteractionStarted);
  onInteractionStartedRef.current = onInteractionStarted;
  // 生产 V1 皮肤变体：v1 且非 faceStatic 诊断时在 boot 内启用。
  // 资格（克莱妲权威 PMX）与 mask 解析在 boot 中判定；解析失败安全回退 original。
  const v1Requested = v14dSkinVariant === "v1" && !v14dFaceStatic;
  interactionRef.current = interaction;
  v14dColorBaselineRef.current = v14dColorBaseline;
  v14dFaceStaticRef.current = v14dFaceStatic;
  v14dFaceStaticGatedRef.current = v14dFaceStaticGated;
  backgroundEffectRef.current = backgroundEffect;
  gradeRef.current = grade;
  gradeIntensityRef.current = gradeIntensity;
  transparentBackgroundRef.current = transparentBackground;
  cameraSnapshotRef.current = cameraSnapshot;
  onReadyChangeRef.current = onReadyChange;
  onInteractionCompleteRef.current = onInteractionComplete;

  const reportStatus = (state: "loading" | "ready" | "error", detail: string) => {
    if (canvasRef.current) {
      canvasRef.current.dataset.webgpuStatus = state;
      canvasRef.current.dataset.webgpuDetail = detail;
    }
    setRuntimeStatus({ state, detail });
    onReadyChangeRef.current?.(state === "ready", detail);
  };

  const applyKoledaDefaultAppearance = (model: Awaited<ReturnType<Engine["loadModel"]>>) => {
    // faceStatic：权威 PMX 已强门控为 Koleda，外观/形变锁定与 Koleda 判定不依赖外部
    // modelIdentifier/modelUrl（该模式下未传入 target modelUrl），强制视为 Koleda。
    const enabled =
      v14dFaceStatic || isKoledaModelIdentifier(modelIdentifier, modelUrl, localModelImport?.pmxFile?.name);
    if (!enabled) return;

    for (const [index, material] of model.getMaterials().entries()) {
      if (!isKoledaMaskMaterialName(material.name)) continue;
      engineRef.current?.setMaterialVisible("companion", material.name, false);
      materialStateRef.current.set(stableMaterialId(index), { visible: false, preset: "默认" });
    }

    // 眼部由动作采样管理；默认外观只处理材质，不在每帧重写闭眼权重。
  };

  const clearVmdCompletionFallback = () => {
    if (vmdCompletionFallbackTimerRef.current === null) return;
    globalThis.clearTimeout(vmdCompletionFallbackTimerRef.current);
    vmdCompletionFallbackTimerRef.current = null;
    // 清理证据（仅验收用）：记录兜底已被清除、当前不再 armed。
    if (canvasRef.current) canvasRef.current.dataset.vmdCompletionFallbackArmed = "false";
  };

  const readRezeVmdIkPolicy = async (url: string) => {
    let pending = vmdIkPolicyCacheRef.current.get(url);
    if (!pending) {
      pending = fetchRezeVmdIkPolicy(url);
      vmdIkPolicyCacheRef.current.set(url, pending);
    }
    try {
      return await pending;
    } catch (error) {
      vmdIkPolicyCacheRef.current.delete(url);
      console.warn("[reze-vmd] 无法读取 VMD IK 状态，保持舞台默认 IK", error);
      return {
        mode: "unavailable",
        engineIkEnabled: null,
        ikFrameCount: 0,
        footIkEntryCount: 0,
      };
    }
  };

  const applyVmdIkPolicy = (
    engine: Engine,
    policy: Awaited<ReturnType<typeof readRezeVmdIkPolicy>>,
  ) => {
    const enabled = applyRezeVmdIkPolicy(engine, policy, defaultIkEnabledRef.current);
    if (canvasRef.current) {
      canvasRef.current.dataset.vmdIkPolicy = policy.mode;
      canvasRef.current.dataset.vmdIkEnabled = String(enabled);
      canvasRef.current.dataset.vmdIkLastPolicy = policy.mode;
      canvasRef.current.dataset.vmdIkLastEnabled = String(enabled);
    }
    return enabled;
  };

  const restoreDefaultIk = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setIKEnabled(defaultIkEnabledRef.current);
    if (canvasRef.current) {
      canvasRef.current.dataset.vmdIkPolicy = "default";
      canvasRef.current.dataset.vmdIkEnabled = String(defaultIkEnabledRef.current);
    }
  };

  const handleRezeVmdFinished = (
    model: Awaited<ReturnType<Engine["loadModel"]>>,
    finishedName: string,
  ) => {
    // 身份/模型有效性校验必须放在任何 clear/count/loop/reset/complete 副作用之前（P0-1）。
    // 旧动作/错误 finishedName 的回调不得清除当前新动作已 arm 的 fallback，也不得计数。
    const currentName = currentVmdUrlRef.current.split("/").pop();
    if (!currentName || currentName !== finishedName || model !== modelRef.current) return;
    // 仅匹配当前动作的回调才可清当前 fallback 并继续后续完成流程。
    clearVmdCompletionFallback();
    // 可判别完成证据（先验身份再计数，回归 P0）：仅当回调的 finishedName 就是当前
    // 动作时才自增，过期/错误名称的回调不得充当完成证据。供验收区分「真播完触发
    // 完成回调」与「仅超时后 !playing」。
    if (canvasRef.current) {
      const c = canvasRef.current;
      c.dataset.vmdNaturalFinishCount = String(Number(c.dataset.vmdNaturalFinishCount || 0) + 1);
      c.dataset.vmdNaturalFinishName = finishedName;
    }

    const activeInteraction = interactionRef.current;
    const loopUrls = Array.from(new Set((activeInteraction?.vmdLoopUrls || []).filter(Boolean)));
    if (loopUrls.length) {
      const finishedUrl = loopUrls.find((url) => url.split("/").pop() === finishedName) || "";
      const nextUrl =
        activeInteraction?.loopMode === "sequential"
          ? loopUrls[(Math.max(0, loopUrls.indexOf(finishedUrl)) + 1) % loopUrls.length]
          : (() => {
              const candidates = loopUrls.filter((url) => url !== finishedUrl);
              const pool = candidates.length ? candidates : loopUrls;
              return pool[Math.floor(Math.random() * pool.length)];
            })();
      if (!nextUrl) return;
      const nextName = nextUrl.split("/").pop() || "motion.vmd";
      const loopRequestId = vmdRequestGuardRef.current.begin();
      void (async () => {
        try {
          const [policy] = await Promise.all([
            readRezeVmdIkPolicy(nextUrl),
            model.loadVmd(nextName, nextUrl),
          ]);
          if (model !== modelRef.current || !vmdRequestGuardRef.current.isCurrent(loopRequestId)) return;
          const engine = engineRef.current;
          if (!engine) return;
          applyVmdIkPolicy(engine, policy);
          playRezeVmd(model, nextName, { preserveCurrentPose: true });
          currentVmdUrlRef.current = nextUrl;
          lastLoopVmdUrlRef.current = nextUrl;
          armRezeVmdCompletionFallback(model, nextName, nextUrl);
          engine.resetPhysics();
        } catch (error) {
          reportStatus("error", `循环动作切换失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
      return;
    }

    // 单次动作的 VMD 可能只有第 0 帧；reze-engine 对零时长剪辑不会派发
    // animationState.onEnd。自然结束和兜底计时器均通知页面恢复待机。
    // 保留最后一帧，交由下一动作衔接；完成回调不插入绑定姿势。
    onInteractionCompleteRef.current?.();
  };

  const armRezeVmdCompletionFallback = (
    model: Awaited<ReturnType<Engine["loadModel"]>>,
    name: string,
    url: string,
  ) => {
    clearVmdCompletionFallback();
    const durationSeconds = Math.max(0, Number(model.getAnimationProgress?.().duration) || 0);
    const delayMs = durationSeconds > 0 ? Math.ceil(durationSeconds * 1000) + 350 : 80;
    if (canvasRef.current) {
      canvasRef.current.dataset.vmdCompletionFallbackDelay = String(delayMs);
      canvasRef.current.dataset.vmdCompletionFallbackFired = "false";
      canvasRef.current.dataset.vmdCompletionFallbackArmed = "true"; // 兜底已 arm（仅验收证据）
    }
    vmdCompletionFallbackTimerRef.current = globalThis.setTimeout(() => {
      vmdCompletionFallbackTimerRef.current = null;
      if (canvasRef.current) {
        canvasRef.current.dataset.vmdCompletionFallbackFired = "true";
        canvasRef.current.dataset.vmdCompletionFallbackArmed = "false"; // 兜底已触发，不再 armed
      }
      if (model !== modelRef.current || currentVmdUrlRef.current !== url) return;
      handleRezeVmdFinished(model, name);
    }, delayMs);
  };

  const applySceneSettings = (next: RezeSceneDebugSettings) => {
    settingsRef.current = { ...DEFAULT_SETTINGS, ...next };
    const engine = engineRef.current;
    if (!engine || !engineReadyRef.current) return { ...settingsRef.current };
    const settings = settingsRef.current;
    engine.setWorld({ color: hexToLinearVec3(settings.worldColor), strength: settings.ambientIntensity });
    engine.setSun({
      color: hexToLinearVec3(settings.sunColor),
      strength: settings.keyIntensity,
      direction: azElToDirection(settings.sunAzimuth, settings.sunElevation),
    });
    engine.setBloomOptions({
      enabled: settings.bloomStrength > 0,
      threshold: settings.bloomThreshold,
      knee: settings.bloomKnee,
      radius: settings.bloomRadius,
      intensity: settings.bloomStrength,
      color: hexToLinearVec3(settings.bloomColor),
    });
    engine.setBackgroundColor(transparentBackgroundRef.current ? null : hexToSrgbVec3(settings.backgroundColor));
    engine.setCameraTarget(new Vec3(settings.cameraTargetX, settings.cameraTargetY, settings.cameraTargetZ));
    engine.setCameraDistance(settings.cameraDistance);
    engine.addGround({
      diffuseColor: hexToLinearVec3(settings.groundColor),
      opacity: settings.groundOpacity,
      shadowStrength: settings.groundShadow ? 1 : 0,
      gridLineOpacity: settings.groundGridEnabled ? 0.4 : 0,
      gridLineColor: hexToLinearVec3(settings.groundGridColor),
      width: settings.groundSize,
      height: settings.groundSize,
      fadeStart: settings.groundSize * (10 / 160),
      fadeEnd: settings.groundSize * (80 / 160),
    });
    return { ...settings };
  };

  const applyGrade = (preset: RezeGradePreset, intensity: number) => {
    const engine = engineRef.current;
    if (!engine || !engineReadyRef.current) return null;
    const cdl = resolveRezeGrade(preset, intensity);
    engine.setColorGrading({
      shadows: hexToSrgbVec3(cdl.shadows),
      midtones: hexToSrgbVec3(cdl.midtones),
      highlights: hexToSrgbVec3(cdl.highlights),
      contrast: cdl.contrast,
      saturation: cdl.saturation,
    });
    if (canvasRef.current) {
      canvasRef.current.dataset.rezeGrade = preset;
      canvasRef.current.dataset.rezeGradeIntensity = String(intensity);
    }
    return { preset, intensity };
  };

  const restorePersistedCamera = (snapshot: MmdCameraSnapshot | null = cameraSnapshotRef.current) => {
    const engine = engineRef.current;
    if (!engine || !engineReadyRef.current || !snapshot) return null;
    if (!applyRezeCameraSnapshot(engine, snapshot)) return null;
    settingsRef.current = {
      ...settingsRef.current,
      cameraDistance: Math.hypot(
        snapshot.position[0] - snapshot.target[0],
        snapshot.position[1] - snapshot.target[1],
        snapshot.position[2] - snapshot.target[2],
      ),
      cameraTargetX: snapshot.target[0],
      cameraTargetY: snapshot.target[1],
      cameraTargetZ: snapshot.target[2],
    };
    return captureRezeCameraSnapshot(engine);
  };

  const updateV14dFaceCameraDataset = (locked: boolean) => {
    const canvas = canvasRef.current;
    const snapshot = captureRezeCameraSnapshot(engineRef.current);
    if (!canvas || !snapshot) return snapshot;
    canvas.dataset[V14D_FACE_STATIC_DATASET.cameraLocked] = String(locked);
    canvas.dataset[V14D_FACE_STATIC_DATASET.cameraFov] = String(snapshot.fov);
    canvas.dataset[V14D_FACE_STATIC_DATASET.cameraPos] = snapshot.position.join(",");
    canvas.dataset.v14dFaceCameraTarget = snapshot.target.join(",");
    return snapshot;
  };

  const updateV14dColorBaselineDataset = (result: V14dColorBaselineResult) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.v14dColorBaseline = "true";
    canvas.dataset.v14dColorBaselineStatus = result.status;
    canvas.dataset.v14dColorBaselineScene = result.scene.status;
    canvas.dataset.v14dColorBaselineRoiReadback = String(result.readback.roiReadback);
    canvas.dataset.v14dColorBaselineLinearHdrReadback = String(result.readback.linearHdrReadback);
    canvas.dataset.v14dColorBaselineFinalDisplayReadback = String(result.readback.finalDisplayReadback);
    canvas.dataset.v14dColorBaselineMaterialMaskReadback = String(result.readback.materialMaskReadback);
    canvas.dataset.v14dColorBaselineMaterialMaskSource = result.readback.materialMaskSource || "";
    canvas.dataset.v14dColorBaselineMaterialMaskSourceFormat = result.readback.materialMaskSourceFormat || "";
    canvas.dataset.v14dColorBaselineFirstDivergence = result.firstDivergenceLevel || result.firstDivergenceStatus;
    canvas.dataset.v14dColorBaselineVmdLoaded = String(result.input.vmdLoaded);
    canvas.dataset.v14dColorBaselineRenderLoopStopped = String(result.input.renderLoopStopped);
    canvas.dataset.v14dColorBaselineBaseColorSource = result.readback.baseColorSource || "";
    canvas.dataset.v14dColorBaselineLinearHdrSource = result.readback.linearHdrSource || "";
    canvas.dataset.v14dColorBaselineHdrSourceFormat = result.readback.hdrSourceFormat || "";
    canvas.dataset.v14dColorBaselineMaskSourceFormat = result.readback.maskSourceFormat || "";
    canvas.dataset.v14dColorBaselineNanCount =
      result.readback.nanCount === null ? "" : String(result.readback.nanCount);
    canvas.dataset.v14dColorBaselineInfCount =
      result.readback.infCount === null ? "" : String(result.readback.infCount);
    const animation = result.input.animation;
    const finalProgress = animation.afterLinearHdrRenderFrame ?? animation.beforeRenderFrame;
    canvas.dataset.v14dColorBaselineAnimationName = finalProgress?.animationName || "";
    canvas.dataset.v14dColorBaselineAnimationCurrentSeconds =
      finalProgress ? String(finalProgress.currentSeconds) : "";
    canvas.dataset.v14dColorBaselineAnimationDurationSeconds =
      finalProgress ? String(finalProgress.durationSeconds) : "";
    canvas.dataset.v14dColorBaselineAnimationCurrentFrame =
      finalProgress ? String(finalProgress.currentFrame) : "";
    canvas.dataset.v14dColorBaselineAnimationPlaying =
      finalProgress ? String(finalProgress.playing) : "";
    canvas.dataset.v14dColorBaselineAnimationPaused =
      finalProgress ? String(finalProgress.paused) : "";
    canvas.dataset.v14dColorBaselineAnimationFrame120Verified = String(animation.frame120Verified);
    canvas.dataset.v14dColorBaselineAnimationRenderFrameStable = String(animation.renderFrameStable);
  };

  const createV14dColorBaselineInput = (
    animation = createV14dAnimationEvidence(null, null, null),
  ) => ({
    width: V14D_COLOR_BASELINE_WIDTH,
    height: V14D_COLOR_BASELINE_HEIGHT,
    frame: V14D_COLOR_BASELINE_FRAME,
    fps: V14D_COLOR_BASELINE_FPS,
    seconds: V14D_COLOR_BASELINE_SECONDS,
    camera: V14D_COLOR_BASELINE_CAMERA,
    vmdUrl: interactionRef.current.vmdUrl || "",
    vmdLoaded: baselineVmdLoadedRef.current,
    renderLoopStopped: true,
    renderFrameDeltaSeconds: 0 as const,
    animation,
  });

  const captureV14dColorBaseline = (): Promise<V14dColorBaselineResult> => {
    if (!v14dColorBaselineRef.current) {
      return Promise.reject(new Error("V14D 颜色基线入口未启用，请使用 v14dColorBaseline=1。"));
    }
    const pending = baselineCapturePromiseRef.current;
    if (pending) return pending;

    const promise = (async () => {
      const engine = engineRef.current;
      const model = modelRef.current;
      const canvas = canvasRef.current;
      let input = createV14dColorBaselineInput();
      const scene = validateV14dColorBaselineScene(settingsRef.current);
      const readback = createEmptyV14dColorBaselineReadback();
      if (!engine || !model || !canvas || !engineReadyRef.current) {
        const result = createV14dColorBaselineResult({
          status: "error",
          scene,
          input,
          readback,
          error: "WebGPU 引擎或 PMX 模型尚未就绪，无法执行固定单帧颜色基线采集。",
        });
        baselineResultRef.current = result;
        updateV14dColorBaselineDataset(result);
        return result;
      }

      engine.stopRenderLoop();
      model.pause();
      let beforeRenderFrame = readV14dAnimationProgress(model);
      let afterBaseColorRenderFrame: V14dAnimationProgressEvidence | null = null;
      let afterLinearHdrRenderFrame: V14dAnimationProgressEvidence | null = null;
      input = createV14dColorBaselineInput(
        createV14dAnimationEvidence(beforeRenderFrame, null, null),
      );

      const originalGroups =
        baselineOriginalStyleGroupsRef.current ?? engine.getStyleGroups("companion");
      baselineOriginalStyleGroupsRef.current = originalGroups.map((group) => ({
        ...group,
        materials: [...group.materials],
      }));
      const restoreGroups = baselineOriginalStyleGroupsRef.current;
      let styleGroupsRestored = false;
      let baseResolve: Awaited<ReturnType<typeof readV14dColorBaselineResolveTargets>> | null = null;
      let linearResolve: Awaited<ReturnType<typeof readV14dColorBaselineResolveTargets>> | null = null;
      let materialMask: Awaited<ReturnType<typeof readV14dColorBaselineMaterialMask>> | null = null;
      let finalDisplay: V14dNormalizedImage | null = null;

      const restoreProductionStyleGroups = async () => {
        const restored = await engine.applyStyleGroups("companion", restoreGroups);
        if (!restored.ok) {
          const diagnostics = restored.groups
            .flatMap((group) => group.diagnostics.map((diagnostic) => diagnostic.message))
            .join("; ");
          throw new Error(`恢复生产材质组失败：${diagnostics || "unknown error"}`);
        }
        styleGroupsRestored = true;
      };

      try {
        const modelMaterialNames = new Set(model.getMaterials().map((material) => material.name));
        let nextMaterialId = 1;
        const materialIdByName: Record<string, number> = {};
        for (const material of model.getMaterials()) {
          if (material.vertexCount === 0) continue;
          materialIdByName[material.name] = nextMaterialId;
          nextMaterialId += 1;
        }
        const unlit = await applyV14dUnlitStyleGroups(engine, modelMaterialNames, restoreGroups);
        if (canvasRef.current) {
          canvasRef.current.dataset.v14dUnlitDiagnostic = "true";
          canvasRef.current.dataset.v14dUnlitGraph = V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH.name;
          canvasRef.current.dataset.v14dUnlitGroups = unlit.appliedGroups.join(",");
          canvasRef.current.dataset.v14dUnlitUnknownMaterials = unlit.unknownMaterials.join(",");
        }

        // BaseColor 只来自 texture-only Unlit 组；这里禁止把生产材质组的 HDR
        // 读回同时当作 BaseColor，两个阶段必须各自 render + readback。
        engine.stopRenderLoop();
        model.pause();
        engine.renderFrame(0);
        afterBaseColorRenderFrame = readV14dAnimationProgress(model);
        input = createV14dColorBaselineInput(
          createV14dAnimationEvidence(beforeRenderFrame, afterBaseColorRenderFrame, null),
        );
        baseResolve = await readV14dColorBaselineResolveTargets(
          engine,
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
        );
        materialMask = await readV14dColorBaselineMaterialMask(
          engine,
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
        );

        await restoreProductionStyleGroups();
        engine.stopRenderLoop();
        model.pause();
        engine.renderFrame(0);
        afterLinearHdrRenderFrame = readV14dAnimationProgress(model);
        input = createV14dColorBaselineInput(
          createV14dAnimationEvidence(
            beforeRenderFrame,
            afterBaseColorRenderFrame,
            afterLinearHdrRenderFrame,
          ),
        );
        linearResolve = await readV14dColorBaselineResolveTargets(
          engine,
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
        );
        finalDisplay = await readV14dCanvasDisplay(canvas);

        const baseColorImage = baseResolve ? makeV14dLinearImage(
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
          baseResolve.hdr.data,
        ) : null;
        const linearHdrImage = linearResolve ? makeV14dLinearImage(
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
          linearResolve.hdr.data,
        ) : null;
        const analysis = analyzeV14dColorBaselineRois({
          readback: {
            baseColor: baseColorImage,
            linearHdr: linearHdrImage,
            finalDisplay,
            // Geometry and camera are unchanged between the two passes; use the
            // production pass mask plus the diagnostic material/depth mask as the
            // authoritative background exclusion.
            mask: linearResolve?.mask.data ?? baseResolve?.mask.data ?? null,
            materialMask: materialMask?.data ?? null,
          },
          materialIdByName,
          scene,
        });
        const hasReadyRoi = V14D_COLOR_BASELINE_ROIS.some((roi) => roi.calibrationStatus === "ready");
        const allRoiLevelsMeasured =
          hasReadyRoi &&
          analysis.rois.length > 0 &&
          analysis.rois.every((roi) =>
            (["baseColor", "linearHdr", "finalDisplay"] as const).every(
              (level) => roi.levels[level].status === "measured",
            ),
          );
        const resultReadback: V14dColorBaselineResult["readback"] = {
          roiReadback: hasReadyRoi && Boolean(baseResolve && linearResolve && materialMask),
          linearHdrReadback: Boolean(linearResolve),
          finalDisplayReadback: Boolean(finalDisplay),
          materialMaskReadback: Boolean(materialMask),
          materialMaskSource: materialMask ? "engine-pick-material-id-depth" : null,
          materialMaskSourceFormat: materialMask?.sourceFormat ?? null,
          baseColorSource: baseResolve ? "v14d-unlit-texture-only" : null,
          linearHdrSource: linearResolve ? "production-style-groups" : null,
          hdrSourceFormat: linearResolve?.hdr.sourceFormat ?? baseResolve?.hdr.sourceFormat ?? null,
          maskSourceFormat: linearResolve?.mask.sourceFormat ?? baseResolve?.mask.sourceFormat ?? null,
          width: V14D_COLOR_BASELINE_WIDTH,
          height: V14D_COLOR_BASELINE_HEIGHT,
          rowPitch: {
            hdr: linearResolve?.hdr.rowPitch ?? baseResolve?.hdr.rowPitch ?? null,
            mask: linearResolve?.mask.rowPitch ?? baseResolve?.mask.rowPitch ?? null,
          },
          nanCount: linearResolve?.hdr.nanCount ?? baseResolve?.hdr.nanCount ?? null,
          infCount: linearResolve?.hdr.infCount ?? baseResolve?.hdr.infCount ?? null,
        };
        const result = createV14dColorBaselineResult({
          status:
            scene.valid &&
            input.vmdLoaded &&
            resultReadback.roiReadback &&
            resultReadback.linearHdrReadback &&
            resultReadback.finalDisplayReadback &&
            allRoiLevelsMeasured
              ? "ready"
              : "invalid",
          scene,
          input,
          readback: resultReadback,
          rois: analysis.rois,
          firstDivergenceStatus: analysis.firstDivergence.status,
          firstDivergenceLevel: analysis.firstDivergence.level,
          firstDivergenceReason: analysis.firstDivergence.reason,
        });
        // 临时根因取证：记录 Web unlit BaseColor 每 ROI 实际均值。
        (result as Record<string, unknown>).__webBaseColorActualMeans =
          measureV14dRoiActualMeans({
            image: baseColorImage,
            mask: linearResolve?.mask.data ?? baseResolve?.mask.data ?? null,
            materialMask: materialMask?.data ?? null,
            materialIdByName,
          });
        baselineResultRef.current = result;
        updateV14dColorBaselineDataset(result);
        return result;
      } catch (error) {
        const resultReadback: V14dColorBaselineResult["readback"] = {
          roiReadback: Boolean(baseResolve && linearResolve && materialMask && V14D_COLOR_BASELINE_ROIS.some((roi) => roi.calibrationStatus === "ready")),
          linearHdrReadback: Boolean(linearResolve),
          finalDisplayReadback: Boolean(finalDisplay),
          materialMaskReadback: Boolean(materialMask),
          materialMaskSource: materialMask ? "engine-pick-material-id-depth" : null,
          materialMaskSourceFormat: materialMask?.sourceFormat ?? null,
          baseColorSource: baseResolve ? "v14d-unlit-texture-only" : null,
          linearHdrSource: linearResolve ? "production-style-groups" : null,
          hdrSourceFormat: linearResolve?.hdr.sourceFormat ?? baseResolve?.hdr.sourceFormat ?? null,
          maskSourceFormat: linearResolve?.mask.sourceFormat ?? baseResolve?.mask.sourceFormat ?? null,
          width: V14D_COLOR_BASELINE_WIDTH,
          height: V14D_COLOR_BASELINE_HEIGHT,
          rowPitch: {
            hdr: linearResolve?.hdr.rowPitch ?? baseResolve?.hdr.rowPitch ?? null,
            mask: linearResolve?.mask.rowPitch ?? baseResolve?.mask.rowPitch ?? null,
          },
          nanCount: linearResolve?.hdr.nanCount ?? baseResolve?.hdr.nanCount ?? null,
          infCount: linearResolve?.hdr.infCount ?? baseResolve?.hdr.infCount ?? null,
        };
        const result = createV14dColorBaselineResult({
          status: "error",
          scene,
          input,
          readback: resultReadback,
          error: error instanceof Error ? error.message : String(error),
        });
        baselineResultRef.current = result;
        updateV14dColorBaselineDataset(result);
        return result;
      } finally {
        if (!styleGroupsRestored) {
          try {
            await restoreProductionStyleGroups();
            engine.stopRenderLoop();
            model.pause();
            engine.renderFrame(0);
          } catch (restoreError) {
            console.error("[v14d-color-baseline] 恢复生产材质组失败", restoreError);
          }
        }
      }
    })();
    baselineCapturePromiseRef.current = promise;
    void promise.then(
      () => {
        if (baselineCapturePromiseRef.current === promise) baselineCapturePromiseRef.current = null;
      },
      () => {
        if (baselineCapturePromiseRef.current === promise) baselineCapturePromiseRef.current = null;
      },
    );
    return promise;
  };
  baselineCaptureFnRef.current = captureV14dColorBaseline;

  /**
   * V14D Face State 2 静态预览采集：固定单帧（frame120）后，用 Face 材质 ID
   * pick mask + 模型覆盖 alpha + 深度前景隔离脸部 ROI，返回显示 sRGB/线性均值。
   * 只读消费渲染结果，不写回动画 Runtime；生产路径不创建 pick 资源。
   */
  const captureV14dFaceStatic = async (): Promise<V14dFaceStaticCapture> => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    const model = modelRef.current;
    const mode = v14dFaceStaticMode;
    const texture = v14dFaceStaticTextureName(mode);
    const base: V14dFaceStaticCapture = {
      mode,
      frame: V14D_FACE_STATIC_FRAME,
      state: V14D_FACE_STATIC_STATE,
      blend: V14D_FACE_STATIC_BLEND,
      cameraLocked: true,
      paused: true,
      texture,
      width: V14D_FACE_STATIC_SIZE,
      height: V14D_FACE_STATIC_SIZE,
      faceMaterialId: null,
      faceMaterialName: V14D_FACE_MATERIAL_NAME,
      authorityOk: false,
      roi: { px: [0, 0, 0, 0], samples: 0, faceSamples: 0 },
      meanSrgb: null,
      meanLinear: null,
    };
    if (!canvas || !engine || !model || !v14dFaceStaticRef.current || !v14dFaceStaticGatedRef.current) {
      return { ...base, error: "V14D Face Static 未启用或引擎未就绪。" };
    }
    try {
      // Face pick ID 从材质名映射推导（不硬编码）：引擎 pick mask 只统计
      // vertexCount>0 的材质，1-based，0=无命中。
      const faceMaterialId = v14dFaceStaticFacePickId(
        model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount })),
      );
      if (faceMaterialId === null) {
        return { ...base, error: `未在 PMX 材质中找到权威 Face 材质（${V14D_FACE_MATERIAL_NAME}）。` };
      }
      base.faceMaterialId = faceMaterialId;
      base.authorityOk = true;
      const materialMask = await readV14dColorBaselineMaterialMask(engine, V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      const display = await readV14dCanvasDisplay(canvas);
      const [rx, ry, rw, rh] = V14D_FACE_STATIC_ROI_NORM;
      const x0 = Math.floor(rx * V14D_FACE_STATIC_SIZE);
      const y0 = Math.floor(ry * V14D_FACE_STATIC_SIZE);
      const x1 = Math.min(V14D_FACE_STATIC_SIZE - 1, Math.ceil((rx + rw) * V14D_FACE_STATIC_SIZE) - 1);
      const y1 = Math.min(V14D_FACE_STATIC_SIZE - 1, Math.ceil((ry + rh) * V14D_FACE_STATIC_SIZE) - 1);
      let samples = 0;
      let faceSamples = 0;
      const srgbSum = [0, 0, 0];
      const linearSum = [0, 0, 0];
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          samples += 1;
          const off = (y * V14D_FACE_STATIC_SIZE + x) * 4;
          const modelId = materialMask.data[off];
          const matId = materialMask.data[off + 1];
          if (modelId === 0 || matId !== faceMaterialId) continue;
          faceSamples += 1;
          const r = display.data[off];
          const g = display.data[off + 1];
          const b = display.data[off + 2];
          srgbSum[0] += r; srgbSum[1] += g; srgbSum[2] += b;
          linearSum[0] += srgbToLinear(r); linearSum[1] += srgbToLinear(g); linearSum[2] += srgbToLinear(b);
        }
      }
      if (faceSamples > 0) {
        base.meanSrgb = [srgbSum[0] / faceSamples, srgbSum[1] / faceSamples, srgbSum[2] / faceSamples];
        base.meanLinear = [linearSum[0] / faceSamples, linearSum[1] / faceSamples, linearSum[2] / faceSamples];
      }
      base.roi = { px: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], samples, faceSamples };
      // Stage 2B-M3：全身皮肤 ROI（Face + BodySkin）逐材质统计，含 bbox 供近景定位。
      // 与上方 Face ROI 同一 materialMask/display 口径，只按材质 pick id 分组。
      {
        const materials = model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount }));
        const skinTargets = [V14D_FACE_MATERIAL_NAME, V14D_BODY_MATERIAL_NAME];
        const skinRoi: NonNullable<V14dFaceStaticCapture["skinRoi"]> = {};
        for (const name of skinTargets) {
          const pickId = v14dFaceStaticMaterialPickId(materials, name);
          if (pickId === null) continue;
          let n = 0;
          const sSum = [0, 0, 0];
          const lSum = [0, 0, 0];
          let minX = V14D_FACE_STATIC_SIZE, minY = V14D_FACE_STATIC_SIZE, maxX = -1, maxY = -1;
          for (let y = 0; y < V14D_FACE_STATIC_SIZE; y += 1) {
            for (let x = 0; x < V14D_FACE_STATIC_SIZE; x += 1) {
              const off = (y * V14D_FACE_STATIC_SIZE + x) * 4;
              if (materialMask.data[off] === 0 || materialMask.data[off + 1] !== pickId) continue;
              n += 1;
              const r = display.data[off], g = display.data[off + 1], b = display.data[off + 2];
              sSum[0] += r; sSum[1] += g; sSum[2] += b;
              lSum[0] += srgbToLinear(r); lSum[1] += srgbToLinear(g); lSum[2] += srgbToLinear(b);
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
          if (n > 0) {
            skinRoi[name] = {
              pickId,
              samples: n,
              meanSrgb: [sSum[0] / n, sSum[1] / n, sSum[2] / n],
              meanLinear: [lSum[0] / n, lSum[1] / n, lSum[2] / n],
              bboxNorm: [minX / V14D_FACE_STATIC_SIZE, minY / V14D_FACE_STATIC_SIZE,
                (maxX - minX + 1) / V14D_FACE_STATIC_SIZE, (maxY - minY + 1) / V14D_FACE_STATIC_SIZE],
            };
          }
        }
        if (Object.keys(skinRoi).length > 0) base.skinRoi = skinRoi;

        // Stage 2B-M3 修正轮：BodySkin 四区域语义统计。
        // 用 BodySkin 三角形展开 pass（triId per pixel）+ CPU 蒙皮世界质心分区，
        // 把每个可见像素归属到 neck/waist/leftHand/rightHand 四区域之一。
        // 区域定义见 V14D_BODY_SKIN_REGIONS（世界 y 带 + x 符号，叉腰下左右手按 x 区分）。
        try {
          const bodyMatIndex = model.getMaterials().findIndex((m) => m.name === V14D_BODY_MATERIAL_NAME);
          if (bodyMatIndex >= 0) {
            const mats = model.getMaterials();
            const bodyFirstIndex = mats.slice(0, bodyMatIndex).reduce((acc, m) => acc + m.vertexCount, 0);
            const bodyIndexCount = mats[bodyMatIndex].vertexCount;
            const skinning = model.getSkinning();
            const bodySrc = {
              vertices: model.getVertices(),
              indices: model.getIndices(),
              joints: skinning.joints,
              weights: skinning.weights,
              faceFirstIndex: bodyFirstIndex,
              faceIndexCount: bodyIndexCount,
              skinMatrices: model.getSkinMatrices(),
            };
            const centroids = computeV14dMaterialWorldTriCentroids(bodySrc);
            const labels = classifyV14dMaterialRegions(centroids, V14D_BODY_SKIN_REGIONS);
            const triUv = await readV14dFaceExpandedTriUv(engineRef.current, V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE, bodySrc);
            const bodyPickId = v14dFaceStaticMaterialPickId(
              model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount })),
              V14D_BODY_MATERIAL_NAME,
            );
          if (bodyPickId !== null && triUv) {
            // 诊断 pass 相机修正：capture 可能在自由相机/全身视角下调用，
            // 先渲染一帧使 triUv/pick 与当前视角一致。
            try { engine.renderFrame(0); } catch { /* 保持既有状态 */ }
            const totalVisible = skinRoi[V14D_BODY_MATERIAL_NAME]?.samples ?? 0;
              const regionStats: Record<string, {
                tris: number; samples: number; sSum: number[]; lSum: number[];
                minX: number; minY: number; maxX: number; maxY: number;
              }> = {};
              for (let r = 0; r < V14D_BODY_SKIN_REGIONS.length; r += 1) {
                regionStats[V14D_BODY_SKIN_REGIONS[r].id] = {
                  tris: 0, samples: 0, sSum: [0, 0, 0], lSum: [0, 0, 0],
                  minX: V14D_FACE_STATIC_SIZE, minY: V14D_FACE_STATIC_SIZE, maxX: -1, maxY: -1,
                };
              }
              // 三角形数（世界分区命中，与屏幕可见性无关）。
              for (let t = 0; t < labels.length; t += 1) {
                const r = labels[t];
                if (r >= 0) regionStats[V14D_BODY_SKIN_REGIONS[r].id].tris += 1;
              }
              // 像素归属：triId per pixel → 区域标签 → 统计。
              for (let y = 0; y < V14D_FACE_STATIC_SIZE; y += 1) {
                for (let x = 0; x < V14D_FACE_STATIC_SIZE; x += 1) {
                  const i = y * V14D_FACE_STATIC_SIZE + x;
                  const off = i * 4;
                  // 只统计同时被 BodySkin pick 命中且 triUv pass 覆盖的像素（前景）。
                  if (materialMask.data[off] === 0 || materialMask.data[off + 1] !== bodyPickId) continue;
                  const triId = triUv.triId[i];
                  if (triId < 0 || triId >= labels.length) continue;
                  const r = labels[triId];
                  if (r < 0) continue;
                  const st = regionStats[V14D_BODY_SKIN_REGIONS[r].id];
                  st.samples += 1;
                  const rr = display.data[off], gg = display.data[off + 1], bb = display.data[off + 2];
                  st.sSum[0] += rr; st.sSum[1] += gg; st.sSum[2] += bb;
                  st.lSum[0] += srgbToLinear(rr); st.lSum[1] += srgbToLinear(gg); st.lSum[2] += srgbToLinear(bb);
                  if (x < st.minX) st.minX = x; if (x > st.maxX) st.maxX = x;
                  if (y < st.minY) st.minY = y; if (y > st.maxY) st.maxY = y;
                }
              }
              const out: NonNullable<V14dFaceStaticCapture["bodySkinRegions"]> = {};
              for (const def of V14D_BODY_SKIN_REGIONS) {
                const st = regionStats[def.id];
                if (st.samples <= 0) continue;
                out[def.id] = {
                  def: { id: def.id, yMin: def.yMin, yMax: def.yMax, xSide: def.xSide },
                  triangles: st.tris,
                  samples: st.samples,
                  coverage: totalVisible > 0 ? st.samples / totalVisible : 0,
                  meanSrgb: [st.sSum[0] / st.samples, st.sSum[1] / st.samples, st.sSum[2] / st.samples],
                  meanLinear: [st.lSum[0] / st.samples, st.lSum[1] / st.samples, st.lSum[2] / st.samples],
                  bboxNorm: [st.minX / V14D_FACE_STATIC_SIZE, st.minY / V14D_FACE_STATIC_SIZE,
                    (st.maxX - st.minX + 1) / V14D_FACE_STATIC_SIZE, (st.maxY - st.minY + 1) / V14D_FACE_STATIC_SIZE],
                };
              }
              if (Object.keys(out).length > 0) base.bodySkinRegions = out;
            }
          }
        } catch { /* 区域统计失败不阻塞主 capture，Gate 会按缺失区域如实失败 */ }
      }
      return base;
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) };
    }
  };

  /** 读取当前 faceStatic 模式的 pre-tonemap HDR resolve 与同一口径 Face pick mask。
   *  uvDebug/composite/HDR 导出共享此路径，保证 Gate 用同一线性口径对账。
   *  hdr 为 scene pass 输出（未过 composite 的 bloom/exposure/LUT/grade/gamma）。 */
  const readV14dFaceResolveAndMask = async (): Promise<{
    faceMaterialId: number;
    hdr: Float32Array;
    faceMask: Uint8Array;
    size: number;
  } | null> => {
    const engine = engineRef.current;
    const model = modelRef.current;
    if (!engine || !model) return null;
    try {
      const faceMaterialId = v14dFaceStaticFacePickId(
        model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount })),
      );
      if (faceMaterialId === null) return null;
      const size = V14D_FACE_STATIC_SIZE;
      const [resolve, materialMask] = await Promise.all([
        readV14dColorBaselineResolveTargets(engine, size, size),
        readV14dColorBaselineMaterialMask(engine, size, size),
      ]);
      const faceMask = new Uint8Array(size * size);
      for (let i = 0; i < size * size; i += 1) {
        const off = i * 4;
        faceMask[i] = materialMask.data[off] !== 0 && materialMask.data[off + 1] === faceMaterialId ? 1 : 0;
      }
      return { faceMaterialId, hdr: resolve.hdr.data, faceMask, size };
    } catch {
      return null;
    }
  };
  /** 导出脸部像素 mask（PNG base64）：Face 材质命中像素=白，其余=黑。
   *  供同口径分量 Gate 在 Blender 参考图上复用同一脸部像素定义量化。 */
  const exportV14dFaceMaskPng = async (): Promise<string | null> => {
    const engine = engineRef.current;
    const model = modelRef.current;
    if (!engine || !model || !v14dFaceStaticRef.current || !v14dFaceStaticGatedRef.current) return null;
    try {
      const faceMaterialId = v14dFaceStaticFacePickId(
        model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount })),
      );
      if (faceMaterialId === null) return null;
      const materialMask = await readV14dColorBaselineMaterialMask(engine, V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      const c = document.createElement("canvas");
      c.width = V14D_FACE_STATIC_SIZE; c.height = V14D_FACE_STATIC_SIZE;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const img = ctx.createImageData(V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      for (let i = 0; i < V14D_FACE_STATIC_SIZE * V14D_FACE_STATIC_SIZE; i += 1) {
        const off = i * 4;
        const isFace = materialMask.data[off] !== 0 && materialMask.data[off + 1] === faceMaterialId;
        const v = isFace ? 255 : 0;
        img.data[off] = v; img.data[off + 1] = v; img.data[off + 2] = v; img.data[off + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL("image/png").split(",")[1] ?? null;
    } catch {
      return null;
    }
  };

  /** 按材质名导出材质 pick mask（逐像素 0/1 Uint8Array，width=height=V14D_FACE_STATIC_SIZE）。
   *  用于眼/口邻域保持性单列：EyeWhite/Eyes 材质可独立量化，不被并入 Face Gate。
   *  与 exportV14dFaceMaskPng 同一渲染口径（materialMask readback + pick id）。 */
  const exportV14dMaterialMaskByName = async (materialName: string): Promise<Uint8Array | null> => {
    const engine = engineRef.current;
    const model = modelRef.current;
    if (!engine || !model) return null;
    try {
      const materials = model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount }));
      const pickId = v14dFaceStaticFacePickId(materials, materialName);
      if (pickId === null) return null;
      const size = V14D_FACE_STATIC_SIZE;
      const materialMask = await readV14dColorBaselineMaterialMask(engine, size, size);
      const mask = new Uint8Array(size * size);
      for (let i = 0; i < size * size; i += 1) {
        const off = i * 4;
        mask[i] = materialMask.data[off] !== 0 && materialMask.data[off + 1] === pickId ? 1 : 0;
      }
      return mask;
    } catch {
      return null;
    }
  };
  /**
   * 导出 Face 材质逐像素插值 UV（R=u, G=v, B=0）的 PNG base64。
   * 与 exportV14dFaceMaskPng 用同一 Face pick mask 隔离脸部像素；
   * 仅在 faceStatic 模式且 Face 已切到 V14D_FACE_UV_DEBUG_GRAPH 时有意义。
   * 供 UV-direct 对账读取 Web 侧每个脸部像素实际使用的 UV 坐标。
   */
  const exportV14dFaceUvPng = async (): Promise<{
    png: string;
    width: number;
    height: number;
    faceMaterialId: number;
    /** 逐像素原始插值 UV（Float32，pre-tonemap HDR readback，非最终 canvas 显示色）。 */
    uv: Float32Array;
    /** 逐像素是否命中 Face 材质（同一 Face pick mask）。 */
    faceMask: Uint8Array;
  } | null> => {
    try {
      // 关键修复：uvDebug 的 Face fragment 输出 vec3f(input.uv, 0.0)，在场景 HDR pass
      // 写入 pre-tonemap 的 hdrResolveTexture。必须从该 HDR resolve 做 GPU readback，
      // 读取的 R/G 才是原始插值 UV。旧实现从最终 canvas（readV14dCanvasDisplay）反推，
      // 已被 composite 的 bloom/exposure/Filmic LUT/color grading/gamma 污染，不是原始 UV。
      const fr = await readV14dFaceResolveAndMask();
      if (!fr) return null;
      const { faceMaterialId, hdr, faceMask: faceMaskArr, size } = fr;
      const uv = new Float32Array(size * size * 2);
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const img = ctx.createImageData(size, size);
      for (let i = 0; i < size * size; i += 1) {
        const off = i * 4;
        const isFace = faceMaskArr[i] === 1;
        // HDR readback 的 R=u, G=v（vec3f(input.uv, 0.0)），保持浮点精度。
        const u = isFace ? hdr[off] : 0;
        const v = isFace ? hdr[off + 1] : 0;
        uv[i * 2] = u;
        uv[i * 2 + 1] = v;
        // PNG 仅供人眼检查（8-bit 量化），精确值用 uv Float32Array。
        img.data[off] = Math.round(Math.max(0, Math.min(255, u * 255)));
        img.data[off + 1] = Math.round(Math.max(0, Math.min(255, v * 255)));
        img.data[off + 2] = 0;
        img.data[off + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const png = c.toDataURL("image/png").split(",")[1] ?? null;
      if (!png) return null;
      return { png, width: size, height: size, faceMaterialId, uv, faceMask: faceMaskArr };
    } catch {
      return null;
    }
  };

  /**
   * 导出当前 faceStatic 模式 Face 材质的 pre-tonemap HDR 线性 RGB（逐像素浮点）。
   * 从 hdrResolveTexture（场景 pass 输出，源格式随硬件为 rg11b10ufloat/rgba16float，
   * 诊断链 blit 到 rgba16float 读回目标；未过 composite 的
   * bloom/exposure/Filmic LUT/color grading/gamma）GPU readback。
   * 与 uvDebug 用同一 Face pick mask；供 UV-direct Gate 用「同一线性口径」对账，
   * 避免拿 tonemap 后的最终 canvas 对比未 tonemap 的 baker 参考（口径不一致）。
   */
  const exportV14dFaceHdrFloat = async (): Promise<{
    width: number;
    height: number;
    faceMaterialId: number;
    rgb: Float32Array;
    faceMask: Uint8Array;
  } | null> => {
    try {
      // 诊断同步屏障（默认关闭）：HDR pick/resolve 读回前，把当前 CPU 蒙皮矩阵
      // 写回 GPU 并排空队列，与 triUv pass 保持同一皮肤状态。
      if (engineRef.current) await flushV14dDiagnosticBarrier(engineRef.current);
      const fr = await readV14dFaceResolveAndMask();
      if (!fr) return null;
      const { faceMaterialId, hdr, faceMask: faceMaskArr, size } = fr;
      const rgb = new Float32Array(size * size * 3);
      for (let i = 0; i < size * size; i += 1) {
        const off = i * 4;
        if (faceMaskArr[i] === 1) {
          rgb[i * 3] = hdr[off];
          rgb[i * 3 + 1] = hdr[off + 1];
          rgb[i * 3 + 2] = hdr[off + 2];
        }
      }
      return { width: size, height: size, faceMaterialId, rgb, faceMask: faceMaskArr };
    } catch {
      return null;
    }
  };

  /**
   * Stage 2B-M3：按材质名导出该材质的 pre-tonemap HDR 线性 RGB（Float32Array）+ 材质 pick mask。
   * 与 exportV14dFaceHdrFloat 同一 HDR resolve 口径，只把 Face pick 换成任意材质 pick，
   * 供 BodySkin ROI Gate 用「同一线性口径」与 Blender 身体参考对账。
   */
  const exportV14dMaterialHdrFloat = async (materialName: string): Promise<{
    width: number;
    height: number;
    materialName: string;
    pickId: number;
    rgb: Float32Array;
    mask: Uint8Array;
  } | null> => {
    try {
      const engine = engineRef.current;
      const model = modelRef.current;
      if (!engine || !model) return null;
      if (engine) await flushV14dDiagnosticBarrier(engine);
      const materials = model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount }));
      const pickId = v14dFaceStaticMaterialPickId(materials, materialName);
      if (pickId === null) return null;
      const size = V14D_FACE_STATIC_SIZE;
      // Stage 2B-M3 修正轮（P0-2 修复）：HDR/mask readback 的 per-frame 相机矩阵
      // 可能是启动时脸部相机的旧值；自由相机/近景视角下先用当前实际相机渲染一帧，
      // 使 HDR/pick 与当前屏幕视角一致（否则四区域近景视角下颜色/pick 错位）。
      // 停 render loop 再用当前相机渲染一帧，避免被循环下一帧覆盖。
      try {
        engine.stopRenderLoop();
        model.pause();
        engine.renderFrame(0);
      } catch { /* 保持既有状态 */ }
      const [resolve, materialMask] = await Promise.all([
        readV14dColorBaselineResolveTargets(engine, size, size),
        readV14dColorBaselineMaterialMask(engine, size, size),
      ]);
      const hdr = resolve.hdr.data;
      const rgb = new Float32Array(size * size * 3);
      const mask = new Uint8Array(size * size);
      for (let i = 0; i < size * size; i += 1) {
        const off = i * 4;
        const hit = materialMask.data[off] !== 0 && materialMask.data[off + 1] === pickId;
        mask[i] = hit ? 1 : 0;
        if (hit) {
          rgb[i * 3] = hdr[off];
          rgb[i * 3 + 1] = hdr[off + 1];
          rgb[i * 3 + 2] = hdr[off + 2];
        }
      }
      return { width: size, height: size, materialName, pickId, rgb, mask };
    } catch {
      return null;
    }
  };

  /**
   * 导出当前 faceStatic 模式 Face 材质的最终显示字节（canvas sRGB 8-bit，已过
   * composite 显示变换）逐像素 RGB 与 Face mask。display-passthrough 下这些字节
   * 应与注入的显示域纹理字节一致——这是 G1 色块真绑定与 G4 AgX 显示字节闭环的
   * 正式输入。与 HDR 导出用同一 Face pick mask（pick pass，逐像素材质 ID）。
   */
  const exportV14dFaceDisplayCapture = async (): Promise<{
    width: number;
    height: number;
    faceMaterialId: number;
    displayRgb: Uint8Array;
    faceMask: Uint8Array;
  } | null> => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    const model = modelRef.current;
    if (!canvas || !engine || !model || !v14dFaceStaticRef.current || !v14dFaceStaticGatedRef.current) return null;
    try {
      const faceMaterialId = v14dFaceStaticFacePickId(
        model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount })),
      );
      if (faceMaterialId === null) return null;
      const size = V14D_FACE_STATIC_SIZE;
      const materialMask = await readV14dColorBaselineMaterialMask(engine, size, size);
      const display = await readV14dCanvasDisplay(canvas);
      const displayRgb = new Uint8Array(size * size * 3);
      const faceMaskArr = new Uint8Array(size * size);
      for (let i = 0; i < size * size; i += 1) {
        const off = i * 4;
        const isFace = materialMask.data[off] !== 0 && materialMask.data[off + 1] === faceMaterialId;
        faceMaskArr[i] = isFace ? 1 : 0;
        // readV14dCanvasDisplay 返回 0..1 float；转回 8-bit 显示字节。
        displayRgb[i * 3] = Math.round(Math.max(0, Math.min(1, display.data[off])) * 255);
        displayRgb[i * 3 + 1] = Math.round(Math.max(0, Math.min(1, display.data[off + 1])) * 255);
        displayRgb[i * 3 + 2] = Math.round(Math.max(0, Math.min(1, display.data[off + 2])) * 255);
      }
      return { width: size, height: size, faceMaterialId, displayRgb, faceMask: faceMaskArr };
    } catch {
      return null;
    }
  };

  /**
   * 逐像素导出 Face 三角形 ID + 插值 UV（Stage 2B-M2 诊断专用，默认关闭路径）。
   * 复用 pick pass 深度语义的专用 GPU pass，输出 (triId, u, v)；附相机 view/proj
   * 矩阵（左手系、列主序），供离线 Gate 把 Blender raycast 采样映射到 Web 屏幕像素。
   */
  const exportV14dFaceTriUv = async (): Promise<{
    width: number;
    height: number;
    faceMaterialId: number;
    faceMaterialIndex: number;
    faceMaterialFirstIndex: number;
    faceTriangleCount: number;
    camera: { view: number[]; projection: number[] } | null;
    triId: Int32Array;
    uv: Float32Array;
    faceMask: Uint8Array;
  } | null> => {
    const engine = engineRef.current;
    const model = modelRef.current;
    if (!engine || !model || !v14dFaceStaticRef.current || !v14dFaceStaticGatedRef.current) return null;
    try {
      // 诊断同步屏障（默认关闭）：把当前 CPU 蒙皮矩阵写回 GPU 并排空队列，
      // 确保本次 triUv pass 与随后同帧 HDR pick 读到同一皮肤状态。
      await flushV14dDiagnosticBarrier(engine);
      const materials = model.getMaterials();
      const faceMaterialIndex = materials.findIndex((m) => m.name === V14D_FACE_MATERIAL_NAME);
      if (faceMaterialIndex < 0) return null;
      const faceMaterialId = v14dFaceStaticFacePickId(
        materials.map((m) => ({ name: m.name, vertexCount: m.vertexCount })),
      );
      if (faceMaterialId === null) return null;
      const faceFirstIndex = materials
        .slice(0, faceMaterialIndex)
        .reduce((acc, m) => acc + m.vertexCount, 0);
      const faceTriangleCount = Math.floor(materials[faceMaterialIndex].vertexCount / 3);
      const size = V14D_FACE_STATIC_SIZE;
      // 路线 B+：Face 非索引展开 pass，triId 可靠（= PMX/Blender Face 局部序号）。
      const faceIndexCount = materials[faceMaterialIndex].vertexCount;
      const skinning = model.getSkinning();
      const rb = await readV14dFaceExpandedTriUv(engine, size, size, {
        vertices: model.getVertices(),
        indices: model.getIndices(),
        joints: skinning.joints,
        weights: skinning.weights,
        faceFirstIndex,
        faceIndexCount,
        skinMatrices: model.getSkinMatrices(),
      });
      const camera = engine as unknown as { camera?: { getViewMatrix(): { values: Float32Array }; getProjectionMatrix(): { values: Float32Array } } };
      const cam = camera.camera
        ? { view: Array.from(camera.camera.getViewMatrix().values), projection: Array.from(camera.camera.getProjectionMatrix().values) }
        : null;
      return {
        width: rb.width,
        height: rb.height,
        faceMaterialId,
        faceMaterialIndex,
        faceMaterialFirstIndex: faceFirstIndex,
        faceTriangleCount,
        camera: cam,
        triId: rb.triId,
        uv: rb.uv,
        faceMask: rb.faceMask,
      };
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!v14dFaceStatic) return;
    window.__v14dFaceStatic = {
      capture: () => captureV14dFaceStatic(),
      exportFaceMaskPng: () => exportV14dFaceMaskPng(),
      exportFaceUvPng: () => exportV14dFaceUvPng(),
      exportFaceHdrFloat: () => exportV14dFaceHdrFloat(),
      exportFaceDisplayCapture: () => exportV14dFaceDisplayCapture(),
      exportMaterialMaskByName: (name: string) => exportV14dMaterialMaskByName(name),
      exportFaceTriUv: () => exportV14dFaceTriUv(),
      exportMaterialHdrFloat: (name: string) => exportV14dMaterialHdrFloat(name),
      /**
       * Stage 2B-M3 修正轮：导出任意材质的三角形展开 pass（triId + uv per pixel，
       * 当前相机视角）+ 该材质逐三角形蒙皮世界质心 + 按 V14D_BODY_SKIN_REGIONS 的
       * 区域标签。供 Gate 用「三角形语义区域」而非整块材质均值做四区域对账。
       * 区域标签为 Int32Array（-1=未分区，否则=V14D_BODY_SKIN_REGIONS 下标）。
       */
      exportMaterialTriRegions: async (
        materialName: string,
        boneRegionOverride?: readonly (readonly number[])[],
      ) => {
        const engine = engineRef.current;
        const model = modelRef.current;
        if (!engine || !model) return null;
        try {
          const mats = model.getMaterials();
          const matIndex = mats.findIndex((m) => m.name === materialName);
          if (matIndex < 0) return null;
          await flushV14dDiagnosticBarrier(engine);
          const firstIndex = mats.slice(0, matIndex).reduce((acc, m) => acc + m.vertexCount, 0);
          const indexCount = mats[matIndex].vertexCount;
          const skinning = model.getSkinning();
          const src = {
            vertices: model.getVertices(),
            indices: model.getIndices(),
            joints: skinning.joints,
            weights: skinning.weights,
            faceFirstIndex: firstIndex,
            faceIndexCount: indexCount,
            skinMatrices: model.getSkinMatrices(),
          };
          const centroids = computeV14dMaterialWorldTriCentroids(src);
          const labels = classifyV14dMaterialRegions(centroids, V14D_BODY_SKIN_REGIONS);
          // Stage 2B-M3.1：BodySkin 语义分区改用版本化骨骼主导权重集合（v1）。
          // 旧版 labels 为世界 y 带 + x 符号矩形分区（左手 y 带会误吞腰腹皮肤，已废弃为
          // 仅参考用 legacy 标签）；正式归属用 boneRegionLabels（-1=未分区，否则=
          // V14D_BODY_SKIN_BONE_REGION_IDS 下标：0=neck 1=torso 2=leftHand 3=rightHand）。
          const boneRegionLabels =
            materialName === V14D_BODY_MATERIAL_NAME
              ? classifyV14dVerticesByBoneRegion(
                  skinning.joints,
                  skinning.weights,
                  model.getIndices(),
                  firstIndex,
                  indexCount,
                  V14D_BODY_SKIN_BONE_REGION_IDS,
                  [
                    V14D_BODY_SKIN_BONE_REGIONS_V1.neck,
                    V14D_BODY_SKIN_BONE_REGIONS_V1.torso,
                    V14D_BODY_SKIN_BONE_REGIONS_V1.leftHand,
                    V14D_BODY_SKIN_BONE_REGIONS_V1.rightHand,
                  ],
                  boneRegionOverride,
                )
              : null;
          // 诊断：逐三角形主导骨骼直方图（索引），供探针核对骨骼集合是否命中。
          let dominantBoneHistogram: Record<string, number> | null = null;
          let skeletonBoneNames: string[] | null = null;
          if (materialName === V14D_BODY_MATERIAL_NAME) {
            try {
              skeletonBoneNames = (model.getSkeleton?.()?.bones ?? []).map((b: { name: string }) => b.name);
            } catch { skeletonBoneNames = null; }
            const indices = model.getIndices();
            const hist: Record<string, number> = {};
            for (let t = 0; t < Math.floor(indexCount / 3); t += 1) {
              const vi = indices[firstIndex + t * 3];
              let bestBone = -1, bestW = -1;
              for (let j = 0; j < 4; j += 1) {
                const w = skinning.weights[vi * 4 + j];
                if (w > bestW) { bestW = w; bestBone = skinning.joints[vi * 4 + j]; }
              }
              hist[String(bestBone)] = (hist[String(bestBone)] || 0) + 1;
            }
            dominantBoneHistogram = hist;
          }
          const size = V14D_FACE_STATIC_SIZE;
          // Stage 2B-M3 修正轮（P0-2 修复）：自由相机/近景视角下，诊断 pass 的
          // pickPerFrameBindGroup 可能是启动时脸部相机的旧矩阵。导出前先用当前实际
          // 相机强制渲染一帧，使 pick/triUv pass 与当前屏幕视角一致（否则全身/近景
          // 视角下 BodySkin 区域像素全部错位到脸部相机的屏幕投影，neck/waist 无命中）。
          // 关键：render loop 运行中 renderFrame(0) 可能被下一帧循环覆盖，先停循环
          // 再用当前相机渲染一帧，保证诊断 pass 读到的是当前实际相机的投影。
          try {
            engine.stopRenderLoop();
            model.pause();
            engine.renderFrame(0);
          } catch { /* 保持既有状态 */ }
          const triUv = await readV14dFaceExpandedTriUv(engine, size, size, src);
          if (!triUv) return null;
          return {
            width: size,
            height: size,
            materialName,
            triCount: Math.floor(indexCount / 3),
            triId: triUv.triId,
            uv: triUv.uv,
            faceMask: triUv.faceMask,
            centroids,
            regionLabels: labels,
            boneRegionLabels,
            boneRegionIds: boneRegionLabels ? [...V14D_BODY_SKIN_BONE_REGION_IDS] : null,
            boneRegionVersion: boneRegionLabels ? V14D_BODY_SKIN_BONE_REGIONS_V1.version : null,
            dominantBoneHistogram,
            skeletonBoneNames,
            regionDefs: V14D_BODY_SKIN_REGIONS.map((d) => ({ id: d.id, yMin: d.yMin, yMax: d.yMax, xSide: d.xSide })),
          };
        } catch {
          return null;
        }
      },
      exportBodySkinDrawBinding: () => {
        const engine = engineRef.current;
        if (!engine) return null;
        try {
          // 引擎私有 draw-call 表（诊断只读）：modelInstances → drawCalls[] → groupId，
          // groupId → styleGroups install → { pipeline, group.graph.name }。
          const insts = (engine as unknown as { modelInstances?: Map<string, unknown> }).modelInstances;
          if (!insts) return null;
          const out: { materialName: string; groupId: string | null; hasPipeline: boolean; graphName: string | null }[] = [];
          for (const inst of insts.values()) {
            const drawCalls = (inst as { drawCalls?: { materialName: string; groupId: string | null; baseBindGroupEntries?: unknown }[] }).drawCalls;
            const styleGroups = (inst as { styleGroups?: Map<string, { pipeline?: unknown; group?: { graph?: { name?: string } } }> }).styleGroups;
            if (!drawCalls) continue;
            for (const dc of drawCalls) {
              if (!dc.baseBindGroupEntries) continue; // 跳过 outline/ground
              const install = dc.groupId && styleGroups ? styleGroups.get(dc.groupId) : undefined;
              out.push({
                materialName: dc.materialName,
                groupId: dc.groupId ?? null,
                hasPipeline: !!(install && install.pipeline),
                graphName: install?.group?.graph?.name ?? null,
              });
            }
          }
          const bodyCalls = out.filter((d) => d.materialName === V14D_BODY_MATERIAL_NAME);
          const allBodySkinOnComposite =
            bodyCalls.length > 0 &&
            bodyCalls.every((d) => d.groupId === "v14d-body-skin-composite" && d.hasPipeline && d.graphName === "V14D Body Skin Composite");
          return { drawCalls: out, allBodySkinOnComposite };
        } catch {
          return null;
        }
      },
    };
    // Stage 2B-M3 近景截图：允许采集脚本直接设相机（freeCamera 模式，保持 paused）。
    (window as unknown as { __v14dSetCamera?: (s: MmdCameraSnapshot) => void }).__v14dSetCamera = (s) => {
      const engine = engineRef.current;
      if (!engine) return;
      v14dFaceCameraFreeRef.current = true;
      restorePersistedCamera(s);
      readRezeCamera(engine)?.setInputLocked(false);
      modelRef.current?.pause();
      engine.runRenderLoop();
      updateV14dFaceCameraDataset(false);
    };
    return () => {
      if (window.__v14dFaceStatic) delete window.__v14dFaceStatic;
      delete (window as unknown as { __v14dSetCamera?: unknown }).__v14dSetCamera;
    };
    // captureV14dFaceStatic 读取最新 ref/mode，稳定引用即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v14dFaceStatic]);

  useImperativeHandle(ref, () => ({
    unlockCamera: () => {
      const engine = engineRef.current;
      readRezeCamera(engine)?.setInputLocked(false);
      if (v14dFaceStaticRef.current && engine) {
        v14dFaceCameraFreeRef.current = true;
        modelRef.current?.pause();
        engine.runRenderLoop();
        return updateV14dFaceCameraDataset(false);
      }
      return captureRezeCameraSnapshot(engine);
    },
    lockCamera: () => {
      const engine = engineRef.current;
      readRezeCamera(engine)?.setInputLocked(true);
      if (v14dFaceStaticRef.current && engine) {
        v14dFaceCameraFreeRef.current = false;
        engine.stopRenderLoop();
        modelRef.current?.pause();
        engine.renderFrame(0);
        return updateV14dFaceCameraDataset(true);
      }
      return captureRezeCameraSnapshot(engine);
    },
    captureCamera: () => captureRezeCameraSnapshot(engineRef.current),
    setCameraSnapshot: (snapshot) => {
      const applied = restorePersistedCamera(snapshot);
      const engine = engineRef.current;
      if (v14dFaceStaticRef.current && engine) {
        readRezeCamera(engine)?.setInputLocked(!v14dFaceCameraFreeRef.current);
        if (v14dFaceCameraFreeRef.current) engine.runRenderLoop();
        else {
          engine.stopRenderLoop();
          modelRef.current?.pause();
          engine.renderFrame(0);
        }
        return updateV14dFaceCameraDataset(!v14dFaceCameraFreeRef.current);
      }
      return applied;
    },
    resetCamera: () => {
      if (v14dFaceStaticRef.current) {
        const snapshot = restorePersistedCamera(V14D_FACE_STATIC_CAMERA);
        const engine = engineRef.current;
        if (engine) {
          readRezeCamera(engine)?.setInputLocked(!v14dFaceCameraFreeRef.current);
          if (v14dFaceCameraFreeRef.current) engine.runRenderLoop();
          else {
            engine.stopRenderLoop();
            modelRef.current?.pause();
            engine.renderFrame(0);
          }
          updateV14dFaceCameraDataset(!v14dFaceCameraFreeRef.current);
        }
        return snapshot;
      }
      applySceneSettings(DEFAULT_SETTINGS);
      return captureRezeCameraSnapshot(engineRef.current);
    },
    adjustCameraDistance: (delta) => {
      const engine = engineRef.current;
      const currentDistance = readRezeCamera(engine)?.radius ?? settingsRef.current.cameraDistance;
      const cameraDistance = Math.max(3.5, Math.min(40, currentDistance + delta));
      if (engine && engineReadyRef.current) {
        engine.setCameraDistance(cameraDistance);
      }
      settingsRef.current = { ...settingsRef.current, cameraDistance };
      if (v14dFaceStaticRef.current && engine && !v14dFaceCameraFreeRef.current) {
        engine.stopRenderLoop();
        modelRef.current?.pause();
        engine.renderFrame(0);
        updateV14dFaceCameraDataset(true);
      }
      return cameraDistance;
    },
    hitTestCharacterAtClientPoint: (clientX, clientY) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      return Boolean(
        rect &&
          canvasRef.current?.dataset.webgpuStatus === "ready" &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom,
      );
    },
    getStageRect: () => canvasRef.current?.getBoundingClientRect() ?? null,
    setSpeechLevel: () => undefined,
    setSpeechViseme: () => undefined,
    getRendererLabel: () => "reze-engine WebGPU",
    getMaterialDebugEntries: () => {
      const model = modelRef.current;
      if (!model) return [];
      return model.getMaterials().map((material, index) => {
        const id = stableMaterialId(index);
        const state = materialStateRef.current.get(id) ?? { visible: true, preset: "默认" };
        return {
          id,
          name: material.name || `材质 ${index + 1}`,
          meshName: "PMX / WebGPU",
          preset: state.preset,
          visible: state.visible,
          opacity: 1,
          emissiveIntensity: 0,
          supportsOpacity: false,
          supportsEmissive: false,
        };
      });
    },
    updateMaterialDebug: (id, patch) => {
      const engine = engineRef.current;
      const model = modelRef.current;
      if (!engine || !model) return null;
      const index = Number(id.split(":").at(-1));
      const material = model.getMaterials()[index];
      if (!material) return null;
      const current = materialStateRef.current.get(id) ?? { visible: true, preset: "默认" };
      const visible = typeof patch.visible === "boolean" ? patch.visible : current.visible;
      engine.setMaterialVisible("companion", material.name, visible);
      materialStateRef.current.set(id, { ...current, visible });
      return { id, visible, opacity: 1, emissiveIntensity: 0 };
    },
    resetMaterialDebug: (id) => {
      const engine = engineRef.current;
      const model = modelRef.current;
      if (!engine || !model) return null;
      const index = Number(id.split(":").at(-1));
      const material = model.getMaterials()[index];
      if (!material) return null;
      engine.setMaterialVisible("companion", material.name, true);
      materialStateRef.current.set(id, { visible: true, preset: "默认" });
      return { id, visible: true, opacity: 1, emissiveIntensity: 0 };
    },
    setMaterialPreset: (id, preset) => {
      const engine = engineRef.current;
      const model = modelRef.current;
      const graph = MATERIAL_GRAPHS[preset];
      if (!engine || !model || !graph) return null;
      const index = Number(id.split(":").at(-1));
      const material = model.getMaterials()[index];
      if (!material) return null;
      const current = materialStateRef.current.get(id) ?? { visible: true, preset: "默认" };
      void engine.upsertStyleGroup("companion", {
        id: `reze-debug-${index}`,
        label: material.name || `材质 ${index + 1}`,
        materials: [material.name],
        graph,
        ...(preset === "眼睛" ? { renderClass: "eye" as const } : {}),
        ...(preset === "头发" ? { renderClass: "hair" as const } : {}),
      });
      materialStateRef.current.set(id, { ...current, preset });
      return { id, preset };
    },
    captureStagePng: () => canvasRef.current?.toDataURL("image/png") ?? null,
    setSceneDebugSettings: (settings) => applySceneSettings(settings as RezeSceneDebugSettings),
    resetSceneDebugSettings: () => applySceneSettings(DEFAULT_SETTINGS),
    captureColorBaseline: () =>
      baselineCaptureFnRef.current?.() ??
      Promise.reject(new Error("V14D 颜色基线采集接口尚未初始化。")),
    getColorBaselineResult: () => baselineResultRef.current,
  }), []);

  useEffect(() => {
    if (!v14dColorBaseline) return;
    const api = {
      capture: () =>
        baselineCaptureFnRef.current?.() ??
        Promise.reject(new Error("V14D 颜色基线采集接口尚未初始化。")),
      getResult: () => baselineResultRef.current,
    };
    window.__v14dColorBaseline = api;
    return () => {
      if (window.__v14dColorBaseline === api) delete window.__v14dColorBaseline;
    };
  }, [v14dColorBaseline]);

  useEffect(() => {
    const canvas = canvasRef.current;
    // faceStatic：资产经注入（File）提供，不依赖 modelUrl，故空 modelUrl 也要启动 boot。
    if (!canvas || (!modelUrl && !v14dFaceStatic)) return;
    let disposed = false;
    const initialSettings = sceneSettings ?? pipelineDefaultSettings;
    // faceStatic 黄金帧：复用 reze-k3 白光场景（票据确认口径），但按权威 blend
    // 改为暗背景、无地面（blend 无地面网格）、bloom 关闭；相机随后由
    // V14D_FACE_STATIC_CAMERA 覆盖（不受 settings 里的 cameraTarget/Distance 影响）。
    const effectiveInitialSettings =
      v14dColorBaseline || v14dFaceStatic ? REZE_K3_SCENE_DEFAULTS : initialSettings;
    const boot = async () => {
      reportStatus("loading", "正在初始化 reze-engine WebGPU…");
      if (!("gpu" in navigator)) throw new Error("当前浏览器不支持 WebGPU，请改用 Reze NPR（WebGL）模式。");
      settingsRef.current = { ...DEFAULT_SETTINGS, ...effectiveInitialSettings };
      engineReadyRef.current = false;
      const engine = new Engine(canvas, {
        background: transparentBackgroundRef.current ? null : hexToSrgbVec3(effectiveInitialSettings.backgroundColor),
        camera: {
          distance: effectiveInitialSettings.cameraDistance,
          target: new Vec3(effectiveInitialSettings.cameraTargetX, effectiveInitialSettings.cameraTargetY, effectiveInitialSettings.cameraTargetZ),
        },
        world: { color: hexToLinearVec3(effectiveInitialSettings.worldColor), strength: effectiveInitialSettings.ambientIntensity },
        sun: {
          color: hexToLinearVec3(effectiveInitialSettings.sunColor),
          strength: effectiveInitialSettings.keyIntensity,
          direction: azElToDirection(effectiveInitialSettings.sunAzimuth, effectiveInitialSettings.sunElevation),
        },
        bloom: {
          enabled: effectiveInitialSettings.bloomStrength > 0,
          threshold: effectiveInitialSettings.bloomThreshold,
          knee: effectiveInitialSettings.bloomKnee,
          radius: effectiveInitialSettings.bloomRadius,
          intensity: effectiveInitialSettings.bloomStrength,
          color: hexToLinearVec3(effectiveInitialSettings.bloomColor),
        },
        // 仅为颜色基线/验收探针启用引擎已有的材质 pick 资源；生产默认不创建
        // pick draw call，也不改变生产材质 shader 或灯光行为。验收探针用它
        // 导出同一帧、同一相机的 PMX 材质 ID+深度前景掩码，区分 HairA/HairB。
        onRaycast: v14dColorBaseline || v14dFaceStatic || acceptanceProbeEnabled ? () => undefined : undefined,
      });
      engineRef.current = engine;
      await engine.init();
      if (disposed) return;
      engineReadyRef.current = true;
      if (v14dFaceStatic) {
        engine.setRenderSize(V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      } else if (v14dColorBaseline) {
        engine.setRenderSize(V14D_COLOR_BASELINE_WIDTH, V14D_COLOR_BASELINE_HEIGHT);
      }
      defaultIkEnabledRef.current = engine.getIKEnabled?.() ?? true;
      const initialBackgroundEffect = await engine.setBackgroundEffect(
        v14dColorBaseline || v14dFaceStatic || backgroundEffectRef.current === "关闭" || backgroundEffectRef.current !== "Shining Stars"
          ? null
          : REZE_SHINING_STARS_WGSL,
      );
      if (!initialBackgroundEffect.ok) throw new Error(`Shining Stars 背景编译失败：${initialBackgroundEffect.diagnostics.join("; ")}`);
      let model: Awaited<ReturnType<Engine["loadModel"]>>;
      if (v14dFaceStatic) {
        // V14D Face State 2 静态预览：权威 PMX/纹理/VMD 与派生纹理以 File 注入，
        // 引擎 files 变体用 createFileMapAssetReader 完全局部解析（无网络、无 404、
        // 不全局包装 window.fetch）。仓库不捆绑第三方资产（README 资产政策）。
        // 强门控：pmxFile 必须是权威 Koleda PMX，否则抛错不静默回退。
        // 资产由 addInitScript/用户注入，可能晚于 boot；轮询等待其就绪（有界 30s）。
        let assets = window.__v14dFaceStaticAssets;
        const waitStart = Date.now();
        while (!assets && Date.now() - waitStart < 30000) {
          await new Promise((r) => setTimeout(r, 100));
          if (disposed) return;
          assets = window.__v14dFaceStaticAssets;
        }
        if (!assets) {
          throw new Error(
            "v14dFaceStatic 需要权威资产集（window.__v14dFaceStaticAssets）：由采集脚本注入或用户 folder 选择提供。",
          );
        }
        if (assets.pmxFile.name !== V14D_FACE_STATIC_AUTHORITY.pmxFileName) {
          throw new Error(
            `v14dFaceStatic 仅支持权威 Koleda PMX（${V14D_FACE_STATIC_AUTHORITY.pmxFileName}），收到 ${assets.pmxFile.name}`,
          );
        }
        // 派生/原始 Face diffuse：按当前模式选纹理（faceTextures 优先，否则单一 faceOverride），
        // 覆盖 face_d 逻辑键后并入模型文件列表。
        // uvDebug 模式不需要纹理（Face 只输出 UV），用原始 face_d 占位即可。
        const isUvDebug = v14dFaceStaticMode === "uvDebug";
        // 实时合成模式（Stage 2B-M1）：faceShadowOnly/finalFaceComposite 不再用
        // 预烘焙整图替换 face_d，而是读原始 face_d + State2 packed mask 实时合成。
        const isLiveState2 = v14dFaceStaticMode === "faceShadowOnly" || v14dFaceStaticMode === "finalFaceComposite";
        const faceOverride = isLiveState2
          ? assets.faceTextures?.normal ?? assets.faceOverride ?? null
          : isUvDebug
            ? assets.faceTextures?.normal ?? assets.faceOverride ?? null
            : (assets.faceTextures?.[v14dFaceStaticMode] ?? assets.faceOverride ?? null);
        const isBaked = v14dFaceStaticMode === "bakedGolden";
        const bakedFiles = isBaked && assets.bakedTextures
          ? (Object.values(assets.bakedTextures) as File[])
          : [];
        // 实时合成模式的 State2 mask File 以唯一逻辑键注入（webkitRelativePath），
        // 由引擎补丁五在 setupMaterialsForInstance 前建立独立纹理（rgba8unorm/禁 mipmap）。
        const state2MaskFile = isLiveState2 ? assets.state2Mask ?? null : null;
        if (isLiveState2 && !state2MaskFile) {
          throw new Error("实时合成模式需要 State2 packed mask（assets.state2Mask）。");
        }
        const modelFiles = [
          ...assets.modelFiles,
          ...(faceOverride ? [faceOverride] : []),
          ...bakedFiles,
          ...(state2MaskFile ? [state2MaskFile] : []),
        ];
        // 真实 GPU 绑定：bakedGolden 模式把材质名→唯一 logicalPath 传给引擎，
        // 由 loadModel 在 GPU 材质建立（setupMaterialsForInstance 上传 GPUTexture/建
        // bind group）之前为每个目标材质追加独立 texture entry 并改 diffuseTextureIndex。
        // 引擎补丁默认关闭（无 overrides 时 no-op）；仅 9 个文件齐全才传 overrides，
        // 部分 bakedDir 不进入已绑定状态。cape 图可内容为空但文件/独立路径必须存在。
        const bakedOverrides = isBaked
          ? (() => {
              const o: Record<string, string> = {};
              for (const b of V14D_BAKED_BINDINGS) {
                if (assets.bakedTextures?.[b.key]) o[b.pmxMaterial] = b.logicalPath;
              }
              return Object.keys(o).length === V14D_BAKED_BINDINGS.length ? o : undefined;
            })()
          : undefined;
        model = await engine.loadModel("companion", {
          files: modelFiles,
          pmxFile: assets.pmxFile,
          ...(bakedOverrides ? { materialDiffuseOverrides: bakedOverrides } : {}),
          ...(isLiveState2 ? { materialAuxTextures: { [V14D_FACE_MATERIAL_NAME]: V14D_STATE2_MASK_LOGICAL_PATH } } : {}),
        } as Parameters<Engine["loadModel"]>[1]);
        // 真实 GPU 绑定证明：loadModel 返回后从引擎读取每个目标材质最终的
        // diffuseTextureIndex 与对应 logicalPath（此时 setupMaterialsForInstance 已用
        // 该路径上传 GPUTexture 并建 bind group）。这不是自证名单——是引擎实际状态。
        if (isBaked && canvasRef.current) {
          const texs = model.getTextures();
          // 追加纹理区间（引擎补丁在 GPU 材质建立前写入）：start=override 前原始纹理数，
          // count=追加条数。Gate 据此校验九项 idx 恰好覆盖 [start, start+count)。
          const range = (model as unknown as { __v14dBakedTextureRange?: { start: number; count: number } })
            .__v14dBakedTextureRange;
          const actual = model.getMaterials()
            .filter((m) => V14D_BAKED_BINDINGS.some((b) => b.pmxMaterial === m.name))
            .map((m) => {
              const tex = m.diffuseTextureIndex >= 0 ? texs[m.diffuseTextureIndex] : null;
              return `${m.name}|${m.diffuseTextureIndex}|${tex ? tex.path : ""}`;
            });
          canvasRef.current.dataset.v14dBakedActual = actual.join(";");
          canvasRef.current.dataset.v14dBakedTexStart = range ? String(range.start) : "";
          canvasRef.current.dataset.v14dBakedTexCount = range ? String(range.count) : "";
          canvasRef.current.dataset.v14dBakedTexFinal = String(texs.length);
        }
        // 实时合成模式的真实双纹理绑定证据（Stage 2B-M1）：Face diffuse=原始 face_d，
        // State2 mask=引擎补丁五在 GPU 材质建立前创建的独立纹理（rgba8unorm 线性视图）。
        if (isLiveState2 && canvasRef.current) {
          const texs = model.getTextures();
          const faceMat = model.getMaterials().find((m) => m.name === V14D_FACE_MATERIAL_NAME);
          const auxIdx = (model as unknown as { __v14dAuxTextureIndex?: Record<string, number> })
            .__v14dAuxTextureIndex?.[V14D_FACE_MATERIAL_NAME];
          const diffuseTex = faceMat && faceMat.diffuseTextureIndex >= 0 ? texs[faceMat.diffuseTextureIndex] : null;
          const maskTex = auxIdx !== undefined && auxIdx >= 0 ? texs[auxIdx] : null;
          canvasRef.current.dataset.v14dLiveState2 = "true";
          canvasRef.current.dataset.v14dLiveFaceDiffuse = diffuseTex ? diffuseTex.path : "";
          canvasRef.current.dataset.v14dLiveMaskPath = maskTex ? maskTex.path : "";
          canvasRef.current.dataset.v14dLiveMaskIndex = auxIdx !== undefined ? String(auxIdx) : "";
          canvasRef.current.dataset.v14dLiveBound =
            diffuseTex?.path.endsWith(V14D_FACE_BASE_TEXTURE_NAME) && maskTex?.path === V14D_STATE2_MASK_LOGICAL_PATH
              ? "true"
              : "false";
        }
        if (canvasRef.current) {
          canvasRef.current.dataset[V14D_FACE_STATIC_DATASET.texture] =
            isUvDebug ? "uv-debug" : v14dFaceStaticTextureName(v14dFaceStaticMode);
        }
      } else if (localModelImport) {
        // 生产 V1（V14D）皮肤变体：v1 且克莱妲权威 PMX 时复用导入目录 File[]，
        // 额外定位 State2 mask 并以唯一逻辑键注入（materialAuxTextures），引擎补丁
        // 在 GPU 材质建立前为 Face 建独立 rgba8unorm mask 纹理。mask 缺失或非克莱妲
        // 安全回退原始 Reze K3（不抛错、不污染其他模型/管线）。
        const v1Assets = v1Requested ? resolveV14dV1AssetsFromImport(localModelImport) : null;
        if (v1Assets) {
          model = await engine.loadModel("companion", {
            files: v1Assets.files,
            pmxFile: v1Assets.pmxFile,
            materialAuxTextures: { [V14D_FACE_MATERIAL_NAME]: V14D_STATE2_MASK_LOGICAL_PATH },
          } as Parameters<Engine["loadModel"]>[1]);
        } else {
          model = await engine.loadModel("companion", { files: localModelImport.files, pmxFile: localModelImport.pmxFile });
        }
      } else {
        model = await engine.loadModel("companion", modelUrl);
      }
      if (disposed) return;
      modelRef.current = model;
      applyKoledaDefaultAppearance(model);
      setRezeVmdCompletionHandler(model, (finishedName: string) => handleRezeVmdFinished(model, finishedName));
      // faceStatic：权威 PMX 已强门控为 Koleda，材质预设/分组不依赖外部 modelIdentifier/modelUrl。
      const isKoleda =
        v14dFaceStatic || isKoledaModelIdentifier(modelIdentifier, modelUrl, localModelImport?.pmxFile?.name);
      const koledaFaceAndBodyMaterials = isKoleda
        ? model.getMaterials().map((material) => material.name).filter(isKoledaFaceOrBodyMaterialName)
        : [];
      await engine.autoStyleGroups(
        "companion",
        koledaFaceAndBodyMaterials.length ? { cloth_smooth: koledaFaceAndBodyMaterials } : undefined,
      );
      const originalStyleGroups = engine.getStyleGroups("companion");
      baselineOriginalStyleGroupsRef.current = originalStyleGroups.map((group) => ({
        ...group,
        materials: [...group.materials],
      }));
      // 生产 V1（V14D）皮肤变体：仅克莱妲 + localModelImport + v1 且 mask 已注入时，
      // 把 Face/BodySkin 切到实时合成 graph（真实重新编译 + draw-call 绑定），
      // 其余材质保持 reze-k3 正常分组。applyStyleGroups 失败或非克莱妲安全回退。
      // 资格判定与 UI/effective variant 完全共用同一个 eligibility.eligible（单一权威，
      // 主会话第二次验收唯一 P0）：boot 不再叠加 isKoledaModelIdentifier 等第二套业务门控，
      // 消除「UI 选中 V1 但 boot 因 identifier 回退」的可达分歧。
      const v1Eligibility = evaluateRezeK3V1Eligibility(localModelImport);
      const v1Activation = resolveRezeK3SkinVariantActivation(
        v1Requested ? "v1" : "original",
        v1Eligibility,
        [modelIdentifier, modelUrl, localModelImport?.pmxFile?.name],
      );
      const v1Active = v1Activation.active;
      // 运行时防御性（非业务资格，不改变 effective 变体）：权威 PMX 已隐含克莱妲身份，
      // 若 identifier 启发式不一致只暴露统一告警状态供 UI/诊断读取，不静默改渲染。
      if (v1Activation.diagnosticIdentifierMismatch) {
        console.warn("[v14d-skin-variant] V1 资格已通过但克莱妲 identifier 启发式不一致（仍以资格谓词为准）");
        if (canvasRef.current) canvasRef.current.dataset.v14dSkinVariantIdentifierMismatch = "true";
      }
      if (v1Active) {
        try {
          const v1Groups = buildV14dSkinVariantStyleGroups(originalStyleGroups);
          const v1Result = await engine.applyStyleGroups("companion", v1Groups);
          if (canvasRef.current) {
            canvasRef.current.dataset.v14dSkinVariant = v1Result.ok ? "v1" : "original";
            canvasRef.current.dataset.v14dSkinVariantFaceGraph = v1Result.ok
              ? V14D_FACE_V1_COMPOSITE_GRAPH.name
              : "";
            // draw-call 级证据：Face/BodySkin/HairA/HairB 各自实际 groupId/pipeline/graph。
            // 深遍历已抽到 collectV14dSkinVariantBindingCounts（boot/探针共用）。
            try {
              const counts = collectV14dSkinVariantBindingCounts(engine);
              canvasRef.current.dataset.v14dSkinVariantFaceDrawCalls = String(counts.faceDrawCalls);
              canvasRef.current.dataset.v14dSkinVariantFaceOnComposite = String(counts.faceOnComposite);
              canvasRef.current.dataset.v14dSkinVariantBodyDrawCalls = String(counts.bodyDrawCalls);
              canvasRef.current.dataset.v14dSkinVariantBodyOnComposite = String(counts.bodyOnComposite);
              canvasRef.current.dataset.v14dSkinVariantHairADrawCalls = String(counts.hairADrawCalls);
              canvasRef.current.dataset.v14dSkinVariantHairAOnComposite = String(counts.hairAOnComposite);
              canvasRef.current.dataset.v14dSkinVariantHairBDrawCalls = String(counts.hairBDrawCalls);
              canvasRef.current.dataset.v14dSkinVariantHairBOnComposite = String(counts.hairBOnComposite);
              canvasRef.current.dataset.v14dSkinVariantBrowsDrawCalls = String(counts.browsDrawCalls);
              canvasRef.current.dataset.v14dSkinVariantBrowsOnComposite = String(counts.browsOnComposite);
              canvasRef.current.dataset.v14dSkinVariantLashesDrawCalls = String(counts.lashesDrawCalls);
              canvasRef.current.dataset.v14dSkinVariantLashesOnComposite = String(counts.lashesOnComposite);
            } catch { /* 证据读取失败不阻断渲染 */ }
          }
          if (!v1Result.ok) {
            console.warn("[v14d-skin-variant] V1 graph 应用失败，回退原始 Reze K3", JSON.stringify(v1Result.groups));
          }
        } catch (error) {
          if (canvasRef.current) canvasRef.current.dataset.v14dSkinVariant = "original";
          console.warn("[v14d-skin-variant] V1 启用异常，回退原始 Reze K3", error);
        }
      } else if (canvasRef.current) {
        canvasRef.current.dataset.v14dSkinVariant = v1Activation.effective;
      }
      if (v14dUnlitDiagnostic) {
        const modelMaterialNames = new Set(model.getMaterials().map((material) => material.name));
        const unlitPlan = buildV14dUnlitStyleGroups(originalStyleGroups, modelMaterialNames, v14dFaceStatic);
        if (canvasRef.current) {
          canvasRef.current.dataset.v14dUnlitDiagnostic = "true";
          canvasRef.current.dataset.v14dUnlitGraph = V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH.name;
          canvasRef.current.dataset.v14dUnlitGroups = unlitPlan.appliedGroups.join(",");
          canvasRef.current.dataset.v14dUnlitUnknownMaterials = unlitPlan.unknownMaterials.join(",");
        }
        if (!v14dColorBaseline) {
          const unlit = await applyV14dUnlitStyleGroups(engine, modelMaterialNames, originalStyleGroups);
          if (canvasRef.current) {
            canvasRef.current.dataset.v14dUnlitGroups = unlit.appliedGroups.join(",");
            canvasRef.current.dataset.v14dUnlitUnknownMaterials = unlit.unknownMaterials.join(",");
          }
        }
      }
      if (v14dFaceStatic) {
        // worldPos 模式：所有材质统一输出 world_pos 颜色，验证相机/缩放几何。
        if (v14dFaceStaticMode === "worldPos" || v14dFaceStaticMode === "diffuseFlat") {
          const allNames = model.getMaterials().map((m) => m.name);
          const worldPosResult = await engine.applyStyleGroups("companion", [
            {
              id: "v14d-gf-world-pos",
              label: "V14D GF World Pos Debug",
              materials: allNames,
              graph: v14dFaceStaticMode === "worldPos" ? V14D_FACE_STATIC_WORLD_POS_GRAPH : V14D_FACE_STATIC_DIFFUSE_GRAPH,
            },
          ]);
          if (canvasRef.current) {
            canvasRef.current.dataset[V14D_FACE_STATIC_DATASET.faceMaterialApplied] = String(worldPosResult.ok);
          }
        }
        // Stage 2B-M1 实时合成（修正轮）：normal 用原始 face_d（纯纹理 unlit 基线）；
        // faceShadowOnly/finalFaceComposite 把 Face 切到实时合成 graph，引擎补丁五
        // 按 graph.name 精确覆写 final_color，从原始 face_d + State2 packed mask + 取证常量
        // 在线性空间实时计算 warm/art/fringe（不再是整张预烘焙脸图或纯纹理替换）。
        // 保证「只有 Face 材质输出变化」的严格 A/B；其余材质保持 reze-k3 正常分组。
        // uvDebug 模式只输出 Face 的插值 UV（几何节点），供 UV-direct 对账。
        if (v14dFaceStaticMode !== "worldPos" && v14dFaceStaticMode !== "diffuseFlat") {
        if (v14dFaceStaticMode === "bakedGolden") {
          // 黄金帧最终着色烘焙模式：把全部烘焙材质切到纯纹理 unlit graph，
          // 纹理来自 Blender frame120 Cycles COMBINED 最终着色烘焙图
          // （含六 AREA 灯/世界光/Toon/Face Shadow，保留 alpha cutout）。
          //
          // 逐材质独立绑定（修复重复逻辑键覆盖）：烘焙文件以唯一逻辑键
          // Textures/v14d-baked/baked_<key>.png 注入 fileMap；加载后按 PMX 材质名
          // 把该材质 diffuse 纹理路径改写为对应烘焙键，引擎按路径独立解析，
          // 不再发生 EyeWhite 覆盖 Face / HairB 覆盖 HairA / 空 Cape 覆盖 Top。
          // 真实 GPU 绑定已在 loadModel 内完成（materialDiffuseOverrides 在
          // setupMaterialsForInstance 之前追加独立 texture entry 并改 diffuseTextureIndex，
          // GPU 材质建立时即读取正确烘焙纹理）。此处仅切 unlit graph 做 passthrough 显示。
          const bakedMaterials = V14D_BAKED_BINDINGS.map((b) => b.pmxMaterial);
          const bakedGroups = originalStyleGroups.map((group) => ({
            ...group,
            materials: group.materials.filter((name) => !bakedMaterials.includes(name)),
          })).filter((group) => group.materials.length > 0);
          const bakedResult = await engine.applyStyleGroups("companion", [
            ...bakedGroups,
            {
              id: "v14d-baked-golden",
              label: "V14D Baked Golden Frame",
              materials: bakedMaterials,
              graph: V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH,
            },
          ]);
          if (canvasRef.current) {
            canvasRef.current.dataset[V14D_FACE_STATIC_DATASET.faceMaterialApplied] = String(bakedResult.ok);
          }
          if (!bakedResult.ok) {
            console.warn("[v14d-face-static] bakedGolden graph 应用失败", bakedResult);
          }
        } else {
        // 实时合成模式（Stage 2B-M1/M3）：Face 套实时 graph（引擎按 graph.name 覆写输出
        // 为 mask 公式）；finalFaceComposite 额外把 BodySkin 切到身体暖肤合成 graph
        // （Stage 2B-M3 全身皮肤统一：脖子/腰/双手与脸同一 V14D skin family 口径）。
        // normal/uvDebug 保持既有单纹理/UV 输出（normal 是 A/B 基线，BodySkin 不动）。
        const faceGraph =
          v14dFaceStaticMode === "uvDebug"
            ? V14D_FACE_UV_DEBUG_GRAPH_LEGACY
            : v14dFaceStaticMode === "faceShadowOnly"
              ? V14D_FACE_LIVE_SHADOW_GRAPH
              : v14dFaceStaticMode === "finalFaceComposite"
                ? V14D_FACE_LIVE_COMPOSITE_GRAPH
                : V14D_FACE_STATIC_GRAPH;
        const applyBodySkin = v14dFaceStaticMode === "finalFaceComposite";
        const excluded = new Set<string>([V14D_FACE_MATERIAL_NAME]);
        if (applyBodySkin) excluded.add(V14D_BODY_MATERIAL_NAME);
        const faceGroups = originalStyleGroups.map((group) => ({
          ...group,
          materials: group.materials.filter((name) => !excluded.has(name)),
        })).filter((group) => group.materials.length > 0);
        const skinGroups: Parameters<Engine["applyStyleGroups"]>[1] = [
          ...faceGroups,
          {
            id: "v14d-face-static",
            label: "V14D Face Static State2",
            materials: [V14D_FACE_MATERIAL_NAME],
            graph: faceGraph,
          },
        ];
        if (applyBodySkin) {
          // P0-4 诊断 fault injection（默认关闭，仅 v14dBodyFault 查询参数显式开启）：
          //  missing=漏绑 BodySkin 组；wrongGraph=BodySkin 绑到错误 graph 名；
          //  wrongMaterial=把 BodySkin graph 绑到 HairA（错材质）。供运行时负测验证 Gate 检出。
          const fault = new URLSearchParams(window.location.search).get("v14dBodyFault");
          if (fault === "missing") {
            // 漏绑：不 push BodySkin 组，BodySkin 保持原分组（已被 excluded 移除，进入 retained）。
          } else if (fault === "wrongGraph") {
            skinGroups.push({
              id: "v14d-body-skin-composite",
              label: "V14D Body Skin Composite",
              materials: [V14D_BODY_MATERIAL_NAME],
              graph: { ...V14D_BODY_LIVE_COMPOSITE_GRAPH, name: "V14D Face Live Composite" },
            });
          } else if (fault === "wrongMaterial") {
            skinGroups.push({
              id: "v14d-body-skin-composite",
              label: "V14D Body Skin Composite",
              materials: ["HairA"],
              graph: V14D_BODY_LIVE_COMPOSITE_GRAPH,
            });
          } else {
          skinGroups.push({
            id: "v14d-body-skin-composite",
            label: "V14D Body Skin Composite",
            materials: [V14D_BODY_MATERIAL_NAME],
            graph: V14D_BODY_LIVE_COMPOSITE_GRAPH,
          });
          }
        }
        const faceResult = await engine.applyStyleGroups("companion", skinGroups);
        if (canvasRef.current) {
          canvasRef.current.dataset[V14D_FACE_STATIC_DATASET.faceMaterialApplied] = String(faceResult.ok);
          if (applyBodySkin) {
            // Stage 2B-M3 修正轮（P0-3）：bodyApplied 必须来自引擎真实 draw-call/graph 状态，
            // 不再是「faceResult.ok && 材质存在」的自证。三层核对：
            //  (1) applyStyleGroups 的分组诊断里 body 组（id=v14d-body-skin-composite）编译+安装 ok；
            //  (2) 引擎 getStyleGroups 里 BodySkin 当前归属的组 graph.name 恰为
            //      "V14D Body Skin Composite"（证明它实际绑定的是身体暖肤合成 graph，
            //      而非漏绑/错绑到别的 graph）；
            //  (3) 该组确实声明了 BodySkin 材质。
            const bodyGroupResult = faceResult.groups.find((g) => g.groupId === "v14d-body-skin-composite");
            const installedGroups = engine.getStyleGroups("companion");
            const bodyInstall = installedGroups.find(
              (g) => Array.isArray(g.materials) && g.materials.includes(V14D_BODY_MATERIAL_NAME),
            );
            const bodyGraphName = bodyInstall?.graph?.name ?? null;
            const bodyOk =
              !!bodyGroupResult?.ok &&
              bodyGraphName === "V14D Body Skin Composite";
            canvasRef.current.dataset[V14D_FACE_STATIC_DATASET.bodyMaterialApplied] = String(bodyOk);
            // 供 Gate 读取真实绑定证据（不是自证）：实际 graph 名 + 组诊断 ok。
            canvasRef.current.dataset.v14dBodySkinGraph = bodyGraphName ?? "";
            canvasRef.current.dataset.v14dBodySkinGroupOk = String(!!bodyGroupResult?.ok);
            // P0-4：draw-call 级证据——BodySkin 的每个 draw call 实际 groupId/pipeline/graph。
            try {
              const insts = (engine as unknown as { modelInstances?: Map<string, unknown> }).modelInstances;
              let bodyCalls = 0; let bodyOnComposite = 0;
              if (insts) {
                for (const inst of insts.values()) {
                  const drawCalls = (inst as { drawCalls?: { materialName: string; groupId: string | null; baseBindGroupEntries?: unknown }[] }).drawCalls;
                  const styleGroups = (inst as { styleGroups?: Map<string, { pipeline?: unknown; group?: { graph?: { name?: string } } }> }).styleGroups;
                  if (!drawCalls) continue;
                  for (const dc of drawCalls) {
                    if (!dc.baseBindGroupEntries || dc.materialName !== V14D_BODY_MATERIAL_NAME) continue;
                    bodyCalls += 1;
                    const install = dc.groupId && styleGroups ? styleGroups.get(dc.groupId) : undefined;
                    if (dc.groupId === "v14d-body-skin-composite" && install?.pipeline && install?.group?.graph?.name === "V14D Body Skin Composite") bodyOnComposite += 1;
                  }
                }
              }
              canvasRef.current.dataset.v14dBodySkinDrawCalls = String(bodyCalls);
              canvasRef.current.dataset.v14dBodySkinDrawOnComposite = String(bodyOnComposite);
            } catch { /* 保持既有状态 */ }
          }
        }
        if (!faceResult.ok) {
          console.warn("[v14d-face-static] Face graph 应用失败: " + JSON.stringify(faceResult.groups));
        }
        }
      }
      }
      if (isKoleda) {
        for (const [index, material] of model.getMaterials().entries()) {
          if (!isKoledaFaceOrBodyMaterialName(material.name)) continue;
          const current = materialStateRef.current.get(stableMaterialId(index)) ?? { visible: true, preset: "默认" };
          materialStateRef.current.set(stableMaterialId(index), { ...current, preset: "柔滑布料" });
        }
      }
      if (disposed) return;
      if (v14dColorBaseline || v14dFaceStatic) applySceneSettings(effectiveInitialSettings);
      else applySceneSettings(initialSettings);
      if (v14dFaceStatic) {
        // 黄金帧构图：暗背景 + 无地面 + bloom 关闭，对齐 blend 最终画面口径；
        // 曝光 -0.56 对齐权威 AgX exposure，look 保持引擎默认 medium_high_contrast。
        const faceEngine = engineRef.current;
        if (faceEngine) {
          faceEngine.setBackgroundColor(hexToLinearVec3("#050505"));
          faceEngine.addGround({ opacity: 0, width: 0, height: 0 });
          faceEngine.setBloomOptions({ enabled: false, intensity: 0 });
          // bakedGolden：烘焙纹理=Cycles COMBINED 最终着色线性（含六灯/世界光/Toon/Face Shadow），
          // 已含全部光照，用曝光 0 原样显示（Web 端不再叠加光照/曝光）；
          // 其余三模式仍对齐权威 AgX 曝光 -0.56。
          faceEngine.setViewTransformOptions(
            v14dFaceStaticMode === "bakedGolden"
              ? { exposure: 0, gamma: 1.0, displayPassthrough: true }
              : { exposure: -0.56, gamma: 1.0 },
          );
        }
        // 配准负测（Stage 2B-M1）：v14dFaceCameraOverride=shift 平移相机 +X 6 PMX 单位；
        // null 强制不恢复相机（保持 boot 默认），使 Gate 读取的实际 fov/position/target 缺失。
        const camSnapshot = v14dFaceCameraWithOverride(V14D_FACE_STATIC_CAMERA, v14dFaceCameraOverride);
        if (camSnapshot) {
          restorePersistedCamera(camSnapshot);
          readRezeCamera(engine)?.setInputLocked(true);
        }
      } else if (v14dColorBaseline) {
        restorePersistedCamera(V14D_COLOR_BASELINE_CAMERA);
        readRezeCamera(engine)?.setInputLocked(true);
      } else {
        restorePersistedCamera();
      }
      applyGrade(gradeRef.current, gradeIntensityRef.current);
      const initialInteraction = interactionRef.current;
      // faceStatic：用注入的权威 VMD File（对象 URL），不经网络 URL。
      const faceStaticVmdUrl =
        v14dFaceStatic && window.__v14dFaceStaticAssets?.vmdFile
          ? URL.createObjectURL(window.__v14dFaceStaticAssets.vmdFile)
          : null;
      const effectiveVmdUrl: string = v14dFaceStatic
        ? faceStaticVmdUrl ?? ""
        : initialInteraction.vmdUrl || "";
      if (effectiveVmdUrl) {
        const requestId = vmdRequestGuardRef.current.begin();
        const vmdSrc = effectiveVmdUrl;
        const name = v14dFaceStatic
          ? V14D_FACE_STATIC_AUTHORITY.vmdFileName
          : vmdSrc.split("/").pop() || "motion.vmd";
        const [policy] = await Promise.all([
          readRezeVmdIkPolicy(vmdSrc),
          model.loadVmd(name, vmdSrc),
        ]);
        if (disposed || !vmdRequestGuardRef.current.isCurrent(requestId)) return;
          applyVmdIkPolicy(engine, policy);
          baselineVmdLoadedRef.current = true;
          if (v14dColorBaseline || v14dFaceStatic) {
            // loadVmd() 只登记剪辑；必须先把它设为当前动作，seek() 才会
            // 写入 frame 120。否则固定单帧诊断会继续渲染绑定姿态。
            playRezeVmd(model, name);
            model.seek(v14dFaceStatic ? V14D_FACE_STATIC_SECONDS : V14D_COLOR_BASELINE_SECONDS);
            model.pause();
            currentVmdUrlRef.current = vmdSrc;
          } else {
          playRezeVmd(model, name);
          currentVmdUrlRef.current = vmdSrc;
          armRezeVmdCompletionFallback(model, name, vmdSrc);
        }
        engine.resetPhysics();
      }
      if (v14dColorBaseline || v14dFaceStatic) {
        engine.stopRenderLoop();
        model.pause();
        engine.renderFrame(0);
        // 黄金帧：模型以 PMX 单位渲染（实测 skinned head Y≈16.42，与相机
        // 同单位），无需 setModelTransform 缩放；V14D_FACE_STATIC_CAMERA
        // 已按 PMX 单位换算自权威 PROTO_GameCamera。
      } else {
        engine.runRenderLoop();
      }
      if (v14dFaceStatic && canvasRef.current) {
        v14dFaceCameraFreeRef.current = false;
        // 黄金帧诊断探针：暴露引擎相机实际值与模型世界包围盒，供采集脚本核对构图。
        const gfEngine = engineRef.current;
        const gfModel = modelRef.current;
        (window as unknown as { __rezeEngineProbe?: () => unknown }).__rezeEngineProbe = () => {
          // 黄金帧诊断探针（最小字段）：仅暴露核对构图所需的引擎相机实际值、
          // 模型变换与脸部皮肤后世界包围盒，供采集脚本核对相机/缩放对齐。
          const cam = gfEngine ? readRezeCamera(gfEngine) : null;
          const pos = cam?.getPosition?.();
          let faceBox: { center: number[] | null; sizeY: number | null; minW: number[]; maxW: number[] } | null = null;
          try {
            const verts = (gfModel as unknown as { getVertices?: () => ArrayLike<number> | null })?.getVertices?.();
            const skinning = gfModel?.getSkinning?.();
            const joints = skinning?.joints;
            const weights = skinning?.weights;
            const skinMats = gfModel?.getSkinMatrices?.();
            const mats = gfModel?.getMaterials?.() ?? [];
            const indices = gfModel?.getIndices?.();
            const faceMatIdx = mats.findIndex((m) => m.name === "Face");
            if (verts && skinMats && joints && weights && indices && faceMatIdx >= 0) {
              let idxStart = 0;
              for (let mi = 0; mi < faceMatIdx; mi += 1) idxStart += mats[mi].vertexCount;
              const idxEnd = idxStart + mats[faceMatIdx].vertexCount;
              const faceVertSet = new Set<number>();
              for (let k = idxStart; k < idxEnd; k += 1) faceVertSet.add(indices[k]);
              const minW = [Infinity, Infinity, Infinity];
              const maxW = [-Infinity, -Infinity, -Infinity];
              const px: number[] = []; const py: number[] = []; const pz: number[] = [];
              for (const vi of faceVertSet) {
                const bx = verts[vi * 8], by = verts[vi * 8 + 1], bz = verts[vi * 8 + 2];
                let wx = 0, wy = 0, wz = 0;
                for (let k = 0; k < 4; k += 1) {
                  const bi = joints[vi * 4 + k];
                  const w = weights[vi * 4 + k] / 255;
                  if (w <= 0) continue;
                  const o = bi * 16;
                  wx += w * (skinMats[o] * bx + skinMats[o + 4] * by + skinMats[o + 8] * bz + skinMats[o + 12]);
                  wy += w * (skinMats[o + 1] * bx + skinMats[o + 5] * by + skinMats[o + 9] * bz + skinMats[o + 13]);
                  wz += w * (skinMats[o + 2] * bx + skinMats[o + 6] * by + skinMats[o + 10] * bz + skinMats[o + 14]);
                }
                px.push(wx); py.push(wy); pz.push(wz);
                minW[0] = Math.min(minW[0], wx); maxW[0] = Math.max(maxW[0], wx);
                minW[1] = Math.min(minW[1], wy); maxW[1] = Math.max(maxW[1], wy);
                minW[2] = Math.min(minW[2], wz); maxW[2] = Math.max(maxW[2], wz);
              }
              if (px.length > 0) {
                const med = (a: number[]) => { const s = [...a].sort((p, q2) => p - q2); return s[Math.floor(s.length / 2)]; };
                faceBox = { center: [med(px), med(py), med(pz)], sizeY: maxW[1] - minW[1], minW, maxW };
              }
            }
          } catch { /* ignore */ }
          return {
            camera: cam && pos
              ? { position: [pos.x, pos.y, pos.z], target: [cam.target.x, cam.target.y, cam.target.z], fovDeg: (cam.fov * 180) / Math.PI }
              : null,
            modelTransform: gfEngine?.getModelTransform?.("companion") ?? null,
            faceBox,
          };
        };
        const canvas = canvasRef.current;
        canvas.dataset[V14D_FACE_STATIC_DATASET.enabled] = "true";
        canvas.dataset[V14D_FACE_STATIC_DATASET.mode] = v14dFaceStaticMode;
        canvas.dataset[V14D_FACE_STATIC_DATASET.frame] = String(V14D_FACE_STATIC_FRAME);
        canvas.dataset[V14D_FACE_STATIC_DATASET.state] = String(V14D_FACE_STATIC_STATE);
        canvas.dataset[V14D_FACE_STATIC_DATASET.blend] = V14D_FACE_STATIC_BLEND.toFixed(2);
        // 采集实际 Web 相机（Stage 2B-M1 配准 Gate 输入）：负测 override 下这些值
        // 与权威相机不同或缺失，配准 Gate 必须据此失败。cameraLocked 反映实际锁定。
        const actualCam = captureRezeCameraSnapshot(engine);
        canvas.dataset[V14D_FACE_STATIC_DATASET.cameraLocked] = actualCam && v14dFaceCameraOverride !== "null" ? "true" : "false";
        canvas.dataset[V14D_FACE_STATIC_DATASET.cameraFov] = actualCam ? String(actualCam.fov) : "";
        canvas.dataset[V14D_FACE_STATIC_DATASET.cameraPos] = actualCam ? actualCam.position.join(",") : "";
        canvas.dataset.v14dFaceCameraTarget = actualCam ? actualCam.target.join(",") : "";
        canvas.dataset[V14D_FACE_STATIC_DATASET.paused] = "true";
        canvas.dataset[V14D_FACE_STATIC_DATASET.authority] =
          `${V14D_FACE_STATIC_AUTHORITY.pmxFileName}#${V14D_FACE_STATIC_AUTHORITY.vmdFileName}`;
      }
      reportStatus(
        "ready",
        `${localModelImport ? `已导入 ${localModelImport.pmxFile.name}` : "WebGPU 已就绪"} · ${model.getMaterials().length} 个 PMX 材质${v14dUnlitDiagnostic ? " · V14D Unlit 诊断" : ""}${v14dColorBaseline ? " · 白光颜色基线单帧" : ""}${v14dFaceStatic ? ` · V14D Face Static ${v14dFaceStaticMode} f${V14D_FACE_STATIC_FRAME}` : ""}`,
      );
    };
    void boot().catch((error: unknown) => {
      if (!disposed) reportStatus("error", error instanceof Error ? error.message : String(error));
    });
    return () => {
      disposed = true;
      engineReadyRef.current = false;
      v14dFaceCameraFreeRef.current = false;
      modelRef.current = null;
      // 黄金帧诊断探针：页面卸载/默认入口时清除，避免残留到生产路径。
      delete (window as unknown as { __rezeEngineProbe?: unknown }).__rezeEngineProbe;
      clearVmdCompletionFallback();
      vmdIkPolicyCacheRef.current.clear();
      materialStateRef.current.clear();
      baselineOriginalStyleGroupsRef.current = null;
      baselineResultRef.current = null;
      baselineVmdLoadedRef.current = false;
      baselineCapturePromiseRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [modelUrl, localModelImport, modelIdentifier, v14dUnlitDiagnostic, v14dColorBaseline, v14dFaceStatic, v14dFaceStaticMode, scenePreset, v14dSkinVariant]);

  useEffect(() => {
    if (v14dColorBaseline || v14dFaceStatic || !sceneSettings) return;
    applySceneSettings(sceneSettings);
  }, [sceneSettings, v14dColorBaseline, v14dFaceStatic]);

  useEffect(() => {
    if (v14dColorBaseline || v14dFaceStatic) return;
    restorePersistedCamera(cameraSnapshot);
  }, [cameraSnapshot, v14dColorBaseline, v14dFaceStatic]);

  useEffect(() => {
    if (v14dColorBaseline || v14dFaceStatic) return;
    const engine = engineRef.current;
    if (!engine || !engineReadyRef.current) return;
    void engine.setBackgroundEffect(backgroundEffect === "Shining Stars" ? REZE_SHINING_STARS_WGSL : null).then((result) => {
      if (!result.ok) reportStatus("error", `Shining Stars 背景编译失败：${result.diagnostics.join("; ")}`);
    });
  }, [backgroundEffect, v14dColorBaseline]);

  useEffect(() => {
    applyGrade(grade, gradeIntensity);
  }, [grade, gradeIntensity]);

  // 共享的「经 interaction 路径加载并播放 VMD」：通用 VMD effect 与验收探针
  // playVmd 共用同一条调用，确保成功 load/apply/play 后必然 engine.resetPhysics()。
  // 曾误删通用 effect 的 resetPhysics（验收回归 P0-2），此处以共享函数统一恢复并
  // 自增可判别计数，验收据此断言该路径真实调用了 resetPhysics。
  const loadVmdThroughInteractionPath = useCallback(async (url: string, loopUrls?: string[] | null, guard?: (() => boolean) | null) => {
    const model = modelRef.current;
    if (!model) throw new Error("no model");
    const name = url.split("/").pop() || "motion.vmd";
    const [policy] = await Promise.all([
      readRezeVmdIkPolicy(url),
      model.loadVmd(name, url),
    ]);
    // 请求守卫硬检查（P0）：必须发生在任何 apply/play/currentUrl/fallback/resetPhysics
    // 副作用之前。较慢完成的旧请求在 await 返回时若已不是当前请求（或模型已切换），
    // 必须无副作用退出，不得改写模型状态或自增计数。
    if (guard && !guard()) return null;
    if (model !== modelRef.current) return null;
    const engine = engineRef.current;
    if (!engine) throw new Error("no engine");
    applyVmdIkPolicy(engine, policy);
    // 只有在「上一个动作已经结束（currentVmdUrlRef 已被完成回调清空）」时
    // 才代表真的没有动作在播，直接 show/play 从绑定姿势起跳；只要前一个
    // 动作仍在进行中（currentVmdUrlRef 非空），新动作必须保留当前姿势，避免
    // 模型被 resetAllBones() 拉回 T 形再跳到新动作，产生闪烁。
    playRezeVmd(model, name, { preserveCurrentPose: Boolean(currentVmdUrlRef.current) });
    currentVmdUrlRef.current = url;
    if (loopUrls?.includes(url)) lastLoopVmdUrlRef.current = url;
    armRezeVmdCompletionFallback(model, name, url);
    onInteractionStartedRef.current?.();
    engine.resetPhysics();
    if (canvasRef.current) {
      const c = canvasRef.current;
      c.dataset.vmdEffectResetPhysicsCount = String(Number(c.dataset.vmdEffectResetPhysicsCount || 0) + 1);
    }
    return name;
  }, []);

  useEffect(() => {
    // 固定单帧诊断（colorBaseline / faceStatic）在 boot 内一次性加载 VMD 并
    // seek→pause→stopRenderLoop→renderFrame(0)，通用 VMD effect 不得再 play/resetPhysics。
    if (v14dColorBaseline || v14dFaceStatic) return;
    const requestId = vmdRequestGuardRef.current.begin();
    const model = modelRef.current;
    if (!model || interaction.mode !== "vmd" || !interaction.vmdUrl) return;
    const url = interaction.vmdUrl;
    const load = async () => {
      try {
        // 守卫在共享函数内部、任何副作用前检查（P0）；调用方不再依赖「返回后才检查」。
        await loadVmdThroughInteractionPath(url, interaction.vmdLoopUrls, () =>
          vmdRequestGuardRef.current.isCurrent(requestId) && model === modelRef.current
        );
      } catch (error) {
        if (!vmdRequestGuardRef.current.isCurrent(requestId)) return;
        reportStatus("error", `VMD 加载失败：${error instanceof Error ? error.message : String(error)}`);
        onInteractionErrorRef.current?.({ type: "vmd", vmdUrl: url });
      }
    };
    void load();
    // 进度镜像（只读）：当前 VMD 播放进度 → canvas dataset，供真实 /companion 验收
    // 断言 play/pause/seek 的实际帧前进。reze-k3 无 __mmdCompanionRuntime，本 dataset
    // 是该管线唯一可外部读取的播放状态来源。随 VMD 播放生命周期启动/终止。
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const nm = (interaction.vmdUrl || "").split("/").pop() || "";
      canvas.dataset.vmdPlaybackName = nm;
      // 启动新进度镜像前先清掉旧镜像，避免同名 VMD 残留多个 rAF 循环。
      vmdPlaybackMirrorCleanupRef.current?.();
      vmdPlaybackMirrorCleanupRef.current = null;
      let rafId = 0;
      let cancelled = false;
      const tick = () => {
        if (cancelled || canvas.dataset.vmdPlaybackName !== nm || !nm) return; // 已停止/切换/卸载
        const progress = modelRef.current?.getAnimationProgress?.();
        if (progress) {
          canvas.dataset.vmdPlaybackCurrent = String(Number(progress.current) || 0);
          canvas.dataset.vmdPlaybackDuration = String(Number(progress.duration) || 0);
          canvas.dataset.vmdPlaybackPlaying = String(Boolean(progress.playing));
        }
        rafId = globalThis.requestAnimationFrame(tick);
      };
      rafId = globalThis.requestAnimationFrame(tick);
      vmdPlaybackMirrorCleanupRef.current = () => { cancelled = true; globalThis.cancelAnimationFrame(rafId); };
    }
    return () => {
      // 清理：取消进度镜像 rAF 并清除 dataset，避免卸载后残留。
      vmdPlaybackMirrorCleanupRef.current?.();
      vmdPlaybackMirrorCleanupRef.current = null;
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        delete canvas.dataset.vmdPlaybackName;
        delete canvas.dataset.vmdPlaybackCurrent;
        delete canvas.dataset.vmdPlaybackDuration;
        delete canvas.dataset.vmdPlaybackPlaying;
      }
    };
  }, [interaction.mode, interaction.vmdUrl, interaction.playbackRate, interaction.vmdRequestId, v14dColorBaseline, v14dFaceStatic]);

  // 验收探针（仅在显式验收开关 ?v14dAcceptanceProbe=1 下暴露，生产默认不挂载）：reze-k3
  // 走 reze-engine，没有 __mmdCompanionRuntime。暴露最小 play/pause/seek 供真实
  // /companion 验收脚本驱动 VMD load→play→pause→seek，经 modelRef/engineRef 复用与
  // interaction effect 同一条引擎调用路径。卸载时清除，避免残留。
  const acceptanceProbeEnabled =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("v14dAcceptanceProbe") === "1";
  useEffect(() => {
    if (!acceptanceProbeEnabled) return;
    // 仅在显式验收开关下启用显示链取证；默认生产入口不会安装。
    // 包装真实 Engine 方法但不改变参数或返回值，只记录传给
    // setPipeline/setBindGroup/drawIndexed 的管线与绑定组对象。
    type V14dDisplayTraceDraw = {
      instanceName: string;
      materialName: string | null;
      type: string;
      drawIndex: number | null;
      drawOrder: number;
      count: number;
      firstIndex: number;
      groupId: string | null;
      pipeline: unknown;
      bindGroup: unknown;
      matchStatus: "unique" | "ambiguous" | "unmatched";
      candidateIndices: number[];
      drawIdentityKey: string;
    };
    type V14dDisplayTraceFrame = {
      schemaVersion: 1;
      captureId: string | null;
      frame: number | null;
      requestSerial: number;
      renderSerial: number;
      draws: V14dDisplayTraceDraw[];
      pipelineBinds: { instanceName: string; type: string; pipeline: unknown }[];
      compositePipeline: unknown;
      compositeGamma: number | null;
    };
    const displayChainObjectIds = new WeakMap<object, string>();
    let nextDisplayChainObjectId = 1;
    const displayChainObjectId = (value: unknown) => {
      if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
      const object = value as object;
      const existing = displayChainObjectIds.get(object);
      if (existing) return existing;
      const id = "gpu-" + nextDisplayChainObjectId++;
      displayChainObjectIds.set(object, id);
      return id;
    };
    let displayChainTraceCleanup: (() => void) | null = null;
    let displayChainTraceRequested: { captureId: string; frame: number; requestSerial: number } | null = null;
    let displayChainTraceCurrent: V14dDisplayTraceFrame | null = null;
    let displayChainTraceLast: V14dDisplayTraceFrame | null = null;
    let displayChainRenderSerial = 0;
    let displayChainRequestSerial = 0;
    type V14dDisplayTraceInstallResult =
      | { ok: true; alreadyInstalled?: boolean }
      | { ok: false; error: string };
    // install/set/capture 三个方法共同构成一个显示链验收探针，不是三个独立的调试分支。
    const serializeDisplayChainTrace = (trace: V14dDisplayTraceFrame | null) => trace
      ? {
          schemaVersion: trace.schemaVersion,
          captureId: trace.captureId,
          frame: trace.frame,
          requestSerial: trace.requestSerial,
          renderSerial: trace.renderSerial,
          draws: trace.draws.map((draw) => ({
            ...draw,
            pipeline: displayChainObjectId(draw.pipeline),
            bindGroup: displayChainObjectId(draw.bindGroup),
          })),
          pipelineBinds: trace.pipelineBinds.map((bind) => ({ ...bind, pipeline: displayChainObjectId(bind.pipeline) })),
          compositePipeline: displayChainObjectId(trace.compositePipeline),
          compositeGamma: trace.compositeGamma,
        }
      : null;
    const installDisplayChainTrace = (): V14dDisplayTraceInstallResult => {
      const engine = engineRef.current;
      if (!engine) return { ok: false, error: "engine unavailable" };
      if (displayChainTraceCleanup) return { ok: true, alreadyInstalled: true };
      const target = engine as unknown as Record<string, unknown>;
      const originalRenderFrame = target.renderFrame;
      const originalDrawMaterials = target.drawMaterials;
      if (typeof originalRenderFrame !== "function" || typeof originalDrawMaterials !== "function") {
        return { ok: false, error: "reze-engine display trace seam unavailable" };
      }
      const renderFrame = originalRenderFrame as (deltaSeconds: number) => unknown;
      const drawMaterials = originalDrawMaterials as (pass: unknown, inst: unknown, type: unknown) => unknown;
      const wrappedRenderFrame = function (this: unknown, deltaSeconds: number) {
        const requested = displayChainTraceRequested;
        const trace: V14dDisplayTraceFrame = {
          schemaVersion: 1,
          captureId: requested?.captureId ?? null,
          frame: requested?.frame ?? null,
          requestSerial: requested?.requestSerial ?? 0,
          renderSerial: ++displayChainRenderSerial,
          draws: [],
          pipelineBinds: [],
          compositePipeline: null,
          compositeGamma: null,
        };
        displayChainTraceCurrent = trace;
        try {
          return renderFrame.call(this, deltaSeconds);
        } finally {
          const fields = this as Record<string, unknown>;
          const view = fields.viewTransform as { gamma?: unknown } | undefined;
          const gamma = Number(view?.gamma);
          trace.compositeGamma = Number.isFinite(gamma) ? gamma : null;
          trace.compositePipeline = gamma === 1
            ? fields.compositePipelineIdentity
            : fields.compositePipelineGamma;
          displayChainTraceLast = trace;
          displayChainTraceCurrent = null;
        }
      };
      const wrappedDrawMaterials = function (this: unknown, pass: unknown, inst: unknown, type: unknown) {
        const trace = displayChainTraceCurrent;
        if (!trace || !pass || typeof pass !== "object") return drawMaterials.call(this, pass, inst, type);
        let pipeline: unknown = null;
        let materialBindGroup: unknown = null;
        const instance = inst as { name?: string; drawCalls?: { type?: string; materialName?: string; count?: number; firstIndex?: number; groupId?: string | null; drawIndex?: number | null }[] };
        const drawCalls = instance.drawCalls ?? [];
        const instanceName = String(instance.name ?? "unknown");
        const wrappedPass = new Proxy(pass as object, {
          get(targetPass, property, receiver) {
            const method = Reflect.get(targetPass, property, receiver);
            if (typeof method !== "function") return method;
            if (property === "setPipeline") {
              return (nextPipeline: unknown) => {
                pipeline = nextPipeline;
                trace.pipelineBinds.push({ instanceName, type: String(type), pipeline: nextPipeline });
                return (method as (...args: unknown[]) => unknown).call(targetPass, nextPipeline);
              };
            }
            if (property === "setBindGroup") {
              return (index: number, bindGroup: unknown, ...rest: unknown[]) => {
                if (index === 2) materialBindGroup = bindGroup;
                return (method as (...args: unknown[]) => unknown).call(targetPass, index, bindGroup, ...rest);
              };
            }
            if (property === "drawIndexed") {
              return (count: number, ...args: unknown[]) => {
                const firstIndex = Number(args[1] ?? 0);
                const match = findV14dDisplayChainDrawMatch(drawCalls, { type: String(type), count, firstIndex });
                const draw = match.status === "unique" ? match.draw : null;
                const drawIndex = match.status === "unique"
                  ? (draw?.drawIndex == null
                    ? match.index
                    : Number.isInteger(draw.drawIndex) ? draw.drawIndex : null)
                  : null;
                const drawOrder = trace.draws.length;
                const matchStatus = match.status as V14dDisplayTraceDraw["matchStatus"];
                const observedDraw = {
                  instanceName,
                  materialName: draw?.materialName ?? null,
                  type: String(type),
                  drawIndex,
                  drawOrder,
                  count,
                  firstIndex,
                  groupId: draw?.groupId ?? null,
                  pipeline,
                  bindGroup: materialBindGroup,
                  matchStatus,
                  candidateIndices: match.candidateIndices,
                  drawIdentityKey: makeV14dDisplayChainDrawIdentityKey({
                    materialName: draw?.materialName ?? null,
                    groupId: draw?.groupId ?? null,
                    type: String(type),
                    count,
                    firstIndex,
                    drawIndex,
                    drawOrder,
                  }),
                };
                trace.draws.push(observedDraw);
                return (method as (...callArgs: unknown[]) => unknown).call(targetPass, count, ...args);
              };
            }
            return (method as (...args: unknown[]) => unknown).bind(targetPass);
          },
        });
        return drawMaterials.call(this, wrappedPass, inst, type);
      };
      target.renderFrame = wrappedRenderFrame;
      target.drawMaterials = wrappedDrawMaterials;
      displayChainTraceCleanup = () => {
        if (target.renderFrame === wrappedRenderFrame) target.renderFrame = originalRenderFrame;
        if (target.drawMaterials === wrappedDrawMaterials) target.drawMaterials = originalDrawMaterials;
        displayChainTraceRequested = null;
        displayChainTraceCurrent = null;
        displayChainTraceLast = null;
        displayChainTraceCleanup = null;
      };
      return { ok: true, alreadyInstalled: false };
    };
    const setDisplayChainTraceCapture = (captureId: string, frame: number):
      | { ok: true; captureId: string; frame: number; requestSerial: number }
      | { ok: false; error: string } => {
      if (typeof captureId !== "string" || captureId.length === 0 || !Number.isFinite(frame)) {
        return { ok: false, error: "captureId/frame invalid" };
      }
      const installed = installDisplayChainTrace();
      if (!installed.ok) return installed;
      const requestSerial = ++displayChainRequestSerial;
      displayChainTraceRequested = { captureId, frame, requestSerial };
      return { ok: true, captureId, frame, requestSerial };
    };
    const captureDisplayChainState = async (options: { captureId: string; frame: number; render?: boolean; reuseRequestedCapture?: boolean }) => {
      const canvas = canvasRef.current;
      const engine = engineRef.current;
      const model = modelRef.current;
      if (!canvas || !engine || !model) return { error: "canvas/engine/model unavailable" };
      const renderSerialBefore = displayChainRenderSerial;
      const reusableRequest = options.reuseRequestedCapture
        && displayChainTraceRequested?.captureId === options.captureId
        && displayChainTraceRequested.frame === options.frame
        ? displayChainTraceRequested
        : null;
      const request = reusableRequest
        ? { ok: true as const, captureId: reusableRequest.captureId, frame: reusableRequest.frame, requestSerial: reusableRequest.requestSerial }
        : setDisplayChainTraceCapture(options.captureId, options.frame);
      if (!request.ok) return { error: request.error };
      const fields = engine as unknown as Record<string, unknown>;
      const wasRunning = fields.animationFrameId !== null && fields.animationFrameId !== undefined;
      engine.stopRenderLoop();
      model.pause();
      try {
        if (options.render) engine.renderFrame(0);
        const width = canvas.width;
        const height = canvas.height;
        const production = engine.getProductionDrawCallSourceSnapshot(options.captureId, options.frame);
        const resolve = await readV14dColorBaselineResolveTargets(engine, width, height);
        const materialMask = await readV14dColorBaselineMaterialMask(engine, width, height);
        const display = await readV14dCanvasDisplay(canvas);
        const materials = model.getMaterials();
        const materialIdByName: Record<string, number> = {};
        let nextId = 1;
        for (const material of materials) {
          if (material.vertexCount <= 0) continue;
          materialIdByName[material.name] = nextId++;
        }
        const ids = ["Brows", "Lashes"] as const;
        const slotStats: Record<string, unknown> = {};
        for (const name of ids) {
          const materialId = materialIdByName[name];
          let samples = 0;
          const hdrSum = [0, 0, 0];
          const displaySum = [0, 0, 0];
          const hdrMin = [Infinity, Infinity, Infinity];
          const hdrMax = [-Infinity, -Infinity, -Infinity];
          const displayMin = [Infinity, Infinity, Infinity];
          const displayMax = [-Infinity, -Infinity, -Infinity];
          for (let index = 0; index < width * height; index += 1) {
            const off = index * 4;
            if (materialMask.data[off] === 0 || materialMask.data[off + 1] !== materialId) continue;
            samples += 1;
            for (let channel = 0; channel < 3; channel += 1) {
              const hdrValue = resolve.hdr.data[off + channel];
              const displayValue = display.data[off + channel] * 255;
              hdrSum[channel] += hdrValue;
              displaySum[channel] += displayValue;
              hdrMin[channel] = Math.min(hdrMin[channel], hdrValue);
              hdrMax[channel] = Math.max(hdrMax[channel], hdrValue);
              displayMin[channel] = Math.min(displayMin[channel], displayValue);
              displayMax[channel] = Math.max(displayMax[channel], displayValue);
            }
          }
          slotStats[name] = {
            materialId,
            samples,
            hdrMean: samples ? hdrSum.map((value) => Number((value / samples).toFixed(6))) : null,
            hdrRange: samples ? [hdrMin, hdrMax].map((range) => range.map((value) => Number(value.toFixed(6)))) : null,
            displayMean: samples ? displaySum.map((value) => Number((value / samples).toFixed(3))) : null,
            displayRange: samples ? [displayMin, displayMax].map((range) => range.map((value) => Number(value.toFixed(3)))) : null,
          };
        }
        const instance = production.instances.find((item) => item.name === "companion");
        const targetDraws = (instance?.drawCalls ?? [])
          .filter((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes")
          .map((draw) => ({
            materialName: draw.materialName,
            materialIndex: draw.materialIndex,
            count: draw.count,
            firstIndex: draw.firstIndex,
            drawIndex: draw.drawIndex,
            pickDrawCallIndex: draw.pickDrawCallIndex,
            groupId: draw.groupId,
            graphName: draw.graphName,
            compileInstallPipeline: displayChainObjectId(draw.mainPipeline),
            bindGroup: displayChainObjectId(draw.mainBindGroup),
          }));
        const install = (fields.modelInstances as Map<string, { styleGroups?: Map<string, { group?: { graph?: { name?: string; nodes?: { id?: string; inputs?: { color?: unknown } }[] } }; signature?: string; pipeline?: unknown }> }> | undefined)
          ?.get("companion")?.styleGroups?.get("v14d-skin-variant-brows-lashes");
        const trace = serializeDisplayChainTrace(displayChainTraceLast);
        const renderObserved = Boolean(
          trace
          && trace.requestSerial === request.requestSerial
          && trace.captureId === options.captureId
          && trace.frame === options.frame,
        );
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = width;
        maskCanvas.height = height;
        const maskContext = maskCanvas.getContext("2d");
        if (!maskContext) return { error: "material mask canvas unavailable" };
        const maskImage = maskContext.createImageData(width, height);
        maskImage.data.set(materialMask.data);
        maskContext.putImageData(maskImage, 0, 0);
        const progress = model.getAnimationProgress?.();
        return {
          captureId: options.captureId,
          frame: options.frame,
          width,
          height,
          requestedRender: Boolean(options.render),
          renderObserved,
          renderSerialBefore,
          renderLoopRunningBefore: wasRunning,
          renderLoopRunningAfter: fields.animationFrameId !== null && fields.animationFrameId !== undefined,
          currentFrame: Number.isFinite(Number(progress?.current)) ? Number(progress.current) * V14D_HAIR_AUTHORITATIVE_CAPTURE.fps : null,
          materialIdByName,
          graphName: install?.group?.graph?.name ?? null,
          tint: install?.group?.graph?.nodes?.find((node) => node.id === "v14d_brows_lashes_tint")?.inputs?.color ?? null,
          signature: install?.signature ?? null,
          targetDraws,
          slotStats,
          hdr: { sourceFormat: resolve.hdr.sourceFormat, nanCount: resolve.hdr.nanCount, infCount: resolve.hdr.infCount },
          trace,
          canvasDataUrl: canvas.toDataURL("image/png"),
          materialMaskPng: maskCanvas.toDataURL("image/png"),
        };
      } finally {
        if (wasRunning) engine.runRenderLoop();
      }
    };
    (window as unknown as { __rezeStageProbe?: unknown }).__rezeStageProbe = {
      async playVmd(url: string, raceKey?: string) {
        const m = modelRef.current;
        if (!m) throw new Error("no model");
        // 竞态守卫（P0 回归）：raceKey 标识本次请求；较晚发起的请求会覆盖
        // vmdProbeRaceTokenRef，使较慢完成的旧请求在任何副作用前退出并计数
        // （vmdRaceStaleCount），最终播放必须是最后发起的请求。
        let guard: (() => boolean) | null = null;
        if (raceKey != null) {
          const token = { key: raceKey };
          vmdProbeRaceTokenRef.current = token;
          guard = () => {
            const stale = vmdProbeRaceTokenRef.current !== token;
            if (stale && canvasRef.current) {
              const c = canvasRef.current;
              c.dataset.vmdRaceStaleCount = String(Number(c.dataset.vmdRaceStaleCount || 0) + 1);
            }
            return !stale;
          };
        }
        // 与通用 VMD effect 走同一条共享加载路径（含 resetPhysics + 计数），
        // 确保探针驱动的 load→play 与真实 UI 交互路径一致（验收回归 P0-2）。
        const nm = await loadVmdThroughInteractionPath(url, null, guard);
        if (nm === null) return null; // 守卫判定为旧请求，无副作用退出
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          canvas.dataset.vmdPlaybackName = nm;
          // 启动新进度镜像前先清掉旧镜像，避免同名 VMD 残留多个 rAF 循环。
          vmdPlaybackMirrorCleanupRef.current?.();
          vmdPlaybackMirrorCleanupRef.current = null;
          let rafId = 0;
          let cancelled = false;
          const tick = () => {
            if (cancelled || canvas.dataset.vmdPlaybackName !== nm) return; // 已停止/切换/卸载则终止
            const progress = m.getAnimationProgress?.();
            if (progress) {
              canvas.dataset.vmdPlaybackCurrent = String(Number(progress.current) || 0);
              canvas.dataset.vmdPlaybackDuration = String(Number(progress.duration) || 0);
              canvas.dataset.vmdPlaybackPlaying = String(Boolean(progress.playing));
            }
            rafId = globalThis.requestAnimationFrame(tick);
          };
          rafId = globalThis.requestAnimationFrame(tick);
          vmdPlaybackMirrorCleanupRef.current = () => { cancelled = true; globalThis.cancelAnimationFrame(rafId); };
        }
        return nm;
      },
      // 暂停/跳走时取消完成兜底计时器：VMD 已不在自然播放，fallback 不应再把
      // 中段暂停/跳走误判为「自然播完」。这是真实行为修复（配合完成回调先验身份）。
      pauseVmd() { modelRef.current?.pause(); clearVmdCompletionFallback(); },
     seekVmd(seconds: number) { modelRef.current?.seek(seconds); clearVmdCompletionFallback(); },
      // 相机取景钩子（仅验收开关，Stage 2C-M1 修正轮）：暂停 VMD 后摆拍指定视角，
      // 供头发前刘海/后长发独立近景 A/B 取证。只改引擎相机轨道参数，不改场景设置；
      // 调用方用 cameraOrbit("reset") 恢复 settingsRef 默认取景。
      cameraOrbit(pose: "front" | "back" | "face" | "reset") {
        const engine = engineRef.current;
        if (!engine) throw new Error("no engine");
        modelRef.current?.pause();
        clearVmdCompletionFallback();
        const s = settingsRef.current;
        // front/back 保留既有头发近景取景（targetY≈11.8、距离 3.6）；它只服务验收辅助证据，
        // 机器分区判定由 analyze 的 UV 锚点口径（startIndex/indexCount）独立支撑。
        // Stage 2C-M2a 修正轮新增 face 姿态：对准脸部（眉眼），目标点 [0.38,16.8,-1.1]
        // 来自 frame120 生产几何取景证据；正面 alpha=π、半径 2.5、平视 beta=π/2 放大脸部，
        // 让眉毛/睫毛这两小槽在画面中具备足够前景像素（全身取景下 triUV 采样为 0，
        // front 头发取景会压到画面顶部），供逐槽 identity-target 与 Lashes 透明边缘
        // Gate 的逐像素收敛判定。
        const diagnosticFaceTarget = new Vec3(0.38, 16.8, -1.1);
        const diagnosticTarget = pose === "face"
          ? diagnosticFaceTarget
          : new Vec3(s.cameraTargetX, 11.8, s.cameraTargetZ);
        engine.setCameraTarget(diagnosticTarget);
        if (pose === "front") {
          engine.setCameraDistance(3.6); engine.setCameraAlpha(Math.PI); engine.setCameraBeta(Math.PI * 0.42);
        } else if (pose === "face") {
          // face 使用 frame120 已验证的眉眼取景；仅验收探针调用，生产默认入口不暴露。
          engine.setCameraDistance(2.5); engine.setCameraAlpha(Math.PI); engine.setCameraBeta(Math.PI / 2);
        } else if (pose === "back") {
          engine.setCameraDistance(3.6); engine.setCameraAlpha(0); engine.setCameraBeta(Math.PI * 0.42);
        } else {
          engine.setCameraDistance(s.cameraDistance); engine.setCameraAlpha(Math.PI); engine.setCameraBeta(Math.PI / 2.5);
        }
        return { pose };
      },
      // 过期完成回调负测钩子（P0-1，仅验收开关）：注入一个 finishedName 不等于当前动作的
      // 过期/错误回调。修复后它不得清当前 fallback、不得自增完成计数、不得改 currentName。
      fireStaleFinish(staleName: string) {
        const m = modelRef.current;
        if (!m) throw new Error("no model");
        handleRezeVmdFinished(m, staleName);
      },
      // 完成兜底状态证据（仅验收开关）：armed/cleared/fired/delay + 当前动作名。
      vmdFallbackState() {
        const c = canvasRef.current;
        return {
          armed: (c?.dataset.vmdCompletionFallbackArmed || "") === "true",
          fired: (c?.dataset.vmdCompletionFallbackFired || "") === "true",
          delay: Number(c?.dataset.vmdCompletionFallbackDelay || 0),
          currentName: (currentVmdUrlRef.current.split("/").pop()) || "",
          timerActive: vmdCompletionFallbackTimerRef.current !== null,
        };
      },
      // 场景不变性证据（P1-1）：只读场景文档源 settingsRef + grade + 背景效果。
      // 变体切换只改 Face/BodySkin 材质 graph，不触碰这些字段；original/V1 各捕获一次
      // 逐字段比对即可证明 K3 灯光/星空/相机/Bloom/grade/tone mapping 未被 V1 改写。
      sceneSnapshot() {
        const engine = engineRef.current;
        const viewTransform = engine && typeof engine.getViewTransformOptions === "function"
          ? { ...engine.getViewTransformOptions() }
          : null;
        return {
          settings: { ...settingsRef.current },
          grade: gradeRef.current,
          gradeIntensity: gradeIntensityRef.current,
          backgroundEffect: backgroundEffectRef.current,
          transparentBackground: transparentBackgroundRef.current,
          // 引擎 view transform（exposure/gamma/look=Filmic tone mapping）与灯光/星空
          // 同等级：original/V1 逐字段比对证明 V1 不改写全局显示链。
          viewTransform,
        };
      },
      /**
       * 验收专用逐像素 PMX 材质身份 pass：复用引擎 pick pipeline 的 material-ID+
       * depth 前景结果，导出 RGBA PNG（R=modelId，G=materialId）及同源材质映射。
       * 该掩码与当前画布同尺寸、同相机、同一帧，只在显式 acceptance probe 下可见；
       * analyze 据此把屏幕样本严格分到 HairA/HairB，不再用矩形 ROI 猜槽位。
       */
      async captureMaterialMask() {
        const canvas = canvasRef.current;
        const engine = engineRef.current;
        const model = modelRef.current;
        if (!canvas || !engine || !model) return null;
        try {
          await flushV14dDiagnosticBarrier(engine);
          try { engine.renderFrame(0); } catch { /* 保持当前姿态 */ }
          const width = canvas.width;
          const height = canvas.height;
          const materialMask = await readV14dColorBaselineMaterialMask(engine, width, height);
          const materials = model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount }));
          const materialIdByName: Record<string, number> = {};
          let nextId = 1;
          for (const material of materials) {
            if (material.vertexCount <= 0) continue;
            materialIdByName[material.name] = nextId;
            nextId += 1;
          }
          const maskCanvas = document.createElement("canvas");
          maskCanvas.width = width;
          maskCanvas.height = height;
          const ctx = maskCanvas.getContext("2d");
          if (!ctx) return null;
          const image = ctx.createImageData(width, height);
          image.data.set(materialMask.data);
          ctx.putImageData(image, 0, 0);
          return {
            width,
            height,
            source: "engine-pick-material-id-depth",
            materialIdByName,
            png: maskCanvas.toDataURL("image/png"),
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
      /**
       * Stage 2C-M1.1 HairA/HairB 正式 triUV 证据：在同一停帧中导出生产等价
       * material-ID+depth 前景掩码，并分别用非索引展开 pass 给每个头发槽输出
       * 局部三角形 ID、插值 UV 与该槽的三角形 UV 表。调用方必须把三者按同一
       * 画布像素索引配对；不能退化为槽位均值或矩形 ROI 目标。
       */
      async captureHairTriUv(materialNames?: readonly string[], options?: { useForegroundDepth?: boolean; nearClipOverride?: number; sourceMode?: V14dHairTriUvSourceMode }) {
        const canvas = canvasRef.current;
        const engine = engineRef.current;
        const model = modelRef.current;
        if (!canvas || !engine || !model) return serializeV14dCaptureError("no canvas/engine/model", "runtime-unavailable", "runtime");
        const runtimeState = captureV14dHairRuntimeState(model, engine);
        // 探针隔离的采集 epoch（Stage 2C-M2a P1 provenance）：?v14dAcceptanceProbe=1 下把
        // 采集序号持久化在 sessionStorage（同一 tab 跨 page.reload 存活、不同 tab 隔离）。
        // 每次采集都分配并自增一次（采集 epoch 即采集序号）；captureId 形如 "e3-2"（epoch3 的第 2 次采集）。每次采集
        // 都实时读取（不缓存在组件 useRef——Next 在软 reload 下会复用 module 实例，组件内缓存
        // 会让 epoch 跨 reload 残留为同一值），从而跨 reload 的两次独立采集 captureId 全局唯一，
        // 修复 wrongTint 标定中 run2/wrong 同碰撞为 "1" 的 provenance 缺陷。
        // 默认生产入口（无探针开关）不触碰 sessionStorage，captureId 仍为纯自增序号，行为不变。
        if (acceptanceProbeEnabled) {
          try {
            const KEY = "__v14dCaptureEpoch";
            const cur = Number(window.sessionStorage?.getItem(KEY) ?? "0") || 0;
            window.sessionStorage?.setItem(KEY, String(cur + 1));
            (window as unknown as { __v14dCaptureEpoch?: number }).__v14dCaptureEpoch = cur + 1;
          } catch { /* sessionStorage 不可用时退化为纯自增序号 */ }
        }
        const seq = ++hairTriUvCaptureIdRef.current;
        const captureEpoch = acceptanceProbeEnabled ? String((window as unknown as { __v14dCaptureEpoch?: number }).__v14dCaptureEpoch ?? "") : "";
        const captureId = captureEpoch ? "e" + captureEpoch + "-" + seq : String(seq);
        let captureSuspended = false;
        let cameraNearBeforeCapture: number | null = null;
        const readCaptureProgress = () => {
          const progress = model.getAnimationProgress?.();
          const currentSeconds = Number(progress?.current);
          if (!Number.isFinite(currentSeconds)) return null;
          const fps = V14D_HAIR_AUTHORITATIVE_CAPTURE.fps;
          return {
            animationName: progress?.animationName ?? null,
            currentSeconds,
            currentFrame: currentSeconds * fps,
            fps,
            fpsProvenance: V14D_HAIR_AUTHORITATIVE_CAPTURE.fpsProvenance,
            durationSeconds: Number(progress?.duration) || 0,
            looping: Boolean(progress?.looping),
            playing: Boolean(progress?.playing),
            paused: Boolean(progress?.paused),
          };
        };
        try {
          // 原子采集边界：先停止 render loop/暂停 VMD，再 flush 当前蒙皮矩阵；
          // 此后 canvas、material mask、triUV 都在同一冻结姿态中生成，直到 finally。
          captureSuspended = true;
          engine.stopRenderLoop();
          model.pause();
          await flushV14dDiagnosticBarrier(engine);
          const materials = model.getMaterials();
          const materialIdByName: Record<string, number> = {};
          let nextId = 1;
          for (const material of materials) {
            if (material.vertexCount <= 0) continue;
            materialIdByName[material.name] = nextId;
            nextId += 1;
          }
          const targetNames = (materialNames && materialNames.length > 0
            ? [...materialNames]
            : [V14D_HAIR_A_MATERIAL_NAME, V14D_HAIR_B_MATERIAL_NAME]) as readonly string[];
          const targetEntries = targetNames.map((name) => {
            const materialIndex = materials.findIndex((material) => material.name === name);
            return {
              name,
              materialIndex,
              materialId: materialIdByName[name] ?? null,
            };
          });
          const missing = targetEntries.filter((entry) => entry.materialIndex < 0 || entry.materialId === null);
          if (missing.length > 0) {
            return serializeV14dCaptureError(
              "missing target material: " + missing.map((entry) => entry.name).join(", "),
              "target-material-missing",
              "missing-input",
            );
          }

          // renderFrame 后再次等待 GPU 队列，确保 canvas 显示字节与后续诊断 pass
          // 都观察到这一冻结姿态；任何读回期间的时间推进都会被证据校验拒绝。
          // Stage 2C-M2a：nearClipOverride 在「读 canvas 显示字节」之前生效，让
          // canvas/material-mask/triUV 三份证据共用同一放大深度的投影（near 只影响
          // 深度缓冲精度、不改变屏幕几何位置，仍满足原子同帧约束）。见循环内注释。
          if (options?.useForegroundDepth) {
            const cam0 = (engine as unknown as { camera?: { near: number } }).camera;
            const nco = options?.nearClipOverride;
            if (cam0 && typeof nco === "number" && Number.isFinite(nco) && Number.isFinite(cam0.near)) {
              cameraNearBeforeCapture = cam0.near;
              cam0.near = nco;
              (engine as unknown as { updateCameraUniforms?: () => void }).updateCameraUniforms?.();
            }
          }
          // P1-1：renderObserved = 本采集真实提交了一帧渲染（engine.renderFrame(0)）且 GPU 队列
          // flush 完成；非仅 captureId/frame 两字段。无 render 时该帧未提交 → renderObserved=false。
          let renderObserved = false;
          engine.renderFrame(0);
          renderObserved = true;
          await flushV14dDiagnosticBarrier(engine);
          const progressAfterRender = readCaptureProgress();
          if (!progressAfterRender) return {
            ...serializeV14dCaptureError("capture VMD progress unavailable", "capture-state-unavailable", "capture-state"),
            captureId,
          };
          const canvasDataUrl = canvas.toDataURL("image/png");

          const width = canvas.width;
          const height = canvas.height;
          const sourceMode = options?.sourceMode ?? "production-draw-call";
          const productionSource = await readV14dProductionDrawCallSourceSnapshot(
            engine,
            captureId,
            progressAfterRender.currentFrame,
          );
          // 同一冻结帧内取得 CPU 两层观测与独立 GPU 缓冲读回，绝不将 effective 命名为 GPU。
          const morphModel = model as unknown as { runtimeMorph: { weights: ArrayLike<number>; nameIndex: Record<string, number> }; getEffectiveMorphWeights(): ArrayLike<number> };
          const morphWeightReadback = {
            captureId, frame: progressAfterRender.currentFrame,
            nameIndex: { ...morphModel.runtimeMorph.nameIndex },
            runtime: Array.from(morphModel.runtimeMorph.weights),
            effective: Array.from(morphModel.getEffectiveMorphWeights()),
            gpu: productionSource.morphWeightsByInstance.companion ?? null,
          };
          const materialMask = await readV14dColorBaselineMaterialMask(engine, width, height);
          const maskCanvas = document.createElement("canvas");
          maskCanvas.width = width;
          maskCanvas.height = height;
          const maskContext = maskCanvas.getContext("2d");
          if (!maskContext) return serializeV14dCaptureError("material mask canvas unavailable", "material-mask-unavailable", "readback");
          const maskImage = maskContext.createImageData(width, height);
          maskImage.data.set(materialMask.data);
          maskContext.putImageData(maskImage, 0, 0);

          const vertices = model.getVertices();
          const indices = model.getIndices();
          const skinning = model.getSkinning();
        const byMaterial: Record<string, unknown> = {};
        let resolvedForegroundDepth = false;
        for (const entry of targetEntries) {
            const material = materials[entry.materialIndex];
            const firstIndex = materials
              .slice(0, entry.materialIndex)
              .reduce((sum, current) => sum + current.vertexCount, 0);
            const indexCount = material.vertexCount;
            const triangleCount = Math.floor(indexCount / 3);
            const src = {
              vertices,
              indices,
              joints: skinning.joints,
              weights: skinning.weights,
              faceFirstIndex: firstIndex,
              faceIndexCount: indexCount,
              skinMatrices: model.getSkinMatrices(),
            };
            // Stage 2C-M2a 修正轮：Brows/Lashes 原子采集需要真实前景深度剔除。
            // 无深度展开 pass 的可见性由绘制顺序决定，脸部特写取景下刘海/侧发在屏幕上
            // 覆盖眉睫区时会把目标槽三角形投到被遮挡像素上（triUV 落进 face_d 头发区）。
            // useForegroundDepth 走生产 pick 深度 prepass + equal 剔除，可见性与生产
            // material-ID pick（Lashes 前景 152 像素）完全一致；Hair 链路保持原无深度
            // 行为，不触碰已通过 Gate。
            //
            // nearClipOverride（Stage 2C-M2a）：depth24plus 是 24 位无符号归一化深度，
            // 在 near=0.05 的标准投影下脸部近距离（≈2.6-3.6m）可用精度不足，睫毛薄片
            // 相对皮肤/眼睑的厘米级偏移无法分辨（实测 152 前景像素全部被 equal 剔除）。
            // 把引擎相机 near 临时拉到 1.0（脸部特写下有效深度区间收窄、精度大幅提升），
            // pass 完成后在 finally 恢复。这是诊断 pass 的临时投影调整，不改场景默认
            // 相机配置；near=1.0 仍远小于相机到脸部距离（2.6m），不会裁掉模型。
            // nearClipOverride 已在首个 renderFrame 前设置并同步 camera uniform（见上方），
            // canvas/material-mask/triUV 三份证据共用同一放大深度的投影。此处不再重复
            // 设置，避免循环内每材质重复 renderFrame。
            let triUv;
            try {
              triUv = sourceMode === "production-draw-call"
                ? await readV14dProductionSourceTriUv(productionSource, width, height, [entry.name])
                : options?.useForegroundDepth
                  ? await readV14dFaceExpandedTriUvDepth(engine, width, height, src)
                  : await readV14dFaceExpandedTriUv(engine, width, height, src);
            } catch (error) {
              return serializeV14dCaptureError(error, "triuv-readback-failed", "readback");
            }
            if (sourceMode === "production-draw-call" || options?.useForegroundDepth) resolvedForegroundDepth = true;
            const triangleUvs = new Float32Array(triangleCount * 6);
            for (let triangle = 0; triangle < triangleCount; triangle += 1) {
              for (let corner = 0; corner < 3; corner += 1) {
                const vertexIndex = indices[firstIndex + triangle * 3 + corner];
                const uvOffset = (triangle * 3 + corner) * 2;
                triangleUvs[uvOffset] = vertices[vertexIndex * 8 + 6];
                triangleUvs[uvOffset + 1] = vertices[vertexIndex * 8 + 7];
              }
            }
            byMaterial[entry.name] = {
              materialId: entry.materialId,
              materialIndex: entry.materialIndex,
              firstIndex,
              indexCount,
              triangleCount,
              triId: triUv.triId,
              uv: triUv.uv,
              triMask: triUv.faceMask,
              triUvSource: sourceMode,
              depthBias: "depthBias" in triUv ? triUv.depthBias : { constant: 0, slopeScale: 0 },
              triangleUvs,
            };
          }

          const progressAfterRead = readCaptureProgress();
          if (!progressAfterRead
            || Math.abs(progressAfterRead.currentSeconds - progressAfterRender.currentSeconds) > V14D_COLOR_BASELINE_EPSILON
            || Math.abs(progressAfterRead.currentFrame - progressAfterRender.currentFrame) > V14D_COLOR_BASELINE_EPSILON) {
            return {
              ...serializeV14dCaptureError(
                "capture VMD time advanced while reading atomic hair evidence",
                "capture-time-advanced",
                "capture-state",
              ),
              captureId,
              captureProgressBeforeRead: progressAfterRender,
              captureProgressAfterRead: progressAfterRead,
            };
          }
          const pixelEvidence = {
            captureId,
            width,
            height,
            animationName: progressAfterRead.animationName,
            currentSeconds: progressAfterRead.currentSeconds,
            currentFrame: progressAfterRead.currentFrame,
            fps: progressAfterRead.fps,
            fpsProvenance: progressAfterRead.fpsProvenance,
          };
          const materialMaskEvidence = { ...pixelEvidence };
          const triUvEvidence = { ...pixelEvidence };
          const camera = engine as unknown as {
            camera?: {
              getViewMatrix(): { values: Float32Array };
              getProjectionMatrix(): { values: Float32Array };
            };
          };
          return {
            source: resolvedForegroundDepth
              ? sourceMode === "production-draw-call"
                ? "engine-pick-material-id-depth+production-draw-call-source-tri-uv"
                : "engine-pick-material-id-depth+expanded-tri-uv-foreground-depth"
              : "engine-pick-material-id-depth+expanded-tri-uv",
            sourceMode,
            captureId,
            width,
            height,
            materialIdByName,
            canvasDataUrl,
            materialMaskPng: maskCanvas.toDataURL("image/png"),
            captureState: progressAfterRead,
            captureProgressBeforeRead: progressAfterRender,
            captureProgressAfterRead: progressAfterRead,
            productionSource: productionSource.audit,
            morphWeightReadback,
            renderObserved,
            captureEvidence: {
              pixel: pixelEvidence,
              materialMask: materialMaskEvidence,
              triUv: triUvEvidence,
            },
            camera: camera.camera
              ? {
                  view: Array.from(camera.camera.getViewMatrix().values),
                  projection: Array.from(camera.camera.getProjectionMatrix().values),
                }
              : null,
            byMaterial,
          };
        } catch (error) {
          return serializeV14dCaptureError(error, "capture-failed", "capture");
        } finally {
          // Stage 2C-M2a：恢复 nearClipOverride 改过的相机 near 并同步 uniform。
          // 放在整个采集完成后（而非循环内），保证 canvas/material-mask/全部目标槽
          // triUV 共用同一放大深度投影；恢复后不影响后续生产渲染（near 回原值）。
          if (options?.useForegroundDepth) {
            const camR = (engine as unknown as { camera?: { near: number } }).camera;
            if (camR && cameraNearBeforeCapture !== null) {
              camR.near = cameraNearBeforeCapture;
              (engine as unknown as { updateCameraUniforms?: () => void }).updateCameraUniforms?.();
            }
          }
          if (captureSuspended) restoreV14dHairRuntimeState(model, engine, runtimeState);
        }
      },
      // 负测钩子（仅验收开关）：用错误 graph / 编译非法 graph 驱动 V1 styleGroup 应用，
      // 真实验证「错误 graph 不命中 Face draw-call」「applyStyleGroups 失败回退 original」。
      async applyBadSkinGraph(kind: BadSkinGraphKind, options?: { render?: boolean }) {
        const engine = engineRef.current;
        if (!engine) throw new Error("no engine");
        const groups = buildV14dSkinVariantStyleGroups(engine.getStyleGroups("companion"));
        // 扰动由 perturbV14dSkinVariantStyleGroups 纯函数提供（node --test 可直接驱动、与生产同源）。
        const bad = perturbV14dSkinVariantStyleGroups(groups, kind);
        const res = await engine.applyStyleGroups("companion", bad);
        if (canvasRef.current) {
          canvasRef.current.dataset.v14dSkinVariant = res.ok ? "v1" : "original";
          canvasRef.current.dataset.v14dSkinVariantFaceGraph = res.ok ? String(bad.find((g) => g.id === "v14d-skin-variant-face")?.graph?.name ?? "") : "";
          try {
            const counts = collectV14dSkinVariantBindingCounts(engine);
            canvasRef.current.dataset.v14dSkinVariantFaceDrawCalls = String(counts.faceDrawCalls);
            canvasRef.current.dataset.v14dSkinVariantFaceOnComposite = String(counts.faceOnComposite);
            canvasRef.current.dataset.v14dSkinVariantBodyDrawCalls = String(counts.bodyDrawCalls);
            canvasRef.current.dataset.v14dSkinVariantBodyOnComposite = String(counts.bodyOnComposite);
            canvasRef.current.dataset.v14dSkinVariantHairADrawCalls = String(counts.hairADrawCalls);
            canvasRef.current.dataset.v14dSkinVariantHairAOnComposite = String(counts.hairAOnComposite);
            canvasRef.current.dataset.v14dSkinVariantHairBDrawCalls = String(counts.hairBDrawCalls);
            canvasRef.current.dataset.v14dSkinVariantHairBOnComposite = String(counts.hairBOnComposite);
            canvasRef.current.dataset.v14dSkinVariantBrowsDrawCalls = String(counts.browsDrawCalls);
            canvasRef.current.dataset.v14dSkinVariantBrowsOnComposite = String(counts.browsOnComposite);
            canvasRef.current.dataset.v14dSkinVariantLashesDrawCalls = String(counts.lashesDrawCalls);
            canvasRef.current.dataset.v14dSkinVariantLashesOnComposite = String(counts.lashesOnComposite);
          } catch { /* 证据读取失败不阻断负测 */ }
        }
        let renderedAfterApply = false;
        if (res.ok && options?.render !== false) {
          const engineFields = engine as unknown as { animationFrameId?: number | null };
          // 冻结的验收采集没有 render loop 消费新管线；仅在该状态提交一次零增量帧。
          // 生产播放保持现有循环，不额外推进帧数或时间。
          if (engineFields.animationFrameId === null || engineFields.animationFrameId === undefined) {
            engine.renderFrame(0);
            renderedAfterApply = true;
          }
        }
        return { ok: res.ok, groups: res.groups, unknownMaterials: res.unknownMaterials, conflicts: res.conflicts, renderedAfterApply };
      },
      // Stage 2C-M2a.3：显式 acceptance probe 才安装的只读 draw/display 链取证。
      // 默认入口不暴露；调用方必须自己声明 captureId/frame，且 captureDisplayChainState
      // 会在读取前冻结 render loop，避免把时间推进或异步重建误判为颜色变化。
      installDisplayChainTrace,
      setDisplayChainTraceCapture,
      captureDisplayChainState,
      // Stage 2C-M2a 修正轮（G7 动态 Morph）：暴露引擎/模型引用与闭眼 Morph 选择器，
      // 供 accept 在 V1 下采集开眼/闭眼两状态的逐槽可见性。只读 + setMorphWeight/
      // setMaterialVisible 组合，不改 PMX/VMD/Morph 数据；默认生产入口不暴露本探针。
      engineRef,
      modelRef,
      // 验收专用：复用真实快照/应用接口，不经过持久化或默认 reset。
      captureCamera: () => captureRezeCameraSnapshot(engineRef.current),
      setCameraSnapshot(snapshot: MmdCameraSnapshot) {
        const engine = engineRef.current;
        if (!applyRezeCameraSnapshot(engine, snapshot)) throw new Error("acceptance camera restore unavailable");
        (engine as unknown as { updateCameraUniforms(): void }).updateCameraUniforms();
        return captureRezeCameraSnapshot(engine);
      },
      selectClosedEyeMorphNames: selectKoledaClosedEyeMorphNames,
      // Stage 2C-M2a 修正轮（G7 表情状态）：暴露非眨眼表情 Morph 名选择器（权威 PMX
      // 取证：「笑い」移动 506 个 Lashes 顶点，是最强的非眨眼表情状态）。只读选择器。
      selectExpressionMorphNames: (names = []) =>
        (Array.isArray(names) ? names : []).filter(Boolean).filter((name) => {
          const text = String(name).toLowerCase();
          return text.includes("笑い") || text.includes("smile") || text.includes("warai");
        }),
    };
    return () => {
      displayChainTraceCleanup?.();
      delete (window as unknown as { __rezeStageProbe?: unknown }).__rezeStageProbe;
      vmdPlaybackMirrorCleanupRef.current?.();
      vmdPlaybackMirrorCleanupRef.current = null;
    };
    // 探针只读 ref，不随 interaction 变化重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptanceProbeEnabled]);

  useEffect(() => {
    if (v14dColorBaseline || v14dFaceStatic) return;
    if (interaction.mode === "vmd" && interaction.vmdUrl) return;
    clearVmdCompletionFallback();
    currentVmdUrlRef.current = "";
    restoreDefaultIk();
    if (modelRef.current) resetRezeModelToBindPose(modelRef.current);
  }, [interaction.mode, interaction.vmdUrl]);

  return (
    <div
      className="mio-stage-webgpu-shell"
      data-webgpu-status={runtimeStatus.state}
      data-v14d-unlit-diagnostic={v14dUnlitDiagnostic ? "true" : "false"}
      data-v14d-color-baseline={v14dColorBaseline ? "true" : "false"}
    >
      <canvas
        ref={canvasRef}
        className="mio-stage-canvas mio-stage-canvas--webgpu"
        data-renderer="reze-engine-webgpu"
        data-v14d-unlit-diagnostic={v14dUnlitDiagnostic ? "true" : "false"}
        data-v14d-color-baseline={v14dColorBaseline ? "true" : "false"}
      />
      {runtimeStatus.state !== "ready" ? <p className="mio-stage-webgpu-status" role="status">{runtimeStatus.detail}</p> : null}
    </div>
  );
});
