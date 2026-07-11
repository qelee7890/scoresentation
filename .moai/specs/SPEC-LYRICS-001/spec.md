---
id: SPEC-LYRICS-001
version: 0.1.1
status: draft
created: 2026-07-11
updated: 2026-07-11
author: qelee7890
priority: high
issue_number: 0
---

# SPEC-LYRICS-001 — 한-외국어 이중 가사 캐노니컬 데이터 기반 (M1)

## HISTORY

- **v0.1.1** (2026-07-11): **감사 minor 6건 반영**(plan-auditor iteration 1, PASS 0.90). ① REQ-LYR-023 (Unwanted)→(Ubiquitous, 부정형) 재분류 + EARS 유형 커버리지 표 갱신 ② REQ-LYR-040 `[EXISTING/MODIFY]`→`[EXISTING]` ③ REQ-LYR-012 범위 밖 '수출' 언급 제거(SPEC-003 이관 명시) ④ REQ-LYR-031 읽기 프리미티브 3종 구체 열거 ⑤ REQ-LYR-011 트리거를 곡 단위 이벤트로 명확화 ⑥ `sys.exit(1)` → "0이 아닌 종료 코드", `payload.songId` 표현을 데이터 계약 참조로 재서술. 요구 실체·모듈/REQ 수(5모듈·20건) 불변.
- **v0.1.0** (2026-07-11): 최초 작성. 게이트 확정(plan.md v0.2.0, 2026-07-11)을 반영한 M1 "데이터 기반" 요구명세. 요구 모듈 5개(RM-A~RM-E), EARS 요구 20건(REQ-LYR-001~043), Exclusions 7건. 뷰어·편집기(SPEC-002)·수출 실행(SPEC-003)은 범위 밖.

---

## 개요 (WHAT / WHY)

scoresentation(Electron 찬송가 프레젠테이션 앱)에 **한글 1음절:1음표(멜리스마 포함)와 외국어 N글자:1음표를 모두 1급으로 표현하는 캐노니컬 데이터 모델**을 도입하고, mobile/koscriber **v2 코퍼스(573곡, ES 23곡)를 데스크톱으로 수입**하며, **레거시 v1.7.x user overlay를 안전 처분**하고, **양방향 동기화의 원장 기초**를 놓는다. 설계 모델은 v2 음절-음표 구조(research §2, §7.2). 본 SPEC은 M1(데이터 기반)만 다룬다 — 렌더/편집기는 SPEC-002, 수출·병합 실행은 SPEC-003.

경로 약어: `[S]`=scoresentation, `[M]`=scoresentation-mobile, `[K]`=koscriber-soniox, `[P]`=praise-spanish, `[U]`=`%APPDATA%/Scoresentation/data`. 근거는 `research.md` 섹션·`path:line`으로 추적한다.

## 환경·전제 (Assumptions)

- 기준 코드베이스 = `pre-spanish`(커밋 `aa43aab`, v1.5.9). 스페인어 코드·데이터 없음.
- v2 코퍼스 `[M]/data/scoresentation_v2.db`(573곡)가 가사·음표 데이터의 단일 권위이자 설계 기준(research §1.3, §3.1).
- v1.7.0 스페인어 구현·anchored 레이아웃은 설계 입력이 아니며 폐기/마이그레이션 대상(research §8.4).
- DB 스크립트는 Python `sqlite3`만 사용, baseline은 read-only, 편집 후 `PRAGMA wal_checkpoint(TRUNCATE)`(CLAUDE.md, research §6.1·§8.5).
- 검증된 인프라(baseline+user overlay·tombstone·`hymn-saved` 브로드캐스트)는 승계(research §6.4~6.5).

## 요구 모듈 (5개, M1 범위)

| 모듈 | 이름 | REQ 범위 |
|---|---|---|
| RM-A | 캐노니컬 doc 모델·스키마 | REQ-LYR-001~005 |
| RM-B | v2→데스크톱 수입 파이프라인 | REQ-LYR-010~013 |
| RM-C | 레거시 처분·마이그레이션 | REQ-LYR-020~024 |
| RM-D | 동기화 원장 기초 | REQ-LYR-030~031 |
| RM-E | 데이터 무결성 불변식 | REQ-LYR-040~043 |

---

## EARS 요구명세

