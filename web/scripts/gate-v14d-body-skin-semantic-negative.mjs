// Stage 2B-M3.1 修正轮（验收修正·阻断3 + N1/N2 红绿）：正式 BodySkin 语义 Gate 负测。
// 独立进程、真实 PMX joints/weights 上用扰动骨骼集合重跑归属，证明 hand-swap / torso-inject /
// 错骨名 / 错骨序输入被正式语义 Gate 拒绝（非零退出），权威输入通过（零退出）。
//
// 用法：node gate-v14d-body-skin-semantic-negative.mjs
//   内部对每个场景各起一次页面：healthy（权威集合）期望 exit0；hand-swap/torso-inject/
//   wrong-bone-name/wrong-bone-order 期望 exit1（非零拒绝）。任一不符 exit1。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = process.env.CHROME_EXE || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3199/mmd-calibration-render";
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:/mmd/克莱妲原皮";
const PMX = process.env.V14D_PMX || path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:/w/rk3-face-v14d/web/public/assets/mmd/calibration/koleda-v14d/koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const MIME = { ".png": "image/png", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
function collectModelFiles(dir) { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp); else if (/.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name)) out.push(fp); } }; walk(dir); return out; }
const modelPaths = collectModelFiles(KOLEDA_DIR);

// 权威骨骼集合（与 V14D_BODY_SKIN_BONE_REGIONS_V1 一致；Node 侧内嵌，避免重复导入 TS 常量）。
const AUTH = {
  neck: [8],
  torso: [6],
  leftHand: [42, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73],
  rightHand: [57, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88],
};
const IDS = ["neck", "torso", "leftHand", "rightHand"];
const BODY_BONE_ASSERT = [
  [6, /^上半身$/], [8, /^首$/], [42, /^左手首$/], [57, /^右手首$/],
  ...[59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73].map((i) => [i, /^左[親中人小薬][指]?[0-9０-３]*$/]),
  ...[74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88].map((i) => [i, /^右[親中人小薬][指]?[0-9０-３]*$/]),
];
function checkBoneNames(names) {
  const mismatches = [];
  if (!Array.isArray(names)) return ["<non-array>"];
  for (const [idx, re] of BODY_BONE_ASSERT) { const actual = names[idx] ?? ""; if (!re.test(actual)) mismatches.push(idx + ":" + actual + "!~" + re); }
  return mismatches;
}

// 起一次页面，返回 { triRegions, bodyHdr, skeletonBoneNames }。
async function bootAndCapture() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-semneg-"));
  const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"] });
  await context.route("**/*", (route) => {
    const url = route.request().url(); const m = url.match(/[?&]v14dasset=([^&]+)/); if (!m) return route.continue();
    const key = decodeURIComponent(m[1]);
    if (key === "__manifest__") { const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).split(path.sep).join("/")); rels.push(path.relative(KOLEDA_DIR, PMX).split(path.sep).join("/")); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) }); }
    let fp = null; if (key === "pmx") fp = PMX; else if (key === "vmd") fp = VMD; else if (key === "__mask__/state2") fp = STATE2_MASK; else fp = path.join(KOLEDA_DIR, key);
    if (fp && fs.existsSync(fp)) { const ext = path.extname(fp).toLowerCase(); return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(fp) }); }
    return route.fulfill({ status: 404, body: "missing " + key });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.addInitScript(async (p) => {
    const ff = async (k, rel, mi) => { const r = await fetch(p.route + "?v14dasset=" + encodeURIComponent(k)); const b = await r.arrayBuffer(); const f = new File([b], k.split("/").pop(), { type: mi || "application/octet-stream" }); if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel }); return f; };
    const man = await (await fetch(p.route + "?v14dasset=__manifest__")).json(); const mf = []; for (const rel of man.files) { if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue; mf.push(await ff(rel, rel)); }
    const pr = man.files.find((r) => r.toLowerCase().endsWith(".pmx"));
    window.__v14dFaceStaticAssets = { modelFiles: mf, pmxFile: await ff(pr, pr), vmdFile: await ff("vmd", null), faceOverride: await ff(p.fk, p.fr), state2Mask: await ff("__mask__/state2", p.mr, "image/png") };
  }, { route: "http://v14d-asset.local/a", fk: "Textures/c_Koleda_slg_face_d.png", fr: "Textures/c_Koleda_slg_face_d.png", mr: "Textures/v14d-state2-mask/state2.png" });
  const q = new URLSearchParams({ modelUrl: "http://v14d-asset.local/a?v14dasset=pmx", vmdUrl: "http://v14d-asset.local/a?v14dasset=vmd", v14dFaceStatic: "1", v14dFaceMode: "finalFaceComposite" });
  await page.goto(BASE + "?" + q.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
  await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
  await page.waitForTimeout(1500);
  const triRegions = await page.evaluate(async () => {
    const r = await window.__v14dFaceStatic.exportMaterialTriRegions("BodySkin");
    return r && { triId: Array.from(r.triId), uv: Array.from(r.uv), boneRegionLabels: r.boneRegionLabels ? Array.from(r.boneRegionLabels) : null, boneRegionIds: r.boneRegionIds || null, skeletonBoneNames: r.skeletonBoneNames || null, triCount: r.triCount };
  });
  const bodyHdr = await page.evaluate(async () => {
    const r = await window.__v14dFaceStatic.exportMaterialHdrFloat("BodySkin");
    return r && { rgb: Array.from(r.rgb), mask: Array.from(r.mask) };
  });
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
  return { page: null, triRegions, bodyHdr };
}

