"""Unit tests for the container's deck geometry.

Run: python3 -m unittest discover -s docker/app -v
"""

import json
import unittest

import izerpdeck as deck


class Slugs(unittest.TestCase):
    def test_readable_umlauts(self):
        self.assertEqual(deck.slugify("Q3 Bericht — Übersicht"), "q3-bericht-uebersicht")

    def test_never_empty_or_traversing(self):
        self.assertEqual(deck.slugify("../../etc/passwd"), "etc-passwd")
        self.assertEqual(deck.slugify("...", fallback="deck"), "deck")
        self.assertEqual(deck.slugify(""), "deck")

    def test_unique(self):
        self.assertEqual(deck.unique_slug("report", set()), "report")
        self.assertEqual(deck.unique_slug("report", {"report"}), "report-2")
        self.assertEqual(deck.unique_slug("report", {"report", "report-2"}), "report-3")

    def test_safe_slug_gate(self):
        for good in ("report", "q3-2026", "a"):
            self.assertTrue(deck.is_safe_slug(good), good)
        for bad in ("", "..", "a/b", "Report", "-lead", "a" * 65):
            self.assertFalse(deck.is_safe_slug(bad), bad)


class Layout(unittest.TestCase):
    def test_single_page_is_one_cell(self):
        placed = deck.layout([(1600, 900)], gap=200, margin=200)
        self.assertEqual(placed["columns"], 1)
        self.assertEqual(placed["rows"], 1)
        self.assertEqual(placed["pages"][0]["left"], 200)
        self.assertEqual(placed["pages"][0]["top"], 200)
        self.assertEqual(placed["canvas_w"], 2000)
        self.assertEqual(placed["canvas_h"], 1300)

    def test_reading_order_grid(self):
        placed = deck.layout([(1600, 900)] * 4, gap=200, margin=200)
        self.assertEqual(placed["columns"], 2)
        self.assertEqual(placed["rows"], 2)
        tops = [p["top"] for p in placed["pages"]]
        lefts = [p["left"] for p in placed["pages"]]
        self.assertEqual(lefts, [200, 2000, 200, 2000])       # left→right …
        self.assertEqual(tops, [200, 200, 1300, 1300])        # … then wrap down

    def test_columns_capped_at_six(self):
        self.assertEqual(deck.layout([(100, 100)] * 100)["columns"], 6)

    def test_explicit_columns_win(self):
        placed = deck.layout([(1600, 900)] * 6, columns=3)
        self.assertEqual((placed["columns"], placed["rows"]), (3, 2))

    def test_mixed_sizes_are_centred_in_a_uniform_cell(self):
        placed = deck.layout([(1600, 900), (800, 900)], gap=200, margin=200)
        self.assertEqual(placed["cell_w"], 1600)
        # Second page is half as wide → 400 px of padding on each side.
        self.assertEqual(placed["pages"][1]["left"], 200 + 1600 + 200 + 400)

    def test_pages_never_overlap(self):
        placed = deck.layout([(1600, 900)] * 9, gap=200, margin=200)
        boxes = [(p["left"], p["top"], p["left"] + p["width"], p["top"] + p["height"])
                 for p in placed["pages"]]
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                overlap = not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])
                self.assertFalse(overlap, f"{a} overlaps {b}")

    def test_empty_deck_rejected(self):
        with self.assertRaises(ValueError):
            deck.layout([])


class Scale(unittest.TestCase):
    def test_matches_the_readme_recipe_for_16_9(self):
        # README §9: a 1600 px wide 16:9 card at F=0.9 → scale 1.08
        self.assertAlmostEqual(deck.fit_scale(1600, 900), 1.08, places=6)

    def test_portrait_pages_fit_by_height(self):
        # A4 portrait at 1600 px wide is 2263 px tall — height is the binding axis.
        scale = deck.fit_scale(1600, 2263)
        self.assertLessEqual(1600 * scale, deck.REF_VW)
        self.assertLessEqual(2263 * scale, deck.REF_VH)
        self.assertAlmostEqual(2263 * scale, deck.REF_VH * deck.FILL, places=6)

    def test_every_page_fits_the_reference_view(self):
        for size in [(1600, 900), (1600, 2263), (2000, 500), (900, 1600)]:
            scale = deck.fit_scale(*size)
            self.assertLessEqual(size[0] * scale, deck.REF_VW + 1e-9, size)
            self.assertLessEqual(size[1] * scale, deck.REF_VH + 1e-9, size)


