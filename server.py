from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT_DIR / "data" / "scoresentation.db"


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
                ORDER BY CAST(number AS INTEGER), number
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

        normalized_number = str(hymn.get("number") or number or "").strip()
        if not normalized_number.isdigit():
            raise ValueError("곡 번호는 숫자 문자열이어야 합니다.")

        if str(number).strip() and str(number).strip() != normalized_number:
            raise ValueError("요청 경로의 곡 번호와 본문 데이터의 곡 번호가 일치하지 않습니다.")

        hymn = json.loads(json.dumps(hymn, ensure_ascii=False))
        hymn["number"] = normalized_number

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


class ScoresentationHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, directory: str, repository: HymnRepository, **kwargs: Any) -> None:
        self.repository = repository
        super().__init__(*args, directory=directory, **kwargs)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "GET, PUT, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/hymns":
            json_response(self, HTTPStatus.OK, {"items": self.repository.list_hymns()})
            return

        if parsed.path.startswith("/api/hymns/"):
            hymn_number = self._extract_hymn_number(parsed.path)
            if hymn_number is None:
                json_error(self, HTTPStatus.BAD_REQUEST, "곡 번호가 올바르지 않습니다.")
                return

            item = self.repository.get_hymn(hymn_number)
            if item is None:
                json_error(self, HTTPStatus.NOT_FOUND, "저장된 곡을 찾지 못했습니다.")
                return

            json_response(self, HTTPStatus.OK, {"item": item})
            return

        super().do_GET()

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/hymns/"):
            json_error(self, HTTPStatus.NOT_FOUND, "지원하지 않는 API 경로입니다.")
            return

        hymn_number = self._extract_hymn_number(parsed.path)
        if hymn_number is None:
            json_error(self, HTTPStatus.BAD_REQUEST, "곡 번호가 올바르지 않습니다.")
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

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/hymns/"):
            json_error(self, HTTPStatus.NOT_FOUND, "지원하지 않는 API 경로입니다.")
            return

        hymn_number = self._extract_hymn_number(parsed.path)
        if hymn_number is None:
            json_error(self, HTTPStatus.BAD_REQUEST, "곡 번호가 올바르지 않습니다.")
            return

        deleted = self.repository.delete_hymn(hymn_number)
        if not deleted:
            json_error(self, HTTPStatus.NOT_FOUND, "삭제할 저장본이 없습니다.")
            return

        json_response(self, HTTPStatus.OK, {"deleted": True, "number": hymn_number})

    def _extract_hymn_number(self, path: str) -> str | None:
        hymn_number = unquote(path.rsplit("/", 1)[-1]).strip()
        return hymn_number if hymn_number.isdigit() else None

    def _read_json_body(self) -> Any:
        content_length = int(self.headers.get("Content-Length") or 0)
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        return json.loads(raw_body.decode("utf-8"))


def run_server(host: str, port: int, db_path: Path) -> None:
    repository = HymnRepository(db_path)

    def handler_factory(*args: Any, **kwargs: Any) -> ScoresentationHandler:
        return ScoresentationHandler(
            *args,
            directory=str(ROOT_DIR),
            repository=repository,
            **kwargs,
        )

    server = ThreadingHTTPServer((host, port), handler_factory)
    print(f"Scoresentation server running at http://{host}:{port}")
    print(f"SQLite DB: {db_path}")
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
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB path")
    args = parser.parse_args()
    run_server(args.host, args.port, args.db.resolve())


if __name__ == "__main__":
    main()
