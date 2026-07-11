// Purity guard (SPEC-LYRICS-001 HARD constraint): the pure-JS canonical/ledger
// modules MUST NOT import better-sqlite3 or main/db.js — directly or transitively —
// so they load and run under plain `node --test` (ABI isolation: the native binary
// is built for Electron and fails under Node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Modules that must stay ABI-pure. ledger.js arrives in T-009 — guarded by existence.
const PURE_MODULES = ["../main/canonical-doc.js", "../main/ledger.js"];
const FORBIDDEN = [/better-sqlite3/, /\bdb\.js\b/, /main\/db/];

function existing() {
    return PURE_MODULES.filter((rel) => existsSync(path.join(here, rel)));
}

test("pure modules load under plain node (no native-ABI import)", async () => {
    const mods = existing();
    assert.ok(mods.length >= 1, "at least canonical-doc.js must exist");
    for (const rel of mods) {
        const mod = await import(rel); // throws if it transitively pulls in better-sqlite3
        assert.equal(typeof mod, "object");
    }
    const cdoc = await import("../main/canonical-doc.js");
    assert.equal(typeof cdoc.canonicalStringify, "function");
});

test("pure modules contain no forbidden native/db imports (static source scan)", () => {
    for (const rel of existing()) {
        const src = readFileSync(path.join(here, rel), "utf-8");
        // Only inspect actual import/require statement lines, not comments describing the rule.
        const importLines = src
            .split("\n")
            .filter((l) => /(^\s*import\b|(^\s*(const|let|var|export)\b.*\brequire\s*\()|(^\s*require\s*\())/.test(l));
        for (const pat of FORBIDDEN) {
            const hit = importLines.find((l) => pat.test(l));
            assert.equal(hit, undefined, `${rel}: forbidden import matching ${pat}: ${hit}`);
        }
    }
});
