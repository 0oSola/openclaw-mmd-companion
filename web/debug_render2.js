const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.waitForTimeout(3000);

  // Check renderer state
  const rendererInfo = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const renderer = rt.renderer;
    if (!renderer) return { error: "no renderer" };
    
    const canvas = renderer.domElement;
    return {
      canvasW: canvas.width,
      canvasH: canvas.height,
      canvasClientW: canvas.clientWidth,
      canvasClientH: canvas.clientHeight,
      canvasStyle: canvas.style.cssText.substring(0, 200),
      rendererSize: renderer.domElement ? `${renderer.domElement.width}x${renderer.domElement.height}` : "n/a",
      pixelRatio: renderer.getPixelRatio ? renderer.getPixelRatio() : "n/a",
      hasScene: !!rt.scene,
      hasCamera: !!rt.camera,
      destroyed: rt.destroyed,
      // Check if render loop is running by checking clock
      clockElapsedTime: rt.clock ? (typeof rt.clock.getElapsedTime === "function" ? rt.clock.getElapsedTime() : "no method") : "no clock",
      // Check renderPass
      hasRenderPass: !!rt.renderPass,
      hasComposer: !!rt.composer,
      // Check if there's a canvas in the DOM that's visible
      canvasRect: canvas.getBoundingClientRect ? JSON.stringify({
        x: canvas.getBoundingClientRect().x,
        y: canvas.getBoundingClientRect().y,
        w: canvas.getBoundingClientRect().width,
        h: canvas.getBoundingClientRect().height,
      }) : "n/a",
    };
  });
  console.log("Renderer info:", JSON.stringify(rendererInfo, null, 2));

  // Try to manually render and capture
  const renderResult = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    try {
      // Force update
      if (rt.model) {
        rt.model.updateMatrixWorld(true);
      }
      // Try renderScene
      if (typeof rt.renderScene === "function") {
        rt.renderScene();
      }
      // Try direct renderer render
      if (rt.renderer && rt.scene && rt.camera) {
        rt.renderer.render(rt.scene, rt.camera);
      }
      // Try composer
      if (rt.composer) {
        rt.composer.render();
      }
      return { ok: true, hasRenderPass: !!rt.renderPass, hasComposer: !!rt.composer };
    } catch(e) { return { error: e.message }; }
  });
  console.log("Render result:", JSON.stringify(renderResult));

  // Wait and read pixels again
  await page.waitForTimeout(500);
  
  const pixelCheck = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const canvas = rt.renderer.domElement;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { error: "no gl" };
    const w = canvas.width;
    const h = canvas.height;
    // Check multiple points
    const points = [
      [Math.floor(w/2), Math.floor(h/2)],
      [Math.floor(w/4), Math.floor(h/2)],
      [Math.floor(w/2), Math.floor(h/4)],
      [Math.floor(w/2), Math.floor(h*3/4)],
    ];
    const results = [];
    for (const [x, y] of points) {
      const px = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      results.push([x, y, [px[0], px[1], px[2], px[3]]]);
    }
    // Also check full frame
    const full = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, full);
    let nonZero = 0;
    for (let i = 0; i < full.length; i += 4) {
      if (full[i] || full[i+1] || full[i+2] || full[i+3]) nonZero++;
    }
    return { points: results, totalNonZero: nonZero, total: w * h };
  });
  console.log("Pixel check:", JSON.stringify(pixelCheck, null, 2));

  // Check: is there another canvas? Maybe the render goes to a different canvas
  const canvasCount = await page.evaluate(() => {
    const canvases = document.querySelectorAll("canvas");
    return Array.from(canvases).map(c => ({
      w: c.width, h: c.height,
      class: c.className,
      parent: c.parentElement?.tagName + (c.parentElement?.className ? "." + c.parentElement.className : ""),
      style: c.style.cssText.substring(0, 100),
    }));
  });
  console.log("All canvases:", JSON.stringify(canvasCount, null, 2));

  // Check: does the calibration-render page actually use a different component?
  // Look at what the page renders
  const pageHTML = await page.evaluate(() => {
    const root = document.querySelector("#__next") || document.body;
    return root.innerHTML.substring(0, 2000);
  });
  console.log("Page HTML (first 2000 chars):", pageHTML);

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
