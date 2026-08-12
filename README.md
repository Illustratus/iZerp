# iZerp — Guide & File Format

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-c69a4c.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/dependencies-none-c69a4c.svg" alt="No dependencies">
  <img src="https://img.shields.io/badge/build-not%20required-c69a4c.svg" alt="No build step">
  <img src="https://img.shields.io/badge/types-included-c69a4c.svg" alt="TypeScript types included">
  <a href="https://hub.docker.com/r/illustratus/izerp"><img src="https://img.shields.io/docker/v/illustratus/izerp?label=docker&color=c69a4c" alt="Docker image"></a>
</p>

> 🌐 **Language:** English (this file) · [Deutsch](README.de.md)
> Both versions are equivalent in content — the same sections, the same depth,
> just in different languages.

**iZerp** turns any HTML page into a zoom-and-pan, Prezi-style presentation.
Content is placed freely on a large surface (the "canvas"); individual views are
saved as **slides** and played back in sequence. The smooth camera move between
slides creates the Prezi effect.

![iZerp in presentation mode](docs/screenshots/presentation.png)

<p align="center">
  <img src="docs/screenshots/editor.png" width="49%" alt="Editor with the slide sidebar">
  &nbsp;
  <img src="docs/screenshots/menu.png" width="49%" alt="The launcher menu">
</p>

<p align="center"><strong>▶ <a href="https://illustratus.github.io/iZerp/">Live demo</a></strong> · two files, no build, no dependencies, no external requests</p>

At its core iZerp is **two files** plus its own file format:

| File                      | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `izerp-lib.css`           | Look of the UI (default "Brass & Ink" theme)               |
| `izerp-lib.js`            | Logic: camera, slides, storage, import/export              |
| `*.izerp`                 | Interchange format for slides + settings (JSON)            |
| `izerp-fonts.css`         | **optional** — restores the original web-font look         |
| `izerp-theme-neutral.css` | **optional** — neutral skin / starting point for theming   |

This guide describes iZerp **generally**. Section 8 fully specifies the `.izerp`
format; section 9 shows how an **AI** can generate a presentation from it
**automatically**; section 12 covers the **Docker image** that turns a PDF into a
hosted presentation without writing any HTML.

---

## 1. Embedding

Two lines are enough. The script **automatically** wraps the entire body content
into a zoomable surface.

```html
<!DOCTYPE html>
<html lang="en">            <!-- lang seeds the UI language (de/en) -->
<head>
  <link rel="stylesheet" href="izerp-lib.css">
</head>
<body>

  <!-- Any content, positioned freely (see section 9) -->

  <script src="izerp-lib.js"></script>   <!-- LAST, before </body> -->
</body>
</html>
```

> The `<script>` must come **after** the content so it can be wrapped on load.

On start, an **iZerp button** (FAB) appears at the bottom left, opening the menu.

### Fonts — no external request

`izerp-lib.css` loads **no** web fonts and makes **no** network request. The
default is a system font stack. The original "Brass & Ink" look (Fraunces /
Hanken Grotesk / JetBrains Mono) is **opt-in**: include `izerp-fonts.css`
**after** `izerp-lib.css` — or override the variables `--p-display` / `--p-body`
/ `--p-mono` yourself (see section 5 → Theming).

### Configuration (`data-*`, `window.iZerpConfig`, `iZerp.init`)

iZerp starts with no configuration. You can customize it via three equivalent
sources (precedence, later wins): `window.iZerpConfig` → `data-*` on the script
tag → `iZerp.init(options)`.

| Option       | `data-*`            | Meaning                                                            |
| ------------ | ------------------- | ----------------------------------------------------------------- |
| `slides`     | `data-slides`       | URL of a `.izerp` file used as the default deck (http[s]).        |
| `lang`       | `data-lang`         | `de` \| `en` \| `auto` (default `auto`).                          |
| `storageKey` | `data-storage-key`  | Fixed storage key instead of per-URL (survives renames).          |
| `persist`    | `data-persist`      | `false` → never write to localStorage (in-memory only).           |
| `fab`        | `data-fab`          | `false` → hide the FAB, drive iZerp via the API.                  |
| `target`     | `data-target`       | CSS selector of the element to wrap (default `<body>`).           |
| `autoInit`   | `data-auto-init`    | `false` → don't start automatically; call `iZerp.init()` yourself.|
| `languages`  | *(object only)*     | Add/override UI languages: `{ code: { …strings } }`. See section 5.|

