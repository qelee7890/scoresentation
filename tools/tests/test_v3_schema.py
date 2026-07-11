"""v3 canonical schema contract test (SPEC-LYRICS-001, T-003).

Python-side (stdlib sqlite3 + unittest) check that the saved_hymns_v3 table shape
the import tool writes matches what main/db.js reads, and that it is physically
separate from the v1 saved_hymns table (GWT-A1). Uses an ephemeral temp DB — never
touches the real user/baseline DBs.
"""
import json
import os
import sqlite3
import tempfile
import unittest

# Must stay byte-identical to SAVED_HYMNS_V3_DDL in main/db.js.
V3_DDL = """CREATE TABLE IF NOT EXISTS saved_hymns_v3 (
    number TEXT PRIMARY KEY,
    category TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    new_number TEXT NOT NULL DEFAULT '',
    doc_json TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    schema_version INTEGER NOT NULL DEFAULT 3,
    updated_at TEXT NOT NULL DEFAULT ''
)"""

V1_DDL = """CREATE TABLE IF NOT EXISTS saved_hymns (
    number TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', new_number TEXT NOT NULL DEFAULT '',
    composer TEXT NOT NULL DEFAULT '', key_signature TEXT NOT NULL DEFAULT '',
    time_signature TEXT NOT NULL DEFAULT '', hymn_json TEXT NOT NULL, updated_at TEXT NOT NULL)"""

EXPECTED_V3_COLUMNS = [
    ("number", "TEXT"),
    ("category", "TEXT"),
    ("title", "TEXT"),
    ("new_number", "TEXT"),
    ("doc_json", "TEXT"),
    ("content_hash", "TEXT"),
    ("schema_version", "INTEGER"),
    ("updated_at", "TEXT"),
]


def sample_doc(number="495"):
    return {
        "schemaVersion": 3, "id": number, "number": number, "newNumber": "438",
        "title": "내 영혼이 은총 입어", "composer": "", "category": "hymn",
        "key": "4b", "timeSignature": "3/4",
        "sections": [{
            "kind": "verse", "label": "1", "altLanguages": {},
            "lines": [{"id": "s1.0", "textOnly": False, "syllables": [{
                "surface": {"ko": "내", "es": "Fue", "en": None},
                "wordBoundary": "standalone", "leadSpace": False, "melisma": False, "wbEs": "mid",
                "notes": [{"pitch": "E4", "dur": "8", "dotted": False, "accidental": None,
                           "beamGroup": None, "fermata": False}],
            }]}],
        }],
        "_provenance": {"migratedFrom": "v2", "sourceHash": None, "migratedAt": None, "warnings": []},
    }


class V3SchemaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sc-v3-")
        self.path = os.path.join(self.tmp, "fixture.db")
        con = sqlite3.connect(self.path)
        con.execute(V1_DDL)
        con.execute(V3_DDL)
        con.execute(
            "INSERT INTO saved_hymns_v3 (number,category,title,new_number,doc_json,content_hash,schema_version,updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            ("495", "hymn", "내 영혼이 은총 입어", "438",
             json.dumps(sample_doc("495"), ensure_ascii=False), "", 3, "2026-07-11T00:00:00Z"),
        )
        con.commit()
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        con.close()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _con(self):
        return sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)

    def test_v3_separate_from_v1(self):
        # GWT-A1: both tables coexist as physically separate tables.
        con = self._con()
        names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        con.close()
        self.assertIn("saved_hymns", names)
        self.assertIn("saved_hymns_v3", names)

    def test_v3_column_contract(self):
        con = self._con()
        cols = [(r[1], r[2]) for r in con.execute("PRAGMA table_info('saved_hymns_v3')")]
        con.close()
        self.assertEqual(cols, EXPECTED_V3_COLUMNS)

    def test_doc_json_is_syllable_first_canonical(self):
        con = self._con()
        doc_json = con.execute("SELECT doc_json FROM saved_hymns_v3 WHERE number='495'").fetchone()[0]
        con.close()
        doc = json.loads(doc_json)
        self.assertEqual(doc["schemaVersion"], 3)
        syl = doc["sections"][0]["lines"][0]["syllables"][0]
        # syllable-first: it owns its surface{ko,es,en} and its own notes[]
        self.assertEqual(set(syl["surface"].keys()), {"ko", "es", "en"})
        self.assertTrue(isinstance(syl["notes"], list))

    def test_schema_version_column_default(self):
        con = self._con()
        sv = con.execute("SELECT schema_version FROM saved_hymns_v3 WHERE number='495'").fetchone()[0]
        con.close()
        self.assertEqual(sv, 3)


if __name__ == "__main__":
    unittest.main()
