# SPEC-LYRICS-001 연구 보고서 (research.md)

- **작성일**: 2026-07-11
- **기준 체크아웃**: `scoresentation` 브랜치 `pre-spanish` (커밋 `aa43aab`, v1.5.9)
- **조사 저장소**: scoresentation(데스크톱), koscriber-soniox(송출), scoresentation-mobile(모바일 뷰어·v2 코퍼스), praise-spanish(저작 스테이징)
- **경로 표기 약어**: `[S]` = `C:/Users/qelee/scoresentation`, `[M]` = `C:/Users/qelee/scoresentation-mobile`, `[K]` = `C:/Users/qelee/koscriber-soniox`, `[P]` = `C:/Users/qelee/praise-spanish`, `[U]` = `%APPDATA%/Scoresentation/data` (= `C:/Users/qelee/AppData/Roaming/Scoresentation/data`)

---

## 1. 개요 및 연구 범위

### 1.1 배경과 설계 방침 (백지 재설계 결정)

SPEC-LYRICS-001은 scoresentation의 다국어(한-서) 가사 기능을 **백지에서 재설계**한다. 사용자 확정 사항:

- **기존 v1.7.0 스페인어 구현(`Section.spanish[]` + `Note.syllable`)과 anchored 레이아웃 정책은 설계 입력이 아니다.** 본 보고서에서는 §8.4의 레거시 데이터 처분 대상으로만 다룬다. (참고: 옛 정책 이력 중 "natural+justify" 방식은 사용자가 명시적으로 거부했고 재시도 금지 — 프로젝트 메모리.)
- **koscriber-soniox의 찬양 슬라이드 구조가 유일한 설계 기준 모델**이다 (§2, §3).
- **현행 v1.5.9 찬송가 DB의 한글 가사 규약**(아멘 슬라이드, 멜리스마 하이픈, 슬라이드 세그멘테이션, dot→hyphen)은 **유효한 설계 입력**으로 유지한다 (§6.6).

### 1.2 핵심 발견: "koscriber의 슬라이드 구조"의 실체

koscriber-soniox 자체에는 악보 렌더러도 찬양 데이터도 **없다**. 찬양 슬라이드의 실체는 형제 저장소 **`[M]/web/`**(정적 뷰어 + `songs/*.json` 573곡)이며, koscriber는 이것을 `/hymn/`으로 정적 서빙하고 WebSocket `state.hymn`으로 릴레이하는 **운영/송출 껍데기**다 (`[K]/backend/main.py:3059-3082`, `HYMN_WEB_DIR` 기본값 `../scoresentation-mobile/web` = `main.py:3063`; `[K]/docs/찬양모드_구현내역_2026-07-02.md:16-31`). 따라서 "설계 기준 모델" = **scoresentation-mobile의 v2 음절-음표 모델**이다.

```
[scoresentation 데스크톱(Electron)]  NWC → data/scoresentation.db (v1 hymn_json, 560곡)
        │ [M]/tools/migrate_to_v2.py  (읽기전용 baseline → v2 음절 1급 모델)
[scoresentation-mobile]  data/scoresentation_v2.db (saved_hymns_v2, 573곡 — 단일 권위)
        │ [M]/tools/export_songs.py
        web/songs/0001..0573.json + index.json  ← 곡당 정적 JSON 1파일
        │ fetch ([M]/web/js/viewer.js)
        HTML+CSS+인라인 SVG 렌더 (notes-minimal.js: SMuFL/Bravura)
        │ ?embed=1&pane=ko|es (iframe)
[koscriber-soniox]  presenter ♪패널 → state.hymn={song,line,lang} → /ws/state → 회중 viewer.html iframe
```

### 1.3 버전 지형 (기준 브랜치 판단 자료)

| 브랜치/커밋 | 버전 | 상태 | 본 SPEC에서의 지위 |
|---|---|---|---|
| `pre-spanish` = `aa43aab` | v1.5.9 | 현 체크아웃. 스페인어 코드·데이터 전무, baseline 560곡 | **재설계 기준 코드베이스** |
| `origin/main` = `97ce633` | v1.7.0 | 배포된 최신 릴리스(`dist/latest.yml` 2026-06-28), baseline 565곡·ES 13곡 | 설계 입력 제외(레거시 데이터 계보로만 참조) |
| 로컬 `main` = `37880b4` | v1.7.1 | **미푸시·미태그·미배포**. 그러나 이 PC에서 실행됨(user DB `app_meta` v2 스탬프 2026-07-02) — baseline 565곡·ES 15곡 | 이 PC 런타임 실체. 원격 부재라 커밋 해시로만 참조 가능 |
| `[M]` v2 코퍼스 | schemaVersion 2 | 573곡, 2026-07-03 최종 갱신 | **가사·음표 데이터의 단일 권위이자 설계 기준 모델** |

중간 이력: `1c22c01`(experiment) → `c56692a`(v1.6.0 스페인어 병기) → `9ca5b32`(v1.6.1 마이그레이션 v1) → `97ce633`(v1.7.0 anchored) → `37880b4`(v1.7.1 로컬 전용).

### 1.4 연구 범위

5개 병렬 조사(koscriber 슬라이드 구조 / koscriber DB / scoresentation 뷰어 / scoresentation 편집기 / 교차 매핑·동기화)와 4개 갭 조사(v1.7.x 실체, pitch 라벨 의미 판정, 슬라이드 재그룹 결정성 전수 검증, MVP-plan 편집 시맨틱·json-format2 규약)를 통합했다. DB 실측은 전부 Python `sqlite3` read-only로 수행했다.

---

## 2. koscriber-soniox 찬양 악보 슬라이드 구조 (설계 기준 모델)

### 2.1 렌더링 방식 — HTML + CSS + 음절별 인라인 SVG (canvas/이미지 아님)

의존성 0의 바닐라 JS. 한 곡 전체를 세로 스크롤 "무대"에 줄(line) 단위로 그리고, 현재 줄만 확대(loupe)·음표·오선을 표시한다.

- **DOM 구조**: `renderStage()`가 줄마다 `.line` → (절 첫 줄이면 `.verse-pill`) → `.word`(단어 묶음, 내부 줄바꿈 금지) → `.syl`(음절) → `.surface`(가사 텍스트) + `.note`(음절 위 절대배치 SVG)를 생성 — `[M]/web/js/viewer.js:166-197`, `itemSpan` `viewer.js:120-143`.
- **음표 = 음절당 미니 인라인 SVG**: `MiniNotes.syllableNotes(glyphs)`가 SMuFL 글리프(Bravura)를 `<text>`로 합성 — notehead(`E0A2/E0A3/E0A4`), 기둥 `<line>`, 꼬리(`E240~E243`), 임시표(`E260/E261/E262`), 점음표(`E1E7`), 페르마타(`E4C0`) — `[M]/web/js/notes-minimal.js:12-20,105-152`.
- **절대 음높이 좌표**: `PITCH` 맵(A3=6 … D6=−2.5; 오선 5선 = F5/D5/B4/G4/E4)을 고정 좌표 `yLine(pos)=LINE0(5.55)+pos·LS(3.78)`에 배치, 오선 밖 음은 덧줄(ledger) 자동 — `notes-minimal.js:32-35,61-77,118-120`. 2026-07-02 커밋 `782b1eb`에서 반칸(한 음정) 상향 오류가 정정된 상태(`notes-minimal.js:30-31`; 상세는 §7.7).
- **오선은 SVG가 아닌 CSS 배경**: `.staff`가 `linear-gradient` 5줄(18.5/31.1/43.7/56.3/68.9%) — `[M]/web/css/viewer.css:167-176`. `positionStaff()`가 현재 줄의 `.note`들을 `getBoundingClientRect()`로 물리 행(wrap된 행)별 클러스터링해 행마다 오선 1개를 음표 합집합 박스에 맞춰 삽입(loupe scale `/s` 보정 포함) — `viewer.js:304-334`. **오선은 현재 줄에만** 표시(`viewer.css:127`).
- **조표**: `parseKey("2#"/"4b"/"Bb")` → `keySignature()`가 표준 위치(플랫 B♭4·E♭5…/샵 F♯5·C♯5…)에 글리프 SVG를 만들어 오선 첫 행 왼쪽에 부착 — `notes-minimal.js:161-192`, `viewer.js:318-325`.
- **돋보기(loupe)/포커스**: 전 줄을 base 폰트로 두고 `transform: scale`(중앙 창=1.0, 외곽=0.7, smoothstep ramp)만 스크롤 프레임마다 갱신 → reflow 0 — `viewer.js:239-253`. 현재 줄만 `line-height:3`(음표 2em 공간, `viewer.css:123`).
- **진행 순서(navOrder)**: 문서는 자연순(1·2·3절·후렴 각 1회)으로 렌더하되, 후렴이 있으면 이동 순서만 `1절→후렴→2절→후렴…`으로 인터리브(같은 후렴 줄 인덱스 반복 참조) — `flatten()` `viewer.js:29-56`.
- **폰트 4종 self-host**: Bravura(음표) / Freesentation(한글) / NotoSansCondensed latin+latinext(ES·EN, unicode-range 분리) — `viewer.css:4-30`.

### 2.2 곡 데이터 포맷 (전 필드 — 573곡 전수 실측)

파일: `[M]/web/songs/<0001..0573>.json`(export 순번 4자리 id, `[M]/tools/export_songs.py:40-46`). 목록: `web/songs/index.json` = `{count, songs:[{id, number, title, category, hasEs, hasNotes, lines, verses, warnings}]}` (`export_songs.py:69-79`). ※ **id는 export 순번이라 곡 추가 시 밀리는 불안정 키 — `number`가 안정 키** (`[K]/docs/찬양모드_구현내역_2026-07-02.md:132`).

**곡(top-level)** — 573곡 전부 동일 키 셋:

| 필드 | 의미 |
|---|---|
| `schemaVersion:2, rev, updatedAt` | 스키마 버전·편집 리비전·시각 |
| `id, number, newNumber` | id=export 순번, number=구 찬송가 번호 또는 곡명(PK), newNumber=새찬송가 번호 |
| `title, composer` | 제목·작곡 |
| `category` | `"hymn"`(558곡) \| `"song"`(CCM 15곡) |
| `key`, `timeSignature` | 조표(`"4b"/"3#"/"Bb"`, 악보 없으면 `""`)·박자(전곡 "4/4" 또는 "") |
| `sections[]` | 아래 |
| `_provenance` | `{migratedFrom:"v1", sourceHash:"sha256:…", warningCount}` |

**Section**(2,330개): `{kind:"verse"(2,058)|"chorus"(272), label:"1"|"후렴", lines[], altLanguages:{en:[{lineId,text,syllables:[]}]}}` — **영어는 줄 단위 텍스트만, 음표 미결속**(뷰어 미표시, M7 과제).

**Line**(7,433개): `{id:"s1.0", textOnly:bool, syllables[]}` — `textOnly:true`면 음표 없는 가사 전용(예: 0568 '왕이 나셨다', notes 빈 채 KO/ES 병기). ※ line id의 정확한 의미는 §8.3.

**Syllable**(92,619개) — **음절이 1급 단위**:

| 필드 | 값·분포(실측) | 의미 |
|---|---|---|
| `surface` | `{ko, es, en}` | 다국어 병기 슬롯. ko=한글 1글자, es=그 음표 슬롯이 쥔 스페인어 조각(다글자·null·공백 포함 가능), en=항상 null |
| `wordBoundary` | start 31,150 / mid 22,824 / end 31,143 / standalone 7,429 / continuation 73 | **KO 단어 경계**(원본 공백 위치 보존) |
| `wbEs` | start 1,749 / mid 1,727 (hasEs 곡에만, 3,476개) | **ES 단어 경계**(언어별 별도; end/standalone 미사용, 부재 시 뷰어가 mid 취급 `viewer.js:68-70`) |
| `leadSpace` | bool | 파생값(단어 시작 && 줄 첫 음절 아님). **뷰어 미소비** — wordBoundary/wbEs로 재계산 |
| `melisma` | bool | notes.length>1 표식. **뷰어 미소비**(글리프 수로 판정) |
| `continuation` | 음절 73개(71개 줄) | 앞 줄에서 넘어온 멜리스마(표면 `ko:""`, 음표만) |
| `koJoinPrev` 1,194 / `koJoinNext` 10 / `esJoinNext` 4 | 수동 v2 주석 | **언어별 줄바꿈 재배치**(렌더 전용): KO 음절을 앞 줄로 당김/다음 줄로 밀기/ES 전방결합어 밀기 — `effSyllables()` `viewer.js:152-163`. 마이그레이션 미생성, 수기 QC 산물(§8.1) |
| `notes[]` | 101,224개 | 아래 |

**Note**: `{pitch:"C4".."G5"(null 0건), dur:"q"47,147|"8"32,503|"h"14,808|"16"5,681|"w"1,085, dotted:bool, accidental:null|sharp(583)|natural(675)|flat(182), beamGroup:int|null(최대 25 — 뷰어는 빔 미렌더), fermata:bool(코퍼스 1곳)}`. 멜리스마 최대 1음절 22음표(125장 '영').

**실 예시 — 0190 "샘물과 같은 보혈은" 1절 첫 줄** (`[M]/web/songs/0190.json`):

