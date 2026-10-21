const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", m => console.log(m.type(), m.text()));
  const modelUrl = "http://127.0.0.1:3100/twist-tests/model/eula.pmx";
  const renderUrl = "http://127.0.0.1:3100/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  const keys = await page.evaluate(() => Object.keys(window.__mmdCompanionRuntime));
  console.log("runtime keys:", JSON.stringify(keys));
  const info = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const result = {};
    for (const k of Object.keys(rt)) { result[k] = typeof rt[k]; }
    return result;
  });
  console.log("runtime types:", JSON.stringify(info, null, 2));
  const parseInfo = await page.evaluate(async () => {
    const rt = window.__mmdCompanionRuntime;
    try {
      const resp = await fetch("/twist-tests/twist_rest.vmd");
      const buf = new Uint8Array(await resp.arrayBuffer());
      console.log("VMD fetched, bytes:", buf.length);
      const parserCandidates = [rt._parser, rt.parser, rt.vmdParser, rt.mmdParser].filter(Boolean);
      let parseResult = null;
      for (const p of parserCandidates) {
        try {
          const r = p.parseVmd ? p.parseVmd(buf) : (p.parse ? p.parse(buf) : null);
          parseResult = r;
          console.log("Parser found:", p.constructor ? p.constructor.name : typeof p, "result:", r ? "ok" : "null");
          break;
        } catch(e) { console.log("Parser error:", e.message); }
      }
      if (!parseResult) {
        const methods = Object.keys(rt).filter(k => typeof rt[k] === "function");
        console.log("Methods:", JSON.stringify(methods));
        return { error: "no parser found", methods };
      }
      return { ok: true, motions: parseResult.motions ? parseResult.motions.length : 0 };
    } catch(e) { return { error: e.message }; }
  });
  console.log("parse info:", JSON.stringify(parseInfo));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
