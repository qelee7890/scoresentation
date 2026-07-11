---
id: SPEC-LYRICS-002
version: 0.2.2
status: approved
created: 2026-07-12
updated: 2026-07-12
author: qelee7890
priority: high
issue_number: 0
---

# SPEC-LYRICS-002 구현 계획 (plan.md) — 이중 가사 악보 뷰어(M2) + 슬라이드 편집기(M3)

> 구현 계획. spec.md / acceptance.md / spec-compact.md 는 본 계획 확정(게이트 2026-07-12) 후 Phase 2에서 작성한다.
> 근거는 `SPEC-LYRICS-001/research.md`와 **M1 구현 실체**(코드 확인)를 `path:line`으로 추적한다. 약어: `[S]`=scoresentation, `[M]`=scoresentation-mobile, `[K]`=koscriber, `[U]`=`%APPDATA%/Scoresentation/data`.

## HISTORY

- **v0.2.2** (2026-07-12): **감사 2차 N1+minor 4건 반영 미러**(spec.md v0.2.1와 동기). 혼합 빔 적격을 **캐노니컬(v3) 편집 모드 한정**으로 확정(v1 균일 규약 동결·무변경, v1 곡은 승격 경로로만 혼합 빔 획득); parity 골든 5번째 곡을 **364장(아멘)**으로 고정(R11·Layer 1c 동기).
- **v0.2.1** (2026-07-12): **감사 1차 7건 반영 + 혼합 빔 구조 사용자 요구 추가**(spec.md v0.2.0와 동기). D1 editor.js 비대화 임계 **+150줄** 확정, D2 트레이스 보강, D3 REQ-043 GWT, D4 parity 대표 곡 집합 열거, D5 3중 게이트 게이트별 차단/경고, D6 '빈 악보' v1 산출 은퇴 명문화(신곡 항상 v3 → "미래 v1 신곡" 문구 제거, 승격 대상은 "기존 v1 곡"으로 한정), D7 RM-B nav/줌/테마 parity. 혼합 빔({8,8.,16} 임의 조합): 렌더 새김 규칙(primary+secondary/stub) + 편집기 적격 규칙, `beamGroup` int id 무변경. REQ 27→31, GWT 20→29.
- **v0.2.0** (2026-07-12): **게이트 확정 반영(권고 3건 사용자 재결정 포함).** 사용자가 4개 질문 중 3개에서 권고와 다르게 재결정:
  - **[재결정 1] 렌더러:** notes.js 확장 하이브리드(권고) → **모바일 `notes-minimal.js`를 렌더러 코어로 포팅** + 빔 추가(D10) + **좌표 규약을 모바일 true-position(post-`782b1eb` 보정 맵)으로 정착**, 데스크톱 앵커(−0.5) 차이 문서화 + pitch 좌표 parity 회귀 테스트(§7.4). **dual-read dispatch는 미이의 → 유지**(감사 가능하도록 본 이력에 명시).
  - **[재결정 2] 편집기:** 별도 페이지(권고, SPEC-001 D6 확정) → **단일 편집기 통합**(기존 `editor.html` 흐름이 v3 편집 흡수). **D6(별도 페이지)는 사용자 재결정(2026-07-12 게이트)으로 '단일 편집기 통합'으로 대체.** 완화 요구: v3 로직은 신규 모듈(`editor-canonical.js` + 순수 로직 모듈)에 두어 `editor.js` 모놀리스 비대화 방지.
  - **[재결정 3] 범위 확장:** 신규 곡 v3 **직접 authoring을 SPEC-002 범위에 포함**(권고는 후속 SPEC). 저장 계약(신규 IPC `hymns:save-canonical`)·ES per-syllable+`~`/`‿` 정규화·7 legacyV1 재음절화 의무 유지.
  - RM 모듈을 재구성해 범위 확장을 흡수하면서 ≤5 유지(RM-D에 신곡 authoring 흡수). status=approved.
  - **[범위 추가 — v1→v3 opt-in 승격]** (2026-07-12 후속): **기존 v1 전용 곡(7 순수 사용자 곡 + v3 미보유 기존 곡; 신규 곡은 항상 v3라 해당 없음)**을 **사용자 선택으로** 캐노니컬 승격해 스페인어/영어 편집을 얻는 기능 추가. 결정적 in-app v1→v3 변환(Python import 시맨틱 미러, 슬라이드 그룹은 v1 doc 자체 `korean[]`에서 직접 — 3-소스 백필 불요), 순수 JS 모듈. 7 legacyV1 재음절화는 이 일반 승격의 **특수 케이스**로 통합(한 메커니즘·두 진입 상태). 뷰어는 **부분 번역 doc을 우아하게 렌더**(es=null 데스크톱 동작 명시). 승격 후 dispatch가 뷰어→신규 렌더러·편집기→캐노니컬 모드 자동 전환. → 아키텍처 방향 (e) 신설, RM-D 확장.
