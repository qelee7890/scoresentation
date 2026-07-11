"""Sync-ledger foundation initializer (SPEC-LYRICS-001, T-009).

Builds a per-song (number, rev, contentHash) ledger from the canonical v3 baseline.
The contentHash is RECOMPUTED from content via the shared canonical convention
(tools/canonical_doc.py == main/ledger.js) — v2 rev/source_hash are distrusted.

Scope guard: this tool ONLY initializes the ledger. No 3-way merge and no koscriber
export live here — those are deferred to SPEC-003 (GWT-D2). Python sqlite3 only,
PRAGMA wal_checkpoint(TRUNCATE) after write, backup-first.
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import canonical_doc  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BASELINE = os.path.join(ROOT, "data", "scoresentation.db")
INITIAL_REV = 1  # fresh ledger baseline; future desktop edits increment rev (SPEC-003)

SYNC_LEDGER_DDL = """CREATE TABLE IF NOT EXISTS sync_ledger (
    number TEXT PRIMARY KEY,
    rev INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT NOT NULL
)"""


def init_ledger(baseline_path, backup=True):
    """Initialize sync_ledger from saved_hymns_v3. Returns the number of ledger rows."""
    con = sqlite3.connect(f"file:{baseline_path}?mode=ro", uri=True)
    rows = con.execute("SELECT number, doc_json FROM saved_hymns_v3 ORDER BY number").fetchall()
    con.close()

    entries = []
    for number, doc_json in rows:
        doc = json.loads(doc_json)
        entries.append((str(number), INITIAL_REV, canonical_doc.compute_content_hash(doc)))

    if backup and os.path.exists(baseline_path):
        shutil.copy2(baseline_path, f"{baseline_path}.bak.{int(time.time())}")

    con = sqlite3.connect(baseline_path)
    try:
        con.execute("PRAGMA journal_mode = WAL")
        con.execute(SYNC_LEDGER_DDL)
        con.executemany(
            "INSERT INTO sync_ledger (number, rev, content_hash) VALUES (?,?,?)"
            " ON CONFLICT(number) DO UPDATE SET rev=excluded.rev, content_hash=excluded.content_hash",
            entries,
        )
        con.commit()
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()
    return len(entries)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Initialize the (number, rev, contentHash) sync ledger")
    ap.add_argument("--baseline", default=DEFAULT_BASELINE)
    ap.add_argument("--write", action="store_true", help="apply (default: report only)")
    args = ap.parse_args(argv)
    if not os.path.exists(args.baseline):
        print(f"baseline not found: {args.baseline}", file=sys.stderr)
        return 2
    if not args.write:
        con = sqlite3.connect(f"file:{args.baseline}?mode=ro", uri=True)
        n = con.execute("SELECT COUNT(*) FROM saved_hymns_v3").fetchone()[0]
        con.close()
        print(f"(dry-run) would initialize {n} ledger entries (--write to apply)")
        return 0
    n = init_ledger(args.baseline, backup=True)
    print(f"initialized sync_ledger with {n} entries (WAL checkpointed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
