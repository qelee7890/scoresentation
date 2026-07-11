// Tests for the pure-JS canonical dual-lyrics document model (SPEC-LYRICS-001, T-002).
// Runs under plain `node --test` — MUST NOT require better-sqlite3 / main/db.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    SCHEMA_VERSION,
    serialize,
    deserialize,
    canonicalStringify,
    normalizeDoc,
    assignSyllableIds,
    validateDoc,
    iterSyllables,
} from "../main/canonical-doc.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

// A KO 1:N melisma syllable owning two notes, plus dual surface + lossless note meta.
function melismaSyllable() {
    return {
        surface: { ko: "샘", es: "Hay u", en: null },
        wordBoundary: "start",
        leadSpace: false,
        melisma: true,
        wbEs: "mid",
        notes: [
            { pitch: "C4", dur: "8", dotted: false, accidental: null, beamGroup: 0, fermata: false },
            { pitch: "E4", dur: "8", dotted: false, accidental: null, beamGroup: 0, fermata: false },
        ],
    };
}

// A doc carrying lossless meta (tempo/newTitle/beamGroup/melisma/continuation/_provenance)
// plus curation fields (koJoinPrev/koJoinNext/esJoinNext, slideIndex/slideBreaks).
function sampleDoc() {
    return {
        schemaVersion: SCHEMA_VERSION,
        rev: 1,
        updatedAt: "2026-07-11T00:00:00Z",
        id: "190",
        number: "190",
        newNumber: "254",
        title: "샘물과 같은 보혈은",
        newTitle: "샘물과 같은 보혈은(개정)",
        composer: "L.Mason",
        category: "hymn",
        key: "3b",
        timeSignature: "4/4",
        tempo: "♩=92",
        sections: [
            {
                kind: "verse",
                label: "1",
                slideBreaks: [1],
                altLanguages: {},
                lines: [
                    {
                        id: "s1.0",
                        textOnly: false,
                        slideIndex: 0,
                        syllables: [
                            melismaSyllable(),
                            {
                                surface: { ko: "물", es: "na", en: null },
                                wordBoundary: "end",
                                leadSpace: false,
                                melisma: false,
                                wbEs: "end",
                                koJoinPrev: true,
                                notes: [
                                    { pitch: "G4", dur: "q", dotted: false, accidental: null, beamGroup: null, fermata: false },
                                ],
                            },
                        ],
                    },
                    {
                        id: "s1.1",
                        textOnly: false,
                        slideIndex: 1,
                        syllables: [
                            {
                                surface: { ko: "", es: null, en: null },
                                wordBoundary: "continuation",
                                leadSpace: false,
                                melisma: true,
                                continuation: true,
                                koJoinPrev: true,
                                notes: [
                                    { pitch: "B4", dur: "q", dotted: false, accidental: null, beamGroup: null, fermata: false },
                                ],
                            },
                            {
                                surface: { ko: "라", es: "cir", en: null },
                                wordBoundary: "standalone",
                                leadSpace: true,
                                melisma: false,
                                wbEs: "standalone",
                                esJoinNext: true,
                                koJoinNext: true,
                                notes: [
                                    { pitch: "A4", dur: "8", dotted: false, accidental: null, beamGroup: null, fermata: false },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
        _provenance: {
            migratedFrom: "v2",
            sourceHash: "sha256:deadbeef",
            migratedAt: "2026-07-03T00:00:00Z",
            warnings: [],
        },
    };
}

// ── GWT-A1: model shape + lossless round-trip ───────────────────────────────

test("GWT-A1: syllable is first-class — owns surface{ko,es,en} and its own notes[] (KO 1:N melisma)", () => {
    const doc = sampleDoc();
    const syl = doc.sections[0].lines[0].syllables[0];
    assert.equal(syl.surface.ko, "샘");
    assert.equal(syl.surface.es, "Hay u");
    assert.equal(syl.surface.en, null);
    assert.equal(syl.notes.length, 2, "melisma syllable owns >1 note (KO 1:N)");
});

test("GWT-A1: schemaVersion is 3 and lossless meta survives serialize→deserialize round-trip", () => {
    const doc = normalizeDoc(sampleDoc());
    assert.equal(doc.schemaVersion, 3);
    const round = deserialize(serialize(doc));
    assert.deepEqual(round, doc, "round-trip must be lossless");
    // Spot-check the explicitly lossless meta fields.
    assert.equal(round.tempo, "♩=92");
    assert.equal(round.newTitle, "샘물과 같은 보혈은(개정)");
    assert.equal(round.sections[0].lines[0].syllables[0].notes[0].beamGroup, 0);
    assert.equal(round.sections[0].lines[0].syllables[0].melisma, true);
    assert.equal(round.sections[0].lines[1].syllables[0].continuation, true);
    assert.deepEqual(round._provenance.warnings, []);
});

// ── GWT-A2: curation fields + stable IDs are first-class ─────────────────────

test("GWT-A2: curation fields (koJoinPrev/koJoinNext/esJoinNext, slideIndex/slideBreaks) are first-class and survive round-trip", () => {
    const doc = normalizeDoc(sampleDoc());
    const round = deserialize(serialize(doc));
    assert.equal(round.sections[0].lines[0].syllables[1].koJoinPrev, true);
    assert.equal(round.sections[0].lines[1].syllables[1].koJoinNext, true);
    assert.equal(round.sections[0].lines[1].syllables[1].esJoinNext, true);
    assert.deepEqual(round.sections[0].slideBreaks, [1]);
    assert.equal(round.sections[0].lines[1].slideIndex, 1);
});

test("GWT-A2: assignSyllableIds gives stable, deterministic, idempotent syllable IDs", () => {
    const doc = assignSyllableIds(normalizeDoc(sampleDoc()));
    const ids = [...iterSyllables(doc)].map((s) => s.syllable.id);
    assert.deepEqual(ids, ["s1.0#0", "s1.0#1", "s1.1#0", "s1.1#1"]);
    // Idempotent: re-running does not change IDs.
    const again = assignSyllableIds(doc);
    const ids2 = [...iterSyllables(again)].map((s) => s.syllable.id);
    assert.deepEqual(ids2, ids);
});

// ── GWT-A3: ES N-glyph → 1 slot, wbEs independent of KO boundary ─────────────

test("GWT-A3: ES N-glyph 'Hay u' (2 words) binds to one syllable slot; wbEs recorded independently of KO wordBoundary", () => {
    const doc = normalizeDoc(sampleDoc());
    const syl = doc.sections[0].lines[0].syllables[0];
    // One KO syllable slot holds a multi-word ES surface (N glyphs → 1 slot).
    assert.equal(syl.surface.es, "Hay u");
    assert.ok(syl.surface.es.includes(" "), "ES surface preserves multi-word glyphs");
    // wbEs is independent of the KO wordBoundary.
    assert.equal(syl.wordBoundary, "start");
    assert.equal(syl.wbEs, "mid");
    // The new schema admits wbEs 'end'/'standalone' (D10 extension).
    assert.equal(doc.sections[0].lines[0].syllables[1].wbEs, "end");
    assert.equal(doc.sections[0].lines[1].syllables[1].wbEs, "standalone");
});

// ── canonical serialization convention ──────────────────────────────────────

test("canonicalStringify is deterministic regardless of key insertion order", () => {
    const a = { b: 1, a: 2, nested: { y: 1, x: 2 } };
    const b = { a: 2, nested: { x: 2, y: 1 }, b: 1 };
    assert.equal(canonicalStringify(a), canonicalStringify(b));
    // Sorted keys, compact separators (no spaces), non-ASCII preserved literally.
    assert.equal(canonicalStringify({ z: "가", a: 1 }), '{"a":1,"z":"가"}');
});

// ── validation ──────────────────────────────────────────────────────────────

test("validateDoc accepts a normalized valid doc", () => {
    const doc = normalizeDoc(sampleDoc());
    const res = validateDoc(doc);
    assert.equal(res.valid, true, JSON.stringify(res.errors));
    assert.deepEqual(res.errors, []);
});

test("validateDoc rejects wrong schema version, missing number, and malformed syllable", () => {
    const bad = normalizeDoc(sampleDoc());
    bad.schemaVersion = 2;
    bad.number = "";
    delete bad.sections[0].lines[0].syllables[0].surface;
    const res = validateDoc(bad);
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => /schemaVersion/.test(e)));
    assert.ok(res.errors.some((e) => /number/.test(e)));
    assert.ok(res.errors.some((e) => /surface/.test(e)));
});

test("normalizeDoc fills structural defaults without dropping data", () => {
    const minimal = {
        number: "1",
        category: "hymn",
        sections: [
            { kind: "verse", label: "1", lines: [{ id: "s1.0", syllables: [{ surface: { ko: "주" }, notes: [] }] }] },
        ],
    };
    const doc = normalizeDoc(minimal);
    assert.equal(doc.schemaVersion, SCHEMA_VERSION);
    const syl = doc.sections[0].lines[0].syllables[0];
    assert.equal(syl.surface.es, null);
    assert.equal(syl.surface.en, null);
    assert.equal(syl.surface.ko, "주");
    assert.ok(Array.isArray(doc._provenance.warnings));
});
