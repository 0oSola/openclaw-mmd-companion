// V14D Face State 2 静态预览三模式采集 + HTTP 4xx/5xx 门禁。
// 权威 PMX/纹理/VMD 经 page.route 从本地文件 fulfill（引擎 files 变体局部解析）；
// face_d 按模式由 Face override File 覆盖（normal=原始, composite=合成, shadow=衰减）。
// 仓库不捆绑第三方资产（README 资产政策）；本地路径可用环境变量覆盖。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

// G0 像素级对齐门控（--align-gate=1）：bakedGolden 模式额外采集「Blender 权威 PNG
// alpha>8 剪影 对 Web faceMask 的 Face-specific 配准证据」。Blender alpha 编码整个模型
// 剪影（含头发/身体），远大于 Face 子区，故不做整剪影 IoU、也不比较「整剪影质心 vs
// Face 质心」（口径不同）。改用 Face-specific 判据：(a) Web faceMask 落在 Blender 剪影
// 内的覆盖率 ≥ FACE_COVERAGE_MIN（无越界）；(b) Web faceMask 质心 与 交集
// (webMask ∩ blenderSilhouette) 质心 偏移 ≤ CENTROID_MAX_PX（检测 Web faceMask 相对
// Blender 模型的平移/缩放错位）。默认关闭，不影响既有 normal/bakedGolden 采集语义。
const ALIGN_GATE = process.argv.includes("--align-gate=1") || process.env.V14D_ALIGN_GATE === "1";
const FACE_COVERAGE_MIN = 0.99;
const CENTROID_MAX_PX = 5;
const ALPHA_THRESHOLD = 8;

// 绑定 Gate 负向自验（--self-test-binding-gate）：在 import/浏览器启动前直接退出。
// 绑定描述内联于此（与 v14dFaceStatic.ts V14D_BAKED_BINDINGS 一致），避免在浏览器
// 启动前依赖后定义的 validateBakedBinding/BAKED_BINDINGS。验证错绑/漏绑必被拒。
if (process.argv.includes("--self-test-binding-gate")) {
  const BINDINGS = [
    ["face","Face","baked_face.png"],["eyeWhite","EyeWhite","baked_eyeWhite.png"],
    ["eyes","Eyes","baked_eyes.png"],["eyesPlus","Eyes+","baked_eyesPlus.png"],
    ["hairA","HairA","baked_hairA.png"],["hairB","HairB","baked_hairB.png"],
    ["body","BodySkin","baked_body.png"],["top","Cth1-Top","baked_top.png"],
    ["cape","Cth1-Cape","baked_cape.png"],
  ];
  const EXPECT = BINDINGS.map(([k, pmx, file]) => ({ pmx, logicalPath: "Textures/v14d-baked/" + file }));
  // gate 与 validateBakedBinding 同逻辑（含追加区间校验）。state 需含 bakedTexStart/Count。
  const gate = (actualStr, start, count, fails) => {
    const actual = actualStr.split(";").filter(Boolean).map((s) => {
      const [materialName, idx, logicalPath] = s.split("|");
      return { materialName, idx: Number(idx), logicalPath };
    });
    if (actual.length !== EXPECT.length) fails.push("count " + actual.length + " != " + EXPECT.length);
    for (const e of EXPECT) {
      const a = actual.find((x) => x.materialName === e.pmx);
      if (!a) { fails.push(e.pmx + " missing"); continue; }
      if (a.logicalPath !== e.logicalPath) fails.push(e.pmx + " bound " + a.logicalPath + " != " + e.logicalPath);
    }
    const idxs = actual.map((a) => a.idx);
    for (const a of actual) {
      if (!Number.isInteger(a.idx) || a.idx < 0) fails.push(a.materialName + " idx 非法 " + a.idx);
    }
    const dup = idxs.filter((v, i) => idxs.indexOf(v) !== i);
    if (dup.length) fails.push("idx 重复 " + [...new Set(dup)].join(","));
    if (Number.isInteger(start) && Number.isInteger(count) && count === EXPECT.length) {
      const sorted = [...idxs].sort((a, b) => a - b);
      const range = Array.from({ length: count }, (_, i) => start + i);
      if (!(sorted.length === range.length && sorted.every((v, i) => v === range[i]))) fails.push("idx 未覆盖追加区间");
    } else {
      fails.push("追加区间缺失 start=" + start + " count=" + count);
    }
  };
  // 正常：原始纹理 0..18，追加区间 start=19 count=9，idx 19..27 连续。
  const S = 19, C = 9;
  const mk = (idxFn) => BINDINGS.map(([, pmx, file], i) => `${pmx}|${idxFn(i)}|Textures/v14d-baked/${file}`).join(";");
  const good = mk((i) => S + i);
  const wrongFace = BINDINGS.map(([k, pmx, file], i) => `${pmx}|${S + i}|Textures/v14d-baked/${k === "face" ? "baked_eyeWhite.png" : file}`).join(";");
  const missingTop = BINDINGS.filter(([k]) => k !== "top").map(([, pmx, file], i) => `${pmx}|${S + i}|Textures/v14d-baked/${file}`).join(";");
  const sharedIdx = mk(() => S); // 全部共享同一 idx
  const negIdx = mk((i) => (i === 0 ? -1 : S + i)); // Face 负 idx
  const inOriginalRange = mk((i) => i); // idx 落在原始区间 0..8
  const f1 = []; gate(good, S, C, f1);
  const f2 = []; gate(wrongFace, S, C, f2);
  const f3 = []; gate(missingTop, S, C, f3);
  const f4 = []; gate(sharedIdx, S, C, f4);
  const f5 = []; gate(negIdx, S, C, f5);
  const f6 = []; gate(inOriginalRange, S, C, f6);
  let ok = true;
  if (f1.length) { ok = false; console.error("SELF-TEST-FAIL: 正常九项被误拒", f1); }
  if (!f2.length) { ok = false; console.error("SELF-TEST-FAIL: Face 错绑 EyeWhite 未被拒绝"); }
  if (!f3.length) { ok = false; console.error("SELF-TEST-FAIL: 漏绑 Top 未被拒绝"); }
  if (!f4.length) { ok = false; console.error("SELF-TEST-FAIL: 共享 idx 未被拒绝"); }
  if (!f5.length) { ok = false; console.error("SELF-TEST-FAIL: 负 idx 未被拒绝"); }
  if (!f6.length) { ok = false; console.error("SELF-TEST-FAIL: idx 落在原始纹理区间未被拒绝"); }
  if (!ok) process.exit(1);
  console.log("===SELF-TEST-BINDING-GATE-OK=== 正常九项(连续新增idx)通过; 错绑/漏绑/共享idx/负idx/落原始区间均被拒绝");
  process.exit(0);
}

