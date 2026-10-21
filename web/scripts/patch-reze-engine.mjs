/**
 * 幂等修补 node_modules/reze-engine 的 PMX 文本长度上限。
 *
 * 第二处补丁：给 files 版 Engine.loadModel 增加默认关闭的 materialDiffuseOverrides
 * （材质名 → 唯一 logicalPath）。在 PmxLoader.loadFromReader() 之后、
 * addModel()/setupMaterialsForInstance()（GPU 纹理上传与 bind group 建立）之前，
 * 为每个目标材质**追加独立 texture entry 并改 diffuseTextureIndex**。这才是真实
 * GPU 绑定：修正此前在 loadModel 返回后才改 tex.path（不会重传 GPUTexture/重建
 * bind group）的伪绑定。不改磁盘 PMX、材质槽、拓扑或 VMD。
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
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const V14D_AUTHORITY_PATH = path.join(rootDir, "src", "features", "stage", "v14dAuthority.js");
let V14D_HAIR_TINT;
let V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR;
try {
  ({ V14D_HAIR_TINT, V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR } = await import(pathToFileURL(V14D_AUTHORITY_PATH).href));
} catch (error) {
  throw new Error("无法加载 V14D 唯一权威模块: " + V14D_AUTHORITY_PATH + "（" + (error?.message || error) + "）");
}
if (!Array.isArray(V14D_HAIR_TINT) || V14D_HAIR_TINT.length !== 3
  || V14D_HAIR_TINT.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
  throw new Error("V14D_HAIR_TINT 权威导出必须是 3 个 [0,1] 范围内的有限数值");
}
const V14D_HAIR_TINT_LITERAL = JSON.stringify(V14D_HAIR_TINT);
// wrongAlpha 故障因子唯一权威：与引擎/分析器同一 v14dAuthority.js 导出，禁止手写漂移。
if (typeof V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR !== "number"
  || !Number.isFinite(V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR)
  || V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR <= 0 || V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR >= 1e-6) {
  throw new Error("V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR 权威导出必须是 (0,1e-6) 内的有限数值（须低于 hashed clamp 下限 1e-6 才真实剔除片元）");
}
const V14D_WRONG_ALPHA_FAULT_FACTOR_LITERAL = String(V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR);

// ─── --self-test 早退分流（必须在任何真实 node_modules 写入/patch target 遍历/strict verify 之前）───
// 本块自包含、只操作临时目录：构造干净 reze-engine 0.26.0 隔离 fixture，
// 用子进程调用同一脚本文件（重写 rootDir 指向临时 fixture）跑真实生产控制流，
// 验证首次注入/二次幂等/anchor-miss 负测；真实 web/node_modules 前后 SHA256 不变自证不触碰。
if (process.argv.includes("--self-test")) {
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const sha = (fp) => createHash("sha256").update(fs.readFileSync(fp)).digest("hex");
  const realRoot = rootDir;
  const selfSrc = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const fails = [];
  const ok = (c, m) => { if (c) console.log("[self-test ok] " + m); else { fails.push(m); console.error("[self-test FAIL] " + m); } };
  // 真实 node_modules 关键文件前后 SHA256（证明本自测不触碰真实依赖）。
  const FRESH_HASH_RELATIVE_FILES = [
    "src/pmx-loader.ts", "dist/pmx-loader.js",
    "src/engine.ts", "dist/engine.js", "dist/engine.d.ts",
    "src/graph/slots.ts", "dist/graph/slots.js",
    "src/graph/compile.ts", "dist/graph/compile.js",
    "src/shaders/passes/composite.ts", "dist/shaders/passes/composite.js",
  ];
  const hashTargetSet = (baseRoot) => Object.fromEntries(FRESH_HASH_RELATIVE_FILES.map((relative) => {
    const file = path.join(baseRoot, "node_modules", "reze-engine", relative);
    return [relative, fs.existsSync(file) ? sha(file) : "missing"];
  }));
  const realShaBefore = hashTargetSet(realRoot);
  // 1) 构造干净隔离 fixture：需要一份未打本票补丁的 reze-engine 0.26.0。
  //    从 npm registry tarball 解出（registry.npmjs.org/reze-engine/-/reze-engine-0.26.0.tgz）。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "state2-fresh-root-"));
  const cleanRoot = path.join(tmp, "clean-web");
  const fixtureRoot = path.join(tmp, "patched-web");
  fs.mkdirSync(path.join(cleanRoot, "node_modules"), { recursive: true });
  const tgz = path.join(tmp, "reze.tgz");
  const { get } = await import("node:https");
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tgz);
    get("https://registry.npmjs.org/reze-engine/-/reze-engine-0.26.0.tgz", (res) => {
      if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return; }
      res.pipe(out); out.on("finish", () => out.close(resolve));
    }).on("error", reject);
  });
  const { execSync } = await import("node:child_process");
  const unpack = path.join(tmp, "unpack"); fs.mkdirSync(unpack, { recursive: true });
  execSync("tar -xzf " + JSON.stringify(tgz) + " -C " + JSON.stringify(unpack), { stdio: "pipe" });
  fs.cpSync(path.join(unpack, "package"), path.join(cleanRoot, "node_modules", "reze-engine"), { recursive: true });
  const authorityFixture = path.join(cleanRoot, "src", "features", "stage", "v14dAuthority.js");
  fs.mkdirSync(path.dirname(authorityFixture), { recursive: true });
  fs.copyFileSync(path.join(realRoot, "src", "features", "stage", "v14dAuthority.js"), authorityFixture);
  fs.cpSync(cleanRoot, fixtureRoot, { recursive: true });
  // fixture 初始必须未打 State2 补丁（helper 不存在 / 走旧路径）。
  const cleanSlotsSrc = path.join(cleanRoot, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  const cleanEngineSrc = path.join(cleanRoot, "node_modules", "reze-engine", "src", "engine.ts");
  const cleanEngineDist = path.join(cleanRoot, "node_modules", "reze-engine", "dist", "engine.js");
  const cleanEngineDts = path.join(cleanRoot, "node_modules", "reze-engine", "dist", "engine.d.ts");
  const fixSlotsSrc = path.join(fixtureRoot, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  const fixSlotsDist = path.join(fixtureRoot, "node_modules", "reze-engine", "dist", "graph", "slots.js");
  const fixSrc0 = fs.readFileSync(cleanSlotsSrc, "utf8");
  ok(fixSrc0.indexOf("V14D_STATE2_HELPERS_WGSL") < 0 && fixSrc0.indexOf("includeState2Mask") < 0, "断点C fixture 初始未打 State2 补丁（helper 不存在，走旧路径）");
  ok(!fs.readFileSync(cleanEngineSrc, "utf8").includes("getProductionDrawCallSourceSnapshot")
    && !fs.readFileSync(cleanEngineDist, "utf8").includes("getProductionDrawCallSourceSnapshot")
    && !fs.readFileSync(cleanEngineDts, "utf8").includes("getProductionDrawCallSourceSnapshot"),
  "生产源快照 fixture 初始未注入（src/dist/d.ts 均无接口）");
  // 2) 子进程调用同一脚本生产控制流：重写 rootDir 指向 fixture。
  const fakeScript = path.join(tmp, "patch-run.mjs");
  const redirected = selfSrc.replace('const rootDir = path.resolve(__dirname, "..");', 'const rootDir = ' + JSON.stringify(fixtureRoot) + ';');
  ok(redirected !== selfSrc, "self-test rootDir 重定向成功（子进程跑真实生产控制流，非 replace 仿真）");
  fs.writeFileSync(fakeScript, redirected, "utf8");
  const runScript = (script) => {
    try {
      const stdout = execFileSync(process.execPath, [script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { exit: 0, stdout, stderr: "" };
    } catch (e) {
      return {
        exit: e.status == null ? 1 : e.status,
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
      };
    }
  };
  const runPatch = () => runScript(fakeScript);
  const makeRunner = (label, sourceRoot) => {
    const script = path.join(tmp, label + "-patch-run.mjs");
    const source = selfSrc.replace('const rootDir = path.resolve(__dirname, "..");', 'const rootDir = ' + JSON.stringify(sourceRoot) + ';');
    fs.writeFileSync(script, source, "utf8");
    return () => runScript(script);
  };
  const reportPatchFailure = (label, result) => {
    const lines = (result.stdout + "\n" + result.stderr)
      .split(/\r?\n/)
      .filter((line) => /(?:FAIL|missing-file|anchor-miss|PATCH-VERIFY|patch-reze-engine|锚点)/.test(line));
    for (const line of lines) console.error("[self-test detail] " + label + ": " + line);
  };
  const expectRejected = (label, runner) => {
    const result = runner();
    if (result.exit === 0) reportPatchFailure(label, result);
    ok(result.exit !== 0, label + " 非0退出（得到 " + result.exit + "）");
  };
  const copyCleanFixture = (label) => {
    const targetRoot = path.join(tmp, label + "-web");
    fs.cpSync(cleanRoot, targetRoot, { recursive: true });
    return targetRoot;
  };

  // 所有负测都从同一个干净 tarball seed 构造，不能先让生产补丁通过再破坏完成态。
  const anchorRoot = copyCleanFixture("anchor-miss");
  const anchorSlots = path.join(anchorRoot, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  let anchorContent = fs.readFileSync(anchorSlots, "utf8");
  anchorContent = anchorContent.split("export function assembleModule").join("export function assembleModule_BROKEN");
  anchorContent = anchorContent.split("includeState2Mask = false").join("includeStyleUniformsOnly = false");
  fs.writeFileSync(anchorSlots, anchorContent, "utf8");

  const missingRoot = copyCleanFixture("missing-file");
  fs.rmSync(path.join(missingRoot, "node_modules", "reze-engine", "dist", "graph", "compile.js"), { force: true });

  const duplicateRoot = copyCleanFixture("duplicate-marker");
  const duplicateSlots = path.join(duplicateRoot, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  fs.appendFileSync(duplicateSlots, String.fromCharCode(10) + "// duplicate const V14D_STATE2_HELPERS_WGSL marker" + String.fromCharCode(10), "utf8");

  const missingARoot = copyCleanFixture("missing-a");
  const missingASlots = path.join(missingARoot, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  let missingAContent = fs.readFileSync(missingASlots, "utf8");
  missingAContent = missingAContent.split("const HASHED_ALPHA_DECLS").join("const HASHED_ALPHA_DECLS_BROKEN");
  fs.writeFileSync(missingASlots, missingAContent, "utf8");

  const missingBRoot = copyCleanFixture("missing-b");
  const missingBEngine = path.join(missingBRoot, "node_modules", "reze-engine", "src", "engine.ts");
  let missingBContent = fs.readFileSync(missingBEngine, "utf8");
  missingBContent = missingBContent.split("const baseBindGroupEntries").join("const baseBindGroupEntries_BROKEN");
  fs.writeFileSync(missingBEngine, missingBContent, "utf8");

  const pmxAnchorRoot = copyCleanFixture("pmx-anchor-miss");
  const pmxAnchorFile = path.join(pmxAnchorRoot, "node_modules", "reze-engine", "src", "pmx-loader.ts");
  const pmxAnchorContent = fs.readFileSync(pmxAnchorFile, "utf8").split("// Debug: log problematic string lengths").join("// Debug: log problematic string lengths BROKEN");
  fs.writeFileSync(pmxAnchorFile, pmxAnchorContent, "utf8");

  const productionSourceAnchorRoot = copyCleanFixture("production-source-anchor-miss");
  const productionSourceAnchorFile = path.join(productionSourceAnchorRoot, "node_modules", "reze-engine", "src", "engine.ts");
  const productionSourceAnchorContent = fs.readFileSync(productionSourceAnchorFile, "utf8")
    .split("  markVertexBufferDirty(modelNameOrModel?: string | Model): void {")
    .join("  markVertexBufferDirty_BROKEN(modelNameOrModel?: string | Model): void {");
  fs.writeFileSync(productionSourceAnchorFile, productionSourceAnchorContent, "utf8");

  const productionSourceDuplicateRoot = copyCleanFixture("production-source-duplicate-marker");
  const productionSourceDuplicateFile = path.join(productionSourceDuplicateRoot, "node_modules", "reze-engine", "src", "engine.ts");
  fs.appendFileSync(productionSourceDuplicateFile, String.fromCharCode(10)
    + "// duplicate getProductionDrawCallSourceSnapshot(captureId: string, frame: number) marker"
    + String.fromCharCode(10), "utf8");

  // 首次运行必须真正 exit 0；fixture 内任一严格校验失败都让 self-test 变红。
  const first = runPatch();
  const firstExit = first.exit;
  if (firstExit !== 0) reportPatchFailure("首次运行", first);
  ok(firstExit === 0, "首次完整 fixture 生产补丁 exit=0（实际得到 " + firstExit + "）");
  // Stage 2C-M2a 修正轮：prelude 调用现带 v14dAlphaFault 参数，匹配前缀（不含结尾括号）。
  const orderOk = (fp) => { const c = fs.readFileSync(fp, "utf8"); const ai = c.indexOf("export function assembleModule"); const seg = ai >= 0 ? c.slice(ai, ai + 900) : ""; const hi = seg.indexOf("V14D_STATE2_HELPERS_WGSL : "); const pi = seg.indexOf("prelude(renderClass, alphaMode"); return hi >= 0 && pi >= 0 && hi < pi; };
  ok(orderOk(fixSlotsSrc), "断点C 首次注入后 src assembleModule 内 helperIndex < preludeIndex");
  ok(orderOk(fixSlotsDist), "断点C 首次注入后 dist assembleModule 内 helperIndex < preludeIndex");
  // 二次运行必须 exit 0 且文件 hash 不变（幂等）。
  const hashAfterFirst = hashTargetSet(fixtureRoot);
  const second = runPatch();
  const secondExit = second.exit;
  if (secondExit !== 0) reportPatchFailure("二次运行", second);
  const hashAfterSecond = hashTargetSet(fixtureRoot);
  ok(secondExit === 0, "二次完整 fixture 生产补丁 exit=0（实际得到 " + secondExit + "）");
  ok(JSON.stringify(hashAfterFirst) === JSON.stringify(hashAfterSecond), "全部生产 target 二次文件 hash 不变（逐项幂等，无重复注入）");
  expectRejected("断点C anchor-miss fixture（clean seed）", makeRunner("anchor-miss", anchorRoot));
  expectRejected("missing-file fixture（clean seed）", makeRunner("missing-file", missingRoot));
  expectRejected("重复 marker fixture（clean seed）", makeRunner("duplicate-marker", duplicateRoot));
  expectRejected("断点A 缺失 fixture（clean seed）", makeRunner("missing-a", missingARoot));
  expectRejected("断点B 缺失 fixture（clean seed）", makeRunner("missing-b", missingBRoot));
  expectRejected("PMX 长度补丁 anchor-miss fixture（clean seed）", makeRunner("pmx-anchor-miss", pmxAnchorRoot));
  expectRejected("生产源快照 anchor-miss fixture（clean seed）", makeRunner("production-source-anchor-miss", productionSourceAnchorRoot));
  expectRejected("生产源快照重复 marker fixture（clean seed）", makeRunner("production-source-duplicate-marker", productionSourceDuplicateRoot));
  fs.rmSync(tmp, { recursive: true, force: true });
  // 3) 真实 node_modules 前后 SHA256 不变。
  const realShaAfter = hashTargetSet(realRoot);
  const shaSame = JSON.stringify(realShaBefore) === JSON.stringify(realShaAfter);
  ok(shaSame, "self-test 不触碰真实 web/node_modules（全部生产 target SHA256 前后一致）");
  if (fails.length) { console.error("===PATCH-SELF-TEST-FAIL===" + String.fromCharCode(10) + fails.join(String.fromCharCode(10))); process.exit(1); }
  console.log("===PATCH-SELF-TEST-OK=== 真实隔离 fixture fresh-patch 首次/二次全 target 幂等通过；anchor-miss、missing-file、重复 marker、断点A缺失、断点B缺失、PMX anchor-miss、生产源快照 anchor-miss/重复 marker 负测全部拒绝；真实 node_modules 全 target SHA256 不变");
  process.exit(0);
}

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

const pmxTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "pmx-loader.ts"),
    anchor: OLD_SRC,
    replacement: "",
    isDone: (content) => !content.includes("Suspicious string length"),
    label: "src/pmx-loader.ts 文本长度上限",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "pmx-loader.js"),
    anchor: OLD_DIST,
    replacement: "",
    isDone: (content) => !content.includes("Suspicious string length"),
    label: "dist/pmx-loader.js 文本长度上限",
  },
];

// 所有生产注入（包括旧 PMX 长度修补）统一走同一 manifest；target 缺失、锚点 0/多匹配
// 都记录为硬失败，不允许某一条历史路径静默成功而绕过严格校验。
const patchLog = [];
function applyPatchManifest(targets, phase) {
  for (const t of targets) {
    if (!fs.existsSync(t.file)) { patchLog.push({ label: t.label, status: "missing-file" }); continue; }
    const content = fs.readFileSync(t.file, "utf8");
    const done = t.isDone ? t.isDone(content) : content.includes(t.doneMarker);
    if (done) { patchLog.push({ label: t.label, status: "already" }); continue; }
    const anchors = t.anchors ?? [t.anchor];
    const matches = anchors.filter((anchor) => content.includes(anchor));
    if (matches.length !== 1) {
      const status = matches.length === 0 ? "anchor-miss" : "ambiguous-anchor";
      console.warn("[patch-reze-engine] " + phase + " 锚点" + (status === "anchor-miss" ? "未匹配" : "不唯一") + "，拒绝继续: " + t.label);
      patchLog.push({ label: t.label, status });
      continue;
    }
    fs.writeFileSync(t.file, content.replace(matches[0], t.replacement), "utf8");
    patchLog.push({ label: t.label, status: "injected" });
    console.log("[patch-reze-engine] 已注入 " + phase + ": " + t.label);
  }
}

applyPatchManifest(pmxTargets, "pmx-text-length");

// ─── 补丁二：materialDiffuseOverrides（真实 GPU 绑定，默认关闭） ─────────────
// 注入点：files 版 loadModel 中 loadFromReader 之后、addModel 之前。
// 对每个目标材质：push 一条新 texture entry（path=唯一 logicalPath），把该材质
// diffuseTextureIndex 指向新 entry。setupMaterialsForInstance 据此在 GPU 材质建立时
// 读取正确烘焙纹理，真正替换 GPUTexture/bind group。overrides 为空对象时完全 no-op。
const OVERRIDE_HELPER_SRC = `      const __mdo = pathOrOptions.materialDiffuseOverrides
      if (__mdo) {
        const texs = model.getTextures()
        const __mdoStart = texs.length
        for (const m of model.getMaterials()) {
          const p = __mdo[m.name]
          if (p !== undefined) {
            texs.push({ path: p, name: p.split(\"/\").pop() || p })
            m.diffuseTextureIndex = texs.length - 1
          }
        }
        model.__v14dBakedTextureRange = { start: __mdoStart, count: texs.length - __mdoStart }
        // 显示字节闭环（GF4）：反投影/烘焙诊断纹理在近距离 minification 下会采到
        // 被 dilation 均值填充污染的低 mip 级（实测 UV 梯度 ~6 纹素/像素, LOD≈2.7-4,
        // Web MAE 27 vs 离线 mip0 MAE 8）。记录诊断纹理集合，createTextureFromLogicalPath
        // 对其禁用 mipmap（mipLevelCount=1，强制 mip0 双线性 = 离线口径）。默认空集 no-op。
        this.__v14dNoMipmapPaths = new Set(Object.values(__mdo))
      }
`;
const OVERRIDE_HELPER_DIST = `            const __mdo = pathOrOptions.materialDiffuseOverrides;
            if (__mdo) {
                const texs = model.getTextures();
                const __mdoStart = texs.length;
                for (const m of model.getMaterials()) {
                    const p = __mdo[m.name];
                    if (p !== undefined) {
                        texs.push({ path: p, name: p.split(\"/\").pop() || p });
                        m.diffuseTextureIndex = texs.length - 1;
                    }
                }
                model.__v14dBakedTextureRange = { start: __mdoStart, count: texs.length - __mdoStart };
                this.__v14dNoMipmapPaths = new Set(Object.values(__mdo));
            }
`;

const SRC_ANCHOR = `      const model = await PmxLoader.loadFromReader(reader, pmxKey)
      model.setName(name)`;
const DIST_ANCHOR = `            const model = await PmxLoader.loadFromReader(reader, pmxKey);
            model.setName(name);`;

const overrideTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: SRC_ANCHOR,
    replacement: `      const model = await PmxLoader.loadFromReader(reader, pmxKey)\n${OVERRIDE_HELPER_SRC}      model.setName(name)`,
    doneMarker: "__mdo",
    label: "src/engine.ts 实现",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: DIST_ANCHOR,
    replacement: `            const model = await PmxLoader.loadFromReader(reader, pmxKey);\n${OVERRIDE_HELPER_DIST}            model.setName(name);`,
    doneMarker: "__mdo",
    label: "dist/engine.js 实现",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts"),
    anchors: [
      "    pmxFile?: File;\n};",
      "    pmxFile?: File;\n    /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n    materialDiffuseOverrides?: Record<string, string>;\n};",
    ],
    replacement: "    pmxFile?: File;\n    /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n    materialDiffuseOverrides?: Record<string, string>;\n    /** Per-material auxiliary texture override (material name -> unique logicalPath). Default off. */\n    materialAuxTextures?: Record<string, string>;\n};",
    doneMarker: "materialAuxTextures?: Record<string, string>;",
    label: "dist/engine.d.ts 类型",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchors: [
      "  pmxFile?: File\n}",
      "  pmxFile?: File\n  /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n  materialDiffuseOverrides?: Record<string, string>\n}",
    ],
    replacement: "  pmxFile?: File\n  /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n  materialDiffuseOverrides?: Record<string, string>\n  /** Per-material auxiliary texture override (material name -> unique logicalPath). Default off. */\n  materialAuxTextures?: Record<string, string>\n}",
    doneMarker: "materialAuxTextures?: Record<string, string>\n",
    label: "src/engine.ts 类型",
  },
];

