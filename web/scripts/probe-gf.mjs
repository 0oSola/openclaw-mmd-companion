// 聚焦探针：读 faceStatic 画面状态与引擎相机实际值。
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:3002/mmd-calibration-render";
const KOLEDA_DIR = "D:\\mmd\\克莱妲原皮";
const PMX = path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const DERIVED_DIR = "C:\\w\\rk3-face-v14d\\.scratch\\v14d-face-static-derived";
const BAKED_DIR = path.resolve(".scratch/v14d-static-golden-frame/baked");

function collect(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(p));
    else out.push(p);
  }
  return out;
}
const modelPaths = collect(KOLEDA_DIR);
const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).replace(/\\/g, "/"));

const browser = await chromium.launch({ executablePath: CHROME_EXE, headless: true, viewport: { width: 640, height: 640 } });
const page = await (await browser.newContext()).newPage();
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[console]", m.type(), m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

await page.addInitScript(({ rels: r, koleda, pmx, vmd, derived }) => {
  const route = (name) => name.startsWith("__derived__/") ? `${derived}/${name.slice(12)}` : `${koleda}/${name}`;
  window.__v14dFetchMap = { rels: r, route };
}, { rels, koleda: KOLEDA_DIR, pmx: PMX, vmd: VMD, derived: DERIVED_DIR });

await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.host !== "v14d-asset.local") return route.continue();
  const key = url.searchParams.get("v14dasset");
  const filePath = key === "pmx" ? PMX : key === "vmd" ? VMD : route0(key);
  function route0(k) {
    if (k.startsWith("__baked__/")) return path.join(BAKED_DIR, k.slice(10));
    return k.startsWith("__derived__/") ? path.join(DERIVED_DIR, k.slice(12)) : path.join(KOLEDA_DIR, k);
  }
  try {
    const body = fs.readFileSync(filePath);
    await route.fulfill({ status: 200, body });
  } catch {
    await route.fulfill({ status: 404, body: "missing" });
  }
});

const MODE = process.argv[2] || "finalFaceComposite";
await page.goto(`${BASE}?v14dFaceStatic=1&v14dFaceMode=${MODE}`, { waitUntil: "domcontentloaded" });
// 注入 File 资产（与采集脚本同语义）
await page.evaluate(async ({ rels: r, koleda, pmx, vmd, derived }) => {
  async function fetchFile(rel) {
    const url = rel === "__pmx__" ? `http://v14d-asset.local/a?v14dasset=pmx`
      : rel === "__vmd__" ? `http://v14d-asset.local/a?v14dasset=vmd`
      : `http://v14d-asset.local/a?v14dasset=${encodeURIComponent(rel)}`;
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const name = rel.split("/").pop();
    return new File([buf], name, {});
  }
  const modelFiles = [];
  for (const rel of r) {
    const f = await fetchFile(rel);
    Object.defineProperty(f, "webkitRelativePath", { value: rel });
    modelFiles.push(f);
  }
  const pmxFile = modelFiles.find((f) => f.name.endsWith(".pmx"));
  const vmdBuf = await (await fetch(`http://v14d-asset.local/a?v14dasset=vmd`)).arrayBuffer();
  const vmdFile = new File([vmdBuf], "koleda-v14d-authoritative-pose-f120.vmd");
  const compBuf = await (await fetch(`http://v14d-asset.local/a?v14dasset=${encodeURIComponent("__derived__/v14d-face-composite-state2.png")}`)).arrayBuffer();
  const faceOverride = new File([compBuf], "v14d-face-composite-state2.png");
  Object.defineProperty(faceOverride, "webkitRelativePath", { value: "Textures/c_Koleda_slg_face_d.png" });
  // 黄金帧烘焙纹理（baked_*）：按材质逻辑名覆盖，注入 bakedTextures。
  const BAKED = {
    face: "baked_face.png",
    hairA: "baked_hairA.png",
    hairB: "baked_hairB.png",
    body: "baked_body.png",
    top: "baked_top.png",
    cape: "baked_cape.png",
  };
  const BAKED_MAP = {
    face: "Textures/c_Koleda_slg_face_d.png",
    hairA: "Textures/c_KoledaSSR01_slg_hair_d.png",
    hairB: "Textures/c_KoledaSSR01_slg_hair_d.png",
    body: "Textures/body_d.png",
    top: "Textures/c_KoledaSSR01_slg_cloth1_da.png",
    cape: "Textures/c_KoledaSSR01_slg_cloth1_da.png",
  };
  const bakedTextures = {};
  for (const [key, fname] of Object.entries(BAKED)) {
    try {
      const buf = await (await fetch(`http://v14d-asset.local/a?v14dasset=${encodeURIComponent("__baked__/" + fname)}`)).arrayBuffer();
      if (buf.byteLength < 100) continue;
      const f = new File([buf], fname);
      Object.defineProperty(f, "webkitRelativePath", { value: BAKED_MAP[key] });
      bakedTextures[key] = f;
    } catch { /* ignore */ }
  }
  window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride, bakedTextures };
}, { rels, koleda: KOLEDA_DIR, pmx: PMX, vmd: VMD, derived: DERIVED_DIR });

await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
await page.waitForTimeout(800);
const info = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const eng = window.__rezeEngineProbe ? window.__rezeEngineProbe() : null;
  return { status: c?.dataset.webgpuStatus, ds: { ...c?.dataset }, engine: eng };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: `.scratch/v14d-static-golden-frame/probe-gf-${MODE}.png` });
await browser.close();
