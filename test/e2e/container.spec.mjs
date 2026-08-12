import { readFileSync } from 'node:fs';
import { test, expect, request as apiRequest } from '@playwright/test';

// End-to-end for the Docker deck host (docker/): a PDF goes in through the
// upload form, and a real presentation must come out — same library, same
// keys, same rail. Runs only when a host is pointed at:
//
//   docker run -d -p 8099:8080 -v "$(mktemp -d):/data" izerp:dev
//   IZERP_HOST_URL=http://localhost:8099 npm run test:e2e -- container
//
// CI does exactly this in the "container" job.

const HOST = process.env.IZERP_HOST_URL;
const PDF_PATH = new URL('./fixtures/sample.pdf', import.meta.url);
const PDF = { name: 'sample.pdf', mimeType: 'application/pdf', buffer: readFileSync(PDF_PATH) };

test.skip(!HOST, 'set IZERP_HOST_URL to run the container e2e tests');

// One worker for this file: the tests share one server and one volume, and a
// second worker re-running beforeAll would delete the deck the first worker is
// still reading.
test.describe.configure({ mode: 'serial' });

const SLUG = 'e2e-deck';        // seeded here, read by most tests
const FORM_SLUG = 'e2e-form';   // written by the upload-form test only

// Seed through the API so the read-only tests do not depend on each other and
// can still run in parallel.
test.beforeAll(async () => {
  const api = await apiRequest.newContext({ baseURL: HOST });
  for (const slug of [SLUG, FORM_SLUG]) await api.post(`/p/${slug}/delete`);
  await api.post('/upload', { multipart: { name: 'E2E Deck', pdf: PDF } });
  await api.dispose();
});

test('the upload form turns a PDF into a listed presentation', async ({ page }) => {
  await page.goto(`${HOST}/`);
  await page.fill('input[name="name"]', 'E2E Form');
  await page.setInputFiles('input[name="pdf"]', PDF);
  await page.click('button[type="submit"]');

  await expect(page.locator('.banner')).toContainText('3 pages');
  await expect(page.locator('.banner')).not.toHaveClass(/banner-warn/);
  await expect(page.locator(`.deck a[href="/p/${FORM_SLUG}/"]`).first()).toBeVisible();
});

test('the generated page is an ordinary iZerp deck', async ({ page }) => {
  await page.goto(`${HOST}/p/${SLUG}/`);
  await page.waitForFunction(() => window.iZerp && window.iZerp.isReady());

  // One slide per page plus the overview.
  expect(await page.evaluate(() => window.iZerp.getSlides().length)).toBe(4);
  await expect(page.locator('img.izerp-page')).toHaveCount(3);
  await expect(page.locator('#izerp-fab')).toBeVisible();

  // Every slide must fit the reference view it was captured in.
  const slides = await page.evaluate(() => window.iZerp.getSlides());
  for (const slide of slides) {
    expect(slide.vw).toBe(1920);
    expect(slide.vh).toBe(1080);
    expect(slide.scale).toBeGreaterThan(0);
  }
});

test('the host bar sits outside the zoomable canvas', async ({ page }) => {
  await page.goto(`${HOST}/p/${SLUG}/`);
  await page.waitForFunction(() => !!document.getElementById('izerp-host'));

  // Inside #izerp-canvas-wrap it would zoom away with the slides.
  expect(await page.evaluate(
    () => !!document.querySelector('#izerp-canvas-wrap #izerp-host'))).toBe(false);

  // And it must be reachable before iZerp's own chrome.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#izerp-host')))
    .toBe(true);
});

test('"Present" from the library starts the talk in one click', async ({ page }) => {
  await page.goto(`${HOST}/`);
  await page.locator(`.deck:has(a[href^="/p/${SLUG}/"]) a.btn-primary`).click();
  await page.waitForFunction(() => window.iZerp && window.iZerp.isReady());

  await expect(page.locator('#izerp-root')).toHaveAttribute('data-mode', 'presentation');
  await expect(page.locator('#izerp-rail-cur')).toHaveText('01');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#izerp-rail-cur')).toHaveText('02');

  // The host bar steps aside during a talk, like iZerp's own FAB.
  await expect(page.locator('#izerp-host')).toHaveClass(/izerp-host-away/);
});

test('the deck file is served and is valid .izerp JSON', async ({ request }) => {
  const response = await request.get(`${HOST}/p/${SLUG}/deck.izerp`);
  expect(response.ok()).toBeTruthy();
  const deck = await response.json();
  expect(Array.isArray(deck.slides)).toBe(true);
  expect(deck.slides[0]).toMatchObject({ vw: 1920, vh: 1080 });
});

test('a non-PDF is refused with a sentence, not a stack trace', async ({ page }) => {
  await page.goto(`${HOST}/`);
  await page.setInputFiles('input[name="pdf"]', {
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a pdf'),
  });
  await page.click('button[type="submit"]');

  const banner = page.locator('.banner');
  await expect(banner).toHaveClass(/banner-warn/);
  await expect(banner).toContainText('not a PDF');
});
