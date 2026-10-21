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
const vmdFiles = [{ name: "front_depth_fabrik" }, { name: "front_depth_fabrik_v7" }];
const outBase = path.join(projectRoot, "imgToAction", "outputs", "actions", "stages_3_6_v7_render");
const angles = [{name:"front",theta:0},{name:"right",theta:-Math.PI/2},{name:"back",theta:Math.PI},{name:"left",theta:Math.PI/2}];
const testFrames = Array.from({length: 20}, (_, i) => i * 10);
const TPOSE = { right_shoulder: [-0.2471, 6.0384, 0.8999], chin: [0.0000, 6.8534, 1.1435], waist: [0.0000, 2.4484, 1.4077] };
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function length(v){return Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);}
const FRONT_AXIS = [0, 0.140048, 0.990145];

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
  await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
  await page.waitForTimeout(500);
  const baseCamera = await page.evaluate(() => window.__mmdCompanionRuntime?.getCameraSnapshot?.());
  const allMetrics = []; let count = 0;
  for (const vmd of vmdFiles) {
    const vmdPath = path.join(projectRoot, "imgToAction", "outputs", "vmd", vmd.name + ".vmd");
    if (!existsSync(vmdPath)) { console.log("SKIP " + vmd.name); continue; }
    const vmdUrl = toServedUrl(ss.baseUrl, vmdPath);
    const loaded = await page.evaluate(async (url) => {
      const rt = window.__mmdCompanionRuntime; if (!rt || !rt.model || !rt.loader) return false;
      rt.setCalibrationCaptureMode?.(true);
      const response = await fetch(url); const buffer = await response.arrayBuffer();
      const parser = rt.loader._getParser ? rt.loader._getParser() : null; if (!parser) return false;
      const v = parser.parseVmd(buffer, true); const target = rt.animationBuildTarget || rt.model;
      const clip = rt.loader.animationBuilder.build(v, target); rt.currentClip = clip; rt.setCalibrationCaptureMode?.(true); return true;
    }, vmdUrl);
    if (!loaded) { console.log("FAIL " + vmd.name); continue; }
    for (const frame of testFrames) {
      await page.evaluate((f) => window.__mmdCompanionRuntime?.seekVmdFrame?.(f, 30), frame);
      await page.waitForTimeout(150);
      const boneData = await page.evaluate(() => {
        const rt = window.__mmdCompanionRuntime; if (!rt || !rt.model) return null;
        const result = {}; const skeleton = rt.model?.skeleton;
        if (skeleton && skeleton.bones) { for (const bone of skeleton.bones) { if (bone.name) { bone.updateMatrixWorld(); const e = bone.matrixWorld.elements; result[bone.name] = [e[12], e[13], e[14]]; } } }
        return result;
      });
      if (boneData) {
        const wrist = boneData["右手首"]; const elbow = boneData["右ひじ"]; const shoulder = boneData["右肩"] || TPOSE.right_shoulder;
        const chin = TPOSE.chin; const waist = TPOSE.waist;
        const wo = wrist ? sub(wrist, shoulder) : [0,0,0]; const eo = elbow ? sub(elbow, shoulder) : [0,0,0];
        const wfd = wrist ? dot(wo, FRONT_AXIS) : 0; const efd = elbow ? dot(eo, FRONT_AXIS) : 0;
        const wtc = wrist ? length(sub(wrist, chin)) : 0;
        let ea = 0;
        if (wrist && elbow && shoulder) { const u = sub(elbow, shoulder); const l = sub(wrist, elbow); const ul = length(u), ll = length(l); if (ul > 1e-8 && ll > 1e-8) { const c = Math.max(-1, Math.min(1, dot(u, l) / (ul * ll))); ea = Math.acos(c) * 180 / Math.PI; } }
        const m = { vmd: vmd.name, frame, wrist_front_depth: Math.round(wfd*1000)/1000, elbow_front_depth: Math.round(efd*1000)/1000, wrist_to_chin: Math.round(wtc*1000)/1000, elbow_angle: Math.round(ea*10)/10 };
        allMetrics.push(m);
        console.log(`OK ${vmd.name} f${frame}: wfd=${m.wrist_front_depth}, chin=${m.wrist_to_chin}, ea=${m.elbow_angle}`);
      }
      for (const angle of angles) {
        await page.evaluate(({cam, az}) => { const rt = window.__mmdCompanionRuntime; if (!rt || !cam) return; const dx = cam.position[0] - cam.target[0]; const dz = cam.position[2] - cam.target[2]; const r = Math.sqrt(dx*dx + dz*dz); const a = Math.atan2(dx, dz) + az; rt.camera.position.set(cam.target[0] + r * Math.sin(a), cam.position[1], cam.target[2] + r * Math.cos(a)); rt.camera.lookAt(cam.target[0], cam.target[1], cam.target[2]); }, { cam: baseCamera, az: angle.theta });
        await page.waitForTimeout(80);
        const outDir = path.join(outBase, vmd.name, angle.name); mkdirSync(outDir, { recursive: true });
        const fs = String(frame).padStart(3, "0");
        await page.screenshot({ path: path.join(outDir, vmd.name + "_f" + fs + ".png"), type: "png" });
        count++;
      }
    }
  }
  await browser.close(); ss.server.close();
  mkdirSync(outBase, { recursive: true });
  writeFileSync(path.join(outBase, "comparison_metrics.json"), JSON.stringify(allMetrics, null, 2));
  console.log("Done: " + count + " screenshots");
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
