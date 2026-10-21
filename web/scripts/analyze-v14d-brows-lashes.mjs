// Stage 2C-M2a 修正轮：Brows/Lashes 逐槽 identity-target 正式 Gate（独立 analyzer）。
//
// 与 Hair 逐槽 Gate 同一口径，但恒等 tint 不需要 changed=true；每槽必须：
//   materialId（engine-pick-material-id-depth）+ 原子同帧 expanded-tri-uv +
//   face_d canonical target 逐像素误差/覆盖/P95，且 targetBinding 合法一致。
// 同时提供 Lashes 透明边缘专门 Gate（核心/边缘/透明区分母、生产可见性与
// face_d alpha/权威 alphaThreshold=0.5 的 cutout 一致性、边缘颜色/fringe 误差），
// 覆盖黑框、白边、整槽消失三类风险。
//
// 负测（实跑、自然拒绝、非配置包装）：
//   --neg-wrongtint        读 wrongtint 画布，错误 tint 拉远两槽目标，两槽正式 Gate=false
//   --neg-swap-slot-target 交换 Brows↔Lashes 的 target/triUV 归属，analyzer exit 非零
//   --neg-wrong-alpha      读 wrongAlpha 画布（专用 fault tag → 引擎 prelude 在 hashed
//                          discard 前把 alpha 乘固定故障因子
//                          V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR（权威导出，当前 1e-7），真实剔除片元、
//                          coverage/边界环收缩），边界环 lashesAlphaEdge.gate 必须自然
//                          false（真实像素/coverage 证据，非配置/阈值自证）
// 任一正式判定失败 → exit 1（swap 负测模式也保留非零以证明阻断）；报告写
// .scratch/reze-k3-v1-stage/visual-diff-brows-lashes[-wrongtint|-swap-slot-target].json。
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import {
  barycentricForTriangleUv,
  barycentricInside,
  sampleHairTextureLinear,
  srgbByteToLinear,
} from "../src/features/stage/v14dHairPartition.js";
import {
  V14D_BROWS_LASHES_ALPHA_THRESHOLD,
  V14D_BROWS_LASHES_SLOTS,
  V14D_BROWS_LASHES_TEXTURE_NAME,
  V14D_BROWS_LASHES_TINT_LINEAR,
  v14dBrowsLashesTargetDisplayFromLinear,
} from "../src/features/stage/v14dBrowsLashesTarget.js";

const OUT = path.resolve(process.env.V14D_G7_OUT || ".scratch/reze-k3-v1-stage");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || 'D:/mmd/克莱妲原皮';
const FACE_TEX = process.env.V14D_BROWS_LASHES_TEX || path.join(KOLEDA_DIR, "Textures", V14D_BROWS_LASHES_TEXTURE_NAME);

// 阈值由权威取证 + 健康证据标定（注释记录口径，非硬编码必败字段）：
// 恒等 tint 下 V1 与 face_d canonical 目标应高度一致，但含引擎灯光/Toon 显示链
// 的乘性亮度差与亚像素/抖动噪声，故用「绝对 MAE 上限 + P95 上限 + 覆盖下限 + 样本数下限」。
// 眉毛/睫毛是小槽，样本数低于 hair；alpha 边缘区存在 hashed 抖动，P95 阈值放宽。
const THRESHOLDS = {
  minSlotTargetSamples: 12,       // 逐槽目标判定最小像素数（眉毛/睫毛小槽）
  minTriUvResolution: 0.999,      // 材质前景中至少 99.9% 必须有同帧 triUV
  slotAbsMae: 95,                 // V1 对 face_d canonical 的绝对 MAE 上限（含显示链亮度差）
  slotP95: 150,                   // V1 对 canonical 的 P95 上限（边缘抖动放宽）
  minCoverage: 0.0,               // 覆盖率仅记录不判定（分母改为该槽全屏前景像素，非 ROI）
  // Lashes 透明边缘：核心/边缘/透明三区分母 + 屏幕空间边界环误差上限。
  // 边缘分母口径（Stage 2C-M2a 第二次修正轮）：face_d 在两槽生产可见像素 alpha 恒 1.0，
  // 纹理 alpha 边缘带恒空（无判别力）。正式「透明边缘」证据改用 production material-ID
  // 前景掩码的 4-邻域形态学边界环（屏幕空间边界像素集合），实测非空（Lashes≈130 边界
  // 像素/特写帧），在该边界环上核对黑边（lum<25）/白边（lum>235）/整槽消失三类风险。
  // wrongAlpha（专用 fault tag → 引擎 prelude 在 hashed discard 前把 alpha 乘故障因子
  // 权威 1e-7）真实剔除部分片元：production 前景 mask 收缩、边界环像素数与边缘色分布改变
  // → 边界环 Gate 自然非零拒绝（真实 coverage/像素证据，非阈值/配置自证）。
  lashesEdgeMae: 120,             // 边缘区 V1 对 canonical 的 MAE 上限（保留作颜色误差参考）
  minEdgeBoundaryPixels: 8,       // 边界环最小像素数（整槽消失/极端裁切→环塌缩被拒）
  maxEdgeDarkRatio: 0.45,         // 边界环暗像素占比上限（黑边）；健康 Lashes 实测 0.354（46/130，暗红褐睫毛有真实暗边界），wrongTint 0.485；整槽纯黑失效→ratio→1.0 必拒
  maxEdgeBrightRatio: 0.35,       // 边界环亮像素占比上限（白边）
  // 保留 minLashesEdgeProximity 作为纹理 alpha 口径的参考记录（非正式判定）：权威
  // face_d 两槽可见像素 min alpha=1.0（见 .scratch/v14d-brows-lashes/brows-lashes-forensic.json）。
  // 正式透明边缘判定已由屏幕空间边界环（minEdgeBoundaryPixels/maxEdgeDarkRatio/
  // maxEdgeBrightRatio）承担，不再以空 alpha 边缘带软通过。
  minLashesEdgeProximity: 0.9,    // 参考记录：可见像素最小 alpha（健康 hashed 口径恒 1.0）
  // wrongTint 通道指纹判别阈值（Stage 2C-M2a 修正轮 P1 标定，口径修正为显示链不变的
  // 通道比差值）。绝对 MAE 与红通道归一化偏移均受 K3 显示链（曝光/Toon/sRGB）对红通道的
  // 非均匀压缩影响（暗眉/暗红睫红通道对恒等 target 的偏差本就大，不可判别）。改用：
  //   redDropDiff = mean( (V1红-Orig红)/max(1,Orig红) - (V1绿-Orig绿)/max(1,Orig绿) )。
  // 显示链对每个槽的红/绿施加同一因子，恒等 tint 下红降≈绿降 → redDropDiff≈0；
  // 错误 tint[0,1,1] 额外压低红通道 → 红降>绿降 → redDropDiff 显著为负。标定（.scratch probe，
  // 两次独立健康 + 一次错误采集）：
  //   恒等：Brows redDropDiff≈+0.037/+0.037、Lashes≈+0.092/+0.099（均>0）；
  //   错误：Brows≈-0.144、Lashes≈-0.021（均<0）。阈值取 0（符号分离，两侧均有实测裕量）。
  // 标定证据（两次独立健康采集 + 一次错误采集的 redDropDiff）写入机器报告
  // browsLashesTintCalibration（accept G3）。
  minTintBaselineShift: 20,       // 保留字段（标定汇总断言兼容），判别改用 maxRedDropDiff
  maxRedDropDiff: 0.0,            // 红降-绿降差值上限：恒等 tint>=0，错误 tint[0,1,1]<0
};

