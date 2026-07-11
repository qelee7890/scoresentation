"""Import-time integrity gate tests (SPEC-LYRICS-001, T-006).

ES triple gate ABORTS the import (non-zero) on injected defects with no corrupt output
(GWT-B3); KO glyph-note gate absorbs surplus notes into the last syllable and preserves
defect markers (GWT-E3). Reads real v2 + json-format2 READ-ONLY; writes to temp only.
"""
import copy
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

import import_v2_to_desktop as imp  # noqa: E402

REAL_V2 = r"C:/Users/qelee/scoresentation-mobile/data/scoresentation_v2.db"
JSON_FORMAT2 = r"C:/Users/qelee/praise-spanish/docs/json-format2"
V2_DDL = """CREATE TABLE saved_hymns_v2 (
    number TEXT, title TEXT, new_number TEXT, composer TEXT, key_signature TEXT,
    time_signature TEXT, category TEXT, schema_version INTEGER, rev INTEGER,
    warning_count INTEGER, source_hash TEXT, migrated_at TEXT, doc_json TEXT)"""


def build_v2(path, docs):
    con = sqlite3.connect(path)
    con.execute(V2_DDL)
    con.executemany(
        "INSERT INTO saved_hymns_v2 (number,title,new_number,composer,category,schema_version,rev,warning_count,source_hash,migrated_at,doc_json)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [(str(d.get("number")), d.get("title", ""), d.get("newNumber", ""), d.get("composer", ""),
          d.get("category", ""), 2, 1, 0, "sha256:x", "2026-07-03T00:00:00Z",
          json.dumps(d, ensure_ascii=False)) for d in docs],
    )
    con.commit()
    con.close()


class KoGateTest(unittest.TestCase):
    def test_glyph_note_mismatch_absorbs_into_last_syllable_and_preserves_markers(self):
        # GWT-E3: unabsorbed surplus notes (line-level orphanNotes) -> absorbed into the
        # last syllable + GLYPH_NOTE_MISMATCH warning + defect markers preserved (no rejection).
        surplus = [
            {"pitch": "D5", "dur": "8", "dotted": False, "accidental": None, "beamGroup": None, "fermata": False},
            {"pitch": "C5", "dur": "8", "dotted": False, "accidental": None, "beamGroup": None, "fermata": False},
        ]
        doc = {
            "schemaVersion": 3, "number": "999", "category": "hymn", "title": "t",
            "sections": [{"kind": "verse", "label": "1", "altLanguages": {}, "lines": [{
                "id": "s1.0", "textOnly": False, "dangling": True, "orphanNotes": copy.deepcopy(surplus),
                "syllables": [
                    {"surface": {"ko": "주", "es": None, "en": None}, "wordBoundary": "standalone",
                     "leadSpace": False, "melisma": False,
                     "notes": [{"pitch": "E4", "dur": "8", "dotted": False, "accidental": None, "beamGroup": None, "fermata": False}]},
                    {"surface": {"ko": "여", "es": None, "en": None}, "wordBoundary": "standalone",
                     "leadSpace": False, "melisma": False,
                     "notes": [{"pitch": "F4", "dur": "8", "dotted": False, "accidental": None, "beamGroup": None, "fermata": False}]},
                ],
            }]}],
            "_provenance": {"migratedFrom": "v2", "sourceHash": None, "migratedAt": None, "warnings": []},
        }
        added = imp.apply_ko_gate(doc)
        line = doc["sections"][0]["lines"][0]
        last = line["syllables"][-1]
        # surplus absorbed into last syllable, flagged melisma
        self.assertEqual(len(last["notes"]), 3)
        self.assertEqual([n["pitch"] for n in last["notes"]], ["F4", "D5", "C5"])
        self.assertTrue(last["melisma"])
        # warning recorded
        self.assertEqual(len(added), 1)
        self.assertEqual(doc["_provenance"]["warnings"][-1]["code"], "GLYPH_NOTE_MISMATCH")
        # defect markers preserved, no fabricated lyrics
        self.assertTrue(line["dangling"])
        self.assertIn("orphanNotes", line)
        self.assertEqual(last["surface"]["ko"], "여")


@unittest.skipUnless(os.path.exists(REAL_V2) and os.path.isdir(JSON_FORMAT2), "real v2/json-format2 not present")
class EsGateAbortTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sc-esg-")
        self.v2 = os.path.join(self.tmp, "v2.db")
        self.out = os.path.join(self.tmp, "baseline.db")
        self.es_sources = imp.load_es_sources(JSON_FORMAT2)
        src = sqlite3.connect(f"file:{REAL_V2}?mode=ro", uri=True)
        self.doc190 = json.loads(src.execute("SELECT doc_json FROM saved_hymns_v2 WHERE number='190'").fetchone()[0])
        src.close()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _no_output(self):
        if not os.path.exists(self.out):
            return True
        con = sqlite3.connect(f"file:{self.out}?mode=ro", uri=True)
        try:
            con.execute("SELECT COUNT(*) FROM saved_hymns_v3").fetchone()
            return False
        except sqlite3.OperationalError:
            return True
        finally:
            con.close()

    def test_clean_es_song_passes_gate(self):
        build_v2(self.v2, [self.doc190])
        n = imp.run_import(self.v2, self.out, backup=False, gates=True, es_sources=self.es_sources)
        self.assertEqual(n, 1)

    def test_syllable_note_defect_aborts_nonzero_and_no_output(self):
        # GWT-B3: strip notes from a non-textOnly ES syllable -> glyph!=notes -> abort.
        bad = copy.deepcopy(self.doc190)
        bad["sections"][0]["lines"][0]["syllables"][0]["notes"] = []
        build_v2(self.v2, [bad])
        with self.assertRaises(imp.ImportGateError) as ctx:
            imp.run_import(self.v2, self.out, backup=False, gates=True, es_sources=self.es_sources)
        self.assertIn("190", ctx.exception.failures)
        self.assertTrue(self._no_output(), "no corrupt output written after abort")

    def test_whitespace_wbEs_defect_aborts_nonzero(self):
        # GWT-B3: corrupt wbEs so an ES word boundary is dropped -> word-split mismatch -> abort.
        bad = copy.deepcopy(self.doc190)
        flipped = False
        for sec in bad["sections"]:
            for ln in sec["lines"]:
                for syl in ln["syllables"]:
                    if syl.get("wbEs") == "start":
                        syl["wbEs"] = "mid"  # merge this word into the previous group
                        flipped = True
                        break
                if flipped:
                    break
            if flipped:
                break
        self.assertTrue(flipped, "fixture must contain a wbEs='start' to corrupt")
        build_v2(self.v2, [bad])
        with self.assertRaises(imp.ImportGateError) as ctx:
            imp.run_import(self.v2, self.out, backup=False, gates=True, es_sources=self.es_sources)
        self.assertIn("190", ctx.exception.failures)
        self.assertTrue(self._no_output())

    def test_main_returns_nonzero_on_gate_failure(self):
        bad = copy.deepcopy(self.doc190)
        bad["sections"][0]["lines"][0]["syllables"][0]["notes"] = []
        build_v2(self.v2, [bad])
        rc = imp.main(["--v2", self.v2, "--out", self.out, "--write"])
        self.assertEqual(rc, 1)


if __name__ == "__main__":
    unittest.main()
