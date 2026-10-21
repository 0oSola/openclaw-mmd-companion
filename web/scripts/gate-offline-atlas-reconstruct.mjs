// 离线 atlas 重建 Gate（Stage 2A-GF4 验收修正，P0）。
//
// 目的：不启动浏览器/GPU，在 CPU 上按引擎实际 sampler 语义重建 Web 对反投影 atlas
// 的采样，与 fresh AgX PNG 原始显示字节对照，把「反投影/冲突聚合/覆盖/dilation/
// 过滤口径」的根因与「GPU sampler/passthrough」的根因分离。
//
// 引擎实际 sampler（reze-engine setupMaterialsForInstance + materialSampler）：
//   - 纹理格式 rgba8unorm-srgb（硬件在采样时把每纹素 sRGB 字节解码为 linear）；
//   - mag/min/mipmapFilter 全 linear（trilinear）；addressMode repeat/repeat；
//   - 材质纹理带完整 mipmap 链（generateMipmaps，srgb 视图线性空间 box 滤波）。
// 本 Gate 复现 mip-level-0 的双线性采样（Face 在 640 屏近距离、magnification 主导，
// LOD≈0）；trilinear/mipmap 影响单列为近似边界，见输出字段 filterModel。
//
// 采样重建链：UV → 邻近 4 纹素 sRGB 字节 → 逐纹素 sRGB→linear 解码 → 双线性插值
//（linear 域）→ linear→sRGB OETF 编码 → 8-bit 显示字节。
//
// 样本只取「g4Mask ∩ g3Mask ∩ 该像素 UV 的 4 邻近纹素全部落在 originalCoverage」，
// dilation/均值填充生成的缺失区域不得伪装为有效样本（missing 单列）。
//
// 用法：node gate-offline-atlas-reconstruct.mjs <freshPng> <g3Dir> <g4Dir>
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const FRESH_PNG = process.argv[2];
const G3 = process.argv[3] || ".scratch/v14d-agx-byte-capture/g3-atlas";
const G4 = process.argv[4] || ".scratch/v14d-agx-byte-capture/g4-result";
if (!FRESH_PNG || !fs.existsSync(FRESH_PNG)) { console.error("缺 fresh PNG"); process.exit(2); }

const meta = JSON.parse(fs.readFileSync(path.join(G3, "g3-offline-meta.json"), "utf8"));
const SIZE = meta.screenSize; const ATLAS = meta.atlasSize;
// 正式 Gate 阈值与样本下限（不足则视为无效证据）。
const MAE_TOL = 20;
const MIN_SAMPLES = 1000;

const uvArr = new Float32Array(fs.readFileSync(path.join(G3, "g3-uv.f32.bin")).buffer.slice(0));
const faceMask = new Uint8Array(fs.readFileSync(path.join(G3, "g3-facemask.u8.bin")).buffer.slice(0));
const g3Mask = new Uint8Array(fs.readFileSync(path.join(G3, "g3-mask.u8.bin")).buffer.slice(0));
const originalCoverage = new Uint8Array(fs.readFileSync(path.join(G3, "g3-original-coverage.u8.bin")).buffer.slice(0));
const atlas = new Uint8Array(fs.readFileSync(path.join(G3, "g3-atlas-rgb.u8.bin")).buffer.slice(0));
const g4Mask = fs.existsSync(path.join(G4, "g4-mask.u8.bin"))
  ? new Uint8Array(fs.readFileSync(path.join(G4, "g4-mask.u8.bin")).buffer.slice(0))
  : g3Mask;

const freshRaw = await sharp(FRESH_PNG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (freshRaw.info.width !== SIZE || freshRaw.info.height !== SIZE) { console.error("fresh PNG 尺寸错误"); process.exit(2); }
const fresh = freshRaw.data;

// sRGB 解码（EOTF）与编码（OETF），与引擎硬件/补丁一致。
const srgbToLinear = (b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const linearToSrgb = (l) => { const c = Math.max(0, l); const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.min(1, s) * 255); };

// repeat wrap
const wrap = (t) => ((t % ATLAS) + ATLAS) % ATLAS;

// 按引擎 sampler 从 atlas 采样 UV 处的显示字节（mip0 双线性，linear 域插值）。
function sampleAtlas(u, v) {
  const fx = u * (ATLAS - 1);
  const fy = v * (ATLAS - 1); // v 不翻转（与引擎采样一致，GF4 验收修正）
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  const dx = fx - x0; const dy = fy - y0;
  const lin = [0, 0, 0];
  let allOriginal = true;
  for (const [ox, oy, w] of [[0, 0, (1 - dx) * (1 - dy)], [1, 0, dx * (1 - dy)], [0, 1, (1 - dx) * dy], [1, 1, dx * dy]]) {
    if (w <= 0) continue;
    const tx = wrap(x0 + ox); const ty = wrap(y0 + oy);
    const t = ty * ATLAS + tx;
    if (originalCoverage[t] !== 1) allOriginal = false;
    for (let c = 0; c < 3; c += 1) lin[c] += srgbToLinear(atlas[t * 4 + c]) * w;
  }
  return { rgb: [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])], allOriginal };
}