applyPatchManifest(overrideTargets, "materialDiffuseOverrides");

// ─── 补丁：生产 draw-call 源快照的合法 GPUBuffer 读回能力（默认只增加 usage） ───
// 诊断接口需要验证生产 draw-call 实际绑定的顶点、索引、蒙皮属性与 skin matrix
// 缓冲。WebGPU 的 copyBufferToBuffer 要求源缓冲声明 COPY_SRC；旧探针未满足该
// 合约时，映射到的零值不能证明生产 vertexBuffer 为空。只扩展 buffer usage，不改
// 任何视觉公式、顶点布局、数据内容或生产渲染分支。
const productionSourceBufferTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: [
      "    const vertexBuffer = this.device.createBuffer({",
      "      label: `${name}: vertex buffer`,",
      "      size: vertices.byteLength,",
      "      // STORAGE so the morph compute pass can write morphed positions in place.",
      "      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,",
      "    })",
    ].join("\n"),
    replacement: [
      "    const vertexBuffer = this.device.createBuffer({",
      "      label: `${name}: vertex buffer`,",
      "      size: vertices.byteLength,",
      "      // STORAGE so the morph compute pass can write morphed positions in place.",
      "      // COPY_SRC is required only by the opt-in production source snapshot.",
      "      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,",
      "    })",
    ].join("\n"),
    doneMarker: "      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,",
    label: "src/engine.ts 生产顶点源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: [
      "        const vertexBuffer = this.device.createBuffer({",
      "            label: `${name}: vertex buffer`,",
      "            size: vertices.byteLength,",
      "            // STORAGE so the morph compute pass can write morphed positions in place.",
      "            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,",
      "        });",
    ].join("\n"),
    replacement: [
      "        const vertexBuffer = this.device.createBuffer({",
      "            label: `${name}: vertex buffer`,",
      "            size: vertices.byteLength,",
      "            // STORAGE so the morph compute pass can write morphed positions in place.",
      "            // COPY_SRC is required only by the opt-in production source snapshot.",
      "            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,",
      "        });",
    ].join("\n"),
    doneMarker: "            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,",
    label: "dist/engine.js 生产顶点源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: [
      "    const jointsBuffer = this.device.createBuffer({",
      "      label: `${name}: joints buffer`,",
      "      size: skinning.joints.byteLength,",
      "      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,",
      "    })",
    ].join("\n"),
    replacement: [
      "    const jointsBuffer = this.device.createBuffer({",
      "      label: `${name}: joints buffer`,",
      "      size: skinning.joints.byteLength,",
      "      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
      "    })",
    ].join("\n"),
    doneMarker: "      label: `${name}: joints buffer`,\n      size: skinning.joints.byteLength,\n      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
    label: "src/engine.ts 生产 joints 源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: [
      "        const jointsBuffer = this.device.createBuffer({",
      "            label: `${name}: joints buffer`,",
      "            size: skinning.joints.byteLength,",
      "            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,",
      "        });",
    ].join("\n"),
    replacement: [
      "        const jointsBuffer = this.device.createBuffer({",
      "            label: `${name}: joints buffer`,",
      "            size: skinning.joints.byteLength,",
      "            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
      "        });",
    ].join("\n"),
    doneMarker: "            label: `${name}: joints buffer`,\n            size: skinning.joints.byteLength,\n            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
    label: "dist/engine.js 生产 joints 源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: [
      "    const weightsBuffer = this.device.createBuffer({",
      "      label: `${name}: weights buffer`,",
      "      size: skinning.weights.byteLength,",
      "      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,",
      "    })",
    ].join("\n"),
    replacement: [
      "    const weightsBuffer = this.device.createBuffer({",
      "      label: `${name}: weights buffer`,",
      "      size: skinning.weights.byteLength,",
      "      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
      "    })",
    ].join("\n"),
    doneMarker: "      label: `${name}: weights buffer`,\n      size: skinning.weights.byteLength,\n      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
    label: "src/engine.ts 生产 weights 源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: [
      "        const weightsBuffer = this.device.createBuffer({",
      "            label: `${name}: weights buffer`,",
      "            size: skinning.weights.byteLength,",
      "            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,",
      "        });",
    ].join("\n"),
    replacement: [
      "        const weightsBuffer = this.device.createBuffer({",
      "            label: `${name}: weights buffer`,",
      "            size: skinning.weights.byteLength,",
      "            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
      "        });",
    ].join("\n"),
    doneMarker: "            label: `${name}: weights buffer`,\n            size: skinning.weights.byteLength,\n            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
    label: "dist/engine.js 生产 weights 源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: [
      "    const skinMatrixBuffer = this.device.createBuffer({",
      "      label: `${name}: skin matrices`,",
      "      size: Math.max(256, matrixSize),",
      "      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,",
      "    })",
    ].join("\n"),
    replacement: [
      "    const skinMatrixBuffer = this.device.createBuffer({",
      "      label: `${name}: skin matrices`,",
      "      size: Math.max(256, matrixSize),",
      "      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
      "    })",
    ].join("\n"),
    doneMarker: "      label: `${name}: skin matrices`,\n      size: Math.max(256, matrixSize),\n      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
    label: "src/engine.ts 生产 skin matrix 源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: [
      "        const skinMatrixBuffer = this.device.createBuffer({",
      "            label: `${name}: skin matrices`,",
      "            size: Math.max(256, matrixSize),",
      "            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,",
      "        });",
    ].join("\n"),
    replacement: [
      "        const skinMatrixBuffer = this.device.createBuffer({",
      "            label: `${name}: skin matrices`,",
      "            size: Math.max(256, matrixSize),",
      "            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
      "        });",
    ].join("\n"),
    doneMarker: "            label: `${name}: skin matrices`,\n            size: Math.max(256, matrixSize),\n            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
    label: "dist/engine.js 生产 skin matrix 源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: [
      "    const indexBuffer = this.device.createBuffer({",
      "      label: `${name}: index buffer`,",
      "      size: indices.byteLength,",
      "      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,",
      "    })",
    ].join("\n"),
    replacement: [
      "    const indexBuffer = this.device.createBuffer({",
      "      label: `${name}: index buffer`,",
      "      size: indices.byteLength,",
      "      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
      "    })",
    ].join("\n"),
    doneMarker: "      label: `${name}: index buffer`,\n      size: indices.byteLength,\n      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
    label: "src/engine.ts 生产 index 源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: [
      "        const indexBuffer = this.device.createBuffer({",
      "            label: `${name}: index buffer`,",
      "            size: indices.byteLength,",
      "            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,",
      "        });",
    ].join("\n"),
    replacement: [
      "        const indexBuffer = this.device.createBuffer({",
      "            label: `${name}: index buffer`,",
      "            size: indices.byteLength,",
      "            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
      "        });",
    ].join("\n"),
    doneMarker: "            label: `${name}: index buffer`,\n            size: indices.byteLength,\n            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,",
    label: "dist/engine.js 生产 index 源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: [
      "    const weightsBuffer = this.device.createBuffer({",
      "      label: `${name}: morph weights`,",
      "      size: Math.max(data.morphCount * 4, 4),",
      "      usage: RO,",
      "    })",
    ].join("\n"),
    replacement: [
      "    const weightsBuffer = this.device.createBuffer({",
      "      label: `${name}: morph weights`,",
      "      size: Math.max(data.morphCount * 4, 4),",
      "      usage: RO | GPUBufferUsage.COPY_SRC,",
      "    })",
    ].join("\n"),
    doneMarker: "      label: `${name}: morph weights`,\n      size: Math.max(data.morphCount * 4, 4),\n      usage: RO | GPUBufferUsage.COPY_SRC,",
    label: "src/engine.ts GPU morph 权重源 COPY_SRC",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: [
      "        const weightsBuffer = this.device.createBuffer({",
      "            label: `${name}: morph weights`,",
      "            size: Math.max(data.morphCount * 4, 4),",
      "            usage: RO,",
      "        });",
    ].join("\n"),
    replacement: [
      "        const weightsBuffer = this.device.createBuffer({",
      "            label: `${name}: morph weights`,",
      "            size: Math.max(data.morphCount * 4, 4),",
      "            usage: RO | GPUBufferUsage.COPY_SRC,",
      "        });",
    ].join("\n"),
    doneMarker: "            label: `${name}: morph weights`,\n            size: Math.max(data.morphCount * 4, 4),\n            usage: RO | GPUBufferUsage.COPY_SRC,",
    label: "dist/engine.js GPU morph 权重源 COPY_SRC",
  },
];
applyPatchManifest(productionSourceBufferTargets, "production-source-diagnostic");

// ─── 补丁：reze-engine 生产 draw-call 几何源快照接口（默认关闭、只读） ───
// 这是本票唯一的引擎 seam：调用方必须显式提供 captureId/frame，接口返回生产
// material-ID pick 与 HDR draw 使用的同一组 ModelInstance GPU buffer、draw range、
// per-instance bind group 和 morph/skin 来源。返回 GPU 资源句柄供同一 JS realm 的
// 诊断 pass 使用；接口不触发渲染、不写入 buffer，也不改变任何生产状态。
const PRODUCTION_SOURCE_TYPES_SRC = [
  "export type ProductionDrawCallSource = {",
  "  materialName: string",
  "  materialIndex: number",
  "  count: number",
  "  firstIndex: number",
  "  drawIndex: number",
  "  pickDrawCallIndex: number",
  "  mainBindGroup: GPUBindGroup",
  "  pickBindGroup: GPUBindGroup",
  "  mainPipeline: GPURenderPipeline | null",
  "  groupId: string | null",
  "  graphName: string | null",
  "}",
  "",
  "export type ProductionPickDrawCallSource = {",
  "  materialName: string",
  "  materialIndex: number",
  "  count: number",
  "  firstIndex: number",
  "  drawIndex: number",
  "  pickDrawCallIndex: number",
  "  bindGroup: GPUBindGroup",
  "}",
  "",
  "export type ProductionDrawCallSourceSnapshot = {",
  "  schemaVersion: 1",
  "  captureId: string",
  "  frame: number",
  "  source: \"reze-engine-production-draw-call\"",
  "  device: GPUDevice",
  "  pick: {",
  "    pipeline: GPURenderPipeline",
  "    perFrameBindGroup: GPUBindGroup",
  "    perFrameBindGroupLayout: GPUBindGroupLayout",
  "    perInstanceBindGroupLayout: GPUBindGroupLayout",
  "    perMaterialBindGroupLayout: GPUBindGroupLayout",
  "  }",
  "  renderTargets: { hdrResolveTexture: GPUTexture; maskResolveTexture: GPUTexture; hdrFormat: GPUTextureFormat }",
  "  instances: Array<{",
  "    name: string",
  "    visible: boolean",
  "    buffers: { vertex: GPUBuffer; index: GPUBuffer; joints: GPUBuffer; weights: GPUBuffer; skinMatrices: GPUBuffer }",
  "    bufferBytes: { vertex: number; index: number; joints: number; weights: number; skinMatrices: number }",
  "    geometry: { vertexCount: number; indexCount: number; vertexStrideBytes: 32; indexFormat: \"uint32\"; jointsFormat: \"uint16x4\"; weightsFormat: \"unorm8x4\" }",
  "    sourceIdentity: { vertex: string; index: string; joints: string; weights: string; skinMatrices: string }",
  "    transforms: {",
  "      skinMatrixSource: \"model.getSkinMatrices -> skinMatrixBuffer\"",
  "      matrixCount: number",
  "      morphMode: \"gpu-compute-in-place\" | \"cpu-upload\"",
  "      morphSource: string",
  "      morphWeightsBuffer: GPUBuffer | null",
  "      morphWeightsByteLength: number",
  "      morphWeightsNonZeroCount: number",
  "      morphDispatchPending: boolean",
  "    }",
  "    pickPerInstanceBindGroup: GPUBindGroup",
  "    drawCalls: ProductionDrawCallSource[]",
  "    pickDrawCalls: ProductionPickDrawCallSource[]",
  "  }>",
  "}",
].join("\n");

const PRODUCTION_SOURCE_TYPES_DIST = [
  "export type ProductionDrawCallSource = {",
  "    materialName: string;",
  "    materialIndex: number;",
  "    count: number;",
  "    firstIndex: number;",
  "    drawIndex: number;",
  "    pickDrawCallIndex: number;",
  "    mainBindGroup: GPUBindGroup;",
  "    pickBindGroup: GPUBindGroup;",
  "    mainPipeline: GPURenderPipeline | null;",
  "    groupId: string | null;",
  "    graphName: string | null;",
  "};",
  "export type ProductionPickDrawCallSource = {",
  "    materialName: string;",
  "    materialIndex: number;",
  "    count: number;",
  "    firstIndex: number;",
  "    drawIndex: number;",
  "    pickDrawCallIndex: number;",
  "    bindGroup: GPUBindGroup;",
  "};",
  "export type ProductionDrawCallSourceSnapshot = {",
  "    schemaVersion: 1;",
  "    captureId: string;",
  "    frame: number;",
  "    source: \"reze-engine-production-draw-call\";",
  "    device: GPUDevice;",
  "    pick: { pipeline: GPURenderPipeline; perFrameBindGroup: GPUBindGroup; perFrameBindGroupLayout: GPUBindGroupLayout; perInstanceBindGroupLayout: GPUBindGroupLayout; perMaterialBindGroupLayout: GPUBindGroupLayout };",
  "    renderTargets: { hdrResolveTexture: GPUTexture; maskResolveTexture: GPUTexture; hdrFormat: GPUTextureFormat };",
  "    instances: Array<{ name: string; visible: boolean; buffers: { vertex: GPUBuffer; index: GPUBuffer; joints: GPUBuffer; weights: GPUBuffer; skinMatrices: GPUBuffer }; bufferBytes: { vertex: number; index: number; joints: number; weights: number; skinMatrices: number }; geometry: { vertexCount: number; indexCount: number; vertexStrideBytes: 32; indexFormat: \"uint32\"; jointsFormat: \"uint16x4\"; weightsFormat: \"unorm8x4\" }; sourceIdentity: { vertex: string; index: string; joints: string; weights: string; skinMatrices: string }; transforms: { skinMatrixSource: \"model.getSkinMatrices -> skinMatrixBuffer\"; matrixCount: number; morphMode: \"gpu-compute-in-place\" | \"cpu-upload\"; morphSource: string; morphWeightsBuffer: GPUBuffer | null; morphWeightsByteLength: number; morphWeightsNonZeroCount: number; morphDispatchPending: boolean }; pickPerInstanceBindGroup: GPUBindGroup; drawCalls: ProductionDrawCallSource[]; pickDrawCalls: ProductionPickDrawCallSource[] }>;",
  "};",
].join("\n");

