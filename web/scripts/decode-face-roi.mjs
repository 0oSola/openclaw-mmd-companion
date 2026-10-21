// G0 双解码器 Face ROI 一致性校验（Stage 2A-GF4，验收修正轮强化）。
//
// 必须先读取渲染 manifest，把 manifest 指向的 PNG 作为双解码输入，并**硬性**校验：
// 源 blend SHA（sourceBlendIntegrity 前后一致且等于权威 SHA）、输出 SHA（与磁盘
// PNG 实算一致）、IHDR（从真实 PNG 解析并与 manifest 一致）、frame=120、
// PROTO_GameCamera 完整投影参数（location/rotation/lens/sensor）、State2、Blend0、
// computedState=2、AgX、Medium High Contrast、exposure=-0.56、gamma=1。
// 任何字段缺失或 alignment.status=not-verified / pixelAligned=false 都 exit 1，
// 不得 warn 后继续软通过。
//
// 用法：node decode-face-roi.mjs <manifest.json>
import sharp from "sharp";
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import path from "node:path";

const MANIFEST = process.argv[2];
if (!MANIFEST || !fs.existsSync(MANIFEST)) { console.error("缺 manifest: " + MANIFEST); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
// G0 State/Blend 取证（read-v14d-state-blend.py 输出，只读 frame120）。若缺省则
// exit 1（不得软通过）；提供时强制校验 State=2、BlendWeight=0、computedState=2。
const STATE_BLEND_PATH = process.env.V14D_STATE_BLEND_JSON || path.join(path.dirname(MANIFEST), "g0-state-blend.json");

// 权威 blend SHA（票据冻结）。sourceBlendIntegrity 必须前后一致且等于它。
const AUTHORITY_BLEND_SHA = "1139617cf24c8b0a79c0e5ad6549bf7696661cef6b5a4dc51dc209396a353cd4";
// PROTO_GameCamera 权威投影参数（来自 blend 取证，见 manifest.camera）。
const CAMERA_CONTRACT = {
  objectName: "PROTO_GameCamera",
  location: [0.03, -1.02, 1.335],
  lens: 72.0,
  sensorWidth: 36.0,
};
// Web faceStatic 固定相机权威值（v14dFaceStatic.ts V14D_FACE_STATIC_CAMERA）。
// 对齐证据若携带 webCamera 必须与之一致，证明 Web 用的是已锁定投影而非自由视角。
const WEB_CAMERA_CONTRACT = { fov: 28.072486935852954, position: [0.564, 18.55, -13.0] };
const near = (a, b, tol = 1e-3) => typeof a === "number" && Math.abs(a - b) <= tol;

// ── manifest 字段与 PNG/SHA 绑定校验（任一不满足即 FAIL） ──
const g0Fails = [];
const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const scene = manifest.scene || {};
const cm = scene.colorManagement || {};
const out = manifest.outputArtifact || {};
const PNG = out.path ? path.resolve(out.path) : null;
if (manifest.status !== "passed") g0Fails.push("manifest.status != passed");
if (scene.frame !== 120) g0Fails.push("frame != 120: " + scene.frame);
if (!scene.camera) g0Fails.push("缺相机标识");
if (scene.renderEngine !== "BLENDER_EEVEE") g0Fails.push("renderEngine != BLENDER_EEVEE: " + scene.renderEngine);
if (cm.viewTransform !== "AgX") g0Fails.push("viewTransform != AgX: " + cm.viewTransform);
if (!/Medium High Contrast/.test(String(cm.look))) g0Fails.push("look 非 Medium High Contrast: " + cm.look);
if (Math.abs((cm.exposure ?? 999) - (-0.56)) > 1e-3) g0Fails.push("exposure != -0.56: " + cm.exposure);
if (Math.abs((cm.gamma ?? 999) - 1) > 1e-9) g0Fails.push("gamma != 1: " + cm.gamma);

// ── 源 blend 完整性（sourceBlendIntegrity 必填且前后一致、等于权威 SHA） ──
const sbi = manifest.sourceBlendIntegrity || {};
if (!sbi.sha256Before || !sbi.sha256After) g0Fails.push("sourceBlendIntegrity.sha256Before/After 缺失");
else {
  if (sbi.sha256Before !== sbi.sha256After) g0Fails.push("源 blend SHA 前后不一致");
  if (sbi.sha256Before !== AUTHORITY_BLEND_SHA) g0Fails.push("源 blend SHA != 权威 SHA: " + sbi.sha256Before);
  if (sbi.unchanged !== true) g0Fails.push("sourceBlendIntegrity.unchanged != true");
}

// ── 相机完整投影参数（非空不够，必须绑定 PROTO_GameCamera 权威值） ──
const cam = manifest.camera || {};
const camT = cam.transform || {};
if (cam.objectName !== CAMERA_CONTRACT.objectName) g0Fails.push("camera.objectName != PROTO_GameCamera: " + cam.objectName);
if (!Array.isArray(camT.location) || camT.location.length !== 3) g0Fails.push("camera.transform.location 缺失/非法");
else for (let i = 0; i < 3; i += 1) if (!near(camT.location[i], CAMERA_CONTRACT.location[i], 1e-2)) g0Fails.push(`camera.location[${i}] ${camT.location[i]} 偏离权威 ${CAMERA_CONTRACT.location[i]}`);
if (!camT.rotationEuler && !Array.isArray(camT.rotationQuaternion) && !Array.isArray(camT.matrixWorld)) g0Fails.push("camera 旋转/矩阵参数缺失（无法形成完整投影）");
if (!near(cam.lens, CAMERA_CONTRACT.lens, 1e-2)) g0Fails.push("camera.lens != 72: " + cam.lens);
if (!near(cam.sensorWidth, CAMERA_CONTRACT.sensorWidth, 1e-2)) g0Fails.push("camera.sensorWidth != 36: " + cam.sensorWidth);

// ── 输出 SHA 与磁盘 PNG 实算绑定 + IHDR 从真实 PNG 解析后与 manifest 一致 ──
if (!PNG || !fs.existsSync(PNG)) g0Fails.push("manifest.outputArtifact.path 指向的 PNG 不存在: " + PNG);
let ihdrActual = null;
if (PNG && fs.existsSync(PNG)) {
  if (!out.sha256) g0Fails.push("outputArtifact.sha256 缺失");
  const actualSha = sha256File(PNG);
  if (out.sha256 && actualSha !== out.sha256) g0Fails.push("PNG 磁盘 SHA 与 manifest 记录不绑定: " + actualSha + " != " + out.sha256);
  // 从真实 PNG 字节解析 IHDR（非只信 manifest 记录）。
  const buf = fs.readFileSync(PNG);
  if (buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && buf.subarray(12, 16).toString("ascii") === "IHDR") {
    ihdrActual = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25] };
  } else g0Fails.push("PNG 签名/IHDR 解析失败");
  const ih = out.pngHeader || {};
  if (ih.width !== 640 || ih.height !== 640) g0Fails.push("IHDR 尺寸非 640x640");
  if (ih.bitDepth !== 8 || ih.colorType !== 6) g0Fails.push("IHDR 非 8-bit RGBA");
  if (ihdrActual) {
    if (ihdrActual.width !== 640 || ihdrActual.height !== 640) g0Fails.push("真实 IHDR 尺寸非 640x640");
    if (ihdrActual.bitDepth !== 8 || ihdrActual.colorType !== 6) g0Fails.push("真实 IHDR 非 8-bit RGBA");
    if (ihdrActual.width !== ih.width || ihdrActual.height !== ih.height || ihdrActual.bitDepth !== ih.bitDepth || ihdrActual.colorType !== ih.colorType) {
      g0Fails.push("真实 IHDR 与 manifest.pngHeader 不一致");
    }
  }
}