```
ko '샘' es "Hay u"  wb start wbEs mid  melisma  notes [C4:8, E4:8]   ← ES 한 슬롯에 두 단어(공백 포함)
ko '물' es "na"     wb mid   wbEs mid           notes [G4:q.]
ko '과' es "fuen"   wb end   wbEs start         notes [A4:8]        ← ES 단어 "fuente" 시작
ko '같' es "te"     wb start wbEs mid  lead     notes [G4:q]
ko '은' es "sin"    wb end   wbEs start         notes [C5:q]
ko '임' es "sangre" wb start wbEs start melisma notes [C4:8, E4:8]  ← ES 1단어 : KO 1음절 : 2음표
ko '로' es null     wb end                      notes [C4:8]        ← es=null → 앞 ES 음절에 병합 렌더
```

### 2.3 저장 데이터 → 화면 파이프라인

1. **권위 DB**: `[M]/data/scoresentation_v2.db` 단일 테이블 `saved_hymns_v2` (스키마는 §3.2).
2. **export**: `[M]/tools/export_songs.py` — 숫자 number 우선 정렬 → 4자리 순번 id 부여 → `_provenance.warnings` 본문 제거(개수만) → `web/songs/NNNN.json` + `index.json`(`hasEs`/`hasNotes` 파생 집계, `export_songs.py:54-67`).
3. **서빙**: `[K]/backend/main.py:3063` `HYMN_WEB_DIR`를 `/hymn/{path}`로 서빙(traversal 가드 `relative_to`, `Cache-Control: no-cache` ETag 재검증 — `main.py:3072-3082`).
4. **로드**: `viewer.js loadSong()` `fetch("songs/<id>.json")` → `flatten()`(lines+navOrder) → `renderStage()` → 음절별 SVG → `focusByNav()` 중앙 스크롤 → `positionStaff()` — `viewer.js:469-501`.
5. **송출**: presenter `stateSnapshot()`에 `...(hymnState ? {hymn: hymnState} : {})` (`[K]/frontend/index.html:2233-2244`) → `/ws/state` WS 무검증 릴레이 + 인메모리 `latest_state` + 25초 하트비트 재전송(`main.py:3290-3330`) → 회중 `viewer.html`의 `applyHymn()`.

### 2.4 찬양 모드(찬송가 모드) 운영 흐름

**정의**: 찬양 시간에 presenter가 회중 폰(스트리밍 뷰어)에 찬송가 가사+음표 뷰어를 전면에 띄우는 기능. 설교/통역 파이프라인 무변경 — `state.hymn` 필드 하나만 추가(필드 없으면 원상 복귀, 하위호환) — `[K]/docs/찬양모드_구현내역_2026-07-02.md:16-31`.

- **활성화**: 컨트롤 바 ♪ 버튼(`[K]/frontend/index.html:840`) → 찬양 패널 + **마이크 자동 일시정지**(`hymnPauseMic`, `index.html:2282-2287`) → 검색(번호 정확→접두→제목 부분, `es` 입력=스페인어 보유 23곡 전체, `index.html:2291-2305`) → 곡 선택 = 송출 시작(`hymnOpenSong` `index.html:2366-2375`): `hymnState={song,line:0,lang:'ko'}` + 미리보기 iframe `/hymn/index.html?embed=1&theme=dark&song=…` + `publishState()`.
- **위치 정본**: 미리보기 뷰어가 이동 시 보고하는 `{kosHymnPos:{song,line,total,lang,follow}}`를 받아 `hymnState` 갱신·재송출(`index.html:2388-2392`). **절 매크로**: 숫자키 1–9=N절, 0=후렴 → `{section:{kind,num}}` postMessage, 절→navPos 변환은 뷰어가 수행(`index.html:2420-2432`, `jumpSection` `viewer.js:380-394`).
- **회중 표시**(`[K]/frontend/viewer.html:483-577`): `state.hymn` 수신 시 `#hymn-wrap`(z-index 30)에 iframe 1~2개. 언어·배치는 그 사용자의 ASR 레이아웃(`viewerUi.effectiveLayoutMode()`)이 결정 — 단독=1패널, 2단=두 언어 병기(`?pane=ko|es` 고정 패널; ES 없는 곡의 ES 패널은 빈 화면 — `viewer.js:483-485`). 같은 곡이면 postMessage로 절만 동기(재로드 없음, `viewer.html:548-550`). 자유 스크롤 이탈은 존중, '현재 위치' 버튼만 `force:true` 강제 복귀(`viewer.html:566-570`, `viewer.js:454-459`). 종료 시 `hymn` 필드 제거 → iframe 해제(`viewer.html:516-528`).
- **임베드 계약**(mobile 측, `viewer.js:422-466,511-524`): `?embed=1`(부모 postMessage 구동) · `?pane=ko|es`(컨트롤 숨김+언어 고정) · `?theme=dark|light` · `?song=&line=&lang=&n=`. 같은 오리진만 신뢰. lang은 부모 값이 '바뀔 때만' 반영(회중 로컬 토글 존중).
- **장애 대비**: `[M]/web/fallback/찬양_fallback.html` — 폰트·렌더러·데이터 내장 단일 자립 파일(2.9MB), 프로젝터 file:// 실행, 숫자 절 매크로 지원(`[M]/tools/build_fallback_html.py:1-11`).

### 2.5 관련 문서 (신규 편집기 설계 시 필독)

- `[K]/docs/찬양모드_구현내역_2026-07-02.md` — 찬양 모드 단일 인수인계 문서(아키텍처, postMessage/URL 계약, 운영, 제약). 2026-07-04 main 병합·실전 검증 완료.
- `[M]/docs/lyric-rules.md` — **가사 규칙 단일 명세**: v1 hymn_json 구조, 멜리스마 하이픈, dot→hyphen, 아멘, ES `~`/`‿`, 결함 게이트(전수 실측 수치).
- `[M]/docs/HANDOFF.md` — v2 데이터 모델 요약(§3), 뷰어 함정·피드백 27차 누적(§4), 재빌드 체인(§8.6).
- `[M]/docs/MVP-plan.md` — v1 역공학(§2.1), v2 스키마 원문(§2.3), wordBoundary 마이그레이션 의사코드(§2.4), 편집 서버 설계(§6, §5.7 참조).
- `[M]/docs/codebase-analysis.md` — 3-repo 생태계, "**v2 스키마는 뷰어의 상위집합**" 통찰(§6): `leadSpace`/`melisma`/`beamGroup`/`altLanguages.en`은 데이터에 있으나 뷰어 미소비.
- `[M]/docs/lyric-linebreak-audit.md` — `<br/>` 오분할 전수조사(676건/258곡)와 `koJoinPrev` 일괄 적용 방법론.
- `[M]/docs/praise-spanish-audit.md` — ES 반영 QC 이력·수기 절차(§3.8).

---

## 3. koscriber-soniox 찬양 DB (스키마·식별자·읽기/쓰기 경로)

### 3.1 데이터 실체 — 2단 구조

| 계층 | 경로 | 크기/규모 | 성격 |
|---|---|---|---|
| **권위 소스(단일 정본)** | `[M]/data/scoresentation_v2.db` | 23.9MB, mtime 2026-07-03, git 추적 | SQLite `saved_hymns_v2` 573행 |
| **파생 산출물(뷰어용)** | `[M]/web/songs/` | 574파일(~23.3MB) | `export_songs.py`가 재생성 |
| (신규 ES곡 원본 스테이징) | `[P]/docs/json-format2/` | 22개 json (찬송가 10 + CCM 12) | v1 형식 정본, git 아님 |

데스크톱 `[S]/data/scoresentation.db`(v1, 560행)가 이 v2 DB의 마이그레이션 원본이었고, 이후 v2 쪽에만 대규모 품질 수정 + 신곡이 누적됐다. **데스크톱 앱은 현재 이 v2 DB를 전혀 읽지 않는다** — 완전히 별개 데이터 계보이며, import 방향은 **v2(573곡, ES 23곡) → scoresentation 데스크톱**이다.

### 3.2 스키마 (Python sqlite3 원문 덤프)

```sql
CREATE TABLE saved_hymns_v2 (
            number         TEXT PRIMARY KEY,
            title          TEXT NOT NULL DEFAULT '',
            new_number     TEXT NOT NULL DEFAULT '',
            composer       TEXT NOT NULL DEFAULT '',
            key_signature  TEXT NOT NULL DEFAULT '',
            time_signature TEXT NOT NULL DEFAULT '',
            category       TEXT NOT NULL DEFAULT '',
            schema_version INTEGER NOT NULL DEFAULT 2,
            rev            INTEGER NOT NULL DEFAULT 1,
            warning_count  INTEGER NOT NULL DEFAULT 0,
            source_hash    TEXT NOT NULL DEFAULT '',
            migrated_at    TEXT NOT NULL DEFAULT '',
            doc_json       TEXT NOT NULL
        )
```

인덱스는 PK 자동 인덱스뿐, 전 573행 `schema_version=2`. 데스크톱 v1 테이블(§6.2)과의 차이: v1은 `hymn_json`(verses/chorus, `<br/>` 줄, duration 접미 `.`) / v2는 `doc_json`(음절 1급 통합 모델) + `category`/`rev`/`source_hash`/`warning_count` 메타.

`doc_json` 구조는 §2.2와 동일(뷰어 JSON은 doc_json에서 `_provenance.warnings` 본문만 제거한 원본 그대로 — `export_songs.py:43-67`, line id 보존). 실제 예 (495번 '내 영혼이 은총 입어' 첫 음절):

```json
{ "surface": {"ko": "내", "es": "Fue", "en": null},
  "wordBoundary": "standalone", "leadSpace": false, "melisma": false,
  "notes": [{"pitch": "E4", "dur": "8", "dotted": false, "accidental": null,
             "beamGroup": null, "fermata": false}],
  "wbEs": "mid" }
```

스키마 문서: `[M]/docs/HANDOFF.md:89-115`(§3), 상세 `[M]/docs/MVP-plan.md` §2.3.

### 3.3 곡 수·분류·식별자

- **총 573곡** = `category='hymn'` 558곡(통일찬송가 1~558, `number`=숫자 문자열) + `category='song'` 15곡(CCM, **`number`=제목 그대로**).
- CCM 중 중복 의심 1쌍: `'score-축복의 사람'` / `'축복의 사람'` — **데스크톱 v1 baseline에도 동일하게 둘 다 존재**(560 = 558 + 2)해서 승계된 것.
- 식별자 2중 체계: DB PK = `number`(안정 키) vs export `id` = 4자리 순번(`export_songs.py:24-25,41-42`) — 곡 추가 시 밀리는 불안정 키. koscriber 방송 프로토콜 `state.hymn.song`이 이 id를 사용(`[K]/frontend/index.html:2369`).

### 3.4 언어 보유 현황

- **ko**: 573곡 전부.
- **es**: 스키마상 모든 음절에 `surface.es` 슬롯이 있으므로 키 존재≠보유. **비어있지 않은 es는 정확히 23곡**(export `hasEs`와 일치, `export_songs.py:55-60`):
  - 통일찬송가 10곡: **184, 190, 204, 340, 404, 411, 465, 487, 495, 502**
  - CCM 13곡: 송축해 내 영혼 · 십자가 열쇠 · 돈으로도 못가요 · 고난 당한 구세주 · 주 예수 나의 산 소망 · 주님 계신 교회 · 야곱의 축복 · 꽃들도 · 은혜 · 주의 이름 높이며 · 살아계신 주 · 싹트네 · **왕이 나셨다**(악보 없음 → textOnly, ES는 창작 가창역)
  - ES는 음절 단위로 음표에 결속(`surface.es` + `wbEs` + `esJoinNext`). QC 이력: `[M]/docs/praise-spanish-audit.md:1-66`(23곡 전량 완료).
- **en**: `surface.en`은 전 코퍼스 0건. 영어는 `sections[].altLanguages.en`에 텍스트 줄만(음표 미결속, `{lineId,text,syllables:[]}`) **215곡/947섹션** 존재 — M7 과제(`HANDOFF.md:177`, R2).

### 3.5 읽기 경로 (hymn mode)

§2.3~2.4에 통합 서술. 요약: `[K]/backend/main.py:3063,3072-3082`(마운트) → presenter `fetch('/hymn/songs/index.json')`(`[K]/frontend/index.html:2273`) → 곡 선택·iframe·WS 송출 → 회중 `viewer.html:431-432,483-499` → 본체 `[M]/web/js/viewer.js:556,470,479-486` → fallback `[M]/web/fallback/찬양_fallback.html`.

### 3.6 쓰기·갱신·변환 도구 (`[M]/tools/`)

