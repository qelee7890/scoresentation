/**
 * Overlay-disposal db.js integration gate (SPEC-LYRICS-001, T-007) — run under Electron:
 *   electron tools/check-overlay-disposal.cjs
 *
 * Verifies the db.js side of the v3 overlay disposal (the disposal LOGIC itself is covered
 * by tools/tests/test_overlay_disposal.py):
 *   - REQ-LYR-023 absence-assert: main/db.js does NOT re-introduce origin/main's one-way
 *     _runOneTimeMigrations (the pre-spanish base must not port it)
 *   - _initUserSchema provisions the app_meta v3 reverse-key home
 *   - after disposal, masking is resolved: getCanonicalHymn reads the baseline for a dropped
 *     overlay number, and reads the promoted overlay v3 for a preserved user song
 *   - app_meta holds only v3 reverse keys (no legacy forward keys)
 *
 * Ephemeral OS-temp fixtures only; never touches the real user DB. Exits non-zero on failure.
 */
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function assert(cond, msg) { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); }

const V3_DDL = `CREATE TABLE IF NOT EXISTS saved_hymns_v3 (
    number TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
    new_number TEXT NOT NULL DEFAULT '', doc_json TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '',
    schema_version INTEGER NOT NULL DEFAULT 3, updated_at TEXT NOT NULL DEFAULT '')`;

function canonicalDoc(number, ko) {
    return {
        schemaVersion: 3, id: number, number, newNumber: "", title: `T${number}`, composer: "",
        category: /^\d+$/.test(number) ? "hymn" : "song", key: "", timeSignature: "",
        sections: [{ kind: "verse", label: "1", altLanguages: {}, lines: [{
            id: "s1.0", textOnly: false, syllables: [{
                surface: { ko, es: null, en: null }, wordBoundary: "standalone", leadSpace: false, melisma: false,
                notes: [{ pitch: "E4", dur: "8", dotted: false, accidental: null, beamGroup: null, fermata: false }],
            }],
        }] }],
        _provenance: { migratedFrom: "v2", sourceHash: null, migratedAt: null, warnings: [] },
    };
}

app.whenReady().then(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-disp-"));
    let failed = false;
    try {
        // (1) REQ-LYR-023 absence-assert on the db.js source — ignore comment lines (which
        // may legitimately reference the name to document why it is NOT ported).
        const dbSrc = fs.readFileSync(path.join(__dirname, "..", "main", "db.js"), "utf-8");
        const dbCode = dbSrc.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
        assert(!/_runOneTimeMigrations/.test(dbCode), "db.js code must NOT port origin/main _runOneTimeMigrations");

        const Database = require("better-sqlite3");
        const baselinePath = path.join(tmp, "baseline.db");
        const userPath = path.join(tmp, "user", "scoresentation-user.db");
        fs.mkdirSync(path.dirname(userPath), { recursive: true });

        // Fixture baseline: v1 + v3 for the disposed number 100 (content succession).
        const b = new Database(baselinePath);
        b.exec(`CREATE TABLE saved_hymns (number TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
            new_number TEXT NOT NULL DEFAULT '', composer TEXT NOT NULL DEFAULT '',
            key_signature TEXT NOT NULL DEFAULT '', time_signature TEXT NOT NULL DEFAULT '',
            hymn_json TEXT NOT NULL, updated_at TEXT NOT NULL);`);
        b.prepare("INSERT INTO saved_hymns (number,title,hymn_json,updated_at) VALUES (?,?,?,?)")
            .run("100", "Baseline100", JSON.stringify({ id: "100", number: "100", title: "Baseline100", category: "hymn" }), "2026-01-01T00:00:00Z");
        b.exec(V3_DDL);
        b.prepare("INSERT INTO saved_hymns_v3 (number,doc_json) VALUES (?,?)").run("100", JSON.stringify(canonicalDoc("100", "베")));
        b.close();

        // Post-disposal user overlay: number 100 DROPPED (absent); pure user song 'userA'
        // PROMOTED to v3; app_meta carries only the v3 reverse key.
        const u = new Database(userPath);
        u.exec(`CREATE TABLE saved_hymns (number TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
            new_number TEXT NOT NULL DEFAULT '', composer TEXT NOT NULL DEFAULT '',
            key_signature TEXT NOT NULL DEFAULT '', time_signature TEXT NOT NULL DEFAULT '',
            hymn_json TEXT NOT NULL, updated_at TEXT NOT NULL);`);
        u.exec("CREATE TABLE user_tombstones (number TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);");
        u.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);");
        u.exec(V3_DDL);
        u.prepare("INSERT INTO saved_hymns (number,title,hymn_json,updated_at) VALUES (?,?,?,?)")
            .run("userA", "UserA", JSON.stringify({ id: "userA", number: "userA", title: "UserA", category: "song" }), "2026-01-01T00:00:00Z");
        u.prepare("INSERT INTO saved_hymns_v3 (number,doc_json) VALUES (?,?)").run("userA", JSON.stringify(canonicalDoc("userA", "꽃")));
        u.prepare("INSERT INTO app_meta (key,value) VALUES ('migration:v3_overlay_disposal','2026-07-11T00:00:00Z')").run();
        u.close();

        const { HymnRepository } = await import(pathToFileURL(path.join(__dirname, "..", "main", "db.js")).href);
        const repo = new HymnRepository(baselinePath, userPath);

        // (2) db.js provisioned app_meta.
        const u2 = new Database(userPath);
        const tables = new Set(u2.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
        assert(tables.has("app_meta"), "db.js _initUserSchema provisions app_meta");
        const metaKeys = new Set(u2.prepare("SELECT key FROM app_meta").all().map((r) => r.key));
        assert(metaKeys.has("migration:v3_overlay_disposal"), "app_meta has the v3 reverse key");
        assert(!metaKeys.has("migration:fix_stale_spanish_overrides_v1") && !metaKeys.has("migration:fix_stale_spanish_overrides_v2"),
            "app_meta has no origin/main forward keys");
        u2.close();

        // (3) masking resolved: dropped 100 now reads from baseline; promoted userA reads overlay.
        const c100 = repo.getCanonicalHymn("100");
        assert(c100 && c100.sections[0].lines[0].syllables[0].surface.ko === "베", "getCanonicalHymn(100) reads baseline v3 (masking resolved)");
        const cUser = repo.getCanonicalHymn("userA");
        assert(cUser && cUser.sections[0].lines[0].syllables[0].surface.ko === "꽃", "getCanonicalHymn(userA) reads promoted overlay v3 (preserved)");
        assert(repo.getAppMeta("migration:v3_overlay_disposal") !== null, "getAppMeta exposes the v3 reverse key");

        console.log("[check-overlay-disposal] OK — absence-assert + app_meta v3 reverse keys + masking resolution verified.");
    } catch (err) {
        failed = true;
        console.error(`[check-overlay-disposal] FAIL — ${err && err.message ? err.message : String(err)}`);
    } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        app.exit(failed ? 1 : 0);
    }
});
