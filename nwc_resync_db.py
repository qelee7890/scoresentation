"""
NWC 원본을 기준으로 data/scoresentation.db의 곡 데이터를 재동기화.

- pitch/duration: NWC 원본 그대로 (v2 변환 제거)
- 슬라이드 구조: 기존 DB의 절/줄 개수는 보존
- 가사: NWC 가사로 보강 (하이픈 포함)
- 후렴: DB의 chorus 텍스트가 있으면 그 글자 시퀀스를 NWC line1에서 역탐색해 분리
- key_signature, time_signature: NWC에 값이 있으면 교체, 없으면 유지
- pitchLabelVersion 필드 제거

사용법:
  python nwc_resync_db.py                  # dry-run (변경 요약만)
  python nwc_resync_db.py --write          # 백업 후 실제 DB 업데이트
  python nwc_resync_db.py 94 72            # 특정 번호만 dry-run
  python nwc_resync_db.py --write 94       # 특정 번호만 실제 업데이트
"""
import json, os, re, shutil, sqlite3, subprocess, sys, time
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent
DB_PATH = ROOT / 'data' / 'scoresentation.db'
NWC_DIR = ROOT / 'sample' / 'nwc찬송'
BRIDGE = ROOT / 'nwc_bridge.mjs'


def parse_nwc(nwc_path):
    proc = subprocess.run(['node', str(BRIDGE), str(nwc_path)],
                          capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f'bridge failed: {proc.stderr.decode("utf-8","replace")}')
    return json.loads(proc.stdout.decode('utf-8'))


def _note_to_json(n):
    """NWC note dict → JSON note dict. accidental/beamGroup 부착."""
    out = {'pitch': n['pitch'], 'duration': n['dur']}
    if n.get('accidental'):
        out['accidental'] = n['accidental']
    if n.get('beamGroup') is not None:
        out['beamGroup'] = n['beamGroup']
    return out


def assign_beam_groups(melody, base_id=0):
    """beam='beg'/'mid'/'end' 정보를 beamGroup 정수 ID로 변환 (in-place)."""
    current = None
    next_id = base_id
    for n in melody:
        b = n.get('beam')
        if b == 'beg':
            current = next_id
            next_id += 1
            n['beamGroup'] = current
        elif b in ('mid', 'end') and current is not None:
            n['beamGroup'] = current
            if b == 'end':
                current = None
        else:
            n['beamGroup'] = None
            current = None
    return next_id


def strip_nonword(s):
    """한국어/영문자만 남김 (하이픈/공백/구두점, <br/> 태그 제거)."""
    if not s:
        return ''
    s = re.sub(r'<br\s*/?>', '', s, flags=re.IGNORECASE)
    return re.sub(r'[^\w가-힣]', '', s, flags=re.UNICODE)


def nwc_token_text(tok):
    """' 예'→'예', ' -'→''. 절 번호 prefix '1.' 도 제거."""
    s = tok or ''
    s = re.sub(r'^\s*\d+\.', '', s)  # prefix 먼저 제거
    return strip_nonword(s)


def build_char_stream(tokens):
    """NWC 토큰 배열 → (char, token_index) 시퀀스. 하이픈/공백 제외."""
    stream = []
    for i, tok in enumerate(tokens):
        for ch in nwc_token_text(tok):
            stream.append((ch, i))
    return stream


def find_chorus_start(line1_tokens, db_chorus_text):
    """DB 후렴 글자 시퀀스가 NWC line1 어디서부터 시작하는지 토큰 인덱스 반환.
    실패 시 None."""
    if not db_chorus_text:
        return None
    target = strip_nonword(db_chorus_text)
    if not target:
        return None
    stream = build_char_stream(line1_tokens)
    src = ''.join(c for c, _ in stream)
    # 뒤쪽부터 일치 지점 탐색 (후렴이 보통 곡 뒷부분)
    idx = src.rfind(target)
    if idx < 0:
        # 앞부분 10자 이상만이라도 매칭 시도
        probe = target[:min(10, len(target))]
        idx = src.rfind(probe) if len(probe) >= 4 else -1
        if idx < 0:
            return None
    # idx 글자가 속한 토큰 인덱스
    return stream[idx][1]


