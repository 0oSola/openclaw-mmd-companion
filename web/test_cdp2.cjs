const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.connectOverCDP('ws://172.18.48.1:9223/devtools/browser/803b8da7-fc9a-48e9-87b1-fd0fde056add');
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  
  const page = await context.newPage();
  
  // Set localStorage before navigating
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "playwright-user", renderPipeline: "classic" }),
    );
  });
  
  console.log('Navigating to http://localhost:3100/companion ...');
  await page.goto('http://localhost:3100/companion', { timeout: 30000, waitUntil: 'domcontentloaded' });
  console.log('Page loaded, title:', await page.title());
  
  // Wait for canvas
  try {
    await page.locator('canvas').first().waitFor({ timeout: 15000 });
    console.log('Canvas found!');
    
    const stage = page.getByTestId('mio-stage-wrap');
    const hasStage = await stage.count();
    console.log('Stage found:', hasStage > 0);
    
    const status = page.locator('.mio-stage-status').first();
    const hasStatus = await status.count();
    if (hasStatus > 0) {
      console.log('Status:', await status.textContent());
    }
  } catch(e) {
    console.log('Canvas/stage check:', e.message.substring(0, 100));
  }
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/cdp_test_screenshot.png', fullPage: true });
  console.log('Screenshot saved to /tmp/cdp_test_screenshot.png');
  
  // Get console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  
  await page.waitForTimeout(3000);
  if (errors.length > 0) {
    console.log('Console errors:', errors.slice(0, 5));
  }
  
  await context.close();
  console.log('Done');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
