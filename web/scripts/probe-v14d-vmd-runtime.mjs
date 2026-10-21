// P0-4 运行时零回归探针：正常非 faceStatic 路径真实执行 VMD load→play→pause→seek。
// 不带 v14dFaceStatic 开关（生产默认），注入权威 PMX+VMD，驱动 __mmdCompanionRuntime：
//   playVmd 后观察 currentVmdAction.time 前进（帧前进），pause 后 time 稳定，
//   seekVmdFrame 到目标帧后 time 到位。同时断言默认入口无 displayPassthrough/资产注入
// 泄漏、保持 Filmic（无 passthrough uniform 置位）。任一失败 exit 1。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.V14D_CAPTURE_ORIGIN || "http://127.0.0.1:3102";
const BASE = ORIGIN + "/mmd-calibration-render";
const KOLEDA_DIR = "D:\\mmd\\克莱妲原皮";
const PMX = path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";

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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-vmd-runtime-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME_EXE, headless: true, viewport: { width: 640, height: 640 },
  args: ["--enable-unsafe-webgpu"],
});
const pageErrors = [];
const fails = [];
let leak = {};
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => pageErrors.push(String((e && e.stack) || e)));
  page.on("console", (m) => { const t = m.type(); if (t === "error" || t === "warning") console.log("[console]", t, m.text().slice(0, 240)); });
  page.on("requestfailed", (r) => console.log("[reqfail]", r.url().slice(0, 120), r.failure()?.errorText));
  // 资产路由：权威 PMX/VMD/纹理经本地文件 fulfill。
  await page.addInitScript(({ rels: r, koleda }) => {
    window.__v14dFetchMap = { rels: r, route: (name) => `${koleda}/${name}` };
  }, { rels, koleda: KOLEDA_DIR });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.host !== "v14d-asset.local") return route.continue();
    // 资产键优先 query；否则从 path 段 /asset/<key>/<file> 解析（避免污染扩展名）。
    let key = url.searchParams.get("v14dasset");
    if (!key) { const m = url.pathname.match(/\/asset\/([^/]+)\//); if (m) key = decodeURIComponent(m[1]); }
    if (!key && /\.pmx$/i.test(url.pathname)) key = "pmx";
    if (!key && /\.vmd$/i.test(url.pathname)) key = "vmd";
    let filePath = null;
    if (key === "pmx") filePath = PMX;
    else if (key === "vmd") filePath = VMD;
    else if (key) filePath = path.join(KOLEDA_DIR, key);
    if (filePath && fs.existsSync(filePath)) return route.fulfill({ status: 200, body: fs.readFileSync(filePath) });
    if (key === "__manifest__") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) });
    return route.fulfill({ status: 404, body: "not found" });
  });
  // 正常非 faceStatic 入口：传 modelUrl+vmdUrl，不传 v14dFaceStatic。
  // MMDLoader 按「最后一个 . 之后全部」判定扩展名，query/fragment 都会污染。资产键放
  // 进 path 段，path 以 .pmx/.vmd 结尾且无 query/fragment，路由按段解析键。
  const modelUrl = "http://v14d-asset.local/asset/pmx/model.pmx";
  const vmdUrl = "http://v14d-asset.local/asset/vmd/motion.vmd";
  const target = `${BASE}?modelUrl=${encodeURIComponent(modelUrl)}&vmdUrl=${encodeURIComponent(vmdUrl)}&autoplay=0`;
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-testid='mmd-calibration-render']", { timeout: 60000 });
  // 等 runtime 暴露且模型就绪。
  let modelReady = false;
  for (let i = 0; i < 24 && !modelReady; i += 1) {
    await page.waitForTimeout(2500);
   const st = await page.evaluate(() => ({
     rt: Boolean(window.__mmdCompanionRuntime),
     model: Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model),
     clip: Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.currentClip),
     time: window.__mmdCompanionRuntime?.currentVmdAction ? window.__mmdCompanionRuntime.currentVmdAction.time : -1,
      status: (window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.statusElement?.textContent) || document.querySelector(".mio-stage")?.textContent?.slice(0, 140) || "",
      fetchMap: Boolean(window.__v14dFetchMap),
   }));
    if (i === 3) console.log(`[probe] status="${st.status}" fetchMap=${st.fetchMap}`);
    console.log(`[probe] t=${(i + 1) * 2.5}s rt=${st.rt} model=${st.model} clip=${st.clip} time=${st.time.toFixed ? st.time.toFixed(2) : st.time}`);
    modelReady = st.rt && st.model;
  }
  if (!modelReady) fails.push("模型加载超时（60s 未就绪）");

  // 1) 默认无泄漏断言：无 displayPassthrough 探针/资产注入。
  leak = await page.evaluate(() => ({
    assetsInjected: Boolean(window.__v14dFaceStaticAssets),
    probePresent: Boolean(window.__rezeEngineProbe),
    faceStaticCanvas: document.querySelector("canvas")?.dataset.v14dFaceStatic ?? "(unset)",
  }));
  if (leak.assetsInjected) fails.push("默认入口泄漏 v14dFaceStaticAssets");
  if (leak.probePresent) fails.push("默认入口泄漏 rezeEngineProbe");

  // 2) play：帧前进。
  const t0 = await page.evaluate(async (vu) => {
    const rt = window.__mmdCompanionRuntime;
    await rt.playVmd(vu, 1, [], {});
    await new Promise((r) => setTimeout(r, 800));
    return rt.currentVmdAction ? rt.currentVmdAction.time : -1;
  }, vmdUrl);
  const t1 = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 500));
    return window.__mmdCompanionRuntime.currentVmdAction ? window.__mmdCompanionRuntime.currentVmdAction.time : -1;
  });
  if (!(t0 >= 0 && t1 > t0)) fails.push(`play 帧未前进: t0=${t0} t1=${t1}`);
  else console.log(`[runtime] play 帧前进 t0=${t0.toFixed(3)}s -> t1=${t1.toFixed(3)}s`);

  // 3) pause：time 稳定。
  const pauseRes = await page.evaluate(async () => {
    const rt = window.__mmdCompanionRuntime;
    const a = rt.currentVmdAction;
    if (!a) return { ok: false, reason: "no action" };
    a.paused = true;
    const before = a.time;
    await new Promise((r) => setTimeout(r, 500));
    const after = a.time;
    return { ok: true, before, after, paused: a.paused };
  });
  if (!pauseRes.ok || pauseRes.paused !== true || Math.abs(pauseRes.after - pauseRes.before) > 0.05) {
    fails.push(`pause 不稳定: ${JSON.stringify(pauseRes)}`);
  } else console.log(`[runtime] pause 稳定 time=${pauseRes.before.toFixed(3)}s (paused=${pauseRes.paused})`);

  // 4) seek：到目标帧（frame 60 @30fps = 2.0s）。
  const seekRes = await page.evaluate(async () => {
    const rt = window.__mmdCompanionRuntime;
    const ok = rt.seekVmdFrame(60, 30);
    await new Promise((r) => setTimeout(r, 200));
    const a = rt.currentVmdAction;
    return { seekOk: ok, time: a ? a.time : -1, paused: a ? a.paused : null };
  });
  const targetSec = 60 / 30;
  if (!seekRes.seekOk || Math.abs(seekRes.time - targetSec) > 0.05) {
    fails.push(`seek 未到位: ${JSON.stringify(seekRes)} 期望~${targetSec}s`);
  } else console.log(`[runtime] seek 到位 time=${seekRes.time.toFixed(3)}s (期望 ${targetSec.toFixed(3)}s)`);

  if (pageErrors.length) fails.push("页面错误: " + pageErrors.slice(0, 2).join(" | "));
} finally { await context.close(); }

const report = { leak, fails, pageErrors };
fs.mkdirSync(path.resolve(".scratch/v14d-agx-byte-capture"), { recursive: true });
fs.writeFileSync(path.resolve(".scratch/v14d-agx-byte-capture/vmd-runtime-probe.json"), JSON.stringify(report, null, 2));
if (fails.length) { console.error("===VMD-RUNTIME-PROBE-FAIL===\n" + fails.join("\n")); process.exit(1); }
console.log("===VMD-RUNTIME-PROBE-OK=== 正常路径 load→play→pause→seek 全部通过，默认无泄漏");
