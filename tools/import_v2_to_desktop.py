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
import glob
import json
import os
import re
import shutil
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import canonical_doc  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_V2 = r"C:/Users/qelee/scoresentation-mobile/data/scoresentation_v2.db"
DEFAULT_OUT = os.path.join(ROOT, "data", "scoresentation.db")
DEFAULT_JSON_FORMAT2 = r"C:/Users/qelee/praise-spanish/docs/json-format2"

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


# ── Import-time integrity gates (T-006) ──────────────────────────────────────

_ES_LETTER = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]")
_BR = re.compile(r"<br\s*/?>", re.IGNORECASE)


class ImportGateError(Exception):
    """Raised to ABORT the import when ES integrity gates fail (no corrupt output).
    `.failures` maps failing song number -> list of reason strings."""

    def __init__(self, failures):
        self.failures = failures
        super().__init__(f"ES integrity gate failed for {len(failures)} song(s): {sorted(failures)}")


def has_es(doc):
    return any((y.get("surface") or {}).get("es")
               for sec in doc.get("sections", []) for ln in sec.get("lines", []) for y in ln.get("syllables", []))


# @MX:WARN: [AUTO] KO glyph-note gate — mutates docs (absorbs surplus notes).
# @MX:REASON: must never fabricate or reject lyrics (REQ-LYR-041/043); surplus notes are
# absorbed into the LAST syllable and defect markers preserved, matching the v2 migration.
def apply_ko_gate(doc):
    """When a line carries unabsorbed surplus notes (a line-level `orphanNotes` marker),
    absorb them into the last syllable (melisma recovery), record GLYPH_NOTE_MISMATCH in
    _provenance.warnings, and PRESERVE the defect markers. Returns the warnings added."""
    added = []
    prov = doc.setdefault("_provenance", {})
    warnings = prov.setdefault("warnings", [])
    for sec in doc.get("sections", []):
        for ln in sec.get("lines", []):
            orphan = ln.get("orphanNotes")
            syls = ln.get("syllables") or []
            if orphan and syls:
                last = syls[-1]
                last.setdefault("notes", [])
                last["notes"].extend(orphan)
                last["melisma"] = True
                w = {"lineId": ln.get("id"), "section": f"{sec.get('kind')}{sec.get('label')}",
                     "code": "GLYPH_NOTE_MISMATCH", "detail": f"+{len(orphan)} 음표 흡수(멜리스마 복구); glyph<note"}
                warnings.append(w)
                added.append(w)
                # Preserve the defect marker (do not delete) for provenance/audit.
    return added


def _es_words(text):
    t = _BR.sub(" ", str(text or "")).replace("~", "")
    cleaned = "".join(c if _ES_LETTER.match(c) else " " for c in t)
    return [w for w in cleaned.split() if w]


def _rendered_es_words(line):
    """Viewer wbEs-group rendering (multi-word ES melisma syllables split on inner space)."""
    groups, cur = [], None
    for s in line.get("syllables", []):
        es = (s.get("surface") or {}).get("es") or ""
        cont = bool(s.get("continuation")) or not es
        starts = (not cont) and (s.get("wbEs") or "mid") == "start"
        if cur is None or starts:
            if cur is not None:
                groups.append(cur)
            cur = es
        else:
            cur += es
    if cur is not None:
        groups.append(cur)
    out = []
    for g in groups:
        out.extend(_es_words(g))
    return out


def _es_source_section_words(hymn):
    """Per-section ES word streams from a json-format2 source's spanish[] (verses sorted, then chorus)."""
    verses = hymn.get("verses") or {}

    def vkey(k):
        return (0, int(k)) if str(k).isdigit() else (1, str(k))

    secs = [verses[k] for k in sorted(verses.keys(), key=vkey)]
    if hymn.get("chorus"):
        secs.append(hymn["chorus"])
    return [_es_words(" ".join(sec.get("spanish") or [])) for sec in secs]


