// 验证 18748 预览默认载入主舞台待机动作，并能切换动作。
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const out = path.resolve(process.argv[2] || "output/gf2-idle-preview-check");
fs.mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("playwright-core/package.json"));
const executable = require(path.join(root, "lib/server/registry/index.js")).registry
  .findExecutable("chromium-headless-shell").executablePath();
const base = process.env.GF2_PREVIEW_BASE || "http://127.0.0.1:18748/";
const report = { started: new Date().toISOString(), base, checks: [], errors: [] };
let browser;
try {
  browser = await chromium.launch({ executablePath: executable, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.gf2Preview?.state?.ready === true", null, { timeout: 180000 });
  await page.waitForFunction("Boolean(window.gf2Preview?.state?.vmd)", null, { timeout: 180000 });
  const first = await page.evaluate(() => ({
    duration: window.gf2Preview.state.duration,
    vmd: window.gf2Preview.state.vmd,
    options: [...document.querySelectorAll("#motion-select option")].map((o) => o.textContent),
    disabled: document.getElementById("motion-select").disabled,
  }));
  report.checks.push({ name: "默认载入主舞台待机动作", ...first });
  const target = first.options.find((name) => name.startsWith("L06_02_"));
  const value = await page.evaluate((name) => {
    const option = [...document.querySelectorAll("#motion-select option")].find((o) => o.textContent === name);
    const select = document.getElementById("motion-select");
    select.value = option.value;
    select.dispatchEvent(new Event("change"));
    return option.value;
  }, target);
  await page.waitForFunction(
    (name) => window.gf2Preview.state.vmd === name,
    target, { timeout: 120000 },
  );
  const second = await page.evaluate(() => ({
    duration: window.gf2Preview.state.duration,
    vmd: window.gf2Preview.state.vmd,
    frame: window.gf2Preview.state.frame,
    playing: window.gf2Preview.state.playing,
    status: document.getElementById("status").textContent,
  }));
  report.checks.push({ name: "切换到 L06 后动作与时长更新", value, ...second });
  await page.screenshot({ path: path.join(out, "preview-idle.png") });
  report.passed = report.errors.length === 0
    && /^L\d+_02_/.test(first.vmd || "")
    && second.vmd === target
    && Math.abs(second.duration - first.duration) > 1e-6;
} catch (error) {
  report.errors.push(String(error));
  report.passed = false;
} finally {
  await browser?.close().catch(() => {});
  report.ended = new Date().toISOString();
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks, errors: report.errors }, null, 2));
process.exit(report.passed ? 0 : 1);