- **`migrate_to_v2.py`** (31KB): v1 baseline → v2 전량 변환. baseline은 read-only 원칙(`migrate_to_v2.py:15`), 표준 sqlite3만 사용(:16). **재마이그레이션하면 v2에 직접 가한 수동 주석(koJoinPrev·재띄어쓰기 등)이 소실** — v2가 단일 권위(`migrate_to_v2.py:7-8`, `HANDOFF.md:206`).
- **`import_praise_songs.py`**: `[P]` json-format2(v1 형식 정본) → `migrate_row` 재사용 → `saved_hymns_v2` 멱등 upsert(ON CONFLICT 시 `rev+1`, `import_praise_songs.py:76-89`) + ES 공백 자동 게이트(audit→fix→재검, :93-126) + `PRAGMA wal_checkpoint(TRUNCATE)`(:123). dry-run 기본, `--write`로 기록.
- **`export_songs.py`**: v2 DB → `web/songs/*.json` + `index.json`(읽기 전용 접속 `mode=ro`, :34).
- 보조 DQ 도구 7종: `audit_es_spacing.py`/`fix_es_spacing.py`, `apply_textonly_es.py`, `apply_respace.py` 등 (`HANDOFF.md:55-63`).
- **공식 재빌드 체인**(`HANDOFF.md:209`): `import_praise_songs.py --write` → `export_songs.py` → `build_review_html.py` → `build_review_pdf.py` → `build_fallback_html.py` → `node tools/test_notes_minimal.mjs`.
- **v2 → v1(데스크톱) 역변환 도구는 존재하지 않음**(전 tools/ 확인).

### 3.7 json-format2 저작 포맷과 import QC 게이트 (22파일 실측)

**파일 구조**: 두 가지 래핑 — 찬송가 10곡은 flat(`{number,newNumber,title,key,timeSignature,composer,verses,chorus}`), CCM 12곡은 제목 키 래핑(`{"살아계신 주": {id,title,category,…}}`) — `unwrap()`이 흡수(`import_praise_songs.py:32`, `migrate_to_v2.py:59`). CCM은 `number=title`, `category='song'`(`import_praise_songs.py:8,:53`). 섹션은 v1 형식 그대로: `{korean:[슬라이드…], english:[…], spanish:[…], notes:[슬라이드…]}`, `notes[slideIdx]={"0":[noteObj…],…}`. **noteObj 전부에 저자가 손 정렬한 `syllable`(ES 음절) 보유**(22파일 스캔: syllable 수 == 음표 수; 예외 '왕이 나셨다'는 notes 자체가 없어 textOnly + `apply_textonly_es.py` 별도 경로, `HANDOFF.md:37`).

**마커/규약(실물 확인)**:
- `~` = 단어 내 결합(렌더 시 제거): 예 꽃들도 `"re~ci"` — 희소(2파일 각 1회).
- `‿`(U+203F) = 연음 synalepha(렌더 시 공백): 예 411 `"me‿a"`, 은혜 `"que‿en"` — 널리 사용(파일당 0~16회). 정규화 동치: `~`→'', `‿`→' ' (`migrate_to_v2.py:70-72`).
- `syllable:""` = ES 가사 없는 음표(멜리스마 이월 슬롯; '살아계신 주'에 20개).
- KO 멜리스마 = korean 문자열의 `-`(v1 규약 그대로).
- **spanish 줄 구분 = `<br/>` 확정 규약**(`HANDOFF.md:38` — `/` 구분은 wbEs 정렬 실패). 단 실물엔 legacy `/` 잔존: 190·411은 `/`만, 184·340·465·487은 혼용 — audit의 `words_of()`가 비문자를 공백 취급해 감사는 통과(`audit_es_spacing.py:39-43`)하지만, `derive_word_breaks`는 줄 단위(`BR_RE.split`) 정렬이므로 **신규 저작은 `<br/>`로 KO와 줄 수를 맞춰야** wbEs가 산출된다(`migrate_to_v2.py:323,:340`).

**import QC 게이트 3층**:
1. **곡별 인라인 게이트**(`import_praise_songs.py:59-69`): KO 게이트(글리프==음표수)와 ES 재조립(letter-only) 곡별 출력, 미달 시 `★ 게이트 미통과` 표시(:68-69).
2. **ES 공백 게이트(자동, write 직후)**(:93-126): 곡마다 `audit_es_spacing.scan_song` 감사(:106) → 발견 시 `fix_es_spacing.fix_song` 자동 수정·DB 반영(:110-116) → 재검(:117) → 잔존 시 `sys.exit(1)`로 export 차단(:124-126). 신규 곡은 `audit.SOURCES`에 정본 파일 등록 필요(`audit_es_spacing.py:23-36`, :101-102).
3. **알고리즘**: audit(`audit_es_spacing.py:80-129`) — 렌더 측 `wbEs=='start'` 그룹 결합(:61-77) vs 정본 단어 스트림 소비(:97-113), 정본 없는 곡은 휴리스틱만(:120-125); fix(`fix_es_spacing.py:29-53`) — 정본 단어 스트림에서 letter 수만큼 잘라 `surface.es` 재작성 + `wbEs` 재계산(:51), 줄 경계가 단어를 가르면 SystemExit(:76).

**수기 QC 절차**(`praise-spanish-audit.md:205-213`, 신규 곡 의무): 정본 0-diff 대조(띄어쓰기·대소문자 포함 — letter-only 게이트 불신, :195) → 음절-음표 시그니처 → ES 재파생 → 슬라이드 분절은 원본 `<br/>` 대신 `koJoinPrev`/`esJoinNext`로 자연 문장화(esJoinNext 대상 다음-줄 첫 음절 wbEs를 start로 보정) → v2 DB+web/songs 동시 반영 → 재대조 + 렌더러 단위테스트 30.

### 3.8 데이터 신선도

v2 DB mtime 2026-07-03 09:41 = 마지막 export와 일치, git 커밋됨(작업트리 무변경). 최근 커밋: `fad5bda`(HANDOFF 갱신), `3eecfd7`(495 ES 교체), `782b1eb`(음표 반칸 정정). 미커밋 변경은 fallback 산출물/빌더뿐(곡 데이터 무관).

---

## 4. scoresentation 슬라이드 뷰어 구조 (v1.5.9)

### 4.1 프로세스·창·IPC

- **메인 프로세스**: `[S]/main.js`(445줄, ESM) — DB 리포지토리 초기화(`main.js:418-419`), IPC 핸들러 등록(:421-425), 커스텀 `app://` 프로토콜(:52-81), 자동 업데이트(:341-411). 모듈: `[S]/main/db.js`(better-sqlite3 리포지토리 2종), `[S]/main/media.js`(이미지 관리).
- **preload**: `[S]/preload.cjs` — `contextBridge.exposeInMainWorld("electronAPI", …)`(:3-45). `contextIsolation:true, nodeIntegration:false`(`main.js:91-92`).
- **렌더러**: 단일 페이지 `[S]/src/index.html`이 곧 프레젠테이션 화면. 로드 순서: marked/dompurify/katex → `storage.js` → `setlistStorage.js` → `notes.js` → `presentation.js`(레거시) → `present.js`(실제 컨트롤러) (`src/index.html:320-328`).
- **창 관리 — 발표 전용 창 없음**: 메인 창 하나(1400×900)가 좌측 사이드바(셋리스트 편집)+우측 슬라이드 영역을 겸함(`main.js:85-96`, `src/index.html:13-109`). 발표는 같은 창에서 `requestFullscreen()`(F 키, `present.js:2552-2555`). 듀얼스크린/프로젝터 창 개념 없음.
- **에디터 창**: `window.open("editor.html?song=…")`(`present.js:1207-1209`) → `setWindowOpenHandler`가 `app://` URL이면 새 BrowserWindow(1200×900, 동일 preload) 허용, 외부 URL은 `shell.openExternal`(`main.js:99-117`).
- **닫기 가드**: `app:set-dirty` 통지(`preload.cjs:37`, `main.js:128-131`) → close 시 미저장 경고(`main.js:133-160`), 업데이트 재시작 시 `isQuittingForUpdate` 우회(:136,398).
- **`app://` 프로토콜**(`main.js:52-81`): `/media/*`·`/images/*`는 user 우선+baseline 폴백(`resolveWithBaselineFallback`, :47-50), `/node_modules/*`·`/fonts/*`는 앱 루트, 그 외 `src/`.
- **IPC 채널 전체**: invoke — `hymns:list/get/save/delete`(`main.js:164-193`), `setlists:list/get/create/update/delete/export/import`(:197-273), `media:upload/delete`(:277-300), `images-folders:list/get/sync`(:304-318). send(renderer→main) — `app:set-dirty`(:128). send(main→renderer) — `hymn-saved`/`hymn-deleted` 전 창 브로드캐스트(:177-191); 업데이트 이벤트 `update:*`(:335-408, 수신 `present.js:344-376`). **슬라이드 제어용 IPC는 없다** — 슬라이드 넘김은 100% 렌더러 내부. 웹 폴백: electronAPI 부재 시 `/api/*` HTTP(`tools/server.py`) + `BroadcastChannel("scoresentation")`(`present.js:473-484`).

### 4.2 슬라이드 빌드 (present.js)

- 컨트롤러 `PresentMode`(`present.js:210-2620`). `init()` → `loadSongs()`(전 곡 메모리 로드+초성 포함 검색 인덱스, :447-462, :52-133) → `renderAll()` → `rebuildPresentation()`.
- `buildSlidesForItem(item)`(:2133-2211)이 아이템 타입별 HTML 생성: `score` → `buildSlidesForHymn`, `blank`, `text`(marked+DOMPurify+KaTeX), `media`(이미지 다중), `order`(순서 페이지, :2213-2224).
- `buildSlidesForHymn(hymn)`(:2257-2367): 절 순서대로 `verses[n].korean[i]`(슬라이드 단위 문자열, `<br/>` 줄 구분)를 순회하고 각 절 뒤에 후렴 반복 삽입 → 슬라이드마다:

```
.slide.slide-lyrics > .slide-content >
    .slide-title ( .slide-title-text "133장 (새135장) 제목" + .slide-section-badge "n장/N장" )
    .lyrics-content[.with-notes] >
        .slide-verse-badge ("n절", 절 첫 슬라이드만; 위치는 JS 계산)
        .lyrics-korean[data-has-notes] (가사 HTML)
        .lyrics-english (선택; 4줄→2줄 압축 compactEnglish, :2263-2274)
```

- 악보 표시 여부는 곡 전체에 pitch 있는 음표 존재 여부(`hasRenderableNotes`, :33-45). 프레젠트 모드에 타이틀 슬라이드 없음(레거시 `presentation.js:45-59`에만 존재).
- `rebuildPresentation()`(:2369-2399): 전 슬라이드 HTML을 `#presentation`에 innerHTML로 일괄 주입, `itemStartIndex[itemId]` 기록, `renderAllNotes()` 호출.

### 4.3 악보 레이아웃 엔진 `NotesEngine` (`[S]/src/notes.js`, 701줄)

- **원리**: 가사 텍스트를 정상 렌더한 뒤 **각 글자(음절)의 실제 화면 x 중심을 측정**하고 그 좌표 위에 SVG 오선지+음표를 그린다("음표가 가사를 따라간다").
- `addNotationToLyrics(lyricsElement, notesData, timeSignature, key)`(`notes.js:599-632`): `.lyrics-korean` innerHTML을 `<br>`로 분리 → 음표 있는 줄을 `.lyrics-line-with-notes > (.notation-container + .lyrics-line-text)`로 재구성 → rAF 후 `renderNotations`.
- `measureCharPositions(textElement)`(:661-697): 공백 제외 모든 글자를 `<span class="char-measure">`로 임시 감싸 `getBoundingClientRect()`로 중심 x 수집 후 원복.
- `createLineNotation(chars, notes, charPositions, totalWidth, key, dangling)`(:503-593): SVG 폭 = `totalWidth + clefMargin + keyWidth(+dangling 폭)`, `margin-left: -totalMargin`(:524-526)으로 음자리표/조표는 가사 왼쪽 밖으로 걸치고 음표 x는 `charPositions[i] + totalMargin`(:551)로 글자 중심 정렬. 구성: 오선 `createStaff`(:232-240), 높은음자리표(:210-224), 조표 파싱 `parseKeySignature`(:143-168)+위치 테이블(:78-79), Bravura 글리프(:46-74), `pitchMap` A3~D6(:89-108), `durationMap` w/h/q/8/16+점 `'q.'`(:111-117,253-255), 기둥 방향 B4 기준(:283), 덧줄(:476-497), 임시표(:262-277), 페르마타(:338-351).
- **빔(연결선)**: `note.beamGroup` ID 그룹핑(`collectBeamGroups`, :393-412) → 그룹 음표는 꼬리/기둥 생략하고 `createBeams`가 기울기 있는 폴리곤 빔+기둥을 직접 그림(:418-471), 16분음표는 2중 빔(:460-467). ※ mobile 뷰어는 빔 미렌더 — 격차 지점.
- **dangling**(가사 글자 수 초과 음표, 빨간색 `#d8324c`)은 에디터 전용 — 뷰어 `renderNotations`(:653)는 dangling 인자 없이 호출, `editor.js:2011-2017`만 `{extraNotes}` 전달.
- 간격 보정: 악보 줄 `margin-bottom:-30px`(`notes.css:21-28`), line-height 축소(`notes.css:92-99`).
- **재렌더 정책**: 최초 1회만 `addNotationToLyrics`(DOM 래핑 포함); 슬라이드 전환(`showGlobalSlide`, `present.js:2412-2435`)·줌(`rerenderAllNotations`, :421-437)·테마 토글 시에는 SVG만 `renderNotations` 재호출(래핑 중복 방지 주석 :415-418). 절 뱃지 위치는 JS 계산(`positionVerseBadgeForSlide`, :2437-2462; CSS `presentation.css:215-234`).

