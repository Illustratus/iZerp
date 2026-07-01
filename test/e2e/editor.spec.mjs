import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/deck.izerp', import.meta.url));

test.beforeEach(async ({ page }) => {
  // Clear storage ONCE (not via addInitScript, which would also fire on the
  // in-test reload and wipe the edits we're checking survive), then reload so
  // the demo seeds a clean deck.
  await page.goto('/examples/basic.html');
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload();
  await page.waitForFunction(() => window.iZerp && window.iZerp.isReady());
});

const slideCount = (page) => page.evaluate(() => window.iZerp.getSlides().length);

test('editor: "Set slide" adds a slide to the deck', async ({ page }) => {
  await page.evaluate(() => window.iZerp.setMode('editor'));
  const before = await slideCount(page);
  await page.locator('#izerp-btn-set').click();
  expect(await slideCount(page)).toBe(before + 1);
  await expect(page.locator('.izerp-slide-item')).toHaveCount(before + 1);
});

test('editor: deleting a slide removes it', async ({ page }) => {
  await page.evaluate(() => window.iZerp.setMode('editor'));
  const before = await slideCount(page);
  await page.locator('.izerp-slide-delete').first().click();
  expect(await slideCount(page)).toBe(before - 1);
});

test('editor: edits persist across reload (localStorage wins over the seed)', async ({ page }) => {
  await page.evaluate(() => window.iZerp.setMode('editor'));
  const before = await slideCount(page);
  await page.locator('#izerp-btn-set').click();
  expect(await slideCount(page)).toBe(before + 1);

  await page.reload();
  await page.waitForFunction(() => window.iZerp && window.iZerp.isReady());
  expect(await slideCount(page)).toBe(before + 1); // not re-seeded back to `before`
});

test('settings: switching language rebuilds the UI in the new language', async ({ page }) => {
  await page.evaluate(() => window.iZerp.setMode('settings'));
  await page.locator('.izerp-lang-btn[data-lang="de"]').click();
  await expect(page.locator('.izerp-settings-hd-label')).toHaveText('EINSTELLUNGEN');
  // and no duplicate document listeners crept in — navigation still advances once
  await page.evaluate(() => window.iZerp.setMode('presentation'));
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#izerp-rail-cur')).toHaveText('02');
});

test('settings: "clear all" empties the deck', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await page.evaluate(() => window.iZerp.setMode('settings'));
  await page.locator('#izerp-btn-clear').click();
  await expect.poll(() => slideCount(page)).toBe(0);
});

test('settings: exporting triggers a .izerp download', async ({ page }) => {
  // Force the anchor-download fallback so no OS save dialog blocks the test.
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  await page.evaluate(() => window.iZerp.setMode('settings'));
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#izerp-btn-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.izerp$/);
});

test('settings: importing a .izerp file replaces the deck', async ({ page }) => {
  // Force the <input type=file> fallback so we can drive it via a file chooser.
  await page.evaluate(() => { window.showOpenFilePicker = undefined; });
  await page.evaluate(() => window.iZerp.setMode('settings'));
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#izerp-btn-import').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(FIXTURE);
  await expect.poll(() => slideCount(page)).toBe(2);
  const titles = await page.evaluate(() => window.iZerp.getSlides().map(s => s.title));
  expect(titles).toEqual(['Imported one', 'Imported two']);
});
