const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", m => {
    const t = m.text();
    if (!/skinning|morphTargets|envMap|combine|GPU stall|404|ERR_NETWORK|React DevTools/.test(t)) {
      console.log(m.type(), t);
    }
  });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  
  // Load with rest VMD
  const restVmd = webUrl + "/twist-tests/twist_rest.vmd";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin&vmdUrl=" + encodeURIComponent(restVmd);
  
  console.log("Loading...");
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (rt.setCalibrationCaptureMode) rt.setCalibrationCaptureMode(true);
  });
  await page.waitForTimeout(2000);
  console.log("Ready");

  // Get 右腕 bone world position at rest
  const restPos = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    let bone = null;
    rt.model.traverse(obj => {
      if (obj.name === "右腕") bone = obj;
    });
    if (!bone) return { error: "bone not found" };
    return {
      name: bone.name,
      pos: [bone.position.x, bone.position.y, bone.position.z],
      quat: [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w],
    };
  });
  console.log("Rest pose 右腕:", JSON.stringify(restPos));

  // Take rest screenshot
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (rt.camera) {
      rt.camera.position.set(0, 8, 30);
      rt.camera.lookAt(0, 5, 0);
    }
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: "dbg_rest.png", type: "png" });
  console.log("Rest screenshot:", fs.statSync("dbg_rest.png").size, "bytes");

  // Now load xp90
  const xp90Vmd = webUrl + "/twist-tests/twist_r_wrist_xp90.vmd";
  await page.evaluate(async (url) => {
    const rt = window.__mmdCompanionRuntime;
    await rt.playVmd(url);
    let w = 0;
    while (rt.isLoadingVmd && w < 5000) { await new Promise(r => setTimeout(r, 100)); w += 100; }
  }, xp90Vmd);
  await page.waitForTimeout(1000);

  // Check if VMD loaded
  const vmdState = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    return {
      currentVmdUrl: rt.currentVmdUrl,
      hasClip: !!rt.currentClip,
      clipDuration: rt.currentClip?.duration,
    };
  });
  console.log("After xp90 load:", JSON.stringify(vmdState));

  // Seek to frame 10
  const seekResult = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (typeof rt.seekVmdFrame === "function") {
      return rt.seekVmdFrame(10, 30);
    }
    return "no seekVmdFrame";
  });
  console.log("Seek result:", seekResult);
  await page.waitForTimeout(500);

  // Get 右腕 bone position after seek
  const xp90Pos = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    let bone = null;
    rt.model.traverse(obj => {
      if (obj.name === "右腕") bone = obj;
    });
    if (!bone) return { error: "bone not found" };
    return {
      name: bone.name,
      pos: [bone.position.x, bone.position.y, bone.position.z],
      quat: [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w],
    };
  });
  console.log("xp90 pose 右腕:", JSON.stringify(xp90Pos));
  console.log("Position changed:", JSON.stringify(restPos.pos) !== JSON.stringify(xp90Pos.pos));
  console.log("Quaternion changed:", JSON.stringify(restPos.quat) !== JSON.stringify(xp90Pos.quat));

  // Take xp90 screenshot
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (rt.camera) {
      rt.camera.position.set(0, 8, 30);
      rt.camera.lookAt(0, 5, 0);
    }
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: "dbg_xp90.png", type: "png" });
  console.log("xp90 screenshot:", fs.statSync("dbg_xp90.png").size, "bytes");
  console.log("Screenshots same size:", fs.statSync("dbg_rest.png").size === fs.statSync("dbg_xp90.png").size);

  // Render a frame explicitly
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (typeof rt.renderScene === "function") rt.renderScene();
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: "dbg_xp90_rendered.png", type: "png" });
  console.log("xp90 rendered:", fs.statSync("dbg_xp90_rendered.png").size, "bytes");

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