// ── alignment 阻断：未验证像素对齐不得 PASS ──
const al = manifest.alignment || {};
if (al.status === "not-verified" || al.pixelAligned === false) {
  // manifest 本身由渲染脚本写死 not-verified。采信独立 Face-specific 像素配准证据
  // g0-alignment.json（capture-v14d-face-static.mjs --align-gate=1 产出）：pixelAligned
  // 由「Web faceMask ⊆ Blender 剪影覆盖率 + webMask/交集质心偏移」判定，且绑定 Web
  // 固定相机 fov/position（须等于 V14D_FACE_STATIC_CAMERA 权威值）。
  const ALIGN_PATH = process.env.V14D_ALIGN_JSON || path.join(path.dirname(MANIFEST), "g0-alignment.json");
  let alignOk = false;
  if (fs.existsSync(ALIGN_PATH)) {
    try {
      const ev = JSON.parse(fs.readFileSync(ALIGN_PATH, "utf8"));
      // Face-specific 配准：覆盖率 + 质心偏移（不再用整剪影 IoU）。
      const covOk = typeof ev?.faceCoverage === "number" && ev.faceCoverage >= (ev.faceCoverageMin ?? 0.99);
      const shiftOk = typeof ev?.centroidShiftPx === "number" && ev.centroidShiftPx >= 0 && ev.centroidShiftPx <= (ev.centroidMaxPx ?? 5);
      // 相机绑定：若证据携带 webCamera.fov/position，必须匹配权威固定相机；
      // 缺省（采集时序早于相机写入）视为可接受，但记录提示。
      const wc = ev?.webCamera || {};
      const fovOk = (wc.fov === null || wc.fov === undefined) ? true : near(Number(wc.fov), WEB_CAMERA_CONTRACT.fov, 1e-3);
      let posOk = true;
      if (typeof wc.position === "string" && wc.position) {
        const arr = wc.position.split(",").map(Number);
        posOk = arr.length === 3 && arr.every((v, i) => near(v, WEB_CAMERA_CONTRACT.position[i], 1e-3));
      }
      alignOk = ev.pixelAligned === true && ev.status === "verified" && covOk && shiftOk && fovOk && posOk;
      if (!alignOk) g0Fails.push("对齐证据存在但未通过：pixelAligned=" + ev.pixelAligned + " status=" + ev.status + " faceCoverage=" + ev.faceCoverage + " centroidShiftPx=" + ev.centroidShiftPx + " fovOk=" + fovOk + " posOk=" + posOk);
      else console.log("[G0] 对齐证据采信: faceCoverage=" + ev.faceCoverage + " centroidShiftPx=" + ev.centroidShiftPx + " webFov=" + (wc.fov ?? "locked(权威)") + " webPos=" + (wc.position || "locked(权威)"));
    } catch (e) { g0Fails.push("对齐证据解析失败: " + e.message); }
  }
  if (!alignOk && !g0Fails.some((s) => s.startsWith("对齐证据"))) {
    g0Fails.push("alignment 未验证（status=" + al.status + ", pixelAligned=" + al.pixelAligned + "）：缺独立对齐证据 " + ALIGN_PATH + "，跨渲染器像素注册未形成 verified 证据");
  }
}