// 负向自验（--self-test-negative）：在任何资产加载/浏览器启动前运行。
// 构造非法 faceMask（NaN/Infinity/非 0/1 值），证明 validateHdrEvidence 会拒绝；
// 合法 mask 不被误拒。function 声明提升使 validateHdrEvidence 可在此调用。
if (process.argv.includes("--self-test-negative")) {
  const FIXED = 640;
  const px = FIXED * FIXED;
  const okRgb = new Array(px * 3).fill(0.5);
  const okMask = new Array(px).fill(0); okMask[0] = 1;
  const cases = {
    "NaN": (() => { const m = okMask.slice(); m[5] = NaN; return m; })(),
    "Infinity": (() => { const m = okMask.slice(); m[7] = Infinity; return m; })(),
    "value-2": (() => { const m = okMask.slice(); m[9] = 2; return m; })(),
    "bool-true": (() => { const m = okMask.slice(); m[11] = true; return m; })(),
  };
  let allOk = true;
  for (const [name, mask] of Object.entries(cases)) {
    const f = [];
    validateHdrEvidence("selftest", { width: FIXED, height: FIXED, faceMaterialId: 1, rgb: okRgb, faceMask: mask }, f);
    if (!f.some((s) => s.includes("faceMask 含非法值"))) { allOk = false; console.error(`SELF-TEST-FAIL: 非法 faceMask(${name}) 未被拒绝`); }
  }
  const fOk = [];
  validateHdrEvidence("selftest", { width: FIXED, height: FIXED, faceMaterialId: 1, rgb: okRgb, faceMask: new Array(px).fill(1) }, fOk);
  if (fOk.some((s) => s.includes("faceMask 含非法值"))) { allOk = false; console.error("SELF-TEST-FAIL: 合法 faceMask 被误拒"); }
  if (!allOk) process.exit(1);
  console.log("===SELF-TEST-NEGATIVE-OK=== 非法 faceMask(NaN/Infinity/2/true) 均被拒绝, 合法 mask 0/1 不误拒");
  process.exit(0);
}

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3100/mmd-calibration-render";
const OUT = path.resolve(process.argv[2] || ".scratch/v14d-face-static/capture-final");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX = process.env.V14D_PMX || path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const DERIVED_DIR = process.env.V14D_DERIVED_DIR || "C:\\w\\rk3-face-v14d\\.scratch\\v14d-face-static-derived";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
const FACE_D_REL = "Textures/c_Koleda_slg_face_d.png";
// 黄金帧最终着色烘焙纹理目录（Cycles COMBINED 逐材质，含光照）。
const BAKED_DIR = process.env.V14D_BAKED_DIR || "D:\\mmd\\克莱妲原皮\\v14d-baked-final";
// State2 实时合成：权威 packed mask（Non-Color 1024x1024）注入为唯一逻辑键。
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const STATE2_MASK_REL = "Textures/v14d-state2-mask/state2.png";
const CAMERA_OVERRIDE = (() => { const h = process.argv.find((a) => a.startsWith("--camera-override=")); return h ? h.split("=", 2)[1] : null; })();
// 烘焙绑定（与 v14dFaceStatic.ts V14D_BAKED_BINDINGS 一致）：
// [key, pmxMaterial, bakedFile]。注入逻辑键一律 Textures/v14d-baked/<bakedFile>（唯一，不覆盖）。
const BAKED_BINDINGS = [
  ["face", "Face", "baked_face.png"],
  ["eyeWhite", "EyeWhite", "baked_eyeWhite.png"],
  ["eyes", "Eyes", "baked_eyes.png"],
  ["eyesPlus", "Eyes+", "baked_eyesPlus.png"],
  ["hairA", "HairA", "baked_hairA.png"],
  ["hairB", "HairB", "baked_hairB.png"],
  ["body", "BodySkin", "baked_body.png"],
  ["top", "Cth1-Top", "baked_top.png"],
  ["cape", "Cth1-Cape", "baked_cape.png"],
];
const BAKED_FILES = Object.fromEntries(BAKED_BINDINGS.map(([k, , f]) => [k, [f, "Textures/v14d-baked/" + f]]));
// 额外模式：--mode=<名称> 只采集单一模式并输出 face-static-<名称>.png，跳过其余循环。
const MODE_ARG = (() => {
  const hit = process.argv.find((a) => a.startsWith("--mode="));
  return hit ? hit.split("=", 2)[1] : null;
})();
fs.mkdirSync(OUT, { recursive: true });

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
const modelPaths = collectModelFiles(KOLEDA_DIR).filter((p) => path.resolve(p) !== path.resolve(FACE_D));
if (!fs.existsSync(PMX)) throw new Error("缺权威 PMX: " + PMX);
if (!fs.existsSync(VMD)) throw new Error("缺权威 VMD: " + VMD);

