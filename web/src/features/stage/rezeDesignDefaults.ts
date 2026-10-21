/**
 * Reze Design 的场景契约。
 *
 * 数值与字段范围对齐参考工程的 bundled default scene；这里仅保存可执行的
 * 场景数据，不依赖或复制其 AGPL 编辑器实现。
 */
export type RezeSceneDebugSettings = {
  sunAzimuth: number;
  sunElevation: number;
  keyIntensity: number;
  ambientIntensity: number;
  bloomThreshold: number;
  bloomKnee: number;
  bloomRadius: number;
  bloomStrength: number;
  cameraDistance: number;
  cameraTargetX: number;
  cameraTargetY: number;
  cameraTargetZ: number;
  sunColor: string;
  worldColor: string;
  bloomColor: string;
  backgroundColor: string;
  groundColor: string;
  groundSize: number;
  groundOpacity: number;
  groundShadow: boolean;
  groundGridColor: string;
  groundGridEnabled: boolean;
};

export const REZE_DESIGN_SCENE_DEFAULTS: RezeSceneDebugSettings = {
  sunAzimuth: 205,
  sunElevation: 21,
  keyIntensity: 2.0,
  ambientIntensity: 0.66,
  bloomThreshold: 0.5,
  bloomKnee: 0.5,
  bloomRadius: 4.0,
  bloomStrength: 0.05,
  cameraDistance: 26.2,
  cameraTargetX: 0,
  cameraTargetY: 11.4,
  cameraTargetZ: 0,
  sunColor: "#ffffff",
  worldColor: "#ed6aff",
  bloomColor: "#ffc9c9",
  backgroundColor: "#4b004f",
  groundColor: "#c800de",
  groundSize: 160,
  groundOpacity: 0.42,
  groundShadow: true,
  groundGridColor: "#fafaf9",
  groundGridEnabled: true,
};

/**
 * Reze K3 的默认场景（来自 MMD_stage/ak-12.json 的 scene 字段）。
 *
 * 与 reze-design 的紫调舞台不同：k3 复刻走明亮的中性光（白主光/白世界光/白地面），
 * 相机更近、目标点更高，画布透明后由页面 MIO CSS 背景透出。
 */
export const REZE_K3_SCENE_DEFAULTS: RezeSceneDebugSettings = {
  sunAzimuth: 10,
  sunElevation: 55,
  keyIntensity: 1.07,
  ambientIntensity: 0.73,
  bloomThreshold: 0.67,
  bloomKnee: 0.55,
  bloomRadius: 0.7,
  bloomStrength: 0.03,
  cameraDistance: 21.2,
  cameraTargetX: -2.1,
  cameraTargetY: 12.3,
  cameraTargetZ: 2.2,
  sunColor: "#ffffff",
  worldColor: "#ffffff",
  bloomColor: "#ff9e9e",
  backgroundColor: "#ffffff",
  groundColor: "#ffffff",
  groundSize: 141,
  groundOpacity: 0.19,
  groundShadow: true,
  groundGridColor: "#fafaf9",
  groundGridEnabled: true,
};

/** 新写的、与参考效果语义兼容的星空背景标识。 */
export const REZE_BACKGROUND_EFFECTS = ["Shining Stars", "关闭"] as const;
export type RezeBackgroundEffect = (typeof REZE_BACKGROUND_EFFECTS)[number];

type RezeGradeRange = readonly [number, number] | readonly [number, number, number];
type RezeGradeSpec = {
  shadows: RezeGradeRange;
  midtones: RezeGradeRange;
  highlights: RezeGradeRange;
  contrast: number;
  saturation: number;
};

/**
 * 参考工程 content/grades.json 的内置调色；名称翻译只发生在 UI，数值保持一致。
 */
export const REZE_GRADE_PRESETS = ["中性", "血色", "赛博朋克", "神圣", "月光", "樱色"] as const;
export type RezeGradePreset = (typeof REZE_GRADE_PRESETS)[number];

