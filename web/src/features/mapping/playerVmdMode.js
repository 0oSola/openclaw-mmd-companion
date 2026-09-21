const key = userId => 'mmd_player_vmd_mode_v1:' + encodeURIComponent(userId);
export const normalizePlayerVmdMode = value => value === 'standard' ? 'standard' : 'baked';

export function readPlayerVmdMode(storage, userId) {
  try { return normalizePlayerVmdMode(userId ? storage.getItem(key(userId)) : null); }
  catch { return 'baked'; }
}

export function writePlayerVmdMode(storage, userId, mode) {
  if (!userId) return false;
  try { storage.setItem(key(userId), normalizePlayerVmdMode(mode)); return true; }
  catch { return false; }
}

export function applyPlayerVmdMode(interaction, mode) {
  const { vmdBakedBoneAnimationByUrl, ...rest } = interaction;
  const playerVmdMode = normalizePlayerVmdMode(mode);
  return { ...rest, playerVmdMode, bakedBoneAnimation: playerVmdMode === 'baked',
    lockLowerBody: false, lockRootPosition: false };
}
