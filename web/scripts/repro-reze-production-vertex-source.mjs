// Stage 2C-M2a.2 最小红灯：生产 material-ID pick 与同帧 triUV 身份是否同像素。
// 只调用显式 acceptance probe；生产源快照通过 reze-engine 的只读 seam 返回，
// 不从舞台侧猜测/改写私有 buffer。默认命令验证生产 draw-call 同源 triUV，
// --neg-wrong-source 与 --neg-mat-swap 必须保持非零以证明负测可检出。
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.V14D_CAPTURE_ORIGIN || "http://127.0.0.1:3001";
const BASE = ORIGIN + "/companion?v14dAcceptanceProbe=1";
const OUT = path.resolve(process.env.V14D_REPRO_OUT || ".scratch/reze-production-vertex-source");
const IMPORT_CACHE = path.resolve(process.env.V14D_IMPORT_CACHE || ".scratch/reze-k3-v1-stage/import-koleda");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX_NAME = "GirlsFrontline KoledaDefault.pmx";
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const VMD_URL = "/__probe__/koleda-v14d-authoritative-pose-f120.vmd";
const WIDTH = 1440;
const HEIGHT = 960;
const THRESHOLDS = { minOverlapRatio: 0.6, maxCentroidShiftPx: 3 };
const NEG_WRONG_SOURCE = process.argv.includes("--neg-wrong-source");
const NEG_MAT_SWAP = process.argv.includes("--neg-mat-swap");
const SOURCE_MODE = NEG_WRONG_SOURCE ? "cpu-base" : "production-draw-call";
fs.mkdirSync(OUT, { recursive: true });

function linkTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const source = path.join(src, entry.name);
    const target = path.join(dst, entry.name);
    if (entry.isDirectory()) linkTree(source, target);
    else if (!fs.existsSync(target)) {
      try { fs.linkSync(source, target); } catch { fs.copyFileSync(source, target); }
    }
  }
}
if (!fs.existsSync(path.join(IMPORT_CACHE, PMX_NAME))) linkTree(KOLEDA_DIR, IMPORT_CACHE);

const report = {
  ticket: "Stage2C-M2a.2 production vertex source",
  origin: ORIGIN,
  viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  capture: { vmd: VMD_URL, seconds: 4, frame: 120, fps: 30 },
  thresholds: THRESHOLDS,
  mode: { sourceMode: SOURCE_MODE, materialIdSwap: NEG_MAT_SWAP, expectedNegative: NEG_WRONG_SOURCE || NEG_MAT_SWAP },
  slots: {},
  audit: null,
  auditChecks: {},
  captureEvidenceChecks: {},
  negativeVerdict: null,
  accepted: false,
  failureClassifications: [],
  failures: [],
  pass: false,
};

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "reze-production-source-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME_EXE,
  headless: true,
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  args: ["--enable-unsafe-webgpu"],
});
const page = context.pages()[0] ?? (await context.newPage());
page.on("pageerror", (error) => report.failures.push("pageerror: " + String(error).slice(0, 300)));
await page.addInitScript(() => {
  window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({
    userId: "8X29-AF3E", renderPipeline: "mio-reference", ttsEnabled: false,
  }));
});

