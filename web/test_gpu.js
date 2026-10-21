const { chromium } = require("playwright");

(async () => {
  // Try using real GPU instead of SwiftShader
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-angle=gl",
      "--enable-features=Vulkan",
      "--disable-software-rasterizer",
      "--enable-gpu-rasterization",
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
    
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    
    // Count non-zero
    const full = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, full);
    let nonZero = 0;
    for (let i = 0; i < full.length; i += 4) {
      if (full[i] || full[i+1] || full[i+2] || full[i+3]) nonZero++;
    }
    
    return {
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      centerPixel: [px[0], px[1], px[2], px[3]],
      nonZeroPixels: nonZero,
      totalPixels: canvas.width * canvas.height,
    };
  });
  console.log("GPU render:", JSON.stringify(info, null, 2));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
