import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3110/mmd-calibration-render";
const ASSET = process.env.V14D_ASSET_BASE || "http://127.0.0.1:3220";
const MODEL = `${ASSET}/GirlsFrontline%20KoledaDefault.pmx`;
const VMD = `${ASSET}/koleda-v14d-authoritative-pose-f120.vmd`;
const OUT = path.resolve(process.argv[2] || ".scratch/v14d-color-baseline-capture");
fs.mkdirSync(OUT, { recursive: true });

const query = new URLSearchParams({
  modelUrl: MODEL,
  vmdUrl: VMD,
  v14dColorBaseline: "1",
});

const browserProfile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-color-baseline-chrome-"));
const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];

const context = await chromium.launchPersistentContext(browserProfile, {
  executablePath: CHROME_EXE,
  headless: false,
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
});

try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.stack || error));
  });
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || "unknown",
    });
  });

  const url = `${BASE}?${query.toString()}`;
  console.log(`[capture] goto ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-testid='mmd-calibration-render']", { timeout: 60000 });
  await page.waitForSelector("canvas[data-v14d-color-baseline='true']", { timeout: 120000 });
  await page.waitForSelector("[data-webgpu-status='ready']", { timeout: 120000 });
  await page.waitForTimeout(1500);

  const before = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const root = document.querySelector("[data-testid='mmd-calibration-render']");
    return {
      root: root
        ? {
            baseline: root.getAttribute("data-v14d-color-baseline"),
            size: root.getAttribute("data-v14d-color-baseline-size"),
            frame: root.getAttribute("data-v14d-color-baseline-frame"),
            seconds: root.getAttribute("data-v14d-color-baseline-seconds"),
            lighting: root.getAttribute("data-v14d-color-baseline-lighting"),
          }
        : null,
      canvas: canvas
        ? {
            width: canvas.width,
            height: canvas.height,
            status: canvas.dataset.webgpuStatus || null,
            detail: canvas.dataset.webgpuDetail || null,
            vmdIkPolicy: canvas.dataset.vmdIkPolicy || null,
            vmdIkEnabled: canvas.dataset.vmdIkEnabled || null,
            unlitDiagnostic: canvas.dataset.v14dUnlitDiagnostic || null,
            unlitGraph: canvas.dataset.v14dUnlitGraph || null,
            unlitGroups: canvas.dataset.v14dUnlitGroups || null,
            scenePreset: canvas.dataset.scenePreset || null,
          }
        : null,
    };
  });

  console.log("[capture] invoking window.__v14dColorBaseline.capture()");
  const result = await page.evaluate(async () => {
    if (!window.__v14dColorBaseline) {
      throw new Error("window.__v14dColorBaseline 未初始化。");
    }
    return await window.__v14dColorBaseline.capture();
  });

  const after = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas
      ? {
          width: canvas.width,
          height: canvas.height,
          status: canvas.dataset.webgpuStatus || null,
          detail: canvas.dataset.webgpuDetail || null,
          baselineStatus: canvas.dataset.v14dColorBaselineStatus || null,
          baselineScene: canvas.dataset.v14dColorBaselineScene || null,
          roiReadback: canvas.dataset.v14dColorBaselineRoiReadback || null,
          linearHdrReadback: canvas.dataset.v14dColorBaselineLinearHdrReadback || null,
          finalDisplayReadback: canvas.dataset.v14dColorBaselineFinalDisplayReadback || null,
          materialMaskReadback: canvas.dataset.v14dColorBaselineMaterialMaskReadback || null,
          materialMaskSource: canvas.dataset.v14dColorBaselineMaterialMaskSource || null,
          materialMaskSourceFormat: canvas.dataset.v14dColorBaselineMaterialMaskSourceFormat || null,
          firstDivergence: canvas.dataset.v14dColorBaselineFirstDivergence || null,
          vmdLoaded: canvas.dataset.v14dColorBaselineVmdLoaded || null,
          renderLoopStopped: canvas.dataset.v14dColorBaselineRenderLoopStopped || null,
          baseColorSource: canvas.dataset.v14dColorBaselineBaseColorSource || null,
          linearHdrSource: canvas.dataset.v14dColorBaselineLinearHdrSource || null,
          hdrSourceFormat: canvas.dataset.v14dColorBaselineHdrSourceFormat || null,
          maskSourceFormat: canvas.dataset.v14dColorBaselineMaskSourceFormat || null,
          animationName: canvas.dataset.v14dColorBaselineAnimationName || null,
          animationCurrentSeconds: canvas.dataset.v14dColorBaselineAnimationCurrentSeconds || null,
          animationDurationSeconds: canvas.dataset.v14dColorBaselineAnimationDurationSeconds || null,
          animationCurrentFrame: canvas.dataset.v14dColorBaselineAnimationCurrentFrame || null,
          animationPlaying: canvas.dataset.v14dColorBaselineAnimationPlaying || null,
          animationPaused: canvas.dataset.v14dColorBaselineAnimationPaused || null,
          animationFrame120Verified:
            canvas.dataset.v14dColorBaselineAnimationFrame120Verified || null,
          animationRenderFrameStable:
            canvas.dataset.v14dColorBaselineAnimationRenderFrameStable || null,
          unlitDiagnostic: canvas.dataset.v14dUnlitDiagnostic || null,
          unlitGraph: canvas.dataset.v14dUnlitGraph || null,
          unlitGroups: canvas.dataset.v14dUnlitGroups || null,
          unlitUnknownMaterials: canvas.dataset.v14dUnlitUnknownMaterials || null,
        }
      : null;
  });

  const screenshotPath = path.join(OUT, "white-light-frame120-final-display.png");
  await page.screenshot({ path: screenshotPath });

  const artifact = {
    capturedAt: new Date().toISOString(),
    browser: {
      executablePath: CHROME_EXE,
      headless: false,
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      args: ["--enable-unsafe-webgpu"],
    },
    url,
    source: { modelUrl: MODEL, vmdUrl: VMD },
    before,
    result,
    after,
    screenshot: screenshotPath,
    consoleMessages,
    pageErrors,
    failedRequests,
  };
  const jsonPath = path.join(OUT, "white-light-frame120-diagnostic.json");
  fs.writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf8");
  console.log(`[capture] screenshot ${screenshotPath}`);
  console.log(`[capture] diagnostic ${jsonPath}`);
  console.log(JSON.stringify({ result, before, after }, null, 2));
} finally {
  await context.close();
  fs.rmSync(browserProfile, { recursive: true, force: true });
}
