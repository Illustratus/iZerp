"""Pure deck logic for the iZerp container: slugs, canvas layout, .izerp decks.

Everything here is side-effect free and unit-tested (test_izerpdeck.py) so the
geometry that decides whether a slide is framed correctly never depends on a
running server, a PDF renderer or a browser.

The layout is deterministic and documented (docker/README.md → "The canvas
layout"), because a hand-written or AI-generated .izerp file has to be able to
target the same coordinates the container lays the pages out at.
"""

from __future__ import annotations

import json
import re
import struct
import unicodedata

# ── Reference view ────────────────────────────────────────────────────────
# iZerp fits every slide "contain"-style against the viewport it was captured
# in (README §9). 1920×1080 is the beamer reference the library is tuned for.
REF_VW = 1920
REF_VH = 1080
# Fraction of the reference view a single page fills. 0.9 leaves a margin so a
# window with a different aspect ratio still shows the whole page.
FILL = 0.9

DECK_FORMAT_VERSION = "1.3"


# ── Slugs ─────────────────────────────────────────────────────────────────

def slugify(name: str, fallback: str = "deck") -> str:
    """A filesystem- and URL-safe directory name. Never empty, never traversing."""
    # Transliterate umlauts BEFORE normalising — NFKD would split "Ü" into
    # "U" + a combining mark, and "Übersicht" would silently become "ubersicht".
    text = name or ""
    for src, dst in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(src, dst).replace(src.upper(), dst.upper())
    normalised = unicodedata.normalize("NFKD", text)
    ascii_only = normalised.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)[:60].strip("-")
    return slug or fallback


def unique_slug(slug: str, taken: set[str]) -> str:
    """`report`, `report-2`, `report-3`, … — stable and predictable."""
    if slug not in taken:
        return slug
    n = 2
    while f"{slug}-{n}" in taken:
        n += 1
    return f"{slug}-{n}"


