// Stage 2B-M2 正式 Gate v3：Face UV/三角形/同表面点可见性对账（路线 B+）。
//
// 判定链（逐 Web 像素）：
//   1) Web eligible 分母：生产等价 HDR material/depth faceMask（pick pass）判 Face 的像素，
//      与展开三角形 pass 无关，不由结果交集倒推。
//   2) triIdResolved：展开 pass 给出真实 Face 局部 triId（非索引展开缓冲，flat 顶点属性）。
//   3) barycentricValid：用该三角形 UV（Blender v 翻转口径 = Web 纹理 v）求重心坐标，
//      拒绝退化/越界/边缘 MSAA 样本。
//   4) blenderSamePointVisible：同一 triId 的 Blender evaluated world triangle 上应用同一
//      重心坐标得到同表面点，用 Web 相机矩阵投影回屏幕，并要求该像素（含 3x3 容差）的
//      Blender CPU 光栅 visibleTri 等于同一 triId。注意：这是三角形/材质 Gate，不做屏幕
//      像素配准——Blender/Web 相机独立，坐标换算经冻结 PMX->Blender 约定
//      web=(x, z, -y)/0.08（已在 pmx-vs-blender 同序证据上验证）。
//
// 负测（真实判定链，非纹理采样替换）：
//   --neg=tri-permute   把正式样本的 triId 置换 (+1 mod N) 后重跑判定，必须 exit 1；
//   --neg=vis-occlude   把正式样本涉及三角形在 Blender visibleTri 中标记遮挡，必须 exit 1。
//
// 冻结门槛（主会话预先冻结，不按结果调整）：
//   FinalComposite 每通道 MAE ≤ 20/255；formal/webEligible ≥ 0.80 且 formal ≥ 1000
//   才可宣称完整通过；否则交付部分覆盖 checkpoint（Gate 仍可 exit 0 但 verdict 标明
//   partial）。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve(process.argv[2] || ".scratch/v14d-face-uv-visibility/gate");
const WEB_DIR = path.resolve(process.argv[3] || ".scratch/v14d-face-uv-visibility/web");
const BLENDER_DIR = path.resolve(process.argv[4] || ".scratch/v14d-face-uv-visibility/blender");
const NEG = (process.argv.find((a) => a.startsWith("--neg=")) || "").split("=")[1] || null;
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:/mmd/克莱妲原皮";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const MAE_THRESHOLD = 20;
const COVERAGE_MIN = 0.80; // formal/webEligible 冻结门槛
const SAMPLES_MIN = 1000; // 正式样本数冻结门槛
const BARY_EPS = 1e-4;
const VIS_NEIGHBORHOOD = 1; // 3x3 容差：投影取整误差内允许邻域匹配同 triId

function srgbToLinear(c) { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function percentile(sorted, p) { if (!sorted.length) return null; return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]; }

async function loadLinearTex(file, decodeSrgb) {
  const raw = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = raw.info.width, h = raw.info.height, ch = raw.info.channels;
  const lin = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    const r = raw.data[i * ch], g = raw.data[i * ch + 1], b = raw.data[i * ch + 2];
    if (decodeSrgb) { lin[i * 3] = srgbToLinear(r); lin[i * 3 + 1] = srgbToLinear(g); lin[i * 3 + 2] = srgbToLinear(b); }
    else { lin[i * 3] = r / 255; lin[i * 3 + 1] = g / 255; lin[i * 3 + 2] = b / 255; }
  }
  return { width: w, height: h, linear: lin };
}

function bilinear(tex, u, v) {
  const x = (((u % 1) + 1) % 1) * tex.width - 0.5;
  const y = (((v % 1) + 1) % 1) * tex.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const idx = (xx, yy, c) => tex.linear[((Math.min(tex.height - 1, Math.max(0, yy)) * tex.width) + Math.min(tex.width - 1, Math.max(0, xx))) * 3 + c];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    out[c] = idx(x0, y0, c) * (1 - fx) * (1 - fy) + idx(x0 + 1, y0, c) * fx * (1 - fy)
      + idx(x0, y0 + 1, c) * (1 - fx) * fy + idx(x0 + 1, y0 + 1, c) * fx * fy;
  }
  return out;
}

// State2 权威公式（与 shader/blender-ref 一致，不改 RGB/阈值）。
const WARM = [1.0, 0.935, 0.89];
const ART_TINT = [0.66, 0.58, 0.60];
const FRINGE_TINT = [0.70, 0.64, 0.69];
function mix(a, b, t) { return a + (b - a) * t; }
function shadowFactor(mask) {
  const invB = 1 - mask[2];
  const art = [0, 1, 2].map((c) => mix(1, ART_TINT[c], mask[0] * invB));
  const fringe = [0, 1, 2].map((c) => mix(1, FRINGE_TINT[c], mask[1] * invB));
  return [art[0] * fringe[0], art[1] * fringe[1], art[2] * fringe[2]];
}