```html
<!-- Example: force English, hide the FAB, use a fixed key -->
<script src="izerp-lib.js"
        data-lang="en" data-fab="false" data-storage-key="my-deck"></script>
```

### Auto-loading slides (`data-slides`)

Slides can live in a companion `.izerp` file and be loaded **automatically** via
an attribute on the script tag:

```html
<script src="izerp-lib.js" data-slides="slides.izerp"></script>
```

iZerp loads the file on start and uses it as the **default deck**. Rules:

- It is loaded **only if this page has no slides of its own yet** (in
  localStorage). As soon as you change something in the editor, the stored slides
  win — the file is then ignored.
- The file is **not** copied into localStorage. If you update `slides.izerp`, the
  change appears on the next reload (as long as no edits of your own exist). The
  `.izerp` file thus remains the source of truth.
- Colors from the file (`settings`) are applied for the intended look, without
  overwriting the global settings.

> ⚠️ **Server required:** `data-slides` uses `fetch` and only works over
> **http(s)**. Opening the page directly via `file://` makes the browser block
> access (a console message points this out). Then either open it through a local
> server (e.g. `python3 -m http.server` in the folder) **or** import the file
> once manually via **Settings → "Open .izerp"**.

---

## 2. The three modes

| Mode             | For                                            |
| ---------------- | ---------------------------------------------- |
| **Editor**       | Create, arrange, and annotate slides           |
| **Presentation** | Play the talk                                  |
| **Settings**     | Colors, language, import/export, reset         |

`Esc` closes every mode.

---

## 3. Editor — capturing slides

**Moving:**

- **Pan:** hold the left mouse button and drag — or drag with one finger.
- **Zoom:** mouse wheel (zooms toward the cursor), a two-finger **pinch**, or the
  **+ / −** buttons.
- **Click the zoom readout** → back to 100 %.

**Slides:**

- **"Set slide"** saves the current view as a new slide.
- When you're exactly on a slide, it becomes **"Update slide"**.
- **"Remove"** deletes the selected slide.

**Slide list (right):** edit titles, enter speaker notes, reorder via
drag-and-drop, fly to a slide, or delete.

**Keyboard:** `←/↑` previous · `→/↓` next · `Esc` exit.

---

## 4. Presentation — playback

| Key / action               | Effect                                               |
| -------------------------- | ---------------------------------------------------- |
| `→` `↓` `PageDown` · swipe ← | next slide                                          |
| `←` `↑` `PageUp` · swipe →  | previous slide                                       |
| **hold `Space`**           | laser pointer (follows the mouse); release hides it  |
| `N`                        | toggle speaker notes                                 |
| `Esc`                      | exit                                                 |

On touch devices, a horizontal **swipe** pages through the deck.

A compact **rail** is shown along the bottom edge: slide number, a graduated
**progress bar**, and the timer with **RESET**. It hugs the bottom edge and never
covers the content — the speaker reads the pace, the audience reads the progress.

The **speaker notes** are collapsed by default (the stage stays clear) and are
summoned from the rail or with **`N`**. The panel shows the title, notes, and the
**next** slide. Full screen via the browser (`F11`).

### Notes in the console — a discreet teleprompter

On every slide change iZerp also **prints the current slide's title and notes to
the browser console**. Because DevTools can be undocked into its own window
(DevTools → ⋮ menu → *Dock side* → *Separate window*), this gives you a hidden
teleprompter:

1. Start the presentation and open DevTools, then undock the console into a
   separate window (move it to a second screen, or just keep it off-screen).
