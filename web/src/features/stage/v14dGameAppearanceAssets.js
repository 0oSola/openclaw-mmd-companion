export const V14D_GAME_MANIFEST_URL = "/assets/v14d-game/manifest";

export const V14D_GAME_DEFAULT_SETTINGS = Object.freeze({
  display: "game/ocio",
  exposure: -0.4,
  fabricDetail: 2,
  legStructure: 1,
  closedEye: "motion",
  smile: 0.55,
  iris: 2,
  autoFace: true,
  manualMask: 2,
  lightingEnabled: true,
  hairMaskStrength: 1,
  hairMaskView: false,
  hairDiskCandidate: false,
  rotation: 0,
});

export function createV14dGameModelAsset(manifest) {
  const model = manifest?.model;
  const relativePath = String(model?.relativePath || "").trim();
  const url = String(model?.url || "").trim();
  if (!relativePath && !url) return null;
  const name = (relativePath.split(/[\\/]/).filter(Boolean).pop() || "GirlsFrontline KoledaDefault.pmx").trim();
  return {
    name,
    label: `${name.replace(/\.(pmx|pmd)$/i, "")}（本机游戏外观）`,
    relative_path: relativePath || name,
    size_bytes: Number(model?.sizeBytes) || 0,
    url,
  };
}

export function normalizeV14dGameSettings(patch = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("外观参数必须为对象");
  for (const key of Object.keys(patch)) if (!Object.hasOwn(V14D_GAME_DEFAULT_SETTINGS, key)) throw new Error("未知外观参数：" + key);
  const result = { ...V14D_GAME_DEFAULT_SETTINGS, ...patch };
  for (const [key, low, high] of [["exposure", -2, 1], ["fabricDetail", 0, 2], ["legStructure", 0, 2], ["iris", 0, 2], ["hairMaskStrength", 0, 1], ["manualMask", 0, 4], ["rotation", -180, 180]]) {
    const value = result[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) throw new Error("外观参数越界：" + key);
  }
  if (!Number.isInteger(result.manualMask)) throw new Error("遮罩状态必须为整数");
  for (const key of ["autoFace", "lightingEnabled", "hairMaskView", "hairDiskCandidate"]) if (typeof result[key] !== "boolean") throw new Error("外观开关必须为布尔值：" + key);
  if (result.hairDiskCandidate) throw new Error("圆盘光实验未开放");
  if (!["game/ocio", "game/builtin"].includes(result.display)) throw new Error("未知显示模式");
  if (!["reference", "motion", "open", "closed"].includes(result.closedEye)) throw new Error("未知眼部模式");
  if (result.smile !== null && (typeof result.smile !== "number" || !Number.isFinite(result.smile) || result.smile < 0 || result.smile > 1)) throw new Error("微笑权重无效");
  return result;
}

export function v14dGameSettingsStorageKey(userId, modelPath) {
  return "v14d-game-settings-v2:" + JSON.stringify([userId, modelPath]);
}

export function readV14dGameSettings(storage, userId, modelPath) {
  if (!userId) return { ...V14D_GAME_DEFAULT_SETTINGS };
  const key = v14dGameSettingsStorageKey(userId, modelPath);
  const saved = storage.getItem(key);
  if (saved !== null) return normalizeV14dGameSettings(JSON.parse(saved));
  const legacyKey = "v14d-game-settings-v1:" + JSON.stringify([userId, modelPath]);
  const legacy = storage.getItem(legacyKey);
  if (legacy === null) return { ...V14D_GAME_DEFAULT_SETTINGS };
  const settings = { ...normalizeV14dGameSettings(JSON.parse(legacy)), closedEye: "motion" };
  storage.setItem(key, JSON.stringify(settings));
  return settings;
}

const REQUIRED_OCIO_KEYS = ["processor", "shader", "lut0", "lut1"];

export function validateV14dGameManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, reason: "V14D 游戏外观清单缺失。" };
  }
  if (manifest.available === false) {
    return { ok: false, reason: String(manifest.reason || "V14D 游戏外观资源不可用。") };
  }
  if (!manifest.model?.url || !/\.(pmx|pmd)(?:$|[?#])/i.test(String(manifest.model.url))) {
    return { ok: false, reason: "V14D 游戏外观模型资源未登记。" };
  }
  if (!manifest.model.relativePath || !manifest.model.sha256) {
    return { ok: false, reason: "V14D 游戏外观模型身份不完整。" };
  }
  const ocio = manifest.ocio || {};
  const missingOcio = REQUIRED_OCIO_KEYS.filter((key) => !ocio[key]?.url || !ocio[key]?.sha256);
  if (missingOcio.length) {
    return { ok: false, reason: "V14D 本机 OCIO 资源缺失：" + missingOcio.join(", ") + "。" };
  }
  if (!Array.isArray(manifest.textures) || !manifest.textures.length) {
    return { ok: false, reason: "V14D 游戏外观材质纹理未登记。" };
  }
  if (manifest.textures.some((entry) => !entry?.key || !entry?.url || !entry?.sha256 || !entry?.kind)) {
    return { ok: false, reason: "V14D 游戏外观材质纹理身份不完整。" };
  }
  if (!Array.isArray(manifest.lights) || manifest.lights.length !== 6) {
    return { ok: false, reason: "V14D 游戏外观六灯清单不完整。" };
  }
  for (const light of manifest.lights) {
    if (
      light?.type !== "AREA" ||
      !["DISK", "RECTANGLE"].includes(light.shape) ||
      !Array.isArray(light.color) ||
      light.color.length !== 3 ||
      !Array.isArray(light.matrix) ||
      light.matrix.length !== 4 ||
      light.matrix.some((row) => !Array.isArray(row) || row.length !== 4 || row.some((value) => !Number.isFinite(Number(value)))) ||
      !Number.isFinite(Number(light.size)) ||
      !Number.isFinite(Number(light.sizeY)) ||
      !Number.isFinite(Number(light.power))
    ) {
      return { ok: false, reason: "V14D 游戏外观六灯参数不完整。" };
    }
  }
  if (!manifest.sourceManifestSha256) {
    return { ok: false, reason: "V14D 游戏外观源清单身份缺失。" };
  }
  return { ok: true, reason: "" };
}

export function getV14dGameTextureUrl(manifest, key) {
  return manifest?.textures?.find((item) => item?.key === key)?.url || "";
}