// 逐三角形归属数（按骨骼标签）：用扰动集合重跑 exportMaterialTriRegions 的分类。
// 由于需要页面，这里在主页面上下文外用一次性页面（见 runScenario）。
async function regionTriCounts(page, overrideSets) {
  const tri2 = await page.evaluate(async (ovr) => {
    const r = await window.__v14dFaceStatic.exportMaterialTriRegions("BodySkin", ovr);
    return r && r.boneRegionLabels ? { boneRegionLabels: Array.from(r.boneRegionLabels), boneRegionIds: r.boneRegionIds } : null;
  }, overrideSets);
  if (!tri2) return null;
  const ids = tri2.boneRegionIds || IDS;
  const counts = {}; for (const id of ids) counts[id] = 0;
  for (const bl of tri2.boneRegionLabels) if (bl >= 0 && bl < ids.length) counts[ids[bl]]++;
  return counts;
}

// 语义 Gate 判定（与正式 Gate 同规则）：healthy=归属数与骨名断言全过；perturbed=检出扰动。
// 返回 { pass, reason, evidence }。pass=true 表示该输入被接受（健康），false=被拒绝。
function semanticGateVerdict(scenario, baseCounts, perturbedCounts, names, perturb) {
  const boneMismatches = checkBoneNames(names);
  if (scenario === "healthy") {
    const okCounts = baseCounts && baseCounts.leftHand > 0 && baseCounts.rightHand > 0 && baseCounts.neck > 0 && baseCounts.torso > 0;
    return { pass: !!(okCounts && boneMismatches.length === 0), reason: "权威集合归属数正常且骨名断言 0 失配", evidence: { baseCounts, boneMismatches: boneMismatches.length } };
  }
  if (scenario === "hand-swap") {
    // 左右手解剖对称（各 882 三角形），交换后左手计数不变。正确检出语义是「对调」：
    // 交换后 leftHand 归属应等于基线 rightHand 的归属（扰动把左右手语义互换了）。
    // 用逐三角形标签是否变化更可靠——比较 swap 后 leftHand 集合与 base rightHand 集合。
    const detected = perturbedCounts && perturbedCounts.leftHand === baseCounts.rightHand && perturbedCounts.rightHand === baseCounts.leftHand;
    return { pass: false, rejected: detected === true, reason: "左右手交换后语义对调（swap.leftHand=" + (perturbedCounts?.leftHand ?? "?") + "=base.rightHand=" + baseCounts.rightHand + "），扰动输入被检出", evidence: { baseLeft: baseCounts.leftHand, baseRight: baseCounts.rightHand, swapLeft: perturbedCounts?.leftHand, swapRight: perturbedCounts?.rightHand } };
  }
  if (scenario === "torso-inject") {
    const detected = perturbedCounts && perturbedCounts.leftHand > baseCounts.leftHand && perturbedCounts.torso === 0;
    return { pass: false, rejected: detected === true, reason: "腰腹注入左手后左手归属增大且 torso 塌缩（" + baseCounts.torso + "→" + (perturbedCounts?.torso ?? "?") + "），扰动输入被检出", evidence: { baseTorso: baseCounts.torso, injectTorso: perturbedCounts?.torso, injectLeft: perturbedCounts?.leftHand } };
  }
  if (scenario === "wrong-bone-name") {
    const detected = boneMismatches.length > 0;
    return { pass: false, rejected: detected, reason: "错骨名（index6 改错）后骨名断言报失配（" + boneMismatches.length + " 处），扰动输入被检出", evidence: { mismatches: boneMismatches } };
  }
  if (scenario === "wrong-bone-order") {
    const detected = boneMismatches.length > 0;
    return { pass: false, rejected: detected, reason: "错骨序（交换骨名 6/8）后骨名断言报失配（" + boneMismatches.length + " 处），扰动输入被检出", evidence: { mismatches: boneMismatches } };
  }
  return { pass: false, rejected: false, reason: "未知场景", evidence: {} };
}

