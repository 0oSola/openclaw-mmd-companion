// Stage 2B-M1 完整 Face Gate：State2 实时合成对账。
//
// 覆盖范围：full Face（全部可见 Face 材质像素）、interior（3x3 腐蚀内区）、edge（face−interior）、
// 眼/口邻域（EyeWhite/Eyes 材质保持性单列）。被排除像素单列报告。
// 口径：Web 侧 pre-tonemap HDR 线性 RGB（exportFaceHdrFloat）+ 同一 Face pick mask；
//       Blender 侧 Emission 直出参考帧（同一线性口径，Standard/exposure0/gamma1）。
// 完成标准：full Face 有效覆盖率 >= 95%，full Face 每通道 MAE <= 20/255。
// 配准 Gate：canvas 实际 fov/position/target 与权威 V14D_FACE_STATIC_CAMERA 比对；
//           --camera-override=shift|null 负测必须使 Gate 失败（证明判别力）。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const CHROME_EXE = process.env.CHROME_EXE || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3100/mmd-calibration-render";
const OUT = path.resolve(process.argv[2] || ".scratch/v14d-face-state2-runtime/gate");
const REF_DIR = path.resolve(process.env.V14D_STATE2_REF_DIR || ".scratch/v14d-face-state2-runtime");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:/mmd/\u514b\u83b1\u59b2\u539f\u76ae";
const PMX = process.env.V14D_PMX || path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:/w/rk3-face-v14d/web/public/assets/mmd/calibration/koleda-v14d/koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const STATE2_MASK_REL = "Textures/v14d-state2-mask/state2.png";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
for (const [label, fp, envUsed] of [["PMX", PMX, !!process.env.V14D_PMX], ["VMD", VMD, !!process.env.V14D_VMD], ["State2 mask", STATE2_MASK, !!process.env.V14D_STATE2_MASK]]) {
  if (!envUsed && !fs.existsSync(fp)) { console.error("GATE-CONFIG-FAIL: 默认 " + label + " 路径不存在 " + fp + "（请用环境变量覆盖）"); process.exit(2); }
}
const FIXED = 640;
const CAMERA_OVERRIDE = (() => { const h = process.argv.find((a) => a.startsWith("--camera-override=")); return h ? h.split("=", 2)[1] : null; })();
const MODE_ARG = (() => { const h = process.argv.find((a) => a.startsWith("--mode=")); return h ? h.split("=", 2)[1] : null; })();
const NEGATIVE = process.argv.includes("--negative"); // 期望失败（配准负测）

// 权威相机（与 v14dFaceStatic.ts V14D_FACE_STATIC_CAMERA 一致；采集后比对）。
const AUTH_CAM = { fov: 28.072486935852954 }; // fov 精确比对；position/target 由 canvas 实际值提供，null 即阻断
const MAE_THRESHOLD = 20 / 255; // 每通道线性 MAE 上限
const COVERAGE_MIN = 0.95;      // full Face 有效覆盖率下限
const MIN_FACE_SAMPLES = 1000;

const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };

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

// sRGB 显示字节 -> 线性（Blender 参考 PNG 为 Standard 显示域，需反变换到线性再对账）。
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

// 3x3 腐蚀（Face mask 内区）。edge = face − interior。
function erode3x3(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1)
          if (!mask[(y + dy) * w + (x + dx)]) { all = 0; break; }
      out[i] = all;
    }
  }
  return out;
}

