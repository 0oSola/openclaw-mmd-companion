import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

function startStaticServer(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost`);
    if (!url.pathname.startsWith("/files/")) { res.writeHead(404); res.end(); return; }
    const decodedPath = decodeURIComponent(url.pathname.slice("/files/".length));
    const filePath = path.join(root, decodedPath);
    if (!existsSync(filePath)) { res.writeHead(404); res.end("Not found: " + decodedPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    const types = { ".pmx":"application/octet-stream",".vmd":"application/octet-stream",".png":"image/png",".json":"application/json" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    const s = server.listen(0, "127.0.0.1", () => resolve({ server: s, baseUrl: `http://127.0.0.1:${s.address().port}` }));
  });
}

function toServedUrl(baseUrl, filePath) {
  return `${baseUrl}/files/${path.relative(projectRoot, filePath).split(path.sep).map(encodeURIComponent).join("/")}`;
}

const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
const { chromium } = requireFromWeb("playwright");

const staticServer = await startStaticServer(projectRoot);
console.log("Static server:", staticServer.baseUrl);

const modelPath = "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx";
const vmdPath = "imgToAction/outputs/vmd/basic_tests/basic_r_ankle_xp.vmd";
const modelUrl = toServedUrl(staticServer.baseUrl, modelPath);
const vmdUrl = toServedUrl(staticServer.baseUrl, vmdPath);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (msg) => { if (msg.type() === "error" || msg.type() === "warning") console.log(`[${msg.type()}]`, msg.text()); });

const renderUrl = `http://127.0.0.1:3100/mmd-calibration-render?modelUrl=${encodeURIComponent(modelUrl)}&renderPipeline=genshin`;
console.log("Render URL:", renderUrl);
await page.goto(renderUrl, { waitUntil: "domcontentloaded" });

// Wait for runtime
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  const ready = await page.evaluate(() => !!window.__mmdCompanionRuntime?.model);
  console.log(`Attempt ${i+1}: model=${ready}`);
  if (ready) break;
}

// Load VMD
const loaded = await page.evaluate(async (url) => {
  const rt = window.__mmdCompanionRuntime;
  rt?.setCalibrationCaptureMode?.(true);
  const result = await rt?.playVmd?.(url, 1, [], { disableCrossfade: true });
  rt?.setCalibrationCaptureMode?.(true);
  return result !== false;
}, vmdUrl);
console.log("VMD loaded:", loaded);
await page.waitForTimeout(3000);

// Seek to frame 1 (rest) and frame 10 (45deg rotation)
for (const frame of [1, 10]) {
  await page.evaluate((f) => window.__mmdCompanionRuntime?.seekVmdFrame?.(f, 30), frame);
  await page.waitForTimeout(300);
  
  const diag = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt?.model;
    const skel = model?.skeleton;
    if (!skel) return { error: "no skeleton" };
    
    const ankle = skel.bones.find(b => b.name === '右足首');
    if (!ankle) return { error: "no ankle" };
    
    const ankleIdx = skel.bones.indexOf(ankle);
    
    // Read boneMatrices (the Float32Array used by bone texture)
    const boneMatStart = ankleIdx * 16;
    const boneMatSlice = skel.boneMatrices ? Array.from(skel.boneMatrices.slice(boneMatStart, boneMatStart + 16)).map(v => +v.toFixed(4)) : null;
    
    // Also read ankle's world matrix
    const mw = ankle.matrixWorld.elements.map(v => +v.toFixed(4));
    
    // Read ankle's local matrix
    const ml = ankle.matrix.elements.map(v => +v.toFixed(4));
    
    return {
      frame: rt?.currentVmdAction?.time || 'unknown',
      ankleQuat: [+ankle.quaternion.x.toFixed(6), +ankle.quaternion.y.toFixed(6), +ankle.quaternion.z.toFixed(6), +ankle.quaternion.w.toFixed(6)],
      ankleIdx,
      boneMatSlice,  // This is what GPU actually uses
      matrixWorld: mw,
      matrixLocal: ml,
      boneTextureExists: !!skel.boneTexture,
      boneTextureSize: skel.boneTexture?.image?.width + 'x' + skel.boneTexture?.image?.height,
    };
  });
  console.log(`\nFrame ${frame}:`, JSON.stringify(diag, null, 2));
}

await browser.close();
staticServer.server.close();