- **v0.1.0** (2026-07-12): 초안. M2+M3 범위, 요구 모듈 5개, 설계 긴장 (a)~(d) 권고, 마일스톤·리스크·TDD·mx_plan·미해결 질문 6건.

---

## 확정 결정사항 (게이트 2026-07-12 + SPEC-001 승계)

1. **유일 설계 모델 = koscriber/mobile v2 음절-음표 구조**(research §2, §7.2). 캐노니컬 doc(schemaVersion 3, M1 `main/canonical-doc.js`)이 데이터 정본 — **뷰어/편집기는 소비만**, 스키마 변경 없음.
2. **[확정] 렌더러 = 모바일 `notes-minimal.js` 포팅 코어 + 빔(D10) + 모바일 true-position 좌표 규약**(§7.4). dual-read dispatch(v3→신규 렌더러, v1→기존 경로 무변경) 유지.
3. **[확정] 편집기 = 단일 통합**(기존 `editor.html`가 v3 흡수). ~~D6 별도 페이지~~ 대체됨. v3 로직은 신규 모듈 파일에 격리, `editor.js` 비대화 금지.
4. **[확정] 신규 곡 v3 직접 authoring 범위 포함.** ES per-syllable 직접 편집 + `~`/`‿` 입력 정규화. 7 legacyV1 재음절화 의무 유지.
5. **[확정] 저장 계약:** 신규 IPC `hymns:save-canonical`(saved_hymns_v3 overlay upsert + `sync_ledger` rev↑/contentHash + 기존 `hymn-saved` broadcast 재사용).
6. **D10(승계): beamGroup 데이터 보존 + 데스크톱 렌더 유지.** 수출·병합 실행은 SPEC-003.
7. **[확정] v1→v3 opt-in 승격.** v1 전용 곡을 사용자 선택으로 결정적 변환(순수 JS, Python import 시맨틱 미러; 슬라이드 그룹은 v1 `korean[]`에서 직접). 승격 후 dispatch가 뷰어/편집기를 자동 캐노니컬 전환. 뷰어는 부분 번역 doc 우아하게 렌더. v1 원본 행은 롤백용으로 보존, 읽기 시 v3 우선. **승격된 곡은 편집기가 캐노니컬 모드로만 라우팅**(레거시 편집 드리프트 차단).

### M1 구현 실체 (본 계획 전제 — 코드 확인 완료)

| 산출물 | 위치 | SPEC-002 의미 |
|---|---|---|
| 캐노니컬 doc(schemaVersion 3) | `[S]/main/canonical-doc.js` — `normalizeDoc`/`validateDoc`/`assignSyllableIds`/`iterSyllables`/`canonicalStringify` | 소비 대상. 안정 음절 ID `` `${line.id}#${i}` ``(§7.1 위치결속 제거) |
| `saved_hymns_v3(number, doc_json)` | baseline 572곡(slideIndex/slideBreaks 백필) + user overlay(v1 7 + v3 승격 7) | 렌더/편집 소스 |
| 읽기 IPC `hymns:get-canonical` | `main.js:177-181`, `preload.cjs:8`, `db.js:207-231`(`getCanonicalHymn`) | 읽기 경로(존재) |
| 원장 프리미티브 | `[S]/main/ledger.js` — `computeContentHash`, `createLedger`(읽기 전용) | 저장 시 contentHash 재계산 재사용 |
| 3-트랙 테스트 | node:test / py unittest / Electron 게이트 | RM-E 실행 기반 |
| **쓰기 경로 부재** | `hymns:save-canonical` 없음 | **SPEC-002 신설(RM-C)** |

### 승계 의무 (M1 → SPEC-002)

7 legacyV1 wrap(`sections:[]`, `_provenance.legacyV1`)은 **재음절화(문장→음절 자동분절+수동 보정)로 진짜 캐노니컬화**해야 한다(RM-D 명시 요구).

---

## SPEC 분해 (요구 모듈 ≤5) — 범위 확장 흡수