2. In your screen-share, share **only the presentation window** — not the whole
   screen.
3. Read your notes from the console window as you go. The audience only sees the
   slide; they never notice you're reading.

The console line updates automatically as you navigate, so it always shows the
notes for the slide currently on stage.

---

## 5. Settings

- **Colors:** primary (accent/progress/buttons), secondary (panel background),
  tertiary (text on panels).
- **Language:** Deutsch / English (default: auto-detected).
- **File:** **"Save as .izerp"** (export) · **"Open .izerp"** (import).
- **Danger zone:** delete all slides.
- Finally **"Save settings"**.

### Theming (CSS variables)

The default is the **"Brass & Ink"** theme. All colors and fonts are CSS custom
properties on `#izerp-root` and can be overridden in your own stylesheet (loaded
**after** `izerp-lib.css`) — without touching the library. A ready-made,
restrained skin ships as `izerp-theme-neutral.css` (a good template to copy). The
most important variables: `--brass*` (metal), `--ink*` (surfaces), `--line*`
(hairlines), `--tx-*` (text), `--p-display` / `--p-body` / `--p-mono` (fonts).

### Custom languages (no source edit)

iZerp ships with `de` and `en`. Add or override any language at runtime — no
source change needed. Partial dictionaries are fine; missing keys fall back to
English.

```js
// via config…
window.iZerpConfig = {
  lang: 'fr',
  languages: { fr: { editorLabel: 'Éditeur', presentationLabel: 'Présentation' } },
};
// …or via the API before init:
iZerp.registerLanguage('fr', { editorLabel: 'Éditeur' });
```

The string keys are defined in the `STRINGS` table at the top of `izerp-lib.js`.

---

## 6. Storage

iZerp stores **locally in the browser** (localStorage) — no server.

| Content   | Key                                   | Scope                        |
| --------- | ------------------------------------- | ---------------------------- |
| Slides    | `izerp:slides:<page path + query>`    | **per page (URL)**           |
| Settings  | `izerp:settings`                      | global                       |

> ⚠️ Slides are tied to the **URL path**. If the HTML file is moved/renamed, the
> browser points at a different page and the slides "go missing" (they are not
> deleted). Other browsers / incognito have their own storage too.
> **Fix:** export slides as `.izerp` and import them at the new location. (Or pin
> a fixed key with `data-storage-key` — see section 1.)

---

## 7. Programming interface

After loading, `window.iZerp` is available:

```js
iZerp.version          // e.g. "1.3"
iZerp.init(options)    // start manually (with data-auto-init="false"); returns iZerp
iZerp.destroy()        // tear down fully: remove listeners/nodes, un-wrap the body
iZerp.getSlides()      // array copy of all slides
iZerp.getCurrentIndex()// index of the active slide (0-based; -1 = none)
iZerp.getCurrentSlide()// active slide object or null
iZerp.getConfig()      // copy of the resolved configuration
iZerp.isReady()        // true once initialised
iZerp.setMode('presentation' | 'editor' | 'settings' | 'idle')
iZerp.saveToFile()     // trigger a .izerp export
iZerp.loadFromFile()   // open the .izerp import dialog
iZerp.registerLanguage(code, dict) // add/override a UI language at runtime
iZerp.on(type, handler)// subscribe to an event; returns an unsubscribe function
iZerp.off(type, handler)
```

> **`destroy()`** removes all document listeners, removes iZerp's nodes, and
> reverses the body wrapping — the host is left clean. Afterwards a fresh
> `iZerp.init()` is possible (important for SPAs / reuse). `iZerp.on`
> subscriptions survive a `destroy()`/`init()`.

### Event API

So the host page (e.g. the slide HTML) can react to navigation deterministically —
instead of measuring geometry every frame — iZerp emits events. Two equivalent
ways:

```js
// a) conveniently via iZerp.on (returns an unsubscribe function)
const stop = iZerp.on('slidechange', ({ index, total, slide }) => { … });

// b) as a bubbling DOM event on document — independent of script load order
//    (also works before iZerp has initialised)
document.addEventListener('izerp:slidechange', e => { e.detail.index; });
```

