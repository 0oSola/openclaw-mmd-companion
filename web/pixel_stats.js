const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1536 }, deviceScaleFactor: 1 });

  const webUrl = "http://127.0.0.1:3100";
  const modelUrl = webUrl + "/twist-tests/model/eula.pmx";
  const renderUrl = webUrl + "/mmd-calibration-render?modelUrl=" + encodeURIComponent(modelUrl) + "&renderPipeline=genshin";
  
  await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mmdCompanionRuntime && window.__mmdCompanionRuntime.model), null, { timeout: 60000 });
  await page.waitForTimeout(3000);

  // Read ALL pixels from the WebGL canvas
  const pixelStats = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    const w = canvas.width;
    const h = canvas.height;
    
    // Force render
    const rt = window.__mmdCompanionRuntime;
    rt.renderer.render(rt.scene, rt.camera);
    
    // Read full framebuffer
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    
    // Sample some pixels at different positions
    const samples = [];
    const positions = [
      [0, 0], [w-1, h-1], [w/2, h/2], [w/4, h/4], [3*w/4, 3*h/4],
      [w/2, 0], [0, h/2], [w/2, h-1]
    ];
    for (const [x, y] of positions) {
      const idx = (y * w + x) * 4;
      samples.push({
        pos: [Math.floor(x), Math.floor(y)],
        rgba: [pixels[idx], pixels[idx+1], pixels[idx+2], pixels[idx+3]]
      });
    }
    
    // Count unique colors
    const colorMap = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      const key = `${pixels[i]},${pixels[i+1]},${pixels[i+2]},${pixels[i+3]}`;
      colorMap.set(key, (colorMap.get(key) || 0) + 1);
    }
    
    // Get top 5 colors
    const topColors = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([color, count]) => ({ color, count, percent: (count / (w*h) * 100).toFixed(2) + "%" }));
    
    return {
      canvasSize: [w, h],
      totalPixels: w * h,
      samples,
      topColors,
      uniqueColors: colorMap.size,
    };
  });
  
  console.log("Pixel stats:", JSON.stringify(pixelStats, null, 2));

  // Also: check what the toDataURL image actually looks like
  // by reading it back as an Image and sampling pixels
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas.toDataURL("image/png");
  });
  
  // Write it locally
  const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  fs.writeFileSync("/Users/sola/.openclaw/workspace/canvas_capture.png", buf);
  console.log("\nSaved canvas to /Users/sola/.openclaw/workspace/canvas_capture.png for inspection");

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
