"""
NWC 파일의 멜로디 음표를 hymns.json의 notes 포맷으로 변환한다.

사용법:
  python nwc_to_hymns.py                  # 샘플 변환 + 확인만
  python nwc_to_hymns.py --write          # hymns.json에 실제 기록
  python nwc_to_hymns.py --write 1 46 72  # 특정 번호만

변환 규칙:
- NWC 소프라노 멜로디를 hymns.json의 가사 슬라이드/줄에 1:1 매핑
- 1절 + 후렴의 멜로디가 기준, 2절 이후는 절 부분만 재사용
- NWC pitch(표준)를 프로젝트 v2 체계(한 단계 낮춤)로 변환
- 기존 hymns.json 필드는 모두 보존
"""

import json
import sys
import os
import subprocess

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# ── pitch v2 변환 ────────────────────────────────────

V2_SHIFT = {'C': ('B', -1), 'D': ('C', 0), 'E': ('D', 0), 'F': ('E', 0),
            'G': ('F', 0), 'A': ('G', 0), 'B': ('A', 0)}


def to_v2_pitch(standard_pitch_str):
    """'E4' → 'D4' (v2 체계)"""
    name = standard_pitch_str[:-1]
    octave = int(standard_pitch_str[-1])
    new_name, oct_delta = V2_SHIFT[name]
    return f'{new_name}{octave + oct_delta}'


# ── NWC bridge (Node.js nwc-viewer 호출) ─────────────

BRIDGE_SCRIPT = os.path.join(os.path.dirname(__file__), 'nwc_bridge.mjs')


def parse_nwc_via_bridge(nwc_path):
    """nwc_bridge.mjs를 Node.js로 실행하여 멜로디 JSON 반환"""
    result = subprocess.run(
        ['node', BRIDGE_SCRIPT, os.path.abspath(nwc_path)],
        capture_output=True, encoding='utf-8', timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f'nwc_bridge error: {result.stderr[:200]}')
    return json.loads(result.stdout)


# ── 음절 수 계산 ─────────────────────────────────────

def count_syllables_per_line(korean_text):
    """'찬양하라 복되신<br/>백성들아 전하세' → [10, 8]"""
    lines = korean_text.split('<br/>')
    return [len(line.replace(' ', '')) for line in lines]


def count_verse_syllables(verse_data):
    """verse dict → 슬라이드별, 줄별 음절 수 리스트"""
    result = []
    for slide_text in verse_data['korean']:
        result.append(count_syllables_per_line(slide_text))
    return result


# ── NWC melody → notes 매핑 ──────────────────────────

def map_melody_to_slides(melody_notes, slide_line_counts):
    """
    melody_notes: [{pitch, dur, ...}, ...]
    slide_line_counts: [[chars_line0, chars_line1], [chars_line0, ...], ...]
    → notes 배열 (프로젝트 포맷)
    """
    notes_array = []
    note_idx = 0

    for slide_counts in slide_line_counts:
        slide_notes = {}
        for line_idx, char_count in enumerate(slide_counts):
            line_notes = []
            for _ in range(char_count):
                if note_idx < len(melody_notes):
                    n = melody_notes[note_idx]
                    line_notes.append({
                        'pitch': n['pitch'],
                        'duration': n['dur'],
                    })
                else:
                    line_notes.append(None)
                note_idx += 1
            slide_notes[str(line_idx)] = line_notes
        notes_array.append(slide_notes)

    return notes_array


# ── 메인 변환 로직 ───────────────────────────────────

