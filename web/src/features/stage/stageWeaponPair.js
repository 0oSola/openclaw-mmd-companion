import { resolveStageAssetUrl } from "./stageAssetUrl.js";
// 保留旧显式试播；下方按已核验的完整文件内容登记配套，不代表动作质量通过。
export const KOLEDA_WEAPON_PREVIEW = Object.freeze({
  modelPath: "克莱妲原皮/Koleda_v1.1_动作兼容.pmx",
  characterMotion: "/stage-assets/koleda-inspect-weapon/character.vmd",
  weaponModel: "/stage-assets/koleda-huiling-skin/weapon.pmx",
  weaponMaterialRoot: "/stage-assets/koleda-huiling-skin/",
  weaponPartMaterials: true,
  weaponMotion: "/stage-assets/koleda-inspect-weapon/weapon.vmd",
  playbackRate: 8,
  modelSha256: "441edc6e3ce7f1e9545906d8ba2df4c6682659f1d066946d49b26c863c6bb4c4",
});

// 按实际读取的文件内容绑定，上传生成新地址或改名不会丢失配套；同名文件不获信任。
const A07_WEAPON_PAIR = Object.freeze({
  modelPath: KOLEDA_WEAPON_PREVIEW.modelPath,
  modelSha256: KOLEDA_WEAPON_PREVIEW.modelSha256,
  weaponModel: KOLEDA_WEAPON_PREVIEW.weaponModel,
  weaponMaterialRoot: KOLEDA_WEAPON_PREVIEW.weaponMaterialRoot,
  weaponPartMaterials: true,
  weaponMotion: "/stage-assets/koleda-a07-weapon/motion.vmd",
  playbackRate: 1,
  label: "A07 碰枪互动",
});
const INSPECT_FULL_WEAPON_PAIR = Object.freeze({
  modelPath: KOLEDA_WEAPON_PREVIEW.modelPath,
  modelSha256: KOLEDA_WEAPON_PREVIEW.modelSha256,
  weaponModel: KOLEDA_WEAPON_PREVIEW.weaponModel,
  weaponMaterialRoot: KOLEDA_WEAPON_PREVIEW.weaponMaterialRoot,
  weaponPartMaterials: true,
  weaponMotionFromCharacter: true,
  playbackRate: 1,
  label: "专属查看完整单VMD",
});
const KNOWN_MOTIONS = new Map([
  ["44d16ccbe39b3f55f04764fc3e11b8e6856c5c083017da4383d229989fd8b344", A07_WEAPON_PAIR],
  ["517245cffe73f92fdada127729f884bc753c99d9ffa03d03fbce5a475506aaf1", Object.freeze({ ...A07_WEAPON_PAIR, weaponMotionFromCharacter: true })],
  ["61cc6e1b9ee74573cb8dddd0a913344c21d5d5d6318ba093f89208caf317411c", INSPECT_FULL_WEAPON_PAIR],
]);
const KNOWN_BYTE_LENGTHS = new Set([7818506, 7989002, 11078741]);

export async function identifyStageWeaponPair(buffer) {
  if (!KNOWN_BYTE_LENGTHS.has(buffer?.byteLength) || !globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return KNOWN_MOTIONS.get(hash) || null;
}

export function resolveStageWeaponPair(motionUrl, identifiedPair = null) {
  if (identifiedPair) return identifiedPair.weaponMotionFromCharacter
    ? { ...identifiedPair, weaponMotion: motionUrl } : identifiedPair;
  if (!motionUrl || !globalThis.location) return null;
  try {
    const url = new URL(motionUrl, globalThis.location.href);
    const preview = new URL(resolveStageAssetUrl(KOLEDA_WEAPON_PREVIEW.characterMotion));
    return url.origin === preview.origin && url.pathname === preview.pathname
      ? KOLEDA_WEAPON_PREVIEW : null;
  } catch { return null; }
}
