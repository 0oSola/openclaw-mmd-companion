import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3100/mmd-calibration-render";
const ASSET = process.env.V14D_ASSET_BASE || "http://127.0.0.1:3220";
const MODEL = ASSET + "/GirlsFrontline%20KoledaDefault.pmx";
const VMD = ASSET + "/koleda-v14d-authoritative-pose-f120.vmd";

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-face-default-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME_EXE, headless: false, viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
});
const faceRedirects = [];
const pageErrors = [];
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => pageErrors.push(String((e && e.stack) || e)));
  page.on("request", (r) => { if (/v14d-face-.*state2\.png/i.test(r.url())) faceRedirects.push(r.url()); });
  const query = new URLSearchParams({ modelUrl: MODEL, vmdUrl: VMD });
  await page.goto(BASE + "?" + query.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-webgpu-status='ready']", { timeout: 120000 });
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const badge = document.querySelector("[data-testid='v14d-face-static-badge']");
    const main = document.querySelector("[data-testid='mmd-calibration-render']");
    return {
      webgpuStatus: (c && c.dataset.webgpuStatus) || "",
      faceStaticCanvas: (c && c.dataset.v14dFaceStatic) ?? "(unset)",
      faceStaticMain: (main && main.dataset.v14dFaceStatic) ?? "(unset)",
      badgePresent: Boolean(badge),
    };
  });
  const pass = result.faceStaticCanvas === "(unset)" && result.faceStaticMain === "false"
    && !result.badgePresent && faceRedirects.length === 0 && pageErrors.length === 0;
  console.log(JSON.stringify({ pass, result, faceRedirects, pageErrors }, null, 2));
  console.log(pass ? "===DEFAULT-PRODUCTION-OK===" : "===DEFAULT-PRODUCTION-FAIL===");
} finally { await context.close(); }