function percentile95(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((x, y) => x - y);
  const idx = (sorted.length - 1) * 0.95;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function round3(v) { return v === null || v === undefined || !Number.isFinite(v) ? null : +v.toFixed(3); }

async function loadRaw(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// face_d 纹理 → 线性 RGB 缓存（供逐 UV 双线性采样 + alpha 通道保留）。
async function loadFaceTexture() {
  const raw = await loadRaw(FACE_TEX);
  const n = raw.width * raw.height;
  const linear = new Float32Array(n * 3);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    linear[i * 3] = srgbByteToLinear(raw.data[i * 4]);
    linear[i * 3 + 1] = srgbByteToLinear(raw.data[i * 4 + 1]);
    linear[i * 3 + 2] = srgbByteToLinear(raw.data[i * 4 + 2]);
    alpha[i] = raw.data[i * 4 + 3] / 255;
  }
  return { width: raw.width, height: raw.height, linear, alpha, raw };
}
function sampleFaceAlpha(tex, u, v) {
  // 与 sampleHairTextureLinear 同双线性口径，但只取 alpha 通道。
  const x = Math.min(Math.max(u, 0), 1) * (tex.width - 1);
  const y = Math.min(Math.max(v, 0), 1) * (tex.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, tex.width - 1), y1 = Math.min(y0 + 1, tex.height - 1);
  const fx = x - x0, fy = y - y0;
  const a00 = tex.alpha[y0 * tex.width + x0];
  const a10 = tex.alpha[y0 * tex.width + x1];
  const a01 = tex.alpha[y1 * tex.width + x0];
  const a11 = tex.alpha[y1 * tex.width + x1];
  return a00 * (1 - fx) * (1 - fy) + a10 * fx * (1 - fy) + a01 * (1 - fx) * fy + a11 * fx * fy;
}

function slotInfo(capture, materialName) { return capture?.byMaterial?.[materialName] ?? null; }
function slotTriangleUvs(info, triId) {
  const s = triId * 6;
  if (!Array.isArray(info?.triangleUvs) || s < 0 || s + 6 > info.triangleUvs.length) return null;
  return info.triangleUvs.slice(s, s + 6);
}
// 收集某槽全屏有效 triUV 记录（swap 负测用它建另一槽目标流）。
function collectSlotTriUvRecords(capture, materialMask, materialId, materialName, W, H) {
  const info = slotInfo(capture, materialName);
  if (!info || !Number.isInteger(materialId) || materialId <= 0) return [];
  const records = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    if (materialMask.data[i] === 0 || materialMask.data[i + 1] !== materialId) continue;
    if (!info.triMask?.[y * W + x]) continue;
    const triId = Number(info.triId?.[y * W + x]);
    const u = Number(info.uv?.[(y * W + x) * 2]);
    const v = Number(info.uv?.[(y * W + x) * 2 + 1]);
    if (!Number.isInteger(triId) || triId < 0 || triId >= Number(info.triangleCount) || !Number.isFinite(u) || !Number.isFinite(v)) continue;
    if (!barycentricInside(barycentricForTriangleUv(u, v, slotTriangleUvs(info, triId)))) continue;
    records.push({ index: y * W + x, triId, u, v });
  }
  return records;
}

