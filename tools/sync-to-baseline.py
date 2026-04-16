"""
sync-to-baseline.py

앱(npm start)에서 편집한 user data를 프로젝트의 baseline data로 병합합니다.
- saved_hymns: user DB -> baseline DB (upsert)
- user_tombstones: baseline에서 해당 곡 삭제
- setlists + setlist_items: user DB -> baseline DB (upsert)
- setlist_tombstones: baseline에서 해당 셋리스트 삭제
- media/: user -> baseline 복사
- images/: user -> baseline 복사

사용법: python tools/sync-to-baseline.py
"""

import os
import sys
import sqlite3
import shutil

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE_DIR = os.path.join(ROOT_DIR, "data")

APPDATA = os.environ.get("APPDATA")
if not APPDATA:
    print("APPDATA 환경변수를 찾을 수 없습니다.")
    sys.exit(1)

USER_DIR = os.path.join(APPDATA, "scoresentation", "data")

if not os.path.isdir(USER_DIR):
    print(f"User data 폴더가 없습니다: {USER_DIR}")
    print("앱을 한 번 실행한 뒤 다시 시도하세요.")
    sys.exit(0)

print(f"Baseline: {BASELINE_DIR}")
print(f"User:     {USER_DIR}")
print()


# ── 1. Hymns ──

user_hymn_db = os.path.join(USER_DIR, "scoresentation-user.db")
baseline_hymn_db = os.path.join(BASELINE_DIR, "scoresentation.db")

if os.path.isfile(user_hymn_db):
    user = sqlite3.connect(user_hymn_db)
    user.row_factory = sqlite3.Row
    base = sqlite3.connect(baseline_hymn_db)

    # tombstones
    tombstones = user.execute("SELECT number FROM user_tombstones").fetchall()
    if tombstones:
        for t in tombstones:
            base.execute("DELETE FROM saved_hymns WHERE number = ?", (t["number"],))
        base.commit()
        print(f"[hymns] {len(tombstones)}개 삭제 (tombstone)")

    # upsert
    rows = user.execute("SELECT * FROM saved_hymns").fetchall()
    if rows:
        for r in rows:
            base.execute(
                "INSERT OR REPLACE INTO saved_hymns (number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (r["number"], r["title"], r["new_number"], r["composer"], r["key_signature"], r["time_signature"], r["hymn_json"], r["updated_at"]),
            )
        base.commit()
        print(f"[hymns] {len(rows)}개 병합")

    user.close()
    base.close()
else:
    print("[hymns] user DB 없음, 건너뜀")


# ── 2. Setlists ──

user_setlist_db = os.path.join(USER_DIR, "setlists.db")
baseline_setlist_db = os.path.join(BASELINE_DIR, "setlists.db")

if os.path.isfile(user_setlist_db):
    user = sqlite3.connect(user_setlist_db)
    user.row_factory = sqlite3.Row
    base = sqlite3.connect(baseline_setlist_db)

    # ensure schema
    base.executescript("""
        CREATE TABLE IF NOT EXISTS setlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            settings TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS setlist_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setlist_id INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            item_type TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            mime TEXT NOT NULL DEFAULT '',
            size INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
    """)
    # settings 컬럼 없으면 추가
    try:
        base.execute("ALTER TABLE setlists ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'")
    except Exception:
        pass

    # tombstones
    tomb_count = 0
    try:
        tombstones = user.execute("SELECT id FROM setlist_tombstones").fetchall()
        if tombstones:
            for t in tombstones:
                base.execute("DELETE FROM setlist_items WHERE setlist_id = ?", (t["id"],))
                base.execute("DELETE FROM setlists WHERE id = ?", (t["id"],))
            base.commit()
            tomb_count = len(tombstones)
    except Exception:
        pass
    if tomb_count:
        print(f"[setlists] {tomb_count}개 삭제 (tombstone)")

    # upsert setlists
    setlists = user.execute("SELECT * FROM setlists").fetchall()
    if setlists:
        for s in setlists:
            base.execute(
                "INSERT OR REPLACE INTO setlists (id, name, created_at, updated_at, settings) "
                "VALUES (?, ?, ?, ?, ?)",
                (s["id"], s["name"], s["created_at"], s["updated_at"], s["settings"] if s["settings"] else "{}"),
            )
            base.execute("DELETE FROM setlist_items WHERE setlist_id = ?", (s["id"],))
            items = user.execute(
                "SELECT * FROM setlist_items WHERE setlist_id = ? ORDER BY position", (s["id"],)
            ).fetchall()
            for it in items:
                base.execute(
                    "INSERT INTO setlist_items (setlist_id, position, item_type, payload_json) "
                    "VALUES (?, ?, ?, ?)",
                    (s["id"], it["position"], it["item_type"], it["payload_json"]),
                )
        base.commit()
        print(f"[setlists] {len(setlists)}개 병합")

    # media table
    media_rows = user.execute("SELECT * FROM media").fetchall()
    if media_rows:
        for m in media_rows:
            base.execute(
                "INSERT OR REPLACE INTO media (id, filename, mime, size, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (m["id"], m["filename"], m["mime"], m["size"], m["created_at"]),
            )
        base.commit()
        print(f"[media DB] {len(media_rows)}개 병합")

    user.close()
    base.close()
else:
    print("[setlists] user DB 없음, 건너뜀")


# ── 3. 파일 복사 ──

def copy_dir(src, dest):
    if not os.path.isdir(src):
        return 0
    os.makedirs(dest, exist_ok=True)
    count = 0
    for entry in os.scandir(src):
        dst = os.path.join(dest, entry.name)
        if entry.is_dir():
            count += copy_dir(entry.path, dst)
        else:
            shutil.copy2(entry.path, dst)
            count += 1
    return count

media_count = copy_dir(os.path.join(USER_DIR, "media"), os.path.join(BASELINE_DIR, "media"))
if media_count:
    print(f"[media files] {media_count}개 복사")

image_count = copy_dir(os.path.join(USER_DIR, "images"), os.path.join(BASELINE_DIR, "images"))
if image_count:
    print(f"[image files] {image_count}개 복사")

print("\n완료! baseline data가 업데이트되었습니다.")
