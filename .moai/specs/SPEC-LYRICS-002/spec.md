---
id: SPEC-LYRICS-002
version: 0.2.2
status: draft
created: 2026-07-12
updated: 2026-07-12
author: qelee7890
priority: high
issue_number: 2
---

# SPEC-LYRICS-002 — 이중 가사 악보 뷰어(M2) + 슬라이드 편집기(M3)

## HISTORY

- **v0.2.2** (2026-07-12): 감사 3차 잔여 1건(N4 재발) 종결 — 참조 섹션의 plan.md 버전 하드코딩 제거(자기추격형 스테일 참조 구조 차단). 내용 변경 없음.
- **v0.2.1** (2026-07-12): **감사 2차 N1+minor 4건 반영 — 혼합 빔 캐노니컬 모드 한정 명확화.** N1(major): REQ-039를 **캐노니컬(v3) 편집 모드 한정**으로 확정("대체" 문구·오도성 `editor.js:3402` 인용 제거; v1 균일 규약은 동결, v1 곡은 승격 경로로만 혼합 빔 획득) + REQ-006 캐노니컬 렌더러 한정 명시 + GWT-D9 모드 명시. m1: 연속 secondary>stub 우선 규칙을 REQ-006 본문으로 승격. m2: REQ-038 Unwanted→Event-driven 재태깅(집계 갱신). m3: 참조의 plan.md v0.2.0→v0.2.1. m4: parity 골든 5번째 곡을 **364장(아멘)**으로 고정. REQ/GWT 수 불변(31/29).
- **v0.2.0** (2026-07-12): **감사 1차 7건 반영 + 사용자 요구 추가: 혼합 빔 구조({8,8.,16} 임의 조합).** 감사(FAIL 0.70): D1 editor.js 비대화 임계 수치 확정(+150줄), D2 트레이스 보강(REQ-001/030/031 GWT 추가), D3 REQ-043 GWT, D4 parity 골든벡터 대상 집합 열거, D5 3중 게이트 차단/경고 게이트별 확정, D6 '빈 악보' v1 산출 은퇴 명문화(REQ-038, "미래 v1 신곡" 긴장 해소), D7 RM-B nav/줌/테마 parity REQ(REQ-014). 사용자 요구: 혼합 빔(REQ-006 렌더러 새김 규칙 + REQ-039 편집기 적격 규칙, `beamGroup` int id 무변경). REQ 27→31, GWT 20→29.
- **v0.1.0** (2026-07-12): 최초 작성. 게이트 확정(plan.md v0.2.0, 2026-07-12; 권고 3건 사용자 재결정 + v1→v3 opt-in 승격 범위 추가)을 반영. 요구 모듈 5개(RM-A~RM-E), EARS 요구 27건, Exclusions 5건.

---

## 개요 (WHAT / WHY)

M1(SPEC-LYRICS-001)이 놓은 **캐노니컬 doc(schemaVersion 3)** 데이터 기반 위에, ① 한-외국어 이중 가사 악보 슬라이드를 프레젠테이션에 렌더하는 **뷰어**(M2)와 ② 그 슬라이드를 편집하는 **단일 통합 편집기**(M3)를 구현한다. 편집기는 음절 결속 편집·신곡 v3 authoring·**v1 전용 곡의 사용자 선택 캐노니컬 승격(opt-in)**을 제공한다. 유일 설계 모델 = koscriber/mobile v2 음절-음표 구조(research §2, §7.2). **뷰어/편집기는 캐노니컬 모델을 소비만** 하고 스키마를 바꾸지 않는다. 수출·3-way 병합 실행은 SPEC-003.

약어: `[S]`=scoresentation, `[M]`=scoresentation-mobile, `[K]`=koscriber, `[U]`=`%APPDATA%/Scoresentation/data`. 근거는 `SPEC-LYRICS-001/research.md` §·`path:line`으로 추적.

## 환경·전제 (Assumptions)

