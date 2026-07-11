"""Sync-ledger init + cross-language hash parity tests (SPEC-LYRICS-001, T-009).

The Python half of the golden-vector parity (the JS half is test/ledger.test.js): both
runners assert compute_content_hash(doc) == the pinned contentHash, proving byte-identical
hashing across languages. Plus ledger init from a fixture baseline. Temp DBs only.
"""
import glob
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(TOOLS)
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)

import canonical_doc  # noqa: E402
import init_sync_ledger as led  # noqa: E402
import import_v2_to_desktop as imp  # noqa: E402

GOLD = os.path.join(ROOT, "test", "fixtures", "canonical-golden")
REAL_V2 = r"C:/Users/qelee/scoresentation-mobile/data/scoresentation_v2.db"


class HashParityTest(unittest.TestCase):
    def test_golden_vectors_match_pinned_hashes(self):
        # GWT-D1: Python hash == pinned golden vector (same value JS asserts -> cross-language parity).
        files = glob.glob(os.path.join(GOLD, "*.json"))
        self.assertGreaterEqual(len(files), 2, "golden vectors present")
        for fp in files:
            with open(fp, encoding="utf-8") as fh:
                v = json.load(fh)
            self.assertEqual(canonical_doc.compute_content_hash(v["doc"]), v["contentHash"], v["name"])

    def test_hash_deterministic_and_v2_independent(self):
        fp = os.path.join(GOLD, "simple-ko.json")
        with open(fp, encoding="utf-8") as fh:
            v = json.load(fh)
        h1 = canonical_doc.compute_content_hash(v["doc"])
        # mutate volatile fields -> hash unchanged (distrusts v2 rev/source_hash)
        mutated = json.loads(json.dumps(v["doc"]))
        mutated["rev"] = 999
        mutated["_provenance"]["sourceHash"] = "sha256:different"
        h2 = canonical_doc.compute_content_hash(mutated)
        self.assertEqual(h1, h2)
        self.assertEqual(h1, v["contentHash"])


class LedgerInitTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sc-led-")
        self.baseline = os.path.join(self.tmp, "baseline.db")
        # Build a small v3 baseline via the import (real rows if available, else synthetic).
        v2 = os.path.join(self.tmp, "v2.db")
        con = sqlite3.connect(v2)
        con.execute("""CREATE TABLE saved_hymns_v2 (number TEXT, doc_json TEXT)""")
        if os.path.exists(REAL_V2):
            src = sqlite3.connect(f"file:{REAL_V2}?mode=ro", uri=True)
            rows = src.execute("SELECT number, doc_json FROM saved_hymns_v2 WHERE number IN ('190','495','204')").fetchall()
            src.close()
        else:
            rows = [("495", json.dumps({"schemaVersion": 2, "number": "495", "category": "hymn", "title": "t",
                     "sections": [], "_provenance": {"warnings": []}}, ensure_ascii=False))]
        con.executemany("INSERT INTO saved_hymns_v2 VALUES (?,?)", rows)
        con.commit()
        con.close()
        self.n = imp.run_import(v2, self.baseline, backup=False)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _ledger(self):
        con = sqlite3.connect(f"file:{self.baseline}?mode=ro", uri=True)
        rows = con.execute("SELECT number, rev, content_hash FROM sync_ledger ORDER BY number").fetchall()
        con.close()
        return rows

    def test_init_creates_one_entry_per_song(self):
        # GWT-D2: init produces a (number, rev, contentHash) entry per song; no merge/export.
        n = led.init_ledger(self.baseline, backup=False)
        self.assertEqual(n, self.n)
        rows = self._ledger()
        self.assertEqual(len(rows), self.n)
        for number, rev, chash in rows:
            self.assertEqual(rev, led.INITIAL_REV)
            self.assertTrue(chash.startswith("sha256:"))

    def test_ledger_hash_matches_recomputed_doc_hash(self):
        led.init_ledger(self.baseline, backup=False)
        con = sqlite3.connect(f"file:{self.baseline}?mode=ro", uri=True)
        docs = dict(con.execute("SELECT number, doc_json FROM saved_hymns_v3").fetchall())
        ledger_hash = dict((r[0], r[2]) for r in con.execute("SELECT number, rev, content_hash FROM sync_ledger"))
        con.close()
        for number, doc_json in docs.items():
            self.assertEqual(ledger_hash[number], canonical_doc.compute_content_hash(json.loads(doc_json)))

    def test_init_is_idempotent(self):
        led.init_ledger(self.baseline, backup=False)
        first = self._ledger()
        led.init_ledger(self.baseline, backup=False)
        self.assertEqual(first, self._ledger())

    def test_no_merge_or_export_surface(self):
        # GWT-D2 scope guard: the init tool exposes no merge/export functions.
        for forbidden in ("merge", "reconcile", "three_way_merge", "export", "export_to_koscriber", "apply"):
            self.assertFalse(hasattr(led, forbidden), f"{forbidden} must not exist in the foundation ledger tool")


if __name__ == "__main__":
    unittest.main()