const STUB_MODEL = {
  name: PMX_NAME,
  label: "克莱妲",
  relative_path: PMX_NAME,
  size_bytes: 0,
  url: "/assets/mmd/models/" + encodeURIComponent(PMX_NAME),
};
function findAsset(relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  let current = KOLEDA_DIR;
  for (const part of parts) {
    if (!fs.existsSync(current)) return null;
    const hit = fs.readdirSync(current, { withFileTypes: true })
      .find((entry) => entry.name.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    current = path.join(current, hit.name);
  }
  return fs.existsSync(current) && fs.statSync(current).isFile() ? current : null;
}
const json = (route, body) => route.fulfill({
  status: 200, contentType: "application/json", body: JSON.stringify(body),
});
await page.route("**/api/backend/**", async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname.replace(/^\/api\/backend/, "");
  if (p.startsWith("/codex/knowledge/review-summary")) return json(route, { workspace_key: null, total: 0, pending: 0, by_status: {} });
  if (p.startsWith("/assets/mmd/models")) return json(route, { items: [STUB_MODEL] });
  if (p.startsWith("/assets/vmd")) return json(route, { items: [] });
  if (p.startsWith("/config/mapping/resolved/")) return json(route, { mappings: {} });
  if (p === "/sessions" && route.request().method() === "GET") return json(route, { items: [] });
  if (p === "/sessions" && route.request().method() === "POST") return json(route, { session: { id: "stub-session-1", title: "验收会话", selected_model_path: null } });
  if (/^\/sessions\/[^/]+\/messages/.test(p)) return json(route, { items: [] });
  if (p.startsWith("/companion") || p.startsWith("/config/companion")) {
    return json(route, { user_id: "8X29-AF3E", selected_model_path: null, render_pipeline: "reze-k3", reze_stage_document: null, updated_at: null });
  }
  return json(route, { items: [] });
});
await page.route("**://127.0.0.1:8000/**", async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname;
  if (/\.pmx$/i.test(p)) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(path.join(KOLEDA_DIR, PMX_NAME)) });
  if (/\.(png|jpe?g|webp|bmp|tga|sph|spa)$/i.test(p)) {
    const relative = p.replace(/^\/assets\/mmd\/models\/?/i, "");
    const found = findAsset(relative);
    if (found) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(found) });
    return json(route, { detail: "texture not found: " + relative });
  }
  if (p.startsWith("/desktop-pet/shared-config")) return json(route, { user_id: "8X29-AF3E", selected_model_path: null, render_pipeline: "reze-k3" });
  if (p.startsWith("/assets/mmd/models")) return json(route, { items: [STUB_MODEL] });
  if (p.startsWith("/assets/mmd/vmds") || p.startsWith("/assets/vmd")) return json(route, { items: [] });
  return json(route, { items: [] });
});
await page.route("**/*.vmd", (route) => route.fulfill({
  status: 200, contentType: "application/octet-stream", body: fs.readFileSync(VMD),
}));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
await page.waitForTimeout(2500);
await page.click("button.mio-advanced-mode");
await page.waitForSelector("[data-testid=mio-advanced-panel]", { timeout: 15000 });
await page.click('.mio-pipeline-option:has-text("Reze K3")');
await page.waitForTimeout(800);
await page.click('button.mio-nav-button[aria-label="打开 Reze 材质与场景编辑器"]', { force: true });
await page.waitForSelector('button.mio-reze-editor-tool[aria-label="资产"]', { timeout: 20000 });
await page.click('button.mio-reze-editor-tool[aria-label="资产"]');
await page.waitForSelector("input[type=file][webkitdirectory]", { timeout: 20000 });
await page.locator("input[type=file][webkitdirectory]").first().setInputFiles(IMPORT_CACHE);
await page.waitForSelector('canvas[data-webgpu-status="ready"]', { timeout: 120000 });
await page.click("button.mio-advanced-mode").catch(() => {});
await page.waitForTimeout(500);
await page.click('[data-testid="reze-k3-skin-variant-v1"]');
await page.waitForSelector('canvas[data-webgpu-status="ready"]', { timeout: 120000 });
await page.waitForTimeout(500);

