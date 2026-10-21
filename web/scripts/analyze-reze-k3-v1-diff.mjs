// G3+新视觉 Gate 分析：Scene invariance + Material-only calibration + 隔离 + 收敛。
// 以退出码硬阻断：任一区域判定失败 → exit 1。报告写 visual-diff.json。
//
// 采样口径（诚实测量，区分真实改写与重建噪声）：
//  - 皮肤区（face/neck/hand）：只对「皮肤掩码像素」求 MAE/meanDiff。手部在全身画布中
//    皮肤像素占比 <2%，不掩码会被外套/背景稀释成假阴性。掩码是经典肤色判别（isSkin）。
//  - 非皮肤区（hair/clothes/gear）：剔除皮肤像素。用 meanMeanDiff（平均色偏）+ 超阈像素
//    占比判定，而非 maxMeanDiff——后者会被材质过渡边界的少量重建光栅噪声（亚像素偏移）
//    放大成假阳性。实测 original 连拍基线噪声 maxMeanDiff≈0.13、meanMeanDiff≈0.02；
//    original→V1 的材质边界噪声把 meanMeanDiff 推到 ~0.3 量级，真实材质改写会 >1。
//  - 背景区（skyTL/skyTR）：星空背景绝大多数像素 alpha=0 且近黑（lum<30），亮点是稀疏
//    星星（闪烁噪声）。只对「暗空多数像素（双图 lum<30）」求 meanDiff，断言 V1 不改写
//    K3 灯光/星空背景。亮星像素被显式排除（避免把星星闪烁误判为场景重写）。
import sharp from "sharp";
import fs from "node:fs"; import path from "node:path";
import crypto from "node:crypto";
import {
  barycentricForTriangleUv,
  barycentricInside,
  buildHairUvGridFromPmx,
  classifyHairPixel,
  sampleHairTextureLinear,
  srgbByteToLinear,
  v14dHairTargetDisplay,
  v14dHairTargetDisplayFromLinear,
} from "../src/features/stage/v14dHairPartition.js";
import {
  V14D_BROWS_LASHES_ALPHA_THRESHOLD,
  V14D_BROWS_LASHES_SLOTS,
  V14D_BROWS_LASHES_TEXTURE_NAME,
  v14dBrowsLashesTargetDisplayFromLinear,
} from "../src/features/stage/v14dBrowsLashesTarget.js";

// Stage 2C-M2a 修正轮：Brows/Lashes 逐槽 identity-target Gate（独立 lane）。
// --brows-lashes 只消费 Brows/Lashes 原子同帧证据与 face_d 权威目标，输出独立
// 报告 visual-diff-brows-lashes.json；--neg-wrongtint / --neg-swap-slot-target
// 在该 lane 内分别读 wrongtint 画布/交换 Brows↔Lashes target/triUV 归属。
const NEG_BROWS_LASHES = process.argv.includes("--brows-lashes");
if (NEG_BROWS_LASHES) {
  const mod = await import("./analyze-v14d-brows-lashes.mjs");
  const code = await mod.runBrowsLashesAnalysis(process.argv);
  process.exit(code);
}

const V14D_HAIR_FORMAL_GATE_AUTHORITY = "material-id+atomic-triuv+slot-changed+target-convergence";

/**
 * HairA/HairB 正式 Gate 的唯一组合判定。
 *
 * legacy aggregate hair ROI 只能作为诊断输入，不能影响 pass；正式槽必须同时
 * 满足「槽确实变化」与「同槽 materialId/原子 triUV 输入合法且目标指标收敛」。
 * 该函数保持纯函数，既由 analyzer 消费，也由 --self-test-hair-gate 验证。
 */
export function evaluateV14dHairFormalGate({
  hairAChanged,
  hairBChanged,
  hairA,
  hairB,
  legacyAggregate = null,
} = {}) {
  const evaluateSlot = (changed, targetConvergence) => {
    const changedPass = changed === true;
    const targetConvergencePass = targetConvergence?.formalGate === true
      && targetConvergence?.targetBinding?.consistent === true
      && targetConvergence?.targetBinding?.inputsValid === true;
    return {
      changed: changedPass,
      targetConvergence: targetConvergencePass,
      pass: changedPass && targetConvergencePass,
    };
  };
  const slots = {
    hairA: evaluateSlot(hairAChanged, hairA),
    hairB: evaluateSlot(hairBChanged, hairB),
  };
  return {
    authority: V14D_HAIR_FORMAL_GATE_AUTHORITY,
    pass: slots.hairA.pass && slots.hairB.pass,
    formalTargetGate: { hairA: slots.hairA.pass, hairB: slots.hairB.pass },
    slots,
    legacyAggregateDiagnostic: {
      present: legacyAggregate !== null && legacyAggregate !== undefined,
      ignored: true,
    },
  };
}

/**
 * 负测只把「正式 Gate 自然拒绝、输入仍合法、没有其他分析异常」认作预期拒绝。
 * wrongTint 预期 exit=0，swap-slot-target 预期 exit=1；两者不能靠缺样本或
 * analysisFailures 伪造通过。
 */
export function evaluateV14dHairNegativeProtocol({
  mode,
  formalTargetGate,
  hairA,
  hairB,
  analysisFailures,
} = {}) {
  const naturalMetricGate = {
    hairA: hairA?.metricGate === true,
    hairB: hairB?.metricGate === true,
  };
  const bindingInputsValid = {
    hairA: hairA?.targetBinding?.inputsValid === true,
    hairB: hairB?.targetBinding?.inputsValid === true,
  };
  const formalReject = formalTargetGate?.hairA === false && formalTargetGate?.hairB === false;
  const naturalMetricReject = naturalMetricGate.hairA === false && naturalMetricGate.hairB === false;
  const validNegativeInputs = bindingInputsValid.hairA && bindingInputsValid.hairB;
  const noAnalysisFailures = Array.isArray(analysisFailures) && analysisFailures.length === 0;
  const rejected = formalReject && naturalMetricReject && validNegativeInputs && noAnalysisFailures;
  return {
    mode,
    status: rejected ? "rejected" : "failed",
    rejected,
    expectedExit: mode === "wrongTint" ? 0 : 1,
    formalTargetGate: { hairA: formalTargetGate?.hairA ?? null, hairB: formalTargetGate?.hairB ?? null },
    naturalMetricGate,
    bindingInputsValid,
    analysisFailures: Array.isArray(analysisFailures) ? analysisFailures : null,
  };
}

if (process.argv.includes("--self-test-hair-gate")) {
  const passingTarget = {
    formalGate: true,
    targetBinding: { consistent: true, inputsValid: true },
    metricGate: true,
  };
  const failingTarget = {
    formalGate: false,
    targetBinding: { consistent: true, inputsValid: true },
    metricGate: false,
  };
  const healthy = evaluateV14dHairFormalGate({
    hairAChanged: true,
    hairBChanged: true,
    hairA: passingTarget,
    hairB: passingTarget,
    legacyAggregate: { mae: 0.388, maxMeanDiff: 1 },
  });
  const changedFailure = evaluateV14dHairFormalGate({
    hairAChanged: false,
    hairBChanged: true,
    hairA: passingTarget,
    hairB: passingTarget,
  });
  const targetConvergenceFailure = evaluateV14dHairFormalGate({
    hairAChanged: true,
    hairBChanged: true,
    hairA: passingTarget,
    hairB: failingTarget,
  });
  const negativeInput = { metricGate: false, targetBinding: { inputsValid: true } };
  const swapNegative = evaluateV14dHairNegativeProtocol({
    mode: "swapSlotTarget",
    formalTargetGate: { hairA: false, hairB: false },
    hairA: negativeInput,
    hairB: negativeInput,
    analysisFailures: [],
  });
  const wrongTintNegative = evaluateV14dHairNegativeProtocol({
    mode: "wrongTint",
    formalTargetGate: { hairA: false, hairB: false },
    hairA: negativeInput,
    hairB: negativeInput,
    analysisFailures: [],
  });
  console.log(JSON.stringify({
    healthyWithLegacyAggregateFailure: {
      pass: healthy.pass,
      formalTargetGate: healthy.formalTargetGate,
      legacyAggregateIgnored: healthy.legacyAggregateDiagnostic.ignored,
    },
    changedFailure: { pass: changedFailure.pass, formalTargetGate: changedFailure.formalTargetGate },
    targetConvergenceFailure: { pass: targetConvergenceFailure.pass, formalTargetGate: targetConvergenceFailure.formalTargetGate },
    swapNegative: { status: swapNegative.status, expectedExit: swapNegative.expectedExit, analysisFailures: swapNegative.analysisFailures },
    wrongTintNegative: { status: wrongTintNegative.status, expectedExit: wrongTintNegative.expectedExit, analysisFailures: wrongTintNegative.analysisFailures },
  }));
  process.exit(0);
}