| Event               | `detail`                        | When                                                                                                                            |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ready`             | `{ version, total }`            | iZerp initialised **and** `data-slides` loaded — from now on `getSlides()` is safe                                              |
| `slidechange`       | `{ index, total, slide, mode }` | Active slide changes (camera move **begins**)                                                                                   |
| `slidesettled`      | `{ index, total, slide, mode }` | Camera move to this slide **landed** (skipped if you navigate on quickly)                                                       |
| `presentationstart` | `{ total }`                     | Presentation starts (before the first slide)                                                                                   |
| `presentationend`   | `{ mode, total, elapsedMs }`    | Presentation left; `elapsedMs` = elapsed talk time                                                                             |
| `modechange`        | `{ mode, total }`               | Every mode switch                                                                                                              |
| `deckchange`        | `{ slides, total, reason }`     | The **deck** changes (not navigation); `reason` ∈ `add`, `update`, `remove`, `reorder`, `clear`, `import`, `load`, `edit`      |
| `laserchange`       | `{ active, x, y }`              | Laser pointer shown/hidden                                                                                                     |
| `settingschange`    | `{ settings }`                  | Colors/language saved                                                                                                          |

`index` is 0-based (`-1` = nothing active), `slide` is the slide object or
`null`. The example slide HTML uses `izerp:slidechange` to trigger the reveal
choreography per slide exactly **once** (no flicker).

---

## 8. The `.izerp` file format

An `.izerp` file is **JSON**. On export, iZerp writes:

```json
{
  "version": "1.3",
  "savedAt": "2026-06-27T08:12:31.689Z",
  "slides": [
    {
      "id": "s1",
      "title": "Slide title",
      "cx": 1500,
      "cy": 900,
      "scale": 1.08,
      "vw": 1920,
      "vh": 1080,
      "notes": "Speaker notes for the speaker panel."
    }
  ],
  "settings": {
    "colorPrimary": "#e4003a",
    "colorSecondary": "#0a0a0a",
    "colorTertiary": "#ffffff",
    "lang": "en"
  }
}
```

### Top-level fields

| Field      | Required on import? | Meaning                                             |
| ---------- | ------------------- | --------------------------------------------------- |
| `slides`   | **yes**             | Array of slides (order = playback order)            |
| `settings` | optional            | Colors + language; applied to the settings          |
| `version`  | ignored             | informational only (export version)                 |
| `savedAt`  | ignored             | informational only (ISO timestamp)                  |

> **Minimal valid file:** `{ "slides": [ … ] }`. `version`, `savedAt`, and
> `settings` are optional. Import applies the slides to **the currently open
> page** (overwriting its previous slides).

### Structure of a slide object

| Field   | Type   | Meaning                                                           |
| ------- | ------ | ----------------------------------------------------------------- |
| `id`    | string | unique identifier (arbitrary, e.g. `"s1"`)                        |
| `title` | string | title in the slide list & speaker panel                          |
| `cx`    | number | **x center** of the view in **canvas pixels**                    |
| `cy`    | number | **y center** of the view in **canvas pixels**                    |
| `scale` | number | zoom factor (1 = 100 %; >1 closer, <1 farther)                   |
| `vw`    | number | viewport **width** at capture (reference for the fit)            |
| `vh`    | number | viewport **height** at capture                                   |
| `notes` | string | speaker notes (may be empty)                                     |

### Settings object

| Field            | Meaning                                     |
| ---------------- | ------------------------------------------- |
| `colorPrimary`   | accent, progress bar, buttons (hex)         |
| `colorSecondary` | panel background (hex)                      |
| `colorTertiary`  | text color on panels (hex)                  |
| `lang`           | `"de"`, `"en"`, or `"auto"`                 |

---

## 9. Automatic generation by an AI

An AI can generate a complete iZerp presentation by producing **two artifacts**:

1. an **HTML page** that includes `izerp-lib.css` + `izerp-lib.js` and lays out
   the content as freely positioned elements on the canvas;
2. a list of **slides** (camera moves), either as a `.izerp` file to import or
   written directly into localStorage.

For step 2 to work, the AI must understand the **coordinate system**.

### The coordinate system

- The body is wrapped in `#izerp-canvas-wrap`, whose `transform-origin` is
  `0 0` (top left). An element set via CSS to `left:X; top:Y; width:W;
  height:H` thus occupies **canvas coordinates** `X … X+W` / `Y … Y+H`. Its
  center is at `(X + W/2, Y + H/2)`.
