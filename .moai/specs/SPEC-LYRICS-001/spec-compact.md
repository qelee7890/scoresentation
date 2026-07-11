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

# SPEC-LYRICS-001 (compact) — 캐노니컬 이중 가사 데이터 기반 (M1)

## REQ (EARS)

DELTA: `[EXISTING]`·`[MODIFY]`·`[NEW]`·`[REMOVE]`.

### RM-A 캐노니컬 doc 모델·스키마
- **REQ-LYR-001** [NEW] (Ubiquitous): 시스템은 모든 곡을 음절 1급 문서로 표현하며 각 음절이 `notes[]`를 소유(KO 1:N)하고 `surface{ko,es,en}`을 가진다.
- **REQ-LYR-002** [NEW] (Ubiquitous): 시스템은 캐노니컬 문서를 v1과 분리된 신규 `saved_hymns_v3`(baseline+overlay)에 `schema_version`과 함께 영속화한다.
- **REQ-LYR-003** [NEW] (Optional): Where 음절이 `es` 표면을 가지면, N글자를 한 음표 슬롯에 결속하고 `wbEs`(end/standalone 포함)를 기록한다.
- **REQ-LYR-004** [NEW] (Ubiquitous): 큐레이션 필드(`koJoinPrev`/`koJoinNext`/`esJoinNext`, 재띄어쓰기, `slideIndex`/`slideBreaks[]`, 안정 음절 ID)를 1급 영속 데이터로 취급한다.
- **REQ-LYR-005** [NEW] (Ubiquitous): 렌더 안 되는 값(`tempo`/`newTitle`/`beamGroup`/`melisma`/`continuation`/`_provenance`)도 무손실 보존한다.

### RM-B v2→데스크톱 수입
- **REQ-LYR-010** [NEW] (Event-driven): When 수입 도구가 v2 DB(read-only)에 실행되면, 573곡 캐노니컬 문서를 데스크톱 baseline에 Python sqlite3로 수입한다.
- **REQ-LYR-011** [NEW] (Event-driven): When 수입 파이프라인이 각 곡을 처리할 때, line id 산술로 그 곡의 슬라이드 그룹을 백필하며 전체 573곡에서 결번 0을 보장한다.
- **REQ-LYR-012** [NEW] (Unwanted): If ES QC 게이트(글리프==음표 / letter-only 재조립 / 공백 wbEs 그룹) 실패 시, then 수입을 0이 아닌 종료 코드로 중단하고 실패 곡을 보고한다(수출 적용은 SPEC-003).
- **REQ-LYR-013** [NEW] (State-driven): While 수입 재실행 동안, 멱등 upsert로 동일 baseline을 산출하고 중복 행을 만들지 않는다.

### RM-C 레거시 처분·마이그레이션
- **REQ-LYR-020** [MODIFY] (Event-driven): When user 스키마 초기화 시, `saved_hymns_v3`+`schema_version`을 프로비저닝하는 전방·멱등·백업 선행 마이그레이션을 실행한다.
- **REQ-LYR-021** [MODIFY] (State-driven): While overlay 행이 15 ES 중복행이고 새 baseline이 내용 승계를 입증한 동안, 그 overlay 행을 폐기한다.
- **REQ-LYR-022** [NEW] (Ubiquitous): 7 순수 사용자 곡을 캐노니컬로 승격 후 무조건 보존한다(폐기 금지).
- **REQ-LYR-023** [REMOVE] (Ubiquitous, 부정형): origin/main 단방향 `_runOneTimeMigrations`를 적용하지 않으며, `app_meta`를 v3 역방향 키로 재설계한다.
- **REQ-LYR-024** [MODIFY] (Event-driven): When #204 수입 시 v2 정본(후렴 '아 멘' 없음)을 채택하고, `score-축복의 사람`/`축복의 사람` 중복은 셋리스트에서 참조되지 않는 사본을 폐기해 해소한다(참조 기준 = 셋리스트 항목 곡 참조 필드 `payload.songId`).

### RM-D 동기화 원장 기초
- **REQ-LYR-030** [NEW] (Ubiquitous): 곡 단위 원장 `(number, rev, contentHash)`를 결정적 콘텐츠 해시로 유지하고 수입 시 초기화한다(v2 rev/source_hash 불신, 재계산).
- **REQ-LYR-031** [NEW] (Optional): Where 원장이 존재하면 읽기 프리미티브 3종(`lookup(number)→(rev,contentHash)`, `computeContentHash(doc)`, `baseSnapshot(number)→(rev,contentHash)`)만 노출하고, 병합·수출은 수행하지 않는다(SPEC-003).

