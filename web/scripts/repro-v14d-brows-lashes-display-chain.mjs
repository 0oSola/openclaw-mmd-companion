// Stage 2C-M2a.3 最小红灯：强 sentinel 已进入 Brows/Lashes 编译结果，
// 但最终 canvas 是否仍与 identity 相同。
//
// 这是只读诊断复现：浏览器内只读取引擎运行时对象、调用既有 acceptance probe，
// 不改生产图、正式阈值、相机、PMX/VMD 或 alpha analyzer。原始 PNG/JSON 全部写入
// .scratch/repro-v14d-brows-lashes-display-chain，不提交。
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  makeV14dDisplayChainDrawIdentityKey,
  validateV14dDisplayChainDrawTrace,
} from "../src/features/stage/v14dDisplayChainEvidence.mjs";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.V14D_CAPTURE_ORIGIN || "http://127.0.0.1:3114";
const BASE = ORIGIN + "/companion?v14dAcceptanceProbe=1";
const OUT = path.resolve(process.env.V14D_REPRO_OUT || ".scratch/repro-v14d-brows-lashes-display-chain");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX_NAME = "GirlsFrontline KoledaDefault.pmx";
const PMX = path.join(KOLEDA_DIR, PMX_NAME);
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const VMD_URL = "/__probe__/koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:\\w\\rk3-face-v14d\\experiments\\koleda-v14d-face-shadow\\assets\\textures\\v14d-01234-face-shadow-state-2.png";
const MASK_NAME = "v14d-01234-face-shadow-state-2.png";
const WIDTH = 1440;
const HEIGHT = 960;
const USER_ID = "8X29-AF3E";
const RUNS = Number(process.env.V14D_REPRO_RUNS || 1);
const PAIR_ID = "v14d-bl-pair";
const IDENTITY_CAPTURE_ID = PAIR_ID + "-identity";
const IDENTITY_CONTROL_CAPTURE_ID = PAIR_ID + "-identity-control";
const SENTINEL_CAPTURE_ID = PAIR_ID + "-sentinel";
const OUTSIDE_TARGET_NOISE_BUDGET = Object.freeze({ changedRatio: 0.02, meanAbsRgbSum: 1, p95AbsRgbSum: 4 });
const OUTSIDE_TARGET_EXCESS_BUDGET = Object.freeze({ changedRatio: 0.01, meanAbsRgbSum: 1, p95AbsRgbSum: 4 });
const DISPLAY_CHAIN_DIAGNOSTIC_THRESHOLDS = Object.freeze({
  targetCanvasMeanAbsRgbSum: 1,
  targetCanvasChangedRatio: 0.05,
  hdrRedMeanAbsDelta: 0.01,
});

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

function findKoledaAsset(relativePath) {
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

const importDir = path.join(OUT, "import-koleda");
if (!fs.existsSync(path.join(importDir, PMX_NAME))) linkTree(KOLEDA_DIR, importDir);
const maskLink = path.join(importDir, "Textures", MASK_NAME);
if (!fs.existsSync(maskLink)) {
  fs.mkdirSync(path.dirname(maskLink), { recursive: true });
  try { fs.linkSync(STATE2_MASK, maskLink); } catch { fs.copyFileSync(STATE2_MASK, maskLink); }
}

const report = {
  ticket: "Stage 2C-M2a.3 Brows/Lashes display chain minimum repro",
  origin: ORIGIN,
  viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  authority: {
    pmx: PMX,
    vmd: VMD_URL,
    seconds: 4,
    frame: 120,
    fps: 30,
    camera: "face",
    pairId: PAIR_ID,
    identityCaptureId: IDENTITY_CAPTURE_ID,
    identityControlCaptureId: IDENTITY_CONTROL_CAPTURE_ID,
    sentinelCaptureId: SENTINEL_CAPTURE_ID,
  },
  hypotheses: [
    { id: "H1", statement: "applyStyleGroups 成功后冻结帧没有新的 renderFrame/command submission", prediction: "补一次零增量 render 后，实际 draw、HDR 与 canvas 出现 sentinel 差异" },
    { id: "H2", statement: "pipeline cache/signature 错误复用旧 pipeline", prediction: "identity 与 sentinel compile/install 或实际 draw pipeline 身份相同" },
    { id: "H3", statement: "applyStyleGroups 后 draw-call group/pipeline 未重建", prediction: "style group 状态变化但实际 setPipeline 仍为 identity" },
    { id: "H4", statement: "正确 fragment 写入中间目标后被后续 pass 覆盖", prediction: "Brows/Lashes HDR 变化但 resolve/composite/canvas 不变化" },
    { id: "H5", statement: "采集或重建时序撤销 sentinel", prediction: "apply 后 graph/tint/pipeline 回退或出现重建/请求错误" },
  ],
  diagnosis: {
    firstLostBoundary: "applyStyleGroups 返回之后 → 下一次 renderFrame/command submission 之前",
    pairId: PAIR_ID,
    frame: 120,
  },
  runs: [],
  pageErrors: [],
  failedRequests: [],
  httpBad: [],
  failures: [],
};

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installRoutes(page) {
  const stubModel = {
    name: PMX_NAME,
    label: "克莱妲",
    relative_path: PMX_NAME,
    size_bytes: 0,
    url: "/assets/mmd/models/" + encodeURIComponent(PMX_NAME),
  };
  await page.route("**/api/backend/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace(/^\/api\/backend/, "");
    if (endpoint.startsWith("/codex/knowledge/review-summary")) return json(route, { workspace_key: null, total: 0, pending: 0, by_status: {} });
    if (endpoint.startsWith("/assets/mmd/models")) return json(route, { items: [stubModel] });
    if (endpoint.startsWith("/assets/vmd")) return json(route, { items: [] });
    if (endpoint.startsWith("/config/mapping/resolved/")) return json(route, { mappings: {} });
    if (endpoint === "/sessions" && route.request().method() === "GET") return json(route, { items: [] });
    if (endpoint === "/sessions" && route.request().method() === "POST") return json(route, { session: { id: "stub-session-1", title: "显示链复现", selected_model_path: null } });
    if (/^\/sessions\/[^/]+\/messages/.test(endpoint)) return json(route, { items: [] });
    if (endpoint.startsWith("/companion") || endpoint.startsWith("/config/companion")) return json(route, { user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3", reze_stage_document: null, updated_at: null });
    return json(route, { items: [] });
  });
  await page.route("**://127.0.0.1:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname;
    if (/\\.pmx$/i.test(endpoint)) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(PMX) });
    if (/\\.(png|jpe?g|webp|bmp|tga|sph|spa)$/i.test(endpoint)) {
      const relative = endpoint.replace(/^\/assets\/mmd\/models\/?/i, "");
      const found = findKoledaAsset(relative);
      if (found) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(found) });
      return json(route, { detail: "texture not found: " + relative }, 404);
    }
    if (endpoint.startsWith("/desktop-pet/shared-config")) return json(route, { user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3" });
    if (endpoint.startsWith("/assets/mmd/models")) return json(route, { items: [stubModel] });
    if (endpoint.startsWith("/assets/mmd/vmds") || endpoint.startsWith("/assets/vmd")) return json(route, { items: [] });
    return json(route, { items: [] });
  });
  await page.route("**/*.vmd", (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(VMD) }));
}

