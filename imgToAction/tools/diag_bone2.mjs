import { createRequire } from "node:module";
import path from "node:path";
const projectRoot = "D:/workspace/MMD project";
const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
const { chromium } = requireFromWeb("playwright");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("console", (msg) => console.log(`[browser ${msg.type()}]`, msg.text()));
page.on("pageerror", (err) => console.log(`[pageerror]`, err.message));

const url = "http://127.0.0.1:3100/mmd-calibration-render?modelUrl=http://127.0.0.1:3100/files/MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx&renderPipeline=genshin";
console.log("Navigating to:", url);
await page.goto(url, { waitUntil: "domcontentloaded" });
console.log("Page loaded, waiting for runtime...");

// Wait for runtime with polling
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  const hasRuntime = await page.evaluate(() => !!window.__mmdCompanionRuntime);
  if (hasRuntime) {
    const hasModel = await page.evaluate(() => !!window.__mmdCompanionRuntime?.model);
    console.log(`Attempt ${i+1}: runtime=${hasRuntime}, model=${hasModel}`);
    if (hasModel) break;
  } else {
    console.log(`Attempt ${i+1}: no runtime yet`);
  }
}

// Check state
const result = await page.evaluate(() => {
  const rt = window.__mmdCompanionRuntime;
  if (!rt) return { error: "no runtime", hasCanvas: !!document.querySelector('canvas') };
  if (!rt.model) return { error: "no model", hasCanvas: !!document.querySelector('canvas') };
  const skel = rt.model.skeleton;
  return {
    hasSkeleton: !!skel,
    boneCount: skel?.bones?.length || 0,
    hasBoneTexture: !!skel?.boneTexture,
  };
});
console.log("Final state:", JSON.stringify(result, null, 2));

await browser.close();