let n = 0; let missing = 0; const sumAbs = [0, 0, 0]; const absPerPx = [];
let g4Count = 0; let g3Count = 0; let interCount = 0;
for (let i = 0; i < SIZE * SIZE; i += 1) {
  const g4 = g4Mask[i] === 1; const g3 = g3Mask[i] === 1;
  if (g4) g4Count += 1; if (g3) g3Count += 1; if (g4 && g3) interCount += 1;
  if (!(g4 && g3)) continue;
  const u = uvArr[i * 2]; const v = uvArr[i * 2 + 1];
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) { missing += 1; continue; }
  const s = sampleAtlas(u, v);
  if (!s.allOriginal) { missing += 1; continue; } // 邻近纹素含 dilation/填充，剔除
  n += 1;
  let pxMax = 0;
  for (let c = 0; c < 3; c += 1) {
    const d = Math.abs(fresh[i * 4 + c] - s.rgb[c]);
    sumAbs[c] += d; if (d > pxMax) pxMax = d;
  }
  absPerPx.push(pxMax);
}
absPerPx.sort((a, b) => a - b);
const p95 = absPerPx.length ? absPerPx[Math.min(absPerPx.length - 1, Math.floor(absPerPx.length * 0.95))] : null;
const mae = sumAbs.map((s) => (n ? s / n : null));

const report = {
  freshPng: path.resolve(FRESH_PNG),
  filterModel: "mip-level-0 双线性（magnification 主导 LOD≈0）；引擎实际为 trilinear+mipmap，影响单列",
  wrap: "repeat/repeat", textureFormat: "rgba8unorm-srgb",
  chain: "UV → 邻近4纹素 sRGB字节 → 逐纹素 sRGB→linear 解码 → linear 双线性插值 → linear→sRGB OETF → 8-bit",
  g3MaskCount: g3Count, g4MaskCount: g4Count, intersection: interCount,
  missing, originalCoverageTexels: originalCoverage.reduce((a, b) => a + b, 0),
  formalSamples: n, mae, p95,
};
fs.writeFileSync(path.join(G4, "offline-reconstruct-result.json"), JSON.stringify(report, null, 2));
console.log("===OFFLINE-ATLAS-RECONSTRUCT===", JSON.stringify({ formalSamples: n, missing, intersection: interCount, mae: mae.map((x) => (x === null ? null : +x.toFixed(2))), p95 }));

// ── 正式 Gate 判定（exit code 与 pass/fail 一致） ──
// 失败条件：formalSamples 不足、missing>0（含 dilation/填充样本）、任一通道 MAE>20。
const gateFails = [];
if (n < MIN_SAMPLES) gateFails.push(`formalSamples ${n} < ${MIN_SAMPLES}`);
if (missing > 0) gateFails.push(`missing=${missing}（g4∩g3 内有像素 UV 邻近纹素含 dilation/填充，不得进入正式 MAE）`);
for (let c = 0; c < 3; c += 1) if (mae[c] === null || mae[c] > MAE_TOL) gateFails.push(`通道 ${c} MAE ${mae[c]?.toFixed(2)} > ${MAE_TOL}`);
if (gateFails.length) {
  console.error("===OFFLINE-ATLAS-GATE-FAIL===\n" + gateFails.join("\n"));
  console.error("根因在反投影/冲突聚合/覆盖/dilation/过滤口径");
  process.exit(1);
}
console.log("===OFFLINE-ATLAS-GATE-OK=== 离线重建 MAE≤20 且 missing=0：反投影/覆盖足够，剩余误差归 GPU sampler/passthrough");
process.exit(0);