async function captureMode(mode) {
  const modelPaths = collectModelFiles(KOLEDA_DIR).filter((p) => path.resolve(p) !== path.resolve(FACE_D));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-state2-gate-chrome-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 },
    deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
  });
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
      // 实时合成：Face BaseColor 恒为原始 face_d；mask 独立注入。
      const faceOverride = await fetchFile("Textures/c_Koleda_slg_face_d.png", "Textures/c_Koleda_slg_face_d.png");
      const state2Mask = await fetchFile("__mask__/state2", payload.state2MaskRel, "image/png");
      window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride, bakedTextures: null, state2Mask };
    }, { route: "http://v14d-asset.local/a", state2MaskRel: STATE2_MASK_REL });

    const modelUrl = "http://v14d-asset.local/a?v14dasset=pmx";
    const vmdUrl = "http://v14d-asset.local/a?v14dasset=vmd";
    const query = new URLSearchParams({ modelUrl, vmdUrl, v14dFaceStatic: "1", v14dFaceMode: mode });
    if (CAMERA_OVERRIDE) query.set("v14dFaceCameraOverride", CAMERA_OVERRIDE);
    await page.goto(BASE + "?" + query.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
    try {
      await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 60000 });
    } catch (e) {
      const dbg = await page.evaluate(() => ({ status: document.querySelector('canvas')?.dataset?.webgpuStatus || null, text: document.body?.innerText?.slice(0, 800) || '' })).catch(() => null);
      throw new Error('canvas not ready; webgpuStatus=' + (dbg && dbg.status) + ' body=' + (dbg && dbg.text) + ' pageErrors=' + pageErrors.join(' | '));
    }
    await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
    await page.waitForTimeout(1200);

    const state = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      return {
        mode: c?.dataset.v14dFaceStaticMode || "", frame: c?.dataset.v14dFaceStaticFrame || "",
        state: c?.dataset.v14dFaceStaticState || "", blend: c?.dataset.v14dFaceStaticBlend || "",
        cameraLocked: c?.dataset.v14dFaceStaticCameraLocked || "", paused: c?.dataset.v14dFaceStaticPaused || "",
        cameraFov: c?.dataset.v14dFaceStaticCameraFov || "", cameraPos: c?.dataset.v14dFaceStaticCameraPos || "",
        cameraTarget: c?.dataset.v14dFaceCameraTarget || "",
        liveBound: c?.dataset.v14dLiveBound || "", liveFaceDiffuse: c?.dataset.v14dLiveFaceDiffuse || "",
        liveMaskPath: c?.dataset.v14dLiveMaskPath || "",
      };
    });

    const hdr = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      if (!api || !api.exportFaceHdrFloat) return null;
      const r = await api.exportFaceHdrFloat();
      if (!r) return null;
      return { width: r.width, height: r.height, rgb: Array.from(r.rgb), faceMask: Array.from(r.faceMask) };
    });
    const eyeWhiteMask = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      if (!api || !api.exportMaterialMaskByName) return null;
      const m = await api.exportMaterialMaskByName("EyeWhite");
      return m ? Array.from(m) : null;
    });
    const eyesMask = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      if (!api || !api.exportMaterialMaskByName) return null;
      const m = await api.exportMaterialMaskByName("Eyes");
      return m ? Array.from(m) : null;
    });
    const png = path.join(OUT, mode + "-web.png");
    await page.screenshot({ path: png });
    return { state, hdr, eyeWhiteMask, eyesMask, png, pageErrors };
  } finally {
    await context.close();
  }
}

async function loadRefLinear(refName) {
  const p = path.join(REF_DIR, refName);
  if (!fs.existsSync(p)) return null;
  const raw = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = raw.info.width, h = raw.info.height;
  const lin = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    lin[i * 3] = srgbToLinear(raw.data[i * 4]);
    lin[i * 3 + 1] = srgbToLinear(raw.data[i * 4 + 1]);
    lin[i * 3 + 2] = srgbToLinear(raw.data[i * 4 + 2]);
  }
  return { width: w, height: h, linear: lin };
}

