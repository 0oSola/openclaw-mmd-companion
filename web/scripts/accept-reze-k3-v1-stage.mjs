// Reze K3 V1（V14D）真实舞台视觉与 VMD 验收（票据 reze-k3-v1-stage-visual-acceptance）。
// 在真实生产 /companion（非 /mmd-calibration-render）端到端验收「原始 Reze K3 / V1」切换。
// 覆盖 G1-G6；任一硬断言失败 exitCode=1。报告写 .scratch/reze-k3-v1-stage/gate-report.json。
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { captureApiRoute } from "./v14d-capture-api-origin.mjs";
import { evaluateG7WeightEvidence, calibrateG7Noise, evaluateG7Movement, validateG7Source } from "../src/features/stage/v14dG7WeightEvidence.js";
import {
  validateV14dHairCapturePair,
  V14D_HAIR_AUTHORITATIVE_CAPTURE,
} from "../src/features/stage/v14dHairCaptureState.js";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.V14D_CAPTURE_ORIGIN || "http://127.0.0.1:3114";
const API_ROUTE = captureApiRoute(process.env.V14D_CAPTURE_API_ORIGIN);
const ENTRY_ONLY = process.argv.includes("--entry-only");
// P0-1 红绿证明开关：?v14dG7FaultRestore=1 在 G7 open 态采集后注入 throw，验证异常路径 finally
// 恢复 exact 原态（restore.ok===true）。仅 acceptance probe；--fault-restore 可不经 URL 强制开启。
const FAULT_RESTORE = process.argv.includes("--fault-restore");
const FAULT_FIRST_CAPTURE = process.argv.includes("--fault-first-capture");
const BASE = ORIGIN + "/companion?v14dAcceptanceProbe=1" + (FAULT_RESTORE ? "&v14dG7FaultRestore=1" : "");
const OUT = path.resolve(process.env.V14D_G7_OUT || ".scratch/reze-k3-v1-stage");
// P0 逐槽 Morph 取证：权威 PMX 顶点级受影响槽映射（由 Blender/PMX 取证脚本产出）。
// 闭眼 まばたき 与表情 笑い 均只移动 Lashes（506 顶点）、Brows 0 顶点，故逐槽判定必须
// 按此声明：受影响槽须超同状态噪声上界、未受影响槽应≈基线。该 JSON 是机器取证唯一来源。
const MORPH_FORENSIC = path.resolve(".scratch/v14d-brows-lashes/pmx-morph-forensic.json");
fs.mkdirSync(OUT, { recursive: true });
// Stage 2C-M2a 修正轮：--fast-bl 只跑到 G3 Brows/Lashes identity-target Gate 即退出，
// 供特写取景/阈值标定的快速单变量迭代；正式全量验收不带此开关（跑完 G1-G7）。
const FAST_BL = process.argv.includes("--fast-bl");

const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX_NAME = "GirlsFrontline KoledaDefault.pmx";
const PMX = path.join(KOLEDA_DIR, PMX_NAME);
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:\\w\\rk3-face-v14d\\experiments\\koleda-v14d-face-shadow\\assets\\textures\\v14d-01234-face-shadow-state-2.png";
const MASK_NAME = "v14d-01234-face-shadow-state-2.png";
const sha256 = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// 临时导入目录（.scratch 硬链接，不修改用户原始资产）。mask 以权威文件名放入 Textures/。
function linkTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) linkTree(s, d);
    else if (!fs.existsSync(d)) {
      // 跨盘硬链接（EXDEV）回退复制；只进 .scratch，不提交，不修改用户原始资产。
      try { fs.linkSync(s, d); } catch { fs.copyFileSync(s, d); }
    }
  }
}
// 在权威克莱妲目录下按相对路径（大小写不敏感、支持 Textures/spa/normalmap 等子目录）
// 解析纹理真实文件。逐段比对目录项大小写不敏感，命中文件返回绝对路径，否则 null。
function findKoledaAsset(rel) {
  const parts = rel.split("/").filter(Boolean);
  let cur = KOLEDA_DIR;
  for (let i = 0; i < parts.length; i++) {
    if (!fs.existsSync(cur)) return null;
    const want = parts[i].toLowerCase();
    const hit = fs.readdirSync(cur, { withFileTypes: true }).find((e) => e.name.toLowerCase() === want);
    if (!hit) return null;
    cur = path.join(cur, hit.name);
  }
  return fs.existsSync(cur) && fs.statSync(cur).isFile() ? cur : null;
}
const HAIR_TEX = process.env.V14D_HAIR_TEX
  || findKoledaAsset("Textures/c_KoledaSSR01_slg_hair_d.png")
  || path.join(KOLEDA_DIR, "Textures", "c_KoledaSSR01_slg_hair_d.png");
const HAIR_PMX = process.env.V14D_HAIR_PMX || PMX;
const HAIR_CAPTURE_VMD_URL = "/__probe__/koleda-v14d-authoritative-pose-f120.vmd";
// Hair 正式 Gate 的姿态不可由环境变量改写；环境变量只允许切换外部资产，
// 不能把另一秒/帧或另一动画伪装成权威样本。
const HAIR_CAPTURE_FPS = V14D_HAIR_AUTHORITATIVE_CAPTURE.fps;
const HAIR_CAPTURE_FPS_PROVENANCE = V14D_HAIR_AUTHORITATIVE_CAPTURE.fpsProvenance;
const HAIR_CAPTURE_FRAME = V14D_HAIR_AUTHORITATIVE_CAPTURE.currentFrame;
const HAIR_CAPTURE_SECONDS = V14D_HAIR_AUTHORITATIVE_CAPTURE.currentSeconds;
const HAIR_CAPTURE_ANIMATION_NAME = V14D_HAIR_AUTHORITATIVE_CAPTURE.animationName;
const IMPORT_DIR = path.join(OUT, "import-koleda");
if (!fs.existsSync(path.join(IMPORT_DIR, PMX_NAME))) linkTree(KOLEDA_DIR, IMPORT_DIR);
const MASK_LINK = path.join(IMPORT_DIR, "Textures", MASK_NAME);
if (!fs.existsSync(MASK_LINK)) { fs.mkdirSync(path.dirname(MASK_LINK), { recursive: true }); try { fs.linkSync(STATE2_MASK, MASK_LINK); } catch { fs.copyFileSync(STATE2_MASK, MASK_LINK); } }
// 非克莱妲负测：同一 PMX 重命名 + 含 mask（证明资格按 PMX 文件名判定）。
const NEG_RENAME_DIR = path.join(OUT, "import-renamed");
if (!fs.existsSync(path.join(NEG_RENAME_DIR, "KoledaRenamedCopy.pmx"))) {
  fs.mkdirSync(path.join(NEG_RENAME_DIR, "Textures"), { recursive: true });
  const linkOrCopy = (s, d) => { try { fs.linkSync(s, d); } catch { fs.copyFileSync(s, d); } };
  linkOrCopy(PMX, path.join(NEG_RENAME_DIR, "KoledaRenamedCopy.pmx"));
  linkOrCopy(STATE2_MASK, path.join(NEG_RENAME_DIR, "Textures", MASK_NAME));
}
// 缺 mask 负测：权威 PMX 单文件，不含 mask。
const NEG_NOMASK_DIR = path.join(OUT, "import-nomask");
if (!fs.existsSync(path.join(NEG_NOMASK_DIR, PMX_NAME))) { fs.mkdirSync(NEG_NOMASK_DIR, { recursive: true }); try { fs.linkSync(PMX, path.join(NEG_NOMASK_DIR, PMX_NAME)); } catch { fs.copyFileSync(PMX, path.join(NEG_NOMASK_DIR, PMX_NAME)); } }

const report = { origin: ORIGIN, base: BASE, assets: { pmx: PMX, vmd: VMD, mask: STATE2_MASK, hairTexture: HAIR_TEX, hairTextureSha256: fs.existsSync(HAIR_TEX) ? sha256(HAIR_TEX) : null, maskSha256: sha256(STATE2_MASK), vmdSha256: fs.existsSync(VMD) ? sha256(VMD) : null }, gates: {}, pageErrors: [], httpBad: [], failedReqs: [], screenshots: {} };
// 聚焦校准开关 --g7-morph-only：只跑 G7 的动态 Morph 稳定性，跳过 G1-G6 前置断言
// （最小环境准备由 G7 入口自行完成）。供红绿单变量迭代；正式全量验收不带此开关。
const G7_EVIDENCE_ONLY = process.argv.includes("--g7-evidence-only");
const G7_MORPH_ONLY = process.argv.includes("--g7-morph-only") || G7_EVIDENCE_ONLY;
const fail = (gate, msg) => {
  console.error("ASSERT-FAIL[" + gate + "]: " + msg);
  report.gates[gate] = report.gates[gate] || { status: "pass", failures: [] };
  report.gates[gate].status = "fail"; report.gates[gate].failures.push(msg); process.exitCode = 1;
};
const note = (gate, msg) => console.log("[" + gate + "] " + msg);

// ── G5 竞态判定纯函数（供 --self-test-g5-race 负向自验复用，与下方 page.evaluate 口径一致）──
// 语义：旧请求 A 无副作用退出（retA===null）、当前播放名为 B、resetPhysics 仅 B 自增（rpDelta===1）、
// A 被守卫判旧（staleDelta>=1）、A 未增加完成计数（finishDelta===0）。
function computeG5RaceOk({ retA, currentName, nameB, rpDelta, staleDelta, finishDelta }) {
  return retA === null && currentName === nameB && String(currentName).includes("f120")
    && rpDelta === 1 && staleDelta >= 1 && finishDelta === 0;
}

// ── G5 过期完成回调名称判定纯函数（供 --self-test-g5-stale 复用，与 page.evaluate 口径一致）──
// 语义：注入过期 A 名后 naturalFinishName 仍【严格等于】本次 B 的真实动作名（不是仅"含 f120"）；
// B 完成后 naturalFinishName 仍严格等于 B；且注入名确为 A（不等于 B）。
function computeG5StaleNameOk({ bName, staleAName, nameAfterStale, nameFinal }) {
  return typeof bName === "string" && bName.length > 0
    && staleAName !== bName
    && nameAfterStale === bName
    && nameFinal === bName;
}

// P0：可重复、真实执行的 G5 竞态负向自验。healthy(finishDelta=0) 必须 true；
// 其他条件相同但 finishDelta=1 必须被判失败（本分支以非零退出码拒绝）。
if (process.argv.includes("--self-test-g5-race")) {
  const healthy = computeG5RaceOk({ retA: null, currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 1, finishDelta: 0 });
  const finishBump = computeG5RaceOk({ retA: null, currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 1, finishDelta: 1 });
  const staleRet = computeG5RaceOk({ retA: "koleda-v14d-authoritative-pose-f120.vmd", currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 1, finishDelta: 0 });
  const wrongCurrent = computeG5RaceOk({ retA: null, currentName: "race-a.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 1, finishDelta: 0 });
  const rpZero = computeG5RaceOk({ retA: null, currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 0, staleDelta: 1, finishDelta: 0 });
  const staleZero = computeG5RaceOk({ retA: null, currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 0, finishDelta: 0 });
  const results = { healthy, finishBump, staleRet, wrongCurrent, rpZero, staleZero };
  console.log("G5-race self-test:", JSON.stringify(results));
  const pass = healthy === true && finishBump === false && staleRet === false && wrongCurrent === false && rpZero === false && staleZero === false;
  // 短路退出：self-test 不执行下方浏览器代码。用 setImmediate 包裹 process.exit，避免
  // 「永不 resolve 的顶层 await」触发 unsettled-TLA 警告；process.exit 立即按结果终止。
  if (!pass) { console.error("===G5-RACE-SELF-TEST-FAIL==="); setImmediate(() => process.exit(1)); }
  else { console.log("===G5-RACE-SELF-TEST-OK==="); setImmediate(() => process.exit(0)); }
  await new Promise(() => {}); // 阻止下方浏览器代码执行；setImmediate 在进程退出前已调度
}

// P0：G5 过期回调名称判定负向自验（可重复、真实执行）。healthy（A≠B 且注入后/完成后都严格=B）
// 必须 true；名称错绑（注入后=B 但完成≠B、注入后≠B、stale=B 等）必须 false → 非零退出。
if (process.argv.includes("--self-test-g5-stale")) {
  const B = "koleda-v14d-authoritative-pose-f120.vmd";
  const A = "race-a.vmd";
  const healthy = computeG5StaleNameOk({ bName: B, staleAName: A, nameAfterStale: B, nameFinal: B });
  const finalWrong = computeG5StaleNameOk({ bName: B, staleAName: A, nameAfterStale: B, nameFinal: A }); // 完成后被改成 A
  const afterWrong = computeG5StaleNameOk({ bName: B, staleAName: A, nameAfterStale: A, nameFinal: B }); // 注入后即被改成 A
  const staleIsB = computeG5StaleNameOk({ bName: B, staleAName: B, nameAfterStale: B, nameFinal: B });   // 注入名=B（非过期）
  const results = { healthy, finalWrong, afterWrong, staleIsB };
  console.log("G5-stale self-test:", JSON.stringify(results));
  const pass = healthy === true && finalWrong === false && afterWrong === false && staleIsB === false;
  if (!pass) { console.error("===G5-STALE-SELF-TEST-FAIL==="); setImmediate(() => process.exit(1)); }
  else { console.log("===G5-STALE-SELF-TEST-OK==="); setImmediate(() => process.exit(0)); }
  await new Promise(() => {});
}

// ── 浏览器 + 会话预置 + API 兜底（本机无 Python，API 后端不可达）────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rk3v1-stage-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: true, viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, args: ["--enable-unsafe-webgpu"] });
const page = context.pages()[0] ?? (await context.newPage());
report.apiOrigin = API_ROUTE.origin;
report.pmxResponses = [];
context.on("response", response => {
  const url = new URL(response.url());
  if (url.pathname.toLowerCase().endsWith(".pmx")) report.pmxResponses.push({
    origin: url.origin, pathname: url.pathname, status: response.status(),
    contentType: response.headers()["content-type"] || null, configuredOriginMatched: API_ROUTE.matches(url),
  });
});
page.on("pageerror", (e) => report.pageErrors.push(String((e && e.stack) || e)));
page.on("console", (m) => { const t = m.text(); if (/v14d-skin-variant|WGSL|error|未定义|undeclared|tint/i.test(t)) (report.consoleWarn = report.consoleWarn || []).push(t.slice(0, 900)); });
page.on("requestfailed", (r) => report.failedReqs.push({ url: r.url().slice(0, 160), err: r.failure()?.errorText || "unknown" }));
page.on("response", (r) => { if (r.status() >= 400) report.httpBad.push({ url: r.url().slice(0, 160), status: r.status() }); });

const USER_ID = "8X29-AF3E";
await page.addInitScript((uid) => {
  window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: uid, renderPipeline: "mio-reference", ttsEnabled: false }));
}, USER_ID);

// 克莱妲存根：让「模型切换」选中克莱妲（存储键驱动变体持久化），模型目录存根（Three.js 分支用）。
const KOLEDA_REL = PMX_NAME;
const STUB_MODEL = { name: PMX_NAME, label: "克莱妲", relative_path: KOLEDA_REL, size_bytes: 0, url: "/assets/mmd/models/" + encodeURIComponent(PMX_NAME) };
await page.route("**/api/backend/**", async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname.replace(/^\/api\/backend/, "");
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  // 知识审核徽标期待 { by_status }；返回合法空摘要避免组件读 undefined 崩溃。
  if (p.startsWith("/codex/knowledge/review-summary")) return json({ workspace_key: null, total: 0, pending: 0, by_status: {} });
  if (p.startsWith("/assets/mmd/models")) return json({ items: [STUB_MODEL] });
  if (p.startsWith("/assets/vmd")) return json({ items: [] });
  if (p.startsWith("/config/mapping/resolved/")) return json({ mappings: {} });
  if (p === "/sessions" && route.request().method() === "GET") return json({ items: [] });
  if (p === "/sessions" && route.request().method() === "POST") return json({ session: { id: "stub-session-1", title: "验收会话", selected_model_path: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
  if (/^\/sessions\/[^/]+\/messages/.test(p)) return json({ items: [] });
  if (p.startsWith("/companion") || p.startsWith("/config/companion")) return json({ user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3", reze_stage_document: null, updated_at: null });
  return json({ items: [] });
});
// 兜底：仅拦截配置的直接后端来源，默认兼容8000；不接管其他端口。
// shared-config 用 directApi:true，MMDStage.toAbsolute 把存根模型/贴图/VMD 相对路径
// 也解析到该 origin，二者都不经 /api/backend 代理。后端不可用时必须在此拦截，
// 否则产生 ERR_CONNECTION_REFUSED 进入 failedRequests 阻断 G1。
await page.route(API_ROUTE.matches, async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (/\.pmx$/i.test(p)) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(PMX) });
  // 纹理/贴图：从权威克莱妲目录真实映射（Three.js 把 PMX 相对纹理路径解析到
  // /assets/mmd/models/<Textures|spa|textures>/<file>）。后端不可用时由本兜底从磁盘
  // 提供真实字节，避免 404 进入 httpBad 阻断 G1；文件确实不存在才返回 404。
  if (/\.(png|jpe?g|webp|bmp|tga|sph|spa)$/i.test(p)) {
    const base = p.replace(/^\/assets\/mmd\/models\/?/i, "");
    const cand = findKoledaAsset(base);
    if (cand) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(cand) });
    return json({ detail: "texture not found: " + base }, 404);
 }
  if (p.startsWith("/desktop-pet/shared-config")) return json({ user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3" });
  if (p.startsWith("/assets/mmd/models")) return json({ items: [STUB_MODEL] });
  if (p.startsWith("/assets/mmd/vmds") || p.startsWith("/assets/vmd")) return json({ items: [] });
  if (p.startsWith("/codex/knowledge/review-summary")) return json({ workspace_key: null, total: 0, pending: 0, by_status: {} });
  return json({ items: [] });
});
// 权威 VMD 全局路由：G3 锁帧与 G5 完整播放都用探针 playVmd("/__probe__/....vmd")，
// 需在脚本开头注册一次，覆盖整个验收过程（G5 内不再重复注册/注销）。
await page.route("**/*.vmd", async (route) => {
  // 竞态回归（P0）：/__probe__/__slow__/ 前缀的 VMD 延迟返回字节，模拟「较慢完成的旧请求」。
  if (route.request().url().includes("/__probe__/__slow__/")) {
    await new Promise((s) => setTimeout(s, 1200));
  }
  return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(VMD) });
});