### 4.4 찬송가 슬라이드 vs 이미지 슬라이드

- **찬송가**: `.slide.slide-lyrics` — 상단 `.slide-title`(32px×scale) + 카운터 뱃지, 중앙 정렬 가사. 기본 `.slide` 패딩 `6% 1.5% 4%`(`present.css:396-398`); **v1.5.9(커밋 `aa43aab`) = `.slide-lyrics { padding-top: 3% }` 추가**(`present.css:400-404`, `present.js:2346`) — 이미지 슬라이드(`present.css:1446-1450`)와 제목 y 위치 일치용 2줄 변경.
- **이미지**: `.slide.slide-media[data-fit]`(`present.js:2162-2190`) — 제목+뱃지(없으면 생략), `<img>`+하단 캡션(`present.css:1499-1509`). fit 3종: `contain`(:1473-1477)/`cover`(:1479-1491)/`none`(:1493-1497). 출처 2종: 개별 업로드(`media:upload` → `%APPDATA%.../data/media/` + DB `media` 등록, `main.js:277-291`)와 이미지 폴더(`images-folders:sync`, `present.js:1944-1990`, `main/media.js`).
- 배경 이미지: setlist `settings.bgImage` → `--present-bg-image`, blank 제외 전 슬라이드 cover 배경 + `--present-overlay`(`present.js:2557-2575`, `present.css:1562-1605`).

### 4.5 내비게이션·셋리스트 흐름

- 셋리스트 = `items[] {itemId, type: score|blank|text|media|order, payload}`(`present.js:281`, 검증 `main/db.js:220`). 전역 슬라이드 배열로 평탄화 + `itemStartIndex` 점프(`present.js:2380-2389`, `gotoItemFirstSlide` :1273-1277).
- **전환**: 트랜지션 없음 — `.slide { display:none }` / `.active { display:flex }` 토글(`presentation.css:120-140`, `showGlobalSlide` `present.js:2412-2435`).
- **키보드**(`present.js:708-750`): →/Space 다음, ← 이전, +/- 줌, F 전체화면, R 현재 아이템 첫 슬라이드, **1~9 = 해당 절 첫 슬라이드(이미지면 N번째 장), 0 = 현재 절의 후렴 첫 장**(`jumpToVerse` :2489-2537 — 후렴 슬라이드에 `afterVerse`로 소속 절 기록 :2344), Ctrl+Z/Y(스냅샷 100개, :787-830), Ctrl+S. 클릭: 슬라이드 좌/우 절반(:753-758). ※ mobile 절 매크로(§2.4)와 의미 일치 — 진행 순서(절→후렴 인터리브)도 양쪽 모두 파생값으로 저장 안 함(`present.js:2287-2344` ↔ `viewer.js:29-56`).
- 셋리스트 저장: `SetlistStorage` → IPC → `SetlistRepository`(§6.4). JSON 내보내기/들여오기(`main.js:235-272`).
- 곡 실시간 갱신: 에디터 저장 → `hymn-saved` 브로드캐스트 → `forceRefresh` 후 해당 곡 포함 시 재빌드+현재 인덱스 유지(`present.js:487-501`); 삭제 시 셋리스트 자동 제거(:503-520).

### 4.6 스타일·스케일링 모델

- **줌 = 폰트 배율 변수**: `body`에 `--present-scale`(0.5~2.0, localStorage `present-zoom`) 설정(`present.js:404-443`); 타이포그래피 전부 `calc(Npx * var(--present-scale,1))` — 가사 48px, 영문 30px, 제목 32px, 뱃지 18~20px(`presentation.css:174,186,190,221-225,247,256`). 악보도 `staffHeight: 40*scale`로 재렌더(`getNotesTheme`, `present.js:197-204`).
- **뷰포트**: 슬라이드 컨테이너 100%×100vh(`present.css:383-393`), % 패딩 safe area. 가사 폰트는 vw 미사용(고정 px×scale) — 화면 크기 자동 적응 없음. 예외: 텍스트 슬라이드 `clamp(32px,3.8vw,54px)`(`present.css:1414,1421`), `max-width:768px`에서 악보 0.8 축소(`notes.css:102-111`). `.slide-content` `max-width:1200px`(`presentation.css:166-170`)는 프레젠트 모드에서 해제(`present.css:407-409`).
- **테마**: `body.dark` 토글(localStorage `present-theme`) → 배경 #000/가사 #fff(`present.css:1629-1641`), 악보 색 테마 연동(`present.js:197-204`), 토글 시 전체 재빌드(:398-402).
- **폰트**: 가사 'Presentation'(Freesentation-7Bold woff2, `presentation.css:10-15`), 악보 Bravura(`notes.css:4-18`) — `app:///fonts/` 서빙(`main.js:71-72`). 900px 이하 사이드바 상단 접힘(`present.css:1698-1734`).

### 4.7 데이터 플로우: DB row → 슬라이드 DOM

1. baseline `[S]/data/scoresentation.db`(패키징 시 `resources/data`, `main.js:21-24`) `saved_hymns` 560곡(§6.2~6.3).
2. `HymnRepository.getHymn` — tombstone → user DB → baseline(`main/db.js:128-140`); `listHymns` 병합·정렬(:105-126); `_rowToItem`이 `hymn_json` 파싱(:69-83).
3. IPC `hymns:list`(`preload.cjs:5`, `main.js:165-167`).
4. `HymnStorage.init()` → `{songId:{hymn,updatedAt}}` 맵(`storage.js:150-167,207-239`) + 레거시 localStorage 마이그레이션(:169-205).
5. `loadSongs()` → `songMap` + 검색 인덱스(`present.js:447-462`).
6. `buildSlidesForHymn(deepClone(hymn))`(:2136-2138)이 `.slide.slide-lyrics` HTML 생성, `notes: verse.notes[i]` 첨부(:2296-2364).
7. `#presentation.innerHTML = 전체 HTML`(:2391).
8. `renderAllNotes()` → `addNotationToLyrics` → rAF → `measureCharPositions` → `createLineNotation` → `.notation-container.innerHTML = svg`(`present.js:2401-2410`, `notes.js:599-656`).
9. `showGlobalSlide(i)` — `.active` 토글 + 현재 슬라이드 SVG 재측정·재렌더 + 절 뱃지 위치(:2412-2435).

### 4.8 레거시 참고

`src/presentation.js`의 `PresentationEngine`(단일 곡용, 타이틀 슬라이드·N키 악보 토글)은 index.html에 로드는 되나 **인스턴스화되지 않음** — `PresentMode`가 완전 대체, `presentation.css`의 기본 슬라이드 스타일만 실사용. `hymn_json.tempo`는 프레젠트 모드에서 렌더되지 않음.

---

## 5. scoresentation 편집기 현황과 확장 지점

### 5.1 곡(악보·가사) 편집기 — `[S]/src/editor.html` + `editor.js` (5,594줄, 단일 클래스 `HymnEditor`, `editor.js:348`)

**진입점은 셋리스트 악보 아이템의 "편집" 메뉴 단 하나**(`present.js:1204-1219` `handleItemEdit`), 곡 ID는 `?song=` 쿼리(`editor.js:228-242`).

**가사 편집**(contenteditable):
- 한글 줄 = `contenteditable` div(`data-role="korean-line"`, `editor.js:1046-1063`), 영어 줄(:1066-1078).
- 입력 즉시 `handleEditableInput`(:2602)이 `slide.korean` 갱신 + `syncNotesToCurrentText`로 음표 배열 리사이즈. blur 시 trim + `<후렴>` 마커 감지 → 후렴 섹션 이동(:2641, :2678-2694).
- 줄 조작: `Enter`=줄 분할(`splitEditableLine`, :1586), `Ctrl+Enter`=커서 이후 새 슬라이드 분리(:1810), 줄 시작 `Backspace`/줄 끝 `Delete`=인접 줄 병합(:1616/:1647). 진입 `handleEditableKeydown`(:2542).

**음표 편집**(자체 SVG 오선지 직접 조작):
- 빈 오선지 클릭 → 음표 생성(`applyClickAction`, :3689-3719; **:3721-3748은 `return` 뒤 도달 불가 데드코드**).
- 음표 클릭/우클릭 → 인라인 메뉴(길이·점·임시표·연결선·삭제) — `renderNoteContextMenu`(:3966), `handleNoteMenuAction`(:4068), 다중선택 `renderBeamContextMenu`(:4237)/`handleBeamMenuAction`(:4342), 일괄 `applyBeamBulk*`(:4423-4501).
- 드래그: 비선택=음높이, 선택=x이동/일괄 피치(:4569, :4670), 빈 오선지 드래그=범위 다중선택(:3506).
- 키보드: ↑/↓ 피치, ←/→ 칸 이동, `<`/`>` 박자, Delete, Esc(:549-648).
- 빔: `beamGroup` id 부여/해제(:3833, :3867), 8/16분음표만(:3402), 고아 그룹 자동 정리(:4855, :1328).
- 점음표(:4197), 임시표(:4152), 페르마타(:4466), 조표: 클릭 추가(:4742)/더블클릭 삭제(:4759) → `updateHymnKey`(:4775)가 `hymn.key`("4b" 형식) 갱신.

**슬라이드 조작**: 캔버스 우클릭(추가/통합/삭제, :3020, :3075); 복사/붙여넣기(:1779, :1795); `insertSlideAfterCurrent`(:1745)는 `koreanOwner/englishOwner/notesOwner` 배열 직접 splice — **슬라이드는 hymn 데이터의 뷰이며 별도 모델 없음**. 절·후렴 이동(`openSectionMenu` :4916, `moveSlideToSection` :5010), 순서 교체(:5069). 분할 시 음표 맵도 문자 오프셋 기준 분할(`splitNotesForNewSlide` :1368), 통합 시 병합(`mergeNotesMapsConcat` :1427).

**기타**: undo/redo = hymn 전체 deep-clone 스냅샷(최대 120, :2401); JSON textarea 양방향 편집(`editor.html:105-108`, :5510, :5486); JSON 파일 import(:5318 — 즉시 저장; `{id:{…}}` 랩 허용 :5282); 검색(:744). 툴바의 편집모드/점음표/연결선/슬라이드추가/JSON 버튼은 `hidden` 처리(우클릭·인라인 메뉴로 대체, `editor.html:57-64,79,86-87`, `editor.js:431-442`; 편집모드 토글은 키 `e`만, :554-558).

### 5.2 프레젠테이션 창의 편집 기능

- 셋리스트 아이템 5종 추가(`addItemOfType` `present.js:1183`, 메뉴 `index.html:89-95`), 드래그 정렬(:2098), 인라인 메뉴(:1247, `index.html:302-318`).
- 텍스트/순서/이미지 페이지 모달(`index.html:112-140/143-172/219-266`), 배경 이미지(:68-82).
- **"빈 악보" 모달**(`index.html:174-217`, `openScoreModal` `present.js:1512`): 제목/조표/박자/작곡가 + 가사 마크다운(`# 1절`, `---`=슬라이드 구분, `(괄호)`=영어 줄) → `parseLyricsMarkdown`(:1417) → `sectionsToHymn`(:1455)이 **notes가 빈 hymn JSON을 생성**·저장 후 setlist에 추가(:1627). **신곡 생성의 유일한 GUI 경로**(음표는 이후 편집기에서 부착).

### 5.3 편집기 UI 구조

- `editor.html` 레이아웃: `.editor-sidebar`(검색/메타/슬라이드 목록) + `.editor-main`(툴바→상태줄→`#editor-canvas`→JSON textarea→사용법 패널)(`editor.html:12-196`).
- 이벤트 10종을 `#editor-canvas`에 위임(`bindControls`, `editor.js:530-539`); 좌표→대상 판정은 `getTargetFromEvent`(:3180)가 캐시된 `lineEl._layout`으로 계산.
- 렌더 파이프라인: `renderCurrentSlide`(:1022) → `renderAllLines`(:1957) → `renderLine`(:1987): `measureEditorCharPositions`(:2031, 숨김 DOM 글자별 x 측정) → `createRenderableNotes`(:2086) + `computeLineDanglingInfo`(:2097) → `notesEngine.createLineNotation` SVG. 리사이즈/폰트 로드 시 rAF 스로틀(:1964).

### 5.4 영속화 체인 (상세는 §6)

`saveCurrentHymn`(`editor.js:5175`) → `HymnStorage.saveHymn`(`storage.js:292-329`) → `electronAPI.saveHymn`(`preload.cjs:7`) → `ipcMain.handle("hymns:save")`(`main.js:175-182`) → `HymnRepository.saveHymn`(`main/db.js:142-197`, 항상 user DB upsert). 저장 후 `hymn-saved` 브로드캐스트로 프레젠테이션 자동 리빌드. unsaved 가드는 `markDirty`(`editor.js:2415`) → `app:set-dirty`.

### 5.5 음절↔음표 정합성 검증 — soft only

경고 표시만 있고 저장을 막는 하드 검증은 없다.