const PRODUCTION_SOURCE_METHOD_SRC = [
  "  getProductionDrawCallSourceSnapshot(captureId: string, frame: number): ProductionDrawCallSourceSnapshot {",
  "    if (typeof captureId !== \"string\" || captureId.length === 0) throw new Error(\"captureId must be non-empty\")",
  "    if (!Number.isFinite(frame)) throw new Error(\"frame must be finite\")",
  "    const instances = [...this.modelInstances.values()].map((inst) => {",
  "      const materials = inst.model.getMaterials()",
  "      const materialIndexByName = new Map(materials.map((material, index) => [material.name, index]))",
  "      const vertices = inst.model.getVertices()",
  "      const indices = inst.model.getIndices()",
  "      const skinning = inst.model.getSkinning()",
  "      const matrixCount = inst.model.getSkeleton().bones.length",
  "      const materialDraws = inst.drawCalls.filter((draw) => !!draw.baseBindGroupEntries)",
  "      const findMain = (count: number, firstIndex: number) => { const drawIndex = materialDraws.findIndex((draw) => draw.count === count && draw.firstIndex === firstIndex); return drawIndex < 0 ? null : { draw: materialDraws[drawIndex], drawIndex } }",
  "      if (materialDraws.length > 0 && inst.pickDrawCalls.length === 0) throw new Error(\"production pick draw calls unavailable: Engine was created without onRaycast\")",
  "      const pickDrawCalls = inst.pickDrawCalls.map((pick, pickIndex) => {",
  "        const match = findMain(pick.count, pick.firstIndex)",
  "        if (!match) throw new Error(\"production pick draw range has no matching material draw: \" + pick.firstIndex)",
  "        const materialIndex = materialIndexByName.get(match.draw.materialName)",
  "        if (materialIndex === undefined) throw new Error(\"production draw material missing: \" + match.draw.materialName)",
  "        return { materialName: match.draw.materialName, materialIndex, count: pick.count, firstIndex: pick.firstIndex, drawIndex: match.drawIndex, pickDrawCallIndex: pickIndex, bindGroup: pick.bindGroup }",
  "      })",
  "      const drawCalls = materialDraws.map((draw, drawIndex) => {",
  "        const pickDrawCallIndex = inst.pickDrawCalls.findIndex((candidate) => candidate.count === draw.count && candidate.firstIndex === draw.firstIndex)",
  "        if (pickDrawCallIndex < 0) throw new Error(\"material draw has no matching production pick draw: \" + draw.materialName)",
  "        const pick = inst.pickDrawCalls[pickDrawCallIndex]",
  "        const materialIndex = materialIndexByName.get(draw.materialName)",
  "        if (materialIndex === undefined) throw new Error(\"production draw material missing: \" + draw.materialName)",
  "        const install = draw.groupId ? inst.styleGroups.get(draw.groupId) : undefined",
  "        return { materialName: draw.materialName, materialIndex, count: draw.count, firstIndex: draw.firstIndex, drawIndex, pickDrawCallIndex, mainBindGroup: draw.bindGroup, pickBindGroup: pick.bindGroup, mainPipeline: install?.pipeline ?? null, groupId: draw.groupId, graphName: install?.group?.graph?.name ?? null }",
  "      })",
  "      const morphWeights = inst.gpuMorph?.weightsData ?? null",
  "      const morphWeightsNonZeroCount = morphWeights ? morphWeights.reduce((count, weight) => count + (Math.abs(weight) > 0.0001 ? 1 : 0), 0) : 0",
  "      return {",
  "        name: inst.name,",
  "        visible: inst.model.visible,",
  "        buffers: { vertex: inst.vertexBuffer, index: inst.indexBuffer, joints: inst.jointsBuffer, weights: inst.weightsBuffer, skinMatrices: inst.skinMatrixBuffer },",
  "        bufferBytes: { vertex: vertices.byteLength, index: indices.byteLength, joints: skinning.joints.byteLength, weights: skinning.weights.byteLength, skinMatrices: Math.max(256, matrixCount * 16 * 4) },",
  "        geometry: { vertexCount: vertices.length / 8, indexCount: indices.length, vertexStrideBytes: 32, indexFormat: \"uint32\", jointsFormat: \"uint16x4\", weightsFormat: \"unorm8x4\" },",
  "        sourceIdentity: { vertex: inst.name + \".vertexBuffer\", index: inst.name + \".indexBuffer\", joints: inst.name + \".jointsBuffer\", weights: inst.name + \".weightsBuffer\", skinMatrices: inst.name + \".skinMatrixBuffer\" },",
  "        transforms: { skinMatrixSource: \"model.getSkinMatrices -> skinMatrixBuffer\", matrixCount, morphMode: inst.gpuMorph ? \"gpu-compute-in-place\" : \"cpu-upload\", morphSource: inst.gpuMorph ? \"GPU morph compute writes vertexBuffer\" : \"model vertices queue.writeBuffer -> vertexBuffer\", morphWeightsBuffer: inst.gpuMorph?.weightsBuffer ?? null, morphWeightsByteLength: inst.gpuMorph ? Math.max(4, inst.gpuMorph.weightsData.byteLength) : 0, morphWeightsNonZeroCount, morphDispatchPending: !!inst.gpuMorph?.dispatchNeeded },",
  "        pickPerInstanceBindGroup: inst.pickPerInstanceBindGroup,",
  "        drawCalls,",
  "        pickDrawCalls,",
  "      }",
  "    })",
  "    return {",
  "      schemaVersion: 1,",
  "      captureId,",
  "      frame,",
  "      source: \"reze-engine-production-draw-call\",",
  "      device: this.device,",
  "      pick: { pipeline: this.pickPipeline, perFrameBindGroup: this.pickPerFrameBindGroup, perFrameBindGroupLayout: this.pickPerFrameBindGroupLayout, perInstanceBindGroupLayout: this.pickPerInstanceBindGroupLayout, perMaterialBindGroupLayout: this.pickPerMaterialBindGroupLayout },",
  "      renderTargets: { hdrResolveTexture: this.hdrResolveTexture, maskResolveTexture: this.maskResolveTexture, hdrFormat: this.hdrFormat },",
  "      instances,",
  "    }",
  "  }",
].join("\n");

const PRODUCTION_SOURCE_METHOD_DIST = [
  "    getProductionDrawCallSourceSnapshot(captureId, frame) {",
  "        if (typeof captureId !== \"string\" || captureId.length === 0)",
  "            throw new Error(\"captureId must be non-empty\");",
  "        if (!Number.isFinite(frame))",
  "            throw new Error(\"frame must be finite\");",
  "        const instances = [...this.modelInstances.values()].map((inst) => {",
  "            const materials = inst.model.getMaterials();",
  "            const materialIndexByName = new Map(materials.map((material, index) => [material.name, index]));",
  "            const vertices = inst.model.getVertices();",
  "            const indices = inst.model.getIndices();",
  "            const skinning = inst.model.getSkinning();",
  "            const matrixCount = inst.model.getSkeleton().bones.length;",
  "            const materialDraws = inst.drawCalls.filter((draw) => !!draw.baseBindGroupEntries);",
  "            const findMain = (count, firstIndex) => { const drawIndex = materialDraws.findIndex((draw) => draw.count === count && draw.firstIndex === firstIndex); return drawIndex < 0 ? null : { draw: materialDraws[drawIndex], drawIndex }; };",
  "            if (materialDraws.length > 0 && inst.pickDrawCalls.length === 0)",
  "                throw new Error(\"production pick draw calls unavailable: Engine was created without onRaycast\");",
  "            const pickDrawCalls = inst.pickDrawCalls.map((pick, pickIndex) => {",
  "                const match = findMain(pick.count, pick.firstIndex);",
  "                if (!match)",
  "                    throw new Error(\"production pick draw range has no matching material draw: \" + pick.firstIndex);",
  "                const materialIndex = materialIndexByName.get(match.draw.materialName);",
  "                if (materialIndex === undefined)",
  "                    throw new Error(\"production draw material missing: \" + match.draw.materialName);",
  "                return { materialName: match.draw.materialName, materialIndex, count: pick.count, firstIndex: pick.firstIndex, drawIndex: match.drawIndex, pickDrawCallIndex: pickIndex, bindGroup: pick.bindGroup };",
  "            });",
  "            const drawCalls = materialDraws.map((draw, drawIndex) => {",
  "                const pickDrawCallIndex = inst.pickDrawCalls.findIndex((candidate) => candidate.count === draw.count && candidate.firstIndex === draw.firstIndex);",
  "                if (pickDrawCallIndex < 0)",
  "                    throw new Error(\"material draw has no matching production pick draw: \" + draw.materialName);",
  "                const pick = inst.pickDrawCalls[pickDrawCallIndex];",
  "                const materialIndex = materialIndexByName.get(draw.materialName);",
  "                if (materialIndex === undefined)",
  "                    throw new Error(\"production draw material missing: \" + draw.materialName);",
  "                const install = draw.groupId ? inst.styleGroups.get(draw.groupId) : undefined;",
  "                return { materialName: draw.materialName, materialIndex, count: draw.count, firstIndex: draw.firstIndex, drawIndex, pickDrawCallIndex, mainBindGroup: draw.bindGroup, pickBindGroup: pick.bindGroup, mainPipeline: install?.pipeline ?? null, groupId: draw.groupId, graphName: install?.group?.graph?.name ?? null };",
  "            });",
  "            const morphWeights = inst.gpuMorph?.weightsData ?? null;",
  "            const morphWeightsNonZeroCount = morphWeights ? morphWeights.reduce((count, weight) => count + (Math.abs(weight) > 0.0001 ? 1 : 0), 0) : 0;",
  "            return {",
  "                name: inst.name,",
  "                visible: inst.model.visible,",
  "                buffers: { vertex: inst.vertexBuffer, index: inst.indexBuffer, joints: inst.jointsBuffer, weights: inst.weightsBuffer, skinMatrices: inst.skinMatrixBuffer },",
  "                bufferBytes: { vertex: vertices.byteLength, index: indices.byteLength, joints: skinning.joints.byteLength, weights: skinning.weights.byteLength, skinMatrices: Math.max(256, matrixCount * 16 * 4) },",
  "                geometry: { vertexCount: vertices.length / 8, indexCount: indices.length, vertexStrideBytes: 32, indexFormat: \"uint32\", jointsFormat: \"uint16x4\", weightsFormat: \"unorm8x4\" },",
  "                sourceIdentity: { vertex: inst.name + \".vertexBuffer\", index: inst.name + \".indexBuffer\", joints: inst.name + \".jointsBuffer\", weights: inst.name + \".weightsBuffer\", skinMatrices: inst.name + \".skinMatrixBuffer\" },",
  "                transforms: { skinMatrixSource: \"model.getSkinMatrices -> skinMatrixBuffer\", matrixCount, morphMode: inst.gpuMorph ? \"gpu-compute-in-place\" : \"cpu-upload\", morphSource: inst.gpuMorph ? \"GPU morph compute writes vertexBuffer\" : \"model vertices queue.writeBuffer -> vertexBuffer\", morphWeightsBuffer: inst.gpuMorph?.weightsBuffer ?? null, morphWeightsByteLength: inst.gpuMorph ? Math.max(4, inst.gpuMorph.weightsData.byteLength) : 0, morphWeightsNonZeroCount, morphDispatchPending: !!inst.gpuMorph?.dispatchNeeded },",
  "                pickPerInstanceBindGroup: inst.pickPerInstanceBindGroup,",
  "                drawCalls,",
  "                pickDrawCalls,",
  "            };",
  "        });",
  "        return {",
  "            schemaVersion: 1,",
  "            captureId,",
  "            frame,",
  "            source: \"reze-engine-production-draw-call\",",
  "            device: this.device,",
  "            pick: { pipeline: this.pickPipeline, perFrameBindGroup: this.pickPerFrameBindGroup, perFrameBindGroupLayout: this.pickPerFrameBindGroupLayout, perInstanceBindGroupLayout: this.pickPerInstanceBindGroupLayout, perMaterialBindGroupLayout: this.pickPerMaterialBindGroupLayout },",
  "            renderTargets: { hdrResolveTexture: this.hdrResolveTexture, maskResolveTexture: this.maskResolveTexture, hdrFormat: this.hdrFormat },",
  "            instances,",
  "        };",
  "    }",
].join("\n");

const productionSourceTypeTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: "type DrawCallType = \"opaque\" | \"transparent\" | \"ground\" | \"opaque-outline\" | \"transparent-outline\"\n",
    replacement: PRODUCTION_SOURCE_TYPES_SRC + "\n" + "type DrawCallType = \"opaque\" | \"transparent\" | \"ground\" | \"opaque-outline\" | \"transparent-outline\"\n",
    doneMarker: "export type ProductionDrawCallSourceSnapshot =",
    label: "src/engine.ts 生产源快照类型",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts"),
    anchor: "type DrawCallType = \"opaque\" | \"transparent\" | \"ground\" | \"opaque-outline\" | \"transparent-outline\";\n",
    replacement: PRODUCTION_SOURCE_TYPES_DIST + "\n" + "type DrawCallType = \"opaque\" | \"transparent\" | \"ground\" | \"opaque-outline\" | \"transparent-outline\";\n",
    doneMarker: "export type ProductionDrawCallSourceSnapshot =",
    label: "dist/engine.d.ts 生产源快照类型",
  },
];
applyPatchManifest(productionSourceTypeTargets, "production-source-interface");

const productionSourceMethodTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: "  markVertexBufferDirty(modelNameOrModel?: string | Model): void {\n",
    replacement: PRODUCTION_SOURCE_METHOD_SRC + "\n\n" + "  markVertexBufferDirty(modelNameOrModel?: string | Model): void {\n",
    doneMarker: "getProductionDrawCallSourceSnapshot(captureId: string, frame: number)",
    label: "src/engine.ts 生产源快照实现",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: "    markVertexBufferDirty(modelNameOrModel) {\n",
    replacement: PRODUCTION_SOURCE_METHOD_DIST + "\n\n" + "    markVertexBufferDirty(modelNameOrModel) {\n",
    doneMarker: "getProductionDrawCallSourceSnapshot(captureId, frame)",
    label: "dist/engine.js 生产源快照实现",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts"),
    anchor: "    markVertexBufferDirty(modelNameOrModel?: string | Model): void;\n",
    replacement: "    getProductionDrawCallSourceSnapshot(captureId: string, frame: number): ProductionDrawCallSourceSnapshot;\n" + "    markVertexBufferDirty(modelNameOrModel?: string | Model): void;\n",
    doneMarker: "getProductionDrawCallSourceSnapshot(captureId: string, frame: number): ProductionDrawCallSourceSnapshot;",
    label: "dist/engine.d.ts 生产源快照声明",
  },
];
applyPatchManifest(productionSourceMethodTargets, "production-source-interface");

// 上方注入循环后立即进行统一严格校验定义；predev/prebuild 与 --verify 共用。
// ─── 统一严格校验（predev/prebuild 与 --verify 共用）：全部 marker 满足预期计数。 ──
// 不只在 --verify 才计数；普通 predev/prebuild 也必须拦截重复/缺失 marker，
// 否则生命周期内重复注入或部分注入不会被发现。任一 marker 非恰好一次即 exit 1。
const STATE2_VERIFY_CHECKS = (() => {
  const slotsSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  const slotsDist = path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js");
  const compileSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts");
  const compileDist = path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js");
  const engineSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts");
  const engineDistJs = path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js");
  const pmxSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "pmx-loader.ts");
  const pmxDist = path.join(rootDir, "node_modules", "reze-engine", "dist", "pmx-loader.js");
  return [
    { label: "src/pmx-loader.ts 文本长度上限已移除", file: pmxSrc, marker: "Suspicious string length", expectedCount: 0 },
    { label: "dist/pmx-loader.js 文本长度上限已移除", file: pmxDist, marker: "Suspicious string length", expectedCount: 0 },
    { label: "src/engine.ts materialAuxTextures 注入", file: engineSrc, marker: "const __aux = pathOrOptions.materialAuxTextures" },
    { label: "dist/engine.js materialAuxTextures 注入", file: engineDistJs, marker: "const __aux = pathOrOptions.materialAuxTextures;" },
    { label: "src/engine.ts materialAuxTextures 类型声明", file: engineSrc, marker: "materialAuxTextures?: Record<string, string>" },
    { label: "dist/engine.d.ts materialAuxTextures 类型声明", file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts"), marker: "materialAuxTextures?: Record<string, string>;" },
    { label: "src/engine.ts aux mask 禁 mipmap", file: engineSrc, marker: "__v14dAuxTexturePaths?.has(logicalPath)" },
    { label: "dist/engine.js aux mask 禁 mipmap", file: engineDistJs, marker: "__v14dAuxTexturePaths?.has(logicalPath)" },
    { label: "src/engine.ts aux mask 非 sRGB 视图", file: engineSrc, marker: "__isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\"" },
    { label: "dist/engine.js aux mask 非 sRGB 视图", file: engineDistJs, marker: "__isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\"" },
    { label: "src/engine.ts bind group 布局 binding(5)", file: engineSrc, marker: "// V14D State2 实时合成：extra mask texture" },
    { label: "dist/engine.js bind group 布局 binding(5)", file: engineDistJs, marker: "// V14D State2 实时合成：extra mask texture" },
    { label: "src/engine.ts createMaterialBindGroup binding(5)", file: engineSrc, marker: "maskView ?? this.fallbackMaterialTexture.createView()" },
    { label: "dist/engine.js createMaterialBindGroup binding(5)", file: engineDistJs, marker: "maskView ?? this.fallbackMaterialTexture.createView()" },
    { label: "src/engine.ts setupMaterialsForInstance mask 加载", file: engineSrc, marker: "const __auxMaskView = __auxTexture ? __auxTexture.createView() : undefined" },
    { label: "dist/engine.js setupMaterialsForInstance mask 加载", file: engineDistJs, marker: "const __auxMaskView = __auxTexture ? __auxTexture.createView() : undefined;" },
    { label: "src/graph/slots.ts state2 helper 声明", file: slotsSrc, marker: "const V14D_STATE2_HELPERS_WGSL" },
    { label: "dist/graph/slots.js state2 helper 声明", file: slotsDist, marker: "const V14D_STATE2_HELPERS_WGSL" },
    { label: "src/graph/slots.ts assembleModule state2 门控", file: slotsSrc, marker: "includeState2Mask = false" },
    { label: "dist/graph/slots.js assembleModule state2 门控", file: slotsDist, marker: "includeState2Mask = false" },
    { label: "src/graph/compile.ts state2 门控", file: compileSrc, marker: "graph.tags?.includes(\"v14d-state2-face\")" },
    { label: "dist/graph/compile.js state2 门控", file: compileDist, marker: "graph.tags?.includes(\"v14d-state2-face\")" },
  // 断点 A 修正轮（src + dist 生效路径）：健壮行匹配 override 存在且被 compile 接线。
  { label: "src/graph/slots.ts state2 override 修正函数", file: slotsSrc, marker: "export function v14dState2OverrideFsBodyFixed(graphName: string, fsBody: string, hairTint?: readonly number[]): string" },
  { label: "dist/graph/slots.js state2 override 修正函数", file: slotsDist, marker: "export function v14dState2OverrideFsBodyFixed(graphName, fsBody, hairTint)" },
  { label: "src/graph/compile.ts state2 override 修正接线", file: compileSrc, marker: "const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint)" },
  { label: "dist/graph/compile.js state2 override 修正接线", file: compileDist, marker: "const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint);" },
  // 断点 B 修正轮：aux mask view 并入 baseEntries (binding 5) 且重绑展开不丢失。
    { label: "src/engine.ts binding5 baseEntries", file: engineSrc, marker: "binding: 5, resource: __binding5View" },
    { label: "dist/engine.js binding5 baseEntries", file: engineDistJs, marker: "binding: 5, resource: __binding5View" },
    { label: "src/engine.ts createMaterialBindGroup binding5 门控 fallback", file: engineSrc, marker: "const hasBinding5 = baseEntries.some((e) => e.binding === 5)" },
    { label: "dist/engine.js createMaterialBindGroup binding5 门控 fallback", file: engineDistJs, marker: "const hasBinding5 = baseEntries.some((e) => e.binding === 5);" },
  { label: "src/engine.ts assignDrawCallGroups 展开 baseEntries", file: engineSrc, marker: "...dc.baseBindGroupEntries" },
  { label: "dist/engine.js assignDrawCallGroups 展开 baseEntries", file: engineDistJs, marker: "...dc.baseBindGroupEntries" },
  // 断点 A 生效性（换行语义）：override 必须以真实换行拆分 fsBody 行；
  // "\\n" 两字符转义会让 findIndex 找不到 final_color（表达式含空格），静默不生效。
  { label: "src/graph/slots.ts override 真实换行 split", file: slotsSrc, marker: 'fsBody.split("\\n")' },
  { label: "dist/graph/slots.js override 真实换行 split", file: slotsDist, marker: "fsBody.split(String.fromCharCode(10))" },
  // 断点 A 生效性（fence 完整闭合）：fence 结束标记必须恰好一次且无残缺变体，
  // 否则 "FIX_ENDD" 一类残缺注释会让后续 WGSL 函数体不闭合（expected '}'）。
  { label: "dist/graph/slots.js fence 结束标记完整", file: slotsDist, marker: "V14D_STATE2_OVERRIDE_FIX_END" + "\n" },
  // 断点 A 生效性（helper 注入位置）：state2 helper 必须在 prelude（fn fs 开头）之前，
  // 否则 WGSL 函数嵌套 → expected '}' for function body，Face graph 应用失败静默回退。
  // Stage 2C-M1：state2 helpers 与 prelude 之间现在隔着 hair helper 注入行；
  // 「helper 在 prelude 前注入」不变量更新为 hair helper（最后一个 helper）紧邻 prelude。
  { label: "src/graph/slots.ts helper 在 prelude 前注入", file: slotsSrc, marker: 'V14D_HAIR_HELPER_WGSL : "") +' + "\n" + "    prelude(renderClass, alphaMode, v14dAlphaFault)" },
  { label: "dist/graph/slots.js helper 在 prelude 前注入", file: slotsDist, marker: 'V14D_HAIR_HELPER_WGSL : "") +' + "\n" + "        prelude(renderClass, alphaMode, v14dAlphaFault)" },
  // Stage 2B-M3 全身皮肤统一：身体合成 helper + BodySkin graph.name 覆写分支（src/dist 各自恰好一次）。
  { label: "src/graph/slots.ts body skin helper", file: slotsSrc, marker: "fn v14d_skin_body_composite(base: vec3f)" },
  { label: "dist/graph/slots.js body skin helper", file: slotsDist, marker: "fn v14d_skin_body_composite(base: vec3f)" },
  { label: "src/graph/slots.ts body skin override 分支", file: slotsSrc, marker: 'graphName === "V14D Body Skin Composite"' },
  { label: "dist/graph/slots.js body skin override 分支", file: slotsDist, marker: 'graphName === "V14D Body Skin Composite"' },
  // Stage 2C-M1 HairA/HairB V1：头发合成 helper 常量 + assembleModule 注入参数 +
  // compile 门控 + Hair graph.name 覆写分支（src/dist 各自恰好一次）。
  { label: "src/graph/slots.ts hair helper 常量", file: slotsSrc, marker: "const V14D_HAIR_HELPER_WGSL = " },
  { label: "dist/graph/slots.js hair helper 常量", file: slotsDist, marker: "const V14D_HAIR_HELPER_WGSL = " },
  { label: "src/graph/slots.ts assembleModule hair helper 参数", file: slotsSrc, marker: "includeV14dHairHelper = false," },
  { label: "dist/graph/slots.js assembleModule hair helper 参数", file: slotsDist, marker: "includeV14dHairHelper = false, v14dAlphaFault = false)" },
  { label: "src/graph/slots.ts assembleModule hair helper 注入", file: slotsSrc, marker: "(includeV14dHairHelper ? V14D_HAIR_HELPER_WGSL : " },
  { label: "dist/graph/slots.js assembleModule hair helper 注入", file: slotsDist, marker: "(includeV14dHairHelper ? V14D_HAIR_HELPER_WGSL : " },
  { label: "src/graph/compile.ts hair graph 门控", file: compileSrc, marker: 'graph.name === "V14D Hair V1 Composite" || graph.name === "V14D Brows Lashes V1 Composite"' },
  { label: "dist/graph/compile.js hair graph 门控", file: compileDist, marker: 'graph.name === "V14D Hair V1 Composite" || graph.name === "V14D Brows Lashes V1 Composite"' },
  { label: "src/graph/slots.ts hair override 分支", file: slotsSrc, marker: 'graphName === "V14D Hair V1 Composite"' },
  { label: "dist/graph/slots.js hair override 分支", file: slotsDist, marker: 'graphName === "V14D Hair V1 Composite"' },
  { label: "src/graph/slots.ts brows-lashes override guard", file: slotsSrc, marker: 'graphName === "V14D Brows Lashes V1 Composite"' },
  { label: "dist/graph/slots.js brows-lashes override guard", file: slotsDist, marker: 'graphName === "V14D Brows Lashes V1 Composite"' },
  { label: "src/graph/compile.ts brows-lashes helper 注入门控", file: compileSrc, marker: 'graph.name === "V14D Brows Lashes V1 Composite", v14dAlphaFault)' },
  { label: "dist/graph/compile.js brows-lashes helper 注入门控", file: compileDist, marker: 'graph.name === "V14D Brows Lashes V1 Composite", v14dAlphaFault);' },
  // Stage 2C-M2a 修正轮：wrongAlpha 验收故障注入 seam 不变量（裁决项 3）。
  // 正常路径：prelude 默认 alpha 表达式 material.alpha * tex_s.a 必须保留（let 形态，
  // 在 alphaDecl 三元表达式的 false 分支与其它非 fault 材质复用）。fault 因子仅在
  // alphaDecl 的 true 分支出现恰好一次（src/dist 各一）。compile 的 fault tag 门控
  // （graph.tags 含 v14d-wrong-alpha-fault）在 src/dist 各恰好一次。
  { label: "src/graph/slots.ts 正常 alpha 语义保留（let 分支）", file: slotsSrc, marker: ': "  let alpha = material.alpha * tex_s.a' },
  { label: "dist/graph/slots.js 正常 alpha 语义保留（let 分支）", file: slotsDist, marker: ': "  let alpha = material.alpha * tex_s.a' },
  { label: "src/graph/slots.ts wrongAlpha fault 因子恰好一次", file: slotsSrc, marker: "var alpha = material.alpha * tex_s.a * " + V14D_WRONG_ALPHA_FAULT_FACTOR_LITERAL },
  { label: "dist/graph/slots.js wrongAlpha fault 因子恰好一次", file: slotsDist, marker: "var alpha = material.alpha * tex_s.a * " + V14D_WRONG_ALPHA_FAULT_FACTOR_LITERAL },
  { label: "src/graph/compile.ts alphaFault tag 门控恰好一次", file: compileSrc, marker: 'graph.tags?.includes("v14d-wrong-alpha-fault")' },
  { label: "dist/graph/compile.js alphaFault tag 门控恰好一次", file: compileDist, marker: 'graph.tags?.includes("v14d-wrong-alpha-fault")' },
  { label: "src/graph/compile.ts brows-lashes tint 读取", file: compileSrc, marker: 'n.id === "v14d_brows_lashes_tint"' },
  { label: "dist/graph/compile.js brows-lashes tint 读取", file: compileDist, marker: 'n.id === "v14d_brows_lashes_tint"' },
  ];
})();

