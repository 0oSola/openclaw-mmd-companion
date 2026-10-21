#!/usr/bin/env node
// render-finger-reverify.mjs - Re-render left hand joint 2/3 tests with correct API
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
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
    const types = {".pmx":"application/octet-stream",".vmd":"application/octet-stream",".png":"image/png"};
    res.writeHead(200, {"Access-Control-Allow-Origin":"*","Content-Type": types[path.extname(target).toLowerCase()]||"application/octet-stream"});
    createReadStream(target).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({server, baseUrl:"http://127.0.0.1:"+server.address().port}));
  });
}

function toServedUrl(baseUrl, filePath) {
  return baseUrl + "/files/" + path.relative(projectRoot, filePath).split(path.sep).map(encodeURIComponent).join("/");
}

const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
const { chromium } = requireFromWeb("playwright");

const modelPath = "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx";
const vmdDir = path.join(projectRoot, "imgToAction/outputs/vmd/basic_tests");
const outBase = path.join(projectRoot, "imgToAction/outputs/actions/20260702_finger_reverify");
const angles = [
  { name: "front", theta: 0 },
  { name: "right", theta: -Math.PI/2 },
  { name: "back", theta: Math.PI },
  { name: "left", theta: Math.PI/2 },
];

// Left hand joints 2/3 that need re-verification + a baseline
const vmdFiles = [
  "basic_finger_rest",
  "basic_l_index2_xp", "basic_l_index2_xn", "basic_l_index2_yp", "basic_l_index2_yn", "basic_l_index2_zp", "basic_l_index2_zn",
  "basic_l_index3_xp", "basic_l_index3_xn", "basic_l_index3_yp", "basic_l_index3_yn", "basic_l_index3_zp", "basic_l_index3_zn",
  "basic_l_middle2_xp", "basic_l_middle2_xn", "basic_l_middle2_yp", "basic_l_middle2_yn", "basic_l_middle2_zp", "basic_l_middle2_zn",
  "basic_l_middle3_xp", "basic_l_middle3_xn", "basic_l_middle3_yp", "basic_l_middle3_yn", "basic_l_middle3_zp", "basic_l_middle3_zn",
  "basic_l_ring2_xp", "basic_l_ring2_xn", "basic_l_ring2_yp", "basic_l_ring2_yn", "basic_l_ring2_zp", "basic_l_ring2_zn",
  "basic_l_ring3_xp", "basic_l_ring3_xn", "basic_l_ring3_yp", "basic_l_ring3_yn", "basic_l_ring3_zp", "basic_l_ring3_zn",
  "basic_l_pinky2_xp", "basic_l_pinky2_xn", "basic_l_pinky2_yp", "basic_l_pinky2_yn", "basic_l_pinky2_zp", "basic_l_pinky2_zn",
  "basic_l_pinky3_xp", "basic_l_pinky3_xn", "basic_l_pinky3_yp", "basic_l_pinky3_yn", "basic_l_pinky3_zp", "basic_l_pinky3_zn",
  // Also include right hand for comparison
  "basic_r_index2_xp", "basic_r_index2_xn",
  "basic_r_middle2_xp", "basic_r_middle2_xn",
];

async function main() {
  const staticServer = await startStaticServer(projectRoot);
  console.log("Static server:", staticServer.baseUrl);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", msg => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!/skinning|morphTargets|envMap|combine|GPU stall|ERR_NETWORK/.test(text)) console.log("[err] " + text);
    }
  });

  const modelUrl = toServedUrl(staticServer.baseUrl, path.resolve(projectRoot, modelPath));
  const webUrl = "http://127.0.0.1:3100";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  console.log("Loading model...");
  const t0 = Date.now();
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Boolean(window.__mmdCompanionRuntime?.model && !window.__mmdCompanionRuntime?.isLoadingVmd),
    null, { timeout: 60000 }
  );
  console.log("Model loaded in " + ((Date.now()-t0)/1000).toFixed(1) + "s");
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(500);

  const baseCamera = await page.evaluate(() => window.__mmdCompanionRuntime?.getCameraSnapshot?.());
  console.log("Base camera:", JSON.stringify(baseCamera?.target));

  let count = 0;
  for (const vmdName of vmdFiles) {
    const vmdPath = path.join(vmdDir, vmdName + ".vmd");
    if (!existsSync(vmdPath)) { console.log("SKIP " + vmdName); continue; }
    const vmdUrl = toServedUrl(staticServer.baseUrl, vmdPath);

    const loaded = await page.evaluate(async (url) => {
      const rt = window.__mmdCompanionRuntime;
      if (!rt || !rt.model || !rt.loader) return false;
      rt.setCalibrationCaptureMode?.(true);
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const parser = rt.loader._getParser ? rt.loader._getParser() : null;
      if (!parser) return false;
      const vmd = parser.parseVmd(buffer, true);
      const target = rt.animationBuildTarget || rt.model;
      const clip = rt.loader.animationBuilder.build(vmd, target);
      rt.currentClip = clip;
      rt.setCalibrationCaptureMode?.(true);
      return true;
    }, vmdUrl);

    if (!loaded) { console.log("FAIL " + vmdName); continue; }

    await page.evaluate((f) => window.__mmdCompanionRuntime?.seekVmdFrame?.(f, 30), 10);
    await page.waitForTimeout(200);

    for (const angle of angles) {
      await page.evaluate(({cam, az}) => {
        const rt = window.__mmdCompanionRuntime;
        if (!rt || !cam) return;
        const dx = cam.position[0] - cam.target[0];
        const dz = cam.position[2] - cam.target[2];
        const r = Math.sqrt(dx*dx + dz*dz);
        const a = Math.atan2(dx, dz) + az;
        rt.camera.position.set(cam.target[0] + r * Math.sin(a), cam.position[1], cam.target[2] + r * Math.cos(a));
        rt.camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
      }, { cam: baseCamera, az: angle.theta });
      await page.waitForTimeout(100);

      const outDir = path.join(outBase, vmdName, angle.name);
      mkdirSync(outDir, { recursive: true });
      await page.screenshot({ path: path.join(outDir, vmdName + ".png"), type: "png" });
      count++;
    }
    console.log("OK " + vmdName);
  }

  await browser.close();
  staticServer.server.close();
  console.log("Done: " + count + " screenshots saved");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