- M1 산출물 존재(코드 확인): `main/canonical-doc.js`(`normalizeDoc`/`validateDoc`/`assignSyllableIds`/`iterSyllables`/`canonicalStringify`, 안정 음절 ID `` `${line.id}#${i}` ``), `saved_hymns_v3(number, doc_json)`(baseline 572곡·overlay), 읽기 IPC `hymns:get-canonical`(`main.js:177`, `db.js:207` `getCanonicalHymn`), 원장 `main/ledger.js`(`computeContentHash`).
- **쓰기 경로 `hymns:save-canonical`은 부재 → 본 SPEC이 신설.**
- 3-트랙 테스트 인프라(node:test / py unittest / Electron 게이트) 사용 가능.
- dual-read dispatch로 v1 경로는 무변경 보존; baseline read-only, 저장은 user overlay만.

## 게이트 확정 (2026-07-12)

- 렌더러 = 모바일 `notes-minimal.js` 포팅 코어 + 빔(D10) + **모바일 true-position 좌표 규약**(§7.4).
- 편집기 = **단일 통합**(기존 `editor.html` 흡수). SPEC-001 D6(별도 페이지)는 본 게이트로 대체. v3 로직은 신규 모듈에 격리, `editor.js` 비대화 금지.
- 신곡 v3 직접 authoring 범위 포함. ES/EN = per-syllable + `~`/`‿` 정규화.
- **v1→v3 opt-in 승격** 범위 포함(결정적 순수 JS 변환, 슬라이드=v1 `korean[]` 직접, 7 legacyV1 통합, 부분 번역 뷰어 렌더, 승격 후 캐노니컬 전용 라우팅, v1 원본 롤백 보존).

## 요구 모듈 (5개)

| 모듈 | 이름 | REQ |
|---|---|---|
| RM-A | 이중 가사 렌더러 코어(포팅+빔+혼합빔+좌표+부분번역) | REQ-LYR2-001~006 |
| RM-B | 프레젠테이션 통합(dual-read·그룹·nav/줌/테마 parity) | REQ-LYR2-010~014 |
| RM-C | 단일 편집기 v3 통합 + 저장 계약 | REQ-LYR2-020~024 |
| RM-D | 음절 편집 + v1→v3 승격/변환 + 신곡 authoring + 빔 적격 | REQ-LYR2-030~039 |
| RM-E | 렌더/편집 불변식·테스트 계약 | REQ-LYR2-040~044 |

---

## EARS 요구명세

REQ ID 규약: **`REQ-LYR2-xxx`** (SPEC-002 네임스페이스 — SPEC-001의 `REQ-LYR-0xx`와 분리). DELTA: `[EXISTING]`(불변·characterization) · `[MODIFY]` · `[NEW]` · `[REMOVE]`.

### RM-A — 이중 가사 렌더러 코어

- **REQ-LYR2-001** [NEW] (Ubiquitous): 시스템은 v3 캐노니컬 doc을 음절 1급으로 렌더하는 신규 렌더러 코어를 모바일 `notes-minimal.js` 포팅으로 제공한다(word-block 무개행, per-syllable 셀, 다국어 표면, `effSyllables`/`wbEs`, melisma 셀, `spreadNoteInto`, continuation). (§2.1, §7.2)
- **REQ-LYR2-002** [NEW] (Optional): **Where** 음표에 `beamGroup`이 있으면, 렌더러는 빔을 렌더한다(모바일 원본 미보유, D10 요구). (§4.3, D10)
- **REQ-LYR2-003** [NEW] (Ubiquitous): 신규 렌더러의 pitch 좌표 규약은 모바일 true-position(post-`782b1eb` 보정 맵, `notes-minimal.js:32-35`)을 캐노니컬로 채택하며, 데스크톱 앵커(−0.5, `notes.js:85-88`) 규약과의 차이를 문서화한다. (§7.4)
- **REQ-LYR2-004** [NEW] (Unwanted): **If** 렌더된 음표의 y좌표가 골든 true-position과 불일치하면, **then** pitch 위치 parity 회귀 테스트가 빌드를 실패시킨다. (§7.4)
- **REQ-LYR2-005** [NEW] (State-driven): **While** doc이 부분 번역(일부 음절만 `surface.es`)이면, 뷰어는 ES 단어 런 내부의 `es=null` 음절을 앞 ES 음절에 멜리스마 병합하고(`-` 추가), ES 문맥이 없는 음절은 ES 레인에 글리프 없이 KO만 표시한다 — 크래시·가사 날조 없음(KO 폴백 금지). (§7.2, `viewer.js:64-90`)
- **REQ-LYR2-006** [NEW] (State-driven): **While** 한 빔 그룹이 `{8, 8.(dotted-8th), 16}`의 임의 조합·순서를 포함하는 동안(당김음 8.+16/16+8. Scotch snap, 일반 8-16/16-8/8-16-16 등), **캐노니컬(v3) 렌더러**는 그룹 전체에 **공통 primary 빔 1개**를 긋고, **16분 멤버 위에만 secondary 빔 세그먼트**를 새긴다 — 인접한 16분끼리는 secondary 빔을 **연속**으로 잇고, 16분이 8분/8.에 인접하면 **partial stub**(부분 빔)로 처리하며 stub은 그 빔 이웃 방향을 가리킨다(표준 조판). **우선순위: 인접 16분 사이의 연속 secondary 빔이 stub보다 우선한다** — 한 16분이 양쪽(8/8.와 다른 16분)에 동시 인접하면 16분 이웃 쪽으로 연속 빔을 잇고 그 경계에는 stub을 그리지 않는다. (v1 렌더 경로 `notes.js`는 무변경.) `beamGroup`은 기존 int id 그대로(데이터 모델 무변경). (§4.3, 사용자 요구 2026-07-12)