def distribute_to_lines(tokens_span, melody_span, db_korean_lines):
    """주어진 NWC 토큰/멜로디 구간을 DB의 줄별 한국어 텍스트에 맞춰 분배.

    반환: per_line = [(tokens_list, notes_list), ...]
    전략: DB 각 줄의 글자 수대로 NWC 토큰을 글자 기준으로 잘라낸다.
         매칭 안 되면 비율 폴백.
    """
    n_lines = len(db_korean_lines)
    if n_lines == 0:
        return []
    if n_lines == 1:
        return [(list(tokens_span), list(melody_span))]

    # 각 DB 줄의 글자 수
    db_line_chars = [strip_nonword(re.sub(r'<br\s*/?>', '', ln)) for ln in db_korean_lines]
    stream = build_char_stream(tokens_span)
    total_chars = len(stream)

    result = []
    cursor = 0  # stream index
    tok_used = 0
    for li, line_chars in enumerate(db_line_chars):
        n_chars = len(line_chars)
        if cursor >= total_chars:
            result.append(([], []))
            continue
        if li == n_lines - 1:
            # 남은 거 다 할당
            end_idx = total_chars
        else:
            end_idx = min(cursor + n_chars, total_chars)
        if end_idx <= cursor:
            result.append(([], []))
            continue
        first_tok = stream[cursor][1]
        last_tok = stream[end_idx - 1][1]
        # 토큰 경계까지 포함
        tok_start = first_tok
        tok_end = last_tok + 1
        # 이전 줄이 먹어버린 토큰 이후부터 시작하도록 보정
        if tok_start < tok_used:
            tok_start = tok_used
        if tok_end < tok_start:
            tok_end = tok_start
        line_tokens = list(tokens_span[tok_start:tok_end])
        line_notes = list(melody_span[tok_start:tok_end])
        result.append((line_tokens, line_notes))
        tok_used = tok_end
        cursor = end_idx

    # 마지막 줄이 토큰을 다 못 먹었으면 남은 것 붙이기
    if tok_used < len(tokens_span) and result:
        extra_tok = list(tokens_span[tok_used:])
        extra_notes = list(melody_span[tok_used:])
        lt, ln = result[-1]
        result[-1] = (lt + extra_tok, ln + extra_notes)

    return result


def strip_parens_from_tokens(tokens):
    """괄호 내부 문자만 제거. (cleaned_tokens, drop_indices) 반환.
    cleaned 후 공백만 남는 토큰 인덱스를 drop에 포함."""
    cleaned = []
    drop = set()
    in_paren = False
    for i, tok in enumerate(tokens):
        s = tok or ''
        out_chars = []
        for ch in s:
            if in_paren:
                if ch == ')':
                    in_paren = False
                continue
            if ch == '(':
                in_paren = True
                continue
            out_chars.append(ch)
        cleaned_tok = ''.join(out_chars)
        if not cleaned_tok.strip():
            drop.add(i)
            cleaned.append('')
        else:
            cleaned.append(cleaned_tok)
    return cleaned, drop


class LineFormatState:
    """여러 줄에 걸친 char_idx 누적용 상태."""
    def __init__(self, db_full_text):
        db_clean = re.sub(r'<br\s*/?>', '', db_full_text or '')
        self.words = [w for w in db_clean.split() if w and not set(w) <= set('-–—')]
        self.char_word = []
        for wi, w in enumerate(self.words):
            self.char_word.extend([wi] * len(w))
        self.char_idx = 0


def parse_tokens_to_items(tokens, state):
    """토큰 → items. state.char_idx, state.char_word 참조/갱신."""
    items = []
    for tok in tokens:
        txt = (tok or '').strip()
        txt = re.sub(r'^\s*\d+\.', '', txt).strip()
        if not txt:
            continue
        if set(txt) <= set('-–—'):
            items.append(('hyp', '-', None))
            continue
        core = re.sub(r'[-–—]', '', txt)
        if core:
            if state.char_idx < len(state.char_word):
                wi = state.char_word[state.char_idx]
            else:
                wi = ('extra', state.char_idx)
            items.append(('syl', core, wi))
            state.char_idx += len(core)
    return items


