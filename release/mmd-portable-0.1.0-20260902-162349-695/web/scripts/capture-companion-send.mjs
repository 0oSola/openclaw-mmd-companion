import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const captureState = process.env.CAPTURE_SEND_STATE || "disabled";
const captureRenderPipeline = process.env.CAPTURE_RENDER_PIPELINE || "mio-reference";

await page.addInitScript((renderPipeline) => {
  const key = "mmd_companion_session_v1";
  window.localStorage.setItem(
    key,
    JSON.stringify({ userId: "8X29-AF3E", renderPipeline: renderPipeline }),
  );
}, captureRenderPipeline);

await page.goto("http://127.0.0.1:3200/companion", { waitUntil: "domcontentloaded" });

const sendButton = page.locator(".mio-send");
const inputShell = page.locator(".mio-command-input-shell");
const commandBar = page.locator(".mio-command-bar");
const input = page.locator(".mio-command-input");

await sendButton.waitFor({ state: "visible" });
await page.waitForTimeout(1200);

if (captureState === "default" || captureState === "hover" || captureState === "loading") {
  await input.fill("帮我整理一个需求方案");
  await page.waitForTimeout(200);
}

if (captureState === "hover") {
  await sendButton.hover();
  await page.waitForTimeout(200);
}

if (captureState === "loading") {
  await sendButton.click();
  await page.waitForTimeout(300);
}

const sendBox = await sendButton.boundingBox();
const inputBox = await inputShell.boundingBox();
const barBox = await commandBar.boundingBox();

await page.screenshot({ path: `artifacts/companion-send-full-${captureState}.png`, fullPage: true });
await commandBar.screenshot({ path: `artifacts/companion-send-bar-${captureState}.png` });

console.log(JSON.stringify({ captureState, sendBox, inputBox, barBox }, null, 2));

await browser.close();
