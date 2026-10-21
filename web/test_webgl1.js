const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  // Inject a script BEFORE page loads to force WebGL1
  await page.addInitScript(() => {
    // Force WebGL1 by disabling WebGL2
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type === "webgl2") {
        return originalGetContext.call(this, "webgl", ...args);
      }
      return originalGetContext.call(this, type, ...args);
    };
  });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.waitForTimeout(3000);

  // Check WebGL version
  const glInfo = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER),
    };
  });
  console.log("GL info:", JSON.stringify(glInfo));

  // Force render and capture via toDataURL
  const dataUrl = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const canvas = document.querySelector("canvas");
    if (rt.model) rt.model.updateMatrixWorld(true);
    rt.camera.position.set(0, 8, 30);
    rt.camera.lookAt(0, 5, 0);
    rt.camera.updateMatrixWorld(true);
    rt.camera.updateProjectionMatrix();
    rt.renderer.render(rt.scene, rt.camera);
    return canvas.toDataURL("image/png");
  });
  
  const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  fs.writeFileSync("/tmp/webgl1_test.png", buf);
  console.log("WebGL1 screenshot:", buf.length, "bytes");

  // Check pixel
  const pixel = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl");
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2], px[3]];
  });
  console.log("Center pixel:", JSON.stringify(pixel));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
