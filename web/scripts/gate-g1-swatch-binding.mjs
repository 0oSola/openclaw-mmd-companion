// G1 真绑定色块 Gate（Stage 2A-GF4）。
//
// 证明 bakedGolden + display-passthrough 下 Face 材质**真绑定**到 [64,128,192] 色块：
//   1) 准备满足九材质 override 门槛的完整文件集（Face=色块，其余八张用授权占位图）；
//   2) 从引擎实际 bakedActual（materialName|diffuseTextureIndex|logicalPath）证明 Face
//      的 diffuseTextureIndex 指向承载色块的唯一追加 texture entry；
//   3) 用腐蚀（eroded）后的 Face material mask 采样最终显示字节，逐通道误差 ≤2/255。
//
// 反投影源是纹理字节（色块已知值），不做任何颜色空间猜测；passthrough 保证
// 显示字节 == 注入纹理字节。脚本失败 exit 1。
//
// 用法：V14D_BAKED_DIR=<g1-swatch 目录> node gate-g1-swatch-binding.mjs [outDir]
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3102/mmd-calibration-render";
const OUT = path.resolve(process.argv[2] || ".scratch/v14d-agx-byte-capture/g1-result");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX = process.env.V14D_PMX || path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const BAKED_DIR = process.env.V14D_BAKED_DIR || path.resolve(".scratch/v14d-agx-byte-capture/g1-swatch");
const SIZE = 640;

// 色块期望值（注入 baked_face.png 的纯色）。
const SWATCH = [64, 128, 192];
const CHANNEL_TOL = 2; // 逐通道误差 ≤2/255
const MIN_FACE_SAMPLES = 1000; // 腐蚀后仍需足够样本，防止空 mask 蒙混

// 九材质绑定（与 v14dFaceStatic.ts V14D_BAKED_BINDINGS 一致）。
const BAKED_BINDINGS = [
  ["face", "Face", "baked_face.png"],
  ["eyeWhite", "EyeWhite", "baked_eyeWhite.png"],
  ["eyes", "Eyes", "baked_eyes.png"],
  ["eyesPlus", "Eyes+", "baked_eyesPlus.png"],
  ["hairA", "HairA", "baked_hairA.png"],
  ["hairB", "HairB", "baked_hairB.png"],
  ["body", "BodySkin", "baked_body.png"],
  ["top", "Cth1-Top", "baked_top.png"],
  ["cape", "Cth1-Cape", "baked_cape.png"],
];
const BAKED_FILES = Object.fromEntries(BAKED_BINDINGS.map(([k, , f]) => [k, [f, "Textures/v14d-baked/" + f]]));
const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };

fs.mkdirSync(OUT, { recursive: true });

function collectModelFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/\.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name)) out.push(fp);
    }
  };
  walk(dir);
  return out;
}
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
const modelPaths = collectModelFiles(KOLEDA_DIR).filter((p) => path.resolve(p) !== path.resolve(FACE_D));
if (!fs.existsSync(PMX)) { console.error("缺权威 PMX: " + PMX); process.exit(2); }
if (!fs.existsSync(VMD)) { console.error("缺权威 VMD: " + VMD); process.exit(2); }
for (const [, , f] of BAKED_BINDINGS) {
  if (!fs.existsSync(path.join(BAKED_DIR, f))) { console.error("G1 文件集缺: " + f); process.exit(2); }
}

// 腐蚀（4 邻域）：去掉任一边界像素，避免边缘混合解释超标。
function erodeMask(mask, size, iters = 1) {
  let cur = mask;
  for (let k = 0; k < iters; k += 1) {
  const out = new Uint8Array(size * size);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      if (cur[i] === 1 && cur[i - 1] === 1 && cur[i + 1] === 1 && cur[i - size] === 1 && cur[i + size] === 1) out[i] = 1;
    }
  }
  cur = out;
  }
  return cur;
}

