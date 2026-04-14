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

// ─────────────────────────────────────────────
// Hymn Repository
// ─────────────────────────────────────────────

export class HymnRepository {
    constructor(dbPath) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this._initialize();
    }

    _initialize() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS saved_hymns (
                number TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                new_number TEXT NOT NULL DEFAULT '',
                composer TEXT NOT NULL DEFAULT '',
                key_signature TEXT NOT NULL DEFAULT '',
                time_signature TEXT NOT NULL DEFAULT '',
                hymn_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `);
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

    listHymns() {
        const rows = this.db.prepare(`
            SELECT number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at
            FROM saved_hymns
            ORDER BY CASE WHEN number GLOB '[0-9]*' THEN 0 ELSE 1 END,
                     CAST(number AS INTEGER),
                     number
        `).all();
        return rows.map((row) => this._rowToItem(row));
    }

    getHymn(number) {
        const row = this.db.prepare(`
            SELECT number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at
            FROM saved_hymns WHERE number = ?
        `).get(number);
        return row ? this._rowToItem(row) : null;
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

        const existing = this.db.prepare("SELECT 1 FROM saved_hymns WHERE number = ?").get(normalizedNumber);

        this.db.prepare(`
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

        return [item, !existing];
    }

    deleteHymn(number) {
        const result = this.db.prepare("DELETE FROM saved_hymns WHERE number = ?").run(number);
        return result.changes > 0;
    }
}

// ─────────────────────────────────────────────
// Setlist & Media Repository
// ─────────────────────────────────────────────

const VALID_ITEM_TYPES = new Set(["score", "blank", "text", "media"]);

export class SetlistRepository {
    constructor(dbPath) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
        this._initialize();
    }

    _initialize() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS setlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                settings TEXT NOT NULL DEFAULT '{}'
            )
        `);
        try { this.db.exec("ALTER TABLE setlists ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'"); } catch (_) { /* already exists */ }
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS setlist_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setlist_id INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                item_type TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}'
            )
        `);
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_setlist_items_setlist ON setlist_items(setlist_id, position)");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                mime TEXT NOT NULL DEFAULT '',
                size INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
        `);
    }

    listSetlists() {
        return this.db.prepare(`
            SELECT s.id, s.name, s.created_at, s.updated_at,
                   (SELECT COUNT(*) FROM setlist_items i WHERE i.setlist_id = s.id) AS item_count
            FROM setlists s ORDER BY s.updated_at DESC, s.id DESC
        `).all().map((row) => ({
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            itemCount: row.item_count,
        }));
    }

    getSetlist(id) {
        const row = this.db.prepare("SELECT id, name, created_at, updated_at, settings FROM setlists WHERE id = ?").get(id);
        if (!row) return null;

        const itemRows = this.db.prepare(`
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

    createSetlist(name, items, settings) {
        const now = utcNowIso();
        const cleanName = (name || "").trim() || "새 셋리스트";
        const settingsJson = JSON.stringify(settings || {});

        const result = this.db.prepare(
            "INSERT INTO setlists (name, created_at, updated_at, settings) VALUES (?, ?, ?, ?)"
        ).run(cleanName, now, now, settingsJson);

        const id = result.lastInsertRowid;
        if (items) this._replaceItems(id, items);

        return this.getSetlist(id);
    }

    updateSetlist(id, name, items, settings) {
        const now = utcNowIso();
        const existing = this.db.prepare("SELECT 1 FROM setlists WHERE id = ?").get(id);
        if (!existing) return null;

        if (name !== null && name !== undefined) {
            const cleanName = (name || "").trim() || "새 셋리스트";
            this.db.prepare("UPDATE setlists SET name = ?, updated_at = ? WHERE id = ?").run(cleanName, now, id);
        } else {
            this.db.prepare("UPDATE setlists SET updated_at = ? WHERE id = ?").run(now, id);
        }
        if (settings !== null && settings !== undefined) {
            this.db.prepare("UPDATE setlists SET settings = ? WHERE id = ?").run(JSON.stringify(settings), id);
        }
        if (items !== null && items !== undefined) {
            this._replaceItems(id, items);
        }

        return this.getSetlist(id);
    }

    deleteSetlist(id) {
        const result = this.db.prepare("DELETE FROM setlists WHERE id = ?").run(id);
        return result.changes > 0;
    }

    _replaceItems(setlistId, items) {
        this.db.prepare("DELETE FROM setlist_items WHERE setlist_id = ?").run(setlistId);
        const insert = this.db.prepare(`
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

    // ── Media ──

    registerMedia(filename, mime, size) {
        const now = utcNowIso();
        const result = this.db.prepare(
            "INSERT INTO media (filename, mime, size, created_at) VALUES (?, ?, ?, ?)"
        ).run(filename, mime, size, now);
        return {
            id: result.lastInsertRowid,
            filename, mime, size,
            createdAt: now,
            url: `/media/${filename}`,
        };
    }

    getMedia(id) {
        const row = this.db.prepare("SELECT id, filename, mime, size, created_at FROM media WHERE id = ?").get(id);
        if (!row) return null;
        return { id: row.id, filename: row.filename, mime: row.mime, size: row.size, createdAt: row.created_at, url: `/media/${row.filename}` };
    }

    deleteMedia(id) {
        const media = this.getMedia(id);
        if (!media) return null;
        this.db.prepare("DELETE FROM media WHERE id = ?").run(id);
        return media;
    }

    listMedia() {
        return this.db.prepare("SELECT id, filename, mime, size, created_at FROM media").all().map((r) => ({
            id: r.id, filename: r.filename, mime: r.mime, size: r.size, createdAt: r.created_at,
        }));
    }

    deleteMediaRowsByFilenames(filenames) {
        if (!filenames.length) return 0;
        const placeholders = filenames.map(() => "?").join(",");
        return this.db.prepare(`DELETE FROM media WHERE filename IN (${placeholders})`).run(...filenames).changes;
    }

    iterSetlistPayloadJson() {
        const items = this.db.prepare("SELECT payload_json FROM setlist_items").all();
        const setlists = this.db.prepare("SELECT settings FROM setlists").all();
        const blobs = items.map((r) => r.payload_json || "");
        blobs.push(...setlists.map((r) => r.settings || ""));
        return blobs;
    }
}
