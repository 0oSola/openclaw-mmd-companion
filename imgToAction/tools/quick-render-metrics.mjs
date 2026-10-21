#!/usr/bin/env node
// Quick batch renderer that also collects orientation metrics
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

function startStaticServer(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/files/")) { res.writeHead(404, {"Access-Control-Allow-Origin":"*"}); res.end(); return; }
    const decoded = decodeURIComponent(url.pathname.slice("/files/".length));
    const target = path.resolve(root, decoded);
    if ((target !== root && !target.startsWith(root + path.sep)) || !existsSync(target)) { res.writeHead(404, {"Access-Control-Allow-Origin":"*"}); res.end(); return; }
    const types = {".pmx":"application/octet-stream",".vmd":"application/octet-stream",".png":"image/png",".json":"application/json",".tga":"application/octet-stream"};
    res.writeHead(200, {"Access-Control-Allow-Origin":"*","Content-Type": types[path.extname(target).toLowerCase()]||"application/octet-stream"});
    createReadStream(target).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({server, baseUrl:`http://127.0.0.1:${server.address().port}`}));
  });
}

function toServedUrl(baseUrl, filePath) {
  return `${baseUrl}/files/${path.relative(projectRoot, filePath).split(path.sep).map(encodeURIComponent).join("/")}`;
}

const args = process.argv.slice(2);
let vmds = [], outBase = "imgToAction/outputs/actions/quick_metrics", frames = [10], webUrl = "http://127.0.0.1:3100";
let modelPath = existsSync(path.resolve(projectRoot, "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx"))
  ? "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx"
  : "imgToAction/assets/pmx/优菈.pmx";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--vmds") vmds = args[++i].split(",").map(s=>s.trim()).filter(Boolean);
  else if (args[i] === "--out-base") outBase = args[++i];
  else if (args[i] === "--frames") frames = args[++i].split(",").map(s=>parseInt(s));
  else if (args[i] === "--web-url") webUrl = args[++i];
  else if (args[i] === "--model") modelPath = args[++i];
}

const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
const { chromium } = requireFromWeb("playwright");

