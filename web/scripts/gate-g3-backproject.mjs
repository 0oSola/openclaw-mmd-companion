// G3 AgX 显示字节反投影（Stage 2A-GF4，仅 Face）。
//
// 以磁盘权威 AgX PNG 的**原始 8-bit 显示字节**（sharp 字节域解码，不用 image.pixels
// 猜颜色空间）为源，按屏幕像素→UV 反投影到 Face atlas：
//   1) 采集 uvDebug 模式（与 bakedGolden 同 frame120/相机/栅格）的逐像素插值 UV 与
//      Face 可见像素 mask（pick pass 逐像素材质 ID）。
//   2) 用 fresh PNG 原始 RGB 字节：对每个 Face 可见屏幕像素，把其显示字节写入
//      atlas 上该像素 UV 对应的纹素。
//   3) 冲突聚合（多屏幕像素→同纹素）取均值并计数；未覆盖纹素用边界扩张填充
//      （最近已覆盖纹素），记录覆盖像素、冲突数、未覆盖策略。
//
// 产物：候选 Face atlas PNG + 覆盖统计 JSON。脚本失败 exit 1。
//
// 用法：node gate-g3-backproject.mjs <freshPng> [outDir]
import { chromium } from "playwright";
import sharp from "sharp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// 与 G4 共享的腐蚀函数（4 邻域）。保持同一份实现，避免 G3/G4 mask 语义漂移。
export function erodeMask(mask, size, iters = 2) {
  let cur = mask;
  for (let k = 0; k < iters; k += 1) {
    const out = new Uint8Array(size * size);
    for (let y = 1; y < size - 1; y += 1) for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      if (cur[i] === 1 && cur[i - 1] === 1 && cur[i + 1] === 1 && cur[i - size] === 1 && cur[i + size] === 1) out[i] = 1;
    }
    cur = out;
  }
  return cur;
}

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3102/mmd-calibration-render";
const FRESH_PNG = process.argv[2];
const OUT = path.resolve(process.argv[3] || ".scratch/v14d-agx-byte-capture/g3-atlas");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX = process.env.V14D_PMX || path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const SIZE = 640;
const ATLAS = 1024; // Face atlas 1024×1024（与 baked_face.png / face_d 一致）