const sel = { canvasReady: "canvas[data-webgpu-status=\"ready\"]", variantBar: "[data-testid=\"reze-k3-skin-variant-bar\"]", variantBtn: (v) => "[data-testid=\"reze-k3-skin-variant-" + v + "\"]" };
// 初始默认 mio-reference（Three.js）对存根模型会加载失败，不出现 WebGPU ready 画布；
// 这里只等 DOM + 会话就绪，真正的 canvas ready 在切到 reze-k3 后等待。
async function gotoCompanion() {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500); // 等 bootstrap（会话/模型清单/共享配置）完成
}
async function openRezeEditor() {
  // 「工具」导航在 reze 管线下 aria-label 为「打开 Reze 材质与场景编辑器」，否则为「工具」。
  const byReze = page.locator("button.mio-nav-button[aria-label*=\"Reze\"]");
  const byTools = page.locator("button.mio-nav-button[aria-label=\"工具\"]");
  if (await byReze.count()) await byReze.first().click();
  else if (await byTools.count()) await byTools.first().click();
  else await page.locator("button.mio-nav-button").nth(3).click();
  // 等 Reze 编辑器面板与资产标签真实渲染（视图切换+面板动画后才有 file input）。
  await page.waitForSelector("button.mio-reze-editor-tool[aria-label=\"资产\"]", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
}
async function switchToRezeK3() {
  // 管线按钮在「高级功能」面板。先开高级面板（命令栏齿轮按钮）→ 点 Reze K3。
  await page.click("button.mio-advanced-mode");
  await page.waitForSelector("[data-testid=\"mio-advanced-panel\"]", { timeout: 15000 });
  await page.click(".mio-pipeline-option:has-text(\"Reze K3\")");
  // 注意：无本地导入时 reze-k3 走 modelUrl 加载（存根模型不可达）→ canvas=error；
  // 这里不等待 ready，待真实目录导入后再等 canvas[data-webgpu-status=ready]。
  await page.waitForTimeout(800);
  // handleRenderPipelineChange 关闭面板；重开 Reze 编辑器。命令栏面板会遮挡导航按钮，
  // 验收场景用 force 点击绕过（真实用户路径是点同一按钮，只是指针事件被浮层截获）。
  await page.click("button.mio-nav-button[aria-label=\"打开 Reze 材质与场景编辑器\"]", { force: true });
  await page.waitForSelector("button.mio-reze-editor-tool[aria-label=\"资产\"]", { timeout: 20000 });
  await page.click("button.mio-reze-editor-tool[aria-label=\"资产\"]");
}
async function importDir(dirPath) {
  // 目录导入控件在 Reze 编辑器「资产」标签；先确保编辑器与标签激活。
  // 面板可能已被前一步关闭；确保 Reze 编辑器与「资产」标签激活再导入。
  if (!(await page.locator("input[type=file]").count())) {
    await page.click("button.mio-nav-button[aria-label=\"打开 Reze 材质与场景编辑器\"]", { force: true }).catch(() => {});
    await page.waitForSelector("button.mio-reze-editor-tool[aria-label=\"资产\"]", { timeout: 20000 }).catch(() => {});
    await page.click("button.mio-reze-editor-tool[aria-label=\"资产\"]").catch(() => {});
    await page.waitForTimeout(400);
  }
  // 等目录 input 真实出现（webkitdirectory 由 ref 回调设置）。
  await page.waitForSelector("input[type=file]", { timeout: 20000 });
  const input = page.locator("input[type=file][webkitdirectory]").first();
  await input.setInputFiles(dirPath);
  await page.waitForSelector(sel.canvasReady, { timeout: 120000 });
  // 导入后关闭高级功能浮层，避免遮挡舞台右侧的变体单选按钮。
  await page.click("button.mio-advanced-mode").catch(() => {});
  await page.waitForTimeout(500);
}
async function waitRebuilt() { await page.waitForSelector(sel.canvasReady, { timeout: 120000 }); await page.waitForTimeout(500); }
async function readCanvasState() {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const d = c.dataset;
    return { webgpuStatus: d.webgpuStatus || "", variant: d.v14dSkinVariant || "(unset)", faceGraph: d.v14dSkinVariantFaceGraph || "", faceDrawCalls: d.v14dSkinVariantFaceDrawCalls || "", faceOnComposite: d.v14dSkinVariantFaceOnComposite || "", bodyDrawCalls: d.v14dSkinVariantBodyDrawCalls || "", bodyOnComposite: d.v14dSkinVariantBodyOnComposite || "", hairADrawCalls: d.v14dSkinVariantHairADrawCalls || "", hairAOnComposite: d.v14dSkinVariantHairAOnComposite || "", hairBDrawCalls: d.v14dSkinVariantHairBDrawCalls || "", hairBOnComposite: d.v14dSkinVariantHairBOnComposite || "", browsDrawCalls: d.v14dSkinVariantBrowsDrawCalls || "", browsOnComposite: d.v14dSkinVariantBrowsOnComposite || "", lashesDrawCalls: d.v14dSkinVariantLashesDrawCalls || "", lashesOnComposite: d.v14dSkinVariantLashesOnComposite || "", idMismatch: d.v14dSkinVariantIdentifierMismatch || "", vmdName: d.vmdPlaybackName || "", vmdCurrent: d.vmdPlaybackCurrent || "", vmdDuration: d.vmdPlaybackDuration || "", vmdPlaying: d.vmdPlaybackPlaying || "" };
  });
}
async function readUiVariant() { return page.evaluate(() => { const a = document.querySelector("[data-testid=\"reze-k3-skin-variant-bar\"] .mio-pipeline-option.is-active"); return a ? a.getAttribute("data-testid").replace("reze-k3-skin-variant-", "") : null; }); }
async function variantBarVisible() { const n = await page.locator(sel.variantBar).count(); if (!n) return false; return page.locator(sel.variantBar).first().isVisible(); }
async function shot(name) { const f = path.join(OUT, name + ".png"); await page.screenshot({ path: f }); report.screenshots[name] = f; return f; }
async function captureStagePixels() { return page.evaluate(() => { const c = document.querySelector("canvas"); if (!c) return { error: "no canvas" }; try { return { dataUrl: c.toDataURL("image/png"), width: c.width, height: c.height }; } catch (e) { return { error: String(e) }; } }); }
async function prepareHairCapture() {
  return page.evaluate(async ({ url, seconds, fps }) => {
    const stage = window.__rezeStageProbe;
    if (!stage?.playVmd || !stage?.pauseVmd || !stage?.seekVmd) return { error: "VMD capture probe unavailable" };
    const name = await stage.playVmd(url);
    stage.pauseVmd();
    stage.seekVmd(seconds);
    stage.pauseVmd();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const progress = document.querySelector("canvas")?.dataset || {};
    return {
      name,
      requestedSeconds: seconds,
      requestedFrame: seconds * fps,
      reportedSeconds: Number(progress.vmdPlaybackCurrent || 0),
      reportedPlaying: progress.vmdPlaybackPlaying || "",
    };
  }, { url: HAIR_CAPTURE_VMD_URL, seconds: HAIR_CAPTURE_SECONDS, fps: HAIR_CAPTURE_FPS });
}
async function captureHairAtomic() {
  return page.evaluate(async () => {
    // Stage 2C-M2a：HairA/HairB 保持既有 cpu-base 无深度展开口径。合并
    // production-draw-call 基础设施后 captureHairTriUv 默认 sourceMode 变为
    // production-draw-call，会改变 Hair 的逐屏幕 triUV 口径并导致既有 Hair 正式
    // Gate 报「同材质同三角形同 UV 证据不可用」。Hair 链路显式固定 cpu-base，
    // 不触碰已通过 Gate；production-draw-call 仅服务 Brows/Lashes 逐槽取证。
    const raw = await window.__rezeStageProbe?.captureHairTriUv?.(undefined, { sourceMode: "cpu-base" });
    if (!raw || raw.error) return raw;
    const byMaterial = Object.fromEntries(Object.entries(raw.byMaterial || {}).map(([name, info]) => [name, {
      ...info,
      triId: Array.from(info.triId || []),
      uv: Array.from(info.uv || []),
      triMask: Array.from(info.triMask || []),
      triangleUvs: Array.from(info.triangleUvs || []),
    }]));
    return { ...raw, byMaterial };
  });
}
// Stage 2C-M2a 修正轮：Brows/Lashes 原子同帧采集。复用同一 captureHairTriUv
// 探针（上轮已参数化 materialNames），但显式传入 Brows/Lashes 槽名，得到两槽
// 各自的 materialId/expanded-tri-uv 与同帧 canvas 像素。
const BROWS_LASHES_SLOTS = ["Brows", "Lashes"];
async function captureBrowsLashesAtomic() {
  return page.evaluate(async (names) => {
    // Stage 2C-M2a 修正轮：Brows/Lashes 需要真实前景深度剔除（useForegroundDepth）
    // + 临时提高相机 near 到 1.0（nearClipOverride）解决 depth24 在脸部特写下精度
    // 不足导致的睫毛薄片 z-fighting 剔除（实测不提高 near 时 152 前景像素全灭）。
    // Hair 链路不传这两个选项，保持原无深度行为。
    const raw = await window.__rezeStageProbe?.captureHairTriUv?.(names, { useForegroundDepth: true, nearClipOverride: 1.0 });
    if (!raw || raw.error) return raw;
    const byMaterial = Object.fromEntries(Object.entries(raw.byMaterial || {}).map(([name, info]) => [name, {
      ...info,
      triId: Array.from(info.triId || []),
      uv: Array.from(info.uv || []),
      triMask: Array.from(info.triMask || []),
      triangleUvs: Array.from(info.triangleUvs || []),
    }]));
    return { ...raw, byMaterial };
  }, BROWS_LASHES_SLOTS);
}
function saveDataUrl(du, name) { if (!du || !du.startsWith("data:image/png")) return null; const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(du.split(",")[1], "base64")); report.screenshots[name.replace(/\.png$/, "")] = f; return f; }
function summarizeHairAtomicCapture(capture) {
  if (!capture || capture.error) return { error: capture?.error || "missing atomic hair capture" };
  const materials = Object.fromEntries(Object.entries(capture.byMaterial || {}).map(([name, info]) => {
    const triMask = Array.isArray(info.triMask) ? info.triMask : [];
    const triId = Array.isArray(info.triId) ? info.triId : [];
    const uv = Array.isArray(info.uv) ? info.uv : [];
    return [name, {
      materialId: info.materialId ?? null,
      materialIndex: info.materialIndex ?? null,
      firstIndex: info.firstIndex ?? null,
      indexCount: info.indexCount ?? null,
      triangleCount: info.triangleCount ?? null,
      triMaskSamples: triMask.reduce((sum, value) => sum + (value ? 1 : 0), 0),
      triIdSamples: triId.reduce((sum, value) => sum + (Number.isInteger(Number(value)) && Number(value) >= 0 ? 1 : 0), 0),
      uvSamples: Math.floor(uv.length / 2),
      triangleUvsLength: Array.isArray(info.triangleUvs) ? info.triangleUvs.length : 0,
    }];
  }));
  return {
    source: capture.source || null,
    captureId: capture.captureId ?? capture.captureEvidence?.pixel?.captureId ?? null,
    width: capture.width ?? null,
    height: capture.height ?? null,
    captureState: capture.captureState || null,
    captureProgressBeforeRead: capture.captureProgressBeforeRead || null,
    captureProgressAfterRead: capture.captureProgressAfterRead || null,
    captureEvidence: capture.captureEvidence || null,
    materialIdByName: capture.materialIdByName || null,
    materials,
  };
}
function hairCaptureAudit(capture, atomicPair) {
  const evidence = capture?.captureEvidence || {};
  const pixel = evidence.pixel || {};
  const triUv = evidence.triUv || {};
  const seconds = Number(pixel.currentSeconds ?? capture?.captureState?.currentSeconds);
  const frame = Number(pixel.currentFrame ?? capture?.captureState?.currentFrame);
  return {
    actual: {
      seconds: Number.isFinite(seconds) ? seconds : null,
      frame: Number.isFinite(frame) ? frame : null,
      fps: Number.isFinite(pixel.fps) ? pixel.fps : null,
      fpsProvenance: typeof pixel.fpsProvenance === "string" ? pixel.fpsProvenance : null,
      animationName: pixel.animationName ?? null,
    },
    captureId: capture?.captureId ?? pixel.captureId ?? null,
    pixelCaptureId: pixel.captureId ?? null,
    triUvCaptureId: triUv.captureId ?? null,
    pixelTriUvPair: atomicPair,
  };
}

// 入口回放只证明受控存根环境的导入、开关与六槽绑定，不替代G1-G7。
if (ENTRY_ONLY) {
  const started = Date.now();
  const entry = { startedAt: new Date(started).toISOString(), status: "running", phase: "navigate", failures: [] };
  report.entry = entry;
  let deadline;
  try {
    await Promise.race([
      (async () => {
        await gotoCompanion();
        await switchToRezeK3();
        // 与完整验收相同：K3侧栏下通用模型选择器可隐藏，目录导入仍是必经步骤。
        await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
        entry.phase = "import-and-ready";
        await importDir(IMPORT_DIR);
        entry.original = await readCanvasState();
        if (entry.original.webgpuStatus !== "ready" || entry.original.variant !== "original") throw new Error("原始模式未就绪");
        await shot("entry-original");
        entry.phase = "v1-binding";
        await page.click(sel.variantBtn("v1"));
        await waitRebuilt();
        entry.v1 = await readCanvasState();
        entry.copy = await page.locator(sel.variantBtn("v1")).innerText();
        if (entry.v1.webgpuStatus !== "ready" || entry.v1.variant !== "v1") throw new Error("V1未就绪");
        for (const slot of ["face", "body", "hairA", "hairB", "brows", "lashes"]) {
          const count = Number(entry.v1[slot + "DrawCalls"]);
          if (!(count > 0 && count === Number(entry.v1[slot + "OnComposite"]))) throw new Error(slot + "绑定未通过");
        }
        for (const word of ["Face", "BodySkin", "HairA/HairB", "Brows", "Lashes", "6 槽", "9 槽", "高光待决"])
          if (!entry.copy.includes(word)) throw new Error("显示文案缺少" + word);
        await shot("entry-v1");
        entry.phase = "original-return";
        await page.click(sel.variantBtn("original"));
        await waitRebuilt();
        entry.returned = await readCanvasState();
        if (entry.returned.variant !== "original" || entry.returned.webgpuStatus !== "ready") throw new Error("切回原始模式失败");
      })(),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("入口回放105秒预算耗尽")), 105000); }),
    ]);
    if (report.pageErrors.length || report.failedReqs.length || report.httpBad.length) throw new Error("入口存在页面或HTTP错误");
    entry.status = "pass";
  } catch (error) {
    entry.status = "fail";
    entry.failures.push(String(error?.stack || error));
  } finally {
    clearTimeout(deadline);
    let diagnosticTimer;
    await Promise.race([
      (async () => {
        entry.lastPage = await page.evaluate(() => ({
          canvas: [...document.querySelectorAll("canvas")].map(c => ({ ...c.dataset })),
          visibleText: document.body.innerText.slice(-5000),
        }));
        const file = path.join(OUT, "entry-final.png");
        await page.screenshot({ path: file, timeout: 3000 });
        report.screenshots.entryFinal = file;
      })().catch(error => { entry.diagnosticError = String(error); }),
      new Promise(resolve => { diagnosticTimer = setTimeout(resolve, 4000); }),
    ]);
    clearTimeout(diagnosticTimer);
    await context.close();
    entry.elapsedMs = Date.now() - started;
    report.summary = { allPass: entry.status === "pass", exitCode: entry.status === "pass" ? 0 : 1, scope: "entry-only", fullAcceptanceRun: false };
    fs.writeFileSync(path.join(OUT, "entry-report.json"), JSON.stringify(report, null, 2));
    console.log("===ENTRY=== " + JSON.stringify({ ...report.summary, phase: entry.phase, failures: entry.failures, pmxResponses: report.pmxResponses }));
  }
  process.exit(report.summary.exitCode);
}

// ── G1：用户路径与切换 ───────────────────────────────────────────────
// 聚焦校准开关 --g7-morph-only：跳过 G1-G6 主体（最小环境准备由 G7 入口自行完成）。
if (!G7_MORPH_ONLY) try {
  note("G1", "进入 /companion origin=" + ORIGIN);
  await gotoCompanion();
  await switchToRezeK3();
  // 选中克莱妲模型（驱动变体持久化存储键），再真实导入目录。
  await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
  const st0 = await readCanvasState();
  note("G1", "初始 variant=" + st0.variant + " status=" + st0.webgpuStatus);
  if (await variantBarVisible()) fail("G1", "未导入权威克莱妲目录时变体 UI 不应显示");
  note("G1", "导入权威克莱妲目录（含 mask）");
  await importDir(IMPORT_DIR);
  if (!(await variantBarVisible())) fail("G1", "资格满足后变体 UI 未显示");
  const ui0 = await readUiVariant(); const stI = await readCanvasState();
  note("G1", "导入后 UI=" + ui0 + " canvas=" + stI.variant);
  if (ui0 !== "original") fail("G1", "默认应 original，实际 " + ui0);
  if (stI.variant !== "original") fail("G1", "导入后 canvas 默认应 original，实际 " + stI.variant);
  await shot("g1-original-with-ui");
  note("G1", "点击 V1");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const ui1 = await readUiVariant(); const st1 = await readCanvasState();
  note("G1", "V1 后 UI=" + ui1 + " canvas=" + st1.variant + " faceGraph=" + st1.faceGraph);
  if (ui1 !== "v1") fail("G1", "点 V1 后 UI=" + ui1);
  if (st1.variant !== "v1") fail("G1", "点 V1 后 canvas=" + st1.variant);
  if (st1.webgpuStatus !== "ready") fail("G1", "V1 后画布未 ready");
  await shot("g1-v1-with-ui");
  note("G1", "切回 original");
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const ui2 = await readUiVariant(); const st2 = await readCanvasState();
  if (ui2 !== "original" || st2.variant !== "original") fail("G1", "切回 original 失败 ui=" + ui2 + " canvas=" + st2.variant);
  report.gates.G1 = report.gates.G1 || { status: "pass", failures: [] }; note("G1", "PASS");
} catch (e) { fail("G1", "exception: " + (e?.stack || e)); }