const OUT = path.resolve(process.env.V14D_G7_OUT || ".scratch/reze-k3-v1-stage");
const ORIG = path.join(OUT, "g3-original-canvas.png");
const V1 = path.join(OUT, "g3-v1-canvas.png");
const FORMAL_HAIR_ORIG = path.join(OUT, "g3-hair-original-canvas.png");
const FORMAL_HAIR_V1 = path.join(OUT, "g3-hair-v1-canvas.png");
// 同变体连拍（original 第二帧，可选）：用于把 original↔V1 的衣服/装备差异与同变体
// 待机微动帧间噪声区分（Stage 2C-M1 噪声基线，防把微动误判为材质泄漏）。
const ORIG_B = path.join(OUT, "g3-original-canvas-b.png");
const HAIR_MASK = path.join(OUT, "g3-hair-material-mask.png");
const HAIR_MASK_META = path.join(OUT, "g3-hair-material-mask.json");
const HAIR_TRI_UV = path.join(OUT, "g3-hair-tri-uv.json");
const TARGET = process.env.V14D_TARGET || "C:\\w\\rk3-face-v14d\\.scratch\\v14d-face-static-derived\\blender-ref-finalFaceComposite.png";
// 负测模式（--neg-wrongtint / --neg-swap-slot-target）：读取 G3 负测画布或交换目标
// 归属，其余同正式口径。负测要求正式画布已存在，产出独立报告，不覆盖正式报告。
const NEG_WRONGTINT = process.argv.includes("--neg-wrongtint");
const NEG_SWAP_SLOT_TARGET = process.argv.includes("--neg-swap-slot-target");
const V1_ACTUAL = NEG_WRONGTINT ? path.join(OUT, "g3-v1-canvas-wrongtint.png") : V1;
// Hair 正式目标使用 probe 原子返回的同一冻结姿态画布；继承的 Face/BodySkin/
// 场景稳定性仍使用原有 A/B 画布。两条 lane 共享尺寸与同一验收运行，但不把
// 不同姿态的像素混入 Hair origMae/v1Mae。
// Hair 正式 lane 默认只消费原子 probe 产物；legacy g3-original/g3-v1 只服务
// Face/BodySkin/场景稳定性 lane。环境覆盖保留给显式诊断/夹具，不改变正式默认。
const HAIR_ORIG = process.env.V14D_HAIR_ORIG_CANVAS || FORMAL_HAIR_ORIG;
const HAIR_V1 = process.env.V14D_HAIR_V1_CANVAS || FORMAL_HAIR_V1;
const REPORT_JSON = NEG_WRONGTINT
  ? path.join(OUT, "visual-diff-wrongtint.json")
  : NEG_SWAP_SLOT_TARGET
    ? path.join(OUT, "visual-diff-swap-slot-target.json")
    : path.join(OUT, "visual-diff.json");
if (NEG_WRONGTINT && NEG_SWAP_SLOT_TARGET) {
  console.error("wrongtint 与 swap-slot-target 负测不能同时启用");
  process.exit(1);
}
if (!fs.existsSync(ORIG) || !fs.existsSync(V1)) { console.error("missing canvas pngs"); process.exit(1); }
if (!fs.existsSync(HAIR_ORIG) || !fs.existsSync(HAIR_V1)) {
  console.error("missing formal hair canvas pngs: " + HAIR_ORIG + " / " + HAIR_V1);
  process.exit(1);
}
if (NEG_WRONGTINT && !fs.existsSync(V1_ACTUAL)) { console.error("missing wrongtint canvas " + V1_ACTUAL); process.exit(1); }

async function loadRaw(p) { const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width, height: info.height }; }
const a = await loadRaw(ORIG);
// 负测只替换 HairA/HairB 的实际画布；其余正式 Gate 仍以健康 V1 画布为参照，
// 避免把 hair-only 扰动错误包装成 Face/场景 failure，同时保留其他 failure 的硬阻断。
const b = await loadRaw(V1);
const hairOrigImage = await loadRaw(HAIR_ORIG);
const hairV1Image = await loadRaw(HAIR_V1);
const hairActual = NEG_WRONGTINT ? await loadRaw(V1_ACTUAL) : hairV1Image;
if (a.width !== b.width || a.height !== b.height
  || hairOrigImage.width !== hairV1Image.width || hairOrigImage.height !== hairV1Image.height
  || hairOrigImage.width !== a.width || hairOrigImage.height !== a.height
  || hairActual.width !== hairOrigImage.width || hairActual.height !== hairOrigImage.height) { console.error("size mismatch"); process.exit(1); }
// 同变体连拍（可选）：original 第二帧，作为非皮肤「待机微动噪声基线」。
const a2 = fs.existsSync(ORIG_B) ? await loadRaw(ORIG_B) : null;
const W = a.width, H = a.height;
let materialMask = null;
let materialMaskMeta = null;
if (fs.existsSync(HAIR_MASK) && fs.existsSync(HAIR_MASK_META)) {
  try {
    materialMask = await loadRaw(HAIR_MASK);
    materialMaskMeta = JSON.parse(fs.readFileSync(HAIR_MASK_META, "utf8"));
    if (materialMask.width !== W || materialMask.height !== H) {
      materialMask = null;
      materialMaskMeta = { error: "material mask dimensions do not match canvas" };
    }
  } catch (error) {
    materialMask = null;
    materialMaskMeta = { error: error instanceof Error ? error.message : String(error) };
  }
}
let hairTriUvCapture = null;
let hairTriUvCaptureError = null;
if (fs.existsSync(HAIR_TRI_UV)) {
  try {
    hairTriUvCapture = JSON.parse(fs.readFileSync(HAIR_TRI_UV, "utf8"));
  } catch (error) {
    hairTriUvCaptureError = error instanceof Error ? error.message : String(error);
  }
}
const hairMaterialIds = {
  hairA: Number(hairTriUvCapture?.materialIdByName?.HairA ?? materialMaskMeta?.materialIdByName?.HairA),
  hairB: Number(hairTriUvCapture?.materialIdByName?.HairB ?? materialMaskMeta?.materialIdByName?.HairB),
};
const hairMaterialMaskReady = Boolean(
  materialMask && Number.isInteger(hairMaterialIds.hairA) && hairMaterialIds.hairA > 0
  && Number.isInteger(hairMaterialIds.hairB) && hairMaterialIds.hairB > 0
  && hairMaterialIds.hairA !== hairMaterialIds.hairB,
);
const hairTriUvCaptureReady = Boolean(
  hairTriUvCapture
  && hairTriUvCapture.source === "engine-pick-material-id-depth+expanded-tri-uv"
  && hairTriUvCapture.width === W
  && hairTriUvCapture.height === H
  && hairTriUvCapture.byMaterial?.HairA
  && hairTriUvCapture.byMaterial?.HairB,
);

