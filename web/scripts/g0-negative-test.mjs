// G0 负测驱动：构造 manifest 变体，证明 decode-face-roi.mjs 在各类证据缺失时 exit≠0。
// 在临时目录运行，不触碰真实证据。通过才 exit0。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const G0 = path.join(__dirname, "decode-face-roi.mjs");
const SRC = path.resolve(".scratch/v14d-agx-byte-capture/g0-reference");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gf4-g0-neg-"));
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const pngDst = path.join(tmp, "ref.png");
fs.copyFileSync(path.join(SRC, "blender-v14d-frame120-rerender.png"), pngDst);
manifest.outputArtifact.path = pngDst;
// 提供一个通过的 Face-specific 对齐证据，隔离待测变量（字段与 capture --align-gate=1 一致）。
const alignOk = { status: "verified", pixelAligned: true, faceCoverage: 1.0, faceCoverageMin: 0.99, centroidShiftPx: 0, centroidMaxPx: 5, webCamera: { fov: 28.072486935852954, position: "0.564,18.55,-13" } };

function runCase(name, mutate, opts = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const m = JSON.parse(JSON.stringify(manifest));
  mutate(m, dir);
  const mp = path.join(dir, "manifest.json");
  fs.writeFileSync(mp, JSON.stringify(m, null, 2));
  if (opts.withState !== false) fs.copyFileSync(path.join(SRC, "g0-state-blend.json"), path.join(dir, "g0-state-blend.json"));
  if (opts.withAlign) fs.writeFileSync(path.join(dir, "g0-alignment.json"), JSON.stringify(alignOk));
  let code = 0;
  try { execFileSync(process.execPath, [G0, mp], { stdio: "pipe" }); } catch (e) { code = e.status ?? 1; }
  const pass = code !== 0;
  console.log(`${pass ? "OK " : "FAIL"} [${name}] exit=${code}（期望非0）`);
  return pass;
}

let all = true;
// 1. 缺 State/Blend 取证文件
all = runCase("missing-state", () => {}, { withState: false, withAlign: true }) && all;
// 2. 缺 source SHA
all = runCase("missing-source-sha", (m) => { delete m.sourceBlendIntegrity.sha256Before; }, { withAlign: true }) && all;
// 3. source SHA 不等于权威
all = runCase("wrong-source-sha", (m) => { m.sourceBlendIntegrity.sha256Before = "0".repeat(64); m.sourceBlendIntegrity.sha256After = "0".repeat(64); }, { withAlign: true }) && all;
// 4. 缺 output SHA
all = runCase("missing-output-sha", (m) => { delete m.outputArtifact.sha256; }, { withAlign: true }) && all;
// 5. output SHA 与磁盘不一致
all = runCase("wrong-output-sha", (m) => { m.outputArtifact.sha256 = "f".repeat(64); }, { withAlign: true }) && all;
// 6. 错误 camera（objectName）
all = runCase("wrong-camera", (m) => { m.camera.objectName = "WrongCam"; }, { withAlign: true }) && all;
// 7. 错误 camera lens
all = runCase("wrong-lens", (m) => { m.camera.lens = 50; }, { withAlign: true }) && all;
// 8. alignment not-verified 且无独立证据
all = runCase("align-not-verified", () => {}, { withAlign: false }) && all;
// 9. alignment 证据 pixelAligned=false
all = runCase("align-false", (m, dir) => { fs.writeFileSync(path.join(dir, "g0-alignment.json"), JSON.stringify({ status: "not-verified", pixelAligned: false, faceCoverage: 0.5, faceCoverageMin: 0.99, centroidShiftPx: 30, centroidMaxPx: 5 })); }, {}) && all;
// 10. IHDR 尺寸记录与真实不符（篡改 pngHeader）
all = runCase("wrong-ihdr", (m) => { m.outputArtifact.pngHeader.width = 320; }, { withAlign: true }) && all;

fs.rmSync(tmp, { recursive: true, force: true });
if (!all) { console.error("===G0-NEGATIVE-FAIL=== 存在未拦截场景"); process.exit(1); }
console.log("===G0-NEGATIVE-OK=== 全部 10 个负测场景均非零退出");