function strictVerifyAll() {
  const engineSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts");
  const engineDistJs = path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js");
  const engineDistDts = path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts");
  const compSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "shaders", "passes", "composite.ts");
  const compDist = path.join(rootDir, "node_modules", "reze-engine", "dist", "shaders", "passes", "composite.js");
  const checks = [
    { label: "src/engine.ts 生产源快照类型", file: engineSrc, marker: "export type ProductionDrawCallSourceSnapshot =" },
    { label: "dist/engine.d.ts 生产源快照类型", file: engineDistDts, marker: "export type ProductionDrawCallSourceSnapshot =" },
    { label: "src/engine.ts 生产源快照实现", file: engineSrc, marker: "getProductionDrawCallSourceSnapshot(captureId: string, frame: number): ProductionDrawCallSourceSnapshot" },
    { label: "dist/engine.js 生产源快照实现", file: engineDistJs, marker: "getProductionDrawCallSourceSnapshot(captureId, frame)" },
    { label: "dist/engine.d.ts 生产源快照声明", file: engineDistDts, marker: "getProductionDrawCallSourceSnapshot(captureId: string, frame: number): ProductionDrawCallSourceSnapshot;" },
    { label: "src/engine.ts 顶点源 COPY_SRC", file: engineSrc, marker: "usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC," },
    { label: "dist/engine.js 顶点源 COPY_SRC", file: engineDistJs, marker: "usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC," },
    { label: "src/engine.ts GPU morph 权重源 COPY_SRC", file: engineSrc, marker: "usage: RO | GPUBufferUsage.COPY_SRC," },
    { label: "dist/engine.js GPU morph 权重源 COPY_SRC", file: engineDistJs, marker: "usage: RO | GPUBufferUsage.COPY_SRC," },
    { label: "src/engine.ts 实现", file: engineSrc, marker: "__mdoStart = texs.length" },
    { label: "dist/engine.js 实现", file: engineDistJs, marker: "__mdoStart = texs.length" },
    { label: "dist/engine.d.ts 类型", file: engineDistDts, marker: "materialDiffuseOverrides?: Record<string, string>;" },
    { label: "src/engine.ts 类型", file: engineSrc, marker: "materialDiffuseOverrides?: Record<string, string>\n" },

    { label: "src/engine.ts setter", file: engineSrc, marker: "v.displayPassthrough = patch.displayPassthrough" },
    { label: "dist/engine.js setter", file: engineDistJs, marker: "v.displayPassthrough = patch.displayPassthrough" },
    { label: "src/engine.ts uniform u[2]", file: engineSrc, marker: "u[2] = v.displayPassthrough ? 1.0 : 0.0" },
    { label: "dist/engine.js uniform u[2]", file: engineDistJs, marker: "u[2] = v.displayPassthrough ? 1.0 : 0.0" },
    { label: "src merge 默认 false", file: engineSrc, marker: "displayPassthrough: partial?.displayPassthrough" },
    { label: "dist merge 默认 false", file: engineDistJs, marker: "displayPassthrough: partial?.displayPassthrough" },
    { label: "src ViewTransformOptions 类型", file: engineSrc, marker: "displayPassthrough?: boolean\n" },

    { label: "dist ViewTransformOptions 类型", file: engineDistDts, marker: "displayPassthrough?: boolean;" },
    { label: "src shader srgb_encode helper", file: compSrc, marker: "fn v14d_srgb_encode" },
    { label: "dist shader srgb_encode helper", file: compDist, marker: "fn v14d_srgb_encode" },
    { label: "src shader passthrough 早退", file: compSrc, marker: "viewU[0].z > 0.5" },
    { label: "dist shader passthrough 早退", file: compDist, marker: "viewU[0].z > 0.5" },
    { label: "src shader grade/gamma 门控", file: compSrc, marker: "viewU[0].z <= 0.5 && APPLY_GAMMA" },
    { label: "dist shader grade/gamma 门控", file: compDist, marker: "viewU[0].z <= 0.5 && APPLY_GAMMA" },
    { label: "src 诊断纹理禁 mipmap", file: engineSrc, marker: "__v14dNoMipmapPaths?.has(logicalPath)" },
    { label: "dist 诊断纹理禁 mipmap", file: engineDistJs, marker: "__v14dNoMipmapPaths?.has(logicalPath)" },
    { label: "override 记录诊断纹理集合", file: engineDistJs, marker: "this.__v14dNoMipmapPaths = new Set(Object.values(__mdo))" },
    // ─── 补丁五（State2 实时合成）不变量：各恰好一次 ───
    ...STATE2_VERIFY_CHECKS,
  ];
  let allOk = true;
  for (const c of checks) {
    const content = fs.existsSync(c.file) ? fs.readFileSync(c.file, "utf8") : "";
    // CRLF 文件：marker 末尾换行写成 LF 时 split 不命中。按 "marker 或其 CRLF 形式" 统一计数。
    const markers = [c.marker, c.marker.replace(/\n$/, "\r\n")].filter((m, i, a) => a.indexOf(m) === i);
    let count = 0;
    for (const m of markers) count += content.split(m).length - 1;
    const expectedCount = c.expectedCount ?? 1;
    const ok = count === expectedCount;
    if (!ok) allOk = false;
    console.log("[verify] " + c.label + ": marker 出现 " + count + " 次 " + (ok ? "OK" : "FAIL(应为" + expectedCount + "次)"));
  }
  if (!allOk) { console.error("===PATCH-VERIFY-FAIL=== 存在非恰好一次的 marker"); return false; }
  console.log("===PATCH-VERIFY-OK=== 全部 " + checks.length + " 项严格不变量满足预期计数");
  return true;
}
if (process.argv.includes("--verify")) { if (!strictVerifyAll()) process.exit(1); else process.exit(0); }

// ─── 补丁三：display-passthrough 视图变换模式（默认关闭，绕过 Filmic/grade/gamma） ──
// 目标（Stage 2A-GF4 AgX 显示字节 Face 捕获闭环）：bakedGolden 诊断把「磁盘权威
// AgX PNG 的原始 8-bit 显示字节」反投影到 Face atlas 后，Web 端必须**原样直通**
// 这些显示字节，不能再过引擎默认的 Filmic LUT + color grading + gamma（否则等于把
// 已是显示域的字节二次调色，破坏「显示字节 = 显示字节」的闭环不变量）。
//
// 最小注入：复用 composite uniform 的 viewU[0] 空槽 z 分量（u[2]）作 passthrough
// 标志。默认 false（u[2]=0），生产路径完全不变；仅显式 setViewTransformOptions({
// displayPassthrough: true }) 时 u[2]=1，composite fragment 在 filmic/grade/gamma
// 之前早退 disp=exposed（仅保留 exposure 缩放的线性色，不做任何色调映射）。
//
// 精确不变量（--verify 校验，各恰好一次）：
//   1) setter 接受 displayPassthrough 字段（src/dist 各一处）；
//   2) uniform 写入 u[2] = passthrough?1:0（src/dist 各一处）；
//   3) mergeViewTransformDefaults 默认 displayPassthrough=false（src/dist 各一处）；
//   4) ViewTransformOptions 类型含 displayPassthrough?: boolean（src.ts/dist.d.ts 各一处）；
//   5) composite shader 含 passthrough 早退分支（src.ts/dist.js 各一处）。
const PASSTHROUGH_SETTER_ANCHOR_SRC = "    if (patch.look !== undefined) v.look = patch.look\n";
const PASSTHROUGH_SETTER_ANCHOR_DIST = "        if (patch.look !== undefined)\n            v.look = patch.look;\n";
const PASSTHROUGH_UNIFORM_SRC = "    u[2] = 0.0\n";
const PASSTHROUGH_UNIFORM_DIST = "        u[2] = 0.0;\n";
const PASSTHROUGH_MERGE_SRC = "      look: partial?.look ?? d.look,\n";
const PASSTHROUGH_MERGE_DIST = "            look: partial?.look ?? d.look,\n";
const PASSTHROUGH_TYPE_SRC = '  look: "default" | "medium_high_contrast"\n}';
const PASSTHROUGH_TYPE_DIST = '    look: "default" | "medium_high_contrast";\n};';
// composite shader helper：sRGB OETF（linear→显示字节域）。display-passthrough 把
// 纹理解码后的 linear 值重新编码回 sRGB 显示字节，使「磁盘 PNG 字节 ⇄ 显示字节」闭环。
const PASSTHROUGH_HELPER_ANCHOR = "const FILMIC_LUT_W: f32 = 256.0;\n";
const PASSTHROUGH_HELPER_REPLACEMENT =
  "const FILMIC_LUT_W: f32 = 256.0;\n" +
  "// V14D display passthrough: linear→sRGB OETF (IEC 61966-2-1).\n" +
  "fn v14d_srgb_encode(x: f32) -> f32 {\n" +
  "  let c = max(x, 0.0);\n" +
  "  return select(1.055 * pow(c, 1.0 / 2.4) - 0.055, 12.92 * c, c <= 0.0031308);\n" +
  "}\n";
// composite shader：filmic/grade/gamma 三层整体包进 else，passthrough 时早退并做
// linear→sRGB 编码（纹理由 rgba8unorm-srgb 硬件解码为 linear，passthrough 须还原字节）。
const PASSTHROUGH_SHADER_ANCHOR =
  "  let exposed = combined * exp2(viewU[0].x);\n" +
  "  let tm = vec3f(filmic(exposed.r), filmic(exposed.g), filmic(exposed.b));\n" +
  "  var disp = max(tm, vec3f(0.0));\n";
const PASSTHROUGH_SHADER_REPLACEMENT =
  "  let exposed = combined * exp2(viewU[0].x);\n" +
  "  // V14D display passthrough (viewU[0].z>0.5): bypass Filmic LUT + grade + gamma.\n" +
  "  // 纹理由硬件 sRGB→linear 解码；passthrough 重新 linear→sRGB 编码，使最终显示\n" +
  "  // 字节等于注入纹理的原始 sRGB 字节（显示字节闭环）。Default off (viewU[0].z==0).\n" +
  "  var disp = max(vec3f(filmic(exposed.r), filmic(exposed.g), filmic(exposed.b)), vec3f(0.0));\n" +
  "  if (viewU[0].z > 0.5) {\n" +
  "    let le = max(exposed, vec3f(0.0));\n" +
  "    disp = vec3f(v14d_srgb_encode(le.r), v14d_srgb_encode(le.g), v14d_srgb_encode(le.b));\n" +
  "  }\n";
// grade/gamma 块：仅在非 passthrough 时执行（passthrough 已早退，跳过这两层）。
const GRADE_BLOCK_ANCHOR =
  "  if (viewU[9].w > 0.5) {\n" +
  "    disp = grade(disp);\n" +
  "  }\n" +
  "  if (APPLY_GAMMA) {\n" +
  "    disp = pow(disp, vec3f(viewU[0].y));\n" +
  "  }\n";
const GRADE_BLOCK_REPLACEMENT =
  "  if (viewU[0].z <= 0.5 && viewU[9].w > 0.5) {\n" +
  "    disp = grade(disp);\n" +
  "  }\n" +
  "  if (viewU[0].z <= 0.5 && APPLY_GAMMA) {\n" +
  "    disp = pow(disp, vec3f(viewU[0].y));\n" +
  "  }\n";

const passthroughTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: PASSTHROUGH_SETTER_ANCHOR_SRC,
    replacement: PASSTHROUGH_SETTER_ANCHOR_SRC + "    if (patch.displayPassthrough !== undefined) v.displayPassthrough = patch.displayPassthrough\n",
    doneMarker: "v.displayPassthrough = patch.displayPassthrough",
    label: "src/engine.ts setter",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: PASSTHROUGH_SETTER_ANCHOR_DIST,
    replacement: PASSTHROUGH_SETTER_ANCHOR_DIST + "        if (patch.displayPassthrough !== undefined)\n            v.displayPassthrough = patch.displayPassthrough;\n",
    doneMarker: "v.displayPassthrough = patch.displayPassthrough",
    label: "dist/engine.js setter",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: PASSTHROUGH_UNIFORM_SRC,
    replacement: "    u[2] = v.displayPassthrough ? 1.0 : 0.0\n",
    doneMarker: "u[2] = v.displayPassthrough ? 1.0 : 0.0",
    label: "src/engine.ts uniform u[2]",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: PASSTHROUGH_UNIFORM_DIST,
    replacement: "        u[2] = v.displayPassthrough ? 1.0 : 0.0;\n",
    doneMarker: "u[2] = v.displayPassthrough ? 1.0 : 0.0",
    label: "dist/engine.js uniform u[2]",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: PASSTHROUGH_MERGE_SRC,
    replacement: PASSTHROUGH_MERGE_SRC + "      displayPassthrough: partial?.displayPassthrough ?? d.displayPassthrough ?? false,\n",
    doneMarker: "displayPassthrough: partial?.displayPassthrough",
    label: "src/engine.ts merge 默认 false",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: PASSTHROUGH_MERGE_DIST,
    replacement: PASSTHROUGH_MERGE_DIST + "            displayPassthrough: partial?.displayPassthrough ?? d.displayPassthrough ?? false,\n",
    doneMarker: "displayPassthrough: partial?.displayPassthrough",
    label: "dist/engine.js merge 默认 false",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: PASSTHROUGH_TYPE_SRC,
    replacement: '  look: "default" | "medium_high_contrast"\n  /** Display passthrough (default false): bypass Filmic/grade/gamma in composite. */\n  displayPassthrough?: boolean\n}',
    doneMarker: "displayPassthrough?: boolean",
    label: "src/engine.ts ViewTransformOptions 类型",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts"),
    anchor: PASSTHROUGH_TYPE_DIST,
    replacement: '    look: "default" | "medium_high_contrast";\n    /** Display passthrough (default false): bypass Filmic/grade/gamma in composite. */\n    displayPassthrough?: boolean;\n};',
    doneMarker: "displayPassthrough?: boolean;",
    label: "dist/engine.d.ts ViewTransformOptions 类型",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "shaders", "passes", "composite.ts"),
    anchor: PASSTHROUGH_SHADER_ANCHOR,
    replacement: PASSTHROUGH_SHADER_REPLACEMENT,
    doneMarker: "viewU[0].z > 0.5",
    label: "src/shaders/passes/composite.ts passthrough 早退",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "shaders", "passes", "composite.ts"),
    anchor: PASSTHROUGH_HELPER_ANCHOR,
    replacement: PASSTHROUGH_HELPER_REPLACEMENT,
    doneMarker: "fn v14d_srgb_encode",
    label: "src/shaders/passes/composite.ts srgb_encode helper",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "shaders", "passes", "composite.js"),
    anchor: PASSTHROUGH_HELPER_ANCHOR,
    replacement: PASSTHROUGH_HELPER_REPLACEMENT,
    doneMarker: "fn v14d_srgb_encode",
    label: "dist/shaders/passes/composite.js srgb_encode helper",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "shaders", "passes", "composite.js"),
    anchor: PASSTHROUGH_SHADER_ANCHOR,
    replacement: PASSTHROUGH_SHADER_REPLACEMENT,
    doneMarker: "viewU[0].z > 0.5",
    label: "dist/shaders/passes/composite.js passthrough 早退",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "shaders", "passes", "composite.ts"),
    anchor: GRADE_BLOCK_ANCHOR,
    replacement: GRADE_BLOCK_REPLACEMENT,
    doneMarker: "viewU[0].z <= 0.5 && APPLY_GAMMA",
    label: "src/shaders/passes/composite.ts grade/gamma 门控",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "shaders", "passes", "composite.js"),
    anchor: GRADE_BLOCK_ANCHOR,
    replacement: GRADE_BLOCK_REPLACEMENT,
    doneMarker: "viewU[0].z <= 0.5 && APPLY_GAMMA",
    label: "dist/shaders/passes/composite.js grade/gamma 门控",
  },
];

// ─── 补丁四：诊断纹理禁用 mipmap（默认关闭，仅 materialDiffuseOverrides 命中的纹理） ──
// 见 OVERRIDE_HELPER 注释：反投影/烘焙诊断纹理在 minification 下采被 dilation 污染的
// 低 mip 级。对 __v14dNoMipmapPaths 集合内的 logicalPath 强制 mipLevelCount=1。
const MIPMAP_SRC_ANCHOR = "    const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1\n";
const MIPMAP_DIST_ANCHOR = "        const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;\n";
const mipmapTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: MIPMAP_SRC_ANCHOR,
    replacement: "    const mipLevelCount = this.__v14dNoMipmapPaths?.has(logicalPath) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1\n",
    doneMarker: "__v14dNoMipmapPaths?.has(logicalPath)",
    label: "src/engine.ts 诊断纹理禁 mipmap",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: MIPMAP_DIST_ANCHOR,
    replacement: "        const mipLevelCount = this.__v14dNoMipmapPaths?.has(logicalPath) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1;\n",
    doneMarker: "__v14dNoMipmapPaths?.has(logicalPath)",
    label: "dist/engine.js 诊断纹理禁 mipmap",
  },
];
passthroughTargets.push(...mipmapTargets);

// ─── 补丁五：V14D State2 实时脸部合成（默认关闭，Stage 2B-M1） ────────────────
// 目标：Face 材质在 Web 线性空间逐像素从「原始 face_d + State2 packed mask +
// Blender 节点常量」实时执行 warm/art/fringe 合成，不再使用整张预烘焙脸图。
//
// 最小注入面：
//   1) loadModel options.materialAuxTextures（材质名 → 辅助纹理 logicalPath，默认关）：
//      在 materialDiffuseOverrides 同一点（loadFromReader 之后、addModel 之前）
//      追加独立 texture entry，记 model.__v14dAuxTexturePaths。不改磁盘 PMX、材质槽、
//      拓扑或 VMD。
//   2) createTextureFromLogicalPath：对 __v14dAuxTexturePaths 命中的路径创建
//      rgba8unorm（无 sRGB 硬件解码，mask 是 Non-Color 线性数据）且禁用 mipmap
//      （mip0 双线性 = 离线逐纹素口径，避免被 dilation/填充污染的低 mip 级）。
//   3) mainPerMaterialBindGroupLayout 追加 binding(5) 纹理槽（extra mask texture）；
//      createMaterialBindGroup 统一绑定（无 mask 的材质回退 fallbackMaterialTexture）。
//      绑定必须在 GPU 材质建立前闭合并由 Gate 读取 dataset 证据。
//   4) 编译 graph（graph.tags 含 "v14d-state2-face"）时注入 mask 纹理声明 + 合成
//      helper（warm/art/fringe/occlusion 常量来自权威 blend 取证，硬编码于 WGSL）。
//      仅 Face 材质走实时合成 graph；其余材质（EyeWhite/Eyes/Eyes+/Hair/Body/Clothes）
//      保持 reze-k3 正常路径，不引用新纹理。
const AUX_HELPER_SRC = [
  "      const __aux = pathOrOptions.materialAuxTextures",
  "      if (__aux) {",
  "        const texs = model.getTextures()",
  "        for (const m of model.getMaterials()) {",
  "          const p = __aux[m.name]",
  "          if (p !== undefined) {",
  '            texs.push({ path: p, name: p.split("/").pop() || p })',
  "            model.__v14dAuxTextureIndex = model.__v14dAuxTextureIndex || {}",
  "            model.__v14dAuxTextureIndex[m.name] = texs.length - 1",
  "          }",
  "        }",
  "        model.__v14dAuxTexturePaths = new Set(Object.values(__aux))",
  "      }",
  "",
].join("\n");
const AUX_HELPER_DIST = [
  "            const __aux = pathOrOptions.materialAuxTextures;",
  "            if (__aux) {",
  "                const texs = model.getTextures();",
  "                for (const m of model.getMaterials()) {",
  "                    const p = __aux[m.name];",
  "                    if (p !== undefined) {",
  '                        texs.push({ path: p, name: p.split("/").pop() || p });',
  "                        model.__v14dAuxTextureIndex = model.__v14dAuxTextureIndex || {};",
  "                        model.__v14dAuxTextureIndex[m.name] = texs.length - 1;",
  "                    }",
  "                }",
  "                model.__v14dAuxTexturePaths = new Set(Object.values(__aux));",
  "            }",
  "",
].join("\n");
const AUX_ANCHOR_SRC = OVERRIDE_HELPER_SRC + "      model.setName(name)";
const AUX_ANCHOR_DIST = OVERRIDE_HELPER_DIST + "            model.setName(name);";
const AUX_REPLACEMENT_SRC = OVERRIDE_HELPER_SRC + AUX_HELPER_SRC + "      model.setName(name)";
const AUX_REPLACEMENT_DIST = OVERRIDE_HELPER_DIST + AUX_HELPER_DIST + "            model.setName(name);";

// createTextureFromLogicalPath：aux mask 纹理用 rgba8unorm（非 sRGB）+ 禁 mipmap。
const AUX_TEX_SRC_ANCHOR = "    const mipLevelCount = this.__v14dNoMipmapPaths?.has(logicalPath) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1\n";
const AUX_TEX_SRC_REPLACEMENT =
  "    const __isAuxMask = inst.model.__v14dAuxTexturePaths?.has(logicalPath)\n" +
  "    const mipLevelCount = (__isAuxMask || this.__v14dNoMipmapPaths?.has(logicalPath)) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1\n";
const AUX_TEX_DIST_ANCHOR = "        const mipLevelCount = this.__v14dNoMipmapPaths?.has(logicalPath) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1;\n";
const AUX_TEX_DIST_REPLACEMENT =
  "        const __isAuxMask = inst.model.__v14dAuxTexturePaths?.has(logicalPath);\n" +
  "        const mipLevelCount = (__isAuxMask || this.__v14dNoMipmapPaths?.has(logicalPath)) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1;\n";
// 必须锁定真实纹理创建点（label 为 `texture: ${cacheKey}` 的那一处）。
// 宽松锚点会把 createPipelines 的 fallback 1x1 白纹理（无 logicalPath 上下文）
// 错误覆写，浏览器运行时报 `__isAuxMask is not defined`；fallback 保持固定 srgb。
const TEX_FORMAT_SRC_ANCHOR = "      label: `texture: ${cacheKey}`,\n      size: [width, height],\n      format: \"rgba8unorm-srgb\",\n";
const TEX_FORMAT_SRC_REPLACEMENT = "      label: `texture: ${cacheKey}`,\n      size: [width, height],\n      format: __isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\",\n";
const TEX_FORMAT_DIST_ANCHOR = "            label: `texture: ${cacheKey}`,\n            size: [width, height],\n            format: \"rgba8unorm-srgb\",\n";
const TEX_FORMAT_DIST_REPLACEMENT = "            label: `texture: ${cacheKey}`,\n            size: [width, height],\n            format: __isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\",\n";

// bind group 布局：binding(5) = extra mask texture（v14d state2）。默认材质回退 fallback。
const BINDGROUP_LAYOUT_SRC_ANCHOR =
  '        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },\n      ],\n    })\n\n    // Shared zero StyleUniforms buffer';
const BINDGROUP_LAYOUT_SRC_REPLACEMENT =
  '        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },\n        // V14D State2 实时合成：extra mask texture（默认回退 fallbackMaterialTexture）。\n        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },\n      ],\n    })\n\n    // Shared zero StyleUniforms buffer';
const BINDGROUP_LAYOUT_DIST_ANCHOR =
  '                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },\n            ],\n        });\n        // Shared zero StyleUniforms buffer';
const BINDGROUP_LAYOUT_DIST_REPLACEMENT =
  '                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },\n                // V14D State2 实时合成：extra mask texture（默认回退 fallbackMaterialTexture）。\n                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },\n            ],\n        });\n        // Shared zero StyleUniforms buffer';

const CREATE_BINDGROUP_SRC_ANCHOR = [
  "  private createMaterialBindGroup(label: string, baseEntries: GPUBindGroupEntry[], styleBuffer: GPUBuffer): GPUBindGroup {",
  "    return this.device.createBindGroup({",
  "      label,",
  "      layout: this.mainPerMaterialBindGroupLayout,",
  "      entries: [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }],",
  "    })",
  "  }",
].join("\n");
const CREATE_BINDGROUP_SRC_REPLACEMENT = [
  "  private createMaterialBindGroup(label: string, baseEntries: GPUBindGroupEntry[], styleBuffer: GPUBuffer, maskView?: GPUTextureView): GPUBindGroup {",
  "    return this.device.createBindGroup({",
  "      label,",
  "      layout: this.mainPerMaterialBindGroupLayout,",
  "      entries: [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }, { binding: 5, resource: maskView ?? this.fallbackMaterialTexture.createView() }],",
  "    })",
  "  }",
].join("\n");
const CREATE_BINDGROUP_DIST_ANCHOR = [
  "    createMaterialBindGroup(label, baseEntries, styleBuffer) {",
  "        return this.device.createBindGroup({",
  "            label,",
  "            layout: this.mainPerMaterialBindGroupLayout,",
  "            entries: [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }],",
  "        });",
  "    }",
].join("\n");
const CREATE_BINDGROUP_DIST_REPLACEMENT = [
  "    createMaterialBindGroup(label, baseEntries, styleBuffer, maskView) {",
  "        return this.device.createBindGroup({",
  "            label,",
  "            layout: this.mainPerMaterialBindGroupLayout,",
  "            entries: [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }, { binding: 5, resource: maskView ?? this.fallbackMaterialTexture.createView() }],",
  "        });",
  "    }",
].join("\n");

// Fresh 0.26.0 上游布局的后续说明文字可能变化，target 只锁定结构闭合行。
const BINDGROUP_LAYOUT_SRC_ANCHOR_FIXED = [
  "        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "      ],",
  "    })",
].join("\n");
const BINDGROUP_LAYOUT_SRC_REPLACEMENT_FIXED = [
  "        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "        // V14D State2 实时合成：extra mask 纹理（默认回退 fallbackMaterialTexture）。",
  "        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "      ],",
  "    })",
].join("\n");
const BINDGROUP_LAYOUT_DIST_ANCHOR_FIXED = [
  "                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "            ],",
  "        });",
].join("\n");
const BINDGROUP_LAYOUT_DIST_REPLACEMENT_FIXED = [
  "                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "                // V14D State2 实时合成：extra mask 纹理（默认回退 fallbackMaterialTexture）。",
  "                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "            ],",
  "        });",
].join("\n");

const CREATE_BINDGROUP_SRC_REPLACEMENT_FIXED = [
  "  private createMaterialBindGroup(label: string, baseEntries: GPUBindGroupEntry[], styleBuffer: GPUBuffer, maskView?: GPUTextureView): GPUBindGroup {",
  "    const hasBinding5 = baseEntries.some((e) => e.binding === 5)",
  "    const maskEntry = hasBinding5 ? baseEntries.find((e) => e.binding === 5) : undefined",
  "    const effectiveMaskView = maskEntry?.resource ?? maskView ?? this.fallbackMaterialTexture.createView()",
  "    const entries: GPUBindGroupEntry[] = [",
  "      ...baseEntries.filter((e) => e.binding !== 5),",
  "      { binding: 4, resource: { buffer: styleBuffer } },",
  "      { binding: 5, resource: effectiveMaskView },",
  "    ]",
  "    return this.device.createBindGroup({",
  "      label,",
  "      layout: this.mainPerMaterialBindGroupLayout,",
  "      entries,",
  "    })",
  "  }",
].join("\n");
const CREATE_BINDGROUP_DIST_REPLACEMENT_FIXED = [
  "    createMaterialBindGroup(label, baseEntries, styleBuffer, maskView) {",
  "        const hasBinding5 = baseEntries.some((e) => e.binding === 5);",
  "        const maskEntry = hasBinding5 ? baseEntries.find((e) => e.binding === 5) : undefined;",
  "        const effectiveMaskView = maskEntry?.resource ?? maskView ?? this.fallbackMaterialTexture.createView();",
  "        const entries = [",
  "            ...baseEntries.filter((e) => e.binding !== 5),",
  "            { binding: 4, resource: { buffer: styleBuffer } },",
  "            { binding: 5, resource: effectiveMaskView },",
  "        ];",
  "        return this.device.createBindGroup({",
  "            label,",
  "            layout: this.mainPerMaterialBindGroupLayout,",
  "            entries,",
  "        });",
  "    }",
].join("\n");

const BINDGROUP_LAYOUT_SRC_ANCHOR_STRUCTURED = [
  "    this.mainPerMaterialBindGroupLayout = this.device.createBindGroupLayout({",
  "      label: \"main per-material bind group layout\",",
  "      entries: [",
  "        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        // StyleUniforms for compiled graph shaders (adjust-tier sliders). Hand-written",
  "        // presets simply don't declare it — a layout may carry bindings a shader ignores.",
  "        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "      ],",
  "    })",
].join("\n");
const BINDGROUP_LAYOUT_SRC_REPLACEMENT_STRUCTURED = [
  "    this.mainPerMaterialBindGroupLayout = this.device.createBindGroupLayout({",
  "      label: \"main per-material bind group layout\",",
  "      entries: [",
  "        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        // StyleUniforms for compiled graph shaders (adjust-tier sliders). Hand-written",
  "        // presets simply don't declare it — a layout may carry bindings a shader ignores.",
  "        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "        // V14D State2 实时合成：extra mask texture（默认回退 fallbackMaterialTexture）。",
  "        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "      ],",
  "    })",
].join("\n");
const BINDGROUP_LAYOUT_DIST_ANCHOR_STRUCTURED = [
  "        this.mainPerMaterialBindGroupLayout = this.device.createBindGroupLayout({",
  "            label: \"main per-material bind group layout\",",
  "            entries: [",
  "                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                // StyleUniforms for compiled graph shaders (adjust-tier sliders). Hand-written",
  "                // presets simply don't declare it — a layout may carry bindings a shader ignores.",
  "                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "            ],",
  "        });",
].join("\n");
const BINDGROUP_LAYOUT_DIST_REPLACEMENT_STRUCTURED = [
  "        this.mainPerMaterialBindGroupLayout = this.device.createBindGroupLayout({",
  "            label: \"main per-material bind group layout\",",
  "            entries: [",
  "                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                // StyleUniforms for compiled graph shaders (adjust-tier sliders). Hand-written",
  "                // presets simply don't declare it — a layout may carry bindings a shader ignores.",
  "                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "                // V14D State2 实时合成：extra mask texture（默认回退 fallbackMaterialTexture）。",
  "                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "            ],",
  "        });",
].join("\n");

const SETUP_MASK_SRC_ANCHOR = "      const textureView = diffuseTexture.createView()\n";
const SETUP_MASK_SRC_REPLACEMENT = [
  "      const textureView = diffuseTexture.createView()",
  "      // V14D State2 实时合成：aux mask 纹理（仅 materialAuxTextures 命中的材质）。",
  "      const __auxIdx = inst.model.__v14dAuxTextureIndex?.[mat.name]",
  "      const __auxTexture = __auxIdx !== undefined ? await loadTextureByIndex(__auxIdx) : null",
  "      const __auxMaskView = __auxTexture ? __auxTexture.createView() : undefined",
  "",
].join("\n");
const SETUP_MASK_DIST_ANCHOR = "            const textureView = diffuseTexture.createView();\n";
const SETUP_MASK_DIST_REPLACEMENT = [
  "            const textureView = diffuseTexture.createView();",
  "            // V14D State2 实时合成：aux mask 纹理（仅 materialAuxTextures 命中的材质）。",
  "            const __auxIdx = inst.model.__v14dAuxTextureIndex?.[mat.name];",
  "            const __auxTexture = __auxIdx !== undefined ? await loadTextureByIndex(__auxIdx) : null;",
  "            const __auxMaskView = __auxTexture ? __auxTexture.createView() : undefined;",
  "",
].join("\n");
const SETUP_BINDGROUP_SRC_ANCHOR = [
  "      const bindGroup = this.createMaterialBindGroup(",
  "        `${prefix}material: ${mat.name}`,",
  "        baseBindGroupEntries,",
  "        this.zeroStyleBuffer,",
  "      )",
].join("\n");
const SETUP_BINDGROUP_SRC_REPLACEMENT = [
  "      const bindGroup = this.createMaterialBindGroup(",
  "        `${prefix}material: ${mat.name}`,",
  "        baseBindGroupEntries,",
  "        this.zeroStyleBuffer,",
  "        __auxMaskView,",
  "      )",
].join("\n");
const SETUP_BINDGROUP_DIST_ANCHOR = "            const bindGroup = this.createMaterialBindGroup(`${prefix}material: ${mat.name}`, baseBindGroupEntries, this.zeroStyleBuffer);";
const SETUP_BINDGROUP_DIST_REPLACEMENT = "            const bindGroup = this.createMaterialBindGroup(`${prefix}material: ${mat.name}`, baseBindGroupEntries, this.zeroStyleBuffer, __auxMaskView);";

