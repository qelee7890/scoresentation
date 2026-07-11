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

# SPEC-LYRICS-002 수용 기준 (acceptance.md)

Given-When-Then 시나리오(총 29건). 각 요구 모듈 ≥2건, 엣지 케이스 포함, REQ 31건 전수 트레이스(고아 GWT 0). 모든 기준은 관찰 가능(테스트 출력·DOM 요소·수치 임계). UI 시각 정합은 순수 함수 검증 + Electron 스모크 + 수동 확인으로 분할(테스트 전략 참조). 근거는 `SPEC-LYRICS-001/research.md` §·`spec.md` REQ.

---

## RM-A — 이중 가사 렌더러 코어

### GWT-A1 (pitch 좌표 parity, REQ-LYR2-003·004)
- **Given** 알려진 곡(1장 '만복의 근원', Ab)의 v3 doc이 있고,
- **When** 신규 렌더러(`notes-canonical`)로 음표 y좌표를 계산하면,
- **Then** 각 음표가 골든 true-position(오선 F5/D5/B4/G4/E4 기준, post-`782b1eb` 보정 맵)과 일치하며, 데스크톱 앵커(−0.5) 상수 혼입 시 parity 회귀 테스트가 실패한다.

### GWT-A2 (빔 렌더, REQ-LYR2-002)
- **Given** `beamGroup`을 보유한 v3 곡이 있고,
- **When** 렌더하면,
- **Then** 빔 폴리곤이 렌더된다(모바일 원본에는 없던 렌더; 16분음표 이중 빔 포함).

### GWT-A3 (부분 번역 우아 렌더, 엣지, REQ-LYR2-005)
- **Given** 일부 음절에만 `surface.es`가 있고 나머지는 `es=null`인 doc이 있고,
- **When** 뷰어가 렌더하면,
- **Then** ES 단어 런 내부의 `es=null` 음절은 앞 ES 음절에 멜리스마(`-`) 병합되고, ES 문맥 없는 음절은 ES 레인에 글리프 없이 KO만 표시되며, 크래시·가사 날조가 없다.

### GWT-A4 (렌더러 코어 포팅 동작, REQ-LYR2-001)
- **Given** 멜리스마 음절(notes.length>1)·continuation 음절(`ko:""`)·한 단어(word-block) 여러 음절을 포함한 v3 doc이 있고,
- **When** `canonical-render`가 레이아웃 모델을 산출하면,
- **Then** 멜리스마는 첫 셀=가사·이후 셀=늘임표(`-`)로, continuation은 앞 줄 이월 음표로, word-block은 내부 개행 없는 단일 묶음으로 배치되고, `effSyllables`/`wbEs` 그룹이 언어별로 산출된다.

### GWT-A5 (혼합 빔 당김음·Scotch snap, REQ-LYR2-006)
- **Given** 빔 그룹이 `[8.(dotted-8th), 16]`(당김음) 및 `[16, 8.]`(Scotch snap)인 v3 곡이 있고,
- **When** 신규 렌더러가 빔을 새기면,
- **Then** 그룹 전체에 공통 primary 빔 1개가 그려지고, 16분 멤버 위에 secondary **partial stub**이 그려지며 **stub이 그 8.(빔 이웃) 방향을 가리킨다**(`[8.,16]`은 stub이 왼쪽, `[16,8.]`은 stub이 오른쪽).

### GWT-A6 (혼합 빔 일반 8-16-16, REQ-LYR2-006)
- **Given** 빔 그룹이 `[8, 16, 16]`인 v3 곡이 있고,
- **When** 렌더하면,
- **Then** 공통 primary 빔 1개 + 두 16분(2·3번째) 사이에 **연속 secondary 빔**이 그려지고, **2번째 음(16분)의 좌측 경계(8분과 인접)에는 stub이 그려지지 않는다**(연속 빔 우선 규칙).

---

## RM-B — 프레젠테이션 통합

