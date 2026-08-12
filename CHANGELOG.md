# Changelog

All notable changes to iZerp are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] — 2026-08-12

The deck host learns the second way in: a folder that is already an iZerp page,
served live from the volume while you build it with your own toolchain.

### Added

- **HTML projects.** Copy a folder containing an iZerp page into the data
  directory and it appears in the library — never uploaded, never converted,
  served byte for byte including the copy of `izerp-lib.js` the project pins.
  The entry file is `index.html`, or the only `.html` in the folder, or the one
  named by an `izerp.json` (`{"name": …, "entry": …}`). With several HTML files
  and no hint, nothing is guessed and the library says what to add — a Pandoc
  poster repo holds `poster.pdf.html`, `poster.css.html` and `poster.tpl.html`,
  and serving the wrong one looks like a broken project.
- **Live reload.** The page reloads when a file in the project folder changes,
  through a long-poll endpoint and one injected script tag. The container runs
  no build of its own: run `make`, `vite` or Pandoc on the host and the browser
  follows. A change is debounced until the folder holds still, so a build that
  writes a dozen files reloads the page once, not a dozen times.
- **`/p/<slug>/edit` and `/p/<slug>/present`** — the two jobs as two links, for
  PDF decks and HTML projects alike; `/present` is the one to send someone.
  Both redirect to `/p/<slug>/#edit|#present` rather than serving separate
  pages: a project pins its own library version, and older ones key
  `localStorage` on `location.pathname`, so three paths would split one deck
  into three sets of slides. Live reload pauses while a presentation is
  running, however it was started.
- **A project whose page never loads its own `.izerp`** is flagged on the card
  with the one-line fix (`data-slides="slides.izerp"`). Such a deck only ever
  existed in the browser it was authored in, and would otherwise show up here
  as an inexplicably empty presentation.
- **A project need not carry `izerp-lib.js`/`.css`.** If the folder has them
  they are served as-is and the project stays self-contained and version-pinned;
  if it does not, the container serves its own copy at the same URL, so
  `<script src="./izerp-lib.js">` works either way and nothing is rewritten.
  Which copy is in play, and its version, is shown on the card (`library pinned
  1.1` / `library from the container 1.5.0`) — a deck recorded against one
  version and played by another is the kind of difference that surfaces as
  "the zoom is off".
- Directory traversal and dotfiles (`.git`, `.env`) are refused for project
  folders; `IZERP_WATCH_INTERVAL`, `IZERP_WATCH_QUIET`, `IZERP_WATCH_TIMEOUT`
  tune the watcher.

### Changed

- The library's *Present* button uses the `/present` route instead of a
  `#present` fragment, so the mode is decided by the server and the link
  survives being copied.

## [1.4.0] — 2026-08-12

Adds an official way to **host** presentations: a Docker image that turns a PDF
into an iZerp deck. The library itself is unchanged apart from its version
string — the container produces exactly the kind of page iZerp already consumed.

### Added

- **Docker deck host** (`docker/`). A container that serves an upload page,
  renders each PDF page onto one canvas with `pdftoppm`, generates a `.izerp`
  deck (one slide per page plus an overview slide), and serves the result as a
  normal iZerp presentation. Published as `illustratus/izerp` for
  `linux/amd64` and `linux/arm64`.
  - **One volume.** Everything lives under `/data` as plain files — original
    PDF, page images, `deck.izerp`, `meta.json` — so a single mount puts the
    whole archive wherever the user wants it, and backing up is copying a
    folder.
  - **Several presentations, switchable.** A library page lists every deck on
    the volume; a small host bar inside a deck switches between them and steps
    aside for the presentation, editor and settings.
  - **Bring your own slides.** An uploaded `.izerp` is used verbatim; otherwise
    one is generated. A generated deck can be downloaded, edited, re-uploaded,
    or regenerated. The canvas layout is deterministic and documented so a
    hand-written or AI-generated `.izerp` can target it.
  - **Deep link.** `/p/<slug>/#present` starts the talk immediately — the
    library's *Present* button uses it, so a deck is one click from the list.
  - **Fixed storage key per deck** (`data-storage-key`), fingerprinted with the
    deck file, so editing survives a changed host or port and replacing the
    deck actually shows the new one.
  - **Mismatch check.** An uploaded `.izerp` whose camera targets do not land
    on the rendered pages — typically one written for the HTML original or an
    older layout — is flagged on upload and on the deck's card
    (`13/21 slides off-page`) instead of silently producing a deck that frames
    empty canvas. No automatic remapping: printing reflows the layout, so no
    single transform is correct, and a near-miss is harder to spot than an
    obvious one.
  - **Files follow the volume's owner.** On Linux a bind mount keeps its host
    owner while the container writes as root, which left users unable to delete
    their own decks without `sudo`. New decks are handed to the owner of the
    data directory; a root-owned named volume is left untouched.
  - Stdlib-only Python server, no pip dependencies; `IZERP_READ_ONLY`,
    `IZERP_RENDER_WIDTH`, `IZERP_GAP`, `IZERP_TITLE`, `IZERP_LANG`,
    `IZERP_MAX_UPLOAD_MB` for configuration; `/healthz` used as the image's
    `HEALTHCHECK`.
- **Publishing pipeline.** `.github/workflows/docker.yml` builds the image,
  runs `docker/smoke-test.sh` and the container end-to-end suite against a
  running container, and only then pushes to Docker Hub — `:X.Y.Z`, `:X.Y`,
  `:X`, `:latest` from a `vX.Y.Z` tag, `:edge` from `main`. A tag that
  disagrees with `package.json` fails the build.
- **Tests.** `docker/app/test_izerpdeck.py` (canvas layout, fit scale, slug and
  `.izerp` parsing) runs in CI as its own job; `test/e2e/container.spec.mjs`
  drives a real container through upload, playback and error handling.
- **`RELEASING.md`** documenting the release and image-tagging flow.

### Changed

- Version bumped to 1.4 across `package.json`, `izerp-lib.js`, `izerp-lib.css`
  and `izerp.d.ts`. The `.izerp` **format is unchanged** — files written by 1.3
  load in 1.4 and vice versa; the `version` field only records the writer.
- The unit smoke test now reads the expected version from `package.json`
  instead of hard-coding it, so a release bump touches one file fewer.

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

[1.5.0]: https://github.com/Illustratus/iZerp/releases/tag/v1.5.0
[1.4.0]: https://github.com/Illustratus/iZerp/releases/tag/v1.4.0
[1.3.0]: https://github.com/Illustratus/iZerp/releases/tag/v1.3.0
