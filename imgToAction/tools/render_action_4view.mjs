#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

function startStaticServer(root) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (!url.pathname.startsWith("/files/")) {
        res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        res.end();
        return;
      }
      const decoded = decodeURIComponent(url.pathname.slice("/files/".length));
      const target = path.resolve(root, decoded);
      if ((target !== root && !target.startsWith(root + path.sep)) || !existsSync(target)) {
        res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        res.end();
        return;
      }
      const types = {
        ".pmx": "application/octet-stream",
        ".vmd": "application/octet-stream",
        ".png": "image/png",
        ".json": "application/json",
      };
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": types[path.extname(target).toLowerCase()] || "application/octet-stream",
      });
      createReadStream(target).on("error", (error) => console.error(`[static stream] ${target}: ${error.message}`)).pipe(res);
    } catch (error) {
      console.error(`[static 500] ${req.url}: ${error instanceof Error ? error.message : String(error)}`);
      res.writeHead(500, { "Access-Control-Allow-Origin": "*" });
      res.end(error instanceof Error ? error.message : String(error));
    }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

function toServedUrl(baseUrl, filePath) {
  return `${baseUrl}/files/${path
    .relative(projectRoot, filePath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/")}`;
}

function playwrightLaunchEnv() {
  const localLibDir = path.join(projectRoot, ".local-playwright-libs", "usr", "lib", "x86_64-linux-gnu");
  if (!existsSync(localLibDir)) return process.env;
  const current = process.env.LD_LIBRARY_PATH || "";
  return {
    ...process.env,
    LD_LIBRARY_PATH: current ? `${localLibDir}:${current}` : localLibDir,
  };
}

function parseFrames(value) {
  return String(value || "0,10,20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,210")
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item >= 0);
}

