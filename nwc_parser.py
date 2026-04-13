"""
NWC (NoteWorthy Composer) 바이너리 파일 파서

NWC 1.70 [NWZ] 압축 포맷에서 메타데이터, 가사, 음표를 추출한다.

Pitch 매핑 (nwc-viewer/zz85 참조):
  raw byte → staff position → pitch name
  구 파서 convention: pos = (raw > 127) ? (256-raw) : (-raw)
  pitch_index = pos + CLEF_OFFSET(treble=34)
  note = NAMES[pitch_index % 7], octave = pitch_index // 7

Note 레코드 구조 (8 bytes):
  byte[0]: duration (low nibble → index into [w,h,q,8,16,32,64])
  byte[1-3]: data2 (beam, triplet, stem, lyric flags)
  byte[4-5]: attr1 (dot, tie, accent, staccato, slur)
  byte[6]: pos (signed int8, staff position)
  byte[7]: attr2 (accidental bits 0-2, stem length flag bit 6)

탐색 방식: byte[6]==xx, byte[7]==0x0d (attr2, accidental=Normal) 패턴으로 음표 위치를 찾고,
byte[0]~byte[5]에서 duration/dots/tie를 추출한다.
"""

import zlib
import struct
import json
import sys
import os
from collections import Counter
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# ── 상수 ──────────────────────────────────────────────

PITCH_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
DURATION_CODES = ['w', 'h', 'q', '8', '16', '32', '64']
ACCIDENTALS = ['#', 'b', 'n', 'x', 'v', '']  # index 5 = Normal (auto)
CLEF_OFFSET_TREBLE = 34  # (3+1)*7 + 6 = 34 (B above middle C)

FLAT_MASK = {
    0: '', 2: 'Bb', 18: 'Bb,Eb', 19: 'Bb,Eb,Ab',
    27: 'Bb,Eb,Ab,Db', 91: 'Bb,Eb,Ab,Db,Gb',
    95: 'Bb,Eb,Ab,Db,Gb,Cb', 127: 'Bb,Eb,Ab,Db,Gb,Cb,Fb',
}
SHARP_MASK = {
    0: '', 32: 'F#', 36: 'F#,C#', 100: 'F#,C#,G#',
    108: 'F#,C#,G#,D#', 109: 'F#,C#,G#,D#,A#',
    125: 'F#,C#,G#,D#,A#,E#', 127: 'F#,C#,G#,D#,A#,E#,B#',
}

KEY_FLAT_NAMES = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']
KEY_SHARP_NAMES = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']


def key_string_to_code(key_str):
    """'Bb,Eb,Ab,Db' → '4b', 'F#,C#,G#' → '3#'"""
    if not key_str:
        return 'C'
    parts = [p for p in key_str.split(',') if p]
    if not parts:
        return 'C'
    if 'b' in parts[0]:
        return f'{len(parts)}b'
    elif '#' in parts[0]:
        return f'{len(parts)}#'
    return 'C'


# ── Pitch 변환 ───────────────────────────────────────

def raw_to_pitch(raw_byte):
    """NWC raw position byte → (name, octave) e.g. ('E', 4)"""
    pos = (256 - raw_byte) if raw_byte > 127 else (-raw_byte)
    p = pos + CLEF_OFFSET_TREBLE
    name = PITCH_NAMES[p % 7]
    octave = p // 7
    return name, octave


def raw_to_pitch_str(raw_byte):
    """NWC raw position byte → 'E4' 형태 문자열"""
    name, octave = raw_to_pitch(raw_byte)
    return f'{name}{octave}'


# ── NWC 파일 파서 ────────────────────────────────────