// 逐槽 identity-target 收敛：ROI=脸部近景全区，样本=该槽 materialId 前景像素。
// 恒等目标 = face_d canonical（同槽同 UV 双线性采样 → srgbToLinear → ×恒等 tint → 显示字节）。
function slotIdentityTarget({ slot, materialName, materialId, capture, materialMask, origImage, v1Image, faceTex, W, H, faceRoi, swapTargetSlot, swapCaptureInfo, wrongTintFingerprint, calibrationMode }) {
  const info = slotInfo(capture, materialName);
  if (!info) return { slot, error: "missing triUV material entry" };
  // Stage 2C-M2a 修正轮：分母 = 该槽全屏 materialId 前景像素（小槽正确口径）。
  // 眉毛/睫毛是极小槽，任何矩形 ROI 都无法稳定框住；逐槽收敛的覆盖/样本分母
  // 必须是「该槽在整帧中真实渲染出的像素」，这与 Hair 逐槽 Gate 的
  // materialForegroundPixels/triUvResolution 口径一致（ROI 仅用于皮肤/背景分区，
  // 不用于小槽逐槽收敛）。逐槽前景像素 = 全屏扫描。
  let roiPixels = 0, materialForegroundPixels = 0, triUvResolvedPixels = 0;
  let rejectedNoTriUv = 0, rejectedInvalidTri = 0, rejectedBarycentric = 0;
  const samples = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    roiPixels += 1;
    if (materialMask.data[i] === 0 || materialMask.data[i + 1] !== materialId) continue;
    materialForegroundPixels += 1;
    if (!info.triMask?.[y * W + x]) { rejectedNoTriUv += 1; continue; }
    const triId = Number(info.triId?.[y * W + x]);
    const u = Number(info.uv?.[(y * W + x) * 2]);
    const v = Number(info.uv?.[(y * W + x) * 2 + 1]);
    if (!Number.isInteger(triId) || triId < 0 || triId >= Number(info.triangleCount) || !Number.isFinite(u) || !Number.isFinite(v)) { rejectedInvalidTri += 1; continue; }
    triUvResolvedPixels += 1;
    const bary = barycentricForTriangleUv(u, v, slotTriangleUvs(info, triId));
    if (!barycentricInside(bary)) { rejectedBarycentric += 1; continue; }
    samples.push({ index: y * W + x, triId, u, v });
  }
  // 目标流：正常=本槽同 UV；swap 负测=另一槽全屏 triUV 记录流。
  let targetStream = samples;
  const targetSlot = swapTargetSlot || slot;
  if (swapTargetSlot && swapTargetSlot !== slot) {
    const other = swapCaptureInfo[targetSlot];
    targetStream = collectSlotTriUvRecords(capture, materialMask, other.materialId, other.materialName, W, H);
  }
  if (samples.length > 0 && targetStream.length === 0) return { slot, error: "swap target triUV samples unavailable" };
  const v1Errors = [], v1Channel = [[], [], []];
  let v1Abs = 0;
  // 通道指纹（Stage 2C-M2a 修正轮 P1 口径修正）：对所有模式（含健康）计算显示链不变的
  // 通道比差值 redDropDiff，作为 maxRedDropDiff 的机器标定证据——健康采集（≈+0.04/+0.09）
  // 与错误采集（≈-0.14/-0.02）同口径对比，证明阈值有裕量。
  const needChannelFingerprint = true;
  const channelFingerprint = needChannelFingerprint
    ? { red: { identityVsIdentity: [], wrongVsIdentity: [], redDropDiff: [], tgtRedSum: 0 } }
    : null;
  for (let k = 0; k < samples.length; k += 1) {
    const s = samples[k];
    const t = targetStream[k % targetStream.length];
    const rgbLinear = sampleHairTextureLinear(faceTex, t.u, t.v);
    const target = v14dBrowsLashesTargetDisplayFromLinear(rgbLinear);
    const off = s.index * 4;
    const v1 = [v1Image.data[off], v1Image.data[off + 1], v1Image.data[off + 2]];
    const ch = v1.map((val, c) => Math.abs(val - target[c]));
    const px = ch.reduce((a2, b2) => a2 + b2, 0) / 3;
    v1Errors.push(px); v1Abs += px;
    for (let c = 0; c < 3; c += 1) v1Channel[c].push(ch[c]);
    s.v1Error = px;
    if (needChannelFingerprint) {
      const origPx = [origImage.data[off], origImage.data[off + 1], origImage.data[off + 2]];
      channelFingerprint.red.identityVsIdentity.push(Math.abs(origPx[0] - target[0]));
      channelFingerprint.red.wrongVsIdentity.push(Math.abs(v1[0] - target[0]));
      channelFingerprint.red.redDropDiff.push(((v1[0] - origPx[0]) / Math.max(1, origPx[0])) - ((v1[1] - origPx[1]) / Math.max(1, origPx[1])));
      channelFingerprint.red.tgtRedSum += target[0];
    }
  }
  const v1Mae = samples.length ? v1Abs / samples.length : 0;
  const v1P95 = percentile95(v1Errors);
  const triUvResolution = materialForegroundPixels > 0 ? triUvResolvedPixels / materialForegroundPixels : 0;
  const coverage = samples.length / Math.max(1, roiPixels);
  const targetMaterialId = swapTargetSlot && swapTargetSlot !== slot ? swapCaptureInfo[swapTargetSlot].materialId : materialId;
  const targetBindingConsistent = targetSlot === slot && Number.isInteger(materialId) && materialId > 0
    && Number(info.materialId) === materialId && targetMaterialId === materialId;
  const inputsValid = Number.isInteger(materialId) && materialId > 0
    && Number.isInteger(Number(info.materialId)) && Number(info.materialId) > 0
    && samples.length >= THRESHOLDS.minSlotTargetSamples
    && targetStream.length >= THRESHOLDS.minSlotTargetSamples
    && triUvResolution >= THRESHOLDS.minTriUvResolution;
  const metricFailureReasons = [];
  if (samples.length < THRESHOLDS.minSlotTargetSamples) metricFailureReasons.push("samples<" + THRESHOLDS.minSlotTargetSamples);
  if (!(triUvResolution >= THRESHOLDS.minTriUvResolution)) metricFailureReasons.push("triUvResolution<" + THRESHOLDS.minTriUvResolution);
  if (!(coverage >= 0)) metricFailureReasons.push("coverage<0");
  if (!(v1Mae < THRESHOLDS.slotAbsMae)) metricFailureReasons.push("v1Mae>=" + THRESHOLDS.slotAbsMae + " (" + v1Mae.toFixed(3) + ")");
  if (!Number.isFinite(v1P95) || !(v1P95 <= THRESHOLDS.slotP95)) metricFailureReasons.push("P95>" + THRESHOLDS.slotP95 + " (" + round3(v1P95) + ")");
  // wrongTint 通道指纹（口径修正）：判别量 = redDropDiff = mean[(V1红-Orig红)/Orig红 - (V1绿-Orig绿)/Orig绿]。
  // 显示链不变（红绿同因子缩放抵消），恒等 tint 时≈0，错误 tint[0,1,1] 压低红通道 → 显著为负。
  let tintFingerprint = null;
  if (channelFingerprint) {
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const n = channelFingerprint.red.redDropDiff.length;
    const idVsId = avg(channelFingerprint.red.identityVsIdentity);
    const wrongVsId = avg(channelFingerprint.red.wrongVsIdentity);
    const redDropDiff = avg(channelFingerprint.red.redDropDiff);
    const meanTgtRed = n ? channelFingerprint.red.tgtRedSum / n : null;
    const tintReachedPixels = Number.isFinite(redDropDiff) && redDropDiff < THRESHOLDS.maxRedDropDiff;
    tintFingerprint = {
      redMae: { identityVsIdentity: round3(idVsId), wrongVsIdentity: round3(wrongVsId), meanTargetRed: round3(meanTgtRed) },
      redDropDiff: round3(redDropDiff),
      maxRedDropDiff: THRESHOLDS.maxRedDropDiff,
      tintReachedPixels,
      evidence: "错误 tint 到达像素：V1 红通道相对绿通道的额外压降 redDropDiff 显著为负（红通道被错误 tint 压低）",
    };
    // 标定模式（--tint-pair）下 redDropDiff 不作为失败依据，只记录供阈值标定。
    if (calibrationMode) {
      tintFingerprint.calibrationOnly = true;
    }
    // tint 到达像素（即 tint 被改错）必须让逐槽正式 Gate 自然 false（真实拒绝证据）。
    // 标定模式下跳过此失败（健康 redDropDiff≈0 是预期，只记录证据不判错）。
    if (tintReachedPixels && !calibrationMode) metricFailureReasons.push("tintFingerprint(redDropDiff=" + round3(redDropDiff) + "<" + THRESHOLDS.maxRedDropDiff + ",红通道相对绿通道被额外压低,tint 被改错)");
  }
  const metricGateFinal = metricFailureReasons.length === 0;
  return {
    slot, materialName, materialId, triUvSourceSlot: slot, targetTriUvSourceSlot: targetSlot,
    targetBinding: { materialSlot: slot, materialId, triUvMaterialId: Number(info.materialId), targetTriUvSourceSlot: targetSlot, targetTriUvMaterialId: targetMaterialId, targetSamples: targetStream.length, consistent: targetBindingConsistent, inputsValid, mode: swapTargetSlot && swapTargetSlot !== slot ? "swapped-negative" : "same-material" },
    samples: samples.length, targetSamples: targetStream.length, roiPixels, materialForegroundPixels, triUvResolvedPixels,
    rejectedNoTriUv, rejectedInvalidTri, rejectedBarycentric,
    triUvResolution: +triUvResolution.toFixed(6), coverage: +coverage.toFixed(6),
    v1Mae: round3(v1Mae), p95: { v1: round3(v1P95), v1ByChannel: v1Channel.map((c) => round3(percentile95(c))) },
    tintFingerprint,
    metricGate: metricGateFinal, formalGate: metricGateFinal, metricFailureReasons,
    target: { texture: FACE_TEX, sampling: "bilinear-linear-face_d-then-identity-tint-then-srgb-display", formula: "targetDisplay(uv)=linearToSrgb(bilinear(srgbToLinear(face_d,uv))*V14D_BROWS_LASHES_TINT)" },
  };
}

