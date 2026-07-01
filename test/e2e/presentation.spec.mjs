import { test, expect } from '@playwright/test';

// Drive the real example deck through a real browser: init → menu → present →
// navigate → laser → exit. Complements the jsdom unit tests (which can't do
// layout, CSS transitions, or key handling end to end).

test.beforeEach(async ({ page }) => {
  // Start each test from a clean slate so the seed runs deterministically.
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.goto('/examples/basic.html');
  await page.waitForFunction(() => window.iZerp && window.iZerp.isReady());
});

test('example deck initialises with the seeded slides', async ({ page }) => {
  const total = await page.evaluate(() => window.iZerp.getSlides().length);
  expect(total).toBe(5); // 4 stations + overview
  await expect(page.locator('#izerp-fab')).toBeVisible();
  await expect(page.locator('#izerp-canvas-wrap')).toHaveCount(1);
});

test('menu opens and presentation mode shows the rail', async ({ page }) => {
  await page.locator('#izerp-fab').click();
  await expect(page.locator('#izerp-menu-overlay')).toHaveClass(/izerp-visible/);

  await page.locator('.izerp-mode-btn[data-target="presentation"]').click();
  const rail = page.locator('#izerp-rail');
  await expect(rail).toBeVisible();
  await expect(page.locator('#izerp-rail-cur')).toHaveText('01');
});

test('keyboard navigation advances slides', async ({ page }) => {
  await page.evaluate(() => window.iZerp.setMode('presentation'));
  await expect(page.locator('#izerp-rail-cur')).toHaveText('01');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#izerp-rail-cur')).toHaveText('02');

  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#izerp-rail-cur')).toHaveText('01');

  // slidechange events reach the host and match the API index.
  const idx = await page.evaluate(() => window.iZerp.getCurrentIndex());
  expect(idx).toBe(0);
});

test('holding Space shows the laser pointer, releasing hides it', async ({ page }) => {
  await page.evaluate(() => window.iZerp.setMode('presentation'));
  await page.mouse.move(400, 300);
  await page.keyboard.down('Space');
  await expect(page.locator('#izerp-laser')).toHaveClass(/izerp-visible/);
  await page.keyboard.up('Space');
  await expect(page.locator('#izerp-laser')).not.toHaveClass(/izerp-visible/);
});

test('a horizontal swipe/drag navigates the deck', async ({ page }) => {
  // Exercises the pointer-swipe path (identical for touch and mouse pointers).
  await page.evaluate(() => window.iZerp.setMode('presentation'));
  await expect(page.locator('#izerp-rail-cur')).toHaveText('01');
  const vp = page.viewportSize();
  const y = Math.round(vp.height / 2);
  await page.mouse.move(vp.width * 0.72, y);
  await page.mouse.down();
  await page.mouse.move(vp.width * 0.18, y, { steps: 6 }); // fast leftward flick
  await page.mouse.up();
  await expect(page.locator('#izerp-rail-cur')).toHaveText('02');
});

test('Escape exits presentation back to idle', async ({ page }) => {
  await page.evaluate(() => window.iZerp.setMode('presentation'));
  await expect(page.locator('#izerp-pres-overlays')).toHaveClass(/izerp-visible/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#izerp-pres-overlays')).not.toHaveClass(/izerp-visible/);
});