function computeRegionMetrics(webRgb, refLin, mask, w, h) {
  // 返回 { samples, coverage, mae:[r,g,b], p95:[r,g,b] }；mask 命中且 Web/参考均有限为有效样本。
  let valid = 0;
  const errs = [[], [], []];
  for (let i = 0; i < w * h; i += 1) {
    if (!mask[i]) continue;
    const r = webRgb[i * 3], g = webRgb[i * 3 + 1], b = webRgb[i * 3 + 2];
    const rr = refLin[i * 3], rg = refLin[i * 3 + 1], rb = refLin[i * 3 + 2];
    if (![r, g, b, rr, rg, rb].every(Number.isFinite)) continue;
    valid += 1;
    errs[0].push(Math.abs(r - rr)); errs[1].push(Math.abs(g - rg)); errs[2].push(Math.abs(b - rb));
  }
  const mae = [0, 1, 2].map((c) => errs[c].length ? errs[c].reduce((a, b) => a + b, 0) / errs[c].length : null);
  const p95 = [0, 1, 2].map((c) => { const s = errs[c].slice().sort((a, b) => a - b); return percentile(s, 95); });
  return { valid, mae, p95 };
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const modes = MODE_ARG ? [MODE_ARG] : ["normal", "faceShadowOnly", "finalFaceComposite"];
  const refName = { faceShadowOnly: "blender-ref-state2-shadow-factor.png", finalFaceComposite: "blender-ref-state2-final-composite.png" }; // normal 无 Blender 参考，仅作对照基线
  const fails = [];
  const modeHdrs = {};
  const report = { modes: {}, cameraOverride: CAMERA_OVERRIDE, negative: NEGATIVE };

  for (const mode of modes) {
    const cap = await captureMode(mode);
    const m = { state: cap.state, pageErrors: cap.pageErrors.length };
    // ── 配准 Gate：相机实际值必须非 null，未负测时等于权威 fov；负测时由失败证明判别力 ──
    const fov = Number(cap.state.cameraFov);
    if (!Number.isFinite(fov) || fov <= 0) { fails.push(mode + ": 相机 fov null/非法"); m.registration = "null-fov"; }
    else if (!cap.state.cameraPos || !cap.state.cameraTarget) { fails.push(mode + ": 相机 position/target 缺失"); m.registration = "null-pos"; }
    else if (!CAMERA_OVERRIDE && Math.abs(fov - AUTH_CAM.fov) > 0.5) { fails.push(mode + ": 相机 fov " + fov + " != 权威 " + AUTH_CAM.fov); m.registration = "fov-mismatch"; }
    else m.registration = CAMERA_OVERRIDE ? "override-active" : "ok";
    // ── 双纹理绑定 Gate（normal 为原始 face_d 对照基线，不挂 State2 live graph，跳过绑定断言）──
    if (mode !== "normal") {
      if (cap.state.liveBound !== "true") fails.push(mode + ": 实时双纹理绑定未通过 (liveBound=" + cap.state.liveBound + ")");
      if (cap.state.liveMaskPath !== STATE2_MASK_REL) fails.push(mode + ": mask 路径错误 " + cap.state.liveMaskPath);
    }
    if (!cap.hdr) { fails.push(mode + ": HDR 证据缺失"); report.modes[mode] = m; continue; }
    modeHdrs[mode] = cap.hdr;
    if (mode === "normal") { report.modes[mode] = m; continue; } // normal 仅对照，不做 Blender 参考 MAE
    const w = cap.hdr.width, h = cap.hdr.height;
    const faceMask = Uint8Array.from(cap.hdr.faceMask);
    const faceCount = faceMask.reduce((a, b) => a + b, 0);
    m.faceSamples = faceCount;
    if (faceCount < MIN_FACE_SAMPLES) fails.push(mode + ": Face 样本不足 " + faceCount);

    const ref = await loadRefLinear(refName[mode]);
    if (!ref) { fails.push(mode + ": Blender 参考缺失 " + refName[mode]); report.modes[mode] = m; continue; }
    if (ref.width !== w || ref.height !== h) fails.push(mode + ": 参考尺寸 " + ref.width + "x" + ref.height + " != Web " + w + "x" + h);

    // ── 分区 ──
    const interior = erode3x3(faceMask, w, h);
    const edge = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i += 1) edge[i] = faceMask[i] && !interior[i] ? 1 : 0;
    const eyeW = cap.eyeWhiteMask ? Uint8Array.from(cap.eyeWhiteMask) : new Uint8Array(w * h);
    const eyes = cap.eyesMask ? Uint8Array.from(cap.eyesMask) : new Uint8Array(w * h);

    const full = computeRegionMetrics(cap.hdr.rgb, ref.linear, faceMask, w, h);
    const intM = computeRegionMetrics(cap.hdr.rgb, ref.linear, interior, w, h);
    const edgeM = computeRegionMetrics(cap.hdr.rgb, ref.linear, edge, w, h);
    const eyeWM = computeRegionMetrics(cap.hdr.rgb, ref.linear, eyeW, w, h);
    const eyesM = computeRegionMetrics(cap.hdr.rgb, ref.linear, eyes, w, h);
    // 被排除像素 = 非 Face（含眼/口邻域，由眼睛材质保持性单列）
    const excluded = w * h - faceCount;

    const fullCoverage = faceCount ? full.valid / faceCount : 0;
    m.regions = {
      full: { samples: faceCount, valid: full.valid, coverage: +fullCoverage.toFixed(4), mae: full.mae.map((v) => v === null ? null : +(v * 255).toFixed(2)), p95: full.p95.map((v) => v === null ? null : +(v * 255).toFixed(2)) },
      interior: { samples: interior.reduce((a, b) => a + b, 0), valid: intM.valid, mae: intM.mae.map((v) => v === null ? null : +(v * 255).toFixed(2)), p95: intM.p95.map((v) => v === null ? null : +(v * 255).toFixed(2)) },
      edge: { samples: edge.reduce((a, b) => a + b, 0), valid: edgeM.valid, mae: edgeM.mae.map((v) => v === null ? null : +(v * 255).toFixed(2)), p95: edgeM.p95.map((v) => v === null ? null : +(v * 255).toFixed(2)) },
      eyeWhite: { samples: eyeW.reduce((a, b) => a + b, 0), valid: eyeWM.valid, mae: eyeWM.mae.map((v) => v === null ? null : +(v * 255).toFixed(2)) },
      eyes: { samples: eyes.reduce((a, b) => a + b, 0), valid: eyesM.valid, mae: eyesM.mae.map((v) => v === null ? null : +(v * 255).toFixed(2)) },
      excludedPixels: excluded,
    };
    // ── 完成标准 ──
    if (fullCoverage < COVERAGE_MIN) fails.push(mode + ": full Face 有效覆盖率 " + fullCoverage.toFixed(4) + " < " + COVERAGE_MIN);
    for (let c = 0; c < 3; c += 1) {
      if (full.mae[c] === null || full.mae[c] > MAE_THRESHOLD) fails.push(mode + ": full Face 通道 " + c + " MAE " + (full.mae[c] === null ? "null" : (full.mae[c] * 255).toFixed(2) + "/255") + " > 20/255");
    }
    report.modes[mode] = m;
  }

  // 三模式 pre-tonemap HDR 互异（实时合成生效证据）：normal/faceShadowOnly/finalFaceComposite 的 Face HDR 均值必须互不相同。
  if (!NEGATIVE && !MODE_ARG) {
    const faceMean = (hdr) => {
      if (!hdr) return null;
      let n = 0; const acc = [0, 0, 0];
      for (let i = 0; i < hdr.faceMask.length; i += 1) { if (!hdr.faceMask[i]) continue; n += 1; acc[0] += hdr.rgb[i*3]; acc[1] += hdr.rgb[i*3+1]; acc[2] += hdr.rgb[i*3+2]; }
      return n ? acc.map((v) => +(v / n).toFixed(5)) : null;
    };
    const means = { normal: faceMean(modeHdrs.normal), faceShadowOnly: faceMean(modeHdrs.faceShadowOnly), finalFaceComposite: faceMean(modeHdrs.finalFaceComposite) };
    report.modeHdrFaceMean = means;
    const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
    if (same(means.normal, means.faceShadowOnly)) fails.push("HDR 互异失败: normal 与 faceShadowOnly 均值相同 " + JSON.stringify(means.normal) + "（实时 shadow 覆写未生效）");
    if (same(means.normal, means.finalFaceComposite)) fails.push("HDR 互异失败: normal 与 finalFaceComposite 均值相同 " + JSON.stringify(means.normal) + "（实时 composite 覆写未生效）");
    if (same(means.faceShadowOnly, means.finalFaceComposite)) fails.push("HDR 互异失败: faceShadowOnly 与 finalFaceComposite 均值相同 " + JSON.stringify(means.faceShadowOnly));
    console.log("[HDR-distinct] " + JSON.stringify(means));
  }
  fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify(report, null, 2));
  console.log("===STATE2-LIVE-GATE-REPORT=== " + path.join(OUT, "gate-report.json"));
  console.log(JSON.stringify(report, null, 2));

  if (NEGATIVE) {
    // 负测：必须失败。若全通过说明配准 Gate 无判别力。
    if (fails.length === 0) {
      console.error("===STATE2-LIVE-GATE-NEGATIVE-FAIL=== 负测(相机覆写 " + CAMERA_OVERRIDE + ")未被拒绝，Gate 无判别力");
      process.exit(1);
    }
    console.log("===STATE2-LIVE-GATE-NEGATIVE-OK=== 负测被拒绝（" + fails.length + " 项），Gate 有判别力");
    process.exit(0);
  }
  if (fails.length) { console.error("===STATE2-LIVE-GATE-FAIL===\n" + fails.join("\n")); process.exit(1); }
  console.log("===STATE2-LIVE-GATE-OK===");
}

run().catch((e) => { console.error("===STATE2-LIVE-GATE-ERROR===", e); process.exit(2); });
