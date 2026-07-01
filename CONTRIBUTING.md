# Contributing to iZerp

Thanks for your interest in improving iZerp! It's a deliberately small project —
two source files, no build step, no dependencies — so contributing is easy.

## Project shape

| Path                        | What it is                                            |
| --------------------------- | ----------------------------------------------------- |
| `izerp-lib.js`              | The library (camera, slides, storage, UI, events).    |
| `izerp-lib.css`             | The default "Brass & Ink" theme + all CSS variables.  |
| `izerp-fonts.css`           | Optional web-font pack (opt-in).                       |
| `izerp-theme-neutral.css`   | Optional neutral skin / theming starting point.       |
| `examples/`                 | Self-contained demo pages.                             |
| `README.md` / `README.de.md`| English (primary) and German documentation.           |

The library itself has no bundler and no transpiler: `izerp-lib.js` is plain
ES5-compatible browser JavaScript wrapped in an IIFE that exposes `window.iZerp`.
Keep it that way — the "drop in two files" simplicity is the point. The tooling
below (esbuild, tests) is only for the repo, never a runtime dependency.

## Local development

Because slide auto-loading uses `fetch`, serve the folder over HTTP rather than
opening files directly:

```bash
npm install          # dev tooling only (esbuild, jsdom, playwright)
npm start            # python3 -m http.server 8000
# then open http://localhost:8000/examples/basic.html  (or /index.html)
```

(`examples/basic.html` and `index.html` also seed slides via `localStorage`, so
they work over `file://` too.)

### Scripts

| Command             | What it does                                              |
| ------------------- | -------------------------------------------------------- |
| `npm run lint`      | `node --check izerp-lib.js` (syntax).                    |
| `npm test`          | jsdom unit tests (`test/unit/`).                         |
| `npm run test:e2e`  | Playwright e2e against the demo (`test/e2e/`).           |
| `npm run build`     | Regenerate `dist/izerp-lib.min.{js,css}` with esbuild.   |
| `npm run screenshots` | Recapture the README screenshots into `docs/`.         |

If you change `izerp-lib.js` or `izerp-lib.css`, run `npm run build` and commit
the regenerated `dist/` — CI fails if `dist/` is out of sync with the source.

## Before you open a PR

- **Match the surrounding style.** Same naming, comment density, and idiom.
- **Keep it dependency-free and build-free.**
- **Localise user-facing strings** — add keys to *both* the `de` and `en`
  blocks in the `STRINGS` table; never hard-code display text.
- **Theme via variables.** Prefer overriding / adding CSS custom properties on
  `#izerp-root` over hard-coded colours.
- **Sanity-check the JS**: `node --check izerp-lib.js`.
- **Test the flows you touched** by hand in a browser: Editor (set / update /
  reorder / delete slides), Presentation (navigation, laser, notes, timer),
  Settings (colours, language, import/export), and `iZerp.destroy()` +
  re-`init()`.
- Note behavioural changes in `CHANGELOG.md` under an *Unreleased* heading.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, your
browser/OS, and — if you can — a minimal HTML page that reproduces it.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
