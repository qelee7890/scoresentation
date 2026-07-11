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

# SPEC-LYRICS-001 수용 기준 (acceptance.md)

Given-When-Then 시나리오. 각 요구 모듈당 최소 2건, 엣지 케이스 포함(총 16건). 모든 기준은 관찰 가능(테스트 출력·파일 존재·수치 임계)해야 한다. DB 조작·검증은 Python `sqlite3` read-only로 수행한다. 근거는 `research.md` 섹션·`spec.md` REQ로 추적한다.

---

## RM-A — 캐노니컬 doc 모델·스키마

### GWT-A1 (라운드트립, REQ-LYR-001·002·005)
- **Given** v2 코퍼스의 한 곡(예: 495번 '내 영혼이 은총 입어')이 있고,
- **When** 수입 후 `saved_hymns_v3`에서 그 곡의 캐노니컬 문서를 다시 읽으면,
- **Then** 각 음절이 `surface{ko,es,en}`와 자신의 `notes[]`를 소유하고(음절 1급), `tempo`/`newTitle`/`beamGroup`/`melisma`/`continuation`/`_provenance`가 무손실 보존되며, 문서는 v1 `saved_hymns`가 아닌 별도 `saved_hymns_v3`에 `schema_version`과 함께 저장돼 있다.

### GWT-A2 (큐레이션 필드 생존, REQ-LYR-004)
- **Given** `koJoinPrev`를 796줄 중 하나로 가진 곡이 수입돼 있고,
- **When** 그 곡을 조회하면,
- **Then** `koJoinPrev`/`koJoinNext`/`esJoinNext`·슬라이드 그룹(`slideIndex`/`slideBreaks[]`)·안정 음절 ID가 1급 필드로 그대로 존재한다(파생 재계산으로 소실되지 않음).

### GWT-A3 (외국어 N:1 결속, 엣지, REQ-LYR-003)
- **Given** 190번 1절 첫 줄의 한 음절이 ES 표면 "Hay u"(공백 포함 2단어)를 한 음표 슬롯에 쥐고 있고,
- **When** 캐노니컬 문서를 조회하면,
- **Then** 그 음절의 `surface.es`는 N글자를 보존하고 `wbEs`(start|mid|end|standalone)가 KO 경계와 독립으로 기록돼 있다.

---

## RM-B — v2→데스크톱 수입 파이프라인

### GWT-B1 (전량 수입 + 슬라이드 백필, REQ-LYR-010·011)
- **Given** `[M]/data/scoresentation_v2.db`(573곡, read-only)가 있고,
- **When** `import_v2_to_desktop.py`를 실행하면,
- **Then** baseline `saved_hymns_v3`에 573곡이 수입되고, 573곡/2,330섹션/7,433줄 전부에서 슬라이드 그룹 백필의 **결번이 0**이다(결정성 검증 통과).

### GWT-B2 (멱등 재실행, 엣지, REQ-LYR-013)
- **Given** 수입이 1회 완료된 baseline이 있고,
- **When** 동일 입력으로 수입을 재실행하면,
- **Then** 행 수·콘텐츠 해시가 이전과 동일하고 중복 행이 0이다(멱등 upsert).

### GWT-B3 (QC 게이트 실패 중단, 엣지, REQ-LYR-012)
- **Given** ES 곡 하나에 공백/음절-음표 불일치 결함을 주입했고,
- **When** 수입을 실행하면,
- **Then** 시스템은 손상 데이터를 산출하지 않고 **0이 아닌(비정상) 종료 코드로 중단**하며 실패 곡 번호를 보고한다.

---

## RM-C — 레거시 처분·마이그레이션

### GWT-C1 (overlay 마스킹 해소, 엣지, REQ-LYR-021)
- **Given** user overlay에 15개 ES 중복행이 있고 새 baseline이 동일 내용을 승계함이 입증된 상태에서,
- **When** 처분 마이그레이션을 실행하면,
- **Then** 15개 overlay 행이 폐기되고, 해당 number 조회는 이제 baseline(캐노니컬)에서 읽힌다(마스킹 해소). 승계 미입증 행은 폐기되지 않는다.

### GWT-C2 (순수 사용자 곡 보존, 엣지, REQ-LYR-022)
- **Given** 어느 baseline에도 없는 7개 순수 사용자 곡(꽃들도, 살아계신 주, 싹트네, 야곱의 축복, 은혜, 주님 계신 교회, 주의 이름 높이며)이 overlay에 있고,
- **When** 마이그레이션을 실행하면,
- **Then** 7곡 전부 캐노니컬 포맷으로 승격돼 보존되며 단 1곡도 폐기되지 않는다.

