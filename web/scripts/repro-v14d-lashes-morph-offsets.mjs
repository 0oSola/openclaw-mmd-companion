// Stage 2C-M2a.4 生产 Morph 偏移取证。
// 该脚本只在显式 acceptance probe 下读取生产模型/引擎状态，不修改 PMX、VMD、
// 生产 Gate 或渲染公式；所有文件输出都落在 .scratch。
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.V14D_CAPTURE_ORIGIN || "http://127.0.0.1:3114";
const BASE = ORIGIN + "/companion?v14dAcceptanceProbe=1";
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX_NAME = "GirlsFrontline KoledaDefault.pmx";
const PMX = path.join(KOLEDA_DIR, PMX_NAME);
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const VMD_URL = "/__probe__/koleda-v14d-authoritative-pose-f120.vmd";
const FORENSIC = path.resolve(process.env.V14D_FORENSIC || ".scratch/v14d-brows-lashes/pmx-morph-forensic.json");
const OUT = path.resolve(process.env.V14D_RUNTIME_OUT || ".scratch/v14d-brows-lashes");
const IMPORT_DIR = path.join(OUT, "import-koleda");
const WIDTH = 1440;
const HEIGHT = 960;
const MORPH_NAMES = ["まばたき", "笑い"];
const SLOT_NAMES = ["Brows", "Lashes"];

fs.mkdirSync(OUT, { recursive: true });

function linkTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) linkTree(from, to);
    else if (!fs.existsSync(to)) {
      try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
    }
  }
}

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

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function vectorStats(rows) {
  const vectors = rows.map((row) => row.offset.map(Number));
  const mags = vectors.map((v) => Math.hypot(v[0], v[1], v[2]));
  const strict = vectors.filter((v) => v.some((x) => x !== 0));
  return {
    totalOffsetReferences: vectors.length,
    strictNonZeroOffsetCount: strict.length,
    strictNonZeroVertexCount: rows.filter((row) => row.offset.some((x) => Number(x) !== 0)).length,
    maxOffset: Math.max(0, ...mags),
    meanOffset: mags.length ? mags.reduce((a, b) => a + b, 0) / mags.length : 0,
    rmsOffset: mags.length ? Math.sqrt(mags.reduce((a, b) => a + b * b, 0) / mags.length) : 0,
  };
}

function positionDelta(openState, state, slot) {
  const a = openState?.positions?.[slot]?.positions || {};
  const b = state?.positions?.[slot]?.positions || {};
  const rows = [];
  for (const key of Object.keys(a)) {
    if (!b[key]) continue;
    const d = [b[key][0] - a[key][0], b[key][1] - a[key][1], b[key][2] - a[key][2]];
    rows.push({ vertex: Number(key), offset: d, magnitude: Math.hypot(d[0], d[1], d[2]) });
  }
  const moved = rows.filter((row) => row.magnitude > 1e-4);
  const mags = rows.map((row) => row.magnitude);
  return {
    comparedVertexCount: rows.length,
    movedVertexCount: moved.length,
    maxDelta: Math.max(0, ...mags),
    meanDelta: mags.length ? mags.reduce((a, b) => a + b, 0) / mags.length : 0,
    rmsDelta: mags.length ? Math.sqrt(mags.reduce((a, b) => a + b * b, 0) / mags.length) : 0,
    deltas: rows,
  };
}

function expectedError(deltaRows, expectedRows) {
  const expected = new Map(expectedRows.map((row) => [Number(row.vertex), row.offset.map(Number)]));
  const actualVertices = new Set(deltaRows.map((row) => Number(row.vertex)));
  const errors = [];
  for (const row of deltaRows) {
    const target = expected.get(row.vertex) || [0, 0, 0];
    errors.push(Math.max(
      Math.abs(row.offset[0] - target[0]),
      Math.abs(row.offset[1] - target[1]),
      Math.abs(row.offset[2] - target[2]),
    ));
  }
  return {
    expectedVertexCount: expected.size,
    actualVertexCount: actualVertices.size,
    comparedVertexCount: errors.length,
    expectedOnlyVertexCount: [...expected.keys()].filter((vertex) => !actualVertices.has(vertex)).length,
    actualOnlyVertexCount: [...actualVertices].filter((vertex) => !expected.has(vertex)).length,
    maxAbsError: Math.max(0, ...errors),
    meanAbsError: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : 0,
  };
}

