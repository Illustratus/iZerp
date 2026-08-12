# iZerp deck host — a Docker image

Upload a PDF, get a zoom-and-pan presentation.

The container hosts a small page where you drop in a **PDF** (and, if you have
one, a **`.izerp` slides file**). It renders the PDF's pages onto one big canvas
and serves them as an ordinary [iZerp](https://github.com/Illustratus/iZerp)
presentation — same camera moves, same keys, same speaker notes. Everything it
writes lives in **one directory** you mount wherever you like, and every
presentation you have uploaded stays switchable from inside the running deck.

```bash
docker run -p 8080:8080 -v "$PWD/decks:/data" illustratus/izerp
```

Open <http://localhost:8080>, upload a PDF, press **Present**.

![A PDF deck playing, zoomed out to the overview slide](https://raw.githubusercontent.com/Illustratus/iZerp/main/docs/screenshots/docker-deck.png)

<p align="center"><em>Six PDF pages on one canvas — the camera flies between them, the last slide zooms out to all of them.</em></p>

![The library page](https://raw.githubusercontent.com/Illustratus/iZerp/main/docs/screenshots/docker-library.png)

---

## Contents

1. [Quick start](#quick-start)
2. [The volume — where your files live](#the-volume--where-your-files-live)
3. [HTML projects — edit, save, watch it reload](#html-projects--edit-save-watch-it-reload)
4. [Two URLs: /edit and /present](#two-urls-edit-and-present)
5. [Several presentations, one host](#several-presentations-one-host)
6. [Bringing your own slides](#bringing-your-own-slides)
7. [The canvas layout](#the-canvas-layout)
8. [Configuration](#configuration)
9. [Security — read this before exposing it](#security--read-this-before-exposing-it)
10. [Tags and versions](#tags-and-versions)
11. [Building it yourself](#building-it-yourself)
12. [Limitations](#limitations)

---

## Quick start

**docker run**

```bash
mkdir -p decks
docker run -d --name izerp \
  -p 8080:8080 \
  -v "$PWD/decks:/data" \
  --restart unless-stopped \
  illustratus/izerp
```

**docker compose** — [`docker-compose.yml`](docker-compose.yml) in this folder:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Then:

1. Open <http://localhost:8080>.
2. Choose a PDF, optionally give it a name, press **Upload & render**.
3. Press **Present**. Arrow keys navigate, `Space` is the laser pointer, `N`
   opens the speaker notes, `Esc` leaves.

Nothing else is needed — no account, no database, no internet. The page makes
**no external requests**.

---

## The volume — where your files live

Everything the container knows is under `/data`. Mount that anywhere:

```bash
-v /mnt/nas/presentations:/data          # a NAS share
-v "$HOME/Documents/decks:/data"         # a folder in your home directory
-v izerp-data:/data                      # a named Docker volume
```

One directory per presentation, all plain files:

```text
/data/
└── q3-review/
    ├── source.pdf        the PDF you uploaded, kept as-is
    ├── deck.izerp        the slides (camera moves) — plain JSON
    ├── meta.json         name, page sizes, canvas layout
    └── pages/
        ├── 0001.png      one image per PDF page
        ├── 0002.png
        └── …
```

Because it is just files:

- **Backing up** is copying the directory.
- **Moving a host** is copying the directory to the new machine's volume.
- **Deleting** a presentation is deleting its folder (the container picks the
  change up on the next page load — no restart needed).
- **Adding** one by hand works too: drop a folder with the same four files in
  and it appears in the library.

---

## HTML projects — edit, save, watch it reload

A PDF is one way in. The other is a folder that is **already** an iZerp page:
your HTML, your assets, your `.izerp`, your copy of the library. Copy it into
the data directory and it appears in the library — nothing is uploaded and
nothing is converted.

```bash
cp -r ~/work/poster /path/to/decks/poster
```

The container serves that folder **exactly as it is on disk** and adds one
script tag, which does two things: it applies the mode the URL asked for, and
it reloads the page when a file in the folder changes.

That makes the folder a live preview of your own build:

```bash
# terminal 1 — the host, watching
docker run -p 8080:8080 -v "$PWD/decks:/data" illustratus/izerp

# terminal 2 — your toolchain, unchanged
cd decks/poster && make html      # or vite build, pandoc, esbuild, a text editor…
```

Save a file, run your build, and the browser reloads within a second. The
container has **no** build step of its own — no Node, no Pandoc, no bundler in
the image. It watches names, sizes and modification times, waits until the
folder holds still (so `make` does not reload the page once per written file),
and then reloads once.

### Which file is the page?

- `index.html` if there is one.
- Otherwise the only `.html` file in the folder.
- Otherwise nothing is guessed — a Pandoc poster repo can hold
  `poster.pdf.html`, `poster.css.html` and `poster.tpl.html`, and serving the
  wrong one would look like a broken project. Add an `izerp.json`:

  ```json
  { "name": "NL2SQL Poster", "entry": "poster.pdf.html" }
  ```

The library page tells you which of these applies, per folder.

### What the container does not touch

Your markup, your assets and your `izerp-lib.js` are served byte for byte —
including an older version of the library, if that is what the project pins.
Files and folders starting with a dot (`.git`, `.env`) are never served, and a
request cannot escape the project folder.

---

## Two URLs: /edit and /present

The two things you do with a deck are different jobs, so they have different
URLs. Both work for a PDF deck and for an HTML project.

| URL | For | Live reload |
| --- | --- | --- |
| `/p/<slug>/` | Opening it, looking around | yes |
| `/p/<slug>/edit` | Placing slides, adjusting the camera | yes |
| `/p/<slug>/present` | The talk | **no** |

`/present` is deliberately frozen: a page that reloads itself in the middle of a
talk is worse than a stale one. It is also the link to send to someone — it
opens straight into the presentation, no menu, no clicks.

---

## Several presentations, one host

The start page lists every presentation on the volume, newest first, with a
thumbnail of the first page.

Inside a running deck, a small bar sits in the top-left corner: **◂ Library**
and a dropdown with every other presentation. Picking one switches straight to
it. The bar is only there at rest — it steps aside for the presentation, the
editor and the settings, so nothing of iZerp's own surface is ever covered.
Press `Esc` and it comes back.

The bar is **not** part of iZerp — the library's own surface is unchanged. It is
mounted outside the zoomable canvas by the container's `container.js`.

---

## Bringing your own slides

Without a `.izerp` file the container generates one: **one slide per page**, in
reading order, plus a final **overview** slide that frames the whole canvas.
That is a complete, presentable deck.

To control the camera yourself, there are three ways in, in increasing order of
effort:

1. **Edit in the browser.** Open the deck, use iZerp's editor (launcher →
   Editor) to move, add and delete slides. Your edits are stored in the
   browser's localStorage under a key pinned to the presentation, so they
   survive reloads and a changed host or port.
2. **Round-trip a file.** Download the generated deck from the library
   (**Deck**), edit the JSON, and upload it again under **Replace deck ·
   delete**. **Regenerate automatic deck** puts the default back.
3. **Upload one with the PDF.** The **Slides** field on the upload form takes a
   `.izerp` file directly.

A `.izerp` file is JSON — the format is specified in the
[main README, section 8](../README.md#8-the-izerp-file-format). Coordinates
refer to the canvas the container lays the pages out on, so you need to know
that layout:

> **A deck written for a different page is the one trap here.** Camera targets
> are plain numbers: an `.izerp` from the HTML original, from an older layout,
> or from another PDF imports perfectly cleanly and then frames empty canvas on
> every slide. The only symptom is "the zoom levels are wrong". The container
> therefore checks each target against the rendered pages on upload and says so
> — in the banner and on the deck's card (`13/21 slides off-page`).
>
> There is deliberately **no automatic remapping**: printing an HTML page to PDF
> reflows it, so no single transform maps the old coordinates onto the render.
> Guessing one would move the slides *nearly* into place, which is worse than
> visibly wrong. Re-capture the views in the editor on the container page
> instead — you are then looking at the exact pixels the audience will see.

---

## The canvas layout

Deterministic on purpose, so a hand-written or AI-generated `.izerp` can target
it. Every presentation also publishes its own numbers at
`/p/<slug>/meta.json`.

- Each page is rendered to a PNG **1600 px wide** (`IZERP_RENDER_WIDTH`), height
  follows the page's aspect ratio.
- Pages are placed in a grid, **left to right, then down**. The column count is
  `ceil(sqrt(pageCount))`, capped at 6 — or exactly what you typed in the
  **Columns** field.
- Each page is centred in a uniform cell as large as the biggest page, with a
  **200 px gap** (`IZERP_GAP`) between cells and a 200 px margin around
  everything.
- So page *i* (0-based) at `cols` columns sits at:

  ```text
  col  = i % cols            row  = floor(i / cols)
  left = 200 + col * (cell_w + 200)
  top  = 200 + row * (cell_h + 200)
  cx   = left + page_w / 2   cy   = top + page_h / 2
  ```

- The slide zoom fits the page into the 1920×1080 reference view with a 10 %
  margin — the width-only recipe from
  [README section 9](../README.md#9-automatic-generation-by-an-ai), generalised
  over both axes so portrait pages are not cut off:

  ```text
  scale = 0.9 * min(1920 / page_w, 1080 / page_h)
  vw    = 1920
  vh    = 1080
  ```

---

## Configuration

All optional, all environment variables:

| Variable              | Default   | Meaning                                                            |
| --------------------- | --------- | ------------------------------------------------------------------ |
| `IZERP_DATA`          | `/data`   | Where presentations are stored (this is the volume).               |
| `IZERP_PORT`          | `8080`    | Port inside the container.                                         |
| `IZERP_HOST`          | `0.0.0.0` | Bind address inside the container.                                 |
| `IZERP_TITLE`         | `iZerp`   | Heading on the library page.                                       |
| `IZERP_LANG`          | `auto`    | iZerp's UI language: `auto`, `de`, `en`.                           |
| `IZERP_RENDER_WIDTH`  | `1600`    | Page width in canvas pixels. Higher = sharper zoom, bigger files.  |
| `IZERP_GAP`           | `200`     | Gap between pages on the canvas, in canvas pixels.                 |
| `IZERP_MAX_UPLOAD_MB` | `200`     | Upload limit. Larger uploads are refused with a message.           |
| `IZERP_WATCH_INTERVAL`| `0.4`     | Seconds between file checks for live reload.                       |
| `IZERP_WATCH_QUIET`   | `1.2`     | Seconds the folder must hold still after a change before reloading.|
| `IZERP_WATCH_TIMEOUT` | `25`      | Seconds a watch request waits before the browser asks again.       |
| `IZERP_READ_ONLY`     | unset     | `1` → serve existing decks; refuse every upload, replace, delete.  |

`GET /healthz` returns JSON with the deck count and both versions — the image
already uses it as its Docker `HEALTHCHECK`.

---

## Security — read this before exposing it

**There is no authentication.** Anyone who can reach the port can upload,
replace and delete presentations, and can read every deck on the volume. This is
deliberate: the image is a small self-hosted tool, not a multi-tenant service.

For anything beyond a trusted network:

- Put it behind a reverse proxy that handles TLS and authentication
  (Caddy `basic_auth`, nginx `auth_basic`, an SSO forward-auth, …).
- Or bind it to loopback only — `-p 127.0.0.1:8080:8080` — and reach it through
  a tunnel.
- Run a public "viewer" instance with `IZERP_READ_ONLY=1` and a private one for
  uploading; both can mount the same directory, the read-only one `:ro`.

The container runs as **root** by default so that a bind mount owned by any host
user works on the first try. Files it creates are handed to whoever owns the
mounted directory, so on Linux your own decks stay deletable without `sudo`; a
root-owned named volume is left alone. To run unprivileged, make the directory
writable by that user and pass it through:

```bash
mkdir -p decks
docker run -p 8080:8080 -v "$PWD/decks:/data" \
  --user "$(id -u):$(id -g)" illustratus/izerp
```

Uploaded PDFs are rendered by `pdftoppm` (poppler) inside the container and are
never executed. Only the rendered PNGs and the original file are served back.

---

## Tags and versions

The image is versioned **together with iZerp itself** — `illustratus/izerp:1.4.0`
contains iZerp 1.4.0. No second version number to reconcile.

| Tag              | What it is                                                   |
| ---------------- | ------------------------------------------------------------ |
| `latest`         | The newest release.                                          |
| `1.4.0`          | Exactly that release — pin this in production.               |
| `1.4`            | Newest patch of that minor line.                             |
| `1`              | Newest release of that major line.                           |
| `edge`           | Built from `main`. Useful, not promised.                     |

Platforms: `linux/amd64` and `linux/arm64`.

Each release is a git tag `vX.Y.Z` on
[the repository](https://github.com/Illustratus/iZerp); the publish workflow
refuses to build a tag that disagrees with `package.json`. Changes are recorded
in [CHANGELOG.md](../CHANGELOG.md).

---

## Building it yourself

The build context is the **repository root**, because the image copies
`izerp-lib.js` and `izerp-lib.css` in:

```bash
git clone https://github.com/Illustratus/iZerp
cd iZerp
docker build -f docker/Dockerfile -t izerp:dev .
docker/smoke-test.sh izerp:dev          # boots it, uploads a PDF, checks the deck
```

Hacking on the server without Docker (needs Python 3 and `poppler-utils`):

```bash
IZERP_DATA=./decks IZERP_PORT=8080 python3 docker/app/server.py
python3 -m unittest discover -s docker/app -v
```

The server is the Python standard library only — no pip install, no
requirements file. The layout maths lives in
[`app/izerpdeck.py`](app/izerpdeck.py) and is unit-tested on its own.

---

## Limitations

- **PDF in, presentation out.** PowerPoint or Keynote files must be exported to
  PDF first. Text in a rendered PDF deck becomes an image, so it is not
  selectable and not searchable. An HTML project keeps real text.
- **No build step in the container.** It watches a folder; it does not run
  `make`, `npm` or Pandoc. That is deliberate — it keeps the image small and
  your toolchain yours. Run the build on the host and the reload follows.
- **Projects are not uploaded or deleted from the web page.** A project folder
  is yours; copy it in and remove it with the tools you already use.
- **No authentication.** See above.
- **A phone in portrait shows the page small.** Slides are captured against a
  1920×1080 reference; iZerp keeps the whole captured area visible, so a very
  tall, narrow window shrinks the page and lets the neighbouring pages peek in.
  Landscape, or a tablet upwards, is fine.
- **One process, no queue.** A very large PDF blocks its own request while it
  renders (other requests keep being served). Rendering is a one-time cost per
  upload.
- **Chromium and Firefox are what CI drives.** Safari is expected to work but is
  not covered by the automated tests.

---

MIT licensed, like the rest of iZerp. Issues and pull requests:
<https://github.com/Illustratus/iZerp>.
