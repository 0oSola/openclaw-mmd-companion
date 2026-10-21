const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", m => {
    if (m.type() === "log" || m.type() === "error") console.log(m.type(), m.text());
  });

  const modelUrl = "http://127.0.0.1:3100/twist-tests/model/eula.pmx";
  const vmdUrl = "http://127.0.0.1:3100/twist-tests/twist_rest.vmd";
  const renderUrl = "http://127.0.0.1:3100/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin&vmdUrl=" + encodeURIComponent(vmdUrl);
  
  console.log("Loading page with vmdUrl param...");
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  
  // Wait for VMD to potentially load
  await page.waitForTimeout(5000);
  
  const state = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    return {
      currentVmdUrl: rt.currentVmdUrl || null,
      isLoadingVmd: rt.isLoadingVmd,
      hasCurrentClip: !!rt.currentClip,
      currentVmdAction: rt.currentVmdAction ? "has_value" : null,
    };
  });
  console.log("VMD state:", JSON.stringify(state));
  
  // Check all function props including prototype chain
  const rtMethods = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const allProps = new Set();
    let proto = Object.getPrototypeOf(rt);
    while (proto && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach(n => allProps.add(n));
      proto = Object.getPrototypeOf(proto);
    }
    Object.getOwnPropertyNames(rt).forEach(n => allProps.add(n));
    return Array.from(allProps).filter(n => {
      try { return typeof rt[n] === "function" && n !== "constructor"; } catch { return false; }
    });
  });
  console.log("All methods:", JSON.stringify(rtMethods));
  
  // Check if there's a loadVmdUrl or similar on the page or companion
  const pageFuncs = await page.evaluate(() => {
    const funcs = [];
    for (const k of Object.getOwnPropertyNames(window)) {
      if (typeof window[k] === "function" && (k.toLowerCase().includes("vmd") || k.toLowerCase().includes("load") || k.toLowerCase().includes("mmd"))) {
        funcs.push(k);
      }
    }
    return funcs;
  });
  console.log("Window funcs:", JSON.stringify(pageFuncs));
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
