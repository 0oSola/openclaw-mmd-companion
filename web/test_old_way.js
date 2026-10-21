// Quick test: run the OLD render-vmd-pose-check with a twist VMD
const { chromium } = require("playwright");
const { createServer } = require("node:http");
const { createReadStream, existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = "D:\\workspace\\MMD project";
const modelPath = "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx";
const vmdPath = "imgToAction/outputs/vmd/basic_tests/twist_r_wrist_xp90.vmd";
const outDir = path.join(projectRoot, "imgToAction/outputs/test_old_render");

mkdirSync(outDir, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".png": "image/png",
};

function startStaticServer() {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      const filePath = path.join(projectRoot, decodeURIComponent(req.url.replace("/files/", "")));
      const ext = path.extname(filePath);
      if (existsSync(filePath)) {
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404); res.end("Not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function main() {
  const staticServer = await startStaticServer();
  console.log("Static server:", staticServer.baseUrl);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1536 },
    deviceScaleFactor: 1,
  });

  const modelUrl = `${staticServer.baseUrl}/files/${modelPath.split(path.sep).join("/")}`;
  const vmdUrl = `${staticServer.baseUrl}/files/${vmdPath.split(path.sep).join("/")}`;
  
  const renderUrl = `http://127.0.0.1:3100/mmd-calibration-render?modelUrl=${encodeURIComponent(modelUrl)}&renderPipeline=genshin`;
  console.log("Loading:", renderUrl.substring(0, 80) + "...");
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model && !window.__mmdCompanionRuntime.isLoadingVmd), null, { timeout: 60000 });
  console.log("Model loaded");
  
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  
  // Load VMD
  const played = await page.evaluate(async (url) => {
    const rt = window.__mmdCompanionRuntime;
    const result = await rt?.playVmd?.(url, 1, [], { disableCrossfade: true });
    return result !== false;
  }, vmdUrl);
  console.log("VMD played:", played);
  await page.waitForFunction(() => !window.__mmdCompanionRuntime?.isLoadingVmd, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  
  // Seek
  await page.evaluate(() => window.__mmdCompanionRuntime?.seekVmdFrame?.(10, 30));
  await page.waitForTimeout(200);
  
  // Screenshot - page level like the old script
  const outPath = path.join(outDir, "frame_010.png");
  await page.screenshot({ path: outPath, fullPage: false });
  console.log("Screenshot:", fs.statSync(outPath).size, "bytes at", outPath);
  
  // Also canvas
  const canvasPath = path.join(outDir, "canvas_010.png");
  await page.locator("canvas").first().screenshot({ path: canvasPath });
  console.log("Canvas:", fs.statSync(canvasPath).size, "bytes");
  
  await browser.close();
  staticServer.server.close();
}

main().catch(e => { console.error(e); process.exit(1); });
