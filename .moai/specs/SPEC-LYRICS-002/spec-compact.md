---
id: SPEC-LYRICS-002
version: 0.2.1
status: draft
created: 2026-07-12
updated: 2026-07-12
author: qelee7890
priority: high
issue_number: 0
---

# SPEC-LYRICS-002 (compact) — 이중 가사 뷰어(M2) + 편집기(M3)

## REQ (EARS)

ID 규약 `REQ-LYR2-xxx`. DELTA: `[EXISTING]`·`[MODIFY]`·`[NEW]`·`[REMOVE]`.

### RM-A 렌더러 코어
- **REQ-LYR2-001** [NEW] (Ubiquitous): v3 doc을 음절 1급 렌더하는 신규 코어(모바일 `notes-minimal.js` 포팅; word-block/effSyllables/wbEs/melisma 셀/spreadNoteInto/continuation).
- **REQ-LYR2-002** [NEW] (Optional): Where beamGroup → 빔 렌더(D10, 모바일 원본 미보유).
- **REQ-LYR2-003** [NEW] (Ubiquitous): pitch 좌표 = 모바일 true-position(post-782b1eb) 채택 + 데스크톱 앵커(−0.5) 차이 문서화.
- **REQ-LYR2-004** [NEW] (Unwanted): If 음표 y가 골든 true-position과 불일치 → parity 회귀 테스트 빌드 실패.
- **REQ-LYR2-005** [NEW] (State-driven): While 부분 번역(일부 es=null) → ES 런 내부 es=null은 앞 ES 음절 멜리스마 병합, 그 외 KO만; 크래시·날조 없음(§7.2).
- **REQ-LYR2-006** [NEW] (State-driven): While 빔 그룹이 {8,8.,16} 임의 조합·순서 → **캐노니컬 렌더러**가 공통 primary 빔 1개 + 16분 위 secondary(인접 16분 연속, 8/8. 인접 16분은 partial stub, stub은 빔 이웃 방향). **연속 secondary > stub 우선**(양쪽 인접 16분은 16분 이웃 연속, 경계 stub 없음). v1 notes.js 무변경. beamGroup int id 무변경.

### RM-B 프레젠테이션 통합
- **REQ-LYR2-010** [MODIFY] (Event-driven): When buildSlidesForItem → v3면 신규 렌더러, else v1 경로(dual-read).
- **REQ-LYR2-011** [EXISTING] (Ubiquitous): v1 전용 곡은 기존 경로 바이트 동일 DOM 동작 유지.
- **REQ-LYR2-012** [MODIFY] (Event-driven): When hymn-saved 수신 → 재빌드+인덱스 유지.
- **REQ-LYR2-013** [NEW] (State-driven): While v3가 slideIndex/slideBreaks 보유 → 그 그룹으로 페이지 구성.
- **REQ-LYR2-014** [MODIFY] (Ubiquitous): v3 슬라이드에 기존 줌(--present-scale)·테마(body.dark)·절 매크로 nav(1~9절/0후렴)를 v1과 동등 적용(parity).

### RM-C 편집기 v3 통합 + 저장
- **REQ-LYR2-020** [MODIFY] (Event-driven): When 편집 진입 & v3 doc 있으면 기존 편집기 페이지 안에서 캐노니컬 모드(별도 페이지 없음).
- **REQ-LYR2-021** [NEW] (Ubiquitous): v3 로직은 신규 모듈 파일에 두며 editor.js 순증가 **≤ +150줄**(git diff --stat, dispatch만)로 제한.
- **REQ-LYR2-022** [NEW] (Event-driven): When 캐노니컬 저장 → hymns:save-canonical(validateDoc·assignSyllableIds → v3 overlay upsert → sync_ledger rev↑·contentHash → hymn-saved).
- **REQ-LYR2-023** [EXISTING] (State-driven): While v1 전용 곡이면 기존 편집기 동작(char-position) 무변경.
- **REQ-LYR2-024** [NEW] (State-driven): While 승격된 곡(v3 존재)이면 편집기는 캐노니컬 모드로만 라우팅(레거시 드리프트 차단).

