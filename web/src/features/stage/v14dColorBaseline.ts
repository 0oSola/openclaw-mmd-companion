/// <reference types="@webgpu/types" />

import { REZE_K3_SCENE_DEFAULTS, type RezeSceneDebugSettings } from "@/features/stage/rezeDesignDefaults";

export const V14D_COLOR_BASELINE_WIDTH = 1280;
export const V14D_COLOR_BASELINE_HEIGHT = 720;
export const V14D_COLOR_BASELINE_FPS = 30;
export const V14D_COLOR_BASELINE_FRAME = 120;
export const V14D_COLOR_BASELINE_SECONDS = V14D_COLOR_BASELINE_FRAME / V14D_COLOR_BASELINE_FPS;
export const V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD = 0.5;
export const V14D_COLOR_BASELINE_EPSILON = 1e-6;

export const V14D_COLOR_BASELINE_CAMERA = {
  fov: 28.072486935852954,
  position: [0.375, 16.6875, -12.75] as [number, number, number],
  target: [0.3786548, 16.68750004, -11.75000668] as [number, number, number],
  locked: true,
};

export const V14D_COLOR_BASELINE_SCENE_KEYS = [
  "sunColor",
  "worldColor",
  "backgroundColor",
  "groundColor",
  "sunAzimuth",
  "sunElevation",
  "keyIntensity",
  "ambientIntensity",
] as const;

export type V14dColorBaselineSceneKey = (typeof V14D_COLOR_BASELINE_SCENE_KEYS)[number];

export type V14dColorBaselineLevel = "baseColor" | "linearHdr" | "finalDisplay";

export type V14dColorBaselineRoi = {
  id: string;
  material: {
    pmx: string;
    blender: string;
    web: string;
    diffuseTexture: string;
  };
  screen: {
    coordinateSpace: "normalized";
    polygon: Array<[number, number]> | null;
    bounds: [number, number, number, number] | null;
  };
  edgeErosionPx: number;
  minValidPixels: number;
  backgroundExclusion: {
    mode: "model-coverage-and-material-id-depth";
    channel: "maskResolveTexture.g+materialMask.g";
    threshold: number;
    rule: string;
  };
  calibrationStatus: "pending-calibration" | "unverified" | "ready";
  reference?: {
    baseColorSrgb?: [number, number, number];
    linearHdrSrgb?: [number, number, number];
    finalDisplaySrgb?: [number, number, number];
    source: string;
  };
};

/**
 * ROI 坐标来自真实的 1280×720 frame-120 白光画面校准。
 * 背景排除仍由材质 mask alpha 完成；bounds 只负责限定已校准的局部取样区域。
 */
export const V14D_COLOR_BASELINE_ROIS: readonly V14dColorBaselineRoi[] = [
  {
    id: "hair.front",
    material: {
      pmx: "HairA",
      blender: "PROTO_GF2_HairA",
      web: "HairA",
      diffuseTexture: "c_KoledaSSR01_slg_hair_d.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.3734375, 0.16527777777777777, 0.21640625, 0.4638888888888889],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.66970604945617, 0.6523746335533499, 0.7086999554537097],
      linearHdrSrgb: [0.6273923359081031, 0.61601119993634, 0.6941206348890926],
      finalDisplaySrgb: [0.5134638775435728, 0.5118026991104822, 0.5720413683333714],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[478,119,277,334]；edgeErosionPx=2。",
    },
  },
  {
    id: "hair.back",
    material: {
      pmx: "HairB",
      blender: "PROTO_GF2_HairB",
      web: "HairB",
      diffuseTexture: "c_KoledaSSR01_slg_hair_d.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.38828125, 0.2638888888888889, 0.26796875, 0.7361111111111112],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.7545091590729425, 0.7346827763842059, 0.7870342315078118],
      linearHdrSrgb: [0.6719024066830409, 0.6586767342221878, 0.736478958865226],
      finalDisplaySrgb: [0.5532433312854331, 0.550117723014672, 0.6046184047457078],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[497,190,343,530]；edgeErosionPx=2。",
    },
  },
  {
    id: "skin.face",
    material: {
      pmx: "Face",
      blender: "PROTO_V14D_GF2_Face",
      web: "Face",
      diffuseTexture: "c_Koleda_slg_face_d.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.4453125, 0.39166666666666666, 0.13046875, 0.15833333333333333],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.9342793003323737, 0.7857934113911736, 0.7624051933801729],
      linearHdrSrgb: [0.8978616929789722, 0.72928035692014, 0.6941475070120563],
      finalDisplaySrgb: [0.7092495249852734, 0.60792236239141, 0.5855194395367366],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[570,282,167,114]；edgeErosionPx=2。",
    },
  },
  {
    id: "clothes.chest",
    material: {
      pmx: "Cth1-Top",
      blender: "PROTO_GF2_Cth1-Top",
      web: "Cth1-Top",
      diffuseTexture: "c_KoledaSSR01_slg_cloth1_da.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.40859375, 0.6027777777777777, 0.23203125, 0.3972222222222222],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.7200672970797082, 0.7134111692974934, 0.7334130523811577],
      linearHdrSrgb: [0.7093168193216505, 0.7030308601009203, 0.7200484540873416],
      finalDisplaySrgb: [0.5206145478093768, 0.5187587002798091, 0.5394622779201983],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[523,434,297,286]；edgeErosionPx=2。",
    },
  },
  {
    id: "clothes.leftSleeve",
    material: {
      pmx: "Cth1-Top",
      blender: "PROTO_GF2_Cth1-Top",
      web: "Cth1-Top",
      diffuseTexture: "c_KoledaSSR01_slg_cloth1_da.png",
    },
    screen: {
      coordinateSpace: "normalized",
      polygon: null,
      bounds: [0.6859375, 0.9375, 0.01796875, 0.0625],
    },
    edgeErosionPx: 2,
    minValidPixels: 64,
    backgroundExclusion: {
      mode: "model-coverage-and-material-id-depth",
      channel: "maskResolveTexture.g+materialMask.g",
      threshold: V14D_COLOR_BASELINE_MASK_ALPHA_THRESHOLD,
      rule: "同时要求 maskResolveTexture.g >= 0.5、材质 ID 匹配目标 PMX 材质且通过 depth24plus 前景可见性；不使用接近白色规则。",
    },
    calibrationStatus: "ready",
    reference: {
      baseColorSrgb: [0.7953772012503841, 0.7982162197952023, 0.8161731518402069],
      linearHdrSrgb: [0.7539505448306034, 0.7563871855599547, 0.7699739197593685],
      finalDisplaySrgb: [0.6277303755440624, 0.6306586179066459, 0.6387500862018414],
      source: "Blender 5.1.1 纯纹理（无 tint/rmo/阴影节点树）白光 frame-120；材质 ID+深度 mask；boundsPx=[878,675,23,45]；edgeErosionPx=2；角色左袖/画面右下可见袖片。",
    },
  },
];

export type V14dSceneValidation = {
  valid: boolean;
  status: "ok" | "scene-mismatch";
  mismatches: Array<{
    key: V14dColorBaselineSceneKey;
    expected: string | number;
    actual: string | number | undefined;
  }>;
};

export function validateV14dColorBaselineScene(
  scene: Partial<RezeSceneDebugSettings> | null | undefined,
): V14dSceneValidation {
  const mismatches: V14dSceneValidation["mismatches"] = [];
  const expected = REZE_K3_SCENE_DEFAULTS;
  const numericKeys: readonly V14dColorBaselineSceneKey[] = [
    "sunAzimuth",
    "sunElevation",
    "keyIntensity",
    "ambientIntensity",
  ];
  const stringKeys: readonly V14dColorBaselineSceneKey[] = [
    "sunColor",
    "worldColor",
    "backgroundColor",
    "groundColor",
  ];
  for (const key of numericKeys) {
    const actual = scene?.[key];
    const expectedValue = expected[key] as number;
    if (typeof actual !== "number" || Math.abs(actual - expectedValue) > V14D_COLOR_BASELINE_EPSILON) {
      mismatches.push({ key, expected: expectedValue, actual });
    }
  }
  for (const key of stringKeys) {
    const actual = scene?.[key];
    const expectedValue = expected[key];
    if (actual !== expectedValue) mismatches.push({ key, expected: expectedValue, actual });
  }
  return {
    valid: mismatches.length === 0,
    status: mismatches.length === 0 ? "ok" : "scene-mismatch",
    mismatches,
  };
}

