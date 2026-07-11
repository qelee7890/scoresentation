// @MX:ANCHOR: [AUTO] Canonical dual-lyrics document model — shared shape/serialization for db.js, import, and ledger.
// @MX:REASON: fan_in >= 3 (main/db.js canonical read path, tools import pipeline via golden vectors, main/ledger.js hash) — the doc shape and canonicalStringify convention are the single source of truth.
//
// SPEC-LYRICS-001 (T-002). PURE JS: this module MUST NOT import better-sqlite3 or
// main/db.js (directly or transitively) so it runs under plain `node --test`.
//
// @MX:NOTE: [AUTO] Data conventions for the syllable-first canonical doc (schemaVersion 3):
//   - Syllable is first-class: each owns surface{ko,es,en} and its own notes[].
//   - KO melisma = one syllable owning notes.length > 1 (+ melisma:true).
//   - continuation syllable = surface.ko "" + continuation:true (tie/slur tail, koJoinPrev).
//   - ES N-glyph binding = a multi-word surface.es on ONE syllable slot; wbEs
//     (start|mid|end|standalone) is recorded independently of the KO wordBoundary (D10).
//   - Curation fields (koJoinPrev/koJoinNext/esJoinNext, respacing via leadSpace,
//     slideIndex/slideBreaks[], stable syllable id) are first-class persisted data.
//   - Lossless meta (tempo/newTitle/beamGroup/melisma/continuation/_provenance) is preserved verbatim.

export const SCHEMA_VERSION = 3;

const NOTE_DEFAULTS = { dotted: false, accidental: null, beamGroup: null, fermata: false };

// ── Canonical serialization convention (shared with the Python side & the ledger) ──
//
// @MX:NOTE: [AUTO] ONE canonical serialization convention, mirrored byte-for-byte in Python
//   (json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))):
//   recursively sort object keys (by code point), compact separators (","/":"), keep
//   non-ASCII literal (UTF-8), no trailing whitespace. sha256 is taken over the UTF-8 bytes.
//   Cross-verified by shared golden vectors asserted by BOTH node:test and Python unittest.

function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
        return out;
    }
    return value;
}

export function canonicalStringify(value) {
    return JSON.stringify(sortKeysDeep(value));
}

export function serialize(doc) {
    return canonicalStringify(doc);
}

export function deserialize(str) {
    return JSON.parse(str);
}

// ── Normalization ───────────────────────────────────────────────────────────

function normalizeNote(note) {
    const n = note && typeof note === "object" ? note : {};
    return {
        pitch: String(n.pitch ?? ""),
        dur: String(n.dur ?? ""),
        dotted: n.dotted ?? NOTE_DEFAULTS.dotted,
        accidental: n.accidental ?? NOTE_DEFAULTS.accidental,
        beamGroup: n.beamGroup ?? NOTE_DEFAULTS.beamGroup,
        fermata: n.fermata ?? NOTE_DEFAULTS.fermata,
    };
}

function normalizeSyllable(syl) {
    const s = syl && typeof syl === "object" ? syl : {};
    const surface = s.surface && typeof s.surface === "object" ? s.surface : {};
    const out = {
        surface: {
            ko: surface.ko ?? "",
            es: surface.es ?? null,
            en: surface.en ?? null,
        },
        wordBoundary: s.wordBoundary ?? "standalone",
        leadSpace: s.leadSpace ?? false,
        melisma: s.melisma ?? false,
        notes: Array.isArray(s.notes) ? s.notes.map(normalizeNote) : [],
    };
    // Optional first-class fields: preserved verbatim only when present (lossless, no fabrication).
    if (s.id !== undefined) out.id = s.id;
    if (s.wbEs !== undefined) out.wbEs = s.wbEs;
    if (s.continuation !== undefined) out.continuation = s.continuation;
    if (s.koJoinPrev !== undefined) out.koJoinPrev = s.koJoinPrev;
    if (s.koJoinNext !== undefined) out.koJoinNext = s.koJoinNext;
    if (s.esJoinNext !== undefined) out.esJoinNext = s.esJoinNext;
    return out;
}

function normalizeLine(line) {
    const l = line && typeof line === "object" ? line : {};
    const out = {
        id: String(l.id ?? ""),
        textOnly: l.textOnly ?? false,
        syllables: Array.isArray(l.syllables) ? l.syllables.map(normalizeSyllable) : [],
    };
    if (l.slideIndex !== undefined) out.slideIndex = l.slideIndex;
    return out;
}

function normalizeSection(section) {
    const sec = section && typeof section === "object" ? section : {};
    const out = {
        kind: sec.kind ?? "verse",
        label: sec.label ?? "",
        altLanguages: sec.altLanguages && typeof sec.altLanguages === "object" ? sec.altLanguages : {},
        lines: Array.isArray(sec.lines) ? sec.lines.map(normalizeLine) : [],
    };
    if (sec.slideBreaks !== undefined) out.slideBreaks = sec.slideBreaks;
    return out;
}

