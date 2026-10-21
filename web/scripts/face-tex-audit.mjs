// 审计 faceStatic 实际注入/上传的 Face diffuse 纹理内容与磁盘权威 face_d 的差异。
// 用 Canvas 2D 解码注入 File 与磁盘 File, 逐通道统计像素级差异(不经 WebGPU 采样)。
import { chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import crypto from "node:crypto";
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3000/mmd-calibration-render";
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
const OUT = path.resolve(".scratch/v14d-face-static/uv-align/web");
fs.mkdirSync(OUT, { recursive: true });

const diskBuf = fs.readFileSync(FACE_D);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-texaudit-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 200, height: 200 } });
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${BASE}?v14dFaceStatic=0`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const result = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "c_Koleda_slg_face_d.png", { type: "image/png" });
    const bmp = await createImageBitmap(file, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    // 只统计脸部 UV 区域(u 0.45..0.85, v 0.55..0.80 对应 1024x1024 像素)
    const x0 = Math.floor(0.454 * bmp.width), x1 = Math.ceil(0.848 * bmp.width);
    const y0 = Math.floor(0.552 * bmp.height), y1 = Math.ceil(0.797 * bmp.height);
    let n = 0; const sum = [0,0,0]; const maxAbs = [0,0,0];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const off = (y * bmp.width + x) * 4;
      sum[0] += img[off]; sum[1] += img[off+1]; sum[2] += img[off+2]; n++;
    }
    return { width: bmp.width, height: bmp.height, faceUvPx: { x0, y0, x1, y1 }, n, mean8bit: sum.map((s) => s / n), sha: "computed-in-page-not-available" };
  }, diskBuf.toString("base64"));
  const diskStat = { bytes: diskBuf.length, sha256: crypto.createHash("sha256").update(diskBuf).digest("hex") };
  const report = { diskFile: FACE_D, diskStat, pageDecode: result };
  fs.writeFileSync(path.join(OUT, "face-tex-audit.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await context.close(); }