| 모듈 | 이름 | 마일스톤 | 핵심 |
|---|---|---|---|
| RM-A | 이중 가사 렌더러 코어 | M2 | notes-minimal.js 포팅 + 빔(**혼합 {8,8.,16} primary+secondary/stub**) + 좌표 규약 정착 + parity + **부분 번역(es=null) 우아 렌더** |
| RM-B | 프레젠테이션 통합 | M2 | dual-read dispatch(승격 후 자동 전환), 슬라이드 그룹, nav/줌/테마·리빌드 parity |
| RM-C | 단일 편집기 v3 통합 + 저장 계약 | M3 | editor.html 흡수(신규 모듈 격리), `hymns:save-canonical`+원장, **승격 opt-in 액션·승격 후 캐노니컬 전용 라우팅** |
| RM-D | 음절 편집 + v1→v3 승격/변환 + 신곡 authoring + 빔 적격 | M3 | per-syllable KO/ES·`~`/`‿`·1:N·3중 게이트·주석 보존·**신곡 v3 authoring**·**v1→v3 결정적 변환(재음절화 통합)**·**캐노니컬 모드 한정 혼합 빔 {8,8.,16} 적격(v1 균일 규약 동결)** |
| RM-E | 렌더/편집 불변식·테스트 계약 | M2·M3 | 순수 함수 분리·좌표 parity·원장 불변식·v1 무변경·editor.js 비대화 가드·**변환 골든벡터 parity** |

**범위 확장 흡수 근거:** ① create-new-song은 **재음절화와 동일 엔진**(문장→음절 자동분절 + 음표 부착 + `validateDoc` + KO 글리프 게이트)을 빈 doc에서 시작할 뿐. ② **v1→v3 승격도 같은 캐노니컬화 엔진**을 v1 `hymn_json`(또는 legacyV1 payload)에서 시작할 뿐 — 7 legacyV1 재음절화는 이 승격의 **특수 진입 상태**다(한 메커니즘·두 진입 상태). 세 기능(신곡 authoring·재음절화·v1 승격)이 동일 변환 엔진을 공유하므로 **RM-D에 통합**해 인위적 분할 없이 ≤5를 유지한다.

**의존 순서:** M1(완료) → M2(RM-A→RM-B) → M3(RM-C→RM-D). RM-E는 교차 불변식.

---

## 아키텍처 방향 (게이트 확정)

### (a) 뷰어 통합 — dual-read dispatch (확정, 미이의)

`buildSlidesForItem`(`present.js:2133`)/`buildSlidesForHymn`(:2257)에서 **v3 doc 존재로 렌더러 분기**: v3면 신규 렌더러 코어, 없으면 기존 v1 경로 **무변경**. setlist 아이템 타입은 `score` 유지. 슬라이드 그룹=백필된 slideIndex/slideBreaks.

### (b) 렌더러 — 모바일 notes-minimal.js 포팅 코어 (확정, 재결정 1)

- **[확정] 신규 렌더러 코어 `src/notes-canonical.js` = `[M]/web/js/notes-minimal.js` 포팅.** 음절 1급 인라인 SVG(SMuFL/Bravura), word-block 무개행, effSyllables/wbEs, melisma 셀, spreadNoteInto, continuation(§2.1). 가사 레이아웃도 모바일 `viewer.js` 알고리즘 이식(`[M]/web/js/viewer.js:64-163`).
- **[확정] (a) 빔 추가:** `beamGroup` 렌더를 포팅 코어 위에 얹는다 — 모바일 원본은 빔 미렌더, D10이 요구.
- **[확정] (b) 좌표 규약 정착:** 신규 렌더러의 pitch 좌표는 **모바일 true-position(post-`782b1eb` 보정 맵, `notes-minimal.js:32-35`)을 캐노니컬**로 채택한다. 데스크톱 `notes.js` 앵커(진짜 위치 −0.5, `notes.js:85-88`) 규약과의 차이를 문서화하고, **pitch 위치 parity 회귀 테스트**로 골든 위치를 고정한다(§7.4).
- **결과 구조:** v1 경로는 데스크톱 `notes.js`(앵커) 무변경, v3 경로는 신규 `notes-canonical.js`(true-position). **두 좌표 규약이 dual-read로 분리 공존** — 섞지 않는다.

### (c) 편집기 — 단일 통합 (확정, 재결정 2, D6 대체)