def load_es_sources(json_format2_dir=DEFAULT_JSON_FORMAT2):
    """json-format2 ES sources keyed by number/title (unwrapping nested CCM files)."""
    src = {}
    if not os.path.isdir(json_format2_dir):
        return src
    for fp in glob.glob(os.path.join(json_format2_dir, "*.json")):
        try:
            with open(fp, encoding="utf-8") as fh:
                d = json.load(fh)
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(d, dict) and "verses" not in d and "chorus" not in d and len(d) == 1:
            inner = next(iter(d.values()))
            if isinstance(inner, dict) and ("verses" in inner or "chorus" in inner):
                d = inner
        stem = os.path.splitext(os.path.basename(fp))[0].split("_", 1)[-1]
        for key in (d.get("number"), d.get("title"), d.get("id"), stem):
            if key:
                src.setdefault(str(key), d)
    return src


# @MX:ANCHOR: [AUTO] ES triple gate — structural QC boundary that aborts the import on
# corruption (glyph==notes / letter reassembly / whitespace-inclusive wbEs group audit).
# @MX:REASON: sole guard preventing corrupt bilingual output from reaching the baseline
# artifact (REQ-LYR-012); consumed by run_import and the T-006 test suite.
def es_gate_failures(number, doc, es_sources):
    """Return a list of ABORTING reasons for an ES song (empty = pass). Reuses the
    audit_es_spacing.py alignment. The benign #204 source-residual ('Amén', dropped with
    the amen slide) is intentionally NOT an aborting condition."""
    reasons = []
    hymn = es_sources.get(str(number))
    src = _es_source_section_words(hymn) if hymn else None
    for si, sec in enumerate(doc.get("sections", [])):
        stream = list(src[si]) if (src and si < len(src)) else None
        ptr = off = 0
        for ln in sec.get("lines", []):
            # (1) glyph==notes: every ES-bearing syllable must own >= 1 note.
            # textOnly lines legitimately carry lyrics with no notes (e.g. '왕이 나셨다') — exempt.
            if not ln.get("textOnly"):
                for y in ln.get("syllables", []):
                    es = (y.get("surface") or {}).get("es") or ""
                    if es and not y.get("continuation") and not (y.get("notes") or []):
                        reasons.append(f"{ln.get('id')}: ES glyph without note (glyph!=notes)")
            got = _rendered_es_words(ln)
            if not got:
                continue
            if stream is None:
                continue
            # (2/3) whitespace-inclusive wbEs group audit vs letter-only source reassembly.
            if off != 0:
                reasons.append(f"{ln.get('id')}: ES boundary word split (continues from prev line)")
            want, need, p, o = [], sum(len(w) for w in got), ptr, off
            while need > 0 and p < len(stream):
                take = min(need, len(stream[p]) - o)
                want.append(stream[p][o:o + take])
                need -= take
                o += take
                if o == len(stream[p]):
                    p += 1
                    o = 0
            ptr, off = p, o
            if off != 0:
                reasons.append(f"{ln.get('id')}: ES boundary word split (continues into next line)")
            if need > 0:
                reasons.append(f"{ln.get('id')}: ES has more letters than source (reassembly mismatch)")
            if [w.lower() for w in got] != [w.lower() for w in want]:
                reasons.append(f"{ln.get('id')}: ES word split mismatch (whitespace/wbEs)")
    return reasons


# ── Legacy data cleanup (T-008) ──────────────────────────────────────────────

DEFAULT_SETLIST_DBS = [
    os.path.join(ROOT, "data", "setlists.db"),
    os.path.expandvars(r"%APPDATA%/Scoresentation/data/setlists.db"),
]


def _line_ko(line):
    return "".join((y.get("surface") or {}).get("ko") or "" for y in line.get("syllables", []))


def strip_standalone_amen(doc):
    """Adopt the v2 canonical for #204: drop any standalone chorus '아 멘' slide/line
    (D8/GWT-C3). No-op on the pristine v2 corpus (which already omits it); defensive
    against an amen leaking in from a v1 source. Returns the number of lines removed."""
    removed = 0
    for sec in doc.get("sections", []):
        if sec.get("kind") != "chorus":
            continue
        kept = []
        for ln in sec.get("lines", []):
            if _line_ko(ln).replace(" ", "") == "아멘":
                removed += 1
                continue
            kept.append(ln)
        sec["lines"] = kept
    return removed


def load_v2_numbers(v2_path):
    con = sqlite3.connect(f"file:{v2_path}?mode=ro", uri=True)
    try:
        return [r[0] for r in con.execute("SELECT number FROM saved_hymns_v2").fetchall()]
    finally:
        con.close()