def emit_items(items, prev_word):
    """items 리스트 → (출력 문자열, 마지막 word_idx).
    단어 경계 공백, 단어 내 하이픈 붙여쓰기 적용."""
    out = []
    for i, (kind, txt, wi) in enumerate(items):
        if kind == 'syl':
            if out and wi != prev_word:
                out.append(' ')
            out.append(txt)
            prev_word = wi
        else:
            next_word = None
            for j in range(i + 1, len(items)):
                if items[j][0] == 'syl':
                    next_word = items[j][2]
                    break
            same_word = (prev_word is not None and next_word is not None
                         and prev_word == next_word)
            if same_word:
                out.append('-')
            else:
                if out and not out[-1].endswith(' '):
                    out.append(' ')
                out.append('-')
                out.append(' ')
    text = ''.join(out)
    return re.sub(r' +', ' ', text).strip(), prev_word


    if not tokens:
        return ''
    state = LineFormatState(db_line_text)
    items = parse_tokens_to_items(tokens, state)
    text, _ = emit_items(items, None)
    return text


def notes_from_tokens(tokens_span, melody_span, line_tokens):
    """line_tokens 각각에 대응하는 melody 항목을 line_notes로 변환."""
    # 인덱스는 이미 distribute_to_lines에서 맞춘 상태. 그대로 반환.
    out = []
    for n in melody_span:
        out.append({'pitch': n['pitch'], 'duration': n['dur']})
    return out


def build_slide(db_slide, line_tokens_notes):
    """DB 슬라이드의 줄 구조를 유지하며 새 가사/음표로 교체.

    db_slide: {'korean': [...], 'english': [...]?} style is verse/chorus 전체 슬라이드의 일부
    실제로는 per-slide가 아니라 notes 배열이 슬라이드별이라 상위에서 조합.
    """
    pass


