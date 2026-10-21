// 生产门控回归：默认（无 v14dFaceStatic 开关）打开校准页，断言 faceStatic 未启用、
// 无徽章、无 Face 派生纹理/资产注入请求、无页面错误。不依赖任何仓库内资产：
// 默认入口不传 modelUrl/vmdUrl（仓库不捆绑第三方资产），faceStatic 逻辑应完全旁路。
import { chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.V14D_CAPTURE_ORIGIN || "http://127.0.0.1:3100";
const BASE = ORIGIN + "/mmd-calibration-render";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-face-default-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"] });
const derivedReqs = []; const pageErrors = []; const httpBad = [];
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => pageErrors.push(String((e && e.stack) || e)));
  page.on("request", (r) => { if (/v14d-face-.*state2\.png|__v14dFaceStaticAssets|v14dasset=/i.test(r.url())) derivedReqs.push(r.url()); });
  page.on("response", (r) => { const s = r.status(); if (s >= 400) httpBad.push({ url: r.url(), status: s }); });
  // 默认生产入口：不带 v14dFaceStatic 开关，也不传 modelUrl/vmdUrl（无目标模型）。
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-testid='mmd-calibration-render']", { timeout: 60000 });
  await page.waitForTimeout(6000);
  const result = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const badge = document.querySelector("[data-testid='v14d-face-static-badge']");
    const main = document.querySelector("[data-testid='mmd-calibration-render']");
    return { faceStaticCanvas: (c && c.dataset.v14dFaceStatic) ?? "(unset)", faceStaticMain: (main && main.dataset.v14dFaceStatic) ?? "(unset)", badgePresent: Boolean(badge), assetsInjected: Boolean(window.__v14dFaceStaticAssets), probePresent: Boolean(window.__rezeEngineProbe) };
  });
  const pass = result.faceStaticCanvas === "(unset)" && result.faceStaticMain === "false" && !result.badgePresent && !result.assetsInjected && !result.probePresent && derivedReqs.length === 0 && pageErrors.length === 0;
  console.log(JSON.stringify({ pass, result, derivedReqs, httpBad, pageErrors }, null, 2));
  console.log(pass ? "===DEFAULT-GATING-OK===" : "===DEFAULT-GATING-FAIL===");
  if (!pass) process.exitCode = 1;
} finally { await context.close(); }