### GWT-B1 (dispatch 회귀, REQ-LYR2-010·011)
- **Given** v3 doc 보유 곡과 v1 전용 곡이 각각 있고,
- **When** 프레젠테이션이 슬라이드를 빌드하면,
- **Then** v3 곡은 신규 렌더러 경로로, v1 곡은 **기존 v1 경로가 바이트 동일 DOM 동작**으로 렌더된다(v1 회귀 0).

### GWT-B2 (슬라이드 그룹, REQ-LYR2-013)
- **Given** `slideIndex`/`slideBreaks`를 가진 v3 곡이 있고,
- **When** 렌더하면,
- **Then** 슬라이드 페이지가 그 그룹 경계와 일치하게 구성된다.

### GWT-B3 (저장 리빌드, REQ-LYR2-012)
- **Given** 프레젠테이션이 표시 중이고,
- **When** `hymn-saved` 브로드캐스트를 수신하면,
- **Then** 해당 곡 슬라이드가 재빌드되고 현재 인덱스가 유지된다.

### GWT-B4 (nav/줌/테마 parity, REQ-LYR2-014)
- **Given** v3 슬라이드가 표시 중이고,
- **When** 사용자가 줌(±)·테마 토글·절 매크로 키(1~9절, 0 후렴)를 조작하면,
- **Then** v3 슬라이드가 v1 슬라이드와 동등하게 폰트 배율 재적용·다크 테마 전환·해당 절/후렴 첫 슬라이드 점프로 반응한다.

---

## RM-C — 단일 편집기 v3 통합 + 저장 계약

### GWT-C1 (save-canonical 원장, REQ-LYR2-022)
- **Given** 캐노니컬 편집 모드에서 doc을 수정했고,
- **When** 저장하면,
- **Then** `saved_hymns_v3` overlay가 upsert되고, `sync_ledger`의 rev가 단조 증가하며 `contentHash=computeContentHash(doc)`로 갱신되고, `hymn-saved`가 브로드캐스트된다.

### GWT-C2 (editor.js 비대화 가드, 엣지, REQ-LYR2-021)
- **Given** v3 편집 로직이 구현됐고,
- **When** `git diff --stat`로 `editor.js` 순증가 줄수를 측정하면,
- **Then** 순증가 ≤ **+150줄**이고, v3 실질 로직(캐노니컬 렌더·게이트·분절·변환)은 전부 `editor-canonical.js`/`editor-syllabify.js`/`editor-gates.js`/`v1-to-canonical.js` 신규 모듈에 존재한다.

### GWT-C3 (편집기 dispatch, REQ-LYR2-020·023)
- **Given** v3 곡과 v1 전용 곡이 있고,
- **When** 각각 편집 진입하면,
- **Then** v3 곡은 같은 편집기 페이지 안에서 캐노니컬 모드로, v1 곡은 기존 편집기 동작(무변경)으로 열린다.

### GWT-C4 (승격 후 라우팅 드리프트 차단, 엣지, REQ-LYR2-024)
- **Given** 승격되어 v3 doc이 존재하는 곡이 있고,
- **When** 사용자가 그 곡을 다시 편집 진입하면,
- **Then** 편집기는 캐노니컬 모드로만 라우팅하고 레거시 v1 편집 모드로 열지 않는다.

---

## RM-D — 음절 편집 + v1→v3 승격/변환 + 신곡 authoring

### GWT-D1 (신곡 v3 authoring, REQ-LYR2-035)
- **Given** 사용자가 title/meta와 가사 문장을 입력했고,
- **When** 신곡을 생성하면,
- **Then** 산출된 v3 doc이 `validateDoc`를 통과하고 KO 글리프==음표수 게이트를 만족한다.