const state2Targets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: AUX_ANCHOR_SRC,
    replacement: AUX_REPLACEMENT_SRC,
    doneMarker: "const __aux = pathOrOptions.materialAuxTextures",
    label: "src/engine.ts materialAuxTextures 注入",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: AUX_ANCHOR_DIST,
    replacement: AUX_REPLACEMENT_DIST,
    doneMarker: "const __aux = pathOrOptions.materialAuxTextures;",
    label: "dist/engine.js materialAuxTextures 注入",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: AUX_TEX_SRC_ANCHOR,
    replacement: AUX_TEX_SRC_REPLACEMENT,
    doneMarker: "__v14dAuxTexturePaths?.has(logicalPath)",
    label: "src/engine.ts aux mask 禁 mipmap",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: AUX_TEX_DIST_ANCHOR,
    replacement: AUX_TEX_DIST_REPLACEMENT,
    doneMarker: "__v14dAuxTexturePaths?.has(logicalPath)",
    label: "dist/engine.js aux mask 禁 mipmap",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: TEX_FORMAT_SRC_ANCHOR,
    replacement: TEX_FORMAT_SRC_REPLACEMENT,
    doneMarker: "__isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\"",
    label: "src/engine.ts aux mask 非 sRGB 视图",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: TEX_FORMAT_DIST_ANCHOR,
    replacement: TEX_FORMAT_DIST_REPLACEMENT,
    doneMarker: "__isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\"",
    label: "dist/engine.js aux mask 非 sRGB 视图",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: BINDGROUP_LAYOUT_SRC_ANCHOR_STRUCTURED,
    replacement: BINDGROUP_LAYOUT_SRC_REPLACEMENT_STRUCTURED,
    doneMarker: "// V14D State2 实时合成：extra mask texture",
    label: "src/engine.ts bind group 布局 binding(5)",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: BINDGROUP_LAYOUT_DIST_ANCHOR_STRUCTURED,
    replacement: BINDGROUP_LAYOUT_DIST_REPLACEMENT_STRUCTURED,
    doneMarker: "// V14D State2 实时合成：extra mask texture",
    label: "dist/engine.js bind group 布局 binding(5)",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: CREATE_BINDGROUP_SRC_ANCHOR,
    replacement: CREATE_BINDGROUP_SRC_REPLACEMENT_FIXED,
    doneMarker: "effectiveMaskView = ",
    label: "src/engine.ts createMaterialBindGroup binding(5)",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: CREATE_BINDGROUP_DIST_ANCHOR,
    replacement: CREATE_BINDGROUP_DIST_REPLACEMENT_FIXED,
    doneMarker: "effectiveMaskView = ",
    label: "dist/engine.js createMaterialBindGroup binding(5)",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: SETUP_MASK_SRC_ANCHOR,
    replacement: SETUP_MASK_SRC_REPLACEMENT,
    doneMarker: "__auxMaskView",
    label: "src/engine.ts setupMaterialsForInstance mask 加载",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: SETUP_MASK_DIST_ANCHOR,
    replacement: SETUP_MASK_DIST_REPLACEMENT,
    doneMarker: "__auxMaskView",
    label: "dist/engine.js setupMaterialsForInstance mask 加载",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: SETUP_BINDGROUP_SRC_ANCHOR,
    replacement: SETUP_BINDGROUP_SRC_REPLACEMENT,
    doneMarker: "this.zeroStyleBuffer,\n        __auxMaskView,",
    label: "src/engine.ts setupMaterialsForInstance bindGroup 传 mask",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: SETUP_BINDGROUP_DIST_ANCHOR,
    replacement: SETUP_BINDGROUP_DIST_REPLACEMENT,
    doneMarker: "this.zeroStyleBuffer, __auxMaskView);",
    label: "dist/engine.js setupMaterialsForInstance bindGroup 传 mask",
  },
];

// slots.ts/compile.ts：v14d-state2-face graph 编译时注入 mask 纹理声明 + 合成 helper。
// 常量来自权威 blend 取证（web/scripts/forensic-v14d-face-state2.py 输出 manifest）。
const SLOTS_STATE2_ANCHOR = "const HAIR_OVER_EYES_DECL = `override IS_OVER_EYES: bool = false;\n\n`\n";
// Stage 2C-M1 修正轮：dist/graph/slots.js 头部追加 bundle specifier 重定向，使
// node --test 能直接 import 该文件（浏览器由打包器按 specifier 解析；node 的 ESM
// 需要显式扩展名）。import 提升保证重定向在任何相对导入前生效，对浏览器/打包器
// 是无副作用的合法 import。
const SLOTS_DIST_BUNDLE_REDIRECT = "import \"reze-engine\";\n";
const SLOTS_STATE2_DIST_ANCHOR = "const HAIR_OVER_EYES_DECL = `override IS_OVER_EYES: bool = false;\n\n`;\n";

// Stage 2C-M1：V14D 头发合成 helper 的独立 WGSL 常量（不并入 state2 helpers）。
// 常量来源：web/src/features/stage/v14dAuthority.js 的 V14D_HAIR_TINT 唯一权威导出。
// 该脚本只把经过结构/数值校验的导出序列化进生成的 reze-engine 补丁；assembleModule
// 用 includeV14dHairHelper 单独注入（不连带 State2 mask 声明/binding 5），hair graph
// 无需 mask 即可编译。
const V14D_HAIR_HELPER_DECL_SRC =
  "// V14D 头发合成 helper（Stage 2C-M1）：hair_d 线性 × 银白紫乘色（权威 blend 取证）。\n" +
  "const V14D_HAIR_HELPER_WGSL = `fn v14d_hair_composite(base: vec3f, tint: vec3f) -> vec3f { return base * tint; }\n`;\n";
const V14D_HAIR_HELPER_DECL_DIST =
  "// V14D 头发合成 helper（Stage 2C-M1）：hair_d 线性 × 银白紫乘色（权威 blend 取证）。\n" +
  "const V14D_HAIR_HELPER_WGSL = `fn v14d_hair_composite(base: vec3f, tint: vec3f) -> vec3f { return base * tint; }\n`;\n";
// Stage 2C-M1（HairA/HairB V1 材质迁移）：V14D 头发合成 helper，由独立升级 target
// 追加到已存在的 V14D_STATE2_HELPERS_WGSL 模板（helper 追加 target 在 slots 声明
// target 之后执行，fresh/旧补丁两种形态都最终收敛）。
const SLOTS_STATE2_REPLACEMENT = "const HAIR_OVER_EYES_DECL = `override IS_OVER_EYES: bool = false;\n\n`\n\n// V14D State2 实时合成（Stage 2B-M1）：extra mask 纹理声明 + 合成 helper。\n// 常量来自权威 blend 取证（web/scripts/forensic-v14d-face-state2.py 输出 manifest）：\n//   warm=[1,0.935,0.89], shadowTint=[0.66,0.58,0.60], fringeTint=[0.70,0.64,0.69]。\n// mask 纹理为 rgba8unorm（非 sRGB 解码视图），采样即线性值；仅在编译 tags 含\n// \"v14d-state2-face\" 的 graph 时注入，默认关闭；Stage 2B-M3 起 body graph 也按 graph.name 注入。\nconst V14D_STATE2_MASK_DECL = `@group(2) @binding(5) var v14d_state2_mask: texture_2d<f32>;\n\n`;\n\nconst V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor(mask: vec3f) -> vec3f {\n  let inv_b = 1.0 - mask.b;\n  let art = mix(vec3f(1.0, 1.0, 1.0), vec3f(0.66, 0.58, 0.60), mask.r * inv_b);\n  let fringe = mix(vec3f(1.0, 1.0, 1.0), vec3f(0.70, 0.64, 0.69), mask.g * inv_b);\n  return art * fringe;\n}\n\nfn v14d_state2_composite(base: vec3f, mask: vec3f) -> vec3f {\n  let warm = base * vec3f(1.0, 0.935, 0.89);\n  return warm * v14d_state2_shadow_factor(mask);\n}\n\nfn v14d_skin_body_composite(base: vec3f) -> vec3f {\n  return base * vec3f(1.0, 0.945, 0.905);\n}\n\n\n\n`;\n";
const SLOTS_STATE2_DIST_REPLACEMENT = "const HAIR_OVER_EYES_DECL = `override IS_OVER_EYES: bool = false;\n\n`;\n// V14D State2 实时合成（Stage 2B-M1）：extra mask 纹理声明 + 合成 helper。\n// 常量来自权威 blend 取证（web/scripts/forensic-v14d-face-state2.py 输出 manifest）：\n//   warm=[1,0.935,0.89], shadowTint=[0.66,0.58,0.60], fringeTint=[0.70,0.64,0.69]。\n// mask 纹理为 rgba8unorm（非 sRGB 解码视图），采样即线性值；仅在编译 tags 含\n// \"v14d-state2-face\" 的 graph 时注入，默认关闭；Stage 2B-M3 起 body graph 也按 graph.name 注入。\nconst V14D_STATE2_MASK_DECL = `@group(2) @binding(5) var v14d_state2_mask: texture_2d<f32>;\n\n`;\n\nconst V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor(mask: vec3f) -> vec3f {\n  let inv_b = 1.0 - mask.b;\n  let art = mix(vec3f(1.0, 1.0, 1.0), vec3f(0.66, 0.58, 0.60), mask.r * inv_b);\n  let fringe = mix(vec3f(1.0, 1.0, 1.0), vec3f(0.70, 0.64, 0.69), mask.g * inv_b);\n  return art * fringe;\n}\n\nfn v14d_state2_composite(base: vec3f, mask: vec3f) -> vec3f {\n  let warm = base * vec3f(1.0, 0.935, 0.89);\n  return warm * v14d_state2_shadow_factor(mask);\n}\n\nfn v14d_skin_body_composite(base: vec3f) -> vec3f {\n  return base * vec3f(1.0, 0.945, 0.905);\n}\n\n\n\n`;\n";

// Stage 2C-M1 HairA/HairB V1：头发合成 helper 追加 target（独立于 slots 声明 target）。
// 常量来自权威 blend 取证（web/scripts/forensic-v14d-hair-state.py 输出 manifest，
// 证据 web/.scratch/v14d-hairab/hair-forensic.json）：PROTO_GF2_HairA/HairB 的
// BaseColor = c_KoledaSSR01_slg_hair_d.png（sRGB，2048x2048，hasData=true，Alpha 直连
// Principled.Alpha，blendMethod=HASHED、alphaThreshold=0.5，与引擎 hashed-alpha 裁切
// 口径一致）经 PROTO_HairTint（MIX_RGB MULTIPLY、Factor=1）得到唯一权威 tint。
// 视角相关部分（Anisotropic、Roughness/Specular
// MapRange 支路、ToonRamp 经 ShaderToRGB）按 A/B/C 分类为 C（不能烘焙/不固化视角
// 高光），本阶段只迁移 BaseColor 乘色。anchors 同时覆盖旧 helper 形态（无 hair
// helper）与已升级形态，doneMarker 只认最终形态，fresh/旧补丁/二次运行三态幂等收敛。
const SLOTS_ASSEMBLE_SRC_ANCHOR = "export function assembleModule(\n  renderClass: RenderClass,\n  alphaMode: AlphaMode,\n  fsBody: string,\n  includeStyleUniforms: boolean,\n): string {\n  return (\n    NODES_WGSL +\n    COMMON_MATERIAL_PRELUDE_WGSL +\n    (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n    decls(renderClass, alphaMode) +\n    prelude(renderClass, alphaMode) +\n    fsBody +\n    \"\\n\" +\n    epilogue(renderClass, alphaMode) +\n    \"}\\n\"\n  )\n}";
const SLOTS_ASSEMBLE_SRC_REPLACEMENT = "export function assembleModule(\n  renderClass: RenderClass,\n  alphaMode: AlphaMode,\n  fsBody: string,\n  includeStyleUniforms: boolean,\n  includeState2Mask = false,\n  includeV14dHairHelper = false,\n): string {\n  return (\n    NODES_WGSL +\n    COMMON_MATERIAL_PRELUDE_WGSL +\n    (includeState2Mask ? V14D_STATE2_MASK_DECL : \"\") +\n    (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n    decls(renderClass, alphaMode) +\n    (includeState2Mask ? V14D_STATE2_HELPERS_WGSL : \"\") +\n    (includeV14dHairHelper ? V14D_HAIR_HELPER_WGSL : \"\") +\n    prelude(renderClass, alphaMode) +\n    fsBody +\n    \"\\n\" +\n    epilogue(renderClass, alphaMode) +\n    \"}\\n\"\n  )\n}";
const SLOTS_ASSEMBLE_DIST_ANCHOR = "export function assembleModule(renderClass, alphaMode, fsBody, includeStyleUniforms) {\n    return (NODES_WGSL +\n        COMMON_MATERIAL_PRELUDE_WGSL +\n        (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n        decls(renderClass, alphaMode) +\n        prelude(renderClass, alphaMode) +\n        fsBody +\n        \"\\n\" +\n        epilogue(renderClass, alphaMode) +\n        \"}\\n\");\n}";

// Stage 2C-M1 旧已打形态（含 includeState2Mask、尚无 includeV14dHairHelper）：
// 作为升级 anchor，使已打 Stage 2B 补丁的环境能继续收敛到含 hair helper 的最终形态。
const SLOTS_ASSEMBLE_SRC_LEGACY_STATE2 = "export function assembleModule(\n  renderClass: RenderClass,\n  alphaMode: AlphaMode,\n  fsBody: string,\n  includeStyleUniforms: boolean,\n  includeState2Mask = false,\n): string {\n  return (\n    NODES_WGSL +\n    COMMON_MATERIAL_PRELUDE_WGSL +\n    (includeState2Mask ? V14D_STATE2_MASK_DECL : \"\") +\n    (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n    decls(renderClass, alphaMode) +\n    (includeState2Mask ? V14D_STATE2_HELPERS_WGSL : \"\") +\n    prelude(renderClass, alphaMode) +\n    fsBody +\n    \"\\n\" +\n    epilogue(renderClass, alphaMode) +\n    \"}\\n\"\n  )\n}";
const SLOTS_ASSEMBLE_DIST_LEGACY_STATE2 = "export function assembleModule(renderClass, alphaMode, fsBody, includeStyleUniforms, includeState2Mask = false) {\n    return (NODES_WGSL +\n        COMMON_MATERIAL_PRELUDE_WGSL +\n        (includeState2Mask ? V14D_STATE2_MASK_DECL : \"\") +\n        (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n        decls(renderClass, alphaMode) +\n        (includeState2Mask ? V14D_STATE2_HELPERS_WGSL : \"\") +\n        prelude(renderClass, alphaMode) +\n        fsBody +\n        \"\\n\" +\n        epilogue(renderClass, alphaMode) +\n        \"}\\n\");\n}";
const SLOTS_ASSEMBLE_DIST_REPLACEMENT = "export function assembleModule(renderClass, alphaMode, fsBody, includeStyleUniforms, includeState2Mask = false, includeV14dHairHelper = false) {\n    return (NODES_WGSL +\n        COMMON_MATERIAL_PRELUDE_WGSL +\n        (includeState2Mask ? V14D_STATE2_MASK_DECL : \"\") +\n        (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n        decls(renderClass, alphaMode) +\n        (includeState2Mask ? V14D_STATE2_HELPERS_WGSL : \"\") +\n        (includeV14dHairHelper ? V14D_HAIR_HELPER_WGSL : \"\") +\n        prelude(renderClass, alphaMode) +\n        fsBody +\n        \"\\n\" +\n        epilogue(renderClass, alphaMode) +\n        \"}\\n\");\n}";
const COMPILE_ASSEMBLE_SRC_ANCHOR = "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current)";
const COMPILE_ASSEMBLE_SRC_REPLACEMENT = "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false)";
const COMPILE_ASSEMBLE_DIST_ANCHOR = "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current);";
const COMPILE_ASSEMBLE_DIST_REPLACEMENT = "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false);";

// 断点 A：以 graph.name 精确覆写编译器生成的 final_color 行。函数使用真实换行
// 拆分，并保留 node 注释；非 State2 graph 原样返回。src/dist 的表达式保持同构。
const STATE2_OVERRIDE_SRC = [
  "// V14D_STATE2_OVERRIDE_FIX_BEGIN",
  "export function v14dState2OverrideFsBodyFixed(graphName: string, fsBody: string, hairTint?: readonly number[]): string {",
  "  const isFaceLive = graphName === \"V14D Face State2 Live ShadowFactor\" || graphName === \"V14D Face State2 Live Composite\"",
  "  const isBodySkin = graphName === \"V14D Body Skin Composite\"",
  "  const isHairV1 = graphName === \"V14D Hair V1 Composite\"",
  "  if (!isFaceLive && !isBodySkin && !isHairV1) return fsBody",
  "  const lines = fsBody.split(\"\\n\")",
  "  const finalIndex = lines.findIndex((line) => /\\blet final_color\\s*=/.test(line))",
  "  if (finalIndex < 0) return fsBody",
  "  const tag = lines[finalIndex].match(/\\s+(\\/\\/.*)$/)?.[1] ?? \"\"",
  "  const mask = \"textureSample(v14d_state2_mask, diffuseSampler, input.uv).rgb\"",
  "  const defaultHairTint: readonly number[] = " + V14D_HAIR_TINT_LITERAL,
  "  const hairTintVec = \"vec3f(\" + (hairTint?.[0] ?? defaultHairTint[0]) + \", \" + (hairTint?.[1] ?? defaultHairTint[1]) + \", \" + (hairTint?.[2] ?? defaultHairTint[2]) + \")\"",
  "  const expr = isHairV1 ? \"v14d_hair_composite(tex_color, \" + hairTintVec + \")\" : isBodySkin ? \"v14d_skin_body_composite(tex_color)\" : (graphName === \"V14D Face State2 Live ShadowFactor\" ? \"v14d_state2_shadow_factor(\" + mask + \")\" : \"v14d_state2_composite(tex_color, \" + mask + \")\")",
  "  lines[finalIndex] = \"  let final_color = \" + expr + \";\" + tag",
  "  return lines.join(\"\\n\")",
  "}",
  "// V14D_STATE2_OVERRIDE_FIX_END",
].join("\n");
const STATE2_OVERRIDE_DIST = [
  "// V14D_STATE2_OVERRIDE_FIX_BEGIN",
  "export function v14dState2OverrideFsBodyFixed(graphName, fsBody, hairTint) {",
  "    const isFaceLive = graphName === \"V14D Face State2 Live ShadowFactor\" || graphName === \"V14D Face State2 Live Composite\";",
  "    const isBodySkin = graphName === \"V14D Body Skin Composite\";",
  "    const isHairV1 = graphName === \"V14D Hair V1 Composite\";",
  "    if (!isFaceLive && !isBodySkin && !isHairV1) return fsBody;",
  "    const lines = fsBody.split(String.fromCharCode(10));",
  "    const finalIndex = lines.findIndex((line) => /\\blet final_color\\s*=/.test(line));",
  "    if (finalIndex < 0) return fsBody;",
  "    const tag = lines[finalIndex].match(/\\s+(\\/\\/.*)$/)?.[1] ?? \"\";",
  "    const mask = \"textureSample(v14d_state2_mask, diffuseSampler, input.uv).rgb\";",
  "    const defaultHairTint = " + V14D_HAIR_TINT_LITERAL + ";",
  "    const hairTintVec = \"vec3f(\" + (hairTint?.[0] ?? defaultHairTint[0]) + \", \" + (hairTint?.[1] ?? defaultHairTint[1]) + \", \" + (hairTint?.[2] ?? defaultHairTint[2]) + \")\";",
  "    const expr = isHairV1 ? \"v14d_hair_composite(tex_color, \" + hairTintVec + \")\" : isBodySkin ? \"v14d_skin_body_composite(tex_color)\" : (graphName === \"V14D Face State2 Live ShadowFactor\" ? \"v14d_state2_shadow_factor(\" + mask + \")\" : \"v14d_state2_composite(tex_color, \" + mask + \")\");",
  "    lines[finalIndex] = \"  let final_color = \" + expr + \";\" + tag;",
  "    return lines.join(String.fromCharCode(10));",
  "}",
  "// V14D_STATE2_OVERRIDE_FIX_END",
].join("\n");
const HASHED_ALPHA_ANCHOR = "const HASHED_ALPHA_DECLS = " + String.fromCharCode(96);

