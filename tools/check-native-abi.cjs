/**
 * Native-module ABI guard. MUST be run under Electron (not Node):
 *   electron tools/check-native-abi.cjs   (via `npm run verify-native`)
 *
 * Confirms better-sqlite3 actually loads and runs under Electron's ABI.
 * Exits non-zero on failure so it aborts the build/publish npm chain — this
 * prevents shipping a Node-ABI native module (NODE_MODULE_VERSION mismatch),
 * which makes the installed app crash on startup. See
 * memory/packaged-native-module-abi.md.
 */
const { app } = require("electron");

app.whenReady().then(() => {
    try {
        const Database = require("better-sqlite3");
        const db = new Database(":memory:");
        const row = db.prepare("select 1 as x").get();
        db.close();
        if (!row || row.x !== 1) throw new Error("unexpected query result");
        console.log(
            `[abi-check] OK — better-sqlite3 loads under Electron ${process.versions.electron} (NODE_MODULE_VERSION ${process.versions.modules})`,
        );
        app.exit(0);
    } catch (err) {
        const msg = err && err.message ? err.message.split("\n")[0] : String(err);
        console.error(`[abi-check] FAIL — ${msg}`);
        console.error("[abi-check] Native module is not built for Electron. Run `npm run rebuild` (electron-rebuild), then retry.");
        app.exit(1);
    }
});