async function preparePage(page) {
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.stack || error)));
  page.on("requestfailed", (request) => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "unknown" }));
  page.on("response", (response) => {
    if (response.status() >= 400) report.httpBad.push({ url: response.url(), status: response.status() });
  });
  await page.addInitScript((uid) => {
    window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: uid, renderPipeline: "mio-reference", ttsEnabled: false }));
  }, USER_ID);
  await installRoutes(page);
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
  await page.locator("input[type=file][webkitdirectory]").first().setInputFiles(importDir);
  await page.waitForSelector('canvas[data-webgpu-status="ready"]', { timeout: 120000 });
  await page.click("button.mio-advanced-mode").catch(() => {});
  await page.waitForTimeout(500);
  await page.click('[data-testid="reze-k3-skin-variant-v1"]');
  await page.waitForSelector('canvas[data-webgpu-status="ready"]', { timeout: 120000 });
  await page.waitForTimeout(500);
}

const FAULT_NO_RENDER = process.argv.includes("--fault-no-render");

async function runOnce(index) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-bl-chain-repro-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_EXE,
    headless: true,
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    args: ["--enable-unsafe-webgpu"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await preparePage(page);
    const setup = await page.evaluate(async ({ vmdUrl }) => {
      const stage = window.__rezeStageProbe;
      if (!stage?.playVmd || !stage?.cameraOrbit) return { error: "display chain setup probe unavailable" };
      await stage.playVmd(vmdUrl);
      stage.pauseVmd();
      stage.seekVmd(4);
      stage.pauseVmd();
      stage.cameraOrbit("face");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { frame: Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || 0) * 30 };
    }, { vmdUrl: VMD_URL });
    if (setup.error) return { index, error: setup.error };
    const traceInstalled = await page.evaluate(() => window.__rezeStageProbe?.installDisplayChainTrace?.() || { ok: false, error: "trace install unavailable" });
    if (!traceInstalled?.ok) return { index, error: "display chain trace install failed", traceInstalled };
    await page.evaluate(() => {
      const stage = window.__rezeStageProbe;
      stage.engineRef.current.stopRenderLoop();
      stage.modelRef.current.pause();
    });
    const identity = await page.evaluate((captureId) => window.__rezeStageProbe.captureDisplayChainState({ captureId, frame: 120, render: true }), IDENTITY_CAPTURE_ID);
    if (identity.error) return { index, error: identity.error, identity };
    const identityControl = await page.evaluate((captureId) => window.__rezeStageProbe.captureDisplayChainState({ captureId, frame: 120, render: true }), IDENTITY_CONTROL_CAPTURE_ID);
    if (identityControl.error) return { index, error: identityControl.error, identity, identityControl };
    await page.evaluate((captureId) => {
      const stage = window.__rezeStageProbe;
      stage.engineRef.current.stopRenderLoop();
      stage.modelRef.current.pause();
      stage.setDisplayChainTraceCapture(captureId, 120);
    }, SENTINEL_CAPTURE_ID);
    const applied = await page.evaluate(async (faultNoRender) => {
      const stage = window.__rezeStageProbe;
      return stage.applyBadSkinGraph("wrongBrowsLashesTint", faultNoRender ? { render: false } : undefined);
    }, FAULT_NO_RENDER);
    const sentinel = await page.evaluate((captureId) => window.__rezeStageProbe.captureDisplayChainState({ captureId, frame: 120, render: false, reuseRequestedCapture: true }), SENTINEL_CAPTURE_ID);
    if (sentinel.error) return { index, error: sentinel.error, identity, sentinel };
    const diff = await page.evaluate(async ({ identityDataUrl, identityControlDataUrl, sentinelDataUrl, maskDataUrl, materialIds, materialIdsByName, width, height }) => {
      const decode = async (dataUrl) => {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      };
      const identityPixels = await decode(identityDataUrl);
      const identityControlPixels = await decode(identityControlDataUrl);
      const sentinelPixels = await decode(sentinelDataUrl);
      const mask = await decode(maskDataUrl);
      const targetIds = new Set([Number(materialIds.Brows), Number(materialIds.Lashes)]);
      const measure = (left, right, include) => {
        let sampled = 0; let changed = 0; let sumAbs = 0; let maxAbs = 0; let redAbs = 0;
        const histogram = new Uint32Array(766);
        for (let i = 0; i < width * height; i += 1) {
          const io = i * 4;
          if (!include(io)) continue;
          sampled += 1;
          const dr = Math.abs(left[io] - right[io]);
          const dg = Math.abs(left[io + 1] - right[io + 1]);
          const db = Math.abs(left[io + 2] - right[io + 2]);
          const d = dr + dg + db;
          if (d > 0) changed += 1;
          sumAbs += d; redAbs += dr; maxAbs = Math.max(maxAbs, d);
          histogram[d] += 1;
        }
        let cumulative = 0; let p95 = 0;
        for (let d = 0; d < histogram.length; d += 1) {
          cumulative += histogram[d];
          if (cumulative >= sampled * 0.95) { p95 = d; break; }
        }
        return {
          sampled,
          changed,
          changedRatio: sampled ? Number((changed / sampled).toFixed(6)) : 0,
          meanAbsRgbSum: sampled ? Number((sumAbs / sampled).toFixed(6)) : 0,
          meanAbsRed: sampled ? Number((redAbs / sampled).toFixed(6)) : 0,
          maxAbsRgbSum: maxAbs,
          p95AbsRgbSum: p95,
        };
      };
      const isTarget = (off) => mask[off] !== 0 && targetIds.has(mask[off + 1]);
      const materialId = (name) => Number(materialIdsByName?.[name]);
      const clothingIds = new Set(Object.entries(materialIdsByName || {})
        .filter(([name]) => /^Cth/i.test(name))
        .map(([, id]) => Number(id)));
      const regionPredicates = {
        background: (off) => mask[off] === 0,
        Face: (off) => mask[off] !== 0 && mask[off + 1] === materialId("Face"),
        BodySkin: (off) => mask[off] !== 0 && mask[off + 1] === materialId("BodySkin"),
        HairA: (off) => mask[off] !== 0 && mask[off + 1] === materialId("HairA"),
        HairB: (off) => mask[off] !== 0 && mask[off + 1] === materialId("HairB"),
        clothing: (off) => mask[off] !== 0 && clothingIds.has(mask[off + 1]),
      };
      const subtractNoise = (sentinel, noiseBaseline) => ({
        changedRatio: Number(Math.max(0, sentinel.changedRatio - noiseBaseline.changedRatio).toFixed(6)),
        meanAbsRgbSum: Number(Math.max(0, sentinel.meanAbsRgbSum - noiseBaseline.meanAbsRgbSum).toFixed(6)),
        maxAbsRgbSum: Math.max(0, sentinel.maxAbsRgbSum - noiseBaseline.maxAbsRgbSum),
        p95AbsRgbSum: Math.max(0, sentinel.p95AbsRgbSum - noiseBaseline.p95AbsRgbSum),
      });
      const outsideTargetMask = measure(identityPixels, sentinelPixels, (off) => !isTarget(off));
      const noiseBaselineOutsideTargetMask = measure(identityPixels, identityControlPixels, (off) => !isTarget(off));
      const outsideTargetRegions = Object.fromEntries(Object.entries(regionPredicates)
        .map(([name, include]) => {
          const sentinel = measure(identityPixels, sentinelPixels, include);
          const noiseBaseline = measure(identityPixels, identityControlPixels, include);
          return [name, { observed: sentinel.sampled > 0 && noiseBaseline.sampled > 0, sentinel, noiseBaseline, excess: subtractNoise(sentinel, noiseBaseline) }];
        }));
      return {
        mask: { source: "identity material-ID mask", pairId: "v14d-bl-pair", captureId: "v14d-bl-pair-identity" },
        targetMask: measure(identityPixels, sentinelPixels, (off) => isTarget(off)),
        outsideTargetMask,
        noiseBaselineOutsideTargetMask,
        outsideTargetExcess: subtractNoise(outsideTargetMask, noiseBaselineOutsideTargetMask),
        outsideTargetRegions,
      };
    }, {
      identityDataUrl: identity.canvasDataUrl,
      identityControlDataUrl: identityControl.canvasDataUrl,
      sentinelDataUrl: sentinel.canvasDataUrl,
      maskDataUrl: identity.materialMaskPng,
      materialIds: { Brows: identity.slotStats.Brows.materialId, Lashes: identity.slotStats.Lashes.materialId },
      materialIdsByName: identity.materialIdByName,
      width: identity.width,
      height: identity.height,
    });
    const normalizeMetadata = (state) => ({
      pairId: PAIR_ID,
      captureId: state.captureId,
      currentFrame: state.currentFrame,
      graphName: state.graphName,
      tint: state.tint,
      pipeline: state.targetDraws?.[0]?.compileInstallPipeline || null,
      displayChain: {
        pairId: PAIR_ID,
        requestSerial: state.trace?.requestSerial ?? null,
        frame: state.trace?.frame ?? null,
        renderObserved: state.renderObserved,
        renderLoopRunningBefore: state.renderLoopRunningBefore,
        renderLoopRunningAfter: state.renderLoopRunningAfter,
      },
    });
    const normalizeState = (state) => ({
      runtime: {
        graphName: state.graphName,
        tint: state.tint,
        signature: state.signature,
        pipeline: state.targetDraws?.[0]?.compileInstallPipeline || null,
        drawCalls: (state.targetDraws || []).map((draw) => ({
          materialName: draw.materialName,
          type: "opaque",
          count: draw.count,
          firstIndex: draw.firstIndex,
          drawIndex: draw.drawIndex,
          groupId: draw.groupId,
          bindGroup: draw.bindGroup,
          pipelineUsedByLookup: draw.compileInstallPipeline,
          drawIdentityKey: makeV14dDisplayChainDrawIdentityKey({
            materialName: draw.materialName,
            type: "opaque",
            count: draw.count,
            firstIndex: draw.firstIndex,
            groupId: draw.groupId,
            drawIndex: draw.drawIndex,
            drawOrder: draw.drawIndex,
          }),
        })),
      },
      capture: {
        pairId: PAIR_ID,
        captureId: state.captureId,
        source: "display-chain-state",
        width: state.width,
        height: state.height,
        currentFrame: state.currentFrame,
        captureEvidence: { pixel: { pairId: PAIR_ID, captureId: state.captureId, currentFrame: state.currentFrame, width: state.width, height: state.height } },
        slotStats: state.slotStats,
        materialIdByName: Object.fromEntries(Object.entries(state.slotStats || {}).map(([name, slot]) => [name, slot.materialId])),
        canvasDataUrl: state.canvasDataUrl,
        materialMaskPng: state.materialMaskPng,
        displayChain: {
          pairId: PAIR_ID,
          requestSerial: state.trace?.requestSerial ?? null,
          frame: state.trace?.frame ?? null,
          requestedRender: state.requestedRender,
          renderObserved: state.renderObserved,
          renderLoopRunningBefore: state.renderLoopRunningBefore,
          renderLoopRunningAfter: state.renderLoopRunningAfter,
          renderSerialBefore: state.renderSerialBefore,
          hdr: state.hdr,
          trace: state.trace,
        },
      },
    });
    const normalizedIdentity = normalizeState(identity);
    const normalizedSentinel = normalizeState(sentinel);
    const normalizedIdentityControl = normalizeMetadata(identityControl);
    return { index, setup, applied, traceInstalled, identity: normalizedIdentity, identityControl: normalizedIdentityControl, sentinel: normalizedSentinel, diff };
  } finally {
    await context.close();
  }
}