function parseArgs(argv) {
  const args = {
    vmdName: process.env.IMGTOACTION_VMD_NAME || "eula_elegant_thinking_generated",
    outDirName: process.env.IMGTOACTION_RENDER_DIR || "elegant_thinking_generated_render",
    webUrl: process.env.IMGTOACTION_WEB_URL || "http://127.0.0.1:3100",
    frames: parseFrames(process.env.IMGTOACTION_RENDER_FRAMES),
    screenshots: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--vmd-name") {
      args.vmdName = next;
      i += 1;
    } else if (arg === "--out-dir") {
      args.outDirName = next;
      i += 1;
    } else if (arg === "--web-url") {
      args.webUrl = next;
      i += 1;
    } else if (arg === "--frames") {
      args.frames = parseFrames(next);
      i += 1;
    } else if (arg === "--no-screenshots") {
      args.screenshots = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const modelPath = path.join(projectRoot, "MMD", "优菈_by_原神_339146e6e418d79e85a515b26414c0b0", "优菈.pmx");
const angles = [
  { name: "front", theta: 0 },
  { name: "right", theta: -Math.PI / 2 },
  { name: "back", theta: Math.PI },
  { name: "left", theta: Math.PI / 2 },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vmdPath = path.join(projectRoot, "imgToAction", "outputs", "vmd", `${args.vmdName}.vmd`);
  const outBase = path.join(projectRoot, "imgToAction", "outputs", "actions", args.outDirName);
  if (!existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
  if (!existsSync(vmdPath)) throw new Error(`VMD not found: ${vmdPath}`);

  const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
  const { chromium } = requireFromWeb("playwright");
  const staticServer = await startStaticServer(projectRoot);
  const browser = await chromium.launch({ headless: true, env: playwrightLaunchEnv() });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!/skinning|morph|envMap|combine|GPU|ERR_NETWORK/.test(text)) console.log(`[err] ${text}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) console.log(`[http ${response.status()}] ${response.url()}`);
  });

  try {
    const modelUrl = toServedUrl(staticServer.baseUrl, modelPath);
    const renderUrl = new URL("/mmd-calibration-render", args.webUrl);
    renderUrl.searchParams.set("modelUrl", modelUrl);
    renderUrl.searchParams.set("renderPipeline", "genshin");
    console.log("Loading model...");
    await page.goto(renderUrl.href, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime?.model && !window.__mmdCompanionRuntime?.isLoadingVmd), null, {
      timeout: 60000,
    });
    console.log("Model loaded");
    await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
    await page.waitForTimeout(300);
    const baseCamera = await page.evaluate(() => window.__mmdCompanionRuntime?.getCameraSnapshot?.());
    const vmdUrl = toServedUrl(staticServer.baseUrl, vmdPath);
    const loaded = await page.evaluate(async (url) => {
      const rt = window.__mmdCompanionRuntime;
      if (!rt?.model || !rt.loader) return false;
      rt.setCalibrationCaptureMode?.(true);
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const parser = rt.loader._getParser ? rt.loader._getParser() : null;
      if (!parser) return false;
      const vmd = parser.parseVmd(buffer, true);
      const target = rt.animationBuildTarget || rt.model;
      rt.currentClip = rt.loader.animationBuilder.build(vmd, target);
      rt.setCalibrationCaptureMode?.(true);
      return true;
    }, vmdUrl);
    if (!loaded) throw new Error(`Failed to load VMD: ${vmdPath}`);

    const allBoneFrames = [];
    let count = 0;
    for (const frame of args.frames) {
      await page.evaluate((f) => window.__mmdCompanionRuntime?.seekVmdFrame?.(f, 30), frame);
      await page.waitForTimeout(120);
      const boneData = await page.evaluate(() => {
        const rt = window.__mmdCompanionRuntime;
        if (!rt?.model) return null;
        const joints = {};
        const rotations = {};
        for (const bone of rt.model?.skeleton?.bones || []) {
          if (!bone.name) continue;
          bone.updateMatrixWorld();
          const e = bone.matrixWorld.elements;
          joints[bone.name] = [e[12], e[13], e[14]];
          rotations[bone.name] = [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w];
        }
        return { joints, rotations };
      });
      if (boneData) allBoneFrames.push({ index: frame, ...boneData });

      for (const angle of args.screenshots ? angles : []) {
        await page.evaluate(
          ({ cam, az }) => {
            const rt = window.__mmdCompanionRuntime;
            if (!rt || !cam) return;
            const dx = cam.position[0] - cam.target[0];
            const dz = cam.position[2] - cam.target[2];
            const radius = Math.sqrt(dx * dx + dz * dz);
            const base = Math.atan2(dx, dz);
            const a = base + az;
            rt.camera.position.set(cam.target[0] + radius * Math.sin(a), cam.position[1], cam.target[2] + radius * Math.cos(a));
            rt.camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
          },
          { cam: baseCamera, az: angle.theta },
        );
        await page.waitForTimeout(60);
        const outDir = path.join(outBase, args.vmdName, angle.name);
        mkdirSync(outDir, { recursive: true });
        const fs = String(frame).padStart(3, "0");
        await page.screenshot({ path: path.join(outDir, `${args.vmdName}_f${fs}.png`), type: "png" });
        count += 1;
      }
      console.log(`OK ${args.vmdName} f${frame}`);
    }

    mkdirSync(outBase, { recursive: true });
    writeFileSync(path.join(outBase, "rendered_bone_frames.json"), `${JSON.stringify(allBoneFrames, null, 2)}\n`, "utf8");
    writeFileSync(
      path.join(outBase, "render_manifest.json"),
      `${JSON.stringify(
        {
          vmd: path.relative(projectRoot, vmdPath).replaceAll(path.sep, "/"),
          out_dir: path.relative(projectRoot, outBase).replaceAll(path.sep, "/"),
          frames: args.frames,
          views: args.screenshots ? angles.map((angle) => angle.name) : [],
          screenshots: count,
          generated_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`Done: ${count} screenshots, ${allBoneFrames.length} bone frames exported`);
  } finally {
    await browser.close();
    staticServer.server.close();
  }
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