export function srgbToLinear(channel: number): number {
  const value = Math.max(0, Math.min(1, Number.isFinite(channel) ? channel : 0));
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(channel: number): number {
  const value = Math.max(0, Number.isFinite(channel) ? channel : 0);
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

export function srgbToLinearRgb(rgb: readonly [number, number, number]): [number, number, number] {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

type Lab = [number, number, number];

function srgbToLab(rgb: readonly [number, number, number]): Lab {
  const [r, g, b] = srgbToLinearRgb(rgb);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1.0;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (value: number) => (value > 0.008856451679 ? value ** (1 / 3) : 7.787037037 * value + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000，输入为 D65/sRGB 适配的 Lab。 */
export function deltaE2000(first: Lab, second: Lab): number {
  const [l1, a1, b1] = first;
  const [l2, a2, b2] = second;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;
  const c1Prime = Math.hypot(a1Prime, b1);
  const c2Prime = Math.hypot(a2Prime, b2);
  const hPrime = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const hue = (Math.atan2(b, a) * 180) / Math.PI;
    return hue >= 0 ? hue : hue + 360;
  };
  const h1Prime = hPrime(a1Prime, b1);
  const h2Prime = hPrime(a2Prime, b2);
  const deltaL = l2 - l1;
  const deltaC = c2Prime - c1Prime;
  let deltaH = h2Prime - h1Prime;
  if (c1Prime * c2Prime === 0) deltaH = 0;
  else if (deltaH > 180) deltaH -= 360;
  else if (deltaH < -180) deltaH += 360;
  const deltaBigH = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin((deltaH * Math.PI) / 360);
  const lBar = (l1 + l2) / 2;
  const cPrimeBar = (c1Prime + c2Prime) / 2;
  let hPrimeBar = h1Prime + h2Prime;
  if (c1Prime * c2Prime === 0) hPrimeBar = h1Prime + h2Prime;
  else if (Math.abs(h1Prime - h2Prime) <= 180) hPrimeBar /= 2;
  else hPrimeBar = (h1Prime + h2Prime + 360) / 2;
  const t =
    1 -
    0.17 * Math.cos(((hPrimeBar - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hPrimeBar * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hPrimeBar + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hPrimeBar - 63) * Math.PI) / 180);
  const deltaTheta = 30 * Math.exp(-(((hPrimeBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cPrimeBar ** 7 / (cPrimeBar ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cPrimeBar;
  const sh = 1 + 0.015 * cPrimeBar * t;
  const rt = -Math.sin((2 * deltaTheta * Math.PI) / 180) * rc;
  return Math.sqrt(
    (deltaL / sl) ** 2 +
      (deltaC / sc) ** 2 +
      (deltaBigH / sh) ** 2 +
      rt * (deltaC / sc) * (deltaBigH / sh),
  );
}

export function percentile95(values: readonly number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * 0.95;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export type V14dNormalizedImage = {
  width: number;
  height: number;
  data: Float32Array;
  colorSpace: "linear" | "srgb";
};

export type V14dRoiLevelMetric = {
  status: "measured" | "pending-calibration" | "unmeasured" | "insufficient-pixels" | "scene-mismatch";
  sampleCount: number;
  validSampleCount: number;
  validRate: number;
  linearRgbMeanErrorPercent: number | null;
  linearRgbChannelErrorPercent: { r: number | null; g: number | null; b: number | null };
  finalDisplayDeltaE2000: { mean: number | null; p95: number | null };
  notes: string[];
};

export type V14dColorBaselineRoiResult = {
  roiId: string;
  material: V14dColorBaselineRoi["material"];
  materialId: number | null;
  levels: Record<V14dColorBaselineLevel, V14dRoiLevelMetric>;
};

export type V14dFirstDivergence = {
  status: "observed" | "not-observed" | "not-proven";
  level: V14dColorBaselineLevel | null;
  reason: string;
};

export type V14dColorBaselineReadback = {
  width: number;
  height: number;
  hdr: {
    format: GPUTextureFormat;
    sourceFormat: GPUTextureFormat | "unknown";
    rowPitch: number;
    data: Float32Array;
    nanCount: number;
    infCount: number;
  };
  mask: {
    format: "rgba8unorm";
    sourceFormat: GPUTextureFormat;
    rowPitch: number;
    data: Uint8Array;
  };
  materialMask: {
    format: "rgba8unorm";
    sourceFormat: GPUTextureFormat;
    rowPitch: number;
    data: Uint8Array;
  } | null;
  finalDisplay: V14dNormalizedImage;
};

export type V14dAnimationProgressEvidence = {
  animationName: string | null;
  currentSeconds: number;
  durationSeconds: number;
  percentage: number;
  currentFrame: number;
  expectedFrame: number;
  frameError: number;
  looping: boolean;
  playing: boolean;
  paused: boolean;
};

export type V14dAnimationEvidence = {
  beforeRenderFrame: V14dAnimationProgressEvidence | null;
  afterBaseColorRenderFrame: V14dAnimationProgressEvidence | null;
  afterLinearHdrRenderFrame: V14dAnimationProgressEvidence | null;
  expectedFrame: number;
  fps: number;
  renderFrameStable: boolean;
  frame120Verified: boolean;
};

export type V14dColorBaselineResult = {
  schemaVersion: 1;
  status: "ready" | "invalid" | "error" | "not-run";
  scene: V14dSceneValidation;
  input: {
    width: number;
    height: number;
    frame: number;
    fps: number;
    seconds: number;
    camera: typeof V14D_COLOR_BASELINE_CAMERA;
    vmdUrl: string;
    vmdLoaded: boolean;
    renderLoopStopped: boolean;
    renderFrameDeltaSeconds: 0;
    animation: V14dAnimationEvidence;
  };
  readback: {
    roiReadback: boolean;
    linearHdrReadback: boolean;
    finalDisplayReadback: boolean;
    materialMaskReadback: boolean;
    materialMaskSource: "engine-pick-material-id-depth" | null;
    materialMaskSourceFormat: GPUTextureFormat | null;
    baseColorSource: "v14d-unlit-texture-only" | null;
    linearHdrSource: "production-style-groups" | null;
    hdrSourceFormat: GPUTextureFormat | "unknown" | null;
    maskSourceFormat: GPUTextureFormat | null;
    width: number;
    height: number;
    rowPitch: { hdr: number | null; mask: number | null };
    nanCount: number | null;
    infCount: number | null;
  };
  rois: V14dColorBaselineRoiResult[];
  firstDivergenceStatus: V14dFirstDivergence["status"];
  firstDivergenceLevel: V14dFirstDivergence["level"];
  firstDivergenceReason: string;
  thresholds: {
    formal: null;
    note: string;
  };
  error?: string;
};

export type V14dColorBaselineEngine = {
  device?: GPUDevice;
  getProductionDrawCallSourceSnapshot?: (captureId: string, frame: number) => V14dProductionDrawCallSourceSnapshot;
  hdrResolveTexture?: GPUTexture;
  maskResolveTexture?: GPUTexture;
  hdrFormat?: GPUTextureFormat;
  pickPipeline?: GPURenderPipeline;
  pickPerFrameBindGroup?: GPUBindGroup;
  modelInstances?: Map<string, {
    model: { visible: boolean };
    vertexBuffer: GPUBuffer;
    jointsBuffer: GPUBuffer;
    weightsBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    skinMatrixBuffer: GPUBuffer;
    gpuMorph?: { weightsBuffer: GPUBuffer };
    pickPerInstanceBindGroup: GPUBindGroup;
    drawCalls?: Array<{ count: number; firstIndex: number; bindGroup: GPUBindGroup }>;
    pickDrawCalls: Array<{
      count: number;
      firstIndex: number;
      bindGroup: GPUBindGroup;
    }>;
  }>;
};

/**
 * reze-engine 的只读生产源快照。资源句柄只在同一 JS realm 内供诊断 pass 使用，
 * 不得序列化到生产状态；快照本身不触发渲染、不写入 buffer。
 */
export type V14dProductionDrawCallSourceSnapshot = {
  schemaVersion: 1;
  captureId: string;
  frame: number;
  source: "reze-engine-production-draw-call";
  device: GPUDevice;
  pick: {
    pipeline: GPURenderPipeline;
    perFrameBindGroup: GPUBindGroup;
    perFrameBindGroupLayout: GPUBindGroupLayout;
    perInstanceBindGroupLayout: GPUBindGroupLayout;
    perMaterialBindGroupLayout: GPUBindGroupLayout;
  };
  renderTargets: {
    hdrResolveTexture: GPUTexture;
    maskResolveTexture: GPUTexture;
    hdrFormat: GPUTextureFormat;
  };
  instances: Array<{
    name: string;
    visible: boolean;
    buffers: {
      vertex: GPUBuffer;
      index: GPUBuffer;
      joints: GPUBuffer;
      weights: GPUBuffer;
      skinMatrices: GPUBuffer;
    };
    bufferBytes: { vertex: number; index: number; joints: number; weights: number; skinMatrices: number };
    geometry: {
      vertexCount: number;
      indexCount: number;
      vertexStrideBytes: 32;
      indexFormat: "uint32";
      jointsFormat: "uint16x4";
      weightsFormat: "unorm8x4";
    };
    sourceIdentity: { vertex: string; index: string; joints: string; weights: string; skinMatrices: string };
    transforms: {
      skinMatrixSource: "model.getSkinMatrices -> skinMatrixBuffer";
      matrixCount: number;
      morphMode: "gpu-compute-in-place" | "cpu-upload";
      morphSource: string;
      morphWeightsBuffer: GPUBuffer | null;
      morphWeightsByteLength: number;
      morphWeightsNonZeroCount: number;
      morphDispatchPending: boolean;
    };
    pickPerInstanceBindGroup: GPUBindGroup;
    drawCalls: Array<{
      materialName: string;
      materialIndex: number;
      count: number;
      firstIndex: number;
      drawIndex: number;
      pickDrawCallIndex: number;
      mainBindGroup: GPUBindGroup;
      pickBindGroup: GPUBindGroup;
      mainPipeline: GPURenderPipeline | null;
      groupId: string | null;
      graphName: string | null;
    }>;
    pickDrawCalls: Array<{
      materialName: string;
      materialIndex: number;
      count: number;
      firstIndex: number;
      drawIndex: number;
      pickDrawCallIndex: number;
      bindGroup: GPUBindGroup;
    }>;
  }>;
};

export type V14dProductionSourceFloatStats = {
  byteLength: number;
  valueCount: number;
  finiteValueCount: number;
  nonZeroValueCount: number;
  nanCount: number;
  infCount: number;
  maxAbs: number;
};

export type V14dProductionSourceBufferStats = V14dProductionSourceFloatStats & {
  format: string;
  nonZeroPositionVertexCount?: number;
  positionBounds?: { min: [number, number, number]; max: [number, number, number] } | null;
};

export type V14dProductionSourceAudit = {
  schemaVersion: 1;
  captureId: string;
  frame: number;
  source: "reze-engine-production-draw-call";
  pickPipeline: { source: "engine.pickPipeline"; sameAsEngine: boolean };
  instances: Array<{
    name: string;
    visible: boolean;
    geometry: V14dProductionDrawCallSourceSnapshot["instances"][number]["geometry"];
    sourceIdentity: V14dProductionDrawCallSourceSnapshot["instances"][number]["sourceIdentity"];
    bufferIdentity: {
      vertex: boolean;
      index: boolean;
      joints: boolean;
      weights: boolean;
      skinMatrices: boolean;
      pickInstanceBindGroup: boolean;
      morphWeights: boolean;
    };
    buffers: {
      vertex: V14dProductionSourceBufferStats;
      index: V14dProductionSourceBufferStats;
      joints: V14dProductionSourceBufferStats;
      weights: V14dProductionSourceBufferStats;
      skinMatrices: V14dProductionSourceBufferStats;
      morphWeights: V14dProductionSourceBufferStats | null;
    };
    transforms: Omit<V14dProductionDrawCallSourceSnapshot["instances"][number]["transforms"], "morphWeightsBuffer"> & {
      morphWeightsReadback: boolean;
    };
    drawCalls: Array<Omit<V14dProductionDrawCallSourceSnapshot["instances"][number]["drawCalls"][number], "mainBindGroup" | "pickBindGroup" | "mainPipeline"> & {
      rangeMatchesPick: boolean;
      mainBindGroupMatchesEngine: boolean;
      pickBindGroupMatchesEngine: boolean;
      mainPipelinePresent: boolean;
    }>;
    pickDrawCalls: Array<Omit<V14dProductionDrawCallSourceSnapshot["instances"][number]["pickDrawCalls"][number], "bindGroup">>;
    indexIntegrity: {
      allDrawRangesInBounds: boolean;
      maxReferencedVertexIndex: number;
      referencedVertexIndicesInBounds: boolean;
    };
  }>;
  renderTargets: {
    hdrResolveTexture: { source: "engine.hdrResolveTexture"; sameAsEngine: boolean; format: GPUTextureFormat };
    maskResolveTexture: { source: "engine.maskResolveTexture"; sameAsEngine: boolean };
  };
};

export type V14dProductionSourceErrorCode =
  | "interface-unavailable"
  | "invalid-capture-request"
  | "snapshot-rejected"
  | "buffer-readback-failed"
  | "buffer-readback-incomplete";

export type V14dProductionSourceFailureClass =
  | "missing-source"
  | "invalid-request"
  | "snapshot"
  | "readback";

export class V14dProductionSourceError extends Error {
  readonly code: V14dProductionSourceErrorCode;
  readonly failureClass: V14dProductionSourceFailureClass;

  constructor(code: V14dProductionSourceErrorCode, failureClass: V14dProductionSourceFailureClass, message: string) {
    super(message);
    this.name = "V14dProductionSourceError";
    this.code = code;
    this.failureClass = failureClass;
  }
}

export type V14dProductionSourceReadback = {
  snapshot: V14dProductionDrawCallSourceSnapshot;
  audit: V14dProductionSourceAudit;
  morphWeightsByInstance: Record<string, number[]>;
};

export type V14dProductionSourceTriUvReadback = {
  triId: Int32Array;
  uv: Float32Array;
  faceMask: Uint8Array;
  width: number;
  height: number;
  source: "production-draw-call-buffers";
  depthBias: { constant: 0; slopeScale: 0 };
};

export type V14dHairTriUvSourceMode = "production-draw-call" | "cpu-base";

function readEnginePrivateFields(engine: unknown): V14dColorBaselineEngine {
  return (engine ?? {}) as V14dColorBaselineEngine;
}

function asProductionSourceError(
  error: unknown,
  code: V14dProductionSourceErrorCode,
  failureClass: V14dProductionSourceFailureClass,
  prefix: string,
): V14dProductionSourceError {
  if (error instanceof V14dProductionSourceError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new V14dProductionSourceError(code, failureClass, prefix + detail);
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function halfToFloat(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * (fraction / 0x400) * 2 ** -14;
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + fraction / 0x400) * 2 ** (exponent - 15);
}

type V14dProductionBufferKey = "vertex" | "index" | "joints" | "weights" | "skinMatrices" | "morphWeights";

type V14dProductionBufferBytes = Record<V14dProductionBufferKey, Uint8Array | null>;

function makeFloatStats(
  bytes: Uint8Array,
  format: string,
  positionStride?: number,
): V14dProductionSourceBufferStats {
  const copy = bytes.slice();
  const values = new Float32Array(copy.buffer);
  let finiteValueCount = 0;
  let nonZeroValueCount = 0;
  let nanCount = 0;
  let infCount = 0;
  let maxAbs = 0;
  let nonZeroPositionVertexCount = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  if (positionStride) {
    for (let i = 0; i + 2 < values.length; i += positionStride) {
      const x = values[i];
      const y = values[i + 1];
      const z = values[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (Math.abs(x) > 1e-7 || Math.abs(y) > 1e-7 || Math.abs(z) > 1e-7) nonZeroPositionVertexCount += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
  }
  for (const value of values) {
    if (Number.isNaN(value)) { nanCount += 1; continue; }
    if (!Number.isFinite(value)) { infCount += 1; continue; }
    finiteValueCount += 1;
    if (Math.abs(value) > 1e-7) nonZeroValueCount += 1;
    maxAbs = Math.max(maxAbs, Math.abs(value));
  }
  return {
    format,
    byteLength: bytes.byteLength,
    valueCount: values.length,
    finiteValueCount,
    nonZeroValueCount,
    nanCount,
    infCount,
    maxAbs,
    ...(positionStride
      ? {
          nonZeroPositionVertexCount,
          positionBounds: Number.isFinite(minX)
            ? { min: [minX, minY, minZ] as [number, number, number], max: [maxX, maxY, maxZ] as [number, number, number] }
            : null,
        }
      : {}),
  };
}

function makeIntegerStats(bytes: Uint8Array, format: string, elementBytes: 1 | 2 | 4): V14dProductionSourceBufferStats {
  const copy = bytes.slice();
  const values = elementBytes === 4
    ? new Uint32Array(copy.buffer)
    : elementBytes === 2
      ? new Uint16Array(copy.buffer)
      : new Uint8Array(copy.buffer);
  let nonZeroValueCount = 0;
  let maxAbs = 0;
  for (const value of values) {
    if (value !== 0) nonZeroValueCount += 1;
    maxAbs = Math.max(maxAbs, value);
  }
  return {
    format,
    byteLength: bytes.byteLength,
    valueCount: values.length,
    finiteValueCount: values.length,
    nonZeroValueCount,
    nanCount: 0,
    infCount: 0,
    maxAbs,
  };
}

async function readV14dProductionBufferBytes(
  device: GPUDevice,
  instance: V14dProductionDrawCallSourceSnapshot["instances"][number],
): Promise<V14dProductionBufferBytes> {
  const specs: Array<{ key: V14dProductionBufferKey; buffer: GPUBuffer; byteLength: number }> = [
    { key: "vertex", buffer: instance.buffers.vertex, byteLength: instance.bufferBytes.vertex },
    { key: "index", buffer: instance.buffers.index, byteLength: instance.bufferBytes.index },
    { key: "joints", buffer: instance.buffers.joints, byteLength: instance.bufferBytes.joints },
    { key: "weights", buffer: instance.buffers.weights, byteLength: instance.bufferBytes.weights },
    { key: "skinMatrices", buffer: instance.buffers.skinMatrices, byteLength: instance.bufferBytes.skinMatrices },
  ];
  if (instance.transforms.morphWeightsBuffer) {
    specs.push({
      key: "morphWeights",
      buffer: instance.transforms.morphWeightsBuffer,
      byteLength: Math.max(4, instance.transforms.morphWeightsByteLength),
    });
  }
  const readbacks = specs.map((spec) => ({
    ...spec,
    readback: device.createBuffer({
      label: "V14D production source readback " + instance.name + " " + spec.key,
      size: Math.max(4, alignTo(spec.byteLength, 4)),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    }),
  }));
  try {
    const encoder = device.createCommandEncoder({ label: "V14D production source buffer encoder" });
    for (const item of readbacks) {
      encoder.copyBufferToBuffer(item.buffer, 0, item.readback, 0, item.byteLength);
    }
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const output: V14dProductionBufferBytes = {
      vertex: null, index: null, joints: null, weights: null, skinMatrices: null, morphWeights: null,
    };
    for (const item of readbacks) {
      await item.readback.mapAsync(GPUMapMode.READ);
      output[item.key] = new Uint8Array(item.readback.getMappedRange()).slice(0, item.byteLength);
      item.readback.unmap();
    }
    return output;
  } finally {
    for (const item of readbacks) {
      if (item.readback.mapState === "mapped") item.readback.unmap();
      item.readback.destroy();
    }
  }
}

/**
 * 读取 reze-engine 生产 draw-call 的真实 GPU 源，并返回可落盘的审计摘要。
 *
 * 这是默认关闭的诊断 seam：只有调用方显式提供 captureId/frame 才会执行。
 * 快照中的 GPUBuffer/bind group 句柄只用于同一 JS realm 的后续诊断 pass；
 * audit 则只包含可序列化身份、范围、来源与非零统计。
 */
export async function readV14dProductionDrawCallSourceSnapshot(
  engine: unknown,
  captureId: string,
  frame: number,
): Promise<V14dProductionSourceReadback> {
  const fields = readEnginePrivateFields(engine);
  if (typeof fields.getProductionDrawCallSourceSnapshot !== "function") {
    throw new V14dProductionSourceError(
      "interface-unavailable",
      "missing-source",
      "reze-engine 未暴露生产 draw-call 源快照接口；请先运行 patch-reze-engine.mjs",
    );
  }
  if (typeof captureId !== "string" || captureId.length === 0) {
    throw new V14dProductionSourceError("invalid-capture-request", "invalid-request", "production source captureId 不能为空");
  }
  if (!Number.isFinite(frame)) {
    throw new V14dProductionSourceError("invalid-capture-request", "invalid-request", "production source frame 必须是有限数");
  }
  let snapshot: V14dProductionDrawCallSourceSnapshot;
  try {
    snapshot = fields.getProductionDrawCallSourceSnapshot(captureId, frame);
  } catch (error) {
    throw asProductionSourceError(error, "snapshot-rejected", "snapshot", "production source snapshot 被引擎拒绝：");
  }
  const auditInstances: V14dProductionSourceAudit["instances"] = [];
  const morphWeightsByInstance: Record<string, number[]> = {};
  for (const instance of snapshot.instances) {
    let bytes: V14dProductionBufferBytes;
    try {
      bytes = await readV14dProductionBufferBytes(snapshot.device, instance);
    } catch (error) {
      throw asProductionSourceError(error, "buffer-readback-failed", "readback", "production source buffer 读回失败：");
    }
    const vertex = bytes.vertex;
    const index = bytes.index;
    const joints = bytes.joints;
    const weights = bytes.weights;
    const skinMatrices = bytes.skinMatrices;
    const morphWeights = bytes.morphWeights;
    if (morphWeights) morphWeightsByInstance[instance.name] = Array.from(new Float32Array(morphWeights.slice().buffer));
    if (!vertex || !index || !joints || !weights || !skinMatrices) {
      throw new V14dProductionSourceError(
        "buffer-readback-incomplete",
        "readback",
        "production source buffer 读回不完整：" + instance.name,
      );
    }
    const engineInstance = fields.modelInstances?.get(instance.name);
    const bufferIdentity = {
      vertex: engineInstance?.vertexBuffer === instance.buffers.vertex,
      index: engineInstance?.indexBuffer === instance.buffers.index,
      joints: engineInstance?.jointsBuffer === instance.buffers.joints,
      weights: engineInstance?.weightsBuffer === instance.buffers.weights,
      skinMatrices: engineInstance?.skinMatrixBuffer === instance.buffers.skinMatrices,
      pickInstanceBindGroup: engineInstance?.pickPerInstanceBindGroup === instance.pickPerInstanceBindGroup,
      morphWeights: !!instance.transforms.morphWeightsBuffer && engineInstance?.gpuMorph?.weightsBuffer === instance.transforms.morphWeightsBuffer,
    };
    const indexCopy = index.slice();
    const indexData = new Uint32Array(indexCopy.buffer);
    let allDrawRangesInBounds = true;
    let maxReferencedVertexIndex = -1;
    let referencedVertexIndicesInBounds = true;
    for (const draw of instance.pickDrawCalls) {
      if (draw.firstIndex < 0 || draw.count < 0 || draw.firstIndex + draw.count > indexData.length) {
        allDrawRangesInBounds = false;
        continue;
      }
      for (let i = draw.firstIndex; i < draw.firstIndex + draw.count; i += 1) {
        const vertexIndex = indexData[i];
        maxReferencedVertexIndex = Math.max(maxReferencedVertexIndex, vertexIndex);
        if (vertexIndex >= instance.geometry.vertexCount) referencedVertexIndicesInBounds = false;
      }
    }
    const { morphWeightsBuffer: _morphWeightsBuffer, ...transformAudit } = instance.transforms;
    auditInstances.push({
      name: instance.name,
      visible: instance.visible,
      geometry: instance.geometry,
      sourceIdentity: instance.sourceIdentity,
      bufferIdentity,
      buffers: {
        vertex: makeFloatStats(vertex, "float32x8(position3+normal3+uv2)", 8),
        index: makeIntegerStats(index, "uint32", 4),
        joints: makeIntegerStats(joints, "uint16x4", 2),
        weights: makeIntegerStats(weights, "unorm8x4", 1),
        skinMatrices: makeFloatStats(skinMatrices, "float32x16-per-bone"),
        morphWeights: morphWeights ? makeFloatStats(morphWeights, "float32-per-morph") : null,
      },
      transforms: {
        ...transformAudit,
        morphWeightsReadback: !!morphWeights,
      },
      drawCalls: instance.drawCalls.map((draw) => {
        const engineDraw = engineInstance?.drawCalls?.[draw.drawIndex];
        const pickSource = instance.pickDrawCalls[draw.pickDrawCallIndex];
        return {
        materialName: draw.materialName,
        materialIndex: draw.materialIndex,
        count: draw.count,
        firstIndex: draw.firstIndex,
        drawIndex: draw.drawIndex,
        pickDrawCallIndex: draw.pickDrawCallIndex,
        groupId: draw.groupId,
        graphName: draw.graphName,
        mainPipelinePresent: !!draw.mainPipeline,
        rangeMatchesPick: !!pickSource
          && pickSource.drawIndex === draw.drawIndex
          && pickSource.pickDrawCallIndex === draw.pickDrawCallIndex
          && pickSource.count === draw.count
          && pickSource.firstIndex === draw.firstIndex,
        mainBindGroupMatchesEngine: engineDraw?.bindGroup === draw.mainBindGroup,
        pickBindGroupMatchesEngine: pickSource?.bindGroup === draw.pickBindGroup,
      };
      }),
      pickDrawCalls: instance.pickDrawCalls.map((draw) => ({
        materialName: draw.materialName,
        materialIndex: draw.materialIndex,
        count: draw.count,
        firstIndex: draw.firstIndex,
        drawIndex: draw.drawIndex,
        pickDrawCallIndex: draw.pickDrawCallIndex,
      })),
      indexIntegrity: { allDrawRangesInBounds, maxReferencedVertexIndex, referencedVertexIndicesInBounds },
    });
  }
  const renderTargets = {
    hdrResolveTexture: {
      source: "engine.hdrResolveTexture" as const,
      sameAsEngine: fields.hdrResolveTexture === snapshot.renderTargets.hdrResolveTexture,
      format: snapshot.renderTargets.hdrFormat,
    },
    maskResolveTexture: {
      source: "engine.maskResolveTexture" as const,
      sameAsEngine: fields.maskResolveTexture === snapshot.renderTargets.maskResolveTexture,
    },
  };
  return {
    snapshot,
    morphWeightsByInstance,
    audit: {
      schemaVersion: 1,
      captureId: snapshot.captureId,
      frame: snapshot.frame,
      source: snapshot.source,
      pickPipeline: { source: "engine.pickPipeline", sameAsEngine: fields.pickPipeline === snapshot.pick.pipeline },
      instances: auditInstances,
      renderTargets,
    },
  };
}

const BLIT_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  var uvs = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

@fragment
fn fsMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
}
`;

async function blitTextureToReadback(
  device: GPUDevice,
  source: GPUTexture,
  sourceFormat: GPUTextureFormat | "unknown",
  width: number,
  height: number,
  destinationFormat: "rgba16float" | "rgba8unorm",
): Promise<{ data: ArrayBuffer; rowPitch: number }> {
  const target = device.createTexture({
    label: "V14D color baseline readback target",
    size: [width, height],
    format: destinationFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const bytesPerPixel = destinationFormat === "rgba16float" ? 8 : 4;
  const rowPitch = alignTo(width * bytesPerPixel, 256);
  const buffer = device.createBuffer({
    label: "V14D color baseline readback buffer",
    size: rowPitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const module = device.createShaderModule({ label: `V14D blit ${sourceFormat}`, code: BLIT_SHADER });
    const pipeline = device.createRenderPipeline({
      label: `V14D blit ${sourceFormat} to ${destinationFormat}`,
      layout: "auto",
      vertex: { module, entryPoint: "vsMain" },
      fragment: { module, entryPoint: "fsMain", targets: [{ format: destinationFormat }] },
      primitive: { topology: "triangle-list" },
    });
    const sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: sampler },
      ],
    });
    const encoder = device.createCommandEncoder({ label: "V14D color baseline readback encoder" });
    const pass = encoder.beginRenderPass({
      label: "V14D color baseline texture blit",
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: target },
      { buffer, bytesPerRow: rowPitch, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    return { data: mapped.slice(0), rowPitch };
  } finally {
    if (buffer.mapState === "mapped") buffer.unmap();
    buffer.destroy();
    target.destroy();
  }
}

function decodeHdrReadback(raw: ArrayBuffer, rowPitch: number, width: number, height: number) {
  const output = new Float32Array(width * height * 4);
  const view = new DataView(raw);
  let nanCount = 0;
  let infCount = 0;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowPitch;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = rowOffset + x * 8;
      const targetOffset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const value = halfToFloat(view.getUint16(sourceOffset + channel * 2, true));
        output[targetOffset + channel] = value;
        if (Number.isNaN(value)) nanCount += 1;
        else if (!Number.isFinite(value)) infCount += 1;
      }
    }
  }
  return { data: output, nanCount, infCount };
}

function decodeRgba8Readback(raw: ArrayBuffer, rowPitch: number, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  const source = new Uint8Array(raw);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * rowPitch;
    const targetOffset = y * width * 4;
    output.set(source.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
  }
  return output;
}

export async function readV14dColorBaselineResolveTargets(
  engine: unknown,
  width: number,
  height: number,
): Promise<Pick<V14dColorBaselineReadback, "hdr" | "mask">> {
  const fields = readEnginePrivateFields(engine);
  if (!fields.device || !fields.hdrResolveTexture || !fields.maskResolveTexture) {
    throw new Error("reze-engine 未暴露可诊断的 HDR/mask resolve 纹理。");
  }
  const hdrSourceFormat = fields.hdrFormat ?? "unknown";
  const hdrRaw = await blitTextureToReadback(
    fields.device,
    fields.hdrResolveTexture,
    hdrSourceFormat,
    width,
    height,
    "rgba16float",
  );
  const maskSourceFormat: GPUTextureFormat = "rg8unorm";
  const maskRaw = await blitTextureToReadback(
    fields.device,
    fields.maskResolveTexture,
    maskSourceFormat,
    width,
    height,
    "rgba8unorm",
  );
  const hdr = decodeHdrReadback(hdrRaw.data, hdrRaw.rowPitch, width, height);
  return {
    hdr: {
      format: "rgba16float",
      sourceFormat: hdrSourceFormat,
      rowPitch: hdrRaw.rowPitch,
      data: hdr.data,
      nanCount: hdr.nanCount,
      infCount: hdr.infCount,
    },
    mask: {
      format: "rgba8unorm",
      sourceFormat: maskSourceFormat,
      rowPitch: maskRaw.rowPitch,
      data: decodeRgba8Readback(maskRaw.data, maskRaw.rowPitch, width, height),
    },
  };
}

/**
 * 诊断专用的全分辨率材质 ID pass。
 *
 * reze-engine 的生产 mask MRT 只携带 bloom mask 与累计模型 alpha，不能区分
 * 同一 ROI 矩形内的多个 PMX 材质。这里复用引擎已有 pick pipeline、skinning
 * buffer 和逐材质 draw call，以 depth24plus 的 less-equal 深度测试保留前景材质。
 * 该 pass 只在 v14dColorBaseline=1 的固定单帧采集中执行，不改变生产渲染路径。
 */
export async function readV14dColorBaselineMaterialMask(
  engine: unknown,
  width: number,
  height: number,
): Promise<NonNullable<V14dColorBaselineReadback["materialMask"]>> {
  const fields = readEnginePrivateFields(engine);
  if (!fields.device || !fields.pickPipeline || !fields.pickPerFrameBindGroup || !fields.modelInstances) {
    throw new Error("reze-engine 未暴露诊断所需的材质 ID pick pipeline。");
  }
  const target = fields.device.createTexture({
    label: "V14D material ID mask",
    size: [width, height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const depth = fields.device.createTexture({
    label: "V14D material ID depth",
    size: [width, height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const rowPitch = alignTo(width * 4, 256);
  const buffer = fields.device.createBuffer({
    label: "V14D material ID readback",
    size: rowPitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = fields.device.createCommandEncoder({ label: "V14D material ID mask encoder" });
    const pass = encoder.beginRenderPass({
      label: "V14D material ID mask pass",
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(fields.pickPipeline);
    pass.setBindGroup(0, fields.pickPerFrameBindGroup);
    for (const instance of fields.modelInstances.values()) {
      if (!instance.model.visible) continue;
      pass.setVertexBuffer(0, instance.vertexBuffer);
      pass.setVertexBuffer(1, instance.jointsBuffer);
      pass.setVertexBuffer(2, instance.weightsBuffer);
      pass.setIndexBuffer(instance.indexBuffer, "uint32");
      pass.setBindGroup(1, instance.pickPerInstanceBindGroup);
      for (const draw of instance.pickDrawCalls) {
        pass.setBindGroup(2, draw.bindGroup);
        pass.drawIndexed(draw.count, 1, draw.firstIndex, 0, 0);
      }
    }
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: target },
      { buffer, bytesPerRow: rowPitch, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    fields.device.queue.submit([encoder.finish()]);
    await fields.device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const data = new Uint8Array(width * height * 4);
    const source = new Uint8Array(mapped);
    for (let y = 0; y < height; y += 1) {
      const sourceOffset = y * rowPitch;
      const targetOffset = y * width * 4;
      data.set(source.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
    }
    return {
      format: "rgba8unorm",
      sourceFormat: "rgba8unorm",
      rowPitch,
      data,
    };
  } finally {
    if (buffer.mapState === "mapped") buffer.unmap();
    buffer.destroy();
    depth.destroy();
    target.destroy();
  }
}

// 与 reze-engine pick 管线完全相同的生产顶点布局：位置/法线/UV 为 float32x8，
// joints 为 uint16x4，weights 为 unorm8x4。这个布局是本票的关键不变量；
// 不能复用旧的 uint32/float32 诊断布局，否则读到的并不是生产属性。
const PRODUCTION_SOURCE_VERTEX_BUFFERS: GPUVertexBufferLayout[] = [
  {
    arrayStride: 32,
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x3" },
      { shaderLocation: 1, offset: 12, format: "float32x3" },
      { shaderLocation: 2, offset: 24, format: "float32x2" },
    ],
  },
  {
    arrayStride: 8,
    attributes: [{ shaderLocation: 3, offset: 0, format: "uint16x4" }],
  },
  {
    arrayStride: 4,
    attributes: [{ shaderLocation: 4, offset: 0, format: "unorm8x4" }],
  },
];

const PRODUCTION_SOURCE_DEPTH_WGSL = /* wgsl */ `
struct CameraUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewPos: vec3f,
  _padding: f32,
};
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> skinMats: array<mat4x4f>;

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints0: vec4<u32>,
  @location(4) weights0: vec4<f32>,
) -> @builtin(position) vec4f {
  let pos4 = vec4f(position, 1.0);
  let weightSum = weights0.x + weights0.y + weights0.z + weights0.w;
  let invWeightSum = select(1.0, 1.0 / weightSum, weightSum > 0.0001);
  let nw = select(vec4f(1.0, 0.0, 0.0, 0.0), weights0 * invWeightSum, weightSum > 0.0001);
  var sp = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) { sp += (skinMats[joints0[i]] * pos4) * nw[i]; }
  return camera.projection * camera.view * vec4f(sp.xyz, 1.0);
}
`;

const PRODUCTION_SOURCE_TRI_UV_WGSL = /* wgsl */ `
struct CameraUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewPos: vec3f,
  _padding: f32,
};
struct TriMeta {
  triId: u32,
  materialId: u32,
  _p0: u32,
  _p1: u32,
};
struct PickId {
  modelId: f32,
  materialId: f32,
  _p1: f32,
  _p2: f32,
};
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> skinMats: array<mat4x4f>;
@group(2) @binding(0) var<uniform> pickId: PickId;
@group(3) @binding(0) var<uniform> tri: TriMeta;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @interpolate(flat) @location(1) triId: u32,
};

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints0: vec4<u32>,
  @location(4) weights0: vec4<f32>,
) -> VSOut {
  let pos4 = vec4f(position, 1.0);
  let weightSum = weights0.x + weights0.y + weights0.z + weights0.w;
  let invWeightSum = select(1.0, 1.0 / weightSum, weightSum > 0.0001);
  let nw = select(vec4f(1.0, 0.0, 0.0, 0.0), weights0 * invWeightSum, weightSum > 0.0001);
  var sp = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) { sp += (skinMats[joints0[i]] * pos4) * nw[i]; }
  var out: VSOut;
  out.pos = camera.projection * camera.view * vec4f(sp.xyz, 1.0);
  out.uv = uv;
  out.triId = tri.triId;
  return out;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  return vec4f(in.uv.x, in.uv.y, f32(in.triId), pickId.materialId);
}
`;

/**
 * 从 production draw-call 的真实 GPU buffer 直接生成 triId+UV。
 *
 * pass1 按引擎 pickDrawCalls 原顺序、原 firstIndex/count 写入前景深度；
 * pass2 仍使用同一 vertex/index/joints/weights/skinMatrix buffer，仅把目标
 * draw-call 拆成三索引小 draw，并以 uniform 携带局部 triId。这样位置、蒙皮、
 * morph 后 vertexBuffer 和索引解释都与生产 pick 相同；本 pass 没有 depthBias。
 */
export async function readV14dProductionSourceTriUv(
  source: V14dProductionSourceReadback,
  width: number,
  height: number,
  materialNames: readonly string[],
): Promise<V14dProductionSourceTriUvReadback> {
  const snapshot = source.snapshot;
  const device = snapshot.device;
  const targetNames = new Set(materialNames);
  const triLayout = device.createBindGroupLayout({
    label: "V14D production source tri metadata layout",
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
  });
  const depthLayout = device.createPipelineLayout({
    label: "V14D production source depth layout",
    bindGroupLayouts: [snapshot.pick.perFrameBindGroupLayout, snapshot.pick.perInstanceBindGroupLayout],
  });
  const triPipelineLayout = device.createPipelineLayout({
    label: "V14D production source tri UV layout",
    bindGroupLayouts: [snapshot.pick.perFrameBindGroupLayout, snapshot.pick.perInstanceBindGroupLayout, snapshot.pick.perMaterialBindGroupLayout, triLayout],
  });
  const depthModule = device.createShaderModule({ label: "V14D production source depth shader", code: PRODUCTION_SOURCE_DEPTH_WGSL });
  const triModule = device.createShaderModule({ label: "V14D production source tri UV shader", code: PRODUCTION_SOURCE_TRI_UV_WGSL });
  const depthPipeline = device.createRenderPipeline({
    label: "V14D production source depth pipeline",
    layout: depthLayout,
    vertex: { module: depthModule, buffers: PRODUCTION_SOURCE_VERTEX_BUFFERS },
    primitive: { cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less-equal" },
  });
  const triPipeline = device.createRenderPipeline({
    label: "V14D production source tri UV pipeline",
    layout: triPipelineLayout,
    vertex: { module: triModule, buffers: PRODUCTION_SOURCE_VERTEX_BUFFERS },
    fragment: { module: triModule, targets: [{ format: "rgba32float" }] },
    primitive: { cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "equal" },
  });
  const depth = device.createTexture({
    label: "V14D production source depth",
    size: [width, height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const target = device.createTexture({
    label: "V14D production source tri UV target",
    size: [width, height],
    format: "rgba32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const rowPitch = alignTo(width * 16, 256);
  const readback = device.createBuffer({
    label: "V14D production source tri UV readback",
    size: rowPitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const triResources: Array<{ buffer: GPUBuffer; bindGroup: GPUBindGroup }> = [];
  try {
    const encoder = device.createCommandEncoder({ label: "V14D production source tri UV encoder" });
    const p1 = encoder.beginRenderPass({
      label: "V14D production source depth prepass",
      colorAttachments: [],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    p1.setPipeline(depthPipeline);
    p1.setBindGroup(0, snapshot.pick.perFrameBindGroup);
    for (const instance of snapshot.instances) {
      if (!instance.visible) continue;
      p1.setVertexBuffer(0, instance.buffers.vertex);
      p1.setVertexBuffer(1, instance.buffers.joints);
      p1.setVertexBuffer(2, instance.buffers.weights);
      p1.setIndexBuffer(instance.buffers.index, "uint32");
      p1.setBindGroup(1, instance.pickPerInstanceBindGroup);
      for (const draw of instance.pickDrawCalls) {
        p1.drawIndexed(draw.count, 1, draw.firstIndex, 0, 0);
      }
    }
    p1.end();

    const p2 = encoder.beginRenderPass({
      label: "V14D production source tri UV pass",
      colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depth.createView(), depthLoadOp: "load", depthStoreOp: "store" },
    });
    p2.setPipeline(triPipeline);
    p2.setBindGroup(0, snapshot.pick.perFrameBindGroup);
    for (const instance of snapshot.instances) {
      if (!instance.visible) continue;
      p2.setVertexBuffer(0, instance.buffers.vertex);
      p2.setVertexBuffer(1, instance.buffers.joints);
      p2.setVertexBuffer(2, instance.buffers.weights);
      p2.setIndexBuffer(instance.buffers.index, "uint32");
      p2.setBindGroup(1, instance.pickPerInstanceBindGroup);
      for (const draw of instance.pickDrawCalls) {
        if (!targetNames.has(draw.materialName)) continue;
        const triangleCount = Math.floor(draw.count / 3);
        for (let triangle = 0; triangle < triangleCount; triangle += 1) {
          const triBuffer = device.createBuffer({
            label: "V14D production source tri metadata " + instance.name + " " + draw.materialName + " " + triangle,
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(triBuffer, 0, new Uint32Array([triangle, draw.materialIndex, 0, 0]));
          const triBindGroup = device.createBindGroup({
            label: "V14D production source tri metadata bind group",
            layout: triLayout,
            entries: [{ binding: 0, resource: { buffer: triBuffer } }],
          });
          triResources.push({ buffer: triBuffer, bindGroup: triBindGroup });
          p2.setBindGroup(2, draw.bindGroup);
          p2.setBindGroup(3, triBindGroup);
          p2.drawIndexed(3, 1, draw.firstIndex + triangle * 3, 0, 0);
        }
      }
    }
    p2.end();
    encoder.copyTextureToBuffer(
      { texture: target },
      { buffer: readback, bytesPerRow: rowPitch, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await readback.mapAsync(GPUMapMode.READ);
    const mapped = new Float32Array(readback.getMappedRange().slice(0));
    const rowFloats = rowPitch / 4;
    const triId = new Int32Array(width * height).fill(-1);
    const uv = new Float32Array(width * height * 2);
    const faceMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const offset = y * rowFloats + x * 4;
        if (mapped[offset + 3] > 0.5) {
          uv[i * 2] = mapped[offset];
          uv[i * 2 + 1] = mapped[offset + 1];
          triId[i] = Math.round(mapped[offset + 2]);
          faceMask[i] = 1;
        }
      }
    }
    return {
      triId,
      uv,
      faceMask,
      width,
      height,
      source: "production-draw-call-buffers",
      depthBias: { constant: 0, slopeScale: 0 },
    };
  } finally {
    if (readback.mapState === "mapped") readback.unmap();
    readback.destroy();
    for (const resource of triResources) resource.buffer.destroy();
    depth.destroy();
    target.destroy();
  }
}

/**
 * 诊断专用的 Face 三角形 ID + UV pass（Stage 2B-M2，默认关闭，仅 faceStatic 采集调用）。
 *
 * 复用 pick pass 的逐材质 draw call 与深度语义，但 fragment 输出改为
 * (Face 局部三角形 ID 的 16bit 编码, u, v)，仅 Face 材质输出非零；其余材质
 * 输出 (1,1,1,1) 哨兵。UV 与生产同顶点属性（PMX 原始 UV），与 Blender loop UV 同口径。
 * 深度用 less-equal 保留前景，与 readV14dColorBaselineMaterialMask 完全一致。
 */
// Depth-only WGSL（pass1：全部材质写深度，颜色丢弃）
const FACE_TRI_DEPTH_WGSL = /* wgsl */ `
struct CameraUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewPos: vec3f,
  _padding: f32,
};
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> skinMats: array<mat4x4f>;

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints0: vec4<u32>,
  @location(4) weights0: vec4<f32>,
) -> @builtin(position) vec4f {
  let pos4 = vec4f(position, 1.0);
  let weightSum = weights0.x + weights0.y + weights0.z + weights0.w;
  let invWeightSum = select(1.0, 1.0 / weightSum, weightSum > 0.0001);
  let nw = select(vec4f(1.0, 0.0, 0.0, 0.0), weights0 * invWeightSum, weightSum > 0.0001);
  var sp = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) { sp += (skinMats[joints0[i]] * pos4) * nw[i]; }
  return camera.projection * camera.view * vec4f(sp.xyz, 1.0);
}
`;

// Face UV WGSL（pass2：仅 Face 材质输出插值 UV，深度 equal 测试保留前景 Face 像素）
const FACE_UV_ONLY_WGSL = /* wgsl */ `
struct CameraUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewPos: vec3f,
  _padding: f32,
};
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> skinMats: array<mat4x4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @interpolate(flat) @location(1) triIndex: u32,
};

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints0: vec4<u32>,
  @location(4) weights0: vec4<f32>,
  @builtin(vertex_index) vertIndex: u32,
) -> VSOut {
  let pos4 = vec4f(position, 1.0);
  let weightSum = weights0.x + weights0.y + weights0.z + weights0.w;
  let invWeightSum = select(1.0, 1.0 / weightSum, weightSum > 0.0001);
  let nw = select(vec4f(1.0, 0.0, 0.0, 0.0), weights0 * invWeightSum, weightSum > 0.0001);
  var sp = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) { sp += (skinMats[joints0[i]] * pos4) * nw[i]; }
  var out: VSOut;
  out.pos = camera.projection * camera.view * vec4f(sp.xyz, 1.0);
  out.uv = uv;
  // Chrome WebGPU 不支持 @builtin(primitive_index)（实测致管线静默失败、pass 无输出）。
  // 改用 @builtin(vertex_index)：drawIndexed(count,1,firstIndex=0,0,0) 时它是索引缓冲位置，
  // 同一三角形三顶点 flat 插值取 provoke 顶点（每三角第 1 顶点），vertIndex/3 = 三角形序号。
  out.triIndex = vertIndex / 3u;  // 注意：Chrome WebGPU 无 primitive_index，vertex_index/3 编号与 Blender triIndex 不对应（实测 0/96 UV 一致、96 ID 覆盖整脸=多三角共享 ID），仅作诊断占位，Gate 不得据此判同三角形。
  return out;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  return vec4f(in.uv.x, in.uv.y, f32(in.triIndex), 1.0);
}
`;

export type V14dFaceTriUvReadback = {
  /** 逐像素 Face 局部三角形序号（@builtin(primitive_index)，Face firstIndex=0 故等于 Blender triIndex，同拓扑同序）；非 Face 前景像素为 -1。 */
  triId: Int32Array;
  /** 逐像素插值 UV（Float32, length = width*height*2）；非 Face 前景像素为 0。 */
  uv: Float32Array;
  /** 逐像素是否 Face 且为前景（深度 equal 通过）。 */
  faceMask: Uint8Array;
  width: number;
  height: number;
};

/**
 * 诊断专用的 Face 前景 UV pass（Stage 2B-M2，默认关闭）。
 *
 * 两段式：
 *   pass1 全部材质 depth-only（less 写深度）→ 得到场景前景深度；
 *   pass2 仅 Face 材质（equal 测试，不写深度）→ 输出插值 UV；
 *   被头发/身体遮挡的 Face 像素在 pass2 因深度不等被剔除，保证 faceMask 只含
 *   真实可见的 Face 像素。UV 与生产同顶点属性（PMX 原始 UV），与 Blender loop UV 同口径。
 *
 * 注意：本 pass 不输出三角形 ID（WebGPU 无无状态三角形序号）；同三角形约束由
 * 离线 Gate 用「Web 像素 UV 必须落在该像素 Blender raycast 三角形的 UV 范围内」判定。
 */
export async function readV14dFaceTriUvMask(
  engine: unknown,
  width: number,
  height: number,
  faceMaterialIndex: number,
  faceMaterialFirstIndex: number,
): Promise<V14dFaceTriUvReadback> {
  const fields = readEnginePrivateFields(engine);
  if (!fields.device || !fields.pickPerFrameBindGroup || !fields.modelInstances) {
    throw new Error("reze-engine 未暴露诊断所需的 Face 前景 UV 管线字段。");
  }
  const device = fields.device;
  const perFrameLayout = (fields as unknown as { pickPerFrameBindGroupLayout?: GPUBindGroupLayout }).pickPerFrameBindGroupLayout!;
  const perInstanceLayout = (fields as unknown as { pickPerInstanceBindGroupLayout?: GPUBindGroupLayout }).pickPerInstanceBindGroupLayout!;
  const depthLayout = device.createPipelineLayout({ bindGroupLayouts: [perFrameLayout, perInstanceLayout] });
  const uvLayout = device.createPipelineLayout({ bindGroupLayouts: [perFrameLayout, perInstanceLayout] });
  const depthModule = device.createShaderModule({ label: "V14D face depth shader", code: FACE_TRI_DEPTH_WGSL });
  const uvModule = device.createShaderModule({ label: "V14D face uv shader", code: FACE_UV_ONLY_WGSL });
  const buffers: GPUVertexBufferLayout[] = [
    { arrayStride: 32, attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x3" },
      { shaderLocation: 1, offset: 12, format: "float32x3" },
      { shaderLocation: 2, offset: 24, format: "float32x2" },
    ] },
    { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "uint32x4" }] },
    { arrayStride: 16, attributes: [{ shaderLocation: 4, offset: 0, format: "float32x4" }] },
  ];
  const depthPipeline = device.createRenderPipeline({
    label: "V14D face depth pipeline",
    layout: depthLayout,
    vertex: { module: depthModule, buffers },
    primitive: { cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });
  const uvPipeline = device.createRenderPipeline({
    label: "V14D face uv pipeline",
    layout: uvLayout,
    vertex: { module: uvModule, buffers },
    fragment: { module: uvModule, targets: [{ format: "rgba32float" }] },
    primitive: { cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "equal" },
  });

  const depth = device.createTexture({
    label: "V14D face depth",
    size: [width, height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const target = device.createTexture({
    label: "V14D face uv target",
    size: [width, height],
    format: "rgba32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const rowPitch = alignTo(width * 16, 256);
  const buffer = device.createBuffer({
    label: "V14D face uv readback",
    size: rowPitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  try {
    const encoder = device.createCommandEncoder({ label: "V14D face uv encoder" });
    // pass1: 全部材质 depth-only
    const p1 = encoder.beginRenderPass({
      label: "V14D face depth prepass",
      colorAttachments: [],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    p1.setPipeline(depthPipeline);
    p1.setBindGroup(0, fields.pickPerFrameBindGroup);
    for (const instance of fields.modelInstances.values()) {
      if (!instance.model.visible) continue;
      p1.setVertexBuffer(0, instance.vertexBuffer);
      p1.setVertexBuffer(1, instance.jointsBuffer);
      p1.setVertexBuffer(2, instance.weightsBuffer);
      p1.setIndexBuffer(instance.indexBuffer, "uint32");
      p1.setBindGroup(1, instance.pickPerInstanceBindGroup);
      for (const draw of instance.pickDrawCalls) {
        p1.drawIndexed(draw.count, 1, draw.firstIndex, 0, 0);
      }
    }
    p1.end();
    // pass2: 仅 Face 材质输出 UV，深度 equal 剔除被遮挡的 Face 像素
    const p2 = encoder.beginRenderPass({
      label: "V14D face uv pass",
      colorAttachments: [
        { view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
      ],
      depthStencilAttachment: {
        view: depth.createView(),
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    });
    p2.setPipeline(uvPipeline);
    p2.setBindGroup(0, fields.pickPerFrameBindGroup);
    for (const instance of fields.modelInstances.values()) {
      if (!instance.model.visible) continue;
      p2.setVertexBuffer(0, instance.vertexBuffer);
      p2.setVertexBuffer(1, instance.jointsBuffer);
      p2.setVertexBuffer(2, instance.weightsBuffer);
      p2.setIndexBuffer(instance.indexBuffer, "uint32");
      p2.setBindGroup(1, instance.pickPerInstanceBindGroup);
      let matIndex = 0;
      for (const draw of instance.pickDrawCalls) {
        if (matIndex === faceMaterialIndex) {
          p2.drawIndexed(draw.count, 1, draw.firstIndex, 0, 0);
        }
        matIndex += 1;
      }
    }
    p2.end();
    encoder.copyTextureToBuffer(
      { texture: target },
      { buffer, bytesPerRow: rowPitch, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const hdr = mapped.slice(0);
    // rgba32float：每行 rowPitch 字节（含对齐填充），每像素 16 字节（4×f32），R=u,G=v,B=triIndex,A=1。
    const mapped32 = new Float32Array(mapped);
    const rowFloats = rowPitch / 4;
    const triId = new Int32Array(width * height).fill(-1);
    const uv = new Float32Array(width * height * 2);
    const faceMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const off = y * rowFloats + x * 4;
        const a = mapped32[off + 3];
        if (a > 0.5) {
          uv[i * 2] = mapped32[off];
          uv[i * 2 + 1] = mapped32[off + 1];
          triId[i] = Math.round(mapped32[off + 2]);
          faceMask[i] = 1;
        }
      }
    }
    return { triId, uv, faceMask, width, height };
  } finally {
    if (buffer.mapState === "mapped") buffer.unmap();
    buffer.destroy();
    target.destroy();
    depth.destroy();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2B-M2 路线 B+：Face 非索引展开三角形 pass（真实三角形身份）
//
// 背景：@builtin(primitive_index) 在 Chrome WebGPU 不受支持（实测致 pass 静默失败）；
// @builtin(vertex_index)/3 在 indexed draw 下编号与 Blender triIndex 不对应（多三角共享 ID）。
// 本 pass 改为：CPU 侧按 PMX Face 索引范围把每个三角形展开为 3 份顶点（position/normal/uv/
// joints/weights），并把同一个 Face 局部 triId 作为 flat 顶点属性写入每个展开顶点；GPU 用
// 非索引 draw(vertexCount=faceIndexCount)。triId 由此具有可靠语义（= PMX/Blender Face 局部
// 三角形序号，已验证 sortedVerts 2738/2738 同序一致）。
//
    // 可见性口径（修正版）：原 pass1 全模型 depth-only + equal 剔除的口径仍依赖
    // face_d alpha cutout 与生产 HDR pick 区域不一致（展开 pass 不做 cutout）。
    // 改为：pass2 直接以生产 HDR pick faceMask 作为 Web eligible 分母，
    // 展开 triId/UV 仅负责给这些像素补充三角形身份与 UV；不再做独立深度剔除。
    // 这样 Web 可见性语义与生产 pick 完全一致（含 alpha/cutout）。
// ─────────────────────────────────────────────────────────────────────────────

const FACE_EXPANDED_WGSL = /* wgsl */ `
struct CameraUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewPos: vec3f,
  _padding: f32,
};
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> skinMats: array<mat4x4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @interpolate(flat) @location(1) triId: u32,
};

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints0: vec4<u32>,
  @location(4) weights0: vec4<f32>,
  @location(5) triId: u32,
) -> VSOut {
  let pos4 = vec4f(position, 1.0);
  var out: VSOut;
  // 顶点已在 CPU 侧蒙皮展开为世界坐标（见 readV14dFaceExpandedTriUv 注释），
  // 此处只做 MVP 变换；joints0/weights0 不再使用（保留属性槽兼容管线布局）。
  out.pos = camera.projection * camera.view * pos4;
  out.uv = uv;
  out.triId = triId;
  return out;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4f {
  return vec4f(in.uv.x, in.uv.y, f32(in.triId), 1.0);
}
`;

// Stage 2C-M2a 修正轮（Brows/Lashes 逐槽原子 triUV 取证）：带前景深度剔除的
// 展开三角形 pass 专用顶点/片段着色器。
//
// 背景：readV14dFaceExpandedTriUv 的无深度 pass 可见性由绘制顺序决定；眉毛/睫毛是
// 紧贴脸部的小槽，脸部特写取景下刘海/侧发在屏幕上覆盖眉睫区，无深度 pass 会把
// 目标槽三角形投到这些被遮挡像素上，造成 triUV 落进 face_d 的头发纹理区
// （实测 Lashes triUvResolution=0.026、v1Mae=120，样本被 UV 合理性检查拒绝）。
// 生产材质 ID pick pass（readV14dColorBaselineMaterialMask）用真实深度管线，
// 同一帧下 Lashes 前景 152 像素全部有效。因此本 pass：
//   pass1 用生产 pick 深度管线（less 写深度）渲染全部材质，得到与生产完全一致的
//         场景前景深度；
//   pass2 仅画目标槽的 CPU 蒙皮展开几何（equal 深度测试、不写深度），输出插值 UV
//         与槽内局部三角形 ID。
// 被其他材质遮挡的目标槽像素在 pass2 被剔除，与生产可见性口径完全一致。
const FACE_EXPANDED_DEPTH_WGSL = /* wgsl */ `
struct CameraUniforms {
  view: mat4x4f,
  projection: mat4x4f,
  viewPos: vec3f,
  _padding: f32,
};
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(1) @binding(0) var<storage, read> skinMats: array<mat4x4f>;

@vertex fn vs(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints0: vec4<u32>,
  @location(4) weights0: vec4<f32>,
) -> @builtin(position) vec4f {
  let pos4 = vec4f(position, 1.0);
  let weightSum = weights0.x + weights0.y + weights0.z + weights0.w;
  let invWeightSum = select(1.0, 1.0 / weightSum, weightSum > 0.0001);
  let nw = select(vec4f(1.0, 0.0, 0.0, 0.0), weights0 * invWeightSum, weightSum > 0.0001);
  var sp = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) { sp += (skinMats[joints0[i]] * pos4) * nw[i]; }
  return camera.projection * camera.view * vec4f(sp.xyz, 1.0);
}
`;

export type V14dFaceExpandedSource = {
  vertices: Float32Array;
  indices: Uint32Array;
  joints: Uint16Array;
  weights: Uint8Array;
  faceFirstIndex: number;
  faceIndexCount: number;
  /** 蒙皮矩阵（getSkinMatrices()，列主序 16 浮点/骨骼）；提供时 CPU 侧展开为世界坐标。 */
  skinMatrices?: Float32Array;
};

/**
 * 诊断专用的同步屏障（默认关闭路径专用，仅 Stage 2B-M2 faceStatic 采集调用）：
 * 在调用方执行任何诊断 GPU pass 前，强制把当前 CPU 侧蒙皮矩阵写回 GPU，
 * 并用 onSubmittedWorkDone 排空已排队命令，确保随后的诊断 pass 读到与最近一次
 * 生产渲染完全相同的皮肤/相机状态（消除诊断 pass 间的时钟漂移）。
 *
 * 背景：faceStatic 模式 engine.stopRenderLoop() + model.pause() 后，
 * 诊断 pass（triUv / HDR pick / HDR resolve）各自直接读 GPU 缓冲；若某次渲染循环
 * 已把下一帧的皮肤矩阵排入 queue 但尚未执行，后续诊断 pass 会读到不一致的中间态。
 * 本函数把当前 getSkinMatrices() 结果写入 skinMatrixBuffer 并等待队列排空，
 * 把诊断读回锚定到调用时刻的 CPU 状态。
 */
export async function flushV14dDiagnosticBarrier(engine: unknown): Promise<void> {
  const fields = readEnginePrivateFields(engine);
  if (!fields.device || !fields.modelInstances) return;
  for (const instance of fields.modelInstances.values()) {
    const inst = instance as unknown as {
      model?: { getSkinMatrices?: () => Float32Array };
      skinMatrixBuffer?: GPUBuffer;
    };
    if (!inst.model?.getSkinMatrices || !inst.skinMatrixBuffer) continue;
    const mats = inst.model.getSkinMatrices();
    fields.device.queue.writeBuffer(inst.skinMatrixBuffer, 0, mats.buffer, mats.byteOffset, mats.byteLength);
  }
  await fields.device.queue.onSubmittedWorkDone();
}


/**
 * Stage 2C-M2a 修正轮：Brows/Lashes 逐槽原子 triUV 取证（带真实前景深度剔除）。
 *
 * 与 readV14dFaceExpandedTriUv（无深度、仅 faceStatic 使用的诊断 pass）不同，本 pass
 * 的可见性不由绘制顺序决定：
 *   pass1 复用生产 pick 深度管线（less 写深度）渲染全部材质，得到与生产完全一致的
 *         场景前景深度；
 *   pass2 仅画目标槽的 CPU 蒙皮展开几何（equal 深度测试、不写深度），输出插值 UV 与
 *         槽内局部三角形 ID；被其他材质（刘海/侧发/脸）遮挡的目标槽像素被剔除。
 * 眉毛/睫毛是紧贴脸部的小槽，脸部特写取景下头发在屏幕上覆盖眉睫区，无深度 pass
 * 会把目标槽三角形投到这些被遮挡像素上，triUV 落进 face_d 的头发纹理区导致
 * identity-target Gate 误判。本 pass 与生产材质 ID pick（152 像素 Lashes 前景）口径
 * 完全一致。仅在 Brows/Lashes 验收探针（captureHairTriUv useForegroundDepth）下调用，
 * 不改变生产渲染路径；faceStatic 原有调用点保持无深度行为。
 */
export async function readV14dFaceExpandedTriUvDepth(
  engine: unknown,
  width: number,
  height: number,
  src: V14dFaceExpandedSource,
): Promise<V14dFaceTriUvReadback> {
  const fields = readEnginePrivateFields(engine);
  if (!fields.device || !fields.pickPipeline || !fields.pickPerFrameBindGroup || !fields.modelInstances) {
    throw new Error("reze-engine 未暴露诊断所需的展开 Face 深度剔除管线字段。");
  }
  const device = fields.device;
  const perFrameLayout = (fields as unknown as { pickPerFrameBindGroupLayout?: GPUBindGroupLayout }).pickPerFrameBindGroupLayout!;
  const perInstanceLayout = (fields as unknown as { pickPerInstanceBindGroupLayout?: GPUBindGroupLayout }).pickPerInstanceBindGroupLayout!;

  const faceTriCount = Math.floor(src.faceIndexCount / 3);
  const expandedVertCount = faceTriCount * 3;
  const stride32 = 8 + 4 + 4 + 1;
  const interleaved = new ArrayBuffer(expandedVertCount * stride32 * 4);
  const f32 = new Float32Array(interleaved);
  const u32 = new Uint32Array(interleaved);
  for (let t = 0; t < faceTriCount; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const vi = src.indices[src.faceFirstIndex + t * 3 + k];
      const dst = (t * 3 + k) * stride32;
      for (let c = 0; c < 8; c += 1) f32[dst + c] = src.vertices[vi * 8 + c];
      for (let c = 0; c < 4; c += 1) u32[dst + 8 + c] = src.joints[vi * 4 + c];
      for (let c = 0; c < 4; c += 1) f32[dst + 12 + c] = src.weights[vi * 4 + c] / 255;
      u32[dst + 16] = t;
    }
  }

  // Stage 2C-M2a 修正轮：pass2 用 CPU 蒙皮展开为世界坐标（调用方 flushV14dDiagnosticBarrier
  // 已把同一姿态写回 GPU 的 pass1 skinMats）。pass2 的 FACE_EXPANDED_WGSL 只做 MVP、
  // 不再 GPU 蒙皮；pass1 的 FACE_EXPANDED_DEPTH_WGSL 用 GPU skinMats 蒙皮。
  // 两段共享 flush 后的同一姿态；CPU/GPU 蒙皮浮点微差在 depth24+near=1.0 下为亚像素级。
  if (src.skinMatrices) {
    const sm = src.skinMatrices;
    for (let t = 0; t < faceTriCount; t += 1) {
      for (let k = 0; k < 3; k += 1) {
        const vi = src.indices[src.faceFirstIndex + t * 3 + k];
        const dst = (t * 3 + k) * stride32;
        const bx = src.vertices[vi * 8], by = src.vertices[vi * 8 + 1], bz = src.vertices[vi * 8 + 2];
        let wx = 0, wy = 0, wz = 0;
        for (let j = 0; j < 4; j += 1) {
          const bi = u32[dst + 8 + j];
          const w = f32[dst + 12 + j];
          if (w <= 0) continue;
          const o = bi * 16;
          wx += w * (sm[o] * bx + sm[o + 4] * by + sm[o + 8] * bz + sm[o + 12]);
          wy += w * (sm[o + 1] * bx + sm[o + 5] * by + sm[o + 9] * bz + sm[o + 13]);
          wz += w * (sm[o + 2] * bx + sm[o + 6] * by + sm[o + 10] * bz + sm[o + 14]);
        }
        f32[dst] = wx; f32[dst + 1] = wy; f32[dst + 2] = wz;
      }
    }
  }

  const expandedBuffer = device.createBuffer({
    label: "V14D face expanded depth vertex buffer",
    size: interleaved.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(expandedBuffer, 0, interleaved);

  // pass2 展开几何用 GPU 蒙皮（skinMats），与 pass1 逐顶点一致：顶点缓冲携带
  // 原始 PMX 位置 + joints/weights，shader 里做蒙皮（注释见上方根因修复 2）。
  const expandedLayout = device.createPipelineLayout({ bindGroupLayouts: [perFrameLayout, perInstanceLayout] });
  const expandedModule = device.createShaderModule({ label: "V14D face expanded depth shader", code: FACE_EXPANDED_WGSL });
  const expandedBuffers: GPUVertexBufferLayout[] = [
    {
      arrayStride: stride32 * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" },
        { shaderLocation: 3, offset: 32, format: "uint32x4" },
        { shaderLocation: 4, offset: 48, format: "float32x4" },
        { shaderLocation: 5, offset: 64, format: "uint32" },
      ],
    },
  ];
  const expandedModuleInfo = await expandedModule.getCompilationInfo();
  const expandedErrors = expandedModuleInfo.messages.filter((m) => m.type === "error");
  if (expandedErrors.length > 0) {
    throw new Error("V14D face expanded depth shader 编译失败: " + expandedErrors.map((m) => m.message).join("; "));
  }
  device.pushErrorScope("validation");
  const expandedPipeline = device.createRenderPipeline({
    label: "V14D face expanded depth pipeline",
    layout: expandedLayout,
    vertex: { module: expandedModule, buffers: expandedBuffers },
    fragment: { module: expandedModule, targets: [{ format: "rgba32float" }] },
    primitive: { cullMode: "none" },
    // Stage 2C-M2a：用 less-equal 而非 equal。生产 pick 的 prepass 以 less-equal 写
    // 深度，目标槽自身前景像素的深度等于该值；但展开几何与 pick 走不同 shader，
    // 浮点光栅化微差会让严格 equal 把目标槽自身前景也剔除（实测两槽 0 命中）。
    // less-equal 保留目标槽前景与「未被更近物体遮挡」的语义：若有更近遮挡物，
    // 展开几何深度更大仍被剔除；prepass 已用生产 pick 管线渲染全部材质，故遮挡
    // 剔除口径与生产 material-ID pick 一致。
    // Stage 2C-M2a 修正轮（实验）：CPU 蒙皮 pass2 与 GPU 蒙皮 pass1 存在浮点微差，
    // 目标槽自身前景像素在 less-equal 下被判为「比 pass1 略远」而剔除（实测 overlap=0）。
    // 给 pass2 一个向相机方向的恒定深度偏移（depthBias 负值 → 深度略减 → 更接近前景），
    // 补偿两套蒙皮的微差，让目标槽自身前景通过剔除，同时仍被真正更近的遮挡物挡住。
    // 实测 depthBias=-2/slope=-2 后 Lashes 命中质心 (840,240) 已贴近 mask (827,249)，
    // 但仍因光栅化最近邻错位 overlap=0；加大偏移使目标槽前景稳定压过 pass1 深度。
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal", depthBias: -8, depthBiasSlopeScale: -4.0 },
  });
  const pipelineError = await device.popErrorScope();
  if (pipelineError) {
    throw new Error("V14D face expanded depth pipeline 创建失败: " + pipelineError.message);
  }

  // Stage 2C-M2a 修正轮（根因修复）：pass1 不能用 fields.pickPipeline——该管线带
  // rgba8unorm fragment target，在 colorAttachments: [] 的 depth-only pass 中触发
  // WebGPU 校验失败，使整个 command encoder 作废（pass1/pass2/copy 全被丢弃，
  // 实测 _debugHitCount=0 且 _debugPrepassDepthCount=全画布像素数）。
  // 改为专用 depth-only 管线：顶点布局与 pick 的 fullVertexBuffers 完全一致
  //（reze-engine engine.ts：buffer0 f32x3/f32x3/f32x2@stride32、buffer1 uint16x4@stride8、
  //  buffer2 unorm8x4@stride4），布局只有 [perFrame, perInstance] 两组，
  // 深度 less-equal 写（与 pick 同口径）。
  const prepassModule = device.createShaderModule({ label: "V14D face prepass depth shader", code: FACE_EXPANDED_DEPTH_WGSL });
  const prepassModuleInfo = await prepassModule.getCompilationInfo();
  const prepassErrors = prepassModuleInfo.messages.filter((m) => m.type === "error");
  if (prepassErrors.length > 0) {
    throw new Error("V14D face prepass depth shader 编译失败: " + prepassErrors.map((m) => m.message).join("; "));
  }
  const prepassLayout = device.createPipelineLayout({ bindGroupLayouts: [perFrameLayout, perInstanceLayout] });
  const prepassBuffers: GPUVertexBufferLayout[] = [
    {
      arrayStride: 32,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" },
      ],
    },
    { arrayStride: 8, attributes: [{ shaderLocation: 3, offset: 0, format: "uint16x4" }] },
    { arrayStride: 4, attributes: [{ shaderLocation: 4, offset: 0, format: "unorm8x4" }] },
  ];
  device.pushErrorScope("validation");
  const prepassPipeline = device.createRenderPipeline({
    label: "V14D face prepass depth pipeline",
    layout: prepassLayout,
    vertex: { module: prepassModule, buffers: prepassBuffers },
    primitive: { cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less-equal" },
  });
  const prepassPipelineError = await device.popErrorScope();
  if (prepassPipelineError) {
    throw new Error("V14D face prepass depth pipeline 创建失败: " + prepassPipelineError.message);
  }

  const depth = device.createTexture({
    label: "V14D face expanded depth",
    size: [width, height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const target = device.createTexture({ label: "V14D face expanded depth target", size: [width, height], format: "rgba32float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const rowPitch = alignTo(width * 16, 256);
  const buffer = device.createBuffer({ label: "V14D face expanded depth readback", size: rowPitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  try {
    const encoder = device.createCommandEncoder({ label: "V14D face expanded depth encoder" });
    // pass1：生产 pick 深度管线渲染全部材质，写场景前景深度（与 material-ID pick 同口径）。
    const p1 = encoder.beginRenderPass({
      label: "V14D face expanded depth prepass",
      colorAttachments: [],
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    p1.setPipeline(prepassPipeline);
    p1.setBindGroup(0, fields.pickPerFrameBindGroup);
    for (const instance of fields.modelInstances.values()) {
      if (!instance.model.visible) continue;
      p1.setVertexBuffer(0, instance.vertexBuffer);
      p1.setVertexBuffer(1, instance.jointsBuffer);
      p1.setVertexBuffer(2, instance.weightsBuffer);
      p1.setIndexBuffer(instance.indexBuffer, "uint32");
      p1.setBindGroup(1, instance.pickPerInstanceBindGroup);
      for (const draw of instance.pickDrawCalls) {
        p1.drawIndexed(draw.count, 1, draw.firstIndex, 0, 0);
      }
    }
    p1.end();
    // pass2：仅目标槽展开几何，equal 深度测试剔除被遮挡像素，输出 uv/triId。
    const p2 = encoder.beginRenderPass({
      label: "V14D face expanded depth uv pass",
      colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: {
        view: depth.createView(),
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    });
    p2.setPipeline(expandedPipeline);
    p2.setBindGroup(0, fields.pickPerFrameBindGroup);
    for (const instance of fields.modelInstances.values()) {
      if (!instance.model.visible) continue;
      p2.setVertexBuffer(0, expandedBuffer);
      p2.setBindGroup(1, instance.pickPerInstanceBindGroup);
      p2.draw(expandedVertCount, 1, 0, 0);
    }
    p2.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: rowPitch, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const mapped32 = new Float32Array(mapped.slice(0));
    const rowFloats = rowPitch / 4;
    const triId = new Int32Array(width * height).fill(-1);
    const uv = new Float32Array(width * height * 2);
    const faceMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const off = y * rowFloats + x * 4;
        const a = mapped32[off + 3];
        if (a > 0.5) {
          uv[i * 2] = mapped32[off];
          uv[i * 2 + 1] = mapped32[off + 1];
          triId[i] = Math.round(mapped32[off + 2]);
          faceMask[i] = 1;
        }
      }
    }
    return { triId, uv, faceMask, width, height };
  } finally {
    if (buffer.mapState === "mapped") buffer.unmap();
    buffer.destroy();
    target.destroy();
    depth.destroy();
    expandedBuffer.destroy();
  }
}

export async function readV14dFaceExpandedTriUv(
  engine: unknown,
  width: number,
  height: number,
  src: V14dFaceExpandedSource,
): Promise<V14dFaceTriUvReadback> {
  const fields = readEnginePrivateFields(engine);
  if (!fields.device || !fields.pickPerFrameBindGroup || !fields.modelInstances) {
    throw new Error("reze-engine 未暴露诊断所需的展开 Face 管线字段。");
  }
  const device = fields.device;
  const perFrameLayout = (fields as unknown as { pickPerFrameBindGroupLayout?: GPUBindGroupLayout }).pickPerFrameBindGroupLayout!;
  const perInstanceLayout = (fields as unknown as { pickPerInstanceBindGroupLayout?: GPUBindGroupLayout }).pickPerInstanceBindGroupLayout!;

  const faceTriCount = Math.floor(src.faceIndexCount / 3);
  const expandedVertCount = faceTriCount * 3;
  const stride32 = 8 + 4 + 4 + 1;
  const interleaved = new ArrayBuffer(expandedVertCount * stride32 * 4);
  const f32 = new Float32Array(interleaved);
  const u32 = new Uint32Array(interleaved);
  for (let t = 0; t < faceTriCount; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const vi = src.indices[src.faceFirstIndex + t * 3 + k];
      const dst = (t * 3 + k) * stride32;
      for (let c = 0; c < 8; c += 1) f32[dst + c] = src.vertices[vi * 8 + c];
      for (let c = 0; c < 4; c += 1) u32[dst + 8 + c] = src.joints[vi * 4 + c];
      for (let c = 0; c < 4; c += 1) f32[dst + 12 + c] = src.weights[vi * 4 + c] / 255;
      u32[dst + 16] = t;
    }
  }

  // CPU 侧蒙皮展开（关键修复）：展开缓冲必须携带蒙皮后的世界坐标，
  // 不能依赖 skinMats uniform。诊断 pass 与生产 pick 之间可能存在引擎内部
  // 状态差（相机 VMD pose、resize 后的投影矩阵），导致同一 CPU 姿态在
  // 两个 pass 中被 GPU 渲染到不同屏幕位置（实测位移 (-24,-39)px）。
  // 改为：调用方先 flushV14dDiagnosticBarrier 把当前 CPU 蒙皮矩阵写回 GPU，
  // 然后本函数在 CPU 侧用同一蒙皮矩阵展开 position（normal/uv/joints/weights
  // 保持原始），GPU 侧只做 MVP 变换（不再做蒙皮），两个诊断 pass 共享同一
  // 已展开的静态几何，彻底消除时序漂移。
  // 说明：调用方必须保证 src.skinMatrices 与当前 GPU skinMatrixBuffer 一致
  //（flushV14dDiagnosticBarrier 已把 getSkinMatrices() 写回 GPU）。
  if (src.skinMatrices) {
    const sm = src.skinMatrices;
    for (let t = 0; t < faceTriCount; t += 1) {
      for (let k = 0; k < 3; k += 1) {
        const vi = src.indices[src.faceFirstIndex + t * 3 + k];
        const dst = (t * 3 + k) * stride32;
        const bx = src.vertices[vi * 8], by = src.vertices[vi * 8 + 1], bz = src.vertices[vi * 8 + 2];
        let wx = 0, wy = 0, wz = 0;
        for (let j = 0; j < 4; j += 1) {
          const bi = u32[dst + 8 + j];
          const w = f32[dst + 12 + j];
          if (w <= 0) continue;
          const o = bi * 16;
          wx += w * (sm[o] * bx + sm[o + 4] * by + sm[o + 8] * bz + sm[o + 12]);
          wy += w * (sm[o + 1] * bx + sm[o + 5] * by + sm[o + 9] * bz + sm[o + 13]);
          wz += w * (sm[o + 2] * bx + sm[o + 6] * by + sm[o + 10] * bz + sm[o + 14]);
        }
        f32[dst] = wx; f32[dst + 1] = wy; f32[dst + 2] = wz;
      }
    }
  }

  const expandedBuffer = device.createBuffer({
    label: "V14D face expanded vertex buffer",
    size: interleaved.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(expandedBuffer, 0, interleaved);

  const expandedLayout = device.createPipelineLayout({ bindGroupLayouts: [perFrameLayout, perInstanceLayout] });
  const expandedModule = device.createShaderModule({ label: "V14D face expanded shader", code: FACE_EXPANDED_WGSL });
  const expandedBuffers: GPUVertexBufferLayout[] = [
    {
      arrayStride: stride32 * 4,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" },
        { shaderLocation: 3, offset: 32, format: "uint32x4" },
        { shaderLocation: 4, offset: 48, format: "float32x4" },
        { shaderLocation: 5, offset: 64, format: "uint32" },
      ],
    },
  ];

  const expandedPipeline = device.createRenderPipeline({
    label: "V14D face expanded pipeline",
    layout: expandedLayout,
    vertex: { module: expandedModule, buffers: expandedBuffers },
    fragment: { module: expandedModule, targets: [{ format: "rgba32float" }] },
    primitive: { cullMode: "none" },
  });

  const target = device.createTexture({ label: "V14D face expanded target", size: [width, height], format: "rgba32float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const rowPitch = alignTo(width * 16, 256);
    const buffer = device.createBuffer({ label: "V14D face expanded readback", size: rowPitch * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    try {
      const encoder = device.createCommandEncoder({ label: "V14D face expanded encoder" });
      const p2 = encoder.beginRenderPass({
        label: "V14D face expanded pass",
        colorAttachments: [{ view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      });
      p2.setPipeline(expandedPipeline);
      p2.setBindGroup(0, fields.pickPerFrameBindGroup);
    for (const instance of fields.modelInstances.values()) {
      if (!instance.model.visible) continue;
      p2.setVertexBuffer(0, expandedBuffer);
      p2.setBindGroup(1, instance.pickPerInstanceBindGroup);
      p2.draw(expandedVertCount, 1, 0, 0);
    }
    p2.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: rowPitch, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const mapped32 = new Float32Array(mapped.slice(0));
    const rowFloats = rowPitch / 4;
    const triId = new Int32Array(width * height).fill(-1);
    const uv = new Float32Array(width * height * 2);
    const faceMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const off = y * rowFloats + x * 4;
        const a = mapped32[off + 3];
        if (a > 0.5) {
          uv[i * 2] = mapped32[off];
          uv[i * 2 + 1] = mapped32[off + 1];
          triId[i] = Math.round(mapped32[off + 2]);
          faceMask[i] = 1;
        }
      }
    }
  return { triId, uv, faceMask, width, height };
  } finally {
      if (buffer.mapState === "mapped") buffer.unmap();
      buffer.destroy();
      target.destroy();
      expandedBuffer.destroy();
    }
  }


// ─────────────────────────────────────────────────────────────────────────────
// Stage 2B-M3 修正轮：任意材质的三角形语义区域（世界坐标分区）。

export type V14dMaterialRegionDef = {
  /** 区域机器名（如 "neck"/"waist"/"leftHand"/"rightHand"）。 */
  id: string;
  /** 世界坐标 y 下限（含），PMX 单位。 */
  yMin: number;
  /** 世界坐标 y 上限（不含），PMX 单位。 */
  yMax: number;
  /**
   * 世界坐标 x 符号约束："any" 不限 / "pos" 仅 x>0（PMX 左手侧）/ "neg" 仅 x<0（PMX 右手侧）。
   * 用于把左右手分开（叉腰姿势下两手 y 带重叠，必须按 x 符号区分）。
   */
  xSide: "any" | "pos" | "neg";
};

/**
 * 计算某材质每个三角形蒙皮后的世界质心（CPU 侧，与 readV14dFaceExpandedTriUv
 * 同一蒙皮公式）。返回逐三角形 [x, y, z]（PMX 单位），供语义区域划分。
 * 三角形顺序 = 该材质 vertexCount/3 的局部序号（与 PMX/Blender polygon 顺序一致）。
 */
export function computeV14dMaterialWorldTriCentroids(src: V14dFaceExpandedSource): Float32Array {
  const triCount = Math.floor(src.faceIndexCount / 3);
  const centroids = new Float32Array(triCount * 3);
  const sm = src.skinMatrices;
  for (let t = 0; t < triCount; t += 1) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k += 1) {
      const vi = src.indices[src.faceFirstIndex + t * 3 + k];
      const bx = src.vertices[vi * 8], by = src.vertices[vi * 8 + 1], bz = src.vertices[vi * 8 + 2];
      let wx = bx, wy = by, wz = bz;
      if (sm) {
        wx = 0; wy = 0; wz = 0;
        for (let j = 0; j < 4; j += 1) {
          const bi = src.joints[vi * 4 + j];
          const w = src.weights[vi * 4 + j] / 255;
          if (w <= 0) continue;
          const o = bi * 16;
          wx += w * (sm[o] * bx + sm[o + 4] * by + sm[o + 8] * bz + sm[o + 12]);
          wy += w * (sm[o + 1] * bx + sm[o + 5] * by + sm[o + 9] * bz + sm[o + 13]);
          wz += w * (sm[o + 2] * bx + sm[o + 6] * by + sm[o + 10] * bz + sm[o + 14]);
        }
      }
      cx += wx; cy += wy; cz += wz;
    }
    centroids[t * 3] = cx / 3;
    centroids[t * 3 + 1] = cy / 3;
    centroids[t * 3 + 2] = cz / 3;
  }
  return centroids;
}

/**
 * 按世界坐标分区规则把逐三角形质心映射为区域标签。
 * 返回与三角形同长的 Int32Array：-1=不属于任何区域，否则 = regionDefs 下标。
 * 区域定义按数组顺序优先匹配（先命中先得），调用方需保证区域不重叠。
 */
export function classifyV14dMaterialRegions(
  centroids: Float32Array,
  regionDefs: readonly V14dMaterialRegionDef[],
): Int32Array {
  const triCount = centroids.length / 3;
  const labels = new Int32Array(triCount).fill(-1);
  for (let t = 0; t < triCount; t += 1) {
    const x = centroids[t * 3], y = centroids[t * 3 + 1];
    for (let r = 0; r < regionDefs.length; r += 1) {
      const d = regionDefs[r];
      if (y < d.yMin || y >= d.yMax) continue;
      if (d.xSide === "pos" && x <= 0) continue;
      if (d.xSide === "neg" && x >= 0) continue;
      labels[t] = r;
      break;
    }
  }
  return labels;
}

/**
 * Stage 2B-M3.1：按顶点主导骨骼的语义区域分类。
 *
 * 对某材质的每个三角形，先求 3 个顶点各自的主导骨骼（蒙皮权重最大的骨骼索引），
 * 再按版本化骨骼集合 boneSets（region id → 骨骼索引数组）把三角形归属到语义区域：
 *   - 三角形归属 = 其 3 顶点主导骨骼投票数最多的区域；
 *   - 3 顶点骨骼都不在任何区域集合 → 标签 -1（unassigned）。
 *
 * 与 classifyV14dMaterialRegions（世界 y 带 + x 符号）的区别：本函数不依赖世界坐标，
 * 按骨骼语义分区，几何/姿态变化下区域归属稳定（骨骼是解剖语义单位）。
 *
 * @param joints 每顶点 4 骨骼索引（Uint16Array，joints[v*4+j]）
 * @param weights 每顶点 4 骨骼权重（Uint8Array，weights[v*4+j]，0..255）
 * @param indices 三角形索引缓冲（Uint32Array）
 * @param firstIndex 该材质在 indices 中的起始偏移
 * @param indexCount 该材质的索引数（= 三角形数 × 3）
 * @param regionOrder 区域 id 数组（输出标签 = 该数组下标，-1=未分区）
 * @param boneSets 与 regionOrder 对应的骨骼索引数组（每区域一组）
 * @returns 与三角形数同长的 Int32Array 标签
 */
export function classifyV14dVerticesByBoneRegion(
  joints: Uint16Array,
  weights: Uint8Array,
  indices: Uint32Array,
  firstIndex: number,
  indexCount: number,
  regionOrder: readonly string[],
  boneSets: readonly (readonly number[])[],
  boneSetsOverride?: readonly (readonly number[])[],
): Int32Array {
  // Stage 2B-M3.1 修正轮：可选扰动集合（仅诊断/负测用，如左右手交换/腰腹注入/错骨序）。
  // 提供时用它代替 boneSets 参与归属；生产路径省略本参数，行为与权威集合完全一致（零改动）。
  const sets = boneSetsOverride ?? boneSets;
  const triCount = Math.floor(indexCount / 3);
  const labels = new Int32Array(triCount).fill(-1);
  // 骨骼索引 → 区域下标 的查找表（骨骼总数上限 4096，足够 PMX 449 骨骼）。
  const boneToRegion = new Int32Array(4096).fill(-1);
  for (let r = 0; r < sets.length; r += 1) {
    for (const b of sets[r]) {
      if (b >= 0 && b < 4096) boneToRegion[b] = r;
    }
  }
  for (let t = 0; t < triCount; t += 1) {
    const votes = new Int32Array(regionOrder.length);
    for (let k = 0; k < 3; k += 1) {
      const vi = indices[firstIndex + t * 3 + k];
      // 主导骨骼 = 权重最大的骨骼索引。
      let bestBone = -1;
      let bestW = -1;
      for (let j = 0; j < 4; j += 1) {
        const w = weights[vi * 4 + j];
        if (w > bestW) {
          bestW = w;
          bestBone = joints[vi * 4 + j];
        }
      }
      const region = bestBone >= 0 && bestBone < 4096 ? boneToRegion[bestBone] : -1;
      if (region >= 0) votes[region] += 1;
    }
    let best = -1;
    let bestVotes = 0;
    for (let r = 0; r < regionOrder.length; r += 1) {
      if (votes[r] > bestVotes) {
        bestVotes = votes[r];
        best = r;
      }
    }
    labels[t] = best;
  }
  return labels;
}


export async function readV14dCanvasDisplay(canvas: HTMLCanvasElement): Promise<V14dNormalizedImage> {
  const width = canvas.width || V14D_COLOR_BASELINE_WIDTH;
  const height = canvas.height || V14D_COLOR_BASELINE_HEIGHT;
  const dataUrl = canvas.toDataURL("image/png");
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("无法把 WebGPU canvas 转换为 Final Display 像素。"));
    element.src = dataUrl;
  });
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不支持 Final Display 2D readback。");
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const data = new Float32Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 1) data[index] = rgba[index] / 255;
  return { width, height, data, colorSpace: "srgb" };
}

function pointInPolygon(x: number, y: number, polygon: readonly [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function getRoiPixelBounds(
  roi: V14dColorBaselineRoi,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (roi.screen.bounds) {
    const [x, y, w, h] = roi.screen.bounds;
    return {
      minX: Math.max(0, Math.floor(x * width)),
      minY: Math.max(0, Math.floor(y * height)),
      maxX: Math.min(width - 1, Math.ceil((x + w) * width) - 1),
      maxY: Math.min(height - 1, Math.ceil((y + h) * height) - 1),
    };
  }
  if (roi.screen.polygon?.length) {
    const xs = roi.screen.polygon.map(([x]) => x);
    const ys = roi.screen.polygon.map(([, y]) => y);
    return {
      minX: Math.max(0, Math.floor(Math.min(...xs) * width)),
      minY: Math.max(0, Math.floor(Math.min(...ys) * height)),
      maxX: Math.min(width - 1, Math.ceil(Math.max(...xs) * width) - 1),
      maxY: Math.min(height - 1, Math.ceil(Math.max(...ys) * height) - 1),
    };
  }
  return null;
}

function pixelIsInRoi(
  roi: V14dColorBaselineRoi,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const nx = (x + 0.5) / width;
  const ny = (y + 0.5) / height;
  if (roi.screen.bounds) {
    const [bx, by, bw, bh] = roi.screen.bounds;
    const erosionX = roi.edgeErosionPx / width;
    const erosionY = roi.edgeErosionPx / height;
    return nx >= bx + erosionX && nx <= bx + bw - erosionX && ny >= by + erosionY && ny <= by + bh - erosionY;
  }
  return roi.screen.polygon ? pointInPolygon(nx, ny, roi.screen.polygon) : false;
}

function createUnmeasuredMetric(
  status: V14dRoiLevelMetric["status"],
  note: string,
): V14dRoiLevelMetric {
  return {
    status,
    sampleCount: 0,
    validSampleCount: 0,
    validRate: 0,
    linearRgbMeanErrorPercent: null,
    linearRgbChannelErrorPercent: { r: null, g: null, b: null },
    finalDisplayDeltaE2000: { mean: null, p95: null },
    notes: [note],
  };
}

function compareRoiLevel(
  roi: V14dColorBaselineRoi,
  level: V14dColorBaselineLevel,
  image: V14dNormalizedImage | null,
  mask: Uint8Array | null,
  materialMask: Uint8Array | null,
  materialId: number | null,
  referenceSrgb: [number, number, number] | undefined,
  sceneValid: boolean,
): V14dRoiLevelMetric {
  if (!sceneValid) return createUnmeasuredMetric("scene-mismatch", "白光场景校验未通过，数值不得作为 Gate B 证据。");
  if (roi.calibrationStatus !== "ready" || !getRoiPixelBounds(roi, image?.width ?? 0, image?.height ?? 0)) {
    return createUnmeasuredMetric("pending-calibration", "ROI 尚未提供经过真实 1280×720 画面校准的屏幕坐标。");
  }
  if (!image || !mask || !materialMask || materialId === null) {
    return createUnmeasuredMetric("unmeasured", "缺少该级别图像、模型覆盖 mask 或目标材质 ID readback。");
  }
  if (!referenceSrgb) return createUnmeasuredMetric("unmeasured", "缺少 Blender/PMX 对应参考颜色，未计算误差。");

  const bounds = getRoiPixelBounds(roi, image.width, image.height);
  if (!bounds) return createUnmeasuredMetric("pending-calibration", "ROI 坐标为空。");
  const expectedLinear = srgbToLinearRgb(referenceSrgb);
  const deltaEs: number[] = [];
  let sampleCount = 0;
  let validSampleCount = 0;
  const actualLinearSum = [0, 0, 0];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!pixelIsInRoi(roi, x, y, image.width, image.height)) continue;
      sampleCount += 1;
      const maskAlpha = mask[(y * image.width + x) * 4 + 1] / 255;
      if (maskAlpha < roi.backgroundExclusion.threshold) continue;
      const offset = (y * image.width + x) * 4;
      const materialMaskModelId = materialMask[offset];
      const materialMaskMaterialId = materialMask[offset + 1];
      if (materialMaskModelId === 0 || materialMaskMaterialId !== materialId) continue;
      const actualSrgb: [number, number, number] = [
        image.colorSpace === "srgb" ? image.data[offset] : linearToSrgb(image.data[offset]),
        image.colorSpace === "srgb" ? image.data[offset + 1] : linearToSrgb(image.data[offset + 1]),
        image.colorSpace === "srgb" ? image.data[offset + 2] : linearToSrgb(image.data[offset + 2]),
      ];
      const actualLinear = image.colorSpace === "srgb"
        ? srgbToLinearRgb(actualSrgb)
        : [image.data[offset], image.data[offset + 1], image.data[offset + 2]] as [number, number, number];
      validSampleCount += 1;
      actualLinearSum[0] += actualLinear[0];
      actualLinearSum[1] += actualLinear[1];
      actualLinearSum[2] += actualLinear[2];
      if (level === "finalDisplay") deltaEs.push(deltaE2000(srgbToLab(actualSrgb), srgbToLab(referenceSrgb)));
    }
  }
  if (validSampleCount < roi.minValidPixels) {
    return {
      ...createUnmeasuredMetric(
        "insufficient-pixels",
        `有效像素 ${validSampleCount} 少于最小要求 ${roi.minValidPixels}；已同时按模型覆盖 alpha、材质 ID 和深度可见性排除背景及其他材质。`,
      ),
      sampleCount,
      validSampleCount,
      validRate: sampleCount ? validSampleCount / sampleCount : 0,
    };
  }
  const actualLinearMean = actualLinearSum.map((value) => value / validSampleCount);
  // Stage 1 修复：BaseColor 级改为"ROI 均值对参考均值"的偏差（bias）口径。
  // 原实现用 mean|逐像素 - 单一常数参考|，把纹理自身的空间方差计入了"误差"，
  // 导致头发/胸口等纹理多变的 ROI 必然高达 13-27%，而颜色均匀的左袖只有 5%。
  // 这里改为 |mean(actual) - expected|，只衡量真实采样偏差，纹理方差单独以诊断形式记录。
  const channels = actualLinearMean.map((value, index) => Math.abs(value - expectedLinear[index]) * 100);
  return {
    status: "measured",
    sampleCount,
    validSampleCount,
    validRate: sampleCount ? validSampleCount / sampleCount : 0,
    linearRgbMeanErrorPercent: (channels[0] + channels[1] + channels[2]) / 3,
    linearRgbChannelErrorPercent: { r: channels[0], g: channels[1], b: channels[2] },
    finalDisplayDeltaE2000: {
      mean: deltaEs.length ? deltaEs.reduce((sum, value) => sum + value, 0) / deltaEs.length : null,
      p95: deltaEs.length ? percentile95(deltaEs) : null,
    },
    notes: [
      "有效像素同时满足模型覆盖 alpha、目标材质 ID 与 depth24plus 前景可见性；Linear RGB 误差按 ROI 均值的绝对线性通道差 × 100 计算（偏差口径，纹理空间方差不计入）。",
      `诊断 actualLinearMean=${actualLinearMean.map((v) => v.toFixed(4)).join(",")} expectedLinear=${expectedLinear.map((v) => v.toFixed(4)).join(",")} imageColorSpace=${image.colorSpace}`,
      "当前没有正式 Gate 阈值。",
    ],
  };
}

export function analyzeV14dColorBaselineRois({
  rois = V14D_COLOR_BASELINE_ROIS,
  readback,
  materialIdByName,
  scene,
}: {
  rois?: readonly V14dColorBaselineRoi[];
  readback: {
    baseColor: V14dNormalizedImage | null;
    linearHdr: V14dNormalizedImage | null;
    finalDisplay: V14dNormalizedImage | null;
    mask: Uint8Array | null;
    materialMask: Uint8Array | null;
  };
  materialIdByName: Readonly<Record<string, number>>;
  scene: V14dSceneValidation;
}): {
  rois: V14dColorBaselineRoiResult[];
  firstDivergence: V14dFirstDivergence;
} {
  const results = rois.map((roi) => ({
    roiId: roi.id,
    material: roi.material,
    materialId: materialIdByName[roi.material.web] ?? null,
    levels: {
      baseColor: compareRoiLevel(
        roi,
        "baseColor",
        readback.baseColor,
        readback.mask,
        readback.materialMask,
        materialIdByName[roi.material.web] ?? null,
        roi.reference?.baseColorSrgb,
        scene.valid,
      ),
      linearHdr: compareRoiLevel(
        roi,
        "linearHdr",
        readback.linearHdr,
        readback.mask,
        readback.materialMask,
        materialIdByName[roi.material.web] ?? null,
        roi.reference?.linearHdrSrgb,
        scene.valid,
      ),
      finalDisplay: compareRoiLevel(
        roi,
        "finalDisplay",
        readback.finalDisplay,
        readback.mask,
        readback.materialMask,
        materialIdByName[roi.material.web] ?? null,
        roi.reference?.finalDisplaySrgb,
        scene.valid,
      ),
    },
  }));
  const levels: readonly V14dColorBaselineLevel[] = ["baseColor", "linearHdr", "finalDisplay"];
  for (const level of levels) {
    const measured = results.some((result) => {
      const metric = result.levels[level];
      return metric.status === "measured" && (metric.linearRgbMeanErrorPercent ?? 0) > V14D_COLOR_BASELINE_EPSILON;
    });
    if (measured) {
      return {
        rois: results,
        firstDivergence: {
          status: "observed",
          level,
          reason: `在 ${level} 级至少一个 ROI 的线性 RGB 误差超过诊断 epsilon；这不是正式 Gate 阈值。`,
        },
      };
    }
  }
  const hasMeasured = results.some((result) =>
    levels.some((level) => result.levels[level].status === "measured"),
  );
  return {
    rois: results,
    firstDivergence: hasMeasured
      ? { status: "not-observed", level: null, reason: "已测 ROI 未观察到超过诊断 epsilon 的误差。" }
      : { status: "not-proven", level: null, reason: "没有可用的已校准 ROI 与参考颜色，无法证明首次分歧位置。" },
  };
}

export function createV14dColorBaselineResult(
  patch: Partial<V14dColorBaselineResult> & Pick<V14dColorBaselineResult, "status" | "scene" | "input" | "readback">,
): V14dColorBaselineResult {
  return {
    schemaVersion: 1,
    status: patch.status,
    scene: patch.scene,
    input: patch.input,
    readback: patch.readback,
    rois: patch.rois ?? [],
    firstDivergenceStatus: patch.firstDivergenceStatus ?? "not-proven",
    firstDivergenceLevel: patch.firstDivergenceLevel ?? null,
    firstDivergenceReason: patch.firstDivergenceReason ?? "尚未执行 ROI 数值分析。",
    thresholds: {
      formal: null,
      note: "本票没有正式阈值；任何候选 epsilon 只用于标记诊断分歧，不代表 Gate 通过/失败。",
    },
    ...(patch.error ? { error: patch.error } : {}),
  };
}

export function makeV14dLinearImage(
  width: number,
  height: number,
  data: Float32Array,
): V14dNormalizedImage {
  return { width, height, data, colorSpace: "linear" };
}

/**
 * 临时诊断探针：计算每个 ROI 内 Web unlit BaseColor 的实际均值（sRGB 与 linear），
 * 只用于根因取证，不进入正式 Gate 判定。
 */
export function measureV14dRoiActualMeans({
  rois = V14D_COLOR_BASELINE_ROIS,
  image,
  mask,
  materialMask,
  materialIdByName,
}: {
  rois?: readonly V14dColorBaselineRoi[];
  image: V14dNormalizedImage | null;
  mask: Uint8Array | null;
  materialMask: Uint8Array | null;
  materialIdByName: Readonly<Record<string, number>>;
}): Record<string, { srgb: number[]; linear: number[]; n: number } | null> {
  const out: Record<string, { srgb: number[]; linear: number[]; n: number } | null> = {};
  for (const roi of rois) {
    out[roi.id] = null;
    if (!image || !mask || !materialMask) continue;
    const materialId = materialIdByName[roi.material.web];
    if (materialId == null) continue;
    const bounds = getRoiPixelBounds(roi, image.width, image.height);
    if (!bounds) continue;
    let n = 0;
    const linSum = [0, 0, 0];
    const srgbSum = [0, 0, 0];
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (!pixelIsInRoi(roi, x, y, image.width, image.height)) continue;
        const offset = (y * image.width + x) * 4;
        if (mask[offset + 1] / 255 < roi.backgroundExclusion.threshold) continue;
        if (materialMask[offset] === 0 || materialMask[offset + 1] !== materialId) continue;
        const lin: [number, number, number] =
          image.colorSpace === "srgb"
            ? srgbToLinearRgb([image.data[offset], image.data[offset + 1], image.data[offset + 2]])
            : [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
        const srgb: [number, number, number] =
          image.colorSpace === "srgb"
            ? [image.data[offset], image.data[offset + 1], image.data[offset + 2]]
            : [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];
        for (let c = 0; c < 3; c += 1) {
          linSum[c] += lin[c];
          srgbSum[c] += srgb[c];
        }
        n += 1;
      }
    }
    if (n > 0) {
      out[roi.id] = {
        srgb: srgbSum.map((v) => v / n),
        linear: linSum.map((v) => v / n),
        n,
      };
    }
  }
  return out;
}