// compile/assembleModule 的同一调用行必须由一个 manifest target 一次性收敛，
// 同时完成 A 的 fsBody 覆写接线与 State2 tag 门控，避免多个 replace 依赖先后顺序。
const COMPILE_STATE2_IMPORT_SRC_ANCHOR = "import { assembleModule } from \"./slots\"\n";
const COMPILE_STATE2_IMPORT_SRC_REPLACEMENT = "import { assembleModule, v14dState2OverrideFsBodyFixed } from \"./slots\"\n";
const COMPILE_STATE2_IMPORT_DIST_ANCHOR = "import { assembleModule } from \"./slots\";\n";
const COMPILE_STATE2_IMPORT_DIST_REPLACEMENT = "import { assembleModule, v14dState2OverrideFsBodyFixed } from \"./slots\";\n";
const COMPILE_STATE2_SRC_FRESH_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current)",
].join("\n");
const COMPILE_STATE2_SRC_STATE2_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false)",
].join("\n");
const COMPILE_STATE2_SRC_A_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody)",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current)",
].join("\n");
const COMPILE_STATE2_SRC_A_STATE2_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody)",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false)",
].join("\n");
// Stage 2C-M2a：Brows/Lashes V1 graph 名（compile/slots 覆写与幂等 anchor 共用）。
const BROWS_LASHES_GRAPH_NAME = "V14D Brows Lashes V1 Composite";
const COMPILE_STATE2_SRC_FINAL = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\")?.inputs?.color as number[] | undefined) ?? " + V14D_HAIR_TINT_LITERAL,
  "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint)",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, (graph.tags?.includes(\"v14d-state2-face\") ?? false) || graph.name === \"V14D Body Skin Composite\", graph.name === \"V14D Hair V1 Composite\")"
].join("\n");
const COMPILE_STATE2_DIST_FRESH_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current);",
].join("\n");
const COMPILE_STATE2_DIST_STATE2_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false);",
].join("\n");
const COMPILE_STATE2_DIST_A_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody);",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current);",
].join("\n");
const COMPILE_STATE2_DIST_A_STATE2_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody);",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false);",
].join("\n");
const COMPILE_STATE2_DIST_FINAL = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\")?.inputs?.color) ?? " + V14D_HAIR_TINT_LITERAL + ";",
  "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint);",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, (graph.tags?.includes(\"v14d-state2-face\") ?? false) || graph.name === \"V14D Body Skin Composite\", graph.name === \"V14D Hair V1 Composite\");"
].join("\n");

// Stage 2C-M1 升级形态 anchor：compile 的 assemble 调用行已是「fsBodyLive + 5 参
// （含 BodySkin 门控）」但尚未带第 6 参 hair helper 门控。列入 anchors 使已打
// Stage 2B/2C 前半的环境能继续收敛到最终 6 参形态。
// Stage 2C-M1 升级形态 anchor（SRC 侧）：compile 调用行已是「fsBodyLive + 5 参
// （含 BodySkin 门控）」但尚未带第 6 参 hair helper 门控。
const COMPILE_STATE2_SRC_HAIR_UPGRADE_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody)",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, (graph.tags?.includes(\"v14d-state2-face\") ?? false) || graph.name === \"V14D Body Skin Composite\")"
].join("\n");
// Stage 2C-M1 修正轮 anchor：当前已打补丁的 compile 调用行（fsBodyLive 两参形态）。
// 升级目标把它推进为「先取 hairTint、再三参覆写」的最终形态。
const COMPILE_STATE2_SRC_TINT_UPGRADE_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody)",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, (graph.tags?.includes(\"v14d-state2-face\") ?? false) || graph.name === \"V14D Body Skin Composite\", graph.name === \"V14D Hair V1 Composite\")"
].join("\n");
// Stage 2C-M2a anchor：compile 已打 Brows/Lashes（tint 读取扩展 + helper 门控含
// Brows/Lashes），FINAL target 幂等命中此形态（不再重复替换）。
const COMPILE_STATE2_SRC_BROWS_LASHES_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\" || n.id === \"v14d_brows_lashes_tint\")?.inputs?.color as number[] | undefined) ?? " + V14D_HAIR_TINT_LITERAL,
  "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint)",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, (graph.tags?.includes(\"v14d-state2-face\") ?? false) || graph.name === \"V14D Body Skin Composite\", graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\")"
].join("\n");
const COMPILE_STATE2_DIST_TINT_UPGRADE_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody);",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, (graph.tags?.includes(\"v14d-state2-face\") ?? false) || graph.name === \"V14D Body Skin Composite\", graph.name === \"V14D Hair V1 Composite\");"
].join("\n");
const COMPILE_STATE2_DIST_HAIR_UPGRADE_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody);",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, (graph.tags?.includes(\"v14d-state2-face\") ?? false) || graph.name === \"V14D Body Skin Composite\");"
].join("\n");
// Stage 2C-M2a anchor（DIST 侧）：compile 已打 Brows/Lashes。
const COMPILE_STATE2_DIST_BROWS_LASHES_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\" || n.id === \"v14d_brows_lashes_tint\")?.inputs?.color) ?? " + V14D_HAIR_TINT_LITERAL + ";",
  "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint);",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, (graph.tags?.includes(\"v14d-state2-face\") ?? false) || graph.name === \"V14D Body Skin Composite\", graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\");"
].join("\n");

const BASE_BIND_ENTRIES_SRC_ANCHOR = [
  "      const baseBindGroupEntries: GPUBindGroupEntry[] = [",
  "        { binding: 0, resource: textureView },",
  "        { binding: 1, resource: { buffer: materialUniformBuffer } },",
  "        { binding: 2, resource: (toonTexture ?? this.fallbackMaterialTexture).createView() },",
  "        { binding: 3, resource: (sphereTexture ?? this.fallbackMaterialTexture).createView() },",
  "      ]",
].join("\n");
const BASE_BIND_ENTRIES_SRC_REPLACEMENT = [
  "      const __binding5View = __auxMaskView ?? this.fallbackMaterialTexture.createView()",
  "      const baseBindGroupEntries: GPUBindGroupEntry[] = [",
  "        { binding: 0, resource: textureView },",
  "        { binding: 1, resource: { buffer: materialUniformBuffer } },",
  "        { binding: 2, resource: (toonTexture ?? this.fallbackMaterialTexture).createView() },",
  "        { binding: 3, resource: (sphereTexture ?? this.fallbackMaterialTexture).createView() },",
  "        { binding: 5, resource: __binding5View },",
  "      ]",
].join("\n");
const BASE_BIND_ENTRIES_DIST_ANCHOR = [
  "            const baseBindGroupEntries = [",
  "                { binding: 0, resource: textureView },",
  "                { binding: 1, resource: { buffer: materialUniformBuffer } },",
  "                { binding: 2, resource: (toonTexture ?? this.fallbackMaterialTexture).createView() },",
  "                { binding: 3, resource: (sphereTexture ?? this.fallbackMaterialTexture).createView() },",
  "            ];",
].join("\n");
const BASE_BIND_ENTRIES_DIST_REPLACEMENT = [
  "            const __binding5View = __auxMaskView ?? this.fallbackMaterialTexture.createView();",
  "            const baseBindGroupEntries = [",
  "                { binding: 0, resource: textureView },",
  "                { binding: 1, resource: { buffer: materialUniformBuffer } },",
  "                { binding: 2, resource: (toonTexture ?? this.fallbackMaterialTexture).createView() },",
  "                { binding: 3, resource: (sphereTexture ?? this.fallbackMaterialTexture).createView() },",
  "                { binding: 5, resource: __binding5View },",
  "            ];",
].join("\n");

const ASSIGN_GROUP_SRC_ANCHOR = [
  "      dc.bindGroup = this.createMaterialBindGroup(",
  "        " + String.fromCharCode(96) + "material: \${dc.materialName}" + String.fromCharCode(96) + ",",
  "        dc.baseBindGroupEntries,",
  "        install ? install.uniformBuffer : this.zeroStyleBuffer,",
  "      )",
].join("\n");
const ASSIGN_GROUP_SRC_REPLACEMENT = [
  "      dc.bindGroup = this.createMaterialBindGroup(",
  "        " + String.fromCharCode(96) + "material: \${dc.materialName}" + String.fromCharCode(96) + ",",
  "        [...dc.baseBindGroupEntries],",
  "        install ? install.uniformBuffer : this.zeroStyleBuffer,",
  "      )",
].join("\n");
const ASSIGN_GROUP_DIST_ANCHOR =
  "            dc.bindGroup = this.createMaterialBindGroup(" + String.fromCharCode(96) + "material: \${dc.materialName}" + String.fromCharCode(96) + ", dc.baseBindGroupEntries, install ? install.uniformBuffer : this.zeroStyleBuffer);";
const ASSIGN_GROUP_DIST_REPLACEMENT =
  "            dc.bindGroup = this.createMaterialBindGroup(" + String.fromCharCode(96) + "material: \${dc.materialName}" + String.fromCharCode(96) + ", [...dc.baseBindGroupEntries], install ? install.uniformBuffer : this.zeroStyleBuffer);";

const state2CompletenessTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: HASHED_ALPHA_ANCHOR,
    replacement: STATE2_OVERRIDE_SRC + "\n" + HASHED_ALPHA_ANCHOR,
    doneMarker: "export function v14dState2OverrideFsBodyFixed(graphName: string, fsBody: string, hairTint?: readonly number[]): string",
    label: "src/graph/slots.ts state2 override 修正函数",
  },
  // Stage 2C-M1：override 函数体内新增 isHairV1 分支。旧形态（无 hair 分支）与
  // 新形态（已含 hair 分支）都作为 anchors，任一命中都收敛到最终函数体；
  // doneMarker 只认最终形态（isHairV1 声明行），fresh/旧补丁/二次运行三态幂等。
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchors: [
      "  if (!isFaceLive && !isBodySkin) return fsBody",
      "  const isHairV1 = graphName === \"V14D Hair V1 Composite\"",
    ],
    replacement: "  const isHairV1 = graphName === \"V14D Hair V1 Composite\"\n  if (!isFaceLive && !isBodySkin && !isHairV1) return fsBody",
    doneMarker: "  const isHairV1 = graphName === \"V14D Hair V1 Composite\"",
    label: "src/graph/slots.ts hair override 分支（guard）",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchors: [
      "  const expr = isBodySkin ? \"v14d_skin_body_composite(tex_color)\"",
      "  const expr = isHairV1 ? \"v14d_hair_composite(tex_color)\"",
      "  const expr = isHairV1 ? \"v14d_hair_composite(tex_color, \" + hairTintVec + \")\"",
    ],
    replacement: "  const expr = isHairV1 ? \"v14d_hair_composite(tex_color, \" + hairTintVec + \")\" : isBodySkin ? \"v14d_skin_body_composite(tex_color)\"",
    doneMarker: "  const expr = isHairV1 ? \"v14d_hair_composite(tex_color, \" + hairTintVec + \")\"",
    label: "src/graph/slots.ts hair override 分支（expr）",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: HASHED_ALPHA_ANCHOR,
    replacement: STATE2_OVERRIDE_DIST + "\n" + HASHED_ALPHA_ANCHOR,
    doneMarker: "export function v14dState2OverrideFsBodyFixed(graphName, fsBody, hairTint)",
    label: "dist/graph/slots.js state2 override 修正函数",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchors: [
      "    if (!isFaceLive && !isBodySkin) return fsBody;",
      "    const isHairV1 = graphName === \"V14D Hair V1 Composite\";",
      "    const isHairV1 = graphName === \"V14D Hair V1 Composite\" || graphName === \"" + BROWS_LASHES_GRAPH_NAME + "\";",
    ],
    replacement: "    const isHairV1 = graphName === \"V14D Hair V1 Composite\";\n    if (!isFaceLive && !isBodySkin && !isHairV1) return fsBody;",
    // Stage 2C-M2a：hair-only 与 Brows/Lashes 已打形态都视为收敛终态，避免与
    // brows-lashes guard target 互相回退改写（二次运行幂等）。
    isDone: (content) => content.includes("    const isHairV1 = graphName === \"V14D Hair V1 Composite\";\n    if (!isFaceLive && !isBodySkin && !isHairV1) return fsBody;") || content.includes("graphName === \"" + BROWS_LASHES_GRAPH_NAME + "\";"),
    label: "dist/graph/slots.js hair override 分支（guard）",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchors: [
      "    const expr = isBodySkin ? \"v14d_skin_body_composite(tex_color)\"",
      "    const expr = isHairV1 ? \"v14d_hair_composite(tex_color)\"",
      "    const expr = isHairV1 ? \"v14d_hair_composite(tex_color, \" + hairTintVec + \")\"",
    ],
    replacement: "    const expr = isHairV1 ? \"v14d_hair_composite(tex_color, \" + hairTintVec + \")\" : isBodySkin ? \"v14d_skin_body_composite(tex_color)\"",
    doneMarker: "    const expr = isHairV1 ? \"v14d_hair_composite(tex_color, \" + hairTintVec + \")\"",
    label: "dist/graph/slots.js hair override 分支（expr）",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts"),
    anchor: COMPILE_STATE2_IMPORT_SRC_ANCHOR,
    replacement: COMPILE_STATE2_IMPORT_SRC_REPLACEMENT,
    doneMarker: "import { assembleModule, v14dState2OverrideFsBodyFixed } from \"./slots\"",
    label: "src/graph/compile.ts state2 override import 接线",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js"),
    anchor: COMPILE_STATE2_IMPORT_DIST_ANCHOR,
    replacement: COMPILE_STATE2_IMPORT_DIST_REPLACEMENT,
    doneMarker: "import { assembleModule, v14dState2OverrideFsBodyFixed } from \"./slots\"",
    label: "dist/graph/compile.js state2 override import 接线",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts"),
    anchors: [COMPILE_STATE2_SRC_FRESH_ANCHOR, COMPILE_STATE2_SRC_STATE2_ANCHOR, COMPILE_STATE2_SRC_A_ANCHOR, COMPILE_STATE2_SRC_A_STATE2_ANCHOR, COMPILE_STATE2_SRC_HAIR_UPGRADE_ANCHOR, COMPILE_STATE2_SRC_TINT_UPGRADE_ANCHOR, COMPILE_STATE2_SRC_BROWS_LASHES_ANCHOR],
    replacement: COMPILE_STATE2_SRC_FINAL,
    // Stage 2C-M2a：FINAL（仅 hair）与 Brows/Lashes 已打形态都视为收敛终态，
    // 避免 FINAL 把 Brows/Lashes 文本替换回去又被 brows-lashes target 二次改写的循环。
    // Stage 2C-M2a 修正轮：alphaFault compile target 已打时该行结尾变为
    // 「...Composite\", (graph.tags?.includes(\"v14d-wrong-alpha-fault\")...)』，也视为收敛终态。
    isDone: (content) => content.includes(COMPILE_STATE2_SRC_FINAL) || content.includes(COMPILE_STATE2_SRC_BROWS_LASHES_ANCHOR) || content.includes('graph.tags?.includes("v14d-wrong-alpha-fault")'),
    label: "src/graph/compile.ts state2 override + tag 门控接线",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js"),
    anchors: [COMPILE_STATE2_DIST_FRESH_ANCHOR, COMPILE_STATE2_DIST_STATE2_ANCHOR, COMPILE_STATE2_DIST_A_ANCHOR, COMPILE_STATE2_DIST_A_STATE2_ANCHOR, COMPILE_STATE2_DIST_HAIR_UPGRADE_ANCHOR, COMPILE_STATE2_DIST_TINT_UPGRADE_ANCHOR, COMPILE_STATE2_DIST_BROWS_LASHES_ANCHOR],
    replacement: COMPILE_STATE2_DIST_FINAL,
    isDone: (content) => content.includes(COMPILE_STATE2_DIST_FINAL) || content.includes(COMPILE_STATE2_DIST_BROWS_LASHES_ANCHOR) || content.includes('graph.tags?.includes("v14d-wrong-alpha-fault")'),
    label: "dist/graph/compile.js state2 override + tag 门控接线",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: BASE_BIND_ENTRIES_SRC_ANCHOR,
    replacement: BASE_BIND_ENTRIES_SRC_REPLACEMENT,
    doneMarker: "binding: 5, resource: __binding5View",
    label: "src/engine.ts binding5 baseEntries",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: BASE_BIND_ENTRIES_DIST_ANCHOR,
    replacement: BASE_BIND_ENTRIES_DIST_REPLACEMENT,
    doneMarker: "binding: 5, resource: __binding5View",
    label: "dist/engine.js binding5 baseEntries",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: ASSIGN_GROUP_SRC_ANCHOR,
    replacement: ASSIGN_GROUP_SRC_REPLACEMENT,
    doneMarker: "...dc.baseBindGroupEntries",
    label: "src/engine.ts assignDrawCallGroups 展开 baseEntries",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: ASSIGN_GROUP_DIST_ANCHOR,
    replacement: ASSIGN_GROUP_DIST_REPLACEMENT,
    doneMarker: "...dc.baseBindGroupEntries",
    label: "dist/engine.js assignDrawCallGroups 展开 baseEntries",
  },
];

