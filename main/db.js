import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

function utcNowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function normalizeSongId(payload, fallback = "") {
    if (!payload || typeof payload !== "object") return String(fallback || "").trim();
    return String(payload.id || payload.number || fallback || "").trim();
}

function openReadonlyIfExists(dbPath) {
    if (!dbPath || !fs.existsSync(dbPath)) return null;
    try {
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        db.pragma("query_only = ON");
        return db;
    } catch (err) {
        console.warn(`[baseline] open failed: ${dbPath}: ${err.message}`);
        return null;
    }
}

// ─────────────────────────────────────────────
// Hymn Repository (baseline + user overlay)
// ─────────────────────────────────────────────

export class HymnRepository {
    constructor(baselineDbPath, userDbPath) {
        fs.mkdirSync(path.dirname(userDbPath), { recursive: true });
        this.userDb = new Database(userDbPath);
        this.userDb.pragma("journal_mode = WAL");
        this._initUserSchema();

        this.baselineDb = openReadonlyIfExists(baselineDbPath);
        if (this.baselineDb) this._verifyBaselineSchema();
    }

    _initUserSchema() {
        this.userDb.exec(`
            CREATE TABLE IF NOT EXISTS saved_hymns (
                number TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                new_number TEXT NOT NULL DEFAULT '',
                composer TEXT NOT NULL DEFAULT '',
                key_signature TEXT NOT NULL DEFAULT '',
                time_signature TEXT NOT NULL DEFAULT '',
                hymn_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_tombstones (
                number TEXT PRIMARY KEY,
                deleted_at TEXT NOT NULL
            );
        `);
    }

    _verifyBaselineSchema() {
        try {
            this.baselineDb.prepare("SELECT number FROM saved_hymns LIMIT 1").get();
        } catch (err) {
            console.warn(`[baseline] schema mismatch, ignoring: ${err.message}`);
            this.baselineDb = null;
        }
    }

    _rowToItem(row) {
        const hymn = JSON.parse(row.hymn_json);
        return {
            id: normalizeSongId(hymn, row.number),
            category: hymn.category || (/^\d+$/.test(row.number) ? "hymn" : "song"),
            number: row.number,
            title: row.title,
            newNumber: row.new_number,
            composer: row.composer,
            key: row.key_signature,
            timeSignature: row.time_signature,
            updatedAt: row.updated_at,
            hymn,
        };
    }

    _selectAll(db) {
        return db.prepare(`
            SELECT number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at
            FROM saved_hymns
        `).all();
    }

    _selectOne(db, number) {
        return db.prepare(`
            SELECT number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at
            FROM saved_hymns WHERE number = ?
        `).get(number);
    }

    _tombstoneSet() {
        return new Set(
            this.userDb.prepare("SELECT number FROM user_tombstones").all().map((r) => r.number)
        );
    }

    listHymns() {
        const userRows = this._selectAll(this.userDb);
        const userIds = new Set(userRows.map((r) => r.number));
        const tombstones = this._tombstoneSet();

        const baselineRows = this.baselineDb
            ? this._selectAll(this.baselineDb).filter(
                (r) => !userIds.has(r.number) && !tombstones.has(r.number)
            )
            : [];

        const merged = [...userRows, ...baselineRows].map((row) => this._rowToItem(row));
        merged.sort((a, b) => {
            const aNum = /^\d+$/.test(a.number);
            const bNum = /^\d+$/.test(b.number);
            if (aNum && !bNum) return -1;
            if (!aNum && bNum) return 1;
            if (aNum && bNum) return Number(a.number) - Number(b.number);
            return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
        });
        return merged;
    }

    getHymn(number) {
        const tomb = this.userDb.prepare("SELECT 1 FROM user_tombstones WHERE number = ?").get(number);
        if (tomb) return null;

        const userRow = this._selectOne(this.userDb, number);
        if (userRow) return this._rowToItem(userRow);

        if (this.baselineDb) {
            const baseRow = this._selectOne(this.baselineDb, number);
            if (baseRow) return this._rowToItem(baseRow);
        }
        return null;
    }

