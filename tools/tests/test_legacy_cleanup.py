"""Legacy data cleanup tests (SPEC-LYRICS-001, T-008).

#204 adopts the v2 canonical (no '아 멘' slide, GWT-C3); the score-축복의 사람 /
축복의 사람 duplicate is resolved by setlist payload.songId references — the
unreferenced copy is dropped (default: the 'score-' prefixed one), setlists intact
(GWT-C4). All fixtures are ephemeral temp DBs.
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

import import_v2_to_desktop as imp  # noqa: E402

V2_DDL = """CREATE TABLE saved_hymns_v2 (
    number TEXT, title TEXT, new_number TEXT, composer TEXT, key_signature TEXT,
    time_signature TEXT, category TEXT, schema_version INTEGER, rev INTEGER,
    warning_count INTEGER, source_hash TEXT, migrated_at TEXT, doc_json TEXT)"""
SETLIST_ITEMS_DDL = """CREATE TABLE setlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, setlist_id INTEGER, position INTEGER,
    item_type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}')"""


def note(pitch="E4"):
    return {"pitch": pitch, "dur": "8", "dotted": False, "accidental": None, "beamGroup": None, "fermata": False}


def syl(ko):
    return {"surface": {"ko": ko, "es": None, "en": None}, "wordBoundary": "standalone",
            "leadSpace": False, "melisma": False, "notes": [note()]}


def mini_doc(number, chorus_lines=None):
    sections = [{"kind": "verse", "label": "1", "altLanguages": {},
                 "lines": [{"id": "s1.0", "textOnly": False, "syllables": [syl("주"), syl("여")]}]}]
    if chorus_lines is not None:
        sections.append({"kind": "chorus", "label": "후렴", "altLanguages": {},
                         "lines": [{"id": f"s2.{i}", "textOnly": False, "syllables": [syl(c) for c in line]}
                                   for i, line in enumerate(chorus_lines)]})
    return {"schemaVersion": 2, "number": number, "id": number, "category": "song", "title": number,
            "sections": sections,
            "_provenance": {"migratedFrom": "v2", "sourceHash": None, "migratedAt": None, "warnings": []}}


def build_v2(path, docs):
    con = sqlite3.connect(path)
    con.execute(V2_DDL)
    con.executemany(
        "INSERT INTO saved_hymns_v2 (number,category,schema_version,rev,warning_count,doc_json) VALUES (?,?,?,?,?,?)",
        [(str(d["number"]), d.get("category", "song"), 2, 1, 0, json.dumps(d, ensure_ascii=False)) for d in docs],
    )
    con.commit()
    con.close()


def build_setlists(path, items):
    con = sqlite3.connect(path)
    con.execute(SETLIST_ITEMS_DDL)
    con.executemany(
        "INSERT INTO setlist_items (setlist_id, position, item_type, payload_json) VALUES (1, ?, ?, ?)",
        [(i, it, json.dumps(pl, ensure_ascii=False)) for i, (it, pl) in enumerate(items)],
    )
    con.commit()
    con.close()


class ResolveDuplicateTest(unittest.TestCase):
    PAIR = ("score-축복의 사람", "축복의 사람")

    def test_find_pairs(self):
        pairs = imp.find_duplicate_pairs(["score-축복의 사람", "축복의 사람", "495"])
        self.assertEqual(pairs, [("score-축복의 사람", "축복의 사람")])

    def test_neither_referenced_drops_score_prefixed(self):
        self.assertEqual(imp.resolve_duplicate_to_drop(set(), self.PAIR), "score-축복의 사람")

    def test_score_referenced_drops_plain(self):
        self.assertEqual(imp.resolve_duplicate_to_drop({"score-축복의 사람"}, self.PAIR), "축복의 사람")

    def test_plain_referenced_drops_score(self):
        self.assertEqual(imp.resolve_duplicate_to_drop({"축복의 사람"}, self.PAIR), "score-축복의 사람")

    def test_both_referenced_defaults_to_score(self):
        self.assertEqual(imp.resolve_duplicate_to_drop({"score-축복의 사람", "축복의 사람"}, self.PAIR), "score-축복의 사람")


class LegacyCleanupIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sc-clean-")
        self.v2 = os.path.join(self.tmp, "v2.db")
        self.out = os.path.join(self.tmp, "baseline.db")
        self.setlists = os.path.join(self.tmp, "setlists.db")
        build_v2(self.v2, [
            mini_doc("score-축복의 사람"),
            mini_doc("축복의 사람"),
            mini_doc("204", chorus_lines=[["나", "의", "찬", "송"], ["아", "멘"]]),
        ])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _numbers(self):
        con = sqlite3.connect(f"file:{self.out}?mode=ro", uri=True)
        rows = [r[0] for r in con.execute("SELECT number FROM saved_hymns_v3").fetchall()]
        con.close()
        return set(rows)

    def _run(self):
        referenced = imp.load_setlist_songids([self.setlists])
        pairs = imp.find_duplicate_pairs(imp.load_v2_numbers(self.v2))
        drops = [imp.resolve_duplicate_to_drop(referenced, p) for p in pairs]
        hook = imp.make_legacy_cleanup_hook(drop_numbers=drops)
        return imp.run_import(self.v2, self.out, backup=False, gates=False, transform_hook=hook)

    def test_c4_unreferenced_dup_dropped_setlists_intact(self):
        # A setlist references an unrelated media folder named '축복의 사람' (not a songId).
        build_setlists(self.setlists, [("media", {"title": "축복의 사람", "folderName": "축복의 사람"})])
        with open(self.setlists, "rb") as fh:
            setlist_before = fh.read()
        self._run()
        nums = self._numbers()
        # neither copy is referenced by songId -> default drops the score- prefixed copy
        self.assertIn("축복의 사람", nums)
        self.assertNotIn("score-축복의 사람", nums)
        # setlist DB untouched (read-only reference)
        with open(self.setlists, "rb") as fh:
            self.assertEqual(fh.read(), setlist_before)

    def test_c4_referenced_copy_is_kept(self):
        # If a setlist score item references 'score-축복의 사람', the OTHER copy is dropped.
        build_setlists(self.setlists, [("score", {"songId": "score-축복의 사람"})])
        self._run()
        nums = self._numbers()
        self.assertIn("score-축복의 사람", nums)
        self.assertNotIn("축복의 사람", nums)

    def test_c3_204_has_no_amen_slide(self):
        build_setlists(self.setlists, [])
        self._run()
        con = sqlite3.connect(f"file:{self.out}?mode=ro", uri=True)
        doc = json.loads(con.execute("SELECT doc_json FROM saved_hymns_v3 WHERE number='204'").fetchone()[0])
        con.close()
        amen = [ln for s in doc["sections"] for ln in s["lines"]
                if "".join((y.get("surface") or {}).get("ko") or "" for y in ln["syllables"]).replace(" ", "") == "아멘"]
        self.assertEqual(amen, [], "#204 has no standalone amen slide (v2 canonical adopted)")


if __name__ == "__main__":
    unittest.main()