def resync_hymn(num, db_row, nwc_data):
    """한 곡 재동기화. 반환: (new_payload, report_dict) 또는 (None, error_msg)."""
    title, new_num, composer, ksig_db, tsig_db, payload_json, _ = db_row
    try:
        data = json.loads(payload_json)
    except Exception as e:
        return None, f'invalid hymn_json: {e}'

    melody = nwc_data.get('melody') or []
    lyrics_lines_raw = nwc_data.get('lyrics') or []
    bar_at = list(nwc_data.get('barAt') or [])
    if not melody or not lyrics_lines_raw:
        return None, 'nwc melody/lyrics empty'

    # NWC beam 마커 → beamGroup 정수 ID
    assign_beam_groups(melody)

    # melisma(슬러 중/끝, 타이 끝) 음표 위치에 하이픈 토큰 삽입하여 lyrics-melody 1:1 정렬.
    # NWC는 melisma 음표에 가사를 붙이지 않아서 lyrics 길이가 melody 길이보다 짧음.
    melisma_positions = [i for i, n in enumerate(melody) if n.get('melisma')]
    if melisma_positions:
        new_lyrics = []
        for ln in lyrics_lines_raw:
            line = list(ln)
            for mi in sorted(melisma_positions):
                if mi <= len(line):
                    line.insert(mi, ' -')
            new_lyrics.append(line)
        lyrics_lines_raw = new_lyrics

    # 괄호 내부 문자 제거. 각 라인마다 독립적으로 cleanup → line0 기준 drop 인덱스로
    # 전체 라인/멜로디 동기 필터링.
    cleaned_line0, drop = strip_parens_from_tokens(lyrics_lines_raw[0])
    # 다른 라인도 문자 단위로 cleanup (cross-verse paren이 라인마다 조금씩 다를 수 있음)
    cleaned_other = []
    for ln in lyrics_lines_raw[1:]:
        c, _ = strip_parens_from_tokens(ln)
        cleaned_other.append(c)
    lyrics_lines_raw = [cleaned_line0] + cleaned_other

    if drop:
        keep = [i for i in range(len(lyrics_lines_raw[0])) if i not in drop]
        # 바라인 인덱스 재매핑: drop된 인덱스만큼 차감
        drop_sorted = sorted(drop)
        def _remap(b):
            from bisect import bisect_left
            return b - bisect_left(drop_sorted, b)
        bar_at = [_remap(b) for b in bar_at]
        melody = [melody[i] for i in keep if i < len(melody)]
        lyrics_lines_raw = [[ln[i] for i in keep if i < len(ln)] for ln in lyrics_lines_raw]

    # 후렴 감지는 raw 가사 줄 길이로 수행 (pad 전)
    lyrics_lines = [list(ln) for ln in lyrics_lines_raw]
    raw_lengths = [len(ln) for ln in lyrics_lines]
    raw_len0 = raw_lengths[0]
    raw_len1 = raw_lengths[1] if len(lyrics_lines) >= 2 else raw_len0

    verses_db = data.get('verses') or {}
    chorus_db = data.get('chorus') or None
    has_db_chorus = bool(chorus_db and isinstance(chorus_db, dict)
                         and (chorus_db.get('korean') or chorus_db.get('notes')))

    # 후렴 분리 인덱스 결정: DB에 chorus 필드가 있을 때만
    chorus_start_idx = None
    if has_db_chorus:
        chorus_text = ''
        korean = chorus_db.get('korean')
        if isinstance(korean, list):
            chorus_text = ''.join(korean)
        elif isinstance(korean, str):
            chorus_text = korean
        # 1순위: 가사 줄 길이 차이 (line1이 line0보다 짧으면 verse-only임)
        if raw_len0 > raw_len1:
            chorus_start_idx = raw_len1
        else:
            # 2순위: DB 후렴 텍스트를 line0에서 검색
            chorus_start_idx = find_chorus_start(lyrics_lines[0], chorus_text)

    # no-chorus는 melody 끝까지 verse로 사용
    if chorus_start_idx is None or chorus_start_idx >= raw_len0:
        chorus_start_idx = len(melody)

    # melody tail(가사 없는 종결음) 대응: 가사 줄을 melody 길이로 pad
    for li in range(len(lyrics_lines)):
        if len(lyrics_lines[li]) < len(melody):
            lyrics_lines[li].extend([' '] * (len(melody) - len(lyrics_lines[li])))

    # 멜로디는 line1 토큰과 1:1 대응 (같은 길이)
    if len(melody) != len(lyrics_lines[0]):
        # 드문 경우, 어긋나면 경고만
        pass

    verse_token_end = chorus_start_idx
    verse_melody = melody[:verse_token_end]
    verse_tokens_l1 = lyrics_lines[0][:verse_token_end]
    chorus_melody = melody[verse_token_end:]
    chorus_tokens = lyrics_lines[0][verse_token_end:]

    new_verses = {}
    # 절 번호 정렬
    verse_keys = sorted(verses_db.keys(), key=lambda k: int(k) if k.isdigit() else 0)

    # 바라인 기반 줄/슬라이드 경계 계산 (공통)
    # range_start, range_end: melody(note)/lyric 인덱스 구간
    def compute_line_breaks(range_start, range_end, bars_per_line=4, lines_per_slide=3):
        """구간 내 바라인 위치로 줄 경계 생성. (line_spans, slide_breaks)
        line_spans: [(start_idx, end_idx), ...] each 한 줄 범위.
        slide_breaks: 몇 번째 줄에서 슬라이드가 바뀌는지 (예: [3,6] = 3,6번째 줄 이후 새 슬라이드)."""
        bars_in_range = [b for b in bar_at if range_start < b < range_end]
        # 줄 경계: 매 bars_per_line마다
        breaks = [bars_in_range[i] for i in range(bars_per_line - 1, len(bars_in_range), bars_per_line)]
        spans = []
        prev = range_start
        for b in breaks:
            spans.append((prev, b))
            prev = b
        spans.append((prev, range_end))
        # 슬라이드 경계: 매 lines_per_slide 줄마다
        return spans

    def build_slides(spans, tokens, notes_arr, db_text, lines_per_slide=2):
        """spans에 따라 줄별 (korean, notes) 생성 후 슬라이드로 그룹화.
        전체 items를 먼저 구성하고 span 경계에서 분할 — 줄 경계의 하이픈 표기 일관성 확보."""
        if not spans:
            return [], []
        state = LineFormatState(db_text)
        # 전체 items를 먼저 만들되, 각 item이 어느 token 인덱스에서 나왔는지 기록
        all_items = []  # (kind, txt, wi, tok_idx)
        for ti, tok in enumerate(tokens):
            sub = parse_tokens_to_items([tok], state)
            for it in sub:
                all_items.append(it + (ti,))
        # span별로 items 분할
        line_items = []
        for (s, e) in spans:
            line_items.append([it[:3] for it in all_items if s <= it[3] < e])
        # 전체 컨텍스트에서 emit (prev_word, next_syl 찾기 위해)
        prev_word = None
        line_texts = []
        for li, items in enumerate(line_items):
            # 다음 줄의 첫 syl을 참고해 마지막 하이픈 처리용 sentinel 추가
            next_syl_word = None
            for j in range(li + 1, len(line_items)):
                for it in line_items[j]:
                    if it[0] == 'syl':
                        next_syl_word = it[2]
                        break
                if next_syl_word is not None:
                    break
            extended = items + ([('syl', '', next_syl_word)] if next_syl_word is not None else [])
            text, prev_word = emit_items(extended, prev_word)
            # sentinel 은 길이 0이라 text에 영향 없음
            line_texts.append(text)
        # 줄별 notes 추출
        line_notes_list = []
        for (s, e) in spans:
            line_notes_list.append([_note_to_json(n) for n in notes_arr[s:e]])
        # 빈 줄(텍스트 없고 음표도 없는 끝자락) 제거. 음표만 있고 텍스트 없으면 직전 줄과 병합
        filtered_texts = []
        filtered_notes = []
        for txt, notes in zip(line_texts, line_notes_list):
            if not txt and not notes:
                continue
            if not txt and filtered_notes:
                # 가사가 비어있지만 음표는 있으면 이전 줄의 음표 리스트에 붙여 무음 꼬리로 포함
                filtered_notes[-1].extend(notes)
                continue
            filtered_texts.append(txt)
            filtered_notes.append(notes)
        # 슬라이드 그룹화
        slides_korean = []
        slides_notes = []
        for i in range(0, len(filtered_texts), lines_per_slide):
            chunk_texts = filtered_texts[i:i + lines_per_slide]
            chunk_notes = filtered_notes[i:i + lines_per_slide]
            slides_korean.append('<br/>'.join(chunk_texts))
            sn = {}
            for li, ns in enumerate(chunk_notes):
                sn[str(li)] = ns
            slides_notes.append(sn)
        return slides_korean, slides_notes

    for vkey in verse_keys:
        v = verses_db[vkey] or {}
        db_korean = v.get('korean') or []
        db_english = v.get('english')

        try:
            line_i = int(vkey) - 1
        except Exception:
            line_i = 0
        # 토큰 구성: N절(N>=2)은 line_{N-1} 사용, 없으면 line0 prefix
        if line_i == 0:
            v_tokens = list(lyrics_lines[0][:verse_token_end])
        elif 0 < line_i < len(lyrics_lines):
            raw_len = raw_lengths[line_i]
            v_tokens = list(lyrics_lines[line_i][:min(raw_len, verse_token_end)])
            if len(v_tokens) < verse_token_end:
                v_tokens.extend(lyrics_lines[0][len(v_tokens):verse_token_end])
        else:
            v_tokens = list(lyrics_lines[0][:verse_token_end])

        v_notes = melody[:verse_token_end]
        # DB 전체 가사(슬라이드 구분 합치기) — 단어 경계 참조용
        db_full = ' '.join(re.sub(r'<br\s*/?>', ' ', s or '') for s in db_korean)
        spans = compute_line_breaks(0, verse_token_end)
        slides_k, slides_n = build_slides(spans, v_tokens, v_notes, db_full)

        new_v = dict(v)
        new_v['korean'] = slides_k
        new_v['notes'] = slides_n
        if db_english is not None:
            new_v['english'] = db_english
        new_verses[vkey] = new_v

    # 후렴 처리
    new_chorus = None
    if chorus_db and chorus_melody:
        db_korean = chorus_db.get('korean') or []
        db_english = chorus_db.get('english')
        db_full = ' '.join(re.sub(r'<br\s*/?>', ' ', s or '') for s in db_korean)
        spans = compute_line_breaks(verse_token_end, len(melody))
        # chorus_tokens은 line0의 tail, chorus_melody도 동일 range
        # spans는 melody/token 인덱스 기준이므로 chorus용 인덱스로 변환 (빼주기)
        chorus_spans = [(s - verse_token_end, e - verse_token_end) for (s, e) in spans]
        slides_k, slides_n = build_slides(chorus_spans, chorus_tokens, chorus_melody, db_full)
        new_chorus = dict(chorus_db)
        new_chorus['korean'] = slides_k
        new_chorus['notes'] = slides_n

    # 최종 payload
    new_data = dict(data)
    new_data['verses'] = new_verses
    if new_chorus is not None:
        new_data['chorus'] = new_chorus
    elif 'chorus' in new_data and not chorus_db:
        pass  # leave as-is (None/absent)
    # pitchLabelVersion 제거
    new_data.pop('pitchLabelVersion', None)

    # keySig / timeSig은 원본 DB 값을 그대로 보존 (NWC 파싱값이 부정확한 경우가 있음)
    new_ksig = ksig_db
    new_tsig = tsig_db
    # hymn_json 내부의 key/timeSignature 필드도 DB 값으로 맞춰둠
    if ksig_db:
        new_data['key'] = ksig_db
    if tsig_db:
        new_data['timeSignature'] = tsig_db

    # 통계
    db_verse_note_total = 0
    for vk, vv in verses_db.items():
        for slide in vv.get('notes') or []:
            for _, ns in slide.items():
                db_verse_note_total += sum(1 for n in ns if n)
    new_verse_note_total = 0
    for vk, vv in new_verses.items():
        for slide in vv.get('notes') or []:
            for _, ns in slide.items():
                new_verse_note_total += sum(1 for n in ns if n)

    report = {
        'num': num,
        'title': title,
        'verses': len(new_verses),
        'chorus': bool(new_chorus),
        'nwc_melody_count': len(melody),
        'chorus_split': chorus_start_idx,
        'db_note_total': db_verse_note_total,
        'new_note_total': new_verse_note_total,
        'keySig': new_ksig,
        'timeSig': new_tsig,
    }
    return (new_ksig, new_tsig, new_data), report


