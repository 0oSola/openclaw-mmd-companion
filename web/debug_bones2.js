const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", m => {
    const t = m.text();
    if (!/skinning|morphTargets|envMap|combine|GPU stall|404|ERR_NETWORK/.test(t)) {
      console.log(m.type(), t);
    }
  });

  // Use the COMPANION page, not calibration-render
  console.log("Loading companion page...");
  await page.goto("http://127.0.0.1:3100/companion", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  
  // Check bones on companion page
  const bones = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const boneNames = rt.bones ? Object.keys(rt.bones) : [];
    return {
      boneCount: boneNames.length,
      boneNames: boneNames,
      hasRightWristJP: boneNames.includes("右腕"),
      hasRightArm: boneNames.includes("rightArm"),
    };
  });
  console.log("Companion bones:", JSON.stringify(bones));

  // Now try loading a VMD on companion page
  const vmdUrl = "http://127.0.0.1:3100/twist-tests/twist_r_wrist_xp90.vmd";
  console.log("Playing VMD on companion...");
  const result = await page.evaluate(async (url) => {
    const rt = window.__mmdCompanionRuntime;
    if (typeof rt.playVmd !== "function") return { error: "no playVmd" };
    try {
      await rt.playVmd(url);
      let waited = 0;
      while (rt.isLoadingVmd && waited < 10000) {
        await new Promise(r => setTimeout(r, 200));
        waited += 200;
      }
      return {
        ok: true,
        waited,
        currentVmdUrl: rt.currentVmdUrl,
        hasClip: !!rt.currentClip,
        clipDuration: rt.currentClip ? rt.currentClip.duration : null,
      };
    } catch(e) { return { error: e.message }; }
  }, vmdUrl);
  console.log("playVmd result:", JSON.stringify(result));

  // Seek to frame 10
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    if (rt.seekVmdFrame) rt.seekVmdFrame(10, 30);
  });
  await page.waitForTimeout(500);

  // Check bone position after VMD
  const boneState = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const result = {};
    if (rt.bones) {
      for (const name of Object.keys(rt.bones)) {
        const b = rt.bones[name];
        result[name] = {
          pos: b.position ? [+b.position.x.toFixed(4), +b.position.y.toFixed(4), +b.position.z.toFixed(4)] : null,
          rot: b.quaternion ? [+b.quaternion.x.toFixed(4), +b.quaternion.y.toFixed(4), +b.quaternion.z.toFixed(4), +b.quaternion.w.toFixed(4)] : (b.rotation ? [+b.rotation.x.toFixed(4), +b.rotation.y.toFixed(4), +b.rotation.z.toFixed(4), +b.rotation.w.toFixed(4)] : null),
        };
      }
    }
    return result;
  });
  console.log("Bone positions after VMD:", JSON.stringify(boneState, null, 2));

  await page.screenshot({ path: "test_companion_xp90.png", type: "png" });
  const size = require("fs").statSync("test_companion_xp90.png").size;
  console.log("Companion screenshot size:", size);

  // Also check the calibration-render page
  console.log("\n--- Calibration render page ---");
  const page2 = await browser.newPage();
  page2.on("console", m => {
    const t = m.text();
    if (!/skinning|morphTargets|envMap|combine|GPU stall|404|ERR_NETWORK/.test(t)) {
      console.log("p2:", m.type(), t);
    }
  });
  const modelUrl = "http://127.0.0.1:3100/twist-tests/model/eula.pmx";
  const calUrl = "http://127.0.0.1:3100/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin&vmdUrl=" + encodeURIComponent(vmdUrl);
  await page2.goto(calUrl, { waitUntil: "domcontentloaded" });
  await page2.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page2.waitForTimeout(3000);

  const calBones = await page2.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const boneNames = rt.bones ? Object.keys(rt.bones) : [];
    return {
      boneCount: boneNames.length,
      boneNames: boneNames,
      hasRightWristJP: boneNames.includes("右腕"),
    };
  });
  console.log("Calibration bones:", JSON.stringify(calBones));

  await page2.screenshot({ path: "test_calib_xp90.png", type: "png" });
  const calSize = require("fs").statSync("test_calib_xp90.png").size;
  console.log("Calibration screenshot size:", calSize);

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