// Lashes 透明边缘专门 Gate：按 face_d alpha 把 Lashes 前景样本分核心/边缘/透明三区，
// 核对生产可见性（materialId 前景）与权威 alphaThreshold cutout 一致性 + 边缘颜色误差。
// Lashes 透明边缘专门 Gate（Stage 2C-M2a 第二次修正轮：屏幕空间边界环口径）。
// 分母 = production material-ID 前景掩码的 4-邻域形态学边界环（前景像素中至少一个
// 4-邻邻居不是该槽前景）。该环非空且随裁切口径变化：wrongAlpha（专用 fault tag → 引擎
// prelude 在 discard 前把 alpha 乘故障因子 权威 1e-7）真实剔除片元、mask 收缩、边界环像素数
// 与边缘色分布改变 → 自然拒绝。
// 黑边=边界环暗像素(lum<25)占比超限；白边=亮像素(lum>235)占比超限；整槽消失=环塌缩
// （edgeBoundary<minEdgeBoundaryPixels 或 lashesForeground=0）。
function lashesAlphaEdge({ capture, materialMask, lashesId, v1Image, faceTex, W, H, faceRoi, wrongAlpha }) {
  const materialName = "Lashes";
  const info = slotInfo(capture, materialName);
  if (!info) return { error: "missing lashes triUV" };
  const threshold = V14D_BROWS_LASHES_ALPHA_THRESHOLD;
  // 1) 生产可见性前景掩码（materialId 命中即该像素由 Lashes 渲染）。
  const fg = new Uint8Array(W * H);
  let lashesForeground = 0;
  for (let p = 0; p < W * H; p += 1) {
    const i = p * 4;
    if (materialMask.data[i] !== 0 && materialMask.data[i + 1] === lashesId) { fg[p] = 1; lashesForeground += 1; }
  }
  // 2) 4-邻域形态学边界环：前景像素中至少一个邻居非前景。
  const edgePixels = [];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const p = y * W + x;
    if (!fg[p]) continue;
    const left = x > 0 ? fg[p - 1] : 0;
    const right = x < W - 1 ? fg[p + 1] : 0;
    const up = y > 0 ? fg[p - W] : 0;
    const down = y < H - 1 ? fg[p + W] : 0;
    if (left + right + up + down < 4) edgePixels.push(p);
  }
  // 3) 边界环上的颜色统计（黑边/白边/边缘色误差）+ 纹理 alpha 参考记录。
  let blackFrame = 0, whiteFringe = 0;
  const edgeErrors = [];
  const edgeLums = [];
  const visibleAlphas = [];
  for (const p of edgePixels) {
    const i = p * 4;
    const px = [v1Image.data[i], v1Image.data[i + 1], v1Image.data[i + 2]];
    const lum = (px[0] + px[1] + px[2]) / 3;
    edgeLums.push(lum);
    if (lum < 25) blackFrame += 1;
    if (lum > 235) whiteFringe += 1;
    // triUV 合法的边界像素才计入边缘色误差与 alpha 记录。
    if (!info.triMask?.[p]) continue;
    const triId = Number(info.triId?.[p]);
    const u = Number(info.uv?.[p * 2]);
    const v = Number(info.uv?.[p * 2 + 1]);
    if (!Number.isInteger(triId) || triId < 0 || triId >= Number(info.triangleCount)) continue;
    if (!barycentricInside(barycentricForTriangleUv(u, v, slotTriangleUvs(info, triId)))) continue;
    const a = sampleFaceAlpha(faceTex, u, v);
    visibleAlphas.push(a);
    const rgbLinear = sampleHairTextureLinear(faceTex, u, v);
    const target = v14dBrowsLashesTargetDisplayFromLinear(rgbLinear);
    edgeErrors.push(px.reduce((s, val, c) => s + Math.abs(val - target[c]), 0) / 3);
  }
  const edgeCount = edgePixels.length;
  const edgeMae = edgeErrors.length ? edgeErrors.reduce((s, v) => s + v, 0) / edgeErrors.length : 0;
  const minAlpha = visibleAlphas.length ? Math.min(...visibleAlphas) : null;
  const darkRatio = edgeCount > 0 ? blackFrame / edgeCount : 0;
  const brightRatio = edgeCount > 0 ? whiteFringe / edgeCount : 0;
  const failures = [];
  // 整槽消失：前景=0 或边界环塌缩（槽太小/被剔除→环像素数低于下限）。
  if (lashesForeground < 1) failures.push("lashesForeground=0(整槽消失)");
  if (edgeCount < THRESHOLDS.minEdgeBoundaryPixels) failures.push("edgeBoundary=" + edgeCount + "<" + THRESHOLDS.minEdgeBoundaryPixels + "(边界环塌缩,整槽消失/极端裁切风险)");
  // 黑边：边界环暗像素占比超限。
  if (darkRatio > THRESHOLDS.maxEdgeDarkRatio) failures.push("edgeDarkRatio=" + round3(darkRatio) + ">" + THRESHOLDS.maxEdgeDarkRatio + "(黑边风险)");
  // 白边：边界环亮像素占比超限。
  if (brightRatio > THRESHOLDS.maxEdgeBrightRatio) failures.push("edgeBrightRatio=" + round3(brightRatio) + ">" + THRESHOLDS.maxEdgeBrightRatio + "(白边风险)");
  // 边缘色误差（仅在有 triUV 合法样本时判定）。
  if (edgeErrors.length >= 1 && !(edgeMae <= THRESHOLDS.lashesEdgeMae)) failures.push("edgeMae>" + THRESHOLDS.lashesEdgeMae + " (" + round3(edgeMae) + ")");
  return {
    materialName, lashesForeground,
    edgeBoundaryPixels: edgeCount,
    boundaryRingDenominator: { edgeBoundary: edgeCount, foreground: lashesForeground },
    edgeDarkRatio: round3(darkRatio), edgeBrightRatio: round3(brightRatio),
    edgeMae: round3(edgeMae), edgeP95: round3(percentile95(edgeErrors)),
    blackFrameCount: blackFrame, whiteFringeCount: whiteFringe,
    minVisibleAlpha: round3(minAlpha),
    alphaThreshold: threshold, authorityAlphaThreshold: V14D_BROWS_LASHES_ALPHA_THRESHOLD,
    edgeBoundaryCalibratedFrom: "production material-id 4-neighbour boundary ring (130 px/closeup frame)",
    failures, gate: failures.length === 0,
  };
}

