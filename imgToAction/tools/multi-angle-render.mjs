#!/usr/bin/env node
// Multi-angle batch renderer: renders each VMD from front/left/right/back
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
let vmds = [], outBase = "imgToAction/outputs/actions/multi_angle", frames = [10], webUrl = "http://127.0.0.1:3100";
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

const ANGLES = {
  front: 0,    // azimuth 0
  right: -90,  // camera moves to right side
  back: 180,
  left: 90,
};

const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
const { chromium } = requireFromWeb("playwright");

async function main() {
  const staticServer = await startStaticServer(projectRoot);
  console.log("Static:", staticServer.baseUrl);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", msg => {
    if (msg.type() === "error") {
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

  // Get base camera snapshot
  const baseCamera = await page.evaluate(() => window.__mmdCompanionRuntime?.getCameraSnapshot?.());
  console.log("Base camera target:", JSON.stringify(baseCamera?.target));

  let count = 0;
  for (const vmdPath of vmds) {
    count++;
    const vmdName = path.basename(vmdPath, ".vmd");
    const vmdUrl = toServedUrl(staticServer.baseUrl, vmdPath);
    const t1 = Date.now();

    // Load VMD
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

    if (!loaded) { console.log(`[${count}/${vmds.length}] ${vmdName}: LOAD FAILED`); continue; }

    // Parse bone_id from vmd name
    const stripped = vmdName.replace('basic_', ''); const lastUnderscore = stripped.lastIndexOf('_'); const parts = [stripped.slice(0, lastUnderscore), stripped.slice(lastUnderscore + 1)];
    const boneId = parts[0];

    for (const [angleName, azimuth] of Object.entries(ANGLES)) {
      // Rotate camera
      await page.evaluate(({cam, az}) => {
        const rt = window.__mmdCompanionRuntime;
        if (!rt || !cam) return;
        const dx = cam.position[0] - cam.target[0];
        const dz = cam.position[2] - cam.target[2];
        const dist = Math.hypot(dx, dz);
        const baseAngle = Math.atan2(dx, dz);
        const newAngle = baseAngle + (az * Math.PI / 180);
        const newPos = [
          cam.target[0] + dist * Math.sin(newAngle),
          cam.position[1],
          cam.target[2] + dist * Math.cos(newAngle),
        ];
        rt.applyCameraSnapshot?.({
          position: newPos,
          target: cam.target,
          fov: cam.fov || 33,
          locked: true,
        }, { locked: true });
      }, {cam: baseCamera, az: azimuth});
      await page.waitForTimeout(100);

      for (const frame of frames) {
        await page.evaluate((f) => window.__mmdCompanionRuntime?.seekVmdFrame?.(f, 30), frame);
        await page.waitForTimeout(200);

        const outDir = path.join(projectRoot, outBase, boneId, angleName);
        mkdirSync(outDir, { recursive: true });
        const screenshotPath = path.join(outDir, `${vmdName}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
      }
    }
    console.log(`[${count}/${vmds.length}] ${vmdName} done (${((Date.now()-t1)/1000).toFixed(1)}s)`);
  }

  // Reset camera to front
  await page.evaluate((cam) => {
    window.__mmdCompanionRuntime?.applyCameraSnapshot?.(cam, { locked: true });
  }, baseCamera);

  await browser.close();
  staticServer.server.close();
  console.log(`\nComplete: ${vmds.length} VMDs × 4 angles = ${vmds.length * 4 * frames.length} screenshots`);
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
