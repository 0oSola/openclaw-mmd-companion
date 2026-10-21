// 用户路径复验：真实操作文件选择器（setInputFiles），非 addInitScript 注入。
// 选资产 -> 点加载 -> 逐模式点按钮 -> 截图 + 硬断言。任一失败 exit 1。
import { chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3100/mmd-calibration-render";
const OUT = path.resolve(".scratch/v14d-face-static/user-path");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const DERIVED_DIR = process.env.V14D_DERIVED_DIR || "C:\\w\\rk3-face-v14d\\.scratch\\v14d-face-static-derived";
const COMPOSITE = path.join(DERIVED_DIR, "v14d-face-composite-state2.png");
const ATTEN = path.join(DERIVED_DIR, "v14d-face-shadow-attenuation-state2.png");
// State2 实时合成的权威 mask（Node 常量公式所需的 packed mask）。
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
fs.mkdirSync(OUT, { recursive: true });
const MIN_FACE_SAMPLES = 1000;
const fail = (msg) => { console.error("ASSERT-FAIL: " + msg); process.exitCode = 1; };
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-userpath-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 760, height: 860 }, deviceScaleFactor: 1, args: ["--enable-unsafe-webgpu"] });
const pageErrors = []; const httpBad = []; const failedReqs = [];
const report = { modes: {}, pageErrors, httpBad, failedReqs };
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e)));
  page.on("requestfailed", (r) => failedReqs.push({ url: r.url(), err: r.failure()?.errorText || "unknown" }));
  page.on("response", (r) => { const s = r.status(); if (s >= 400) httpBad.push({ url: r.url(), status: s }); });
  await page.goto(BASE + "?v14dFaceStatic=1&v14dFaceMode=normal", { waitUntil: "domcontentloaded", timeout: 60000 });
  // 资产面板应出现（提示选择本地资产）
  await page.waitForSelector("[data-testid='v14d-face-static-asset-panel']", { timeout: 15000 });
  // 真实文件选择
  await page.setInputFiles("[data-testid='v14d-face-dir-input']", KOLEDA_DIR);
  await page.setInputFiles("[data-testid='v14d-face-vmd-input']", VMD);
  await page.setInputFiles("[data-testid='v14d-face-state2-mask-input']", STATE2_MASK);
  await page.click("[data-testid='v14d-face-load']");
  // 加载后面板消失，canvas ready
  await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
  await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 60000 });
  for (const mode of ["normal", "faceShadowOnly", "finalFaceComposite"]) {
    await page.click(`[data-testid='v14d-face-mode-${mode}']`);
    await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
    await page.waitForFunction((m) => document.querySelector("canvas")?.dataset.v14dFaceStaticMode === m, mode, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      return { mode: c?.dataset.v14dFaceStaticMode || "", frame: c?.dataset.v14dFaceStaticFrame || "", state: c?.dataset.v14dFaceStaticState || "", blend: c?.dataset.v14dFaceStaticBlend || "", locked: c?.dataset.v14dFaceStaticCameraLocked || "", paused: c?.dataset.v14dFaceStaticPaused || "", faceApplied: c?.dataset.v14dFaceStaticFaceApplied || "" };
    });
    const roi = await page.evaluate(async () => { const api = window.__v14dFaceStatic; if (!api) return { error: "no api" }; return api.capture(); });
    const png = path.join(OUT, `userpath-${mode}.png`);
    await page.screenshot({ path: png });
    report.modes[mode] = { state, faceSamples: roi?.roi?.faceSamples ?? 0, meanLinear: roi?.meanLinear ?? null, roiError: roi?.error || null, png };
    console.log(`[userpath] ${mode} faceSamples=${report.modes[mode].faceSamples} faceApplied=${state.faceApplied} meanLinear=${JSON.stringify(report.modes[mode].meanLinear)}`);
    if (state.mode !== mode) fail(`mode mismatch: ${state.mode} != ${mode}`);
    if (state.frame !== "120" || state.state !== "2" || state.blend !== "0.00") fail(`badge state wrong: ${JSON.stringify(state)}`);
    if (state.locked !== "true" || state.paused !== "true") fail(`not locked/paused: ${JSON.stringify(state)}`);
    if (state.faceApplied !== "true") fail(`face not applied in ${mode}: ${state.faceApplied}`);
    if ((report.modes[mode].faceSamples ?? 0) < MIN_FACE_SAMPLES) fail(`faceSamples too low in ${mode}: ${report.modes[mode].faceSamples}`);
  }
  if (pageErrors.length) fail("pageErrors: " + pageErrors.join(" | "));
  if (httpBad.length) fail("httpBad: " + JSON.stringify(httpBad));
  if (failedReqs.length) fail("failedRequests: " + JSON.stringify(failedReqs));
} catch (e) {
  fail("exception: " + (e?.stack || e));
} finally {
  fs.writeFileSync(path.join(OUT, "userpath-report.json"), JSON.stringify(report, null, 2));
  await context.close();
}
console.log(process.exitCode ? "===USER-PATH-FAIL===" : "===USER-PATH-OK===");