- **[확정] 별도 페이지 없음.** 기존 `editor.html` 흐름이 v3 편집을 흡수한다. **~~SPEC-001 D6(별도 페이지)~~는 2026-07-12 게이트로 '단일 편집기 통합'으로 대체.**
- **[완화 요구] `editor.js`(5,594줄) 모놀리스 비대화 금지:** v3 편집 로직은 **신규 모듈 파일**에 둔다 — `src/editor-canonical.js`(v3 모드 컨트롤러) + 순수 로직 모듈(`src/editor-syllabify.js`, `src/editor-gates.js`). 기존 페이지가 이들을 로드하고, `editor.js`는 dispatch 진입점만 최소 추가.
- **Dispatch 경계:** 편집 진입 시 곡에 v3 doc 있으면 **캐노니컬 편집 모드**(신규 모듈), v1 전용이면 **기존 동작(char-position 기반) 무변경**. 두 모드는 렌더 컨테이너를 공유하되 로직 경로가 분리된다.
- **저장 계약:** `hymns:save-canonical(number, doc)` → `validateDoc`·`assignSyllableIds` → saved_hymns_v3 overlay upsert(tombstone 선제거) → `sync_ledger` rev↑·`contentHash=computeContentHash(doc)`(`ledger.js:33`) → 기존 `hymn-saved` broadcast(`present.js:487-501` 리빌드 무료 승계).

### (d) 신곡 authoring + ES/EN 입력 (확정, 재결정 3)

- **[확정] 신규 곡 v3 직접 authoring 범위 포함.** 수집 UI는 기존 "빈 악보" 모달(`present.js:1512` `openScoreModal`)의 title/key/time/composer + 가사 입력을 재사용하되, **출력을 v1(`sectionsToHymn` :1455)이 아니라 v3 캐노니컬 doc으로** 라우팅한다(`sectionsToCanonical` 신설: 섹션/줄 구조 + 입력 가사 음절 자동분절 + 음표 부착 → `save-canonical`).
- **입장 — '빈 악보' 모달 처분:** 신규 곡은 **기본적으로 v3 authoring**으로 라우팅한다. 기존 v1 산출 경로(`sectionsToHymn`)는 신규 곡 생성에서 **은퇴**(기존 v1 곡은 영향 없음). 이는 `present.js:1417-1505` 모달 경로 변경이라 회귀 위험이 있어 수집 UI를 characterization으로 보호한다(리스크 R9).
- **[확정] ES/EN = per-syllable 직접 편집 + `~`/`‿` 입력 정규화**(`~`→결합/제거, `‿`→synalepha 공백; `migrate_to_v2.py:70-72` 규약). 저장 형태는 정규화된 per-syllable surface. EN=`altLanguages` 별도 트랙.

### (e) v1→v3 opt-in 승격 (확정, 범위 추가)

- **[확정] opt-in 액션:** 편집기가 v1 전용 곡에 명시적 승격 액션("스페인어/영어 병기 추가" / "캐노니컬로 변환")을 노출. 트리거 시 **결정적 in-app v1→v3 변환** 실행.
- **[확정] 변환 엔진 `src/v1-to-canonical.js`(순수 JS, node:test-able, no better-sqlite3):** Python import 파이프라인 시맨틱 미러(§7.2, `migrate_to_v2.py`) — 비공백 문자 1:1 char↔note → 음절 1급, 하이픈→멜리스마(`notes.length>1`+`melisma`), 줄 선행 하이픈→continuation(`ko:""`), 결함 보존·날조 금지(`GLYPH_NOTE_MISMATCH` 흡수), KO 글리프==음표수 게이트. `canonical-doc.js` 규약 준수. 가능한 범위에서 **Python 변환과 공유 골든벡터로 parity 교차 검증**.
- **[확정] 슬라이드 그룹 = v1 doc 자체 `korean[]` 슬라이드 배열에서 직접**(각 `korean[i]`=슬라이드, 내부 `<br/>`=줄). **3-소스 백필(§8.3) 불요** — in-app 승격은 v1 doc이 슬라이드 권위. (baseline 대량 수입만 백필을 썼음.)
- **[확정] 저장·전환:** 승격 → `hymns:save-canonical`(v3 overlay upsert + `sync_ledger` rev/contentHash 초기화) → **dual-read dispatch가 뷰어→신규 렌더러·편집기→캐노니컬 모드 자동 전환**(추가 뷰어 배선 없음).
- **[확정] 7 legacyV1 통합:** legacyV1 wrap(`_provenance.legacyV1` payload, `sections:[]`) 승격 = 같은 변환 엔진을 legacyV1 payload에 적용. **한 메커니즘·두 진입 상태**(일반 v1 행 / legacyV1 wrap).
- **[확정] 부분 번역 뷰어 렌더(데스크톱 동작 명시):** 승격 직후 doc은 ES/EN이 일부 섹션/줄/음절에만 존재. 뷰어는 언어 레인을 독립 렌더 — 음절 `surface.es=null`이 ES 단어 런 내부면 앞 ES 음절에 멜리스마 병합(`-` 추가, §7.2 `viewer.js:78-90`), 그 외(ES 문맥 없음)면 그 음절은 ES 레인에 글리프 없이 KO만 표시. **미번역 영역은 KO만 표시, 크래시·날조 없음**(KO 폴백 금지 규칙 `viewer.js:64-74` 준수).
- **[확정] v1 원본 처분·드리프트 차단:** 승격은 v3 overlay를 쓰고 **v1 행은 롤백용으로 무변경 보존**. 읽기 시 v3 우선(`getCanonicalHymn` 정밀도). **롤백 = v3 overlay 삭제**(v1 dispatch로 복귀). **승격된 곡(v3 존재)은 편집기가 캐노니컬 모드로만 라우팅** — 레거시 편집으로 돌아가 v1/v3 분기 편집이 갈라지는 드리프트를 차단(리스크 R10).