def convert_hymn(hymn_data, nwc_file_path):
    """hymn_data에 NWC 멜로디 notes를 추가하여 반환"""
    nwc_data = parse_nwc_via_bridge(nwc_file_path)

    if not nwc_data['melody']:
        return None, 'NWC에서 음표를 추출하지 못함'

    melody = nwc_data['melody']  # [{pitch, dur}, ...]

    # 1절의 슬라이드/줄 구조로 음절 수 계산
    verses = hymn_data.get('verses', {})
    chorus = hymn_data.get('chorus')

    if not verses:
        return None, 'hymns.json에 verses 없음'

    first_verse_key = sorted(verses.keys(), key=lambda k: int(k) if k.isdigit() else 0)[0]
    first_verse = verses[first_verse_key]

    # 1절 슬라이드 구조
    verse_slide_counts = count_verse_syllables(first_verse)
    verse_total = sum(sum(lc) for lc in verse_slide_counts)

    # 후렴 슬라이드 구조
    chorus_slide_counts = []
    chorus_total = 0
    if chorus and chorus.get('korean') and chorus['korean'][0]:
        chorus_slide_counts = count_verse_syllables(chorus)
        chorus_total = sum(sum(lc) for lc in chorus_slide_counts)

    # melody 분할: 절 부분 + 후렴 부분
    if chorus_total > 0 and len(melody) >= verse_total + chorus_total:
        verse_melody = melody[:verse_total]
        chorus_melody = melody[verse_total:verse_total + chorus_total]
    else:
        verse_melody = melody[:verse_total]
        chorus_melody = []

    # 각 절에 notes 추가 (같은 melody 재사용)
    for vk, vv in verses.items():
        v_counts = count_verse_syllables(vv)
        v_total = sum(sum(lc) for lc in v_counts)
        # 절 melody를 해당 절의 음절 수에 맞춰 사용
        v_melody = verse_melody[:v_total]
        vv['notes'] = map_melody_to_slides(v_melody, v_counts)

    # 후렴에 notes 추가
    if chorus_melody and chorus_slide_counts:
        chorus['notes'] = map_melody_to_slides(chorus_melody, chorus_slide_counts)

    hymn_data['pitchLabelVersion'] = 2

    return hymn_data, f'OK (melody={len(melody)}, verse={verse_total}, chorus={chorus_total})'


# ── CLI ──────────────────────────────────────────────

def main():
    write_mode = '--write' in sys.argv
    args = [a for a in sys.argv[1:] if a != '--write']

    # NWC 파일 매핑: nccNNN.nwc → 찬송가 NNN번
    nwc_dir = 'sample/nwc찬송'

    # hymns.json 로드
    with open('hymns.json', 'r', encoding='utf-8') as f:
        hymns = json.load(f)

    # 변환 대상
    if args:
        target_nums = args
    else:
        target_nums = ['1', '46', '72']  # 샘플

    results = []
    for num in target_nums:
        nwc_path = os.path.join(nwc_dir, f'ncc{int(num):03d}.nwc')
        if not os.path.exists(nwc_path):
            print(f'[SKIP] {num}번: {nwc_path} 없음')
            continue
        if num not in hymns:
            print(f'[SKIP] {num}번: hymns.json에 없음')
            continue

        hymn_data, msg = convert_hymn(hymns[num], nwc_path)
        if hymn_data is None:
            print(f'[FAIL] {num}번: {msg}')
        else:
            hymns[num] = hymn_data
            results.append(num)
            print(f'[OK]   {num}번 ({hymn_data["title"]}): {msg}')

            # notes 요약 출력
            for vk in sorted(hymn_data['verses'].keys(), key=lambda k: int(k) if k.isdigit() else 0):
                vv = hymn_data['verses'][vk]
                if 'notes' in vv:
                    note_count = sum(
                        sum(1 for n in line_notes if n)
                        for slide in vv['notes'] if slide
                        for line_notes in slide.values()
                    )
                    print(f'       verse {vk}: {note_count} notes across {len(vv["notes"])} slides')
            if (hymn_data.get('chorus') or {}).get('notes'):
                cn = hymn_data['chorus']['notes']
                note_count = sum(
                    sum(1 for n in ln if n) for s in cn if s for ln in s.values()
                )
                print(f'       chorus: {note_count} notes across {len(cn)} slides')

    # 저장
    if write_mode and results:
        with open('hymns.json', 'w', encoding='utf-8') as f:
            json.dump(hymns, f, ensure_ascii=False, indent=2)
        print(f'\nhymns.json 저장 완료 ({len(results)}곡 업데이트)')
    elif results:
        # dry run: 첫 번째 결과만 notes 샘플 출력
        num = results[0]
        h = hymns[num]
        vk = sorted(h['verses'].keys())[0]
        notes = h['verses'][vk].get('notes', [])
        if notes and notes[0]:
            print(f'\n=== {num}번 verse {vk} slide 0 notes 샘플 ===')
            print(json.dumps(notes[0], ensure_ascii=False, indent=2)[:500])
        print('\n(--write 옵션으로 실제 저장)')


if __name__ == '__main__':
    main()
