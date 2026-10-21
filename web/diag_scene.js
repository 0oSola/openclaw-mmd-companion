const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.waitForTimeout(2000);

  // Check: what if we create a NEW WebGL context with preserveDrawingBuffer:true
  // and re-render?
  const result = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const oldCanvas = document.querySelector("canvas");
    if (!oldCanvas) return { error: "no canvas" };
    
    // Get the old renderer's params
    const oldGl = oldCanvas.getContext("webgl2") || oldCanvas.getContext("webgl");
    const oldAttrs = oldGl.getContextAttributes();
    
    // Create new canvas with preserveDrawingBuffer
    const newCanvas = document.createElement("canvas");
    newCanvas.width = oldCanvas.width;
    newCanvas.height = oldCanvas.height;
    
    // Get WebGL context with preserveDrawingBuffer
    const newGl = newCanvas.getContext("webgl2", {
      ...oldAttrs,
      preserveDrawingBuffer: true,
    }) || newCanvas.getContext("webgl", {
      ...oldAttrs,
      preserveDrawingBuffer: true,
    });
    
    if (!newGl) return { error: "no new gl" };
    
    // We can't just swap contexts on three.js renderer
    // But we CAN try: use the existing renderer but with a trick
    // Actually let's try something simpler - draw the old canvas onto a new 2D canvas
    // This works because canvas.toDataURL already works
    
    // Actually, the real question is: does renderer.render() actually produce pixels?
    // Let's check the framebuffer directly
    const gl = oldGl;
    
    // Check: is there a render target / FBO being used?
    // If three.js renders to a framebuffer texture, the default framebuffer might be empty
    let fbBinding = null;
    try {
      fbBinding = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    } catch(e) {}
    
    // Force render and immediately check
    rt.renderer.render(rt.scene, rt.camera);
    
    // Check if there's a bound framebuffer
    let fbAfter = null;
    try {
      fbAfter = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    } catch(e) {}
    
    return {
      oldAttrs,
      fbBinding: fbBinding ? "has_fbo" : "null",
      fbAfter: fbAfter ? "has_fbo" : "null",
      // Check scene children
      sceneChildren: rt.scene.children.length,
      sceneChildTypes: rt.scene.children.map(c => c.type + ":" + (c.name || "unnamed")),
      // Check if model is in scene
      modelInScene: rt.scene.children.some(c => {
        let found = false;
        c.traverse(obj => { if (obj === rt.model) found = true; });
        return found;
      }),
    };
  });
  console.log("Render diagnosis:", JSON.stringify(result, null, 2));

  // If model is NOT in scene, that's the problem
  // Let's check where the model actually lives
  const modelLocation = await page.evaluate(() => {
    const rt = window.__mmdCompanionRuntime;
    const model = rt.model;
    
    // Check if model is in scene graph
    let inScene = false;
    rt.scene.traverse(obj => {
      if (obj === model) inScene = true;
    });
    
    // Check model parent
    const parent = model.parent;
    
    // Check container
    const container = rt.container;
    let containerInScene = false;
    rt.scene.traverse(obj => {
      if (obj === container) containerInScene = true;
    });
    
    return {
      modelInScene: inScene,
      modelParent: parent ? parent.type + ":" + (parent.name || "unnamed") : "null",
      containerInScene: containerInScene,
      containerParent: container && container.parent ? container.parent.type + ":" + (container.parent.name || "unnamed") : "null",
      sceneChildCount: rt.scene.children.length,
      sceneChildren: rt.scene.children.map(c => c.type + ":" + (c.name || "unnamed")),
    };
  });
  console.log("Model location:", JSON.stringify(modelLocation, null, 2));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
