from __future__ import annotations

import argparse
import json
import mimetypes
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT_DIR / "data" / "scoresentation.db"
DEFAULT_SETLIST_DB_PATH = ROOT_DIR / "data" / "setlists.db"
MEDIA_DIR = ROOT_DIR / "data" / "media"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
ALLOWED_IMAGE_MIMES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/bmp", "image/svg+xml", "image/heic", "image/heif",
}
IMAGE_EXT_FOR_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
    "image/heic": ".heic",
    "image/heif": ".heif",
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def json_response(handler: SimpleHTTPRequestHandler, status: int, payload: Any) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def json_error(handler: SimpleHTTPRequestHandler, status: int, message: str) -> None:
    json_response(handler, status, {"error": message})


def normalize_song_id(payload: Any, fallback: str = "") -> str:
    if not isinstance(payload, dict):
        return str(fallback or "").strip()

    song_id = str(payload.get("id") or payload.get("number") or fallback or "").strip()
    return song_id


class HymnRepository:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
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
                """
            )
            connection.commit()

    def _row_to_item(self, row: sqlite3.Row) -> dict[str, Any]:
        hymn = json.loads(row["hymn_json"])
        return {
            "id": normalize_song_id(hymn, row["number"]),
            "category": hymn.get("category") or ("hymn" if str(row["number"]).isdigit() else "song"),
            "number": row["number"],
            "title": row["title"],
            "newNumber": row["new_number"],
            "composer": row["composer"],
            "key": row["key_signature"],
            "timeSignature": row["time_signature"],
            "updatedAt": row["updated_at"],
            "hymn": hymn,
        }

    def list_hymns(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at
                FROM saved_hymns
                ORDER BY CASE WHEN number GLOB '[0-9]*' THEN 0 ELSE 1 END,
                         CAST(number AS INTEGER),
                         number
                """
            ).fetchall()
        return [self._row_to_item(row) for row in rows]

    def get_hymn(self, number: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at
                FROM saved_hymns
                WHERE number = ?
                """,
                (number,),
            ).fetchone()
        return self._row_to_item(row) if row else None

    def save_hymn(self, number: str, hymn: Any) -> tuple[dict[str, Any], bool]:
        if not isinstance(hymn, dict):
            raise ValueError("곡 데이터는 JSON 객체여야 합니다.")

        normalized_number = normalize_song_id(hymn, number)
        if not normalized_number:
            raise ValueError("곡 ID는 비어 있을 수 없습니다.")

        if str(number).strip() and str(number).strip() != normalized_number:
            raise ValueError("요청 경로의 곡 ID와 본문 데이터의 곡 ID가 일치하지 않습니다.")

        hymn = json.loads(json.dumps(hymn, ensure_ascii=False))
        hymn["id"] = normalized_number
        hymn["category"] = hymn.get("category") or ("hymn" if normalized_number.isdigit() else "song")
        if hymn["category"] == "hymn":
            hymn["number"] = str(hymn.get("number") or normalized_number)
        elif "number" in hymn and not hymn.get("number"):
            hymn.pop("number", None)

        updated_at = utc_now_iso()
        payload = json.dumps(hymn, ensure_ascii=False)

        with self._connect() as connection:
            existing = connection.execute(
                "SELECT 1 FROM saved_hymns WHERE number = ?",
                (normalized_number,),
            ).fetchone()

            connection.execute(
                """
                INSERT INTO saved_hymns (
                    number,
                    title,
                    new_number,
                    composer,
                    key_signature,
                    time_signature,
                    hymn_json,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(number) DO UPDATE SET
                    title = excluded.title,
                    new_number = excluded.new_number,
                    composer = excluded.composer,
                    key_signature = excluded.key_signature,
                    time_signature = excluded.time_signature,
                    hymn_json = excluded.hymn_json,
                    updated_at = excluded.updated_at
                """,
                (
                    normalized_number,
                    str(hymn.get("title") or ""),
                    str(hymn.get("newNumber") or ""),
                    str(hymn.get("composer") or ""),
                    str(hymn.get("key") or ""),
                    str(hymn.get("timeSignature") or ""),
                    payload,
                    updated_at,
                ),
            )
            connection.commit()

        item = self.get_hymn(normalized_number)
        if item is None:
            raise RuntimeError("저장 직후 곡 데이터를 다시 읽지 못했습니다.")

        return item, existing is None

    def delete_hymn(self, number: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM saved_hymns WHERE number = ?",
                (number,),
            )
            connection.commit()
        return cursor.rowcount > 0


# ─────────────────────────────────────────────
# Setlist & Media repositories
# ─────────────────────────────────────────────

VALID_ITEM_TYPES = {"score", "blank", "text", "media"}


class SetlistRepository:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS setlists (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    settings TEXT NOT NULL DEFAULT '{}'
                )
                """
            )
            try:
                connection.execute("ALTER TABLE setlists ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'")
            except sqlite3.OperationalError:
                pass
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS setlist_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    setlist_id INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL,
                    item_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL DEFAULT '{}'
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_setlist_items_setlist ON setlist_items(setlist_id, position)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS media (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    mime TEXT NOT NULL DEFAULT '',
                    size INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.commit()

    # ── Setlists ──

    def list_setlists(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT s.id, s.name, s.created_at, s.updated_at,
                       (SELECT COUNT(*) FROM setlist_items i WHERE i.setlist_id = s.id) AS item_count
                FROM setlists s
                ORDER BY s.updated_at DESC, s.id DESC
                """
            ).fetchall()
        return [
            {
                "id": row["id"],
                "name": row["name"],
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
                "itemCount": row["item_count"],
            }
            for row in rows
        ]

    def get_setlist(self, setlist_id: int) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, name, created_at, updated_at, settings FROM setlists WHERE id = ?",
                (setlist_id,),
            ).fetchone()
            if row is None:
                return None
            item_rows = connection.execute(
                """
                SELECT id, position, item_type, payload_json
                FROM setlist_items
                WHERE setlist_id = ?
                ORDER BY position ASC, id ASC
                """,
                (setlist_id,),
            ).fetchall()

        items = []
        for item_row in item_rows:
            try:
                payload = json.loads(item_row["payload_json"] or "{}")
            except json.JSONDecodeError:
                payload = {}
            items.append(
                {
                    "itemId": item_row["id"],
                    "position": item_row["position"],
                    "type": item_row["item_type"],
                    "payload": payload,
                }
            )

        try:
            settings = json.loads(row["settings"] or "{}")
        except (json.JSONDecodeError, IndexError, KeyError):
            settings = {}

        return {
            "id": row["id"],
            "name": row["name"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "settings": settings,
            "items": items,
        }

    def create_setlist(
        self,
        name: str,
        items: list[dict[str, Any]] | None = None,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = utc_now_iso()
        clean_name = (name or "").strip() or "새 셋리스트"
        settings_json = json.dumps(settings or {}, ensure_ascii=False)
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO setlists (name, created_at, updated_at, settings) VALUES (?, ?, ?, ?)",
                (clean_name, now, now, settings_json),
            )
            setlist_id = cursor.lastrowid
            if items:
                self._replace_items(connection, setlist_id, items)
            connection.commit()
        result = self.get_setlist(setlist_id)
        if result is None:
            raise RuntimeError("셋리스트 생성 직후 조회에 실패했습니다.")
        return result

    def update_setlist(
        self,
        setlist_id: int,
        name: str | None = None,
        items: list[dict[str, Any]] | None = None,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        now = utc_now_iso()
        with self._connect() as connection:
            existing = connection.execute(
                "SELECT 1 FROM setlists WHERE id = ?",
                (setlist_id,),
            ).fetchone()
            if existing is None:
                return None
            if name is not None:
                clean_name = (name or "").strip() or "새 셋리스트"
                connection.execute(
                    "UPDATE setlists SET name = ?, updated_at = ? WHERE id = ?",
                    (clean_name, now, setlist_id),
                )
            else:
                connection.execute(
                    "UPDATE setlists SET updated_at = ? WHERE id = ?",
                    (now, setlist_id),
                )
            if settings is not None:
                connection.execute(
                    "UPDATE setlists SET settings = ? WHERE id = ?",
                    (json.dumps(settings, ensure_ascii=False), setlist_id),
                )
            if items is not None:
                self._replace_items(connection, setlist_id, items)
            connection.commit()
        return self.get_setlist(setlist_id)

    def delete_setlist(self, setlist_id: int) -> bool:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM setlists WHERE id = ?", (setlist_id,))
            connection.commit()
        return cursor.rowcount > 0

    def _replace_items(
        self,
        connection: sqlite3.Connection,
        setlist_id: int,
        items: list[dict[str, Any]],
    ) -> None:
        connection.execute("DELETE FROM setlist_items WHERE setlist_id = ?", (setlist_id,))
        for position, item in enumerate(items):
            if not isinstance(item, dict):
                raise ValueError("셋리스트 아이템은 객체여야 합니다.")
            item_type = str(item.get("type") or "").strip()
            if item_type not in VALID_ITEM_TYPES:
                raise ValueError(f"알 수 없는 아이템 타입: {item_type!r}")
            payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
            connection.execute(
                """
                INSERT INTO setlist_items (setlist_id, position, item_type, payload_json)
                VALUES (?, ?, ?, ?)
                """,
                (setlist_id, position, item_type, json.dumps(payload, ensure_ascii=False)),
            )

    # ── Media ──

    def register_media(self, filename: str, mime: str, size: int) -> dict[str, Any]:
        now = utc_now_iso()
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO media (filename, mime, size, created_at) VALUES (?, ?, ?, ?)",
                (filename, mime, size, now),
            )
            media_id = cursor.lastrowid
            connection.commit()
        return {
            "id": media_id,
            "filename": filename,
            "mime": mime,
            "size": size,
            "createdAt": now,
            "url": f"/media/{filename}",
        }

    def get_media(self, media_id: int) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, filename, mime, size, created_at FROM media WHERE id = ?",
                (media_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "filename": row["filename"],
            "mime": row["mime"],
            "size": row["size"],
            "createdAt": row["created_at"],
            "url": f"/media/{row['filename']}",
        }

    def delete_media(self, media_id: int) -> dict[str, Any] | None:
        media = self.get_media(media_id)
        if media is None:
            return None
        with self._connect() as connection:
            connection.execute("DELETE FROM media WHERE id = ?", (media_id,))
            connection.commit()
        return media


# ─────────────────────────────────────────────
# Multipart parsing (minimal, RFC 7578)
# ─────────────────────────────────────────────


def parse_multipart(body: bytes, boundary: bytes) -> list[dict[str, Any]]:
    """Return a list of parts with keys: name, filename, content_type, data."""
    delimiter = b"--" + boundary
    parts: list[dict[str, Any]] = []

    segments = body.split(delimiter)
    for segment in segments:
        if not segment or segment == b"--" or segment == b"--\r\n":
            continue
        if segment.startswith(b"\r\n"):
            segment = segment[2:]
        if segment.endswith(b"\r\n"):
            segment = segment[:-2]
        if segment.endswith(b"--"):
            segment = segment[:-2]
            if segment.endswith(b"\r\n"):
                segment = segment[:-2]

        header_sep = segment.find(b"\r\n\r\n")
        if header_sep == -1:
            continue
        raw_headers = segment[:header_sep].decode("utf-8", errors="replace")
        data = segment[header_sep + 4 :]

        headers: dict[str, str] = {}
        for line in raw_headers.split("\r\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.strip().lower()] = value.strip()

        disposition = headers.get("content-disposition", "")
        name_match = re.search(r'name="([^"]*)"', disposition)
        filename_match = re.search(r'filename="([^"]*)"', disposition)

        parts.append(
            {
                "name": name_match.group(1) if name_match else "",
                "filename": filename_match.group(1) if filename_match else None,
                "content_type": headers.get("content-type", ""),
                "data": data,
            }
        )
    return parts


def generate_media_filename(mime: str, original_name: str | None) -> str:
    ext = ""
    if original_name:
        suffix = Path(original_name).suffix.lower()
        if suffix and len(suffix) <= 6:
            ext = suffix
    if not ext:
        ext = IMAGE_EXT_FOR_MIME.get(mime, ".bin")
    token = uuid.uuid4().hex[:12]
    return f"{token}{ext}"


# ─────────────────────────────────────────────
# HTTP Handler
# ─────────────────────────────────────────────


class ScoresentationHandler(SimpleHTTPRequestHandler):
    def __init__(
        self,
        *args: Any,
        directory: str,
        repository: HymnRepository,
        setlists: SetlistRepository,
        media_dir: Path,
        **kwargs: Any,
    ) -> None:
        self.repository = repository
        self.setlists = setlists
        self.media_dir = media_dir
        super().__init__(*args, directory=directory, **kwargs)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    # ── GET ──

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/hymns":
            json_response(self, HTTPStatus.OK, {"items": self.repository.list_hymns()})
            return

        if path.startswith("/api/hymns/"):
            hymn_number = self._extract_tail(path)
            if hymn_number is None:
                json_error(self, HTTPStatus.BAD_REQUEST, "곡 ID가 올바르지 않습니다.")
                return
            item = self.repository.get_hymn(hymn_number)
            if item is None:
                json_error(self, HTTPStatus.NOT_FOUND, "저장된 곡을 찾지 못했습니다.")
                return
            json_response(self, HTTPStatus.OK, {"item": item})
            return

        if path == "/api/setlists":
            json_response(self, HTTPStatus.OK, {"items": self.setlists.list_setlists()})
            return

        if path.startswith("/api/setlists/"):
            setlist_id = self._extract_int_tail(path, "/api/setlists/")
            if setlist_id is None:
                json_error(self, HTTPStatus.BAD_REQUEST, "셋리스트 ID가 올바르지 않습니다.")
                return
            item = self.setlists.get_setlist(setlist_id)
            if item is None:
                json_error(self, HTTPStatus.NOT_FOUND, "셋리스트를 찾지 못했습니다.")
                return
            json_response(self, HTTPStatus.OK, {"item": item})
            return

        if path.startswith("/media/"):
            self._serve_media_file(unquote(path[len("/media/") :]))
            return

        super().do_GET()

    # ── POST ──

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/setlists":
            try:
                payload = self._read_json_body()
                name = payload.get("name", "")
                items = payload.get("items") if isinstance(payload.get("items"), list) else None
                settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else None
                created = self.setlists.create_setlist(name, items, settings)
            except ValueError as error:
                json_error(self, HTTPStatus.BAD_REQUEST, str(error))
                return
            except json.JSONDecodeError:
                json_error(self, HTTPStatus.BAD_REQUEST, "JSON 본문을 해석하지 못했습니다.")
                return
            json_response(self, HTTPStatus.CREATED, {"item": created})
            return

        if path == "/api/media":
            self._handle_media_upload()
            return

        json_error(self, HTTPStatus.NOT_FOUND, "지원하지 않는 API 경로입니다.")

    # ── PUT ──

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/hymns/"):
            hymn_number = self._extract_tail(path)
            if hymn_number is None:
                json_error(self, HTTPStatus.BAD_REQUEST, "곡 ID가 올바르지 않습니다.")
                return
            try:
                payload = self._read_json_body()
                hymn = payload.get("hymn", payload)
                item, created = self.repository.save_hymn(hymn_number, hymn)
            except ValueError as error:
                json_error(self, HTTPStatus.BAD_REQUEST, str(error))
                return
            except json.JSONDecodeError:
                json_error(self, HTTPStatus.BAD_REQUEST, "JSON 본문을 해석하지 못했습니다.")
                return
            status = HTTPStatus.CREATED if created else HTTPStatus.OK
            json_response(self, status, {"item": item})
            return

        if path.startswith("/api/setlists/"):
            setlist_id = self._extract_int_tail(path, "/api/setlists/")
            if setlist_id is None:
                json_error(self, HTTPStatus.BAD_REQUEST, "셋리스트 ID가 올바르지 않습니다.")
                return
            try:
                payload = self._read_json_body()
                name = payload.get("name") if "name" in payload else None
                items = payload.get("items") if isinstance(payload.get("items"), list) else None
                settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else None
                updated = self.setlists.update_setlist(setlist_id, name=name, items=items, settings=settings)
            except ValueError as error:
                json_error(self, HTTPStatus.BAD_REQUEST, str(error))
                return
            except json.JSONDecodeError:
                json_error(self, HTTPStatus.BAD_REQUEST, "JSON 본문을 해석하지 못했습니다.")
                return
            if updated is None:
                json_error(self, HTTPStatus.NOT_FOUND, "셋리스트를 찾지 못했습니다.")
                return
            json_response(self, HTTPStatus.OK, {"item": updated})
            return

        json_error(self, HTTPStatus.NOT_FOUND, "지원하지 않는 API 경로입니다.")

    # ── DELETE ──

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/hymns/"):
            hymn_number = self._extract_tail(path)
            if hymn_number is None:
                json_error(self, HTTPStatus.BAD_REQUEST, "곡 ID가 올바르지 않습니다.")
                return
            deleted = self.repository.delete_hymn(hymn_number)
            if not deleted:
                json_error(self, HTTPStatus.NOT_FOUND, "삭제할 저장본이 없습니다.")
                return
            json_response(self, HTTPStatus.OK, {"deleted": True, "number": hymn_number})
            return

        if path.startswith("/api/setlists/"):
            setlist_id = self._extract_int_tail(path, "/api/setlists/")
            if setlist_id is None:
                json_error(self, HTTPStatus.BAD_REQUEST, "셋리스트 ID가 올바르지 않습니다.")
                return
            deleted = self.setlists.delete_setlist(setlist_id)
            if not deleted:
                json_error(self, HTTPStatus.NOT_FOUND, "삭제할 셋리스트가 없습니다.")
                return
            json_response(self, HTTPStatus.OK, {"deleted": True, "id": setlist_id})
            return

        if path.startswith("/api/media/"):
            media_id = self._extract_int_tail(path, "/api/media/")
            if media_id is None:
                json_error(self, HTTPStatus.BAD_REQUEST, "미디어 ID가 올바르지 않습니다.")
                return
            media = self.setlists.delete_media(media_id)
            if media is None:
                json_error(self, HTTPStatus.NOT_FOUND, "삭제할 미디어가 없습니다.")
                return
            try:
                (self.media_dir / media["filename"]).unlink(missing_ok=True)
            except OSError:
                pass
            json_response(self, HTTPStatus.OK, {"deleted": True, "id": media_id})
            return

        json_error(self, HTTPStatus.NOT_FOUND, "지원하지 않는 API 경로입니다.")

    # ── Helpers ──

    def _handle_media_upload(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length") or 0)
        if content_length <= 0:
            json_error(self, HTTPStatus.BAD_REQUEST, "업로드할 파일이 없습니다.")
            return
        if content_length > MAX_UPLOAD_BYTES:
            json_error(self, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "파일 크기는 50MB까지 지원합니다.")
            return

        boundary_match = re.search(r"boundary=([^;]+)", content_type)
        if not boundary_match:
            json_error(self, HTTPStatus.BAD_REQUEST, "multipart boundary를 찾을 수 없습니다.")
            return

        boundary = boundary_match.group(1).strip().strip('"').encode("utf-8")
        body = self.rfile.read(content_length)

        try:
            parts = parse_multipart(body, boundary)
        except Exception as error:  # noqa: BLE001
            json_error(self, HTTPStatus.BAD_REQUEST, f"multipart 파싱 실패: {error}")
            return

        file_parts = [part for part in parts if part["filename"]]
        if not file_parts:
            json_error(self, HTTPStatus.BAD_REQUEST, "파일 필드를 찾을 수 없습니다.")
            return
        part = file_parts[0]
        mime = part["content_type"] or mimetypes.guess_type(part["filename"] or "")[0] or ""
        if mime not in ALLOWED_IMAGE_MIMES:
            json_error(self, HTTPStatus.UNSUPPORTED_MEDIA_TYPE, f"지원하지 않는 이미지 형식입니다: {mime}")
            return

        data: bytes = part["data"]
        if len(data) > MAX_UPLOAD_BYTES:
            json_error(self, HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "파일 크기는 50MB까지 지원합니다.")
            return

        self.media_dir.mkdir(parents=True, exist_ok=True)
        filename = generate_media_filename(mime, part["filename"])
        target = self.media_dir / filename
        try:
            target.write_bytes(data)
        except OSError as error:
            json_error(self, HTTPStatus.INTERNAL_SERVER_ERROR, f"파일 저장 실패: {error}")
            return

        media = self.setlists.register_media(filename, mime, len(data))
        json_response(self, HTTPStatus.CREATED, {"item": media})

    def _serve_media_file(self, relative: str) -> None:
        if not relative or "/" in relative or "\\" in relative or ".." in relative:
            self.send_error(HTTPStatus.BAD_REQUEST, "잘못된 경로")
            return
        target = self.media_dir / relative
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "미디어 파일 없음")
            return
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        try:
            data = target.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "파일 읽기 실패")
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(data)

    def _extract_tail(self, path: str) -> str | None:
        tail = unquote(path.rsplit("/", 1)[-1]).strip()
        return tail or None

    def _extract_int_tail(self, path: str, prefix: str) -> int | None:
        if not path.startswith(prefix):
            return None
        tail = path[len(prefix) :].strip("/")
        if not tail:
            return None
        try:
            return int(tail)
        except ValueError:
            return None

    def _read_json_body(self) -> Any:
        content_length = int(self.headers.get("Content-Length") or 0)
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        return json.loads(raw_body.decode("utf-8"))


def run_server(host: str, port: int, db_path: Path, setlist_db_path: Path, media_dir: Path) -> None:
    repository = HymnRepository(db_path)
    setlists = SetlistRepository(setlist_db_path)
    media_dir.mkdir(parents=True, exist_ok=True)

    def handler_factory(*args: Any, **kwargs: Any) -> ScoresentationHandler:
        return ScoresentationHandler(
            *args,
            directory=str(ROOT_DIR),
            repository=repository,
            setlists=setlists,
            media_dir=media_dir,
            **kwargs,
        )

    server = ThreadingHTTPServer((host, port), handler_factory)
    print(f"Scoresentation server running at http://{host}:{port}")
    print(f"Hymn DB:     {db_path}")
    print(f"Setlist DB:  {setlist_db_path}")
    print(f"Media dir:   {media_dir}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Scoresentation with SQLite-backed save/load APIs.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind. Default: 8000")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Hymn SQLite DB path")
    parser.add_argument("--setlist-db", type=Path, default=DEFAULT_SETLIST_DB_PATH, help="Setlist SQLite DB path")
    parser.add_argument("--media-dir", type=Path, default=MEDIA_DIR, help="Media upload directory")
    args = parser.parse_args()
    run_server(
        args.host,
        args.port,
        args.db.resolve(),
        args.setlist_db.resolve(),
        args.media_dir.resolve(),
    )


if __name__ == "__main__":
    main()
