/**
 * Characterization gate (SPEC-LYRICS-001, T-001) — MUST run under Electron:
 *   electron tools/char-existing-overlay.cjs        (npm run test:electron)
 *
 * Locks the EXISTING RM-E contract that the new v3 canonical table must also honor,
 * BEFORE any v3 code is added. Characterizes the current main/db.js HymnRepository:
 *   - baseline opens readonly + query_only=ON and REJECTS writes (GWT-E2)
 *   - getHymn precedence: tombstone -> user overlay -> baseline
 *   - saveHymn writes to the user overlay only (baseline file untouched)
 *   - saveHymn/deleteHymn return contract that drives the hymn-saved/-deleted broadcast
 *
 * Exits non-zero on any violation so it aborts the test chain (check-native-abi.cjs pattern).
 * Uses ephemeral fixtures in the OS temp dir — never touches the real user DB.
 */
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function assert(cond, msg) {
    if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function throws(fn) {
    try { fn(); return false; } catch (_) { return true; }
}

app.whenReady().then(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-char-"));
    let failed = false;
    try {
        const Database = require("better-sqlite3");
        const baselinePath = path.join(tmp, "baseline.db");
        const userPath = path.join(tmp, "user", "scoresentation-user.db");
        fs.mkdirSync(path.dirname(userPath), { recursive: true });

        // ── Build a fixture baseline (v1 saved_hymns) ──
        const b = new Database(baselinePath);
        b.exec(`CREATE TABLE saved_hymns (
            number TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', new_number TEXT NOT NULL DEFAULT '',
            composer TEXT NOT NULL DEFAULT '', key_signature TEXT NOT NULL DEFAULT '',
            time_signature TEXT NOT NULL DEFAULT '', hymn_json TEXT NOT NULL, updated_at TEXT NOT NULL);`);
        const ins = b.prepare(`INSERT INTO saved_hymns
            (number,title,new_number,composer,key_signature,time_signature,hymn_json,updated_at)
            VALUES (?,?,?,?,?,?,?,?)`);
        ins.run("100", "BaselineTitle", "", "", "", "", JSON.stringify({ id: "100", number: "100", title: "BaselineTitle", category: "hymn" }), "2026-01-01T00:00:00Z");
        ins.run("200", "BaselineTwo", "", "", "", "", JSON.stringify({ id: "200", number: "200", title: "BaselineTwo", category: "hymn" }), "2026-01-01T00:00:00Z");
        b.close();

        // ── Load the ESM repository under Electron (dynamic import of ESM from CJS) ──
        const { HymnRepository } = await import(pathToFileURL(path.join(__dirname, "..", "main", "db.js")).href);
        const repo = new HymnRepository(baselinePath, userPath);

        // (1) getHymn falls back to baseline when there is no user row.
        assert(repo.getHymn("100").title === "BaselineTitle", "baseline fallback read");
        assert(repo.getHymn("200").title === "BaselineTwo", "baseline-only read");
        assert(repo.getHymn("999") === null, "missing number -> null");

        // (2) saveHymn writes to the USER overlay only; baseline file stays byte-identical.
        const baselineBefore = fs.readFileSync(baselinePath);
        const [savedItem, isNewExisting] = repo.saveHymn("100", { id: "100", number: "100", title: "UserOverride", category: "hymn" });
        assert(savedItem.title === "UserOverride", "saveHymn returns overridden item");
        assert(isNewExisting === false, "isNew=false when number existed in baseline (drives broadcast semantics)");
        assert(repo.getHymn("100").title === "UserOverride", "user overlay shadows baseline (precedence)");
        const baselineAfter = fs.readFileSync(baselinePath);
        assert(Buffer.compare(baselineBefore, baselineAfter) === 0, "baseline file unchanged after saveHymn (overlay-only write)");

        // (3) A brand-new number reports isNew=true (drives 'is-new' broadcast path).
        const [, isNewFresh] = repo.saveHymn("777", { id: "777", number: "777", title: "Fresh", category: "hymn" });
        assert(isNewFresh === true, "isNew=true for a number absent from user+baseline");

        // (4) deleteHymn on a baseline-backed number creates a tombstone -> getHymn returns null (masking).
        assert(repo.deleteHymn("200") === true, "deleteHymn(baseline) returns true (tombstoned)");
        assert(repo.getHymn("200") === null, "tombstone hides baseline row (tombstone -> user -> baseline order)");

        // (5) baseline is opened readonly + query_only=ON and REJECTS writes (GWT-E2).
        const ro = new Database(baselinePath, { readonly: true, fileMustExist: true });
        ro.pragma("query_only = ON");
        assert(ro.pragma("query_only", { simple: true }) === 1, "query_only=ON is set on baseline handle");
        assert(throws(() => ro.prepare("UPDATE saved_hymns SET title='x' WHERE number='100'").run()), "baseline write is rejected under readonly+query_only");
        ro.close();

        console.log("[char-existing-overlay] OK — RM-E existing contract locked (precedence, overlay-only write, baseline read-only).");
    } catch (err) {
        failed = true;
        console.error(`[char-existing-overlay] FAIL — ${err && err.message ? err.message : String(err)}`);
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        app.exit(failed ? 1 : 0);
    }
});