class NWCFile:
    """NWC 바이너리 파일에서 메타데이터, 가사, 음표를 추출"""

    def __init__(self, filepath):
        raw = Path(filepath).read_bytes()
        if raw[:5] == b'[NWZ]':
            self.data = zlib.decompress(raw[6:])
        else:
            self.data = raw
        self.filepath = filepath

        # 파싱 결과
        self.title = ''
        self.composer = ''
        self.key_code = ''
        self.time_sig = ''
        self.lyrics_lines = []  # [ [syllable, ...], ... ] 절별
        self.notes = []         # [ {pitch, dur, dots, tie, acc}, ... ]

    # ── 1. 헤더 ──

    def parse_header(self):
        data = self.data
        assert data[:20] == b'[NoteWorthy ArtWare]', 'Not a valid NWC file'
        self.version_raw = struct.unpack_from('<H', data, 45)[0]

        # 제목: 0x4c 고정, 작곡가: 바로 뒤
        title_end = data.index(0, 0x4c)
        self.title = data[0x4c:title_end].decode('euc-kr', errors='replace')
        composer_start = title_end + 1
        composer_end = data.index(0, composer_start)
        self.composer = data[composer_start:composer_end].decode('ascii', errors='replace')

    # ── 2. Staff 경계 ──

    def _staff_boundaries(self):
        positions = []
        for marker in [b'Staff-1\x00', b'Staff-2\x00', b'Staff-3\x00']:
            idx = self.data.find(marker)
            if idx >= 0:
                positions.append(idx)
        if len(positions) < 2:
            positions.append(len(self.data))
        return positions

    # ── 3. 가사 (패턴 기반) ──

    def parse_lyrics(self, start, end):
        """Staff-1 영역에서 4-byte EUC-KR 음절 블록들을 추출"""
        data = self.data
        lines = []
        i = start
        while i < end - 4:
            b1, b2, b3 = data[i + 1], data[i + 2], data[i + 3]
            if 0xB0 <= b1 <= 0xC8 and 0xA1 <= b2 <= 0xFE and b3 == 0x00:
                syllables = self._read_syllables(i, end)
                if len(syllables) >= 3:
                    lines.append(syllables)
                    i += len(syllables) * 4
                    continue
            i += 1
        self.lyrics_lines = lines

    def _read_syllables(self, start, end):
        data = self.data
        syllables = []
        i = start
        while i + 3 <= end:
            b1, b2, b3 = data[i + 1], data[i + 2], data[i + 3]
            if 0xA1 <= b1 and 0xA1 <= b2 and b3 == 0x00:
                try:
                    syllables.append(bytes([b1, b2]).decode('euc-kr'))
                    i += 4
                    continue
                except UnicodeDecodeError:
                    pass
            break
        return syllables

    # ── 4. 박자표 ──

    def _find_time_sig(self, start, end):
        """마지막 긴 0x00 패딩 뒤의 TimeSig(05 00) 패턴 탐색"""
        data = self.data
        last_padding_end = None
        zero_run = 0
        for i in range(start, end):
            if data[i] == 0x00:
                zero_run += 1
            else:
                if zero_run >= 100:
                    last_padding_end = i
                zero_run = 0

        if last_padding_end is None:
            return

        for j in range(last_padding_end, min(last_padding_end + 80, end - 10)):
            if data[j] == 0x05 and data[j + 1] == 0x00 and data[j + 2] in (0x00, 0x01):
                num = struct.unpack_from('<H', data, j + 3)[0]
                bits = struct.unpack_from('<H', data, j + 5)[0]
                if 1 <= num <= 12 and 0 <= bits <= 4:
                    self.time_sig = f'{num}/{1 << bits}'
                    return

    # ── 5. 조표 ──

    def _find_key_sig(self, start, end):
        """KeySig(01 00) 패턴에서 flat/sharp bitmap 추출"""
        data = self.data
        # TimeSig 뒤 근처에서 KeySig 탐색
        for i in range(start, min(start + 200, end - 15)):
            if data[i] == 0x01 and data[i + 1] == 0x00 and data[i + 2] in (0x00, 0x01):
                flats = data[i + 3]
                sharps = data[i + 5]
                key_str = FLAT_MASK.get(flats, '') or SHARP_MASK.get(sharps, '')
                if key_str:
                    self.key_code = key_string_to_code(key_str)
                    return

    # ── 6. 음표 (패턴 기반) ──

    def parse_notes(self, start, end):
        """
        Staff-1 소프라노(멜로디) 파트만 추출.

        SATB 찬송가에서 Staff-1 = SA (소프라노+알토).
        소프라노 note: attr2 = 0x0d (accidental=Normal(5), bit3=1)
        알토 및 기타: 다른 attr2 값

        같은 시간 위치의 다중 성부는 바이트 offset 차이 ≤ 13으로 구분.
        첫 번째 성부(offset gap > 13)만 소프라노로 채택.

        가사 line1의 음절 수만큼만 잘라서 가사-음표 1:1 대응을 보장한다.
        """
        data = self.data
        # 1단계: attr2=0x0d인 모든 음표 수집
        raw_notes = []
        for i in range(start + 6, end - 3):
            if data[i + 1] != 0x0d or data[i + 2] != 0x00 or data[i + 3] != 0x00:
                continue
            dur_byte = data[i - 6]
            dur_idx = dur_byte & 0x0F
            if dur_idx >= 7:
                continue

            pitch_str = raw_to_pitch_str(data[i])
            dur = DURATION_CODES[dur_idx]
            attr1_0 = data[i - 2]
            if attr1_0 & 0x01:
                dur += '..'
            elif attr1_0 & 0x04:
                dur += '.'
            tie = bool(attr1_0 & 0x10)
            triplet = bool(data[i - 4] & 0x0C)

            raw_notes.append({
                'pitch': pitch_str,
                'dur': dur,
                'tie': tie,
                'triplet': triplet,
                'offset': i,
            })

        # 2단계: 소프라노만 분리 (gap > 13)
        soprano = []
        for idx, note in enumerate(raw_notes):
            if idx > 0 and note['offset'] - raw_notes[idx - 1]['offset'] <= 13:
                continue  # 같은 시간 위치의 알토 → skip
            soprano.append(note)

        # 3단계: 가사 음절 수만큼 잘라서 대응
        if self.lyrics_lines:
            max_syllables = max(len(line) for line in self.lyrics_lines)
            self.notes = soprano[:max_syllables]
        else:
            self.notes = soprano

    # ── 전체 파싱 ──

    def parse(self):
        self.parse_header()
        staffs = self._staff_boundaries()
        s1_start, s1_end = staffs[0], staffs[1]

        self.parse_lyrics(s1_start, s1_end)
        self._find_time_sig(s1_start + 50, s1_end)

        # 조표: TimeSig 위치 근처에서 탐색
        note_area_start = s1_start + (s1_end - s1_start) // 3
        self._find_key_sig(note_area_start, s1_end)

        self.parse_notes(note_area_start, s1_end)

    # ── 출력 ──

    def summary(self):
        print(f'  Title:    {self.title}')
        print(f'  Composer: {self.composer}')
        print(f'  Key:      {self.key_code}')
        print(f'  Time:     {self.time_sig}')
        total_syl = sum(len(l) for l in self.lyrics_lines)
        print(f'  Lyrics:   {len(self.lyrics_lines)} line(s), {total_syl} syllables')
        for i, line in enumerate(self.lyrics_lines):
            text = ''.join(line)
            preview = text[:40] + ('...' if len(text) > 40 else '')
            print(f'    [{i + 1}] ({len(line)}) {preview}')
        dur_dist = Counter(n['dur'] for n in self.notes)
        print(f'  Notes:    {len(self.notes)} - {dict(dur_dist)}')
        if self.notes:
            sample = ' '.join(
                f"{n['pitch']}({n['dur']})" for n in self.notes[:12]
            )
            print(f'    {sample} ...')


# ── CLI ──────────────────────────────────────────────

if __name__ == '__main__':
    if len(sys.argv) > 1:
        test_files = sys.argv[1:]
    else:
        test_files = [
            'sample/nwc찬송/ncc001.nwc',
            'sample/nwc찬송/ncc046.nwc',
            'sample/nwc찬송/ncc072.nwc',
            'sample/nwc찬송/ncc100.nwc',
            'sample/nwc찬송/ncc200.nwc',
        ]

    for filepath in test_files:
        if not os.path.exists(filepath):
            print(f'[SKIP] {filepath}')
            continue
        print(f'\n=== {os.path.basename(filepath)} ===')
        try:
            nwc = NWCFile(filepath)
            nwc.parse()
            nwc.summary()
        except Exception as e:
            print(f'  [ERROR] {e}')
            import traceback
            traceback.print_exc()
