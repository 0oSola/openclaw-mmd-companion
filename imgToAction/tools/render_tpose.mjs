import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const projectRoot = "D:\\workspace\\MMD project";
function startStaticServer(root) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/files/")) { res.writeHead(404, {"Access-Control-Allow-Origin":"*"}); res.end(); return; }
    const decoded = decodeURIComponent(url.pathname.slice("/files/".length));
    const target = path.resolve(root, decoded);
    if ((target !== root && !target.startsWith(root + path.sep)) || !existsSync(target)) { res.writeHead(404, {"Access-Control-Allow-Origin":"*"}); res.end(); return; }
    const types = {".pmx":"application/octet-stream",".vmd":"application/octet-stream",".png":"image/png",".json":"application/json"};
    res.writeHead(200, {"Access-Control-Allow-Origin":"*", "Content-Type": types[path.extname(target).toLowerCase()]||"application/octet-stream"});
    createReadStream(target).pipe(res);
  });
  return new Promise((resolve, reject) => { server.on("error", reject); server.listen(0, "127.0.0.1", () => resolve({server, baseUrl:"http://127.0.0.1:"+server.address().port})); });
}
function toServedUrl(baseUrl, filePath) { return baseUrl + "/files/" + path.relative(projectRoot, filePath).split(path.sep).map(encodeURIComponent).join("/"); }

const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
const { chromium } = requireFromWeb("playwright");

const modelPath = path.join("MMD", "优菈_by_原神_339146e6e418d79e85a515b26414c0b0", "优菈.pmx");
const OUT = path.join(projectRoot, "imgToAction", "outputs", "actions", "tpose_annotated");
mkdirSync(OUT, { recursive: true });

const ANGLES = [
  { name: "front", theta: 0 },
  { name: "right", theta: -Math.PI/2 },
  { name: "back",  theta: Math.PI },
  { name: "left",  theta: Math.PI/2 },
];

async function main() {
  const ss = await startStaticServer(projectRoot);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", msg => { if (msg.type() === "error") { const t = msg.text(); if (!/skinning|morph|envMap|combine|GPU|ERR_NETWORK/.test(t)) console.log("[err] " + t); } });
  const modelUrl = toServedUrl(ss.baseUrl, path.resolve(projectRoot, modelPath));
  const renderUrl = "http://127.0.0.1:3100/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  console.log("Loading model...");
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime?.model && !window.__mmdCompanionRuntime?.isLoadingVmd), null, { timeout: 60000 });
  console.log("Model loaded");
  
  // Set calibration mode (T-pose, no VMD)
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(1000);
  
  const baseCamera = await page.evaluate(() => window.__mmdCompanionRuntime?.getCameraSnapshot?.());
  console.log("Base camera:", baseCamera);
  
  // Take 4 screenshots
  for (const angle of ANGLES) {
    await page.evaluate(({cam, az}) => {
      const rt = window.__mmdCompanionRuntime; if (!rt || !cam) return;
      const dx = cam.position[0] - cam.target[0];
      const dz = cam.position[2] - cam.target[2];
      const r = Math.sqrt(dx*dx + dz*dz);
      const a = Math.atan2(dx, dz) + az;
      rt.camera.position.set(cam.target[0] + r * Math.sin(a), cam.position[1], cam.target[2] + r * Math.cos(a));
      rt.camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
    }, { cam: baseCamera, az: angle.theta });
    await page.waitForTimeout(500);
    
    const outPath = path.join(OUT, `tpose_${angle.name}.png`);
    await page.screenshot({ path: outPath, type: "png" });
    console.log(`OK ${angle.name}: ${outPath}`);
  }
  
  await browser.close();
  ss.server.close();
  console.log("Done: 4 screenshots");
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