// ── G2：真实绑定 + 负测 ──────────────────────────────────────────────
if (!G7_MORPH_ONLY) try {
  note("G2", "V1 绑定证据");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const b = await readCanvasState(); note("G2", JSON.stringify(b));
  const fc = Number(b.faceDrawCalls), fo = Number(b.faceOnComposite), bc = Number(b.bodyDrawCalls), bo = Number(b.bodyOnComposite);
  const hac = Number(b.hairADrawCalls), hao = Number(b.hairAOnComposite), hbc = Number(b.hairBDrawCalls), hbo = Number(b.hairBOnComposite);
  if (b.variant !== "v1") fail("G2", "canvas 应 v1，实际 " + b.variant);
  if (b.faceGraph !== "V14D Face State2 Live Composite") fail("G2", "Face graph=" + b.faceGraph);
  if (!(fc > 0 && fc === fo)) fail("G2", "Face drawCalls " + fo + "/" + fc + " 未全部走 State2 Composite");
  if (!(bc > 0 && bc === bo)) fail("G2", "BodySkin drawCalls " + bo + "/" + bc + " 未全部走 Body Composite");
  // Stage 2C-M1：HairA/HairB 必须真实命中 V14D Hair V1 Composite（分区各自硬断言，
  // 不用整头合并掩盖 A/B 分区差异）。
  if (!(hac > 0 && hac === hao)) fail("G2", "HairA drawCalls " + hao + "/" + hac + " 未全部走 V14D Hair V1 Composite");
  if (!(hbc > 0 && hbc === hbo)) fail("G2", "HairB drawCalls " + hbo + "/" + hbc + " 未全部走 V14D Hair V1 Composite");
  const brc = Number(b.browsDrawCalls), bro = Number(b.browsOnComposite), lac = Number(b.lashesDrawCalls), lao = Number(b.lashesOnComposite);
  if (!(brc > 0 && brc === bro)) fail("G2", "Brows drawCalls " + bro + "/" + brc + " 未全部走 V14D Brows Lashes V1 Composite");
  if (!(lac > 0 && lac === lao)) fail("G2", "Lashes drawCalls " + lao + "/" + lac + " 未全部走 V14D Brows Lashes V1 Composite");
  report.gates.G2 = report.gates.G2 || { status: "pass", failures: [] }; report.gates.G2.binding = b;
  // 负测 A：original 不命中 V14D graph
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const neg0 = await readCanvasState();
  if (neg0.variant === "v1") fail("G2", "original 模式 canvas 仍 v1");
  note("G2", "负测 A PASS");
  // 负测 B：重命名 PMX + mask → UI 不显示
  note("G2", "负测 B：重命名 PMX"); await importDir(NEG_RENAME_DIR);
  if (await variantBarVisible()) fail("G2", "非权威 PMX 文件名时变体 UI 不应显示");
  const negB = await readCanvasState(); if (negB.variant === "v1") fail("G2", "非权威 PMX 下 canvas 不应 v1");
  note("G2", "负测 B PASS");
  // 负测 C：权威 PMX 缺 mask → UI 不显示
  note("G2", "负测 C：缺 mask"); await importDir(NEG_NOMASK_DIR);
  if (await variantBarVisible()) fail("G2", "缺 mask 时变体 UI 不应显示");
  const negC = await readCanvasState(); if (negC.variant === "v1") fail("G2", "缺 mask 时 canvas 不应 v1");
  note("G2", "负测 C PASS");
  // 负测 D 前恢复资格：缺 mask 导入后资格状态粘性（同 PMX 名重导入不重置），
  // 需整页刷新+重导入权威目录（含 mask）让资格谓词重新判定，变体条才恢复（对齐 G4 路径）。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  if (!(await variantBarVisible())) fail("G2", "刷新+重导入后变体条未恢复（资格未重置）");
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  // 负测 D：错误 graph（graph.name 非权威 V14D 名）→ Face/BodySkin draw-call 不计入 composite。
  note("G2", "负测 D：错误 graph");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const negD = await page.evaluate(async () => { const r = await window.__rezeStageProbe.applyBadSkinGraph("wrongGraph"); const c = document.querySelector("canvas").dataset; return { ok: r.ok, faceOnComposite: c.v14dSkinVariantFaceOnComposite, bodyOnComposite: c.v14dSkinVariantBodyOnComposite, hairAOnComposite: c.v14dSkinVariantHairAOnComposite, hairBOnComposite: c.v14dSkinVariantHairBOnComposite }; });
  if (!(negD.ok && Number(negD.faceOnComposite) === 0 && Number(negD.bodyOnComposite) === 0 && Number(negD.hairAOnComposite) === 0 && Number(negD.hairBOnComposite) === 0)) fail("G2", "错误 graph 应使 composite 命中为 0，实际 " + JSON.stringify(negD));
  note("G2", "负测 D PASS " + JSON.stringify(negD));
  // 负测 E：applyStyleGroups 失败（编译非法 graph）→ ok:false 且 canvas 回退 original。
  note("G2", "负测 E：applyStyleGroups 失败回退");
 const negE = await page.evaluate(async () => { const r = await window.__rezeStageProbe.applyBadSkinGraph("failCompile"); const c = document.querySelector("canvas").dataset; return { ok: r.ok, variant: c.v14dSkinVariant, faceGraph: c.v14dSkinVariantFaceGraph }; });
 if (negE.ok !== false || negE.variant !== "original") fail("G2", "applyStyleGroups 失败应 ok:false 且回退 original，实际 " + JSON.stringify(negE));
 note("G2", "负测 E PASS " + JSON.stringify(negE));
  // 负测 F/G/H（Stage 2C-M1 修正轮）：Hair 专用 missing/wrongMaterial 扰动，
  // 每个都真实驱动引擎 applyStyleGroups 并读回 dataset 绑定证据。要求：
  // 漏 HairA → hairAOnComposite=0 且 hairBOnComposite=1（单变量，B 不受影响）；
  // 漏 HairB → hairBOnComposite=0 且 hairAOnComposite=1；错材质归属（hair 组绑到
  // BodySkin）→ hairA/hairB OnComposite 均=0。任一不满足则同一 Gate 非零退出。
  async function hairNeg(kind, expectA, expectB) {
    const r = await page.evaluate(async (k) => {
      const res = await window.__rezeStageProbe.applyBadSkinGraph(k);
      const c = document.querySelector("canvas").dataset;
      return { ok: res.ok, a: Number(c.v14dSkinVariantHairAOnComposite), b: Number(c.v14dSkinVariantHairBOnComposite), face: Number(c.v14dSkinVariantFaceOnComposite), body: Number(c.v14dSkinVariantBodyOnComposite) };
    }, kind);
    // 扰动后需整页刷新+重导入恢复干净 V1，避免残留影响下一负测。
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
    await page.waitForTimeout(2500);
    await switchToRezeK3();
    await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
    await importDir(IMPORT_DIR);
    await page.click(sel.variantBtn("v1")); await waitRebuilt();
    return r;
  }
  const negMissingA = await hairNeg("missingHairA", 0, 1);
  if (!(negMissingA.a === 0 && negMissingA.b === 1)) fail("G2", "missingHairA 应使 HairA OnComposite=0 且 HairB=1，实际 " + JSON.stringify(negMissingA));
  note("G2", "负测 F missingHairA PASS " + JSON.stringify(negMissingA));
  const negMissingB = await hairNeg("missingHairB", 1, 0);
  if (!(negMissingB.a === 1 && negMissingB.b === 0)) fail("G2", "missingHairB 应使 HairB OnComposite=0 且 HairA=1，实际 " + JSON.stringify(negMissingB));
  note("G2", "负测 G missingHairB PASS " + JSON.stringify(negMissingB));
  const negWrongMat = await hairNeg("wrongHairMaterial", 0, 0);
  if (!(negWrongMat.a === 0 && negWrongMat.b === 0)) fail("G2", "wrongHairMaterial 应使 HairA/HairB OnComposite 均=0，实际 " + JSON.stringify(negWrongMat));
  note("G2", "负测 H wrongHairMaterial PASS " + JSON.stringify(negWrongMat));
  // 负测 I/J/K/L（Stage 2C-M2a）：Brows/Lashes 专用 missing/swap/wrongTint 扰动。
  // 每个都真实驱动引擎 applyStyleGroups 并读回 dataset 绑定证据。要求：
  // 漏 Brows → browsOnComposite=0 且 lashesOnComposite=1（单变量）；
  // 漏 Lashes → lashesOnComposite=0 且 browsOnComposite=1；
  // wrongBrowsLashesTint（恒等 tint 改红绿偏置）→ graph 仍命中（分组绑定不变），
  //   但目标收敛 Gate 在 G3 非零拒绝（此处只证绑定仍命中、graph 名正确）。
  async function browsLashesNeg(kind) {
    const r = await page.evaluate(async (k) => {
      const res = await window.__rezeStageProbe.applyBadSkinGraph(k);
      const c = document.querySelector("canvas").dataset;
      return { ok: res.ok, brows: Number(c.v14dSkinVariantBrowsOnComposite), lashes: Number(c.v14dSkinVariantLashesOnComposite), browsDc: Number(c.v14dSkinVariantBrowsDrawCalls), lashesDc: Number(c.v14dSkinVariantLashesDrawCalls) };
    }, kind);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
    await page.waitForTimeout(2500);
    await switchToRezeK3();
    await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
    await importDir(IMPORT_DIR);
    await page.click(sel.variantBtn("v1")); await waitRebuilt();
    return r;
  }
  const negMissingBrows = await browsLashesNeg("missingBrows");
  if (!(negMissingBrows.brows === 0 && negMissingBrows.lashes === 1)) fail("G2", "missingBrows 应使 Brows OnComposite=0 且 Lashes=1，实际 " + JSON.stringify(negMissingBrows));
  note("G2", "负测 I missingBrows PASS " + JSON.stringify(negMissingBrows));
  const negMissingLashes = await browsLashesNeg("missingLashes");
  if (!(negMissingLashes.brows === 1 && negMissingLashes.lashes === 0)) fail("G2", "missingLashes 应使 Lashes OnComposite=0 且 Brows=1，实际 " + JSON.stringify(negMissingLashes));
  note("G2", "负测 J missingLashes PASS " + JSON.stringify(negMissingLashes));
  const negSwapBL = await browsLashesNeg("swapBrowsLashes");
  // Stage 2C-M2a 修正轮：swap 扰动已改为真实错槽归属（两个独立身份克隆 graph
  // 交叉绑定 Brows↔Lashes）。G2 绑定计数层面两槽仍各有 pipeline（各 1/1 命中
  // 目标 composite 族），但 graph 槽归属被交叉；正式逐槽 Gate（P0-1 原子同帧
  // material-ID+triUV+pixel）据「槽→graph 归属与材质身份不一致」非零拒绝。
  // 此处确认两槽 draw-call 仍真实命中 V1 composite 族（证明不是 missing），
  // 错槽的机器判别由 G3 逐槽身份/目标 Gate 承担，不能用「绑定仍 1/1」冒充通过。
  // 判别点（机器可读）：swap 扰动生成了两个独立身份 graph 名（"(swapped-slot brows)"
  // / "(swapped-slot lashes)"），与生产单一 graph 名不同；绑定计数会因 graph 名
  // 不再精确等于权威 V14D 名而归 0。因此负测成立的证据 = 两槽 OnComposite 均=0
  // （错槽 graph 不被权威绑定计数承认）且 draw-call 仍存在（browsDc/lashesDc=1，
  // 证明不是 missing）。错槽归属的最终非零拒绝由 G3 逐槽 identity-target Gate 承担。
  if (!(negSwapBL.brows === 0 && negSwapBL.lashes === 0 && negSwapBL.browsDc === 1 && negSwapBL.lashesDc === 1)) fail("G2", "swapBrowsLashes 应使两槽权威 OnComposite=0（graph 身份被交叉）但 draw-call 仍在，实际 " + JSON.stringify(negSwapBL));
  note("G2", "负测 K swapBrowsLashes PASS（真实错槽归属，权威绑定计数归 0）" + JSON.stringify(negSwapBL));
  // 负测 L/M（Stage 2C-M2a 修正轮）：Brows/Lashes 专用 wrongGraph 与 compile/apply
  // 失败。wrongGraph 把全部 graph.name 换成非权威名 → brows/lashes OnComposite=0；
  // failCompile 注入非法 output 引用 → applyStyleGroups ok:false 且 canvas 回退 original。
  const negWrongGraphBL = await browsLashesNeg("wrongGraph");
  if (!(negWrongGraphBL.brows === 0 && negWrongGraphBL.lashes === 0)) fail("G2", "wrongGraph 应使 Brows/Lashes OnComposite 均=0，实际 " + JSON.stringify(negWrongGraphBL));
  note("G2", "负测 L wrongGraph(Brows/Lashes) PASS " + JSON.stringify(negWrongGraphBL));
  const negFailCompileBL = await page.evaluate(async () => { const r = await window.__rezeStageProbe.applyBadSkinGraph("failCompile"); const c = document.querySelector("canvas").dataset; return { ok: r.ok, variant: c.v14dSkinVariant, browsOnComposite: Number(c.v14dSkinVariantBrowsOnComposite), lashesOnComposite: Number(c.v14dSkinVariantLashesOnComposite) }; });
  if (negFailCompileBL.ok !== false || negFailCompileBL.variant !== "original") fail("G2", "Brows/Lashes compile/apply 失败应 ok:false 且回退 original，实际 " + JSON.stringify(negFailCompileBL));
  note("G2", "负测 M failCompile/apply(Brows/Lashes) PASS " + JSON.stringify(negFailCompileBL));
  // failCompile 后需刷新恢复干净 V1（同 hair 负测尾部路径）。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  // 负测 D/E 在当前引擎实例注入了错误/非法 graph 分组；需整页刷新重建干净引擎，
  // 再重导入权威目录并恢复 V1 绑定，避免坏分组残留污染后续 Gate。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  if (!(await variantBarVisible())) fail("G2", "负测后刷新+重导入变体条未恢复");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const rec = await readCanvasState();
  if (rec.variant !== "v1" || rec.faceGraph !== "V14D Face State2 Live Composite") fail("G2", "负测后恢复 V1 失败 " + JSON.stringify(rec));
 report.gates.G2.negatives = { original: neg0.variant, renamed: negB.variant, noMask: negC.variant, wrongGraphCompositeHits: Number(negD.faceOnComposite) + Number(negD.bodyOnComposite), failCompileOk: negE.ok, failCompileVariant: negE.variant };
  report.gates.G2.negatives.hair = { missingHairA: negMissingA, missingHairB: negMissingB, wrongHairMaterial: negWrongMat };
  report.gates.G2.negatives.browsLashes = { missingBrows: negMissingBrows, missingLashes: negMissingLashes, swapBrowsLashes: negSwapBL, wrongGraph: negWrongGraphBL, failCompile: negFailCompileBL };
  note("G2", "PASS");
} catch (e) { fail("G2", "exception: " + (e?.stack || e)); }

