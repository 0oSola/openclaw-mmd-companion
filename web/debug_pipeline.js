const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  // Capture all console logs
  const logs = [];
  page.on("console", m => {
    logs.push(m.type() + ": " + m.text());
  });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.waitForTimeout(3000);

  // Check the renderScene source to understand what it does
  const renderSceneSrc = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (typeof rt.renderScene === "function") return rt.renderScene.toString().substring(0, 800);
    return "not found";
  });
  console.log("renderScene source:\n", renderSceneSrc);

  // Check setupGenshinPipeline source
  const genshinSrc = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (typeof rt.setupGenshinPipeline === "function") return rt.setupGenshinPipeline.toString().substring(0, 800);
    return "not found";
  });
  console.log("\nsetupGenshinPipeline source:\n", genshinSrc);

  // Check shouldUsePostFX / shouldUseBloom
  const postFxInfo = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    return {
      shouldUsePostFX: typeof rt.shouldUsePostFX === "function" ? rt.shouldUsePostFX() : "not a function",
      shouldUseBloom: typeof rt.shouldUseBloom === "function" ? rt.shouldUseBloom() : "not a function",
      hasComposer: !!rt.composer,
      hasRenderPass: !!rt.renderPass,
      hasBloomPass: !!rt.bloomPass,
      hasColorGradePass: !!rt.colorGradePass,
      renderPipeline: rt.renderPipeline,
    };
  });
  console.log("\nPostFX info:", JSON.stringify(postFxInfo, null, 2));

  // Try calling setupGenshinPipeline manually
  const setupResult = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    try {
      if (typeof rt.setupGenshinPipeline === "function") {
        rt.setupGenshinPipeline();
        return { ok: true, hasComposer: !!rt.composer, hasRenderPass: !!rt.renderPass };
      }
      return { error: "no setupGenshinPipeline" };
    } catch(e) { return { error: e.message }; }
  });
  console.log("\nAfter manual setupGenshinPipeline:", JSON.stringify(setupResult, null, 2));

  // Try renderScene again after setup
  if (setupResult.ok) {
    await page.evaluate(() => {
      const rt = window.__mmdCompanionRuntime;
      if (rt.model) rt.model.updateMatrixWorld(true);
      if (typeof rt.renderScene === "function") rt.renderScene();
      if (rt.renderer && rt.scene && rt.camera) rt.renderer.render(rt.scene, rt.camera);
      if (rt.composer) rt.composer.render();
    });
    await page.waitForTimeout(500);
    
    const pixelCheck = await page.evaluate(() => {
      const rt = window.__mmdCompanionRuntime;
      const canvas = rt.renderer.domElement;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const px = new Uint8Array(4);
      gl.readPixels(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2], px[3]];
    });
    console.log("\nCenter pixel after manual setup+render:", JSON.stringify(pixelCheck));
  }

  // Print relevant console logs
  console.log("\n=== Console logs (filtered) ===");
  for (const log of logs) {
    if (/pipeline|render|setup|composer|bloom|postfx|error|warn/i.test(log) && !/GPU stall|skinning|morphTargets/.test(log)) {
      console.log(log.substring(0, 200));
    }
  }

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
