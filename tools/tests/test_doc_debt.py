"""Doc-debt cleanup + invariant regression guards (SPEC-LYRICS-001, T-010).

Locks the RM-E operational invariants as source-level regression guards (baseline
read-only + WAL checkpoint discipline + packaging !*.db-wal filter) and asserts the
D5 doc-debt is removed from nwc_to_hymns.py (no data change).
"""
import json
import os
import unittest

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(TOOLS)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class DocDebtTest(unittest.TestCase):
    def test_nwc_to_hymns_dead_pitch_code_removed(self):
        src = read(os.path.join(TOOLS, "nwc_to_hymns.py"))
        for dead in ("V2_SHIFT", "to_v2_pitch", "pitchLabelVersion", "한 단계 낮춤"):
            self.assertNotIn(dead, src, f"stale D5 doc-debt '{dead}' must be removed")

    def test_nwc_to_hymns_still_parses(self):
        import ast
        ast.parse(read(os.path.join(TOOLS, "nwc_to_hymns.py")))  # raises SyntaxError on damage


class RegressionInvariantTest(unittest.TestCase):
    # GWT-E1: every DB-writing tool checkpoints WAL (TRUNCATE) so the DB stays self-contained.
    WAL_TOOLS = ["import_v2_to_desktop.py", "backfill_slidegroups.py", "init_sync_ledger.py", "dispose_user_overlay.py"]
    # GWT-E2: every tool reading a source/baseline DB opens it read-only (mode=ro).
    RO_READERS = ["import_v2_to_desktop.py", "backfill_slidegroups.py", "init_sync_ledger.py", "dispose_user_overlay.py"]

    def test_e1_wal_checkpoint_discipline(self):
        for tool in self.WAL_TOOLS:
            src = read(os.path.join(TOOLS, tool))
            self.assertIn("wal_checkpoint(TRUNCATE)", src, f"{tool} must checkpoint WAL (TRUNCATE)")

    def test_e2_read_only_source_access(self):
        for tool in self.RO_READERS:
            src = read(os.path.join(TOOLS, tool))
            self.assertIn("mode=ro", src, f"{tool} must open source/baseline DBs read-only")

    def test_e1_packaging_wal_filter_unchanged(self):
        pkg = json.loads(read(os.path.join(ROOT, "package.json")))
        rules = pkg["build"]["extraResources"][0]["filter"]
        self.assertIn("!*.db-wal", rules, "packaging must keep excluding uncheckpointed *.db-wal")

    def test_publish_chain_unchanged(self):
        pkg = json.loads(read(os.path.join(ROOT, "package.json")))
        # self-verifying publish chain (ABI guard) must remain intact
        self.assertIn("verify-native", pkg["scripts"]["publish"])
        self.assertIn("rebuild", pkg["scripts"]["publish"])


class TestScriptsTest(unittest.TestCase):
    def test_npm_test_scripts_present(self):
        pkg = json.loads(read(os.path.join(ROOT, "package.json")))
        scripts = pkg["scripts"]
        self.assertIn("test", scripts)
        self.assertIn("test:py", scripts)
        self.assertIn("test:electron", scripts)
        # correct runners: node:test for pure JS, unittest for tools, electron gates for DB glue
        self.assertIn("--test", scripts["test"])
        self.assertIn("unittest", scripts["test:py"])
        self.assertIn("electron", scripts["test:electron"])


if __name__ == "__main__":
    unittest.main()