---

## 마일스톤별 작업 분해

DELTA: `[EXISTING]`(불변·characterization) · `[MODIFY]` · `[NEW]` · `[REMOVE]`.

### M2 — 이중 가사 뷰어 (RM-A, RM-B, Priority High)

- **[NEW] `[S]/src/notes-canonical.js`(RM-A):** `[M]/web/js/notes-minimal.js` 포팅(음절 1급 인라인 SVG, PITCH 맵=true-position `notes-minimal.js:32-35`) + **빔 렌더 추가**(beamGroup). Reference: `notes-minimal.js:12-192`, `viewer.js:104-137`.
- **[NEW] `[S]/src/canonical-render.js`(RM-A):** doc→레이아웃(word-block/effSyllables/wbEs/melisma 셀/spreadNoteInto/continuation) DOM-less 순수 함수. **부분 번역(es=null) 우아 렌더** — ES 런 내부는 멜리스마 병합, 그 외 KO만(§7.2 `viewer.js:64-90`). Reference: `viewer.js:64-163,152-163`.
- **[MODIFY] `[S]/src/present.js`(RM-B):** dual-read dispatch(`buildSlidesForItem` :2133 / `buildSlidesForHymn` :2257) — v3면 신규 렌더러, else v1 무변경. 슬라이드 그룹=slideIndex/slideBreaks.
- **[MODIFY] `[S]/src/index.html`(RM-B):** 렌더 모듈 로드(`index.html:320-328`).
- **[EXISTING] characterization만:** v1 렌더(`notes.js` 앵커), 줌/테마/절 뱃지/nav order(`present.js:404-443,2437-2537`), `hymn-saved` 리빌드(:487-501).

### M3 — 단일 편집기 v3 통합 (RM-C, RM-D, Priority Medium)

- **[NEW] `[S]/src/editor-canonical.js`(RM-C):** v3 편집 모드 컨트롤러(기존 `editor.html`가 로드). Reference: `[M]/docs/MVP-plan.md:492-516`(설계), `canonical-doc.js`.
- **[NEW] 순수 로직 모듈 `[S]/src/editor-syllabify.js` + `editor-gates.js`(RM-D):** 음절 자동분절, 3중 저장 게이트, `~`/`‿` 정규화, koJoin* 보존 병합 — DOM-less. Reference: §3.7, §5.7, `migrate_to_v2.py:70-72,211-281`, `audit_es_spacing.py`.
- **[MODIFY] `[S]/src/editor.js`(RM-C, 최소):** 편집 진입 dispatch만 추가(v3 doc → editor-canonical 위임, else 기존 동작). **비대화 금지** — 로직 증축 안 함. Reference: `editor.js:348`(HymnEditor), §5.6-7.
- **[NEW] IPC `hymns:save-canonical`(RM-C):** `main.js` 핸들러 + `preload.cjs` 메서드 + `db.js saveCanonicalHymn`(v3 overlay upsert + sync_ledger rev↑/contentHash + `hymn-saved`). Reference: `main.js:177-190`, `db.js:207-231,233-284`, `ledger.js:33`.
- **[NEW] 신곡 v3 authoring(RM-D):** `sectionsToCanonical` 신설 + "빈 악보" 모달 출력 라우팅. Reference: `present.js:1417-1505,1512`.
- **[NEW] v1→v3 승격 변환 `[S]/src/v1-to-canonical.js`(RM-D, 순수 JS):** v1 `hymn_json`(또는 legacyV1 payload) → 캐노니컬 doc. 1:1 char↔note→음절, 하이픈→멜리스마, continuation, 결함 보존, KO 글리프 게이트. **슬라이드 그룹은 v1 `korean[]`에서 직접(백필 불요).** Python `migrate_to_v2.py` 시맨틱 미러 + 공유 골든벡터 parity. Reference: `migrate_to_v2.py:128-151,320-371`, §6.6, §7.2.
- **[NEW] 승격 opt-in 액션 + 라우팅(RM-C/RM-D):** 편집기 v1 곡에 승격 버튼 노출 → 변환 → `save-canonical` → 승격 후 캐노니컬 모드 전용 라우팅(v1 롤백 행 보존). Reference: `handleItemEdit` `present.js:1204`, `getCanonicalHymn` `db.js:207`.
- **[NEW] 재음절화(RM-D, 승격 특수 케이스):** 7 legacyV1 wrap(`_provenance.legacyV1`) → 같은 변환 엔진(legacyV1 payload 입력), 원본 보존. Reference: §5.7 :509-514.
- **[NEW] 음절 결속 편집(RM-D):** 1:N 음표 부착, KO/ES per-syllable, 파생 필드(`leadSpace`/`wbEs`) 재산출.
- **[MODIFY] `[S]/src/present.js handleItemEdit`(:1204-1219)(RM-C):** v3 present → 캐노니컬 모드 진입(별도 창 아님, 같은 편집기 페이지).
- **[EXISTING] characterization만:** v1 편집 경로(char-position, `editor.js:2742-2771`), `setDirty` 닫기 가드, "빈 악보" 수집 UI 폼.

