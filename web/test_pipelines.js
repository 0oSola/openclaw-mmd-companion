const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  // Try "hero-shot" pipeline - the old script used that
  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  
  for (const pipeline of ["hero-shot", "classic", "genshin"]) {
    console.log(`\n=== Testing pipeline: ${pipeline} ===`);
    const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=" + pipeline;
    
    const p = await browser.newPage();
    await p.goto(renderUrl, { waitUntil: "domcontentloaded" });
    
    try {
      await p.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 30000 });
      await p.waitForTimeout(2000);

      const info = await p.evaluate(() => {
        const rt = window.__mmdCompanionRuntime;
        return {
          renderPipeline: rt.renderPipeline,
          shouldUsePostFX: typeof rt.shouldUsePostFX === "function" ? rt.shouldUsePostFX() : null,
          hasComposer: !!rt.composer,
          hasRenderPass: !!rt.renderPass,
        };
      });
      console.log("Pipeline info:", JSON.stringify(info));

      // Force render
      await p.evaluate(() => {
        const rt = window.__mmdCompanionRuntime;
        if (rt.model) rt.model.updateMatrixWorld(true);
        if (typeof rt.renderScene === "function") rt.renderScene();
      });
      await p.waitForTimeout(500);

      // Check pixel
      const pixel = await p.evaluate(() => {
        const rt = window.__mmdCompanionRuntime;
        const canvas = rt.renderer.domElement;
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        const px = new Uint8Array(4);
        gl.readPixels(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2], px[3]];
      });
      console.log("Center pixel:", JSON.stringify(pixel));
    } catch(e) {
      console.log("Error:", e.message.substring(0, 100));
    }
    await p.close();
  }

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
