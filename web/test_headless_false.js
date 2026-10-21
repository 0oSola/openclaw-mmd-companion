const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    args: ["--start-minimized"]
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  console.log("Loading...");
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model && !window.__mmdCompanionRuntime.isLoadingVmd), null, { timeout: 60000 });
  console.log("Model loaded");
  
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  
  const vmdUrl = webUrl + "/twist-tests/twist_r_wrist_xp90.vmd";
  await page.evaluate(async (url) => {
    const rt = window.__mmdCompanionRuntime;
    await rt?.playVmd?.(url, 1, [], { disableCrossfade: true });
  }, vmdUrl);
  await page.waitForFunction(() => !window.__mmdCompanionRuntime?.isLoadingVmd, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  
  await page.evaluate(() => window.__mmdCompanionRuntime?.seekVmdFrame?.(10, 30));
  await page.waitForTimeout(500);
  
  await page.screenshot({ path: "test_headless_false.png", fullPage: false });
  console.log("Screenshot:", fs.statSync("test_headless_false.png").size, "bytes");
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
