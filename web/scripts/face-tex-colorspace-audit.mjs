// 颜色管理审计: 同一 face_d PNG, 在 Chrome 里用不同 colorSpaceConversion 解码,
// 统计脸部 UV 区 sRGB 字节均值, 并与 PIL(无颜色管理)字节对照,
// 确认 Web 采样值偏暗红是否来自 Chrome 颜色管理对 sRGB->Canvas 的重映射。
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-cs-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 200, height: 200 } });
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${BASE}?v14dFaceStatic=0`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const result = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "c_Koleda_slg_face_d.png", { type: "image/png" });
    const x0 = 464, y0 = 565, x1 = 869, y1 = 817;
    async function decode(opts) {
      const bmp = await createImageBitmap(file, opts);
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height, { colorSpace: "srgb" }).data;
      let n = 0; const sum = [0,0,0];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const off = (y * bmp.width + x) * 4;
        sum[0]+=img[off]; sum[1]+=img[off+1]; sum[2]+=img[off+2]; n++;
      }
      return sum.map((s)=>s/n);
    }
    return {
      colorSpaceConversion_none: await decode({ premultiplyAlpha: "none", colorSpaceConversion: "none" }),
      colorSpaceConversion_default: await decode({ premultiplyAlpha: "none" }),
      colorSpaceConversion_srgb: await decode({ premultiplyAlpha: "none", colorSpaceConversion: "default" }),
    };
  }, diskBuf.toString("base64"));
  // PIL 参考(无颜色管理)
  const report = { file: FACE_D, sha256: crypto.createHash("sha256").update(diskBuf).digest("hex"), chromeDecodeSrgbMean: result, pilReferenceSrgbMean: [224.94, 181.93, 173.53], note: "PIL 参考值来自 colorspace-isolation 实验的 sRGB 字节统计" };
  fs.writeFileSync(path.join(OUT, "face-tex-colorspace-audit.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await context.close(); }