- A slide targets a point in **exactly this** coordinate system with `cx`/`cy`
  and zooms onto it with `scale`.
- On playback, iZerp fits each slide ("contain-fit"): the area captured at
  recording time always stays **fully visible**. Effective zoom =
  `scale × min(window_w / vw, window_h / vh)`. **At the reference resolution
  (`vw`×`vh`) the effective zoom is exactly `scale`.**

### Recipe: frame an element to fill the view

Given a content element with center `(cx, cy)` and width `W` (canvas px). It
should fill the fraction `F` of the width of a reference view `REF_VW × REF_VH`
(e.g. 16:9 = 1920×1080, `F ≈ 0.9` for some margin):

```text
scale = F × REF_VW / W
vw    = REF_VW
vh    = REF_VH
```

Example: a card 1600 px wide, `REF_VW = 1920`, `F = 0.9` →
`scale = 0.9 × 1920 / 1600 = 1.08`.

> **Recommendation:** create all content cards in the same aspect ratio as the
> presentation (usually 16:9) and at a uniform size — then `scale` is identical
> for all slides and the layout feels calm.

### Recipe: overview / closing slide (the whole surface)

To fit the **entire** canvas (`CANVAS_W × CANVAS_H`):

```text
cx    = CANVAS_W / 2
cy    = CANVAS_H / 2
scale = min(REF_VW / CANVAS_W, REF_VH / CANVAS_H) × F
```

### Recommended AI workflow

1. **Design content** → a list of stations (title, content, speaker notes).
2. **Fix the layout** → give each station fixed canvas coordinates (e.g. a grid
   or serpentine path), cards equally sized.
3. **Render HTML** → cards as `position:absolute` with `left/top/width/height`
   in the wrapped content area.
4. **Compute slides** → per station, determine `cx/cy/scale/vw/vh` with the
   recipe above; set `notes`.
5. **Write slides as a `.izerp` file** → place the object `{ "slides": [...],
   "settings": {...} }` next to the HTML file (e.g. `slides.izerp`).
6. **Wire auto-loading** → set `data-slides` on the script tag:
   `<script src="izerp-lib.js" data-slides="slides.izerp"></script>` (see
   section 1). Serve the page over http(s). The presentation is then
   **turnkey**: open the HTML + `.izerp` + the two library files, done.

> A single data source (e.g. a `STATIONS` array) should feed **both** the HTML
> **and** the `.izerp` slides — that way cards and camera moves can't drift
> apart. See [`examples/basic.html`](examples/basic.html) for exactly this.
>
> **Pure `file://` delivery?** Then `fetch` is blocked; instead use the
> localStorage seed variant below or let the user import once manually.

### Variant: seeding slides via localStorage

Instead of a `.izerp` file, the AI can write the slides directly into
localStorage — **before** the `izerp-lib.js` tag, under the page key. iZerp then
reads them on load:

```js
const key = 'izerp:slides:' + location.pathname + location.search;
if (!localStorage.getItem(key)) {          // don't overwrite existing slides
  localStorage.setItem(key, JSON.stringify([
    { id:'s1', title:'Title', cx:800, cy:450, scale:1, vw:1920, vh:1080, notes:'…' }
    // … more slides
  ]));
}
```

The value is **the same slide array** as in the `slides` field of the `.izerp`
file.

### Things to keep in mind

