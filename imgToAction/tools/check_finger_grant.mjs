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
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt?.model;
    const skel = model?.skeleton;
    const geo = model?.geometry;
    if (!skel) return { error: "no skeleton" };
    
    // Check PMX bone data for grants
    const mmdData = geo?.userData?.MMD;
    const bones = mmdData?.bones || [];
    const grants = mmdData?.grants || [];
    
    // Check vertex weights for finger bones
    const skinIndices = geo?.attributes?.skinIndex;
    const skinWeights = geo?.attributes?.skinWeight;
    const allBones = skel.bones;
    
    const fingerNames = [
      '右人指１','右人指２','右人指３','右人指先',
      '左人指１','左人指２','左人指３','左人指先',
      '右中指１','右中指２','右中指３',
      '左中指１','左中指２','左中指３',
      '右小指１','右小指２','右小指３',
      '左小指１','左小指２','左小指３',
      '右親指０','右親指１','右親指２',
      '左親指０','左親指１','左親指２',
      '右手捩','右手捩1','右手捩2','右手捩3',
      '左手捩','左手捩1','左手捩2','左手捩3',
    ];
    
    // Check vertex weights
    const weightCount = {};
    if (skinIndices) {
      for (let i = 0; i < skinIndices.count; i++) {
        const si = [skinIndices.getX(i), skinIndices.getY(i), skinIndices.getZ(i), skinIndices.getW(i)];
        for (const idx of si) {
          if (idx >= 0) {
            const name = allBones[idx]?.name || `bone_${idx}`;
            if (fingerNames.includes(name) || name.includes('指') || name.includes('捩')) {
              weightCount[name] = (weightCount[name] || 0) + 1;
            }
          }
        }
      }
    }
    
    // Check grants that affect finger bones
    const fingerGrants = grants.filter(g => {
      const srcName = allBones[g.boneIndex]?.name || '';
      const dstName = allBones[g.targetBoneIndex]?.name || '';
      return srcName.includes('指') || dstName.includes('指') || srcName.includes('捩') || dstName.includes('捩');
    }).map(g => ({
      source: allBones[g.boneIndex]?.name,
      target: allBones[g.targetBoneIndex]?.name,
      rotation: g.rotationRate,
      translation: g.translationRate,
    }));
    
    // Check PMX bone flags for finger bones
    const fingerBoneInfo = {};
    for (const name of fingerNames) {
      const bone = allBones.find(b => b.name === name);
      if (!bone) { fingerBoneInfo[name] = { found: false }; continue; }
      const idx = allBones.indexOf(bone);
      const mmdBone = bones[idx];
      fingerBoneInfo[name] = {
        found: true,
        index: idx,
        flags: mmdBone ? '0x' + (mmdBone.flag || 0).toString(16) : 'N/A',
        hasGrantRot: mmdBone ? (mmdBone.flag & 0x0100) !== 0 : false,
        hasGrantTrans: mmdBone ? (mmdBone.flag & 0x0200) !== 0 : false,
        grantRotTarget: mmdBone && (mmdBone.flag & 0x0100) ? allBones[mmdBone.grantRotation?.parentIndex]?.name : null,
        grantRotRate: mmdBone?.grantRotation?.ratio,
      };
    }
    
    return {
      vertexWeights: Object.fromEntries(Object.entries(weightCount).sort((a,b) => b[1] - a[1])),
      fingerGrants,
      fingerBoneInfo,
    };
  });

  console.log("\n=== Vertex weights (finger bones) ===");
  console.log(JSON.stringify(result.vertexWeights, null, 2));
  console.log("\n=== Grants affecting finger bones ===");
  console.log(JSON.stringify(result.fingerGrants, null, 2));
  console.log("\n=== Finger bone info (flags & grants) ===");
  for (const [name, info] of Object.entries(result.fingerBoneInfo)) {
    if (info.found) {
      console.log(`  ${name}: idx=${info.index} flags=${info.flags} grantRot=${info.hasGrantRot} grantRotTarget=${info.grantRotTarget || '-'} rate=${info.grantRotRate ?? '-'}`);
    } else {
      console.log(`  ${name}: NOT FOUND`);
    }
  }

  await browser.close();
  staticServer.server.close();
}
main().catch(e => { console.error(e); process.exit(1); });
