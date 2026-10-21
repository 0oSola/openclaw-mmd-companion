import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const MIME_TYPES = { ".pmx":"application/octet-stream",".vmd":"application/octet-stream",".png":"image/png",".json":"application/json",".tga":"application/octet-stream" };

function startStaticServer(root) {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (!url.pathname.startsWith("/files/")) {
        response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        response.end("Not found");
        return;
      }
      const decodedPath = decodeURIComponent(url.pathname.slice("/files/".length));
      const target = path.resolve(root, decodedPath);
      if ((target !== root && !target.startsWith(`${root}${path.sep}`)) || !existsSync(target)) {
        response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        response.end("Not found: " + decodedPath);
        return;
      }
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": MIME_TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
      });
      createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(500, { "Access-Control-Allow-Origin": "*" });
      response.end(error?.message || String(error));
    }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
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

for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  const ready = await page.evaluate(() => !!window.__mmdCompanionRuntime?.model);
  if (ready) { console.log(`Model loaded after ${i+1} attempts`); break; }
  if (i === 29) console.log("Model failed to load after 30 attempts");
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
  await page.waitForTimeout(500);
  
  const diag = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt?.model;
    const skel = model?.skeleton;
    if (!skel) return { error: "no skeleton" };
    
    const ankle = skel.bones.find(b => b.name === '右足首');
    if (!ankle) return { error: "no ankle" };
    
    const ankleIdx = skel.bones.indexOf(ankle);
    const boneMatStart = ankleIdx * 16;
    const boneMatSlice = skel.boneMatrices ? Array.from(skel.boneMatrices.slice(boneMatStart, boneMatStart + 16)).map(v => +v.toFixed(4)) : null;
    const mw = ankle.matrixWorld.elements.map(v => +v.toFixed(4));
    const ml = ankle.matrix.elements.map(v => +v.toFixed(4));
    
    return {
      ankleQuat: [+ankle.quaternion.x.toFixed(6), +ankle.quaternion.y.toFixed(6), +ankle.quaternion.z.toFixed(6), +ankle.quaternion.w.toFixed(6)],
      ankleIdx,
      boneMatSlice,
      matrixWorld: mw,
      matrixLocal: ml,
    };
  });
  console.log(`\nFrame ${frame}:`, JSON.stringify(diag, null, 2));
}

await browser.close();
staticServer.server.close();