function isSkin(r, g, bl) { const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); return r > 95 && g > 40 && bl > 20 && (mx - mn) > 15 && r > g && r > bl && Math.abs(r - g) > 8; }
const lum = (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3;

const regions = {
  face:      { x: 0.545, y: 0.13, w: 0.07, h: 0.10, kind: "skin" },
  neck:      { x: 0.555, y: 0.23, w: 0.05, h: 0.04, kind: "skin" },
  leftHand:  { x: 0.27,  y: 0.42, w: 0.10, h: 0.10, kind: "skin" },
  rightHand: { x: 0.63,  y: 0.42, w: 0.10, h: 0.10, kind: "skin" },
  waist:     { x: 0.50,  y: 0.50, w: 0.10, h: 0.06, kind: "skin", occluded: true }, // T 形被外套遮挡
  // Stage 2C-M1：HairA/HairB 已迁移为 V1 目标槽，从「必须稳定」改为「必须显著变化」
  // （kind: "hair"）。合并 hair ROI 保留（整头变化证据），另加 HairA 前刘海 /
  // HairB 后长发分区 ROI（full-frame 归一化坐标），各自独立判定，不用整头均值
  // 掩盖分区失败。其余非皮肤（衣服/装备/星空）仍必须稳定。
  hair:      { x: 0.53,  y: 0.0,  w: 0.10, h: 0.06, kind: "hair" },
  hairA:     { x: 0.30,  y: 0.02, w: 0.40, h: 0.24, kind: "hair", image: "g3-hair-front-orig.png", imageV1: "g3-hair-front-v1.png" }, // 前刘海近景
  hairB:     { x: 0.30,  y: 0.02, w: 0.40, h: 0.34, kind: "hair", image: "g3-hair-back-orig.png", imageV1: "g3-hair-back-v1.png" }, // 后长发近景
  // Stage 2C-M1：clothes ROI 收窄到衣服主体（左中 3/4），排除右列刘海/头发遮挡区
  // （网格探针显示该区 original↔V1 与同变体连拍噪声同为高位 2.3-11.7 vs 1.0-4.3，
  // 是头发遮挡/高光帧间微动噪声，非衣服材质泄漏；衣服主体两侧均 <0.5）。
  clothes:   { x: 0.46,  y: 0.42, w: 0.075, h: 0.14, kind: "nonskin" },
  gear:      { x: 0.44,  y: 0.60, w: 0.08, h: 0.10, kind: "nonskin" },
  skyTL:     { x: 0.02,  y: 0.02, w: 0.30, h: 0.12, kind: "bg" },
  skyTR:     { x: 0.68,  y: 0.02, w: 0.30, h: 0.12, kind: "bg" },
};

function bounds(r) { const x0 = Math.floor(r.x * W), y0 = Math.floor(r.y * H); return { x0, y0, x1: Math.min(W, Math.floor((r.x + r.w) * W)), y1: Math.min(H, Math.floor((r.y + r.h) * H)) }; }

function skinStats(r) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, sumAbs = 0, md = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (a.data[i + 3] < 8) continue;
    if (!isSkin(a.data[i], a.data[i + 1], a.data[i + 2])) continue;
    const rb = b.data[i], gb = b.data[i + 1], bb = b.data[i + 2];
    sumAbs += (Math.abs(a.data[i] - rb) + Math.abs(a.data[i + 1] - gb) + Math.abs(a.data[i + 2] - bb)) / 3;
    md[0] += a.data[i] - rb; md[1] += a.data[i + 1] - gb; md[2] += a.data[i + 2] - bb; n++;
  }
  const meanDiff = md.map((v) => +(n ? Math.abs(v / n) : 0).toFixed(2));
  return { samples: n, mae: +(n ? sumAbs / n : 0).toFixed(3), meanDiff, maxMeanDiff: Math.max(...meanDiff) };
}
// 非皮肤区：meanMeanDiff（平均色偏，鲁棒）+ maxMeanDiff（上限）。pctOver2 仅记录不判定——
// 模型在待机 VMD 循环中持续微动，含 specular/RMO 的衣服对高光角极敏感，同变体连拍
// pctOver2 即达 ~15%（帧间噪声），与 original↔V1 几乎相同，故 pctOver2 无法区分
// 真实改写与帧间微动；真实成片材质改写由 meanMeanDiff/maxMeanDiff 捕获（皮肤对照 25-36）。
function nonSkinStats(r, imgA = a, imgB = b) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, sumAbs = 0, md = [0, 0, 0], over2 = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (imgA.data[i + 3] < 8) continue;
    if (isSkin(imgA.data[i], imgA.data[i + 1], imgA.data[i + 2])) continue;
    const d0 = imgA.data[i] - imgB.data[i], d1 = imgA.data[i + 1] - imgB.data[i + 1], d2 = imgA.data[i + 2] - imgB.data[i + 2];
    const ad = (Math.abs(d0) + Math.abs(d1) + Math.abs(d2)) / 3;
    sumAbs += ad; if (ad > 2) over2++;
    md[0] += d0; md[1] += d1; md[2] += d2; n++;
  }
  const meanDiff = md.map((v) => +(n ? Math.abs(v / n) : 0).toFixed(3));
  const meanMeanDiff = meanDiff.reduce((s, v) => s + v, 0) / 3;
  return { samples: n, mae: +(n ? sumAbs / n : 0).toFixed(3), meanDiff, meanMeanDiff: +meanMeanDiff.toFixed(3), maxMeanDiff: Math.max(...meanDiff), pctOver2: +(n ? (100 * over2 / n) : 0).toFixed(2) };
}
// Stage 2C-M1：对任意两张同尺寸图取同区域非皮肤差异（同变体连拍噪声基线）。
// 与 nonSkinStats 同口径，但显式传入两张图（imgA/imgB 取代闭包 a/b）。
function nonSkinStatsPair(imgA, imgB, r) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, md = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (imgA.data[i + 3] < 8) continue;
    if (isSkin(imgA.data[i], imgA.data[i + 1], imgA.data[i + 2])) continue;
    md[0] += imgA.data[i] - imgB.data[i]; md[1] += imgA.data[i + 1] - imgB.data[i + 1]; md[2] += imgA.data[i + 2] - imgB.data[i + 2]; n++;
  }
  const meanDiff = md.map((v) => +(n ? Math.abs(v / n) : 0).toFixed(3));
  const meanMeanDiff = meanDiff.reduce((s, v) => s + v, 0) / 3;
  return { samples: n, meanDiff, meanMeanDiff: +meanMeanDiff.toFixed(3), maxMeanDiff: Math.max(...meanDiff) };
}
function bgStats(r) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, md = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (lum(a.data, i) >= 30 || lum(b.data, i) >= 30) continue;
    md[0] += a.data[i] - b.data[i]; md[1] += a.data[i + 1] - b.data[i + 1]; md[2] += a.data[i + 2] - b.data[i + 2]; n++;
  }
  const meanDiff = md.map((v) => +(n ? Math.abs(v / n) : 0).toFixed(3));
  return { samples: n, meanDiff, maxMeanDiff: Math.max(...meanDiff) };
}

// ── P0-1 目标参考收敛（脸部综合色比「候选指标」）─────────────────────
// 【边界声明】这是脸部综合色比候选指标，非同像素对齐、非空间阴影对齐：
// 目标侧扫整张参考图的全部 isSkin 肤色像素（分母 targetSamples），舞台侧只取舞台脸框
// 内的 isSkin 像素（分母 stageSamples），两者样本空间不同、未做 UV/空间配准。它只能证明
// 「V1 脸部皮肤整体色比比 original 更接近 V14D 目标的肤色比」，不能宣称 State2 空间阴影
// 已逐像素对齐、也不能作为皮肤阶段「最终完成」的判据。
// K3 舞台有灯光/星空显示链，目标参考（Blender V14D finalFaceComposite）是中性白底，
// 绝对亮度不可比。采用「色比」(R/G, R/B) 作为对光照/曝光不敏感的配准皮肤材质空间口径，
// 只比较脸部皮肤像素（isSkin 掩码）。要求 V1 对目标的色比误差显著低于 original。
async function targetSkinRatio(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0, s = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue; // 目标为不透明渲染，剔除透明边
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!isSkin(r, g, b)) continue;
    s[0] += r; s[1] += g; s[2] += b; n++;
  }
  if (!n) return null;
  const m = s.map((v) => v / n);
  return { samples: n, mean: m.map((v) => +v.toFixed(1)), ratio: [+(m[0] / m[1]).toFixed(4), +(m[0] / m[2]).toFixed(4)] };
}
// 舞台脸框皮肤均值色比（与 targetSkinRatio 同 isSkin 口径）。
function stageFaceRatio(img, r) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, s = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (img.data[i + 3] < 8) continue;
    const rr = img.data[i], gg = img.data[i + 1], bb = img.data[i + 2];
    if (!isSkin(rr, gg, bb)) continue;
    s[0] += rr; s[1] += gg; s[2] += bb; n++;
  }
  if (!n) return null;
  const m = s.map((v) => v / n);
  return { samples: n, mean: m.map((v) => +v.toFixed(1)), ratio: [+(m[0] / m[1]).toFixed(4), +(m[0] / m[2]).toFixed(4)] };
}
const ratioDist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// ── 阈值（报告中显式定义，脚本硬阻断；非皮肤阈值对齐实测基线噪声，高于噪声、低于真实改写）──
const THRESHOLDS = {
  skinConvergeMae: 1.0,          // 皮肤区（掩码采样）MAE 必须 > 1（证明 V14D 材质有显著变化）
  skinConvergeMeanDiff: 1.0,     // 皮肤区（掩码采样）maxMeanDiff 必须 > 1（色偏显著收敛）
  minSkinSamples: 20,            // 皮肤区掩码像素数下限（防手部框内无皮肤时假通过）
  // 非皮肤稳定阈值对齐实测：同变体连拍帧间微动噪声 meanMeanDiff≈0.02-0.05、maxMeanDiff≈0.13-0.28；
  // original→V1 因重建 + 待机微动 meanMeanDiff≈0.09-0.34、maxMeanDiff≈0.11-0.71。阈值取噪声上界
  // 之上、真实成片改写（皮肤对照 meanDiff 25-36）之下，允许切换重建的极小光栅噪声（修票明示）。
  nonSkinStableMeanMeanDiff: 1.0, // 非皮肤区 meanMeanDiff（平均色偏）必须 < 1（大面积材质不被改写）
  nonSkinStableMaxMeanDiff: 2.0,  // 非皮肤区 maxMeanDiff 上限（单通道色偏，远高于噪声、低于真实改写）
  bgStableMeanDiff: 0.5,         // 星空背景暗空像素 maxMeanDiff 必须 < 0.5（灯光/背景不变）
  // Stage 2C-M1 修正轮：HairA/HairB 分区对权威 V14D BaseColor 目标的收敛判定阈值。
  // 目标 = hair_d(sRGB→线性)×[0.84,0.85,0.96] 经 linearToSrgb 转回显示字节（与引擎
  // WGSL helper 同一公式、同一 sRGB 绑定采样口径）。绝对误差含引擎灯光/Toon 显示链
  // 的乘性亮度差（未迁移部分），故收敛判据用「V1 误差 < original 误差 且 下降比例
  // > drop 且 绝对上限」，不用绝对零误差冒充逐像素对齐。
  hairTargetDrop: 0.05,         // (origMae - v1Mae)/origMae 必须 > 0.05（向目标显著下降）
  hairTargetAbsMae: 90,         // V1 对目标的绝对 MAE 上限（显示字节 0-255；含显示链亮度差）
  hairTargetCanonicalTolerance: 0.001, // active target 相对同像素权威 UV 基准的 MAE 允许误差
  minHairTargetSamples: 30,     // 分区目标判定最小像素数（防近景框内无该槽像素假通过）
  minHairTriUvResolution: 0.999, // 材质-ID 前景中至少 99.9% 必须有同帧 triUV；边缘 pass 的少量未解析像素单独计数
  // Stage 2C-M1：HairA/HairB 目标槽必须显著变化（V14D 银白紫乘色 [0.84,0.85,0.96] 真实生效）。
  // 阈值参考皮肤收敛口径（mae>1 且 maxMeanDiff>1），与皮肤/错误颜色负测共用同一判别力。
  hairChangeMae: 1.0,            // 头发区（非皮肤像素采样）MAE 必须 > 1（证明 V14D 头发材质显著变化）
  hairChangeMaxMeanDiff: 1.0,    // 头发区 maxMeanDiff 必须 > 1（色偏显著，非帧间噪声）
  // P0-1 目标收敛：V1 对 V14D 目标的色比误差必须比 original 显著下降（误差下降比例下限）。
  targetConvergeDrop: 0.15,      // (dist_orig - dist_v1) / dist_orig 必须 > 0.15（色比口径）
};