### RM-E 데이터 무결성 불변식
- **REQ-LYR-040** [EXISTING] (Ubiquitous): baseline은 read-only+`query_only=ON`으로 열리며 런타임에 baseline에 쓰지 않는다.
- **REQ-LYR-041** [NEW] (Unwanted): If KO 글리프 수 != 음표 수 시, then `GLYPH_NOTE_MISMATCH` 경고 후 잉여 음표를 마지막 음절에 흡수·보존한다(날조·거부 금지).
- **REQ-LYR-042** [MODIFY] (Ubiquitous): 모든 DB 스크립트는 Python sqlite3만 사용하고 편집 후 `PRAGMA wal_checkpoint(TRUNCATE)`를 실행한다.
- **REQ-LYR-043** [EXISTING] (Ubiquitous): 결함 마커(textOnly/orphanNotes/dangling/`_provenance.warnings`)를 보존하고 가사를 날조하지 않는다.

---

## 수용 시나리오 (GWT)

- **GWT-A1** Given v2 곡 / When 수입 후 `saved_hymns_v3` 재조회 / Then 음절 1급·`surface{ko,es,en}`·무손실 메타, v1과 별도 테이블 저장.
- **GWT-A2** Given `koJoinPrev` 보유 곡 / When 조회 / Then 큐레이션 필드·슬라이드 그룹·음절 ID 1급 유지.
- **GWT-A3** Given 190 "Hay u"(2단어 1슬롯) / When 조회 / Then `surface.es` N글자·`wbEs` KO 독립 기록.
- **GWT-B1** Given v2 DB(573) / When 수입 / Then 573곡 수입 + 슬라이드 백필 결번 0(573/2,330/7,433).
- **GWT-B2** Given 수입 완료 baseline / When 재실행 / Then 행수·해시 동일, 중복 0(멱등).
- **GWT-B3** Given ES 결함 주입 / When 수입 / Then 손상 미산출, 0이 아닌(비정상) 종료 코드로 중단 + 실패 곡 보고.
- **GWT-C1** Given 15 중복행 + baseline 승계 입증 / When 처분 / Then 15행 폐기·baseline에서 조회, 미입증 행 유지.
- **GWT-C2** Given 7 순수 사용자 곡 / When 마이그레이션 / Then 7곡 승격·보존, 폐기 0.
- **GWT-C3** Given #204 수입 / When 후렴 검사 / Then '아 멘' 슬라이드 없음(v2 정본).
- **GWT-C4** Given 중복쌍 + 셋리스트 참조 확인 / When 해소 / Then 미참조본 폐기, 셋리스트 무손상.
- **GWT-C5** Given 마이그레이션 완료 / When 재기동 / Then 무변경(멱등), 단방향 로직 미적용, `app_meta` v3 키만.
- **GWT-D1** Given 동일 콘텐츠 / When 해시 2회 계산 / Then `contentHash` 동일(v2 값 미의존).
- **GWT-D2** Given 573 원장 초기화 / When 실행 / Then 병합·수출 0(SPEC-003 이관).
- **GWT-E1** Given Python 편집 후 / When `wal_checkpoint(TRUNCATE)` / Then 미체크포인트 변경 0, DB 자립.
- **GWT-E2** Given baseline `query_only=ON` / When 쓰기 시도 / Then 거부, 쓰기는 overlay만.
- **GWT-E3** Given 글리프!=음표 줄 / When 수입 / Then `GLYPH_NOTE_MISMATCH` 경고 + 마지막 음절 흡수·보존, 결함 마커 유지.

**품질 게이트:** 커버리지 ≥85%, LSP 오류 0, GWT 16건 통과, 백필 결번 0·해시 재현·멱등 무변경·baseline read-only 위반 0·순수 7곡 보존·범위 산출물(UI/수출) 0.

---

## 파일 목록 (변경 대상)

### NEW
- `[S]/tools/import_v2_to_desktop.py` — v2 → 캐노니컬 수입 (Python sqlite3, mode=ro)
- `[S]/tools/backfill_slidegroups.py` — line-id 산술 슬라이드 백필
- `[S]/tools/init_sync_ledger.py` — (rev,contentHash) 원장 기초 초기화

### MODIFY
- `[S]/main/db.js` — `saved_hymns_v3` + `schema_version` + 전방/처분 마이그레이션 + 캐노니컬 조회
- `[S]/preload.cjs` — 캐노니컬 조회 IPC
- `[S]/main.js` — 캐노니컬 IPC 핸들러 등록
- `[S]/tools/nwc_to_hymns.py` — 낡은 헤더·죽은 코드·`pitchLabelVersion` 정리

### REMOVE
- `[S]/main/db.js` — origin/main 단방향 `_runOneTimeMigrations` 미승계

### DATA (Python sqlite3 + checkpoint)
- `[S]/data/scoresentation.db` — `saved_hymns_v3` 신설(read-only 유지)
- `[U]/scoresentation-user.db` — overlay 15 폐기/7 승격 + `app_meta` v3 (멱등·백업 선행)

---

## Exclusions (What NOT to Build)

- 뷰어·편집기 UI 없음 → SPEC-002
- 수출·병합 실행 없음(원장 기초만) → SPEC-003
- anchored 레이아웃 포팅 없음
- koscriber 백엔드 변경 없음
- 실시간 라이브 양방향 자동 동기화 없음(배치 원장만)
- v1→v2 재마이그레이션 없음
- 릴리스/publish 파이프라인 변경 없음
