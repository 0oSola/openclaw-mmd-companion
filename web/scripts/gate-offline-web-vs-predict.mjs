// 离线对照（Stage 2A-GF4 验收修正）：Web 实际显示字节 vs 离线同 UV 采样预测。
//
// 决定性分离「GPU sampler/passthrough 空间行为」与「几何/姿态错位」：
//   - 用 G3 保存的 UV 在 CPU 按引擎 sampler 语义（srgb 解码+mip0 双线性+OETF）从
//     atlas 采样，得到「若 GPU 链与离线口径一致时 Web 应显示的字节」（预测值）。
//   - 与 G4 实采的 Web 显示字节（g4-web-display-rgb.u8.bin）逐像素对照。
//   - 若两者 MAE 低（≈量化噪声）：GPU 链完全按离线口径工作，则 G4 的 27 MAE 来自
//     Web 内容（其 UV 对应的脸部物理位置）与 fresh 内容的几何/姿态差异 —— 几何根因
//     有证据；若 MAE 高：GPU sampler/passthrough 在空间变化下有未建模行为。
//
// 用法：node gate-offline-web-vs-predict.mjs <g3Dir> <g4Dir>
import fs from "node:fs";
import path from "node:path";

const G3 = process.argv[2] || ".scratch/v14d-agx-byte-capture/g3-atlas";
const G4 = process.argv[3] || ".scratch/v14d-agx-byte-capture/g4-result";
const meta = JSON.parse(fs.readFileSync(path.join(G3, "g3-offline-meta.json"), "utf8"));
const SIZE = meta.screenSize; const ATLAS = meta.atlasSize;
// 正式 Gate：GPU 链必须符合离线同 UV 采样预测（量化/双线性噪声级，≤20/255），
// 且正式样本只取「g4 mask ∩ g3 mask ∩ UV四邻近纹素全部 originalCoverage」。
const MAE_TOL = 20;
const MIN_SAMPLES = 1000;
const uvArr = new Float32Array(fs.readFileSync(path.join(G3, "g3-uv.f32.bin")).buffer.slice(0));
const g4Mask = new Uint8Array(fs.readFileSync(path.join(G4, "g4-mask.u8.bin")).buffer.slice(0));
const g3Mask = fs.existsSync(path.join(G3, "g3-mask.u8.bin"))
  ? new Uint8Array(fs.readFileSync(path.join(G3, "g3-mask.u8.bin")).buffer.slice(0))
  : null;
const pxAllOriginal = fs.existsSync(path.join(G3, "g3-px-all-original.u8.bin"))
  ? new Uint8Array(fs.readFileSync(path.join(G3, "g3-px-all-original.u8.bin")).buffer.slice(0))
  : null;
const atlas = new Uint8Array(fs.readFileSync(path.join(G3, "g3-atlas-rgb.u8.bin")).buffer.slice(0));
const webDisplay = new Uint8Array(fs.readFileSync(path.join(G4, "g4-web-display-rgb.u8.bin")).buffer.slice(0));

const srgbToLinear = (b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const linearToSrgb = (l) => { const c = Math.max(0, l); const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.min(1, s) * 255); };
const wrap = (t) => ((t % ATLAS) + ATLAS) % ATLAS;
function sampleAtlas(u, v) {
  const fx = u * (ATLAS - 1); const fy = v * (ATLAS - 1); // v 不翻转（与引擎采样一致）
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  const dx = fx - x0; const dy = fy - y0;
  const lin = [0, 0, 0];
  for (const [ox, oy, w] of [[0, 0, (1 - dx) * (1 - dy)], [1, 0, dx * (1 - dy)], [0, 1, (1 - dx) * dy], [1, 1, dx * dy]]) {
    if (w <= 0) continue;
    const t = wrap(y0 + oy) * ATLAS + wrap(x0 + ox);
    for (let c = 0; c < 3; c += 1) lin[c] += srgbToLinear(atlas[t * 4 + c]) * w;
  }
  return [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];
}
let n = 0; let missing = 0; const sumAbs = [0, 0, 0]; const absPerPx = [];
for (let i = 0; i < SIZE * SIZE; i += 1) {
  if (g4Mask[i] !== 1) continue;
  // 正式样本绑定 G3：须同时落在 g3 mask 且 UV 四邻近纹素全部 originalCoverage。
  if (g3Mask && pxAllOriginal && !(g3Mask[i] === 1 && pxAllOriginal[i] === 1)) { missing += 1; continue; }
  const u = uvArr[i * 2]; const v = uvArr[i * 2 + 1];
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) { missing += 1; continue; }
  const pred = sampleAtlas(u, v);
  n += 1;
  let pxMax = 0;
  for (let c = 0; c < 3; c += 1) {
    const d = Math.abs(webDisplay[i * 3 + c] - pred[c]);
    sumAbs[c] += d; if (d > pxMax) pxMax = d;
  }
  absPerPx.push(pxMax);
}
absPerPx.sort((a, b) => a - b);
const p95 = absPerPx.length ? absPerPx[Math.min(absPerPx.length - 1, Math.floor(absPerPx.length * 0.95))] : null;
const mae = sumAbs.map((s) => (n ? s / n : null));
const report = { samples: n, missing, mae, p95, note: "Web 实际显示 vs 离线同UV采样预测（正式样本=g4∩g3∩全originalCoverage）；低 MAE=GPU 链符合离线口径，高 MAE=GPU sampler/passthrough 空间行为未建模" };
fs.writeFileSync(path.join(G4, "offline-web-vs-predict.json"), JSON.stringify(report, null, 2));
console.log("===OFFLINE-WEB-VS-PREDICT===", JSON.stringify({ samples: n, missing, mae: mae.map((x) => (x === null ? null : +x.toFixed(2))), p95 }));
// ── 正式 Gate 判定 ──
const fails = [];
if (n < MIN_SAMPLES) fails.push(`samples ${n} < ${MIN_SAMPLES}`);
if (g3Mask && pxAllOriginal && missing > 0) fails.push(`missing=${missing}（含 dilation/填充样本）`);
for (let c = 0; c < 3; c += 1) if (mae[c] === null || mae[c] > MAE_TOL) fails.push(`通道 ${c} MAE ${mae[c]?.toFixed(2)} > ${MAE_TOL}`);
if (fails.length) { console.error("===OFFLINE-WEB-VS-PREDICT-FAIL===\n" + fails.join("\n")); process.exit(1); }
console.log("===OFFLINE-WEB-VS-PREDICT-OK=== GPU 链符合离线口径（MAE≤20）");
process.exit(0);
