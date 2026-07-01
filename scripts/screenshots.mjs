// scripts/screenshots.mjs — capture real screenshots of iZerp for the README.
//   npm run screenshots
// Drives the showcase index.html in headless Chromium and writes PNGs to
// docs/screenshots/. Uses file:// (the demo seeds slides via localStorage, so
// no server is needed).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const outDir = fileURLToPath(new URL('./docs/screenshots/', ROOT));
mkdirSync(outDir, { recursive: true });
const pageUrl = new URL('./index.html', ROOT).href;

const VIEWPORT = { width: 1600, height: 900 };
const settle = (page, ms = 1100) => page.waitForTimeout(ms); // camera fly + fonts

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });

await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
await page.goto(pageUrl);
await page.waitForFunction(() => window.iZerp && window.iZerp.isReady());
await page.evaluate(() => document.querySelector('.hint')?.remove());
await settle(page, 400);

async function shot(name) {
  const file = `${outDir}${name}.png`;
  await page.screenshot({ path: file });
  console.log('  ✓ ' + name + '.png');
}

// 1. Presentation — hero slide with the rail
await page.evaluate(() => window.iZerp.setMode('presentation'));
await settle(page);
await shot('presentation');

// 2. Presentation — a feature slide with speaker notes open
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight'); // "Present" station has rich notes
await page.keyboard.press('KeyN');       // reveal the speaker sheet
await settle(page);
await shot('speaker-notes');

// 3. The launcher menu
await page.evaluate(() => window.iZerp.setMode('idle'));
await settle(page, 300);
await page.locator('#izerp-fab').click();
await settle(page, 500);
await shot('menu');

// 4. Editor with the slide sidebar
await page.evaluate(() => window.iZerp.setMode('editor'));
await settle(page);
await shot('editor');

await browser.close();
console.log('screenshots written to docs/screenshots/');
