const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  // Try the OTHER dev server on port 6600 (vite)
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  // First check what's on 6600
  console.log("Checking port 6600...");
  const resp = await page.goto("http://127.0.0.1:6600/", { waitUntil: "domcontentloaded", timeout: 10000 }).catch(e => {
    console.log("6600 failed:", e.message.substring(0, 100));
    return null;
  });
  if (resp) {
    console.log("6600 status:", resp.status());
    const title = await page.title();
    console.log("6600 title:", title);
  }

  // Try calibration render on 3100 (the normal one)
  console.log("\nChecking port 3100...");
  const modelUrl = "http://127.0.0.1:3100/twist-tests/model/eula.pmx";
  const renderUrl = "http://127.0.0.1:3100/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  console.log("Model loaded on 3100");
  
  // Check WebGL context info
  const glInfo = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { error: "no canvas" };
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { error: "no gl" };
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    };
  });
  console.log("WebGL info:", JSON.stringify(glInfo, null, 2));
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
