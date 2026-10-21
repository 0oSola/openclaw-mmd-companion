const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.connectOverCDP('ws://172.18.48.1:9223/devtools/browser/803b8da7-fc9a-48e9-87b1-fd0fde056add');
  const context = await browser.newContext();
  const page = await context.newPage();
  
  console.log('Navigating to http://localhost:3100/companion ...');
  await page.goto('http://localhost:3100/companion', { timeout: 30000 });
  console.log('Page loaded, title:', await page.title());
  
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ timeout: 15000 });
  console.log('Canvas found');
  
  const stage = page.getByTestId('mio-stage-wrap');
  const hasStage = await stage.count();
  console.log('Stage found:', hasStage > 0);
  
  await page.screenshot({ path: '/tmp/cdp_test_screenshot.png' });
  console.log('Screenshot saved');
  
  await context.close();
  console.log('Done');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
