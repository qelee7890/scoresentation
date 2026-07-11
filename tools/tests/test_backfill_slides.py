"""Deterministic slide-group backfill tests (SPEC-LYRICS-001, T-005).

Full-corpus determinism (0 gaps across 573/2,330/7,433) plus focused C[] arithmetic
unit tests. Reads real v2 + v1 sources READ-ONLY; all writes go to a temp baseline.
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)

import backfill_slidegroups as bf  # noqa: E402
import import_v2_to_desktop as imp  # noqa: E402

REAL_V2 = r"C:/Users/qelee/scoresentation-mobile/data/scoresentation_v2.db"
JSON_FORMAT2 = r"C:/Users/qelee/praise-spanish/docs/json-format2"


class BackfillArithmeticTest(unittest.TestCase):
    def test_br_line_count(self):
        self.assertEqual(bf.br_line_count("a<br/>b"), 2)
        self.assertEqual(bf.br_line_count("a<br>b<br/>c"), 3)
        self.assertEqual(bf.br_line_count("single"), 1)
        self.assertEqual(bf.br_line_count(""), 0)

    def test_assign_from_counts_multi_slide(self):
        # section of 4 lines, slides [2,2] -> lines 0,1 -> slide0; lines 2,3 -> slide1
        slide_of, breaks = bf._assign_from_counts([0, 1, 2, 3], [2, 2])
        self.assertEqual(slide_of, {0: 0, 1: 0, 2: 1, 3: 1})
        self.assertEqual(breaks, [2])

    def test_assign_from_counts_mismatch_returns_none(self):
        # 3 lines cannot map onto a [2,2] (=4) source
        self.assertIsNone(bf._assign_from_counts([0, 1, 2], [2, 2]))

    def test_assign_single_slide(self):
        slide_of, breaks = bf._assign_from_counts([0, 1], [2])
        self.assertEqual(slide_of, {0: 0, 1: 0})
        self.assertEqual(breaks, [])


@unittest.skipUnless(os.path.exists(REAL_V2), "real v2 corpus not present")
class BackfillCorpusTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="sc-bf-")
        cls.baseline = os.path.join(cls.tmp, "baseline.db")
        imp.run_import(REAL_V2, cls.baseline, backup=False)
        cls.sources = bf.load_sources()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_full_corpus_zero_gaps(self):
        # GWT-B1: deterministic backfill, 0 gaps across 573 songs / 2,330 sections / 7,433 lines.
        con = sqlite3.connect(f"file:{self.baseline}?mode=ro", uri=True)
        rows = con.execute("SELECT number, doc_json FROM saved_hymns_v3").fetchall()
        con.close()
        songs = sections = lines = gaps = 0
        for _number, dj in rows:
            s, l, g = bf.backfill_doc(json.loads(dj), self.sources)
            songs += 1; sections += s; lines += l; gaps += g
        self.assertEqual((songs, sections, lines, gaps), (573, 2330, 7433, 0))

    def test_run_backfill_persists_and_is_deterministic(self):
        work = os.path.join(self.tmp, "work.db")
        shutil.copy2(self.baseline, work)
        stats1 = bf.run_backfill(work, self.sources, backup=False)
        self.assertEqual((stats1["songs"], stats1["sections"], stats1["lines"], stats1["gap_sections"]),
                         (573, 2330, 7433, 0))
        con = sqlite3.connect(f"file:{work}?mode=ro", uri=True)
        hashes1 = dict(con.execute("SELECT number, content_hash FROM saved_hymns_v3").fetchall())
        sample = con.execute("SELECT doc_json FROM saved_hymns_v3 WHERE number='495'").fetchone()[0]
        con.close()
        # slideIndex + slideBreaks are persisted.
        doc = json.loads(sample)
        self.assertIn("slideIndex", doc["sections"][0]["lines"][0])
        self.assertIn("slideBreaks", doc["sections"][0])
        # Re-run is deterministic: identical content hashes.
        bf.run_backfill(work, self.sources, backup=False)
        con = sqlite3.connect(f"file:{work}?mode=ro", uri=True)
        hashes2 = dict(con.execute("SELECT number, content_hash FROM saved_hymns_v3").fetchall())
        con.close()
        self.assertEqual(hashes1, hashes2)

    @unittest.skipUnless(os.path.isdir(JSON_FORMAT2), "json-format2 sources not present")
    def test_production_pipeline_final_counts_after_cleanup(self):
        # End-to-end PRODUCTION path (gates + T-008 cleanup, then backfill): the post-cleanup
        # baseline is 572 songs / 2,328 sections / 7,429 lines — one fewer than the raw import
        # (573/2,330/7,433) because the unreferenced score-축복의 사람 duplicate is dropped
        # (2 sections: verse + empty chorus; 4 lines). This is the number the shipped baseline carries.
        out = os.path.join(self.tmp, "prod.db")
        referenced = set()  # hermetic: no setlist references -> default drops the score- prefixed copy
        pairs = imp.find_duplicate_pairs(imp.load_v2_numbers(REAL_V2))
        drops = [imp.resolve_duplicate_to_drop(referenced, p) for p in pairs]
        hook = imp.make_legacy_cleanup_hook(drop_numbers=drops)
        n = imp.run_import(REAL_V2, out, backup=False, gates=True, transform_hook=hook)
        self.assertEqual(n, 572, "gates+cleanup import writes 572 songs (573 raw - 1 dropped duplicate)")
        stats = bf.run_backfill(out, self.sources, backup=False)
        self.assertEqual((stats["songs"], stats["sections"], stats["lines"], stats["gap_sections"]),
                         (572, 2328, 7429, 0))

    def test_204_chorus_single_slide_no_amen(self):
        # GWT-C3 tie-in: #204's v2 chorus has 2 lines and maps to a single slide with no
        # phantom "아 멘" slide (user-DB source wins the line-count match over json-format2/baseline).
        con = sqlite3.connect(f"file:{self.baseline}?mode=ro", uri=True)
        dj = con.execute("SELECT doc_json FROM saved_hymns_v3 WHERE number='204'").fetchone()[0]
        con.close()
        doc = json.loads(dj)
        bf.backfill_doc(doc, self.sources)
        chorus = [s for s in doc["sections"] if s["kind"] == "chorus"][0]
        self.assertEqual([l.get("slideIndex") for l in chorus["lines"]], [0, 0])
        self.assertEqual(chorus["slideBreaks"], [])
        amen_lines = [
            l for s in doc["sections"] for l in s["lines"]
            if "".join((y.get("surface") or {}).get("ko") or "" for y in l["syllables"]).replace(" ", "") in ("아멘", "아 멘")
        ]
        self.assertEqual(amen_lines, [], "no standalone amen slide/line in v2-canonical #204")


if __name__ == "__main__":
    unittest.main()