    saveHymn(number, hymn) {
        if (!hymn || typeof hymn !== "object") throw new Error("곡 데이터는 JSON 객체여야 합니다.");

        const normalizedNumber = normalizeSongId(hymn, number);
        if (!normalizedNumber) throw new Error("곡 ID는 비어 있을 수 없습니다.");

        if (number && number.trim() && number.trim() !== normalizedNumber) {
            throw new Error("요청 경로의 곡 ID와 본문 데이터의 곡 ID가 일치하지 않습니다.");
        }

        hymn = JSON.parse(JSON.stringify(hymn));
        hymn.id = normalizedNumber;
        hymn.category = hymn.category || (/^\d+$/.test(normalizedNumber) ? "hymn" : "song");
        if (hymn.category === "hymn") {
            hymn.number = String(hymn.number || normalizedNumber);
        } else if ("number" in hymn && !hymn.number) {
            delete hymn.number;
        }

        const updatedAt = utcNowIso();
        const payload = JSON.stringify(hymn);

        const existedInUser = !!this._selectOne(this.userDb, normalizedNumber);
        const existedInBaseline = this.baselineDb
            ? !!this._selectOne(this.baselineDb, normalizedNumber)
            : false;

        this.userDb.prepare("DELETE FROM user_tombstones WHERE number = ?").run(normalizedNumber);
        this.userDb.prepare(`
            INSERT INTO saved_hymns (number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(number) DO UPDATE SET
                title = excluded.title,
                new_number = excluded.new_number,
                composer = excluded.composer,
                key_signature = excluded.key_signature,
                time_signature = excluded.time_signature,
                hymn_json = excluded.hymn_json,
                updated_at = excluded.updated_at
        `).run(
            normalizedNumber,
            String(hymn.title || ""),
            String(hymn.newNumber || ""),
            String(hymn.composer || ""),
            String(hymn.key || ""),
            String(hymn.timeSignature || ""),
            payload,
            updatedAt,
        );

        const item = this.getHymn(normalizedNumber);
        if (!item) throw new Error("저장 직후 곡 데이터를 다시 읽지 못했습니다.");

        const isNew = !existedInUser && !existedInBaseline;
        return [item, isNew];
    }

    deleteHymn(number) {
        const userResult = this.userDb.prepare("DELETE FROM saved_hymns WHERE number = ?").run(number);
        const inBaseline = this.baselineDb
            ? !!this._selectOne(this.baselineDb, number)
            : false;

        if (inBaseline) {
            this.userDb.prepare(`
                INSERT INTO user_tombstones (number, deleted_at) VALUES (?, ?)
                ON CONFLICT(number) DO UPDATE SET deleted_at = excluded.deleted_at
            `).run(number, utcNowIso());
            return true;
        }
        return userResult.changes > 0;
    }
}

// ─────────────────────────────────────────────
// Setlist & Media Repository (baseline + user overlay)
// ─────────────────────────────────────────────

const VALID_ITEM_TYPES = new Set(["score", "blank", "text", "media", "order"]);

// User-created setlists use IDs >= USER_ID_OFFSET so they never collide with baseline.
const USER_ID_OFFSET = 1_000_000_000;

export class SetlistRepository {
    constructor(userDbPath, baselineDbPath = null) {
        fs.mkdirSync(path.dirname(userDbPath), { recursive: true });
        this.userDb = new Database(userDbPath);
        this.userDb.pragma("journal_mode = WAL");
        this.userDb.pragma("foreign_keys = ON");
        this._initUserSchema();

        this.baselineDb = openReadonlyIfExists(baselineDbPath);
        if (this.baselineDb) this._verifyBaselineSchema();
    }

    _initUserSchema() {
        this.userDb.exec(`
            CREATE TABLE IF NOT EXISTS setlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                settings TEXT NOT NULL DEFAULT '{}'
            )
        `);
        try { this.userDb.exec("ALTER TABLE setlists ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'"); } catch (_) { /* already exists */ }
        this.userDb.exec(`
            CREATE TABLE IF NOT EXISTS setlist_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setlist_id INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                item_type TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_setlist_items_setlist ON setlist_items(setlist_id, position);
            CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                mime TEXT NOT NULL DEFAULT '',
                size INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS setlist_tombstones (
                id INTEGER PRIMARY KEY,
                deleted_at TEXT NOT NULL
            );
        `);
        this._ensureUserAutoincrement();
    }

    _ensureUserAutoincrement() {
        const row = this.userDb.prepare(
            "SELECT seq FROM sqlite_sequence WHERE name = 'setlists'"
        ).get();
        const current = row ? Number(row.seq) : 0;
        if (current < USER_ID_OFFSET) {
            const maxId = this.userDb.prepare("SELECT MAX(id) AS m FROM setlists").get();
            const desiredSeed = Math.max(USER_ID_OFFSET - 1, Number(maxId && maxId.m) || 0);
            if (row) {
                this.userDb.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'setlists'").run(desiredSeed);
            } else {
                this.userDb.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('setlists', ?)").run(desiredSeed);
            }
        }
    }