### RM-B — 프레젠테이션 통합

- **REQ-LYR2-010** [MODIFY] (Event-driven): **When** 프레젠테이션이 곡 슬라이드를 빌드할 때(`buildSlidesForItem`), 시스템은 v3 doc이 있으면 신규 렌더러로, 없으면 기존 v1 경로로 분기한다(dual-read dispatch). (`present.js:2133-2367`)
- **REQ-LYR2-011** [EXISTING] (Ubiquitous): v1 전용 곡은 기존 v1 렌더 경로가 **바이트 동일 DOM 동작**으로 유지된다(무변경 characterization). (`present.js:2257-2367`, `notes.js`)
- **REQ-LYR2-012** [MODIFY] (Event-driven): **When** 곡 저장 브로드캐스트(`hymn-saved`)를 수신하면, 프레젠테이션은 해당 곡 슬라이드를 재빌드하고 현재 인덱스를 유지한다. (`present.js:487-501`)
- **REQ-LYR2-013** [NEW] (State-driven): **While** v3 doc이 `slideIndex`/`slideBreaks`를 보유하는 동안, 렌더러는 그 그룹으로 슬라이드 페이지를 구성한다. (§8.3, M1 백필)
- **REQ-LYR2-014** [MODIFY] (Ubiquitous): 시스템은 v3 슬라이드에 대해 기존 프레젠테이션의 줌(폰트 배율 `--present-scale`)·테마(`body.dark`)·절 매크로 내비게이션(1~9=절, 0=후렴)을 v1 슬라이드와 **동등하게** 적용한다(parity). (`present.js:404-443,2489-2537`, §4.5·§4.6)

### RM-C — 단일 편집기 v3 통합 + 저장 계약

- **REQ-LYR2-020** [MODIFY] (Event-driven): **When** 사용자가 곡 편집을 진입(`handleItemEdit`)하고 그 곡에 v3 doc이 있으면, 시스템은 **기존 편집기 페이지 안에서** 캐노니컬 편집 모드를 활성화한다(별도 페이지 없음). (`present.js:1204`, D6 대체)
- **REQ-LYR2-021** [NEW] (Ubiquitous): v3 편집 로직은 신규 모듈 파일(`editor-canonical.js` + 순수 로직 모듈)에 두며, 기존 `editor.js`(5,594줄)의 **순증가는 +150줄 이내**(dispatch/routing 배선만; 모든 v3 실질 로직은 신규 모듈)여야 한다. — 임계 근거: baseline 5,594줄 대비 +150(≈2.7%)은 v3 감지·위임 분기 + 최소 배선만 수용하는 상한이며 `git diff --stat` 순증가 줄수로 이진 판정한다. (§5.6-7)
- **REQ-LYR2-022** [NEW] (Event-driven): **When** 캐노니컬 편집 저장 시, 시스템은 `hymns:save-canonical`로 doc을 `validateDoc`·`assignSyllableIds` 정규화 후 `saved_hymns_v3` user overlay에 upsert하고, `sync_ledger`의 rev를 단조 증가시키며 `contentHash=computeContentHash(doc)`로 갱신하고 `hymn-saved`를 브로드캐스트한다. (`ledger.js:33`, `db.js:207-284`)
- **REQ-LYR2-023** [EXISTING] (State-driven): **While** 편집 대상 곡이 v1 전용이면, 기존 편집기 동작(char-position 기반)이 변경 없이 유지된다. (`editor.js:2742-2771`)
- **REQ-LYR2-024** [NEW] (State-driven): **While** 곡이 이미 승격되어 v3 doc이 존재하는 동안, 편집기는 그 곡을 캐노니컬 모드로만 라우팅한다(레거시 편집으로의 드리프트 차단). (§(e), R10)

