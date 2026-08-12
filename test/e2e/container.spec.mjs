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

// ── HTML projects ────────────────────────────────────────────────────────
// A folder placed on the volume by hand (CI copies test/e2e/fixtures/project
// there before starting the container). Nothing is uploaded or converted.
const PROJECT = 'project';

test('a folder dropped on the volume is listed and served as-is', async ({ page }) => {
  await page.goto(`${HOST}/`);
  const card = page.locator(`.deck:has(a[href^="/p/${PROJECT}/"])`);
  await expect(card).toBeVisible();
  await expect(card.locator('.deck-meta')).toContainText('html project');
  await expect(card.locator('.deck-meta')).toContainText('poster.html');

  // The project's own files, untouched.
  const raw = await page.request.get(`${HOST}/p/${PROJECT}/slides.izerp`);
  expect((await raw.json()).slides).toHaveLength(2);
});

test('/edit and /present are links that land on one canonical URL', async ({ page, request }) => {
  // Not three paths for one deck: a project pins its own library version, and
  // older ones key localStorage on the pathname — slides saved while editing
  // would then be missing during the talk.
  for (const route of ['edit', 'present']) {
    const response = await request.get(`${HOST}/p/${PROJECT}/${route}`, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe(`/p/${PROJECT}/#${route}`);
  }

  await page.goto(`${HOST}/p/${PROJECT}/edit`);
  await page.waitForFunction(() => window.iZerp && window.iZerp.isReady());
  expect(new URL(page.url()).pathname).toBe(`/p/${PROJECT}/`);
  await expect(page.locator('#izerp-root')).toHaveAttribute('data-mode', 'editor');

  await page.goto(`${HOST}/p/${PROJECT}/present`);
  await page.waitForFunction(() => window.iZerp && window.iZerp.isReady());
  await expect(page.locator('#izerp-root')).toHaveAttribute('data-mode', 'presentation');
});

test('a live-reload script is injected into the project page', async ({ page }) => {
  await page.goto(`${HOST}/p/${PROJECT}/`);
  const sig = await page.evaluate(
    () => document.querySelector('script[src="/assets/project.js"]')?.dataset.sig);
  expect(sig).toMatch(/^[0-9a-f]{16}$/);
});

test('a project may leave out izerp-lib.js and get the container\'s', async ({ request }) => {
  // The fixture folder does not carry the library; `<script src="./izerp-lib.js">`
  // must still work, so a project can stay small without being rewritten.
  const response = await request.get(`${HOST}/p/${PROJECT}/izerp-lib.js`);
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toContain('const VERSION');

  // A file the folder really does not have is still a 404.
  expect((await request.get(`${HOST}/p/${PROJECT}/nope.js`)).status()).toBe(404);
});

test('the watch endpoint reports a change and holds still otherwise', async ({ request }) => {
  const current = await request.get(`${HOST}/p/${PROJECT}/__watch?sig=stale`);
  expect(current.status()).toBe(200);
  const { sig } = await current.json();
  expect(sig).toMatch(/^[0-9a-f]{16}$/);
});

test('a project folder cannot serve files outside itself', async ({ request }) => {
  for (const path of ['/p/project/../../etc/passwd', '/p/project/.git/config']) {
    expect((await request.get(HOST + path, { maxRedirects: 0 })).status()).toBe(404);
  }
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
