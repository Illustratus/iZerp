#!/usr/bin/env python3
"""iZerp deck host — a tiny stdlib-only server that turns a PDF into a
zoom-and-pan presentation.

Upload a PDF (and optionally an .izerp deck), and the page it renders is an
ordinary iZerp page: the PDF's pages laid out as images on one big canvas, the
library's two files on top, the camera moves in a companion .izerp file. Nothing
about the library changes — the container only produces the kind of page iZerp
was always designed to consume.

Everything lives under one directory (default /data), so a single volume mount
puts every uploaded deck wherever the user wants it.

  IZERP_DATA          data directory                  (default /data)
  IZERP_PORT          listen port                     (default 8080)
  IZERP_HOST          bind address                    (default 0.0.0.0)
  IZERP_RENDER_WIDTH  page render width in px         (default 1600)
  IZERP_MAX_UPLOAD_MB upload limit                    (default 200)
  IZERP_GAP           gap between pages on the canvas (default 200)
  IZERP_TITLE         name shown in the library header
  IZERP_LANG          UI language passed to iZerp: auto | de | en (default auto)
  IZERP_READ_ONLY     "1" → serve existing decks, refuse uploads and deletes
"""

from __future__ import annotations

import html
import json
import mmap
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import izerpdeck as deck  # noqa: E402

APP_DIR = Path(__file__).resolve().parent
ASSET_DIR = APP_DIR / "static"

DATA_DIR = Path(os.environ.get("IZERP_DATA", "/data"))
PORT = int(os.environ.get("IZERP_PORT", "8080"))
HOST = os.environ.get("IZERP_HOST", "0.0.0.0")
RENDER_WIDTH = max(400, min(4000, int(os.environ.get("IZERP_RENDER_WIDTH", "1600"))))
MAX_UPLOAD = int(os.environ.get("IZERP_MAX_UPLOAD_MB", "200")) * 1024 * 1024
GAP = max(0, int(os.environ.get("IZERP_GAP", "200")))
SITE_TITLE = os.environ.get("IZERP_TITLE", "iZerp")
UI_LANG = os.environ.get("IZERP_LANG", "auto")
READ_ONLY = os.environ.get("IZERP_READ_ONLY", "") in ("1", "true", "yes")

IZERP_VERSION = os.environ.get("IZERP_VERSION", "dev")
CONTAINER_VERSION = os.environ.get("IZERP_CONTAINER_VERSION", "dev")

# The image copies izerp-lib.js/.css next to the container's own assets. When
# the server is run straight from a git checkout (docker/app/server.py) they are
# still two directories up — look there too, so hacking on the container does
# not require a build.
REPO_ROOT = APP_DIR.parent.parent
SAFE_ASSET = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
# Only these two may come from the repository root — inside the image that path
# is `/`, and a blanket fallback there would happily serve anything sitting in it.
REPO_ASSETS = frozenset({"izerp-lib.js", "izerp-lib.css"})


def resolve_asset(name: str) -> "Path | None":
    if not SAFE_ASSET.fullmatch(name or "") or ".." in name:
        return None
    if (ASSET_DIR / name).is_file():
        return ASSET_DIR / name
    if name in REPO_ASSETS and (REPO_ROOT / name).is_file():
        return REPO_ROOT / name
    return None


MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".izerp": "application/json; charset=utf-8",
    ".png": "image/png",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
}


# ══════════════════════════════════════════════════════════════════════════
# Storage
# ══════════════════════════════════════════════════════════════════════════

def deck_dir(slug: str) -> Path:
    return DATA_DIR / slug


def read_meta(slug: str) -> dict | None:
    path = deck_dir(slug) / "meta.json"
    try:
        with path.open(encoding="utf-8") as fh:
            meta = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    meta["slug"] = slug
    return meta


def list_decks() -> list[dict]:
    """Every readable deck on the volume, newest first."""
    if not DATA_DIR.is_dir():
        return []
    decks = []
    for entry in sorted(DATA_DIR.iterdir()):
        if not entry.is_dir() or not deck.is_safe_slug(entry.name):
            continue
        meta = read_meta(entry.name)
        if meta:
            decks.append(meta)
    decks.sort(key=lambda m: m.get("created", 0), reverse=True)
    return decks


def taken_slugs() -> set[str]:
    if not DATA_DIR.is_dir():
        return set()
    return {e.name for e in DATA_DIR.iterdir() if e.is_dir()}


