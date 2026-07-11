---
id: SPEC-LYRICS-001
version: 0.2.0
status: approved
created: 2026-07-11
updated: 2026-07-11
author: qelee7890
priority: high
issue_number: 0
---

# SPEC-LYRICS-001 구현 계획 (plan.md) — 한-외국어 이중 가사 악보 시스템 (백지 재설계)

> 본 문서는 **구현 계획 초안**이다. spec.md / acceptance.md 는 게이트 통과 후 Phase 2에서 작성한다.
> 근거는 전부 `research.md`(검증된 딥리서치) 섹션·`path:line` 인용으로 추적한다. 경로 약어: `[S]`=scoresentation, `[M]`=scoresentation-mobile, `[K]`=koscriber-soniox, `[P]`=praise-spanish, `[U]`=`%APPDATA%/Scoresentation/data`.

## HISTORY

- **v0.2.0** (2026-07-11): **게이트 확정 반영.** 미해결 질문 6건 전부 사용자 확정(2026-07-11) — D1/D3/D6/D7/D8/D10을 확정으로 승격, 구체 선택 반영, 답변을 관련 절에 흡수. SPEC 분해 3-way 확정(001=M1 데이터 기반 / 002=M2 뷰어+M3 편집기 / 003=M4 수출·동기화). status=approved. Phase 2(spec.md/acceptance.md 작성) 진입.
- **v0.1.0** (2026-07-11): 초안. research.md(v1.0) 기반 SPEC 분해·아키텍처 방향(D1–D10)·마일스톤(M1–M4) 작업 분해·리스크·테스트 전략·mx_plan·미해결 질문 6건 작성. status=draft. 게이트 확정 전.

---

## 확정 결정사항 (사용자 바인딩 — 재설계의 전제)

1. **백지 재설계.** v1.7.0 스페인어 구현(origin/main의 `Section.spanish[]` + `Note.syllable`, research §8.4)과 옛 anchored 레이아웃 정책은 **설계 입력이 아니다.** 유일 설계 모델 = koscriber/mobile **v2 음절-음표 슬라이드 구조**(research §2, §7.2). 레거시 v1.7.x 데이터는 §8.4의 **마이그레이션/폐기 대상**으로만 취급한다. (참고: 옛 "natural+justify" 방식은 사용자가 명시 거부 — 재시도 금지.)
2. **기준 커밋 = `aa43aab`(v1.5.9, `pre-spanish`).** 신규 브랜치는 이 커밋에서 생성한다. 단 **브랜치 생성은 후속 단계이며 본 계획 작업 범위가 아니다.**
3. **데이터 모델은 두 결속을 모두 1급으로 수용.** 한글 = 1음절 : 1음표(멜리스마 포함), 외국어(ES/EN) = N글자 : 1음표. (research §7.2, §7.3)
4. **koscriber 생태계와 양방향 DB interop가 범위.** 지금은 v2 코퍼스(573곡, ES 23곡)를 scoresentation으로 수입하고, 이후 데스크톱 편집분이 koscriber 찬양모드로 역류(수출 계약 §8.6).

---

## SPEC 분해 제안

### 요구 모듈 전수 (초기 식별)

전 초기 범위를 요구 모듈로 나누면 다음 7개다:

| # | 요구 모듈 | 의존 |
|---|---|---|
| RM1 | 캐노니컬 doc 데이터 모델(음절 1급 + ko/es/en + 경계/멜리스마 + 슬라이드 그룹 + 안정 음절 ID) | — |
| RM2 | v2→데스크톱 수입 + 슬라이드 그룹 백필 | RM1 |
| RM3 | user overlay 처분 + 전방 스키마 마이그레이션 | RM1 |
| RM4 | 이중 가사 뷰어 렌더(KO 1:1 + 외국어 N:1) | RM1 |
| RM5 | 슬라이드 편집기 GUI(음절 결속 + 3중 저장 게이트) | RM1, RM4 |
| RM6a | (rev,contentHash) 원장 **기초 프리미티브** (스키마·해시 계산·저장) | RM1 |
| RM6b | koscriber 수출 + 3-way 병합 **실행** | RM6a |
| RM7 | 레거시 데이터 정리(#204 아멘, `score-축복의 사람` 중복) | RM1 |

> 게이트(D3) 확정에 따라 원 RM6이 둘로 분할됐다: **RM6a(원장 기초)는 데이터 기반과 함께 SPEC-001에 편입**(spec.md RM-D), RM6b(수출·병합 실행)만 SPEC-003.

### 결정: 단일 SPEC이 아니라 **3개 SPEC 분할을 권고**

7개 요구 모듈은 **모듈-per-SPEC ≤5 규칙**(moai-workflow-spec)을 단일 SPEC으로는 위반한다. 그러나 분할의 1차 근거는 크기가 아니라 **의존 구조의 자연 절단면**이다:

- RM1(+RM2/RM3/RM7)이 **모든 것의 하드 선행조건**이다. 데이터 모델·수입·처분이 끝나기 전엔 뷰어도 편집기도 수출도 소비할 대상이 없다.
- RM4(뷰어)와 RM6(수출)은 **서로 독립**이다. 뷰어는 수출을 필요로 하지 않고, 수출은 GUI를 필요로 하지 않는다 → RM1 완료 후 병렬 진행 가능.
- RM4(뷰어)와 RM5(편집기)는 **강결합**이다. 편집기는 뷰어의 음절-결속 렌더 코어를 재사용한다(research §5.3 렌더 파이프라인, §5.7 "char 위치 로직 → 음절 ID 결속 rewrite"). 둘을 다른 SPEC으로 쪼개면 인위적 인터페이스 이음새·churn만 생긴다.

| SPEC | 범위(마일스톤) | 요구 모듈 | spec.md 모듈 | 의존 | 상태 |
|---|---|---|---|---|---|
| **SPEC-LYRICS-001** (본건) | **M1 데이터 기반** | RM1, RM2, RM3, RM6a, RM7 | RM-A~RM-E (5) | — | 기반. 최우선 |
| SPEC-LYRICS-002 (예정) | M2 뷰어 + M3 편집기 | RM4, RM5 | — | 001 | 001 완료 후 |
| SPEC-LYRICS-003 (예정) | M4 수출/동기화 | RM6b | — | 001 | 001 완료 후, 002와 병렬 |

**권고: 위 3-SPEC 분할.** 각 SPEC ≤5 모듈을 만족하고, 절단면이 실제 의존 경계(001=병목 기반, 002·003=상호 독립 하류)와 일치한다.

> 본 plan.md는 LYRICS 이니셔티브의 **엄브렐러 계획 초안**이다(진입 SPEC 001 디렉터리에 보관). 아래 마일스톤 분해는 M1–M4 전체를 다루되, **001의 실제 구현 범위는 M1**이며 M2–M4는 하류 SPEC 002/003으로 이관됨을 명시한다.

### 대안(비권고)

- **대안 A — 단일 SPEC-LYRICS-001 + 4 마일스톤:** 사용자 원안. 장점: 문서 1개, 컨텍스트 연속. 단점: 요구 모듈 7개로 ≤5 규칙 위반, RM4/RM5(GUI)와 RM1(데이터)이 한 SPEC에 섞여 게이트/커버리지 경계가 흐려짐.
- **대안 B — 2-SPEC(001 데이터+뷰어 / 002 편집기+수출):** RM4를 001에 붙이면 5모듈로 경계선이며, 수출(RM6)과 편집기(RM5)를 묶으면 상호 무관한 둘을 강제 결합. 의존 절단면과 어긋나 비권고.

---

## 아키텍처 방향 (D1–D10)

기본은 research §10.7 권고를 따랐고, **게이트(2026-07-11)에서 D1·D3·D6·D7·D8·D10이 사용자 권고 채택으로 확정**됐다. `확정`=연구 검증(전수·교차 대조) 또는 게이트 확정.

| # | 결정 항목 | 입장(확정) | 상태 | 근거 |
|---|---|---|---|---|
| D1 | 데스크톱 데이터 계보 | **후보 A 채택: 신규 `saved_hymns_v3` 테이블, 데스크톱이 캐노니컬 doc 직접 읽기/쓰기** | **확정(게이트 2026-07-11)** | §10.2, §8.1, §3.6 |
| D2 | 슬라이드 그룹 | 결정적 백필 후 영속화(`slideIndex`/`slideBreaks[]`) | **확정** | §8.3 전수 검증(573/2,330/7,433, 결번 0) |
| D3 | R12 편집 권위·동기화 방향 | **데스크톱 편집 권위 + 배치 원장 동기화(rev+contentHash, 3-way 병합), 실시간 데몬 없음** | **확정(게이트 2026-07-11)** | §8.6, §9.4-1, 바인딩 4 |
| D4 | 곡 내구 키 | `category+number`(CCM=제목), export 순번 id 대외 격리 | **확정** | §8.7 558:558 완전일치, 제목불일치 0 |
| D5 | pitch 라벨 | 표준 음명 문자열 선언, **데이터 무변경**, 문서 부채만 정리 | **확정** | §7.4 4-코퍼스 교차 대조, 의혹 기각 |
| D6 | 편집기 (→SPEC-002) | 별도 페이지 + 음절 ID 결속 + 3중 저장 게이트 + 수동 주석 보존 | **확정(게이트 2026-07-11)** | §5.6, §5.7, §10.3 |
| D7 | user overlay 처분 | **15 중복행: 새 baseline이 내용 승계 입증 후에만 폐기 / 7 사용자 곡: 캐노니컬 승격 후 보존 / app_meta: v3 역방향 키 재설계** | **확정(게이트 2026-07-11)** | §6.7, §8.4 갭 조사 확정 |
| D8 | 레거시 데이터 정리 | **#204 후렴 '아 멘' = v2 정본(아멘 없음) / `score-축복의 사람` 중복 = 셋리스트 참조 확인 후 미참조본 폐기** | **확정(게이트 2026-07-11)** | §8.3(#204), §3.3, §9.4-3·4 |
| D9 | 신곡 기본 규칙 | 4마디=1줄, 2줄=1슬라이드 | **확정** | §8.3·§10.5 코퍼스 90.6% 2줄 |
| D10 | 메타·확장 필드 | **`tempo`/`newTitle` 무손실 보존 / `wbEs` end/standalone 도입(신 스키마) / beamGroup 데이터 보존 + 데스크톱 렌더 유지(→SPEC-002)** | **확정(게이트 2026-07-11)** | §9.4-5·6·7 |

### D1 (근본, 확정) — 데스크톱은 캐노니컬 doc을 직접 읽는가, v2를 v1로 하향 변환하는가

- **확정: 후보 A.** 데스크톱이 신규 **`saved_hymns_v3` 테이블**의 캐노니컬 doc을 직접 읽고 쓴다. `schema_version` + `_initUserSchema`(`[S]/main/db.js:41-58`, 확인됨) 전방 마이그레이션. 근거: v2→v1 하향 변환은 `koJoinPrev/koJoinNext/esJoinNext`·`wbEs`를 담을 자리가 v1 스키마에 없어 **구조적 손실**(§8.1); 역변환 도구도 전무(§3.6). 백지 재설계 취지에 부합.
- (기각) 후보 B: v2→v1 하향 변환기 — 기존 뷰어/편집기 무수정 이점이 있으나 큐레이션 손실·라운드트립 부담으로 바인딩 1·3과 상충하여 기각.
- baseline/user overlay·tombstone·`hymn-saved` 브로드캐스트 체인(§6.4~6.5)은 검증된 재사용 인프라로 승계. v1 `saved_hymns` 테이블과 물리 분리(신규 테이블)라 롤백·공존 안전.

### D3 (근본, 확정) — R12: 편집 권위와 동기화 방향

- **확정: 후보 A.** 데스크톱을 새 캐노니컬 포맷의 편집 권위로 이관, mobile v2는 수출 대상으로 전환. 동기화는 곡 단위 **(rev, contentHash) 원장** 기반 **배치** 3-way(공통 조상) 병합(§8.2, §10.4). 수입=M1(SPEC-001, 원장 기초 프리미티브 포함), 수출·병합 실행=M4(SPEC-003). 바인딩 4("데스크톱 편집분이 koscriber로 역류")와 정합.
- (기각) 후보 B: 데스크톱 편집 동결 — 바인딩 4(역류)와 정면 충돌하여 기각.
- **[HARD] 실시간 라이브 양방향 자동 동기화 데몬은 범위 제외**(과설계 방지) — 배치 원장 방식만. SPEC-001은 원장 스키마·해시 계산 등 **기초(foundation)만** 구축하고, 실제 3-way 병합·수출 실행은 SPEC-003으로 이관.

### D2·D4·D5·D9 (확정) — 재검증 불요

- **D2:** line id 숫자부 산술로 v1 슬라이드 경계가 결정적 백필됨. 573곡 전수에서 결번 0·구조 불일치 0(§8.3). 단 #204 아멘 1건은 데이터 선택(→D8).
- **D4:** 찬송가 number 558:558 완전일치·제목불일치 0(§8.7). export 순번 id는 불안정 키라 대외 표시용으로만.
- **D5:** 전 코퍼스 pitch가 이미 표준 음명. NWC 원본 == v1 DB == v2 DB == web JSON 4중 일치(§7.4). 데이터 작업 없음; `[S]/tools/nwc_to_hymns.py`의 낡은 헤더·죽은 코드·`pitchLabelVersion` 문서 부채만 정리.
- **D9:** 코퍼스 2줄 슬라이드 90.6% → 신곡 기본값 확정(§10.5).

### D6·D7·D8·D10 (확정, 게이트 2026-07-11)

- **D6 (실현=SPEC-002):** 별도 페이지(`src/slide-editor.html`) — `app://`가 `src/` 임의 파일 서빙 + `setWindowOpenHandler`(`[S]/main.js:99-117`, 확인됨)로 main.js 무수정 창 오픈(§5.6-1). 5.6k줄 `editor.js`에 증축 금지. 음절 ID 결속 + 3중 저장 게이트 + 수동 주석 보존. SPEC-001은 이 편집기가 소비할 캐노니컬 모델·불변식만 정의.
- **D7:** user overlay 22행 = ES 중복 15 + 순수 사용자 곡 7(§6.7 확정). **확정 절차:** 15행은 새 캐노니컬 baseline이 내용 승계를 **입증한 뒤에만** 폐기; **7 사용자 곡은 캐노니컬로 승격한 뒤 보존**; `app_meta` 단방향 정리(origin/main `main/db.js:71-103`)는 **v3 역방향 키로 재설계**. 마이그레이션은 idempotent(재실행 안전)·백업 선행.
- **D8:** **#204 후렴 '아 멘' = v2 정본 채택(아멘 슬라이드 없음)** — v2가 최신 큐레이션 정본이며 §6.6d 규약과 정합. `score-축복의 사람`/`축복의 사람` 중복 = **셋리스트 `payload.songId` 참조 전수 확인 후 미참조본 폐기**(기본 `score-` 접두본).
- **D10:** **`tempo`/`newTitle` 무손실 보존**(doc 메타 필드, 렌더 안 함), **`wbEs`에 end/standalone 도입**(신 캐노니컬 스키마), **beamGroup 데이터 보존 + 데스크톱 렌더 유지**(mobile 뷰어 미렌더는 격차로 수용; 렌더 실현은 SPEC-002).

---

## 마일스톤별 작업 분해

우선순위 = 의존 순서(선행 마일스톤 완료 후 착수). **DELTA 표기:** `[EXISTING]`(불변, characterization만) · `[MODIFY]` · `[NEW]` · `[REMOVE]`. 이 프로젝트는 brownfield이므로 기존 계약을 먼저 characterization으로 잠근 뒤 변경한다.

### M1 — 데이터 기반 (SPEC-LYRICS-001, Priority High)

- **[NEW] 캐노니컬 doc 스키마 정의(RM1):** 음절 1급(`syllables[]`) + `surface{ko,es,en}` + `wordBoundary`/`wbEs` + `melisma`/`continuation` + `notes[]`(pitch 표준음명/dur/dotted/accidental/beamGroup/fermata) + **안정 음절 ID**(위치결속 취약성 제거, §7.1) + **슬라이드 그룹**(`slideIndex` 또는 섹션 `slideBreaks[]`) + 큐레이션 필드(`koJoinPrev`/`koJoinNext`/`esJoinNext`) 1급 + 곡 메타(`category`/`number`/`newNumber`/`key`/`timeSignature`/`tempo`?/`newTitle`?) + `schemaVersion`/`rev`/`sourceHash`/`_provenance`. (§10.1)
- **[NEW] `[S]/tools/import_v2_to_desktop.py`(RM2):** `[M]/data/scoresentation_v2.db`(mode=ro) → 캐노니컬 doc 정본 수입. Python `sqlite3`만, 편집 후 `PRAGMA wal_checkpoint(TRUNCATE)`. Reference: `[M]/tools/migrate_to_v2.py`, `[M]/tools/import_praise_songs.py:76-126`, `[M]/tools/export_songs.py`.
- **[NEW] `[S]/tools/backfill_slidegroups.py`(RM2):** §8.3 line-id 산술(`s{sid}.{n}` 누적 줄수 `C[]` 매핑)로 573곡 슬라이드 그룹 결정적 백필. Reference: `[M]/tools/migrate_to_v2.py:320-371`.
- **[MODIFY] `[S]/main/db.js`(RM1/RM3):** 캐노니컬 테이블(D1 형식 확정 후) + `schema_version` 컬럼 + `_initUserSchema`(`main/db.js:41-58`, 확인됨) 전방 마이그레이션 추가. `getHymn`/`saveHymn` 오버레이·tombstone 체인(`main/db.js:128-197`)은 캐노니컬 소비로 확장.
- **[MODIFY] `[S]/main/db.js`(RM3):** user overlay 처분 마이그레이션 **재설계**(v3 역방향 키; 15 중복행 폐기 / 7 사용자 곡 캐노니컬 승격 / `app_meta` 정리) — 새 baseline이 15곡 내용 포함 검증 후에만 폐기. **[REMOVE]** origin/main `_runOneTimeMigrations`(`main/db.js:71-103`)의 단방향 stale-override 정리 로직은 새 방향과 상충하므로 폐기/역설계.
- **[NEW] baseline `[S]/data/scoresentation.db`(RM2):** 캐노니컬 테이블 생성(import tool 산출물, Python sqlite3). 런타임 read-only + `query_only=ON` 유지(§6.1). 릴리스 전 checkpoint 필수(패키징 `!*.db-wal` 필터, §8.5).
- **[MODIFY]/[REMOVE] 레거시 정리(RM7):** #204 아멘 = v2 정본(아멘 없음), `score-축복의 사람` 중복 = 셋리스트 참조 확인 후 미참조본 폐기 — import 스크립트에 반영.
- **[NEW] 원장 기초 프리미티브(RM6a):** 곡 단위 `(rev, contentHash)` 원장 스키마 + 결정적 콘텐츠 해시 계산·저장. v2 `rev`/`source_hash` 신뢰 불가(§8.2) → 원장 초기화 시 해시 재계산. **기초만** — 3-way 병합·수출 실행은 SPEC-003. Reference: research §8.2, §10.4.
- **[EXISTING] characterization만:** `app://` user우선+baseline폴백(`main.js:47-81`), `hymn-saved`/`hymn-deleted` 브로드캐스트→리빌드(`main.js:177-191`, `present.js:487-520`), baseline read-only.

### M2 — 이중 가사 뷰어 (SPEC-LYRICS-002, Priority High)

- **[MODIFY] `[S]/src/present.js`(RM4):** `buildSlidesForHymn`(`present.js:2257-2367`)·`buildSlidesForItem`(:2133-2211)을 캐노니컬 doc 소비로 확장 — KO 1:1 + 외국어 N:1 이중 가사 슬라이드, 멜리스마/continuation 처리.
- **[NEW] 음절-결속 렌더 모듈(RM4):** 음절 단위 표면 선택·KO 폴백 금지·es=null 병합·1음절 2단어 균등분산 규칙. Reference: `[M]/web/js/viewer.js`(64-163), `[M]/web/js/notes-minimal.js`(음절별 미니 SVG).
- **[MODIFY] `[S]/src/notes.js`(RM4):** char 위치 측정(`notes.js:661-697`) 기반을 **음절 ID 결속**으로 이행(§5.7 rewrite 항목). Reference: `notes.js:503-593,599-656`.
- **[MODIFY] `[S]/src/index.html`:** 로드 순서 편입(`index.html:320-328`).
- **[EXISTING] characterization만:** 줌=폰트배율(`present.js:404-443`), 테마 토글, 절 뱃지 위치(`present.js:2437-2462`), nav order(절→후렴 인터리브, `present.js:2489-2537`).

### M3 — 슬라이드 편집기 GUI (SPEC-LYRICS-002, Priority Medium)

- **[NEW] `[S]/src/slide-editor.html` + `slide-editor.js`(RM5):** 별도 페이지. Reference(구조): `[S]/src/editor.html` + `editor.js`(단, char-position 로직은 재사용 않고 음절 ID 결속으로 신규 작성). 설계 입력: MVP-plan v2 편집기(§5.7, `[M]/docs/MVP-plan.md:492-516`).
- **[NEW] 편집 시맨틱(RM5):** 문장 입력→음절 자동분절+수동 보정, 음절별 1:N 음표 부착, KO/ES 병기 편집(EN은 `altLanguages` 별도 트랙), 파생 필드 재산출(`leadSpace`/`wbEs`/span 내 공백, §5.7).
- **[NEW] 3중 저장 게이트(RM5):** ① KO 글리프==음표수 ② ES letter-only 재조립==원문 ③ **공백 포함 `wbEs` 그룹 대조**(audit 동치) — letter-only만으론 불충분(§3.7, §5.7). Reference: `[M]/tools/audit_es_spacing.py`, `fix_es_spacing.py`.
- **[NEW/WARN] 수동 주석 보존(RM5):** `koJoin*`/`esJoinNext`를 편집 op로 노출하거나 최소 라인 교체 저장 시 보존하는 병합 규칙(§5.7 ★경고 — 21~27차 QC 자산 파괴 방지).
- **[MODIFY] `[S]/preload.cjs` + `main.js`(RM5):** 캐노니컬 저장 IPC 추가(`preload.cjs:3-45`, `main.js:164-193` 핸들러 패턴), `setWindowOpenHandler`(`main.js:99-117`) 창 분기(필요 시).
- **[EXISTING] characterization만:** `editor.js` char-position 로직은 **참조만**(재사용 안 함, 별도 파일); `hymns:save`→리빌드 체인, `setDirty` 닫기 가드(§5.6-6).

### M4 — 수출 / 동기화 실행 (SPEC-LYRICS-003, Priority Medium)

> 원장 **기초**(스키마·해시)는 M1/SPEC-001(RM6a)에 있고, M4는 그 위에서 **병합·수출 실행**만 담당한다(RM6b).

- **[NEW] `[S]/tools/export_desktop_to_koscriber.py`(RM6b):** 캐노니컬 → `web/songs/*.json` + `index.json` 계약 동형 산출(`hasEs`/`hasNotes`/`line`/id 의미 §8.6). Reference: `[M]/tools/export_songs.py:34-79`.
- **[NEW/WARN] `[S]/tools/reconcile_ledger.py`(RM6b):** M1이 구축한 (rev, contentHash) 원장 위에서 곡 단위 3-way(공통 조상) 병합(§8.2). LWW(`sync-to-baseline.py:59-68`) 사고 방지.
- **[NEW] 재빌드 체인 완주 = 완료 조건(RM6):** export→review HTML/PDF→fallback(`[M]/docs/HANDOFF.md:209`)까지가 "동기화 완료" 정의(§8.6-d). id 안정성은 number 기반 주소 이행과 함께 처리 권고.
- **[EXISTING] characterization만:** koscriber serving/embed 계약(`[K]/backend/main.py:3059-3082`, postMessage/URL §2.4) — **무변경**.

---

## 파일 목록 (생성/수정 대상 + 레퍼런스)

### 신규(NEW)

| 파일 | 목적 | Reference |
|---|---|---|
| `[S]/tools/import_v2_to_desktop.py` | v2 doc → 캐노니컬 수입 | `[M]/tools/migrate_to_v2.py`, `[M]/tools/import_praise_songs.py:76-126` |
| `[S]/tools/backfill_slidegroups.py` | line-id 산술 슬라이드 백필 | `[M]/tools/migrate_to_v2.py:320-371`; research §8.3 |
| `[S]/tools/export_desktop_to_koscriber.py` | 캐노니컬 → web/songs + index.json | `[M]/tools/export_songs.py:34-79` |
| `[S]/tools/reconcile_ledger.py` | (rev,contentHash) 3-way 원장 | `[S]/tools/sync-to-baseline.py:51-68`; research §8.2 |
| `[S]/src/slide-editor.html` + `slide-editor.js` | 별도 편집기 페이지 | `[S]/src/editor.html`+`editor.js`(구조); `[M]/docs/MVP-plan.md:492-516`(설계) |
| 음절-결속 렌더 모듈 (`[S]/src/notes-syllable.js` 등) | 음절 단위 이중 가사 렌더 | `[M]/web/js/viewer.js:64-163`, `[M]/web/js/notes-minimal.js:105-192` |

### 수정(MODIFY)

| 파일 | 변경 | Reference |
|---|---|---|
| `[S]/main/db.js` | 캐노니컬 테이블 + schema_version + 전방/처분 마이그레이션 | `main/db.js:41-58`(확인됨), :128-197 |
| `[S]/preload.cjs` | 캐노니컬 저장/조회 IPC | `preload.cjs:3-45` |
| `[S]/main.js` | IPC 핸들러 등록 + (필요 시) 창 분기 | `main.js:164-193`, :99-117(확인됨) |
| `[S]/src/present.js` | 캐노니컬 doc 소비 이중 가사 슬라이드 | `present.js:2133-2367` |
| `[S]/src/notes.js` | char 위치 → 음절 ID 결속 | `notes.js:503-593,599-656,661-697` |
| `[S]/src/index.html` | 렌더 모듈 로드 순서 | `index.html:320-328` |

### 데이터(DATA, Python sqlite3 전용, checkpoint 필수)

| 파일 | 변경 | 제약 |
|---|---|---|
| `[S]/data/scoresentation.db` | 캐노니컬 테이블 신설(import 산출) | 런타임 read-only; 릴리스 전 checkpoint |
| `[U]/scoresentation-user.db` | overlay 처분 마이그레이션(15 폐기/7 승격) | 파괴적 — 게이트 확정 후 |

### 문서 부채 정리(REMOVE/MODIFY)

- `[S]/tools/nwc_to_hymns.py`: 낡은 '한 단계 낮춤' 헤더(:12)·죽은 `V2_SHIFT`/`to_v2_pitch`(:26-35)·`pitchLabelVersion=2`(:153) 정리(§7.4).
- origin/main `[S]/main/db.js:71-103` `_runOneTimeMigrations` 단방향 로직: 새 방향과 상충 → 역설계/폐기(§8.4).

---

## 리스크 및 완화 (research §9.1 기반, 마일스톤 연계)

| # | 리스크 | 완화 | 연계 |
|---|---|---|---|
| R1 | 큐레이션 소실 — `koJoin*`/`wbEs`/재띄어쓰기가 재마이그레이션·부주의 저장(`line-replace`)으로 파괴(§8.1, §5.7 ★) | 캐노니컬이 큐레이션 필드를 1급 수용; 편집기 저장 시 보존/재산출 규칙 명문화; koJoin* 생존 characterization 테스트 | M1, M3 |
| R2 | user overlay 마스킹 — baseline 수입 후에도 동일 number user 행이 영구히 가림(§8.4) | 처분 마이그레이션(15 폐기, 새 baseline 내용 승계 검증 선행); 7 사용자 곡 승격 | M1 |
| R3 | LWW 병합 사고 — `sync-to-baseline.py` 무충돌검사 REPLACE(§8.5) | (rev,contentHash) 원장 3-way 병합으로 대체 | M4 |
| R4 | rev/updated_at 신뢰 불가 — 변경 이력 프리미티브 부재(§8.2) | 원장 초기화 시 콘텐츠 해시 재계산; 데스크톱 쪽 `schema_version` 도입 | M1, M4 |
| R5 | ES 검증 사각지대 — letter-only 게이트가 띄어쓰기·대소문자 누락(§3.7) | 3중 저장 게이트(공백 포함 wbEs 그룹 대조 포함) | M3 |
| R6 | 위치결속 편집 취약성 — 중간 삽입 시 음표 전체 밀림(§7.1) | 안정 음절 ID 결속(새 모델의 존재 이유) | M1, M2/M3 |
| R7 | 빔 렌더 격차 — v2 데이터에 beamGroup(최대 25), mobile 미렌더/데스크톱 렌더(§9.1-7) | D10 게이트 결정; 캐노니컬은 데이터 보존, 데스크톱 렌더 유지, 수출 시 무손실 | M2, M4 |
| R8 | 버전 스큐 — v1.7.1 미푸시 로컬 전용(§1.3) | 커밋 해시 `37880b4`로만 참조; v1.7.x는 폐기 대상 데이터로만 취급 | M1 |

---

## 테스트 전략 (TDD RED-GREEN-REFACTOR, 커버리지 85%)

Brownfield이므로 **§9.2 암묵적 계약을 characterization 테스트로 먼저 잠근 뒤** 변경한다.

### 보호할 암묵적 계약 (characterization, 마일스톤 착수 전)

- `hymn-saved`/`hymn-deleted` 브로드캐스트 → 프레젠테이션 자동 리빌드(`main.js:177-191`, `present.js:487-520`) — M1/M3 착수 전.
- `app://` user우선+baseline폴백 경로 해석(`main.js:47-81`) — M1 착수 전.
- baseline read-only + `query_only=ON`; 패키징 `!*.db-wal` 필터 — M1 착수 전.
- 파생 nav order(절→후렴 인터리브, 저장 안 함)(`present.js:2489-2537`) — M2 착수 전.
- koscriber 임베드 postMessage/URL 계약(`?embed/pane/theme/song/line/lang`, `kosHymnPos`, §2.4) — M4 착수 전(무변경 회귀 방지).

### 마일스톤별 TDD 사이클

- **M1:** RED=캐노니컬 스키마 라운드트립(수입→읽기→동일) 실패 테스트 / 슬라이드 백필 결정성(573곡 결번 0) / overlay 처분 규칙(15 폐기·7 보존) 실패 테스트. GREEN=최소 스키마+import+백필. REFACTOR. 원장/해시 유닛 테스트 포함.
- **M2:** RED=이중 가사 렌더(KO 1:1, ES N:1, 멜리스마/continuation, es=null 병합) 스냅샷 실패. GREEN=렌더 모듈. characterization으로 줌/테마/뱃지/nav 회귀 감시.
- **M3:** RED=3중 저장 게이트(글리프==음표, ES 재조립==원문, wbEs 공백 대조) 각 실패 케이스 + `koJoin*` 보존 실패. GREEN=편집·게이트·보존 병합. 음절 자동분절 유닛.
- **M4:** RED=export index.json 계약 동형(hasEs/hasNotes/line 의미) 실패 + 원장 3-way 충돌 케이스. GREEN=export+reconcile. 재빌드 체인 스모크.

### 운영 규율(불변)

DB 스크립트는 Python `sqlite3`만 + `PRAGMA wal_checkpoint(TRUNCATE)`; baseline read-only; 릴리스는 자체검증 publish 체인 무변경(§10.6, CLAUDE.md, `tools/check-native-abi.cjs`).

---

## mx_plan (@MX 주석 대상)

- **@MX:ANCHOR** (public API 경계 / fan_in≥3):
  - `[S]/main/db.js` 캐노니컬 doc 읽기/쓰기 진입점(`getHymn`/`saveHymn` 확장 — 다수 호출부).
  - `preload.cjs`/`main.js` 신규 캐노니컬 IPC 채널(렌더러 다수 소비).
  - 음절-결속 렌더 모듈의 공개 렌더 함수(뷰어·편집기 공통 소비, §5.3).
- **@MX:WARN** (위험 구역, @MX:REASON 필수):
  - `reconcile_ledger.py` 3-way 병합 로직(REASON: LWW 사고·큐레이션 소실 위험 §8.2·§8.1).
  - 편집기 라인 교체 저장의 `koJoin*` 보존 병합(REASON: 21~27차 수기 QC 자산 파괴 위험 §5.7 ★).
  - overlay 처분 마이그레이션(REASON: 사용자 실데이터 파괴적 §8.4).
- **@MX:NOTE** (데이터 규약):
  - 멜리스마: KO=`notes.length>1`+`melisma`, continuation=`ko:""`(§7.2); 슬라이드 그룹=line-id 산술(§8.3); pitch=표준 음명 문자열(§7.4); ES 마커 `~`=결합/`‿`=연음(§3.7); 아멘=마지막 절 끝 1회(§6.6d).

---

## 게이트 확정 답변 (2026-07-11, 미해결 질문 전부 종결)

1. **D3/R12 — 양방향 동기화 범위·방식.** 확정: **데스크톱 편집 권위 + (rev,contentHash) 배치 원장(수입=M1 기초, 수출·병합=M4/SPEC-003). 실시간 라이브 자동 동기화 데몬 제외.**
2. **D1 — 캐노니컬 저장 형식.** 확정: **신규 테이블 `saved_hymns_v3`.** 오버레이/tombstone 체인 재사용, v1 테이블과 물리 분리 → 롤백·공존 안전.
3. **D8 — #204 후렴 '아 멘' 슬라이드 정본.** 확정: **v2 정본(아멘 슬라이드 없음).** §6.6d 규약과 정합.
4. **D8 — `score-축복의 사람`/`축복의 사람` 중복.** 확정: **셋리스트 `payload.songId` 참조 전수 확인 후 미참조본 폐기**(기본 `score-` 접두본).
5. **D10 — `tempo`/`newTitle`·빔 처리.** 확정: **`tempo`/`newTitle` 무손실 보존(렌더 안 함); beamGroup 데이터 보존 + 데스크톱 렌더 유지(mobile 미렌더는 격차 수용); `wbEs` end/standalone 도입.**
6. **D7 — user overlay 처분 절차·타이밍.** 확정: **새 baseline이 15곡 내용 승계 입증 후에만 15행 폐기; 7 사용자 곡은 폐기 전 캐노니컬 승격 필수; `app_meta`는 v3 역방향 키 재설계; 마이그레이션은 idempotent·백업 선행.**

---

## Exclusions (What NOT to Build)

- **koscriber 백엔드 변경 없음** — 문서화된 정적 serving/embed 계약(`[K]/backend/main.py:3059-3082`, `?embed/pane/theme/song/line/lang`, §2.4) 외에는 손대지 않는다.
- **v1→v2 재마이그레이션 없음** — v2 문서를 정본으로 수입한다. v1 재변환은 21~27차 큐레이션 손실을 유발(§8.1)하므로 금지.
- **anchored 레이아웃 포팅 없음** — v1.7.0 스페인어 구현·anchored 정책·"natural+justify"는 설계 입력이 아니다(바인딩 1). 폐기 대상 데이터로만 참조.
- **릴리스/publish 파이프라인 변경 없음** — 자체검증 publish 체인·ABI 가드·WAL 필터는 무변경(§10.6, CLAUDE.md).
- **실시간 라이브 양방향 자동 동기화 데몬 없음** — 배치 원장 방식만(과설계 방지, D3).
- **EN(`altLanguages.en`) 음표 결속·렌더 없음** — 영어는 텍스트 트랙만 유지. 음표 결속은 mobile M7 과제로 범위 밖(§3.4, §7.2).

---

## 다음 단계

게이트 확정 완료(2026-07-11) → **Phase 2 진행 중**: SPEC-LYRICS-001의 `spec.md`(EARS, 요구 모듈 RM-A~RM-E, M1 범위) + `acceptance.md`(Given-When-Then) + `spec-compact.md` 작성. RM-D는 원장 **기초 프리미티브만**(수출·병합 실행은 SPEC-003). 브랜치 생성(aa43aab 기점)은 별도 단계(manager-git). 뷰어·편집기(SPEC-002)·수출 실행(SPEC-003)은 후속 SPEC.