const summary = { out: OUT, pageErrors: [], failedRequests: [], httpBadResponses: [] };
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-g1-chrome-"));
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
      if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue; // baked 模式脸部用烘焙纹理
      modelFiles.push(await fetchFile(rel, rel));
    }
    const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
    const pmxFile = await fetchFile(pmxRel, pmxRel);
    const vmdFile = await fetchFile("vmd", null);
    const bakedTextures = {};
    for (const [key, [file, relKey]] of Object.entries(payload.bakedMap)) {
      bakedTextures[key] = await fetchFile(`__baked__/${file}`, relKey);
    }
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
      faceApplied: c?.dataset.v14dFaceStaticFaceApplied || "",
      bakedActual: c?.dataset.v14dBakedActual || "",
      bakedTexStart: c?.dataset.v14dBakedTexStart || "", bakedTexCount: c?.dataset.v14dBakedTexCount || "",
    };
  });
  const cap = await page.evaluate(async () => {
    const api = window.__v14dFaceStatic;
    if (!api || !api.exportFaceDisplayCapture) return null;
    const r = await api.exportFaceDisplayCapture();
    if (!r) return null;
    return { width: r.width, height: r.height, faceMaterialId: r.faceMaterialId, displayRgb: Array.from(r.displayRgb), faceMask: Array.from(r.faceMask) };
  });
  await page.screenshot({ path: path.join(OUT, "g1-swatch.png") });
  summary.state = state;

  const fails = [];
  // ── P0-2：九材质全部存在、materialName/logicalPath 逐项一致、索引唯一有限非负整数
  //    并完整覆盖追加区间；不能只验证 Face。 ──
  const actual = (state.bakedActual || "").split(";").filter(Boolean).map((s) => {
    const [materialName, idx, logicalPath] = s.split("|");
    return { materialName, idx: Number(idx), logicalPath };
  });
  const start = Number(state.bakedTexStart); const count = Number(state.bakedTexCount);
  if (actual.length !== BAKED_BINDINGS.length) fails.push(`bakedActual 材质数 ${actual.length} != ${BAKED_BINDINGS.length}`);
  // 逐材质：期望 materialName、logicalPath、idx 唯一有限非负整数、落在追加区间。
  const seenIdx = new Set();
  for (const [key, expectName, file] of BAKED_BINDINGS) {
    const expectPath = "Textures/v14d-baked/" + file;
    const a = actual.find((x) => x.materialName === expectName);
    if (!a) { fails.push(`bakedActual 缺材质 ${expectName}`); continue; }
    if (a.logicalPath !== expectPath) fails.push(`${expectName} logicalPath ${a.logicalPath} != ${expectPath}`);
    if (!(Number.isInteger(a.idx) && a.idx >= 0)) fails.push(`${expectName} idx ${a.idx} 非有限非负整数`);
    if (seenIdx.has(a.idx)) fails.push(`${expectName} idx ${a.idx} 重复`);
    seenIdx.add(a.idx);
    if (Number.isInteger(start) && Number.isInteger(count) && !(a.idx >= start && a.idx < start + count)) {
      fails.push(`${expectName} idx ${a.idx} 不在追加区间 [${start}..${start + count - 1}]`);
    }
  }
  // 追加区间必须被九个材质唯一完整覆盖（start..start+count-1 与 idx 集合完全一致）。
  if (Number.isInteger(start) && Number.isInteger(count) && count === BAKED_BINDINGS.length) {
    const expected = new Set(Array.from({ length: count }, (_, i) => start + i));
    const missing = [...expected].filter((i) => !seenIdx.has(i));
    if (missing.length) fails.push(`追加区间未被完整覆盖，缺 idx: ${missing.join(",")}`);
  } else {
    fails.push(`追加区间无效 start=${state.bakedTexStart} count=${state.bakedTexCount}`);
  }
  // ── Face 单独：真绑定色块 + bakedGolden graph 应用 ──
  const faceBind = actual.find((a) => a.materialName === "Face");
  if (faceBind && faceBind.logicalPath !== "Textures/v14d-baked/baked_face.png") {
    fails.push(`Face 实际绑定 ${faceBind.logicalPath} != Textures/v14d-baked/baked_face.png（未真绑定色块）`);
  }
  if (state.faceApplied !== "true") fails.push("bakedGolden graph 未应用");

  // ── 腐蚀 Face mask 采样显示字节 vs 色块 [64,128,192] ──
  if (!cap) { fails.push("exportFaceDisplayCapture 返回 null"); }
  else {
    const erodeIters = Number(process.env.V14D_G1_ERODE_ITERS || 2);
    const eroded = erodeMask(Uint8Array.from(cap.faceMask), SIZE, erodeIters);
    let n = 0; const sumAbs = [0, 0, 0]; let maxAbs = 0;
    const outlier = []; // 误差>tol 的像素（诊断：位置/实际值）
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      if (eroded[i] !== 1) continue;
      n += 1;
      let pxMax = 0;
      for (let c = 0; c < 3; c += 1) {
        const d = Math.abs(cap.displayRgb[i * 3 + c] - SWATCH[c]);
        sumAbs[c] += d; if (d > maxAbs) maxAbs = d;
        if (d > pxMax) pxMax = d;
      }
      if (pxMax > CHANNEL_TOL && outlier.length < 2000) {
        outlier.push({ x: i % SIZE, y: Math.floor(i / SIZE), rgb: [cap.displayRgb[i * 3], cap.displayRgb[i * 3 + 1], cap.displayRgb[i * 3 + 2]] });
      }
    }
    summary.swatch = { expect: SWATCH, erodedSamples: n, meanAbsErr: sumAbs.map((s) => (n ? s / n : null)), maxAbsErr: maxAbs, tol: CHANNEL_TOL, outlierCount: outlier.length, outlierSample: outlier.slice(0, 20) };
    if (n < MIN_FACE_SAMPLES) fails.push(`腐蚀后 Face 样本数不足 (${n} < ${MIN_FACE_SAMPLES})`);
    if (maxAbs > CHANNEL_TOL) fails.push(`色块逐通道误差超标 maxAbsErr=${maxAbs} > ${CHANNEL_TOL}（非色块真绑定或 passthrough 未生效）`);
  }
  if (summary.pageErrors.length) fails.push(`pageErrors=${summary.pageErrors.length}`);
  if (summary.failedRequests.length) fails.push(`failedRequests=${summary.failedRequests.length}`);
  if (summary.httpBadResponses.length) fails.push(`httpBad=${summary.httpBadResponses.length}`);

  fs.writeFileSync(path.join(OUT, "g1-result.json"), JSON.stringify(summary, null, 2));
  console.log("===G1-SWATCH-BINDING===", JSON.stringify(summary.swatch || {}));
  if (fails.length) { console.error("===G1-GATE-FAIL===\n" + fails.join("\n")); process.exit(1); }
  console.log("===G1-GATE-OK=== Face 真绑定 [64,128,192] 色块，passthrough 直通显示字节");
} finally {
  await context.close();
}
