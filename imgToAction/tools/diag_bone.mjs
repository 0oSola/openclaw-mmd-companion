import { createRequire } from "node:module";
import path from "node:path";
const projectRoot = "D:/workspace/MMD project";
const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
const { chromium } = requireFromWeb("playwright");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const url = "http://127.0.0.1:3100/mmd-calibration-render?modelUrl=http://127.0.0.1:3100/files/MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx&renderPipeline=genshin";
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(20000);

// Check runtime state
const result = await page.evaluate(() => {
  const rt = window.__mmdCompanionRuntime;
  if (!rt || !rt.model) return { error: "no runtime" };
  const skel = rt.model.skeleton;
  return {
    hasSkeleton: !!skel,
    hasSkeletonUpdate: typeof skel?.update === 'function',
    boneCount: skel?.bones?.length || 0,
    boneMatricesLength: skel?.boneMatrices?.length || 0,
    hasBoneTexture: !!skel?.boneTexture,
    boneTextureSize: skel?.boneTexture?.image?.width + 'x' + skel?.boneTexture?.image?.height,
    isInCalibMode: rt.calibrationCaptureMode,
    // Find right ankle bone
    ankleBone: skel?.bones?.find(b => b.name === '右足首')?.name || 'not found',
  };
});
console.log("Runtime state:", JSON.stringify(result, null, 2));

// Now load a VMD and test
const vmdUrl = "http://127.0.0.1:3100/files/imgToAction/outputs/vmd/basic_tests/basic_r_ankle_xp.vmd";
await page.evaluate(async (url) => {
  const rt = window.__mmdCompanionRuntime;
  rt?.setCalibrationCaptureMode?.(true);
  await rt?.playVmd?.(url, 1, [], { disableCrossfade: true });
  rt?.setCalibrationCaptureMode?.(true);
}, vmdUrl);
await page.waitForTimeout(5000);

// Seek to frame 10 and check bone world matrix
await page.evaluate(() => window.__mmdCompanionRuntime?.seekVmdFrame?.(10, 30));
await page.waitForTimeout(500);

// Check bone world position before and after skeleton.update
const diag = await page.evaluate(() => {
  const rt = window.__mmdCompanionRuntime;
  const model = rt?.model;
  const skel = model?.skeleton;
  if (!skel) return { error: "no skeleton" };
  
  // Find ankle bone
  const ankle = skel.bones.find(b => b.name === '右足首');
  if (!ankle) return { error: "no ankle bone" };
  
  // Before skeleton.update
  const beforeMatrixWorld = ankle.matrixWorld.elements.slice(0, 16).map(v => +v.toFixed(6));
  
  // Manually update
  model.updateMatrixWorld(true);
  const afterUpdateMatrix = ankle.matrixWorld.elements.slice(0, 16).map(v => +v.toFixed(6));
  
  // skeleton.update
  skel.update();
  const afterSkeletonUpdate = ankle.matrixWorld.elements.slice(0, 16).map(v => +v.toFixed(6));
  
  // Check boneMatrices array
  const ankleIndex = skel.bones.indexOf(ankle);
  const beforeBoneMat = skel.boneMatrices ? Array.from(skel.boneMatrices.slice(ankleIndex * 16, ankleIndex * 16 + 16)).map(v => +v.toFixed(6)) : null;
  
  return {
    ankleIndex,
    ankleQuat: [ankle.quaternion.x, ankle.quaternion.y, ankle.quaternion.z, ankle.quaternion.w],
    beforeMatrixWorld,
    afterUpdateMatrix,
    afterSkeletonUpdate,
    beforeBoneMat,
    boneTextureData: skel.boneTexture ? 'exists' : 'null',
  };
});
console.log("Bone state:", JSON.stringify(diag, null, 2));

await browser.close();
