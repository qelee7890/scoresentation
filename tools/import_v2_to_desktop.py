"""v2 -> desktop canonical import (SPEC-LYRICS-001, T-004/T-006/T-008).

Reads the koscriber/mobile v2 corpus (mode=ro) and writes syllable-first canonical
v3 documents into the desktop baseline artifact's saved_hymns_v3 table using Python
stdlib sqlite3 ONLY (ABI-independent), with PRAGMA wal_checkpoint(TRUNCATE) after
writing and a timestamped backup before touching an existing repo DB.

Idempotent upsert (number PRIMARY KEY): re-running yields byte-identical doc_json
and content_hash, no duplicate rows.

Usage:
  py -3 tools/import_v2_to_desktop.py                 # dry-run summary (no write)
  py -3 tools/import_v2_to_desktop.py --write         # backup + import into repo baseline
  py -3 tools/import_v2_to_desktop.py --write --out X --v2 Y
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
DEFAULT_V2 = r"C:/Users/qelee/scoresentation-mobile/data/scoresentation_v2.db"
DEFAULT_OUT = os.path.join(ROOT, "data", "scoresentation.db")

SAVED_HYMNS_V3_DDL = """CREATE TABLE IF NOT EXISTS saved_hymns_v3 (
    number TEXT PRIMARY KEY,
    category TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    new_number TEXT NOT NULL DEFAULT '',
    doc_json TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    schema_version INTEGER NOT NULL DEFAULT 3,
    updated_at TEXT NOT NULL DEFAULT ''
)"""


def load_v2_docs(v2_path):
    """Read (number, v2_doc) pairs from the v2 corpus, read-only."""
    con = sqlite3.connect(f"file:{v2_path}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT number, doc_json FROM saved_hymns_v2 ORDER BY number").fetchall()
    finally:
        con.close()
    return [(number, json.loads(doc_json)) for number, doc_json in rows]


def load_v1_meta(out_path):
    """Read lossless meta (tempo/newTitle) the v2 pipeline dropped, from the v1
    baseline saved_hymns table (keyed by number). Returns {number: {tempo,newTitle}}."""
    meta = {}
    if not os.path.exists(out_path):
        return meta
    con = sqlite3.connect(f"file:{out_path}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT number, hymn_json FROM saved_hymns").fetchall()
    except sqlite3.OperationalError:
        return meta
    finally:
        con.close()
    for number, hymn_json in rows:
        try:
            h = json.loads(hymn_json)
        except (json.JSONDecodeError, TypeError):
            continue
        entry = {}
        if h.get("tempo"):
            entry["tempo"] = h["tempo"]
        if h.get("newTitle"):
            entry["newTitle"] = h["newTitle"]
        if entry:
            meta[str(number)] = entry
    return meta


def transform_v2_to_v3(v2doc, v1meta=None):
    """Transform one v2 doc into the canonical v3 doc (superset): bump schemaVersion,
    carry lossless meta from v1 when v2 lacks it, assign stable syllable ids.
    Preserves all curation/defect fields verbatim (no fabrication)."""
    doc = json.loads(json.dumps(v2doc, ensure_ascii=False))  # deep copy
    doc["schemaVersion"] = canonical_doc.SCHEMA_VERSION
    if v1meta:
        if "tempo" not in doc and v1meta.get("tempo"):
            doc["tempo"] = v1meta["tempo"]
        if "newTitle" not in doc and v1meta.get("newTitle"):
            doc["newTitle"] = v1meta["newTitle"]
    canonical_doc.assign_syllable_ids(doc)
    return doc


def build_v3_row(doc):
    """Map a canonical doc to a saved_hymns_v3 row tuple. doc_json is stored in the
    canonical serialization so re-runs are byte-identical (idempotent)."""
    return (
        str(doc.get("number", "")),
        str(doc.get("category", "")),
        str(doc.get("title", "")),
        str(doc.get("newNumber", "")),
        canonical_doc.canonical_stringify(doc),
        canonical_doc.compute_content_hash(doc),
        canonical_doc.SCHEMA_VERSION,
        str(doc.get("updatedAt", "")),
    )


def run_import(v2_path, out_path, backup=True, transform_hook=None):
    """Import every v2 song into out_path's saved_hymns_v3 (idempotent upsert).

    transform_hook(number, v3doc) -> v3doc|None : optional per-song hook used by the
    integrity gates (T-006) and legacy cleanup (T-008). Returning None drops the song.
    Returns the number of rows written.
    """
    v2docs = load_v2_docs(v2_path)
    v1meta = load_v1_meta(out_path)

    docs = []
    for number, v2doc in v2docs:
        v3doc = transform_v2_to_v3(v2doc, v1meta.get(str(number)))
        if transform_hook is not None:
            v3doc = transform_hook(str(number), v3doc)
            if v3doc is None:
                continue
        docs.append(v3doc)

    if backup and os.path.exists(out_path):
        shutil.copy2(out_path, f"{out_path}.bak.{int(time.time())}")

    con = sqlite3.connect(out_path)
    try:
        con.execute("PRAGMA journal_mode = WAL")
        con.execute(SAVED_HYMNS_V3_DDL)
        con.executemany(
            "INSERT INTO saved_hymns_v3 (number,category,title,new_number,doc_json,content_hash,schema_version,updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)"
            " ON CONFLICT(number) DO UPDATE SET category=excluded.category, title=excluded.title,"
            " new_number=excluded.new_number, doc_json=excluded.doc_json, content_hash=excluded.content_hash,"
            " schema_version=excluded.schema_version, updated_at=excluded.updated_at",
            [build_v3_row(d) for d in docs],
        )
        con.commit()
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()
    return len(docs)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Import v2 corpus into desktop canonical baseline")
    ap.add_argument("--v2", default=DEFAULT_V2, help="v2 corpus DB path (read-only)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="desktop baseline DB path (write target)")
    ap.add_argument("--write", action="store_true", help="actually write (default: dry-run)")
    args = ap.parse_args(argv)

    if not os.path.exists(args.v2):
        print(f"v2 corpus not found: {args.v2}", file=sys.stderr)
        return 2

    if not args.write:
        docs = load_v2_docs(args.v2)
        print(f"(dry-run) {len(docs)} songs would be imported into {args.out} (--write to apply)")
        return 0

    n = run_import(args.v2, args.out, backup=True)
    print(f"imported {n} canonical v3 songs into {args.out} (WAL checkpointed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