const out = {
  width: W,
  height: H,
  thresholds: THRESHOLDS,
  target: TARGET,
  regions: {},
  diagnostics: {},
  verdict: {},
  occluded: [],
  hairSlotIdentity: {
    source: materialMaskMeta?.source ?? null,
    maskPath: fs.existsSync(HAIR_MASK) ? HAIR_MASK : null,
    metadataPath: fs.existsSync(HAIR_MASK_META) ? HAIR_MASK_META : null,
    materialIdByName: materialMaskMeta?.materialIdByName ?? null,
    hairA: { materialName: "HairA", materialId: hairMaterialIds.hairA || null },
    hairB: { materialName: "HairB", materialId: hairMaterialIds.hairB || null },
    ready: hairMaterialMaskReady,
  },
};
const failures = [];
if (!hairMaterialMaskReady) failures.push("HairA/HairB 逐像素材质身份掩码不可用或材质 ID 不唯一");
if (!hairTriUvCaptureReady) {
  failures.push("HairA/HairB 同材质同三角形同 UV 证据不可用" + (hairTriUvCaptureError ? ": " + hairTriUvCaptureError : ""));
}
if (hairMaterialMaskReady) {
  const countMaterialPixels = (materialId) => {
    let count = 0;
    for (let i = 0; i < materialMask.data.length; i += 4) {
      if (materialMask.data[i] !== 0 && materialMask.data[i + 1] === materialId) count += 1;
    }
    return count;
  };
  const correctA = countMaterialPixels(hairMaterialIds.hairA);
  const correctB = countMaterialPixels(hairMaterialIds.hairB);
  // 错槽归属负测：故意交换 HairA/HairB 的 materialId，期望所得样本集合严格
  // 互换而非合并/重叠。这样可证明正式逐槽统计不会把另一槽混进当前槽后仍假通过。
  const swappedA = countMaterialPixels(hairMaterialIds.hairB);
  const swappedB = countMaterialPixels(hairMaterialIds.hairA);
  const wrongAssignmentDetected = correctA > 0 && correctB > 0
    && swappedA === correctB && swappedB === correctA && hairMaterialIds.hairA !== hairMaterialIds.hairB;
  out.hairSlotIdentity.wrongSlotAttributionNegative = {
    correct: { hairA: correctA, hairB: correctB },
    swappedAssignment: { hairA: swappedA, hairB: swappedB },
    disjointMaterialIds: hairMaterialIds.hairA !== hairMaterialIds.hairB,
    detected: wrongAssignmentDetected,
    reason: "计数仅作交叉核对；正式错槽判别由 --neg-swap-slot-target 的 target/triUV 语义负测完成",
  };
}
if (hairTriUvCaptureReady) {
  const captureIds = {
    hairA: Number(hairTriUvCapture.materialIdByName?.HairA),
    hairB: Number(hairTriUvCapture.materialIdByName?.HairB),
  };
  if (captureIds.hairA !== hairMaterialIds.hairA || captureIds.hairB !== hairMaterialIds.hairB) {
    failures.push("HairA/HairB materialId 在 triUV 与前景掩码之间不一致");
  }
  for (const slot of ["hairA", "hairB"]) {
    const name = slot === "hairA" ? "HairA" : "HairB";
    const info = hairTriUvCapture.byMaterial?.[name];
    const expected = W * H;
    if (!info || !Number.isInteger(info.triangleCount) || info.triangleCount <= 0
      || !Array.isArray(info.triId) || info.triId.length !== expected
      || !Array.isArray(info.uv) || info.uv.length !== expected * 2
      || !Array.isArray(info.triMask) || info.triMask.length !== expected
      || !Array.isArray(info.triangleUvs) || info.triangleUvs.length !== info.triangleCount * 6) {
      failures.push(name + " triUV 证据长度/三角形元数据非法");
    }
  }
}

// ── Stage 2C-M1.1：HairA/HairB 同材质、同三角形、同 UV 目标 ────────────────
// 正式目标不是槽位均值：每个屏幕样本必须同时命中生产 materialId、同材质
// expanded-tri-uv 的有效 triId，并使用该像素插值 UV 对权威 hair_d 做线性双线性采样。
// PMX 网格只保留给人读 UV 取证图；正式收敛判据完全由 g3-hair-tri-uv.json 驱动。
const HAIR_TEX = process.env.V14D_HAIR_TEX || "D:\\mmd\\克莱妲原皮\\Textures\\c_KoledaSSR01_slg_hair_d.png";
const HAIR_PMX = process.env.V14D_HAIR_PMX || "D:\\mmd\\克莱妲原皮\\GirlsFrontline KoledaDefault.pmx";
const HAIR_FACE_RANGES = {
  // 来自 docs/handoff/evidence/pmx_audit.out.json 的 material_face_ranges（权威冻结）。
  hairA: { name: "HairA", startIndex: 190407, indexCount: 30198 },
  hairB: { name: "HairB", startIndex: 220605, indexCount: 13512 },
};
let hairTargetGrid = null;
let hairTexRaw = null;
let hairTextureLinear = null;
if (fs.existsSync(HAIR_TEX)) {
  try {
    hairTexRaw = await loadRaw(HAIR_TEX);
    const linear = new Float32Array(hairTexRaw.width * hairTexRaw.height * 3);
    for (let i = 0; i < hairTexRaw.width * hairTexRaw.height; i += 1) {
      linear[i * 3] = srgbByteToLinear(hairTexRaw.data[i * 4]);
      linear[i * 3 + 1] = srgbByteToLinear(hairTexRaw.data[i * 4 + 1]);
      linear[i * 3 + 2] = srgbByteToLinear(hairTexRaw.data[i * 4 + 2]);
    }
    hairTextureLinear = { width: hairTexRaw.width, height: hairTexRaw.height, linear };
  } catch (e) {
    failures.push("权威 hair_d 纹理读取失败: " + (e && e.message ? e.message : e));
  }
} else {
  failures.push("权威 hair_d 纹理不存在: " + HAIR_TEX);
}
if (fs.existsSync(HAIR_PMX) && hairTexRaw) {
  try {
    const pmxBuf = fs.readFileSync(HAIR_PMX);
    hairTargetGrid = buildHairUvGridFromPmx(
      pmxBuf.buffer.slice(pmxBuf.byteOffset, pmxBuf.byteOffset + pmxBuf.byteLength),
      HAIR_FACE_RANGES,
    );
  } catch (e) {
    // PMX 网格仅用于人读证据，不阻断已经具备 triId+UV 的正式屏幕目标 Gate。
    hairTargetGrid = null;
  }
}

/**
 * 分区 UV 取证图（人读 A/B 证据，非机器收敛判据）：把 hair_d 纹理中归属本槽的
 * UV 像素抠出，生成 original 语义（hair_d 原色）与 V14D 目标（v14dHairTargetDisplay）
 * 两张同 UV 对齐图 + 差异图，写入 OUT 供报告/审查。屏幕空间近景图由 accept 脚本
 * 的相机摆拍另行产出；机器收敛判定使用下面的逐屏幕样本 triUV 统计。
 */
