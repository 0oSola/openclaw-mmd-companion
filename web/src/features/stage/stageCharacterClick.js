import {
  getVmdAssetCategory,
  isEmptyVmdAsset,
  resolveVmdPlaybackRate,
} from "../mapping/vmdPreview.js";

export const STAGE_CLICK_RIPPLE_DURATION_MS = 720;
export const STAGE_CHARACTER_CLICK_MAX_PRESS_MS = 450;
export const STAGE_CHARACTER_CLICK_MAX_MOVE_PX = 10;

/** @param {any} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

/** @param {any[]} items @param {number} [randomValue] */
function pickRandomItem(items, randomValue = Math.random()) {
  if (!items.length) return null;
  const clamped = Math.min(0.999999, Math.max(0, Number(randomValue) || 0));
  return items[Math.floor(clamped * items.length)] || items[0] || null;
}

/** @param {any} asset */
function hasPlayableClickVmdUrl(asset) {
  return Boolean(asset?.url) && !isEmptyVmdAsset(asset);
}

/** @param {any} asset */
function normalizeClickMotionName(asset) {
  const rawName = `${asset?.display_name || asset?.filename || asset?.asset_id || asset?.url || ""}`;
  return rawName
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/\s*\(\d+\)$/, "")
    .trim();
}

/** @param {any} asset */
function getClickMotionKey(asset) {
  const category = getVmdAssetCategory(asset) || "uncategorized";
  const name = normalizeClickMotionName(asset);
  return name ? `${category}:${name}` : `${category}:${asset?.asset_id || asset?.url || ""}`;
}

/** @param {any[]} assets */
function dedupeClickAssetsByMotion(assets) {
  const seen = new Set();
  const result = [];
  for (const asset of assets) {
    const key = getClickMotionKey(asset);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

/** @param {any[]} assets @param {any[]} sourceAssets @param {string} previousActiveVmdAssetId */
function excludePreviousClickMotion(assets, sourceAssets, previousActiveVmdAssetId = "") {
  if (!previousActiveVmdAssetId || assets.length <= 1) return assets;
  const previousAsset = sourceAssets.find((asset) => asset?.asset_id === previousActiveVmdAssetId);
  const previousMotionKey = previousAsset ? getClickMotionKey(previousAsset) : "";
  if (previousMotionKey) {
    const filtered = assets.filter((asset) => getClickMotionKey(asset) !== previousMotionKey);
    if (filtered.length) return filtered;
  }
  const filtered = assets.filter((asset) => asset?.asset_id !== previousActiveVmdAssetId);
  return filtered.length ? filtered : assets;
}

/**
 * @param {{
 *   id?: string,
 *   clientX?: number,
 *   clientY?: number,
 *   rect?: { left?: number, top?: number, width?: number, height?: number }
 * }} [options]
 * @returns {{ id: string, x: number, y: number, xPercent: number, yPercent: number }}
 */
export function createStageClickRipple({ id, clientX, clientY, rect } = {}) {
  const width = Math.max(1, Number(rect?.width) || 1);
  const height = Math.max(1, Number(rect?.height) || 1);
  const x = clamp((Number(clientX) || 0) - (Number(rect?.left) || 0), 0, width);
  const y = clamp((Number(clientY) || 0) - (Number(rect?.top) || 0), 0, height);

  return {
    id: id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    x,
    y,
    xPercent: Math.round((x / width) * 1000) / 10,
    yPercent: Math.round((y / height) * 1000) / 10,
  };
}

/**
 * @param {{
 *   downClientX?: number,
 *   downClientY?: number,
 *   upClientX?: number,
 *   upClientY?: number,
 *   downTimeMs?: number,
 *   upTimeMs?: number,
 *   maxPressMs?: number,
 *   maxMovePx?: number
 * }} [options]
 * @returns {boolean}
 */
export function shouldTriggerStageCharacterClick({
  downClientX = 0,
  downClientY = 0,
  upClientX = 0,
  upClientY = 0,
  downTimeMs = 0,
  upTimeMs = 0,
  maxPressMs = STAGE_CHARACTER_CLICK_MAX_PRESS_MS,
  maxMovePx = STAGE_CHARACTER_CLICK_MAX_MOVE_PX,
} = {}) {
  const pressMs = Number(upTimeMs) - Number(downTimeMs);
  if (!Number.isFinite(pressMs) || pressMs < 0 || pressMs > maxPressMs) return false;
  const moveX = Number(upClientX) - Number(downClientX);
  const moveY = Number(upClientY) - Number(downClientY);
  return Math.hypot(moveX, moveY) <= maxMovePx;
}

/**
 * @param {{ assets?: any[], randomValue?: number, previousActiveVmdAssetId?: string }} [options]
 * @returns {{ activeVmdAssetId: string, interaction: any }}
 */
export function resolveStageCharacterClickInteraction({
  assets = [],
  randomValue = Math.random(),
  previousActiveVmdAssetId = "",
} = {}) {
  const sourceAssets = Array.isArray(assets) ? assets : [];
  const clickPool = excludePreviousClickMotion(
    dedupeClickAssetsByMotion(sourceAssets.filter(hasPlayableClickVmdUrl)),
    sourceAssets,
    previousActiveVmdAssetId,
  );
  const asset = pickRandomItem(clickPool, randomValue);
  if (asset) {
    const emotion = asset.slot || "happy";
    return {
      activeVmdAssetId: asset.asset_id || "",
      interaction: {
        emotion,
        action: "click_react",
        mode: "vmd",
        vmdUrl: asset.url,
        vmdLoopUrls: [],
        vmdLoopEmotionByUrl: { [asset.url]: emotion },
        standbyVmdUrl: "",
        loopGapMs: 0,
        loopMode: "random",
        lockLowerBody: false,
        lockRootPosition: false,
        disableCrossfade: false,
        playbackRate: resolveVmdPlaybackRate(asset),
        sequence: [],
      },
    };
  }

  return {
    activeVmdAssetId: "",
    interaction: {
      emotion: "happy",
      action: "wave",
      mode: "procedural",
      vmdUrl: "",
      vmdLoopUrls: [],
      vmdLoopEmotionByUrl: {},
      standbyVmdUrl: "",
      loopGapMs: 0,
      loopMode: "random",
      playbackRate: 1,
      sequence: [{ template: "greet_wave", action: "wave", durationMs: 1100, intensity: 0.75 }],
    },
  };
}