### RM-D — 음절 편집 + v1→v3 승격/변환 + 신곡 authoring

- **REQ-LYR2-030** [NEW] (Event-driven): **When** 사용자가 문장 가사를 입력하면, 시스템은 음절 자동분절 + 수동 보정을 제공한다. (§5.7, `MVP-plan.md:509-514`)
- **REQ-LYR2-031** [NEW] (Ubiquitous): 시스템은 음절별 1:N 음표 부착과 KO/ES per-syllable 병기 편집을 제공한다(EN=`altLanguages` 별도 트랙). (§7.2)
- **REQ-LYR2-032** [NEW] (Event-driven): **When** ES 입력에 `~`/`‿` 마커가 포함되면, 시스템은 입력 시 정규화한다(`~`→결합/제거, `‿`→synalepha 공백). (§3.7, `migrate_to_v2.py:70-72`)
- **REQ-LYR2-033** [NEW] (Unwanted): **If** 저장 시 3중 게이트가 실패하면, **then** 시스템은 게이트별로 다음과 같이 처리한다 — **게이트①(KO 글리프==음표수) = 저장 차단(hard block)**; **게이트②(ES letter-only 재조립==원문) = 정본이 있는 곡은 저장 차단(hard), 정본이 없는 곡은 경고(soft, 휴리스틱만 §3.7)**; **게이트③(공백 포함 `wbEs` 그룹 대조) = 경고(soft, 저장 허용)**. hard block 게이트(①·② 정본 有)는 손상 doc 산출을 막는다. (§3.7, §5.7)
- **REQ-LYR2-034** [NEW] (Unwanted): **If** 라인 교체 저장이 수동 주석(`koJoinPrev`/`koJoinNext`/`esJoinNext`)을 잃게 되면, **then** 시스템은 보존 병합을 적용하여 주석을 유지한다. (§5.7 ★)
- **REQ-LYR2-035** [NEW] (Event-driven): **When** 사용자가 신곡을 생성하면, 시스템은 title/meta + 섹션/줄 구조 + 입력 가사 음절 자동분절 + 음표 부착으로 유효한 v3 캐노니컬 doc(`validateDoc` 통과)을 산출한다(v3 직접 authoring). (§(d), `present.js:1417-1512`)
- **REQ-LYR2-036** [NEW] (Event-driven): **When** 사용자가 v1 전용 곡에 승격 액션을 트리거하면, 시스템은 결정적 v1→v3 변환(비공백 문자 1:1 char↔note→음절, 하이픈→멜리스마, 줄 선행 하이픈→continuation, 결함 보존·날조 금지, KO 글리프==음표수 게이트)을 순수 JS로 실행하고, **슬라이드 그룹을 v1 doc 자체 `korean[]` 슬라이드 배열에서 직접** 도출한 뒤(3-소스 백필 불요) `hymns:save-canonical`로 저장한다. (§6.6, §7.2, `migrate_to_v2.py:128-151,320-371`)
- **REQ-LYR2-037** [MODIFY] (State-driven): **While** 7개 legacyV1 wrap(`_provenance.legacyV1`, `sections:[]`)을 승격하는 동안, 시스템은 동일 변환 엔진을 legacyV1 payload에 적용하여 진짜 캐노니컬 doc으로 전환하고 원본을 보존한다(한 메커니즘·두 진입 상태). (§(e))
- **REQ-LYR2-038** [MODIFY] (Event-driven): **When** 사용자가 신곡을 생성하면(빈 악보 모달 제출), 시스템은 v3 캐노니컬 doc만 산출하고 **v1 `hymn_json`을 생성하지 않는다** — 기존 "빈 악보" `sectionsToHymn` v1 저작 경로는 신규 곡 생성에서 은퇴한다(기존 v1 곡은 무영향). **따라서 미래 신규 곡은 항상 v3이며, v1→v3 승격 대상은 "기존 v1 곡(v3 미보유)"으로 한정된다.** (§(d), `present.js:1417-1512`)
- **REQ-LYR2-039** [NEW] (Ubiquitous): **캐노니컬(v3) 편집 모드에 한하여** 편집기는 빔 그룹 지정을 `{8, 8.(dotted-8th), 16}`의 **임의 조합·순서**에 대해 허용한다(당김음 8.+16/16+8. Scotch snap 및 일반 8-16 조합 포함; dotted-16th는 적격 범위 밖). **v1 레거시 편집기의 균일-8/16-only 규약(`validateBeamSelectionItems`, `editor.js:3418-3437`)은 동결·무변경**이며, 캐노니컬 모드는 이를 승계하지 않고 별도 혼합 적격을 적용한다(REQ-023·GWT-C3·Exclusions와 정합). **v1 전용 곡은 v1→v3 opt-in 승격(REQ-036·044 계열) 경로를 통해서만 혼합 빔 능력을 얻는다.** 데이터 모델은 기존 `beamGroup` int id 그대로(변경 없음). (§4.3, 사용자 요구 2026-07-12)