    _verifyBaselineSchema() {
        try {
            this.baselineDb.prepare("SELECT id FROM setlists LIMIT 1").get();
        } catch (err) {
            console.warn(`[baseline setlists] schema mismatch, ignoring: ${err.message}`);
            this.baselineDb = null;
        }
    }

    _tombstoneSet() {
        return new Set(
            this.userDb.prepare("SELECT id FROM setlist_tombstones").all().map((r) => Number(r.id))
        );
    }

    _summaryFromRow(row, itemCount) {
        return {
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            itemCount,
        };
    }

    listSetlists() {
        const userRows = this.userDb.prepare(`
            SELECT s.id, s.name, s.created_at, s.updated_at,
                   (SELECT COUNT(*) FROM setlist_items i WHERE i.setlist_id = s.id) AS item_count
            FROM setlists s
        `).all();
        const userIds = new Set(userRows.map((r) => Number(r.id)));
        const tombstones = this._tombstoneSet();

        let baselineRows = [];
        if (this.baselineDb) {
            baselineRows = this.baselineDb.prepare(`
                SELECT s.id, s.name, s.created_at, s.updated_at,
                       (SELECT COUNT(*) FROM setlist_items i WHERE i.setlist_id = s.id) AS item_count
                FROM setlists s
            `).all().filter((r) => !userIds.has(Number(r.id)) && !tombstones.has(Number(r.id)));
        }

        const merged = [...userRows, ...baselineRows].map((r) => this._summaryFromRow(r, r.item_count));
        merged.sort((a, b) => {
            if (a.updatedAt === b.updatedAt) return b.id - a.id;
            return a.updatedAt < b.updatedAt ? 1 : -1;
        });
        return merged;
    }

    _getSetlistFromDb(db, id) {
        const row = db.prepare("SELECT id, name, created_at, updated_at, settings FROM setlists WHERE id = ?").get(id);
        if (!row) return null;

        const itemRows = db.prepare(`
            SELECT id, position, item_type, payload_json FROM setlist_items
            WHERE setlist_id = ? ORDER BY position ASC, id ASC
        `).all(id);

        const items = itemRows.map((ir) => {
            let payload = {};
            try { payload = JSON.parse(ir.payload_json || "{}"); } catch (_) { /* ignore */ }
            return { itemId: ir.id, position: ir.position, type: ir.item_type, payload };
        });

        let settings = {};
        try { settings = JSON.parse(row.settings || "{}"); } catch (_) { /* ignore */ }

        return {
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            settings,
            items,
        };
    }

    getSetlist(id) {
        const numId = Number(id);
        const tomb = this.userDb.prepare("SELECT 1 FROM setlist_tombstones WHERE id = ?").get(numId);
        if (tomb) return null;

        const fromUser = this._getSetlistFromDb(this.userDb, numId);
        if (fromUser) return fromUser;

        if (this.baselineDb) {
            return this._getSetlistFromDb(this.baselineDb, numId);
        }
        return null;
    }

    createSetlist(name, items, settings) {
        const now = utcNowIso();
        const cleanName = (name || "").trim() || "새 셋리스트";
        const settingsJson = JSON.stringify(settings || {});

        const result = this.userDb.prepare(
            "INSERT INTO setlists (name, created_at, updated_at, settings) VALUES (?, ?, ?, ?)"
        ).run(cleanName, now, now, settingsJson);

        const id = Number(result.lastInsertRowid);
        if (items) this._replaceItems(id, items);
        return this.getSetlist(id);
    }

    updateSetlist(id, name, items, settings) {
        const numId = Number(id);
        const now = utcNowIso();

        const tomb = this.userDb.prepare("SELECT 1 FROM setlist_tombstones WHERE id = ?").get(numId);
        if (tomb) return null;

        const userExists = !!this.userDb.prepare("SELECT 1 FROM setlists WHERE id = ?").get(numId);

        if (!userExists) {
            // If this is a baseline setlist, copy it into user DB (copy-on-write) using the same id.
            if (!this.baselineDb) return null;
            const base = this._getSetlistFromDb(this.baselineDb, numId);
            if (!base) return null;

            this.userDb.prepare(
                "INSERT INTO setlists (id, name, created_at, updated_at, settings) VALUES (?, ?, ?, ?, ?)"
            ).run(numId, base.name, base.createdAt, now, JSON.stringify(base.settings || {}));

            this._replaceItems(numId, base.items.map((it) => ({ type: it.type, payload: it.payload })));
        }

        if (name !== null && name !== undefined) {
            const cleanName = (name || "").trim() || "새 셋리스트";
            this.userDb.prepare("UPDATE setlists SET name = ?, updated_at = ? WHERE id = ?").run(cleanName, now, numId);
        } else {
            this.userDb.prepare("UPDATE setlists SET updated_at = ? WHERE id = ?").run(now, numId);
        }
        if (settings !== null && settings !== undefined) {
            this.userDb.prepare("UPDATE setlists SET settings = ? WHERE id = ?").run(JSON.stringify(settings), numId);
        }
        if (items !== null && items !== undefined) {
            this._replaceItems(numId, items);
        }

        return this.getSetlist(numId);
    }