function roundMetric(value) {
  return Number(Number(value).toFixed(6));
}

function normalizeRgbMean(value) {
  if (!Array.isArray(value) || value.length < 3 || value.slice(0, 3).some((channel) => !Number.isFinite(Number(channel)))) return null;
  return value.slice(0, 3).map((channel) => Number(channel));
}

function buildHdrSlotDelta(identitySlot, sentinelSlot) {
  const identityMean = normalizeRgbMean(identitySlot?.hdrMean);
  const sentinelMean = normalizeRgbMean(sentinelSlot?.hdrMean);
  const observed = Boolean(identitySlot?.samples > 0 && sentinelSlot?.samples > 0 && identityMean && sentinelMean);
  if (!observed) {
    return {
      observed: false,
      identitySamples: Number(identitySlot?.samples || 0),
      sentinelSamples: Number(sentinelSlot?.samples || 0),
      identityHdrMean: identityMean,
      sentinelHdrMean: sentinelMean,
      signedDelta: null,
      absoluteDelta: null,
      redMeanAbsDelta: null,
      changed: false,
    };
  }
  const signedDelta = sentinelMean.map((value, index) => roundMetric(value - identityMean[index]));
  const absoluteDelta = signedDelta.map((value) => roundMetric(Math.abs(value)));
  const redMeanAbsDelta = absoluteDelta[0];
  return {
    observed: true,
    identitySamples: Number(identitySlot.samples),
    sentinelSamples: Number(sentinelSlot.samples),
    identityHdrMean: identityMean,
    sentinelHdrMean: sentinelMean,
    signedDelta,
    absoluteDelta,
    redMeanAbsDelta,
    changed: redMeanAbsDelta > DISPLAY_CHAIN_DIAGNOSTIC_THRESHOLDS.hdrRedMeanAbsDelta,
  };
}

