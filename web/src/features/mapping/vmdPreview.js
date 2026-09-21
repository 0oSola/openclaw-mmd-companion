import { DEFAULT_VMD_PLAYBACK_RATE } from "../stage/builtInMotionPreferences.js";

const IDLE_ANIMATIONS_PACK_PLAYBACK_RATE = 2.5;
const ENTRY_STANDBY_HINTS = ["\u8fdb\u573a\u5f85\u673a", "\u6769\u6d98\u6e80\u5bf0\u546e\u6e80", "entry idle"];
const ENTRY_GREETING_FILENAMES = ["\u6253\u62db\u547c1.vmd", "\u817c\u8146\u6253\u62db\u547c.vmd", "\u884c\u793c1.vmd"];
export const VMD_MOTION_CATEGORIES = Object.freeze({
  IDLE_LOOP: "00_idle_loop",
  ENTRY_FALLBACK: "01_entry_fallback",
  GREETING_SOCIAL: "02_greeting_social",
  THINKING_WAITING: "03_thinking_waiting",
  ANSWERING_EXPLAIN: "04_answering_explain",
  SOFT_EMOTION: "05_soft_emotion",
  STRONG_PERSONALITY: "06_strong_personality",
});
export const IDLE_LOOP_VMD_CATEGORIES = Object.freeze([VMD_MOTION_CATEGORIES.IDLE_LOOP]);
export const CLICK_REACTION_VMD_CATEGORIES = Object.freeze([
  VMD_MOTION_CATEGORIES.GREETING_SOCIAL,
  VMD_MOTION_CATEGORIES.SOFT_EMOTION,
  VMD_MOTION_CATEGORIES.STRONG_PERSONALITY,
]);
export const CLICK_FALLBACK_EXCLUDED_VMD_CATEGORIES = Object.freeze([
  VMD_MOTION_CATEGORIES.IDLE_LOOP,
  VMD_MOTION_CATEGORIES.ENTRY_FALLBACK,
]);
const UNIVERSAL_FAVORITE_PREFIX = "usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/";
const UNIVERSAL_BUILTIN_PREFIX = "usage/vmd/_builtin/";

