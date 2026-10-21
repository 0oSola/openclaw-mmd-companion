const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", m => {
    const t = m.text();
    if (!/skinning|morphTargets|envMap|combine|GPU stall|404|ERR_NETWORK|React DevTools/.test(t)) {
      console.log(m.type(), t);
    }
  });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const restVmd = webUrl + "/twist-tests/twist_rest.vmd";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin&vmdUrl=" + encodeURIComponent(restVmd);
  
  console.log("Loading...");
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (rt.setCalibrationCaptureMode) rt.setCalibrationCaptureMode(true);
  });
  await page.waitForTimeout(2000);
  console.log("Ready");

  // Set camera to front view
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (rt.camera) {
      rt.camera.position.set(0, 8, 30);
      rt.camera.lookAt(0, 5, 0);
    }
  });
  await page.waitForTimeout(500);

  // Take rest screenshot
  await page.screenshot({ path: "cmp_rest.png", type: "png" });
  console.log("Rest:", fs.statSync("cmp_rest.png").size, "bytes");

  // Load xp90
  const xp90Vmd = webUrl + "/twist-tests/twist_r_wrist_xp90.vmd";
  await page.evaluate(async (url) => {
    const rt = window.__mmdCompanionRuntime;
    await rt.playVmd(url);
    let w = 0;
    while (rt.isLoadingVmd && w < 5000) { await new Promise(r => setTimeout(r, 100)); w += 100; }
  }, xp90Vmd);
  await page.waitForTimeout(500);

  // Seek to frame 10
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    rt.seekVmdFrame(10, 30);
  });
  
  // Wait for render loop to pick up the change
  // The render loop runs via requestAnimationFrame, so we need to wait a few frames
  await page.waitForTimeout(500);

  // Force a render
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (typeof rt.renderScene === "function") rt.renderScene();
    if (typeof rt.renderFrame === "function") rt.renderFrame();
  });
  await page.waitForTimeout(200);

  // Take screenshot
  await page.screenshot({ path: "cmp_xp90.png", type: "png" });
  console.log("xp90:", fs.statSync("cmp_xp90.png").size, "bytes");

  // Check: is the render loop actually running?
  const loopInfo = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    return {
      destroyed: rt.destroyed,
      hasRenderer: !!rt.renderer,
      hasScene: !!rt.scene,
      hasCamera: !!rt.camera,
      calibrationCaptureMode: rt.calibrationCaptureMode,
      // Check if clock is running
      clockRunning: rt.clock ? (typeof rt.clock.getElapsedTime === "function" ? rt.clock.getElapsedTime() : null) : null,
      // Check if there's a render loop
      hasStartRenderLoop: typeof rt.startRenderLoop === "function",
      // Check composer
      hasComposer: !!rt.composer,
    };
  });
  console.log("Loop info:", JSON.stringify(loopInfo));

  // Try: take screenshot via canvas toDataURL to compare actual rendered pixels
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { error: "no canvas" };
    return { width: canvas.width, height: canvas.height, hasWebGL: !!canvas.getContext("webgl2") || !!canvas.getContext("webgl") };
  });
  console.log("Canvas:", JSON.stringify(canvasInfo));

  // Try: take element screenshot of just the canvas
  const canvas = await page.$("canvas");
  if (canvas) {
    await canvas.screenshot({ path: "cmp_canvas_rest.png", type: "png" });
    console.log("Canvas element screenshot:", fs.statSync("cmp_canvas_rest.png").size, "bytes");
  } else {
    console.log("No canvas element found");
    // Maybe the canvas is inside a specific container
    const html = await page.evaluate(() => document.querySelector("#__next canvas") ? "found in __next" : (document.querySelector("[data-mmd-stage] canvas") ? "found in stage" : "not found"));
    console.log("Canvas search:", html);
  }

  // Check: maybe screenshots are the same because the page is showing a loading state or blank
  // Let's check pixel data
  const pixelCheck = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { error: "no canvas" };
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { error: "no gl context" };
    // Read a single pixel from center
    const px = new Uint8Array(4);
    const w = canvas.width;
    const h = canvas.height;
    gl.readPixels(Math.floor(w/2), Math.floor(h/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { center: [px[0], px[1], px[2], px[3]] };
  });
  console.log("Center pixel:", JSON.stringify(pixelCheck));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
