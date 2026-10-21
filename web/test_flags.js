const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  // Check: maybe the issue is that SwiftShader needs --use-gl=angle not --use-gl=swiftshader
  // Or maybe we need --enable-unsafe-swiftshader
  
  // Try with specific flags
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--enable-features=Vulkan,UseSkiaRenderer",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  
  let loaded = false;
  try {
    await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
    loaded = true;
  } catch(e) {
    console.log("Model load timeout");
  }
  
  if (loaded) {
    await page.waitForTimeout(3000);
    
    // Render and check
    const pixel = await page.evaluate(() => {
      const rt = window.__mmdCompanionRuntime;
      const canvas = document.querySelector("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      
      rt.renderer.render(rt.scene, rt.camera);
      
      const px = new Uint8Array(4);
      gl.readPixels(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2], px[3]];
    });
    console.log("Center pixel with flags:", JSON.stringify(pixel));
    
    // If still 0, check GL renderer info
    const glInfo = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        version: gl.getParameter(gl.VERSION),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      };
    });
    console.log("GL info:", JSON.stringify(glInfo));
  }

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
