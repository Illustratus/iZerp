// Unit smoke tests for izerp-lib.js, run under jsdom.
//   npm test   (node --test test/unit/)
//
// These exercise the risky, DOM-mutating parts in isolation: init/wrapping,
// config resolution from all three sources, persistence gating, destroy()
// teardown + re-init, the double-init guard, sub-container targeting, and
// runtime language registration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const LIB = readFileSync(fileURLToPath(new URL('../../izerp-lib.js', import.meta.url)), 'utf8');

// Boot a fresh jsdom document with iZerp loaded via an inline <script> (so
// document.currentScript — and thus data-* config — resolve correctly).
function boot({ body = '<div id="content-a">A</div><div id="content-b">B</div>', head = '', data = {} } = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`,
    { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/deck', virtualConsole: vc }
  );
  const doc = dom.window.document;
  const s = doc.createElement('script');
  for (const [k, v] of Object.entries(data)) s.setAttribute(k, v);
  s.textContent = LIB;
  doc.body.appendChild(s);
  // jsdom keeps readyState === 'loading' for appended scripts, so the auto-init
  // DOMContentLoaded listener never fires — trigger init() manually (identical
  // to the data-auto-init="false" path / a real browser firing DOMContentLoaded).
  if (dom.window.iZerp && !dom.window.iZerp.isReady()) dom.window.iZerp.init();
  assert.equal(errors.length, 0, 'no jsdom script errors: ' + errors.map(e => e.detail).join('; '));
  return dom;
}

const PKG_MAJOR_MINOR = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
).version.split('.').slice(0, 2).join('.');

test('default drop-in init wraps content and exposes the API', () => {
  const { window: w } = boot();
  const doc = w.document;
  assert.ok(w.iZerp, 'window.iZerp exists');
  // Read from package.json so a release bump touches one file, not three.
  assert.equal(w.iZerp.version, PKG_MAJOR_MINOR);
  assert.ok(doc.getElementById('izerp-canvas-wrap'), 'canvas wrap created');
  assert.ok(doc.querySelector('#izerp-canvas-wrap #content-a'), 'content A wrapped');
  assert.ok(doc.querySelector('#izerp-canvas-wrap #content-b'), 'content B wrapped');
  assert.ok(doc.getElementById('izerp-root'), 'overlay root created');
  assert.equal(doc.getElementById('izerp-root').dataset.fab, 'true', 'FAB visible by default');
  assert.equal(w.iZerp.isReady(), true);
  for (const k of ['init', 'destroy', 'getSlides', 'getConfig', 'isReady', 'setMode', 'on', 'off', 'registerLanguage']) {
    assert.equal(typeof w.iZerp[k], 'function', `API has ${k}()`);
  }
});

test('config via window.iZerpConfig (lang + boolean coercion)', () => {
  const { window: w } = boot({ head: `<script>window.iZerpConfig = { lang: 'de', fab: false };</script>` });
  const cfg = w.iZerp.getConfig();
  assert.equal(cfg.lang, 'de');
  assert.equal(cfg.fab, false, 'fab coerced to boolean false');
  assert.equal(w.document.getElementById('izerp-root').dataset.fab, 'false', 'FAB hidden');
});

test('config via data-* attributes with string coercion', () => {
  const { window: w } = boot({ data: { 'data-fab': 'false', 'data-storage-key': 'shared', 'data-persist': 'off' } });
  const cfg = w.iZerp.getConfig();
  assert.equal(cfg.fab, false);
  assert.equal(cfg.storageKey, 'shared');
  assert.equal(cfg.persist, false, 'data-persist="off" → false');
});

test('persist=false does not write slides to localStorage', () => {
  const { window: w } = boot({ head: `<script>window.iZerpConfig = { persist: false, storageKey: 'x' };</script>` });
  assert.equal(w.localStorage.getItem('izerp:slides:x'), null);
});

test('destroy() restores the DOM and re-init works', () => {
  const { window: w } = boot();
  const doc = w.document;
  let destroyed = false;
  doc.addEventListener('izerp:destroy', () => { destroyed = true; });

  w.iZerp.destroy();
  assert.ok(!doc.getElementById('izerp-root'), 'root removed');
  assert.ok(!doc.getElementById('izerp-canvas-wrap'), 'canvas wrap removed');
  assert.ok(!doc.getElementById('izerp-global-styles'), 'injected styles removed');
  assert.ok(doc.body.querySelector(':scope > #content-a'), 'content restored to body');
  assert.equal(destroyed, true, 'izerp:destroy event fired');
  assert.equal(w.iZerp.isReady(), false);

  const again = w.iZerp.init();
  assert.equal(again, w.iZerp, 're-init returns iZerp');
  assert.ok(doc.getElementById('izerp-root'), 'root re-created');
  assert.equal(w.iZerp.isReady(), true);
});

test('double-init is guarded and warns', () => {
  const { window: w } = boot();
  const warns = [];
  const orig = w.console.warn;
  w.console.warn = (...a) => warns.push(a.join(' '));
  const r = w.iZerp.init();
  w.console.warn = orig;
  assert.ok(warns.some(x => /already initialised/i.test(x)), 'warned about repeat init');
  assert.equal(r, w.iZerp);
});

test('data-target wraps a sub-container, not the whole body', () => {
  const { window: w } = boot({
    body: '<header id="keep">nav</header><main id="stage"><p id="inside">x</p></main>',
    data: { 'data-target': '#stage' },
  });
  const doc = w.document;
  assert.ok(doc.querySelector('#stage > #izerp-canvas-wrap'), 'wrap inside #stage');
  assert.ok(doc.querySelector('#stage #izerp-canvas-wrap #inside'), '#inside moved into wrap');
  assert.ok(doc.body.querySelector(':scope > #keep'), '#keep left untouched');
});

test('custom language via config.languages is selectable and falls back per key', () => {
  const { window: w } = boot({
    head: `<script>window.iZerpConfig = { lang: 'fr', languages: { fr: { editorLabel: 'Éditeur', langLabel: 'Français' } } };</script>`,
  });
  assert.equal(w.iZerp.getConfig().lang, 'fr');
  // Registered custom label is used…
  assert.ok(w.document.body.textContent.includes('Éditeur'), 'custom French label rendered');
  // …a key NOT provided in the partial dict falls back to English, never a raw key…
  const modeDescs = [...w.document.querySelectorAll('.izerp-mode-desc')].map(e => e.textContent);
  assert.ok(modeDescs.some(t => /slide/i.test(t)), 'missing keys fall back to English');
  // …and the language picker renders a button for the custom language.
  const langButtons = [...w.document.querySelectorAll('.izerp-lang-btn')].map(b => b.dataset.lang);
  assert.ok(langButtons.includes('fr'), 'custom language has a picker button');
  const frBtn = w.document.querySelector('.izerp-lang-btn[data-lang="fr"]');
  assert.equal(frBtn.textContent, 'Français', 'langLabel used for the button');
});

test('destroy() mid-presentation tears down cleanly (timer running)', () => {
  const { window: w } = boot();
  w.iZerp.setMode('presentation');   // starts the timer, flies to slide 0
  assert.equal(w.document.getElementById('izerp-root').dataset.mode, 'presentation');
  // Should not throw with a live timer / presentation state.
  assert.doesNotThrow(() => w.iZerp.destroy());
  assert.ok(!w.document.getElementById('izerp-root'), 'root removed');
  assert.ok(!w.document.body.classList.contains('izerp-pres-active'), 'body class cleared');
  assert.equal(w.iZerp.isReady(), false);
  // …and it can be brought back up.
  w.iZerp.init();
  assert.ok(w.document.getElementById('izerp-root'), 're-init after mid-presentation destroy');
});

test('a screen-reader live region exists for slide announcements', () => {
  const { window: w } = boot();
  const live = w.document.getElementById('izerp-live');
  assert.ok(live, '#izerp-live present');
  assert.equal(live.getAttribute('aria-live'), 'polite');
});