### 교차 (RM-E)

- 3-트랙 테스트 재사용. v1 렌더/편집·수집 UI characterization으로 무변경 보장. editor.js 라인 델타 가드.

---

## 파일 목록 (생성/수정 + Reference)

### 신규(NEW)

| 파일 | 목적 | Reference |
|---|---|---|
| `[S]/src/notes-canonical.js` | notes-minimal.js 포팅 렌더 코어 + 빔(true-position) | `[M]/web/js/notes-minimal.js:12-192` |
| `[S]/src/canonical-render.js` | 음절 1급 DOM-less 레이아웃 | `[M]/web/js/viewer.js:64-163` |
| `[S]/src/editor-canonical.js` | v3 편집 모드 컨트롤러(editor.html 로드) | `[M]/docs/MVP-plan.md:492-516` |
| `[S]/src/editor-syllabify.js` | 문장→음절 자동분절(순수) | §5.7, `migrate_to_v2.py:211-281` |
| `[S]/src/editor-gates.js` | 3중 저장 게이트·`~`/`‿` 정규화·koJoin* 보존(순수) | §3.7, `audit_es_spacing.py` |
| `[S]/src/v1-to-canonical.js` | v1→v3 결정적 변환(순수, 슬라이드=v1 korean[] 직접) | `migrate_to_v2.py:128-151,320-371`, §6.6, §7.2 |

### 수정(MODIFY)

| 파일 | 변경 | Reference |
|---|---|---|
| `[S]/src/present.js` | dual-read dispatch + `handleItemEdit` v3 분기 + "빈 악보" v3 라우팅 | `present.js:1204-1219,1417-1505,2133-2367` |
| `[S]/src/index.html` | 렌더 모듈 로드 | `index.html:320-328` |
| `[S]/src/editor.js` | v3 진입 dispatch만(최소, 비대화 금지) | `editor.js:348`, §5.6-7 |
| `[S]/src/editor.html` | v3 모드 모듈 로드 | `editor.html:12-196` |
| `[S]/main.js` | `hymns:save-canonical` 핸들러 + broadcast | `main.js:177-190` |
| `[S]/preload.cjs` | `saveCanonicalHymn` 메서드 | `preload.cjs:5-8` |
| `[S]/main/db.js` | `saveCanonicalHymn`(v3 overlay upsert + sync_ledger 갱신) | `db.js:207-231,233-284` |

### ~~제거됨~~ (v0.1.0 대비)

- ~~`src/slide-editor.html`~~ — 단일 편집기 통합(재결정 2)으로 **미생성**.

### 데이터(런타임 쓰기 — user overlay만)

| 대상 | 변경 | 제약 |
|---|---|---|
| `[U]` `saved_hymns_v3` | 편집·신곡 저장 upsert(overlay만) | baseline read-only 불변; WAL |
| `[U]` `sync_ledger` | 저장 시 rev↑·contentHash 갱신 | `computeContentHash` 강제 |

---

## 리스크 및 완화