### RM-D 음절 편집 + v1→v3 승격 + 신곡 authoring
- **REQ-LYR2-030** [NEW] (Event-driven): When 문장 가사 입력 → 음절 자동분절+수동 보정.
- **REQ-LYR2-031** [NEW] (Ubiquitous): 1:N 음표 부착 + KO/ES per-syllable(EN=altLanguages).
- **REQ-LYR2-032** [NEW] (Event-driven): When ES `~`/`‿` 입력 → 정규화(`~`→결합, `‿`→공백).
- **REQ-LYR2-033** [NEW] (Unwanted): If 3중 게이트 실패 → 게이트별: ①글리프==음표=차단(hard), ②ES 재조립=정본有 차단·無 경고, ③공백 wbEs=경고(soft); hard 게이트는 doc 미산출.
- **REQ-LYR2-034** [NEW] (Unwanted): If 라인 교체 저장이 koJoin* 주석을 잃게 되면 → 보존 병합 적용.
- **REQ-LYR2-035** [NEW] (Event-driven): When 신곡 생성 → title/meta+구조+자동분절+음표 부착으로 유효 v3 doc(validateDoc 통과).
- **REQ-LYR2-036** [NEW] (Event-driven): When v1 전용 곡 승격 트리거 → 결정적 v1→v3 변환(1:1 char↔note→음절, 하이픈 멜리스마, continuation, 결함 보존, KO 글리프 게이트; **슬라이드=v1 korean[] 직접, 백필 불요**) → save-canonical.
- **REQ-LYR2-037** [MODIFY] (State-driven): While 7 legacyV1 wrap 승격 중 → 같은 변환 엔진을 legacyV1 payload에 적용, 원본 보존(한 메커니즘·두 진입 상태).
- **REQ-LYR2-038** [MODIFY] (Event-driven): When 신곡 생성(빈 악보 제출) → v3 doc만 산출, v1 hymn_json 미생성(sectionsToHymn v1 경로 은퇴; 기존 v1 곡 무영향). 미래 신규 곡은 항상 v3 → 승격 대상은 "기존 v1 곡"으로 한정.
- **REQ-LYR2-039** [NEW] (Ubiquitous): **캐노니컬(v3) 편집 모드 한정** 편집기는 빔 그룹 지정을 {8,8.,16} 임의 조합·순서(당김음·Scotch snap·8-16) 허용(dotted-16th 제외). **v1 균일-8/16-only 규약(editor.js:3418-3437)은 동결·무변경**, 캐노니컬 모드만 별도 적격 적용. v1 곡은 v1→v3 승격 경로로만 혼합 빔 획득. beamGroup int id 무변경.

