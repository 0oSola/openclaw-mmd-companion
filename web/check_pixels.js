const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", m => {
    const t = m.text();
    if (/render|webgl|context|lost/i.test(t)) console.log(m.type(), t);
  });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  console.log("Model loaded");

  // Check if the canvas is actually being drawn to
  const drawInfo = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { error: "no canvas" };
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { error: "no gl" };
    
    // Read a broader area
    const w = canvas.width;
    const h = canvas.height;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    
    // Count non-zero pixels
    let nonZero = 0;
    let sample = [];
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 0 || pixels[i+1] > 0 || pixels[i+2] > 0 || pixels[i+3] > 0) {
        nonZero++;
        if (sample.length < 5) sample.push([pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]]);
      }
    }
    return {
      totalPixels: w * h,
      nonZeroPixels: nonZero,
      sample: sample,
      isContextLost: gl.isContextLost(),
    };
  });
  console.log("Draw info:", JSON.stringify(drawInfo, null, 2));

  // Try: force render and check again
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (rt.renderScene) rt.renderScene();
    if (rt.renderer) rt.renderer.render(rt.scene, rt.camera);
  });
  await page.waitForTimeout(500);
  
  const drawInfo2 = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const w = canvas.width;
    const h = canvas.height;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonZero = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 0 || pixels[i+1] > 0 || pixels[i+2] > 0 || pixels[i+3] > 0) nonZero++;
    }
    return { nonZeroPixels: nonZero, totalPixels: w * h, isContextLost: gl.isContextLost() };
  });
  console.log("After force render:", JSON.stringify(drawInfo2, null, 2));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