### GWT-D2 (`~`/`‿` 정규화, 엣지, REQ-LYR2-032)
- **Given** ES 입력에 "que‿en"·"re~ci"가 있고,
- **When** 입력이 정규화되면,
- **Then** `‿`는 공백(synalepha)으로, `~`는 결합(제거)으로 변환되어 정규화된 per-syllable surface로 저장된다.

### GWT-D3 (3중 게이트 게이트별 동작, 엣지, REQ-LYR2-033)
- **Given** ① KO 글리프!=음표수, ② 정본 보유 곡의 ES 재조립 불일치, ③ 공백 wbEs 그룹 불일치 상태를 각각 만들고,
- **When** 저장을 시도하면,
- **Then** ①은 저장 **차단(hard block)**, ② 정본 有 곡은 **차단**·정본 無 곡은 **경고(soft)**, ③은 **경고(soft, 저장 허용)**로 처리되며, hard block 게이트에서는 손상 doc이 산출되지 않는다.

### GWT-D4 (koJoin* 보존, 엣지, REQ-LYR2-034)
- **Given** `koJoinPrev`를 가진 줄을 라인 교체 저장하고,
- **When** 저장 후 doc을 조회하면,
- **Then** `koJoinPrev`가 보존 병합으로 유지된다.

### GWT-D5 (v1→v3 승격 라운드트립, REQ-LYR2-036)
- **Given** v1 전용 곡(hymn_json, korean[]/notes)이 있고,
- **When** 사용자가 승격을 트리거하면,
- **Then** 변환된 v3 doc이 `validateDoc`를 통과하고 KO 글리프==음표수를 만족하며, **슬라이드 경계가 원본 v1 doc의 `korean[]` 슬라이드와 정확히 동일**하다(3-소스 백필 미사용).

### GWT-D6 (7 legacyV1 승격, REQ-LYR2-037)
- **Given** legacyV1 wrap(`_provenance.legacyV1`, `sections:[]`)인 순수 사용자 곡이 있고,
- **When** 승격하면,
- **Then** 동일 변환 엔진이 legacyV1 payload에 적용되어 진짜 캐노니컬 doc이 산출되고 원본 payload가 보존된다.

### GWT-D7 (음절 자동분절 + 수동 보정, REQ-LYR2-030)
- **Given** 사용자가 한 줄의 가사 문장을 입력해 자동분절 결과가 표시됐고,
- **When** 사용자가 한 음절 경계를 수동으로 옮기면(분절 보정),
- **Then** doc의 음절 배열이 보정된 분할을 반영하고(음절 수·surface.ko 갱신), 결속된 음표는 안정 음절 ID를 따라 유지된다.

### GWT-D8 (1:N 음표 부착 + EN 트랙, REQ-LYR2-031)
- **Given** 한 음절이 선택돼 있고,
- **When** 사용자가 음표 2개를 그 음절에 부착하고 EN 가사를 입력하면,
- **Then** 그 음절의 `notes.length==2`(1:N)로 저장되고, EN 텍스트는 `surface.en`이 아니라 섹션의 `altLanguages.en` 트랙에 저장된다.

### GWT-D9 (혼합 빔 그룹 지정 적격 — 캐노니컬 모드 한정, REQ-LYR2-039)
- **Given** **v3 doc 곡의 캐노니컬 편집 모드에서** `[8., 16]`(당김음)·`[16, 8.]`(Scotch snap)·`[8, 16, 16]` 후보 음표열이 있고,
- **When** 사용자가 각각을 하나의 빔 그룹으로 지정하면,
- **Then** 편집기가 세 조합 모두 허용하고 동일 `beamGroup` int id를 부여하며(dotted-16th 포함 시도는 거부), 데이터 모델은 변경되지 않는다. **v1 전용 곡의 레거시 편집기는 균일-8/16-only 규약을 그대로 유지(혼합 시도 거부, 무변경)한다.**

