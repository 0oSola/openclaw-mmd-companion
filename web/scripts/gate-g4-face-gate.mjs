// G4 正式 Face Gate（Stage 2A-GF4）。
//
// fresh AgX PNG（磁盘原始显示字节） vs Web passthrough canvas 显示字节，用同一
// 腐蚀（eroded）Face material mask 逐像素对比。注入的 baked_face.png 必须是 G3
// 反投影 atlas。输出每通道 MAE、P95、样本数、均值、相对 base face=[111.57,81.67,
// 70.68] 的下降率。正式通过：MAE 每通道 ≤20/255 且下降 ≥50%。exit code 与 pass 一致。
//
// 用法：V14D_BAKED_DIR=<g4-inject> node gate-g4-face-gate.mjs <freshPng> [outDir]
import { chromium } from "playwright";
import sharp from "sharp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { erodeMask } from "./gate-g3-backproject.mjs";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3102/mmd-calibration-render";
const FRESH_PNG = process.argv[2];
const OUT = path.resolve(process.argv[3] || ".scratch/v14d-agx-byte-capture/g4-result");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX = process.env.V14D_PMX || path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const BAKED_DIR = process.env.V14D_BAKED_DIR || path.resolve(".scratch/v14d-agx-byte-capture/g4-inject");
const SIZE = 640;
// G3 产物目录（正式样本绑定的权威来源）。
const G3_DIR = process.env.V14D_G3_DIR || path.resolve(".scratch/v14d-agx-byte-capture/g3-atlas");

// base face：未对齐基线逐通道 MAE（生产路径 vs 参考，来自前序 ticket 验收）。
const BASE_FACE_MAE = [111.57, 81.67, 70.68];
const MAE_TOL = 20; // 每通道 ≤20/255
const DROP_MIN = 0.5; // 下降 ≥50%
const MIN_FACE_SAMPLES = 1000;

const BAKED_BINDINGS = [
  ["face", "Face", "baked_face.png"], ["eyeWhite", "EyeWhite", "baked_eyeWhite.png"],
  ["eyes", "Eyes", "baked_eyes.png"], ["eyesPlus", "Eyes+", "baked_eyesPlus.png"],
  ["hairA", "HairA", "baked_hairA.png"], ["hairB", "HairB", "baked_hairB.png"],
  ["body", "BodySkin", "baked_body.png"], ["top", "Cth1-Top", "baked_top.png"], ["cape", "Cth1-Cape", "baked_cape.png"],
];
const BAKED_FILES = Object.fromEntries(BAKED_BINDINGS.map(([k, , f]) => [k, [f, "Textures/v14d-baked/" + f]]));
const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };

if (!FRESH_PNG || !fs.existsSync(FRESH_PNG)) { console.error("缺 fresh PNG: " + FRESH_PNG); process.exit(2); }
if (!fs.existsSync(PMX)) { console.error("缺权威 PMX"); process.exit(2); }
if (!fs.existsSync(VMD)) { console.error("缺权威 VMD"); process.exit(2); }
for (const [, , f] of BAKED_BINDINGS) if (!fs.existsSync(path.join(BAKED_DIR, f))) { console.error("G4 文件集缺: " + f); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

function collectModelFiles(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp); else if (/\.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name)) out.push(fp); } };
  walk(dir); return out;
}
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
const modelPaths = collectModelFiles(KOLEDA_DIR).filter((p) => path.resolve(p) !== path.resolve(FACE_D));

