// Sync-ledger foundation tests (SPEC-LYRICS-001, T-009). Pure node:test — no better-sqlite3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as ledger from "../main/ledger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLD = path.join(here, "fixtures", "canonical-golden");

function goldenVectors() {
    return readdirSync(GOLD)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(path.join(GOLD, f), "utf-8")));
}

// ── GWT-D1: deterministic, v2-independent content hash + cross-language parity ──

test("GWT-D1: computeContentHash matches the pinned golden vectors (cross-language parity with Python)", () => {
    const vectors = goldenVectors();
    assert.ok(vectors.length >= 2, "golden vectors present");
    for (const v of vectors) {
        assert.equal(ledger.computeContentHash(v.doc), v.contentHash, `hash mismatch for ${v.name}`);
    }
});

test("GWT-D1: hash is identical across two runs (determinism)", () => {
    for (const v of goldenVectors()) {
        assert.equal(ledger.computeContentHash(v.doc), ledger.computeContentHash(v.doc));
    }
});

test("GWT-D1: hash ignores volatile fields (v2 rev/source_hash/updatedAt, _provenance, syllable id)", () => {
    const v = goldenVectors().find((x) => x.name === "simple-ko");
    const mutated = JSON.parse(JSON.stringify(v.doc));
    mutated.rev = 999;
    mutated.updatedAt = "2099-01-01T00:00:00Z";
    mutated._provenance.sourceHash = "sha256:totally-different";
    mutated.sections[0].lines[0].syllables[0].id = "renamed#0";
    assert.equal(ledger.computeContentHash(mutated), v.contentHash, "volatile fields must not affect the hash");
});

test("GWT-D1: a real content change DOES change the hash", () => {
    const v = goldenVectors().find((x) => x.name === "simple-ko");
    const changed = JSON.parse(JSON.stringify(v.doc));
    changed.sections[0].lines[0].syllables[0].surface.ko = "different";
    assert.notEqual(ledger.computeContentHash(changed), v.contentHash);
});

// ── read primitives ──

test("createLedger exposes lookup + baseSnapshot read primitives", () => {
    const l = ledger.createLedger([
        { number: "495", rev: 1, contentHash: "sha256:aaa" },
        { number: "190", rev: 2, contentHash: "sha256:bbb" },
    ]);
    assert.equal(l.size, 2);
    assert.deepEqual(l.lookup("495"), { rev: 1, contentHash: "sha256:aaa" });
    assert.deepEqual(l.baseSnapshot("190"), { rev: 2, contentHash: "sha256:bbb" });
    assert.equal(l.lookup("000"), null);
    assert.equal(l.baseSnapshot("000"), null);
});

// ── GWT-D2: scope boundary — foundation only, no merge/export ──

test("GWT-D2: ledger exposes ONLY the 3 read primitives — no 3-way merge / no export (SPEC-003)", () => {
    const exported = Object.keys(ledger).sort();
    assert.deepEqual(exported, ["computeContentHash", "createLedger"]);
    for (const forbidden of ["merge", "reconcile", "threeWayMerge", "export", "exportToKoscriber", "apply"]) {
        assert.equal(ledger[forbidden], undefined, `${forbidden} must not exist in the foundation ledger`);
    }
    const l = ledger.createLedger([]);
    const keys = Object.keys(l);
    for (const primitive of ["lookup", "baseSnapshot", "computeContentHash"]) {
        assert.ok(keys.includes(primitive), `read primitive ${primitive} present`);
    }
    for (const forbidden of ["merge", "reconcile", "threeWayMerge", "export", "exportToKoscriber", "apply"]) {
        assert.equal(l[forbidden], undefined, `${forbidden} must not exist on the foundation ledger`);
    }
});