async function writeHairSlotUvImages() {
  if (!hairTargetGrid || !hairTexRaw) return {};
  const texW = hairTexRaw.width, texH = hairTexRaw.height;
  const written = {};
  for (const slot of ["hairA", "hairB"]) {
    const origPx = Buffer.alloc(texW * texH * 4);
    const tgtPx = Buffer.alloc(texW * texH * 4);
    const diffPx = Buffer.alloc(texW * texH * 3);
    let n = 0;
    for (let py = 0; py < texH; py++) for (let px = 0; px < texW; px++) {
      if (classifyHairPixel(hairTargetGrid, px, py, texW, texH) !== slot) continue;
      const ti = (py * texW + px) * 4;
      const rgb = [hairTexRaw.data[ti], hairTexRaw.data[ti + 1], hairTexRaw.data[ti + 2]];
      const tgt = v14dHairTargetDisplay(rgb);
      const o = ti;
      origPx[o] = rgb[0]; origPx[o + 1] = rgb[1]; origPx[o + 2] = rgb[2]; origPx[o + 3] = 255;
      tgtPx[o] = tgt[0]; tgtPx[o + 1] = tgt[1]; tgtPx[o + 2] = tgt[2]; tgtPx[o + 3] = 255;
      const d = Math.min(255, Math.round(((Math.abs(rgb[0] - tgt[0]) + Math.abs(rgb[1] - tgt[1]) + Math.abs(rgb[2] - tgt[2])) / 3) * 6));
      const dj = (py * texW + px) * 3;
      diffPx[dj] = d; diffPx[dj + 1] = d; diffPx[dj + 2] = d;
      n++;
    }
    if (!n) continue;
    const crop = await sharp(hairTexRaw.data, { raw: { width: texW, height: texH, channels: 4 } }).png().toBuffer();
    await sharp(origPx, { raw: { width: texW, height: texH, channels: 4 } }).png().toFile(path.join(OUT, "hair-uv-" + slot + "-original.png"));
    await sharp(tgtPx, { raw: { width: texW, height: texH, channels: 4 } }).png().toFile(path.join(OUT, "hair-uv-" + slot + "-v14d-target.png"));
    await sharp(diffPx, { raw: { width: texW, height: texH, channels: 3 } }).png().toFile(path.join(OUT, "hair-uv-" + slot + "-diff.png"));
    written[slot] = { samples: n, original: "hair-uv-" + slot + "-original.png", target: "hair-uv-" + slot + "-v14d-target.png", diff: "hair-uv-" + slot + "-diff.png" };
  }
  return written;
}

/**
 * 逐槽屏幕统计：仅接受 engine-pick-material-id-depth 掩码中对应 PMX 材质 ID
 * 的前景像素。ROI 只负责限定画面区域，不能改变槽位身份；因此另一槽、衣物、
 * 背景即使落入同一矩形也不会进入该槽样本。
 */
function hairSlotDiffStats(r, materialId) {
  if (!materialMask || !Number.isInteger(materialId) || materialId <= 0) {
    return { error: "missing material identity mask", samples: 0, roiPixels: 0, coverage: 0 };
  }
  const origImage = hairOrigImage;
  const activeImage = hairActual;
  const { x0, y0, x1, y1 } = bounds(r);
  let roiPixels = 0;
  let slotPixels = 0;
  let n = 0;
  let sumAbs = 0;
  const md = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    roiPixels += 1;
    if (materialMask.data[i] === 0 || materialMask.data[i + 1] !== materialId) continue;
    slotPixels += 1;
    if (origImage.data[i + 3] < 8) continue;
    const d0 = origImage.data[i] - activeImage.data[i];
    const d1 = origImage.data[i + 1] - activeImage.data[i + 1];
    const d2 = origImage.data[i + 2] - activeImage.data[i + 2];
    sumAbs += (Math.abs(d0) + Math.abs(d1) + Math.abs(d2)) / 3;
    md[0] += d0; md[1] += d1; md[2] += d2;
    n += 1;
  }
  const meanDiff = md.map((v) => +(n ? Math.abs(v / n) : 0).toFixed(3));
  return {
    samples: n,
    roiPixels,
    slotPixels,
    coverage: +(roiPixels ? slotPixels / roiPixels : 0).toFixed(6),
    mae: +(n ? sumAbs / n : 0).toFixed(3),
    meanDiff,
    maxMeanDiff: Math.max(...meanDiff),
    materialId,
  };
}