function summarizeTargetTrace(state) {
  const trace = state?.capture?.displayChain?.trace;
  const draws = Array.isArray(trace?.draws) ? trace.draws : [];
  return Object.fromEntries(["Brows", "Lashes"].map((materialName) => {
    const matches = draws.filter((draw) => draw?.materialName === materialName);
    const draw = matches.length === 1 ? matches[0] : null;
    return [materialName, {
      matchCount: matches.length,
      matchStatus: draw?.matchStatus ?? null,
      candidateIndices: draw?.candidateIndices ?? [],
      drawIndex: draw?.drawIndex ?? null,
      drawOrder: draw?.drawOrder ?? null,
      pipeline: draw?.pipeline ?? null,
      bindGroup: draw?.bindGroup ?? null,
      drawIdentityKey: draw?.drawIdentityKey ?? null,
    }];
  }));
}

function summarizeObservation(state) {
  const capture = state?.capture ?? state;
  const displayChain = capture?.displayChain ?? state?.displayChain ?? {};
  const trace = displayChain.trace ?? null;
  return {
    captureId: capture?.captureId ?? null,
    requestSerial: displayChain.requestSerial ?? null,
    frame: displayChain.frame ?? null,
    requestedRender: displayChain.requestedRender ?? null,
    renderObserved: displayChain.renderObserved ?? false,
    renderSerialBefore: displayChain.renderSerialBefore ?? null,
    traceCaptureId: trace?.captureId ?? null,
    traceRequestSerial: trace?.requestSerial ?? null,
    traceFrame: trace?.frame ?? null,
    traceRenderSerial: trace?.renderSerial ?? null,
  };
}

function isStrongTargetCanvasChange(run) {
  const target = run?.diff?.targetMask;
  return Boolean(
    target?.sampled > 0
    && target.meanAbsRgbSum > DISPLAY_CHAIN_DIAGNOSTIC_THRESHOLDS.targetCanvasMeanAbsRgbSum
    && target.changedRatio > DISPLAY_CHAIN_DIAGNOSTIC_THRESHOLDS.targetCanvasChangedRatio,
  );
}

function buildDisplayChainEvidence(run) {
  const identity = run?.identity;
  const sentinel = run?.sentinel;
  const identityCapture = identity?.capture;
  const sentinelCapture = sentinel?.capture;
  const identityTrace = identityCapture?.displayChain?.trace ?? null;
  const sentinelTrace = sentinelCapture?.displayChain?.trace ?? null;
  const hdrSlots = Object.fromEntries(["Brows", "Lashes"].map((name) => [
    name, buildHdrSlotDelta(identityCapture?.slotStats?.[name], sentinelCapture?.slotStats?.[name]),
  ]));
  const composite = {
    identity: {
      pipeline: identityTrace?.compositePipeline ?? null,
      gamma: identityTrace?.compositeGamma ?? null,
    },
    sentinel: {
      pipeline: sentinelTrace?.compositePipeline ?? null,
      gamma: sentinelTrace?.compositeGamma ?? null,
    },
    bothObserved: Boolean(identityTrace?.compositePipeline && sentinelTrace?.compositePipeline),
    pipelineConsistent: Boolean(
      identityTrace?.compositePipeline
      && sentinelTrace?.compositePipeline
      && identityTrace.compositePipeline === sentinelTrace.compositePipeline,
    ),
    gammaConsistent: Boolean(
      Number.isFinite(Number(identityTrace?.compositeGamma))
      && Number.isFinite(Number(sentinelTrace?.compositeGamma))
      && identityTrace.compositeGamma === sentinelTrace.compositeGamma,
    ),
  };
  const hdrResolve = {
    identity: {
      ...summarizeObservation(identity),
      sourceFormat: identityCapture?.displayChain?.hdr?.sourceFormat ?? null,
      nanCount: identityCapture?.displayChain?.hdr?.nanCount ?? null,
      infCount: identityCapture?.displayChain?.hdr?.infCount ?? null,
      slots: identityCapture?.slotStats ?? null,
    },
    sentinel: {
      ...summarizeObservation(sentinel),
      sourceFormat: sentinelCapture?.displayChain?.hdr?.sourceFormat ?? null,
      nanCount: sentinelCapture?.displayChain?.hdr?.nanCount ?? null,
      infCount: sentinelCapture?.displayChain?.hdr?.infCount ?? null,
      slots: sentinelCapture?.slotStats ?? null,
    },
    slots: hdrSlots,
    allSlotsObserved: Object.values(hdrSlots).every((slot) => slot.observed),
    allSlotsChanged: Object.values(hdrSlots).every((slot) => slot.changed),
    allFinite: [identityCapture?.displayChain?.hdr, sentinelCapture?.displayChain?.hdr].every((hdr) => hdr && hdr.nanCount === 0 && hdr.infCount === 0),
  };
  const targetDraws = {
    identity: summarizeTargetTrace(identity),
    sentinel: summarizeTargetTrace(sentinel),
  };
  const compositeTarget = {
    source: "final canvas after composite/tone mapping",
    targetMask: run?.diff?.targetMask ?? null,
    changed: isStrongTargetCanvasChange(run),
  };
  const finalCanvas = {
    targetMask: run?.diff?.targetMask ?? null,
    outsideTargetMask: run?.diff?.outsideTargetMask ?? null,
    outsideTargetExcess: run?.diff?.outsideTargetExcess ?? null,
    changed: isStrongTargetCanvasChange(run),
  };
  const stageDeltas = {
    hdrResolve,
    composite,
    compositeTarget,
    finalCanvas,
  };
  return {
    schemaVersion: 1,
    pairId: PAIR_ID,
    observations: {
      identity: summarizeObservation(identity),
      identityControl: summarizeObservation(run?.identityControl),
      sentinel: summarizeObservation(sentinel),
    },
    targetDraws,
    hdrResolve,
    composite,
    compositeTarget,
    finalCanvas,
    stageDeltas,
  };
}