// ── G3：完整模型视觉 A/B（original/V1 画布像素）─────────────────────────
if (!G7_MORPH_ONLY) try {
  note("G3", "采集 original/V1 画布像素 A/B");
  // G2 末尾已整页刷新+重导入权威目录并恢复 V1 绑定，变体条已出现；此处不再重复 importDir。
  // 继承的 Face/BodySkin/场景差异 lane 保留原先无 VMD 的用户路径；Hair 正式 lane
  // 随后单独加载同一权威 VMD，pause+seek 到固定秒数，再由单个 captureHairTriUv
  // 原子返回 canvas、material-ID/depth、triId、插值 UV 和时间证据。analyzer 通过
  // V14D_HAIR_ORIG_CANVAS/V14D_HAIR_V1_CANVAS 只把后一 lane 用于 Hair origMae/v1Mae。
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const sceneOrig = await page.evaluate(() => window.__rezeStageProbe?.sceneSnapshot?.() || null);
  const legacyOriginalPix = await captureStagePixels();
  const legacyOriginalBPix = await captureStagePixels();
  const legacyOriginalPng = saveDataUrl(legacyOriginalPix.dataUrl, "g3-original-canvas.png");
  const legacyOriginalBPng = saveDataUrl(legacyOriginalBPix.dataUrl, "g3-original-canvas-b.png");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const sceneV1 = await page.evaluate(() => window.__rezeStageProbe?.sceneSnapshot?.() || null);
  const legacyV1Pix = await captureStagePixels();
  const legacyV1Png = saveDataUrl(legacyV1Pix.dataUrl, "g3-v1-canvas.png");
  if (legacyOriginalPix.error || legacyOriginalBPix.error || legacyV1Pix.error) {
    fail("G3", "继承场景 A/B 画布像素捕获失败 " + (legacyOriginalPix.error || legacyOriginalBPix.error || legacyV1Pix.error));
  }
  report.gates.G3 = report.gates.G3 || { status: "pass", failures: [] };
  report.gates.G3.legacyCanvas = { original: legacyOriginalPng, originalB: legacyOriginalBPng, v1: legacyV1Png };

  // Hair 原子 lane：original/V1 各在变体重建后重新加载同一权威 VMD，并固定到
  // 不可覆盖的 4 秒/120 帧/30 FPS/权威动画名。
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const originalSetup = await prepareHairCapture();
  const originalAtomic = await captureHairAtomic();
  const origPix = originalAtomic?.canvasDataUrl
    ? { dataUrl: originalAtomic.canvasDataUrl, width: originalAtomic.width, height: originalAtomic.height }
    : { error: originalAtomic?.error || "original atomic hair capture unavailable" };
  const oPng = saveDataUrl(origPix.dataUrl, "g3-hair-original-canvas.png");
  await shot("g3-original-full");

  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const v1Setup = await prepareHairCapture();
  const hairTriUvCapture = await captureHairAtomic();
  const v1Pix = hairTriUvCapture?.canvasDataUrl
    ? { dataUrl: hairTriUvCapture.canvasDataUrl, width: hairTriUvCapture.width, height: hairTriUvCapture.height }
    : { error: hairTriUvCapture?.error || "v1 atomic hair capture unavailable" };
  const vPng = saveDataUrl(v1Pix.dataUrl, "g3-hair-v1-canvas.png");
  await shot("g3-v1-full");
  const capturePair = validateV14dHairCapturePair({
    original: {
      ...(originalAtomic?.captureEvidence || {}),
    },
    v1: {
      ...(hairTriUvCapture?.captureEvidence || {}),
    },
  });
  const originalHairAudit = hairCaptureAudit(originalAtomic, capturePair.original);
  const v1HairAudit = hairCaptureAudit(hairTriUvCapture, capturePair.v1);
  const originalAtomicMeta = path.join(OUT, "g3-hair-original-atomic.json");
  const v1AtomicMeta = path.join(OUT, "g3-hair-v1-atomic-summary.json");
  // original probe 也必须留下可审计证据，即使后续 V1 证据失败；只保存
  // captureEvidence/captureState 与材质解析计数摘要，不复制正式 triUV 大数组。
  fs.writeFileSync(originalAtomicMeta, JSON.stringify(summarizeHairAtomicCapture(originalAtomic), null, 2));
  fs.writeFileSync(v1AtomicMeta, JSON.stringify(summarizeHairAtomicCapture(hairTriUvCapture), null, 2));
  report.gates.G3 = report.gates.G3 || { status: "pass", failures: [] };
  report.gates.G3.hairCaptureTime = {
    requested: {
      seconds: HAIR_CAPTURE_SECONDS,
      frame: HAIR_CAPTURE_FRAME,
      fps: HAIR_CAPTURE_FPS,
      fpsProvenance: HAIR_CAPTURE_FPS_PROVENANCE,
      animationName: HAIR_CAPTURE_ANIMATION_NAME,
    },
    originalSetup,
    v1Setup,
    actual: { original: originalHairAudit.actual, v1: v1HairAudit.actual },
    captureIds: {
      original: {
        captureId: originalHairAudit.captureId,
        pixel: originalHairAudit.pixelCaptureId,
        triUv: originalHairAudit.triUvCaptureId,
      },
      v1: {
        captureId: v1HairAudit.captureId,
        pixel: v1HairAudit.pixelCaptureId,
        triUv: v1HairAudit.triUvCaptureId,
      },
    },
    pixelTriUvPairs: { original: capturePair.original, v1: capturePair.v1 },
    captureEvidence: {
      original: originalAtomic?.captureEvidence || null,
      v1: hairTriUvCapture?.captureEvidence || null,
    },
    original: originalAtomic?.captureState || null,
    v1: hairTriUvCapture?.captureState || null,
    pair: capturePair,
  };
  if (!capturePair.ok) fail("G3", "HairA/HairB 原子采集时间/帧不一致: " + JSON.stringify(capturePair));
  if (origPix.error || v1Pix.error) fail("G3", "原子画布像素捕获失败 " + (origPix.error || v1Pix.error));
  if (!hairTriUvCapture?.captureEvidence || !hairTriUvCapture?.canvasDataUrl) fail("G3", "V1 原子 triUV+canvas 证据缺失 " + JSON.stringify(hairTriUvCapture));
  report.gates.G3.canvasSize = { width: v1Pix.width, height: v1Pix.height };
  report.gates.G3.origCanvas = oPng; report.gates.G3.v1Canvas = vPng;
  // HairA/HairB 逐槽身份与 triUV 来自 V1 的同一次原子 probe；页面 evaluate 只把
  // typed arrays 转成普通数组，analyze 消费这份同帧证据。
  if (!hairTriUvCapture || hairTriUvCapture.error || !hairTriUvCapture.materialMaskPng) {
    fail("G3", "HairA/HairB 同材质同三角形同 UV 证据采集失败: " + JSON.stringify(hairTriUvCapture));
  } else if (hairTriUvCapture.width !== v1Pix.width || hairTriUvCapture.height !== v1Pix.height) {
    fail("G3", "triUV 证据尺寸与画布不一致: " + JSON.stringify({ capture: [hairTriUvCapture.width, hairTriUvCapture.height], canvas: [v1Pix.width, v1Pix.height] }));
  } else {
    const maskPng = saveDataUrl(hairTriUvCapture.materialMaskPng, "g3-hair-material-mask.png");
    const maskMeta = path.join(OUT, "g3-hair-material-mask.json");
    fs.writeFileSync(maskMeta, JSON.stringify({
      source: hairTriUvCapture.source,
      width: hairTriUvCapture.width,
      height: hairTriUvCapture.height,
      materialIdByName: hairTriUvCapture.materialIdByName,
    }, null, 2));
    const triUvMeta = path.join(OUT, "g3-hair-tri-uv.json");
    fs.writeFileSync(triUvMeta, JSON.stringify({
      source: hairTriUvCapture.source,
      width: hairTriUvCapture.width,
      height: hairTriUvCapture.height,
      materialIdByName: hairTriUvCapture.materialIdByName,
      camera: hairTriUvCapture.camera || null,
      byMaterial: hairTriUvCapture.byMaterial,
    }, null, 2));
    report.gates.G3.hairSlotIdentity = {
      source: hairTriUvCapture.source,
      mask: maskPng,
      metadata: maskMeta,
      triUv: triUvMeta,
      originalAtomic: originalAtomicMeta,
      v1AtomicSummary: v1AtomicMeta,
      materialIdByName: hairTriUvCapture.materialIdByName,
      hairA: { materialName: "HairA", materialId: hairTriUvCapture.materialIdByName?.HairA ?? null },
      hairB: { materialName: "HairB", materialId: hairTriUvCapture.materialIdByName?.HairB ?? null },
    };
    report.gates.G3.hairTriUv = {
      source: hairTriUvCapture.source,
      width: hairTriUvCapture.width,
      height: hairTriUvCapture.height,
      materialMask: maskPng,
      json: triUvMeta,
      slots: Object.fromEntries(Object.entries(hairTriUvCapture.byMaterial || {}).map(([name, info]) => [name, {
        materialId: info.materialId,
        materialIndex: info.materialIndex,
        firstIndex: info.firstIndex,
        indexCount: info.indexCount,
        triangleCount: info.triangleCount,
        triMaskSamples: (info.triMask || []).reduce((sum, value) => sum + (value ? 1 : 0), 0),
      }])),
    };
  }
  // P1-1 Scene invariance：original 与 V1 的场景文档源（settingsRef：world/sun/bloom/
  // ground/camera/background）+ grade + 背景效果逐字段硬断言一致。变体切换只改 Face/
  // BodySkin 材质 graph，不得触碰场景/显示链；这是「保留 K3 灯光与星空背景」的引擎级证据。
  if (!sceneOrig || !sceneV1) fail("G3", "sceneSnapshot 缺失（探针未暴露场景证据）");
  else {
    const a = JSON.stringify(sceneOrig), b = JSON.stringify(sceneV1);
    report.gates.G3.sceneOrig = sceneOrig; report.gates.G3.sceneV1 = sceneV1;
    if (a !== b) {
      // 逐字段定位差异，给出可判别证据。
      const diffs = [];
      for (const k of Object.keys(sceneOrig)) if (JSON.stringify(sceneOrig[k]) !== JSON.stringify(sceneV1[k])) diffs.push(k);
      for (const k of Object.keys(sceneOrig.settings || {})) if (JSON.stringify(sceneOrig.settings[k]) !== JSON.stringify(sceneV1.settings?.[k])) diffs.push("settings." + k);
      fail("G3", "P1-1 场景不变性失败：V1 改写了场景/显示字段 " + diffs.join(","));
   } else note("G3", "P1-1 场景不变性 PASS（settings/grade/background 逐字段一致）");
    // Stage 2C-M1 修正轮：硬断言 sceneSnapshot 真实包含全局显示链字段（exposure/
    // gamma/tone mapping 经引擎 viewTransform 暴露）。缺任一字段即失败——防止
    // 「快照结构不含这些字段却宣称覆盖」的伪不变性。
    const vt = sceneOrig.viewTransform;
    const vtOk = vt && Number.isFinite(vt.exposure) && Number.isFinite(vt.gamma) && typeof vt.look === "string" && vt.look.length > 0;
    report.gates.G3.viewTransform = vt || null;
    if (!vtOk) fail("G3", "sceneSnapshot 缺 viewTransform（exposure/gamma/look=tone mapping），实际 " + JSON.stringify(vt));
    else note("G3", "viewTransform exposure=" + vt.exposure + " gamma=" + vt.gamma + " look=" + vt.look + "（original/V1 一致）");
 }
  // 硬阻断：区域差异分析以退出码判定（皮肤收敛 + 非皮肤/背景稳定 + HairA/HairB
  // 同材质 triUV 逐像素目标），不允许只算 verdict 强过。
  const { execSync } = await import("node:child_process");
  const analyzerEnv = {
    ...process.env,
    V14D_HAIR_TEX: HAIR_TEX,
    V14D_HAIR_PMX: HAIR_PMX,
  };
  // 让 accept 与独立 analyzer 完全走正式默认 Hair 原子画布；即使外层环境
  // 曾设置过旧覆盖，也不能让完整 Gate 靠 V14D_HAIR_*_CANVAS 绕过默认契约。
  delete analyzerEnv.V14D_HAIR_ORIG_CANVAS;
  delete analyzerEnv.V14D_HAIR_V1_CANVAS;
  const parseVisualReport = (text) => {
    const marker = text.indexOf("===VISUAL-GATE");
    const body = text.slice(text.indexOf("{"), marker >= 0 ? marker : text.length).trim();
    try { return body.startsWith("{") ? JSON.parse(body) : null; } catch { return null; }
  };
  const readVisualReportFile = (fileName) => {
    try { return JSON.parse(fs.readFileSync(path.join(OUT, fileName), "utf8")); } catch { return null; }
  };
  const runAnalyzer = (args = []) => {
    try {
      const stdout = execSync(["node", "scripts/analyze-reze-k3-v1-diff.mjs", ...args].join(" "), { cwd: process.cwd(), encoding: "utf8", env: analyzerEnv, stdio: ["ignore", "pipe", "pipe"] });
      return { exit: 0, stdout, stderr: "" };
    } catch (error) {
      return { exit: Number(error?.status ?? 1), stdout: String(error?.stdout ?? ""), stderr: String(error?.stderr ?? "") };
    }
  };
  const normalAnalysis = runAnalyzer();
  const normalVisualReport = readVisualReportFile("visual-diff.json") || parseVisualReport(normalAnalysis.stdout);
  const normalHairFormalGate = normalVisualReport?.hairFormalGate;
  const normalHairFormalPass = normalHairFormalGate?.authority === "material-id+atomic-triuv+slot-changed+target-convergence"
    && normalHairFormalGate.pass === true
    && normalHairFormalGate.formalTargetGate?.hairA === true
    && normalHairFormalGate.formalTargetGate?.hairB === true;
  try {
    if (normalAnalysis.exit !== 0 || !normalHairFormalPass) {
      throw new Error((normalAnalysis.stdout || normalAnalysis.stderr || "analyzer failed").slice(0, 400)
        + "; hairFormalGate=" + JSON.stringify(normalHairFormalGate));
    }
    note("G3", "区域差异硬阻断 PASS");
  } catch (err) { fail("G3", "区域差异分析硬阻断失败: " + (err.message || err).toString().slice(0, 400)); }
  // analyzer stdout 是给人看的精简摘要；regions.*.targetConvergence（含完整
  // samples/triUV/metricFailureReasons）只在对应 JSON 中。正式验收必须消费完整
  // 报告，不能因摘要省略字段而把有效证据当成缺失。
  report.gates.G3.visualDiff = {
    exit: normalAnalysis.exit,
    report: path.join(OUT, "visual-diff.json"),
    hairFormalGate: normalHairFormalGate || null,
    hairA: normalVisualReport?.regions?.hairA?.targetConvergence || null,
    hairB: normalVisualReport?.regions?.hairB?.targetConvergence || null,
  };
  // 真实错槽/错目标负测：交换 HairA/HairB 的 target/triUV 来源。它必须让正式
  // Gate 以 exit=1 阻断，但 negativeVerdict.status 仍要是 rejected，且两槽必须
  // 保留合法样本、输入证据有效，并由 v1Mae/drop/P95 等自然目标指标失败；不能
  // 靠预置 targetBinding=false 或缺文件/配置异常伪造拒绝。
  const swapAnalysis = runAnalyzer(["--neg-swap-slot-target"]);
  const swapVisualReport = readVisualReportFile("visual-diff-swap-slot-target.json") || parseVisualReport(swapAnalysis.stdout);
  const swapNegative = swapVisualReport?.negativeVerdict || null;
  const swapMetrics = {
    hairA: swapVisualReport?.regions?.hairA?.targetConvergence || null,
    hairB: swapVisualReport?.regions?.hairB?.targetConvergence || null,
  };
  const swapMetricRejected = [swapMetrics.hairA, swapMetrics.hairB].every((metric) =>
    metric?.metricGate === false
    && metric.samples >= 30
    && metric.targetSamples >= 30
    && metric.targetBinding?.inputsValid === true
    && metric.triUvResolution >= 0.999
    && Array.isArray(metric.metricFailureReasons)
    && metric.metricFailureReasons.some((reason) => /v1Mae|drop|P95/i.test(reason)),
  );
  const swapRejected = swapAnalysis.exit !== 0
    && swapNegative?.status === "rejected"
    && swapNegative?.formalTargetGate?.hairA === false
    && swapNegative?.formalTargetGate?.hairB === false
    && swapNegative?.semanticMismatch === true
    && swapNegative?.naturalMetricGate?.hairA === false
    && swapNegative?.naturalMetricGate?.hairB === false
    && swapNegative?.bindingInputsValid?.hairA === true
    && swapNegative?.bindingInputsValid?.hairB === true
    && swapMetricRejected
    && Array.isArray(swapNegative?.analysisFailures)
    && swapNegative.analysisFailures.length === 0;
  report.gates.G3.swapSlotTarget = {
    analyzerExit: swapAnalysis.exit,
    analyzer: swapNegative,
    analysisFailures: swapNegative?.analysisFailures ?? null,
    stderr: swapAnalysis.stderr.slice(0, 1000),
    rejected: swapRejected,
  };
  if (!swapRejected) fail("G3", "错槽/错目标负测协议失败：必须 analyzer exit 非零、两槽正式 Gate=false、合法样本与输入证据存在、自然指标失败且 analysisFailures=[]；实际 " + JSON.stringify(report.gates.G3.swapSlotTarget));
  else note("G3", "错槽/错目标负测 PASS（正式 Gate 非零阻断，语义拒绝非配置异常）");
  // Stage 2C-M1 修正轮：头发前刘海/后长发独立近景（前/后视角摆拍）。
  // 用 cameraOrbit 探针暂停待机 VMD 后摆拍头部特写，分别采 original/V1 纯画布；
  // 近景图是屏幕空间视觉证据（人读 + 差异图），机器分区判定由 analyze 的 UV 锚点口径给出。
  async function hairCloseup(pose, tag) {
    await page.click(sel.variantBtn("original")); await waitRebuilt();
    await page.evaluate((p) => window.__rezeStageProbe.cameraOrbit(p), pose);
    await page.waitForTimeout(350);
    const o = await captureStagePixels();
    if (!o.error) saveDataUrl(o.dataUrl, "g3-hair-" + tag + "-orig.png");
    await page.evaluate(() => window.__rezeStageProbe.cameraOrbit("reset"));
    await page.click(sel.variantBtn("v1")); await waitRebuilt();
    await page.evaluate((p) => window.__rezeStageProbe.cameraOrbit(p), pose);
    await page.waitForTimeout(350);
    const v = await captureStagePixels();
    if (!v.error) saveDataUrl(v.dataUrl, "g3-hair-" + tag + "-v1.png");
    await page.evaluate(() => window.__rezeStageProbe.cameraOrbit("reset"));
    return { orig: !o.error, v1: !v.error };
  }
  const cuFront = await hairCloseup("front", "front");
  const cuBack = await hairCloseup("back", "back");
  report.gates.G3.hairCloseups = { front: cuFront, back: cuBack };
  if (!cuFront.orig || !cuFront.v1 || !cuBack.orig || !cuBack.v1) fail("G3", "头发近景采集失败 " + JSON.stringify(report.gates.G3.hairCloseups));
  // Stage 2C-M2a：Brows/Lashes 脸部特写（original/V1 对照）。恒等 tint 的 V1 语义
  // 目标是「原色通过 + 独立绑定」，像素与 original 同帧应几乎一致；近景图证明
  // 眉毛/睫毛在 V1 下仍正确渲染（无消失/错位/透明边缘破裂），且 G2 已证两槽真实
  // 绑定到独立 V1 graph（非「未生效冒充恒等」）。
  async function browsLashesCloseup(pose, tag) {
    await page.click(sel.variantBtn("original")); await waitRebuilt();
    await page.evaluate((p) => window.__rezeStageProbe.cameraOrbit(p), pose);
    await page.waitForTimeout(350);
    const o = await captureStagePixels();
    if (!o.error) saveDataUrl(o.dataUrl, "g3-brows-lashes-" + tag + "-orig.png");
    await page.evaluate(() => window.__rezeStageProbe.cameraOrbit("reset"));
    await page.click(sel.variantBtn("v1")); await waitRebuilt();
    await page.evaluate((p) => window.__rezeStageProbe.cameraOrbit(p), pose);
    await page.waitForTimeout(350);
    const v = await captureStagePixels();
    if (!v.error) saveDataUrl(v.dataUrl, "g3-brows-lashes-" + tag + "-v1.png");
    await page.evaluate(() => window.__rezeStageProbe.cameraOrbit("reset"));
    return { orig: !o.error, v1: !v.error };
  }
  const blFront = await browsLashesCloseup("front", "front");
  report.gates.G3.browsLashesCloseups = { front: blFront };
  if (!blFront.orig || !blFront.v1) fail("G3", "Brows/Lashes 近景采集失败 " + JSON.stringify(report.gates.G3.browsLashesCloseups));
  // Stage 2C-M2a 修正轮（P0-1）：Brows/Lashes 逐槽原子同帧 identity-target Gate。
  // original/V1 各自在变体重建后重新加载同一权威 VMD 并固定到同一冻结姿态
  // （与 Hair 同一 prepareHairCapture 口径），再切脸部特写取景（眉毛/睫毛是小槽，
  // 全身取景下前景像素不足且 face_d 采样落错区）逐槽原子采集 materialId+triUV+同帧
  // canvas。产物写独立 g3-brows-lashes-* 文件，analyzer 据此对 face_d canonical
  // target 计算逐像素误差/覆盖/P95，wrongTint/错槽目标扰动在 analyzer 侧自然拒绝。
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const blOriginalSetup = await prepareHairCapture();
  const blOriginalAtomic = await captureBrowsLashesAtomic();
  const blOrigPng = saveDataUrl(blOriginalAtomic?.canvasDataUrl, "g3-brows-lashes-original-canvas.png");
  const blOriginalMeta = path.join(OUT, "g3-brows-lashes-original-atomic.json");
  fs.writeFileSync(blOriginalMeta, JSON.stringify(summarizeHairAtomicCapture(blOriginalAtomic), null, 2));

  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const blV1Setup = await prepareHairCapture();
  const blV1Atomic = await captureBrowsLashesAtomic();
  const blV1Png = saveDataUrl(blV1Atomic?.canvasDataUrl, "g3-brows-lashes-v1-canvas.png");
  const blV1Meta = path.join(OUT, "g3-brows-lashes-v1-atomic-summary.json");
  fs.writeFileSync(blV1Meta, JSON.stringify(summarizeHairAtomicCapture(blV1Atomic), null, 2));
  // P1 独立采集 provenance：run1 健康 V1 采集身份（captureId/frame/动画名/画布路径+SHA256）。
  const tintProvRun1 = {
    captureId: blV1Atomic?.captureId ?? blV1Atomic?.captureEvidence?.pixel?.captureId ?? null,
    frame: blV1Atomic?.captureEvidence?.pixel?.currentFrame ?? blV1Atomic?.captureState?.currentFrame ?? null,
    seconds: blV1Atomic?.captureEvidence?.pixel?.currentSeconds ?? blV1Atomic?.captureState?.currentSeconds ?? null,
    animationName: blV1Atomic?.captureEvidence?.pixel?.animationName ?? blV1Atomic?.captureState?.animationName ?? null,
    canvasPath: blV1Png, canvasSha256: blV1Png ? sha256(blV1Png) : null,
  };
  const blCapturePair = validateV14dHairCapturePair({
    original: { ...(blOriginalAtomic?.captureEvidence || {}) },
    v1: { ...(blV1Atomic?.captureEvidence || {}) },
  });
  report.gates.G3.browsLashesCapture = {
    requested: { seconds: HAIR_CAPTURE_SECONDS, frame: HAIR_CAPTURE_FRAME, fps: HAIR_CAPTURE_FPS },
    originalSetup: blOriginalSetup,
    v1Setup: blV1Setup,
    pair: blCapturePair,
    originalAtomicMeta: blOriginalMeta,
    v1AtomicMeta: blV1Meta,
    origCanvas: blOrigPng,
    v1Canvas: blV1Png,
  };
  if (!blCapturePair.ok) fail("G3", "Brows/Lashes 原子采集时间/帧不一致: " + JSON.stringify(blCapturePair));
  if (!blV1Atomic || blV1Atomic.error || !blV1Atomic.materialMaskPng) {
    fail("G3", "Brows/Lashes 原子同帧 material-ID+triUV+pixel 证据采集失败: " + JSON.stringify(blV1Atomic));
  } else {
    const blMaskPng = saveDataUrl(blV1Atomic.materialMaskPng, "g3-brows-lashes-material-mask.png");
    const blTriUvMeta = path.join(OUT, "g3-brows-lashes-tri-uv.json");
    fs.writeFileSync(blTriUvMeta, JSON.stringify({
      source: blV1Atomic.source,
      width: blV1Atomic.width,
      height: blV1Atomic.height,
      materialIdByName: blV1Atomic.materialIdByName,
      camera: blV1Atomic.camera || null,
      byMaterial: blV1Atomic.byMaterial,
    }, null, 2));
  report.gates.G3.browsLashesTriUv = { source: blV1Atomic.source, width: blV1Atomic.width, height: blV1Atomic.height, mask: blMaskPng, json: blTriUvMeta, materialIdByName: blV1Atomic.materialIdByName };
  }

  // Stage 2C-M2a 修正轮（关键修复）：Brows/Lashes 健康 identity-target Gate 必须在 hair
  // wrongTint 负测（下方注入头发错误 tint）之前完成并消费健康画布。hair wrongTint 会
  // 重编译 V1 graph 并把「当前 V1 画布」换成错误头发颜色；若不在此前先跑 Brows/Lashes
  // 健康 analyzer，其 --brows-lashes 读取的 g3-brows-lashes-v1-canvas.png 会被后续
  // captureBrowsLashesAtomic 覆盖成污染态，逐槽恒等 Gate 误报 tint 被改错。因此此处立即：
  // (1) 跑健康 analyzer 消费刚采集的健康画布；(2) 跑一次 baseline 恒等采集（标定 run2，
  //     仍恒等 tint、未注入任何 fault）。wrongTint/wrongAlpha 负测在下方各自注入前已先
  //     reload 恢复干净 V1，再注入各自 fault 重采画布，互不污染。
  const blAnalysis = runAnalyzer(["--brows-lashes"]);
  const blVisualReport = readVisualReportFile("visual-diff-brows-lashes.json") || parseVisualReport(blAnalysis.stdout);
  const blFormalGate = blVisualReport?.browsLashesFormalGate;
  const blFormalPass = blFormalGate?.pass === true
    && blFormalGate?.formalTargetGate?.brows === true
    && blFormalGate?.formalTargetGate?.lashes === true
    && blVisualReport?.lashesAlphaEdge?.gate === true;
  report.gates.G3.browsLashesIdentityTarget = {
    analyzerExit: blAnalysis.exit,
    report: path.join(OUT, "visual-diff-brows-lashes.json"),
    formalGate: blFormalGate || null,
    brows: blVisualReport?.regions?.brows?.targetConvergence || null,
    lashes: blVisualReport?.regions?.lashes?.targetConvergence || null,
    lashesAlphaEdge: blVisualReport?.lashesAlphaEdge || null,
    pass: blFormalPass,
  };
  if (blAnalysis.exit !== 0 || !blFormalPass) {
    fail("G3", "Brows/Lashes 逐槽 identity-target 正式 Gate 未通过 exit=" + blAnalysis.exit + " formalGate=" + JSON.stringify(blFormalGate) + " lashesAlphaEdge=" + JSON.stringify(blVisualReport?.lashesAlphaEdge?.gate ?? null));
  } else note("G3", "Brows/Lashes 逐槽 identity-target 正式 Gate PASS");
  // P1 阈值标定 run2（Stage 2C-M2a 修正轮）：第二次独立健康恒等采集（仍恒等 tint）。
  // 与上方健康 V1 画布（run1，baselineShift≈0）和下方错误 tint 采集（≈48-58）同口径对比，
  // 证明 minTintBaselineShift=20 有实测裕量。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  await prepareHairCapture();
  const blBaselineAtomic = await captureBrowsLashesAtomic();
  const blBaselinePng = saveDataUrl(blBaselineAtomic?.canvasDataUrl, "g3-brows-lashes-v1-canvas-redmae.png");
  // P1 独立采集 provenance：run2 健康恒等采集身份（与 run1 不同 captureId）。
  const tintProvRun2 = {
    captureId: blBaselineAtomic?.captureId ?? blBaselineAtomic?.captureEvidence?.pixel?.captureId ?? null,
    frame: blBaselineAtomic?.captureEvidence?.pixel?.currentFrame ?? blBaselineAtomic?.captureState?.currentFrame ?? null,
    seconds: blBaselineAtomic?.captureEvidence?.pixel?.currentSeconds ?? blBaselineAtomic?.captureState?.currentSeconds ?? null,
    animationName: blBaselineAtomic?.captureEvidence?.pixel?.animationName ?? blBaselineAtomic?.captureState?.animationName ?? null,
    canvasPath: blBaselinePng, canvasSha256: blBaselinePng ? sha256(blBaselinePng) : null,
  };
  const calibBaseline = runAnalyzer(["--brows-lashes", "--tint-pair=g3-brows-lashes-v1-canvas-redmae.png"]);
  // analyzer 报告名由 --tint-pair 画布名推导（去 "g3-brows-lashes-" 前缀与 "-canvas"
  // 后缀）：g3-brows-lashes-v1-canvas-redmae.png → visual-diff-brows-lashes-v1-redmae.json。
  // 但若画布名推导与 analyzer 实际输出不一致，回退到 mtime 最新的 calib 报告兜底。
  let calibBaselineReport = readVisualReportFile("visual-diff-brows-lashes-v1-canvas-redmae.json")
    || readVisualReportFile("visual-diff-brows-lashes-v1-redmae.json")
    || parseVisualReport(calibBaseline.stdout);
  // Stage 2C-M2a 修正轮（关键修复）：健康 Gate 已在上方消费健康画布。后续 bl 负测
  // 各自 reload 复位 + 注入 fault + 重采独立画布名（-wrongtint.png / -wrong-alpha.png），
  // 不会覆盖健康画布 g3-brows-lashes-v1-canvas.png。analyzer 负测模式用各自独立
  // mask/triUV（缺失记 analysisFailures 拒绝，不静默回退健康 mask）。
  // 恢复干净 V1（供 hair wrongTint 与后续 Gate）：reload 复位任何 fault 状态。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  await page.click(sel.variantBtn("v1")); await waitRebuilt();

  // wrongTint 负测（Stage 2C-M2a 修正轮 P0-4）：实跑注入错误 tint 的 Brows/Lashes
  // graph，重采 V1 原子同帧证据，跑 analyze --brows-lashes --neg-wrongtint；逐槽
  // 正式 Gate 必须自然拒绝（恒等 tint 是权威目标，红绿偏置拉远两槽目标）。
  const negBLTint = await page.evaluate(async () => {
    const r = await window.__rezeStageProbe.applyBadSkinGraph("wrongBrowsLashesTint");
    const c = document.querySelector("canvas").dataset;
    return { ok: r.ok, variant: c.v14dSkinVariant, browsOnComposite: c.v14dSkinVariantBrowsOnComposite, lashesOnComposite: c.v14dSkinVariantLashesOnComposite };
  });
  await page.waitForTimeout(400);
  await prepareHairCapture();
  const blWrongTintAtomic = await captureBrowsLashesAtomic();
  const blWrongTintPng = saveDataUrl(blWrongTintAtomic?.canvasDataUrl, "g3-brows-lashes-v1-canvas-wrongtint.png");
  const tintProvWrong = {
    captureId: blWrongTintAtomic?.captureId ?? blWrongTintAtomic?.captureEvidence?.pixel?.captureId ?? null,
    frame: blWrongTintAtomic?.captureEvidence?.pixel?.currentFrame ?? blWrongTintAtomic?.captureState?.currentFrame ?? null,
    seconds: blWrongTintAtomic?.captureEvidence?.pixel?.currentSeconds ?? blWrongTintAtomic?.captureState?.currentSeconds ?? null,
    animationName: blWrongTintAtomic?.captureEvidence?.pixel?.animationName ?? blWrongTintAtomic?.captureState?.animationName ?? null,
    canvasPath: blWrongTintPng, canvasSha256: blWrongTintPng ? sha256(blWrongTintPng) : null,
  };
  if (blWrongTintAtomic && !blWrongTintAtomic.error && blWrongTintAtomic.materialMaskPng) {
    fs.writeFileSync(path.join(OUT, "g3-brows-lashes-tri-uv-wrongtint.json"), JSON.stringify({
      source: blWrongTintAtomic.source, width: blWrongTintAtomic.width, height: blWrongTintAtomic.height,
      materialIdByName: blWrongTintAtomic.materialIdByName, byMaterial: blWrongTintAtomic.byMaterial,
    }, null, 2));
  }
  const blWrongTintResult = runAnalyzer(["--brows-lashes", "--neg-wrongtint"]);
  const blWrongTintReport = readVisualReportFile("visual-diff-brows-lashes-wrongtint.json") || parseVisualReport(blWrongTintResult.stdout);
  const blWrongTintVerdict = blWrongTintReport?.negativeVerdict ?? null;
  const blWrongTintRejected = blWrongTintVerdict?.status === "rejected"
    && blWrongTintVerdict?.formalTargetGate?.brows === false
    && blWrongTintVerdict?.formalTargetGate?.lashes === false
    && Array.isArray(blWrongTintVerdict?.analysisFailures)
    && blWrongTintVerdict.analysisFailures.length === 0;
  report.gates.G3.browsLashesWrongTint = {
    applied: negBLTint,
    analyzerExit: blWrongTintResult.exit,
    analyzer: blWrongTintVerdict,
    rejected: blWrongTintRejected,
  };
  if (!blWrongTintRejected) {
    fail("G3", "Brows/Lashes wrongTint 负测协议失败：必须 negativeVerdict.rejected、两槽正式 Gate 均 false、analysisFailures=[]；实际 " + JSON.stringify(report.gates.G3.browsLashesWrongTint));
  } else note("G3", "Brows/Lashes wrongTint 负测 PASS（两槽正式 Gate 自然拒绝）");

  // P1 阈值标定汇总（Stage 2C-M2a 修正轮）：把同一正式链的两次独立健康采集
  // （visual-diff-brows-lashes.json 的健康 V1 + --tint-pair=redmae 的第二次恒等采集）
  // 与一次错误 tint 采集的 baselineShift 写入机器报告，证明 minTintBaselineShift=20
  // 有实测裕量（健康远低于阈值、错误远高于阈值），非按错误样本硬编码必过。
  // 同时给出边界/反向证据：idVsWrong（恒等画布对错误目标的 MAE）必须显著为正，
  // 证明「错误 tint」与「恒等」在指纹口径上本就远离（方向正确、非偶然）。
  const tintCalib = {
    formula: "redDropDiff = mean[(V1红-Orig红)/Orig红 - (V1绿-Orig绿)/Orig绿]（显示链不变，恒等≈0、错误红通道被额外压低→显著为负）",
    maxRedDropDiff: 0,
    healthy: {
      run1: { brows: blVisualReport?.regions?.brows?.targetConvergence?.tintFingerprint ?? null, lashes: blVisualReport?.regions?.lashes?.targetConvergence?.tintFingerprint ?? null },
      run2: { brows: calibBaselineReport?.regions?.brows?.targetConvergence?.tintFingerprint ?? null, lashes: calibBaselineReport?.regions?.lashes?.targetConvergence?.tintFingerprint ?? null },
    },
    wrong: { brows: blWrongTintReport?.regions?.brows?.targetConvergence?.tintFingerprint ?? null, lashes: blWrongTintReport?.regions?.lashes?.targetConvergence?.tintFingerprint ?? null },
  };
  const healthyAboveThreshold = [tintCalib.healthy.run1.brows, tintCalib.healthy.run1.lashes, tintCalib.healthy.run2.brows, tintCalib.healthy.run2.lashes]
    .every((fp) => fp && Number.isFinite(fp.redDropDiff) && fp.redDropDiff >= 0);
  const wrongBelowThreshold = [tintCalib.wrong.brows, tintCalib.wrong.lashes]
    .every((fp) => fp && Number.isFinite(fp.redDropDiff) && fp.redDropDiff < 0);
  const directionOk = [tintCalib.wrong.brows, tintCalib.wrong.lashes]
    .every((fp) => fp && Number.isFinite(fp.redDropDiff) && Number.isFinite(fp.redMae?.meanTargetRed) && fp.redMae.meanTargetRed > 0);
  tintCalib.healthyAboveThreshold = healthyAboveThreshold;
  tintCalib.wrongBelowThreshold = wrongBelowThreshold;
  tintCalib.directionOk = directionOk;
  tintCalib.margin = "健康 redDropDiff>=0（恒等 tint 红绿同降）与错误 redDropDiff<0（错误 tint 额外压红）符号分离；两次独立健康采集均>=0 证明非按错误样本硬编码，阈值 0 取两侧实测中点";
  // P1 独立采集 provenance（Stage 2C-M2a 修正轮）：把两次健康与一次错误采集的
  // captureId/frame/动画名/画布路径+SHA256 写入机器报告，证明三次采集来自不同原子帧。
  // 硬断言 run1/run2 采集身份不同（captureId 不同），且均为权威 VMD 的 4 秒/frame120。
  // 不要求画布 hash 不同（确定性渲染允许同 hash），只证明采集来源是独立原子帧。
  tintCalib.provenance = { run1: tintProvRun1, run2: tintProvRun2, wrong: tintProvWrong };
  const provOk = [tintProvRun1, tintProvRun2, tintProvWrong].every((p) => p
    && p.captureId != null && p.frame === HAIR_CAPTURE_FRAME
    && typeof p.animationName === "string" && p.animationName.includes("koleda-v14d-authoritative-pose-f120")
    && p.canvasSha256)
    && String(tintProvRun1.captureId) !== String(tintProvRun2.captureId)
    && String(tintProvRun1.captureId) !== String(tintProvWrong.captureId)
    && String(tintProvRun2.captureId) !== String(tintProvWrong.captureId);
  tintCalib.provenanceOk = provOk;
  report.gates.G3.browsLashesTintCalibration = tintCalib;
  if (!(healthyAboveThreshold && wrongBelowThreshold && directionOk && provOk)) {
    fail("G3", "wrongTint 阈值标定证据不足：健康两次应>=0、错误应<0、target红均值应>0、三次采集 provenance 应独立（不同 captureId、frame120/权威VMD）；实际 " + JSON.stringify({ healthyAboveThreshold, wrongBelowThreshold, directionOk, provOk, prov: tintCalib.provenance }));
  } else note("G3", "wrongTint 阈值标定 PASS（健康2次>=0、错误<0、显示链不变口径有效、三次采集 provenance 独立）");

  // wrongAlpha 负测（Stage 2C-M2a 修正轮 P0-2，方案A引擎 seam）：注入专用 fault tag
  // "v14d-wrong-alpha-fault"（权威 graph 名不变，override/hair helper 同生产 V1），
  // 引擎 prelude 在 hashed discard 前把 alpha 乘固定故障因子 1e-7 → 真实剔除边缘
  // 片元、画布边界环颜色分布改变（暗色睫毛露出背景/皮肤色），透明边缘 Gate 自然
  // 非零拒绝（真实画布像素证据，非配置/阈值自证），且 analysisFailures=[]。
  const negBLAlpha = await page.evaluate(async () => {
    const r = await window.__rezeStageProbe.applyBadSkinGraph("wrongBrowsLashesAlpha");
    const c = document.querySelector("canvas").dataset;
    return { ok: r.ok, variant: c.v14dSkinVariant, browsOnComposite: c.v14dSkinVariantBrowsOnComposite, lashesOnComposite: c.v14dSkinVariantLashesOnComposite };
  });
  await page.waitForTimeout(400);
  await prepareHairCapture();
  const blWrongAlphaAtomic = await captureBrowsLashesAtomic();
  saveDataUrl(blWrongAlphaAtomic?.canvasDataUrl, "g3-brows-lashes-v1-canvas-wrong-alpha.png");
  if (blWrongAlphaAtomic && !blWrongAlphaAtomic.error && blWrongAlphaAtomic.materialMaskPng) {
    saveDataUrl(blWrongAlphaAtomic.materialMaskPng, "g3-brows-lashes-material-mask-wrong-alpha.png");
    fs.writeFileSync(path.join(OUT, "g3-brows-lashes-tri-uv-wrong-alpha.json"), JSON.stringify({
      source: blWrongAlphaAtomic.source, width: blWrongAlphaAtomic.width, height: blWrongAlphaAtomic.height,
      materialIdByName: blWrongAlphaAtomic.materialIdByName, byMaterial: blWrongAlphaAtomic.byMaterial,
    }, null, 2));
  }
  const blWrongAlphaResult = runAnalyzer(["--brows-lashes", "--neg-wrong-alpha"]);
  const blWrongAlphaReport = readVisualReportFile("visual-diff-brows-lashes-wrong-alpha.json") || parseVisualReport(blWrongAlphaResult.stdout);
  const blWrongAlphaVerdict = blWrongAlphaReport?.negativeVerdict ?? null;
  const blWrongAlphaRejected = blWrongAlphaResult.exit !== 0
    && blWrongAlphaVerdict?.status === "rejected"
    && blWrongAlphaVerdict?.lashesAlphaEdgeGate === false
    && Array.isArray(blWrongAlphaVerdict?.analysisFailures)
    && blWrongAlphaVerdict.analysisFailures.length === 0;
  report.gates.G3.browsLashesWrongAlpha = {
    applied: negBLAlpha,
    analyzerExit: blWrongAlphaResult.exit,
    analyzer: blWrongAlphaVerdict,
    rejected: blWrongAlphaRejected,
  };
  if (!blWrongAlphaRejected) {
    fail("G3", "Brows/Lashes wrongAlpha 负测协议失败：必须 analyzer exit 非零、lashesAlphaEdgeGate=false、analysisFailures=[]；实际 " + JSON.stringify(report.gates.G3.browsLashesWrongAlpha));
  } else note("G3", "Brows/Lashes wrongAlpha 负测 PASS（错误 alpha 口径被透明边缘 Gate 自然拒绝）");
  // 快速迭代开关：--fast-bl 在 Brows/Lashes identity-target + wrongTint 后即收尾退出，
  // 不跑 G4-G7。正式全量验收不带此开关。
  if (FAST_BL) {
    report.summary = { allPass: process.exitCode !== 1, exitCode: process.exitCode ?? 0, gates: Object.fromEntries(Object.entries(report.gates).map(([k, v]) => [k, v.status])) };
    fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify(report, null, 2));
    console.log("===FAST-BL-END=== allPass=" + (process.exitCode !== 1));
    await context.close().catch(() => {});
    setImmediate(() => process.exit(process.exitCode ?? 0));
  }
  // 负测注入了错误 graph；整页刷新+重导入恢复干净 V1，避免污染后续 Gate。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
} catch (e) { fail("G3", "exception: " + (e?.stack || e)); }