function describeVmdAsset(asset) {
  return [asset?.source_relative_path, asset?.filename, asset?.display_name, asset?.url]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function describeAssetName(asset) {
  return [asset?.display_name, asset?.filename].filter(Boolean).join(" ").toLowerCase();
}

function normalizeAssetFilename(asset) {
  const name = asset?.filename || asset?.display_name || "";
  return name.trim().toLowerCase();
}

function pickRandomItem(items, randomValue = Math.random()) {
  if (!items.length) return null;
  const clamped = Math.min(0.999999, Math.max(0, Number(randomValue) || 0));
  return items[Math.floor(clamped * items.length)] || items[0] || null;
}

function describeVmdAssetPath(asset) {
  return [asset?.favorite_relative_path, asset?.source_relative_path, asset?.relative_path]
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .toLowerCase();
}

export function getVmdAssetCategory(asset) {
  const text = describeVmdAssetPath(asset);
  if (!text) return "";
  return (
    Object.values(VMD_MOTION_CATEGORIES).find(
      (category) => text.includes(`/${category.toLowerCase()}/`) || text.includes(`${category.toLowerCase()}/`),
    ) || ""
  );
}

export function isVmdAssetInCategory(asset, categories = []) {
  const category = getVmdAssetCategory(asset);
  return Boolean(category && new Set(categories).has(category));
}

export function filterVmdAssetsByCategories(assets = [], categories = []) {
  if (!Array.isArray(assets) || !categories?.length) return [];
  const categorySet = new Set(categories);
  return assets.filter((asset) => {
    const category = getVmdAssetCategory(asset);
    return category && categorySet.has(category);
  });
}

export function isEntryStandbyAsset(asset) {
  const text = describeAssetName(asset);
  return ENTRY_STANDBY_HINTS.some((hint) => text.includes(hint));
}

export function excludeEntryStandbyAssets(assets = []) {
  return Array.isArray(assets) ? assets.filter((asset) => !isEntryStandbyAsset(asset)) : [];
}

export function isCompanionSafeVmdAsset(asset) {
  const profile = asset?.motion_profile;
  if (!profile) return true;
  return profile.companion_safe !== false;
}

/**
 * 64 字节的 VMD 只包含文件头与空轨道计数，既没有骨骼帧也没有形态帧。
 * reze-engine 对这种零时长剪辑不会触发结束事件，因此不能把它当作可播放动作。
 */
export function isEmptyVmdAsset(asset) {
  return Number(asset?.size_bytes) > 0 && Number(asset.size_bytes) <= 64;
}

export function excludeCompanionUnsafeAssets(assets = []) {
  return Array.isArray(assets)
    ? assets.filter((asset) => isCompanionSafeVmdAsset(asset) && !isEmptyVmdAsset(asset))
    : [];
}

const MODEL_FAVORITE_FOLDER_SUFFIX = "[动作]";
const BUILTIN_VMD_FOLDER = "_builtin";

/**
 * 取当前模型自己的收藏目录名：`<模型目录名>[动作]`。
 *
 * 收藏按模型归属存放，每个模型写在自己的目录里，互不继承。
 * 模型位于 MMD 根目录（没有父目录）时退化为用文件名主体命名。
 */
export function modelFavoriteFolderName(modelRelativePath) {
  const path = String(modelRelativePath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return "";
  const parent = parts.length >= 2 ? parts[parts.length - 2] : parts[0].replace(/\.[^.]*$/, "");
  return `${parent}${MODEL_FAVORITE_FOLDER_SUFFIX}`.toLowerCase();
}

/** 收藏动作所在目录名（第三段，小写）。 */
export function favoriteAssetFolderName(asset) {
  const path = describeVmdAssetPath(asset);
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 3 ? parts[2] : "";
}

export function normalizeModelRelativePath(modelRelativePath) {
  return String(modelRelativePath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .normalize("NFC");
}

export function isFavoriteForModel(asset, modelRelativePath = "") {
  const model = normalizeModelRelativePath(modelRelativePath);
  if (!asset || !model) return false;
  const paths = Array.isArray(asset.favorite_model_paths)
    ? asset.favorite_model_paths.map(normalizeModelRelativePath).filter(Boolean)
    : [];
  if (paths.length) return paths.includes(model);
  const single = normalizeModelRelativePath(asset.favorite_model_relative_path);
  return Boolean(single && single === model);
}

export function isModelOwnedFavoriteMotionAsset(asset, modelRelativePath = "") {
  if (modelRelativePath) return isFavoriteForModel(asset, modelRelativePath);
  if (!asset) return false;
  if (Array.isArray(asset.favorite_model_paths) && asset.favorite_model_paths.some((path) => normalizeModelRelativePath(path))) {
    return true;
  }
  return Boolean(normalizeModelRelativePath(asset.favorite_model_relative_path));
}

export function selectModelFavoriteVmdAssets(assets = [], modelRelativePath = "") {
  return (Array.isArray(assets) ? assets : []).filter((asset) => isFavoriteForModel(asset, modelRelativePath));
}

export function isUniversalBuiltInMotionAsset(asset) {
  return describeVmdAssetPath(asset).startsWith(UNIVERSAL_BUILTIN_PREFIX.toLowerCase());
}

export function mergeFavoriteMotionAssets(primaryAssets = [], sharedAssets = []) {
  const merged = [];
  const seenIds = new Set();
  for (const asset of [...(Array.isArray(primaryAssets) ? primaryAssets : []), ...(Array.isArray(sharedAssets) ? sharedAssets : [])]) {
    const assetId = String(asset?.asset_id || asset?.url || "");
    if (!assetId || seenIds.has(assetId)) continue;
    seenIds.add(assetId);
    merged.push(asset);
  }
  return merged;
}

function getPlayableVmdAssets(assets = []) {
  return excludeCompanionUnsafeAssets(Array.isArray(assets) ? assets : []).filter((asset) => asset?.url);
}

export function selectUserFavoriteVmdAssets(assets = [], userId = "") {
  return userId ? assets.filter(asset => asset.is_favorite && asset.user_id === userId) : [];
}

function getNonemptyVmdAssets(assets = []) {
  return (Array.isArray(assets) ? assets : []).filter(asset => asset?.url && !isEmptyVmdAsset(asset));
}

function selectCategorizedIdleVmdAssets(assets = []) {
  return getPlayableVmdAssets(filterVmdAssetsByCategories(assets, IDLE_LOOP_VMD_CATEGORIES));
}

function selectSafeStandbyFallbackAssets(assets = []) {
  return getPlayableVmdAssets(excludeEntryStandbyAssets(assets));
}

export function selectAutoplayIdleVmdAssets(assets = []) {
  const categorizedIdleAssets = selectCategorizedIdleVmdAssets(assets);
  if (categorizedIdleAssets.length) return categorizedIdleAssets;
  return selectSafeStandbyFallbackAssets(assets);
}

/**
 * 收藏直接进入随机待机，不按分类或腿部幅度筛选；无有效收藏才使用内置兜底。
 * 前两个参数由调用方提供已收藏集合，第三个参数只用于内置兜底。
 */
export function resolveAutoplayVmdAssetPool(
  currentModelAssets = [],
  eulaFavoriteAssets = [],
  sharedIdleAssets = [],
  { includeEulaFavorites = false } = {},
) {
  const sharedAssets = includeEulaFavorites ? eulaFavoriteAssets : [];
  const favorites = getNonemptyVmdAssets(mergeFavoriteMotionAssets(currentModelAssets, sharedAssets));
  return favorites.length ? favorites : selectAutoplayIdleVmdAssets(sharedIdleAssets);
}

export function selectIdleFallbackVmdAsset(assets = [], { randomValue = Math.random() } = {}) {
  return pickRandomItem(getNonemptyVmdAssets(assets), randomValue);
}

export function getCompanionVmdPlaybackGuards(asset) {
  if (isCompanionSafeVmdAsset(asset)) return {};
  return {
    lockLowerBody: true,
    disableCrossfade: true,
  };
}

function clampPlaybackMultiplier(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(4, Math.max(0.1, numeric));
}

function normalizePlaybackRate(value) {
  return Math.round(value * 1000) / 1000;
}

export function resolveVmdPlaybackRate(asset, multiplier = 1) {
  const text = describeVmdAsset(asset);
  const rateMultiplier = clampPlaybackMultiplier(multiplier);
  if (text.includes("idle_animations_pack") || text.includes("idle animations pack")) {
    return normalizePlaybackRate(IDLE_ANIMATIONS_PACK_PLAYBACK_RATE * rateMultiplier);
  }
  return normalizePlaybackRate(DEFAULT_VMD_PLAYBACK_RATE * rateMultiplier);
}

export function createVmdPreviewInteraction(asset, multiplier = 1, { bakedBoneAnimation = false } = {}) {
  return {
    emotion: asset?.slot || "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: asset?.url || "",
    vmdLoopEmotionByUrl: asset?.url ? { [asset.url]: asset?.slot || "neutral" } : {},
    playbackRate: resolveVmdPlaybackRate(asset, multiplier),
    bakedBoneAnimation: Boolean(bakedBoneAnimation),
    lockLowerBody: false,
    lockRootPosition: false,
    disableCrossfade: true,
    sequence: [],
  };
}

export function createIdleVmdFallbackInteraction(
  assets = [],
  { enabled = true, emotion = "neutral", action = "idle", randomValue = Math.random() } = {},
) {
  if (!enabled) return null;
  const asset = selectIdleFallbackVmdAsset(assets, { randomValue });
  if (!asset?.url) return null;
  const resolvedEmotion = emotion || asset?.slot || "neutral";

  return {
    activeVmdAssetId: asset.asset_id || "",
    interaction: {
      emotion: resolvedEmotion,
      action: action || "idle",
      mode: "vmd",
      vmdUrl: asset.url,
      bakedBoneAnimation: asset.bakedBoneAnimation === true,
      lockRootPosition: asset.bakedBoneAnimation !== true,
      lockLowerBody: false,
      vmdLoopUrls: [],
      vmdLoopEmotionByUrl: { [asset.url]: resolvedEmotion },
      standbyVmdUrl: "",
      loopGapMs: 0,
      loopMode: "random",
      playbackRate: resolveVmdPlaybackRate(asset),
      sequence: [],
    },
  };
}

export function createDefaultFavoriteLoopInteraction(
  assets = [],
  { enabled = true, loopMode = "random", leadMode = "first", randomValue = Math.random() } = {},
) {
  if (!enabled) return null;
  const playableAssets = getNonemptyVmdAssets(assets);
  const leadAsset = leadMode === "random" ? pickRandomItem(playableAssets, randomValue) : playableAssets[0];
  if (!leadAsset) return null;

  return {
    emotion: leadAsset?.slot || "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: leadAsset.url,
    vmdLoopUrls: playableAssets.map((asset) => asset.url),
    vmdBakedBoneAnimationByUrl: Object.fromEntries(playableAssets.map(asset => [asset.url, asset.bakedBoneAnimation === true])),
    vmdLoopEmotionByUrl: Object.fromEntries(
      playableAssets.filter((asset) => asset?.url).map((asset) => [asset.url, asset?.slot || "neutral"]),
    ),
    standbyVmdUrl: "",
    loopMode: loopMode === "sequential" ? "sequential" : "random",
    lockLowerBody: false,
    playbackRate: resolveVmdPlaybackRate(leadAsset),
    sequence: [],
  };
}

export function createEntryGreetingFolderLoopInteraction(
  assets = [],
  { enabled = true, loopMode = "random", randomValue = Math.random(), leadMode = "entry" } = {},
) {
  if (!enabled) return null;
  const playableAssets = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.url);
  if (!playableAssets.length) return null;

  const greetingAssets = playableAssets.filter((asset) => ENTRY_GREETING_FILENAMES.includes(normalizeAssetFilename(asset)));
  const fallbackLeadAssets = excludeEntryStandbyAssets(playableAssets);
  const randomLeadAssets = fallbackLeadAssets.length ? fallbackLeadAssets : playableAssets;
  const leadAsset =
    leadMode === "random"
      ? pickRandomItem(randomLeadAssets, randomValue)
      : greetingAssets.length
        ? pickRandomItem(greetingAssets, randomValue)
        : fallbackLeadAssets[0] || playableAssets[0];
  if (!leadAsset) return null;

  return {
    emotion: leadAsset?.slot || "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: leadAsset.url,
    vmdLoopUrls: playableAssets.map((asset) => asset.url),
    vmdLoopEmotionByUrl: Object.fromEntries(
      playableAssets.filter((asset) => asset?.url).map((asset) => [asset.url, asset?.slot || "neutral"]),
    ),
    standbyVmdUrl: "",
    loopMode: loopMode === "sequential" ? "sequential" : "random",
    playbackRate: resolveVmdPlaybackRate(leadAsset),
    sequence: [],
  };
}

export function buildAutoFavoriteInteraction(assets = [], options = {}) {
  return createDefaultFavoriteLoopInteraction(assets, { ...options, leadMode: "random" });
}

export function buildAutoplayResumeInteraction(assets = [], options = {}) {
  const autoInteraction = createDefaultFavoriteLoopInteraction(assets, { ...options, leadMode: "random" });
  if (!autoInteraction) return null;
  if (!autoInteraction.standbyVmdUrl) return autoInteraction;
  return {
    ...autoInteraction,
    vmdUrl: autoInteraction.standbyVmdUrl,
  };
}