// ─── Stage 2C-M2a：Brows/Lashes V1 覆写接线 ───
// 权威取证（forensic-v14d-brows-lashes.py → brows-lashes-forensic.json）确认
// Brows/Lashes BaseColor 与 Alpha 直连 face_d 纹理、无额外乘色节点，V1 语义目标 =
// 原色通过 + 独立分组绑定。复用 v14d_hair_composite helper（乘法 tint），以恒等
// tint [1,1,1] 实现「原样通过」；负测 wrongBrowsLashesTint 真实改色。
// 扩展三处幂等收敛：override guard/expr 识别新 graph、compile 门控注入 helper 并传 tint。
const browsLashesOverrideTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchors: [
      "  const isHairV1 = graphName === \"V14D Hair V1 Composite\"",
      "  const isHairV1 = graphName === \"V14D Hair V1 Composite\" || graphName === \"" + BROWS_LASHES_GRAPH_NAME + "\"",
    ],
    replacement: "  const isHairV1 = graphName === \"V14D Hair V1 Composite\" || graphName === \"" + BROWS_LASHES_GRAPH_NAME + "\"",
    doneMarker: "  const isHairV1 = graphName === \"V14D Hair V1 Composite\" || graphName === \"" + BROWS_LASHES_GRAPH_NAME + "\"",
    label: "src/graph/slots.ts brows-lashes override guard",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchors: [
      "    const isHairV1 = graphName === \"V14D Hair V1 Composite\";",
      "    const isHairV1 = graphName === \"V14D Hair V1 Composite\" || graphName === \"" + BROWS_LASHES_GRAPH_NAME + "\";",
    ],
    replacement: "    const isHairV1 = graphName === \"V14D Hair V1 Composite\" || graphName === \"" + BROWS_LASHES_GRAPH_NAME + "\";",
    doneMarker: "    const isHairV1 = graphName === \"V14D Hair V1 Composite\" || graphName === \"" + BROWS_LASHES_GRAPH_NAME + "\";",
    label: "dist/graph/slots.js brows-lashes override guard",
  },
];

// compile 侧 target 单独成组：必须在 state2CompletenessTargets 内的 compile FINAL
// target 收敛到最终形态之后再扩展（FINAL 的 anchors 不含 Brows/Lashes 文本）。
const browsLashesCompileTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts"),
    anchors: [
      "  const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\")?.inputs?.color as number[] | undefined) ?? " + V14D_HAIR_TINT_LITERAL,
      "  const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\" || n.id === \"v14d_brows_lashes_tint\")?.inputs?.color as number[] | undefined) ?? " + V14D_HAIR_TINT_LITERAL,
    ],
    replacement: "  const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\" || n.id === \"v14d_brows_lashes_tint\")?.inputs?.color as number[] | undefined) ?? " + V14D_HAIR_TINT_LITERAL,
    doneMarker: "n.id === \"v14d_hair_tint\" || n.id === \"v14d_brows_lashes_tint\"",
    label: "src/graph/compile.ts brows-lashes tint 读取",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js"),
    anchors: [
      "    const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\")?.inputs?.color) ?? " + V14D_HAIR_TINT_LITERAL + ";",
      "    const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\" || n.id === \"v14d_brows_lashes_tint\")?.inputs?.color) ?? " + V14D_HAIR_TINT_LITERAL + ";",
    ],
    replacement: "    const hairTint = (graph.nodes?.find((n) => n.id === \"v14d_hair_tint\" || n.id === \"v14d_brows_lashes_tint\")?.inputs?.color) ?? " + V14D_HAIR_TINT_LITERAL + ";",
    doneMarker: "n.id === \"v14d_hair_tint\" || n.id === \"v14d_brows_lashes_tint\"",
    label: "dist/graph/compile.js brows-lashes tint 读取",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts"),
    anchors: [
      "graph.name === \"V14D Hair V1 Composite\")",
      "graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\")",
    ],
    replacement: "graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\")",
    // Stage 2C-M2a 修正轮：alphaFault compile target 在本 target 之后把该行结尾
    // 「...Composite\")」改为「...Composite\", (graph.tags...』；幂等需认两种形态。
    isDone: (content) => content.includes("graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\")") || content.includes("graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\","),
    label: "src/graph/compile.ts brows-lashes helper 注入门控",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js"),
    anchors: [
      "graph.name === \"V14D Hair V1 Composite\");",
      "graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\");",
    ],
    replacement: "graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\");",
    isDone: (content) => content.includes("graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\");") || content.includes("graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\","),
    label: "dist/graph/compile.js brows-lashes helper 注入门控",
  },
];

// ─── Stage 2C-M2a 修正轮：wrongAlpha 验收故障注入 seam（方案A，仅专用 fault tag 可达）───
// compile.ts 仅在 graph.tags 含专用 fault tag（与 v14dAuthority.js 的
// V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_TAG 同字面量）时给 assembleModule/prelude 传
// v14dAlphaFault=true；prelude 的 alpha 行由 let 改为 var 并乘固定故障因子
// V14D_BROWS_LASHES_WRONG_ALPHA_FAULT_FACTOR（权威导出，当前 1e-7）
// （在 hashed discard 之前），1e-7 < hashed clamp 下限 1e-6 → 真实剔除边缘片元，
// 画布边界环颜色分布改变。正常 graph 无该 tag → let alpha 原字节语义不变；stockings
// 等其它 hashed 材质不受影响。该 tag 只由 ?v14dAcceptanceProbe=1 的
// applyBadSkinGraph("wrongBrowsLashesAlpha") 创建/安装；UI/普通 V1/默认入口不可达。
const ALPHA_FAULT_TAG = "v14d-wrong-alpha-fault";
// prelude 签名替换（含 BEGIN/END 包裹注释，与手动 node_modules 形态逐字节一致）。
const ALPHA_FAULT_PRELUDE_SRC = "// V14D_ALPHA_FAULT_BEGIN\nfunction prelude(renderClass: RenderClass, alphaMode: AlphaMode, v14dAlphaFault = false): string {\n// V14D_ALPHA_FAULT_END";
const ALPHA_FAULT_PRELUDE_DIST = "// V14D_ALPHA_FAULT_BEGIN\nfunction prelude(renderClass, alphaMode, v14dAlphaFault = false) {\n// V14D_ALPHA_FAULT_END";
// prelude 函数体 alphaDecl 声明块（插在 const gate 行之前，模板字符串外）。
const ALPHA_FAULT_DECL_BLOCK_SRC = "  // V14D_ALPHA_FAULT_ALPHA_DECL_BEGIN\n  const alphaDecl = v14dAlphaFault\n    ? \"  var alpha = material.alpha * tex_s.a * " + V14D_WRONG_ALPHA_FAULT_FACTOR_LITERAL + "; // V14D wrongAlpha fault: pre-discard factor\"\n    : \"  let alpha = material.alpha * tex_s.a;\"\n  // V14D_ALPHA_FAULT_ALPHA_DECL_END\n";
const ALPHA_FAULT_DECL_BLOCK_DIST = "    // V14D_ALPHA_FAULT_ALPHA_DECL_BEGIN\n    const alphaDecl = v14dAlphaFault\n        ? \"  var alpha = material.alpha * tex_s.a * " + V14D_WRONG_ALPHA_FAULT_FACTOR_LITERAL + "; // V14D wrongAlpha fault: pre-discard factor\"\n        : \"  let alpha = material.alpha * tex_s.a;\";\n    // V14D_ALPHA_FAULT_ALPHA_DECL_END\n";
const alphaFaultTargets = [
  // prelude 签名（src / dist）。
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: "function prelude(renderClass: RenderClass, alphaMode: AlphaMode): string {",
    replacement: ALPHA_FAULT_PRELUDE_SRC,
    // doneMarker 只认签名行（手动/已打形态在 BEGIN 与签名行间可能含额外注释块）。
    doneMarker: "function prelude(renderClass: RenderClass, alphaMode: AlphaMode, v14dAlphaFault = false): string {",
    label: "src/graph/slots.ts prelude alphaFault 签名",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: "function prelude(renderClass, alphaMode) {",
    replacement: ALPHA_FAULT_PRELUDE_DIST,
    doneMarker: ALPHA_FAULT_PRELUDE_DIST,
    label: "dist/graph/slots.js prelude alphaFault 签名",
  },
  // prelude 函数体 alphaDecl 声明块（src / dist）：插在 const gate 行之前。
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: '  const gate = renderClass === "eye" ? EYE_REAR_GATE : ""',
    replacement: ALPHA_FAULT_DECL_BLOCK_SRC + '  const gate = renderClass === "eye" ? EYE_REAR_GATE : ""',
    doneMarker: "V14D_ALPHA_FAULT_ALPHA_DECL_BEGIN",
    label: "src/graph/slots.ts prelude alphaFault alphaDecl 声明块",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: '    const gate = renderClass === "eye" ? EYE_REAR_GATE : "";',
    replacement: ALPHA_FAULT_DECL_BLOCK_DIST + '    const gate = renderClass === "eye" ? EYE_REAR_GATE : "";',
    doneMarker: "V14D_ALPHA_FAULT_ALPHA_DECL_BEGIN",
    label: "dist/graph/slots.js prelude alphaFault alphaDecl 声明块",
  },
  // prelude 模板内 alpha 行（src / dist）：固定 let 行 → 模板占位 alphaDecl。
  // 锚必须带紧随的 discard 占位行上下文（WGSL 模板内特有），否则会撞车匹配到
  // 上面 alphaDecl 声明块 false 分支字符串里的同一 let 文本（声明块 target 先注入）。
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
   anchor: "  let alpha = material.alpha * tex_s.a;\n${discard}",
   replacement: "${alphaDecl}\n${discard}",
   doneMarker: "${alphaDecl}\n${discard}",
   label: "src/graph/slots.ts prelude 模板 alpha 行换 alphaDecl",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
   anchor: "  let alpha = material.alpha * tex_s.a;\n${discard}",
   replacement: "${alphaDecl}\n${discard}",
   doneMarker: "${alphaDecl}\n${discard}",
   label: "dist/graph/slots.js prelude 模板 alpha 行换 alphaDecl",
  },
  // assembleModule 签名（src / dist）。
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: "  includeV14dHairHelper = false,\n): string {",
    replacement: "  includeV14dHairHelper = false,\n  v14dAlphaFault = false,\n): string {",
    doneMarker: "  includeV14dHairHelper = false,\n  v14dAlphaFault = false,\n): string {",
    label: "src/graph/slots.ts assembleModule alphaFault 参数",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: "includeV14dHairHelper = false) {",
    replacement: "includeV14dHairHelper = false, v14dAlphaFault = false) {",
    doneMarker: "includeV14dHairHelper = false, v14dAlphaFault = false) {",
    label: "dist/graph/slots.js assembleModule alphaFault 参数",
  },
  // assembleModule prelude 调用传 fault（src / dist）。
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: "    prelude(renderClass, alphaMode) +",
    replacement: "    prelude(renderClass, alphaMode, v14dAlphaFault) +",
    doneMarker: "    prelude(renderClass, alphaMode, v14dAlphaFault) +",
    label: "src/graph/slots.ts assembleModule prelude 传 fault",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: "        prelude(renderClass, alphaMode) +",
    replacement: "        prelude(renderClass, alphaMode, v14dAlphaFault) +",
    doneMarker: "        prelude(renderClass, alphaMode, v14dAlphaFault) +",
    label: "dist/graph/slots.js assembleModule prelude 传 fault",
  },
  // compile.ts / compile.js：graph.tags 含 fault tag → 传 v14dAlphaFault=true。
  // (a) 在「const fsBodyLive = v14dState2OverrideFsBodyFixed(...)」行后插入 const
  //     v14dAlphaFault 行（与手动 node_modules 形态逐字节一致）。
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts"),
    anchor: "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint)",
    replacement: "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint)\n  // V14D_ALPHA_FAULT_COMPILE_BEGIN\n  const v14dAlphaFault = (graph.tags?.includes(\"" + ALPHA_FAULT_TAG + "\") ?? false)\n  // V14D_ALPHA_FAULT_COMPILE_END",
    doneMarker: "V14D_ALPHA_FAULT_COMPILE_BEGIN",
    label: "src/graph/compile.ts alphaFault const 行",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js"),
    anchor: "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint);",
    replacement: "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody, hairTint);\n    // V14D_ALPHA_FAULT_COMPILE_BEGIN\n    const v14dAlphaFault = (graph.tags?.includes(\"" + ALPHA_FAULT_TAG + "\") ?? false);\n    // V14D_ALPHA_FAULT_COMPILE_END",
    doneMarker: "V14D_ALPHA_FAULT_COMPILE_BEGIN",
    label: "dist/graph/compile.js alphaFault const 行",
  },
  // (b) assembleModule 调用行追加 v14dAlphaFault 参数（与手动形态一致：变量引用）。
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts"),
    anchor: "graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\")",
    replacement: "graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\", v14dAlphaFault)",
    doneMarker: "graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\", v14dAlphaFault)",
    label: "src/graph/compile.ts alphaFault tag 门控",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js"),
    anchor: "graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\");",
    replacement: "graph.name === \"V14D Hair V1 Composite\" || graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\", v14dAlphaFault);",
    doneMarker: "graph.name === \"" + BROWS_LASHES_GRAPH_NAME + "\", v14dAlphaFault);",
    label: "dist/graph/compile.js alphaFault tag 门控",
  },
];
const state2SlotTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: SLOTS_STATE2_ANCHOR,
    replacement: SLOTS_STATE2_REPLACEMENT,
    doneMarker: "const V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor",
    label: "src/graph/slots.ts state2 helper 声明",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: SLOTS_STATE2_DIST_ANCHOR,
    replacement: SLOTS_STATE2_DIST_REPLACEMENT,
    doneMarker: "const V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor",
    label: "dist/graph/slots.js state2 helper 声明",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchors: [SLOTS_ASSEMBLE_SRC_ANCHOR, SLOTS_ASSEMBLE_SRC_LEGACY_STATE2],
    replacement: SLOTS_ASSEMBLE_SRC_REPLACEMENT,
    doneMarker: "includeV14dHairHelper",
    label: "src/graph/slots.ts assembleModule state2 门控",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchors: [SLOTS_ASSEMBLE_DIST_ANCHOR, SLOTS_ASSEMBLE_DIST_LEGACY_STATE2],
    replacement: SLOTS_ASSEMBLE_DIST_REPLACEMENT,
    doneMarker: "includeV14dHairHelper",
    label: "dist/graph/slots.js assembleModule state2 门控",
  },
  // Stage 2C-M1：hair helper 作为独立 WGSL 常量声明（不并入 V14D_STATE2_HELPERS_WGSL）。
  // 这样 assembleModule 可用 includeV14dHairHelper 单独注入 hair helper，不连带
  // State2 mask 声明（binding 5），hair graph 无需 mask 即可编译通过。常量声明
  // 紧随 state2 helper 声明 target 注入的 V14D_STATE2_HELPERS_WGSL 模板之后
  // （anchor 取模板闭合行 + 紧随其后的注释，幂等：doneMarker 只认常量存在）。
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: "const V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor",
    replacement: V14D_HAIR_HELPER_DECL_SRC + "const V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor",
    doneMarker: "const V14D_HAIR_HELPER_WGSL = ",
    label: "src/graph/slots.ts hair helper 常量声明",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: "const V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor",
    replacement: V14D_HAIR_HELPER_DECL_DIST + "const V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor",
    doneMarker: "const V14D_HAIR_HELPER_WGSL = ",
    label: "dist/graph/slots.js hair helper 常量声明",
  },
];
state2Targets.push(...state2CompletenessTargets, ...state2SlotTargets);
// Stage 2C-M2a：Brows/Lashes override 在 hair 之后收敛（同一 isHairV1 行的二次扩展）。
state2Targets.push(...browsLashesOverrideTargets);
// compile 侧在 compile FINAL 之后再扩展（FINAL anchors 不含 Brows/Lashes 文本）。
state2Targets.push(...browsLashesCompileTargets);
// Stage 2C-M2a 修正轮：alphaFault seam 必须在 assembleModule state2 门控（收敛出
// includeV14dHairHelper 参数）与 brows-lashes helper 注入门控（compile 收敛出最终
// 调用行）之后应用，其锚点依赖这两步的最终形态。
state2Targets.push(...alphaFaultTargets);

// Stage 2C-M1 修正轮：dist/graph/slots.js 头部 bundle specifier 重定向（node 直跑）。
// 独立 target：anchor 取文件首个既有 import 行（"./nodes"），幂等（doneMarker 认
// 重定向行本身存在）。
state2Targets.push({
  file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
  anchor: 'import { NODES_WGSL } from "../shaders/materials/nodes";',
  replacement: SLOTS_DIST_BUNDLE_REDIRECT + 'import { NODES_WGSL } from "../shaders/materials/nodes";',
  doneMarker: SLOTS_DIST_BUNDLE_REDIRECT.trim(),
  label: "dist/graph/slots.js bundle specifier 重定向（node 直跑）",
});
passthroughTargets.push(...state2Targets);

applyPatchManifest(passthroughTargets, "display-passthrough");

// ─── 断点 C 幂等顺序修正:fresh install 后 dist slots.js 可能是旧顺序(helper 嵌套在 prelude/fn fs 内)。
// doneMarker=includeState2Mask 会让上面的 assembleModule target 跳过,掩盖模板旧顺序。
// 这里直接检测 dist slots.js 真实文本的 helper/prelude 先后,旧顺序则幂等替换为新顺序。
{
  const distSlots = path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js");
  if (fs.existsSync(distSlots)) {
    const NL = String.fromCharCode(10);
    const Q = String.fromCharCode(34);
    const helperRef = "(includeState2Mask ? V14D_STATE2_HELPERS_WGSL : " + Q + Q + ") +";
    // Stage 2C-M2a 修正轮：alphaFault 的 assemble 调用 target 先于本修正跑（state2Targets
    // 同批 apply），把 prelude 调用改为含 v14dAlphaFault 参数的形态；本修正的旧/新顺序
    // 锚必须匹配该最终形态，否则 clean install 的 dist 旧顺序无法识别。
    const preludeRef = "prelude(renderClass, alphaMode, v14dAlphaFault) +";
    const oldOrder = "decls(renderClass, alphaMode) +" + NL + "        " + preludeRef + NL + "        " + helperRef;
    const newOrder = "decls(renderClass, alphaMode) +" + NL + "        " + helperRef + NL + "        " + preludeRef;
    let content = fs.readFileSync(distSlots, "utf8");
    if (content.includes(oldOrder)) {
      content = content.replace(oldOrder, newOrder);
      fs.writeFileSync(distSlots, content, "utf8");
      console.log("[patch-reze-engine] 断点C 顺序修正: dist slots.js helper 移到 prelude 之前");
      patchLog.push({ label: "dist slots.js 断点C 顺序修正", status: "injected" });
    } else if (content.includes(newOrder)) {
      patchLog.push({ label: "dist slots.js 断点C 顺序修正", status: "already" });
    }
  }
}


// ─── prebuild/predev 硬性失败：anchor miss / 目标文件缺失 / 注入计数异常非零退出 ──
// 静默跳过的补丁会让引擎行为与代码假设不一致（生产 Filmic/诊断 passthrough 错乱），
// 必须在普通 predev/prebuild 路径失败，而不是仅 warn 继续。
{
  const bad = patchLog.filter((e) => e.status === "anchor-miss" || e.status === "ambiguous-anchor" || e.status === "missing-file");
  if (bad.length) {
    console.error("===PATCH-APPLY-FAIL=== 以下补丁目标异常（anchor-miss/ambiguous-anchor/missing-file）：");
    for (const e of bad) console.error("  [" + e.status + "] " + e.label);
    process.exit(1);
  }
  // 普通 predev/prebuild 也做完整严格计数（拦截重复/缺失 marker，不只 anchor-miss）。
  if (!strictVerifyAll()) process.exit(1);
}
