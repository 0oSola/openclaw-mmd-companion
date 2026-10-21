// 审计 Web 引擎纹理上传链对 face_d(RGBA, alpha~218-255) 的实际预乘行为。
// 同一 File, 分别用 premultiplyAlpha:none/default 解码, 统计脸部 UV 区 RGB 均值,
// 并与磁盘 PIL 解码(未预乘)对照, 确认 Web 采样值 ≈ Blender_linear * alpha 的来源。
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-premul-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 200, height: 200 } });
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${BASE}?v14dFaceStatic=0`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const result = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "c_Koleda_slg_face_d.png", { type: "image/png" });
    const x0 = Math.floor(0.454 * 1024), x1 = Math.ceil(0.848 * 1024);
    const y0 = Math.floor(0.552 * 1024), y1 = Math.ceil(0.797 * 1024);
    async function decodeMean(opts) {
      const bmp = await createImageBitmap(file, opts);
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let n = 0; const sum = [0,0,0]; const asum = [0];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const off = (y * bmp.width + x) * 4;
        sum[0]+=img[off]; sum[1]+=img[off+1]; sum[2]+=img[off+2]; asum[0]+=img[off+3]; n++;
      }
      return { mean8bit: sum.map((s)=>s/n), alphaMean8bit: asum[0]/n };
    }
    const none = await decodeMean({ premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const def = await decodeMean({ colorSpaceConversion: "none" });
    const premul = await decodeMean({ premultiplyAlpha: "premultiply", colorSpaceConversion: "none" });
    return { none, default: def, premultiply: premul };
  }, diskBuf.toString("base64"));
  const report = { file: FACE_D, sha256: crypto.createHash("sha256").update(diskBuf).digest("hex"), faceUvRegion: { x0: 464, y0: 565, x1: 869, y1: 817 }, decodeModes: result };
  fs.writeFileSync(path.join(OUT, "face-tex-premultiply-audit.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await context.close(); }
