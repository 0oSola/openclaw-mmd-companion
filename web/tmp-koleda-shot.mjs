import { chromium } from "playwright";

const modelRel = "MMD/克莱妲原皮_by_少女前线2：追放_3801ab976ee72bef4da6543c0f956bb0/克莱妲原皮/GirlsFrontline KoledaDefault.pmx";
const modelAbs = "http://127.0.0.1:8100/assets/mmd/" + modelRel.split("/").map(encodeURIComponent).join("/");
const base = `http://127.0.0.1:3100/mmd-calibration-render?modelUrl=${encodeURIComponent(modelAbs)}&renderPipeline=`;
const outDir = "D:/workspace/MMD project/tmp/k3-shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 720, height: 960 } });
page.on("response", (res) => { if (res.status() >= 400) console.log("[http]", res.status(), res.url().slice(0, 140)); });
page.on("console", (msg) => { if (msg.type() === "error") console.log("[console]", msg.text().slice(0, 200)); });
page.on("pageerror", (err) => console.log("[pageerror]", err.message.slice(0, 200)));

for (const pipeline of ["k3", "classic"]) {
  await page.goto(base + pipeline, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(14000);
  const status = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log(pipeline, "status:", JSON.stringify(status));
  await page.screenshot({ path: `${outDir}/koleda-${pipeline}-before.png` });
}
await browser.close();
