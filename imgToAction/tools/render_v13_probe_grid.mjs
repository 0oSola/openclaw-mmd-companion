#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": path.extname(target).toLowerCase() === ".png" ? "image/png" : "application/octet-stream",
      });
      createReadStream(target).pipe(res);
    } catch (error) {
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
  return { ...process.env, LD_LIBRARY_PATH: current ? `${localLibDir}:${current}` : localLibDir };
}

function parseArgs(argv) {
  const args = {
    manifest: "imgToAction/outputs/vmd/v13_probe_grid.json",
    outDir: "imgToAction/outputs/actions/v13_probe_grid",
    webUrl: "http://127.0.0.1:3100",
    frames: [160],
    candidateNames: null,
    screenshots: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--manifest") {
      args.manifest = next;
      index += 1;
    } else if (arg === "--out-dir") {
      args.outDir = next;
      index += 1;
    } else if (arg === "--web-url") {
      args.webUrl = next;
      index += 1;
    } else if (arg === "--frame") {
      args.frames = [Number.parseInt(next, 10)];
      index += 1;
    } else if (arg === "--frames") {
      args.frames = next.split(",").map((value) => Number.parseInt(value.trim(), 10)).filter(Number.isFinite);
      index += 1;
    } else if (arg === "--candidate-names") {
      args.candidateNames = new Set(next.split(",").map((value) => value.trim()).filter(Boolean));
      index += 1;
    } else if (arg === "--no-screenshots") {
      args.screenshots = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.frames.length) throw new Error("At least one frame is required");
  return args;
}

const modelPath = path.join(projectRoot, "MMD", "优菈_by_原神_339146e6e418d79e85a515b26414c0b0", "优菈.pmx");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(projectRoot, args.manifest);
  const outBase = path.resolve(projectRoot, args.outDir);
  const probeManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const candidates = (probeManifest.candidates || []).filter(
    (candidate) => !args.candidateNames || args.candidateNames.has(candidate.name),
  );
  if (!candidates.length) throw new Error(`No candidates in ${manifestPath}`);
  if (!existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);

  const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
  const { chromium } = requireFromWeb("playwright");
  const staticServer = await startStaticServer(projectRoot);
  const browser = await chromium.launch({ headless: true, env: playwrightLaunchEnv() });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/skinning|morph|envMap|combine|GPU|ERR_NETWORK/.test(msg.text())) {
      console.log(`[err] ${msg.text()}`);
    }
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
    await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));
    await page.waitForTimeout(300);
    console.log(`Model loaded; rendering ${candidates.length} candidates`);

    const results = [];
    mkdirSync(outBase, { recursive: true });
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const vmdPath = path.resolve(projectRoot, candidate.vmd);
      const vmdUrl = toServedUrl(staticServer.baseUrl, vmdPath);
      const loaded = await page.evaluate(async (url) => {
        const rt = window.__mmdCompanionRuntime;
        if (!rt?.model || !rt.loader) return false;
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const parser = rt.loader._getParser ? rt.loader._getParser() : null;
        if (!parser) return false;
        const vmd = parser.parseVmd(buffer, true);
        rt.currentClip = rt.loader.animationBuilder.build(vmd, rt.animationBuildTarget || rt.model);
        rt.setCalibrationCaptureMode?.(true);
        return true;
      }, vmdUrl);
      if (!loaded) throw new Error(`Failed to load ${vmdPath}`);

      const candidateDir = path.join(outBase, candidate.name);
      mkdirSync(candidateDir, { recursive: true });
      const renderedFrames = [];
      for (const frame of args.frames) {
        await page.evaluate((targetFrame) => window.__mmdCompanionRuntime?.seekVmdFrame?.(targetFrame, 30), frame);
        await page.waitForTimeout(40);
        const boneData = await page.evaluate(() => {
          const rt = window.__mmdCompanionRuntime;
          if (!rt?.model) return null;
          const joints = {};
          const rotations = {};
          for (const bone of rt.model.skeleton?.bones || []) {
            if (!bone.name) continue;
            bone.updateMatrixWorld();
            const elements = bone.matrixWorld.elements;
            joints[bone.name] = [elements[12], elements[13], elements[14]];
            rotations[bone.name] = [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w];
          }
          return { joints, rotations };
        });
        if (boneData) renderedFrames.push({ index: frame, ...boneData });
        if (args.screenshots) {
          await page.screenshot({ path: path.join(candidateDir, `${candidate.name}_f${String(frame).padStart(3, "0")}.png`) });
        }
      }
      writeFileSync(path.join(candidateDir, "rendered_bone_frames.json"), `${JSON.stringify(renderedFrames, null, 2)}\n`, "utf8");
      results.push({ ...candidate, rendered_bone_frames: path.relative(projectRoot, path.join(candidateDir, "rendered_bone_frames.json")).replaceAll(path.sep, "/") });
      if ((index + 1) % 10 === 0 || index + 1 === candidates.length) {
        console.log(`Rendered ${index + 1}/${candidates.length}`);
      }
    }

    writeFileSync(
      path.join(outBase, "probe_results.json"),
      `${JSON.stringify(
        {
          frame: args.frames.length === 1 ? args.frames[0] : null,
          frames: args.frames,
          screenshots: args.screenshots,
          candidates: results,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`Done: ${results.length} candidates -> ${path.relative(projectRoot, outBase)}`);
  } finally {
    await browser.close();
    staticServer.server.close();
  }
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
