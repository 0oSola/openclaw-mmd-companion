#!/usr/bin/env node
// Render multiple VMDs without playVmd - directly load VMD and apply bone tracks
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
let vmds = [], outBase = "imgToAction/outputs/actions/quick2", frames = [10], webUrl = "http://127.0.0.1:3100";
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
  for (const vmdPath of vmds) {
    count++;
    const vmdName = path.basename(vmdPath, ".vmd");
    const vmdUrl = toServedUrl(staticServer.baseUrl, vmdPath);
    console.log(`[${count}/${vmds.length}] ${vmdName}...`);
    const t1 = Date.now();

    // Load VMD using the runtime's loader, create clip, set as currentClip
    // Skip playVmd entirely - just load and set the clip
    const loaded = await page.evaluate(async (url) => {
      const rt = window.__mmdCompanionRuntime;
      if (!rt || !rt.model) return false;
      rt.setCalibrationCaptureMode?.(true);
      // Use the loader to load VMD animation
      const loader = rt.loader;
      if (!loader) return false;
      const target = rt.animationBuildTarget || rt.model;
      const clip = await new Promise((resolve, reject) => { loader.loadAnimation(url, target, resolve, undefined, reject);
      });
      rt.currentClip = clip;
      rt.setCalibrationCaptureMode?.(true);
      return true;
    }, vmdUrl);

    if (!loaded) {
      console.log("  Failed to load VMD, skipping");
      continue;
    }
    console.log(`  VMD loaded in ${((Date.now()-t1)/1000).toFixed(1)}s`);

    const outDir = path.join(projectRoot, outBase, vmdName);
    mkdirSync(outDir, { recursive: true });

    for (const frame of frames) {
      await page.evaluate((f) => window.__mmdCompanionRuntime?.seekVmdFrame?.(f, 30), frame);
      await page.waitForTimeout(200);
      const screenshotPath = path.join(outDir, `frame_${String(frame).padStart(3,"0")}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      const metrics = await page.evaluate(() => {
        const skel = window.__mmdCompanionRuntime?.model?.skeleton;
        if (!skel) return { error: "no skeleton" };
        const q = {};
        for (const bn of ["右足首","右足","右ひざ","右腕","右ひじ","上半身","首","頭","右つま先"]) {
          const b = skel.bones.find(x => x.name === bn);
          if (b) q[bn] = [+b.quaternion.x.toFixed(6),+b.quaternion.y.toFixed(6),+b.quaternion.z.toFixed(6),+b.quaternion.w.toFixed(6)];
        }
        return q;
      });
      writeFileSync(path.join(outDir, `frame_${String(frame).padStart(3,"0")}_metrics.json`), JSON.stringify(metrics, null, 2));
      console.log(`  frame ${frame}: 右足首=${JSON.stringify(metrics["右足首"]||"N/A")}`);
    }
    console.log(`  Done in ${((Date.now()-t1)/1000).toFixed(1)}s`);
  }

  await browser.close();
  staticServer.server.close();
  console.log(`\nComplete: ${vmds.length} VMDs`);
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
