const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  // Navigate to calibration render page - same as old script
  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = "http://127.0.0.1:3100/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  console.log("Loading...");
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  
  // Wait for model
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model && !window.__mmdCompanionRuntime.isLoadingVmd), null, { timeout: 60000 });
  console.log("Model loaded");
  
  // Set calibration mode
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  
  // Load VMD
  const vmdUrl = webUrl + "/twist-tests/twist_r_wrist_xp90.vmd";
  const played = await page.evaluate(async (url) => {
    const rt = window.__mmdCompanionRuntime;
    const result = await rt?.playVmd?.(url, 1, [], { disableCrossfade: true });
    return result !== false;
  }, vmdUrl);
  console.log("VMD played:", played);
  
  // Wait for VMD to load
  await page.waitForFunction(() => !window.__mmdCompanionRuntime?.isLoadingVmd, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  
  // Seek to frame 10
  const ok = await page.evaluate(() => window.__mmdCompanionRuntime?.seekVmdFrame?.(10, 30) === true);
  console.log("Seek ok:", ok);
  await page.waitForTimeout(200);
  
  // Take page screenshot (like old script)
  await page.screenshot({ path: "test_page.png", fullPage: false });
  console.log("Page screenshot:", fs.statSync("test_page.png").size, "bytes");
  
  // Take canvas screenshot  
  await page.locator("canvas").first().screenshot({ path: "test_canvas.png" });
  console.log("Canvas screenshot:", fs.statSync("test_canvas.png").size, "bytes");
  
  // Check pixel content
  const pixel = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return "no canvas";
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return "no gl";
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2], px[3]];
  });
  console.log("Center pixel:", JSON.stringify(pixel));
  
  // Check canvas dimensions
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return c ? { w: c.width, h: c.height, style: c.style.cssText.substring(0, 100) } : null;
  });
  console.log("Canvas:", JSON.stringify(canvasInfo));
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