// ── G4：持久化 ───────────────────────────────────────────────────────
if (!G7_MORPH_ONLY) try {
  note("G4", "V1 刷新保持");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await importDir(IMPORT_DIR);
  const uiR = await readUiVariant(); const stR = await readCanvasState();
  note("G4", "V1 刷新+重导入后 UI=" + uiR + " canvas=" + stR.variant);
  if (uiR !== "v1" || stR.variant !== "v1") fail("G4", "V1 刷新未保持 ui=" + uiR + " canvas=" + stR.variant);
  note("G4", "切回 original 刷新保持");
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await importDir(IMPORT_DIR);
  const uiR2 = await readUiVariant(); const stR2 = await readCanvasState();
  if (uiR2 !== "original" || stR2.variant !== "original") fail("G4", "original 刷新未保持 ui=" + uiR2 + " canvas=" + stR2.variant);
  report.gates.G4 = report.gates.G4 || { status: "pass", failures: [] }; note("G4", "PASS");
} catch (e) { fail("G4", "exception: " + (e?.stack || e)); }

// ── G5：VMD 零回归（两变体各 play→pause→seek 真实运行证据）─────────────
async function vmdCycle(variant) {
  const r = await page.evaluate(async () => {
    const stage = window.__rezeStageProbe;
    if (!stage || !stage.playVmd) return { error: "no __rezeStageProbe" };
    try {
      await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd");
      await new Promise((s) => setTimeout(s, 700));
      const c0 = document.querySelector("canvas");
      const t0 = Number(c0?.dataset.vmdPlaybackCurrent || -1);
      await new Promise((s) => setTimeout(s, 500));
      const t1 = Number(c0?.dataset.vmdPlaybackCurrent || -1);
      const playAdvance = t1 > t0;
      await stage.pauseVmd();
      const pb = Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || -1);
      await new Promise((s) => setTimeout(s, 500));
      const pa = Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || -1);
      const pauseStable = Math.abs(pa - pb) < 0.03;
      await stage.seekVmd(0);
      await new Promise((s) => setTimeout(s, 250));
      const sk = Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || -1);
      const seekOk = sk >= 0 && Math.abs(sk) < 0.2;
      const name = document.querySelector("canvas")?.dataset.vmdPlaybackName || "";
      // 完整播放到结束：seek 回 0 后持续播放，观察进度推进到剪辑尾部（权威 VMD≈5s/120帧@24fps）
      // 并确认结束/循环回调路径仍工作（dataset 进度在播完后稳定或回绕，currentVmdUrl 清空）。
      await stage.seekVmd(0);
      await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd");
      const dur = Number(document.querySelector("canvas")?.dataset.vmdPlaybackDuration || 0);
      // 记录播放前的自然完成计数，用于判别完成回调是否真实触发（非恒真软通过）。
      const finishBefore = Number(document.querySelector("canvas")?.dataset.vmdNaturalFinishCount || 0);
      let lastT = -1; let nearTail = false;
      for (let k = 0; k < 14; k++) {
        await new Promise((s) => setTimeout(s, 500));
        const ct = Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || -1);
        if (dur > 0 && ct >= dur * 0.85) { nearTail = true; } // 进度真实接近尾部
        lastT = ct;
      }
      // 完成回调硬证据：等待播完后读取自然完成计数是否自增。
      await new Promise((s) => setTimeout(s, 1500));
      const finishAfter = Number(document.querySelector("canvas")?.dataset.vmdNaturalFinishCount || 0);
      const endReached = nearTail && finishAfter > finishBefore; // 进度到尾部 且 完成回调真实触发
      const fullPlayOk = endReached;
      return { t0, t1, playAdvance, pb, pa, pauseStable, sk, seekOk, name, duration: dur, lastT, nearTail, finishBefore, finishAfter, endReached, fullPlayOk, ok: playAdvance && pauseStable && seekOk && !!name && fullPlayOk };
    } catch (e) { return { error: String(e) }; }
  });
  return r;
}
if (!G7_MORPH_ONLY) try {
  for (const variant of ["original", "v1"]) {
    note("G5", variant + " VMD 循环");
    await page.click(sel.variantBtn(variant)); await waitRebuilt();
    const cyc = await vmdCycle(variant);
    note("G5", variant + " " + JSON.stringify(cyc));
    if (cyc.error) { fail("G5", variant + " VMD 循环失败: " + cyc.error); continue; }
    if (!cyc.ok) fail("G5", variant + " play/pause/seek 未全通过 " + JSON.stringify(cyc));
    report.gates.G5 = report.gates.G5 || { status: "pass", failures: [], cycles: {} };
    report.gates.G5.cycles[variant] = cyc;
  }
  // G5 负测：提前 seek 到中段后暂停，未播到尾部时完成计数不得自增（防恒真软通过）。
  // 必须等待超过 completion fallback 窗口（duration*1000+350ms≈4.35s）证明计数长期不增，
  // 不能只证明 0.5s 内未增。
  note("G5", "负测：提前停止不得误判为自然结束");
  const negG5 = await page.evaluate(async () => {
    const stage = window.__rezeStageProbe;
    const c = () => document.querySelector("canvas");
    const before = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    await stage.seekVmd(0);
    await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd");
    const fallbackDelay = Number(c()?.dataset.vmdCompletionFallbackDelay || 0);
    const armT = Date.now(); // fallback 在 playVmd 内 arm，记录 arm 时刻
    await new Promise((s) => setTimeout(s, 1200)); // 只播 ~1.2s，远未到 4s 尾部
    await stage.pauseVmd();
    // 等待超过 fallback 窗口（duration+350ms），证明暂停后兜底计时器也不会自增完成计数。
    const waitMs = Math.max(0, fallbackDelay - 1200) + 500;
    await new Promise((s) => setTimeout(s, waitMs));
    const after = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const fallbackFired = c()?.dataset.vmdCompletionFallbackFired || "";
    const midT = Number(c()?.dataset.vmdPlaybackCurrent || -1);
    const totalObservedAfterArmMs = Date.now() - armT; // arm 后实际总观察时长（含 1200 播放 + waitMs）
    return { before, after, midT, fallbackDelay, fallbackFired, waitMs, totalObservedAfterArmMs, notFinished: after === before };
  });
  if (!negG5.notFinished) fail("G5", "负测失败：提前停止却触发了完成计数 " + JSON.stringify(negG5));
  // P1-1：fallbackDelay 必须是有限正数（缺失会变 0 导致软通过），再断言总观察时长超过它。
  if (!(Number.isFinite(negG5.fallbackDelay) && negG5.fallbackDelay > 0)) fail("G5", "负测 fallbackDelay 非法（缺失或为 0）" + JSON.stringify(negG5));
  // P1：硬断言总观察时长确实超过 fallback 窗口，避免报告文字与单字段数值看似矛盾。
  if (!(negG5.totalObservedAfterArmMs > negG5.fallbackDelay)) fail("G5", "负测总观察时长未超过 fallback 窗口 " + JSON.stringify(negG5));
  report.gates.G5.negEarlyStop = negG5; note("G5", "负测 PASS " + JSON.stringify(negG5));
  // G5 竞态回归（P0）：A 慢 / B 快，B 成为最新后 A 才完成。最终播放必须是 B，且 A
  // 不得增加 resetPhysics / 完成 fallback / 完成计数（vmdRaceStaleCount 须自增≥1）。
  note("G5", "竞态回归：旧请求无副作用退出");
  const race = await page.evaluate(async (computeOkSrc) => {
    // 复用脚本顶层纯函数 computeG5RaceOk 的同一口径（注入求值，避免双份实现漂移）。
    const computeOk = eval("(" + computeOkSrc + ")");
    const stage = window.__rezeStageProbe;
    const c = () => document.querySelector("canvas");
    const rpBefore = Number(c()?.dataset.vmdEffectResetPhysicsCount || 0);
    const finishBefore = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const staleBefore = Number(c()?.dataset.vmdRaceStaleCount || 0);
    // A 慢：route 延迟其 VMD 字节；B 快：正常加载。
    const pA = stage.playVmd("/__probe__/__slow__/race-a.vmd", "A");
    await new Promise((s) => setTimeout(s, 150)); // 确保 A 先发出、仍在 await
    const nameB = await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd", "B");
    const retA = await pA; // A 较慢完成，应被守卫判定为旧请求而无副作用退出（返回 null）
    await new Promise((s) => setTimeout(s, 300));
    const currentName = c()?.dataset.vmdPlaybackName || "";
    const rpAfter = Number(c()?.dataset.vmdEffectResetPhysicsCount || 0);
    const finishAfter = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const staleAfter = Number(c()?.dataset.vmdRaceStaleCount || 0);
    const rpDelta = rpAfter - rpBefore;
    const finishDelta = finishAfter - finishBefore;
    const staleDelta = staleAfter - staleBefore;
    // finishDelta===0 硬断言纳入 ok（P0-2）：旧请求 A 不得增加完成计数，否则 Gate exit1。
    const ok = computeOk({ retA, currentName, nameB, rpDelta, staleDelta, finishDelta });
    return {
      retA, nameB, currentName,
      rpDelta, finishDelta, staleDelta, ok,
    };
  }, computeG5RaceOk.toString());
  if (!race.ok) fail("G5", "竞态回归失败：旧请求未无副作用退出 " + JSON.stringify(race));
  report.gates.G5.raceGuard = race; note("G5", "竞态回归 PASS " + JSON.stringify(race));
  // G5 过期完成回调负测（P0-1 + P1-2）：B 已成为当前动作且 fallback 已 arm，此时注入真实
  // A 动作名（race-a.vmd，来自上方竞态回归的慢请求）的过期 finishedName 回调。要求：完成计数
  // 不增、currentName 仍为 B、naturalFinishName 不得被改为 A、B 的 fallback 保持有效未被清除，
  // 且 B 后续仍能正常完成（finish 自增、naturalFinishName 变为 B）。
  note("G5", "负测：注入真实 A 名的过期完成回调不得清当前 fallback");
  const stale = await page.evaluate(async (computeNameOkSrc) => {
    // 复用脚本顶层纯函数 computeG5StaleNameOk 的同一口径（注入求值，避免双份实现漂移）。
    const computeNameOk = eval("(" + computeNameOkSrc + ")");
    const stage = window.__rezeStageProbe;
    const c = () => document.querySelector("canvas");
    const staleAName = "race-a.vmd"; // 真实 A 动作名（竞态回归里的慢请求）
    // 起一个当前动作 B（正常速度），让它 arm fallback。
    await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd");
    const bName = c()?.dataset.vmdPlaybackName || ""; // 本次 B 的真实动作名
    const stateBefore = stage.vmdFallbackState();
    const finishBefore = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    // 注入真实 A 动作名的过期 finishedName 回调（不属于当前动作 B）。
    stage.fireStaleFinish(staleAName);
    await new Promise((s) => setTimeout(s, 200));
    const stateAfter = stage.vmdFallbackState();
    const finishAfterStale = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const nameAfterStale = c()?.dataset.vmdNaturalFinishName || ""; // 注入 A 后必须仍严格等于 B
    const countNotBumped = finishAfterStale === finishBefore;
    const stillB = stateAfter.currentName === stateBefore.currentName && stateAfter.currentName === bName;
    const fallbackKept = stateAfter.armed === true && stateAfter.timerActive === true;
    // B 后续仍能正常完成：等到超过 B 的 fallback 窗口，完成计数应自增。
    const waitMs = Math.max(0, stateAfter.delay) + 500;
    await new Promise((s) => setTimeout(s, waitMs));
    const finishFinal = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const nameFinal = c()?.dataset.vmdNaturalFinishName || ""; // B 完成后必须仍严格等于 B
    const bCompleted = finishFinal > finishAfterStale;
    // 名称判定（P0）：注入 A 后/完成后 naturalFinishName 都严格等于本次 B 的真实动作名。
    const nameOk = computeNameOk({ bName, staleAName, nameAfterStale, nameFinal });
    const ok = countNotBumped && stillB && fallbackKept && bCompleted && nameOk;
    return {
      staleAName, bName, stateBefore, stateAfter, finishBefore, finishAfterStale, finishFinal,
      nameAfterStale, nameFinal, countNotBumped, stillB, fallbackKept, bCompleted, nameOk, waitMs, ok,
    };
  }, computeG5StaleNameOk.toString());
  if (!stale.ok) fail("G5", "过期完成回调负测失败 " + JSON.stringify(stale));
  report.gates.G5.staleFinish = stale; note("G5", "过期完成回调负测 PASS " + JSON.stringify(stale));
  // G5 resetPhysics 回归：通用 VMD effect 每次成功 load/apply/play 后自增计数（P0-2）。
  const rp = await page.evaluate(() => Number(document.querySelector("canvas")?.dataset.vmdEffectResetPhysicsCount || 0));
  if (!(rp > 0)) fail("G5", "通用 VMD effect 未观察到 resetPhysics 计数自增（P0-2 回归）");
  report.gates.G5.resetPhysicsEffectCount = rp; note("G5", "resetPhysics effect 计数=" + rp);
  note("G5", "PASS");
} catch (e) { fail("G5", "exception: " + (e?.stack || e)); }

