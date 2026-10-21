/**
 * Stage 2C-M2a 修正轮：Brows/Lashes 恒等迁移的权威目标公式与 alpha 口径（单一事实源）。
 *
 * 权威取证（web/.scratch/v14d-brows-lashes/brows-lashes-forensic.json，blend SHA256
 * 1139617c…）确认：Brows/Lashes 的 Principled BaseColor 与 Alpha 都直连
 * c_Koleda_slg_face_d.png（sRGB 1024×1024、Linear 插值、alphaMode=STRAIGHT、channels=4），
 * 无 MIX/RGB 乘色节点。因此 V1 语义目标 = BaseColor 原样通过（恒等乘色），
 * targetLinear(uv) = srgbToLinear(face_d(uv))。
 *
 * alpha 口径：blendMethod=HASHED、surfaceRenderMethod=DITHERED、alphaThreshold=0.5、
 * useBackfaceCulling=false。生产引擎对该分组用 hashed-alpha 裁切（renderClass=auto，
 * alphaMode=hashed）；本模块的 alpha 阈值与 PMX 材质名是机器 Gate 的唯一权威来源，
 * accept/analyzer 不得复制字面量形成双权威。
 */

import {
  V14D_BROWS_LASHES_TINT,
  V14D_BROWS_MATERIAL_NAME,
  V14D_LASHES_MATERIAL_NAME,
} from "./v14dAuthority.js";

/** 恒等 tint 的线性乘法向量（与引擎 WGSL helper 同一来源）。 */
export const V14D_BROWS_LASHES_TINT_LINEAR = V14D_BROWS_LASHES_TINT;

/** 权威 face_d 纹理逻辑名（PMX 包内 Textures/ 下文件名；与 v14dFaceStatic.ts 同源）。 */
export const V14D_BROWS_LASHES_TEXTURE_NAME = "c_Koleda_slg_face_d.png";

/** 权威 alpha 裁切阈值（取证 alphaThreshold=0.5）。 */
export const V14D_BROWS_LASHES_ALPHA_THRESHOLD = 0.5;

/** 参与迁移的两槽（机器 Gate 的权威槽清单）。 */
export const V14D_BROWS_LASHES_SLOTS = Object.freeze([
  Object.freeze({ slot: "brows", materialName: V14D_BROWS_MATERIAL_NAME }),
  Object.freeze({ slot: "lashes", materialName: V14D_LASHES_MATERIAL_NAME }),
]);

function srgbByteToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgbByte(l) {
  const clamped = Math.max(0, Math.min(1, l));
  const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, srgb)) * 255);
}

/**
 * 逐像素 V1 目标显示字节：face_d 的 sRGB 字节 → 线性 → 乘恒等 tint → 转回显示字节。
 * 恒等 tint 下数学上等价于原色，但公式保持与 Hair 同一「线性乘法 tint」口径，
 * 使 wrongTint 负测（改 tint）能真实偏离该目标。
 */
export function v14dBrowsLashesTargetDisplayFromLinear(linearRgb) {
  return [
    linearToSrgbByte(linearRgb[0] * V14D_BROWS_LASHES_TINT_LINEAR[0]),
    linearToSrgbByte(linearRgb[1] * V14D_BROWS_LASHES_TINT_LINEAR[1]),
    linearToSrgbByte(linearRgb[2] * V14D_BROWS_LASHES_TINT_LINEAR[2]),
  ];
}

/**
 * face_d 纹理的 sRGB 字节 → 线性 RGB（0..1）。恒等目标的 canonical 参考。
 */
export function v14dBrowsLashesLinearFromSrgbByte(rgb) {
  return [srgbByteToLinear(rgb[0]), srgbByteToLinear(rgb[1]), srgbByteToLinear(rgb[2])];
}