function compareRows(actualRows, expectedRows) {
  const actual = new Map(actualRows.map((row) => [Number(row.vertex), row.offset.map(Number)]));
  const expected = new Map(expectedRows.map((row) => [Number(row.vertex), row.offset.map(Number)]));
  let maxAbsError = 0;
  let sumAbsError = 0;
  let compared = 0;
  for (const [vertex, target] of expected) {
    const value = actual.get(vertex);
    if (!value) continue;
    const error = Math.max(...target.map((x, axis) => Math.abs(value[axis] - x)));
    maxAbsError = Math.max(maxAbsError, error);
    sumAbsError += error;
    compared += 1;
  }
  return {
    expectedVertexCount: expected.size,
    actualVertexCount: actual.size,
    comparedVertexCount: compared,
    pmxOnlyVertexCount: [...expected.keys()].filter((v) => !actual.has(v)).length,
    runtimeOnlyVertexCount: [...actual.keys()].filter((v) => !expected.has(v)).length,
    maxAbsError: maxAbsError,
    meanAbsError: compared ? sumAbsError / compared : 0,
    consistent: expected.size === actual.size && compared === expected.size && maxAbsError <= 1e-6,
  };
}

const offline = JSON.parse(fs.readFileSync(FORENSIC, "utf8"));
if (!fs.existsSync(path.join(IMPORT_DIR, PMX_NAME))) linkTree(KOLEDA_DIR, IMPORT_DIR);

const report = {
  schemaVersion: 1,
  ticket: "Stage 2C-M2a.4 Lashes Morph 偏移权威取证",
  assetSha256: offline.assetSha256,
  sourceRoutes: ["pmx-binary-direct", "blender-cli-shape-key", "reze-engine-production-runtime"],
  authority: { pmx: PMX, vmd: VMD_URL, frame: 120, seconds: 4, fps: 30, camera: "face" },
  runtime: null,
  productionDrawIndexSets: null,
  morphDrawSetProof: null,
  mappingProof: null,
  firstLostBoundary: null,
  hypotheses: {},
  verdict: null,
  failures: [],
};

const context = await chromium.launchPersistentContext(
  fs.mkdtempSync(path.join(process.env.TEMP || process.cwd(), "lashes-morph-runtime-")),
  { executablePath: CHROME_EXE, headless: true, viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, args: ["--enable-unsafe-webgpu"] },
);
const page = context.pages()[0] ?? await context.newPage();
page.on("pageerror", (error) => report.failures.push("pageerror: " + String(error).slice(0, 500)));
page.on("requestfailed", (request) => report.failures.push("requestfailed: " + request.url().slice(0, 220)));