def is_safe_slug(slug: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", slug or ""))


# ── PNG header ────────────────────────────────────────────────────────────

def png_size(path) -> tuple[int, int]:
    """(width, height) from a PNG's IHDR chunk — no image library needed."""
    with open(path, "rb") as fh:
        header = fh.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    width, height = struct.unpack(">II", header[16:24])
    return int(width), int(height)


# ── Canvas layout ─────────────────────────────────────────────────────────

def grid_columns(count: int, requested: int | None = None) -> int:
    """Roughly square, capped at 6 so a long deck stays readable left-to-right."""
    if requested and requested > 0:
        return min(int(requested), max(1, count))
    if count <= 1:
        return 1
    return max(1, min(6, math_ceil_sqrt(count)))


def math_ceil_sqrt(n: int) -> int:
    root = int(n ** 0.5)
    return root if root * root >= n else root + 1


def layout(sizes: list[tuple[int, int]], columns: int | None = None,
           gap: int = 200, margin: int = 200) -> dict:
    """Place pages on the canvas in reading order (left→right, top→bottom).

    Every page sits centred in a uniform cell (the largest page's box), so pages
    of mixed size stay aligned and the camera motion between them stays calm.

    Returns {'columns', 'rows', 'cell_w', 'cell_h', 'canvas_w', 'canvas_h',
             'pages': [{'index', 'left', 'top', 'width', 'height', 'cx', 'cy'}]}
    """
    if not sizes:
        raise ValueError("a deck needs at least one page")

    cols = grid_columns(len(sizes), columns)
    rows = -(-len(sizes) // cols)                      # ceil division
    cell_w = max(w for w, _ in sizes)
    cell_h = max(h for _, h in sizes)

    pages = []
    for i, (w, h) in enumerate(sizes):
        col, row = i % cols, i // cols
        cell_left = margin + col * (cell_w + gap)
        cell_top = margin + row * (cell_h + gap)
        left = cell_left + (cell_w - w) // 2           # centre inside the cell
        top = cell_top + (cell_h - h) // 2
        pages.append({
            "index": i,
            "left": left, "top": top, "width": w, "height": h,
            "cx": left + w / 2, "cy": top + h / 2,
        })

    return {
        "columns": cols, "rows": rows,
        "cell_w": cell_w, "cell_h": cell_h,
        "canvas_w": margin * 2 + cols * cell_w + (cols - 1) * gap,
        "canvas_h": margin * 2 + rows * cell_h + (rows - 1) * gap,
        "gap": gap, "margin": margin,
        "pages": pages,
    }


def fit_scale(width: float, height: float, fill: float = FILL) -> float:
    """Zoom that shows a width×height box completely inside the reference view.

    README §9 gives the width-only recipe (`F × REF_VW / W`); taking the min
    over both axes is the same formula generalised so portrait pages (A4) are
    not cut off at the top and bottom.
    """
    return fill * min(REF_VW / width, REF_VH / height)


def round6(value: float) -> float:
    """Keep the .izerp file readable — six decimals is far below one screen px."""
    return round(float(value), 6)


def build_deck(placed: dict, titles: list[str] | None = None,
               notes: list[str] | None = None, overview: bool = True) -> dict:
    """One slide per page, in reading order, plus a closing overview slide."""
    slides = []
    for page in placed["pages"]:
        i = page["index"]
        slides.append({
            "id": f"p{i + 1}",
            "title": (titles[i] if titles and i < len(titles) else f"Page {i + 1}"),
            "cx": round6(page["cx"]),
            "cy": round6(page["cy"]),
            "scale": round6(fit_scale(page["width"], page["height"])),
            "vw": REF_VW, "vh": REF_VH,
            "notes": (notes[i] if notes and i < len(notes) else ""),
        })

    if overview and len(placed["pages"]) > 1:
        slides.append({
            "id": "overview",
            "title": "Overview",
            "cx": round6(placed["canvas_w"] / 2),
            "cy": round6(placed["canvas_h"] / 2),
            "scale": round6(fit_scale(placed["canvas_w"], placed["canvas_h"])),
            "vw": REF_VW, "vh": REF_VH,
            "notes": "The whole deck at a glance.",
        })

    return {"version": DECK_FORMAT_VERSION, "slides": slides, "settings": {}}


def content_box(placed: dict) -> tuple[float, float, float, float]:
    """The rectangle the pages actually occupy (the margin around them is empty)."""
    pages = placed["pages"]
    return (
        min(p["left"] for p in pages),
        min(p["top"] for p in pages),
        max(p["left"] + p["width"] for p in pages),
        max(p["top"] + p["height"] for p in pages),
    )


def deck_fit(slides: list[dict], box: tuple[float, float, float, float]) -> dict:
    """Do an uploaded deck's camera targets actually point at these pages?

    A `.izerp` written for a different page — the HTML original, an older
    layout, another PDF — is perfectly valid JSON and imports without a
    complaint, but every slide then frames empty canvas. Comparing the targets
    against the pages is exact: no guessing, no transform, just "is this point
    on a page or not".
    """
    x0, y0, x1, y1 = box
    outside = sum(1 for s in slides
                  if not (x0 <= s["cx"] <= x1 and y0 <= s["cy"] <= y1))
    total = len(slides)
    return {
        "total": total,
        "outside": outside,
        # A deliberate overview slide sits outside often enough that one or two
        # strays mean nothing. A quarter of the deck missing the pages does.
        "mismatch": total > 0 and outside > max(1, total // 4),
    }


# ── .izerp validation ─────────────────────────────────────────────────────

REQUIRED_SLIDE_KEYS = ("cx", "cy", "scale")


def parse_deck(raw: bytes) -> dict:
    """Accept an uploaded .izerp file, or explain in one sentence why not.

    Tolerates both shapes iZerp itself writes and reads: the full
    `{version, slides, settings}` object and a bare slide array.
    """
    try:
        data = json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError:
        raise ValueError("The file is not UTF-8 text — is it really an .izerp file?")
    except json.JSONDecodeError as exc:
        raise ValueError(f"Not valid JSON ({exc.msg}, line {exc.lineno}).")

    slides = data if isinstance(data, list) else data.get("slides")
    if not isinstance(slides, list):
        raise ValueError("No 'slides' array found — this looks like different JSON.")
    if not slides:
        raise ValueError("The file contains no slides.")

    cleaned = []
    for i, slide in enumerate(slides):
        if not isinstance(slide, dict):
            raise ValueError(f"Slide {i + 1} is not an object.")
        missing = [k for k in REQUIRED_SLIDE_KEYS if not isinstance(slide.get(k), (int, float))]
        if missing:
            raise ValueError(f"Slide {i + 1} is missing numeric {', '.join(missing)}.")
        cleaned.append({
            "id": str(slide.get("id") or f"s{i + 1}"),
            "title": str(slide.get("title") or f"Slide {i + 1}"),
            "cx": round6(slide["cx"]),
            "cy": round6(slide["cy"]),
            "scale": round6(slide["scale"]),
            "vw": int(slide.get("vw") or REF_VW),
            "vh": int(slide.get("vh") or REF_VH),
            "notes": str(slide.get("notes") or ""),
        })

    settings = data.get("settings") if isinstance(data, dict) else None
    return {
        "version": str(data.get("version") or DECK_FORMAT_VERSION) if isinstance(data, dict)
                   else DECK_FORMAT_VERSION,
        "slides": cleaned,
        "settings": settings if isinstance(settings, dict) else {},
    }