### GWT-C3 (#204 정본 선택, 엣지, REQ-LYR-024)
- **Given** #204를 수입하면,
- **When** 수입된 #204의 후렴 슬라이드를 검사하면,
- **Then** v2 정본을 따라 후렴 '아 멘' 단독 슬라이드가 **없다**.

### GWT-C4 (중복 곡 해소, REQ-LYR-024)
- **Given** `score-축복의 사람`/`축복의 사람` 두 행이 있고 셋리스트 `payload.songId` 참조를 전수 확인했고,
- **When** 중복 해소를 적용하면,
- **Then** 미참조본이 폐기되고 참조본은 유지되며, 어떤 셋리스트 항목도 깨지지 않는다.

### GWT-C5 (마이그레이션 멱등·app_meta v3, 엣지, REQ-LYR-020·023)
- **Given** 처분 마이그레이션이 1회 완료됐고,
- **When** 앱을 재기동해 user 스키마 초기화가 다시 돌면,
- **Then** 추가 변경이 없고(멱등), origin/main 단방향 정리 로직은 적용되지 않으며 `app_meta`에는 v3 역방향 키만 존재한다.

---

## RM-D — 동기화 원장 기초

### GWT-D1 (해시 안정성, 엣지, REQ-LYR-030)
- **Given** 동일 캐노니컬 콘텐츠의 곡이 있고,
- **When** 원장 콘텐츠 해시를 두 번(서로 다른 실행에서) 계산하면,
- **Then** 두 `contentHash`가 동일하다(결정성). v2 `rev`/`source_hash`에 의존하지 않고 재계산된 값이다.

### GWT-D2 (범위 경계 가드, REQ-LYR-031)
- **Given** 수입이 완료돼 573곡 원장 항목 `(number, rev, contentHash)`가 초기화됐고,
- **When** 본 SPEC 산출물을 실행하면,
- **Then** 원장은 읽기 프리미티브를 노출하되 **어떤 3-way 병합·koscriber 수출도 수행하지 않는다**(SPEC-003 이관).

---

## RM-E — 데이터 무결성 불변식

### GWT-E1 (WAL 체크포인트, 엣지, REQ-LYR-042)
- **Given** Python sqlite3로 `saved_hymns_v3`를 편집했고,
- **When** `PRAGMA wal_checkpoint(TRUNCATE)`를 실행한 뒤 파일 상태를 확인하면,
- **Then** `.db-wal` 미체크포인트 변경이 없고(패키징 `!*.db-wal` 필터로 유실 위험 제거) DB가 자립 상태다.

### GWT-E2 (baseline read-only, REQ-LYR-040)
- **Given** 런타임 앱이 baseline을 `query_only=ON`으로 열었고,
- **When** baseline에 쓰기를 시도하면,
- **Then** 쓰기가 거부되고 모든 런타임 쓰기는 user overlay에만 발생한다.

### GWT-E3 (글리프!=음표 보존, 엣지, REQ-LYR-041·043)
- **Given** KO 글리프 수가 음표 수와 불일치하는 미표기 멜리스마 줄이 있고,
- **When** 수입하면,
- **Then** `GLYPH_NOTE_MISMATCH` 경고가 기록되고 잉여 음표가 마지막 음절에 흡수·보존되며(거부·날조 없음), `_provenance.warnings`·textOnly·dangling 등 결함 마커가 유지된다.

---

## 품질 게이트 / Definition of Done

- **테스트 커버리지 ≥ 85%** (신규 도구·마이그레이션 로직 대상; characterization으로 §9.2 암묵적 계약 보호).
- **LSP/린트 오류 0** (변경 파일 대상).
- 위 GWT 16건 전부 통과.
- **결정성 검증:** 슬라이드 백필 결번 0(573/2,330/7,433), 원장 해시 재현.
- **멱등성 검증:** 수입·마이그레이션 재실행 시 무변경.
- **데이터 안전:** baseline read-only 위반 0, WAL 체크포인트 확인, 순수 사용자 7곡 보존 확인, Python-sqlite3-only 준수.
- **범위 가드:** 뷰어/편집기 UI·수출·병합 실행 산출물 0(SPEC-002/003 이관 확인).
