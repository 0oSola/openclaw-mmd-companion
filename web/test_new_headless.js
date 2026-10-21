const { chromium } = require("playwright");

(async () => {
  // Try the new headless mode (Chromium's --headless=new)
  // This mode has better WebGL support than old headless
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--headless=new",
      "--use-angle=gl",
      "--disable-software-rasterizer",
    ],
  });
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

  const info = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const rt = window.__mmdCompanionRuntime;
    
    rt.renderer.render(rt.scene, rt.camera);
    
    const full = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, full);
    let nonZero = 0;
    for (let i = 0; i < full.length; i += 4) {
      if (full[i] || full[i+1] || full[i+2] || full[i+3]) nonZero++;
    }
    
    return {
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      nonZeroPixels: nonZero,
      totalPixels: canvas.width * canvas.height,
    };
  });
  console.log("New headless mode:", JSON.stringify(info, null, 2));

  // Also try page.screenshot
  const fs2 = require("fs");
  await page.screenshot({ path: "test_new_headless.png", fullPage: false });
  console.log("Screenshot:", fs2.statSync("test_new_headless.png").size, "bytes");

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
