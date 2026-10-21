import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const projectRoot = "D:/workspace/MMD project";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  const page = await browser.newPage();

  const modelPath = "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx";
  const modelUrl = `${staticServer.baseUrl}/files/${modelPath.split("/").map(encodeURIComponent).join("/")}`;
  const renderUrl = `http://127.0.0.1:3100/mmd-calibration-render?modelUrl=${encodeURIComponent(modelUrl)}&renderPipeline=genshin`;
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime?.model), null, { timeout: 60_000 });
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(500);

  // Check if skeleton.update exists and works
  const result = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt?.model;
    const skel = model?.skeleton;
    if (!skel) return { error: "no skeleton" };
    
    // Test: manually set a bone rotation, call skeleton.update, check if boneMatrices changed
    const ankle = skel.bones.find(b => b.name === '右足首');
    if (!ankle) return { error: "no ankle bone" };
    
    const idx = skel.bones.indexOf(ankle);
    
    // Save original
    const origQuat = ankle.quaternion.clone();
    
    // Read boneMatrices before
    const beforeMat = Array.from(skel.boneMatrices.slice(idx*16, idx*16+16));
    
    // Set 90 degree rotation
    ankle.quaternion.set(0.7071, 0, 0, 0.7071).normalize();
    model.updateMatrixWorld(true);
    
    // Read after updateMatrixWorld (before skeleton.update)
    const afterMatrixWorld = Array.from(skel.boneMatrices.slice(idx*16, idx*16+16));
    
    // Call skeleton.update
    skel.update();
    
    // Read after skeleton.update
    const afterSkeletonUpdate = Array.from(skel.boneMatrices.slice(idx*16, idx*16+16));
    
    // Restore
    ankle.quaternion.copy(origQuat);
    model.updateMatrixWorld(true);
    skel.update();
    
    return {
      idx,
      beforeMat: beforeMat.map(v => +v.toFixed(4)),
      afterMatrixWorld: afterMatrixWorld.map(v => +v.toFixed(4)),
      afterSkeletonUpdate: afterSkeletonUpdate.map(v => +v.toFixed(4)),
      changed: JSON.stringify(beforeMat) !== JSON.stringify(afterSkeletonUpdate),
    };
  });
  
  console.log("Patch verification:", JSON.stringify(result, null, 2));
  
  await browser.close();
  staticServer.server.close();
}
main().catch(e => { console.error(e); process.exit(1); });
