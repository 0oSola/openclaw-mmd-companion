
// P0-4 真实运行时负测：漏绑/错 graph/错材质 启动页面后，聚焦 Gate 必须检出（非源码字符串模拟）。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = process.env.CHROME_EXE || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3100/mmd-calibration-render";
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:/mmd/克莱妲原皮";
const PMX = process.env.V14D_PMX || path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:/w/rk3-face-v14d/web/public/assets/mmd/calibration/koleda-v14d/koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const MIME = { ".png": "image/png", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
function collectModelFiles(dir) { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp); else if (/.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name)) out.push(fp); } }; walk(dir); return out; }
const modelPaths = collectModelFiles(KOLEDA_DIR);

async function runScenario(fault) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-neg-"));
  const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"] });
  await context.route("**/*", (route) => {
    const url = route.request().url(); const m = url.match(/[?&]v14dasset=([^&]+)/); if (!m) return route.continue();
    const key = decodeURIComponent(m[1]);
    if (key === "__manifest__") { const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).split(path.sep).join("/")); rels.push(path.relative(KOLEDA_DIR, PMX).split(path.sep).join("/")); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) }); }
    let filePath = null; if (key === "pmx") filePath = PMX; else if (key === "vmd") filePath = VMD; else if (key === "__mask__/state2") filePath = STATE2_MASK; else filePath = path.join(KOLEDA_DIR, key);
    if (filePath && fs.existsSync(filePath)) { const ext = path.extname(filePath).toLowerCase(); return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(filePath) }); }
    return route.fulfill({ status: 404, body: "missing " + key });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.addInitScript(async (payload) => {
    const fetchFile = async (key, rel, mime) => { const resp = await fetch(payload.route + "?v14dasset=" + encodeURIComponent(key)); const buf = await resp.arrayBuffer(); const f = new File([buf], key.split("/").pop(), { type: mime || "application/octet-stream" }); if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel }); return f; };
    const manifest = await (await fetch(payload.route + "?v14dasset=__manifest__")).json();
    const modelFiles = []; for (const rel of manifest.files) { if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue; modelFiles.push(await fetchFile(rel, rel)); }
    const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
    window.__v14dFaceStaticAssets = { modelFiles, pmxFile: await fetchFile(pmxRel, pmxRel), vmdFile: await fetchFile("vmd", null), faceOverride: await fetchFile(payload.faceKey, payload.faceRel), state2Mask: await fetchFile("__mask__/state2", payload.state2MaskRel, "image/png") };
  }, { route: "http://v14d-asset.local/a", faceKey: "Textures/c_Koleda_slg_face_d.png", faceRel: "Textures/c_Koleda_slg_face_d.png", state2MaskRel: "Textures/v14d-state2-mask/state2.png" });
  const q = new URLSearchParams({ modelUrl: "http://v14d-asset.local/a?v14dasset=pmx", vmdUrl: "http://v14d-asset.local/a?v14dasset=vmd", v14dFaceStatic: "1", v14dFaceMode: "finalFaceComposite" });
  if (fault) q.set("v14dBodyFault", fault);
  await page.goto(BASE + "?" + q.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const binding = window.__v14dFaceStatic?.exportBodySkinDrawBinding ? window.__v14dFaceStatic.exportBodySkinDrawBinding() : null;
    return {
      bodyApplied: c?.dataset.v14dBodySkinApplied || "",
      bodyGraph: c?.dataset.v14dBodySkinGraph || "",
      bodyGroupOk: c?.dataset.v14dBodySkinGroupOk || "",
      bodyDrawCalls: c?.dataset.v14dBodySkinDrawCalls || "",
      bodyDrawOnComposite: c?.dataset.v14dBodySkinDrawOnComposite || "",
      binding,
    };
  });
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
  return state;
}

// 聚焦 Gate 判定（与正式 Gate 的 bodyApplied 核对同规则）：
// bodyApplied=true 且 bodyGraph==="V14D Body Skin Composite" 且 draw-call 级全部命中。
function gateVerdict(s) {
  const ok = s.bodyApplied === "true" && s.bodyGraph === "V14D Body Skin Composite" && s.bodyGroupOk === "true"
    && Number(s.bodyDrawCalls) > 0 && s.bodyDrawCalls === s.bodyDrawOnComposite
    && s.binding && s.binding.allBodySkinOnComposite === true;
  return ok ? 0 : 1;
}

const scenarios = [
  ["missing", 1], ["wrongGraph", 1], ["wrongMaterial", 1], [null, 0],
];
let allOk = true;
for (const [fault, expect] of scenarios) {
  const s = await runScenario(fault);
  const verdict = gateVerdict(s);
  const pass = verdict === expect;
  if (!pass) allOk = false;
  console.log("[" + (pass ? "ok" : "FAIL") + "] fault=" + (fault ?? "none") + " gateExit=" + verdict + "（期望 " + expect + "） bodyApplied=" + s.bodyApplied + " bodyGraph=" + s.bodyGraph + " drawOnComposite=" + s.bodyDrawOnComposite + "/" + s.bodyDrawCalls);
}
if (!allOk) { console.error("===RUNTIME-NEG-FAIL==="); process.exit(1); }
console.log("===RUNTIME-NEG-OK=== 真实运行时负测（漏绑/错graph/错材质→非零，正确绑定→0）全部通过");

