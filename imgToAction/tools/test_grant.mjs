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
    const types = {".pmx":"application/octet-stream",".vmd":"application/octet-stream"};
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
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(500);

  const outDir = path.join(projectRoot, "imgToAction/outputs/actions/20260702_grant_test");
  mkdirSync(outDir, { recursive: true });

  // Step 1: Rest screenshot
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    const skel = model.skeleton;
    for (const b of skel.bones) { b.quaternion.set(0,0,0,1); b.position.set(0,0,0); }
    model.updateMatrixWorld(true);
    skel.update();
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, "rest.png") });
  console.log("Rest screenshot");

  // Step 2: Rotate 右足首D directly (the actual deform bone)
  const result = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    const skel = model.skeleton;
    
    // Find the D bone
    const ankleD = skel.bones.find(b => b.name === '右足首D');
    if (!ankleD) return { error: "no 右足首D" };
    
    ankleD.quaternion.set(0.7071, 0, 0, 0.7071).normalize();
    model.updateMatrixWorld(true);
    skel.update();
    
    const idx = skel.bones.indexOf(ankleD);
    const mat = Array.from(skel.boneMatrices.slice(idx*16, idx*16+4));
    return { found: true, idx, mat: mat.map(v=>+v.toFixed(4)) };
  });
  console.log("Rotate 右足首D:", JSON.stringify(result));
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, "ankleD_x90.png") });
  console.log("AnkleD X90 screenshot");

  // Step 3: Reset and rotate 右足D (thigh deform bone)
  await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    const skel = model.skeleton;
    const ankleD = skel.bones.find(b => b.name === '右足首D');
    if (ankleD) ankleD.quaternion.set(0,0,0,1);
    
    const hipD = skel.bones.find(b => b.name === '右足D');
    if (hipD) hipD.quaternion.set(0.7071, 0, 0, 0.7071).normalize();
    
    model.updateMatrixWorld(true);
    skel.update();
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(outDir, "hipD_x90.png") });
  console.log("HipD X90 screenshot");

  // Step 4: List all D bones
  const dBones = await page.evaluate(() => {
    const skel = window.__mmdCompanionRuntime?.model?.skeleton;
    if (!skel) return [];
    return skel.bones.filter(b => b.name.includes('D') && !b.name.includes('IK')).map(b => b.name).sort();
  });
  console.log("D bones:", JSON.stringify(dBones));

  await browser.close();
  staticServer.server.close();
}
main().catch(e => { console.error(e); process.exit(1); });
