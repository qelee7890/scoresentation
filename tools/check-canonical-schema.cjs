/**
 * v3 canonical schema/migration smoke gate (SPEC-LYRICS-001, T-003) — run under Electron:
 *   electron tools/check-canonical-schema.cjs
 *
 * Asserts the new saved_hymns_v3 table + forward migration + canonical read path:
 *   - saved_hymns_v3 is created in the user overlay, PHYSICALLY SEPARATE from v1
 *     saved_hymns (both exist; v1 read path unchanged) — GWT-A1
 *   - user DB schema version (PRAGMA user_version) is bumped to 3
 *   - getCanonicalHymn honors tombstone -> user overlay -> baseline precedence and
 *     returns a normalized canonical doc (schemaVersion 3, syllable-first)
 *   - re-initialization is idempotent: no version change, no data change (GWT-C5)
 *
 * Ephemeral OS-temp fixtures only; never touches the real user DB. Exits non-zero on failure.
 */
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function assert(cond, msg) { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); }

function v3doc(number, koFirst) {
    return {
        schemaVersion: 3, id: number, number, newNumber: "", title: `T${number}`,
        composer: "", category: /^\d+$/.test(number) ? "hymn" : "song", key: "", timeSignature: "",
        sections: [{
            kind: "verse", label: "1", altLanguages: {},
            lines: [{
                id: "s1.0", textOnly: false, syllables: [{
                    surface: { ko: koFirst, es: "Fue", en: null },
                    wordBoundary: "standalone", leadSpace: false, melisma: false, wbEs: "start",
                    notes: [{ pitch: "E4", dur: "8", dotted: false, accidental: null, beamGroup: null, fermata: false }],
                }],
            }],
        }],
        _provenance: { migratedFrom: "v2", sourceHash: null, migratedAt: null, warnings: [] },
    };
}

const V3_DDL = `CREATE TABLE IF NOT EXISTS saved_hymns_v3 (
    number TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
    new_number TEXT NOT NULL DEFAULT '', doc_json TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '',
    schema_version INTEGER NOT NULL DEFAULT 3, updated_at TEXT NOT NULL DEFAULT '')`;

app.whenReady().then(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-v3-"));
    let failed = false;
    try {
        const Database = require("better-sqlite3");
        const baselinePath = path.join(tmp, "baseline.db");
        const userPath = path.join(tmp, "user", "scoresentation-user.db");
        fs.mkdirSync(path.dirname(userPath), { recursive: true });

        // ── Fixture baseline: v1 saved_hymns + a v3 canonical row ──
        const b = new Database(baselinePath);
        b.exec(`CREATE TABLE saved_hymns (number TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
            new_number TEXT NOT NULL DEFAULT '', composer TEXT NOT NULL DEFAULT '',
            key_signature TEXT NOT NULL DEFAULT '', time_signature TEXT NOT NULL DEFAULT '',
            hymn_json TEXT NOT NULL, updated_at TEXT NOT NULL);`);
        b.prepare(`INSERT INTO saved_hymns (number,title,new_number,composer,key_signature,time_signature,hymn_json,updated_at)
            VALUES (?,?,?,?,?,?,?,?)`).run("100", "V1Title", "", "", "", "",
            JSON.stringify({ id: "100", number: "100", title: "V1Title", category: "hymn" }), "2026-01-01T00:00:00Z");
        b.exec(V3_DDL);
        b.prepare(`INSERT INTO saved_hymns_v3 (number,category,title,new_number,doc_json,content_hash,schema_version,updated_at)
            VALUES (?,?,?,?,?,?,?,?)`).run("100", "hymn", "T100", "", JSON.stringify(v3doc("100", "베")), "", 3, "2026-01-01T00:00:00Z");
        b.close();

        const { HymnRepository } = await import(pathToFileURL(path.join(__dirname, "..", "main", "db.js")).href);
        const repo = new HymnRepository(baselinePath, userPath);

        // (1) GWT-A1: v3 table exists in user overlay, separate from v1 saved_hymns.
        const u = new Database(userPath);
        const tables = new Set(u.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
        assert(tables.has("saved_hymns"), "v1 saved_hymns still present (unchanged read path)");
        assert(tables.has("saved_hymns_v3"), "saved_hymns_v3 created in user overlay");
        assert(tables.has("user_tombstones"), "user_tombstones preserved");
        const uver = u.pragma("user_version", { simple: true });
        assert(uver === 3, `user_version bumped to 3 (got ${uver})`);

        // (2) canonical read falls back to baseline v3 and returns a normalized doc.
        const fromBaseline = repo.getCanonicalHymn("100");
        assert(fromBaseline && fromBaseline.schemaVersion === 3, "getCanonicalHymn reads baseline v3 doc (schemaVersion 3)");
        assert(fromBaseline.sections[0].lines[0].syllables[0].surface.ko === "베", "canonical doc is syllable-first with ko surface");

        // (3) user overlay v3 row shadows baseline (precedence).
        u.exec(V3_DDL);
        u.prepare(`INSERT INTO saved_hymns_v3 (number,category,title,new_number,doc_json,content_hash,schema_version,updated_at)
            VALUES (?,?,?,?,?,?,?,?)`).run("100", "hymn", "T100", "", JSON.stringify(v3doc("100", "유")), "", 3, "2026-02-01T00:00:00Z");
        const fromUser = repo.getCanonicalHymn("100");
        assert(fromUser.sections[0].lines[0].syllables[0].surface.ko === "유", "user overlay v3 shadows baseline (precedence)");

        // (4) tombstone hides the canonical row too.
        u.prepare("INSERT INTO user_tombstones (number, deleted_at) VALUES (?, ?)").run("100", "2026-03-01T00:00:00Z");
        assert(repo.getCanonicalHymn("100") === null, "tombstone hides canonical read (tombstone -> user -> baseline)");
        u.close();

        // (5) v1 read path unaffected.
        assert(repo.getHymn("100") === null, "v1 getHymn also respects the tombstone (unchanged behavior)");

        // (6) GWT-C5: re-initialization is idempotent — version stable, no schema churn.
        const repo2 = new HymnRepository(baselinePath, userPath);
        const u2 = new Database(userPath);
        assert(u2.pragma("user_version", { simple: true }) === 3, "user_version stays 3 on re-init (idempotent)");
        const v3rows = u2.prepare("SELECT COUNT(*) AS c FROM saved_hymns_v3").get().c;
        assert(v3rows === 1, "no duplicate/lost v3 rows on re-init");
        u2.close();
        void repo2;

        console.log("[check-canonical-schema] OK — v3 table + forward migration + canonical read path verified.");
    } catch (err) {
        failed = true;
        console.error(`[check-canonical-schema] FAIL — ${err && err.message ? err.message : String(err)}`);
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        app.exit(failed ? 1 : 0);
    }
});