const result = await page.evaluate(async ({ vmdUrl, sourceMode, materialIdSwap }) => {
  const stage = window.__rezeStageProbe;
  if (!stage?.playVmd || !stage.captureHairTriUv) return { error: "stage probe unavailable" };
  await stage.playVmd(vmdUrl);
  stage.pauseVmd();
  stage.seekVmd(4);
  stage.pauseVmd();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  // 使用已有 acceptance probe 的诊断近景，不直接触碰引擎私有相机字段；
  // 该调用只存在于显式验收页面，生产默认入口不会暴露它。
  const engine = stage.engineRef?.current;
  const model = stage.modelRef?.current;
  if (!engine || !model) return { error: "engine/model unavailable" };
  engine.stopRenderLoop();
  model.pause();
  stage.cameraOrbit("face");
  engine.renderFrame(0);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  let raw;
  try {
    raw = await stage.captureHairTriUv(["Brows", "Lashes"], {
      useForegroundDepth: true,
      nearClipOverride: 1.0,
      sourceMode,
    });
  } finally {
    // 验收取景只服务本次 capture；取证完成后立即恢复 boot/settings 默认取景。
    stage.cameraOrbit("reset");
  }
  if (!raw || raw.error) return raw || { error: "capture failed" };
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = raw.materialMaskPng; });
  const canvas = document.createElement("canvas");
  canvas.width = raw.width; canvas.height = raw.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { error: "mask context unavailable" };
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, raw.width, raw.height).data;
  const slots = {};
  for (const name of ["Brows", "Lashes"]) {
    const swappedName = name === "Brows" ? "Lashes" : "Brows";
    const id = Number(raw.materialIdByName?.[materialIdSwap ? swappedName : name]);
    const triMask = raw.byMaterial?.[name]?.triMask || [];
    let productionPixels = 0; let triUvPixels = 0; let overlapPixels = 0;
    let px = 0; let py = 0; let tx = 0; let ty = 0;
    for (let i = 0; i < raw.width * raw.height; i += 1) {
      const production = pixels[i * 4] !== 0 && pixels[i * 4 + 1] === id;
      const triUv = triMask[i] === 1;
      if (production) { productionPixels += 1; px += i % raw.width; py += Math.floor(i / raw.width); }
      if (triUv) { triUvPixels += 1; tx += i % raw.width; ty += Math.floor(i / raw.width); }
      if (production && triUv) overlapPixels += 1;
    }
    const denominator = Math.min(productionPixels, triUvPixels);
    const overlapRatio = denominator > 0 ? overlapPixels / denominator : 0;
    const centroidShift = productionPixels > 0 && triUvPixels > 0
      ? { dx: tx / triUvPixels - px / productionPixels, dy: ty / triUvPixels - py / productionPixels }
      : null;
    const shift = centroidShift ? Math.hypot(centroidShift.dx, centroidShift.dy) : null;
    slots[name] = {
      materialId: id, productionPixels, triUvPixels, overlapPixels,
      overlapRatio: Number(overlapRatio.toFixed(6)),
      centroidShift: centroidShift ? { dx: Number(centroidShift.dx.toFixed(2)), dy: Number(centroidShift.dy.toFixed(2)) } : null,
      centroidShiftPx: shift === null ? null : Number(shift.toFixed(2)),
      aligned: denominator > 0 && overlapRatio >= 0.6 && shift !== null && shift <= 3,
    };
  }
  const productionSource = raw.productionSource || null;
  const auditInstances = productionSource?.instances || [];
  const targetInstances = auditInstances.filter((instance) =>
    instance.drawCalls?.some((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes"),
  );
  const targetDraws = targetInstances.flatMap((instance) =>
    instance.drawCalls.filter((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes"),
  );
  const sourceAudit = {
    schemaVersion: productionSource?.schemaVersion ?? null,
    captureId: productionSource?.captureId ?? null,
    frame: productionSource?.frame ?? null,
    source: productionSource?.source ?? null,
    instanceCount: auditInstances.length,
    targetInstanceCount: targetInstances.length,
    targetDraws,
    targetInstances: targetInstances.map((instance) => ({
      name: instance.name,
      visible: instance.visible,
      geometry: instance.geometry,
      sourceIdentity: instance.sourceIdentity,
      bufferIdentity: instance.bufferIdentity,
      buffers: instance.buffers,
      transforms: instance.transforms,
      indexIntegrity: instance.indexIntegrity,
    })),
    renderTargets: productionSource?.renderTargets || null,
  };
  const evidence = raw.captureEvidence || {};
  const evidenceFields = [evidence.pixel, evidence.materialMask, evidence.triUv];
  const captureEvidenceChecks = {
    allPresent: evidenceFields.every((item) => item && typeof item === "object"),
    captureIdMatches: evidenceFields.length === 3
      && evidenceFields.every((item) => String(item.captureId) === String(raw.captureId)),
    frameMatches: evidenceFields.length === 3
      && evidenceFields.every((item) => Number.isFinite(item.currentFrame) && Math.abs(item.currentFrame - 120) <= 1e-6),
    dimensionsMatch: evidenceFields.length === 3
      && evidenceFields.every((item) => item.width === raw.width && item.height === raw.height),
  };
  const auditChecks = {
    sourceMode: raw.sourceMode === sourceMode,
    captureIdMatches: String(raw.captureId) === String(productionSource?.captureId),
    frameMatches: Number.isFinite(productionSource?.frame) && Math.abs(Number(productionSource.frame) - 120) <= 1e-6,
    productionSourceSchema: productionSource?.schemaVersion === 1,
    pickPipelineIdentity: productionSource?.pickPipeline?.sameAsEngine === true,
    productionSourceIdentity: targetInstances.length > 0
      && targetInstances.every((instance) => Object.values(instance.bufferIdentity || {}).every(Boolean))
      && targetInstances.every((instance) => Object.values(instance.sourceIdentity || {}).every((value) => typeof value === "string" && value.length > 0)),
    nonZeroVertexSource: targetInstances.length > 0
      && targetInstances.every((instance) => (instance.buffers?.vertex?.nonZeroPositionVertexCount || 0) > 0),
    drawCallBindingsMatchPick: targetDraws.length > 0 && targetDraws.every((draw) =>
      draw.rangeMatchesPick === true
      && draw.pickBindGroupMatchesEngine === true
      && draw.mainBindGroupMatchesEngine === true),
    mainPipelinePresent: targetDraws.length > 0 && targetDraws.every((draw) => draw.mainPipelinePresent === true),
    indexIntegrity: targetInstances.length > 0
      && targetInstances.every((instance) => instance.indexIntegrity?.allDrawRangesInBounds
        && instance.indexIntegrity?.referencedVertexIndicesInBounds),
    skinSourcePresent: targetInstances.length > 0
      && targetInstances.every((instance) => instance.transforms?.skinMatrixSource === "model.getSkinMatrices -> skinMatrixBuffer"
        && (instance.buffers?.skinMatrices?.nonZeroValueCount || 0) > 0),
    morphSourcePresent: targetInstances.length > 0
      && targetInstances.every((instance) => instance.transforms?.morphMode === "gpu-compute-in-place"
        ? instance.transforms?.morphWeightsReadback === true
        : instance.transforms?.morphMode === "cpu-upload"),
    renderTargetsMatchEngine: productionSource?.renderTargets?.hdrResolveTexture?.sameAsEngine === true
      && productionSource?.renderTargets?.maskResolveTexture?.sameAsEngine === true,
  };
  return { captureId: raw.captureId, source: raw.source, sourceMode: raw.sourceMode, width: raw.width, height: raw.height, slots, audit: sourceAudit, auditChecks, captureEvidenceChecks };
}, { vmdUrl: VMD_URL, sourceMode: SOURCE_MODE, materialIdSwap: NEG_MAT_SWAP });

report.captureId = result?.captureId ?? null;
report.source = result?.source ?? null;
report.sourceMode = result?.sourceMode ?? null;
report.width = result?.width ?? null;
report.height = result?.height ?? null;
report.slots = result?.slots ?? {};
report.audit = result?.audit ?? null;
report.auditChecks = result?.auditChecks ?? {};
report.captureEvidenceChecks = result?.captureEvidenceChecks ?? {};
if (result?.error) report.failures.push(result.error);
if (result?.error) {
  report.failureClassifications.push({
    code: result.errorCode || "unknown",
    class: result.errorClass || "unknown",
  });
}
const alignmentFailures = [];
for (const name of ["Brows", "Lashes"]) {
  const slot = report.slots[name];
  if (!slot?.aligned) {
    alignmentFailures.push(name);
    report.failures.push(name + " production material-ID 与 triUV 未同像素对齐");
  }
}
for (const [name, ok] of Object.entries(report.auditChecks)) {
  if (!ok) report.failures.push("production source audit check failed: " + name);
}
for (const [name, ok] of Object.entries(report.captureEvidenceChecks)) {
  if (!ok) report.failures.push("capture evidence check failed: " + name);
}
const auditChecksPresent = Object.keys(report.auditChecks).length > 0;
const captureEvidenceChecksPresent = Object.keys(report.captureEvidenceChecks).length > 0;
const auditPassed = auditChecksPresent
  && captureEvidenceChecksPresent
  && Object.values(report.auditChecks).every(Boolean)
  && Object.values(report.captureEvidenceChecks).every(Boolean);
report.negativeVerdict = report.mode.expectedNegative
  ? {
      status: alignmentFailures.length > 0 ? "rejected" : "not-rejected",
      rejectionClass: alignmentFailures.length > 0 ? "alignment-failed" : "missing-expected-alignment-failure",
      failedSlots: alignmentFailures,
      auditPassed,
      accepted: alignmentFailures.length > 0 && auditPassed,
    }
  : null;
report.pass = !report.mode.expectedNegative && report.failures.length === 0;
report.accepted = report.mode.expectedNegative ? report.negativeVerdict.accepted : report.pass;
const reportPath = path.join(OUT, report.mode.expectedNegative ? "negative-report.json" : "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
await context.close();
console.log(JSON.stringify({ pass: report.pass, report: reportPath, slots: report.slots, auditChecks: report.auditChecks, failures: report.failures }, null, 2));
if (report.mode.expectedNegative) {
  if (report.negativeVerdict?.accepted) {
    console.log("===REZE-PRODUCTION-VERTEX-SOURCE-EXPECTED-NEGATIVE-REJECTED===");
  } else {
    console.error("===REZE-PRODUCTION-VERTEX-SOURCE-NEGATIVE-PROTOCOL-FAIL===");
  }
  process.exit(1);
} else if (!report.pass) {
  console.error("===REZE-PRODUCTION-VERTEX-SOURCE-FAIL===");
  process.exit(1);
} else {
  console.log("===REZE-PRODUCTION-VERTEX-SOURCE-OK===");
  process.exit(0);
}