### RM-E 불변식·테스트 계약
- **REQ-LYR2-040** [EXISTING] (Ubiquitous): baseline read-only+query_only; 편집·승격·신곡 저장 overlay만.
- **REQ-LYR2-041** [NEW] (Ubiquitous): 순수 로직(레이아웃·분절·게이트·원장·변환) DOM 없이 node:test 결정 검증(85% 대상).
- **REQ-LYR2-042** [NEW] (Ubiquitous): save-canonical 해시 M1 골든벡터(JS==Python) 일관; v1→v3 변환은 **대표 곡 집합**(1장 Ab/46장 멜리스마/3장 continuation/190 ES/**364장 아멘**)에서 Python과 완전 일치. 제외=Python 소스 없는 개인 사용자 곡.
- **REQ-LYR2-043** [NEW] (Ubiquitous): 캐노니컬 스키마(schemaVersion 3) 불변, 소비만.
- **REQ-LYR2-044** [NEW] (Ubiquitous): 승격은 v1 원본 행 무변경 보존; 롤백=v3 overlay 삭제→v1 dispatch 복귀.

---

## 수용 시나리오 (GWT)

- **GWT-A1** 1장 Ab v3 / 렌더 / 골든 true-position 일치, 앵커 혼입 시 parity 실패. (003·004)
- **GWT-A2** beamGroup v3 / 렌더 / 빔 폴리곤(16분 이중빔). (002)
- **GWT-A3** 일부 es / 렌더 / ES 런 내부 es=null 병합, 그 외 KO만, 크래시·날조 없음. (005)
- **GWT-A4** 멜리스마·continuation·word-block doc / 레이아웃 / 첫 셀=가사·이후 늘임표, continuation 이월, word-block 무개행, effSyllables/wbEs 산출. (001)
- **GWT-A5** [8.,16]·[16,8.] / 빔 / 공통 primary + 16분 partial stub, **stub이 8.(이웃) 방향**. (006)
- **GWT-A6** [8,16,16] / 빔 / primary + 두 16분 연속 secondary, **2번째 음 좌측 경계 stub 없음(연속 우선)**. (006)
- **GWT-B1** v3/v1 각각 / 빌드 / v3→신규, v1→바이트 동일 DOM(회귀 0). (010·011)
- **GWT-B2** slideIndex/slideBreaks / 렌더 / 그룹 경계 일치. (013)
- **GWT-B3** 표시 중 / hymn-saved / 재빌드+인덱스 유지. (012)
- **GWT-B4** v3 슬라이드 / 줌·테마·절매크로 / v1과 동등 반응. (014)
- **GWT-C1** 편집 수정 / 저장 / v3 overlay upsert + ledger rev↑/hash + hymn-saved. (022)
- **GWT-C2** git diff --stat / editor.js 순증가 **≤ +150줄**, v3 로직 신규 모듈. (021)
- **GWT-C3** v3/v1 곡 / 편집 진입 / v3→캐노니컬 모드, v1→기존 무변경. (020·023)
- **GWT-C4** 승격된 곡 / 재편집 / 캐노니컬 모드로만(레거시 차단). (024)
- **GWT-D1** title/meta+가사 / 신곡 / validateDoc 통과 + glyph==notes. (035)
- **GWT-D2** "que‿en"·"re~ci" / 정규화 / `‿`→공백, `~`→결합. (032)
- **GWT-D3** 3게이트 각각 / 저장 / ①차단 ②정본有 차단·無 경고 ③경고, hard는 doc 미산출. (033)
- **GWT-D4** koJoinPrev 줄 라인 교체 저장 / 조회 / 보존. (034)
- **GWT-D5** v1 곡 / 승격 / validateDoc + glyph==notes + **슬라이드 경계=v1 korean[] 동일**. (036)
- **GWT-D6** legacyV1 wrap / 승격 / 변환 엔진 적용, 원본 payload 보존. (037)
- **GWT-D7** 자동분절 후 경계 수동 보정 / doc이 보정 분할 반영, 음표는 음절 ID 따라 유지. (030)
- **GWT-D8** 음절에 음표 2개 부착 + EN 입력 / notes.length==2, EN은 altLanguages 트랙. (031)
- **GWT-D9** **캐노니컬 모드**에서 [8.,16]·[16,8.]·[8,16,16] 빔 지정 / 셋 다 허용·동일 beamGroup id, dotted-16th 거부, 모델 무변경; **v1 균일 규약 무변경(거부)**. (039)
- **GWT-D10** 빈 악보 신곡 / 저장소 / v3 doc만, v1 hymn_json 미생성; 승격 대상 아님. (038)
- **GWT-E1** 순수 모듈 / node:test / 결정 통과, ≥85%. (041)
- **GWT-E2** query_only baseline / 저장 / baseline 미변경, overlay만. (040)
- **GWT-E3** 대표 곡 집합(1장/46장/3장/190/364 아멘) 골든벡터 / JS vs Python / 완전 일치(개인곡 제외). (042)
- **GWT-E4** v3+v1 공존 / v3 overlay 삭제 / v1 dispatch 복귀, v1 원본 무변경. (044)
- **GWT-E5** 산출 doc·M1 모듈 검사 / schemaVersion 3 유지, 스키마/마이그레이션 미추가. (043)

**품질 게이트:** 순수 모듈 85%, LSP 0, GWT 29건 통과(REQ 31 전수 트레이스), 좌표·변환 parity(대표 곡 집합) 통과, 혼합 빔 새김, v1 무변경 회귀, 슬라이드 경계 동일성, editor.js 순증가 ≤+150줄, 원장 rev 단조, 범위 산출물(수출/스키마 변경) 0.

**EARS 유형 집계(31건):** Ubiquitous 12(001·003·011·014·021·031·039·040·041·042·043·044) / Event-driven 9(010·012·020·022·030·032·035·036·038) / State-driven 6(005·006·013·023·024·037) / Unwanted 3(004·033·034) / Optional 1(002).

---

## 파일 목록

### NEW
- `[S]/src/notes-canonical.js` — notes-minimal.js 포팅 + 빔(true-position, 혼합 {8,8.,16} primary+secondary/stub)
- `[S]/src/canonical-render.js` — 음절 1급 DOM-less 레이아웃 + 부분 번역
- `[S]/src/editor-canonical.js` — v3 편집 모드 컨트롤러
- `[S]/src/editor-syllabify.js` — 문장→음절 자동분절(순수)
- `[S]/src/editor-gates.js` — 3중 게이트·`~`/`‿`·koJoin* 보존(순수)
- `[S]/src/v1-to-canonical.js` — v1→v3 결정적 변환(순수, 슬라이드=v1 korean[])

### MODIFY
- `[S]/src/present.js` — dual-read dispatch + handleItemEdit v3 분기 + "빈 악보" v3 라우팅
- `[S]/src/index.html` — 렌더 모듈 로드
- `[S]/src/editor.js` — v3 진입 dispatch만(비대화 금지)
- `[S]/src/editor.html` — v3 모드 모듈 로드
- `[S]/main.js` — `hymns:save-canonical` 핸들러 + broadcast
- `[S]/preload.cjs` — `saveCanonicalHymn` 메서드
- `[S]/main/db.js` — `saveCanonicalHymn`(v3 overlay upsert + sync_ledger)

### DATA (user overlay만)
- `[U]` `saved_hymns_v3` — 편집·승격·신곡 upsert(v1 원본 행 무변경)
- `[U]` `sync_ledger` — rev↑·contentHash 갱신

---

## Exclusions (What NOT to Build)

- 수출·병합 실행 없음 → SPEC-003
- koscriber/mobile 측 변경 없음(모바일 원본은 참조/포팅만)
- 캐노니컬 스키마(schemaVersion 3) 변경 없음(소비만)
- v1 렌더/편집 경로·v1 원본 행 재작성 없음(dual-read 무변경)
- 실시간 라이브 동기화 없음
