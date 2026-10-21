const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", m => {
    if (m.type() === "log" || m.type() === "error") console.log(m.type(), m.text());
  });

  const modelUrl = "http://127.0.0.1:3100/twist-tests/model/eula.pmx";
  const renderUrl = "http://127.0.0.1:3100/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  
  // Check how VMD loading works - look for vmdUrl param
  const vmdTestUrl = "http://127.0.0.1:3100/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin&vmdUrl=" + encodeURIComponent("http://127.0.0.1:3100/twist-tests/twist_rest.vmd");
  console.log("Testing with vmdUrl param...");
  
  const page2 = await browser.newPage();
  page2.on("console", m => {
    if (m.type() === "log" || m.type() === "error") console.log("p2:", m.type(), m.text());
  });
  await page2.goto(vmdTestUrl, { waitUntil: "domcontentloaded" });
  await page2.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  
  // Wait a bit for VMD to load
  await page2.waitForTimeout(3000);
  
  const state = await page2.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    return {
      currentVmdUrl: rt.currentVmdUrl,
      isLoadingVmd: rt.isLoadingVmd,
      hasCurrentClip: !!rt.currentClip,
      currentVmdAction: rt.currentVmdAction,
    };
  });
  console.log("VMD state after vmdUrl param:", JSON.stringify(state));
  
  // Also check: maybe there's a global function or the companion page has a loadVmd method
  const globalFuncs = await page2.evaluate(() => {
    const funcs = [];
    for (const k of Object.keys(window)) {
      if (k.toLowerCase().includes("vmd") || k.toLowerCase().includes("mmd") || k.toLowerCase().includes("load")) {
        funcs.push(k + ": " + typeof window[k]);
      }
    }
    return funcs;
  });
  console.log("Global VMD/load funcs:", JSON.stringify(globalFuncs));
  
  // Check if the runtime has a method to load VMD by URL that we missed
  const rtMethods = await page2.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    // Get ALL properties including prototype
    const allProps = [];
    let proto = Object.getPrototypeOf(rt);
    while (proto && proto !== Object.prototype) {
      allProps.push(...Object.getOwnPropertyNames(proto).filter(n => n !== "constructor"));
      proto = Object.getPrototypeOf(proto);
    }
    allProps.push(...Object.getOwnPropertyNames(rt));
    return allProps.filter(n => {
      try { return typeof rt[n] === "function"; } catch { return false; }
    });
  });
  console.log("All function props (incl prototype):", JSON.stringify(rtMethods));
  
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
