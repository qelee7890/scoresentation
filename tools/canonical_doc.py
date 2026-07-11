"""Python mirror of main/canonical-doc.js — shared canonical model + serialization.

SPEC-LYRICS-001. This is the Python half of the ONE canonical serialization
convention, kept byte-for-byte identical to the JS side so contentHash values
match across languages (cross-verified by shared golden vectors, T-009):

    json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))

- sort_keys=True     -> keys sorted by code point (JS Object.keys().sort() parity for ASCII keys)
- ensure_ascii=False -> non-ASCII kept literal (UTF-8), matching JS JSON.stringify
- separators=(",",":")-> compact, no spaces (JS default)
"""
import copy
import hashlib
import json

SCHEMA_VERSION = 3

# Volatile top-level fields excluded from the content hash (distrust v2 rev/source_hash;
# provenance/timestamps are not content). Mirrored in main/ledger.js.
_VOLATILE_TOP = ("rev", "updatedAt", "_provenance")


def canonical_stringify(value) -> str:
    """Deterministic canonical JSON string (sorted keys, compact separators, UTF-8)."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def assign_syllable_ids(doc):
    """Assign stable syllable ids `${line.id}#${index}` in place (idempotent)."""
    for sec in doc.get("sections", []) or []:
        for ln in sec.get("lines", []) or []:
            lid = ln.get("id", "")
            for i, syl in enumerate(ln.get("syllables", []) or []):
                syl.setdefault("id", f"{lid}#{i}")
    return doc


def content_projection(doc):
    """Deep-copy projection used for hashing: drop volatile top-level fields and
    derived syllable ids, keep all musical/lyric/curation content."""
    proj = copy.deepcopy(doc)
    for k in _VOLATILE_TOP:
        proj.pop(k, None)
    for sec in proj.get("sections", []) or []:
        for ln in sec.get("lines", []) or []:
            for syl in ln.get("syllables", []) or []:
                syl.pop("id", None)
    return proj


def compute_content_hash(doc) -> str:
    """Deterministic content hash: sha256 over the canonical UTF-8 bytes of the
    content projection. Recomputed from content (never trusts v2 rev/source_hash)."""
    payload = canonical_stringify(content_projection(doc)).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()