// normalizeDoc fills structural defaults without dropping any data present on the input.
export function normalizeDoc(doc) {
    const d = doc && typeof doc === "object" ? doc : {};
    const prov = d._provenance && typeof d._provenance === "object" ? d._provenance : {};
    const out = {
        schemaVersion: SCHEMA_VERSION,
        id: String(d.id ?? d.number ?? ""),
        number: String(d.number ?? d.id ?? ""),
        newNumber: d.newNumber ?? "",
        title: d.title ?? "",
        composer: d.composer ?? "",
        category: d.category ?? (/^\d+$/.test(String(d.number ?? "")) ? "hymn" : "song"),
        key: d.key ?? "",
        timeSignature: d.timeSignature ?? "",
        sections: Array.isArray(d.sections) ? d.sections.map(normalizeSection) : [],
        _provenance: {
            migratedFrom: prov.migratedFrom ?? null,
            sourceHash: prov.sourceHash ?? null,
            migratedAt: prov.migratedAt ?? null,
            warnings: Array.isArray(prov.warnings) ? prov.warnings : [],
        },
    };
    // Volatile / optional top-level fields — preserved only when present.
    if (d.rev !== undefined) out.rev = d.rev;
    if (d.updatedAt !== undefined) out.updatedAt = d.updatedAt;
    if (d.tempo !== undefined) out.tempo = d.tempo;
    if (d.newTitle !== undefined) out.newTitle = d.newTitle;
    return out;
}

// ── Stable syllable IDs ───────────────────────────────────────────────────────
//
// @MX:NOTE: [AUTO] Stable syllable id = `${line.id}#${indexWithinLine}` (e.g. "s1.0#2").
//   Position-independent binding removes the v1 char-position fragility (research §7.1):
//   editing text keeps notes/foreign surfaces attached to their syllable id.
export function assignSyllableIds(doc) {
    for (const section of doc.sections ?? []) {
        for (const line of section.lines ?? []) {
            const lineId = line.id ?? "";
            (line.syllables ?? []).forEach((syl, i) => {
                if (syl.id === undefined) syl.id = `${lineId}#${i}`;
            });
        }
    }
    return doc;
}

// ── Iteration helper ──────────────────────────────────────────────────────────

export function* iterSyllables(doc) {
    for (const [si, section] of (doc.sections ?? []).entries()) {
        for (const [li, line] of (section.lines ?? []).entries()) {
            for (const [yi, syllable] of (line.syllables ?? []).entries()) {
                yield { section, line, syllable, sectionIndex: si, lineIndex: li, syllableIndex: yi };
            }
        }
    }
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_SECTION_KINDS = new Set(["verse", "chorus"]);

export function validateDoc(doc) {
    const errors = [];
    if (!doc || typeof doc !== "object") {
        return { valid: false, errors: ["doc is not an object"] };
    }
    if (doc.schemaVersion !== SCHEMA_VERSION) {
        errors.push(`schemaVersion must be ${SCHEMA_VERSION}, got ${doc.schemaVersion}`);
    }
    if (!doc.number || typeof doc.number !== "string") {
        errors.push("number must be a non-empty string");
    }
    if (!doc.category || typeof doc.category !== "string") {
        errors.push("category must be a non-empty string");
    }
    if (!Array.isArray(doc.sections)) {
        errors.push("sections must be an array");
        return { valid: errors.length === 0, errors };
    }
    doc.sections.forEach((sec, si) => {
        const at = `sections[${si}]`;
        if (!VALID_SECTION_KINDS.has(sec.kind)) errors.push(`${at}.kind invalid: ${sec.kind}`);
        if (typeof sec.label !== "string") errors.push(`${at}.label must be a string`);
        if (!Array.isArray(sec.lines)) {
            errors.push(`${at}.lines must be an array`);
            return;
        }
        sec.lines.forEach((line, li) => {
            const lat = `${at}.lines[${li}]`;
            if (!line.id || typeof line.id !== "string") errors.push(`${lat}.id must be a non-empty string`);
            if (!Array.isArray(line.syllables)) {
                errors.push(`${lat}.syllables must be an array`);
                return;
            }
            line.syllables.forEach((syl, yi) => {
                const yat = `${lat}.syllables[${yi}]`;
                if (!syl.surface || typeof syl.surface !== "object") {
                    errors.push(`${yat}.surface missing`);
                } else {
                    if (typeof syl.surface.ko !== "string") errors.push(`${yat}.surface.ko must be a string`);
                    if (!("es" in syl.surface)) errors.push(`${yat}.surface.es missing`);
                    if (!("en" in syl.surface)) errors.push(`${yat}.surface.en missing`);
                }
                if (!Array.isArray(syl.notes)) {
                    errors.push(`${yat}.notes must be an array`);
                } else {
                    syl.notes.forEach((n, ni) => {
                        if (!n.pitch && n.pitch !== "") errors.push(`${yat}.notes[${ni}].pitch missing`);
                        if (typeof n.dur !== "string") errors.push(`${yat}.notes[${ni}].dur must be a string`);
                    });
                }
            });
        });
    });
    return { valid: errors.length === 0, errors };
}
