"""
NWC 557곡을 일괄 변환하여 scoresentation.db에 저장한다.

1. hymns.json에서 기존 곡 데이터를 로드
2. NWC 파일에서 멜로디를 추출 (nwc_bridge.mjs)
3. 가사-음표 1:1 매핑으로 notes 필드 생성
4. 변환된 곡 데이터를 SQLite DB에 저장

Usage:
  python nwc_batch_convert.py          # dry run (변환만, 저장 안 함)
  python nwc_batch_convert.py --write  # DB에 실제 저장
"""

import json
import sys
import os
import sqlite3
import subprocess
import glob
import re
from datetime import datetime, timezone
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT_DIR = Path(__file__).resolve().parent
NWC_DIR = ROOT_DIR / 'sample' / 'nwc찬송'
HYMNS_JSON = ROOT_DIR / 'hymns.json'
DB_PATH = ROOT_DIR / 'data' / 'scoresentation.db'
BRIDGE_SCRIPT = ROOT_DIR / 'nwc_bridge.mjs'


# ── NWC bridge ───────────────────────────────────────

def parse_nwc(nwc_path):
    """nwc_bridge.mjs로 NWC 파일 파싱, 멜로디 JSON 반환"""
    result = subprocess.run(
        ['node', str(BRIDGE_SCRIPT), str(nwc_path)],
        capture_output=True, encoding='utf-8', timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr[:200])
    return json.loads(result.stdout)


# ── 음절 수 계산 ─────────────────────────────────────

def count_line_syllables(korean_text):
    lines = korean_text.split('<br/>')
    return [len(line.replace(' ', '')) for line in lines]


def count_verse_syllables(verse_data):
    return [count_line_syllables(s) for s in verse_data['korean']]


# ── 멜로디 → notes 매핑 ─────────────────────────────

def map_melody_to_slides(melody, slide_line_counts):
    notes_array = []
    idx = 0
    for slide_counts in slide_line_counts:
        slide_notes = {}
        for line_idx, char_count in enumerate(slide_counts):
            line_notes = []
            for _ in range(char_count):
                if idx < len(melody):
                    n = melody[idx]
                    line_notes.append({'pitch': n['pitch'], 'duration': n['dur']})
                else:
                    line_notes.append(None)
                idx += 1
            slide_notes[str(line_idx)] = line_notes
        notes_array.append(slide_notes)
    return notes_array


# ── 곡 변환 ─────────────────────────────────────────

def convert_hymn(hymn_data, nwc_path):
    """hymn_data에 NWC 멜로디 notes를 추가. 성공 시 (data, msg), 실패 시 (None, msg)"""
    nwc = parse_nwc(nwc_path)
    melody = nwc.get('melody', [])
    if not melody:
        return None, 'no melody'

    verses = hymn_data.get('verses', {})
    chorus = hymn_data.get('chorus')
    if not verses:
        return None, 'no verses'

    first_vk = sorted(verses.keys(), key=lambda k: int(k) if k.isdigit() else 0)[0]
    first_verse = verses[first_vk]

    verse_counts = count_verse_syllables(first_verse)
    verse_total = sum(sum(lc) for lc in verse_counts)

    chorus_counts = []
    chorus_total = 0
    if chorus and chorus.get('korean') and chorus['korean'][0]:
        chorus_counts = count_verse_syllables(chorus)
        chorus_total = sum(sum(lc) for lc in chorus_counts)

    if chorus_total > 0 and len(melody) >= verse_total + chorus_total:
        verse_melody = melody[:verse_total]
        chorus_melody = melody[verse_total:verse_total + chorus_total]
    else:
        verse_melody = melody[:verse_total]
        chorus_melody = []

    for vk, vv in verses.items():
        vc = count_verse_syllables(vv)
        vt = sum(sum(lc) for lc in vc)
        vv['notes'] = map_melody_to_slides(verse_melody[:vt], vc)

    if chorus_melody and chorus_counts:
        chorus['notes'] = map_melody_to_slides(chorus_melody, chorus_counts)

    hymn_data['pitchLabelVersion'] = 2
    return hymn_data, f'melody={len(melody)}, verse={verse_total}, chorus={chorus_total}'


# ── DB 저장 ──────────────────────────────────────────

def save_to_db(db_path, hymn_number, hymn_data):
    """곡 데이터를 SQLite DB에 upsert"""
    conn = sqlite3.connect(db_path)
    payload = json.dumps(hymn_data, ensure_ascii=False)
    updated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    conn.execute("""
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
    """, (
        hymn_number,
        hymn_data.get('title', ''),
        hymn_data.get('newNumber', ''),
        hymn_data.get('composer', ''),
        hymn_data.get('key', ''),
        hymn_data.get('timeSignature', ''),
        payload,
        updated_at,
    ))
    conn.commit()
    conn.close()


# ── 메인 ─────────────────────────────────────────────

def main():
    write_mode = '--write' in sys.argv

    # hymns.json 로드
    with open(HYMNS_JSON, 'r', encoding='utf-8') as f:
        hymns = json.load(f)

    # NWC 파일 목록 → 번호 매핑
    nwc_files = sorted(glob.glob(str(NWC_DIR / 'ncc*.nwc')))
    print(f'NWC 파일: {len(nwc_files)}개')
    print(f'hymns.json: {len(hymns)}곡')
    print(f'DB: {DB_PATH}')
    print()

    ok_count = 0
    fail_count = 0
    skip_count = 0

    for nwc_path in nwc_files:
        # nccNNN.nwc → NNN
        fname = os.path.basename(nwc_path)
        match = re.match(r'ncc(\d+)\.nwc', fname)
        if not match:
            continue
        num = str(int(match.group(1)))  # '001' → '1'

        if num not in hymns:
            skip_count += 1
            continue

        try:
            hymn_data, msg = convert_hymn(hymns[num].copy(), nwc_path)
            if hymn_data is None:
                fail_count += 1
                if fail_count <= 10:
                    print(f'[FAIL] {num:>3}번: {msg}')
                continue

            ok_count += 1
            if ok_count <= 5 or ok_count % 50 == 0:
                print(f'[OK]   {num:>3}번 ({hymn_data["title"][:15]}): {msg}')

            if write_mode:
                save_to_db(DB_PATH, num, hymn_data)

        except Exception as e:
            fail_count += 1
            if fail_count <= 10:
                print(f'[ERR]  {num:>3}번: {str(e)[:80]}')

    print(f'\n완료: OK={ok_count}, FAIL={fail_count}, SKIP={skip_count}')
    if write_mode:
        # DB 저장 건수 확인
        conn = sqlite3.connect(DB_PATH)
        count = conn.execute('SELECT COUNT(*) FROM saved_hymns').fetchone()[0]
        conn.close()
        print(f'DB 저장 총 {count}곡')
    else:
        print('(--write 옵션으로 DB에 실제 저장)')


if __name__ == '__main__':
    main()