    deleteSetlist(id) {
        const numId = Number(id);
        const userResult = this.userDb.prepare("DELETE FROM setlists WHERE id = ?").run(numId);

        const inBaseline = this.baselineDb
            ? !!this.baselineDb.prepare("SELECT 1 FROM setlists WHERE id = ?").get(numId)
            : false;

        if (inBaseline) {
            this.userDb.prepare(`
                INSERT INTO setlist_tombstones (id, deleted_at) VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at
            `).run(numId, utcNowIso());
            return true;
        }
        return userResult.changes > 0;
    }

    _replaceItems(setlistId, items) {
        this.userDb.prepare("DELETE FROM setlist_items WHERE setlist_id = ?").run(setlistId);
        const insert = this.userDb.prepare(`
            INSERT INTO setlist_items (setlist_id, position, item_type, payload_json) VALUES (?, ?, ?, ?)
        `);
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item || typeof item !== "object") throw new Error("셋리스트 아이템은 객체여야 합니다.");
            const itemType = String(item.type || "").trim();
            if (!VALID_ITEM_TYPES.has(itemType)) throw new Error(`알 수 없는 아이템 타입: ${itemType}`);
            const payload = typeof item.payload === "object" && item.payload ? item.payload : {};
            insert.run(setlistId, i, itemType, JSON.stringify(payload));
        }
    }

    // ── Media (user only; baseline media is served from read-only dir via protocol handler) ──

    registerMedia(filename, mime, size) {
        const now = utcNowIso();
        const result = this.userDb.prepare(
            "INSERT INTO media (filename, mime, size, created_at) VALUES (?, ?, ?, ?)"
        ).run(filename, mime, size, now);
        return {
            id: Number(result.lastInsertRowid),
            filename, mime, size,
            createdAt: now,
            url: `/media/${filename}`,
        };
    }

    getMedia(id) {
        const row = this.userDb.prepare("SELECT id, filename, mime, size, created_at FROM media WHERE id = ?").get(id);
        if (!row) return null;
        return { id: row.id, filename: row.filename, mime: row.mime, size: row.size, createdAt: row.created_at, url: `/media/${row.filename}` };
    }

    deleteMedia(id) {
        const media = this.getMedia(id);
        if (!media) return null;
        this.userDb.prepare("DELETE FROM media WHERE id = ?").run(id);
        return media;
    }

    listMedia() {
        return this.userDb.prepare("SELECT id, filename, mime, size, created_at FROM media").all().map((r) => ({
            id: r.id, filename: r.filename, mime: r.mime, size: r.size, createdAt: r.created_at,
        }));
    }

    deleteMediaRowsByFilenames(filenames) {
        if (!filenames.length) return 0;
        const placeholders = filenames.map(() => "?").join(",");
        return this.userDb.prepare(`DELETE FROM media WHERE filename IN (${placeholders})`).run(...filenames).changes;
    }

    iterSetlistPayloadJson() {
        // Include both user-visible setlists (user + non-tombstoned baseline) so media
        // referenced by baseline setlists isn't treated as orphan.
        const blobs = [];
        const userItems = this.userDb.prepare("SELECT payload_json FROM setlist_items").all();
        const userSettings = this.userDb.prepare("SELECT settings FROM setlists").all();
        blobs.push(...userItems.map((r) => r.payload_json || ""));
        blobs.push(...userSettings.map((r) => r.settings || ""));

        if (this.baselineDb) {
            const tombstones = this._tombstoneSet();
            const userIds = new Set(
                this.userDb.prepare("SELECT id FROM setlists").all().map((r) => Number(r.id))
            );
            const baselineSetlists = this.baselineDb.prepare("SELECT id, settings FROM setlists").all();
            for (const s of baselineSetlists) {
                const idNum = Number(s.id);
                if (userIds.has(idNum) || tombstones.has(idNum)) continue;
                blobs.push(s.settings || "");
                const items = this.baselineDb.prepare(
                    "SELECT payload_json FROM setlist_items WHERE setlist_id = ?"
                ).all(idNum);
                blobs.push(...items.map((r) => r.payload_json || ""));
            }
        }
        return blobs;
    }
}