export async function runBrowsLashesAnalysis(argv) {
  const negWrongTint = argv.includes("--neg-wrongtint");
  const negSwap = argv.includes("--neg-swap-slot-target");
  const negWrongAlpha = argv.includes("--neg-wrong-alpha");
  // P0 整槽消失负测（Stage 2C-M2a 修正轮）：--neg-missing-slot=missing-brows|missing-lashes
  // 读取该扰动下独立采集的画布/mask/triUV，消失槽样本<下限 → 正式逐槽 Gate 非零拒绝。
  const missingSlotArg = argv.find((a) => a.startsWith("--neg-missing-slot="));
  const negMissingSlot = missingSlotArg ? missingSlotArg.slice("--neg-missing-slot=".length) : null;
  // 标定模式：读 --tint-pair=FILE 指定的 second-redMae 画布作为 V1（健康恒等 tint 的
  // 独立重复采集），通道指纹只记录 baselineShift 证据、不触发失败。用于 P1 阈值标定。
  const tintPairArg = argv.find((a) => a.startsWith("--tint-pair="));
  const calibrationMode = Boolean(tintPairArg);
  const tintPairFile = calibrationMode ? path.join(OUT, tintPairArg.slice("--tint-pair=".length)) : null;
  const ORIG = path.join(OUT, "g3-brows-lashes-original-canvas.png");
  const V1 = calibrationMode ? tintPairFile : negWrongTint ? path.join(OUT, "g3-brows-lashes-v1-canvas-wrongtint.png") : negWrongAlpha ? path.join(OUT, "g3-brows-lashes-v1-canvas-wrong-alpha.png") : path.join(OUT, "g3-brows-lashes-v1-canvas.png");
  // 负测 mask/triUV 必须用各自扰动采集的独立文件；缺失则记 analysisFailures 并拒绝
  // （Stage 2C-M2a 修正轮：不再静默回退到健康 mask，避免「负测被健康证据洗白」）。
  const MASK = negWrongAlpha ? path.join(OUT, "g3-brows-lashes-material-mask-wrong-alpha.png") : path.join(OUT, "g3-brows-lashes-material-mask.png");
  const TRIUV = negWrongTint
    ? path.join(OUT, "g3-brows-lashes-tri-uv-wrongtint.json")
    : negWrongAlpha
    ? path.join(OUT, "g3-brows-lashes-tri-uv-wrong-alpha.json")
    : negMissingSlot
    ? path.join(OUT, "g3-brows-lashes-tri-uv-" + negMissingSlot + ".json")
    : path.join(OUT, "g3-brows-lashes-tri-uv.json");
  const V1_MISS = negMissingSlot ? path.join(OUT, "g3-brows-lashes-v1-canvas-" + negMissingSlot + ".png") : V1;
  const MASK_MISS = negMissingSlot ? path.join(OUT, "g3-brows-lashes-material-mask-" + negMissingSlot + ".png") : MASK;
  const REPORT = calibrationMode
    ? path.join(OUT, "visual-diff-brows-lashes-" + path.basename(tintPairFile, ".png").replace(/^g3-brows-lashes-/, "").replace(/-canvas$/, "") + ".json")
    : negWrongTint
    ? path.join(OUT, "visual-diff-brows-lashes-wrongtint.json")
    : negSwap ? path.join(OUT, "visual-diff-brows-lashes-swap-slot-target.json")
    : negWrongAlpha ? path.join(OUT, "visual-diff-brows-lashes-wrong-alpha.json")
    : negMissingSlot ? path.join(OUT, "visual-diff-brows-lashes-" + negMissingSlot + ".json")
    : path.join(OUT, "visual-diff-brows-lashes.json");
  const out = { width: 0, height: 0, thresholds: THRESHOLDS, regions: {}, verdict: {}, failures: [], analysisFailures: [] };
  try {
    if (!fs.existsSync(ORIG) || !fs.existsSync(V1_MISS) || !fs.existsSync(MASK_MISS) || !fs.existsSync(TRIUV)) {
      out.analysisFailures.push("missing artifacts: " + [ORIG, V1_MISS, MASK_MISS, TRIUV].filter((p) => !fs.existsSync(p)).join(","));
      throw new Error("missing artifacts");
    }
    const origImage = await loadRaw(ORIG);
    const v1Image = await loadRaw(V1_MISS);
    const materialMask = await loadRaw(MASK_MISS);
    const capture = JSON.parse(fs.readFileSync(TRIUV, "utf8"));
    const W = origImage.width, H = origImage.height;
    out.width = W; out.height = H;
    if (v1Image.width !== W || v1Image.height !== H || materialMask.width !== W || materialMask.height !== H || capture.width !== W || capture.height !== H) {
      out.analysisFailures.push("size mismatch");
      throw new Error("size mismatch");
    }
    const faceTex = await loadFaceTexture();
    const materialIdByName = capture.materialIdByName || {};
    const browsId = Number(materialIdByName.Brows);
    const lashesId = Number(materialIdByName.Lashes);
    if (!Number.isInteger(browsId) || browsId <= 0 || !Number.isInteger(lashesId) || lashesId <= 0 || browsId === lashesId) {
      out.analysisFailures.push("invalid materialIdByName for Brows/Lashes");
      throw new Error("invalid material ids");
    }
    // 脸部近景 ROI（全脸，与 cameraOrbit front 取景一致）：恒等槽需要足够样本。
    const faceRoi = { x0: Math.floor(W * 0.2), y0: 0, x1: Math.ceil(W * 0.8), y1: Math.floor(H * 0.45) };
    const swapInfo = { brows: { materialId: browsId, materialName: "Brows" }, lashes: { materialId: lashesId, materialName: "Lashes" } };
    for (const { slot, materialName } of V14D_BROWS_LASHES_SLOTS) {
      const materialId = slot === "brows" ? browsId : lashesId;
      const swapTargetSlot = negSwap ? (slot === "brows" ? "lashes" : "brows") : null;
      const conv = slotIdentityTarget({ slot, materialName, materialId, capture, materialMask, origImage, v1Image, faceTex, W, H, faceRoi, swapTargetSlot, swapCaptureInfo: swapInfo, wrongTintFingerprint: negWrongTint, calibrationMode });
      out.regions[slot] = { targetConvergence: conv };
      if (conv.error) { out.failures.push(slot + " 目标收敛判定样本不足: " + conv.error); out.verdict[slot + "TargetConverged"] = false; continue; }
      const converged = conv.formalGate === true && conv.targetBinding?.consistent === true && conv.targetBinding?.inputsValid === true;
      out.verdict[slot + "TargetConverged"] = converged;
      if (!converged) out.failures.push(slot + " 未向权威 face_d 恒等目标收敛 v1Mae=" + conv.v1Mae + " p95=" + conv.p95?.v1 + " targetBinding=" + (conv.targetBinding?.consistent ? "consistent" : "mismatch") + " metricFailures=" + (conv.metricFailureReasons?.join(",") || "none"));
    }
    // 逐槽 UV 取证图 + 差异图（P1 视觉产物）：original/V1/target/diff/alpha-edge。
    // 把脸部近景 ROI 的该槽像素抠出成四张图，便于审查。整槽消失负测（--neg-missing-slot）
    // 跳过此可视化（消失槽 mask 像素数与画布尺寸不一致会污染 artifact，判定只用正式 Gate）。
    if (!negMissingSlot) try {
      for (const { slot, materialName } of V14D_BROWS_LASHES_SLOTS) {
        const materialId = slot === "brows" ? browsId : lashesId;
        const info = slotInfo(capture, materialName);
        const rw = faceRoi.x1 - faceRoi.x0, rh = faceRoi.y1 - faceRoi.y0;
        const mk = () => Buffer.alloc(rw * rh * 4);
        const oPx = mk(), vPx = mk(), tPx = mk(), dPx = mk();
        for (let y = faceRoi.y0; y < faceRoi.y1; y += 1) for (let x = faceRoi.x0; x < faceRoi.x1; x += 1) {
          const gi = (y * W + x) * 4;
          if (materialMask.data[gi] === 0 || materialMask.data[gi + 1] !== materialId) continue;
          const o = ((y - faceRoi.y0) * rw + (x - faceRoi.x0)) * 4;
          oPx[o] = origImage.data[gi]; oPx[o + 1] = origImage.data[gi + 1]; oPx[o + 2] = origImage.data[gi + 2]; oPx[o + 3] = 255;
          vPx[o] = v1Image.data[gi]; vPx[o + 1] = v1Image.data[gi + 1]; vPx[o + 2] = v1Image.data[gi + 2]; vPx[o + 3] = 255;
          let t = [0, 0, 0];
          if (info?.triMask?.[y * W + x]) {
            const triId = Number(info.triId?.[y * W + x]);
            const u = Number(info.uv?.[(y * W + x) * 2]);
            const v = Number(info.uv?.[(y * W + x) * 2 + 1]);
            if (Number.isInteger(triId) && Number.isFinite(u) && Number.isFinite(v)) t = v14dBrowsLashesTargetDisplayFromLinear(sampleHairTextureLinear(faceTex, u, v));
          }
          tPx[o] = t[0]; tPx[o + 1] = t[1]; tPx[o + 2] = t[2]; tPx[o + 3] = 255;
          const dd = Math.min(255, Math.round(((Math.abs(oPx[o] - t[0]) + Math.abs(oPx[o + 1] - t[1]) + Math.abs(oPx[o + 2] - t[2])) / 3) * 2));
          dPx[o] = dd; dPx[o + 1] = dd; dPx[o + 2] = dd; dPx[o + 3] = 255;
        }
        const raw = { width: rw, height: rh, channels: 4 };
        await sharp(oPx, { raw }).png().toFile(path.join(OUT, "g3-" + slot + "-original.png"));
        await sharp(vPx, { raw }).png().toFile(path.join(OUT, "g3-" + slot + "-v1.png"));
        await sharp(tPx, { raw }).png().toFile(path.join(OUT, "g3-" + slot + "-target.png"));
        await sharp(dPx, { raw }).png().toFile(path.join(OUT, "g3-" + slot + "-diff.png"));
        out.regions[slot].artifacts = { original: "g3-" + slot + "-original.png", v1: "g3-" + slot + "-v1.png", target: "g3-" + slot + "-target.png", diff: "g3-" + slot + "-diff.png" };
      }
    } catch (e) { out.artifactError = String(e); }
    // Lashes 透明边缘专门 Gate。整槽消失负测下消失槽无前景（样本<下限已由逐槽 Gate 拒绝），
    // alpha-edge 在 missingLashes 下分母塌缩属预期；为聚焦「逐槽消失」单变量，跳过该可视化 Gate。
    if (!negMissingSlot) {
      const alphaEdge = lashesAlphaEdge({ capture, materialMask, lashesId, v1Image, faceTex, W, H, faceRoi });
      out.lashesAlphaEdge = alphaEdge;
      if (alphaEdge.error) out.failures.push("lashes alpha-edge 判定不可用: " + alphaEdge.error);
      else if (alphaEdge.gate !== true) out.failures.push("lashes 透明边缘 Gate 未通过 " + (alphaEdge.failures?.join(";") || ""));
    }
    // Lashes alpha-edge 证据图：按 face_d alpha 三区着色（核心=绿/边缘=黄/透明区=红）。
    if (!negMissingSlot) try {
      const rw = faceRoi.x1 - faceRoi.x0, rh = faceRoi.y1 - faceRoi.y0;
      const ePx = Buffer.alloc(rw * rh * 4);
      const info = slotInfo(capture, "Lashes");
      for (let y = faceRoi.y0; y < faceRoi.y1; y += 1) for (let x = faceRoi.x0; x < faceRoi.x1; x += 1) {
        const gi = (y * W + x) * 4;
        if (materialMask.data[gi] === 0 || materialMask.data[gi + 1] !== lashesId) continue;
        const o = ((y - faceRoi.y0) * rw + (x - faceRoi.x0)) * 4;
        let col = [128, 128, 128];
        if (info?.triMask?.[y * W + x]) {
          const triId = Number(info.triId?.[y * W + x]);
          const u = Number(info.uv?.[(y * W + x) * 2]);
          const v = Number(info.uv?.[(y * W + x) * 2 + 1]);
          if (Number.isInteger(triId) && Number.isFinite(u) && Number.isFinite(v)) {
            const a = sampleFaceAlpha(faceTex, u, v);
            col = a >= V14D_BROWS_LASHES_ALPHA_THRESHOLD + 0.15 ? [0, 200, 0] : a >= V14D_BROWS_LASHES_ALPHA_THRESHOLD - 0.15 ? [220, 200, 0] : [220, 0, 0];
          }
        }
        ePx[o] = col[0]; ePx[o + 1] = col[1]; ePx[o + 2] = col[2]; ePx[o + 3] = 255;
      }
      await sharp(ePx, { raw: { width: rw, height: rh, channels: 4 } }).png().toFile(path.join(OUT, "g3-lashes-alpha-edge.png"));
      out.lashesAlphaEdge.artifact = "g3-lashes-alpha-edge.png";
    } catch (e) { out.lashesAlphaEdge.artifactError = String(e); }

    // 正式组合 Gate。整槽消失负测不纳入 alpha-edge（分母塌缩属预期，单变量聚焦逐槽消失）。
    const browsPass = out.verdict.browsTargetConverged === true;
    const lashesPass = out.verdict.lashesTargetConverged === true;
    const formalTargetGate = { brows: browsPass, lashes: lashesPass };
    out.browsLashesFormalGate = {
      authority: "material-id+atomic-triuv+identity-target-convergence+lashes-alpha-edge",
      pass: browsPass && lashesPass && (negMissingSlot ? true : out.lashesAlphaEdge?.gate === true),
      formalTargetGate,
      lashesAlphaEdgeGate: negMissingSlot ? null : (out.lashesAlphaEdge?.gate === true),
    };
    for (const slot of ["brows", "lashes"]) {
      if (formalTargetGate[slot] === true) continue;
      if (!out.failures.some((f) => f.startsWith(slot + " "))) out.failures.push(slot + " 正式 Brows/Lashes Gate 未通过（需 identity-target 收敛 + 合法同槽输入）");
    }
    out.pass = out.failures.length === 0 && out.analysisFailures.length === 0;
    // 整槽消失负测（Stage 2C-M2a M2a.4 修正）：missing 扰动把该槽从 V1 composite 移除并回塞
    // 原 K3 face 分组。关键口径：missing 槽仍在同一 mesh 上被 material-ID pick 栅格化
    // （foreground 不因移除 composite 而塌缩，恒等 tint 下 face graph 渲染也与 target 一致），
    // 因此「该槽是否命中 V1 composite」是唯一可靠判别信号。accept 在 missing 采集时把
    // 该槽 applied.onComposite 写入 tri-uv JSON（compositeOnBySlot），=0 即自然检出。
    if (negMissingSlot) {
      const missingSlot = negMissingSlot === "missing-brows" ? "brows" : "lashes";
      const otherSlot = missingSlot === "brows" ? "lashes" : "brows";
      const missTc = out.regions[missingSlot]?.targetConvergence;
      const otherTc = out.regions[otherSlot]?.targetConvergence;
      // compositeOnBySlot：accept 在 missing 采集时写入的每槽 OnComposite 标记（1=命中 V1 composite，
      // 0=被 missing 扰动移除）。missing 槽 OnComposite=0 → 该槽未走 V1 composite → 正式 Gate 拒绝。
      // 若 capture 未带该标记（旧采集），回退用前景塌缩/正式 Gate 失败判别，保持兼容。
      const onBySlot = capture.compositeOnBySlot || null;
      const missOn = onBySlot ? Number(onBySlot[missingSlot]) : null;
      const otherOn = onBySlot ? Number(onBySlot[otherSlot]) : null;
      const compositeProvedMissing = missOn === 0 && otherOn === 1;
      const missFg = missTc?.materialForegroundPixels ?? 0;
      const missingCollapsed = compositeProvedMissing
        || (!onBySlot && (missTc?.metricGate === false || missTc?.formalGate === false));
      const otherHealthy = otherTc?.formalGate === true;
      const rejected = missingCollapsed && otherHealthy && out.analysisFailures.length === 0;
      // 自然拒绝：把 missing 槽 formalTargetGate 标为 false（消失槽不应通过正式 Gate），并记 failure。
      if (missingCollapsed) {
        out.browsLashesFormalGate.formalTargetGate[missingSlot] = false;
        if (!out.failures.some((f) => f.startsWith(missingSlot + " "))) out.failures.push(missingSlot + " 整槽消失：missing 槽 OnComposite=0 未命中 V1 composite（missing 扰动自然检出）");
      }
      out.negativeVerdict = {
        mode: negMissingSlot, status: rejected ? "rejected" : "failed", rejected, expectedExit: 1,
        missingSlot, otherSlot, missingForeground: missFg, otherForeground: otherTc?.materialForegroundPixels ?? null,
        compositeOnBySlot: onBySlot, compositeProvedMissing, missingCollapsed, otherHealthy,
        formalTargetGate: { brows: out.browsLashesFormalGate.formalTargetGate.brows, lashes: out.browsLashesFormalGate.formalTargetGate.lashes },
      };
      out.pass = out.failures.length === 0 && out.analysisFailures.length === 0;
    }

    // 负测判定（自然拒绝、非配置包装）。
    if (negWrongTint || negSwap || negWrongAlpha) {
      const mode = negWrongTint ? "wrongTint" : negSwap ? "swapSlotTarget" : "wrongAlpha";
      const browsTc = out.regions.brows?.targetConvergence;
      const lashesTc = out.regions.lashes?.targetConvergence;
      const formalReject = out.browsLashesFormalGate.formalTargetGate.brows === false && out.browsLashesFormalGate.formalTargetGate.lashes === false;
      const naturalMetricReject = browsTc?.metricGate === false && lashesTc?.metricGate === false;
      const inputsValid = browsTc?.targetBinding?.inputsValid === true && lashesTc?.targetBinding?.inputsValid === true;
      const alphaRejected = negWrongAlpha ? out.lashesAlphaEdge?.gate === false : true;
      // wrongTint 保持预期 exit=0（与 hair 一致）；swap 必须 exit 非零证明阻断；
      // wrongAlpha 必须 exit 非零（真实浏览器链对错误 alpha 口径自然拒绝）。
      const expectedExit = negWrongTint ? 0 : 1;
      // Stage 2C-M2a 收尾：wrongAlpha 只针对 alpha 口径（两槽 identity-target 恒等
      // tint 不受 alpha 模式影响、仍收敛 true），因此拒绝证据 = alpha-edge Gate 自然
      // false（错误 alpha 口径被检出）+ 无配置/样本/分析异常（analysisFailures=[]）。
      // wrongTint/swap 仍需两槽 identity-target 正式 Gate 自然 false + 输入合法。
      const rejected = negWrongAlpha
        ? alphaRejected && out.analysisFailures.length === 0
        : formalReject && naturalMetricReject && inputsValid && out.analysisFailures.length === 0;
      out.negativeVerdict = {
        mode, status: rejected ? "rejected" : "failed", rejected, expectedExit,
        formalTargetGate: { brows: out.browsLashesFormalGate.formalTargetGate.brows, lashes: out.browsLashesFormalGate.formalTargetGate.lashes },
        naturalMetricGate: { brows: browsTc?.metricGate ?? null, lashes: lashesTc?.metricGate ?? null },
        bindingInputsValid: { brows: browsTc?.targetBinding?.inputsValid ?? null, lashes: lashesTc?.targetBinding?.inputsValid ?? null },
        lashesAlphaEdgeGate: out.lashesAlphaEdge?.gate ?? null,
        semanticMismatch: negSwap,
        analysisFailures: out.analysisFailures,
      };
      if (negWrongTint && rejected) {
        // 与 hair wrongTint 协议一致：把预期的两槽收敛失败从 failures 移除，exit=0。
        out.failures = out.failures.filter((f) => !(f.startsWith("brows ") || f.startsWith("lashes ") || f.startsWith("brows 正式") || f.startsWith("lashes 正式")));
        out.pass = out.failures.length === 0 && out.analysisFailures.length === 0;
      }
    }
  } catch (e) {
    if (!out.analysisFailures.length) out.analysisFailures.push(String(e?.message || e));
    out.pass = false;
    out.error = String(e?.message || e);
  }
  fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ pass: out.pass, verdict: out.verdict, browsLashesFormalGate: out.browsLashesFormalGate ?? null, lashesAlphaEdge: out.lashesAlphaEdge ? { gate: out.lashesAlphaEdge.gate, failures: out.lashesAlphaEdge.failures } : null, negativeVerdict: out.negativeVerdict ?? null, failures: out.failures, analysisFailures: out.analysisFailures }, null, 2));
  if (!out.pass) { console.error("===BROWS-LASHES-GATE-FAIL==="); return 1; }
  console.log(out.negativeVerdict ? "===BROWS-LASHES-NEGATIVE-REJECTED===" : "===BROWS-LASHES-GATE-OK===");
  return 0;
}