### RM-E — 렌더/편집 불변식·테스트 계약

- **REQ-LYR2-040** [EXISTING] (Ubiquitous): baseline DB는 read-only + `query_only=ON`으로 열리며, 편집·승격·신곡 저장은 user overlay에만 발생한다. (§6.1)
- **REQ-LYR2-041** [NEW] (Ubiquitous): 순수 로직(레이아웃·자동분절·게이트·원장 갱신·v1→v3 변환)은 DOM 없이 node:test로 결정적 검증 가능하게 분리한다(85% 커버리지 대상). (§테스트 전략)
- **REQ-LYR2-042** [NEW] (Ubiquitous): `save-canonical` 해시는 M1 `canonicalStringify` 골든벡터(JS==Python)와 일관하며, v1→v3 변환은 **명시된 parity 골든벡터 대상 집합**에서 Python 변환(`migrate_to_v2`)과 완전 일치해야 한다. **대상 집합 = v1↔v3 계보가 확인된 대표 곡**: ① 1장 '만복의 근원'(Ab, 표준 케이스) ② 46장(단어 내 멜리스마 하이픈 보유) ③ 3장(독립 하이픈/꼬리음 continuation) ④ 190번(ES 병기·wbEs) ⑤ **364장**(마지막 절 끝 아멘 슬라이드 보유 — §6.6d 커밋 `b71f482`, ①~④와 미중복). **제외 기준 = 대응 Python 소스가 없는 개인 사용자 곡**(7 legacyV1 등 — 이들은 validateDoc + glyph 게이트로만 검증). 실패 시 "범위 밖" 합리화 불가. (§7.4, M1 원장)
- **REQ-LYR2-043** [NEW] (Ubiquitous): 시스템은 M1 캐노니컬 스키마(schemaVersion 3)를 변경하지 않고 소비만 한다. (Exclusions)
- **REQ-LYR2-044** [NEW] (Ubiquitous): 승격은 v1 원본 행을 무변경 보존하며, 롤백은 v3 overlay 삭제로 v1 dispatch에 복귀한다. (§(e), `getCanonicalHymn` `db.js:207`)

**EARS 유형 커버리지:** Ubiquitous(001·003·011·014·021·031·039·040·041·042·043·044, 12) / Event-driven(010·012·020·022·030·032·035·036·038, 9) / State-driven(005·006·013·023·024·037, 6) / Unwanted(004·033·034, 3) / Optional(002, 1) — 5종 전부, 총 31건.

---

## 파일 목록 (변경 대상 + Reference)

### 신규(NEW)

