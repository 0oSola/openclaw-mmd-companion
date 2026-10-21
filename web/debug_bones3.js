const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", m => {
    const t = m.text();
    if (/bone|右腕|rightArm|skeleton|VMD|vmd|parse|clip|motion/i.test(t) && !/skinning|morphTargets/.test(t)) {
      console.log(m.type(), t);
    }
  });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  
  // Load calibration render with rest VMD
  const vmdUrl = webUrl + "/twist-tests/twist_rest.vmd";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin&vmdUrl=" + encodeURIComponent(vmdUrl);
  
  console.log("Loading calibration render...");
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.waitForTimeout(3000);

  // Check model skeleton - look at the actual three.js model
  const modelInfo = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    
    // Check bones object
    const boneKeys = rt.bones ? Object.keys(rt.bones) : [];
    
    // Check model skeleton
    let skeletonBones = [];
    if (model && model.skeleton) {
      const skel = model.skeleton;
      if (skel.bones) {
        skeletonBones = skel.bones.map(b => b.name);
      }
    }
    
    // Check model children/bones directly
    let modelBones = [];
    if (model) {
      model.traverse(obj => {
        if (obj.isBone || obj.type === "Bone") {
          modelBones.push(obj.name);
        }
      });
    }
    
    // Check animationBuildTarget
    let buildTargetBones = [];
    if (rt.animationBuildTarget) {
      buildTargetBones = Object.keys(rt.animationBuildTarget);
    }
    
    // Check vmdAnchorBones
    let anchorBones = [];
    if (rt.vmdAnchorBones) {
      anchorBones = Object.keys(rt.vmdAnchorBones);
    }
    
    // Check baseBoneRotation
    let baseRotations = [];
    if (rt.baseBoneRotation) {
      baseRotations = Object.keys(rt.baseBoneRotation);
    }
    
    return {
      boneKeys,
      skeletonBones: skeletonBones.slice(0, 50),
      modelBones: modelBones.slice(0, 50),
      buildTargetBones,
      anchorBones,
      baseRotations,
    };
  });
  
  console.log("Model info:");
  console.log("  rt.bones keys:", JSON.stringify(modelInfo.boneKeys));
  console.log("  skeleton bones:", JSON.stringify(modelInfo.skeletonBones));
  console.log("  model bones:", JSON.stringify(modelInfo.modelBones));
  console.log("  buildTarget bones:", JSON.stringify(modelInfo.buildTargetBones));
  console.log("  anchor bones:", JSON.stringify(modelInfo.anchorBones));
  console.log("  baseRotations:", JSON.stringify(modelInfo.baseRotations));

  // Now load xp90 VMD and check if clip has tracks for 右腕
  const vmd2Url = webUrl + "/twist-tests/twist_r_wrist_xp90.vmd";
  await page.evaluate(async (url) => {
    const rt = window.__mmdCompanionRuntime;
    await rt.playVmd(url);
    let w = 0;
    while (rt.isLoadingVmd && w < 5000) { await new Promise(r => setTimeout(r, 100)); w += 100; }
  }, vmdUrl);
  await page.waitForTimeout(1000);

  const clipInfo = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const clip = rt.currentClip;
    if (!clip) return { error: "no clip" };
    
    // Check clip tracks
    let tracks = [];
    if (clip.tracks) {
      tracks = clip.tracks.map(t => ({ name: t.name, type: t.ValueTypeName || t.type || "unknown" }));
    }
    
    // Check if mixer exists and what it's doing
    const mixer = rt.getCurrentVmdMixer ? rt.getCurrentVmdMixer() : null;
    let mixerActions = [];
    if (mixer && mixer._actions) {
      mixerActions = mixer._actions.map(a => ({
        name: a._clip ? a._clip.name : "unnamed",
        tracks: a._clip && a._clip.tracks ? a._clip.tracks.length : 0,
        trackNames: a._clip && a._clip.tracks ? a._clip.tracks.map(t => t.name).slice(0, 10) : [],
      }));
    }
    
    return {
      clipName: clip.name,
      clipDuration: clip.duration,
      trackCount: tracks.length,
      tracks: tracks.slice(0, 10),
      mixerActions,
    };
  });
  console.log("Clip info after xp90:", JSON.stringify(clipInfo, null, 2));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
