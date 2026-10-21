const { chromium } = require("playwright");
const fs = require("fs");
const crypto = require("crypto");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(2000);

  // Wait for the render loop to run at least once
  await page.waitForTimeout(2000);

  // Capture toDataURL WITHOUT forcing render - just grab what the render loop drew
  const dataUrl1 = await page.evaluate(() => {
    return document.querySelector("canvas").toDataURL("image/png");
  });
  const buf1 = Buffer.from(dataUrl1.replace(/^data:image\/png;base64,/, ""), "base64");
  fs.writeFileSync("D:/workspace/MMD project/web/capture_loop.png", buf1);
  console.log("From render loop:", buf1.length, "bytes");

  // Now manually render and capture
  const dataUrl2 = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    rt.renderer.render(rt.scene, rt.camera);
    return document.querySelector("canvas").toDataURL("image/png");
  });
  const buf2 = Buffer.from(dataUrl2.replace(/^data:image\/png;base64,/, ""), "base64");
  fs.writeFileSync("D:/workspace/MMD project/web/capture_manual.png", buf2);
  console.log("From manual render:", buf2.length, "bytes");

  // Check if they're different
  const md5_1 = crypto.createHash("md5").update(buf1).digest("hex");
  const md5_2 = crypto.createHash("md5").update(buf2).digest("hex");
  console.log("Loop MD5:", md5_1);
  console.log("Manual MD5:", md5_2);
  console.log("Different:", md5_1 !== md5_2);

  // Now: the KEY test - create a new renderer with preserveDrawingBuffer:true
  // and render the same scene
  const dataUrl3 = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const THREE = window.__mmdCompanionRuntime; // three.js is bundled, can't access directly
    
    // Try: use the existing renderer but set preserveDrawingBuffer before creating context
    // Actually we can't change it after creation.
    // But we can try: render to the canvas, then use createImageBitmap or drawImage
    
    // Alternative: draw the WebGL canvas onto a 2D canvas
    const srcCanvas = document.querySelector("canvas");
    const dstCanvas = document.createElement("canvas");
    dstCanvas.width = srcCanvas.width;
    dstCanvas.height = srcCanvas.height;
    const ctx = dstCanvas.getContext("2d");
    
    // Draw WebGL canvas onto 2D canvas
    ctx.drawImage(srcCanvas, 0, 0);
    
    return dstCanvas.toDataURL("image/png");
  });
  const buf3 = Buffer.from(dataUrl3.replace(/^data:image\/png;base64,/, ""), "base64");
  fs.writeFileSync("D:/workspace/MMD project/web/capture_2d.png", buf3);
  console.log("From 2D drawImage:", buf3.length, "bytes");
  
  const md5_3 = crypto.createHash("md5").update(buf3).digest("hex");
  console.log("2D MD5:", md5_3);
  console.log("Same as loop:", md5_3 === md5_1);

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
