"""v2 -> desktop canonical import tests (SPEC-LYRICS-001, T-004).

Uses stdlib sqlite3 + unittest. Reads the real v2 corpus READ-ONLY to build small
hermetic fixtures (and a full-corpus count check); all writes go to ephemeral temp
DBs — never the real user DB.
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

import canonical_doc  # noqa: E402
import import_v2_to_desktop as imp  # noqa: E402

REAL_V2 = r"C:/Users/qelee/scoresentation-mobile/data/scoresentation_v2.db"
V2_TABLE_DDL = """CREATE TABLE saved_hymns_v2 (
    number TEXT, title TEXT, new_number TEXT, composer TEXT, key_signature TEXT,
    time_signature TEXT, category TEXT, schema_version INTEGER, rev INTEGER,
    warning_count INTEGER, source_hash TEXT, migrated_at TEXT, doc_json TEXT)"""
V1_DDL = """CREATE TABLE saved_hymns (number TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
    new_number TEXT NOT NULL DEFAULT '', composer TEXT NOT NULL DEFAULT '',
    key_signature TEXT NOT NULL DEFAULT '', time_signature TEXT NOT NULL DEFAULT '',
    hymn_json TEXT NOT NULL, updated_at TEXT NOT NULL)"""


def _real_v2_available():
    return os.path.exists(REAL_V2)


class ImportV2Test(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sc-imp-")
        self.v2 = os.path.join(self.tmp, "v2.db")
        self.out = os.path.join(self.tmp, "baseline.db")
        # Build a fixture v2 with a few real rows.
        con = sqlite3.connect(self.v2)
        con.execute(V2_TABLE_DDL)
        if _real_v2_available():
            src = sqlite3.connect(f"file:{REAL_V2}?mode=ro", uri=True)
            rows = src.execute(
                "SELECT number,title,new_number,composer,key_signature,time_signature,category,"
                "schema_version,rev,warning_count,source_hash,migrated_at,doc_json "
                "FROM saved_hymns_v2 WHERE number IN ('190','204','495')"
            ).fetchall()
            src.close()
        else:
            rows = [(
                "495", "내 영혼이 은총 입어", "438", "", "4b", "3/4", "hymn", 2, 3, 0, "sha256:x", "2026-07-03T00:00:00Z",
                json.dumps({
                    "schemaVersion": 2, "rev": 1, "updatedAt": "2026-07-03T00:00:00Z", "id": "495",
                    "number": "495", "newNumber": "438", "title": "내 영혼이 은총 입어", "composer": "",
                    "category": "hymn", "key": "4b", "timeSignature": "3/4",
                    "sections": [{"kind": "verse", "label": "1", "altLanguages": {}, "lines": [
                        {"id": "s1.0", "textOnly": False, "syllables": [
                            {"surface": {"ko": "내", "es": "Fue", "en": None}, "wordBoundary": "standalone",
                             "leadSpace": False, "melisma": False, "wbEs": "mid",
                             "notes": [{"pitch": "E4", "dur": "8", "dotted": False, "accidental": None,
                                        "beamGroup": None, "fermata": False}]}]}]}],
                    "_provenance": {"migratedFrom": "v2", "sourceHash": "sha256:x", "migratedAt": "2026-07-03T00:00:00Z", "warnings": []},
                }, ensure_ascii=False),
            )]
        con.executemany(
            "INSERT INTO saved_hymns_v2 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        con.commit()
        con.close()
        self.n_fixture = len(rows)
        # Fixture out DB with a v1 row carrying tempo/newTitle for 495 (lossless-meta source).
        con = sqlite3.connect(self.out)
        con.execute(V1_DDL)
        con.execute(
            "INSERT INTO saved_hymns (number,title,new_number,composer,key_signature,time_signature,hymn_json,updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            ("495", "내 영혼이 은총 입어", "438", "", "4b", "3/4",
             json.dumps({"number": "495", "tempo": "♩=92", "newTitle": "내 영혼이(개정)", "category": "hymn"}, ensure_ascii=False),
             "2026-01-01T00:00:00Z"),
        )
        con.commit()
        con.close()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _v3_rows(self, path=None):
        con = sqlite3.connect(f"file:{path or self.out}?mode=ro", uri=True)
        rows = con.execute("SELECT number,doc_json,content_hash,schema_version FROM saved_hymns_v3 ORDER BY number").fetchall()
        con.close()
        return rows

    def test_import_writes_v3_docs(self):
        n = imp.run_import(self.v2, self.out, backup=False)
        self.assertEqual(n, self.n_fixture)
        rows = self._v3_rows()
        self.assertEqual(len(rows), self.n_fixture)
        for number, doc_json, chash, sv in rows:
            doc = json.loads(doc_json)
            self.assertEqual(doc["schemaVersion"], 3)
            self.assertEqual(sv, 3)
            self.assertTrue(chash.startswith("sha256:"))

    def test_stable_syllable_ids_assigned(self):
        imp.run_import(self.v2, self.out, backup=False)
        doc = json.loads(self._v3_rows()[0][1])
        syl = doc["sections"][0]["lines"][0]["syllables"][0]
        self.assertIn("id", syl)
        self.assertRegex(syl["id"], r"^s\d+\.\d+#\d+$")

    def test_tempo_newtitle_backfilled_from_v1(self):
        # GWT-A1 lossless meta: v2 dropped tempo/newTitle; import carries them from the v1 baseline.
        imp.run_import(self.v2, self.out, backup=False)
        docs = {r[0]: json.loads(r[1]) for r in self._v3_rows()}
        self.assertEqual(docs["495"].get("tempo"), "♩=92")
        self.assertEqual(docs["495"].get("newTitle"), "내 영혼이(개정)")

    def test_idempotent_rerun_identical(self):
        # GWT-B2: re-run yields identical rows + hashes, no duplicate rows.
        imp.run_import(self.v2, self.out, backup=False)
        first = self._v3_rows()
        imp.run_import(self.v2, self.out, backup=False)
        second = self._v3_rows()
        self.assertEqual(first, second)
        self.assertEqual(len(second), self.n_fixture)

    def test_wal_checkpointed_self_contained(self):
        # GWT-E1: after import + PRAGMA wal_checkpoint(TRUNCATE), the -wal file holds no data.
        imp.run_import(self.v2, self.out, backup=False)
        wal = self.out + "-wal"
        self.assertTrue((not os.path.exists(wal)) or os.path.getsize(wal) == 0,
                        "WAL must be checkpointed/truncated (self-contained DB)")

    @unittest.skipUnless(_real_v2_available(), "real v2 corpus not present")
    def test_full_corpus_573(self):
        # GWT-B1: the whole 573-song corpus imports.
        out = os.path.join(self.tmp, "full.db")
        n = imp.run_import(REAL_V2, out, backup=False)
        self.assertEqual(n, 573)
        con = sqlite3.connect(f"file:{out}?mode=ro", uri=True)
        rows = con.execute("SELECT COUNT(*) FROM saved_hymns_v3").fetchone()[0]
        con.close()
        self.assertEqual(rows, 573)


if __name__ == "__main__":
    unittest.main()