function percentile95(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = (sorted.length - 1) * 0.95;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function roundMetric(value) {
  return value === null || value === undefined ? null : +value.toFixed(3);
}

function hairMaterialName(slot) {
  return slot === "hairA" ? "HairA" : "HairB";
}

function hairTriUvInfo(slot) {
  return hairTriUvCapture?.byMaterial?.[hairMaterialName(slot)] ?? null;
}

function hairTriangleUvs(info, triId) {
  const start = triId * 6;
  if (!Array.isArray(info?.triangleUvs) || start < 0 || start + 6 > info.triangleUvs.length) return null;
  return info.triangleUvs.slice(start, start + 6);
}

/**
 * HairA/HairB 正式逐像素目标 Gate：
 *   materialMask(G=materialId) + triUv(triId,uv) + triangleUvs(triId)
 *   → 权威 hair_d 同 UV 线性双线性采样 → authority tint → 显示字节目标。
 *
 * ROI 只限制屏幕范围，不能赋予材质身份；每个样本都必须同时满足前景材质 ID、
 * 同材质 triMask/triId、UV 有限且落在 triId 对应的三角形 UV 内。负测模式把
 * target/triUV 归属交换到另一槽，但保留真实屏幕样本，以验证正式 Gate 能因语义
 * 错配非零失败，而不是因缺文件/样本不足伪造失败。
 */
async function hairSlotTriUvTargetStats(r, slot, materialId) {
  if (!hairMaterialMaskReady) return { error: "missing material identity mask" };
  if (!hairTriUvCaptureReady) return { error: "missing same-material triUV capture" };
  if (!hairTextureLinear) return { error: "missing authority hair_d texture" };
  const origImage = hairOrigImage;
  const activeImage = hairActual;
  const info = hairTriUvInfo(slot);
  if (!info) return { error: "missing triUV material entry" };
  const targetSlot = NEG_SWAP_SLOT_TARGET ? (slot === "hairA" ? "hairB" : "hairA") : slot;
  const targetRecords = [];
  const { x0, y0, x1, y1 } = bounds(r);
  let roiPixels = 0;
  let materialForegroundPixels = 0;
  let triUvResolvedPixels = 0;
  let rejectedNoTriUv = 0;
  let rejectedInvalidTri = 0;
  let rejectedBarycentric = 0;
  const samples = [];

  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const i = (y * W + x) * 4;
    roiPixels += 1;
    if (materialMask.data[i] === 0 || materialMask.data[i + 1] !== materialId) continue;
    materialForegroundPixels += 1;
    if (!info.triMask?.[y * W + x]) { rejectedNoTriUv += 1; continue; }
    const triId = Number(info.triId?.[y * W + x]);
    const u = Number(info.uv?.[(y * W + x) * 2]);
    const v = Number(info.uv?.[(y * W + x) * 2 + 1]);
    if (!Number.isInteger(triId) || triId < 0 || triId >= Number(info.triangleCount) || !Number.isFinite(u) || !Number.isFinite(v)) {
      rejectedInvalidTri += 1;
      continue;
    }
    triUvResolvedPixels += 1;
    const bary = barycentricForTriangleUv(u, v, hairTriangleUvs(info, triId));
    if (!barycentricInside(bary)) { rejectedBarycentric += 1; continue; }
    const record = { index: y * W + x, triId, u, v };
    samples.push(record);
    targetRecords.push(record);
  }

  const targetStream = targetSlot === slot ? targetRecords : targetRecords.slice();
  // 负测交换完整的 target/triUV 归属：将另一槽全屏的有效 triUV 记录流按稳定序号
  // 配给当前槽屏幕样本。不能只在当前 ROI 中找另一槽，否则前视角 HairA ROI 可能
  // 没有 HairB 像素，最终把“错目标”伪装成“样本缺失”。这些仍是同一真实画布、
  // 同一材质身份 pass 产生的另一槽样本，不是人为颜色扰动。
  if (NEG_SWAP_SLOT_TARGET) {
    targetStream.length = 0;
    // 使用另一槽的完整真实 triUV 记录流配给当前槽屏幕样本。
    // 每条目标记录仍来自合法的 material-ID、triId、UV 和三角形重心校验；
    // 正式失败不能依赖 targetBinding 布尔值，而要由实际目标误差证明。
    targetStream.push(...collectHairTriUvRecords(targetSlot));
  }
  if (samples.length > 0 && targetStream.length === 0) return { error: "swap target triUV samples unavailable" };

  const origErrors = [];
  const v1Errors = [];
  const origChannelErrors = [[], [], []];
  const v1ChannelErrors = [[], [], []];
  const canonicalOrigErrors = [];
  const canonicalV1Errors = [];
  const canonicalOrigChannelErrors = [[], [], []];
  const canonicalV1ChannelErrors = [[], [], []];
  let origAbs = 0;
  let v1Abs = 0;
  let canonicalOrigAbs = 0;
  let canonicalV1Abs = 0;
  for (let ordinal = 0; ordinal < samples.length; ordinal += 1) {
    const sample = samples[ordinal];
    const targetSample = targetStream[ordinal % targetStream.length];
    const targetLinear = sampleHairTextureLinear(hairTextureLinear, targetSample.u, targetSample.v);
    const target = v14dHairTargetDisplayFromLinear(targetLinear);
    // 当前屏幕样本自己的 UV 是不可交换的权威基准。正常模式下它与 target
    // 完全相同；错槽负测仍计算它，用于证明 active target 的误差确实变差。
    const canonicalLinear = sampleHairTextureLinear(hairTextureLinear, sample.u, sample.v);
    const canonicalTarget = v14dHairTargetDisplayFromLinear(canonicalLinear);
    const offset = sample.index * 4;
    const orig = [origImage.data[offset], origImage.data[offset + 1], origImage.data[offset + 2]];
    const v1 = [activeImage.data[offset], activeImage.data[offset + 1], activeImage.data[offset + 2]];
    const origChannels = orig.map((value, channel) => Math.abs(value - target[channel]));
    const v1Channels = v1.map((value, channel) => Math.abs(value - target[channel]));
    const origPixel = origChannels.reduce((sum, value) => sum + value, 0) / 3;
    const v1Pixel = v1Channels.reduce((sum, value) => sum + value, 0) / 3;
    const canonicalOrigChannels = orig.map((value, channel) => Math.abs(value - canonicalTarget[channel]));
    const canonicalV1Channels = v1.map((value, channel) => Math.abs(value - canonicalTarget[channel]));
    const canonicalOrigPixel = canonicalOrigChannels.reduce((sum, value) => sum + value, 0) / 3;
    const canonicalV1Pixel = canonicalV1Channels.reduce((sum, value) => sum + value, 0) / 3;
    origErrors.push(origPixel); v1Errors.push(v1Pixel);
    origAbs += origPixel; v1Abs += v1Pixel;
    canonicalOrigErrors.push(canonicalOrigPixel); canonicalV1Errors.push(canonicalV1Pixel);
    canonicalOrigAbs += canonicalOrigPixel; canonicalV1Abs += canonicalV1Pixel;
    for (let channel = 0; channel < 3; channel += 1) {
      origChannelErrors[channel].push(origChannels[channel]);
      v1ChannelErrors[channel].push(v1Channels[channel]);
      canonicalOrigChannelErrors[channel].push(canonicalOrigChannels[channel]);
      canonicalV1ChannelErrors[channel].push(canonicalV1Channels[channel]);
    }
    sample.origError = origPixel;
    sample.v1Error = v1Pixel;
  }

  const origMae = samples.length ? origAbs / samples.length : 0;
  const v1Mae = samples.length ? v1Abs / samples.length : 0;
  const canonicalOrigMae = samples.length ? canonicalOrigAbs / samples.length : 0;
  const canonicalV1Mae = samples.length ? canonicalV1Abs / samples.length : 0;
  const drop = origMae > 0 ? (origMae - v1Mae) / origMae : 0;
  const activeV1P95 = percentile95(v1Errors);
  const canonicalV1P95 = percentile95(canonicalV1Errors);
  const targetV1MaePenalty = v1Mae - canonicalV1Mae;
  const targetMaterialId = Number(hairTriUvInfo(targetSlot)?.materialId);
  const targetBindingConsistent = targetSlot === slot
    && Number(info.materialId) === materialId
    && targetMaterialId === materialId;
  const triUvResolution = materialForegroundPixels > 0
    ? triUvResolvedPixels / materialForegroundPixels
    : 0;
  const targetBindingInputsValid = Number.isInteger(materialId) && materialId > 0
    && Number.isInteger(Number(info.materialId)) && Number(info.materialId) > 0
    && Number.isInteger(targetMaterialId) && targetMaterialId > 0
    && samples.length >= THRESHOLDS.minHairTargetSamples
    && targetStream.length >= THRESHOLDS.minHairTargetSamples
    && triUvResolution >= THRESHOLDS.minHairTriUvResolution;
  const coverage = +(samples.length / Math.max(1, roiPixels)).toFixed(6);
  const metricFailureReasons = [];
  if (samples.length < THRESHOLDS.minHairTargetSamples) metricFailureReasons.push("samples<" + THRESHOLDS.minHairTargetSamples);
  if (targetStream.length < THRESHOLDS.minHairTargetSamples) metricFailureReasons.push("targetSamples<" + THRESHOLDS.minHairTargetSamples);
  if (!(triUvResolution >= THRESHOLDS.minHairTriUvResolution)) metricFailureReasons.push("triUvResolution<" + THRESHOLDS.minHairTriUvResolution + " (" + triUvResolution.toFixed(6) + ")");
  if (!(coverage > 0)) metricFailureReasons.push("coverage<=0");
  if (!(v1Mae < origMae)) metricFailureReasons.push("v1Mae>=origMae (" + v1Mae.toFixed(3) + ">=" + origMae.toFixed(3) + ")");
  if (!(drop > THRESHOLDS.hairTargetDrop)) metricFailureReasons.push("drop<=" + THRESHOLDS.hairTargetDrop + " (" + drop.toFixed(4) + ")");
  if (!(v1Mae < THRESHOLDS.hairTargetAbsMae)) metricFailureReasons.push("v1Mae>=" + THRESHOLDS.hairTargetAbsMae + " (" + v1Mae.toFixed(3) + ")");
  if (!origErrors.length || !v1Errors.length || !Number.isFinite(activeV1P95) || !Number.isFinite(canonicalV1P95)) metricFailureReasons.push("P95 unavailable");
  if (!(targetV1MaePenalty <= THRESHOLDS.hairTargetCanonicalTolerance)) {
    metricFailureReasons.push("v1Mae>samePixelCanonical (" + v1Mae.toFixed(3) + ">" + canonicalV1Mae.toFixed(3) + ", delta=" + targetV1MaePenalty.toFixed(3) + "); P95=" + roundMetric(activeV1P95) + ">" + roundMetric(canonicalV1P95));
  }
  const metricGate = metricFailureReasons.length === 0;
  const metric = {
    slot,
    materialName: hairMaterialName(slot),
    materialId,
    triUvSourceSlot: slot,
    targetTriUvSourceSlot: targetSlot,
    targetBinding: {
      materialSlot: slot,
      materialId,
      triUvMaterialId: Number(info.materialId),
      targetTriUvSourceSlot: targetSlot,
      targetTriUvMaterialId: targetMaterialId,
      targetSamples: targetStream.length,
      consistent: targetBindingConsistent,
      inputsValid: targetBindingInputsValid,
      mode: NEG_SWAP_SLOT_TARGET ? "swapped-negative" : "same-material",
    },
    samples: samples.length,
    targetSamples: targetStream.length,
    roiPixels,
    materialForegroundPixels,
    triUvResolvedPixels,
    rejectedNoTriUv,
    rejectedInvalidTri,
    rejectedBarycentric,
    triUvResolution: +triUvResolution.toFixed(6),
    coverage,
    materialCoverage: +(materialForegroundPixels / Math.max(1, roiPixels)).toFixed(6),
    triUvCoverage: +(samples.length / Math.max(1, materialForegroundPixels)).toFixed(6),
    origMae: +origMae.toFixed(3),
    v1Mae: +v1Mae.toFixed(3),
    drop: +drop.toFixed(4),
    canonicalTarget: {
      origMae: +canonicalOrigMae.toFixed(3),
      v1Mae: +canonicalV1Mae.toFixed(3),
      p95: {
        orig: roundMetric(percentile95(canonicalOrigErrors)),
        v1: roundMetric(canonicalV1P95),
        origByChannel: canonicalOrigChannelErrors.map((values) => roundMetric(percentile95(values))),
        v1ByChannel: canonicalV1ChannelErrors.map((values) => roundMetric(percentile95(values))),
      },
    },
    targetV1MaePenalty: +targetV1MaePenalty.toFixed(3),
    p95: {
      orig: roundMetric(percentile95(origErrors)),
      v1: roundMetric(activeV1P95),
      origByChannel: origChannelErrors.map((values) => roundMetric(percentile95(values))),
      v1ByChannel: v1ChannelErrors.map((values) => roundMetric(percentile95(values))),
    },
    target: {
      texture: HAIR_TEX,
      sampling: "bilinear-linear-hair_d-then-authority-tint-then-srgb-display",
      formula: "targetDisplay(uv)=linearToSrgb(bilinear(srgbToLinear(hair_d,uv))*V14D_HAIR_TINT)",
    },
  };
  const changed = hairSlotDiffStats(r, materialId);
  metric.changedMae = changed.mae ?? null;
  metric.changedMaxMeanDiff = changed.maxMeanDiff ?? null;
  // formalGate 只表示真实目标数值是否收敛；材质/triUV 同槽一致性单独以
  // targetBinding.consistent 暴露，由外层正式 verdict 组合检查。这样 swap 负测
  // 不能靠预置 false 通过，必须由 v1Mae/drop/P95 等真实目标结果自然拒绝。
  metric.metricGate = metricGate;
  metric.metricFailureReasons = metricFailureReasons;
  metric.formalGate = metricGate;
  metric.artifacts = {
    heatmap: "g3-hair-" + slot + "-triuv-target-heat.png",
    json: "g3-hair-" + slot + "-triuv-target.json",
  };

  const heatmap = Buffer.alloc(W * H * 4);
  for (const sample of samples) {
    const intensity = Math.max(0, Math.min(255, Math.round(sample.v1Error * 4)));
    const offset = sample.index * 4;
    heatmap[offset] = intensity;
    heatmap[offset + 1] = 255 - intensity;
    heatmap[offset + 2] = 0;
    heatmap[offset + 3] = 255;
  }
  await sharp(heatmap, { raw: { width: W, height: H, channels: 4 } })
    .png().toFile(path.join(OUT, metric.artifacts.heatmap));
  await fs.promises.writeFile(path.join(OUT, metric.artifacts.json), JSON.stringify(metric, null, 2));
  return metric;
}

/**
 * 从同一帧、同一 material-ID+depth 掩码中收集某槽的全屏有效 triUV 记录。
 * 仅供错槽/错目标负测建立真实的跨槽目标流；正式统计仍由当前 ROI 的屏幕样本
 * 决定 coverage 与 MAE 分母。
 */
