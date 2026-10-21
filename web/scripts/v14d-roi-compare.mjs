// V14D 黄金帧四 ROI MAE 对比（0-255 域）。复用 web/node_modules/sharp 解码 PNG。
// 用法: node web/scripts/v14d-roi-compare.mjs <ref.png> <web.png> <out.json>
// ROI 归一化坐标与 color-baseline 口径一致（相对 640x640 画面）。
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const [refPath, webPath, outPath] = process.argv.slice(2);
if (!refPath || !webPath || !outPath) {
  console.error("usage: node v14d-roi-compare.mjs <ref.png> <web.png> <out.json>");
  process.exit(2);
}

// 归一化 [x,y,w,h]（相对画面宽/高），与 color-baseline / 历史 roi-compare 同口径。
const ROIS = {
  face: [0.4453, 0.3917, 0.1305, 0.1583],
  frontHair: [0.3734, 0.1653, 0.2164, 0.4639],
  backHair: [0.3883, 0.2639, 0.2680, 0.7361],
  chest: [0.4086, 0.6028, 0.2320, 0.3972],
};

async function loadRgb(p) {
  const img = sharp(p).removeAlpha();
  const meta = await img.metadata();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, refW: meta.width, refH: meta.height };
}

const ref = await loadRgb(refPath);
const web = await loadRgb(webPath);
if (ref.width !== web.width || ref.height !== web.height) {
  console.error(`size mismatch ref=${ref.width}x${ref.height} web=${web.width}x${web.height}`);
  process.exit(2);
}
const W = ref.width, H = ref.height;
const out = {};
for (const [id, [nx, ny, nw, nh]] of Object.entries(ROIS)) {
  const x0 = Math.max(0, Math.round(nx * W)), y0 = Math.max(0, Math.round(ny * H));
  const x1 = Math.min(W, Math.round((nx + nw) * W)), y1 = Math.min(H, Math.round((ny + nh) * H));
  const sum = [0, 0, 0]; let px = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * 3;
      sum[0] += Math.abs(ref.data[o] - web.data[o]);
      sum[1] += Math.abs(ref.data[o + 1] - web.data[o + 1]);
      sum[2] += Math.abs(ref.data[o + 2] - web.data[o + 2]);
      px++;
    }
  }
  out[id] = { mae: sum.map((s) => Number((s / px).toFixed(2))), px };
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
