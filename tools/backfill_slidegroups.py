"""Deterministic slide-group backfill (SPEC-LYRICS-001, T-005).

v2 flattens slides to lines but the line-id numeric part determines the v1 slide
mapping arithmetically (research §8.3). For each v2 section we pick the highest-
priority v1 source whose total line count MATCHES the section, then map each line
`s{sid}.{n}` to its slide via cumulative line-count arithmetic C[]:

    C[0]=0, C[k+1]=C[k]+len(BR_split(korean[k]));  slideIndex(n) = k  s.t.  C[k] <= n < C[k+1]

Line-count matching auto-selects the correct source for #204 (json-format2/baseline
carry a trailing "아 멘" slide → 3 chorus lines; user DB/v2 do not → 2 lines), so the
user-DB grouping wins for #204 with no phantom amen slide.

Sources are read READ-ONLY, priority: json-format2 > user DB > repo baseline (gate
decision 2026-07-11). Writes update saved_hymns_v3 in place (doc_json + content_hash),
Python sqlite3 only, PRAGMA wal_checkpoint(TRUNCATE) after write, backup-first.
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
DEFAULT_BASELINE = os.path.join(ROOT, "data", "scoresentation.db")
DEFAULT_JSON_FORMAT2 = r"C:/Users/qelee/praise-spanish/docs/json-format2"
DEFAULT_USER_DB = os.path.expandvars(r"%APPDATA%/Scoresentation/data/scoresentation-user.db")

_BR = re.compile(r"<br\s*/?>", re.IGNORECASE)
_LINE_ID = re.compile(r"^s(\d+)\.(\d+)$")


def br_line_count(slide_text):
    """Number of lines in a v1 slide string (BR-split, empty parts dropped)."""
    parts = [p for p in _BR.split(slide_text or "") if p.strip()]
    return len(parts) if parts else (1 if (slide_text or "").strip() else 0)


def slide_line_counts(korean_slides):
    """[lines_per_slide, ...] for a v1 section's korean[] slide array."""
    return [br_line_count(s) for s in (korean_slides or [])]


def section_korean(hymn, kind, label):
    """korean[] slides for a v1 hymn's section matching a v2 (kind,label), or None."""
    if not isinstance(hymn, dict):
        return None
    if kind == "chorus":
        ch = hymn.get("chorus")
        return ch.get("korean") if isinstance(ch, dict) else None
    verses = hymn.get("verses")
    if isinstance(verses, dict):
        v = verses.get(str(label))
        if isinstance(v, dict):
            return v.get("korean")
    return None


def load_json_format2(dir_path):
    """Index json-format2 v1 sources by number/title/filename. CCM files nest the
    hymn under a single title key ({title: {verses, chorus, ...}}) — unwrap those."""
    src = {}
    if not os.path.isdir(dir_path):
        return src
    for fp in glob.glob(os.path.join(dir_path, "*.json")):
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


def load_v1_db(db_path):
    src = {}
    if not db_path or not os.path.exists(db_path):
        return src
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT number, hymn_json FROM saved_hymns").fetchall()
    except sqlite3.OperationalError:
        return src
    finally:
        con.close()
    for number, hymn_json in rows:
        try:
            src[str(number)] = json.loads(hymn_json)
        except (json.JSONDecodeError, TypeError):
            continue
    return src


def load_sources(json_format2_dir=DEFAULT_JSON_FORMAT2, user_db=DEFAULT_USER_DB, baseline_db=DEFAULT_BASELINE):
    """Prioritized source list (highest first): json-format2 > user DB > repo baseline."""
    return [
        ("json-format2", load_json_format2(json_format2_dir)),
        ("user-db", load_v1_db(user_db)),
        ("baseline", load_v1_db(baseline_db)),
    ]


def _assign_from_counts(line_ns, counts):
    """Given the per-slide line counts and the sorted line 'n' values of a section,
    return (slideIndex_by_n dict, slideBreaks) if every n maps, else None."""
    total = sum(counts)
    if total != len(line_ns):
        return None
    # cumulative boundaries C[]
    cum = [0]
    for c in counts:
        cum.append(cum[-1] + c)
    slide_of = {}
    for n in line_ns:
        k = None
        for i in range(len(counts)):
            if cum[i] <= n < cum[i + 1]:
                k = i
                break
        if k is None:
            return None  # n out of range -> this source does not match
        slide_of[n] = k
    slide_breaks = cum[1:-1]  # line-index where each subsequent slide starts
    return slide_of, slide_breaks


