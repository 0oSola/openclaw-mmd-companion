// Stage 2B-M2 Web 侧采集（默认关闭诊断路径，仅本脚本触发）：
//   1) Face 三角形 ID + 插值 UV（专用 GPU pass，深度同 pick）+ 相机矩阵
//   2) normal / faceShadowOnly / finalFaceComposite 三种模式的 pre-tonemap HDR（线性）
//   3) Face pick mask
// 全部导出到 --outdir（默认 .scratch/v14d-face-uv-visibility/web）。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = process.env.CHROME_EXE || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3111/mmd-calibration-render";
const OUT = path.resolve(process.argv[2] || ".scratch/v14d-face-uv-visibility/web");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:/mmd/克莱妲原皮";
const PMX = path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:/w/rk3-face-v14d/web/public/assets/mmd/calibration/koleda-v14d/koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const STATE2_MASK_REL = "Textures/v14d-state2-mask/state2.png";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };

function collectModelFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/\.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name)) out.push(fp);
    }
  };
  walk(dir);
  return out;
}

function f32(arr) { return Array.from(arr, (v) => +v.toFixed(8)); }

async function main() {
  console.log("[export] start outdir=" + OUT);
  fs.mkdirSync(OUT, { recursive: true });
  const modelPaths = collectModelFiles(KOLEDA_DIR).filter((p) => path.resolve(p) !== path.resolve(FACE_D));
  console.log("[export] model files=" + modelPaths.length);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-triuv-chrome-"));
  console.log("[export] launching chrome profile=" + profile);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 },
    deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
  });
  console.log("[export] chrome launched");
  try {
    await context.route("**/*", (route) => {
      const url = route.request().url();
      const m = url.match(/[?&]v14dasset=([^&]+)/);
      if (!m) return route.continue();
      const key = decodeURIComponent(m[1]);
      if (key === "__manifest__") {
        const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).replace(/\\/g, "/"));
        rels.push(path.relative(KOLEDA_DIR, PMX).replace(/\\/g, "/"));
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) });
      }
      let filePath = null;
      if (key === "pmx") filePath = PMX;
      else if (key === "vmd") filePath = VMD;
      else if (key === "__mask__/state2") filePath = STATE2_MASK;
      else filePath = path.join(KOLEDA_DIR, key);
      if (filePath && fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(filePath) });
      }
      return route.fulfill({ status: 404, body: "missing " + key });
    });

    const page = context.pages()[0] ?? (await context.newPage());
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e)));
    console.log("[export] injecting assets");
    await page.addInitScript(async (payload) => {
      const fetchFile = async (key, rel, mime) => {
        const resp = await fetch(payload.route + "?v14dasset=" + encodeURIComponent(key));
        if (!resp.ok) throw new Error("asset " + key + " -> " + resp.status);
        const buf = await resp.arrayBuffer();
        const f = new File([buf], key.split("/").pop(), { type: mime || "application/octet-stream" });
        if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel });
        return f;
      };
      const manifest = await (await fetch(payload.route + "?v14dasset=__manifest__")).json();
      const modelFiles = [];
      for (const rel of manifest.files) {
        if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue;
        modelFiles.push(await fetchFile(rel, rel));
      }
      const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
      const pmxFile = await fetchFile(pmxRel, pmxRel);
      const vmdFile = await fetchFile("vmd", null);
      const faceOverride = await fetchFile("Textures/c_Koleda_slg_face_d.png", "Textures/c_Koleda_slg_face_d.png");
      const state2Mask = await fetchFile("__mask__/state2", payload.state2MaskRel, "image/png");
      window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride, bakedTextures: null, state2Mask };
    }, { route: "http://v14d-asset.local/a", state2MaskRel: STATE2_MASK_REL });
    console.log("[export] assets injected");
    // 把页面 console 转发到 Node 侧（诊断探针的 console.log 输出）。
    page.on("console", (msg) => { if (msg.text().startsWith("[expanded]")) console.log(msg.text()); });

    const modelUrl = "http://v14d-asset.local/a?v14dasset=pmx";
    const vmdUrl = "http://v14d-asset.local/a?v14dasset=vmd";
    const base = { modelUrl, vmdUrl, v14dFaceStatic: "1" };

    async function load(mode) {
      const q = new URLSearchParams({ ...base, v14dFaceMode: mode });
      await page.goto(BASE + "?" + q.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
      console.log("[export] page loaded mode=" + mode);
      await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 240000 });
      await page.waitForTimeout(3000); // reze fresh-patch 纹理异步绑定稳定化（已知时序敏感）
      console.log("[export] webgpu ready mode=" + mode);
      await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
      await page.waitForTimeout(1200);
    }

    // ── Stage 2B-M2 同口径采集（路线 B+ 根因修复）──
    // 历史缺陷：triUv 与 HDR pick 分属两个独立 page.evaluate，两者之间引擎内部
    // 蒙皮/相机时序存在 ~32px 位移，hdrFace ∩ triId 仅 226/4639。
    // 根因验证（.scratch/diag-pose-cmp.mjs）：在同一 page.evaluate 原子调用内
    // 先 HDR pick 后 triUv，两 pass 共享同一帧 CPU 蒙皮与相机状态，同像素 overlap
    // 达 4092/4639，且这 4092 个 pick 像素全部获得合法 triId。
    //
    // 新流程（不再逐模式 goto）：
    //   1) 单次加载 finalFaceComposite 模式，固定 VMD f120 + 权威相机。
    //   2) 在同一 page.evaluate 原子调用内先 HDR pick（webEligible 分母）
    //      再展开 triUv pass（真实 triId + UV + 相机矩阵），两者同帧同口径。
    //   3) 用页面内置的模式切换按钮（FaceStaticAssetPanel 的 setFaceStaticMode）
    //      依次切到 normal / faceShadowOnly，各做一次 exportFaceHdrFloat。
    //      三模式 HDR 与步骤 2 共享同一 VMD 姿势与权威相机（模式切换只改 Face 显示
    //      合成路径，不改几何/骨骼/VMD），Gate 用 UV/重心做同表面点对账，坐标系与
    //      相机一致，故三模式逐像素 RGB 可直接用于正式样本。
    await load("finalFaceComposite");

    // 步骤 2：HDR pick 与 triUv 在同一原子 evaluate 内（关键）。
    const atomic = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      if (!api || !api.exportFaceHdrFloat || !api.exportFaceTriUv) return null;
      const pick = await api.exportFaceHdrFloat();
      if (!pick) return null;
      const tri = await api.exportFaceTriUv();
      if (!tri) return null;
      return {
        pick: { width: pick.width, height: pick.height, faceMaterialId: pick.faceMaterialId, faceMask: Array.from(pick.faceMask) },
        tri: {
          width: tri.width, height: tri.height,
          faceMaterialId: tri.faceMaterialId, faceMaterialIndex: tri.faceMaterialIndex,
          faceMaterialFirstIndex: tri.faceMaterialFirstIndex, faceTriangleCount: tri.faceTriangleCount,
          camera: tri.camera ? { view: Array.from(tri.camera.view), projection: Array.from(tri.camera.projection) } : null,
          triId: Array.from(tri.triId), uv: Array.from(tri.uv), faceMask: Array.from(tri.faceMask),
        },
      };
    });
    if (!atomic) throw new Error("原子 HDR pick + triUv 采集失败");
    const hdrPickMask = atomic.pick;
    fs.writeFileSync(path.join(OUT, "web-hdr-pick-mask.json"), JSON.stringify(hdrPickMask));
    const pickPx = hdrPickMask.faceMask.reduce((a, b) => a + b, 0);
    console.log("[hdr-pick] facePixels=" + pickPx);
    const tri = atomic.tri;
    fs.writeFileSync(path.join(OUT, "web-face-tri-uv.json"), JSON.stringify(tri));
    const triSummary = {
      faceTriangleCount: tri.faceTriangleCount,
      facePixels: tri.faceMask.reduce((a, b) => a + b, 0),
      distinctTris: new Set(tri.triId.filter((v) => v >= 0)).size,
      cameraOk: !!tri.camera,
    };
    console.log("[tri/uv] " + JSON.stringify(triSummary));
    let bothPx = 0, resolvedPx = 0;
    for (let i = 0; i < hdrPickMask.faceMask.length; i += 1) {
      if (hdrPickMask.faceMask[i] && tri.faceMask[i]) bothPx += 1;
      if (hdrPickMask.faceMask[i] && tri.triId[i] >= 0) resolvedPx += 1;
    }
    console.log("[hdr-pick] overlapWithTriUv=" + bothPx + " triIdResolved=" + resolvedPx);

    // ── 步骤 3：三模式 HDR 逐模式 page.goto 重建（根因修复）──
    // 实测：运行时点击 setFaceStaticMode 切换模式后，faceShadowOnly 与
    // finalFaceComposite 读出的 HDR 逐像素完全相同（maxd=0）——运行时切换并未
    // 真正重建 Face graph，HDR resolve 读到的是残留内容。唯一可靠的切换是
    // page.goto 重建整个 stage（query.v14dFaceStaticMode 驱动 graph 选择）。
    //
    // 姿势同口径保证：VMD f120 + 权威相机在每次加载都是确定性的（同 VMD 文件、
    // 同 seek、同相机常量），三模式 HDR 与步骤 2 的 triUv 共享同一几何/可见性；
    // 差别仅在 Face 材质的 fragment 输出（公式视图），几何不变，故逐像素 RGB 有效。
    // 步骤 2 的 triUv/pick mask 仍以 finalFaceComposite 加载内的原子采集为准
    //（webEligible 分母与 triId 来源）；此处仅取三模式各自的逐像素 HDR RGB。
    const hdrOut = {};
    for (const mode of ["normal", "faceShadowOnly", "finalFaceComposite"]) {
      await load(mode);
      const hdr = await page.evaluate(async () => {
        const api = window.__v14dFaceStatic;
        if (!api || !api.exportFaceHdrFloat) return null;
        const r = await api.exportFaceHdrFloat();
        if (!r) return null;
        return { width: r.width, height: r.height, faceMaterialId: r.faceMaterialId, rgb: Array.from(r.rgb), faceMask: Array.from(r.faceMask) };
      });
      if (!hdr) throw new Error(mode + " HDR 导出失败");
      fs.writeFileSync(path.join(OUT, "web-" + mode + ".hdr.json"), JSON.stringify({ ...hdr, rgb: f32(hdr.rgb) }));
      hdrOut[mode] = "web-" + mode + ".hdr.json";
      const n = hdr.faceMask.reduce((a, b) => a + b, 0);
      console.log("[hdr] " + mode + " ok facePixels=" + n);
    }

    // ── 3b) Face pick mask PNG（交叉核对，与 HDR 同一语义；normal 模式）──
    await load("normal");
    const maskB64 = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      return api && api.exportFaceMaskPng ? api.exportFaceMaskPng() : null;
    });
    if (maskB64) fs.writeFileSync(path.join(OUT, "web-face-mask.png"), Buffer.from(maskB64, "base64"));

    const manifest = {
      contract: "v14d-face-uv-visibility",
      side: "web",
      base: BASE,
      exports: { triUv: "web-face-tri-uv.json", hdr: hdrOut, faceMask: maskB64 ? "web-face-mask.png" : null },
      pageErrors,
      triSummary,
    };
    fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
    if (pageErrors.length) {
      console.error("PAGE-ERRORS: " + pageErrors.length);
      process.exitCode = 2;
      return;
    }
    console.log("===WEB-EXPORT-OK=== " + OUT);
  } finally {
    await context.close();
  }
}

main().catch((e) => { console.error("===WEB-EXPORT-ERROR===", e); process.exit(2); });