- `syncNotesToCurrentText`(`editor.js:2742-2771`): 텍스트 변경 시 음표 배열을 새 글자 수로 리사이즈, 초과 음표 중 데이터 있는 것(dangling)은 보존.
- `computeLineDanglingInfo`(:2097-2120): ① 음표 없는 글자 → `.is-dangling` 빨간 강조(`renderLineTextOverlay` :2122-2151); ② 글자 수 초과 음표 → 줄 끝 빨간 음표(`notes.js:569-589`; 설명 `editor.html:138-145`).
- 음표 존재 판정 `hasNoteData = !!(note && note.pitch)`(:306-308); 글자 카운트는 공백/개행 제외(`countNotationChars` :281).
- main 측 검증은 "객체인가 + ID 일치"뿐(`main/db.js:143-150`) — notes 구조·pitch 값 무검증(스키마리스 TEXT).

### 5.6 새 score-slide 편집기의 현실적 플러그인 지점

1. **새 HTML 페이지 = 새 창(최저비용)**: `app://`가 `src/` 임의 파일을 서빙(`main.js:74-77`)하므로 `src/slide-editor.html` 추가 + `window.open`만으로 새 편집기 창이 열림(`setWindowOpenHandler`가 preload 자동 주입, `main.js:99-117`). 창 옵션 분기만 필요 시 핸들러 수정.
2. **UI 진입**: (a) `handleItemEdit`(`present.js:1204-1219`) 분기, (b) `+추가` 드롭다운(`index.html:89-95`)+`addItemOfType`(`present.js:1183-1202`), (c) 기존 툴바(`editor.html:55-89`).
3. **preload/IPC 확장**: `preload.cjs` 메서드 추가 + `main.js`의 `register*Handlers` 패턴(:164,197,277,304) 답습; renderer 저장 추상화는 `storage.js`/`setlistStorage.js`의 이중 백엔드 패턴 복제 가능.
4. **데이터 저장 두 갈래**: 곡 단위 확장이면 `hymn_json`이 스키마리스라 새 필드 추가 후 기존 `hymns:save`/overlay/tombstone 재사용 가능(단 `buildSlides` `editor.js:886`와 `buildSlidesForHymn` `present.js:2257`가 verses/chorus를 하드코딩 → 소비 로직 추가 필요). 새 슬라이드 종류라면 `VALID_ITEM_TYPES`(`main/db.js:220`) + `buildSlidesForItem`(`present.js:2133`) + `renderItemCard`(:2059) + `renderOrderListEntry`(:2226) 4곳 확장.
5. **외부 포맷 변환 전례**: NWC → hymn JSON 파이프라인 `[S]/tools/nwc_to_hymns.py`, `[S]/tools/nwc_resync_db.py`(Python, DB 직접). 임포터는 오프라인 Python 도구 또는 편집기 JSON import(`editor.js:5318`) 두 경로 재사용 가능.
6. **갱신 인프라 무료 재사용**: `hymns:save` → `hymn-saved` 자동 리빌드(`present.js:487-501`), 미저장 가드는 `setDirty` 한 줄.
7. **주의**: baseline DB는 항상 read-only; 스크립트 DB 편집은 Python sqlite3만(CLAUDE.md, ABI). editor.js는 5.6k줄 단일 파일(데드코드 존재) — 새 편집기는 별도 파일 권장.

### 5.7 참고 설계 입력: mobile MVP-plan의 v2 편집기 설계 (M2 — 문서만 있고 미구현)

**SSE 델타 op 5종**(`[M]/docs/MVP-plan.md:477-487`, §6.2) — 편집 흐름: `PUT /api/hymns/{number}`(PRESENTER_TOKEN + `If-Match:<rev>`) → v2 upsert·rev++ → 델타 → viewer SSE(:469-475):

| op | 페이로드 | 클라 적용 |
|---|---|---|
| `note-update` | `{songId, sectionId, lineId, sylId, noteIdx, fields}` | 해당 미니 SVG만 재생성(:481) |
| `syllable-update` | `{…, sylId, surface?, wordBoundary?}` | 음절 span 재렌더 + **leadSpace 재계산**(:482) |
| `syllable-insert`/`syllable-delete` | `{…, lineId, atIndex, syllable?}` | 라인 전체 재렌더(:483) |
| `line-replace` | `{…, lineId, line}` | 라인 교체(재분절 등, :484) |
| `song-replace` | `{songId, rev}` | 전체 곡 재로드 폴백(:485) |

각 델타는 `{baseRev,newRev}` 동반, 불일치 시 전체 재동기화(:487); 충돌은 곡 단위 `If-Match` 낙관적 락+409(:276,:461).

**편집기 설계**(§6.3, :492-516): 개요=미니 SVG + 포커스 라인=기존 `editor.js` 풀-스태프 "정밀 모드"(:494-496). `editor.js` 재사용 매트릭스(:500-507): 음표 조작·키보드는 as-is, undo/redo·저장은 adapt, **char 위치 기반 로직(`measureEditorCharPositions`/`syncNotesToCurrentText`)은 음절 ID 결속으로 rewrite**. 1급 기능(:509-514): 문장 입력→음절 자동분절+수동 보정, 음절별 음표 부착(1:N), KO/ES 병기 편집(EN은 `altLanguages` 별도 트랙), 저장 = v2 정규화→PUT→SSE 델타, **line별 음절수≠음표 그룹수 빨강 경고**. 저장 게이트(§3.2, :297-308). write 보안(§6.4, :518-526).

**편집 시 재산출 파생 필드**:
- `leadSpace` = `(wordBoundary in ('start','standalone')) and (i != 0)` — 2차 패스 산출(`MVP-plan.md:226-231`).
- `dotted` = v1 duration 접미 `.` 분리(`split_dot`, `migrate_to_v2.py:75-92`).
- `wbEs` = `derive_word_breaks(spanish_line, note_arr)`(`migrate_to_v2.py:254-281`) + `attach_es_surface`(:211-239)의 두 규칙: (i) KO 멜리스마 span 내부 단어경계에 공백 직접 삽입(space-drop 원천 차단), (ii) wbEs는 '실제 ES를 쥔 첫 음표'의 break 기준(:222-235, :344-347). ES surface 변경 시 이 규칙으로 재산출 필요.
- 게이트: KO 글리프==음표수(:362-367); ES letter-only 재조립==원문(`ES_REASSEMBLE_MISMATCH`, :352-360) — **letter-only라 띄어쓰기·대소문자 사각지대**(`praise-spanish-audit.md:195`), 공백 포함 대조는 audit_es_spacing 담당.

**★핵심 경고**: `koJoinPrev/koJoinNext/esJoinNext`는 렌더 전용 수동 주석으로 **델타 프로토콜 op 5종에 편집 op가 없다**. 전 코퍼스 누적 444건 + 줄바꿈 오분할 수정 325건(`HANDOFF.md:36`) 등 전부 수기 QC 산물이라, 새 편집기의 `line-replace`/`song-replace`류 저장이 이 표식을 날리면 21~27차 QC 자산이 파괴된다(`HANDOFF.md:136`, `MVP-plan.md:697`). 권위 규약(§2.5, `MVP-plan.md:266-278`): baseline write 금지, v2 단일 권위, 데스크톱 v1 편집 동결(권고) 또는 `reconcile_v1_v2.py` 해시 드리프트 검출 후 수동 재마이그레이션.

---

## 6. scoresentation DB 레이어 (베이스라인/사용자 오버레이)

### 6.1 better-sqlite3 사용 구조

better-sqlite3 import는 앱 코드 중 **`[S]/main/db.js` 단 하나**(`main/db.js:1`). main process에서만 DB를 열고 renderer는 IPC로만 접근.

| DB 파일 | 여는 곳 | 모드 |
|---|---|---|
| `{baseline}/scoresentation.db` | `HymnRepository.baselineDb`(`main/db.js:37`) | **readonly + `query_only=ON`**(:14-24); 없거나 스키마 불일치 시 조용히 null(:60-67) |
| `[U]/scoresentation-user.db` | `HymnRepository.userDb`(:33) | 읽기/쓰기, **WAL**(:34); 스키마는 매 실행 `CREATE TABLE IF NOT EXISTS`(:41-58) |
| `{baseline}/setlists.db` | `SetlistRepository.baselineDb`(:233) | readonly + query_only |
| `[U]/setlists.db` | `SetlistRepository.userDb`(:228-230) | 읽기/쓰기, WAL + `foreign_keys=ON`(:237-271) |

경로: baseline은 패키징 시 `process.resourcesPath/data`, 개발 시 리포 `data/`(`main.js:21-23`); user는 `app.getPath("userData")/data`(:30). 리포지토리 생성은 `app.whenReady()`(:418-419).

**WAL**: 앱 코드에 명시적 `wal_checkpoint` 호출 없음(auto-checkpoint 의존). baseline DB도 WAL 모드인데 readonly로 열어 앱이 checkpoint 불가하며, **패키징 시 `!*.db-shm`, `!*.db-wal` 필터로 WAL 파일 제외**(`package.json:33-44`) → 배포 전 반드시 checkpoint 상태여야 함 — CLAUDE.md "Python 편집 후 `PRAGMA wal_checkpoint(TRUNCATE)`" 규칙의 근거. **ABI 가드**: `tools/check-native-abi.cjs`가 Electron 안에서 better-sqlite3를 검증(:13-29), publish 체인 포함(`package.json:14`).

### 6.2 스키마 원문

**`data/scoresentation.db`** (baseline, 560행 = 통일찬송가 558 + CCM 2):

```sql
CREATE TABLE saved_hymns (
    number TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    new_number TEXT NOT NULL DEFAULT '',
    composer TEXT NOT NULL DEFAULT '',
    key_signature TEXT NOT NULL DEFAULT '',
    time_signature TEXT NOT NULL DEFAULT '',
    hymn_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
```

테이블은 이것 하나(+자동 인덱스). **tombstone 테이블은 baseline에 없다.** user DB에는 동일 `saved_hymns` + `user_tombstones`.

**`data/setlists.db`** (baseline): `setlists(id INTEGER PK AUTOINCREMENT, name, created_at, updated_at, settings)`, `setlist_items(id, setlist_id REFERENCES setlists ON DELETE CASCADE, position, item_type, payload_json)` + 인덱스, `media(id, filename, mime, size, created_at)`. 현재 baseline setlist 1개 — ID `1000000011`(user 영역 ≥10억인 이유: `sync-to-baseline.py`가 user 행을 ID 그대로 복사, `main/db.js:395` 주석). `score` payload는 `{"songId":"94"}` 형태.

**`updated_at` 혼합 포맷 주의**: `nwc_resync_db.py`가 쓴 행은 unix초 문자열(`'1776161500'`, `nwc_resync_db.py:638`), 앱이 쓴 행은 ISO(`utcNowIso()`, `main/db.js:5-7`).

### 6.3 hymn_json 구조 (v1, 실측)

```
{ number, newNumber, title, newTitle, key("4b"/"3#"), timeSignature("4/4"), composer, tempo,
  verses: { "1": { korean: [슬라이드문자열...], english: [""...],
                   notes: [ {"0":[{pitch,duration,accidental?,beamGroup?,fermata?}...], "1":[...]} , ...] },
            "2": {...} },
  chorus: null | { korean:[...], english:[...], notes:[...] } }
```

- `korean[i]` = i번째 슬라이드 텍스트, 내부 줄바꿈 `<br/>`(553/560곡 사용).
- `notes[i]` = 슬라이드의 음표, **줄 인덱스 문자열 키**("0","1") → 음표 배열.
- 음표 배열은 그 줄의 **공백 제외 모든 문자와 인덱스 1:1**(하이픈 포함). 실측: 1장 slide0 line0 "만복의 근원 하나님 온 백성 찬송" 비공백 13자 = notes 13개; 46장 "찬양하-라…"도 하이픈까지 세어 정확 일치. 총 99,384 음표; accidental 1,430 / beamGroup 6,159 / fermata 1. **`syllable`·`spanish` 필드는 pre-spanish 데이터에 0건**(전수 확인).
- CCM 예: `number='축복의 사람'`, `{"id":"축복의 사람","category":"song",…}`.

### 6.4 baseline + user 오버레이 계층화

**찬송가(HymnRepository) — "user가 baseline을 가린다"**:
- `getHymn(number)`(`main/db.js:128-140`): ① tombstone이면 **null** ② user 행 ③ baseline ④ null.
- `listHymns()`(:105-126): user 전체 + (user에 없고 tombstone 아닌) baseline 병합, 숫자 ID 먼저·숫자순.
- `saveHymn()` **항상 user DB upsert**(:170-190), tombstone 선제거(:169). ID 규칙 `hymn.id||hymn.number`, 불일치 시 예외(:145-150).
- `deleteHymn()`(:199-213): user 삭제 + baseline 존재 시 tombstone 기록.
- **앱 업데이트 시** baseline은 통째 교체(`main.js:20` 주석), user DB는 유지 → **user가 한 번이라도 저장한 번호는 이후 baseline 업데이트가 영구히 가려진다**.