DELTA 표기: `[EXISTING]`(불변·characterization) · `[MODIFY]` · `[NEW]` · `[REMOVE]`.

### RM-A — 캐노니컬 doc 모델·스키마

- **REQ-LYR-001** [NEW] (Ubiquitous): 시스템은 모든 곡을 **음절 1급(syllable-first)** 캐노니컬 문서로 표현하며, 각 음절은 자신의 `notes[]`를 소유(한글 1:N)하고 다국어 표면 슬롯 `surface{ko, es, en}`를 가진다. (§7.2, §10.1)
- **REQ-LYR-002** [NEW] (Ubiquitous): 시스템은 캐노니컬 문서를 v1 `saved_hymns`와 **물리적으로 분리된 신규 `saved_hymns_v3` 테이블**(baseline + user overlay)에 `schema_version`과 함께 영속화한다. (D1 확정, §8.5)
- **REQ-LYR-003** [NEW] (Optional): **Where** 한 음절이 외국어 표면(`es`)을 가지면, 캐노니컬 모델은 N글자를 한 음표 슬롯에 결속하고 언어 독립 단어경계 `wbEs`(end/standalone 포함)를 기록한다. (§7.2, D10 확정)
- **REQ-LYR-004** [NEW] (Ubiquitous): 캐노니컬 문서는 큐레이션 필드(`koJoinPrev`/`koJoinNext`/`esJoinNext`, 수기 재띄어쓰기 결과, 슬라이드 그룹 `slideIndex`/`slideBreaks[]`, **안정 음절 ID**)를 **1급 영속 데이터**로 취급한다. (§8.1, §8.3, §10.1)
- **REQ-LYR-005** [NEW] (Ubiquitous): 캐노니컬 모델은 렌더되지 않는 값(`tempo`/`newTitle`/`beamGroup`/`melisma`/`continuation`/`_provenance`)도 **무손실 보존**한다. (D10 확정, §9.2)

### RM-B — v2→데스크톱 수입 파이프라인

- **REQ-LYR-010** [NEW] (Event-driven): **When** 수입 도구(`[S]/tools/import_v2_to_desktop.py`)가 `[M]/data/scoresentation_v2.db`(read-only, `mode=ro`)에 대해 실행되면, 시스템은 573곡 전부의 캐노니컬 문서를 데스크톱 baseline에 Python sqlite3로 수입한다. (§3.1, §3.6)
- **REQ-LYR-011** [NEW] (Event-driven): **When** 수입 파이프라인이 각 곡을 처리할 때, 시스템은 line id 산술(`s{sid}.{n}` 누적 줄수 `C[]`)로 그 곡의 슬라이드 그룹을 백필하며, 전체 573곡/2,330섹션/7,433줄에서 **결번 0**을 보장한다. (§8.3, D2 확정)
- **REQ-LYR-012** [NEW] (Unwanted): **If** 한 곡의 ES QC 게이트(KO 글리프==음표수 / ES letter-only 재조립==원문 / 공백 포함 `wbEs` 그룹 대조) 중 하나라도 실패하면, **then** 시스템은 **수입을 0이 아닌(비정상) 종료 코드로 중단**하고 실패 곡을 보고하며 손상 데이터를 산출하지 않는다. (동일 QC 게이트의 수출 적용은 SPEC-003으로 이관) (§3.7)
- **REQ-LYR-013** [NEW] (State-driven): **While** 이미 수입된 코퍼스에 수입을 재실행하는 동안, 시스템은 **멱등 upsert**로 동일한 baseline을 산출하며 행을 중복 생성하지 않는다. (§3.6)

### RM-C — 레거시 처분·마이그레이션

