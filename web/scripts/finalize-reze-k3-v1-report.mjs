// 把 visual-diff.json 合入 gate-report.json 的 G3，并生成 original/V1 并排差异图。
import fs from "node:fs"; import path from "node:path"; import sharp from "sharp";
const OUT = path.resolve(".scratch/reze-k3-v1-stage");
const report = JSON.parse(fs.readFileSync(path.join(OUT, "gate-report.json"), "utf8"));
const diff = JSON.parse(fs.readFileSync(path.join(OUT, "visual-diff.json"), "utf8"));
// 硬断言：仅当分析脚本判定通过（diff.pass===true）才合并 G3 为 pass；否则独立调用本脚本
// 也不得伪造通过（此前无条件 status:pass，主会话验收指出）。退出码非零。
if (diff.pass !== true) {
  console.error("finalize 拒绝合并：visual-diff pass !== true。failures=" + JSON.stringify(diff.failures || []));
  process.exit(1);
}
// 仅在 analyze 脚本判定通过后才合并；这里如实并入真实阈值与逐区域数据。
report.gates.G3 = { ...(report.gates.G3 || {}), status: "pass", failures: [], regionStats: diff.regions, verdict: diff.verdict, occluded: diff.occluded, thresholds: diff.thresholds, sampling: "皮肤区=肤色掩码采样；非皮肤区=剔除皮肤；背景区=暗空多数像素（排除亮星闪烁）" };
// 差异热图：|a-b| 逐像素放大 4x 生成灰度差异图 + 并排三联图。
async function diffHeat() {
  const a = await sharp(path.join(OUT, "g3-original-canvas.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(path.join(OUT, "g3-v1-canvas.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = a.info;
  const heat = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < a.data.length; i += 4, j += 3) {
    const d = Math.min(255, Math.round(((Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i+1] - b.data[i+1]) + Math.abs(a.data[i+2] - b.data[i+2])) / 3) * 6));
    heat[j] = d; heat[j+1] = d; heat[j+2] = d;
  }
  await sharp(heat, { raw: { width, height, channels: 3 } }).png().toFile(path.join(OUT, "g3-diff-heat.png"));
  // 并排三联：original | V1 | diff
  const w2 = width, h2 = height;
  const orig = await sharp(path.join(OUT, "g3-original-canvas.png")).png().toBuffer();
  const v1 = await sharp(path.join(OUT, "g3-v1-canvas.png")).png().toBuffer();
  const heatPng = await sharp(path.join(OUT, "g3-diff-heat.png")).png().toBuffer();
  await sharp({ create: { width: w2 * 3, height: h2, channels: 3, background: { r: 20, g: 20, b: 24 } } })
    .composite([{ input: orig, left: 0, top: 0 }, { input: v1, left: w2, top: 0 }, { input: heatPng, left: w2 * 2, top: 0 }])
    .png().toFile(path.join(OUT, "g3-side-by-side.png"));
}
await diffHeat();
report.screenshots.diffHeat = path.join(OUT, "g3-diff-heat.png");
report.screenshots.sideBySide = path.join(OUT, "g3-side-by-side.png");
fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify(report, null, 2));
console.log("merged G3 regionStats + verdict; side-by-side + diff heat written");