**셋리스트(SetlistRepository) — 반대로 "baseline 우선"**: 사용자 ID는 `USER_ID_OFFSET=1e9` 이상(`main/db.js:223,295-309`); `getSetlist`(:392-407)는 baseline에 같은 ID가 있으면 항상 baseline; baseline 편집 시 **copy-on-write로 새 user ID 복제**(:427-443), 삭제 불가(:468-472); 레거시 사본 기동 시 정리(:275-293). item 타입 화이트리스트 `{"score","blank","text","media","order"}`(:220, 검증 :487).

**미디어/이미지**: `app://` 핸들러가 `/media/*`·`/images/*`를 user 우선+baseline 폴백(`main.js:47-50,52-81`); 이미지 폴더도 동명 시 user가 가림(`main/media.js:75-89,91-116`); media 테이블은 user 전용(`main/db.js:493` 주석).

### 6.5 쓰기 경로 전수

**런타임(앱) — 전부 user 영역만**:

| 트리거 | IPC | 최종 쓰기 |
|---|---|---|
| 편집기 저장(`editor.js:518→5182`) | `hymns:save`(`main.js:175-182`) | user `saved_hymns` upsert + tombstone 삭제; `hymn-saved` 브로드캐스트 |
| 곡 삭제(`editor.js:5206`) | `hymns:delete`(:184-192) | user DELETE + tombstone INSERT |
| 셋리스트 CRUD | `setlists:*`(:208-233) | user setlists/items; create·update 후 `cleanupOrphanMediaSafe()`(:214,227) |
| 셋리스트 import/export | (:253-272 / :235-251) | createSetlist(신규 user ID) / DB 쓰기 없음 |
| 이미지 업로드/삭제 | `media:*`(:278-291/:293-300) | `MEDIA_DIR` 파일 + user `media` 행(`main/db.js:495-506`) |
| 이미지 폴더 동기화 | `images-folders:sync`(:315-317) | 임시폴더+rename 원자 교체(`main/media.js:144-193`) |
| 앱 종료 | `window-all-closed`(:436-439) | 고아 media 정리(`main/media.js:195-226`) |
| 레거시 마이그레이션 | `storage.js:169-205` | localStorage 잔존 곡을 DB보다 최신이면 자동 saveHymn — **숨은 쓰기 경로** |

**개발/유지보수 도구 — baseline을 직접 씀**:
- `[S]/tools/server.py`(`npm run server`): 웹 모드 HTTP API — 리포 `data/*.db` 직접 읽고 씀(`server.py:19-20`; upsert :150-191, setlist CRUD :373-443).
- `[S]/tools/sync-to-baseline.py`(`npm run sync-baseline`): user → baseline 병합, tombstone은 baseline 행 삭제로 반영, `INSERT OR REPLACE`(무충돌검사 LWW; `sync-to-baseline.py:51-68,119-151,187-193`).
- `[S]/tools/nwc_resync_db.py`: NWC 원본에서 baseline 560곡 일괄 재작성(`--write` 시 `.db.bak.{ts}` 백업, :629-641).

### 6.6 한글 가사 저장 규약 (유효한 설계 입력)

**(a) 슬라이드 분할(segmentation)**: `korean` = 슬라이드 문자열 배열, 내부 줄 `<br/>`. 생성 규칙: **4마디 = 1줄, 2줄 = 1슬라이드**(`nwc_resync_db.py:392-406` `compute_line_breaks(bars_per_line=4)`, :408-468 `build_slides(lines_per_slide=2)`). 텍스트 편집 마크다운: `# 1절`/`# 후렴`, `---`=슬라이드, `(...)`=english(`present.js:1398-1505`, 역변환 :1550-1583).

**(b) 음표-글자 1:1**: 공백/개행 제외 i번째 문자 ↔ i번째 음표(`notes.js:661-697`, :547-561; 편집기 동일 규칙 `countNotationChars` `editor.js:281-289`).

**(c) 멜리스마 하이픈**: 한 음절이 여러 음이면 `-` 문자가 추가 음표 자리를 차지(하이픈도 비공백 문자라 음표 1개 배정). 실측: 46장 `"목자 같-이"`, `"찬양하-라"`(단어 내부 = 붙여쓰기); 독립 하이픈 토큰은 단어 경계·꼬리음(3장 `"…만물들아 - -"`; 독립 하이픈 줄 1,647개, 하이픈 보유 384곡). 생성 로직: NWC 파싱 시 melisma 위치에 ` -` 토큰 삽입(`nwc_resync_db.py:305-316`), 단어 내/외 구분은 `emit_items`(:233-259). **코드는 하이픈을 특별 취급하지 않음 — 순수 데이터 규약**(src/ 전수 grep 0건).

**(d) 아멘 슬라이드**: 마지막 절 끝 `"아멘"` 단독 슬라이드 + 음표 2개(1장: `notes[1]={"0":[{A4,w},{A4,h.}]}`). 분포: 보유 101곡 중 마지막 절에만 97곡, 전 절 4곡, 후렴 끝 6곡. 규약 확립: 커밋 `b71f482` v1.5.5 "remove repeating standalone 아멘 slides (340/364 + 34 more; keep once at end)". '아멘' 문자열 처리 코드 없음 — 데이터 컨벤션.

**(e) dot→hyphen**: 멜리스마 자리 `.` 오기를 v1.5.5에서 일괄 치환(커밋 `b71f482`, "1461 dots / 97 hymns"). 현재 korean 가사에 `.` 0건 — **규약: 멜리스마 표기는 항상 `-`, `.` 금지**. 후속: `83050ff` v1.5.8 "re-space scattered-syllable hymns (note-safe)"(공백만 재배치, 38곡 363줄).

### 6.7 user DB 실태 (`[U]`, 실측 + 갭 조사 교정)

`scoresentation-user.db`: `saved_hymns` **22행**, `user_tombstones` 0행, **`app_meta` 테이블 2행**(`migration:fix_stale_spanish_overrides_v1/v2`) — 이 체크아웃(v1.5.9) 코드에는 없는 테이블로, 설치 실행된 v1.7.1이 생성(버전 스큐; 로직은 §8.4). `setlists.db`: setlists 3행, items 67행.

22행의 정확한 구성(갭 조사로 확정 — "ES 찬송가 10 + CCM 12" 통설은 부정확):
- **스페인어 보유 15행** = 찬송가 10(184/190/204/340/404/411/465/487/495/502) + CCM 5(고난 당한 구세주, 돈으로도 못가요, 송축해 내 영혼, 십자가 열쇠, 주 예수 나의 산 소망). **15행 전부 로컬 main(v1.7.1) baseline과 JSON 정규화 비교 시 완전 동일**(중복 사본).
- **스페인어 없는 7행** = 꽃들도, 살아계신 주, 싹트네, 야곱의 축복, 은혜, 주님 계신 교회, 주의 이름 높이며 — **어느 baseline에도 없는 순수 사용자 곡**(2026-07-02 편집). **무조건 보존 대상.**

---

## 7. 음절-음표 매핑 모델 비교 (한국어 1:1 vs 외국어 N:1)

### 7.1 v1 (scoresentation 현 체크아웃) — 위치 기반, 암묵적 음절

- 결속 = **순수 위치**: 렌더러가 줄 텍스트의 i번째 비공백 문자 위에 i번째 음표를 그림(`notes.js:547,661-697`). 음절 정체성·ID 없음.
- 멜리스마 = 하이픈 글리프(§6.6c); 줄 걸침 멜리스마 = 줄 선행 하이픈.
- **편집 취약성**: 가사 수정 시 음표 배열을 인덱스 그대로 리사이즈 — 중간 삽입 시 뒤 음표가 전부 밀림(`editor.js:2742-2771`). 초과 음표는 빨간 dangling 보존(`notes.js:569-589`).
- 영어는 `english[]` 병렬 텍스트일 뿐 음표 미결속.

### 7.2 v2 (mobile/koscriber) — 음절 1급, 명시적 결속

- 한국어: 음절이 `notes[]`를 **직접 소유**(1:N). 멜리스마는 하이픈 글리프 대신 `notes.length>1` + `melisma:true`로 정규화(`migrate_to_v2.py:128-151`); 줄 선행 하이픈은 `ko:""`인 **continuation 음절**로 보존(:137-150). 아멘도 별도 분기 없이 같은 규칙(페르마타 보존, `lyric-rules.md:64-66`). 미표기 멜리스마 391줄은 잉여 음표를 마지막 음절에 흡수(`GLYPH_NOTE_MISMATCH` 경고, `lyric-rules.md:43-45`).
- 스페인어: **음표당 다글자 조각**. v1.7-대 데이터의 음표별 `noteObj.syllable`을 KO 음절의 음표 span 단위로 이어붙여 `surface.es`에 저장. 마커 `~`(단어 내 결합, 제거)/`‿`(synalepha 연음, 공백 치환) — `format_syllable`(`migrate_to_v2.py:70-72`; 실측 `~` 5, `‿` 105; `lyric-rules.md:70-79`). span 내부 단어 경계는 `derive_word_breaks`로 원문에 정렬해 공백 복원(:211-239, :254-281). ES 단어 시작 = `wbEs`(KO와 독립).
- 뷰어 렌더 규칙(`[M]/web/js/viewer.js`): 언어별 표면 선택·KO 폴백 금지(:64-74); **es=null 음절의 음표는 앞 ES 음절에 멜리스마 병합**(추가 `-`, 예 "Emanuel--", :78-90); 멜리스마 = 음표별 셀 `.mn`(첫 셀=가사, 이후=늘임표 `-`, `itemSpan` :126-134); **표면에 공백 있으면(1음절 2단어) 늘임표 대신 음표를 균등 분산**(`spreadNoteInto`, :104-114,135-137); 단어 묶음은 언어별(`toWords` :91-100, `viewer.css:144`); 언어별 줄바꿈 재배치 `effSyllables`(:152-163).
- 영어: `altLanguages.en` 텍스트 전용(음표 결속 0건, 뷰어 미표시).

### 7.3 필드 대응표

| 개념 | scoresentation v1 | mobile/koscriber v2 |
|---|---|---|
| 곡 키 | `saved_hymns.number` TEXT PK | `saved_hymns_v2.number` TEXT PK (동일 키공간) |
| 절/후렴 | `verses:{"1":…}` dict + `chorus` 별도 | `sections:[{kind,label}]` 순서 배열 |
| 슬라이드(1~2줄 묶음) | `korean[i]` (+평행 `english[i]`,`notes[i]`) | **없음 — 줄로 평탄화**(복원 규칙은 §8.3) |
| 시각 줄 | 슬라이드 내 `<br/>` | `lines[{id:'s{sid}.{n}'}]` 1급 레코드 |
| 음절 | 암묵(비공백 문자 위치) | 1급 `syllables[]` |
| KO 음절↔음표 | 위치 1:1(`notes.js:547`) | 음절이 `notes[]` 소유(1:N) |
| 멜리스마 | 하이픈 글리프 = 추가 음표 슬롯 | `notes.length>1` + `melisma:true` |
| 교차줄 멜리스마 | 줄 선행 하이픈 | `continuation:true` 음절(`ko:""`) |
| 단어 경계 | 텍스트 공백 문자 | `wordBoundary`+`leadSpace`(KO), `wbEs`(ES) |
| ES 결속 | (pre-spanish에 없음) | `surface.es` = 음표 span별 다글자 음절, `~`/`‿` 규약 |
| EN | `english[]` 슬라이드 텍스트 | `altLanguages.en[]` 줄 텍스트(동일 미결속) |
| 점음표 | `duration:"q."` 접미 | `dur:"q"` + `dotted:true`(`split_dot`, `migrate_to_v2.py:75-94`) |
| 음표 부가 | accidental/beamGroup/fermata 선택적 | 항상 존재(null/false 채움) |
| 곡 메타 | `newTitle`, `tempo` 있음 | **드랍**(`migrate_to_v2.py:409-431`) |
| 버전 | 없음(updated_at만) | `schemaVersion/rev/source_hash/_provenance` |

### 7.4 pitch 라벨 의미 — 판정 완료 (기존 "중대 충돌" 의혹 기각)

교차 조사 단계에서 "v1 pitch는 프로젝트 시프트 표기, mobile은 표준 — 두 렌더러가 한 칸 다르게 그린다"는 의혹이 제기됐으나, ground truth(NWC 원본) 대조로 **기각**됐다:

- **전 코퍼스(v1 DB, v2 DB/JSON)의 pitch 라벨은 이미 표준 음명(standard scientific pitch)이며 정규화 불요.** 4자 대조(1장 만복의 근원, Ab장조): NWC bridge 파싱 == v1 DB == v2 DB == `web/songs/0001.json` 모두 `A4 A4 G4 F4 E4 A4 B4 C5`(Ab장조 송영의 문자 음명과 정확 일치). 46장·72장 동일. bridge `pitchStr = -pos+34`(`[S]/tools/nwc_bridge.mjs:14-19`)는 표준 파싱.
- 의혹의 근원이었던 `[S]/tools/nwc_to_hymns.py`의 헤더 주석(:12 '한 단계 낮춤')과 `V2_SHIFT`/`to_v2_pitch`(:26-35)는 **호출부가 전무한 죽은 코드 + 낡은 문서**다(실제 매핑은 `'pitch': n['pitch']` 직결, :88-91). 역사: 커밋 `c6fa2ce`(2026-04-13) 시절 로드-시 시프트 레거시 관례가 있었으나, `52dd86a`(2026-04-14) 전면 재동기화에서 NWC 원본 그대로 재기록(`nwc_resync_db.py:4,:39`) + `pitchLabelVersion` 필드 제거(:525-526) + 앱 측 시프트 코드 전부 삭제됨. v1 DB 560행 전수 스캔에서 `pitchLabelVersion` 필드 0건.
- `migrate_to_v2.py`는 pitch를 **무변환 승계**(`"pitch": note.get("pitch")`, :88).
- mobile의 2026-07-02 정정(커밋 `782b1eb`)은 **렌더링 맵만 +0.5 보정**(데이터 무변경): 데스크톱 pitchMap 값은 "Bravura 글리프 앵커 좌표 = 진짜 위치 −0.5"(`[S]/src/notes.js:85-88` 주석)인데 notes-minimal.js가 값 위치에 중심을 그려 전 음표가 반 칸 **높게** 그려지던 버그를 맵 전체 +0.5(`notes-minimal.js:32-35`)로 정정. 정정 후 v2 뷰어는 표준 라벨을 표준 위치에 올바르게 렌더.
- 데스크톱 pitchMap은 pre-spanish == origin/main 완전 동일(18개 엔트리 값까지 identical).

**SPEC 선언 권고**: 캐노니컬 pitch = 표준 음명 문자열 `<A–G><octave>`(다이어토닉 문자 위치 = 원보 보표 위치), 임시표는 `accidental` 별도 필드, 조표는 곡 레벨 `key`. **데이터 쪽 작업 없음**; 유일한 정리 대상은 `nwc_to_hymns.py`의 낡은 헤더·죽은 코드·`pitchLabelVersion=2` 설정(:153)이라는 문서 부채. 렌더러 좌표 규약 2종(데스크톱=앵커 좌표, 모바일=진짜 위치 좌표)은 데이터 의미와 무관한 렌더러 소관.

---

## 8. 양방향 DB 동기화 제약 조건

### 8.1 권위 소스와 비재생성 큐레이션

v2 DB가 "단일 권위"로 선언돼 있고(`HANDOFF.md:65`; R12 미결정 :179), 21~27차 QC(줄 내부 재띄어쓰기 ~145곡/~1,270줄, `koJoinPrev` 325건 일괄, ES space-drop 수정, 495/502 ES 교체, CCM 추가 — `HANDOFF.md:36-38`)는 **v2에 직접 가한 수동 수정이라 v1→v2 재마이그레이션 시 소실**된다(`HANDOFF.md:206`). 데스크톱 v1 baseline은 DQ 수정 이전 상태라 **가사 소스로 신뢰 불가**(`HANDOFF.md:137` ★). → 수입은 "v1 재변환"이 아니라 **v2 문서를 정본으로** 해야 하며, 새 캐노니컬 포맷은 큐레이션 필드(koJoin*, wbEs, 재띄어쓰기)를 1급으로 수용해야 한다. 러프 전수 대조 결과 공백 차이 포함 **338곡/≈1,900줄에서 v1≠v2**(글리프 자체는 보존 원칙).

### 8.2 충돌 감지 프리미티브

- v2 `_provenance.sourceHash` = 원본 v1 `hymn_json`의 sha256(`migrate_to_v2.py:424`) → baseline 변경 감지 가능.
- v2 `rev`는 upsert마다 +1(`import_praise_songs.py:85`)이지만 **신뢰 불가 확정**: fix 도구들이 rev 증가 없이 doc_json만 UPDATE(`apply_missing_fix.py:82`, `apply_linebreak_joins.py:107`; 44·235·364가 rev=1인 채 편집됨). `source_hash`도 upsert 곡만 갱신.
- v1 쪽은 `updated_at`(그나마 혼합 포맷, §6.2)뿐, 스키마 버전 컬럼 없음(`main/db.js:42-57`).
- → 동기화는 곡 단위 **(rev, contentHash) 원장**을 양쪽에 도입해 3-way(공통 조상) 병합 판단을 해야 last-write-wins 사고를 막는다.

### 8.3 슬라이드 재그룹 결정성 — 전수 검증 완료

v2는 슬라이드 경계를 저장하지 않지만(줄로 평탄화), **line id의 숫자부가 v1 슬라이드 매핑을 산술적으로 결정**한다.