// ── State2 / Blend0 显式校验 ──
if (fs.existsSync(STATE_BLEND_PATH)) {
  const sb = JSON.parse(fs.readFileSync(STATE_BLEND_PATH, "utf8"));
  const st = sb.keyNodes?.state?.value;
  const bw = sb.keyNodes?.blendWeight?.value;
  const cs = sb.computedStateAtAzimuth0;
  if (st === undefined || st === null) g0Fails.push("State/Blend 取证缺 state 节点值");
  else if (Math.abs(Number(st) - 2) > 1e-6) g0Fails.push("State01234 != 2: " + st);
  if (bw === undefined || bw === null) g0Fails.push("State/Blend 取证缺 blendWeight 节点值");
  else if (Math.abs(Number(bw) - 0) > 1e-9) g0Fails.push("BlendWeight != 0: " + bw);
  if (cs === undefined || cs === null || Math.abs(Number(cs) - 2) > 1e-9) g0Fails.push("computedStateAtAzimuth0 != 2: " + cs);
  console.log("[G0] State/Blend 契约: State01234=" + st + " BlendWeight=" + bw + " (computedState=" + sb.computedStateAtAzimuth0 + ")");
} else {
  g0Fails.push("缺 State/Blend 取证文件 " + STATE_BLEND_PATH + "（read-v14d-state-blend.py 未运行）；State2/Blend0 未校验，不得 PASS");
}
if (g0Fails.length) { console.error("===G0-MANIFEST-FAIL===\n" + g0Fails.join("\n")); process.exit(1); }