const DERIVED_FILE = {
  finalFaceComposite: "v14d-face-composite-state2.png",
  faceShadowOnly: "v14d-face-shadow-attenuation-state2.png",
  normal: null,
  bakedGolden: null, // 脸部纹理由烘焙纹理提供（baked_face.png）
};
const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };

const summary = { out: OUT, modes: {}, pageErrors: [], failedRequests: [], httpBadResponses: [] };
const ALL_MODES = ["normal", "faceShadowOnly", "finalFaceComposite", "bakedGolden"];
const MODES = MODE_ARG ? (ALL_MODES.includes(MODE_ARG) ? [MODE_ARG] : (() => { console.error(`未知 --mode=${MODE_ARG}`); process.exit(2); })()) : ALL_MODES;
for (const mode of MODES) {
  // 每模式独立 context（仅一次 init script + 一次 route），避免多文档累积。
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-face-static-chrome-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 },
    deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
  });
  try {
  // 资产请求路由到本地文件（页面 fetch 的是 blob: URL，经 route 用本地字节 fulfill）。
  await context.route("**/*", (route) => {
    const url = route.request().url();
    const m = url.match(/[?&]v14dasset=([^&]+)/);
    if (!m) return route.continue();
    const key = decodeURIComponent(m[1]);
    // 资产清单：列出模型文件相对路径（供 faceStatic 逐个 fetch 建 File[]）
    if (key === "__manifest__") {
      const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).replace(/\\/g, "/"));
      rels.push(path.relative(KOLEDA_DIR, PMX).replace(/\\/g, "/"));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) });
    }
    let filePath = null;
    if (key === "pmx") filePath = PMX;
    else if (key === "vmd") filePath = VMD;
    else if (key.startsWith("__derived__/")) filePath = path.join(DERIVED_DIR, key.slice("__derived__/".length));
    else if (key.startsWith("__baked__/")) filePath = path.join(BAKED_DIR, key.slice("__baked__/".length));
    else if (key === "__mask__/state2") filePath = STATE2_MASK;
    else filePath = path.join(KOLEDA_DIR, key);
    if (filePath && fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(filePath) });
    }
    return route.fulfill({ status: 404, body: "missing " + key });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => summary.pageErrors.push(String(e?.stack || e)));