const summary = { out: OUT, pageErrors: [], failedRequests: [], httpBadResponses: [] };
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-g4-chrome-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME_EXE, headless: false, viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
});
try {
  await context.route("**/*", (route) => {
    const url = route.request().url();
    const m = url.match(/[?&]v14dasset=([^&]+)/);
    if (!m) return route.continue();
    const key = decodeURIComponent(m[1]);
    if (key === "__manifest__") {
      const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).replace(/\\/g, "/"));
      rels.push(path.relative(KOLEDA_DIR, PMX).replace(/\\/g, "/"));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) });
    }
    let filePath = null;
    if (key === "pmx") filePath = PMX;
    else if (key === "vmd") filePath = VMD;
    else if (key.startsWith("__baked__/")) filePath = path.join(BAKED_DIR, key.slice("__baked__/".length));
    else filePath = path.join(KOLEDA_DIR, key);
    if (filePath && fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(filePath) });
    }
    return route.fulfill({ status: 404, body: "missing " + key });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => summary.pageErrors.push(String(e?.stack || e)));
  page.on("requestfailed", (r) => summary.failedRequests.push({ url: r.url(), err: r.failure()?.errorText || "unknown" }));
  page.on("response", (r) => { const s = r.status(); if (s >= 400) summary.httpBadResponses.push({ url: r.url(), status: s }); });
  await page.addInitScript(async (payload) => {
    const fetchFile = async (key, rel, mime) => {
      const resp = await fetch(`${payload.route}?v14dasset=${encodeURIComponent(key)}`);
      if (!resp.ok) throw new Error(`asset ${key} -> ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const f = new File([buf], key.split("/").pop(), { type: mime || "application/octet-stream" });
      if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel });
      return f;
    };
    const manifest = await (await fetch(`${payload.route}?v14dasset=__manifest__`)).json();
    const modelFiles = [];
    for (const rel of manifest.files) {
      if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue;
      modelFiles.push(await fetchFile(rel, rel));
    }
    const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
    const pmxFile = await fetchFile(pmxRel, pmxRel);
    const vmdFile = await fetchFile("vmd", null);
    const bakedTextures = {};
    for (const [key, [file, relKey]] of Object.entries(payload.bakedMap)) bakedTextures[key] = await fetchFile(`__baked__/${file}`, relKey);
    window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride: null, bakedTextures };
  }, { route: "http://v14d-asset.local/a", bakedMap: BAKED_FILES });
  const modelUrl = "http://v14d-asset.local/a?v14dasset=pmx";
  const vmdUrl = "http://v14d-asset.local/a?v14dasset=vmd";
  const query = new URLSearchParams({ modelUrl, vmdUrl, v14dFaceStatic: "1", v14dFaceMode: "bakedGolden" });
  await page.goto(`${BASE}?${query.toString()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-testid='mmd-calibration-render']", { timeout: 60000 });
  await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
  await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return {
      webgpuStatus: c?.dataset.webgpuStatus || "", mode: c?.dataset.v14dFaceStaticMode || "",
      faceApplied: c?.dataset.v14dFaceStaticFaceApplied || "", bakedActual: c?.dataset.v14dBakedActual || "",
      frame: c?.dataset.v14dFaceStaticFrame || "", state: c?.dataset.v14dFaceStaticState || "",
      blend: c?.dataset.v14dFaceStaticBlend || "", cameraLocked: c?.dataset.v14dFaceStaticCameraLocked || "",
      paused: c?.dataset.v14dFaceStaticPaused || "",
    };
  });
  const cap = await page.evaluate(async () => {
    const api = window.__v14dFaceStatic;
    if (!api || !api.exportFaceDisplayCapture) return null;
    const r = await api.exportFaceDisplayCapture();
    if (!r) return null;
    return { width: r.width, height: r.height, faceMaterialId: r.faceMaterialId, displayRgb: Array.from(r.displayRgb), faceMask: Array.from(r.faceMask) };
  });
  await page.screenshot({ path: path.join(OUT, "g4-web-passthrough.png") });
  summary.state = state;

  const fails = [];

  // ── G3 绑定：读取 g3 meta/originalCoverage/UV/mask/pxAllOriginal，且证明实际注入
  //    baked_face.png 的 SHA 就是本轮 G3 atlas（不可只查 logicalPath）。 ──
  let g3Meta = null; let g3Mask = null; let g3PxAllOriginal = null;
  try {
    g3Meta = JSON.parse(fs.readFileSync(path.join(G3_DIR, "g3-offline-meta.json"), "utf8"));
    g3Mask = new Uint8Array(fs.readFileSync(path.join(G3_DIR, "g3-mask.u8.bin")).buffer.slice(0));
    g3PxAllOriginal = new Uint8Array(fs.readFileSync(path.join(G3_DIR, "g3-px-all-original.u8.bin")).buffer.slice(0));
  } catch (e) {
    fails.push("G3 产物缺失/不可读（g3-offline-meta/g3-mask/g3-px-all-original）: " + (e?.message || e));
  }
  const injectedFaceSha = fs.existsSync(path.join(BAKED_DIR, "baked_face.png"))
    ? crypto.createHash("sha256").update(fs.readFileSync(path.join(BAKED_DIR, "baked_face.png"))).digest("hex")
    : null;
  if (!g3Meta?.atlasSha256) fails.push("G3 meta 缺 atlasSha256 生成标识");
  else if (injectedFaceSha !== g3Meta.atlasSha256) {
    fails.push(`注入 baked_face.png SHA (${injectedFaceSha}) != 本轮 G3 atlas SHA (${g3Meta.atlasSha256})：注入的不是本轮反投影 atlas`);
  }

  // ── 硬断言 Web 运行时状态 + 九材质真实绑定 ──
  const faceBind = (state.bakedActual || "").split(";").filter(Boolean).map((s) => s.split("|")).find(([n]) => n === "Face");
  if (!faceBind || faceBind[2] !== "Textures/v14d-baked/baked_face.png") fails.push("Face 未绑定到反投影 atlas");
  if (state.faceApplied !== "true") fails.push("bakedGolden graph 未应用");
  if (state.frame !== "120") fails.push("Web frame != 120: " + state.frame);
  if (state.state !== "2") fails.push("Web state != 2: " + state.state);
  if (Number(state.blend) !== 0) fails.push("Web blend != 0: " + state.blend);
  if (state.cameraLocked !== "true") fails.push("Web cameraLocked != true");
  if (state.paused !== "true") fails.push("Web paused != true");
  const actualAll = (state.bakedActual || "").split(";").filter(Boolean);
  if (actualAll.length !== BAKED_BINDINGS.length) fails.push(`九材质绑定数 ${actualAll.length} != ${BAKED_BINDINGS.length}`);
  for (const [, expectName, file] of BAKED_BINDINGS) {
    const expectPath = "Textures/v14d-baked/" + file;
    const a = actualAll.map((s) => s.split("|")).find(([n]) => n === expectName);
    if (!a) { fails.push(`bakedActual 缺材质 ${expectName}`); continue; }
    if (a[2] !== expectPath) fails.push(`${expectName} 绑定 ${a[2]} != ${expectPath}`);
  }

  // fresh PNG 原始字节（sharp 字节域）
  const freshRaw = await sharp(FRESH_PNG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (freshRaw.info.width !== SIZE || freshRaw.info.height !== SIZE) { console.error("fresh PNG 尺寸错误"); process.exit(2); }
  const fresh = freshRaw.data;

  if (!cap) fails.push("exportFaceDisplayCapture 返回 null");
  let metrics = null;
  if (cap) {
    // 正式样本 = g4 eroded mask ∩ g3 mask ∩ UV四邻近纹素全部 originalCoverage。
    // dilation/均值填充生成的缺失区域不得进入正式 MAE（missing 单列，必须=0）。
    const g4Eroded = erodeMask(Uint8Array.from(cap.faceMask), SIZE, 2);
    let missing = 0;
    const formal = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      if (g4Eroded[i] !== 1) continue;
      const ok = g3Mask && g3Mask[i] === 1 && g3PxAllOriginal && g3PxAllOriginal[i] === 1;
      if (ok) formal[i] = 1; else missing += 1;
    }
    const eroded = formal;
    fs.writeFileSync(path.join(OUT, "g4-mask.u8.bin"), Buffer.from(eroded.buffer, eroded.byteOffset, eroded.byteLength));
    // 保存 Web 实际显示字节（逐像素 RGB）供离线对照「Web 显示 vs 离线同 UV 采样预测」。
    fs.writeFileSync(path.join(OUT, "g4-web-display-rgb.u8.bin"), Buffer.from(Uint8Array.from(cap.displayRgb).buffer));
    let n = 0; const sumAbs = [0, 0, 0]; const sumRef = [0, 0, 0]; const sumWeb = [0, 0, 0];
    const absPerPx = []; // 逐像素最大通道误差（P95）
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      if (eroded[i] !== 1) continue;
      n += 1;
      let pxMax = 0;
      for (let c = 0; c < 3; c += 1) {
        const rb = fresh[i * 4 + c]; const wb = cap.displayRgb[i * 3 + c];
        const d = Math.abs(rb - wb);
        sumAbs[c] += d; sumRef[c] += rb; sumWeb[c] += wb;
        if (d > pxMax) pxMax = d;
      }
      absPerPx.push(pxMax);
    }
    absPerPx.sort((a, b) => a - b);
    const p95 = absPerPx.length ? absPerPx[Math.min(absPerPx.length - 1, Math.floor(absPerPx.length * 0.95))] : null;
    const mae = sumAbs.map((s) => (n ? s / n : null));
    const drop = mae.map((m, c) => (m === null ? null : (BASE_FACE_MAE[c] - m) / BASE_FACE_MAE[c]));
    metrics = {
      samples: n, mae, p95, meanRef: sumRef.map((s) => (n ? s / n : null)), meanWeb: sumWeb.map((s) => (n ? s / n : null)),
      baseFaceMae: BASE_FACE_MAE, dropRate: drop, maeTol: MAE_TOL, dropMin: DROP_MIN,
    };
    summary.metrics = metrics;
    summary.g3Binding = { g3Dir: G3_DIR, atlasSha256: g3Meta?.atlasSha256 || null, injectedFaceSha, formalSamplesFromG4Eroded: g4Eroded.reduce((a, b) => a + b, 0), missing };
    if (missing > 0) fails.push(`正式样本缺失 ${missing} 像素（g4 eroded mask 中有像素 UV 邻近纹素含 dilation/填充，不得进入正式 MAE）`);
    if (n < MIN_FACE_SAMPLES) fails.push(`Face 样本数不足 (${n})`);
    for (let c = 0; c < 3; c += 1) {
      if (mae[c] === null || mae[c] > MAE_TOL) fails.push(`通道 ${c} MAE ${mae[c]?.toFixed(2)} > ${MAE_TOL}`);
      if (drop[c] === null || drop[c] < DROP_MIN) fails.push(`通道 ${c} 下降率 ${drop[c] === null ? "null" : (drop[c] * 100).toFixed(1) + "%"} < 50%`);
    }
  }
  if (summary.pageErrors.length) fails.push(`pageErrors=${summary.pageErrors.length}`);
  if (summary.failedRequests.length) fails.push(`failedRequests=${summary.failedRequests.length}`);
  if (summary.httpBadResponses.length) fails.push(`httpBad=${summary.httpBadResponses.length}`);

  fs.writeFileSync(path.join(OUT, "g4-result.json"), JSON.stringify(summary, null, 2));
  console.log("===G4-FACE-GATE===", JSON.stringify(metrics ? { samples: metrics.samples, mae: metrics.mae.map((x) => +x.toFixed(2)), p95: metrics.p95, dropRate: metrics.dropRate.map((x) => +(x * 100).toFixed(1) + "%") } : {}));
  if (fails.length) { console.error("===G4-GATE-FAIL===\n" + fails.join("\n")); process.exit(1); }
  console.log("===G4-GATE-OK=== Face 显示字节闭环对齐 fresh AgX PNG");
} finally {
  await context.close();
}