for (let i = 0; i < RUNS; i += 1) {
  try {
    const result = await runOnce(i + 1);
    report.runs.push(result);
  } catch (error) {
    report.runs.push({ index: i + 1, error: String(error?.stack || error) });
  }
}

for (const run of report.runs) {
  if (run.error) report.failures.push("run " + run.index + ": " + run.error);
  run.displayChain = buildDisplayChainEvidence(run);
  if (!run.identity?.capture || !run.sentinel?.capture) continue;
  if (run.identity.capture.currentFrame == null || Math.abs(Number(run.identity.capture.currentFrame) - 120) > 1e-6) report.failures.push("run " + run.index + ": identity frame is not 120");
  if (run.sentinel.capture.currentFrame == null || Math.abs(Number(run.sentinel.capture.currentFrame) - 120) > 1e-6) report.failures.push("run " + run.index + ": sentinel frame is not 120");
  if (run.identity.capture.pairId !== PAIR_ID || run.sentinel.capture.pairId !== PAIR_ID) report.failures.push("run " + run.index + ": pairId mismatch");
  if (run.identity.capture.captureId !== IDENTITY_CAPTURE_ID || run.sentinel.capture.captureId !== SENTINEL_CAPTURE_ID) report.failures.push("run " + run.index + ": per-side captureId mismatch");
  if (run.identity.capture.captureId === run.sentinel.capture.captureId) report.failures.push("run " + run.index + ": identity/sentinel captureId is not unique");
  if (run.identity.capture.displayChain?.pairId !== PAIR_ID || run.sentinel.capture.displayChain?.pairId !== PAIR_ID) report.failures.push("run " + run.index + ": display trace pairId mismatch");
  if (run.identity.capture.displayChain?.requestSerial == null || run.sentinel.capture.displayChain?.requestSerial == null || run.identity.capture.displayChain.requestSerial === run.sentinel.capture.displayChain.requestSerial) report.failures.push("run " + run.index + ": per-side requestSerial is not unique");
  if (run.identity.capture.displayChain?.frame !== 120 || run.sentinel.capture.displayChain?.frame !== 120) report.failures.push("run " + run.index + ": per-side trace frame is not 120");
  for (const mode of ["identity", "sentinel"]) {
    const observation = run.displayChain.observations[mode];
    if (observation.renderObserved === true
      && (observation.traceCaptureId !== observation.captureId
        || observation.traceRequestSerial !== observation.requestSerial
        || observation.traceFrame !== observation.frame)) {
      report.failures.push("run " + run.index + ": " + mode + " observed render trace identity does not match capture request");
    }
  }
  if (run.identity.runtime.graphName !== "V14D Brows Lashes V1 Composite") report.failures.push("run " + run.index + ": identity graph is not Brows/Lashes V1");
  if (run.sentinel.runtime.graphName !== "V14D Brows Lashes V1 Composite") report.failures.push("run " + run.index + ": sentinel graph is not Brows/Lashes V1");
  const identityDraws = run.identity.runtime.drawCalls || [];
  const sentinelDraws = run.sentinel.runtime.drawCalls || [];
  if (JSON.stringify(identityDraws.map((draw) => [draw.materialName, draw.count, draw.firstIndex, draw.drawIndex, draw.groupId])) !== JSON.stringify(sentinelDraws.map((draw) => [draw.materialName, draw.count, draw.firstIndex, draw.drawIndex, draw.groupId]))) report.failures.push("run " + run.index + ": draw ranges/order/group changed");
  if (JSON.stringify(identityDraws.map((draw) => [draw.materialName, draw.bindGroup])) !== JSON.stringify(sentinelDraws.map((draw) => [draw.materialName, draw.bindGroup]))) report.failures.push("run " + run.index + ": bind groups changed");
  if (run.identity.runtime.pipeline === run.sentinel.runtime.pipeline) report.failures.push("run " + run.index + ": sentinel compile/install pipeline identity was reused");
  if (JSON.stringify(run.sentinel.runtime.tint) !== JSON.stringify([0, 1, 1])) report.failures.push("run " + run.index + ": sentinel tint did not enter runtime graph");
  if (!(run.diff?.targetMask?.sampled > 0)) report.failures.push("run " + run.index + ": no Brows/Lashes pixels in final canvas mask");
  if (!(run.diff?.outsideTargetMask?.sampled > 0)) report.failures.push("run " + run.index + ": outsideTargetMask has no samples");
  if (!(run.diff?.noiseBaselineOutsideTargetMask?.sampled > 0)) report.failures.push("run " + run.index + ": outsideTargetMask noise baseline has no samples");
  if (!run.identityControl || run.identityControl.pairId !== PAIR_ID || run.identityControl.captureId !== IDENTITY_CONTROL_CAPTURE_ID) report.failures.push("run " + run.index + ": identity control capture identity mismatch");
  if (run.identityControl?.displayChain?.renderObserved !== true) report.failures.push("run " + run.index + ": identity control render was not observed");
  if (run.applied?.ok !== true) report.failures.push("run " + run.index + ": sentinel style groups were not applied");
  if (FAULT_NO_RENDER && run.applied?.renderedAfterApply !== false) report.failures.push("run " + run.index + ": stale-render fault did not suppress render");
  if (!FAULT_NO_RENDER && run.applied?.renderedAfterApply !== true) report.failures.push("run " + run.index + ": healthy path did not submit the required frozen-frame render");
  if (!(run.sentinel.capture.displayChain?.renderObserved === true)) report.failures.push("run " + run.index + ": sentinel actual render/setPipeline was not observed");
  for (const mode of ["identity", "sentinel"]) {
    const slotStats = run[mode].capture.slotStats || {};
    for (const materialName of ["Brows", "Lashes"]) {
      if (!(slotStats[materialName]?.samples > 0) || !normalizeRgbMean(slotStats[materialName]?.hdrMean)) {
        report.failures.push("run " + run.index + ": " + mode + " " + materialName + " HDR slot has no finite samples");
      }
    }
    if (run[mode].capture.displayChain?.hdr?.nanCount !== 0 || run[mode].capture.displayChain?.hdr?.infCount !== 0) {
      report.failures.push("run " + run.index + ": " + mode + " HDR readback contains NaN/Infinity");
    }
  }
  if (!run.displayChain.hdrResolve.allSlotsObserved) report.failures.push("run " + run.index + ": Brows/Lashes HDR resolve slot delta is not observed");
  if (!run.displayChain.hdrResolve.allFinite) report.failures.push("run " + run.index + ": HDR resolve finite-value assertion failed");
  if (!run.displayChain.composite.bothObserved) report.failures.push("run " + run.index + ": identity/sentinel composite pipeline was not observed");
  if (!run.displayChain.composite.pipelineConsistent || !run.displayChain.composite.gammaConsistent) {
    report.failures.push("run " + run.index + ": identity/sentinel composite pipeline or gamma is inconsistent");
  }
  if (!FAULT_NO_RENDER && !run.displayChain.hdrResolve.allSlotsChanged) report.failures.push("run " + run.index + ": healthy Brows/Lashes HDR resolve target did not change beyond diagnostic threshold");
  for (const mode of ["identity", "sentinel"]) {
    const state = run[mode];
    const targetDraws = state.runtime.drawCalls || [];
    const traceDraws = (state.capture.displayChain?.trace?.draws || [])
      .filter((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes");
    if (state.capture.displayChain?.renderObserved === true && traceDraws.length !== targetDraws.length) {
      report.failures.push("run " + run.index + ": " + mode + " Brows/Lashes draw trace count mismatch");
    }
    for (let index = 0; index < targetDraws.length; index += 1) {
      const target = targetDraws[index];
      const actual = traceDraws[index];
      if (state.capture.displayChain?.renderObserved !== true || !actual) continue;
      if (actual.pipeline !== target.pipelineUsedByLookup || actual.pipeline !== state.runtime.pipeline) {
        report.failures.push("run " + run.index + ": " + mode + " draw used a pipeline different from compile/install");
      }
      if (actual.bindGroup !== target.bindGroup) {
        report.failures.push("run " + run.index + ": " + mode + " draw used a bind group different from draw snapshot");
      }
    }
  }
  const identityTraceTargets = (run.identity.capture.displayChain?.trace?.draws || []).filter((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes");
  const sentinelTraceTargets = (run.sentinel.capture.displayChain?.trace?.draws || []).filter((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes");
  for (const mode of ["identity", "sentinel"]) {
    const traceDraws = run[mode].capture.displayChain?.trace?.draws || [];
    if (traceDraws.some((draw) => draw.matchStatus !== "unique")) {
      report.failures.push("run " + run.index + ": " + mode + " has duplicate or unmatched draw identity");
    }
    const expectedDraws = run[mode].runtime.drawCalls || [];
    const targetTraceDraws = traceDraws.filter((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes");
    const drawValidation = validateV14dDisplayChainDrawTrace(expectedDraws, targetTraceDraws);
    if (!drawValidation.ok) {
      report.failures.push("run " + run.index + ": " + mode + " draw identity validation: " + drawValidation.errors.join(" | "));
    }
  }
  if (run.identity.capture.displayChain?.renderObserved === true && run.sentinel.capture.displayChain?.renderObserved === true
    && JSON.stringify(identityTraceTargets.map((draw) => draw.pipeline)) === JSON.stringify(sentinelTraceTargets.map((draw) => draw.pipeline))) {
    report.failures.push("run " + run.index + ": identity/sentinel actual draw pipelines did not differ");
  }
  if (run.sentinel.capture.displayChain?.renderObserved === true && run.sentinel.capture.displayChain.trace?.compositePipeline == null) {
    report.failures.push("run " + run.index + ": sentinel composite pipeline was not observed");
  }
  const outside = run.diff?.outsideTargetMask;
  const outsideNoise = run.diff?.noiseBaselineOutsideTargetMask;
  const outsideExcess = run.diff?.outsideTargetExcess;
  if (outsideNoise
    && (outsideNoise.meanAbsRgbSum > OUTSIDE_TARGET_NOISE_BUDGET.meanAbsRgbSum
      || outsideNoise.p95AbsRgbSum > OUTSIDE_TARGET_NOISE_BUDGET.p95AbsRgbSum
      || outsideNoise.changedRatio > OUTSIDE_TARGET_NOISE_BUDGET.changedRatio)) {
    report.failures.push("run " + run.index + ": identity-control non-target noise exceeded the fixed diagnostic budget");
  }
  if (outside
    && (outside.meanAbsRgbSum > OUTSIDE_TARGET_NOISE_BUDGET.meanAbsRgbSum
      || outside.p95AbsRgbSum > OUTSIDE_TARGET_NOISE_BUDGET.p95AbsRgbSum
      || outside.changedRatio > OUTSIDE_TARGET_NOISE_BUDGET.changedRatio)) {
    report.failures.push("run " + run.index + ": non-target canvas changed beyond the fixed diagnostic budget");
  }
  if (outsideExcess
    && (outsideExcess.meanAbsRgbSum > OUTSIDE_TARGET_EXCESS_BUDGET.meanAbsRgbSum
      || outsideExcess.p95AbsRgbSum > OUTSIDE_TARGET_EXCESS_BUDGET.p95AbsRgbSum
      || outsideExcess.changedRatio > OUTSIDE_TARGET_EXCESS_BUDGET.changedRatio)) {
    report.failures.push("run " + run.index + ": non-target canvas exceeded identity-control noise baseline");
  }
  for (const [regionName, metrics] of Object.entries(run.diff?.outsideTargetRegions || {})) {
    const region = metrics.sentinel;
    const baseline = metrics.noiseBaseline;
    if (!(region?.sampled > 0) || !(baseline?.sampled > 0)) {
      continue;
    }
    const excess = metrics.excess;
    if (excess.meanAbsRgbSum > OUTSIDE_TARGET_EXCESS_BUDGET.meanAbsRgbSum
      || excess.p95AbsRgbSum > OUTSIDE_TARGET_EXCESS_BUDGET.p95AbsRgbSum
      || excess.changedRatio > OUTSIDE_TARGET_EXCESS_BUDGET.changedRatio) {
      report.failures.push("run " + run.index + ": non-target region " + regionName + " exceeded identity-control noise baseline");
    }
  }
  if (!isStrongTargetCanvasChange(run)) report.failures.push("run " + run.index + ": target canvas difference below machine threshold");
}

const runtimeErrorCounts = {
  pageErrors: report.pageErrors.length,
  failedRequests: report.failedRequests.length,
  httpBad: report.httpBad.length,
};
for (const [kind, count] of Object.entries(runtimeErrorCounts)) {
  if (count !== 0) report.failures.push("global " + kind + " count must be zero, got " + count);
}
if (report.runs.length !== RUNS) report.failures.push("expected " + RUNS + " repro run(s), got " + report.runs.length);

function targetDrawEvidenceIsValid(run, mode) {
  const state = run?.[mode];
  const observed = run?.displayChain?.targetDraws?.[mode] || {};
  const expected = state?.runtime?.drawCalls || [];
  return ["Brows", "Lashes"].every((materialName) => {
    const expectedDraw = expected.find((draw) => draw.materialName === materialName);
    const actualDraw = observed[materialName];
    return Boolean(
      expectedDraw
      && actualDraw?.matchCount === 1
      && actualDraw.matchStatus === "unique"
      && Number.isInteger(expectedDraw.drawIndex)
      && expectedDraw.drawIndex === actualDraw.drawIndex
      && actualDraw.pipeline
      && actualDraw.pipeline === expectedDraw.pipelineUsedByLookup
      && actualDraw.bindGroup === expectedDraw.bindGroup,
    );
  });
}

function drawPipelinesAreEqual(run, leftMode, rightMode) {
  const left = run?.displayChain?.targetDraws?.[leftMode] || {};
  const right = run?.displayChain?.targetDraws?.[rightMode] || {};
  return ["Brows", "Lashes"].every((materialName) => (
    left[materialName]?.pipeline != null
    && left[materialName].pipeline === right[materialName]?.pipeline
  ));
}

function drawRangesAreStable(run) {
  const project = (mode) => (run?.[mode]?.runtime?.drawCalls || [])
    .filter((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes")
    .map((draw) => [draw.materialName, draw.groupId, draw.count, draw.firstIndex, draw.drawIndex, draw.bindGroup]);
  return JSON.stringify(project("identity")) === JSON.stringify(project("sentinel"));
}

const completeRuns = report.runs.length === RUNS && report.runs.every((run) => run.error == null && run.identity?.capture && run.sentinel?.capture);
const runtimeErrorFree = Object.values(runtimeErrorCounts).every((count) => count === 0);
const healthyCommitRuns = completeRuns && !FAULT_NO_RENDER && report.runs.every((run) => (
  run.applied?.ok === true
  && run.applied?.renderedAfterApply === true
  && run.sentinel.capture.displayChain?.renderObserved === true
  && run.displayChain.hdrResolve.allSlotsChanged
  && run.displayChain.composite.bothObserved
  && run.displayChain.composite.pipelineConsistent
  && run.displayChain.composite.gammaConsistent
  && isStrongTargetCanvasChange(run)
  && targetDrawEvidenceIsValid(run, "sentinel")
));
const faultNoRenderRuns = completeRuns && FAULT_NO_RENDER && report.runs.every((run) => (
  run.applied?.ok === true
  && run.applied?.renderedAfterApply === false
  && run.sentinel.capture.displayChain?.renderObserved === false
  && !isStrongTargetCanvasChange(run)
));
const hypothesisEvidenceReady = completeRuns && runtimeErrorFree;
const setHypothesis = (id, result, evidence) => {
  const hypothesis = report.hypotheses.find((item) => item.id === id);
  if (hypothesis) {
    hypothesis.result = result;
    hypothesis.evidence = evidence;
  }
};

const h2Reuse = hypothesisEvidenceReady && report.runs.every((run) => drawPipelinesAreEqual(run, "identity", "sentinel")
  && run.identity.runtime.pipeline === run.sentinel.runtime.pipeline);
const h2Distinct = hypothesisEvidenceReady && !FAULT_NO_RENDER && report.runs.every((run) => (
  run.identity.runtime.pipeline
  && run.sentinel.runtime.pipeline
  && run.identity.runtime.pipeline !== run.sentinel.runtime.pipeline
  && targetDrawEvidenceIsValid(run, "identity")
  && targetDrawEvidenceIsValid(run, "sentinel")
  && !drawPipelinesAreEqual(run, "identity", "sentinel")
));
setHypothesis("H2", h2Reuse ? "confirmed" : h2Distinct ? "falsified" : "not-evaluated", {
  evaluated: hypothesisEvidenceReady && !FAULT_NO_RENDER,
  compileInstallReused: h2Reuse,
  compileInstallAndActualDrawDistinct: h2Distinct,
  runs: report.runs.map((run) => ({
    index: run.index,
    identityCompileInstallPipeline: run.identity?.runtime?.pipeline ?? null,
    sentinelCompileInstallPipeline: run.sentinel?.runtime?.pipeline ?? null,
    actualDrawPipelinesEqual: drawPipelinesAreEqual(run, "identity", "sentinel"),
  })),
});

const h3StaleRebind = hypothesisEvidenceReady && !FAULT_NO_RENDER && report.runs.some((run) => (
  run.sentinel.capture.displayChain?.renderObserved === true
  && drawPipelinesAreEqual(run, "identity", "sentinel")
));
const h3CorrectRebind = hypothesisEvidenceReady && !FAULT_NO_RENDER && report.runs.every((run) => (
  run.sentinel.capture.displayChain?.renderObserved === true
  && targetDrawEvidenceIsValid(run, "sentinel")
  && drawRangesAreStable(run)
  && !drawPipelinesAreEqual(run, "identity", "sentinel")
));
setHypothesis("H3", h3StaleRebind ? "confirmed" : h3CorrectRebind ? "falsified" : "not-evaluated", {
  evaluated: hypothesisEvidenceReady && !FAULT_NO_RENDER,
  staleRebindObserved: h3StaleRebind,
  sentinelDrawRebindVerified: h3CorrectRebind,
});

const h4Overwrite = hypothesisEvidenceReady && !FAULT_NO_RENDER && report.runs.some((run) => (
  run.displayChain.hdrResolve.allSlotsChanged
  && !run.displayChain.compositeTarget.changed
));
const h4NotOverwritten = hypothesisEvidenceReady && !FAULT_NO_RENDER && report.runs.every((run) => (
  run.displayChain.hdrResolve.allSlotsChanged
  && run.displayChain.compositeTarget.changed
  && run.displayChain.composite.bothObserved
  && run.displayChain.composite.pipelineConsistent
  && run.displayChain.composite.gammaConsistent
));
setHypothesis("H4", h4Overwrite ? "confirmed" : h4NotOverwritten ? "falsified" : "not-evaluated", {
  evaluated: hypothesisEvidenceReady && !FAULT_NO_RENDER,
  hdrResolveChanged: report.runs.map((run) => run.displayChain?.hdrResolve?.allSlotsChanged ?? false),
  compositeTargetChanged: report.runs.map((run) => run.displayChain?.compositeTarget?.changed ?? false),
  compositePipelineStable: report.runs.map((run) => run.displayChain?.composite?.pipelineConsistent ?? false),
  compositeGammaStable: report.runs.map((run) => run.displayChain?.composite?.gammaConsistent ?? false),
});

const h5Retraction = hypothesisEvidenceReady && report.runs.some((run) => (
  run.sentinel.runtime?.graphName !== "V14D Brows Lashes V1 Composite"
  || JSON.stringify(run.sentinel.runtime?.tint) !== JSON.stringify([0, 1, 1])
  || !run.sentinel.runtime?.pipeline
));
const h5Stable = hypothesisEvidenceReady && !FAULT_NO_RENDER && report.runs.every((run) => (
  run.applied?.ok === true
  && run.sentinel.capture.displayChain?.renderObserved === true
  && run.sentinel.runtime?.graphName === "V14D Brows Lashes V1 Composite"
  && JSON.stringify(run.sentinel.runtime?.tint) === JSON.stringify([0, 1, 1])
  && targetDrawEvidenceIsValid(run, "sentinel")
));
setHypothesis("H5", h5Retraction ? "confirmed" : h5Stable ? "falsified" : "not-evaluated", {
  evaluated: hypothesisEvidenceReady && !FAULT_NO_RENDER,
  sentinelStateRetracted: h5Retraction,
  sentinelStateStableThroughActualRender: h5Stable,
  errorCounts: runtimeErrorCounts,
});

setHypothesis("H1", healthyCommitRuns || faultNoRenderRuns ? "confirmed" : "not-evaluated", {
  evaluated: completeRuns,
  healthyCommitObserved: healthyCommitRuns,
  faultNoRenderObserved: faultNoRenderRuns,
  runs: report.runs.map((run) => ({
    index: run.index,
    appliedOk: run.applied?.ok ?? false,
    renderedAfterApply: run.applied?.renderedAfterApply ?? null,
    sentinelRenderObserved: run.sentinel?.capture?.displayChain?.renderObserved ?? false,
    targetCanvasChanged: isStrongTargetCanvasChange(run),
    hdrResolveChanged: run.displayChain?.hdrResolve?.allSlotsChanged ?? false,
  })),
});

report.displayChain = {
  schemaVersion: 1,
  pairId: PAIR_ID,
  thresholds: DISPLAY_CHAIN_DIAGNOSTIC_THRESHOLDS,
  errorCounts: runtimeErrorCounts,
  runs: report.runs.map((run) => run.displayChain),
};
report.stageDeltas = {
  schemaVersion: 1,
  pairId: PAIR_ID,
  runs: report.runs.map((run) => ({ index: run.index, ...(run.displayChain?.stageDeltas ?? {}) })),
};
report.diagnosis.evidence = {
  healthyCommitObserved: healthyCommitRuns,
  faultNoRenderObserved: faultNoRenderRuns,
  firstLostBoundary: report.diagnosis.firstLostBoundary,
};

const reportPath = path.join(OUT, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  report: reportPath,
  runs: report.runs.map((run) => ({
    index: run.index,
    error: run.error || null,
    identity: run.identity ? { captureId: run.identity.capture?.captureId || null, graph: run.identity.runtime?.graphName || null, tint: run.identity.runtime?.tint || null, pipeline: run.identity.runtime?.pipeline || null, renderObserved: run.identity.capture?.displayChain?.renderObserved || false, hdr: run.identity.capture?.slotStats || null } : null,
    sentinel: run.sentinel ? { captureId: run.sentinel.capture?.captureId || null, graph: run.sentinel.runtime?.graphName || null, tint: run.sentinel.runtime?.tint || null, pipeline: run.sentinel.runtime?.pipeline || null, renderObserved: run.sentinel.capture?.displayChain?.renderObserved || false, hdr: run.sentinel.capture?.slotStats || null } : null,
    diff: run.diff || null,
  })),
  pageErrors: report.pageErrors,
  failedRequests: report.failedRequests,
  httpBad: report.httpBad,
  failures: report.failures,
}, null, 2));
if (report.failures.length) {
  console.error("===V14D-BROWS-LASHES-DISPLAY-CHAIN-RED===");
  process.exit(1);
}
console.log("===V14D-BROWS-LASHES-DISPLAY-CHAIN-GREEN===");
process.exit(0);
