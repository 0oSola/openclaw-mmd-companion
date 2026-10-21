const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.waitForTimeout(2000);

  // Check renderer properties
  const rendererProps = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const r = rt.renderer;
    if (!r) return { error: "no renderer" };
    
    // Check preserveDrawingBuffer
    const context = r.getContext();
    const canvas = r.domElement;
    const attrs = canvas.getContext("webgl2")?.getContextAttributes?.() || canvas.getContext("webgl")?.getContextAttributes?.();
    
    return {
      contextAttributes: attrs,
      autoClear: r.autoClear,
      autoClearColor: r.autoClearColor,
      autoClearDepth: r.autoClearDepth,
      autoClearStencil: r.autoClearStencil,
    };
  });
  console.log("Renderer props:", JSON.stringify(rendererProps, null, 2));

  // Approach: use requestAnimationFrame to capture right after render
  // The issue might be that the render loop clears the buffer before we can capture
  
  // Try: hook into the render loop
  const hookResult = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const renderer = rt.renderer;
    
    // Override render to capture after each render
    const originalRender = renderer.render.bind(renderer);
    let capturedPixel = null;
    
    renderer.render = function(scene, camera) {
      originalRender(scene, camera);
      // Read immediately after render
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      gl.readPixels(
        Math.floor(renderer.domElement.width / 2),
        Math.floor(renderer.domElement.height / 2),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px
      );
      if (!capturedPixel && (px[0] || px[1] || px[2] || px[3])) {
        capturedPixel = [px[0], px[1], px[2], px[3]];
      }
    };
    
    // Trigger a render
    if (rt.model) rt.model.updateMatrixWorld(true);
    originalRender(rt.scene, rt.camera);
    
    // Read right after
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    gl.readPixels(
      Math.floor(renderer.domElement.width / 2),
      Math.floor(renderer.domElement.height / 2),
      1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px
    );
    
    renderer.render = originalRender; // Restore
    
    return {
      immediatePixel: [px[0], px[1], px[2], px[3]],
      capturedDuringHook: capturedPixel,
    };
  });
  console.log("Hook result:", JSON.stringify(hookResult, null, 2));

  // Alternative: use toDataURL on canvas
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return "no canvas";
    try {
      const url = canvas.toDataURL("image/png");
      return { length: url.length, prefix: url.substring(0, 50) };
    } catch(e) { return { error: e.message }; }
  });
  console.log("toDataURL:", JSON.stringify(dataUrl));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
