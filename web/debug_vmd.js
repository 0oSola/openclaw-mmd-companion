const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", m => {
    if (m.type() === "log" || m.type() === "error") console.log(m.type(), m.text());
  });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  
  // Load with rest pose first
  const vmdUrl = webUrl + "/twist-tests/twist_rest.vmd";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin&vmdUrl=" + encodeURIComponent(vmdUrl);
  
  console.log("Loading page...");
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (rt.setCalibrationCaptureMode) rt.setCalibrationCaptureMode(true);
  });
  await page.waitForTimeout(2000);

  // Check state after initial load
  let state1 = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    return {
      currentVmdUrl: rt.currentVmdUrl,
      isLoadingVmd: rt.isLoadingVmd,
      hasClip: !!rt.currentClip,
      clipDuration: rt.currentClip ? rt.currentClip.duration : null,
      clipName: rt.currentClip ? rt.currentClip.name : null,
    };
  });
  console.log("After rest load:", JSON.stringify(state1));

  // Take screenshot of rest pose
  await page.screenshot({ path: "test_rest.png", type: "png" });
  console.log("Rest screenshot saved");

  // Now try playVmd with a different VMD
  const vmd2Url = webUrl + "/twist-tests/twist_r_wrist_xp90.vmd";
  console.log("Playing twist_r_wrist_xp90...");
  
  const result = await page.evaluate(async (url) => {
    const rt = window.__mmdCompanionRuntime;
    if (!rt || typeof rt.playVmd !== "function") return { error: "no playVmd" };
    try {
      // Call playVmd
      const r = await rt.playVmd(url);
      // Wait for loading
      let waited = 0;
      while (rt.isLoadingVmd && waited < 10000) {
        await new Promise(res => setTimeout(res, 200));
        waited += 200;
      }
      return { 
        ok: true, 
        waited: waited,
        currentVmdUrl: rt.currentVmdUrl,
        isLoadingVmd: rt.isLoadingVmd,
        hasClip: !!rt.currentClip,
        clipDuration: rt.currentClip ? rt.currentClip.duration : null,
        clipName: rt.currentClip ? rt.currentClip.name : null,
        currentVmdAction: rt.currentVmdAction ? "has_value" : null,
      };
    } catch(e) { return { error: e.message, stack: e.stack }; }
  }, vmd2Url);
  console.log("playVmd result:", JSON.stringify(result));

  // Wait for rendering
  await page.waitForTimeout(1000);

  // Seek to frame 10
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (rt.seekVmdFrame) rt.seekVmdFrame(10, 30);
  });
  await page.waitForTimeout(500);

  // Check bone positions
  let boneState = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (!rt.bones) return { error: "no bones" };
    const boneNames = Object.keys(rt.bones);
    const rightWrist = rt.bones["右腕"];
    const rightElbow = rt.bones["右ひじ"];
    return {
      boneCount: boneNames.length,
      boneNames: boneNames.slice(0, 20),
      rightWrist: rightWrist ? {
        pos: rightWrist.position ? [rightWrist.position.x, rightWrist.position.y, rightWrist.position.z] : null,
        rot: rightWrist.rotation ? [rightWrist.rotation.x, rightWrist.rotation.y, rightWrist.rotation.z, rightWrist.rotation.w] : null,
      } : null,
      rightElbow: rightElbow ? {
        pos: rightElbow.position ? [rightElbow.position.x, rightElbow.position.y, rightElbow.position.z] : null,
        rot: rightElbow.rotation ? [rightElbow.rotation.x, rightElbow.rotation.y, rightElbow.rotation.z, rightElbow.rotation.w] : null,
      } : null,
    };
  });
  console.log("Bone state after x+90:", JSON.stringify(boneState));

  // Take screenshot of xp90 pose
  await page.screenshot({ path: "test_xp90.png", type: "png" });
  console.log("xp90 screenshot saved");

  // Compare file sizes
  const restSize = fs.statSync("test_rest.png").size;
  const xp90Size = fs.statSync("test_xp90.png").size;
  console.log(`Rest size: ${restSize}, xp90 size: ${xp90Size}, same: ${restSize === xp90Size}`);

  // Also check: what does playVmd actually do? Check source
  const playVmdSource = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (typeof rt.playVmd === "function") {
      return rt.playVmd.toString().substring(0, 500);
    }
    return "not found";
  });
  console.log("playVmd source (first 500 chars):", playVmdSource);

  // Check seekVmdFrame source too
  const seekSource = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (typeof rt.seekVmdFrame === "function") {
      return rt.seekVmdFrame.toString().substring(0, 500);
    }
    return "not found";
  });
  console.log("seekVmdFrame source (first 500 chars):", seekSource);

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
