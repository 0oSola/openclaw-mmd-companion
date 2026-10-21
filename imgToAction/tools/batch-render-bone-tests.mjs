#!/usr/bin/env node
/**
 * Batch render multiple VMDs in a single browser session.
 * Loads the PMX model once, then for each VMD: loads VMD, seeks frames, screenshots.
 *
 * Usage:
 *   node.exe imgToAction/tools/batch-render-bone-tests.mjs \
 *     --vmds "vmd1.vmd,vmd2.vmd,..." \
 *     --out-base "imgToAction/outputs/actions/20260702_batch" \
 *     --frames 1,10 \
 *     --angles front,left,right,back \
 *     --web-url http://127.0.0.1:3100
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const MIME_TYPES = {
  ".pmx": "application/octet-stream", ".vmd": "application/octet-stream",
  ".png": "image/png", ".json": "application/json", ".tga": "application/octet-stream",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};

function startStaticServer(root) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (!url.pathname.startsWith("/files/")) { res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end("Not found"); return; }
      const decoded = decodeURIComponent(url.pathname.slice("/files/".length));
      const target = path.resolve(root, decoded);
      if ((target !== root && !target.startsWith(`${root}${path.sep}`)) || !existsSync(target)) {
        res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end("Not found: " + decoded); return;
      }
      res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": MIME_TYPES[path.extname(target).toLowerCase()] || "application/octet-stream" });
      createReadStream(target).pipe(res);
    } catch (e) { res.writeHead(500, { "Access-Control-Allow-Origin": "*" }); res.end(e?.message || String(e)); }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

function toServedUrl(baseUrl, filePath) {
  return `${baseUrl}/files/${path.relative(projectRoot, filePath).split(path.sep).map(encodeURIComponent).join("/")}`;
}

// Parse args
const args = process.argv.slice(2);
let vmds = [], outBase = "imgToAction/outputs/actions/batch", frames = [10], angles = ["front"], webUrl = "http://127.0.0.1:3100";
let modelPath = existsSync(path.resolve(projectRoot, "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx"))
  ? "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx"
  : "imgToAction/assets/pmx/优菈.pmx";
let metricsOnly = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--vmds") vmds = args[++i].split(",").map(s => s.trim()).filter(Boolean);
  else if (args[i] === "--out-base") outBase = args[++i];
  else if (args[i] === "--frames") frames = args[++i].split(",").map(s => parseInt(s.trim()));
  else if (args[i] === "--angles") angles = args[++i].split(",").map(s => s.trim());
  else if (args[i] === "--web-url") webUrl = args[++i];
  else if (args[i] === "--model") modelPath = args[++i];
  else if (args[i] === "--metrics-only") metricsOnly = true;
}

// Camera angles: azimuth rotation around the model
const ANGLE_CONFIGS = {
  front: { azimuth: 0, label: "front" },
  left:  { azimuth: 90, label: "left" },
  right: { azimuth: -90, label: "right" },
  back:  { azimuth: 180, label: "back" },
};

const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
const { chromium } = requireFromWeb("playwright");

async function main() {
  const staticServer = await startStaticServer(projectRoot);
  console.log(`Static server: ${staticServer.baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  page.on("console", msg => {
    const t = msg.type();
    if (t === "error" || t === "warning") {
      const text = msg.text();
      if (!/skinning|morphTargets|envMap|combine|GPU stall|ERR_NETWORK/.test(text)) {
        console.log(`[${t}] ${text}`);
      }
    }
  });

  // Load model once
  const modelUrl = toServedUrl(staticServer.baseUrl, modelPath);
  const renderUrl = `${webUrl}/mmd-calibration-render?modelUrl=${encodeURIComponent(modelUrl)}&renderPipeline=genshin`;
  console.log(`Loading model from ${renderUrl}`);
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });

  // Wait for runtime
  console.log("Waiting for model to load...");
  await page.waitForFunction(
    () => Boolean(window.__mmdCompanionRuntime?.model && !window.__mmdCompanionRuntime?.isLoadingVmd),
    null, { timeout: 60_000 }
  );
  console.log("Model loaded!");
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(500);

  // Get camera snapshot for angle control
  const baseCamera = await page.evaluate(() => window.__mmdCompanionRuntime?.getCameraSnapshot?.());
  console.log("Base camera:", JSON.stringify(baseCamera?.target), "distance:", baseCamera?.distance);

  let count = 0;
  const total = vmds.length;

  for (const vmdRelPath of vmds) {
    count++;
    const vmdName = path.basename(vmdRelPath, ".vmd");
    const vmdUrl = toServedUrl(staticServer.baseUrl, vmdRelPath);
    console.log(`\n[${count}/${total}] Loading VMD: ${vmdName}`);

    // Load VMD
    await page.evaluate(async (url) => {
      const rt = window.__mmdCompanionRuntime;
      rt?.setCalibrationCaptureMode?.(true);
      await rt?.playVmd?.(url, 1, [], { disableCrossfade: true });
      rt?.setCalibrationCaptureMode?.(true);
    }, vmdUrl);
    await page.waitForTimeout(2000);

    for (const angle of angles) {
      const angleConf = ANGLE_CONFIGS[angle];
      if (!angleConf) continue;

      // Set camera angle by rotating azimuth
      if (baseCamera && baseCamera.position && baseCamera.target) {
        await page.evaluate((cam, azimuth) => {
          const rt = window.__mmdCompanionRuntime;
          if (!rt || !cam) return;
          // Calculate new camera position by rotating around target
          const dx = cam.position[0] - cam.target[0];
          const dz = cam.position[2] - cam.target[2];
          const dist = Math.hypot(dx, dz);
          const baseAngle = Math.atan2(dx, dz);
          const newAngle = baseAngle + (azimuth * Math.PI / 180);
          const newPos = [
            cam.target[0] + dist * Math.sin(newAngle),
            cam.position[1], // keep height
            cam.target[2] + dist * Math.cos(newAngle),
          ];
          rt.applyCameraSnapshot?.({
            position: newPos,
            target: cam.target,
            fov: cam.fov || 33,
            locked: true,
          }, { locked: true });
        }, baseCamera, angleConf.azimuth);
        await page.waitForTimeout(100);
      }

      const angleDir = path.join(projectRoot, outBase, vmdName, angle);
      mkdirSync(angleDir, { recursive: true });

      for (const frame of frames) {
        await page.evaluate((f) => window.__mmdCompanionRuntime?.seekVmdFrame?.(f, 30), frame);
        await page.waitForTimeout(150);

        if (!metricsOnly) {
          const screenshotPath = path.join(angleDir, `frame_${String(frame).padStart(3, "0")}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: false });
        }

        // Collect metrics
        const metrics = await page.evaluate(() => {
          const rt = window.__mmdCompanionRuntime;
          const model = rt?.model;
          const skel = model?.skeleton;
          if (!skel) return { error: "no skeleton" };
          const boneQuats = {};
          for (const bn of ["右足首","右足","右ひざ","左足首","左足","左ひざ","右腕","右ひじ","上半身","上半身2","首","頭","右肩","左腕","左ひじ","左肩","右つま先","左つま先"]) {
            const b = skel.bones.find(x => x.name === bn);
            if (b) boneQuats[bn] = { x: +b.quaternion.x.toFixed(6), y: +b.quaternion.y.toFixed(6), z: +b.quaternion.z.toFixed(6), w: +b.quaternion.w.toFixed(6) };
          }
          return { bone_quaternions: boneQuats };
        });

        const metricPath = path.join(angleDir, `frame_${String(frame).padStart(3, "0")}_metrics.json`);
        writeFileSync(metricPath, JSON.stringify({ vmd: vmdName, angle, frame, ...metrics }, null, 2));
      }
    }
    console.log(`  Done: ${vmdName} (${angles.length} angles × ${frames.length} frames)`);
  }

  await browser.close();
  staticServer.server.close();
  console.log(`\nBatch complete: ${total} VMDs rendered`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
