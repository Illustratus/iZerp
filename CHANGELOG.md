# Changelog

All notable changes to iZerp are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-07-01

First public release. Generalised from an internal tool into a drop-in library.

### Added

- **Touch & pen input.** Unified Pointer Events: one-finger pan, two-finger
  pinch-to-zoom, and a horizontal swipe to navigate in presentation mode. The
  stage claims `touch-action` so the page underneath doesn't scroll/zoom.
- **Container mode.** `data-target` now scopes iZerp to a chosen element with
  container-relative camera math and the overlay mounted inside it (not just a
  fullscreen layer).
- **Accessibility.** Focus is moved into and trapped within the menu/settings
  dialogs and restored on close; slide changes are announced through a polite
  ARIA live region.
- **TypeScript types** (`izerp.d.ts`) covering the API, config and event map.
- **Console teleprompter.** Slide notes are logged to the console on every
  change; undock DevTools into a separate window to read them while sharing only
  the presentation window.
- **Configuration API.** Three merge sources (precedence: `window.iZerpConfig`
  → `data-*` attributes → `iZerp.init(options)`): `slides`, `lang`,
  `storageKey`, `persist`, `fab`, `target`, `autoInit`, `languages`.
- **`iZerp.init(options)`** for programmatic / deferred initialisation
  (`data-auto-init="false"`), and a **double-init guard**.
- **`iZerp.destroy()`** — removes every listener and injected node and
  un-wraps the canvas, restoring the host DOM. Safe to re-`init()` afterwards.
- **`iZerp.getConfig()`** and **`iZerp.isReady()`** introspection helpers.
- **`data-target`** — scope the canvas to a chosen element instead of `<body>`.
- **`data-storage-key`** — pin a deck to a fixed key so it survives renames
  or is shared across URLs.
- **`data-persist="false"`** — in-memory mode (e.g. `data-slides`-only embeds).
- **`data-fab="false"`** — hide the launcher button and drive iZerp via the API.
- Optional **`izerp-fonts.css`** (restores the Fraunces / Hanken Grotesk /
  JetBrains Mono web-font look) and **`izerp-theme-neutral.css`** (a restrained
  graphite skin).
- **Runtime i18n** — `iZerp.registerLanguage(code, dict)` and a `languages`
  config option add or override UI languages without editing the source; missing
  keys now fall back to English per key (not to the raw key name).
- **`examples/basic.html`** — a minimal, self-contained demo.
- **Showcase `index.html`** — a polished demo deck, deployed to GitHub Pages.
- **Minified build** — `npm run build` (esbuild) emits `dist/izerp-lib.min.js`
  and `dist/izerp-lib.min.css`; jsDelivr / unpkg point at the minified JS.
- **Tests & CI** — jsdom unit tests (`npm test`) and a Playwright e2e smoke test
  (`npm run test:e2e`), wired into a GitHub Actions workflow (lint · unit · build
  · e2e) plus a Pages deploy workflow.
- English `README.md` (primary) alongside the German `README.de.md` — kept
  content-congruent, both with screenshots.
- MIT `LICENSE`, `package.json` (CDN-ready via unpkg / jsDelivr), `CONTRIBUTING.md`.

### Changed
- **No external requests by default.** `izerp-lib.css` no longer `@import`s
  Google Fonts; it falls back to a system font stack. Restore the original
  typography with the opt-in `izerp-fonts.css`.
- **Fully themeable via variables.** Glows/shadows now use RGB-channel custom
  properties (`--brass-rgb`, `--paper-rgb`, …), so a theme retints the whole
  look, not just the solid fills. `izerp-theme-neutral.css` updated to match.
- The settings language picker renders a button for **every** registered
  language (built-in or added via `config.languages`), not just de/en.
- All CSS colours and fonts are documented, overridable custom properties on
  `#izerp-root`.

### Fixed
- Switching language no longer stacks duplicate document-level event listeners
  (global listeners are now bound once; only element handlers rebind).
- Remaining hard-coded German UI strings are now localised (`toastImported`,
  update-button tooltip).

[1.3.0]: https://github.com/Illustratus/iZerp/releases/tag/v1.3.0