async function main() {
  const staticServer = await startStaticServer(projectRoot);
  console.log("Static:", staticServer.baseUrl);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", msg => {
    const t = msg.type();
    if (t === "error") {
      const text = msg.text();
      if (!/skinning|morphTargets|envMap|combine|GPU stall|ERR_NETWORK/.test(text)) console.log(`[err] ${text}`);
    }
  });

  const modelUrl = toServedUrl(staticServer.baseUrl, modelPath);
  const renderUrl = `${webUrl}/mmd-calibration-render?modelUrl=${encodeURIComponent(modelUrl)}&renderPipeline=genshin`;
  console.log("Loading model...");
  const t0 = Date.now();
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime?.model && !window.__mmdCompanionRuntime?.isLoadingVmd), null, { timeout: 60_000 });
  console.log(`Model loaded in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(500);

  let count = 0;
  const allMetrics = [];

  for (const vmdPath of vmds) {
    count++;
    const vmdName = path.basename(vmdPath, ".vmd");
    const vmdUrl = toServedUrl(staticServer.baseUrl, vmdPath);
    const t1 = Date.now();

    const loaded = await page.evaluate(async (url) => {
      const rt = window.__mmdCompanionRuntime;
      if (!rt || !rt.model || !rt.loader) return { error: "no runtime/loader" };
      rt.setCalibrationCaptureMode?.(true);
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const parser = rt.loader._getParser ? rt.loader._getParser() : null;
      if (!parser) return { error: "no parser" };
      const vmd = parser.parseVmd(buffer, true);
      const target = rt.animationBuildTarget || rt.model;
      const builder = rt.loader.animationBuilder;
      const clip = builder.build(vmd, target);
      rt.currentClip = clip;
      rt.setCalibrationCaptureMode?.(true);
      return { ok: true, tracks: clip?.tracks?.length || 0 };
    }, vmdUrl);

    if (loaded?.error) { console.log(`[${count}/${vmds.length}] ${vmdName}: ERROR ${loaded.error}`); continue; }

    const outDir = path.join(projectRoot, outBase, vmdName);
    mkdirSync(outDir, { recursive: true });

    for (const frame of frames) {
      await page.evaluate((f) => window.__mmdCompanionRuntime?.seekVmdFrame?.(f, 30), frame);
      await page.waitForTimeout(200);

      // Screenshot
      const screenshotPath = path.join(outDir, `frame_${String(frame).padStart(3,"0")}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      // Collect comprehensive metrics
      const metrics = await page.evaluate(() => {
        const rt = window.__mmdCompanionRuntime;
        const model = rt?.model;
        const skel = model?.skeleton;
        const camera = rt?.camera;
        if (!skel || !camera) return { error: "no skeleton/camera" };

        model.updateMatrixWorld(true);
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();

        const bonesByName = new Map();
        const visit = (o) => { if (!o) return; for (const b of o.skeleton?.bones||[]) if (b?.name) bonesByName.set(b.name, b); for (const c of o.children||[]) visit(c); };
        visit(model);

        // Bone quaternions
        const boneQuats = {};
        const boneNames = ["右足首","右足","右ひざ","右つま先","左足首","左足","左ひざ","左つま先","右腕","右ひじ","上半身","上半身2","首","頭","右肩","左腕","左ひじ","左肩","下半身"];
        for (const bn of boneNames) {
          const b = bonesByName.get(bn);
          if (b) boneQuats[bn] = [+b.quaternion.x.toFixed(6),+b.quaternion.y.toFixed(6),+b.quaternion.z.toFixed(6),+b.quaternion.w.toFixed(6)];
        }

        // World positions for key landmarks
        const getWorld = (name) => {
          const b = bonesByName.get(name);
          if (!b) return null;
          b.updateMatrixWorld(true);
          return { x: b.matrixWorld.elements[12], y: b.matrixWorld.elements[13], z: b.matrixWorld.elements[14] };
        };

        // Ankle orientation (ankle -> toe direction)
        const rAnkle = getWorld("右足首"); const rToe = getWorld("右つま先");
        const lAnkle = getWorld("左足首"); const lToe = getWorld("左つま先");
        let rAnklePitch = null, rAnkleYaw = null, lAnklePitch = null, lAnkleYaw = null;
        if (rAnkle && rToe) { const d = {x:rToe.x-rAnkle.x,y:rToe.y-rAnkle.y,z:rToe.z-rAnkle.z}; const l=Math.hypot(d.x,d.y,d.z)||1; rAnklePitch = Math.asin(Math.max(-1,Math.min(1,d.y/l)))*180/Math.PI; rAnkleYaw = Math.atan2(d.x,d.z)*180/Math.PI; }
        if (lAnkle && lToe) { const d = {x:lToe.x-lAnkle.x,y:lToe.y-lAnkle.y,z:lToe.z-lAnkle.z}; const l=Math.hypot(d.x,d.y,d.z)||1; lAnklePitch = Math.asin(Math.max(-1,Math.min(1,d.y/l)))*180/Math.PI; lAnkleYaw = Math.atan2(d.x,d.z)*180/Math.PI; }

        // Joint angles
        const angle = (a,b,c) => { if(!a||!b||!c) return null; const u={x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}; const v={x:c.x-b.x,y:c.y-b.y,z:c.z-b.z}; const ul=Math.hypot(u.x,u.y,u.z)||1,vl=Math.hypot(v.x,v.y,v.z)||1; const dot=(u.x*v.x+u.y*v.y+u.z*v.z)/(ul*vl); return Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI; };
        const rHip = getWorld("右足"), rKnee = getWorld("右ひざ");
        const lHip = getWorld("左足"), lKnee = getWorld("左ひざ");
        const rShldr = getWorld("右肩"), rElbow = getWorld("右ひじ"), rWrist = getWorld("右手首");
        const lShldr = getWorld("左肩"), lElbow = getWorld("左ひじ"), lWrist = getWorld("左手首");
        const waist = getWorld("下半身"), neck = getWorld("首"), head = getWorld("頭");

        // Torso orientation
        let torsoLean = null, torsoYaw = null;
        if (waist && neck) { const d={x:neck.x-waist.x,y:neck.y-waist.y,z:neck.z-waist.z}; const l=Math.hypot(d.x,d.y,d.z)||1; torsoLean=Math.asin(Math.max(-1,Math.min(1,d.y/l)))*180/Math.PI; torsoYaw=Math.atan2(d.x,d.z)*180/Math.PI; }

        // Head orientation
        let headPitch = null, headYaw = null;
        if (neck && head) { const d={x:head.x-neck.x,y:head.y-neck.y,z:head.z-neck.z}; const l=Math.hypot(d.x,d.y,d.z)||1; headPitch=Math.asin(Math.max(-1,Math.min(1,d.y/l)))*180/Math.PI; headYaw=Math.atan2(d.x,d.z)*180/Math.PI; }

        return {
          bone_quaternions: boneQuats,
          ankle_orientation: { right_foot_pitch: rAnklePitch, right_foot_yaw: rAnkleYaw, left_foot_pitch: lAnklePitch, left_foot_yaw: lAnkleYaw },
          joint_angles: { right_knee: angle(rHip,rKnee,rAnkle), left_knee: angle(lHip,lKnee,lAnkle), right_elbow: angle(rShldr,rElbow,rWrist), left_elbow: angle(lShldr,lElbow,lWrist) },
          torso_orientation: { lean: torsoLean, yaw: torsoYaw },
          head_orientation: { pitch: headPitch, yaw: headYaw },
          world_positions: { rAnkle, rToe, lAnkle, lToe, rHip, rKnee, lHip, lKnee, waist, neck, head },
        };
      });

      writeFileSync(path.join(outDir, `frame_${String(frame).padStart(3,"0")}_metrics.json`), JSON.stringify({ vmd: vmdName, frame, ...metrics }, null, 2));
      allMetrics.push({ vmd: vmdName, frame, ...metrics });
    }
    console.log(`[${count}/${vmds.length}] ${vmdName} done (${((Date.now()-t1)/1000).toFixed(1)}s)`);
  }

  mkdirSync(path.join(projectRoot, outBase), { recursive: true });
  // Write combined metrics
  writeFileSync(path.join(projectRoot, outBase, "all_metrics.json"), JSON.stringify(allMetrics, null, 2));
  console.log(`\nComplete: ${vmds.length} VMDs, ${allMetrics.length} frames`);

  await browser.close();
  staticServer.server.close();
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