- **line id의 의미**: `line_id = f"s{sid}.{li_global}"`의 `li_global`은 빈 줄 스킵 판정(:369-371)보다 먼저 증가(`migrate_to_v2.py:326-328`) — 즉 **v1 소스의 섹션 내 전역 줄 인덱스 그 자체**(:320-321 순회 순서).
- **이식 규칙**: 섹션 `sid`에 대해 v1 소스의 `kor = sec.korean[]`에서 누적 줄수 `C[0]=0, C[k+1]=C[k]+len(BR_split(kor[k]))`를 만들고, v2 line `s{sid}.{n}`의 슬라이드 = `C[k] <= n < C[k+1]`인 `k`. (위치 인덱스가 아닌 **id 숫자부를 키로** 사용.)
- **전수 검증 결과**: 곡별 최적 v1 소스(json-format2 > user DB > baseline; #204만 user DB)를 취하면 **573곡 / 2,330섹션 / 7,433줄 전부에서 결번 0·구조 불일치 0·텍스트 불일치 3줄(전부 줄수 불변)** — 빈 줄 스킵은 실코퍼스에서 한 번도 발동하지 않았다.
- **잔여 차이 5건(모두 무해)**: 44/235/364의 선두 음절 누락 결함을 v2에서 의도적으로 복구(`[M]/tools/apply_missing_fix.py:1-11,:44-50,:52-58,:60-71`); '살아계신 주' user DB 오타('도움심' — stale); '야곱의 축복' user DB 줄수 stale(json-format2가 v2의 실제 소스임을 증명); **#204 후렴 '아 멘' 슬라이드** — baseline·json-format2에는 있고 user DB·v2에는 없음(정책 결정 필요).
- 재띄어쓰기(v1.5.8 `83050ff`, 2026-06-21)는 마이그레이션(2026-06-29)보다 먼저이고 **560곡 중 550곡의 source_hash가 현 baseline과 정확 일치** — 이미 반영된 텍스트로 마이그레이션됨. 나머지 10곡(ES 찬송가)은 json-format2 재작업본이 소스.
- **koJoin* 렌더 전용 진술 확정**: `viewer.js:147-151` 주석("모두 수동 v2 주석, 마이그레이션 미생성 … 줄 개수는 불변 → navOrder/포커스/오선 인덱스 그대로"), 구현 `effSyllables`(:152-162), 적용 도구 `apply_linebreak_joins.py:8,:79-83`. koJoinPrev 보유 796줄 전부 정렬 통과.
- **CCM 13곡도 저자 수기 슬라이드 경계를 가진 v1 소스 존재**: 12곡 = `[P]/docs/json-format2/*.json`(v2의 실제 생성 소스, `import_praise_songs.py:2-8,:58`); '송축해 내 영혼' = user DB에만; '왕이 나셨다' = json-format2에만. 실측 슬라이드 분포: 전체 3,900슬라이드 = 2줄 3,534 + 1줄 366(CCM 85 = 82+3) — 관행과 정합.
- **결론**: 슬라이드 그룹 필드는 일회성 스크립트로 **결정적 백필 가능**(자동 573 / 수기 0; 단 #204 아멘 데이터 선택 1건). v1 소스가 전무한 미래 신곡에는 `nwc_resync_db.py`의 규칙(4마디=1줄, 2줄=1슬라이드, :392-406,:408,:460-467,:493-494,:509-513)을 기본값으로 채택 가능.

### 8.4 baseline·user overlay 상호작용과 레거시 v1.7.x 데이터

- 데스크톱 읽기 우선순위 = tombstone → user → baseline; 쓰기는 항상 user; baseline read-only(§6.4). **baseline에 수입해도 동일 number의 user 행이 가려버린다.**
- 현 설치본 user overlay에 v1.7 포맷 22행이 실존(§6.7). 레거시 v1.7 스페인어 포맷(참고): `Section.spanish[]`(슬라이드별 문자열, 줄 구분 `<br/>`) + `Note.syllable`(음표별 ES 음절; 멜리스마=`syllable:""`; 마커 `~`/`‿`) + `hasSpanishSyllables` 데이터 내재 판별(origin/main `src/present.js:48-63`) — **설계 입력이 아니며 마이그레이션/폐기 대상 데이터로만 취급**.
- `app_meta` 마이그레이션의 정체(v1.7.1 코드): `_runOneTimeMigrations()`(origin/main `main/db.js:71-103`) — "override에 스페인어 없음 + baseline에 있음 → override 행·tombstone 삭제"의 단방향 정리(`_hymnHasSpanish` :44-59). v1=v1.6.1 도입, v2=대상 2곡 추가로 재실행 키만 변경. **새 시스템이 반대 방향으로 가면 이 로직은 폐기 또는 역방향 키(v3)로 재설계 필요.**
- **처분 정책 시사점**: (a) 스페인어 15행은 v1.7.1 baseline과 동일 사본 → 새 baseline이 내용을 승계하면 overlay에서 안전 폐기 가능. (b) pre-spanish 기준이므로 **'고난 당한 구세주'·'주 예수 나의 산 소망' 2곡의 스페인어 완성본은 user DB overlay + 로컬 main baseline blob + `docs/bak_db_*.json` + `[P]/docs/json-format2/`에만 존재**(origin/main baseline에는 없음; v2 코퍼스에는 있음 — v2가 최신 정본). (c) **순수 사용자 곡 7행은 무조건 보존.** (d) tombstone 존중 여부(삭제 곡 부활 방지) 명시 필요.

### 8.5 배포 경로·WAL·ABI·스키마 버전

- baseline 갱신은 앱 밖에서 `sync-to-baseline.py`의 **무충돌검사 LWW** `INSERT OR REPLACE`(:59-68) 후 릴리스에 실림. 수입 파이프라인도 같은 지점(리포 `data/scoresentation.db`)을 표적으로 하되, user 행 잔존 시 다음 릴리스에서도 계속 가린다는 점을 처리해야 함.
- **WAL 체크포인트**: 세 DB 모두 WAL(`main/db.js:34,229`; `migrate_to_v2.py:443`). Python 편집 후 `PRAGMA wal_checkpoint(TRUNCATE)` 필수(CLAUDE.md; `migrate_to_v2.py:472`; `import_praise_songs.py:123`) — 특히 패키징 직전(§6.1의 `!*.db-wal` 필터).
- **ABI 규율**: DB 스크립트 조작은 Python `sqlite3`만(CLAUDE.md; `HANDOFF.md:170` 동일 규칙).
- **스키마 버전 태깅**: v1 테이블에는 버전 컬럼이 없음 — 새 설계는 scoresentation 쪽에도 버전 컬럼(또는 doc 내 `schemaVersion`)과 `_initUserSchema`(`main/db.js:41-58`) 단계의 전방 마이그레이션을 추가해야 한다.

### 8.6 koscriber-대면 수출 계약 (역방향)

수출 산출물 = `web/songs/index.json` + `<id>.json` 정적 세트, koscriber는 무수정 서빙(`main.py:3059-3082`, no-cache ETag). 제약:
- (a) **id 순번 불안정** — 곡 추가 시 밀림. number 기반 주소로 이행하거나 id 재발급 시 방송 프로토콜(`state.hymn.song=id`)과 동시 갱신 필요(문서상 문제 인지만 있고 미수정).
- (b) `hasEs` 플래그가 presenter 검색·ES 패널 빈화면 동작을 좌우.
- (c) `line`(navPos) 인덱스가 줄 수에 의존 — 줄 분할을 바꾸는 동기화는 진행 위치 의미를 깨뜨림(단, koJoin* 계열은 줄 수 불변이라 안전 — §8.3).
- (d) 데이터 변경 후 재빌드 체인(export→검토 HTML/PDF→fallback, `HANDOFF.md:209`)까지가 "동기화 완료"의 정의.

### 8.7 곡 식별자 상호운용 (요약)

- 찬송가: 양쪽 `number` '1'~'558' — **558:558 완전 일치, 제목 불일치 0건**(전수 대조). `newNumber`도 양쪽 보존. category 파생 규칙 동일(숫자=hymn, 아니면 song; `main/db.js:73,154` ↔ `migrate_to_v2.py:418`). → number로 1:1 자동 매칭.
- CCM: `number = title` 규약(`import_praise_songs.py:8,53`). 제목 완전일치 매칭, `'score-축복의 사람'` 중복 1건은 수동 정리.
- 내구 키 권고 = `category + number`(CCM은 제목); export 순번 id는 내부 키로 금지.

---

## 9. 리스크, 암묵적 계약, 미해결 질문

### 9.1 리스크

1. **큐레이션 소실**: koJoin*/wbEs/재띄어쓰기 등 v2 수기 자산은 재마이그레이션·부주의한 편집기 저장(`line-replace`)으로 파괴될 수 있음(§5.7, §8.1). 델타 프로토콜에 해당 편집 op 부재.
2. **user overlay 마스킹**: baseline 수입 후에도 동일 number user 행이 영구히 가림(§8.4).
3. **LWW 병합**: `sync-to-baseline.py`가 무충돌검사 REPLACE — 원장 없는 동기화는 데이터 사고 위험(§8.2, §8.5).
4. **rev/updated_at 신뢰 불가**: 변경 이력 추적 프리미티브가 현재 없음(§8.2).
5. **ES 검증 사각지대**: letter-only 게이트는 띄어쓰기·대소문자를 못 잡음 — 3중 검증 필요(§3.7, §5.7).
6. **위치결속 편집 취약성**: v1 모델은 텍스트 중간 삽입 시 음표 전체가 밀림(§7.1) — 새 모델의 존재 이유.
7. **빔 렌더 격차**: v2 데이터에 beamGroup(최대 25)이 있으나 mobile 뷰어는 미렌더, 데스크톱은 렌더 — 새 뷰어/편집기의 지원 범위 결정 필요.
8. **버전 스큐**: v1.7.1은 미푸시 로컬 전용 — 참조는 커밋 해시 `37880b4`로만 가능(§1.3).

### 9.2 암묵적 계약 (새 구현이 존중해야 하는 것)

- `hymn-saved`/`hymn-deleted` 전 창 브로드캐스트 → 프레젠테이션 자동 리빌드(`main.js:177-191`, `present.js:487-520`).
- `app://` 프로토콜의 user 우선+baseline 폴백 경로 해석(`main.js:47-81`).
- koscriber 임베드 postMessage/URL 계약(`?embed/pane/theme/song/line/lang`, `kosHymnPos`, 절 매크로 — §2.4); 같은 오리진 신뢰; lang '변경 시에만' 반영.
- `index.json`의 `hasEs`/`id`/`line` 의미(§8.6); `Cache-Control: no-cache` ETag 재검증.
- baseline DB read-only + `query_only=ON`; 패키징 `!*.db-wal` 필터; Python sqlite3 전용 + checkpoint(§8.5).
- 진행 순서(절→후렴 인터리브)는 양쪽 모두 저장하지 않는 파생값(§4.5).
- v2 결함 보존 원칙: textOnly / orphanNotes / dangling / `_provenance.warnings` — 가사 날조 금지(`migrate_to_v2.py:17`).

### 9.3 갭 조사로 종결된 질문

- ~~pitch 라벨 의미 충돌~~ → 전 코퍼스 표준 음명, 정규화 불요(§7.4).
- ~~v2→v1 슬라이드 재그룹 가능성~~ → line-id 산술로 결정적, 573곡 전수 검증 통과(§8.3).
- ~~koJoin*가 정말 렌더 전용인지~~ → 확정(`viewer.js:147-151`).
- ~~json-format2 실물 미확인~~ → 22파일 실측 완료(§3.7); '송축해 내 영혼'의 v1 소스는 user DB 행으로 확인.
- ~~user DB 22행 구성·처분 근거~~ → 15 스페인어 중복사본 + 7 순수 사용자 곡으로 확정(§6.7, §8.4).
- ~~app_meta 마이그레이션 정체~~ → v1.7.1 stale-override 정리 로직으로 확인(§8.4); `CREATE TABLE IF NOT EXISTS`라 충돌 없음.
- ~~MVP-plan §4~§6 편집 시맨틱~~ → 델타 op 5종·파생 필드 규칙·게이트 확보(§5.7).

### 9.4 미해결 질문

**설계 결정이 필요한 것 (본 SPEC에서 결정)**:
1. **R12**(`HANDOFF.md:179`): 데스크톱 편집 동결 vs reconcile — 양방향 동기화의 방향을 정하는 근본 결정.
2. 데스크톱이 v2 doc을 직접 읽게 확장 vs v2→v1 하향 변환기(기존 역변환 도구 없음; v1에는 koJoin*/wbEs 자리가 없어 하향은 손실) — §10.2.
3. **#204 후렴 '아 멘' 슬라이드**: baseline·json-format2에는 있고 v2·user DB에는 없음 — 어느 쪽을 정본으로.
4. `'score-축복의 사람'`/`'축복의 사람'` 중복쌍 정리(유래 미상; 어느 쪽이 셋리스트에서 참조되는지 전수 미확인).
5. v2가 드랍한 `tempo`/`newTitle` 보존 여부(현 UI 미렌더 — 에디터 내부 사용 여부 미확인).
6. `wbEs`에 end/standalone을 도입할지(현 코퍼스 start|mid만; 뷰어 폴백으로 실질 문제 없음) — 신규 스키마 확정 필요.
7. 새 편집기/뷰어의 빔(beamGroup) 렌더 지원 여부.
8. koscriber 찬양모드의 export 순번 id → number 기반 주소 이행 여부(수출 id 재배정 정책에 직결).
9. user overlay 15행 폐기·7행 보존·app_meta 폐기(또는 v3 재설계)의 구체 절차.

**추가 확인이 남은 것 (경미)**:
- setlists `payload.songId`가 number 기반임만 확인 — 곡 키가 바뀌면 셋리스트 참조 마이그레이션 필요 여부 미검토.
- v1 `english[]`가 실제로 채워진 곡 수와 포맷 규약(v2 `altLanguages.en`은 215곡 확인).
- `updated_at` 혼합 포맷이 실질 버그를 유발하는 경로 존재 여부(목록 정렬은 number 기준이라 무해 추정).
- `textOnly` 줄 수 계수가 조사 간 불일치(9줄 vs 22줄) — 재계수 필요 시 확인.
- `presentation.js`(PresentationEngine)의 잔존 의도; editor.js 데드코드(:3721-3748)·hidden 툴바의 의도; fermata 1곡의 곡 번호·정합성.
- `web/fallback/찬양_fallback.html` 내부 렌더 코드 미열람(빌더 헤더로 구조만 확인).

---

## 10. 구현 접근 권고 (설계 결정 후보 포함)

### 10.1 캐노니컬 포맷: v2 음절 1급 모델 채택 + 상위집합 보강

조사 결과가 가리키는 캐노니컬 포맷은 **v2 doc 모델을 기반으로 v2가 잃은 것을 복원한 상위집합**이다:

- 음절 1급 + 다국어 표면 슬롯(ko/es/en) + 언어별 단어경계(wordBoundary/wbEs) + melisma/continuation — v2 모델 그대로 채택.
- **슬라이드(프레젠테이션 페이지) 그룹 복원**: §8.3의 결정적 백필(일회성 스크립트, 곡별 최적 v1 소스에서 `C[]` 계산 → 줄 레벨 `slideIndex` 또는 섹션 레벨 `slideBreaks[]` 영속화) — 이후 문서 단독 완결.
- **음절 안정 ID 도입**: v2는 줄 ID(`s1.0`)까지만 — 텍스트 편집 시 음표·외국어 표면이 따라오도록 음절 ID를 부여해 위치결속 취약성 제거(§7.1, §5.7 rewrite 항목과 합치).
- **pitch 선언**: 표준 음명, 데이터 무변경(§7.4). `nwc_to_hymns.py` 문서 부채만 정리.
- **큐레이션 필드 1급 수용**: koJoinPrev/koJoinNext/esJoinNext, 수기 재띄어쓰기 결과 — 편집기 저장 시 보존/재산출 규칙 명문화(§5.7 경고).
- **결함 보존 원칙 유지**: textOnly / orphanNotes / dangling / `_provenance.warnings`.
- **내구 키** = `category + number`(CCM=제목), export 순번 id는 대외 표시용으로 격리. `score-축복의 사람` 중복 정리.
- `tempo`/`newTitle`은 사용처 확인 후 보존 여부 결정(드랍 시 손실 명시).

### 10.2 데스크톱 통합 방식 (결정 후보)

- **후보 A (권고): 데스크톱이 새 캐노니컬 doc을 직접 읽고 쓴다** — 신규 테이블(예: `saved_hymns_v3` 또는 `doc_json` 컬럼) + `schema_version` + `_initUserSchema`(`main/db.js:41-58`) 전방 마이그레이션. 근거: v2→v1 하향 변환은 koJoin*/wbEs/esJoinNext를 담을 자리가 없어 구조적 손실(§8.1); 역변환 도구도 존재하지 않음(§3.6).
- **후보 B: v2→v1 하향 변환기 신설** — 기존 뷰어/편집기 무수정이라는 단기 이점이 있으나, 큐레이션 손실·라운드트립 규칙(하이픈 재생성, 점음표 인코딩 변환) 부담으로 백지 재설계 취지에 반함.
- 어느 쪽이든 baseline/user 오버레이·tombstone·`hymn-saved` 브로드캐스트 체인(§6.4~6.5)은 재사용 가능한 검증된 인프라다.

### 10.3 편집기 구현 접근

- **별도 페이지 신설**(`src/slide-editor.html` 등) — `app://` 서빙과 `setWindowOpenHandler`로 main.js 무수정 창 오픈 가능(§5.6-1). 기존 5.6k줄 editor.js에 증축하지 않는다.
- 편집 모델은 §5.7의 MVP-plan 설계를 입력으로: 음절 자동분절+수동 보정, 음절별 음표 부착(1:N), KO/ES 병기 편집, char 위치 로직의 음절 ID 결속 재작성.
- **저장 게이트 3중**: ① KO 글리프==음표수 ② ES letter-only 재조립==원문 ③ 공백 포함 wbEs 그룹 대조(audit 동치) — letter-only만으로는 불충분(§3.7, §5.7).
- ES 입력 UX는 json-format2의 저작 모델(`~`/`‿` 마커, `syllable:""`, KO `-` 멜리스마)을 수용하거나, 최소한 저장 시 `derive_word_breaks` 정렬이 성립하는 형태로 정규화. 파생 필드(leadSpace, wbEs, span 내 공백)의 재산출 규칙은 §5.7 명세를 그대로 이식.
- 수동 주석(koJoin* 등)은 편집 op로 노출하거나, 최소한 라인 교체 저장 시 보존하는 병합 규칙을 명시.
- 기존 검증된 인프라 재사용: `hymns:save` 체인, `hymn-saved` 리빌드, `setDirty` 닫기 가드(§5.6-6).

### 10.4 동기화 설계

- 곡 단위 **(rev, contentHash) 원장**을 양쪽에 도입, 3-way 병합 판단(§8.2). v2의 rev/source_hash는 현재 신뢰 불가하므로 원장 초기화 시 콘텐츠 해시를 새로 계산.
- **R12 결정**을 SPEC에서 내린다(권고 방향: 새 캐노니컬 포맷의 편집 권위를 데스크톱으로 이관하고, mobile v2는 export 대상으로 전환 — 단 이는 후보이며 사용자 확정 필요).
- 수입(v2→데스크톱): v2 문서 정본 + 슬라이드 백필(§8.3) + user overlay 정책(§8.4: 15행 폐기, 7행 보존, 2곡 스페인어는 v2가 최신 정본) + tombstone 존중 + app_meta 레거시 폐기.
- 수출(데스크톱→koscriber): `export_songs.py` 동형 산출(index.json 계약 §8.6) + 재빌드 체인 완주가 완료 조건. id 안정성 문제는 number 기반 주소 이행과 함께 해결 권고.
- ES 신규 입력의 QC 게이트 승계: audit→자동 fix→재검(§3.7) + spanish 줄 구분 `<br/>` 규약.

### 10.5 신곡 기본 규칙

v1 소스가 없는 미래 신곡의 슬라이드 분할 기본값: **4마디 = 1줄, 2줄 = 1슬라이드(잔여는 마지막 1줄)** — 코퍼스 실측 분포(2줄 90.6%)와 정합(§8.3). 아멘 슬라이드는 "마지막 절 끝 1회" 규약(§6.6d) 유지.

### 10.6 운영 규율 (불변)

DB 스크립트 편집은 Python `sqlite3`만 + 편집 후 `PRAGMA wal_checkpoint(TRUNCATE)`; baseline read-only; 릴리스는 자체 검증 publish 체인 그대로(CLAUDE.md).

### 10.7 설계 결정 후보 일람

| # | 결정 항목 | 후보/권고 |
|---|---|---|
| D1 | 데스크톱 데이터 계보 | **A: 새 캐노니컬 doc 직접 채택(권고)** vs B: v2→v1 하향 변환 |
| D2 | 슬라이드 그룹 | 결정적 백필 후 영속화(`slideIndex`/`slideBreaks[]`) — 검증 완료 |
| D3 | R12 (편집 권위·동기화 방향) | 데스크톱 권위 이관 + 원장 동기화(후보) vs 데스크톱 동결 |
| D4 | 곡 키 | `category+number`(CCM=제목); export id 내부 사용 금지 |
| D5 | pitch | 표준 음명 선언, 데이터 무변경, 문서 부채만 정리 |
| D6 | 편집기 | 별도 페이지 + 음절 ID 결속 + 3중 저장 게이트 + 수동 주석 보존 |
| D7 | user overlay 처분 | 15 중복행 폐기 / 7 사용자 곡 보존 / app_meta 폐기·재설계 |
| D8 | 데이터 정리 | #204 아멘 정본 선택, `score-축복의 사람` 중복 해소 |
| D9 | 신곡 기본 규칙 | 4마디=1줄, 2줄=1슬라이드 |
| D10 | 메타 필드 | `tempo`/`newTitle` 보존 여부, `wbEs` end/standalone 도입 여부, 빔 렌더 지원 여부 |