const REZE_GRADE_SPECS: Record<RezeGradePreset, RezeGradeSpec> = {
  "中性": { shadows: [0, 0], midtones: [0, 0], highlights: [0, 0], contrast: 1, saturation: 1 },
  "血色": { shadows: [358, 0.55, 0.36], midtones: [356, 0.3, 0.4], highlights: [2, 0.5, 0.545], contrast: 1.45, saturation: 0.75 },
  "赛博朋克": { shadows: [184, 0.36, 0.41], midtones: [312, 0.15, 0.39], highlights: [328, 0.3, 0.47], contrast: 1.42, saturation: 1.5 },
  "神圣": { shadows: [30, 0.15, 0.38], midtones: [60, 0.55, 0.38], highlights: [0, 0.18, 0.63], contrast: 1.15, saturation: 1.9 },
  "月光": { shadows: [214, 0.59, 0.46], midtones: [239, 0.42, 0.38], highlights: [206, 0.49, 0.4], contrast: 0.95, saturation: 0.5 },
  "樱色": { shadows: [305, 0.12], midtones: [345, 0.09], highlights: [352, 0.18], contrast: 0.96, saturation: 1.08 },
};

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const key = (offset + hue / 30) % 12;
    const value = lightness - chroma * Math.max(-1, Math.min(key - 3, 9 - key, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function resolveRange(range: RezeGradeRange, intensity: number): string {
  const [hue, saturation, lightness = 0.5] = range;
  return hslToHex(hue, saturation * intensity, 0.5 + (lightness - 0.5) * intensity);
}

/** 把预设与 0–1 强度解析成 reze-engine 所需的 ASC CDL 调色参数。 */
export function resolveRezeGrade(preset: RezeGradePreset, intensity: number) {
  const spec = REZE_GRADE_SPECS[preset] ?? REZE_GRADE_SPECS["中性"];
  const factor = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 1));
  return {
    shadows: resolveRange(spec.shadows, factor),
    midtones: resolveRange(spec.midtones, factor),
    highlights: resolveRange(spec.highlights, factor),
    contrast: Math.max(0, 1 + (spec.contrast - 1) * factor),
    saturation: Math.max(0, 1 + (spec.saturation - 1) * factor),
  };
}

/**
 * 独立实现的 Reze 风格 Shining Stars 背景。星点使用相机射线映射，因而转动
 * 相机时星空相对画面移动；alpha 保持在星点上，底色由 scene.backgroundColor 提供。
 */
export const REZE_SHINING_STARS_WGSL = `
const STAR_TINT = vec3f(1.0, 0.96, 0.88);

fn rezeStarHash(p: vec2f) -> vec2f {
  return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453);
}

fn rezeStarLayer(p: vec2f, scale: f32, cutoff: f32, time: f32) -> f32 {
  let cell = floor(p * scale);
  let h = rezeStarHash(cell);
  if (h.x < cutoff) { return 0.0; }
  let local = fract(p * scale) - (0.18 + 0.64 * h);
  let distanceToStar = length(local);
  let phase = 0.55 + 0.45 * sin(time * (0.65 + h.y * 2.3) + h.x * 32.0);
  let radius = 0.026 + 0.045 * h.y;
  let core = smoothstep(radius, radius * 0.22, distanceToStar);
  let halo = smoothstep(radius * 4.0, radius, distanceToStar) * 0.18;
  return (core + halo) * phase;
}

fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  let direction = normalize(ray);
  let sphereUv = vec2f(atan2(direction.x, direction.z) * 1.2, asin(clamp(direction.y, -1.0, 1.0)) * 1.5);
  var stars = rezeStarLayer(sphereUv, 30.0, 0.86, time);
  stars += 0.36 * rezeStarLayer(sphereUv + vec2f(3.7, 3.7), 70.0, 0.94, time * 0.72);
  return vec4f(STAR_TINT, clamp(stars * 1.2, 0.0, 1.0));
}
`;