| # | 리스크 | 완화 | 연계 |
|---|---|---|---|
| R1 | **시각 검증 자동화 한계** — SVG/DOM/폰트 메트릭 렌더는 순수 함수로 완전 검증 불가 | 레이아웃을 DOM-less 순수 함수로 분리해 node:test 단위검증; 픽셀/폰트 의존부는 Electron 스모크 + **수동 시각 확인 병행**. 100% 자동 정합 불가 명시 | M2, RM-E |
| R2 | **렌더러 포팅 좌표-parity** — 모바일 true-position 채택 + 데스크톱 앵커 공존 → 규약 혼입·회귀 위험(§7.4) | 신규 렌더러는 모바일 좌표 상수만, 데스크톱 앵커 상수 격리; **pitch 위치 골든 parity 회귀 테스트**(1장 Ab 등)로 빌드 게이트 | M2, RM-A/E |
| R3 | **editor.js 통합 위험(상승)** — 단일 편집기 결정으로 5.6k줄 모놀리스에 v3 결합; research §5.6-7은 '별도 파일 권장'이었음 | v3 로직 **신규 모듈 격리**(editor-canonical/syllabify/gates), `editor.js`는 dispatch만; **기존 v1 편집기 동작 characterization**로 회귀 봉쇄; editor.js **순증가 ≤ +150줄 가드**(git diff --stat, ≈baseline 2.7%; dispatch/routing만 수용, v3 실질 로직은 전부 신규 모듈 — 이진 판정) | M3, RM-C/E |
| R4 | char-position→음절 ID 로직 혼입 — v3 모드가 실수로 char-position 경로 재사용(§5.7) | dispatch 경계 명확화 + v3 모드는 음절 ID 결속만, char-position 함수 미호출 단위 가드 | M3 |
| R5 | 큐레이션 소실(koJoin*) — 편집 저장이 수동 주석 파괴(§5.7 ★) | 저장 병합 보존 + 라운드트립 테스트 | M3 |
| R6 | 원장 드리프트 — save-canonical rev/hash 누락 시 SPEC-003 병합 오염 | `computeContentHash` 강제 + rev 단조 증가 불변식 테스트 | M3, RM-E |
| R7 | 재음절화·신곡 authoring 데이터 손실 | legacyV1 원본 `_provenance` 보존; 미완료 doc 저장 시 게이트 경고/차단 | M3 |
| R8 | 빔 렌더 이식 정확성 — 포팅 코어에 없던 빔을 얹음 | beamGroup 그룹핑·이중빔(16분) 데스크톱 규칙(§4.3) 참조 + 빔 렌더 스냅샷 테스트 | M2 |
| R9 | **"빈 악보" 모달 v3 라우팅 회귀** — 신곡 경로 변경(재결정 3) | 수집 UI 폼 characterization; v1 산출 은퇴는 신곡 한정(기존 v1 곡 무영향) | M3 |
| R10 | **승격 후 편집 드리프트** — 사용자가 승격된 곡을 레거시 v1 모드로 계속 편집해 v1/v3가 갈라짐 | 승격(v3 존재) 곡은 편집기가 **캐노니컬 모드 전용 라우팅**; v1 행은 롤백용 무변경 보존, 읽기 v3 우선; 라우팅 단위 가드 테스트 | M3 |
| R11 | **v1→v3 변환 결정성·parity** — in-app 변환이 Python import와 어긋나면 데이터 불일치 | 순수 JS 변환 + **대표 곡 집합**(1장/46장/3장/190/**364 아멘**) 골든벡터 parity 테스트(개인 사용자 곡은 Python 소스 부재로 제외, validateDoc+글리프로만 검증); 슬라이드는 v1 korean[] 직접이라 백필 불확실성 없음 | M3, RM-E |
| R12 | **혼합 빔 조판 정확성** — {8,8.,16} 임의 조합에서 secondary 빔/partial stub 방향 오류 | 표준 조판 규칙(연속 16분=연속 secondary가 stub보다 우선, 8/8. 인접 16분=stub은 빔 이웃 방향) 명문화(REQ-006, **캐노니컬 렌더러 한정**) + 대표 조합(8.+16 당김음/16+8. 스카치 스냅/8-16-16) 스냅샷 테스트(stub 방향 단언). 편집 적격은 **캐노니컬 모드 한정**(v1 균일 규약 동결). `beamGroup` 데이터 모델 무변경으로 저장·수출 영향 없음 | M2/M3, RM-A/D |

---

## 테스트 전략 (TDD RED-GREEN-REFACTOR, 순수 모듈 85%)

UI 렌더링 SPEC의 정직한 분할 — **순수 함수 완전 자동, 시각 정합은 게이트+수동 병행.**

- **Layer 1 — node:test(순수, 85% 대상):** `canonical-render`(레이아웃 모델 + 부분 번역 es=null), `editor-syllabify`(자동분절), `editor-gates`(3중 게이트·`~`/`‿`·koJoin* 보존), `saveCanonicalHymn` 원장 갱신, `sectionsToCanonical`(신곡), **`v1-to-canonical`(승격 변환 — 슬라이드 경계가 v1 korean[]과 동일·glyph==notes)**. **DOM 없이 결정적** — R1 1차 방어선.
- **Layer 1c — 변환 parity(순수/게이트):** `v1-to-canonical` 산출이 **대표 곡 집합**(1장 Ab/46장 멜리스마/3장 continuation/190 ES/**364장 아멘**)에서 Python `migrate_to_v2`와 골든벡터 완전 일치 — 개인 사용자 곡은 Python 소스 부재로 제외(validateDoc+글리프로만 검증). R11 가드.
- **Layer 1b — pitch 좌표 parity(순수/게이트):** `notes-canonical`의 pitch→y가 **골든 true-position**과 일치(1장 Ab: F5/D5/B4/G4/E4 기준). 데스크톱 앵커 상수 혼입 시 실패(R2 가드).
- **Layer 2 — Electron 게이트(통합/시각):** DOM 마운트 스모크(슬라이드·오선·음표·빔 존재, 오류 0) + `getBoundingClientRect`/폰트 의존부. **픽셀 정합은 대표 곡 수동 시각 확인**(한-서 병기, 멜리스마, continuation, 빔).
- **Layer 3 — py unittest(회귀):** `save-canonical` 해시가 M1 `canonicalStringify` 골든벡터(JS==Python)와 교차 일관.
- **Characterization(착수 전):** v1 렌더(`notes.js` 앵커)·v1 편집기(char-position)·"빈 악보" 수집 UI·줌/테마/nav·`hymn-saved` 리빌드·koscriber embed(무변경). **editor.js 라인 델타 가드**(비대화).
- **TDD 매핑:** RED=이중 가사 렌더 스냅샷 + 좌표 parity 실패 + 3중 게이트 실패 + koJoin* 보존 실패 + 원장 rev 단조 위반 + 신곡 validateDoc 실패. GREEN=최소 구현. REFACTOR.

### 운영 규율(불변)

baseline read-only; 저장은 user overlay만; DB 스크립트 Python sqlite3 + `wal_checkpoint(TRUNCATE)`; publish 체인 무변경.

---

## mx_plan (@MX 주석 대상)

- **@MX:ANCHOR** (public 경계 / fan_in≥3):
  - `hymns:save-canonical` 쓰기 경계(`main.js`/`preload.cjs`/`db.js saveCanonicalHymn`).
  - `notes-canonical.js`/`canonical-render.js` 공개 렌더 함수(뷰어·편집기 공통).
  - `editor-canonical.js` v3 편집 진입 경계.
- **@MX:WARN** (위험, @MX:REASON 필수):
  - `editor.js` v3 dispatch 결합(REASON: 5.6k줄 모놀리스 비대화·v1 회귀 위험, research §5.6-7).
  - 렌더러 좌표 규약(REASON: 모바일 true-position vs 데스크톱 앵커 혼입 시 pitch 회귀 §7.4).
  - koJoin* 보존 저장 병합(REASON: 수기 QC 자산 파괴 §5.7 ★).
  - `save-canonical` 원장 rev/contentHash 갱신(REASON: SPEC-003 병합 오염 §8.2).
- **@MX:NOTE:** 음절 ID `` `${line.id}#${i}` ``; 좌표 규약(신규=true-position, v1=앵커 −0.5); melisma 셀/spreadNoteInto; `~`/`‿` 정규화; 슬라이드 그룹=slideIndex/slideBreaks.

---

## Exclusions (What NOT to Build)

- **수출·동기화 실행 없음** — koscriber 수출·3-way 병합 실행은 **SPEC-003**. 편집 결과는 `saved_hymns_v3`+`sync_ledger`에만 남긴다.
- **koscriber/mobile 측 변경 없음** — serving/embed 계약(`[K]/backend/main.py:3059-3082`, §2.4) 무변경; 모바일 `viewer.js`/`notes-minimal.js`는 **포팅 원본으로 참조만**(원본 파일 수정 금지).
- **캐노니컬 스키마 변경 없음** — `canonical-doc.js`(schemaVersion 3) 소비만; 스키마 변경은 SPEC-001 개정.
- **v1 렌더/편집 경로 재작성 없음** — dual-read로 v1 곡·v1 편집 동작 무변경 보존.
- **실시간 라이브 동기화 없음** — 배치 원장만(SPEC-001 D3 승계).

---

## 다음 단계

게이트 확정(2026-07-12) 완료 → **Phase 2 진행**: `spec.md`(EARS, RM-A~RM-E, REQ-LYR2-xxx) + `acceptance.md`(GWT) + `spec-compact.md`. 수출·병합 실행은 SPEC-003.