def find_duplicate_pairs(numbers, prefix="score-"):
    """Detect ('score-X', 'X') duplicate pairs present in the corpus."""
    present = set(map(str, numbers))
    return [(n, n[len(prefix):]) for n in present if n.startswith(prefix) and n[len(prefix):] in present]


def load_setlist_songids(setlist_paths=None):
    """Every setlist item's payload.songId across the given DBs (read-only)."""
    ids = set()
    for p in (setlist_paths if setlist_paths is not None else DEFAULT_SETLIST_DBS):
        if not p or not os.path.exists(p):
            continue
        con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
        try:
            rows = con.execute("SELECT payload_json FROM setlist_items").fetchall()
        except sqlite3.OperationalError:
            continue
        finally:
            con.close()
        for (pj,) in rows:
            try:
                pl = json.loads(pj)
            except (json.JSONDecodeError, TypeError):
                continue
            sid = pl.get("songId")
            if sid is not None and str(sid).strip():
                ids.add(str(sid))
    return ids


def resolve_duplicate_to_drop(referenced_ids, pair, prefix="score-"):
    """Pick which copy of a duplicate pair to drop: the setlist-unreferenced one;
    when neither (or both) is referenced, default to dropping the 'score-' prefixed copy."""
    prefixed, plain = pair
    ref = [n for n in pair if n in referenced_ids]
    if len(ref) == 1:
        return plain if ref[0] == prefixed else prefixed
    return prefixed


def make_legacy_cleanup_hook(drop_numbers=(), amen_numbers=("204",)):
    """transform_hook that drops the unreferenced duplicate copy and strips #204's amen slide.
    Setlists are never modified (read-only reference only)."""
    drop = set(map(str, drop_numbers))
    amen = set(map(str, amen_numbers))

    def hook(number, doc):
        if str(number) in drop:
            return None  # drop the unreferenced duplicate copy
        if str(number) in amen:
            strip_standalone_amen(doc)
        return doc

    return hook


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


def run_import(v2_path, out_path, backup=True, transform_hook=None, gates=False, es_sources=None):
    """Import every v2 song into out_path's saved_hymns_v3 (idempotent upsert).

    transform_hook(number, v3doc) -> v3doc|None : optional per-song hook used by the
    legacy cleanup (T-008). Returning None drops the song.

    gates=True enables the T-006 integrity gates: the KO glyph-note gate absorbs surplus
    notes (non-aborting), and the ES triple gate ABORTS the whole import (ImportGateError,
    non-zero exit, failing songs reported) before any write, so no corrupt output is emitted.
    Returns the number of rows written.
    """
    v2docs = load_v2_docs(v2_path)
    v1meta = load_v1_meta(out_path)
    if gates and es_sources is None:
        es_sources = load_es_sources()

    docs = []
    es_failures = {}
    for number, v2doc in v2docs:
        v3doc = transform_v2_to_v3(v2doc, v1meta.get(str(number)))
        if transform_hook is not None:
            v3doc = transform_hook(str(number), v3doc)
            if v3doc is None:
                continue
        if gates:
            apply_ko_gate(v3doc)  # non-aborting: absorb surplus notes + warn
            if has_es(v3doc):
                reasons = es_gate_failures(number, v3doc, es_sources)
                if reasons:
                    es_failures[str(number)] = reasons
        docs.append(v3doc)

    if gates and es_failures:
        # Abort BEFORE writing — no corrupt output reaches the baseline (REQ-LYR-012).
        raise ImportGateError(es_failures)

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

    # Legacy cleanup: resolve the score-축복의 사람 / 축복의 사람 duplicate against setlist references.
    referenced = load_setlist_songids()
    pairs = find_duplicate_pairs(load_v2_numbers(args.v2))
    drops = [resolve_duplicate_to_drop(referenced, p) for p in pairs]
    cleanup_hook = make_legacy_cleanup_hook(drop_numbers=drops)

    try:
        n = run_import(args.v2, args.out, backup=True, gates=True, transform_hook=cleanup_hook)
    except ImportGateError as err:
        print("ABORT — ES integrity gate failed; no output written. Failing songs:", file=sys.stderr)
        for number, reasons in sorted(err.failures.items()):
            print(f"  {number}: {'; '.join(reasons)}", file=sys.stderr)
        return 1
    print(f"imported {n} canonical v3 songs into {args.out} (WAL checkpointed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
