"""
sync-to-baseline.py — 앱에서 편집한 user data 중 **고른 것만** baseline 으로 승격한다.

baseline(data/*.db)은 릴리스에 동봉되는 읽기 전용 원본이다. user data 를 통째로 밀어 넣으면
    - 릴리스 이후 손대지 않은 오래된 곡 수정본이 baseline 개선(예: 일괄 빔)을 덮어쓰고,
    - 지난 주 셋리스트까지 배포되어 "baseline 엔 이번 주 셋리스트 하나" 관례가 깨진다.
그래서 이 도구는 **아무것도 자동으로 고르지 않는다.** 승격할 대상을 직접 지정해야 한다.

사용법
    python tools/sync-to-baseline.py
        현재 상태만 보여준다 (아무것도 쓰지 않음).

    python tools/sync-to-baseline.py --setlist 1000000014
        무엇이 바뀔지 미리보기 (dry-run). --apply 없이는 절대 쓰지 않는다.

    python tools/sync-to-baseline.py --setlist 1000000014 --hymn "주의 이름 높이며" --apply
        셋리스트 1개 + 곡 1개를 승격.

    python tools/sync-to-baseline.py --hymn 27 --hymn 495 --apply
        곡만 승격 (여러 번 지정 가능, 쉼표로도 가능: --hymn 27,495)

    python tools/sync-to-baseline.py --hymn 337 --apply --force
        baseline 이 더 최신인 곡(STALE)을 굳이 승격할 때. 기본은 거부한다.

곡 상태
    NEW    baseline 에 없는 곡          -> 승격하면 새로 추가된다
    NEWER  user 가 baseline 보다 최신    -> 정상 승격 대상
    SAME   내용이 baseline 과 동일       -> 승격해도 의미 없음
    STALE  baseline 이 더 최신(또는 동시) -> 승격하면 baseline 개선이 되돌아간다. --force 필요

셋리스트는 baseline 에 **하나만** 둔다. --setlist 로 지정하면 기존 baseline 셋리스트를 지우고
그것으로 교체하며, 참조하는 media 행과 이미지/미디어 파일이 baseline 에 없으면 함께 복사한다.

--apply 시 data/*.db 를 .bak.sync-<시각> 으로 백업하고, 끝난 뒤 검증(참조 해석·이미지 존재·
음표 정합성·integrity)과 WAL 체크포인트까지 수행한다. 검증에서 문제가 나오면 화면에 표시된다.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

TOOLS_DIR = Path(__file__).resolve().parent
ROOT_DIR = TOOLS_DIR.parent
BASELINE_DIR = ROOT_DIR / "data"

HYMN_COLUMNS = (
    "number", "title", "new_number", "composer",
    "key_signature", "time_signature", "hymn_json", "updated_at",
)


# ─────────────────────────────────────────────
# 공통 헬퍼
# ─────────────────────────────────────────────

def user_data_dir() -> Path:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        sys.exit("APPDATA 환경변수를 찾을 수 없습니다. (Windows 에서 실행하세요)")
    return Path(appdata) / "Scoresentation" / "data"


def parse_updated_at(value) -> float:
    """updated_at 을 epoch(ms)로. ISO 문자열과 unix 초 문자열이 섞여 있다(main/db.js 와 동일 규칙)."""
    if value is None:
        return float("nan")
    text = str(value).strip()
    if not text:
        return float("nan")
    if re.fullmatch(r"\d{9,13}", text):
        num = int(text)
        return num * 1000 if len(text) <= 10 else num
    try:
        return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp() * 1000
    except ValueError:
        return float("nan")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ro(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def rw(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(path))
    con.row_factory = sqlite3.Row
    return con


def nonspace(text: str) -> str:
    return re.sub(r"\s+", "", (text or "").replace("<br/>", ""))


def sections(hymn: dict):
    for section in (hymn.get("verses") or {}).values():
        yield section
    if hymn.get("chorus"):
        yield hymn["chorus"]


def note_total(hymn: dict) -> int:
    return sum(
        len(note_map[key])
        for section in sections(hymn)
        for note_map in (section.get("notes") or [])
        for key in note_map
    )


def beam_group_count(hymn: dict) -> int:
    total = 0
    for section in sections(hymn):
        for note_map in (section.get("notes") or []):
            for key in note_map:
                total += len({
                    note["beamGroup"] for note in note_map[key]
                    if note and note.get("beamGroup") is not None
                })
    return total


def slide_count(hymn: dict) -> int:
    return sum(len(section.get("korean") or []) for section in sections(hymn))


def regression_warnings(user_hymn: dict, base_hymn: dict) -> list[str]:
    """승격했을 때 baseline 에만 있던 작업이 사라지는지 본다.

    updated_at 만으로는 판단할 수 없다. baseline 을 일괄 스크립트로 손볼 때(예: 빔 일괄 적용)
    updated_at 을 갱신하지 않은 경우가 있어서, 시각상으로는 user 가 최신처럼 보이지만
    내용상으로는 baseline 이 더 발전한 상태일 수 있다.
    """
    warnings = []
    user_notes, base_notes = note_total(user_hymn), note_total(base_hymn)
    if user_notes != base_notes:
        warnings.append(f"음표 수 {base_notes} → {user_notes}")
    user_beams, base_beams = beam_group_count(user_hymn), beam_group_count(base_hymn)
    if user_beams < base_beams:
        warnings.append(f"빔 묶음 {base_beams} → {user_beams} (baseline 의 빔 작업이 되돌아감)")
    return warnings


def dangling_lines(hymn: dict) -> list[str]:
    """가사 글자 수와 음표 수가 어긋나는 줄. 이런 음표는 발표 화면에서 렌더되지 않는다."""
    bad = []
    for section in sections(hymn):
        notes = section.get("notes") or []
        for slide_index, slide in enumerate(section.get("korean") or []):
            note_map = notes[slide_index] if slide_index < len(notes) else {}
            for line_index, line in enumerate(slide.split("<br/>")):
                arr = note_map.get(str(line_index)) or []
                if len(nonspace(line)) != len(arr):
                    bad.append(f"slide{slide_index} line{line_index}: 글자{len(nonspace(line))} != 음표{len(arr)}")
    return bad


# ─────────────────────────────────────────────
# 상태 조회
# ─────────────────────────────────────────────

def hymn_status(user_row: sqlite3.Row, base_row: sqlite3.Row | None) -> str:
    if base_row is None:
        return "NEW"
    try:
        same = json.loads(user_row["hymn_json"]) == json.loads(base_row["hymn_json"])
    except (ValueError, TypeError):
        same = user_row["hymn_json"] == base_row["hymn_json"]
    if same:
        return "SAME"
    user_time = parse_updated_at(user_row["updated_at"])
    base_time = parse_updated_at(base_row["updated_at"])
    if user_time != user_time or base_time != base_time:   # NaN
        return "NEWER"      # 판단 불가하면 사용자 편집을 우선 취급 (승격 여부는 사람이 정함)
    return "NEWER" if user_time > base_time else "STALE"


def collect_hymn_states(user_db: Path, base_db: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not user_db.is_file():
        return out
    user = ro(user_db)
    base = ro(base_db) if base_db.is_file() else None
    base_rows = {}
    if base:
        base_rows = {r["number"]: r for r in base.execute(f"SELECT {','.join(HYMN_COLUMNS)} FROM saved_hymns")}
    for row in user.execute(f"SELECT {','.join(HYMN_COLUMNS)} FROM saved_hymns"):
        out[row["number"]] = {"row": row, "base": base_rows.get(row["number"]),
                              "status": hymn_status(row, base_rows.get(row["number"]))}
    user.close()
    if base:
        base.close()
    return out


def setlist_media_refs(settings_json: str, items: list[sqlite3.Row]) -> tuple[set[int], list[str], set[str]]:
    """셋리스트가 참조하는 (media 행 id, images/ 상대경로, media/ 파일명)."""
    media_ids: set[int] = set()
    image_paths: list[str] = []
    media_files: set[str] = set()

    try:
        settings = json.loads(settings_json or "{}")
    except ValueError:
        settings = {}
    bg = settings.get("bgImage")
    if isinstance(bg, dict):
        if bg.get("mediaId"):
            media_ids.add(int(bg["mediaId"]))
        if bg.get("filename"):
            media_files.add(str(bg["filename"]))

    for item in items:
        try:
            payload = json.loads(item["payload_json"] or "{}")
        except ValueError:
            continue
        for image in payload.get("images") or []:
            if image.get("mediaId"):
                media_ids.add(int(image["mediaId"]))
            url = str(image.get("url") or "")
            path = unquote(url.split("?")[0]).lstrip("/")
            if path.startswith("images/"):
                image_paths.append(path)
            elif path.startswith("media/"):
                media_files.add(path[len("media/"):])
    return media_ids, image_paths, media_files


# ─────────────────────────────────────────────
# 출력
# ─────────────────────────────────────────────

def print_overview(user_dir: Path) -> None:
    base_hymn_db = BASELINE_DIR / "scoresentation.db"
    base_setlist_db = BASELINE_DIR / "setlists.db"

    print(f"baseline : {BASELINE_DIR}")
    print(f"user     : {user_dir}\n")

    states = collect_hymn_states(user_dir / "scoresentation-user.db", base_hymn_db)
    print(f"── user 곡 수정본 {len(states)}개 ──")
    if not states:
        print("   (없음)")
    for number, info in sorted(states.items()):
        note = {
            "NEW":   "baseline 에 없는 새 곡",
            "NEWER": "user 가 최신 — 승격 대상",
            "SAME":  "내용 동일 — 승격 불필요",
            "STALE": "baseline 이 더 최신 — 승격하면 baseline 개선이 되돌아감 (--force 필요)",
        }[info["status"]]
        print(f"   [{info['status']:<5}] {number}   ({note})")
        if info["base"] is not None:
            losses = regression_warnings(json.loads(info["row"]["hymn_json"]),
                                         json.loads(info["base"]["hymn_json"]))
            if losses:
                print(f"           ⚠ 승격하면 후퇴: {', '.join(losses)} — 기본적으로 거부됩니다")

    user_setlist_db = user_dir / "setlists.db"
    print(f"\n── user 셋리스트 ──")
    if user_setlist_db.is_file():
        con = ro(user_setlist_db)
        for row in con.execute("SELECT id, name, updated_at FROM setlists ORDER BY id"):
            count = con.execute("SELECT COUNT(*) FROM setlist_items WHERE setlist_id = ?", (row["id"],)).fetchone()[0]
            print(f"   id={row['id']}  {row['name']}  ({count}항목, updated {row['updated_at']})")
        con.close()
    else:
        print("   (없음)")

    print(f"\n── 현재 baseline 셋리스트 ──")
    if base_setlist_db.is_file():
        con = ro(base_setlist_db)
        rows = con.execute("SELECT id, name FROM setlists ORDER BY id").fetchall()
        if not rows:
            print("   (없음)")
        for row in rows:
            count = con.execute("SELECT COUNT(*) FROM setlist_items WHERE setlist_id = ?", (row["id"],)).fetchone()[0]
            print(f"   id={row['id']}  {row['name']}  ({count}항목)")
        con.close()

    print("\n승격하려면 --setlist <id> / --hymn <번호> 를 지정하세요. 실제로 쓰려면 --apply 를 붙입니다.")


# ─────────────────────────────────────────────
# 승격
# ─────────────────────────────────────────────

def backup(paths: list[Path]) -> None:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    for path in paths:
        if path.is_file():
            target = path.with_name(path.name + f".bak.sync-{stamp}")
            shutil.copy2(path, target)
            print(f"   백업: {target.name}")


def promote_hymns(user_dir: Path, numbers: list[str], states: dict, apply: bool, force: bool) -> list[str]:
    """선택한 곡을 baseline 으로. 반환: 실제로 승격한 번호들"""
    base_db = BASELINE_DIR / "scoresentation.db"
    promoted = []

    plan = []
    for number in numbers:
        info = states.get(number)
        if info is None:
            print(f"   [건너뜀] {number}: user DB 에 이 곡의 수정본이 없습니다.")
            continue
        status = info["status"]
        if status == "STALE" and not force:
            print(f"   [거부]   {number}: STALE — baseline 이 더 최신입니다. 정말 되돌리려면 --force")
            continue
        if status == "SAME":
            print(f"   [건너뜀] {number}: baseline 과 내용이 동일합니다.")
            continue

        # 시각과 무관하게, baseline 에만 있던 작업이 사라지는지 본다.
        if info["base"] is not None:
            losses = regression_warnings(json.loads(info["row"]["hymn_json"]),
                                         json.loads(info["base"]["hymn_json"]))
            if losses and not force:
                print(f"   [거부]   {number}: 승격하면 baseline 내용이 후퇴합니다 — {', '.join(losses)}")
                print(f"              (정말 되돌리려면 --force. updated_at 은 user 가 최신이지만"
                      f" baseline 이 나중에 일괄 수정된 경우입니다)")
                continue
            if losses:
                print(f"   [경고]   {number}: --force 로 후퇴를 감수하고 승격합니다 — {', '.join(losses)}")

        plan.append((number, info))

    for number, info in plan:
        hymn = json.loads(info["row"]["hymn_json"])
        bad = dangling_lines(hymn)
        mark = f"음표 {note_total(hymn)}개, 빔 {beam_group_count(hymn)}묶음, 슬라이드 {slide_count(hymn)}개"
        if bad:
            mark += f", ⚠ 정합성 경고 {len(bad)}줄"
        print(f"   [{'승격' if apply else '승격예정'}] {number}  ({info['status']}, {mark})")
        for line in bad[:3]:
            print(f"              ⚠ {line}")

    if not apply or not plan:
        return [number for number, _ in plan]

    con = rw(base_db)
    now = utc_now_iso()
    for number, info in plan:
        row = info["row"]
        con.execute(
            "INSERT OR REPLACE INTO saved_hymns "
            "(number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (row["number"], row["title"], row["new_number"], row["composer"],
             row["key_signature"], row["time_signature"], row["hymn_json"], now),
        )
        promoted.append(number)
    con.commit()
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.close()
    # baseline 을 새 시각으로 찍었으므로, 다음 실행 때 앱이 로컬 override 를 정리하고 배포본을 쓴다.
    print(f"   → {len(promoted)}곡 승격 (updated_at = {now})")
    return promoted


def promote_setlist(user_dir: Path, setlist_id: int, apply: bool) -> bool:
    user_db = user_dir / "setlists.db"
    base_db = BASELINE_DIR / "setlists.db"
    if not user_db.is_file():
        print("   [건너뜀] user 셋리스트 DB 가 없습니다.")
        return False

    user = ro(user_db)
    row = user.execute(
        "SELECT id, name, created_at, updated_at, settings FROM setlists WHERE id = ?", (setlist_id,)
    ).fetchone()
    if row is None:
        user.close()
        print(f"   [실패]  셋리스트 id={setlist_id} 를 user DB 에서 찾지 못했습니다.")
        return False
    items = user.execute(
        "SELECT id, setlist_id, position, item_type, payload_json FROM setlist_items "
        "WHERE setlist_id = ? ORDER BY position", (setlist_id,)
    ).fetchall()
    media_ids, image_paths, media_files = setlist_media_refs(row["settings"], items)
    user_media = {
        mid: user.execute("SELECT id, filename, mime, size, created_at FROM media WHERE id = ?", (mid,)).fetchone()
        for mid in media_ids
    }
    user.close()

    print(f"   [{'승격' if apply else '승격예정'}] 셋리스트 id={setlist_id} 「{row['name']}」 {len(items)}항목")
    print(f"              참조: media행 {sorted(media_ids)}, 이미지 {len(image_paths)}개")

    # 참조 파일이 baseline 에 있는지 (없으면 user 쪽에서 복사)
    to_copy: list[tuple[Path, Path]] = []
    missing: list[str] = []
    for rel in image_paths:
        target = BASELINE_DIR / Path(rel)
        if target.is_file():
            continue
        source = user_dir / Path(rel)
        if source.is_file():
            to_copy.append((source, target))
        else:
            missing.append(rel)
    for filename in media_files:
        target = BASELINE_DIR / "media" / filename
        if target.is_file():
            continue
        source = user_dir / "media" / filename
        if source.is_file():
            to_copy.append((source, target))
        else:
            missing.append(f"media/{filename}")

    for source, target in to_copy:
        print(f"              파일 복사 {'실행' if apply else '예정'}: {target.relative_to(BASELINE_DIR)}")
    for rel in missing:
        print(f"              ⚠ 파일 없음(baseline·user 양쪽): {rel}")

    if not apply:
        return True

    for source, target in to_copy:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

    con = rw(base_db)
    # baseline 은 셋리스트 하나만 유지한다 — 기존 것을 모두 지우고 교체
    for existing in con.execute("SELECT id FROM setlists").fetchall():
        con.execute("DELETE FROM setlist_items WHERE setlist_id = ?", (existing["id"],))
        con.execute("DELETE FROM setlists WHERE id = ?", (existing["id"],))
    for mid, media_row in user_media.items():
        if media_row is None:
            continue
        if con.execute("SELECT 1 FROM media WHERE id = ?", (mid,)).fetchone() is None:
            con.execute(
                "INSERT INTO media (id, filename, mime, size, created_at) VALUES (?, ?, ?, ?, ?)",
                tuple(media_row),
            )
            print(f"              media 행 추가: id={mid} {media_row['filename']}")
    con.execute(
        "INSERT INTO setlists (id, name, created_at, updated_at, settings) VALUES (?, ?, ?, ?, ?)",
        (row["id"], row["name"], row["created_at"], row["updated_at"], row["settings"]),
    )
    con.executemany(
        "INSERT INTO setlist_items (id, setlist_id, position, item_type, payload_json) VALUES (?, ?, ?, ?, ?)",
        [tuple(item) for item in items],
    )
    con.commit()
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.close()
    print(f"   → 셋리스트 교체 완료 (baseline 셋리스트는 항상 1개)")
    return True


# ─────────────────────────────────────────────
# 검증
# ─────────────────────────────────────────────

def verify() -> bool:
    base_hymn_db = BASELINE_DIR / "scoresentation.db"
    base_setlist_db = BASELINE_DIR / "setlists.db"
    ok = True

    hymns = ro(base_hymn_db)
    numbers = {r["number"] for r in hymns.execute("SELECT number FROM saved_hymns")}
    print(f"   곡 {len(numbers)}개")

    if base_setlist_db.is_file():
        setlists = ro(base_setlist_db)
        rows = setlists.execute("SELECT id, name, settings FROM setlists").fetchall()
        if len(rows) != 1:
            print(f"   ⚠ baseline 셋리스트가 {len(rows)}개입니다 (1개여야 함)")
            ok = False
        for row in rows:
            items = setlists.execute(
                "SELECT position, item_type, payload_json FROM setlist_items WHERE setlist_id = ? ORDER BY position",
                (row["id"],),
            ).fetchall()
            positions = [i["position"] for i in items]
            if positions != list(range(len(positions))):
                print(f"   ⚠ 항목 position 이 연속이 아닙니다: {positions}")
                ok = False

            media_ids, image_paths, media_files = setlist_media_refs(row["settings"], items)
            for item in items:
                if item["item_type"] != "score":
                    continue
                payload = json.loads(item["payload_json"] or "{}")
                song_id = payload.get("songId")
                if song_id not in numbers:
                    print(f"   ⚠ pos {item['position']}: songId {song_id!r} 를 baseline 에서 찾을 수 없습니다")
                    ok = False
            for rel in image_paths:
                if not (BASELINE_DIR / Path(rel)).is_file():
                    print(f"   ⚠ 이미지 없음: {rel}")
                    ok = False
            for filename in media_files:
                if not (BASELINE_DIR / "media" / filename).is_file():
                    print(f"   ⚠ 미디어 없음: media/{filename}")
                    ok = False
            for mid in media_ids:
                if setlists.execute("SELECT 1 FROM media WHERE id = ?", (mid,)).fetchone() is None:
                    print(f"   ⚠ media 행 없음: id={mid}")
                    ok = False
            print(f"   셋리스트 「{row['name']}」 {len(items)}항목 — 참조 확인")
        setlists.close()

    for label, con in (("scoresentation.db", hymns),):
        result = con.execute("PRAGMA integrity_check").fetchone()[0]
        print(f"   integrity({label}) = {result}")
        if result != "ok":
            ok = False
    hymns.close()

    if base_setlist_db.is_file():
        con = ro(base_setlist_db)
        result = con.execute("PRAGMA integrity_check").fetchone()[0]
        print(f"   integrity(setlists.db) = {result}")
        if result != "ok":
            ok = False
        con.close()

    return ok


# ─────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="user data 중 고른 것만 baseline 으로 승격합니다. 기본은 미리보기(dry-run).",
    )
    parser.add_argument("--hymn", action="append", default=[],
                        help="승격할 곡 번호/제목. 여러 번 쓰거나 쉼표로 구분 (예: --hymn 27 --hymn 충만)")
    parser.add_argument("--setlist", type=int, default=None,
                        help="승격할 셋리스트 id. baseline 셋리스트를 이것으로 교체한다.")
    parser.add_argument("--apply", action="store_true",
                        help="실제로 baseline 에 쓴다. 없으면 미리보기만 한다.")
    parser.add_argument("--force", action="store_true",
                        help="STALE(baseline 이 더 최신)인 곡도 승격한다.")
    args = parser.parse_args()

    user_dir = user_data_dir()
    if not user_dir.is_dir():
        sys.exit(f"user data 폴더가 없습니다: {user_dir}\n앱을 한 번 실행한 뒤 다시 시도하세요.")

    numbers: list[str] = []
    for entry in args.hymn:
        numbers.extend(part.strip() for part in entry.split(",") if part.strip())

    if not numbers and args.setlist is None:
        print_overview(user_dir)
        return

    print(f"baseline : {BASELINE_DIR}")
    print(f"user     : {user_dir}")
    print("=== 미리보기 (실제로 쓰지 않음) ===\n" if not args.apply else "=== 적용 ===\n")

    if args.apply:
        backup([BASELINE_DIR / "scoresentation.db", BASELINE_DIR / "setlists.db"])
        print()

    states = collect_hymn_states(user_dir / "scoresentation-user.db", BASELINE_DIR / "scoresentation.db")

    if numbers:
        print("── 곡 ──")
        promote_hymns(user_dir, numbers, states, args.apply, args.force)
        print()

    if args.setlist is not None:
        print("── 셋리스트 ──")
        promote_setlist(user_dir, args.setlist, args.apply)
        print()

    if args.apply:
        print("── 검증 ──")
        ok = verify()
        print()
        if ok:
            print("완료. 앱을 실행해 확인한 뒤 git diff 로 의도한 변경만 들어갔는지 보세요.")
        else:
            print("⚠ 검증에서 문제가 발견되었습니다. 위 경고를 확인하고, 필요하면 .bak.sync-* 백업으로 되돌리세요.")
            sys.exit(1)
    else:
        print("실제로 적용하려면 같은 명령에 --apply 를 붙이세요.")


if __name__ == "__main__":
    main()