def backfill_doc(doc, sources):
    """Assign slideIndex (line-level) + slideBreaks (section-level) in place.
    Returns (n_sections, n_lines, n_gap_sections). A gap section is one no source matched."""
    number = str(doc.get("number", ""))
    n_sections = n_lines = n_gaps = 0
    for sec in doc.get("sections", []) or []:
        n_sections += 1
        lines = sec.get("lines", []) or []
        n_lines += len(lines)
        # Empty section (0 lines — a v2 structural artifact, e.g. a placeholder chorus):
        # nothing to assign, not a gap. Preserve it losslessly with an empty slideBreaks.
        if not lines:
            sec["slideBreaks"] = []
            continue
        line_ns = []
        for ln in lines:
            m = _LINE_ID.match(str(ln.get("id", "")))
            line_ns.append(int(m.group(2)) if m else None)
        if any(n is None for n in line_ns):
            n_gaps += 1
            continue
        kind, label = sec.get("kind"), sec.get("label")
        assigned = None
        for _name, src in sources:
            hymn = src.get(number)
            if hymn is None:
                continue
            korean = section_korean(hymn, kind, label)
            if not korean:
                continue
            res = _assign_from_counts(sorted(line_ns), slide_line_counts(korean))
            if res is not None:
                assigned = res
                break
        if assigned is None:
            # Deterministic default (D9): 2 lines per slide, matches corpus 90.6% (research §8.3/§10.5).
            counts = []
            remaining = len(lines)
            while remaining > 0:
                take = min(2, remaining)
                counts.append(take)
                remaining -= take
            assigned = _assign_from_counts(sorted(line_ns), counts)
            n_gaps += 1  # record that no v1 source matched (default was used)
        slide_of, slide_breaks = assigned
        for ln in lines:
            m = _LINE_ID.match(str(ln.get("id", "")))
            ln["slideIndex"] = slide_of[int(m.group(2))]
        sec["slideBreaks"] = slide_breaks
    return n_sections, n_lines, n_gaps


def run_backfill(baseline_path, sources=None, backup=True):
    """Backfill slide groups into every saved_hymns_v3 doc. Returns stats dict."""
    if sources is None:
        sources = load_sources()
    con = sqlite3.connect(f"file:{baseline_path}?mode=ro", uri=True)
    rows = con.execute("SELECT number, doc_json FROM saved_hymns_v3 ORDER BY number").fetchall()
    con.close()

    updates = []
    songs = sections = lines = gap_sections = 0
    for number, doc_json in rows:
        doc = json.loads(doc_json)
        s, l, g = backfill_doc(doc, sources)
        songs += 1
        sections += s
        lines += l
        gap_sections += g
        updates.append((canonical_doc.canonical_stringify(doc), canonical_doc.compute_content_hash(doc), number))

    if backup and os.path.exists(baseline_path):
        shutil.copy2(baseline_path, f"{baseline_path}.bak.{int(time.time())}")

    con = sqlite3.connect(baseline_path)
    try:
        con.execute("PRAGMA journal_mode = WAL")
        con.executemany("UPDATE saved_hymns_v3 SET doc_json=?, content_hash=? WHERE number=?", updates)
        con.commit()
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()
    return {"songs": songs, "sections": sections, "lines": lines, "gap_sections": gap_sections}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Backfill slide groups into saved_hymns_v3")
    ap.add_argument("--baseline", default=DEFAULT_BASELINE)
    ap.add_argument("--json-format2", default=DEFAULT_JSON_FORMAT2)
    ap.add_argument("--user-db", default=DEFAULT_USER_DB)
    ap.add_argument("--write", action="store_true", help="apply (default: report only)")
    args = ap.parse_args(argv)
    sources = load_sources(args.json_format2, args.user_db, args.baseline)
    if not args.write:
        # Dry report against a read of the baseline without writing back.
        con = sqlite3.connect(f"file:{args.baseline}?mode=ro", uri=True)
        rows = con.execute("SELECT number, doc_json FROM saved_hymns_v3").fetchall()
        con.close()
        songs = sections = lines = gaps = 0
        for number, dj in rows:
            s, l, g = backfill_doc(json.loads(dj), sources)
            songs += 1; sections += s; lines += l; gaps += g
        print(f"(dry-run) songs={songs} sections={sections} lines={lines} gap_sections={gaps}")
        return 0
    stats = run_backfill(args.baseline, sources, backup=True)
    print(f"backfill: {stats}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