- All slides — including the **first** one flown to on start — use the
  contain-fit fitting. Still, design for the **target resolution** and choose
  `F ≲ 0.9` so enough margin remains on differing window sizes.
- `id` must be unique; `notes` may be empty (`""`), but should be present.
- Import/seed apply **per page** (URL).

---

## 10. Quick FAQ

**Slides are "gone".** HTML file moved/renamed or a different browser
(section 6) — transfer via `.izerp` (or pin a `data-storage-key`).

**Share slides between devices.** Export `.izerp`, copy it, import it on the
target page.

**Content is cut off during playback.** Captured in a different aspect ratio than
presented — re-set it in the target aspect ratio (16:9) or zoom out a bit more.

**Internet required?** No. iZerp runs fully locally and makes **no** network
request in the default configuration (system fonts). Only the optional
`izerp-fonts.css` fetches web fonts — host them locally if needed.

---

## 11. Browser support & limitations

**Input:** mouse, touch and pen are all supported through one code path — drag to
pan, two-finger pinch to zoom, horizontal swipe to page through a talk.

**Browsers:** targets modern evergreen browsers — Chrome/Edge, Firefox and
Safari (desktop + mobile), roughly the last two years. It relies on CSS custom
properties, Pointer Events and `backdrop-filter`. The File System Access API is
used for import/export **with an automatic download/`<input type=file>`
fallback**, so older browsers still work. No Internet Explorer support.

**Accessibility:** keyboard-operable throughout; the menu and settings dialogs
trap focus and restore it on close; slide changes are announced via a polite
ARIA live region; `prefers-reduced-motion` is honoured.

**Known limitations:**

- **Single instance.** iZerp is a global (`window.iZerp`); one instance per page.
- **Body wrapping.** By default iZerp moves all `<body>` children into a canvas
  wrapper. If host CSS/JS depends on direct body children, scope iZerp with
  `data-target` (its pan/zoom then works relative to that container).
- **Theming reach.** Colours and fonts are CSS variables (`izerp-theme-neutral.css`
  is a full example); a few semantic accents (danger red, warning orange, the
  laser's white core) are intentionally fixed and don't follow the brand theme.
- **Storage is per-URL** unless you set `data-storage-key` (see section 6).

---

## 12. Docker — a deck from a PDF, hosted

Everything above assumes you write the HTML. If what you have is a **PDF**, the
official image does that part for you: it hosts a page where you upload a PDF
(and, if you have one, a `.izerp` file), renders the pages onto one canvas, and
serves the result as an ordinary iZerp presentation.

```bash
docker run -p 8080:8080 -v "$PWD/decks:/data" illustratus/izerp
```

Open <http://localhost:8080>, upload a PDF, press **Present**.

![A PDF deck playing, zoomed out to the overview slide](docs/screenshots/docker-deck.png)

- **One volume, plain files.** Everything lands in `/data` — mount it wherever
  you want. One folder per presentation, containing the original PDF, the page
  images, and the `deck.izerp`. Backing up is copying the folder.
- **Several presentations, switchable.** The start page lists every deck on the
  volume; inside a running deck a small bar in the top-left corner switches
  between them and steps aside while you present.
- **Slides you control.** Without a `.izerp` file the container generates one
  slide per page plus an overview slide. Upload your own, edit in iZerp's editor
  and export, or hit *Regenerate* to get the default back. The canvas layout is
  deterministic and documented, so an AI can write a `.izerp` against it exactly
  as in section 9.
- **Still no external requests, still no dependencies.** The server is the
  Python standard library plus `pdftoppm`; the page loads nothing but
  `izerp-lib.js` and `izerp-lib.css`.
- **No authentication.** Anyone who can reach the port can upload and delete.
  Put it behind a reverse proxy, or run it read-only (`IZERP_READ_ONLY=1`).

Full documentation — configuration, the exact canvas layout, security, tags:
**[docker/README.md](docker/README.md)**.

---

## License

[MIT](LICENSE) © Illustratus. Contributions welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) and the [CHANGELOG](CHANGELOG.md).
