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
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    const skel = model.skeleton;
    const geo = model.geometry;
    
    // Find all bones with IK in name or leg-related
    const legBones = [];
    const allBones = skel.bones;
    
    // Check geometry userData for IK data
    const mmdData = geo?.userData?.MMD;
    const iks = mmdData?.iks || [];
    const bones = mmdData?.bones || [];
    
    // Find leg bones
    const legNames = ['右足', '右ひざ', '右足首', '右つま先', '右足ＩＫ', '右つま先ＩＫ', 
                      '左足', '左ひざ', '左足首', '左つま先', '左足ＩＫ', '左つま先ＩＫ',
                      '右腕', '右ひじ', '右手首'];
    
    for (const name of legNames) {
      const bone = allBones.find(b => b.name === name);
      if (bone) {
        const idx = allBones.indexOf(bone);
        const mmdBone = bones[idx];
        legBones.push({
          name,
          index: idx,
          flags: mmdBone?.flag !== undefined ? '0x' + mmdBone.flag.toString(16) : 'N/A',
          hasIK: mmdBone?.ik !== undefined ? !!mmdBone.ik : false,
          transformAfterPhysics: mmdBone?.transformAfterPhysics || false,
          parent: mmdBone?.parentIndex !== undefined ? allBones[mmdBone.parentIndex]?.name : 'N/A',
        });
      } else {
        legBones.push({ name, notFound: true });
      }
    }
    
    // Check IK definitions
    const ikDefs = iks.map(ik => ({
      target: allBones[ik.target]?.name || ik.target,
      effector: allBones[ik.effector]?.name || ik.effector,
      iteration: ik.iteration,
      links: (ik.links || []).map(l => allBones[l.index]?.name || l.index),
    }));
    
    // Check vertex weights - count how many vertices use each leg bone
    const skinIndices = geo?.attributes?.skinIndex;
    const skinWeights = geo?.attributes?.skinWeight;
    const boneWeightCount = {};
    if (skinIndices) {
      for (let i = 0; i < skinIndices.count; i++) {
        const si = [skinIndices.getX(i), skinIndices.getY(i), skinIndices.getZ(i), skinIndices.getW(i)];
        for (const idx of si) {
          if (idx >= 0) {
            const name = allBones[idx]?.name || `bone_${idx}`;
            boneWeightCount[name] = (boneWeightCount[name] || 0) + 1;
          }
        }
      }
    }
    
    return {
      legBones,
      ikDefs,
      boneWeightCount: Object.fromEntries(Object.entries(boneWeightCount).filter(([k]) => 
        k.includes('足') || k.includes('ひざ') || k.includes('IK') || k.includes('腕') || k.includes('ひじ')
      ).sort((a,b) => b[1] - a[1])),
    };
  });

  console.log("Leg bones:", JSON.stringify(result.legBones, null, 2));
  console.log("\nIK definitions:", JSON.stringify(result.ikDefs, null, 2));
  console.log("\nVertex weights (leg/arm bones):", JSON.stringify(result.boneWeightCount, null, 2));

  await browser.close();
  staticServer.server.close();
}
main().catch(e => { console.error(e); process.exit(1); });