if (!FRESH_PNG || !fs.existsSync(FRESH_PNG)) { console.error("缺 fresh PNG: " + FRESH_PNG); process.exit(2); }
if (!fs.existsSync(PMX)) { console.error("缺权威 PMX: " + PMX); process.exit(2); }
if (!fs.existsSync(VMD)) { console.error("缺权威 VMD: " + VMD); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

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
const modelPaths = collectModelFiles(KOLEDA_DIR);

// ── 步骤 1：采集 uvDebug 模式的逐像素 UV + Face mask ──
async function captureUv() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-g3-chrome-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_EXE, headless: false, viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
  });
  const pageErrors = [];
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
      else filePath = path.join(KOLEDA_DIR, key);
      if (filePath && fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(filePath) });
      }
      return route.fulfill({ status: 404, body: "missing " + key });
    });
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e)));
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
      for (const rel of manifest.files) modelFiles.push(await fetchFile(rel, rel));
      const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
      const pmxFile = await fetchFile(pmxRel, pmxRel);
      const vmdFile = await fetchFile("vmd", null);
      // uvDebug 模式不需要纹理覆盖（Face 只输出 UV），faceOverride 用原始 face_d 占位。
      window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride: null, bakedTextures: null };
    }, { route: "http://v14d-asset.local/a" });
    const modelUrl = "http://v14d-asset.local/a?v14dasset=pmx";
    const vmdUrl = "http://v14d-asset.local/a?v14dasset=vmd";
    const query = new URLSearchParams({ modelUrl, vmdUrl, v14dFaceStatic: "1", v14dFaceMode: "uvDebug" });
    await page.goto(`${BASE}?${query.toString()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("[data-testid='mmd-calibration-render']", { timeout: 60000 });
    await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
    await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
    await page.waitForTimeout(1200);
    const uv = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      if (!api || !api.exportFaceUvPng) return null;
      const r = await api.exportFaceUvPng();
      if (!r) return null;
      return { width: r.width, height: r.height, faceMaterialId: r.faceMaterialId, uv: Array.from(r.uv), faceMask: Array.from(r.faceMask) };
    });
    if (pageErrors.length) throw new Error("uvDebug pageErrors: " + pageErrors.join("; "));
    if (!uv) throw new Error("exportFaceUvPng 返回 null");
    return uv;
  } finally {
    await context.close();
  }
}

const uvCap = await captureUv();
const faceMask = Uint8Array.from(uvCap.faceMask);
const uvArr = Float32Array.from(uvCap.uv);
const faceSamples = faceMask.reduce((a, b) => a + b, 0);
if (faceSamples < 1000) { console.error("G3 Face 可见像素不足: " + faceSamples); process.exit(1); }

// ── 步骤 2：读 fresh PNG 原始 RGB 字节（sharp 字节域，明确不做颜色空间猜测） ──
const freshRaw = await sharp(FRESH_PNG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: fw, height: fh } = freshRaw.info;
if (fw !== SIZE || fh !== SIZE) { console.error(`fresh PNG 尺寸 ${fw}x${fh} != ${SIZE}x${SIZE}`); process.exit(1); }
const freshBytes = freshRaw.data; // RGBA 8-bit 原始字节

// ── 步骤 3：反投影到 Face atlas ──
// UV→atlas 纹素：x=u*(ATLAS-1)、y=v*(ATLAS-1)。
// 关键（GF4 验收修正发现）：引擎/WebGPU 采样 diffuse 纹理时 v **不翻转**（y=v）。
// 此前误用 y=(1-v) 翻转，把 atlas 上下镜像写入，空间渐变错位导致 Web G4 MAE 27
// （色块均匀不受影响故 G1 假阳性通过）。离线对照（gate-offline-web-vs-predict）
// 实证：v 不翻转时 Web 显示 vs 离线同 UV 采样预测 MAE 由 27 降至 ~9。
// 冲突聚合：同纹素多屏幕像素取均值，计数。未覆盖纹素：边界扩张（最近已覆盖纹素）。
// 双线性 splatting：每屏幕可见像素按 UV 小数部分把显示字节加权散布到周围 4 纹素。
// 比最近邻显著提高有效覆盖密度，减少双线性采样插值到未覆盖空洞/dilation 填充色。
const wsum = new Float64Array(ATLAS * ATLAS * 3);
const wcnt = new Float64Array(ATLAS * ATLAS); // 权重和（覆盖强度）
let coveredScreenPx = 0;
for (let i = 0; i < SIZE * SIZE; i += 1) {
  if (faceMask[i] !== 1) continue;
  const u = uvArr[i * 2]; const v = uvArr[i * 2 + 1];
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue; // 非法 UV 跳过
  const fx = u * (ATLAS - 1);
  const fy = v * (ATLAS - 1); // v 不翻转（与引擎采样一致）
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  const dx = fx - x0; const dy = fy - y0;
  const soff = i * 4;
  const r = freshBytes[soff]; const g = freshBytes[soff + 1]; const b = freshBytes[soff + 2];
  const w = [(1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy];
  const offs = [[0, 0], [1, 0], [0, 1], [1, 1]];
  for (let k = 0; k < 4; k += 1) {
    const nx = x0 + offs[k][0]; const ny = y0 + offs[k][1];
    if (nx < 0 || ny < 0 || nx >= ATLAS || ny >= ATLAS) continue;
    const t = ny * ATLAS + nx; const ww = w[k];
    if (ww <= 0) continue;
    wsum[t * 3] += r * ww; wsum[t * 3 + 1] += g * ww; wsum[t * 3 + 2] += b * ww;
    wcnt[t] += ww;
  }
  coveredScreenPx += 1;
}
let coveredTexels = 0; let conflictTexels = 0;
const atlas = new Uint8Array(ATLAS * ATLAS * 4);
const cnt = new Uint32Array(ATLAS * ATLAS); // 供 dilation 判断已覆盖
for (let t = 0; t < ATLAS * ATLAS; t += 1) {
  if (wcnt[t] > 0) {
    coveredTexels += 1;
    if (wcnt[t] > 1.5) conflictTexels += 1;
    atlas[t * 4] = Math.round(wsum[t * 3] / wcnt[t]);
    atlas[t * 4 + 1] = Math.round(wsum[t * 3 + 1] / wcnt[t]);
    atlas[t * 4 + 2] = Math.round(wsum[t * 3 + 2] / wcnt[t]);
    atlas[t * 4 + 3] = 255;
    cnt[t] = 1;
  }
}
// 原始有效覆盖（splat 权重>0，dilation 前的二值快照）：离线重建 Gate 只在其上采样本，
// dilation/均值填充区不得伪装为有效样本。
const originalCoverage = Uint8Array.from(cnt);
// 边界扩张：未覆盖纹素用 3×3 邻域均值迭代填充（有界 24 次，填 UV 岛边缘过渡带）。
// 不追求填满全图——G4 只采样 Face 可见像素（其 UV 落在覆盖区+过渡带）。
let unfilled = ATLAS * ATLAS - coveredTexels;
let iters = 0;
const DILATE_MAX = 24;
while (unfilled > 0 && iters < DILATE_MAX) {
  iters += 1;
  let added = 0;
  const next = Uint8Array.from(atlas);
  const nextCnt = Uint32Array.from(cnt);
  for (let y = 0; y < ATLAS; y += 1) {
    for (let x = 0; x < ATLAS; x += 1) {
      const t = y * ATLAS + x;
      if (cnt[t] > 0) continue;
      let sr = 0, sg = 0, sb = 0, sc = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ATLAS || ny >= ATLAS) continue;
        const nt = ny * ATLAS + nx;
        if (cnt[nt] > 0) { sr += atlas[nt * 4]; sg += atlas[nt * 4 + 1]; sb += atlas[nt * 4 + 2]; sc += 1; }
      }
      if (sc > 0) {
        next[t * 4] = Math.round(sr / sc); next[t * 4 + 1] = Math.round(sg / sc); next[t * 4 + 2] = Math.round(sb / sc); next[t * 4 + 3] = 255;
        nextCnt[t] = 1; added += 1;
      }
    }
  }
  atlas.set(next); cnt.set(nextCnt);
  unfilled -= added;
  if (added === 0) break;
}
// 残余未覆盖（UV 岛外，永不被 G4 采样）填覆盖区均值色，避免偶发采样取纯黑。
if (unfilled > 0 && coveredTexels > 0) {
  let mr = 0, mg = 0, mb = 0, mc = 0;
  for (let t = 0; t < ATLAS * ATLAS; t += 1) if (cnt[t] > 0) { mr += atlas[t * 4]; mg += atlas[t * 4 + 1]; mb += atlas[t * 4 + 2]; mc += 1; }
  if (mc > 0) {
    mr = Math.round(mr / mc); mg = Math.round(mg / mc); mb = Math.round(mb / mc);
    for (let t = 0; t < ATLAS * ATLAS; t += 1) if (cnt[t] === 0) { atlas[t * 4] = mr; atlas[t * 4 + 1] = mg; atlas[t * 4 + 2] = mb; atlas[t * 4 + 3] = 255; }
  }
}

const atlasPath = path.join(OUT, "face-atlas-backproject.png");
await sharp(Buffer.from(atlas), { raw: { width: ATLAS, height: ATLAS, channels: 4 } }).png().toFile(atlasPath);
// 生成标识：最终 atlas PNG 的内容 SHA（G4 必须证明实际注入的 baked_face.png 就是它）。
const atlasSha = crypto.createHash("sha256").update(fs.readFileSync(atlasPath)).digest("hex");
const stats = {
  freshPng: path.resolve(FRESH_PNG),
  atlas: atlasPath,
  atlasSha256: atlasSha,
  atlasSize: ATLAS,
  screenSize: SIZE,
  faceVisibleScreenPx: faceSamples,
  coveredScreenPx,
  coveredTexels,
  conflictTexels,
  conflictRate: coveredTexels ? conflictTexels / coveredTexels : 0,
  coverageRate: coveredTexels / (ATLAS * ATLAS),
  dilationIters: iters,
  unfilledAfterDilation: unfilled,
  uvConvention: "x=u*(ATLAS-1), y=v*(ATLAS-1)（v 不翻转，与引擎采样一致）",
  conflictPolicy: "同纹素多屏幕像素取均值",
  uncoveredPolicy: "边界扩张（3x3 邻域均值迭代填充）",
};
fs.writeFileSync(path.join(OUT, "g3-stats.json"), JSON.stringify(stats, null, 2));

// ── 保存离线重建 Gate 与 G4 绑定的全部输入（纯数据，不做任何对照结论） ──
// originalCoverage：splat 后 dilation 前的二值原始有效覆盖；uv/faceMask：uvDebug
// 模式的逐像素插值 UV 与 Face 可见 mask；g3Mask：腐蚀后的 Face mask（与 G4 同语义）。
// （erodeMask 已提升为模块级共享函数，G4 直接 import 复用同一实现。）
const g3Mask = erodeMask(faceMask, SIZE, 2);
fs.writeFileSync(path.join(OUT, "g3-uv.f32.bin"), Buffer.from(uvArr.buffer, uvArr.byteOffset, uvArr.byteLength));
fs.writeFileSync(path.join(OUT, "g3-facemask.u8.bin"), Buffer.from(faceMask.buffer, faceMask.byteOffset, faceMask.byteLength));
fs.writeFileSync(path.join(OUT, "g3-mask.u8.bin"), Buffer.from(g3Mask.buffer, g3Mask.byteOffset, g3Mask.byteLength));
fs.writeFileSync(path.join(OUT, "g3-original-coverage.u8.bin"), Buffer.from(originalCoverage.buffer, originalCoverage.byteOffset, originalCoverage.byteLength));
fs.writeFileSync(path.join(OUT, "g3-atlas-rgb.u8.bin"), Buffer.from(atlas.buffer, atlas.byteOffset, atlas.byteLength));
// 逐屏幕像素「UV 4 邻近纹素全部属于 originalCoverage」布尔（G4 正式样本的第三个条件）。
const pxAllOriginal = new Uint8Array(SIZE * SIZE);
for (let i = 0; i < SIZE * SIZE; i += 1) {
  const u = uvArr[i * 2]; const v = uvArr[i * 2 + 1];
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) continue;
  const fx = u * (ATLAS - 1); const fy = v * (ATLAS - 1);
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  const dx = fx - x0; const dy = fy - y0;
  let all = true;
  for (const [ox, oy, w] of [[0, 0, (1 - dx) * (1 - dy)], [1, 0, dx * (1 - dy)], [0, 1, (1 - dx) * dy], [1, 1, dx * dy]]) {
    if (w <= 0) continue;
    const tx = ((x0 + ox) % ATLAS + ATLAS) % ATLAS; const ty = ((y0 + oy) % ATLAS + ATLAS) % ATLAS;
    if (originalCoverage[ty * ATLAS + tx] !== 1) { all = false; break; }
  }
  if (all) pxAllOriginal[i] = 1;
}
fs.writeFileSync(path.join(OUT, "g3-px-all-original.u8.bin"), Buffer.from(pxAllOriginal.buffer));
const offlineMeta = {
  screenSize: SIZE, atlasSize: ATLAS, faceMaterialId: uvCap.faceMaterialId,
  atlasSha256: atlasSha,
  files: {
    uv: "g3-uv.f32.bin (float32, size*size*2, 行主序 [u,v])",
    faceMask: "g3-facemask.u8.bin (uint8, size*size, 0/1)",
    g3Mask: "g3-mask.u8.bin (uint8, size*size, 0/1, 腐蚀2次)",
    originalCoverage: "g3-original-coverage.u8.bin (uint8, atlas*atlas, 0/1, splat后dilation前)",
    pxAllOriginal: "g3-px-all-original.u8.bin (uint8, size*size, 0/1, UV四邻近纹素全部originalCoverage)",
    atlasRgb: "g3-atlas-rgb.u8.bin (uint8, atlas*atlas*4, dilation后最终atlas RGBA)",
  },
};
fs.writeFileSync(path.join(OUT, "g3-offline-meta.json"), JSON.stringify(offlineMeta, null, 2));

console.log("===G3-BACKPROJECT===", JSON.stringify({ coveredTexels, conflictTexels, coverageRate: stats.coverageRate.toFixed(4), dilationIters: iters, unfilled }));
if (coveredTexels < 100) { console.error("===G3-GATE-FAIL=== 覆盖纹素过少"); process.exit(1); }
console.log("===G3-GATE-OK=== Face atlas 反投影完成: " + atlasPath);
