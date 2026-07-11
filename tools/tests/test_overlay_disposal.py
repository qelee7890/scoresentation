"""User-overlay disposal tests (SPEC-LYRICS-001, T-007).

Exercises tools/dispose_user_overlay.py against ephemeral FIXTURE copies only — never the
real user DB. Covers succession-gated drop + unverified-retained (GWT-C1), promote+preserve
(GWT-C2), idempotency + app_meta v3 reverse keys + legacy-forward-key removal + tombstone
respect (GWT-C5), the safe --dry-run default, and backup-first.
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
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)

import dispose_user_overlay as dis  # noqa: E402

V1_DDL = """CREATE TABLE saved_hymns (number TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
    new_number TEXT NOT NULL DEFAULT '', composer TEXT NOT NULL DEFAULT '',
    key_signature TEXT NOT NULL DEFAULT '', time_signature TEXT NOT NULL DEFAULT '',
    hymn_json TEXT NOT NULL, updated_at TEXT NOT NULL)"""
V3_DDL = dis.SAVED_HYMNS_V3_DDL
TOMB_DDL = "CREATE TABLE user_tombstones (number TEXT PRIMARY KEY, deleted_at TEXT NOT NULL)"
META_DDL = "CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT)"

DISPOSE = ["100", "101", "102", "103"]
PRESERVE = ["userA", "userB"]


class OverlayDisposalTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sc-disp-")
        self.user = os.path.join(self.tmp, "scoresentation-user.db")
        self.baseline = os.path.join(self.tmp, "baseline.db")

        con = sqlite3.connect(self.user)
        con.execute(V1_DDL)
        con.execute(TOMB_DDL)
        con.execute(META_DDL)
        for n in DISPOSE + PRESERVE:
            con.execute("INSERT INTO saved_hymns (number,title,hymn_json,updated_at) VALUES (?,?,?,?)",
                        (n, f"T{n}", json.dumps({"number": n, "title": f"T{n}", "category": "song",
                                                "verses": {"1": {"korean": ["x"]}}}, ensure_ascii=False), "2026-01-01T00:00:00Z"))
        con.execute("INSERT INTO user_tombstones (number, deleted_at) VALUES ('101','2026-01-01T00:00:00Z')")
        # pre-existing origin/main forward keys that the v3 migration must remove
        for k in dis.LEGACY_FORWARD_KEYS:
            con.execute("INSERT INTO app_meta (key, value) VALUES (?, '2026-06-28T00:00:00Z')", (k,))
        con.commit()
        con.close()

        # baseline v3 has succession for 100,101,103 and userA (NOT 102 -> unproven)
        con = sqlite3.connect(self.baseline)
        con.execute(V3_DDL)
        for n in ["100", "101", "103", "userA"]:
            con.execute("INSERT INTO saved_hymns_v3 (number,doc_json) VALUES (?,?)",
                        (n, json.dumps({"schemaVersion": 3, "number": n, "category": "song", "sections": []}, ensure_ascii=False)))
        con.commit()
        con.close()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _user_numbers(self):
        con = sqlite3.connect(f"file:{self.user}?mode=ro", uri=True)
        rows = {r[0] for r in con.execute("SELECT number FROM saved_hymns").fetchall()}
        con.close()
        return rows

    def _v3(self):
        con = sqlite3.connect(f"file:{self.user}?mode=ro", uri=True)
        try:
            rows = con.execute("SELECT number, doc_json FROM saved_hymns_v3").fetchall()
        except sqlite3.OperationalError:
            rows = []
        con.close()
        return {n: json.loads(dj) for n, dj in rows}

    def _meta(self):
        con = sqlite3.connect(f"file:{self.user}?mode=ro", uri=True)
        rows = dict(con.execute("SELECT key, value FROM app_meta").fetchall())
        con.close()
        return rows

    def _apply(self):
        return dis.dispose(self.user, self.baseline, dispose=DISPOSE, preserve=PRESERVE, write=True, backup=True)

    def test_dry_run_default_writes_nothing(self):
        before = self._user_numbers()
        plan = dis.dispose(self.user, self.baseline, dispose=DISPOSE, preserve=PRESERVE, write=False)
        self.assertEqual(self._user_numbers(), before)  # unchanged
        self.assertEqual(sorted(plan["dropped"]), ["100", "103"])
        self.assertEqual(plan["retained"], ["102"])
        self.assertEqual(plan["skipped"], ["101"])

    def test_c1_succession_gated_drop_and_unverified_retained(self):
        self._apply()
        nums = self._user_numbers()
        # 100,103 dropped (succession); 102 retained (unproven); 101 skipped (tombstoned)
        self.assertNotIn("100", nums)
        self.assertNotIn("103", nums)
        self.assertIn("102", nums)
        self.assertIn("101", nums)

    def test_c2_promote_and_preserve_zero_disposal(self):
        self._apply()
        nums = self._user_numbers()
        v3 = self._v3()
        for n in PRESERVE:
            self.assertIn(n, nums, "pure user song preserved in v1 overlay")
            self.assertIn(n, v3, "pure user song promoted to canonical v3")
            self.assertEqual(v3[n]["schemaVersion"], 3)
            self.assertIn("legacyV1", v3[n]["_provenance"])  # lossless preservation

    def test_c5_idempotent_and_app_meta_v3_reverse_keys_only(self):
        self._apply()
        meta1 = self._meta()
        self.assertIn(dis.V3_DISPOSAL_KEY, meta1)
        for k in dis.LEGACY_FORWARD_KEYS:
            self.assertNotIn(k, meta1, "origin/main forward keys removed (not re-applied)")
        nums1 = self._user_numbers()
        # re-run is a no-op (already applied)
        plan2 = self._apply()
        self.assertTrue(plan2.get("already_applied"))
        self.assertEqual(self._user_numbers(), nums1)

    def test_backup_created_on_write(self):
        self._apply()
        self.assertTrue(glob.glob(self.user + ".bak.*"), "a timestamped backup is created before writing")

    def test_never_writes_without_write_flag_via_main(self):
        before = self._user_numbers()
        rc = dis.main(["--user-db", self.user, "--baseline", self.baseline])  # no --write
        self.assertEqual(rc, 0)
        self.assertEqual(self._user_numbers(), before)


if __name__ == "__main__":
    unittest.main()