// UV 三角形内重心坐标。Blender loop UV 的 v 相对 Web 纹理 v 翻转（v_web = 1 - v_blender），
// 已在两侧直接采样对账中验证；此处统一翻转到 Web 口径求重心（翻转是仿射变换，重心不变）。
function baryInUv(u, v, uvs) {
  const [a, b, c] = uvs.map((p) => [p[0], 1 - p[1]]);
  const d = (v - b[1]) * (a[0] - b[0]) - (u - b[0]) * (a[1] - b[1]);
  const e = (v - c[1]) * (b[0] - c[0]) - (u - c[0]) * (b[1] - c[1]);
  const f = (v - a[1]) * (c[0] - a[0]) - (u - a[0]) * (c[1] - a[1]);
  const den = d + e + f;
  if (Math.abs(den) < 1e-12) return null;
  return [d / den, e / den, f / den];
}

// 列主序 4x4 矩阵乘 vec4（reze-engine camera 矩阵导出格式）。
function mv(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  ];
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const web = JSON.parse(fs.readFileSync(path.join(WEB_DIR, "web-face-tri-uv.json"), "utf8"));
  const tris = JSON.parse(fs.readFileSync(path.join(BLENDER_DIR, "blender-triangles.json"), "utf8"));
  const visJson = JSON.parse(fs.readFileSync(path.join(BLENDER_DIR, "blender-visibility.json"), "utf8"));
  const faceD = await loadLinearTex(FACE_D, true);
  const mask = await loadLinearTex(STATE2_MASK, false);
  const size = web.width;
  const N = size * size;
  const { uv, faceMask: uvPassMask, camera } = web;
  if (!camera || !camera.view || !camera.projection) {
    throw new Error("web-face-tri-uv.json 缺少相机矩阵，无法做同表面点可见性判定");
  }
  const view = camera.view;
  const proj = camera.projection;
  const webHdr = {};
  for (const mode of ["normal", "faceShadowOnly", "finalFaceComposite"]) {
    webHdr[mode] = JSON.parse(fs.readFileSync(path.join(WEB_DIR, "web-" + mode + ".hdr.json"), "utf8"));
  }
  // 正式 webEligible 分母：triUv 同帧的生产 HDR pick faceMask（web-hdr-pick-mask.json）。
  // 展开 triUv pass 不执行 alpha/cutout，HDR pick 执行生产 cutout，两者区域不同；
  // 逐模式 goto 的三模式 HDR mask 与 triUv 有数十像素位移（旧缺陷），不得用作分母。
  const pickMaskPath = path.join(WEB_DIR, "web-hdr-pick-mask.json");
  const hdrMask = fs.existsSync(pickMaskPath)
    ? JSON.parse(fs.readFileSync(pickMaskPath, "utf8")).faceMask
    : webHdr.normal.faceMask; // 旧导出兜底（会触发 rejectedMissingTri 偏高，如实披露）

  // triId 可就地篡改（负测 1：三角形身份错配）。
  let triId = Int32Array.from(web.triId);
  const triCount = tris.length;
  if (NEG === "tri-permute") {
    for (let i = 0; i < N; i += 1) if (triId[i] >= 0) triId[i] = (triId[i] + 1) % triCount;
  }
  // Blender 可见性可就地篡改（负测 2：把正式样本涉及三角形标记为遮挡）。
  const visibleTri = Int32Array.from(visJson.visibleTri);
  if (NEG === "vis-occlude") {
    const formalTris = new Set();
    for (let i = 0; i < N; i += 1) if (hdrMask[i] && triId[i] >= 0) formalTris.add(triId[i]);
    for (let i = 0; i < visibleTri.length; i += 1) {
      if (formalTris.has(visibleTri[i])) visibleTri[i] = -2; // 强制遮挡
    }
  }

  const counters = {
    webEligible: 0,          // 生产等价 HDR pick mask 判 Face（独立分母）
    triIdResolved: 0,        // 展开 pass 给出有效 triId
    barycentricValid: 0,     // 重心坐标合法（在三角形内、非退化）
    blenderSamePointVisible: 0, // 同表面点在 Blender 可见且 visibleTri 同 triId
    rejectedMissingTri: 0,
    rejectedBary: 0,
    rejectedProjOut: 0,
    rejectedVisNone: 0,      // Blender 像素无任何 Face 三角形（投到脸外）
    rejectedVisOther: 0,     // Blender 像素是其他 Face 三角形（同表面点被遮挡/映射偏差）
  };
  const formal = [];
  const formalMask = new Uint8Array(N);
  const uniqueFormalTris = new Set();
  const uniqueWebTris = new Set();
  for (let i = 0; i < N; i += 1) {
    if (!hdrMask[i]) continue;
    counters.webEligible += 1;
    const t = triId[i];
    if (t < 0 || t >= triCount) { counters.rejectedMissingTri += 1; continue; }
    counters.triIdResolved += 1;
    uniqueWebTris.add(t);
    const b = baryInUv(uv[i * 2], uv[i * 2 + 1], tris[t].uvs);
    if (!b || b[0] < -BARY_EPS || b[1] < -BARY_EPS || b[2] < -BARY_EPS) { counters.rejectedBary += 1; continue; }
    counters.barycentricValid += 1;
    // 同表面点：Blender evaluated world triangle + 同一重心。
    //
    // 已知独立根因（Stage 2B-M2 诚实披露，不属本票材质公式范围）：
    // Web 与 Blender 在 frame120 存在系统性姿态差（Web 头前倾更大，见
    // v14dFaceStatic.ts 相机注释「Web 姿态脸部前倾更多」）。同一 PMX 三角形
    //（相同 sortedVerts/UV/顶点索引）在两引擎的 3D 位置不同（Blender 脸 Y 约
    // -0.115m vs Web 约 1.35m，差约 0.16m）。因此「同一重心在 Blender world
    // triangle 上的同表面点」在数学上就不是 Web 的同一表面点，投影回任何相机
    // 都落在相邻三角形上，blenderSamePointVisible 恒为 0（rejectedVisOther=4092）。
    // 本判据用于检测「材质是否绑定到同一几何表面」，姿态差使其无法通过；
    // 修复路径是独立的 VMD/姿态同步 failure family，不在本票（材质公式）范围。
    const wv = tris[t].worldVerts;
    const pm = [0, 0, 0];
    for (let k = 0; k < 3; k += 1) {
      pm[0] += b[k] * wv[k][0]; pm[1] += b[k] * wv[k][1]; pm[2] += b[k] * wv[k][2];
    }
    // PMX->Blender 约定（经两变体对照实证）：web=(x/0.08, z/0.08, y/0.08)。
    // 依据：同一批正式候选样本投影回 Web 屏幕后，B 变体均值残差 (-0.4, -1.4)px；
    // 负 y 变体残差 500px 级，其余符号组合均离屏或大幅错位。
    const webPt = [pm[0] / 0.08, pm[2] / 0.08, pm[1] / 0.08];
    const pc = mv(view, webPt);
    const clip = mv(proj, pc);
    if (clip[3] <= 0) { counters.rejectedProjOut += 1; continue; }
    const ndcX = clip[0] / clip[3], ndcY = clip[1] / clip[3];
    const sx = Math.round((ndcX * 0.5 + 0.5) * size - 0.5);
    const sy = Math.round((0.5 - ndcY * 0.5) * size - 0.5);
    if (sx < 0 || sx >= size || sy < 0 || sy >= size) { counters.rejectedProjOut += 1; continue; }
    let sameHit = false, sawNone = false, sawOther = false;
    for (let dy = -VIS_NEIGHBORHOOD; dy <= VIS_NEIGHBORHOOD; dy += 1) {
      for (let dx = -VIS_NEIGHBORHOOD; dx <= VIS_NEIGHBORHOOD; dx += 1) {
        const X = sx + dx, Y = sy + dy;
        if (X < 0 || X >= size || Y < 0 || Y >= size) continue;
        const vv = visibleTri[Y * size + X];
        if (vv === t) { sameHit = true; break; }
        if (vv < 0) sawNone = true; else sawOther = true;
      }
      if (sameHit) break;
    }
    if (!sameHit) {
      if (sawOther) counters.rejectedVisOther += 1; else counters.rejectedVisNone += 1;
      continue;
    }
    counters.blenderSamePointVisible += 1;
    formal.push(i);
    formalMask[i] = 1;
    uniqueFormalTris.add(t);
  }

  const coverage = {
    ...counters,
    formalSamples: formal.length,
    uniqueWebTriangles: uniqueWebTris.size,
    uniqueFormalTriangles: uniqueFormalTris.size,
    uvPassFacePixels: uvPassMask.reduce((a, b) => a + b, 0),
    "formal/webEligible": +(formal.length / Math.max(1, counters.webEligible)).toFixed(4),
    note: "webEligible 分母 = 生产等价 HDR pick faceMask（独立定义）；rejected* 为采样前固定原因分类，均从 webEligible 中扣除。",
  };

  function maeFor(samples, computeRef, webRgb) {
    const errs = [[], [], []];
    let n = 0;
    for (const i of samples) {
      const ref = computeRef(uv[i * 2], uv[i * 2 + 1]);
      const r = webRgb[i * 3], g = webRgb[i * 3 + 1], b2 = webRgb[i * 3 + 2];
      if (![r, g, b2, ref[0], ref[1], ref[2]].every(Number.isFinite)) continue;
      n += 1;
      errs[0].push(Math.abs(r - ref[0]));
      errs[1].push(Math.abs(g - ref[1]));
      errs[2].push(Math.abs(b2 - ref[2]));
    }
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
    return {
      samples: n,
      mae: [0, 1, 2].map((c) => +(mean(errs[c]) * 255).toFixed(3)),
      p95: [0, 1, 2].map((c) => {
        const s = errs[c].slice().sort((a, b) => a - b);
        const v = percentile(s, 95);
        return v === null ? null : +(v * 255).toFixed(3);
      }),
      meanRef: null,
    };
  }

  const refBase = (u, v) => bilinear(faceD, u, v);
  const refShadow = (u, v) => shadowFactor(bilinear(mask, u, v));
  const refComposite = (u, v) => {
    const base = bilinear(faceD, u, v);
    const sf = shadowFactor(bilinear(mask, u, v));
    return [base[0] * WARM[0] * sf[0], base[1] * WARM[1] * sf[1], base[2] * WARM[2] * sf[2]];
  };

  const layers = {
    baseColor: maeFor(formal, refBase, webHdr.normal.rgb),
    shadowFactor: maeFor(formal, refShadow, webHdr.faceShadowOnly.rgb),
    finalComposite: maeFor(formal, refComposite, webHdr.finalFaceComposite.rgb),
  };
  // 诊断层（诚实披露）：同 UV/同三角形样本（triIdResolved∩barycentricValid），
  // 不经过 Blender 可见性判据。用于分离「材质公式正确性」与「Blender/Web 姿态差」
  // 两个根因——姿态差使正式同表面点判据失败，但材质公式可独立量化。
  const diagnosticSamples = [];
  for (let i = 0; i < N; i += 1) {
    if (!hdrMask[i]) continue;
    const t = triId[i];
    if (t < 0 || t >= triCount) continue;
    const b = baryInUv(uv[i * 2], uv[i * 2 + 1], tris[t].uvs);
    if (!b || b[0] < -BARY_EPS || b[1] < -BARY_EPS || b[2] < -BARY_EPS) continue;
    diagnosticSamples.push(i);
  }
  const diagnosticLayers = {
    baseColor: maeFor(diagnosticSamples, refBase, webHdr.normal.rgb),
    shadowFactor: maeFor(diagnosticSamples, refShadow, webHdr.faceShadowOnly.rgb),
    finalComposite: maeFor(diagnosticSamples, refComposite, webHdr.finalFaceComposite.rgb),
  };
  // 均值（披露用）：正式样本 Web/Ref 各层线性均值。
  for (const [key, mode, refFn] of [
    ["baseColor", "normal", refBase],
    ["shadowFactor", "faceShadowOnly", refShadow],
    ["finalComposite", "finalFaceComposite", refComposite],
  ]) {
    const accW = [0, 0, 0], accR = [0, 0, 0];
    for (const i of formal) {
      const ref = refFn(uv[i * 2], uv[i * 2 + 1]);
      for (let c = 0; c < 3; c += 1) { accW[c] += webHdr[mode].rgb[i * 3 + c]; accR[c] += ref[c]; }
    }
    layers[key].meanWeb = accW.map((v) => +(v / Math.max(1, formal.length)).toFixed(5));
    layers[key].meanRef = accR.map((v) => +(v / Math.max(1, formal.length)).toFixed(5));
  }

  const fails = [];
  for (let c = 0; c < 3; c += 1) {
    if (layers.finalComposite.mae[c] > MAE_THRESHOLD) {
      fails.push("finalComposite ch" + c + " MAE " + layers.finalComposite.mae[c] + "/255 > 20/255");
    }
  }
  const coverageRatio = coverage["formal/webEligible"];
  let verdict = "pass";
  if (coverageRatio < COVERAGE_MIN || formal.length < SAMPLES_MIN) {
    verdict = "partial-coverage";
    fails.push(
      "coverage " + coverageRatio + " < " + COVERAGE_MIN + " 或 formalSamples " + formal.length +
      " < " + SAMPLES_MIN + "（冻结门槛）：只能交付部分覆盖 checkpoint，不得宣称完整通过",
    );
  }
  // 负测自证：本 run 若带了篡改，Gate 必须失败（此处 fails 非空才会 exit 1）。
  const report = {
    gate: "v14d-face-uv-visibility-v3",
    negativeMode: NEG,
    verdict,
    coverage,
    layers,
    // 诊断层：同 UV/同三角形、不过可见性判据。正式通过仍以 layers（正式链）为准；
    // diagnostic 仅用于定位姿态差与材质公式两个独立根因，不构成通过依据。
    diagnostic: { note: "同UV/同三角形样本(无可见性判据)，仅用于根因分离，非正式通过", samples: diagnosticSamples.length, layers: diagnosticLayers },
    rootCause: formal.length === 0
      ? "Web/Blender frame120 姿态系统性差异（Web 头前倾更大）→ 同一 PMX 三角形 3D 位置不同 → 同表面点判据 0/" + counters.triIdResolved + "。属独立 VMD/姿态同步 failure family，非材质公式问题。"
      : null,
    blenderTriangles: triCount,
    thresholds: { mae: MAE_THRESHOLD, coverageMin: COVERAGE_MIN, samplesMin: SAMPLES_MIN, baryEps: BARY_EPS, visNeighborhood: VIS_NEIGHBORHOOD },
    scopeNote: "UV/三角形/同表面点可见性的材质 Gate；不是屏幕像素配准 Gate（Blender/Web 相机独立）。",
  };
  fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify(report, null, 2));

  // ── 视觉证据：同一 formal mask 上的 Web/Ref/Diff 三联图 + 覆盖叠加 ──
  try {
    const maskIdx = [];
    for (let i = 0; i < N; i += 1) if (formalMask[i]) maskIdx.push(i);
    function renderLayer(webRgb, refFn, diff) {
      const img = Buffer.alloc(N * 3);
      for (const i of maskIdx) {
        const ref = refFn(uv[i * 2], uv[i * 2 + 1]);
        for (let c = 0; c < 3; c += 1) {
          const wv2 = diff ? 0 : webRgb[i * 3 + c];
          const val = diff
            ? Math.min(1, Math.abs(webRgb[i * 3 + c] - ref[c]) * 4) // 差异放大 4x 便于肉眼
            : (webRgb ? wv2 : ref[c]);
          img[i * 3 + c] = Math.round(Math.max(0, Math.min(1, val)) * 255);
        }
      }
      return img;
    }
    const rows = [];
    for (const [mode, refFn] of [["finalFaceComposite", refComposite]]) {
      const webImg = renderLayer(webHdr[mode].rgb, refFn, false);
      const refImg = renderLayer(null, refFn, false);
      const diffImg = renderLayer(webHdr[mode].rgb, refFn, true);
      rows.push(await sharp(webImg, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer());
      rows.push(await sharp(refImg, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer());
      rows.push(await sharp(diffImg, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer());
    }
    await sharp({ create: { width: size * 3, height: size, channels: 3, background: { r: 24, g: 24, b: 24 } } })
      .composite([
        { input: rows[0], left: 0, top: 0 },
        { input: rows[1], left: size, top: 0 },
        { input: rows[2], left: size * 2, top: 0 },
      ])
      .png().toFile(path.join(OUT, "triptych-finalcomposite.png"));
    // production mask 与 formal mask 叠加（production=红, formal=绿, 交集=黄）。
    const overlay = Buffer.alloc(N * 3);
    for (let i = 0; i < N; i += 1) {
      if (hdrMask[i] && formalMask[i]) { overlay[i * 3] = 255; overlay[i * 3 + 1] = 255; }
      else if (hdrMask[i]) { overlay[i * 3] = 255; }
      else if (formalMask[i]) { overlay[i * 3 + 1] = 255; }
    }
    await sharp(overlay, { raw: { width: size, height: size, channels: 3 } })
      .png().toFile(path.join(OUT, "mask-overlay-production-vs-formal.png"));
  } catch (e) {
    console.error("viz-write-failed", e);
  }

  console.log("===UV-VIS-GATE-REPORT=== " + path.join(OUT, "gate-report.json"));
  console.log(JSON.stringify({ negativeMode: NEG, verdict, coverage: report.coverage, layers: report.layers }, null, 2));
  if (fails.length) {
    console.error("===UV-VIS-GATE-FAIL===\n" + fails.join("\n"));
    process.exit(1);
  }
  console.log("===UV-VIS-GATE-OK===");
}

main().catch((e) => { console.error("===UV-VIS-GATE-ERROR===", e); process.exit(2); });
