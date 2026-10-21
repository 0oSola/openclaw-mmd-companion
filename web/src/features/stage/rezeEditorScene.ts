import {
  REZE_GRADE_PRESETS,
  type RezeGradePreset,
  type RezeSceneDebugSettings,
} from "./rezeDesignDefaults";

export const REZE_EDITOR_DOCUMENT_VERSION = 1 as const;

export const REZE_EXECUTABLE_MATERIAL_PRESETS = [
  "默认",
  "角色皮肤",
  "面部",
  "眼睛",
  "头发",
  "柔滑布料",
  "金属",
  "半透材质",
] as const;

export { REZE_GRADE_PRESETS, type RezeGradePreset } from "./rezeDesignDefaults";
export { REZE_BACKGROUND_EFFECTS, type RezeBackgroundEffect } from "./rezeDesignDefaults";
import type { RezeBackgroundEffect } from "./rezeDesignDefaults";

export type RezeExecutableMaterialPreset = (typeof REZE_EXECUTABLE_MATERIAL_PRESETS)[number];

export type RezeStageSceneSettings = RezeSceneDebugSettings;

export type RezeStageDocument = {
  version: typeof REZE_EDITOR_DOCUMENT_VERSION;
  name: string;
  updatedAt: string;
  scene: RezeStageSceneSettings;
  materialPresets: Record<string, RezeExecutableMaterialPreset>;
  grade: RezeGradePreset;
  gradeIntensity: number;
  backgroundEffect: RezeBackgroundEffect;
};

export function createDefaultRezeStageDocument(scene: RezeStageSceneSettings): RezeStageDocument {
  return {
    version: REZE_EDITOR_DOCUMENT_VERSION,
    name: "My first scene",
    updatedAt: new Date().toISOString(),
    scene,
    materialPresets: {},
    grade: "中性",
    gradeIntensity: 1,
    backgroundEffect: "Shining Stars",
  };
}

export function normalizeRezeStageDocument(
  value: unknown,
  fallbackScene: RezeStageSceneSettings,
): RezeStageDocument {
  if (!value || typeof value !== "object") return createDefaultRezeStageDocument(fallbackScene);
  const candidate = value as Partial<RezeStageDocument>;
  const scene = candidate.scene && typeof candidate.scene === "object"
    ? { ...fallbackScene, ...candidate.scene }
    : fallbackScene;
  const materialPresets = Object.fromEntries(
    Object.entries(candidate.materialPresets ?? {}).filter((entry): entry is [string, RezeExecutableMaterialPreset] =>
      REZE_EXECUTABLE_MATERIAL_PRESETS.includes(entry[1] as RezeExecutableMaterialPreset),
    ),
  );
  return {
    version: REZE_EDITOR_DOCUMENT_VERSION,
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.slice(0, 60) : "My first scene",
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
    scene,
    materialPresets,
    grade: REZE_GRADE_PRESETS.includes(candidate.grade as RezeGradePreset) ? candidate.grade as RezeGradePreset : "中性",
    gradeIntensity: typeof candidate.gradeIntensity === "number" && Number.isFinite(candidate.gradeIntensity)
      ? Math.max(0, Math.min(1, candidate.gradeIntensity))
      : 1,
    backgroundEffect: candidate.backgroundEffect === "关闭" ? "关闭" : "Shining Stars",
  };
}

export function rezeEditorStorageKey(userId: string, modelPath: string, pipeline: string): string {
  return `mmd_reze_editor_scene_v${REZE_EDITOR_DOCUMENT_VERSION}:${userId}:${pipeline || "reze-design"}:${modelPath || "default"}`;
}
