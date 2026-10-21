/**
 * Reze K3 皮肤变体偏好（"原始 Reze K3" / "Reze K3 V1（V14D）"）。
 *
 * 概念登记（见 workflow/workflow-glossary.zh-CN.md）：
 *   - 皮肤变体（Skin Variant）：在同一 reze-k3 舞台运行时中，对克莱妲
 *     Face/BodySkin 材质应用 V14D State2 实时合成图的可选模式。
 *   - rezeK3SkinVariant：机器字段名，取值 "original" | "v1"。
 *
 * 持久化口径：localStorage 按「用户 + 模型 + reze-k3 管线」三维隔离，
 * 不写入会话、不写入共享配置（桌面 Pet 不受影响），默认 original。
 *
 * 本模块为纯函数 .js；权威资产常量来自 ./v14dAuthority.js（无 bundler alias、
 * 无外部依赖的单一事实源），v14dFaceStatic.ts、本模块与 node:test 测试三方
 * 同源导入，消除注释式双权威（P0-2 第 2 项）。
 */

import { isKoledaModelIdentifier } from "./koledaDefaultAppearance.js";
import { V14D_AUTHORITY_PMX_FILE_NAME, V14D_STATE2_MASK_FILE_NAME } from "./v14dAuthority.js";

/** @typedef {import("./rezeSkinVariantPreference.types").RezeK3SkinVariant} RezeK3SkinVariant */

/** @type {readonly RezeK3SkinVariant[]} */
export const REZE_K3_SKIN_VARIANTS = ["original", "v1"];

/** @type {Record<RezeK3SkinVariant, string>} */
export const REZE_K3_SKIN_VARIANT_LABEL = {
  original: "原始 Reze K3",
  v1: "Reze K3 V1 皮肤预览（V14D）",
};

/** @param {unknown} value @returns {value is RezeK3SkinVariant} */
export function isRezeK3SkinVariant(value) {
  return value === "original" || value === "v1";
}

/** 存储键：用户 + 模型 + 管线三维隔离；仅 reze-k3 管线使用。 */
export function rezeK3SkinVariantStorageKey(userId, modelRelativePath) {
  return "mmd_reze_k3_skin_variant_v1:" + userId + ":reze-k3:" + modelRelativePath;
}

/** 读取持久化的皮肤变体；缺失或非法值回退 original（安全默认，向后兼容）。 */
export function readRezeK3SkinVariant(storage, key) {
  const raw = storage.getItem(key);
  return isRezeK3SkinVariant(raw) ? raw : "original";
}

/** 写入持久化；original 为默认值，直接清除键避免堆积。 */
export function writeRezeK3SkinVariant(storage, key, variant) {
  if (variant === "original") storage.removeItem(key);
  else storage.setItem(key, variant);
}

/**
 * V1（V14D）启用资格（PMX 维度）：仅权威克莱妲 PMX。
 * 权威依据 = PMX 文件名（与诊断入口强门控同源）。
 */
export function isRezeK3V1Eligible(pmxFileName) {
  return pmxFileName === V14D_AUTHORITY_PMX_FILE_NAME;
}

/** 在导入目录文件列表中定位权威 State2 mask（按 webkitRelativePath 或文件名后缀）。 */
export function findV14dState2MaskFile(files) {
  if (!Array.isArray(files)) return null;
  // 用共享常量做 endsWith 匹配，消除字面量复制（与 v14dAuthority.js 同源）。
  const target = V14D_STATE2_MASK_FILE_NAME.toLowerCase();
  return (
    files.find((f) => ((f.webkitRelativePath || f.name) + "").toLowerCase().endsWith(target)) ?? null
  );
}

/**
 * 单一领域谓词：V1（V14D）启用资格 = 权威克莱妲 PMX 且 导入目录含权威 State2 mask。
 *
 * UI 显示、选择回退、传给 MMDStage/RezeWebGpuStage 的 effective variant 与
 * boot 资格必须共用本判定（P0-2/P1）；任何一处不得另起一套业务资格定义。
 * 返回结果对象便于 UI 显示缺失原因，而不只布尔。
 */
export function evaluateRezeK3V1Eligibility(localModelImport) {
  const pmxFile = localModelImport?.pmxFile ?? null;
  const hasAuthorityPmx = !!pmxFile && isRezeK3V1Eligible(pmxFile.name);
  const state2Mask = hasAuthorityPmx ? findV14dState2MaskFile(localModelImport?.files) : null;
  return {
    eligible: hasAuthorityPmx && !!state2Mask,
    hasAuthorityPmx,
    hasState2Mask: !!state2Mask,
    state2Mask,
  };
}

/**
 * 收敛 V1 启用契约：资格决定 effective/active，identifier 只产生诊断信息。
 * 这样 boot 与测试都能调用同一条真实生产路径，避免把标识符影响误写成业务门控。
 *
 * @param {RezeK3SkinVariant} requested
 * @param {{ eligible: boolean }} eligibility
 * @param {unknown | readonly unknown[]} identifier
 * @returns {{ effective: RezeK3SkinVariant, active: boolean, diagnosticIdentifierMismatch: boolean }}
 */
export function resolveRezeK3SkinVariantActivation(requested, eligibility, identifier) {
  const active = requested === "v1" && eligibility?.eligible === true;
  const identifiers = Array.isArray(identifier) ? identifier : [identifier];
  return {
    effective: active ? "v1" : "original",
    active,
    diagnosticIdentifierMismatch: active && !isKoledaModelIdentifier(...identifiers),
  };
}

/**
 * 由资格结果求 effective 变体：资格不满足时持久化的 v1 安全回退 original，
 * 保证用户可见状态与真实渲染一致（P0-2）。
 */
export function resolveRezeK3SkinVariant(requested, localModelImport) {
  return requested === "v1" && evaluateRezeK3V1Eligibility(localModelImport).eligible ? "v1" : "original";
}