// ── G6：管线隔离 ─────────────────────────────────────────────────────
if (!G7_MORPH_ONLY) try {
  note("G6", "切到非 reze-k3 管线不应有 V14D 泄漏");
  // 经命令栏「高级功能」面板切到 reze-design（生产管线切换路径）。
  // 面板可能已开（G5 留了 Reze 编辑器）；toggle 直到高级面板出现。
  if (!(await page.locator("[data-testid=\"mio-advanced-panel\"]").count())) {
    await page.click("button.mio-advanced-mode");
    await page.waitForSelector("[data-testid=\"mio-advanced-panel\"]", { timeout: 15000 });
  }
  await page.click(".mio-pipeline-option:has-text(\"Reze Design\")");
  // 真实克莱妲本地导入（reze-design 也支持），让画布真实重建为 original，消除陈旧 dataset。
  // 复用 importDir：管线切换后 Reze 编辑器/「资产」标签可能已收起，需先重新打开再等目录 input。
  await importDir(IMPORT_DIR);
  const curPipeline = await page.evaluate(() => document.querySelector("[data-render-pipeline]")?.getAttribute("data-render-pipeline") || "");
  note("G6", "当前管线=" + curPipeline);
  if (curPipeline !== "reze-design") fail("G6", "管线未切到 reze-design，实际 " + curPipeline);
  if (await variantBarVisible()) fail("G6", "非 reze-k3 管线显示变体 UI");
  const leak = await page.evaluate(() => ({ assets: Boolean(window.__v14dFaceStaticAssets), variant: document.querySelector("canvas")?.dataset.v14dSkinVariant || "(unset)" }));
  if (leak.assets) fail("G6", "泄漏 v14dFaceStaticAssets");
  // 硬阻断：reze-design 下真实克莱妲导入后 canvas 必须 ready 且 variant=original（不残留 v1）。
  const g6canvas = await readCanvasState();
  if (g6canvas.webgpuStatus !== "ready") fail("G6", "reze-design 画布未 ready，status=" + g6canvas.webgpuStatus);
  if (leak.variant !== "original") fail("G6", "reze-design 下 canvas variant 应 original，实际 " + leak.variant + "（v1 残留）");
  report.gates.G6 = report.gates.G6 || { status: "pass", failures: [], leak }; note("G6", "PASS");
} catch (e) { fail("G6", "exception: " + (e?.stack || e)); }

// ── 探针泄漏断言（P1）：默认生产入口（不带 ?v14dAcceptanceProbe=1）不得挂载 __rezeStageProbe；
// 显式开关入口必须有。这证明探针只在显式验收开关下暴露、生产默认关闭。 ──
if (!G7_MORPH_ONLY) try {
  note("G6", "探针泄漏：默认入口无探针 / 显式开关入口有探针");
  // (a) 当前页面为显式开关入口（BASE 带 ?v14dAcceptanceProbe=1）：探针必须存在。
  const probeOn = await page.evaluate(() => typeof window.__rezeStageProbe !== "undefined" && window.__rezeStageProbe !== null);
  if (!probeOn) fail("G6", "显式开关入口（?v14dAcceptanceProbe=1）未挂载 __rezeStageProbe");
  // (b) 默认生产入口（不带开关）：探针必须不存在。新页面需重复注册 API 存根 route 与
  // 会话 initScript（它们注册在主 page 上、不继承到 context 新页面），否则 bootstrap 不完整。
  const prodPage = await context.newPage();
  await prodPage.addInitScript((uid) => {
    window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: uid, renderPipeline: "mio-reference", ttsEnabled: false }));
  }, USER_ID);
  await prodPage.route("**/api/backend/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api\/backend/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p.startsWith("/codex/knowledge/review-summary")) return json({ workspace_key: null, total: 0, pending: 0, by_status: {} });
    if (p.startsWith("/assets/mmd/models")) return json({ items: [STUB_MODEL] });
    if (p.startsWith("/assets/vmd")) return json({ items: [] });
    if (p.startsWith("/config/mapping/resolved/")) return json({ mappings: {} });
    if (p === "/sessions" && route.request().method() === "GET") return json({ items: [] });
    if (p === "/sessions" && route.request().method() === "POST") return json({ session: { id: "stub-session-1", title: "验收会话", selected_model_path: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    if (/^\/sessions\/[^/]+\/messages/.test(p)) return json({ items: [] });
    if (p.startsWith("/companion") || p.startsWith("/config/companion")) return json({ user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3", reze_stage_document: null, updated_at: null });
    return json({ items: [] });
  });
  await prodPage.route(API_ROUTE.matches, async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (/\.pmx$/i.test(p)) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(PMX) });
    if (/\.(png|jpe?g|webp|bmp|tga|sph|spa)$/i.test(p)) {
      const base = p.replace(/^\/assets\/mmd\/models\/?/i, "");
      const cand = findKoledaAsset(base);
      if (cand) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(cand) });
      return json({ detail: "texture not found: " + base }, 404);
    }
    if (p.startsWith("/desktop-pet/shared-config")) return json({ user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3" });
    if (p.startsWith("/assets/mmd/models")) return json({ items: [STUB_MODEL] });
    if (p.startsWith("/assets/mmd/vmds") || p.startsWith("/assets/vmd")) return json({ items: [] });
    if (p.startsWith("/codex/knowledge/review-summary")) return json({ workspace_key: null, total: 0, pending: 0, by_status: {} });
    return json({ items: [] });
  });
  await prodPage.goto(ORIGIN + "/companion", { waitUntil: "domcontentloaded", timeout: 60000 });
  await prodPage.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await prodPage.waitForTimeout(2500); // 等 bootstrap
  await prodPage.click("button.mio-advanced-mode");
  await prodPage.waitForSelector('[data-testid="mio-advanced-panel"]', { timeout: 15000 });
  await prodPage.click('.mio-pipeline-option:has-text("Reze K3")');
  await prodPage.waitForTimeout(1200);
  await prodPage.click('button.mio-nav-button[aria-label="打开 Reze 材质与场景编辑器"]', { force: true });
  await prodPage.waitForSelector('button.mio-reze-editor-tool[aria-label="资产"]', { timeout: 20000 });
  await prodPage.click('button.mio-reze-editor-tool[aria-label="资产"]');
  const fileInput = prodPage.locator("input[type=file][webkitdirectory]").first();
  await fileInput.setInputFiles(IMPORT_DIR);
  await prodPage.waitForSelector(sel.canvasReady, { timeout: 120000 });
  await prodPage.waitForTimeout(500);
  const prodProbe = await prodPage.evaluate(() => ({ probePresent: typeof window.__rezeStageProbe !== "undefined" && window.__rezeStageProbe !== null, canvasReady: Boolean(document.querySelector('canvas[data-webgpu-status="ready"]')) }));
  await prodPage.close();
  if (!prodProbe.canvasReady) fail("G6", "默认生产入口画布未 ready（无法判定探针泄漏）");
  if (prodProbe.probePresent) fail("G6", "默认生产入口（不带 ?v14dAcceptanceProbe=1）泄漏 __rezeStageProbe");
  report.gates.G6.probeLeak = { explicitProbeOn: probeOn, defaultProbePresent: prodProbe.probePresent, defaultCanvasReady: prodProbe.canvasReady };
  note("G6", "探针泄漏 PASS " + JSON.stringify(report.gates.G6.probeLeak));
} catch (e) { fail("G6", "探针泄漏断言 exception: " + (e?.stack || e)); }

