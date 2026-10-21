import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const projectRoot = "D:/workspace/MMD project";

function startStaticServer(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/files/")) { res.writeHead(404, {"Access-Control-Allow-Origin":"*"}); res.end(); return; }
    const decoded = decodeURIComponent(url.pathname.slice("/files/".length));
    const target = path.resolve(root, decoded);
    if (!existsSync(target)) { res.writeHead(404, {"Access-Control-Allow-Origin":"*"}); res.end(); return; }
    const types = {".pmx":"application/octet-stream",".vmd":"application/octet-stream",".tga":"application/octet-stream"};
    res.writeHead(200, {"Access-Control-Allow-Origin":"*","Content-Type": types[path.extname(target).toLowerCase()]||"application/octet-stream"});
    createReadStream(target).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({server, baseUrl:`http://127.0.0.1:${server.address().port}`}));
  });
}

const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
const { chromium } = requireFromWeb("playwright");

async function main() {
  const staticServer = await startStaticServer(projectRoot);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const modelPath = "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx";
  const modelUrl = `${staticServer.baseUrl}/files/${modelPath.split("/").map(encodeURIComponent).join("/")}`;
  const renderUrl = `http://127.0.0.1:3100/mmd-calibration-render?modelUrl=${encodeURIComponent(modelUrl)}&renderPipeline=genshin`;
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime?.model), null, { timeout: 60_000 });
  console.log("Model loaded");

  // Enable calibration mode (stops helper.update and renderFrame bone manipulation)
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(500);

  const outDir = path.join(projectRoot, "imgToAction/outputs/actions/20260702_direct_bone");
  mkdirSync(outDir, { recursive: true });

  // Step 1: Reset all bones to base, take screenshot
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    const skel = model.skeleton;
    // Reset all bones to identity
    for (const b of skel.bones) {
      b.quaternion.set(0, 0, 0, 1);
      b.position.set(0, 0, 0);
    }
    model.updateMatrixWorld(true);
    skel.update();
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, "rest.png") });
  console.log("Rest screenshot taken");

  // Step 2: Rotate right ankle 90° on X axis, take screenshot
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    const skel = model.skeleton;
    const ankle = skel.bones.find(b => b.name === '右足首');
    if (ankle) {
      ankle.quaternion.set(0.7071, 0, 0, 0.7071).normalize();
    }
    model.updateMatrixWorld(true);
    skel.update();
    // Verify the bone matrix changed
    const idx = skel.bones.indexOf(ankle);
    console.log('Ankle bone matrix after set:', Array.from(skel.boneMatrices.slice(idx*16, idx*16+4)).map(v=>+v.toFixed(4)));
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, "ankle_x90.png") });
  console.log("Ankle X90 screenshot taken");

  // Step 3: Rotate right hip (thigh) 90° on X axis
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    const skel = model.skeleton;
    // Reset ankle
    const ankle = skel.bones.find(b => b.name === '右足首');
    if (ankle) ankle.quaternion.set(0, 0, 0, 1);
    // Rotate hip
    const hip = skel.bones.find(b => b.name === '右足');
    if (hip) hip.quaternion.set(0.7071, 0, 0, 0.7071).normalize();
    model.updateMatrixWorld(true);
    skel.update();
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, "hip_x90.png") });
  console.log("Hip X90 screenshot taken");

  // Step 4: Rotate right arm 90° on X for comparison
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    const skel = model.skeleton;
    // Reset hip
    const hip = skel.bones.find(b => b.name === '右足');
    if (hip) hip.quaternion.set(0, 0, 0, 1);
    // Rotate arm
    const arm = skel.bones.find(b => b.name === '右腕');
    if (arm) arm.quaternion.set(0.7071, 0, 0, 0.7071).normalize();
    model.updateMatrixWorld(true);
    skel.update();
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, "arm_x90.png") });
  console.log("Arm X90 screenshot taken");

  await browser.close();
  staticServer.server.close();
}
main().catch(e => { console.error(e); process.exit(1); });