- **REQ-LYR-020** [MODIFY] (Event-driven): **When** 데스크톱 앱이 user 스키마를 초기화하면, 시스템은 `saved_hymns_v3`와 `schema_version`을 프로비저닝하는 **전방·멱등·백업 선행** 마이그레이션을 실행한다. (`[S]/main/db.js:41-58`, §6.1)
- **REQ-LYR-021** [MODIFY] (State-driven): **While** 한 user-overlay 행이 15개 ES 중복행 중 하나이고 **동시에** 새 baseline이 그 내용을 승계함이 입증(콘텐츠 동치)된 동안, 시스템은 해당 overlay 행을 폐기한다. (§6.7, §8.4, D7 확정)
- **REQ-LYR-022** [NEW] (Ubiquitous): 마이그레이션은 7개 순수 사용자 곡을 캐노니컬 포맷으로 승격한 뒤 **무조건 보존**한다(폐기 금지). (§6.7, D7 확정)
- **REQ-LYR-023** [REMOVE] (Ubiquitous, 부정형): 시스템은 origin/main의 단방향 `_runOneTimeMigrations` stale-override 정리 로직을 적용하지 **않으며**, `app_meta`는 **v3 역방향 키로 재설계**한다. (§8.4, origin/main `main/db.js:71-103`)
- **REQ-LYR-024** [MODIFY] (Event-driven): **When** #204를 수입하면, 시스템은 **v2 정본(후렴 '아 멘' 슬라이드 없음)**을 채택하고, `score-축복의 사람`/`축복의 사람` 중복은 **셋리스트에서 참조되지 않는 사본을 폐기**하여 해소한다(참조 판정 기준 = 셋리스트 항목의 곡 참조 필드 `payload.songId`). (D8 확정, §8.3, §3.3)

### RM-D — 동기화 원장 기초

- **REQ-LYR-030** [NEW] (Ubiquitous): 시스템은 곡 단위 원장 항목 `(number, rev, contentHash)`를 **결정적 콘텐츠 해시**로 유지하며, 수입 시 초기화한다(v2 `rev`/`source_hash` 불신 — 해시 재계산). (§8.2, §10.4)
- **REQ-LYR-031** [NEW] (Optional): **Where** 원장이 존재하면, 시스템은 다음 **읽기 프리미티브 3종**을 노출한다: ① `lookup(number) → (rev, contentHash)`(곡 단위 원장 조회), ② `computeContentHash(doc) → hash`(결정적 콘텐츠 해시 계산), ③ `baseSnapshot(number) → (rev, contentHash)`(수입 시점 공통 조상 기준선 조회). 이 3종이 SPEC-003의 3-way 병합 경계 협상 기준이며, 본 SPEC에서는 병합·수출을 수행하지 **않는다**(SPEC-003으로 이관). (D3 확정, 범위 경계)

### RM-E — 데이터 무결성 불변식

- **REQ-LYR-040** [EXISTING] (Ubiquitous): baseline DB는 read-only + `query_only=ON`으로 열리며, 시스템은 런타임에 baseline에 **결코 쓰지 않는다**. (§6.1, §9.2)
- **REQ-LYR-041** [NEW] (Unwanted): **If** 한 줄의 KO 글리프 수가 음표 수와 불일치하면, **then** 시스템은 `GLYPH_NOTE_MISMATCH` 경고를 기록하고 잉여 음표를 마지막 음절에 흡수·**보존**한다(가사 날조·거부 금지 — 결함 보존 원칙). (§7.2, §9.2)
- **REQ-LYR-042** [MODIFY] (Ubiquitous): 모든 DB 스크립트 조작은 Python `sqlite3`만 사용하고, 편집 후 `PRAGMA wal_checkpoint(TRUNCATE)`를 실행한다(특히 패키징 직전, `!*.db-wal` 필터). (§8.5, §6.1, CLAUDE.md)
- **REQ-LYR-043** [EXISTING] (Ubiquitous): 시스템은 결함 마커(`textOnly`/orphanNotes/dangling/`_provenance.warnings`)를 보존하며 가사를 날조하지 않는다. (§9.2, `migrate_to_v2.py:17`)

**EARS 유형 커버리지:** Ubiquitous(001·002·004·005·022·023·030·040·042·043, 10건) / Event-driven(010·011·020·024, 4건) / State-driven(013·021, 2건) / Unwanted(012·041, 2건) / Optional(003·031, 2건) — 5종 전부, 총 20건.

---

## 파일 목록 (변경 대상 + Reference)

### 신규(NEW)

| 파일 | 목적 | Reference |
|---|---|---|
| `[S]/tools/import_v2_to_desktop.py` | v2 doc → 캐노니컬 수입 (Python sqlite3, mode=ro) | `[M]/tools/migrate_to_v2.py`, `[M]/tools/import_praise_songs.py:76-126` |
| `[S]/tools/backfill_slidegroups.py` | line-id 산술 슬라이드 백필 | `[M]/tools/migrate_to_v2.py:320-371`; §8.3 |
| `[S]/tools/init_sync_ledger.py` | (rev,contentHash) 원장 기초 초기화 | §8.2, §10.4 |

