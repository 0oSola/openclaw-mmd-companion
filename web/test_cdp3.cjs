const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.connectOverCDP('ws://172.18.48.1:9223/devtools/browser/803b8da7-fc9a-48e9-87b1-fd0fde056add');
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "playwright-user", renderPipeline: "classic" }),
    );
  });
  
  console.log('Navigating to http://localhost:3100/companion ...');
  await page.goto('http://localhost:3100/companion', { timeout: 30000, waitUntil: 'domcontentloaded' });
  console.log('Page loaded, title:', await page.title());
  
  try {
    const stage = page.getByTestId('mio-stage-wrap');
    await stage.waitFor({ timeout: 10000 });
    console.log('Stage found!');
    
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ timeout: 15000 });
    console.log('Canvas found!');
    
    const status = page.locator('.mio-stage-status').first();
    const hasStatus = await status.count();
    if (hasStatus > 0) {
      console.log('Status:', await status.textContent());
    }
  } catch(e) {
    console.log('Stage/canvas check:', e.message.substring(0, 200));
  }
  
  await page.screenshot({ path: '/tmp/cdp_test3_screenshot.png' });
  console.log('Screenshot saved');
  
  await context.close();
  console.log('Done');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