| 파일 | 목적 | Reference |
|---|---|---|
| `[S]/src/notes-canonical.js` | notes-minimal.js 포팅 렌더 코어 + 빔(true-position, **혼합 {8,8.,16} primary+secondary/stub 새김**) | `[M]/web/js/notes-minimal.js:12-192`, `notes.js:418-471`(빔 참조) |
| `[S]/src/canonical-render.js` | 음절 1급 DOM-less 레이아웃 + 부분 번역(es=null) | `[M]/web/js/viewer.js:64-163` |
| `[S]/src/editor-canonical.js` | v3 편집 모드 컨트롤러(editor.html 로드) | `[M]/docs/MVP-plan.md:492-516` |
| `[S]/src/editor-syllabify.js` | 문장→음절 자동분절(순수) | §5.7, `migrate_to_v2.py:211-281` |
| `[S]/src/editor-gates.js` | 3중 게이트·`~`/`‿`·koJoin* 보존(순수) | §3.7, `audit_es_spacing.py` |
| `[S]/src/v1-to-canonical.js` | v1→v3 결정적 변환(순수, 슬라이드=v1 korean[]) | `migrate_to_v2.py:128-151,320-371`, §6.6, §7.2 |

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

### 데이터(런타임 쓰기 — user overlay만)

| 대상 | 변경 | 제약 |
|---|---|---|
| `[U]` `saved_hymns_v3` | 편집·승격·신곡 저장 upsert | baseline read-only 불변; v1 원본 행 무변경(롤백) |
| `[U]` `sync_ledger` | 저장 시 rev↑·contentHash 갱신 | `computeContentHash` 강제 |

---

## mx_plan (@MX 주석 대상)

- **@MX:ANCHOR** (public / fan_in≥3): `hymns:save-canonical` 쓰기 경계(`main.js`/`preload.cjs`/`db.js saveCanonicalHymn`); `notes-canonical.js`/`canonical-render.js` 공개 렌더 함수; `v1-to-canonical.js` 변환 진입점; `editor-canonical.js` v3 편집 진입.
- **@MX:WARN** (REASON 필수): `editor.js` v3 dispatch 결합(REASON: 5.6k줄 모놀리스 비대화·v1 회귀, §5.6-7); 렌더러 좌표 규약(REASON: true-position vs 앵커 혼입 pitch 회귀 §7.4); `koJoin*` 보존 병합(REASON: QC 자산 파괴 §5.7 ★); `save-canonical` 원장 갱신(REASON: SPEC-003 병합 오염 §8.2); 승격 후 라우팅(REASON: v1/v3 편집 드리프트).
- **@MX:NOTE:** 음절 ID `` `${line.id}#${i}` ``; 좌표 규약(신규=true-position, v1=앵커 −0.5); melisma 셀/`spreadNoteInto`; `~`/`‿` 정규화; 슬라이드=slideIndex/slideBreaks(뷰어)·v1 korean[](승격); 부분 번역 es=null 병합(§7.2).

---

## Exclusions (What NOT to Build)

- **수출·동기화 실행 없음** — koscriber 수출·3-way 병합 실행은 **SPEC-003**. 편집·승격 결과는 `saved_hymns_v3`+`sync_ledger`에만 남긴다.
- **koscriber/mobile 측 변경 없음** — serving/embed 계약(`[K]/backend/main.py:3059-3082`, §2.4) 무변경; 모바일 `viewer.js`/`notes-minimal.js`는 **포팅 원본으로 참조만**(원본 파일 수정 금지).
- **캐노니컬 스키마 변경 없음** — `canonical-doc.js`(schemaVersion 3) 소비만; 스키마 변경은 SPEC-001 개정.
- **v1 렌더/편집 경로 재작성 없음** — dual-read로 v1 곡·v1 편집 동작·v1 원본 행 무변경 보존.
- **실시간 라이브 동기화 없음** — 배치 원장만(SPEC-001 D3 승계).

---

## 참조

- 상세 계획·마일스톤·리스크·TDD·mx_plan: `plan.md`(approved — 버전은 해당 파일 HISTORY가 정본).
- 수용 기준(GWT): `acceptance.md`.
- 근거: `SPEC-LYRICS-001/research.md`(v1.0); M1 산출물 `main/canonical-doc.js`·`main/ledger.js`.