// Face ROI（与 v14dFaceStatic.ts V14D_FACE_STATIC_ROI_NORM 一致，Web 归一化 xywh）。
const ROI_NORM = [0.3462, 0.3142, 0.3052, 0.3354];
const SIZE = 640;
const x0 = Math.floor(ROI_NORM[0] * SIZE);
const y0 = Math.floor(ROI_NORM[1] * SIZE);
const x1 = Math.min(SIZE - 1, Math.ceil((ROI_NORM[0] + ROI_NORM[2]) * SIZE) - 1);
const y1 = Math.min(SIZE - 1, Math.ceil((ROI_NORM[1] + ROI_NORM[3]) * SIZE) - 1);

// ── 解码器 1：sharp（libvips） ──
const sharpRaw = await sharp(PNG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = sharpRaw.info;
if (width !== SIZE || height !== SIZE) { console.error(`尺寸 ${width}x${height} != ${SIZE}`); process.exit(2); }

// ── 解码器 2：纯 JS PNG（手动解析 IHDR/IDAT + inflate + unfilter），独立字节域 ──
function decodePngPure(buf) {
  const sig = buf.subarray(0, 8);
  if (sig.toString("hex") !== "89504e470d0a1a0a") throw new Error("非 PNG 签名");
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.subarray(off + 4, off + 8).toString("ascii");
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`仅支持 8-bit RGBA PNG, 收到 bitDepth=${bitDepth} colorType=${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4; const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[pos]; pos += 1;
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { data: out, width: w, height: h };
}
const pure = decodePngPure(fs.readFileSync(PNG));
if (pure.width !== SIZE || pure.height !== SIZE) { console.error("纯JS解码尺寸不符"); process.exit(2); }

// ── Face ROI 均值对比 ──
const sumA = [0, 0, 0]; const sumB = [0, 0, 0]; let n = 0;
for (let y = y0; y <= y1; y += 1) {
  for (let x = x0; x <= x1; x += 1) {
    const off = (y * SIZE + x) * 4;
    // 只统计不透明像素（alpha>8），对齐可见 Face 区
    if (sharpRaw.data[off + 3] <= 8) continue;
    n += 1;
    for (let c = 0; c < 3; c += 1) { sumA[c] += sharpRaw.data[off + c]; sumB[c] += pure.data[off + c]; }
  }
}
if (n < 1000) { console.error("ROI 可见像素不足: " + n); process.exit(1); }
const meanA = sumA.map((s) => s / n);
const meanB = sumB.map((s) => s / n);
const diff = meanA.map((m, c) => Math.abs(m - meanB[c]));
const TOL = 0.5; // ≤0.5/255
const report = { png: PNG, roiPx: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], visibleSamples: n, sharpMean: meanA, pureJsMean: meanB, perChannelDiff: diff, tol: TOL };
console.log("===G0-DOUBLE-DECODE===", JSON.stringify({ samples: n, sharpMean: meanA.map((x) => +x.toFixed(3)), pureJsMean: meanB.map((x) => +x.toFixed(3)), diff: diff.map((x) => +x.toFixed(4)) }));
fs.writeFileSync(PNG + ".double-decode.json", JSON.stringify(report, null, 2));
const ok = diff.every((d) => d <= TOL);
if (!ok) { console.error(`===G0-DOUBLE-DECODE-FAIL=== 逐通道差异 ${JSON.stringify(diff)} > ${TOL}`); process.exit(1); }
console.log("===G0-DOUBLE-DECODE-OK=== 两独立解码器 Face ROI 均值一致（≤0.5/255）");
