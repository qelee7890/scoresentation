"""User-overlay disposal migration (SPEC-LYRICS-001, T-007).

Resolves the v1.7 user overlay against the new canonical v3 baseline (research §8.4, D7):
  - DROP the 15 ES-duplicate overlay rows, but ONLY after the new baseline proves content
    succession (baseline saved_hymns_v3 has the number). Succession-unproven rows are RETAINED (GWT-C1).
  - PROMOTE the 7 pure user songs to canonical (v3) in the overlay and UNCONDITIONALLY
    preserve them — 0 disposal (GWT-C2).
  - Redesign app_meta with v3 REVERSE keys (migration:v3_overlay_disposal); the origin/main
    one-way keys (migration:fix_stale_spanish_overrides_v*) are removed, never re-applied (GWT-C5/REQ-LYR-023).
Idempotent (keyed on the v3 app_meta key), tombstone-respecting, backup-first.

[HARD] SAFETY: defaults to --dry-run. --write requires an explicit --user-db target path
(no implicit %APPDATA% default) and creates a timestamped .bak before any change. This tool
NEVER touches the real user DB unless explicitly pointed at it with --write.

Usage:
  py -3 tools/dispose_user_overlay.py --user-db COPY.db                 # dry-run plan
  py -3 tools/dispose_user_overlay.py --user-db COPY.db --baseline B.db --write
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
import time

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import canonical_doc  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BASELINE = os.path.join(ROOT, "data", "scoresentation.db")

V3_DISPOSAL_KEY = "migration:v3_overlay_disposal"
# origin/main forward one-way keys — removed and never re-applied (REQ-LYR-023).
LEGACY_FORWARD_KEYS = ("migration:fix_stale_spanish_overrides_v1", "migration:fix_stale_spanish_overrides_v2")

# Research §6.7/§8.4 confirmed split of the 22-row overlay.
DEFAULT_DISPOSE = [
    "184", "190", "204", "340", "404", "411", "465", "487", "495", "502",
    "고난 당한 구세주", "주 예수 나의 산 소망", "돈으로도 못가요", "십자가 열쇠", "송축해 내 영혼",
]
DEFAULT_PRESERVE = ["꽃들도", "살아계신 주", "싹트네", "야곱의 축복", "은혜", "주님 계신 교회", "주의 이름 높이며"]

SAVED_HYMNS_V3_DDL = """CREATE TABLE IF NOT EXISTS saved_hymns_v3 (
    number TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
    new_number TEXT NOT NULL DEFAULT '', doc_json TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '',
    schema_version INTEGER NOT NULL DEFAULT 3, updated_at TEXT NOT NULL DEFAULT '')"""


def baseline_v3_numbers(baseline_path):
    """Numbers present in baseline saved_hymns_v3 (content succession source)."""
    if not baseline_path or not os.path.exists(baseline_path):
        return set()
    con = sqlite3.connect(f"file:{baseline_path}?mode=ro", uri=True)
    try:
        return {r[0] for r in con.execute("SELECT number FROM saved_hymns_v3").fetchall()}
    except sqlite3.OperationalError:
        return set()
    finally:
        con.close()


def promote_v1_to_v3(number, v1_hymn):
    """Lossless promotion of a pure user (v1) song to a canonical v3 doc. The original v1
    content is preserved verbatim under _provenance.legacyV1; full re-syllabification is a
    SPEC-002 editor concern, so sections stay empty here (data preserved, not fabricated)."""
    return {
        "schemaVersion": canonical_doc.SCHEMA_VERSION,
        "id": str(number), "number": str(number),
        "newNumber": str(v1_hymn.get("newNumber", "")),
        "title": str(v1_hymn.get("title", number)),
        "composer": str(v1_hymn.get("composer", "")),
        "category": str(v1_hymn.get("category", "song")),
        "key": str(v1_hymn.get("key", "")),
        "timeSignature": str(v1_hymn.get("timeSignature", "")),
        "sections": [],
        "_provenance": {"migratedFrom": "user-overlay-v1", "sourceHash": None,
                        "migratedAt": None, "warnings": [], "legacyV1": v1_hymn},
    }


def plan_disposal(user_path, baseline_path, dispose, preserve):
    """Compute the disposal plan without writing. Returns a dict of dropped/retained/promoted/skipped."""
    con = sqlite3.connect(f"file:{user_path}?mode=ro", uri=True)
    user_rows = {r[0]: r[1] for r in con.execute("SELECT number, hymn_json FROM saved_hymns").fetchall()}
    try:
        tombstones = {r[0] for r in con.execute("SELECT number FROM user_tombstones").fetchall()}
    except sqlite3.OperationalError:
        tombstones = set()
    con.close()

    succession = baseline_v3_numbers(baseline_path)
    dropped, retained, promoted, skipped = [], [], [], []
    for number in dispose:
        if number not in user_rows:
            continue
        if number in tombstones:
            skipped.append(number)  # respect the user's deletion
            continue
        if number in succession:
            dropped.append(number)  # succession proven -> safe to drop
        else:
            retained.append(number)  # unproven -> keep (GWT-C1)
    for number in preserve:
        if number in user_rows and number not in tombstones:
            promoted.append(number)
    return {"dropped": dropped, "retained": retained, "promoted": promoted, "skipped": skipped,
            "user_rows": user_rows}


def dispose(user_path, baseline_path=DEFAULT_BASELINE, dispose=None, preserve=None, write=False, backup=True):
    """Apply (write=True) or plan (write=False) the overlay disposal. Idempotent."""
    dispose = list(DEFAULT_DISPOSE if dispose is None else dispose)
    preserve = list(DEFAULT_PRESERVE if preserve is None else preserve)

    plan = plan_disposal(user_path, baseline_path, dispose, preserve)
    if not write:
        return plan

    # Idempotent: skip if already applied.
    con = sqlite3.connect(f"file:{user_path}?mode=ro", uri=True)
    try:
        done = con.execute("SELECT value FROM app_meta WHERE key=?", (V3_DISPOSAL_KEY,)).fetchone()
    except sqlite3.OperationalError:
        done = None
    con.close()
    plan["already_applied"] = bool(done)
    if done:
        return plan

    if backup:
        shutil.copy2(user_path, f"{user_path}.bak.{int(time.time())}")

    con = sqlite3.connect(user_path)
    try:
        con.execute("PRAGMA journal_mode = WAL")
        con.execute(SAVED_HYMNS_V3_DDL)
        con.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)")
        # drop succession-proven ES duplicates
        for number in plan["dropped"]:
            con.execute("DELETE FROM saved_hymns WHERE number=?", (number,))
        # promote pure user songs -> canonical v3 (preserve; never drop)
        for number in plan["promoted"]:
            v1 = json.loads(plan["user_rows"][number])
            v3 = promote_v1_to_v3(number, v1)
            con.execute(
                "INSERT INTO saved_hymns_v3 (number,category,title,new_number,doc_json,content_hash,schema_version,updated_at)"
                " VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(number) DO UPDATE SET doc_json=excluded.doc_json,"
                " content_hash=excluded.content_hash, schema_version=excluded.schema_version",
                (str(number), v3["category"], v3["title"], v3["newNumber"],
                 canonical_doc.canonical_stringify(v3), canonical_doc.compute_content_hash(v3), 3, ""),
            )
        # app_meta: redesign to v3 reverse keys; remove origin/main forward keys.
        for k in LEGACY_FORWARD_KEYS:
            con.execute("DELETE FROM app_meta WHERE key=?", (k,))
        con.execute("INSERT INTO app_meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (V3_DISPOSAL_KEY, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())))
        con.commit()
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()
    return plan


def main(argv=None):
    ap = argparse.ArgumentParser(description="Dispose/promote the v1.7 user overlay against the v3 baseline")
    ap.add_argument("--user-db", required=True, help="explicit user overlay DB path (a COPY; never the live DB unless intended)")
    ap.add_argument("--baseline", default=DEFAULT_BASELINE, help="v3 baseline DB (succession source)")
    ap.add_argument("--write", action="store_true", help="apply changes (default: dry-run)")
    ap.add_argument("--no-backup", action="store_true", help="skip the pre-write backup (tests only)")
    args = ap.parse_args(argv)

    if not os.path.exists(args.user_db):
        print(f"user DB not found: {args.user_db}", file=sys.stderr)
        return 2

    plan = dispose(args.user_db, args.baseline, write=args.write, backup=not args.no_backup)
    mode = "APPLIED" if args.write and not plan.get("already_applied") else ("ALREADY-APPLIED" if plan.get("already_applied") else "DRY-RUN")
    print(f"[{mode}] drop={len(plan['dropped'])} retain={len(plan['retained'])} "
          f"promote={len(plan['promoted'])} skip(tombstoned)={len(plan['skipped'])}")
    if not args.write:
        print("  (dry-run — no changes written; pass --write to apply)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