class BuildDeck(unittest.TestCase):
    def setUp(self):
        self.placed = deck.layout([(1600, 900)] * 3, gap=200, margin=200)

    def test_one_slide_per_page_plus_overview(self):
        built = deck.build_deck(self.placed)
        self.assertEqual(len(built["slides"]), 4)
        self.assertEqual([s["id"] for s in built["slides"]],
                         ["p1", "p2", "p3", "overview"])

    def test_slide_targets_the_page_centre(self):
        built = deck.build_deck(self.placed)
        first = built["slides"][0]
        self.assertEqual((first["cx"], first["cy"]), (1000, 650))
        self.assertEqual((first["vw"], first["vh"]), (1920, 1080))

    def test_overview_shows_the_whole_canvas(self):
        built = deck.build_deck(self.placed)
        overview = built["slides"][-1]
        self.assertEqual(overview["cx"], self.placed["canvas_w"] / 2)
        self.assertLessEqual(self.placed["canvas_w"] * overview["scale"], deck.REF_VW)

    def test_single_page_gets_no_overview(self):
        built = deck.build_deck(deck.layout([(1600, 900)]))
        self.assertEqual(len(built["slides"]), 1)

    def test_is_valid_izerp_json(self):
        built = deck.build_deck(self.placed)
        round_tripped = deck.parse_deck(json.dumps(built).encode("utf-8"))
        self.assertEqual(len(round_tripped["slides"]), len(built["slides"]))


class DeckFit(unittest.TestCase):
    """The check that catches an .izerp written for a different page."""

    def setUp(self):
        self.placed = deck.layout([(1600, 900)] * 4, gap=200, margin=200)
        self.box = deck.content_box(self.placed)

    def test_content_box_is_the_pages_not_the_canvas(self):
        # 200 margin around a 2×2 grid of 1600×900 cells with a 200 gap.
        self.assertEqual(self.box, (200, 200, 3600, 2200))
        self.assertLess(self.box[2], self.placed["canvas_w"])

    def test_a_generated_deck_always_fits_itself(self):
        built = deck.build_deck(self.placed)
        fit = deck.deck_fit(built["slides"], self.box)
        self.assertFalse(fit["mismatch"])
        self.assertEqual(fit["outside"], 0)

    def test_a_deck_for_another_page_is_flagged(self):
        # Real shape of the failure: coordinates from a different canvas.
        foreign = [{"cx": 2835, "cy": 3978, "scale": 1.0} for _ in range(20)]
        fit = deck.deck_fit(foreign, self.box)
        self.assertTrue(fit["mismatch"])
        self.assertEqual(fit["outside"], 20)

    def test_one_stray_slide_is_not_a_mismatch(self):
        # A deliberate overview slide can sit outside; that is not an error.
        slides = [{"cx": 1000, "cy": 650, "scale": 1.0} for _ in range(9)]
        slides.append({"cx": -5000, "cy": -5000, "scale": 0.2})
        self.assertFalse(deck.deck_fit(slides, self.box)["mismatch"])

    def test_the_boundary_counts_as_inside(self):
        edges = [{"cx": x, "cy": y, "scale": 1.0}
                 for x, y in ((200, 200), (3600, 2200), (200, 2200), (3600, 200))]
        self.assertEqual(deck.deck_fit(edges, self.box)["outside"], 0)

    def test_an_empty_deck_is_not_a_mismatch(self):
        self.assertFalse(deck.deck_fit([], self.box)["mismatch"])


class ParseDeck(unittest.TestCase):
    def test_accepts_a_full_izerp_file(self):
        raw = json.dumps({
            "version": "1.3",
            "slides": [{"id": "a", "title": "A", "cx": 1, "cy": 2, "scale": 1,
                        "vw": 1920, "vh": 1080, "notes": "n"}],
            "settings": {"lang": "de"},
        }).encode()
        parsed = deck.parse_deck(raw)
        self.assertEqual(parsed["settings"], {"lang": "de"})
        self.assertEqual(parsed["slides"][0]["title"], "A")

    def test_accepts_a_bare_slide_array(self):
        raw = json.dumps([{"cx": 1, "cy": 2, "scale": 1}]).encode()
        parsed = deck.parse_deck(raw)
        self.assertEqual(parsed["slides"][0]["id"], "s1")
        self.assertEqual(parsed["slides"][0]["vw"], 1920)

    def test_rejects_with_a_sentence_a_human_can_act_on(self):
        cases = {
            b"not json at all": "JSON",
            b"{}": "slides",
            b'{"slides": []}': "no slides",
            b'{"slides": [{"cx": 1}]}': "cy",
            b"\xff\xfe\x00": "UTF-8",
        }
        for raw, needle in cases.items():
            with self.assertRaises(ValueError) as ctx:
                deck.parse_deck(raw)
            self.assertIn(needle, str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