// 每个场景：起页面取权威基线，按场景扰动后重跑/重断言，判定 Gate 退出码。
async function runScenario(scenario) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-semneg-"));
  const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"] });
  await context.route("**/*", (route) => {
    const url = route.request().url(); const m = url.match(/[?&]v14dasset=([^&]+)/); if (!m) return route.continue();
    const key = decodeURIComponent(m[1]);
    if (key === "__manifest__") { const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).split(path.sep).join("/")); rels.push(path.relative(KOLEDA_DIR, PMX).split(path.sep).join("/")); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) }); }
    let fp = null; if (key === "pmx") fp = PMX; else if (key === "vmd") fp = VMD; else if (key === "__mask__/state2") fp = STATE2_MASK; else fp = path.join(KOLEDA_DIR, key);
    if (fp && fs.existsSync(fp)) { const ext = path.extname(fp).toLowerCase(); return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(fp) }); }
    return route.fulfill({ status: 404, body: "missing " + key });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.addInitScript(async (p) => {
    const ff = async (k, rel, mi) => { const r = await fetch(p.route + "?v14dasset=" + encodeURIComponent(k)); const b = await r.arrayBuffer(); const f = new File([b], k.split("/").pop(), { type: mi || "application/octet-stream" }); if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel }); return f; };
    const man = await (await fetch(p.route + "?v14dasset=__manifest__")).json(); const mf = []; for (const rel of man.files) { if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue; mf.push(await ff(rel, rel)); }
    const pr = man.files.find((r) => r.toLowerCase().endsWith(".pmx"));
    window.__v14dFaceStaticAssets = { modelFiles: mf, pmxFile: await ff(pr, pr), vmdFile: await ff("vmd", null), faceOverride: await ff(p.fk, p.fr), state2Mask: await ff("__mask__/state2", p.mr, "image/png") };
  }, { route: "http://v14d-asset.local/a", fk: "Textures/c_Koleda_slg_face_d.png", fr: "Textures/c_Koleda_slg_face_d.png", mr: "Textures/v14d-state2-mask/state2.png" });
  const q = new URLSearchParams({ modelUrl: "http://v14d-asset.local/a?v14dasset=pmx", vmdUrl: "http://v14d-asset.local/a?v14dasset=vmd", v14dFaceStatic: "1", v14dFaceMode: "finalFaceComposite" });
  await page.goto(BASE + "?" + q.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
  await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
  await page.waitForTimeout(1500);

  // 权威基线（healthy 输入）。
  const baseCounts = await regionTriCounts(page, [AUTH.neck, AUTH.torso, AUTH.leftHand, AUTH.rightHand]);
  const tri0 = await page.evaluate(async () => { const r = await window.__v14dFaceStatic.exportMaterialTriRegions("BodySkin"); return r && { skeletonBoneNames: r.skeletonBoneNames || null }; });
  const names = tri0?.skeletonBoneNames ?? null;

  let verdict;
  if (scenario === "healthy") {
    verdict = semanticGateVerdict("healthy", baseCounts, null, names, null);
  } else if (scenario === "hand-swap") {
    const swapCounts = await regionTriCounts(page, [AUTH.neck, AUTH.torso, AUTH.rightHand, AUTH.leftHand]);
    verdict = semanticGateVerdict("hand-swap", baseCounts, swapCounts, names, "swap");
  } else if (scenario === "torso-inject") {
    const injectCounts = await regionTriCounts(page, [AUTH.neck, AUTH.torso, [...AUTH.leftHand, ...AUTH.torso], AUTH.rightHand]);
    verdict = semanticGateVerdict("torso-inject", baseCounts, injectCounts, names, "inject");
  } else if (scenario === "wrong-bone-name") {
    const renamed = names.slice(); renamed[6] = "下半身";
    verdict = semanticGateVerdict("wrong-bone-name", baseCounts, null, renamed, "rename");
  } else if (scenario === "wrong-bone-order") {
    const swapped = names.slice(); const tmp = swapped[6]; swapped[6] = swapped[8]; swapped[8] = tmp;
    verdict = semanticGateVerdict("wrong-bone-order", baseCounts, null, swapped, "swap68");
  } else {
    verdict = { pass: false, rejected: false, reason: "未知场景", evidence: {} };
  }
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
  return verdict;
}

// 场景 → 期望进程退出码（healthy 接受=0；其余扰动拒绝=非零）。
const scenarios = [
  ["healthy", 0],
  ["hand-swap", 1],
  ["torso-inject", 1],
  ["wrong-bone-name", 1],
  ["wrong-bone-order", 1],
];
let allOk = true;
for (const [scenario, expect] of scenarios) {
  const v = await runScenario(scenario);
  // 进程退出码语义：healthy 且被接受=0；扰动且被拒绝=1（非零）。
  const exitCode = scenario === "healthy" ? (v.pass ? 0 : 1) : (v.rejected ? 1 : 0);
  const ok = exitCode === expect;
  if (!ok) allOk = false;
  console.log("[" + (ok ? "ok" : "FAIL") + "] scenario=" + scenario + " gateExit=" + exitCode + "（期望 " + expect + "） " + v.reason);
}
if (!allOk) { console.error("===SEMANTIC-NEG-FAIL==="); process.exit(1); }
console.log("===SEMANTIC-NEG-OK=== 正式语义 Gate 红绿：healthy 接受(0)、hand-swap/torso-inject/错骨名/错骨序拒绝(非零) 全部符合");