function collectHairTriUvRecords(slot) {
  const info = hairTriUvInfo(slot);
  const materialId = hairMaterialIds[slot];
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
    if (!barycentricInside(barycentricForTriangleUv(u, v, hairTriangleUvs(info, triId)))) continue;
    records.push({ index: y * W + x, triId, u, v, sourceSlot: slot });
  }
  return records;
}

for (const [name, r] of Object.entries(regions)) {
  if (r.occluded) { out.regions[name] = { occluded: true, note: "frame 当前姿势下不可见，标记 occluded，不参与收敛/稳定判定" }; out.occluded.push(name); continue; }
 if (r.kind === "skin") {
   const st = skinStats(r); out.regions[name] = st;
   const ok = st.samples >= THRESHOLDS.minSkinSamples && st.mae > THRESHOLDS.skinConvergeMae && st.maxMeanDiff > THRESHOLDS.skinConvergeMeanDiff;
   out.verdict[name + "Converged"] = ok;
   if (!ok) failures.push(name + " 皮肤区未向目标显著收敛 samples=" + st.samples + " mae=" + st.mae + " maxMeanDiff=" + st.maxMeanDiff);
 } else if (r.kind === "nonskin") {
    const st = nonSkinStats(r); out.regions[name] = st;
    // Stage 2C-M1 噪声基线：若有 original 同变体连拍（a2），把 original↔V1 的非皮肤
    // 差异与同变体待机微动帧间噪声比较。只有显著高于同变体噪声才判为真实材质泄漏；
    // 否则判定为帧间微动噪声（引擎切换重建 + 待机 VMD 微动对 specular/RMO 高光角敏感）。
    let noise = null;
    if (a2) {
      const n0 = nonSkinStatsPair(a, a2, r); out.regions[name].sameVariantNoise = n0;
      noise = n0;
    }
    const leaked = noise
      ? (st.meanMeanDiff > Math.max(THRESHOLDS.nonSkinStableMeanMeanDiff, noise.meanMeanDiff * 4) && st.maxMeanDiff > Math.max(THRESHOLDS.nonSkinStableMaxMeanDiff, noise.maxMeanDiff * 4))
      : (st.meanMeanDiff < THRESHOLDS.nonSkinStableMeanMeanDiff && st.maxMeanDiff < THRESHOLDS.nonSkinStableMaxMeanDiff) === false;
    const ok = !leaked;
    out.verdict[name + "Stable"] = ok;
    if (!ok) failures.push(name + " 非皮肤区被 V1 成片改写 meanMeanDiff=" + st.meanMeanDiff + " maxMeanDiff=" + st.maxMeanDiff + (noise ? "（同变体噪声 meanMeanDiff=" + noise.meanMeanDiff + " maxMeanDiff=" + noise.maxMeanDiff + "）" : "（无同变体基线）") + "（判定阈值见 thresholds/噪声×4）");
 } else if (r.kind === "hair") {
    const slot = name === "hairA" ? "hairA" : name === "hairB" ? "hairB" : null;
    // legacy 合并矩形只保留为 report-only 诊断。它没有 materialId/triUV 身份，
    // 不能再作为正式 Hair Gate 的第二权威，也不能污染负测 analysisFailures。
    if (!slot) {
      const st = nonSkinStats(r, hairOrigImage, hairActual);
      const changed = st.mae > THRESHOLDS.hairChangeMae && st.maxMeanDiff > THRESHOLDS.hairChangeMaxMeanDiff;
      const diagnostic = {
        ...st,
        changed,
        diagnosticOnly: true,
        gateRole: "report-only",
        authority: "legacy-aggregate-hair-roi",
        ignoredByFormalGate: true,
      };
      out.regions[name] = diagnostic;
      out.diagnostics.legacyAggregateHair = diagnostic;
      continue;
    }
    // 正式 HairA/HairB 槽：变化判定与同槽 triUV 目标收敛都必须成立。
    const st = hairSlotDiffStats(r, hairMaterialIds[slot]); out.regions[name] = st;
    if (slot) out.regions[name].identity = { materialName: slot === "hairA" ? "HairA" : "HairB", materialId: hairMaterialIds[slot], source: "engine-pick-material-id-depth" };
    if (st.error) {
      failures.push(name + " 逐槽材质身份样本不可用: " + st.error);
      out.verdict[name + "Changed"] = false;
      out.verdict[name + "TargetConverged"] = false;
      continue;
    }
    const changed = st.mae > THRESHOLDS.hairChangeMae && st.maxMeanDiff > THRESHOLDS.hairChangeMaxMeanDiff;
    out.verdict[name + "Changed"] = changed;
    if (!changed) failures.push(name + " 头发目标槽未显著变化 mae=" + st.mae + " maxMeanDiff=" + st.maxMeanDiff + "（需 mae>" + THRESHOLDS.hairChangeMae + " 且 maxMeanDiff>" + THRESHOLDS.hairChangeMaxMeanDiff + "）");
    // 目标收敛（HairA/HairB 分区各自判定，不用整头均值掩盖单槽失败）：
    // 每个正式屏幕样本都从同槽 materialId + triId + 插值 UV 读取 hair_d 的逐像素
    // 目标；PMX UV 网格只服务人读取证图，不参与正式 Gate。
    if (r.image && slot && hairMaterialMaskReady && hairTriUvCaptureReady && hairTextureLinear) {
      const conv = await hairSlotTriUvTargetStats(r, slot, hairMaterialIds[slot]);
      out.regions[name].targetConvergence = conv;
      if (conv.error) {
        out.verdict[name + "TargetConverged"] = false;
        failures.push(name + " 目标收敛判定样本不足: " + conv.error);
      } else {
        const converged = conv.formalGate === true
          && conv.targetBinding?.consistent === true
          && conv.targetBinding?.inputsValid === true;
        out.verdict[name + "TargetConverged"] = converged;
        if (!converged) failures.push(name + " 未向权威 V14D 头发目标收敛 origMae=" + conv.origMae + " v1Mae=" + conv.v1Mae + " drop=" + conv.drop + " targetBinding=" + (conv.targetBinding?.consistent ? "consistent" : "mismatch") + " metricFailures=" + (conv.metricFailureReasons?.join(",") || "none") + "（需同材质 triUV、drop>" + THRESHOLDS.hairTargetDrop + " 且 v1Mae<" + THRESHOLDS.hairTargetAbsMae + "）");
      }
    } else if (r.image) {
      out.verdict[name + "TargetConverged"] = false;
      failures.push(name + " 头发逐屏幕 triUV 目标不可用（需材质身份、同槽 triId/UV 与 authority hair_d）");
    }
  } else {
    const st = bgStats(r); out.regions[name] = st;
    const ok = st.maxMeanDiff < THRESHOLDS.bgStableMeanDiff;
    out.verdict[name + "Stable"] = ok;
    if (!ok) failures.push(name + " 星空背景被 V1 改写 maxMeanDiff=" + st.maxMeanDiff + "（上限 " + THRESHOLDS.bgStableMeanDiff + "）");
  }
}

// HairA/HairB 正式 Gate 的唯一组合结果：legacy aggregate 诊断明确不参与。
const hairFormalGate = evaluateV14dHairFormalGate({
  hairAChanged: out.verdict.hairAChanged,
  hairBChanged: out.verdict.hairBChanged,
  hairA: out.regions.hairA?.targetConvergence,
  hairB: out.regions.hairB?.targetConvergence,
  legacyAggregate: out.regions.hair,
});
out.hairFormalGate = hairFormalGate;
out.verdict.hairAFormalGate = hairFormalGate.formalTargetGate.hairA;
out.verdict.hairBFormalGate = hairFormalGate.formalTargetGate.hairB;
for (const slot of ["hairA", "hairB"]) {
  if (hairFormalGate.formalTargetGate[slot] === true) continue;
  // 细分失败通常已在逐槽分析中记录；这里补上组合 Gate 的硬阻断，
  // 覆盖 inputsValid/一致性未来发生变化但细分日志未覆盖的情况。
  if (!failures.some((failure) => failure.startsWith(slot + " "))) {
    failures.push(slot + " 正式 Hair Gate 未通过（需 changed + targetConvergence + 合法同槽输入）");
  }
}
out.failures = failures;