# ══════════════════════════════════════════════════════════════════════════
# PDF → page images
# ══════════════════════════════════════════════════════════════════════════

class RenderError(RuntimeError):
    pass


def render_pdf(pdf_path: Path, out_dir: Path, width: int) -> list[Path]:
    """One PNG per page, uniform width, aspect preserved. Needs poppler-utils."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "pdftoppm", "-png", "-cropbox",
        "-scale-to-x", str(width), "-scale-to-y", "-1",
        str(pdf_path), str(out_dir / "page"),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=600)
    except FileNotFoundError:
        raise RenderError(
            "pdftoppm was not found. The image needs poppler-utils installed."
        )
    except subprocess.TimeoutExpired:
        raise RenderError("Rendering the PDF took too long (over 10 minutes).")

    if proc.returncode != 0:
        detail = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        raise RenderError(
            "The PDF could not be rendered"
            + (f": {detail[-1]}" if detail else " (is it encrypted or damaged?).")
        )

    pages = sorted(out_dir.glob("page-*.png"), key=_page_number)
    if not pages:
        raise RenderError("The PDF produced no pages — it may be empty or encrypted.")
    return pages


def _page_number(path: Path) -> int:
    match = re.search(r"-(\d+)\.png$", path.name)
    return int(match.group(1)) if match else 0


def build_presentation(name: str, slug: str, pdf_bytes_path: Path,
                       deck_bytes: bytes | None, columns: int | None) -> dict:
    """Render, lay out, write the deck — atomically, into DATA_DIR/<slug>."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{slug}-", dir=DATA_DIR))
    try:
        shutil.copyfile(pdf_bytes_path, staging / "source.pdf")
        page_files = render_pdf(staging / "source.pdf", staging / "pages", RENDER_WIDTH)

        # Normalise the names so the URL is stable and sortable: 0001.png …
        sizes, page_meta = [], []
        for i, src in enumerate(page_files):
            dst = src.with_name(f"{i + 1:04d}.png")
            src.rename(dst)
            width, height = deck.png_size(dst)
            sizes.append((width, height))
            page_meta.append({"file": dst.name, "width": width, "height": height})

        placed = deck.layout(sizes, columns=columns, gap=GAP)
        for entry, page in zip(page_meta, placed["pages"]):
            entry["left"], entry["top"] = page["left"], page["top"]

        if deck_bytes is None:
            deck_data, source = deck.build_deck(placed), "generated"
            fit = None
        else:
            deck_data, source = deck.parse_deck(deck_bytes), "uploaded"
            fit = deck.deck_fit(deck_data["slides"], deck.content_box(placed))

        deck_json = json.dumps(deck_data, indent=2, ensure_ascii=False)
        (staging / "deck.izerp").write_text(deck_json, encoding="utf-8")

        meta = {
            "slug": slug,
            "name": name,
            "created": time.time(),   # float: keeps "newest first" stable within a second
            "pages": page_meta,
            "page_count": len(page_meta),
            "slide_count": len(deck_data["slides"]),
            "layout": {k: placed[k] for k in
                       ("columns", "rows", "cell_w", "cell_h",
                        "canvas_w", "canvas_h", "gap", "margin")},
            "deck_source": source,
            "deck_fit": fit,
            "deck_hash": _short_hash(deck_json),
            "render_width": RENDER_WIDTH,
            "container_version": CONTAINER_VERSION,
        }
        (staging / "meta.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

        # mkdtemp creates 0700. The volume is meant to be readable from the
        # host and from a container started later with a different --user, so
        # widen it before the directory becomes the published deck.
        staging.chmod(0o755)

        target = deck_dir(slug)
        if target.exists():
            shutil.rmtree(target)
        staging.rename(target)
        return meta
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def replace_deck(slug: str, deck_bytes: bytes) -> dict:
    """Swap only the .izerp file of an existing presentation (keeps the pages)."""
    meta = read_meta(slug)
    if meta is None:
        raise ValueError("This presentation no longer exists.")
    deck_data = deck.parse_deck(deck_bytes)
    deck_json = json.dumps(deck_data, indent=2, ensure_ascii=False)
    (deck_dir(slug) / "deck.izerp").write_text(deck_json, encoding="utf-8")
    meta["deck_source"] = "uploaded"
    meta["deck_fit"] = deck.deck_fit(deck_data["slides"], _content_box_of(meta))
    meta["deck_hash"] = _short_hash(deck_json)
    meta["slide_count"] = len(deck_data["slides"])
    (deck_dir(slug) / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return meta


def regenerate_deck(slug: str) -> dict:
    """Rebuild the automatic deck from the stored layout — the way back."""
    meta = read_meta(slug)
    if meta is None:
        raise ValueError("This presentation no longer exists.")
    placed = {
        **meta["layout"],
        "pages": [
            {"index": i, "left": p["left"], "top": p["top"],
             "width": p["width"], "height": p["height"],
             "cx": p["left"] + p["width"] / 2, "cy": p["top"] + p["height"] / 2}
            for i, p in enumerate(meta["pages"])
        ],
    }
    deck_json = json.dumps(deck.build_deck(placed), indent=2, ensure_ascii=False)
    (deck_dir(slug) / "deck.izerp").write_text(deck_json, encoding="utf-8")
    meta["deck_source"] = "generated"
    meta["deck_fit"] = None
    meta["deck_hash"] = _short_hash(deck_json)
    meta["slide_count"] = len(json.loads(deck_json)["slides"])
    (deck_dir(slug) / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return meta


def _content_box_of(meta: dict) -> tuple[float, float, float, float]:
    pages = meta["pages"]
    return (min(p["left"] for p in pages), min(p["top"] for p in pages),
            max(p["left"] + p["width"] for p in pages),
            max(p["top"] + p["height"] for p in pages))


def _short_hash(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10]


# ══════════════════════════════════════════════════════════════════════════
# multipart/form-data — stdlib only (cgi.FieldStorage is gone in 3.13)
# ══════════════════════════════════════════════════════════════════════════

class Part:
    __slots__ = ("name", "filename", "path", "size")

    def __init__(self, name: str, filename: str | None, path: Path, size: int):
        self.name, self.filename, self.path, self.size = name, filename, path, size

    def text(self) -> str:
        return self.path.read_bytes().decode("utf-8", "replace").strip()

    def bytes(self) -> bytes:
        return self.path.read_bytes()


class UploadTooLarge(ValueError):
    pass


def parse_multipart(rfile, content_type: str, length: int, workdir: Path) -> dict[str, Part]:
    """Spool the body to disk, then split it on the boundary via mmap.

    Deliberately never holds a whole upload in memory — a 200 MB slide deck is a
    perfectly ordinary thing for someone to drop in here.
    """
    match = re.search(r'boundary="?([^";]+)"?', content_type or "")
    if not match:
        raise ValueError("Malformed upload (no multipart boundary).")
    if length > MAX_UPLOAD:
        raise UploadTooLarge(
            f"The upload is larger than the {MAX_UPLOAD // (1024 * 1024)} MB limit.")

    boundary = b"--" + match.group(1).encode("latin-1")
    spool = workdir / "body"
    remaining = length
    with spool.open("wb") as out:
        while remaining > 0:
            chunk = rfile.read(min(1 << 20, remaining))
            if not chunk:
                break
            out.write(chunk)
            remaining -= len(chunk)

    parts: dict[str, Part] = {}
    if spool.stat().st_size == 0:
        return parts

    with spool.open("rb") as fh, mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        cursor = mm.find(boundary)
        index = 0
        while cursor != -1:
            start = cursor + len(boundary)
            if mm[start:start + 2] == b"--":                 # closing boundary
                break
            start += 2                                        # skip CRLF
            nxt = mm.find(boundary, start)
            end = (len(mm) if nxt == -1 else nxt) - 2         # drop trailing CRLF
            head_end = mm.find(b"\r\n\r\n", start, end if end > start else len(mm))
            if head_end == -1:
                break
            headers = mm[start:head_end].decode("latin-1")
            body_start, body_end = head_end + 4, max(head_end + 4, end)

            name = _header_param(headers, "name") or f"field{index}"
            filename = _header_param(headers, "filename")
            dest = workdir / f"part-{index}"
            with dest.open("wb") as out:
                for off in range(body_start, body_end, 1 << 20):
                    out.write(mm[off:min(off + (1 << 20), body_end)])
            parts[name] = Part(name, filename, dest, body_end - body_start)

            index += 1
            cursor = nxt
    return parts


def _header_param(headers: str, key: str) -> str | None:
    match = re.search(rf'{key}="([^"]*)"', headers)
    return match.group(1) if match else None


# ══════════════════════════════════════════════════════════════════════════
# HTML
# ══════════════════════════════════════════════════════════════════════════

def esc(value) -> str:
    return html.escape(str(value), quote=True)


def fit_warning(meta: dict) -> str:
    """One sentence naming the most confusing failure this host can produce.

    An uploaded deck written for a different page imports cleanly and then
    frames empty canvas on every slide. Without this the only symptom is
    "the zoom levels are wrong", and finding the cause takes a while.
    """
    fit = meta.get("deck_fit")
    if not fit or not fit.get("mismatch"):
        return ""
    return (f"Careful: {fit['outside']} of {fit['total']} camera positions land "
            f"outside this PDF's pages, so those slides will frame empty space. "
            f"The deck was most likely written for a different page — "
            f"“Regenerate automatic deck” builds one that fits.")


def plural(count: int, word: str) -> str:
    """"1 slide" — not "1 slides". Small, but it is the difference between a
    product and a prototype."""
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def page_shell(title: str, body: str, extra_head: str = "",
               stylesheet: str | None = "/assets/container.css") -> bytes:
    """The library's chrome. A presentation page passes stylesheet=None — it
    styles itself from izerp-lib.css and must not inherit the library's
    body padding/background, which would shift the whole canvas."""
    link = f'<link rel="stylesheet" href="{stylesheet}">\n' if stylesheet else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
{link}{extra_head}</head>
<body>
{body}
</body>
</html>
""".encode("utf-8")


def mismatch_badge(meta: dict) -> str:
    fit = meta.get("deck_fit")
    if not fit or not fit.get("mismatch"):
        return ""
    return (f'<span class="off-page" title="These slides point at coordinates '
            f'that are not on any page of this PDF.">· '
            f'{esc(fit["outside"])}/{esc(fit["total"])} slides off-page</span>')


def library_page(message: str | None = None, tone: str = "ok") -> bytes:
    decks = list_decks()

    cards = []
    for meta in decks:
        slug = meta["slug"]
        first = meta["pages"][0]["file"] if meta.get("pages") else None
        thumb = (f'<img class="thumb" src="/p/{esc(slug)}/pages/{esc(first)}" alt="" loading="lazy">'
                 if first else '<div class="thumb thumb-empty"></div>')
        generated = meta.get("deck_source") == "generated"
        cards.append(f"""
      <article class="deck">
        <a class="deck-open" href="/p/{esc(slug)}/">{thumb}</a>
        <div class="deck-body">
          <h3><a href="/p/{esc(slug)}/">{esc(meta.get('name') or slug)}</a></h3>
          <p class="deck-meta">
            {esc(plural(meta.get('page_count', 0), 'page'))} ·
            {esc(plural(meta.get('slide_count', 0), 'slide'))} ·
            deck {esc('generated' if generated else 'uploaded')}
            {mismatch_badge(meta)}
          </p>
          <div class="deck-actions">
            <a class="btn btn-primary" href="/p/{esc(slug)}/#present">Present</a>
            <a class="btn" href="/p/{esc(slug)}/deck.izerp" download="{esc(slug)}.izerp">Deck</a>
            <a class="btn" href="/p/{esc(slug)}/source.pdf" download>PDF</a>
          </div>
          {"" if READ_ONLY else f'''
          <details class="deck-more">
            <summary>Replace deck · delete</summary>
            <form class="row" method="post" action="/p/{esc(slug)}/deck" enctype="multipart/form-data">
              <input type="file" name="deck" accept=".izerp,application/json" required>
              <button class="btn" type="submit">Upload .izerp</button>
            </form>
            <form class="row" method="post" action="/p/{esc(slug)}/regenerate">
              <button class="btn" type="submit">Regenerate automatic deck</button>
            </form>
            <form class="row" method="post" action="/p/{esc(slug)}/delete"
                  onsubmit="return confirm('Delete “{esc(meta.get('name') or slug)}” for good?')">
              <button class="btn btn-danger" type="submit">Delete presentation</button>
            </form>
          </details>'''}
        </div>
      </article>""")

    empty = """
      <div class="empty">
        <h3>No presentations yet</h3>
        <p>Drop a PDF into the form above. Every page becomes a card on one big
           canvas, and iZerp flies the camera from page to page.</p>
      </div>""" if not decks else ""

    upload = "" if READ_ONLY else """
    <form class="upload" method="post" action="/upload" enctype="multipart/form-data">
      <h2>Add a presentation</h2>
      <div class="fields">
        <label>Name <span class="hint">optional — defaults to the file name</span>
          <input type="text" name="name" placeholder="Q3 review" autocomplete="off">
        </label>
        <label>PDF <span class="hint">required</span>
          <input type="file" name="pdf" accept="application/pdf,.pdf" required>
        </label>
        <label>Slides <span class="hint">optional .izerp — otherwise one slide per page</span>
          <input type="file" name="deck" accept=".izerp,application/json">
        </label>
        <label>Columns <span class="hint">optional — grid width on the canvas</span>
          <input type="number" name="columns" min="1" max="12" placeholder="auto">
        </label>
      </div>
      <button class="btn btn-primary btn-lg" type="submit">Upload &amp; render</button>
    </form>"""

    banner = (f'<div class="banner banner-{esc(tone)}">{esc(message)}</div>'
              if message else "")

    body = f"""
  <header class="site">
    <h1>{esc(SITE_TITLE)}</h1>
    <p>Zoom-and-pan presentations from a PDF. Files live in
       <code>{esc(DATA_DIR)}</code> inside the container.</p>
  </header>
  <main>
    {banner}
    {upload}
    <section class="decks">
      <h2>Presentations{'' if not decks else f' <span class="count">{len(decks)}</span>'}</h2>
      {''.join(cards)}{empty}
    </section>
  </main>
  <footer>iZerp {esc(IZERP_VERSION)} · container {esc(CONTAINER_VERSION)}</footer>
"""
    return page_shell(SITE_TITLE, body)


def presentation_page(meta: dict) -> bytes:
    slug = meta["slug"]
    pages = "\n".join(
        f'    <img class="izerp-page" src="pages/{esc(p["file"])}" alt="Page {i + 1}"'
        f' style="left:{p["left"]}px;top:{p["top"]}px;width:{p["width"]}px;height:{p["height"]}px"'
        f' draggable="false">'
        for i, p in enumerate(meta.get("pages", []))
    )

    others = [{"slug": m["slug"], "name": m.get("name") or m["slug"]} for m in list_decks()]
    boot = json.dumps({
        "slug": slug,
        "name": meta.get("name") or slug,
        "decks": others,
        "readOnly": READ_ONLY,
    }, ensure_ascii=False)

    # A storage key that carries the deck's fingerprint: the .izerp file stays
    # authoritative, own edits survive reloads, and replacing the deck actually
    # shows the new one instead of stale localStorage.
    storage_key = f"izerp-docker:{slug}:{meta.get('deck_hash', '0')}"

    head = f"""<link rel="stylesheet" href="/assets/izerp-lib.css">
<style>
  html, body {{ margin: 0; background: #0e0c0a; }}
  .izerp-page {{
    position: absolute;
    background: #fff;
    border-radius: 6px;
    box-shadow: 0 40px 120px rgba(0,0,0,0.6);
    -webkit-user-drag: none; user-select: none;
  }}
</style>
<script>window.IZERP_CONTAINER = {boot};</script>
"""
    body = f"""  <div id="stage">
{pages}
  </div>

  <script src="/assets/izerp-lib.js"
          data-slides="deck.izerp"
          data-storage-key="{esc(storage_key)}"
          data-lang="{esc(UI_LANG)}"></script>
  <script src="/assets/container.js" defer></script>"""

    return page_shell(f"{meta.get('name') or slug} — {SITE_TITLE}", body, head,
                      stylesheet=None)


# ══════════════════════════════════════════════════════════════════════════
# HTTP
# ══════════════════════════════════════════════════════════════════════════

class Handler(BaseHTTPRequestHandler):
    server_version = f"iZerp/{CONTAINER_VERSION}"
    protocol_version = "HTTP/1.1"

    # ── plumbing ──────────────────────────────────────────────────────────
    def log_message(self, fmt, *args):
        sys.stderr.write("%s  %s\n" % (self.log_date_time_string(), fmt % args))

    def send_bytes(self, payload: bytes, ctype: str, status=HTTPStatus.OK, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def redirect(self, location: str):
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_error_page(self, status: HTTPStatus, message: str):
        body = f"""
  <header class="site"><h1>{esc(status.value)}</h1><p>{esc(message)}</p></header>
  <main><p><a class="btn btn-primary" href="/">Back to the library</a></p></main>
"""
        self.send_bytes(page_shell(f"{status.value} — {SITE_TITLE}", body),
                        MIME[".html"], status)

    def send_static(self, path: Path, cache: str = "no-cache"):
        if not path.is_file():
            return self.send_error_page(HTTPStatus.NOT_FOUND, "File not found.")
        stat = path.stat()
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", MIME.get(path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if self.command == "HEAD":
            return
        with path.open("rb") as fh:
            shutil.copyfileobj(fh, self.wfile, 1 << 16)

    # ── routes ────────────────────────────────────────────────────────────
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        route = urllib.parse.urlsplit(self.path)
        parts = [urllib.parse.unquote(p) for p in route.path.strip("/").split("/") if p]
        query = urllib.parse.parse_qs(route.query)

        if not parts:
            note = query.get("msg", [None])[0]
            tone = query.get("tone", ["ok"])[0]
            return self.send_bytes(library_page(note, tone), MIME[".html"],
                                   headers={"Cache-Control": "no-store"})

        if parts == ["healthz"]:
            return self.send_bytes(
                json.dumps({"ok": True, "decks": len(list_decks()),
                            "izerp": IZERP_VERSION,
                            "container": CONTAINER_VERSION}).encode(),
                MIME[".json"])

        if parts[0] == "assets" and len(parts) == 2:
            asset = resolve_asset(parts[1])
            if asset is None:
                return self.send_error_page(HTTPStatus.NOT_FOUND, "Unknown asset.")
            return self.send_static(asset, cache="public, max-age=300")

        if parts[0] == "p" and len(parts) >= 2:
            return self.serve_deck(parts[1], parts[2:])

        return self.send_error_page(HTTPStatus.NOT_FOUND, "Nothing lives at this URL.")

    def serve_deck(self, slug: str, rest: list[str]):
        if not deck.is_safe_slug(slug):
            return self.send_error_page(HTTPStatus.NOT_FOUND, "Unknown presentation.")
        meta = read_meta(slug)
        if meta is None:
            return self.send_error_page(
                HTTPStatus.NOT_FOUND,
                "That presentation is not on this volume (any more).")

        if not rest:
            if not self.path.endswith("/"):
                # Relative data-slides / page URLs only resolve under a trailing slash.
                return self.redirect(f"/p/{urllib.parse.quote(slug)}/")
            return self.send_bytes(presentation_page(meta), MIME[".html"],
                                   headers={"Cache-Control": "no-store"})

        if rest == ["deck.izerp"]:
            return self.send_static(deck_dir(slug) / "deck.izerp", cache="no-store")
        if rest == ["meta.json"]:
            return self.send_static(deck_dir(slug) / "meta.json", cache="no-store")
        if rest == ["source.pdf"]:
            return self.send_static(deck_dir(slug) / "source.pdf")
        if len(rest) == 2 and rest[0] == "pages" and re.fullmatch(r"\d{4}\.png", rest[1]):
            return self.send_static(deck_dir(slug) / "pages" / rest[1],
                                    cache="public, max-age=86400")

        return self.send_error_page(HTTPStatus.NOT_FOUND, "Unknown file.")

    def do_POST(self):
        # The request body may only be read once — draining it again after
        # parse_multipart() already consumed it would block forever waiting for
        # bytes the client is never going to send.
        self.body_consumed = False
        route = urllib.parse.urlsplit(self.path)
        parts = [urllib.parse.unquote(p) for p in route.path.strip("/").split("/") if p]

        if READ_ONLY:
            return self.fail("This container runs read-only (IZERP_READ_ONLY=1).")

        try:
            if parts == ["upload"]:
                return self.handle_upload()
            if len(parts) == 3 and parts[0] == "p":
                slug, action = parts[1], parts[2]
                if not deck.is_safe_slug(slug):
                    return self.fail("Unknown presentation.")
                if action == "delete":
                    return self.handle_delete(slug)
                if action == "deck":
                    return self.handle_replace_deck(slug)
                if action == "regenerate":
                    meta = regenerate_deck(slug)
                    return self.done(f"Rebuilt the automatic deck for “{meta['name']}” "
                                     f"({plural(meta['slide_count'], 'slide')}).")
        except UploadTooLarge as exc:
            return self.fail(str(exc))
        except (ValueError, RenderError) as exc:
            return self.fail(str(exc))
        except Exception as exc:                              # noqa: BLE001
            self.log_message("unhandled: %r", exc)
            return self.fail("Something went wrong while processing the upload.")

        return self.send_error_page(HTTPStatus.NOT_FOUND, "Nothing to post to here.")

    # ── actions ───────────────────────────────────────────────────────────
    def read_parts(self, workdir: Path) -> dict[str, Part]:
        self.body_consumed = True
        return parse_multipart(self.rfile, self.headers.get("Content-Type", ""),
                               int(self.headers.get("Content-Length") or 0), workdir)

    def handle_upload(self):
        with tempfile.TemporaryDirectory(prefix="izerp-upload-") as tmp:
            parts = self.read_parts(Path(tmp))
            pdf = parts.get("pdf")
            if pdf is None or not pdf.size:
                return self.fail("No PDF was selected.")
            if pdf.bytes()[:5] != b"%PDF-":
                return self.fail(
                    f"“{pdf.filename or 'the file'}” is not a PDF "
                    "(it does not start with %PDF-).")

            name = (parts["name"].text() if "name" in parts else "").strip()
            if not name:
                name = re.sub(r"\.pdf$", "", pdf.filename or "", flags=re.I) or "Presentation"

            columns = None
            if "columns" in parts:
                raw = parts["columns"].text()
                if raw.isdigit():
                    columns = max(1, min(12, int(raw)))

            deck_part = parts.get("deck")
            deck_bytes = deck_part.bytes() if deck_part and deck_part.size else None

            slug = deck.unique_slug(deck.slugify(name), taken_slugs())
            meta = build_presentation(name, slug, pdf.path, deck_bytes, columns)

        source = ("your uploaded deck" if meta["deck_source"] == "uploaded"
                  else "one slide per page")
        message = (f"“{meta['name']}” is ready: "
                   f"{plural(meta['page_count'], 'page')}, "
                   f"{plural(meta['slide_count'], 'slide')} ({source}).")
        warning = fit_warning(meta)
        if warning:
            return self.warn(message + " " + warning)
        return self.done(message)

    def handle_replace_deck(self, slug: str):
        with tempfile.TemporaryDirectory(prefix="izerp-deck-") as tmp:
            parts = self.read_parts(Path(tmp))
            part = parts.get("deck")
            if part is None or not part.size:
                return self.fail("No .izerp file was selected.")
            meta = replace_deck(slug, part.bytes())
        message = (f"New deck for “{meta['name']}”: "
                   f"{plural(meta['slide_count'], 'slide')}.")
        warning = fit_warning(meta)
        return self.warn(message + " " + warning) if warning else self.done(message)

    def handle_delete(self, slug: str):
        self.drain_body()
        meta = read_meta(slug)
        if meta is None:
            return self.fail("That presentation is already gone.")
        shutil.rmtree(deck_dir(slug), ignore_errors=True)
        return self.done(f"Deleted “{meta.get('name') or slug}”.")

    def drain_body(self):
        if getattr(self, "body_consumed", False):
            return
        self.body_consumed = True
        remaining = int(self.headers.get("Content-Length") or 0)
        while remaining > 0:
            chunk = self.rfile.read(min(1 << 16, remaining))
            if not chunk:
                break
            remaining -= len(chunk)

    def done(self, message: str):
        self.redirect("/?msg=" + urllib.parse.quote(message))

    def warn(self, message: str):
        """The upload worked, but the result will not look right."""
        self.redirect("/?tone=warn&msg=" + urllib.parse.quote(message))

    def fail(self, message: str):
        self.drain_body()
        self.redirect("/?tone=warn&msg=" + urllib.parse.quote(message))
        # A rejected upload may have left unread bytes on the socket (an
        # oversized body is refused before it is read). Retiring the connection
        # is cheaper than trying to resynchronise a keep-alive stream.
        self.close_connection = True


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"iZerp deck host · container {CONTAINER_VERSION} · iZerp {IZERP_VERSION}",
          file=sys.stderr)
    print(f"  data   {DATA_DIR}  ({len(list_decks())} presentations)", file=sys.stderr)
    print(f"  listen http://{HOST}:{PORT}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