page.on("console", async (m) => { const t = m.text(); const { appendFileSync } = await import("node:fs"); appendFileSync(process.cwd() + "/.scratch/v14d-face-state2-runtime/console-dump.txt", "[" + m.type() + ":" + m.location()?.url + "] " + t.slice(0,300) + "\n"); });
  page.on("requestfailed", (r) => summary.failedRequests.push({ url: r.url(), err: r.failure()?.errorText || "unknown" }));
  page.on("response", (r) => { const s = r.status(); if (s >= 400) summary.httpBadResponses.push({ url: r.url(), status: s }); });

    // 每个文档加载前：经路由 ?v14dasset= 把权威资产逐个拉成 File 注入
    // window.__v14dFaceStaticAssets；Face diffuse 用 override 覆盖 face_d 逻辑名。
    await page.addInitScript(async (payload) => {
      const fetchFile = async (key, rel, mime) => {
        const resp = await fetch(`${payload.route}?v14dasset=${encodeURIComponent(key)}`);
        if (!resp.ok) throw new Error(`asset ${key} -> ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const f = new File([buf], key.split("/").pop(), { type: mime || "application/octet-stream" });
        if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel });
        return f;
      };
      const manifest = await (await fetch(`${payload.route}?v14dasset=__manifest__`)).json();
      const modelFiles = [];
      const bakedKeys = new Set(payload.bakedKeys || []);
      for (const rel of manifest.files) {
        // 烘焙用唯一逻辑键（Textures/v14d-baked/*），不再顶替原始纹理键；
        // 原始 face_d 等全部正常注入，由引擎按材质改写后的路径独立解析烘焙图。
        if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png") && !payload.isBaked) continue; // 非烘焙由 faceOverride 提供
        modelFiles.push(await fetchFile(rel, rel));
      }
      const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
      const pmxFile = await fetchFile(pmxRel, pmxRel);
      const vmdFile = await fetchFile("vmd", null);
      let faceOverride = null;
      if (payload.faceRel && !payload.isBaked) {
        faceOverride = await fetchFile(payload.faceKey, payload.faceRel);
      }
      // 烘焙模式：逐材质烘焙 File，按 webkitRelativePath=材质逻辑键覆盖。
      let bakedTextures = null;
      if (payload.isBaked) {
        bakedTextures = {};
        for (const [key, [file, relKey]] of Object.entries(payload.bakedMap)) {
          bakedTextures[key] = await fetchFile(`__baked__/${file}`, relKey);
        }
      }
      let state2Mask = null;
      if (payload.state2Mask) { state2Mask = await fetchFile("__mask__/state2", payload.state2MaskRel, "image/png"); }
      window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride, bakedTextures, state2Mask };
    }, {
      route: "http://v14d-asset.local/a",
      isBaked: mode === "bakedGolden",
      bakedKeys: mode === "bakedGolden" ? Object.values(BAKED_FILES).map(([, rel]) => rel) : [],
      bakedMap: mode === "bakedGolden" ? BAKED_FILES : null,
      // 实时合成（faceShadowOnly/finalFaceComposite）：Face BaseColor 恒为原始 face_d，mask 独立注入。
      faceKey: "Textures/c_Koleda_slg_face_d.png",
      state2Mask: mode === "faceShadowOnly" || mode === "finalFaceComposite",
      state2MaskRel: "Textures/v14d-state2-mask/state2.png",
      // 烘焙模式下脸部纹理由 bakedTextures.face 提供，跳过 faceOverride。
      faceRel: mode === "bakedGolden" ? null : "Textures/c_Koleda_slg_face_d.png",
    });

    const modelUrl = `http://v14d-asset.local/a?v14dasset=pmx`;
    const vmdUrl = `http://v14d-asset.local/a?v14dasset=vmd`;
    const query = new URLSearchParams({ modelUrl, vmdUrl, v14dFaceStatic: "1", v14dFaceMode: mode });
    if (CAMERA_OVERRIDE) query.set("v14dFaceCameraOverride", CAMERA_OVERRIDE);
    if (ALIGN_GATE && mode === "bakedGolden") query.set("v14dAlignGate", "1");
    await page.goto(`${BASE}?${query.toString()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("[data-testid='mmd-calibration-render']", { timeout: 60000 });
    await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
    await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      return {
        webgpuStatus: c?.dataset.webgpuStatus || "", faceStatic: c?.dataset.v14dFaceStatic || "",
        mode: c?.dataset.v14dFaceStaticMode || "", frame: c?.dataset.v14dFaceStaticFrame || "",
        state: c?.dataset.v14dFaceStaticState || "", blend: c?.dataset.v14dFaceStaticBlend || "",
        cameraLocked: c?.dataset.v14dFaceStaticCameraLocked || "", paused: c?.dataset.v14dFaceStaticPaused || "",
        cameraFov: c?.dataset.v14dFaceStaticCameraFov || "", cameraPos: c?.dataset.v14dFaceStaticCameraPos || "",
        texture: c?.dataset.v14dFaceStaticTexture || "", faceApplied: c?.dataset.v14dFaceStaticFaceApplied || "",
        authority: c?.dataset.v14dFaceStaticAuthority || "", width: c?.width || 0, height: c?.height || 0,
        liveState2: c?.dataset.v14dLiveState2 || "",
        liveFaceDiffuse: c?.dataset.v14dLiveFaceDiffuse || "",
        liveMaskPath: c?.dataset.v14dLiveMaskPath || "",
        liveMaskIndex: c?.dataset.v14dLiveMaskIndex || "",
        liveBound: c?.dataset.v14dLiveBound || "",
        cameraTarget: c?.dataset.v14dFaceCameraTarget || "",
        bakedBound: c?.dataset.v14dBakedBound || "",
        bakedActual: c?.dataset.v14dBakedActual || "",
        bakedTexStart: c?.dataset.v14dBakedTexStart || "",
        bakedTexCount: c?.dataset.v14dBakedTexCount || "",
        bakedTexFinal: c?.dataset.v14dBakedTexFinal || "",
      };
    });
    const png = path.join(OUT, `face-static-${mode}.png`);
    await page.screenshot({ path: png });
    const roiCapture = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      if (!api) return { error: "no __v14dFaceStatic api" };
      return api.capture();
    });
    // 同步导出 pre-tonemap HDR 线性浮点 RGB（与 baker 参考同一线性口径）。
    const hdr = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      if (!api || !api.exportFaceHdrFloat) return null;
      const r = await api.exportFaceHdrFloat();
      if (!r) return null;
      return { width: r.width, height: r.height, faceMaterialId: r.faceMaterialId, rgb: Array.from(r.rgb), faceMask: Array.from(r.faceMask) };
    });
    if (hdr) {
      fs.writeFileSync(path.join(OUT, `face-static-${mode}.hdr.json`), JSON.stringify(hdr));
    }
    summary.modes[mode] = { state, roi: roiCapture, png, hdr };

    // ── G0 像素级对齐采集（仅 --align-gate=1 且 bakedGolden） ──
    if (ALIGN_GATE && mode === "bakedGolden") {
      const uvCap = await page.evaluate(async () => {
        const api = window.__v14dFaceStatic;
        if (!api || !api.exportFaceUvPng) return null;
        const r = await api.exportFaceUvPng();
        if (!r) return null;
        return { width: r.width, height: r.height, faceMask: Array.from(r.faceMask) };
      });
      const FRESH = path.resolve(".scratch/v14d-agx-byte-capture/g0-reference/blender-v14d-frame120-rerender.png");
      if (uvCap && fs.existsSync(FRESH)) {
        const freshRaw = await sharp(FRESH).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const N = 640 * 640;
        const blenderMask = new Uint8Array(N);
        for (let i = 0; i < N; i += 1) blenderMask[i] = freshRaw.data[i * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
        const webFace = Uint8Array.from(uvCap.faceMask);
        let covered = 0, blendCnt = 0, webCnt = 0, wCx = 0, wCy = 0, iCx = 0, iCy = 0;
        for (let i = 0; i < N; i += 1) {
          const b = blenderMask[i] === 1, w = webFace[i] === 1;
          const px = i % 640, py = (i / 640) | 0;
          if (b) blendCnt += 1;
          if (w) { webCnt += 1; wCx += px; wCy += py; if (b) { covered += 1; iCx += px; iCy += py; } }
        }
        const coverage = webCnt ? covered / webCnt : 0;
        // Face-specific 质心：webMask 质心 vs 交集质心。交集即 webMask 落在 Blender
        // 剪影内的部分；若 Web faceMask 相对 Blender 模型平移/缩放错位，交集缩小且
        // 两质心分离。配准良好时 webMask≈交集，质心偏移≈0。
        const wCentroid = webCnt ? [wCx / webCnt, wCy / webCnt] : null;
        const iCentroid = covered ? [iCx / covered, iCy / covered] : null;
        const centroidShift = (wCentroid && iCentroid)
          ? Math.hypot(wCentroid[0] - iCentroid[0], wCentroid[1] - iCentroid[1]) : Infinity;
        const aligned = coverage >= FACE_COVERAGE_MIN && centroidShift <= CENTROID_MAX_PX && webCnt >= 1000;
        summary.alignment = {
          blenderMaskCount: blendCnt, webFaceMaskCount: webCnt,
          coveredInSilhouette: covered, faceCoverage: +coverage.toFixed(4), faceCoverageMin: FACE_COVERAGE_MIN,
          webFaceCentroid: wCentroid, intersectionCentroid: iCentroid,
          centroidShiftPx: +((centroidShift === Infinity) ? -1 : centroidShift).toFixed(3), centroidMaxPx: CENTROID_MAX_PX,
          pixelAligned: aligned,
          status: aligned ? "verified" : "not-verified",
          webCamera: { fov: Number(state.cameraFov) || null, position: state.cameraPos || null },
        };
        console.log(`[align-gate] faceCoverage=${coverage.toFixed(4)} (min ${FACE_COVERAGE_MIN}) centroidShift=${centroidShift.toFixed(2)}px (max ${CENTROID_MAX_PX}) blender=${blendCnt} web=${webCnt} covered=${covered}`);
      } else {
        summary.alignment = { status: "not-verified", pixelAligned: false, reason: "uvCap 或 fresh PNG 缺失" };
      }
      // 独立对齐证据文件：供 decode-face-roi.mjs（G0）在 manifest.alignment
      // 为 not-verified 时采信。写到 g0-reference/g0-alignment.json。
      try {
        const alignDir = path.resolve(".scratch/v14d-agx-byte-capture/g0-reference");
        fs.mkdirSync(alignDir, { recursive: true });
        fs.writeFileSync(path.join(alignDir, "g0-alignment.json"), JSON.stringify(summary.alignment, null, 2));
        console.log(`[align-gate] 写对齐证据 ${path.join(alignDir, "g0-alignment.json")}`);
      } catch (e) { console.error(`[align-gate] 对齐证据写入失败: ${e.message}`); }
    }
    console.log(`[capture] mode=${mode} faceApplied=${state.faceApplied} faceId=${roiCapture?.faceMaterialId} faceSamples=${roiCapture?.roi?.faceSamples} meanLinear=${JSON.stringify(roiCapture?.meanLinear)} err=${roiCapture?.error || ""}`);
  } finally { await context.close(); }
}
fs.writeFileSync(path.join(OUT, "capture-summary.json"), JSON.stringify(summary, null, 2));
// 硬断言门禁：任一失败 exit 1（不再只记录）。
const MIN_FACE_SAMPLES = 1000;
// 逐模式硬校验 HDR 浮点证据（纯函数，供负向自验复用）。尺寸/样本阈值用默认参数，
// 避免依赖模块级 const 的暂时性死区（self-test 在常量初始化前调用本函数）。
// faceMask 每个值必须是有限数且为明确的 0/1：NaN/Infinity 或其它值会让
// `b ? 1 : 0` 误判为有效 Face 样本，必须显式拒绝。rgb 每个值必须为有限数。
function validateHdrEvidence(mode, hdr, fails, FIXED = 640, MIN_FACE_SAMPLES = 1000) {
  if (!hdr) { fails.push(`${mode}: HDR 浮点证据缺失 (exportFaceHdrFloat 返回 null)`); return; }
  const px = FIXED * FIXED;
  if (hdr.width !== FIXED || hdr.height !== FIXED) fails.push(`${mode}: HDR 尺寸错误 (${hdr.width}x${hdr.height}, 期望 ${FIXED}x${FIXED})`);
  if (!Array.isArray(hdr.rgb) || hdr.rgb.length !== px * 3) fails.push(`${mode}: HDR rgb 长度错误 (${hdr.rgb?.length}, 期望 ${px * 3})`);
  else if (hdr.rgb.some((x) => !Number.isFinite(x))) fails.push(`${mode}: HDR rgb 含非有限数`);
  if (!Array.isArray(hdr.faceMask) || hdr.faceMask.length !== px) fails.push(`${mode}: HDR faceMask 长度错误 (${hdr.faceMask?.length}, 期望 ${px})`);
  else {
    // 严格校验：每个 mask 值必须是有限数且恰好为 0 或 1（拒绝 NaN/Infinity/2/true 等）。
    const badMask = hdr.faceMask.filter((x) => !Number.isFinite(x) || (x !== 0 && x !== 1));
    if (badMask.length > 0) { fails.push(`${mode}: HDR faceMask 含非法值 (非有限或非 0/1, ${badMask.length} 个)`); return; }
    const faceN = hdr.faceMask.reduce((a, b) => a + (b === 1 ? 1 : 0), 0);
    if (faceN < MIN_FACE_SAMPLES) fails.push(`${mode}: HDR Face 样本数不足 (${faceN})`);
  }
}
const fails = [];

// 真实绑定硬 Gate（bakedGolden）：直接读取引擎在 GPU 材质建立后的真实绑定状态
// canvas.dataset.v14dBakedActual（RezeWebGpuStage 从 model.getMaterials()/getTextures()
// 读取的 materialName|diffuseTextureIndex|logicalPath）。逐项核对：材质名命中、
// diffuseTextureIndex 指向独立追加的 texture entry、最终 logicalPath 等于预期唯一烘焙键。
// 这不再是自证名单——是 setupMaterialsForInstance 上传 GPUTexture/建 bind group 时的
// 实际来源。faceApplied=true 只证明 graph 应用，不作纹理注入通过证据。
function validateBakedBinding(state, fails) {
  const actual = (state.bakedActual || "").split(";").filter(Boolean).map((s) => {
    const [materialName, idx, logicalPath] = s.split("|");
    return { materialName, idx: Number(idx), logicalPath };
  });
  const expect = BAKED_BINDINGS.map(([key, pmx, file]) => ({ pmx, logicalPath: "Textures/v14d-baked/" + file }));
  if (actual.length !== expect.length) {
    fails.push(`bakedGolden: 引擎实际绑定材质数 ${actual.length} != 预期 ${expect.length}（真实 GPU 绑定未生效或缺文件）`);
  }
  // 逐项 path 匹配
  for (const e of expect) {
    const a = actual.find((x) => x.materialName === e.pmx);
    if (!a) { fails.push(`bakedGolden: 材质 ${e.pmx} 未在引擎实际绑定中出现`); continue; }
    if (a.logicalPath !== e.logicalPath) {
      fails.push(`bakedGolden: 材质 ${e.pmx} 实际绑定 ${a.logicalPath} != 预期 ${e.logicalPath}（GPU 纹理来源错误）`);
    }
  }
  // idx 必须为有限非负整数、互不相同，且恰好覆盖引擎报告的追加纹理区间 [start, start+count)。
  const start = Number(state.bakedTexStart);
  const count = Number(state.bakedTexCount);
  const idxs = actual.map((a) => a.idx);
  for (const a of actual) {
    if (!Number.isInteger(a.idx) || a.idx < 0) fails.push(`bakedGolden: 材质 ${a.materialName} 的 diffuseTextureIndex ${a.idx} 非有限非负整数`);
  }
  const dup = idxs.filter((v, i) => idxs.indexOf(v) !== i);
  if (dup.length) fails.push(`bakedGolden: diffuseTextureIndex 重复 [${[...new Set(dup)].join(",")}]（共享 texture entry，未独立绑定）`);
  if (Number.isInteger(start) && Number.isInteger(count) && count === expect.length) {
    const sorted = [...idxs].sort((a, b) => a - b);
    const expectRange = Array.from({ length: count }, (_, i) => start + i);
    const covers = sorted.length === expectRange.length && sorted.every((v, i) => v === expectRange[i]);
    if (!covers) {
      fails.push(`bakedGolden: 排序后 idx [${sorted.join(",")}] 未恰好覆盖追加区间 [${start}..${start + count - 1}]`);
    }
  } else {
    fails.push(`bakedGolden: 引擎未报告有效追加纹理区间 start=${state.bakedTexStart} count=${state.bakedTexCount}（补丁未生效）`);
  }
}

// 负向自验：故意错绑（Face→EyeWhite 的烘焙键）与漏绑（缺 Top）都必须被硬 Gate 拒绝，
// 证明 Gate 不是恒通过的摆设。正常九项才 exit 0。
if (process.argv.includes("--self-test-binding-gate")) {
  const good = BAKED_BINDINGS.map(([, pmx, file]) => `${pmx}|5|Textures/v14d-baked/${file}`).join(";");
  const wrongFace = BAKED_BINDINGS.map(([k, pmx, file]) => `${pmx}|5|Textures/v14d-baked/${k === "face" ? "baked_eyeWhite.png" : file}`).join(";");
  const missingTop = BAKED_BINDINGS.filter(([k]) => k !== "top").map(([, pmx, file]) => `${pmx}|5|Textures/v14d-baked/${file}`).join(";");
  const f1 = []; validateBakedBinding({ bakedActual: good }, f1);
  const f2 = []; validateBakedBinding({ bakedActual: wrongFace }, f2);
  const f3 = []; validateBakedBinding({ bakedActual: missingTop }, f3);
  let ok = true;
  if (f1.length) { ok = false; console.error("SELF-TEST-FAIL: 正常九项被误拒", f1); }
  if (!f2.length) { ok = false; console.error("SELF-TEST-FAIL: Face 错绑 EyeWhite 未被拒绝"); }
  if (!f3.length) { ok = false; console.error("SELF-TEST-FAIL: 漏绑 Top 未被拒绝"); }
  if (!ok) process.exit(1);
  console.log("===SELF-TEST-BINDING-GATE-OK=== 正常九项通过, 错绑/漏绑均被拒绝");
  process.exit(0);
}

for (const mode of MODES) {
  const m = summary.modes[mode];
  if (!m) { fails.push(`${mode}: 无采集结果`); continue; }
  if (m.state.webgpuStatus !== "ready") fails.push(`${mode}: canvas 未 ready (${m.state.webgpuStatus})`);
  if (m.state.faceStatic !== "true") fails.push(`${mode}: faceStatic 未启用`);
  if (m.state.mode !== mode) fails.push(`${mode}: 模式不一致 (${m.state.mode})`);
  if (m.state.frame !== "120" || m.state.state !== "2" || m.state.blend !== "0.00") fails.push(`${mode}: 状态帧错误 ${JSON.stringify(m.state)}`);
  if (m.state.cameraLocked !== "true" || m.state.paused !== "true") fails.push(`${mode}: 未锁定/暂停`);
  if (m.state.faceApplied !== "true") fails.push(`${mode}: Face 未应用 (${m.state.faceApplied})`);
  if (!m.roi || m.roi.error) fails.push(`${mode}: capture 错误 ${m.roi?.error || "none"}`);
  if ((m.roi?.roi?.faceSamples ?? 0) < MIN_FACE_SAMPLES) fails.push(`${mode}: faceSamples 不足 (${m.roi?.roi?.faceSamples})`);
  if (!m.roi?.meanLinear) fails.push(`${mode}: meanLinear 缺失`);
  // 正式浮点 HDR 证据硬校验：UV-direct Gate 的正式输入，缺任一项即失败。
  validateHdrEvidence(mode, m.hdr, fails);
  // 实时合成（faceShadowOnly/finalFaceComposite）：真实 GPU 双纹理绑定硬 Gate。
  if (mode === "faceShadowOnly" || mode === "finalFaceComposite") {
    if (m.state.liveBound !== "true") fails.push(mode + ": 实时合成双纹理绑定未通过 (liveBound=" + m.state.liveBound + ")");
    if (!m.state.liveFaceDiffuse || !/c_Koleda_slg_face_d/i.test(m.state.liveFaceDiffuse)) fails.push(mode + ": liveFaceDiffuse 非原始 face_d (" + m.state.liveFaceDiffuse + ")");
    if (m.state.liveMaskPath !== "Textures/v14d-state2-mask/state2.png") fails.push(mode + ": liveMaskPath 错误 (" + m.state.liveMaskPath + ")");
    if (!CAMERA_OVERRIDE) {
      const fov = Number(m.state.cameraFov);
      if (!Number.isFinite(fov) || fov <= 0) fails.push(mode + ": 相机 fov 非法/null (" + m.state.cameraFov + ")");
      if (!m.state.cameraPos) fails.push(mode + ": 相机 position 缺失");
    }
  }
  // bakedGolden：逐材质独立绑定硬 Gate（faceApplied 不再作为纹理注入通过证据）。
  if (mode === "bakedGolden") validateBakedBinding(m.state, fails);
}
if (summary.pageErrors.length) fails.push(`pageErrors=${summary.pageErrors.length}`);
if (summary.failedRequests.length) fails.push(`failedRequests=${summary.failedRequests.length}`);
if (summary.httpBadResponses.length) fails.push(`httpBad=${summary.httpBadResponses.length}`);
console.log("===CAPTURE-DONE===");
console.log(JSON.stringify({ pageErrors: summary.pageErrors.length, failedRequests: summary.failedRequests.length, httpBad: summary.httpBadResponses.length }));
if (fails.length) {
  console.error("===CAPTURE-GATE-FAIL===\n" + fails.join("\n"));
  process.exit(1);
}
console.log("===CAPTURE-GATE-OK===");
