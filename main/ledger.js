// @MX:ANCHOR: [AUTO] Sync-ledger foundation — deterministic content hashing + read-only
// (number, rev, contentHash) primitives shared by db.js glue, the init tool (via golden
// vectors), and future SPEC-003 reconcile. fan_in >= 3.
// @MX:REASON: the contentHash convention is the cross-language contract (JS == Python);
// any drift silently breaks 3-way merge, so it is centralized and golden-vector pinned.
//
// SPEC-LYRICS-001 (T-009). PURE JS: MUST NOT import better-sqlite3 or main/db.js.
// Uses only node builtins (node:crypto) + the pure canonical-doc convention.
//
// Scope guard: this module exposes ONLY the three read primitives (lookup, baseSnapshot,
// computeContentHash). No 3-way merge and no koscriber export live here — those are
// deferred to SPEC-003 (GWT-D2).
import { createHash } from "node:crypto";
import { canonicalStringify } from "./canonical-doc.js";

// Volatile top-level fields excluded from the content hash — mirrored in tools/canonical_doc.py
// (_VOLATILE_TOP). v2 rev/source_hash are distrusted; the hash is recomputed from content.
const VOLATILE_TOP = ["rev", "updatedAt", "_provenance"];

function contentProjection(doc) {
    const proj = JSON.parse(JSON.stringify(doc));
    for (const k of VOLATILE_TOP) delete proj[k];
    for (const section of proj.sections ?? []) {
        for (const line of section.lines ?? []) {
            for (const syllable of line.syllables ?? []) delete syllable.id;
        }
    }
    return proj;
}

// @MX:NOTE: [AUTO] contentHash = "sha256:" + sha256(UTF-8 canonicalStringify(contentProjection(doc))).
// Deterministic and v2-independent (recomputed from content, never from v2 rev/source_hash).
export function computeContentHash(doc) {
    const payload = canonicalStringify(contentProjection(doc));
    return "sha256:" + createHash("sha256").update(payload, "utf8").digest("hex");
}

// createLedger builds the in-memory read index from (number, rev, contentHash) entries.
// The DB glue (loading entries from saved_hymns_v3 / sync_ledger) lives in db.js — this pure
// module stays ABI-free.
export function createLedger(entries) {
    const map = new Map();
    for (const e of entries ?? []) {
        map.set(String(e.number), { rev: e.rev, contentHash: e.contentHash });
    }
    return {
        // lookup(number) -> { rev, contentHash } | null
        lookup(number) {
            return map.get(String(number)) ?? null;
        },
        // baseSnapshot(number) -> { rev, contentHash } | null  (common-ancestor snapshot for a future 3-way merge)
        baseSnapshot(number) {
            const e = map.get(String(number));
            return e ? { rev: e.rev, contentHash: e.contentHash } : null;
        },
        computeContentHash,
        get size() {
            return map.size;
        },
    };
}
