const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  // Last attempt: use headless "new" mode with GPU + page screenshot
  // Playwright 1.58 supports headless: "new" 
  let browser;
  try {
    browser = await chromium.launch({
      headless: "new",
      args: [
        "--use-angle=gl",
        "--enable-gpu-rasterization", 
        "--enable-features=Vulkan",
      ],
    });
  } catch(e) {
    console.log("headless new not supported, falling back");
    browser = await chromium.launch({
      headless: true,
      args: ["--use-angle=gl", "--enable-gpu-rasterization"],
    });
  }
  
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  
  try {
    await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  } catch(e) {
    console.log("Load timeout");
    await browser.close();
    return;
  }
  await page.waitForTimeout(3000);

  // Try the 2D canvas drawImage approach - sometimes works with GPU
  const result = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const srcCanvas = document.querySelector("canvas");
    
    // Force render
    rt.renderer.render(rt.scene, rt.camera);
    
    // Create 2D canvas and draw
    const dst = document.createElement("canvas");
    dst.width = srcCanvas.width;
    dst.height = srcCanvas.height;
    const ctx = dst.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0);
    
    // Check pixels on the 2D canvas
    const imgData = ctx.getImageData(0, 0, dst.width, dst.height);
    let nonZero = 0;
    for (let i = 0; i < imgData.data.length; i += 4) {
      if (imgData.data[i] || imgData.data[i+1] || imgData.data[i+2] || imgData.data[i+3]) nonZero++;
    }
    
    return {
      nonZeroPixels: nonZero,
      totalPixels: dst.width * dst.height,
      dataUrl: dst.toDataURL("image/png").substring(0, 50),
    };
  });
  console.log("2D canvas result:", JSON.stringify(result, null, 2));

  // Also try page screenshot
  await page.screenshot({ path: "test_gpu_page.png", fullPage: false });
  console.log("Page screenshot:", fs.statSync("test_gpu_page.png").size, "bytes");

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