def main():
    argv = sys.argv[1:]
    write_mode = '--write' in argv
    argv = [a for a in argv if a != '--write']
    target_nums = argv if argv else None

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    rows = cur.execute(
        'SELECT number, title, new_number, composer, key_signature, time_signature, hymn_json, updated_at '
        'FROM saved_hymns'
    ).fetchall()

    targets = []
    for r in rows:
        num = r[0]
        if target_nums and num not in target_nums:
            continue
        try:
            intnum = int(num)
        except Exception:
            continue
        nwc_path = NWC_DIR / f'ncc{intnum:03d}.nwc'
        if not nwc_path.exists():
            continue
        targets.append((num, nwc_path, r))

    print(f'대상 곡: {len(targets)}곡')
    results = []
    failed = []
    for num, nwc_path, row in targets:
        try:
            nwc = parse_nwc(nwc_path)
        except Exception as e:
            failed.append((num, f'parse: {e}'))
            continue
        try:
            out, report = resync_hymn(num, row[1:], nwc)
        except Exception as e:
            failed.append((num, f'resync: {e}'))
            continue
        if out is None:
            failed.append((num, report))
            continue
        results.append((num, out, report))

    # 변경 요약
    print(f'성공: {len(results)}곡, 실패: {len(failed)}곡')
    if failed:
        print('\n== 실패 목록(최대 20개) ==')
        for n, msg in failed[:20]:
            print(f'  {n}: {msg}')

    # 음표 수 변화가 큰 곡 TOP 10
    diffs = sorted(results, key=lambda x: abs(x[2]['new_note_total'] - x[2]['db_note_total']), reverse=True)
    print('\n== 음표 수 변화 TOP 10 ==')
    for num, _, rep in diffs[:10]:
        print(f'  {num:>3} {rep["title"][:18]:<18} verses={rep["verses"]} chorus={rep["chorus"]} '
              f'DB={rep["db_note_total"]} → NEW={rep["new_note_total"]} '
              f'(nwc_melody={rep["nwc_melody_count"]}, split={rep["chorus_split"]})')

    if not write_mode:
        print('\n(--write 없이 실행됨. DB 변경 없음)')
        return

    # 백업
    backup_path = DB_PATH.with_suffix(f'.db.bak.{int(time.time())}')
    shutil.copy2(DB_PATH, backup_path)
    print(f'\n백업: {backup_path.name}')

    # 실제 업데이트
    for num, (ksig, tsig, payload), _ in results:
        cur.execute(
            'UPDATE saved_hymns SET key_signature=?, time_signature=?, hymn_json=?, updated_at=? WHERE number=?',
            (ksig, tsig, json.dumps(payload, ensure_ascii=False), int(time.time()), num)
        )
    conn.commit()
    print(f'DB 업데이트 완료: {len(results)}곡')


if __name__ == '__main__':
    main()
