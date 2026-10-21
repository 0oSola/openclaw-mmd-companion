import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
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
  const page = await browser.newPage();

  const modelPath = "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx";
  const modelUrl = `${staticServer.baseUrl}/files/${modelPath.split("/").map(encodeURIComponent).join("/")}`;
  const renderUrl = `http://127.0.0.1:3100/mmd-calibration-render?modelUrl=${encodeURIComponent(modelUrl)}&renderPipeline=genshin`;
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime?.model), null, { timeout: 60_000 });

  const result = await page.evaluate(() => {
    const skel = window.__mmdCompanionRuntime?.model?.skeleton;
    if (!skel) return { error: "no skeleton" };
    
    // All bones with their indices
    const allBones = skel.bones.map((b, i) => ({ name: b.name, index: i }));
    
    // Filter finger-related bones
    const fingerKeywords = ['指', '指先', 'finger', 'hand', '手首', '手', '親', '人差', '中', '薬', '小指'];
    const fingerBones = allBones.filter(b => {
      return fingerKeywords.some(kw => b.name.includes(kw));
    });
    
    // Also find all bones that are children of wrist bones
    const wristBones = allBones.filter(b => b.name === '右手首' || b.name === '左手首');
    
    return {
      totalBones: allBones.length,
      fingerBones: fingerBones.map(b => b.name),
      wristBones: wristBones.map(b => b.name),
      // Also list all bones containing 指 or finger
      allHandBones: allBones.filter(b => b.name.includes('指') || b.name.includes('finger')).map(b => `${b.index}:${b.name}`),
    };
  });

  console.log("Total bones:", result.totalBones);
  console.log("\nFinger-related bones:", JSON.stringify(result.fingerBones, null, 2));
  console.log("\nBones with 指/finger:", JSON.stringify(result.allHandBones, null, 2));

  await browser.close();
  staticServer.server.close();
}
main().catch(e => { console.error(e); process.exit(1); });
