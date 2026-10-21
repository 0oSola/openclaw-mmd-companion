import catalog from "./characterIdleCatalog.json";
import { isKoledaModelIdentifier } from "./koledaDefaultAppearance.js";

// 明确绑定本批角色素材，不把其骨骼动作应用到其他角色。
export function characterDefaultAssets(modelPath) {
  if (!isKoledaModelIdentifier(modelPath)) return [];
  const loops = new Set(catalog.filter((item) => /^L\d+_02_/.test(item.filename)).map((item) => item.filename.split("_")[0]));
  // L05 只有躺姿循环，没有安全进入/退出站姿的过渡，整组不参与默认待机。
  return catalog.filter((item) => !item.filename.startsWith("L05_") && loops.has(item.filename.split("_")[0])).map((item) => ({
    ...item,
    asset_id: `character-default:${item.filename}`,
    url: `/assets/mmd/default-motions/${encodeURIComponent(item.filename)}`,
    slot: "neutral",
  }));
}

export function buildCharacterIdleInteraction(modelPath) {
  const assets = characterDefaultAssets(modelPath);
  if (!assets.length) return null;
  return {
    emotion: "neutral", action: "idle", mode: "vmd",
    vmdUrl: assets[0].url,
    vmdLoopUrls: assets.map((asset) => asset.url),
    loopMode: "sequential", loopGapMs: 0, playbackRate: 1,
    lockLowerBody: false, lockRootPosition: false, sequence: [],
  };
}

export function characterEntranceUrl(modelPath) {
  if (!isKoledaModelIdentifier(modelPath)) return "";
  const entrance = catalog.find((item) => item.filename.startsWith("A03_"));
  return entrance ? `/assets/mmd/default-motions/${encodeURIComponent(entrance.filename)}` : "";
}
