// 诊断：验证 exportMaterialTriRegions 的 boneRegionLabels 语义分区样本分布。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = process.env.CHROME_EXE || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://127.0.0.1:3199/mmd-calibration-render";
const KOLEDA_DIR = "D:/mmd/克莱妲原皮";
const PMX = path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = "C:/w/rk3-face-v14d/web/public/assets/mmd/calibration/koleda-v14d/koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };
function collectModelFiles(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp); else if (/.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name)) out.push(fp); } };
  walk(dir); return out;
}
const modelPaths = collectModelFiles(KOLEDA_DIR);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-bone-probe-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 }, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"] });
await context.route("**/*", (route) => {
  const url = route.request().url();
  const m = url.match(/[?&]v14dasset=([^&]+)/);
  if (!m) return route.continue();
  const key = decodeURIComponent(m[1]);
  if (key === "__manifest__") { const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).split(path.sep).join("/")); rels.push(path.relative(KOLEDA_DIR, PMX).split(path.sep).join("/")); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) }); }
  let filePath = null;
  if (key === "pmx") filePath = PMX; else if (key === "vmd") filePath = VMD; else if (key === "__mask__/state2") filePath = STATE2_MASK; else filePath = path.join(KOLEDA_DIR, key);
  if (filePath && fs.existsSync(filePath)) { const ext = path.extname(filePath).toLowerCase(); return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(filePath) }); }
  return route.fulfill({ status: 404, body: "missing " + key });
});
const page = context.pages()[0] ?? (await context.newPage());
await page.addInitScript(async (payload) => {
  const fetchFile = async (key, rel, mime) => { const resp = await fetch(payload.route + "?v14dasset=" + encodeURIComponent(key)); if (!resp.ok) throw new Error("asset " + key + " -> " + resp.status); const buf = await resp.arrayBuffer(); const f = new File([buf], key.split("/").pop(), { type: mime || "application/octet-stream" }); if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel }); return f; };
  const manifest = await (await fetch(payload.route + "?v14dasset=__manifest__")).json();
  const modelFiles = [];
  for (const rel of manifest.files) { if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue; modelFiles.push(await fetchFile(rel, rel)); }
  const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
  const pmxFile = await fetchFile(pmxRel, pmxRel);
  const vmdFile = await fetchFile("vmd", null);
  const faceOverride = await fetchFile(payload.faceKey, payload.faceRel);
  const state2Mask = await fetchFile("__mask__/state2", payload.state2MaskRel, "image/png");
  window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride, state2Mask };
}, { route: "http://v14d-asset.local/a", faceKey: "Textures/c_Koleda_slg_face_d.png", faceRel: "Textures/c_Koleda_slg_face_d.png", state2MaskRel: "Textures/v14d-state2-mask/state2.png" });
const q = new URLSearchParams({ modelUrl: "http://v14d-asset.local/a?v14dasset=pmx", vmdUrl: "http://v14d-asset.local/a?v14dasset=vmd", v14dFaceStatic: "1", v14dFaceMode: "finalFaceComposite" });
await page.goto(BASE + "?" + q.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
await page.waitForTimeout(1200);
const btn = page.locator("button:has-text('全身')").first();
if (await btn.count()) { await btn.click(); await page.waitForTimeout(700); }
const out = await page.evaluate(async () => {
  const r = await window.__v14dFaceStatic.exportMaterialTriRegions("BodySkin");
  if (!r) return null;
  window.__boneNamesOut = r.skeletonBoneNames || [];
  const skinInfo = await (async () => {
    // 读引擎模型皮肤骨骼数（通过导出 pass 拿不到，直接探 model 内部）
    try {
      const stage = document.querySelector("canvas");
      return { boneMatrices: null };
    } catch { return null; }
  })();
  const labels = Array.from(r.boneRegionLabels || []);
  const ids = r.boneRegionIds || [];
  const hist = {};
  for (const l of labels) hist[l] = (hist[l] || 0) + 1;
  const named = {};
  for (const [k, v] of Object.entries(hist)) named[k === "-1" ? "unassigned" : ids[+k] ?? k] = v;
  // per-region world y range from centroids
  const ranges = {};
  for (let t = 0; t < labels.length; t++) {
    const l = labels[t]; if (l < 0) continue;
    const id = ids[l];
    const y = r.centroids[t * 3 + 1];
    if (!ranges[id]) ranges[id] = { min: y, max: y, tris: 0 };
    ranges[id].tris++;
    if (y < ranges[id].min) ranges[id].min = y;
    if (y > ranges[id].max) ranges[id].max = y;
  }
  // 主导骨骼直方图映射为骨骼名
  const boneNames = r.skeletonBoneNames || [];
  const dbgNamed = {};
  if (r.dominantBoneHistogram) {
    for (const [k, v] of Object.entries(r.dominantBoneHistogram)) {
      dbgNamed[(boneNames[+k] || ("idx" + k)) + " [" + k + "]"] = v;
    }
  }
  return { version: r.boneRegionVersion, ids, namedTris: named, ranges, dbgNamed, boneCount: boneNames.length, legacyLabels: Array.from(r.regionLabels).filter((x) => x >= 0).length };
});
const boneNamesOut = await page.evaluate(() => window.__boneNamesOut || []);
fs.writeFileSync(".scratch/v14d-body-skin-state2/runtimeBoneNames.json", JSON.stringify(boneNamesOut, null, 1));
console.log(JSON.stringify(out, null, 2));
await context.close();
fs.rmSync(profile, { recursive: true, force: true });