// ── G7（Stage 2C-M2a 修正轮 P0-3 重写）：Brows/Lashes 动态 Morph 稳定性 ─────────────
// 不改 PMX/VMD/Morph 数据。用只读探针 + setMorphWeight 在正常权威 0→1 权重下采集
// 三个状态：开眼（基线）、闭眼（まばたき=1）、表情（笑い=1，非眨眼，权威 PMX 取证
// 移动 506 个 Lashes 顶点）。逐槽记录 production material-ID 前景像素集合，证明
// 网格真实移动（Jaccard 距离超阈值）、不整槽丢失（两槽各状态前景>0）、状态可区分。
// 负测（真实可判别）：
//   - 错误 Morph 名（不存在）→ 前景集合与开眼基线完全一致 → 自然拒绝；
//   - 状态不切换（重复开眼）→ 同上自然拒绝；
//   - 整槽消失（missingBrows/missingLashes）由 G3 逐槽 identity-target Gate 承担。
// 阈值由权威健康证据标定：开/闭/表情三状态逐槽 Jaccard 距离记录进报告（含
// minMorphJaccard 标定说明），负测同口径≈0，由此证明阈值有实测裕量、非硬编码必败。
try {
  note("G7", "Brows/Lashes 动态 Morph 稳定性（开眼/闭眼/表情三状态 + 负测）");
  if (G7_MORPH_ONLY) {
    // 最小环境准备（跳过 G1-G6 时）：从干净入口 goto + 切 reze-k3 + 选模型 + 导入目录。
    await gotoCompanion();
    await switchToRezeK3();
    await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
    await importDir(IMPORT_DIR);
  } else {
    // 全量路径：G6 已切到 reze-design，回到 reze-k3 + 权威目录 + V1。
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
    await page.waitForTimeout(2500);
    await switchToRezeK3();
    await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
    await importDir(IMPORT_DIR);
  }
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  await prepareHairCapture();
  // 回归从非默认机位开始；探针必须真正恢复它，不得复位到默认/脸部机位。
  await page.evaluate(() => {
    const s = window.__rezeStageProbe, before = s.captureCamera();
    if (!before) throw new Error('camera snapshot unavailable');
    s.setCameraSnapshot({ ...before, position: [3.25, 17.4, -7.75], target: [0.2, 15.8, -0.4], fov: 39 });
  });

  // 采集三状态 + 两个负测状态的逐槽前景像素集合（material-mask 中该槽 id 命中的
  // 像素索引列表）。无前景深度口径：眉毛紧贴皮肤，前景深度剔除会把计数塌缩失去判别力。
  const morphProbe = await page.evaluate(async ({ slots, faultFirst }) => {
    let activeResult = null; // finally 通过它把 after-restore 快照写回返回值（finally 在 return 后运行）。
    const stage = window.__rezeStageProbe;
    const model = stage?.modelRef?.current ?? null;
    const engine = stage?.engineRef?.current ?? null;
    if (!stage || !stage.captureHairTriUv || !model || !engine) return { error: "probe/model/engine unavailable" };
    // ── 方案 A（Stage 2C-M2a 裁定）：临时 clip 挂起，仅显式 acceptance probe 使用。
    // 权威 pose VMD 仅含 frame120 的「まばたき=1」单关键帧（clamp-to-first 使所有帧=1，
    // 模型恒闭眼），且每次 renderFrame/update 重采样 VMD clip 覆写手动 morph 权重。
    // G7 职责收敛为「Brows/Lashes 材质在真实 PMX Morph 顶点变形下保持正确绑定/可见性/
    // 逐槽身份」，不承担 VMD 0→1 插值资产证明（后者由 G5 的 load→play→pause→seek→end 覆盖）。
    // 流程：保存原态 → 暂停并固定 frame120/相机 → 挂起 clip 重采样 → 正常权重 0→1
    // 逐状态真实 render/flush/capture → finally 恢复 morph 权重、clip 挂起、VMD 时间/
    // 播放态、相机、render-loop。正常权重 0→1，不用超权重。
    // P0-3 状态恢复完整化：保存 exact 目标 morph 权重、clip suspended、VMD seconds、
    // playing/paused、looping、render-loop running、相机；finally 先恢复 exact model.update，
    // 再逐项恢复，并以 after-restore 快照逐字段断言等于 before。
    // P0-2：保存 exact looping/render-loop running/相机状态，finally 逐项恢复并纳入 restore.ok。
    // 相机用 stage.captureCamera（真实 captureRezeCameraSnapshot：position/target/fov）保存，
    // finally 用 stage.setCameraSnapshot（applyRezeCameraSnapshot）恢复，替代原 finally 之外的
    // cameraOrbit("reset")（异常会跳过）。
    const saved = {
      clipSuspended: model.isClipApplySuspended?.() ?? false,
      playing: Boolean(model.getAnimationProgress?.()?.playing),
      paused: Boolean(model.getAnimationProgress?.()?.paused),
      looping: Boolean(model.getAnimationProgress?.()?.looping),
      seconds: Number(model.getAnimationProgress?.()?.current) || 0,
      renderLoopRunning: Boolean(engine.isRenderLoopRunning?.() ?? engine.renderLoopRunning ?? (engine.animationFrameId != null)),
      camera: stage.captureCamera(),
      morphWeights: {},
    };
    const closedNames = (stage.selectClosedEyeMorphNames?.(model.getMorphing().morphs.map((m) => m.name))) || [];
    const exprNames = (stage.selectExpressionMorphNames?.(model.getMorphing().morphs.map((m) => m.name))) || [];
    if (!closedNames.length) return { error: "no closed-eye morph (まばたき) found" };
    if (!exprNames.length) return { error: "no expression morph (笑い) found" };
    // 保存目标 morph 的原始 runtime/effective 权重（finally 逐项恢复，不固定写 0）。
    for (const mn of [...closedNames, ...exprNames]) {
      const ix = model.runtimeMorph?.nameIndex?.[mn];
      if (ix != null) saved.morphWeights[mn] = +(model.getEffectiveMorphWeights?.()[ix] ?? model.runtimeMorph?.weights?.[ix] ?? 0);
    }
    const renderObserved = {};
    // 逐槽证据：material-mask 前景像素集合（mask Jaccard + 整槽消失）+ 受影响槽逐三角
    // 质心位移（闭眼/表情主要是垂直位移，Lashes mask 集合常不变 → 质心是几何位置证据）。
    // P0-1 红绿证明钩子（仅 acceptance probe）：?v14dG7FaultRestore=1 时在 open 态采集后抛错，
    // 验证外层 finally 在异常路径同样恢复 exact 原态。生产默认入口无该参数 → 不触发。
    const faultRestore = new URLSearchParams(window.location.search).get("v14dG7FaultRestore") === "1";
    const captureSlotEvidence = async (label) => {
      const requested = { ...requestedWeights };
      const raw = await stage.captureHairTriUv(slots);
      if (faultFirst && label === 'noIsoOpen') throw new Error('G7 fault: first noIsolation capture');
      if (faultRestore && label === "open") { const e = new Error("G7 fault-injection: open capture throw for restore red/green"); e.faultInjected = true; throw e; }
      if (!raw || raw.error) return { error: raw?.error || "capture failed" };
      // P1-1：每态返回完整原子证据（pixel/materialMask/triUV 同一 captureId/currentFrame + source audit）。
      // renderObserved 硬断言真实 renderObserved=true（非仅 captureId/frame 两字段）。
      const ce = raw.captureEvidence || {};
      const pixelEv = ce.pixel || {};
      const atomicFrame = pixelEv.currentFrame ?? null;
      const atomicId = pixelEv.captureId ?? raw.captureId ?? null;
      const atomicSameCapture = atomicId != null
        && ce.materialMask?.captureId === atomicId
        && ce.triUv?.captureId === atomicId
        && pixelEv.currentFrame === atomicFrame
        && ce.materialMask?.currentFrame === atomicFrame
        && ce.triUv?.currentFrame === atomicFrame;
      const sourceAudit = raw.productionSource ?? null;
      const renderOk = raw.renderObserved === true;
      renderObserved[label] = {
        captureId: atomicId,
        frame: atomicFrame,
        renderObserved: renderOk,
        atomicSameCapture,
        sourceAuditPresent: sourceAudit != null,
      };
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = raw.materialMaskPng; });
      const cv = document.createElement("canvas"); cv.width = raw.width; cv.height = raw.height;
      const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
      const px = cx.getImageData(0, 0, raw.width, raw.height).data;
      const slotPixels = {};
      const gpuVerts = {};
      const wr = raw.morphWeightReadback;
      const sourceInstance = raw.productionSource?.instances?.find((i) => i.name === 'companion');
      const byName = (values) => Object.fromEntries([...closedNames, ...exprNames].map((n) => [n, values?.[wr?.nameIndex?.[n]] ?? null]));
      const weightEvidence = {
        label, captureId: raw.captureId, frame: raw.captureEvidence?.pixel?.currentFrame,
        source: 'production-gpu-buffer-readback',
        sourceCaptureId: wr?.captureId, sourceFrame: wr?.frame,
        sourceIdentity: sourceInstance?.sourceIdentity,
        bufferIdentity: sourceInstance?.bufferIdentity?.morphWeights === true,
        dispatchPending: sourceInstance?.transforms?.morphDispatchPending,
        requested, runtime: byName(wr?.runtime), effective: byName(wr?.effective), gpu: byName(wr?.gpu),
      };
      const gpuWeights = weightEvidence.gpu;
      // A3+M2a.4：位移真值=生产 GPU 顶点快照。captureHairTriUv 内 renderFrame→updateInstances
      // 在 consumeMorphWeightsDirty 时用 getEffectiveMorphWeights() 上传并 dispatch morph compute
      // 写 vertexBuffer；probe update 隔离确保 lock 不覆写本态 probeWeights。
      const inst = engine.modelInstances ? [...engine.modelInstances.values()][0] : null;
      const allIndices = model.getIndices();
      const vertexBuffer = inst?.vertexBuffer ?? null;
      const device = engine.device ?? null;
      for (const name of slots) {
        const id = raw.materialIdByName?.[name];
        const list = [];
        if (Number.isInteger(id) && id > 0) { for (let p = 0; p < raw.width * raw.height; p += 1) { const i = p * 4; if (px[i] !== 0 && px[i + 1] === id) list.push(p); } }
        slotPixels[name] = list;
        const mats = model.getMaterials();
        const mi = mats.findIndex((m) => m.name === name);
        if (vertexBuffer && device && mi >= 0) {
          const firstIndex = mats.slice(0, mi).reduce((s, m) => s + m.vertexCount, 0);
          const indexCount = mats[mi].vertexCount;
          const uniq = [...new Set(Array.from(allIndices.slice(firstIndex, firstIndex + indexCount)))].sort((a, b) => a - b);
          const minV = uniq[0], maxV = uniq[uniq.length - 1], vcount = maxV - minV + 1;
          const byteLen = vcount * 32;
          const rb = device.createBuffer({ size: byteLen, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const enc = device.createCommandEncoder();
          enc.copyBufferToBuffer(vertexBuffer, minV * 32, rb, 0, byteLen);
          device.queue.submit([enc.finish()]);
          await rb.mapAsync(GPUMapMode.READ);
          const arr = new Float32Array(rb.getMappedRange().slice(0));
          rb.unmap(); rb.destroy();
          const positions = {};
          for (const v of uniq) { const b = (v - minV) * 8; positions[v] = [+arr[b].toFixed(5), +arr[b + 1].toFixed(5), +arr[b + 2].toFixed(5)]; }
          gpuVerts[name] = { vertexSet: uniq, positions, drawRange: { firstIndex, count: indexCount }, vertexCount: uniq.length };
        }
      }
      // P1-1：per-state 返回完整原子证据，供正式 evidence evaluator 硬断言同一 captureId/frame。
      // P0-2：raw.camera = captureHairTriUv 在同一 frame120 冻结姿态读取的真实相机 view/projection
      // 矩阵快照（G7 全程相机固定于 frame120 取景）。用作逐字段 before/after 一致性断言。
      return { slotPixels, gpuVerts, gpuWeights, weightEvidence, canvasDataUrl: raw.canvasDataUrl, width: raw.width, height: raw.height, captureEvidence: ce, productionSource: sourceAudit, renderObserved: renderOk, atomicSameCapture, cameraMatrix: raw.camera ?? null };
    };


    const requestedWeights = {};
    const setW = (names, w) => { for (const n of names) { requestedWeights[n] = w; model.setMorphWeight(n, w); } };
    // M2a.4 真根因：lockKoledaMorphWeights 包装 model.update，在 update 后强制写回 まばたき=1
    // （生产默认闭眼语义，RezeWebGpuStage:864 锁定 closedEyeMorphs=1）。G7 探针请求 open=0 会被
    // 该锁覆写 → open/closed 同权重 → 506 顶点 GPU 位移=0。正式修正：仅在显式 acceptance probe
    // 生命周期临时包裹当前 model.update——保存 exact originalUpdate，wrapper 先 originalUpdate.apply
    // 再把本态 probeWeights 写回（覆盖锁的强制写回），finally 恢复 exact originalUpdate。
    // 不修改 koledaDefaultAppearance.js 或生产锁配置；禁止放宽 expectedAffectedSlots、禁止改生产
    // 默认闭眼语义。
    const gpuDiag = { note: "A3+M2a.4: renderFrame 原生 updateInstances→consumeMorphWeightsDirty→getEffectiveMorphWeights→dispatchMorphCompute 写 vertexBuffer；probe update 隔离确保 lock 不覆写 probeWeights" };
    const lockControl = { forcedMorphNames: null, confirmed: false, probeIsolationApplied: false, noIsolationNegative: null };
    let probeWeights = null;
    const originalUpdate = model.update;
    // ── P0-1：所有首次副作用（pause/clip/morph/capture）之后的流程——含真实 noIsolation
    // 控制——纳入同一个外层 try/finally；任一 capture 抛错也走 finally 恢复 exact 原态。
    try {
      // ── P0-3：真实 noIsolation 控制（安装 post-update wrapper 之前）。请求 open=0 后
      engine.stopRenderLoop();
      stage.cameraOrbit('face');
      // 生产 update 让 lockKoledaMorphWeights 强制写回 blink=1；请求 closed=1 后保持 1。
      // 两态生产 GPU 顶点 delta=0，证明无隔离时 lock 覆写 open 请求。confirmed 必须由
      // 真实控制共同得出：open 与 closed 的 effective+GPU 权重均为 1、forced morph 身份
      // 与实际观测一致；任一缺失即失败，禁止布尔硬赋值。
      model.pause();
      model.setClipApplySuspended?.(true);
      setW(closedNames, 0); setW(exprNames, 0);
      const noIsoOpen = await captureSlotEvidence("noIsoOpen");
      setW(closedNames, 1); setW(exprNames, 0);
      const noIsoClosed = await captureSlotEvidence("noIsoClosed");
      // 只消费各态切换之前冻结的副本，此刻 model 已处于 closed。
      const observedOpen = noIsoOpen.weightEvidence.effective;
      const observedClosed = noIsoClosed.weightEvidence.effective;
      const gpuOpen = noIsoOpen?.gpuWeights || {};
      const gpuClosed = noIsoClosed?.gpuWeights || {};
      // forcedMorphNames = 生产锁实际强制为 1 的 morph（open 请求 0 被观测为 1 者），非选择结果。
      const forced = closedNames.filter((mn) => noIsoOpen.weightEvidence.requested[mn] === 0 && noIsoOpen.weightEvidence.runtime[mn] === 1 && observedOpen[mn] === 1 && gpuOpen[mn] === 1);
      lockControl.forcedMorphNames = forced;
      lockControl.observedWeights = { openEffective: observedOpen, closedEffective: observedClosed, openGpu: gpuOpen, closedGpu: gpuClosed };
      lockControl.confirmed = closedNames.length > 0
        && forced.length === closedNames.length
        && closedNames.every((mn) => Math.abs((observedClosed[mn] ?? 0) - 1) < 1e-3)
        && closedNames.every((mn) => Math.abs((gpuOpen[mn] ?? 0) - 1) < 1e-3)
        && closedNames.every((mn) => Math.abs((gpuClosed[mn] ?? 0) - 1) < 1e-3);
      lockControl.noIsolationNegative = { open: noIsoOpen, closed: noIsoClosed, openRequestedWeight: 0, openEffectiveWeightAfterLock: observedOpen[closedNames[0]] ?? null };
      // 安装 post-update 隔离 wrapper（仅显式 acceptance probe）：originalUpdate 后写回本态 probeWeights。
      model.update = function (...args) {
        const result = originalUpdate.apply(this, args);
        if (probeWeights) { for (const [n, w] of Object.entries(probeWeights)) model.setMorphWeight(n, w); }
        return result;
      };
      lockControl.probeIsolationApplied = true;
      model.pause();
      model.setClipApplySuspended?.(true);
      probeWeights = Object.fromEntries([...closedNames, ...exprNames].map((n) => [n, 0]));
      setW(closedNames, 0); setW(exprNames, 0);
      const openEye = await captureSlotEvidence("open");
      const openRepeat = await captureSlotEvidence('openRepeat');
      probeWeights = Object.fromEntries([...closedNames.map((n) => [n, 1]), ...exprNames.map((n) => [n, 0])]);
      setW(closedNames, 1);
      const closedEye = await captureSlotEvidence("closed");
      probeWeights = Object.fromEntries([...closedNames, ...exprNames].map((n) => [n, 0]));
      setW(closedNames, 0);
      probeWeights = Object.fromEntries([...closedNames.map((n) => [n, 0]), ...exprNames.map((n) => [n, 1])]);
      setW(exprNames, 1);
      const expression = await captureSlotEvidence("expression");
      probeWeights = Object.fromEntries([...closedNames, ...exprNames].map((n) => [n, 0]));
      setW(exprNames, 0);
      model.setMorphWeight("__nonexistent_morph__", 1);
      const wrongName = await captureSlotEvidence("wrongName");
      const noSwitch = await captureSlotEvidence("noSwitch");
      const result = { openEye, openRepeat, closedEye, expression, wrongName, noSwitch, noIsolation: lockControl.noIsolationNegative, closedEyeMorphs: closedNames, expressionMorphs: exprNames, renderObserved, clipSuspendedUsed: true, gpuDiag, lockControl, saved, restore: { ok: null, after: null } };
      activeResult = result;
      return result;
    } catch (e) {
      // 返回同一对象，finally 完成恢复后才交给调用方，不以微任务模拟恢复时序。
      const result = { error: String(e?.message || e), faultRestoreError: true, openEye: null, closedEye: null, expression: null, wrongName: null, noSwitch: null, noIsolation: lockControl.noIsolationNegative, closedEyeMorphs: closedNames, expressionMorphs: exprNames, renderObserved, clipSuspendedUsed: true, gpuDiag, lockControl, saved, restore: { ok: null, after: null } };
      activeResult = result;
      return result;
    } finally {
      // 不 await、不渲染：先恢复真实参数，再同步读取 after，最后恢复原循环。
      engine.stopRenderLoop();
      probeWeights = null;
      model.update = originalUpdate;
      model.setClipApplySuspended(saved.clipSuspended);
      model.seek(saved.seconds);
      for (const [n, w] of Object.entries(saved.morphWeights)) model.setMorphWeight(n, w);
      model.animationState.currentLoop = saved.looping;
      // AnimationState 的两个标志并不互斥，逐项恢复原值，不以 pause 代替 stop。
      model.animationState.isPlaying = saved.playing;
      model.animationState.isPaused = saved.paused;
      const afterCamera = stage.setCameraSnapshot(saved.camera);
      if (saved.renderLoopRunning) engine.runRenderLoop();
      const after = {
        clipSuspended: model.isClipApplySuspended(),
        playing: Boolean(model.getAnimationProgress().playing),
        paused: Boolean(model.getAnimationProgress().paused),
        looping: Boolean(model.getAnimationProgress().looping),
        renderLoopRunning: engine.animationFrameId != null,
        seconds: model.getAnimationProgress().current,
        camera: afterCamera,
        morphWeights: Object.fromEntries(Object.keys(saved.morphWeights).map((n) => [n, Number(model.getEffectiveMorphWeights()[model.runtimeMorph.nameIndex[n]])])),
      };
      const eqArray = (a,b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i) => Number.isFinite(v) && Math.abs(v-b[i]) <= 1e-6);
      const cameraOk = !!saved.camera && !!after.camera && eqArray(saved.camera.position, after.camera.position) && eqArray(saved.camera.target, after.camera.target) && Math.abs(saved.camera.fov-after.camera.fov)<=1e-6;
      if (activeResult) activeResult.restore = {
        before: saved, after, cameraApplied: true, cameraOk, updateIdentityRestored: model.update === originalUpdate,
        ok: cameraOk && model.update === originalUpdate
          && ['clipSuspended','playing','paused','looping','renderLoopRunning'].every((key) => after[key] === saved[key])
          && Math.abs(after.seconds-saved.seconds) <= 1e-6
          && Object.keys(saved.morphWeights).every((n) => after.morphWeights[n] === saved.morphWeights[n]),
      };
    }

  }, { slots: BROWS_LASHES_SLOTS, faultFirst: FAULT_FIRST_CAPTURE });



  report.gates.G7 = report.gates.G7 || { status: "pass", failures: [] };
  report.gates.G7.restore = morphProbe.restore;
  if (!morphProbe.restore?.ok) fail('G7', '原相机/运行态未恢复: ' + JSON.stringify(morphProbe.restore));
  if (!morphProbe.error) {
    const closed = morphProbe.closedEyeMorphs, expr = morphProbe.expressionMorphs;
    const assignments = (blink, smile) => Object.fromEntries([...closed.map(n=>[n,blink]), ...expr.map(n=>[n,smile])]);
    const states = { open: morphProbe.openEye, openRepeat: morphProbe.openRepeat, closed: morphProbe.closedEye, expression: morphProbe.expression, wrongName: morphProbe.wrongName, noSwitch: morphProbe.noSwitch, noIsoOpen: morphProbe.noIsolation.open, noIsoClosed: morphProbe.noIsolation.closed };
    const expected = { open: assignments(0,0), openRepeat: assignments(0,0), closed: assignments(1,0), expression: assignments(0,1), wrongName: assignments(0,0), noSwitch: assignments(0,0), noIsoOpen: assignments(0,0), noIsoClosed: assignments(1,0) };
    const evidence = Object.fromEntries(Object.entries(states).map(([label,s])=>[label,s.weightEvidence]));
    report.gates.G7.previews = Object.fromEntries(['open','closed','expression'].map(label=>[label,saveDataUrl(states[label].canvasDataUrl,'g7-' + label + '.png')]));
    for (const s of Object.values(states)) delete s.canvasDataUrl;
    const verdicts = Object.fromEntries(Object.entries(evidence).map(([label,e])=>[label,evaluateG7WeightEvidence(e,label,expected[label],label==='noIsoOpen'?assignments(1,0):expected[label])]));
    report.gates.G7.weightEvidence = { states: evidence, verdicts };
    report.gates.G7.sourceAudit = Object.fromEntries(Object.entries(states).map(([label,s]) => [label, { ok: validateG7Source(s.productionSource, s.weightEvidence.captureId, s.weightEvidence.frame), audit: s.productionSource }]));
    for (const [label,v] of Object.entries(report.gates.G7.sourceAudit)) if (!v.ok) fail('G7', label + ' 生产源审计失败');
    for (const [label,v] of Object.entries(verdicts)) if (!v.ok) fail('G7', label + ' 权重证据失败: ' + v.reasons.join(','));
    const swapped = evaluateG7WeightEvidence(evidence.closed,'open',expected.open);
    const cpuGpuMismatch = evaluateG7WeightEvidence({ ...evidence.open, gpu: evidence.closed.gpu },'open',expected.open);
    report.gates.G7.weightEvidence.negatives = { swapped, cpuGpuMismatch };
    if (swapped.ok || cpuGpuMismatch.ok) fail('G7', '权重证据负测没有判别力');
  }