### 수정(MODIFY)

| 파일 | 변경 | Reference |
|---|---|---|
| `[S]/main/db.js` | `saved_hymns_v3` 테이블 + `schema_version` + 전방/처분 마이그레이션 + 캐노니컬 오버레이 조회 | `main/db.js:41-58`(확인됨), :128-197 |
| `[S]/preload.cjs` | 캐노니컬 조회 IPC(읽기 경로) | `preload.cjs:3-45` |
| `[S]/main.js` | 캐노니컬 IPC 핸들러 등록 | `main.js:164-193` |
| `[S]/tools/nwc_to_hymns.py` | 낡은 '한 단계 낮춤' 헤더·죽은 `V2_SHIFT`/`to_v2_pitch`·`pitchLabelVersion` 정리(문서 부채) | `nwc_to_hymns.py:12,26-35,153`; §7.4 |

### 제거(REMOVE)

| 파일 | 변경 | Reference |
|---|---|---|
| `[S]/main/db.js` (마이그레이션 로직) | origin/main 단방향 `_runOneTimeMigrations` 미승계 | origin/main `main/db.js:71-103`; §8.4 |

### 데이터(DATA, Python sqlite3 전용 + checkpoint)

| 파일 | 변경 | 제약 |
|---|---|---|
| `[S]/data/scoresentation.db` | `saved_hymns_v3` 테이블 신설(import 산출) | 런타임 read-only; 릴리스 전 checkpoint |
| `[U]/scoresentation-user.db` | overlay 처분(15 폐기/7 승격) + `app_meta` v3 재설계 | 파괴적 — 멱등·백업 선행 |

---

## mx_plan (@MX 주석 대상)

- **@MX:ANCHOR** (public API 경계 / fan_in≥3):
  - `[S]/main/db.js` 캐노니컬 doc 읽기 진입점(`getHymn` 확장 — 다수 호출부).
  - `preload.cjs`/`main.js` 신규 캐노니컬 조회 IPC 채널.
- **@MX:WARN** (위험 구역, @MX:REASON 필수):
  - overlay 처분 마이그레이션(REASON: 사용자 실데이터 파괴적 §8.4).
  - 원장 콘텐츠 해시 초기화(REASON: 이후 3-way 병합 정확성의 기준점 §8.2).
- **@MX:NOTE** (데이터 규약):
  - 멜리스마 KO=`notes.length>1`+`melisma`, continuation=`ko:""`(§7.2); 슬라이드 그룹=line-id 산술(§8.3); pitch=표준 음명 문자열(§7.4); ES 마커 `~`=결합/`‿`=연음(§3.7); 아멘=마지막 절 끝 1회(§6.6d).

---

## Exclusions (What NOT to Build)

- **뷰어·편집기 UI 없음** — 이중 가사 렌더(M2)·슬라이드 편집기 GUI(M3)는 **SPEC-002** 범위. 본 SPEC은 이들이 소비할 캐노니컬 모델·불변식만 정의.
- **수출·병합 실행 없음** — koscriber 수출·3-way 병합 실행(M4)은 **SPEC-003** 범위. 본 SPEC은 원장 **기초 프리미티브만** 구축(REQ-LYR-031).
- **anchored 레이아웃 포팅 없음** — v1.7.0 스페인어 구현·anchored 정책·"natural+justify"는 설계 입력 아님(바인딩 1). 폐기 대상 데이터로만 참조.
- **koscriber 백엔드 변경 없음** — 문서화된 정적 serving/embed 계약(`[K]/backend/main.py:3059-3082`) 외 무변경.
- **실시간 라이브 양방향 자동 동기화 없음** — 배치 원장 방식만(D3 확정).
- **v1→v2 재마이그레이션 없음** — v2 문서를 정본으로 수입. v1 재변환은 큐레이션 손실(§8.1)이라 금지.
- **릴리스/publish 파이프라인 변경 없음** — 자체검증 publish 체인·ABI 가드·WAL 필터 무변경(§10.6, CLAUDE.md).

---

## 참조

- 상세 계획·마일스톤·리스크·테스트 전략: `plan.md`(v0.2.0, approved).
- 수용 기준(Given-When-Then): `acceptance.md`.
- 근거(스키마·인용·검증): `research.md`(v1.0).