### GWT-D10 (신곡 v3 전용, 엣지, REQ-LYR2-038)
- **Given** 사용자가 "빈 악보" 모달로 신곡을 생성하고,
- **When** 저장 후 저장소를 검사하면,
- **Then** v3 캐노니컬 doc만 산출되고 v1 `hymn_json` 행은 생성되지 않으며(기존 v1 곡은 무영향), 신규 곡은 v3이므로 v1→v3 승격 대상에 포함되지 않는다.

---

## RM-E — 렌더/편집 불변식·테스트 계약

### GWT-E1 (순수 함수 검증, REQ-LYR2-041)
- **Given** 레이아웃·자동분절·게이트·원장·변환 로직이 순수 모듈로 분리됐고,
- **When** node:test를 실행하면,
- **Then** DOM 없이 결정적으로 통과하며 순수 모듈 커버리지 ≥85%이다.

### GWT-E2 (baseline read-only, REQ-LYR2-040)
- **Given** 런타임 앱이 baseline을 `query_only=ON`으로 열었고,
- **When** 편집·승격·신곡을 저장하면,
- **Then** baseline은 미변경이고 쓰기는 user overlay(`saved_hymns_v3`/`sync_ledger`)에만 발생한다.

### GWT-E3 (변환 parity 골든벡터, 엣지, REQ-LYR2-042)
- **Given** **명시된 대표 곡 집합**(1장 Ab / 46장 단어 내 멜리스마 / 3장 continuation / 190 ES / **364장 아멘**)의 공유 골든벡터가 있고,
- **When** `v1-to-canonical`(JS)과 `migrate_to_v2`(Python) 산출을 대조하면,
- **Then** 이 대표 집합 전부에서 `canonicalStringify` 직렬화가 **완전 일치**한다(개인 사용자 곡은 Python 소스 부재로 대상 제외 — validateDoc+글리프 게이트로만 검증).

### GWT-E4 (승격 롤백, 엣지, REQ-LYR2-044)
- **Given** 승격되어 v3 overlay와 v1 원본 행이 공존하는 곡이 있고,
- **When** v3 overlay 행을 삭제(롤백)하면,
- **Then** 읽기가 v1 dispatch로 복귀하고 v1 원본 행은 무변경 상태이다.

### GWT-E5 (스키마 무변경 범위 가드, REQ-LYR2-043)
- **Given** 뷰어·편집기·승격 산출물이 있고,
- **When** 산출 doc과 M1 모듈을 검사하면,
- **Then** 모든 doc의 `schemaVersion`이 3으로 유지되고 `canonical-doc.js` 스키마·마이그레이션 산출물이 추가되지 않는다(소비만).

---

## 품질 게이트 / Definition of Done

- **순수 모듈 커버리지 ≥ 85%**(canonical-render·editor-syllabify·editor-gates·v1-to-canonical·save-canonical 원장 로직); LSP/린트 오류 0.
- GWT 29건 전부 통과(REQ 31건 전수 트레이스, 고아 GWT 0).
- **좌표 parity 통과**(신규 렌더러 골든 true-position); **변환 parity 통과**(대표 곡 집합에서 v1→v3 JS==Python 완전 일치, REQ-042).
- **혼합 빔 새김 통과**(당김음 8.+16/16+8. stub 방향, 8-16-16 연속 secondary; REQ-006).
- **v1 무변경 회귀**(dual-read: v1 렌더/편집 바이트 동일); **슬라이드 경계 동일성**(승격 곡 = v1 korean[] 슬라이드, REQ-036).
- **editor.js 비대화 가드: `git diff --stat` 순증가 ≤ +150줄**(REQ-021); v3 로직 신규 모듈 격리.
- **데이터 안전:** baseline read-only 위반 0(REQ-040·043 schemaVersion 3 유지); 저장 overlay만; 승격 시 v1 원본 보존·롤백 가능; 원장 rev 단조 증가.
- **범위 가드:** 수출·병합 실행 산출물 0(SPEC-003); koscriber/mobile 원본·캐노니컬 스키마 변경 0(REQ-043).
