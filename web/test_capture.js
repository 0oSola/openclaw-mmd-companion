const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const restVmd = webUrl + "/twist-tests/twist_rest.vmd";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin&vmdUrl=" + encodeURIComponent(restVmd);
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(2000);

  // Capture front angle
  const frontData = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const canvas = document.querySelector("canvas");
    // Set camera to front
    rt.camera.position.set(0, 8, 30);
    rt.camera.lookAt(0, 5, 0);
    rt.camera.updateMatrixWorld(true);
    rt.camera.updateProjectionMatrix();
    if (rt.model) rt.model.updateMatrixWorld(true);
    rt.renderer.render(rt.scene, rt.camera);
    return canvas.toDataURL("image/png");
  });
  fs.writeFileSync("front_test.png", Buffer.from(frontData.replace(/^data:image\/png;base64,/, ""), "base64"));
  console.log("Front:", fs.statSync("front_test.png").size, "bytes");

  // Capture back angle
  const backData = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const canvas = document.querySelector("canvas");
    // Set camera to back
    rt.camera.position.set(0, 8, -30);
    rt.camera.lookAt(0, 5, 0);
    rt.camera.updateMatrixWorld(true);
    rt.camera.updateProjectionMatrix();
    if (rt.model) rt.model.updateMatrixWorld(true);
    rt.renderer.render(rt.scene, rt.camera);
    return canvas.toDataURL("image/png");
  });
  fs.writeFileSync("back_test.png", Buffer.from(backData.replace(/^data:image\/png;base64,/, ""), "base64"));
  console.log("Back:", fs.statSync("back_test.png").size, "bytes");

  // Check if different
  const frontMd5 = require("crypto").createHash("md5").update(fs.readFileSync("front_test.png")).digest("hex");
  const backMd5 = require("crypto").createHash("md5").update(fs.readFileSync("back_test.png")).digest("hex");
  console.log("Front MD5:", frontMd5);
  console.log("Back MD5:", backMd5);
  console.log("Different:", frontMd5 !== backMd5);

  // Now load xp90 and capture
  const xp90Vmd = webUrl + "/twist-tests/twist_r_wrist_xp90.vmd";
  await page.evaluate(async (url) => {
    const rt = window.__mmdCompanionRuntime;
    await rt.playVmd(url, 1, [], { disableCrossfade: true });
    let w = 0;
    while (rt.isLoadingVmd && w < 5000) { await new Promise(r => setTimeout(r, 100)); w += 100; }
  }, xp90Vmd);
  await page.waitForTimeout(500);

  // Seek to frame 10
  await page.evaluate(() => window.__mmdCompanionRuntime?.seekVmdFrame?.(10, 30));
  await page.waitForTimeout(200);

  const xp90Data = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const canvas = document.querySelector("canvas");
    rt.camera.position.set(0, 8, 30);
    rt.camera.lookAt(0, 5, 0);
    rt.camera.updateMatrixWorld(true);
    rt.camera.updateProjectionMatrix();
    if (rt.model) rt.model.updateMatrixWorld(true);
    rt.renderer.render(rt.scene, rt.camera);
    return canvas.toDataURL("image/png");
  });
  fs.writeFileSync("xp90_test.png", Buffer.from(xp90Data.replace(/^data:image\/png;base64,/, ""), "base64"));
  console.log("xp90:", fs.statSync("xp90_test.png").size, "bytes");
  
  const xp90Md5 = require("crypto").createHash("md5").update(fs.readFileSync("xp90_test.png")).digest("hex");
  console.log("xp90 MD5:", xp90Md5);
  console.log("Different from rest:", xp90Md5 !== frontMd5);

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
