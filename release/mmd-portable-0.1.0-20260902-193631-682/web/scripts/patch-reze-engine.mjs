/**
 * 幂等修补 node_modules/reze-engine 的 PMX 文本长度上限。
 *
 * 背景：上游 0.26.0 在 getText() 里有 1000 字节的任意防御上限（"Suspicious
 * string length"）。合法 PMX 的模型备注（如「克莱妲原皮」英文备注 1006 字节）
 * 会触发该上限，导致整个模型加载失败、WebGPU 舞台空白。Three.js MMDLoader 无
 * 此限制。这里移除该上限，保留真正的越界检查。
 *
 * 每次 dev/build 前由 predev/prebuild 钩子执行；npm install 重装依赖后也会
 * 自动重打。幂等：已打过则跳过。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const OLD_SRC = `    // Debug: log problematic string lengths
    if (len > 1000 || len < -1000) {
      throw new RangeError(\`Suspicious string length: \${len} at offset \${this.offset - 4}\`)
    }

`;
const OLD_DIST = `        // Debug: log problematic string lengths
        if (len > 1000 || len < -1000) {
            throw new RangeError(\`Suspicious string length: \${len} at offset \${this.offset - 4}\`);
        }
`;

const targets = [
  { file: path.join(rootDir, "node_modules", "reze-engine", "src", "pmx-loader.ts"), marker: OLD_SRC },
  { file: path.join(rootDir, "node_modules", "reze-engine", "dist", "pmx-loader.js"), marker: OLD_DIST },
];

let patched = 0;
for (const { file, marker } of targets) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, "utf8");
  if (!content.includes("Suspicious string length")) continue; // 已打过
  if (!content.includes(marker)) {
    console.warn(`[patch-reze-engine] 未匹配预期片段，跳过（上游可能已变更）: ${path.basename(file)}`);
    continue;
  }
  fs.writeFileSync(file, content.replace(marker, ""), "utf8");
  patched += 1;
  console.log(`[patch-reze-engine] 已移除 PMX 文本长度上限: ${path.basename(file)}`);
}
if (patched === 0) {
  console.log("[patch-reze-engine] 已是修补后状态，无需处理");
}