report.gates.G7.morph = {
    closedEyeMorphs: morphProbe.closedEyeMorphs,
    expressionMorphs: morphProbe.expressionMorphs,
    renderObserved: morphProbe.renderObserved || null,
    clipSuspended: morphProbe.clipSuspendedUsed === true,
    weightRange: "0->1",
    gpuDiag: morphProbe.gpuDiag || null,
    error: morphProbe.error || null,
  };
  // ── P0-1 红绿证明：--fault-restore / ?v14dG7FaultRestore=1 注入 open 采集 throw，G7 必须因
  // 异常而失败，且 restore.ok===true 证明异常路径 finally 恢复 exact 原态。健康路径（未触发）
  // 要求正常无 fault 标记。
  if (morphProbe.faultRestoreError) {
    report.gates.G7.faultRestore = { triggered: true, error: morphProbe.error, restoreOk: morphProbe.restore?.ok === true, restore: morphProbe.restore ?? null };
    note("G7", "P0-1 异常路径恢复红绿：fault 已触发，restore.ok=" + (morphProbe.restore?.ok === true) + "（G7 因异常而失败，恢复须为 true）");
    fail("G7", "P0-1 异常路径红绿：fault-injection 使 G7 失败；restore.ok=" + (morphProbe.restore?.ok === true) + " 须为 true（恢复 exact 原态）");
  } else if (FAULT_RESTORE || FAULT_FIRST_CAPTURE) {
    fail("G7", "P0-1 红绿失败：--fault-restore 已开启但 fault 未触发（morphProbe.faultRestoreError 缺失）");
  } else if (morphProbe.error || morphProbe.openEye?.error || morphProbe.closedEye?.error || morphProbe.expression?.error) {
    fail("G7", "Morph 稳定性采集失败: " + JSON.stringify({ e: morphProbe.error, o: morphProbe.openEye?.error, c: morphProbe.closedEye?.error, x: morphProbe.expression?.error }));
  } else {
    const jaccardDistance = (a, b) => {
      const setA = new Set(a), setB = new Set(b);
      if (setA.size === 0 && setB.size === 0) return 0;
      let inter = 0;
      for (const v of setA) if (setB.has(v)) inter += 1;
      const union = setA.size + setB.size - inter;
      return union === 0 ? 0 : 1 - inter / union;
    };
    const slotsArr = ["Brows", "Lashes"];
    const countOf = (state, name) => (state?.slotPixels?.[name] || []).length;
    const distTo = (state) => Object.fromEntries(slotsArr.map((n) => [n, +jaccardDistance(morphProbe.openEye.slotPixels[n] || [], state.slotPixels[n] || []).toFixed(4)]));
    // 逐槽前景计数与对开眼基线的 Jaccard 距离。
    const counts = {
      open: Object.fromEntries(slotsArr.map((n) => [n, countOf(morphProbe.openEye, n)])),
      closed: Object.fromEntries(slotsArr.map((n) => [n, countOf(morphProbe.closedEye, n)])),
      expression: Object.fromEntries(slotsArr.map((n) => [n, countOf(morphProbe.expression, n)])),
    };
    const dist = {
      closedVsOpen: distTo(morphProbe.closedEye),
      expressionVsOpen: distTo(morphProbe.expression),
      wrongNameVsOpen: morphProbe.wrongName?.error ? null : distTo(morphProbe.wrongName),
      noSwitchVsOpen: morphProbe.noSwitch?.error ? null : distTo(morphProbe.noSwitch),
    };
    // P0 逐槽判定（Stage 2C-M2a 修正轮）：不能用任意槽 some() 兜底——必须由取证声明的
    // 受影响槽逐槽超过同状态噪声上界。闭眼 まばたき / 表情 笑い 均只移动 Lashes（506 顶点）、
    // Brows 0 顶点（见 pmx-morph-forensic.json）。噪声只来自独立健康重复采集，
    // wrongName/noSwitch 不参与标定；屏幕 Jaccard 仅辅助诊断。
    let forensic = null;
    try { forensic = JSON.parse(fs.readFileSync(MORPH_FORENSIC, "utf8")); } catch (e) { forensic = { error: String(e) }; }
    const forensicFor = (names) => (forensic?.morphs || []).filter((m) => names.includes(m.name));
    // 受影响槽映射：某槽 lashesVerts/browsVerts > 0 → 该槽受影响。按 morph 聚合（任一匹配 morph 移动该槽即受影响）。
    const affectedSlotsFor = (names) => {
      const set = new Set();
      for (const m of forensicFor(names)) {
        if ((m.lashesVerts || 0) > 0) set.add("Lashes");
        if ((m.browsVerts || 0) > 0) set.add("Brows");
      }
      return set;
    };
    const closedAffected = affectedSlotsFor(morphProbe.closedEyeMorphs || []);
    const exprAffected = affectedSlotsFor(morphProbe.expressionMorphs || []);
    // 独立健康重复采集，不让负测自身抬高阈值。屏幕数值仅诊断。
    const healthyScreenRepeat = distTo(morphProbe.openRepeat);
    const negNoise = (n) => healthyScreenRepeat[n];
    const NOISE_MARGIN = 0.02;
    const noiseUpper = Object.fromEntries(slotsArr.map((n) => [n, +(negNoise(n) + NOISE_MARGIN).toFixed(4)]));
    const minForeground = 1;
    const visibleAll = slotsArr.every((n) => counts.open[n] >= minForeground && counts.closed[n] >= minForeground && counts.expression[n] >= minForeground);
    // A3：位移真值=生产 GPU 顶点快照（model-space position delta）。屏幕投影质心受 ~2.5px
    // 抖动污染，降级为渲染健康辅助（diagnosticOnly），不再作为 morph 位移判据。
    // 受影响槽：该槽 draw 顶点集合与 PMX morph 受影响顶点（按名称交集，506=全 morph 取证数）
    // 有非空交集，且 weight0→weight1 生产 GPU 顶点 delta 的 RMS/max 超过 same-weight 重复噪声+epsilon。
    const gpuStats = (s1, s2, n) => {
      const a = s1?.gpuVerts?.[n], b = s2?.gpuVerts?.[n];
      if (!a || !b || !a.vertexSet.length || a.vertexSet.length !== b.vertexSet.length) return { valid: false, maxDelta: null, rmsDelta: null, movedVertexCount: 0, vertexCount: 0 };
      let mx = 0, sumSq = 0, moved = 0, cnt = 0;
      for (const v of a.vertexSet) {
        const pa = a.positions[v], pb = b.positions[v];
        if (!pa || !pb || ![...pa,...pb].every(Number.isFinite) || !b.vertexSet.includes(v)) return { valid: false, maxDelta: null, rmsDelta: null, movedVertexCount: 0, vertexCount: 0 };
        const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
        if (d > mx) mx = d; sumSq += d * d; if (d > 1e-4) moved += 1; cnt += 1;
      }
      return { valid: cnt === a.vertexSet.length, maxDelta: mx, rmsDelta: Math.sqrt(sumSq / cnt), movedVertexCount: moved, vertexCount: cnt };
    };
    const healthyRepeatDelta = Object.fromEntries(slotsArr.map(n=>[n,gpuStats(morphProbe.openEye,morphProbe.openRepeat,n)]));
    const gpuNoiseUpper = calibrateG7Noise(healthyRepeatDelta);
    report.gates.G7.noiseCalibration = { source: 'independent-open-repeat', captureIds: [morphProbe.openEye.weightEvidence.captureId,morphProbe.openRepeat.weightEvidence.captureId], healthyRepeatDelta, gpuNoiseUpper };
    const gpuDelta = {
      closed: Object.fromEntries(slotsArr.map((n) => [n, gpuStats(morphProbe.openEye, morphProbe.closedEye, n)])),
      expression: Object.fromEntries(slotsArr.map((n) => [n, gpuStats(morphProbe.openEye, morphProbe.expression, n)])),
    };
    // 逐槽受影响判定（无 any-slot 兜底）：受影响槽须 movedVertexCount>0 且 maxDelta>噪声上界+epsilon；
    // 未受影响槽须不超过该上界（Brows 不得替 Lashes 通过）。
    const perSlot = (stateDist, affected, stateGpu) => Object.fromEntries(slotsArr.map((n) => [n, {
      affected: affected.has(n),
      dist: stateDist[n],
      noiseUpper: noiseUpper[n],
      gpuDelta: stateGpu[n],
      gpuNoiseUpper: gpuNoiseUpper[n],
      moved: affected.has(n) ? (stateGpu[n].movedVertexCount > 0 && stateGpu[n].maxDelta > gpuNoiseUpper[n]) : null,
      stable: !affected.has(n) ? (stateGpu[n].maxDelta <= gpuNoiseUpper[n]) : null,
    }]));
    const closedPerSlot = perSlot(dist.closedVsOpen, closedAffected, gpuDelta.closed);
    const exprPerSlot = perSlot(dist.expressionVsOpen, exprAffected, gpuDelta.expression);
    // 屏幕证据降为渲染健康辅助。
    const screenProjection = { diagnosticOnly: true, ignoredByMorphMovementGate: true, note: "屏幕投影受 ~2.5px 抖动污染，不作为 morph 位移判据" };

    // 闭眼/表情通过 = 每个受影响槽都真实移动（>该槽噪声上界），且取证确认该状态有受影响槽。
    const evidenceValid = label => report.gates.G7.weightEvidence.verdicts[label]?.ok === true && report.gates.G7.sourceAudit[label]?.ok === true && morphProbe.renderObserved[label]?.renderObserved === true && morphProbe.renderObserved[label]?.atomicSameCapture === true;
    const commonValid = evidenceValid('open') && evidenceValid('openRepeat');
    const closedMovement = evaluateG7Movement(gpuDelta.closed, [...closedAffected], gpuNoiseUpper, commonValid && evidenceValid('closed'));
    const expressionMovement = evaluateG7Movement(gpuDelta.expression, [...exprAffected], gpuNoiseUpper, commonValid && evidenceValid('expression'));
    const closedMoved = closedMovement.ok;
    const exprMoved = expressionMovement.ok;
    // 负测判别（GPU 顶点口径）：错误名/不切换各槽 GPU delta 须不超过噪声上界（无真实 morph 变形）。
    const negGpuDelta = {
      wrongName: Object.fromEntries(slotsArr.map((n) => [n, morphProbe.wrongName?.error ? null : gpuStats(morphProbe.openEye, morphProbe.wrongName, n)])),
      noSwitch: Object.fromEntries(slotsArr.map((n) => [n, morphProbe.noSwitch?.error ? null : gpuStats(morphProbe.openEye, morphProbe.noSwitch, n)])),
    };
    const wrongNameMovement = evaluateG7Movement(negGpuDelta.wrongName, [...closedAffected], gpuNoiseUpper, commonValid && evidenceValid('wrongName') && slotsArr.every(n=>countOf(morphProbe.wrongName,n)>0));
    const noSwitchMovement = evaluateG7Movement(negGpuDelta.noSwitch, [...closedAffected], gpuNoiseUpper, commonValid && evidenceValid('noSwitch') && slotsArr.every(n=>countOf(morphProbe.noSwitch,n)>0));
    const negWrongNameRejected = wrongNameMovement.expectedRejected;
    const negNoSwitchRejected = noSwitchMovement.expectedRejected;
    report.gates.G7.movementEvaluator = { closedMovement, expressionMovement, wrongNameMovement, noSwitchMovement };
    const lockControl = morphProbe.lockControl || null;
    const gpuWeights = {
      open: morphProbe.openEye?.gpuWeights || null,
      closed: morphProbe.closedEye?.gpuWeights || null,
      expression: morphProbe.expression?.gpuWeights || null,
    };
    report.gates.G7.verdict = {
      ok: visibleAll && closedMoved && exprMoved && negWrongNameRejected && negNoSwitchRejected,
      counts, dist, noiseUpper, minForeground, gpuDelta, gpuNoiseUpper, negGpuDelta, screenProjection,
      expectedAffectedSlots: { closed: [...closedAffected], expression: [...exprAffected] },
      closedPerSlot, exprPerSlot,
      forensicSource: MORPH_FORENSIC,
      renderObserved: morphProbe.renderObserved || null,
      clipSuspended: morphProbe.clipSuspendedUsed === true,
      weightRange: "0->1",
      lockControl, gpuWeights,
      calibration: "逐槽判定：受影响槽须 movedVertexCount>0 且 GPU maxDelta>same-weight 重复噪声+epsilon；无 any-slot 兜底；屏幕投影 diagnosticOnly",
      口径声明: "G7 是验收探针控制的生产 GPU Morph 顶点位移与渲染健康 Gate（setClipApplySuspended 挂起 clip + probe update 隔离 lockKoledaMorphWeights 的 まばたき=1 强制写回 + 正常权重 0→1 + 生产 GPU 顶点快照位移），证明 Brows/Lashes 材质在真实生产 Morph 几何下稳定；不宣称当前单关键帧 pose VMD 存在原生 0→1 眨眼插值（VMD 插值由 G5 覆盖）。",
    };
    if (forensic?.error) fail("G7", "Morph 取证 JSON 读取失败: " + forensic.error);
    // lock control 硬断言：confirmed 必须来自真实 noIsolation 控制（请求0被锁回1），隔离已应用。
    if (!lockControl || lockControl.probeIsolationApplied !== true) fail("G7", "lock control 失败：probeIsolationApplied 必须为 true（隔离 lock 的 まばたき=1 强制写回）");
    if (!lockControl?.forcedMorphNames?.length) fail("G7", "lock control 失败：forcedMorphNames 必须含闭眼 morph（まばたき）");
    // P0-3：forcedMorphNames 须为生产锁实际强制的 morph（= 选择的闭眼 morph），且 open/closed
    // 的 effective+GPU 权重均观测为 1（非仅 effective=1）。confirmed 由该组合计算，任一缺失即失败。
    const forcedMatchesSelection = JSON.stringify([...(lockControl?.forcedMorphNames || [])].sort()) === JSON.stringify([...(morphProbe.closedEyeMorphs || [])].sort());
    const ow = lockControl?.observedWeights || {};
    const cn = morphProbe.closedEyeMorphs || [];
    const gpuObsOk = cn.length > 0
      && cn.every((mn) => Math.abs((ow.openGpu?.[mn] ?? 0) - 1) < 1e-3)
      && cn.every((mn) => Math.abs((ow.closedGpu?.[mn] ?? 0) - 1) < 1e-3);
    if (!forcedMatchesSelection) fail("G7", "lock control 失败：forcedMorphNames 须等于选择的闭眼 morph（身份一致），实际 forced=" + JSON.stringify(lockControl?.forcedMorphNames) + " selected=" + JSON.stringify(morphProbe.closedEyeMorphs));
    if (!gpuObsOk) fail("G7", "lock control 失败：noIsolation open/closed 的 GPU 权重须均观测为 1，实际 " + JSON.stringify({ openGpu: ow.openGpu, closedGpu: ow.closedGpu }));
    if (lockControl.confirmed !== true) fail("G7", "lock control 失败：confirmed 必须由真实 noIsolation 控制得出（open/closed effective+GPU 均=1 且 forced 身份一致），实际 confirmed=" + lockControl.confirmed + " observed=" + JSON.stringify(ow));
    // 隔离生效硬断言（按各自 morph 集）：open 态全部=0；closed 态闭眼=1、表情=0（以 gpuWeights 证明）。
    const openW = gpuWeights.open ? Object.values(gpuWeights.open) : [];
    if (openW.length && openW.some((w) => Math.abs(w) > 1e-3)) fail("G7", "隔离失败：open 态 effective 权重应为 0，实际 " + JSON.stringify(gpuWeights.open));
    for (const mn of (morphProbe.closedEyeMorphs || [])) { const w = gpuWeights.closed?.[mn]; if (w == null || Math.abs(w - 1) > 1e-3) fail("G7", "隔离失败：closed 态闭眼 morph " + mn + " 应为 1，实际 " + JSON.stringify(gpuWeights.closed)); }
    for (const mn of (morphProbe.expressionMorphs || [])) { const w = gpuWeights.closed?.[mn]; if (w != null && Math.abs(w) > 1e-3) fail("G7", "隔离失败：closed 态表情 morph " + mn + " 应为 0，实际 " + JSON.stringify(gpuWeights.closed)); }
    if (!visibleAll) fail("G7", "整槽消失：某槽在某状态前景像素为 0 " + JSON.stringify(counts));
    if (closedAffected.size === 0) fail("G7", "取证未声明闭眼受影响槽（pmx-morph-forensic 缺失/无匹配 morph）");
    if (exprAffected.size === 0) fail("G7", "取证未声明表情受影响槽（pmx-morph-forensic 缺失/无匹配 morph）");
    if (!closedMoved) fail("G7", "闭眼 Morph 受影响槽未真实移动（逐槽须>该槽噪声上界）" + JSON.stringify({ expected: [...closedAffected], perSlot: closedPerSlot, gpuDiag: morphProbe.gpuDiag }));
    if (!exprMoved) fail("G7", "表情 Morph（笑い）受影响槽未真实移动（逐槽须>该槽噪声上界）" + JSON.stringify({ expected: [...exprAffected], perSlot: exprPerSlot }));
    report.gates.G7.negatives = { wrongName: dist.wrongNameVsOpen, noSwitch: dist.noSwitchVsOpen, wrongNameRejected: negWrongNameRejected, noSwitchRejected: negNoSwitchRejected };
    if (!negWrongNameRejected) fail("G7", "负测失败：错误 Morph 名（不存在）应与开眼一致（<噪声上界），实际 " + JSON.stringify(dist.wrongNameVsOpen));
    if (!negNoSwitchRejected) fail("G7", "负测失败：状态不切换应与开眼一致（<噪声上界），实际 " + JSON.stringify(dist.noSwitchVsOpen));

    // ── P0-1/P1：noIsolation 负测（同轮真实控制）+ captureId 契约 + no-render/stale 自验。
    // 用与健康路径相同的 GPU delta 判据（gpuStats）判定：noIsolation 下 open/closed 两态
    // 生产 update 被 lock 强制同权重（blink=1）→ 受影响槽 GPU delta=0 → rejected=true。
    const noIso = morphProbe.noIsolation || null;
    const noIsoGpu = noIso && !noIso.open?.error && !noIso.closed?.error
      ? Object.fromEntries(slotsArr.map((n) => [n, gpuStats(noIso.open, noIso.closed, n)]))
      : null;
    const noIsoRejected = !!noIsoGpu && evaluateG7Movement(noIsoGpu,[...closedAffected],gpuNoiseUpper,commonValid && evidenceValid('noIsoOpen') && evidenceValid('noIsoClosed')).expectedRejected;
    const noIsoRenderOk = !!(noIso && noIso.open && noIso.closed && !noIso.open.error && !noIso.closed.error);
    report.gates.G7.noIsolationNegative = {
      rejected: noIsoRejected, renderOk: noIsoRenderOk,
      openRequestedWeight: noIso?.openRequestedWeight ?? null,
      openEffectiveWeightAfterLock: noIso?.openEffectiveWeightAfterLock ?? null,
      gpuDelta: noIsoGpu, gpuNoiseUpper,
      captureIds: { open: morphProbe.renderObserved?.noIsoOpen?.captureId ?? null, closed: morphProbe.renderObserved?.noIsoClosed?.captureId ?? null },
    };
    if (!noIsoRejected) fail("G7", "noIsolation 负测未拒绝：无隔离时 lock 应使 open/closed 同权重、受影响槽 GPU delta=0，实际 " + JSON.stringify(report.gates.G7.noIsolationNegative));
    if (!noIsoRenderOk) fail("G7", "noIsolation 控制采集失败（open/closed 需真实 render/capture）" + JSON.stringify({ o: noIso?.open?.error, c: noIso?.closed?.error }));

    // P1-1：统一正式 evidence evaluator（健康/noIsolation/no-render/stale 共用同一函数）。
    // 每态须 renderObserved=true、atomicSameCapture=true（pixel/materialMask/triUV 同一 captureId/帧）、
    // sourceAudit 非空；跨态 captureId 非空互异、frame=120。
    const EVIDENCE_STATES = ["open", "openRepeat", "closed", "expression", "wrongName", "noSwitch", "noIsoOpen", "noIsoClosed"];
    const evidenceOk = (obs) => {
      const list = EVIDENCE_STATES.map((s) => obs?.[s]);
      if (list.some((x) => !x)) return false;
      const ids = list.map((x) => x.captureId ?? null);
      const idsUnique = ids.every((x) => x != null) && new Set(ids).size === ids.length;
      return idsUnique && list.every((x) => x.frame === 120 && x.renderObserved === true && x.atomicSameCapture === true && x.sourceAuditPresent === true);
    };
    const ro = morphProbe.renderObserved || {};
    const roIds = EVIDENCE_STATES.map((s) => ro[s]?.captureId ?? null);
    const roContractOk = evidenceOk(ro);
    report.gates.G7.captureContract = { states: EVIDENCE_STATES, captureIds: roIds, contractOk: roContractOk, renderObserved: ro };
    if (!roContractOk) fail("G7", "capture 契约失败：所有状态须 renderObserved/atomic 同一 captureId/sourceAudit 成立且跨态 captureId 非空互异、frame=120，实际 " + JSON.stringify(report.gates.G7.captureContract));

    // P1-1：同一正式 evidence evaluator 的 no-render（缺 renderObserved）与 stale（重复 captureId）
    // 负向自验，必须 false。自验用例与健康用例同构（7 态全填），只破坏单一变量。
    const healthyStub = Object.fromEntries(EVIDENCE_STATES.map((s, i) => [s, { captureId: "c" + i, frame: 120, renderObserved: true, atomicSameCapture: true, sourceAuditPresent: true }]));
    const selfHealthy = evidenceOk(healthyStub);
    const selfNoRender = evidenceOk({ ...healthyStub, open: { ...healthyStub.open, renderObserved: false } });
    const selfStale = evidenceOk({ ...healthyStub, closed: { ...healthyStub.closed, captureId: healthyStub.open.captureId } });
    report.gates.G7.captureContractSelfTest = { healthy: selfHealthy, noRender: selfNoRender, stale: selfStale };
    if (selfHealthy !== true || selfNoRender !== false || selfStale !== false) fail("G7", "evidence evaluator 自验失败：healthy 必须 true、no-render/stale 必须 false，实际 " + JSON.stringify(report.gates.G7.captureContractSelfTest));

    // P0-3：finally 状态恢复完整（after-restore 快照逐字段等于 before）。
    const restore = morphProbe.restore || null;
    report.gates.G7.restore = restore;
    if (!restore || restore.ok !== true) fail("G7", "状态恢复失败：finally 后 after-restore 须逐字段等于 before（clip/playing/paused/seconds/morph weights），实际 " + JSON.stringify({ restore, saved: morphProbe.saved }));

    if (visibleAll && closedMoved && exprMoved && negWrongNameRejected && negNoSwitchRejected) {
      note("G7", "PASS counts=" + JSON.stringify(counts) + " dist=" + JSON.stringify(dist) + " closedAffected=" + JSON.stringify([...closedAffected]) + " exprAffected=" + JSON.stringify([...exprAffected]));
    }
    // P0-2：相机恢复已并入 morphProbe 的 finally（setCameraSnapshot(saved.camera)），此处不再
    // 单独 cameraOrbit("reset")（原写法不在 finally 内，异常会跳过恢复）。
  }


  // 聚焦权重/相机模式不运行既有材质分析器，避免写入历史固定目录。
  if (!G7_EVIDENCE_ONLY) {
  // P0 整槽消失负测（Stage 2C-M2a 修正轮）：实际运行 missingBrows/missingLashes 扰动，
  // 重采该扰动下的原子画布+mask+triUV，由正式逐槽 analyzer 非零拒绝。
  // 口径（M2a.4 裁定 5）：missing 槽仍在同一 mesh 上被 material-ID pick 栅格化，恒等 tint 下
  // face graph 渲染也与 identity target 一致，前景/收敛不塌缩；唯一可靠判别信号是
  // 「missing 槽是否命中 V1 composite」。采集时把 applied.browsOnComposite/lashesOnComposite
  // 写入 tri-uv JSON（compositeOnBySlot），missing 槽=0、另一槽=1 → analyzer 自然检出并非零拒绝。
  try {
    const { execSync } = await import("node:child_process");
    const runBLAnalyzer = (args) => {
      try {
        const stdout = execSync(["node", "scripts/analyze-reze-k3-v1-diff.mjs", ...args].join(" "), { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, V14D_HAIR_TEX: HAIR_TEX, V14D_HAIR_PMX: HAIR_PMX }, stdio: ["ignore", "pipe", "pipe"] });
        return { exit: 0, stdout };
      } catch (error) { return { exit: Number(error?.status ?? 1), stdout: String(error?.stdout ?? "") }; }
    };
    const readReport = (name) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, name), "utf8")); } catch { return null; } };
    const missingSlotResults = {};
    for (const kind of ["missingBrows", "missingLashes"]) {
      // 复位干净 V1 后注入 missing 扰动。
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
      await page.waitForTimeout(2500);
      await switchToRezeK3();
      await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
      await importDir(IMPORT_DIR);
      await page.click(sel.variantBtn("v1")); await waitRebuilt();
      const applied = await page.evaluate(async (k) => {
        const r = await window.__rezeStageProbe.applyBadSkinGraph(k);
        const c = document.querySelector("canvas").dataset;
        return { ok: r.ok, browsOnComposite: c.v14dSkinVariantBrowsOnComposite, lashesOnComposite: c.v14dSkinVariantLashesOnComposite };
      }, kind);
      await page.waitForTimeout(400);
      await prepareHairCapture();
      const atomic = await captureBrowsLashesAtomic();
      const tag = kind === "missingBrows" ? "missing-brows" : "missing-lashes";
      const canvasFile = saveDataUrl(atomic?.canvasDataUrl, "g3-brows-lashes-v1-canvas-" + tag + ".png");
      if (atomic && !atomic.error && atomic.materialMaskPng) {
        saveDataUrl(atomic.materialMaskPng, "g3-brows-lashes-material-mask-" + tag + ".png");
        fs.writeFileSync(path.join(OUT, "g3-brows-lashes-tri-uv-" + tag + ".json"), JSON.stringify({
          source: atomic.source, width: atomic.width, height: atomic.height,
          materialIdByName: atomic.materialIdByName, byMaterial: atomic.byMaterial,
          // missing 槽仍在同一 mesh 上被 material-ID pick 栅格化（恒等 tint 下渲染仍收敛），
          // 因此把 missing 扰动后的每槽 OnComposite 标记交给 analyzer 作「是否命中 V1 composite」
          // 的判别信号：missing 槽 OnComposite=0、另一槽=1 → 自然检出并拒绝。
          compositeOnBySlot: { brows: Number(applied.browsOnComposite), lashes: Number(applied.lashesOnComposite) },
        }, null, 2));
      }
      const result = runBLAnalyzer(["--brows-lashes", "--neg-missing-slot=" + tag]);
      const rep = readReport("visual-diff-brows-lashes-" + tag + ".json");
      const missingSlot = kind === "missingBrows" ? "brows" : "lashes";
      const otherSlot = kind === "missingBrows" ? "lashes" : "brows";
      const missingGateFalse = rep?.browsLashesFormalGate?.formalTargetGate?.[missingSlot] === false;
      const otherGateTrue = rep?.browsLashesFormalGate?.formalTargetGate?.[otherSlot] === true;
      const rejected = result.exit !== 0 && missingGateFalse && otherGateTrue
        && Array.isArray(rep?.analysisFailures) && rep.analysisFailures.length === 0;
      missingSlotResults[kind] = {
        applied, analyzerExit: result.exit, missingSlot, otherSlot,
        missingSlotForeground: rep?.regions?.[missingSlot]?.targetConvergence?.materialForegroundPixels ?? null,
        otherSlotForeground: rep?.regions?.[otherSlot]?.targetConvergence?.materialForegroundPixels ?? null,
        formalTargetGate: rep?.browsLashesFormalGate?.formalTargetGate ?? null,
        rejected, canvasFile,
      };
    }
    report.gates.G7.missingSlotNegatives = missingSlotResults;
    for (const kind of ["missingBrows", "missingLashes"]) {
      if (!missingSlotResults[kind].rejected) {
        fail("G7", "整槽消失负测失败（" + kind + "）：必须 analyzer exit 非零、消失槽正式 Gate=false、另一槽 Gate=true、analysisFailures=[]；实际 " + JSON.stringify(missingSlotResults[kind]));
      } else note("G7", "整槽消失负测 PASS（" + kind + " 由正式逐槽 analyzer 自然非零拒绝）");
    }
  } catch (e) { fail("G7", "missingSlot 负测 exception: " + (e?.stack || e)); }
  }
} catch (e) { fail("G7", "exception: " + (e?.stack || e)); }

if (!G7_MORPH_ONLY && report.pageErrors.length) fail("G1", "pageErrors: " + report.pageErrors.slice(0, 3).join(" | "));
// 硬阻断：API 失败请求与 HTTP 错误必须进入 Gate 判定（存根环境下应为 0）。
if (!G7_MORPH_ONLY && report.failedReqs.length) fail("G1", "failedRequests=" + report.failedReqs.length + ": " + report.failedReqs.slice(0, 3).map((r) => r.url).join(" | "));
if (!G7_MORPH_ONLY && report.httpBad.length) fail("G1", "httpBad=" + report.httpBad.length + ": " + report.httpBad.slice(0, 3).map((r) => r.status + " " + r.url).join(" | "));
const finalExitCode = Number.isInteger(process.exitCode) ? process.exitCode : 0;
const summary = { allPass: finalExitCode === 0, exitCode: finalExitCode, gates: Object.fromEntries(Object.entries(report.gates).map(([k, v]) => [k, v.status])) };
fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify({ ...report, summary }, null, 2));
console.log("===GATES=== " + JSON.stringify(summary));
console.log(finalExitCode ? "===STAGE-V1-FAIL===" : "===STAGE-V1-OK===");
await context.close();
// 显式在所有报告落盘、浏览器关闭后恢复最终退出码，避免异步清理或调用方
// 未读取 LASTEXITCODE 时把完整验收失败误呈现为成功。
process.exitCode = finalExitCode;