// ── P0-1 目标参考收敛判定（脸部皮肤，色比口径）────────────────────
// 同名同帧脸框皮肤色比：original 与 V1 分别对 V14D 目标求色比距离，要求 V1 显著更接近。
// 这替代「original↔V1 差异大=收敛」的伪判定——只有对目标的误差真实下降才算收敛。
const faceRegion = regions.face;
const stageOrig = stageFaceRatio(a, faceRegion);
const stageV1 = stageFaceRatio(b, faceRegion);
let targetCmp = null;
if (fs.existsSync(TARGET)) {
  const targetSha256 = crypto.createHash("sha256").update(fs.readFileSync(TARGET)).digest("hex");
  const tgt = await targetSkinRatio(TARGET);
  if (tgt && stageOrig && stageV1) {
    const distOrig = ratioDist(stageOrig.ratio, tgt.ratio);
    const distV1 = ratioDist(stageV1.ratio, tgt.ratio);
    const drop = distOrig > 0 ? (distOrig - distV1) / distOrig : 0;
    targetCmp = { targetRatio: tgt.ratio, targetSamples: tgt.samples, origRatio: stageOrig.ratio, v1Ratio: stageV1.ratio, distOrig: +distOrig.toFixed(4), distV1: +distV1.toFixed(4), drop: +drop.toFixed(4) };
    // 候选指标元数据：记录口径边界、目标 SHA256、两侧样本分母，便于审计与复验。
    out.targetMetric = {
      label: "脸部综合色比候选指标（非同像素/非空间阴影对齐）",
      caveat: "目标侧=整图 isSkin 肤色像素（分母 targetSamples），舞台侧=舞台脸框 isSkin 像素（分母 stageFaceSamples），样本空间不同、未做 UV/空间配准；仅证明整体色比更接近，不证明 State2 空间阴影逐像素对齐，非皮肤阶段最终完成判据。",
      targetPath: TARGET,
      targetSha256,
      targetSamples: tgt.samples,
      stageFaceSamples: stageV1.samples,
    };
    out.targetConvergence = targetCmp;
    const ok = distV1 < distOrig && drop > THRESHOLDS.targetConvergeDrop;
    out.verdict.faceTargetConverged = ok;
    if (!ok) failures.push("P0-1 V1 未向 V14D 目标显著收敛 distOrig=" + distOrig.toFixed(4) + " distV1=" + distV1.toFixed(4) + " drop=" + drop.toFixed(4) + "（需 drop>" + THRESHOLDS.targetConvergeDrop + "）");
  } else failures.push("P0-1 目标参考或脸部皮肤样本为空，无法判定收敛");
} else failures.push("P0-1 目标参考图不存在: " + TARGET);

// P0-1 错误颜色负测：把 V1 画布 R 通道压制（皮肤变青绿，远离 V14D 暖肤目标）。
// 直接操作像素：R*0.4、保留 G/B，isSkin 仍部分命中（R>G 可能不再成立时取 R 提升前的口径），
// 故此处用宽松皮肤掩码（仅 R>60 且曾为皮肤区）统计错色色比。若错色仍被判收敛则判定无效 → fail。
if (targetCmp) {
  try {
    const mod = Buffer.from(b.data); // 复制 V1 像素
    for (let i = 0; i < mod.length; i += 4) {
      if (mod[i + 3] < 8) continue;
      const r = mod[i], g = mod[i + 1], bb = mod[i + 2];
      if (isSkin(r, g, bb)) { mod[i] = Math.round(r * 0.35); mod[i + 1] = Math.min(255, Math.round(g * 1.1)); } // 错色：压 R 提 G
    }
    const negImg = { data: mod, width: b.width, height: b.height };
    // 宽松掩码：用原始图判定皮肤位置，读错色后的值
    const { x0, y0, x1, y1 } = bounds(faceRegion);
    let n = 0, s = [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      if (b.data[i + 3] < 8) continue;
      if (!isSkin(b.data[i], b.data[i + 1], b.data[i + 2])) continue; // 按原始 V1 皮肤位置
      s[0] += mod[i]; s[1] += mod[i + 1]; s[2] += mod[i + 2]; n++;
    }
    if (n) {
      const m = s.map((v) => v / n);
      const negRatio = [+(m[0] / m[1]).toFixed(4), +(m[0] / m[2]).toFixed(4)];
      const negDist = ratioDist(negRatio, targetCmp.targetRatio);
      const negDrop = (targetCmp.distOrig - negDist) / targetCmp.distOrig;
      out.negWrongColor = { negRatio, negDist: +negDist.toFixed(4), negDrop: +negDrop.toFixed(4), samples: n };
      const negConverged = negDist < targetCmp.distOrig && negDrop > THRESHOLDS.targetConvergeDrop;
      if (negConverged) failures.push("P0-1 负测失效：错误青绿肤色被判收敛 negDist=" + negDist.toFixed(4) + " negDrop=" + negDrop.toFixed(4));
    } else { out.negWrongColor = { error: "无皮肤样本" }; failures.push("P0-1 负测无皮肤样本，无法验证判别力"); }
  } catch (e) { out.negWrongColorError = String(e); failures.push("P0-1 负测执行异常: " + e); }
}

// 分区 UV 取证图（人读 A/B 证据）：HairA/HairB 各自的 original 语义 / V14D 目标 /
// 差异图。即使 Gate 失败也产出（便于审查失败形态）；不阻断判定。
try {
  out.hairUvImages = await writeHairSlotUvImages();
} catch (e) { out.hairUvImagesError = String(e); }

// Hair 负测模式：把“预期的正式目标 Gate 拒绝”与“负测失效/配置错误/分析异常”
// 机器区分。wrongTint 的预期拒绝保持 analyzer exit 0；swap-slot-target 则必须
// analyzer exit 非零。两者都要求 negativeVerdict.status=rejected，且只有 HairA
// 与 HairB 都由正式逐屏幕 triUV TargetConverged 判据得到 false 才能成立。
if (NEG_WRONGTINT || NEG_SWAP_SLOT_TARGET) {
  const formalTargetGate = out.hairFormalGate?.formalTargetGate ?? { hairA: null, hairB: null };
  const negA = formalTargetGate.hairA;
  const negB = formalTargetGate.hairB;
  const negativeMetrics = {
    hairA: out.regions.hairA?.targetConvergence ?? null,
    hairB: out.regions.hairB?.targetConvergence ?? null,
  };
  const expectedHairFailure = (message) => message.startsWith("hairA 未向权威 V14D 头发目标收敛")
    || message.startsWith("hairB 未向权威 V14D 头发目标收敛");
  const formalReject = negA === false && negB === false;
  // 两种负测都把 HairA/HairB 正式目标 Gate=false 视为“语义拒绝”而非分析异常，
  // 因此 analysisFailures 不包含这两条预期失败；但只有 wrongTint 协议把预期失败
  // 从总 failures 移除并以 exit=0 结束。swap-slot-target 必须保留正式 Gate 失败，
  // 以 exit=1 证明错槽/错目标确实阻断正式 Gate，而不是靠 negativeVerdict 软通过。
  const otherFailures = failures.filter((failure) => !expectedHairFailure(failure));
  if (NEG_WRONGTINT && formalReject) {
    for (let i = failures.length - 1; i >= 0; i -= 1) if (expectedHairFailure(failures[i])) failures.splice(i, 1);
  }
  const mode = NEG_WRONGTINT ? "wrongTint" : "swapSlotTarget";
  const negativeProtocol = evaluateV14dHairNegativeProtocol({
    mode,
    formalTargetGate,
    hairA: negativeMetrics.hairA,
    hairB: negativeMetrics.hairB,
    analysisFailures: otherFailures,
  });
  const naturalMetricGate = negativeProtocol.naturalMetricGate;
  const bindingInputsValid = negativeProtocol.bindingInputsValid;
  const naturalMetricReject = naturalMetricGate.hairA === false && naturalMetricGate.hairB === false;
  const validNegativeInputs = bindingInputsValid.hairA && bindingInputsValid.hairB;
  const naturalReasons = [
    ...(negativeMetrics.hairA?.metricFailureReasons ?? []).map((reason) => "HairA: " + reason),
    ...(negativeMetrics.hairB?.metricFailureReasons ?? []).map((reason) => "HairB: " + reason),
  ];
  const rejectionReason = formalReject && naturalMetricReject && validNegativeInputs
    ? (NEG_WRONGTINT
      ? naturalReasons
      : [
          "HairA target/triUV source intentionally swapped to HairB",
          "HairB target/triUV source intentionally swapped to HairA",
          ...naturalReasons,
        ])
    : [
        ...(negA !== false ? ["HairA formal target gate did not reject: " + negA] : []),
        ...(negB !== false ? ["HairB formal target gate did not reject: " + negB] : []),
        ...(naturalMetricReject ? [] : ["natural metric Gate did not reject both slots"]),
        ...(validNegativeInputs ? [] : ["negative input binding/sample evidence invalid"]),
        ...(otherFailures.length > 0 ? ["other analysis failures: " + otherFailures.join(" | ")] : []),
      ];
  out.negativeVerdict = {
    mode,
    status: negativeProtocol.status,
    rejected: negativeProtocol.rejected,
    semanticMismatch: NEG_SWAP_SLOT_TARGET,
    formalTargetGate: { hairA: negA, hairB: negB },
    naturalMetricGate,
    bindingInputsValid,
    rejectionReason,
    analysisFailures: otherFailures,
  };
  if (out.negativeVerdict.status !== "rejected") {
    failures.push(mode + " negative protocol failed: " + rejectionReason.join(" | "));
  }
}

out.pass = failures.length === 0;
fs.writeFileSync(REPORT_JSON, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ pass: out.pass, verdict: out.verdict, negativeVerdict: out.negativeVerdict ?? null, hairSlotIdentity: out.hairSlotIdentity, occluded: out.occluded, failures }, null, 2));
if (!out.pass) { console.error("===VISUAL-GATE-FAIL==="); process.exit(1); }
console.log(NEG_WRONGTINT || NEG_SWAP_SLOT_TARGET ? "===VISUAL-GATE-NEGATIVE-REJECTED===" : "===VISUAL-GATE-OK===");