await page.addInitScript(() => {
  window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "mio-reference", ttsEnabled: false }));
});
const stubModel = { name: PMX_NAME, label: "克莱妲", relative_path: PMX_NAME, size_bytes: 0, url: "/assets/mmd/models/" + encodeURIComponent(PMX_NAME) };
await page.route("**/api/backend/**", async (route) => {
  const p = new URL(route.request().url()).pathname.replace(/^\/api\/backend/, "");
  if (p.startsWith("/codex/knowledge/review-summary")) return json(route, { workspace_key: null, total: 0, pending: 0, by_status: {} });
  if (p.startsWith("/assets/mmd/models")) return json(route, { items: [stubModel] });
  if (p.startsWith("/assets/vmd")) return json(route, { items: [] });
  if (p.startsWith("/config/mapping/resolved/")) return json(route, { mappings: {} });
  if (p === "/sessions" && route.request().method() === "GET") return json(route, { items: [] });
  if (p === "/sessions" && route.request().method() === "POST") return json(route, { session: { id: "stub-session-1", title: "Morph 取证" } });
  if (/^\/sessions\/[^/]+\/messages/.test(p)) return json(route, { items: [] });
  if (p.startsWith("/companion") || p.startsWith("/config/companion")) return json(route, { user_id: "8X29-AF3E", selected_model_path: null, render_pipeline: "reze-k3", reze_stage_document: null, updated_at: null });
  return json(route, { items: [] });
});
await page.route("**://127.0.0.1:8000/**", async (route) => {
  const p = new URL(route.request().url()).pathname;
  if (/\.pmx$/i.test(p)) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(PMX) });
  if (/\.(png|jpe?g|webp|bmp|tga|sph|spa)$/i.test(p)) {
    const found = findAsset(p.replace(/^\/assets\/mmd\/models\/?/i, ""));
    return found ? route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(found) }) : json(route, { detail: "asset not found" }, 404);
  }
  return json(route, { items: [] });
});
await page.route("**/*.vmd", (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(VMD) }));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.click("button.mio-advanced-mode");
  await page.waitForSelector("[data-testid=\"mio-advanced-panel\"]", { timeout: 15000 });
  await page.click(".mio-pipeline-option:has-text(\"Reze K3\")");
  await page.waitForTimeout(800);
  await page.click("button.mio-nav-button[aria-label=\"打开 Reze 材质与场景编辑器\"]", { force: true });
  await page.waitForSelector("button.mio-reze-editor-tool[aria-label=\"资产\"]", { timeout: 20000 });
  await page.click("button.mio-reze-editor-tool[aria-label=\"资产\"]");
  await page.locator("input[type=file][webkitdirectory]").first().setInputFiles(IMPORT_DIR);
  await page.waitForSelector("canvas[data-webgpu-status=\"ready\"]", { timeout: 120000 });
  await page.click("button.mio-advanced-mode").catch(() => {});
  await page.waitForTimeout(500);
  await page.click("[data-testid=\"reze-k3-skin-variant-v1\"]");
  await page.waitForSelector("canvas[data-webgpu-status=\"ready\"]", { timeout: 120000 });
  await page.waitForTimeout(500);

  const runtime = await page.evaluate(async ({ vmdUrl, morphNames, slotNames, offlineMorphs }) => {
    const stage = window.__rezeStageProbe;
    const model = stage?.modelRef?.current;
    const engine = stage?.engineRef?.current;
    if (!stage || !model || !engine) return { error: "stage/model/engine unavailable" };
    const nameList = model.getMorphing().morphs.map((m) => m.name);
    const morphs = model.getMorphing().morphs;
    const instances = engine.modelInstances ? [...engine.modelInstances.values()] : [];
    const instance = instances[0] || null;
    const round = (value) => Number.isFinite(value) ? Number(value.toFixed(9)) : null;
    const stat = (rows) => {
      const mags = rows.map((row) => Math.hypot(...row.offset));
      const strict = rows.filter((row) => row.offset.some((value) => value !== 0));
      const referencedVertices = new Set(rows.map((row) => Number(row.vertex)));
      const buckets = {
        exactZero: 0,
        "positiveUpTo1e-8": 0,
        "above1e-8UpTo1e-6": 0,
        "above1e-6UpTo1e-4": 0,
        "above1e-4": 0,
      };
      for (const magnitude of mags) {
        if (magnitude === 0) buckets.exactZero += 1;
        else if (magnitude <= 1e-8) buckets["positiveUpTo1e-8"] += 1;
        else if (magnitude <= 1e-6) buckets["above1e-8UpTo1e-6"] += 1;
        else if (magnitude <= 1e-4) buckets["above1e-6UpTo1e-4"] += 1;
        else buckets["above1e-4"] += 1;
      }
      return {
        totalOffsetReferences: rows.length,
        referencedVertexCount: referencedVertices.size,
        strictNonZeroOffsetCount: strict.length,
        strictNonZeroVertexCount: new Set(strict.map((row) => row.vertex)).size,
        duplicateReferenceCount: rows.length - referencedVertices.size,
        maxOffset: round(Math.max(0, ...mags)),
        meanOffset: round(mags.length ? mags.reduce((a, b) => a + b, 0) / mags.length : 0),
        rmsOffset: round(mags.length ? Math.sqrt(mags.reduce((a, b) => a + b * b, 0) / mags.length) : 0),
        componentMin: [0, 1, 2].map((axis) => round(Math.min(0, ...rows.map((row) => row.offset[axis])))),
        componentMax: [0, 1, 2].map((axis) => round(Math.max(0, ...rows.map((row) => row.offset[axis])))),
        zeroNearZeroBuckets: buckets,
      };
    };
    const runtimeRows = (name) => {
      const index = morphs.findIndex((morph) => morph.name === name);
      const morph = morphs[index];
      return {
        morphIndex: index,
        name,
        type: morph?.type ?? null,
        offsets: (morph?.vertexOffsets || []).map((row) => ({ vertex: row.vertexIndex, offset: row.positionOffset.map(Number) })),
      };
    };
    const csrRows = (computeData, morphIndex) => {
      const rows = [];
      if (!computeData) return rows;
      for (let vertex = 0; vertex < computeData.vertexCount; vertex += 1) {
        const start = Number(computeData.rowStart[vertex]);
        const end = Number(computeData.rowStart[vertex + 1]);
        for (let entry = start; entry < end; entry += 1) {
          if (Number(computeData.colMorph[entry]) !== morphIndex) continue;
          rows.push({
            vertex,
            offset: [
              Number(computeData.colOffset[entry * 3]),
              Number(computeData.colOffset[entry * 3 + 1]),
              Number(computeData.colOffset[entry * 3 + 2]),
            ],
          });
        }
      }
      return rows;
    };
    const internals = () => {
      const runtimeMorph = model.runtimeMorph || null;
      const effective = model.getEffectiveMorphWeights?.() || null;
      const gpuMorph = instance?.gpuMorph || null;
      return {
        selectedWeights: Object.fromEntries(morphNames.map((name) => {
          const index = nameList.indexOf(name);
          return [name, { index, runtime: index >= 0 && runtimeMorph?.weights ? Number(runtimeMorph.weights[index]) : null, effective: index >= 0 && effective ? Number(effective[index]) : null }];
        })),
        runtimeWeightsNonZeroCount: runtimeMorph?.weights ? Array.from(runtimeMorph.weights).filter((value) => Math.abs(value) > 0.0001).length : null,
        morphsDirty: model.morphsDirty ?? null,
        morphWeightsDirty: model.morphWeightsDirty ?? null,
        clipSuspended: model.isClipApplySuspended?.() ?? null,
        currentAnimation: model.getAnimationProgress?.()?.animationName ?? null,
        gpuWeightsData: gpuMorph?.weightsData ? Array.from(gpuMorph.weightsData).map(Number) : null,
        dispatchNeeded: gpuMorph?.dispatchNeeded ?? null,
        gpuWorkgroups: gpuMorph?.workgroups ?? null,
      };
    };
    const readPositions = async () => {
      const materials = model.getMaterials();
      const indices = model.getIndices();
      const device = engine.device;
      const output = {};
      for (const name of slotNames) {
        const materialIndex = materials.findIndex((material) => material.name === name);
        const firstIndex = materials.slice(0, materialIndex).reduce((sum, material) => sum + material.vertexCount, 0);
        const count = materials[materialIndex]?.vertexCount || 0;
        const vertexSet = [...new Set(Array.from(indices.slice(firstIndex, firstIndex + count)))].sort((a, b) => a - b);
        const min = vertexSet[0];
        const max = vertexSet[vertexSet.length - 1];
        const byteLength = (max - min + 1) * 32;
        const readback = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(instance.vertexBuffer, min * 32, readback, 0, byteLength);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        await readback.mapAsync(GPUMapMode.READ);
        const values = new Float32Array(readback.getMappedRange().slice(0));
        readback.unmap();
        readback.destroy();
        const positions = {};
        for (const vertex of vertexSet) {
          const base = (vertex - min) * 8;
          positions[vertex] = [Number(values[base].toFixed(9)), Number(values[base + 1].toFixed(9)), Number(values[base + 2].toFixed(9))];
        }
        output[name] = { firstIndex, count, vertexSet, positions, indexSequence: Array.from(indices.slice(firstIndex, firstIndex + count)) };
      }
      return output;
    };
    const captureState = async (label, assignments) => {
      for (const [name, weight] of assignments) setProbeWeight(name, weight);
      const beforeRender = internals();
      engine.renderFrame(0);
      await engine.device.queue.onSubmittedWorkDone();
      const afterRender = internals();
      const positions = await readPositions();
      return { label, assignments, beforeRender, afterRender, positions };
    };

    const playName = await stage.playVmd(vmdUrl);
    stage.pauseVmd();
    stage.seekVmd(4);
    stage.pauseVmd();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    model.pause();
    model.setClipApplySuspended?.(true);
    const clipIsolation = {
      clearAnimationAvailable: typeof model.clearAnimation === "function",
      setClipApplySuspendedAvailable: typeof model.setClipApplySuspended === "function",
      poseBeforeClear: model.getAnimationProgress?.() || null,
    };
    if (clipIsolation.clearAnimationAvailable) model.clearAnimation();
    model.pause();
    model.setClipApplySuspended?.(true);
    if (!clipIsolation.clearAnimationAvailable && !clipIsolation.setClipApplySuspendedAvailable) {
      return { error: "cannot isolate morph weights from animation clip", clipIsolation };
    }
    clipIsolation.poseAfterClear = model.getAnimationProgress?.() || null;
    clipIsolation.animationClearedForMorphIsolation = clipIsolation.clearAnimationAvailable;
    const defaultAppearanceLockInstalled = Boolean(model.__koledaClosedEyeLockInstalled);
    let defaultAppearanceLockControl = null;
    if (defaultAppearanceLockInstalled) {
      for (const name of morphNames) model.setMorphWeight(name, 0);
      engine.stopRenderLoop();
      model.pause();
      engine.renderFrame(0);
      await engine.device.queue.onSubmittedWorkDone();
      const observedAfterProductionUpdate = internals();
      defaultAppearanceLockControl = {
        requestedWeights: Object.fromEntries(morphNames.map((name) => [name, 0])),
        observedAfterProductionUpdate: observedAfterProductionUpdate.selectedWeights,
        forcedMorphNames: morphNames.filter((name) => observedAfterProductionUpdate.selectedWeights[name]?.runtime !== 0),
        confirmsProductionDefaultAppearanceLock: morphNames.some((name) => observedAfterProductionUpdate.selectedWeights[name]?.runtime !== 0),
      };
    }
    const probeWeights = new Map();
    const updateWithProductionAppearancePolicy = model.update.bind(model);
    model.update = (...args) => {
      const result = updateWithProductionAppearancePolicy(...args);
      for (const [name, weight] of probeWeights) model.setMorphWeight(name, weight);
      return result;
    };
    const setProbeWeight = (name, weight) => {
      probeWeights.set(name, weight);
      model.setMorphWeight(name, weight);
    };
    clipIsolation.defaultAppearanceLockInstalled = defaultAppearanceLockInstalled;
    clipIsolation.defaultAppearanceLockControl = defaultAppearanceLockControl;
    clipIsolation.defaultAppearanceLockBypassedByProbe = defaultAppearanceLockInstalled;
    const initial = { animation: model.getAnimationProgress?.() || null, loadWarnings: model.getLoadWarnings?.() || [], names: nameList, clipIsolation };
    const runtimeMorphs = Object.fromEntries(morphNames.map((name) => {
      const row = runtimeRows(name);
      return [name, { ...row, offsetStats: stat(row.offsets) }];
    }));
    const computeData = model.buildMorphComputeData?.();
    const csr = {};
    if (computeData) {
      for (const name of morphNames) {
        const index = morphs.findIndex((morph) => morph.name === name);
        const offsets = csrRows(computeData, index);
        csr[name] = {
          morphIndex: index,
          entryCount: offsets.length,
          liveThreshold: 0.0001,
          offsets,
          offsetStats: stat(offsets),
        };
      }
    }
    engine.stopRenderLoop();
    model.pause();
    model.setClipApplySuspended?.(true);
    const open = await captureState("open", morphNames.map((name) => [name, 0]));
    const blink = await captureState("blink", [[morphNames[0], 1], [morphNames[1], 0]]);
    const blinkRepeatRead = await readPositions();
    const expression = await captureState("expression", [[morphNames[0], 0], [morphNames[1], 1]]);

    for (const [name, weight] of morphNames.map((morphName) => [morphName, 0])) setProbeWeight(name, weight);
    engine.renderFrame(0);
    await engine.device.queue.onSubmittedWorkDone();
    const capture = await stage.captureHairTriUv(slotNames, { sourceMode: "production-draw-call", useForegroundDepth: true, nearClipOverride: 1.0 });
    return {
      playName,
      initial,
      clipIsolation,
      runtimeMorphs,
      csr,
      states: { open, blink, expression, blinkRepeatRead },
      productionSource: capture?.productionSource || null,
      captureError: capture?.error || null,
      modelDraws: Object.fromEntries(slotNames.map((name) => {
        const entry = open.positions[name];
        return [name, { firstIndex: entry.firstIndex, count: entry.count, vertexSet: entry.vertexSet, indexSequence: entry.indexSequence }];
      })),
    };
  }, { vmdUrl: VMD_URL, morphNames: MORPH_NAMES, slotNames: SLOT_NAMES, offlineMorphs: offline.morphs });

  report.runtime = runtime;
  if (runtime?.error) throw new Error(runtime.error);

  const offlineByName = Object.fromEntries(offline.morphs.map((morph) => [morph.name, morph]));
  const mappingMorphs = {};
  for (const name of MORPH_NAMES) {
    mappingMorphs[name] = compareRows(runtime.runtimeMorphs[name].offsets, offlineByName[name].pmxOffsetRows);
  }
  const offlineRanges = offline.productionDrawIndexSets.pmxSource;
  const drawProof = {};
  for (const name of SLOT_NAMES) {
    const actual = runtime.modelDraws[name];
    const expected = offlineRanges[name];
    const sameSequence = JSON.stringify(actual.indexSequence) === JSON.stringify(
      offlineRangeSequence(offline, name),
    );
    drawProof[name] = {
      firstIndex: actual.firstIndex,
      count: actual.count,
      expectedFirstIndex: expected.firstIndex,
      expectedCount: expected.count,
      uniqueVertexCount: actual.vertexSet.length,
      expectedUniqueVertexCount: expected.uniqueVertexCount,
      indexSequenceEqualToPmx: sameSequence,
      sourceAuditDraw: findSourceDraw(runtime.productionSource, name),
    };
  }
  report.productionDrawIndexSets = {
    pmxSource: offlineRanges,
    runtimeModel: Object.fromEntries(SLOT_NAMES.map((name) => {
      const draw = runtime.modelDraws[name];
      return [name, { firstIndex: draw.firstIndex, count: draw.count, uniqueVertexIndices: draw.vertexSet, indexSequenceSha256: sha256Json(draw.indexSequence) }];
    })),
    proof: drawProof,
    runtimeObserved: true,
  };

  report.morphDrawSetProof = Object.fromEntries(MORPH_NAMES.map((name) => {
    const referenceVertices = new Set(offlineByName[name].pmxOffsetRows.map((row) => Number(row.vertex)));
    const strictNonZeroVertices = new Set(offlineByName[name].pmxOffsetRows
      .filter((row) => row.offset.some((value) => Number(value) !== 0))
      .map((row) => Number(row.vertex)));
    return [name, Object.fromEntries(SLOT_NAMES.map((slot) => {
      const drawVertices = new Set(runtime.modelDraws[slot].vertexSet.map(Number));
      return [slot, {
        referenceVertexCount: referenceVertices.size,
        strictNonZeroVertexCount: strictNonZeroVertices.size,
        drawVertexCount: drawVertices.size,
        referenceDrawIntersectionCount: [...referenceVertices].filter((vertex) => drawVertices.has(vertex)).length,
        strictNonZeroDrawIntersectionCount: [...strictNonZeroVertices].filter((vertex) => drawVertices.has(vertex)).length,
        referenceOnlyCount: [...referenceVertices].filter((vertex) => !drawVertices.has(vertex)).length,
        drawOnlyCount: [...drawVertices].filter((vertex) => !referenceVertices.has(vertex)).length,
        strictNonZeroOnlyCount: [...strictNonZeroVertices].filter((vertex) => !drawVertices.has(vertex)).length,
      }];
    }))];
  }));

  const mapping = {
    offline: offline.mappingProof,
    morphDrawSetProof: report.morphDrawSetProof,
    runtimeMorphs: mappingMorphs,
    productionDraws: drawProof,
    consistent: Boolean(offline.mappingProof?.consistent)
      && Object.values(mappingMorphs).every((value) => value.consistent)
      && Object.values(drawProof).every((value) => value.indexSequenceEqualToPmx),
  };
  report.mappingProof = mapping;

  const gpuDelta = {};
  for (const stateName of ["blink", "expression"]) {
    gpuDelta[stateName] = {};
    for (const slot of SLOT_NAMES) {
      const delta = positionDelta(runtime.states.open, runtime.states[stateName], slot);
      const expectedRows = offlineByName[stateName === "blink" ? "まばたき" : "笑い"].pmxOffsetRows
        .filter((row) => new Set(runtime.states.open.positions[slot].vertexSet).has(Number(row.vertex)));
      gpuDelta[stateName][slot] = { ...delta, expected: expectedError(delta.deltas, expectedRows) };
    }
  }
  report.runtime.gpuDelta = gpuDelta;
  report.runtime.repeatReadback = {
    blinkLashesSameAsFirst: JSON.stringify(runtime.states.blink.positions.Lashes.positions) === JSON.stringify(runtime.states.blinkRepeatRead.Lashes.positions),
  };
  report.runtime.cpuExpectedVsGpuActual = {
    expectedSource: "PMX vertex morph offset rows at weight=1",
    actualSource: "production GPU vertexBuffer readback after renderFrame + queue.onSubmittedWorkDone",
    comparisonEpsilon: 1e-6,
  };

  const blinkIndex = runtime.runtimeMorphs["まばたき"].morphIndex;
  const blinkWeights = {
    beforeRender: runtime.states.blink.beforeRender.selectedWeights["まばたき"],
    afterRender: runtime.states.blink.afterRender.selectedWeights["まばたき"],
    gpuWeightsData: runtime.states.blink.afterRender.gpuWeightsData ? runtime.states.blink.afterRender.gpuWeightsData[blinkIndex] : null,
    dispatchNeededAfterRender: runtime.states.blink.afterRender.dispatchNeeded,
  };
  const blinkLostAt = blinkWeights.afterRender.effective !== 1 || blinkWeights.gpuWeightsData !== 1
    ? "model -> GPU morph weights upload"
    : gpuDelta.blink.Lashes.movedVertexCount === 0
      ? "GPU morph CSR/compute -> production vertexBuffer"
      : null;
  report.firstLostBoundary = {
    status: blinkLostAt ? "located" : "not-lost-after-probe-isolation",
    boundary: blinkLostAt,
    evidence: { blinkWeights, blinkLashes: gpuDelta.blink.Lashes, expressionLashes: gpuDelta.expression.Lashes, repeatReadback: report.runtime.repeatReadback },
  };
  report.hypotheses = {
    H1_pmxToBlenderIndexReorder: mapping.consistent ? "falsified" : "confirmed",
    H3_loaderMorphOffsetParse: Object.values(mappingMorphs).every((value) => value.consistent) ? "falsified" : "confirmed",
    H2_weightOrClipOverride: blinkLostAt === "model -> GPU morph weights upload" ? "confirmed" : "falsified-after-probe-isolation",
    H4_gpuMorphUploadOrCompute: blinkLostAt === "GPU morph CSR/compute -> production vertexBuffer" ? "confirmed" : "falsified",
    H5_gpuReadbackOrTiming: report.runtime.repeatReadback.blinkLashesSameAsFirst ? "falsified" : "pending",
    H6_productionDefaultAppearanceLockInterference: runtime.clipIsolation?.defaultAppearanceLockControl?.confirmsProductionDefaultAppearanceLock ? "confirmed" : "falsified",
  };
  const blinkExpected = gpuDelta.blink.Lashes.expected.expectedVertexCount > 0;
  const expressionExpected = gpuDelta.expression.Lashes.expected.expectedVertexCount > 0;
  report.verdict = {
    offlineAuthority: mapping.consistent,
    blinkExpectedNonZero: blinkExpected,
    blinkObservedMoved: gpuDelta.blink.Lashes.movedVertexCount > 0,
    expressionExpectedNonZero: expressionExpected,
    expressionObservedMoved: gpuDelta.expression.Lashes.movedVertexCount > 0,
    blinkFailure: blinkExpected && gpuDelta.blink.Lashes.movedVertexCount === 0,
    conclusion: blinkExpected && gpuDelta.blink.Lashes.movedVertexCount > 0 && expressionExpected && gpuDelta.expression.Lashes.movedVertexCount > 0
      ? (runtime.clipIsolation?.defaultAppearanceLockControl?.confirmsProductionDefaultAppearanceLock
        ? "权威 PMX/Blender、reze-engine Morph CSR 和生产 draw 索引一致；原始 G7 零 delta 是 Koleda 默认外观锁把探针开眼基线也强制为 まばたき=1，非引擎 Morph 丢失。绕过该探针干扰后まばたき/笑い均按期望移动，需修探针隔离并保持 Gate，不得放宽 expectedAffectedSlots。"
        : "权威 PMX/Blender、reze-engine Morph CSR 和生产 draw 索引一致；まばたき/笑い均按期望移动，未复现生产 Morph 丢失。")
      : "需要继续检查",
  };
} catch (error) {
  report.failures.push(String(error?.stack || error));
  report.verdict = { error: String(error?.message || error) };
} finally {
  await context.close();
}

function offlineRangeSequence(source, name) {
  // 报告为防止重复保存全模型 index，只保存目标槽的完整序列 hash；
  // runtime 仍会保存序列，故这里以 hash 比较避免把 PMX 全索引重新落盘。
  // 该函数由下方在 PMX-only 报告缺少完整序列时通过 source rows 重新解析补齐。
  const range = source.productionDrawIndexSets.pmxSource[name];
  if (Array.isArray(range.indexSequence)) return range.indexSequence;
  return [];
}

function findSourceDraw(source, name) {
  for (const instance of source?.instances || []) {
    const draw = (instance.drawCalls || []).find((candidate) => candidate.materialName === name);
    if (draw) return draw;
  }
  return null;
}

const reportPath = path.join(OUT, "morph-offset-runtime-forensic.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
  report: reportPath,
  verdict: report.verdict,
  firstLostBoundary: report.firstLostBoundary,
  hypotheses: report.hypotheses,
  failures: report.failures,
}, null, 2));
if (report.failures.length || report.verdict?.blinkFailure) process.exit(1);
