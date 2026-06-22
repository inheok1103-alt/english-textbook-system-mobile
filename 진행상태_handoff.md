# 교재 시스템 — 진행 상태 핸드오프 (2026-06-20)

> 위치: `C:\Users\이인혁\Downloads\교재\`  ·  메인 앱: `index.html` (더블클릭 실행)
> 빌드: `cd tools && node build_app.js`

## 현재 완료 상태
- **교재 879종(영어 전용)** · 실표지 **865종** · 스킬 10종(듣기·말하기·독해·쓰기·문법·구문·어휘·파닉스·모의/기출·통합)
- 비영어(북트리거 인문/과학 115종) 제거 완료
- ELT 110종(옥스포드·케임브리지·피어슨·내셔널지오·e-future·A*List·컴퍼스·사람in 등) 병합
- 특목고 부교재 36종(민사고 원서·AP English·Norton·Vocabulary Workshop·Critical Reader 등) 병합
- 시리즈 폭파: 62시리즈 → +204권(권별 CEFR/단어수 코멘트, 실출판사) — Reading Future, Smart Reading, What's Reading, e-future Classic Readers, Vivid Reading 등
- 코멘트 enrich: **40종 적용 완료**(고유 "설명+이럴경우" 형식)
- 정렬(한글 가나다·영어 ABC), 케미(궁합) 2D+3D, 나이 라벨 제거

## 앱 기능 (index.html)
- **설계 모드**: 644+ DB(4대영역/난이도/상황/학년 탭+검색) → 3단계×4분기 파이프라인 배치
- **교재 추천**(독립 섹션): 현재 교재 선택 → 정답률 구간별(80%+심화/60%체화/40%↓보강) 추천. CEFR·케미·시리즈연계·4대영역밸런스·교육학이론(i+1/ZPD) 종합. "담기"→설계모드 전환 후 원하는 슬롯 탭
- **3D 인지 매핑**: y=난이도, 케미 색상 연결선, 병목 진동
- 어휘 자동 처방, 커리 공유/저장/불러오기, 실시간 대시보드(Apps Script 연동 시)

## ⏳ 남은 작업 (세션 한도 8:40pm KST 리셋 후 재개 — AI 워크플로 필요)

### 1. 교재별 심층 DB (최우선 — 사용자 핵심 요청)
교재마다: 난이도(근거)·요구수준(선행)·교재특징·목차·구성방식·교재의도·강점·같이하면좋을교재.
- 방식: deep-analysis 워크플로(영어 879종 pipeline, per-book 웹리서치 → book_profiles.json)
- 페어링("같이하면 좋을 교재")은 앱에서 레벨/CEFR/케미/4대영역으로 산출
- 앱에 **교재 상세 패널** 추가(클릭 시 전체 프로필)

### 2. 나머지 코멘트 enrich (~290종)
- enrich-remaining 워크플로 366개 중 ~40개만 성공(한도 초과). 나머지 재실행.
- 형식: "간단 설명 + 이럴 경우 이 교재" / 시리즈는 권별로 다르게.

### 3. 표지 중복 수정 — 부분완료 (2026-06-21)
- **완료**: 서로 무관한 책이 같은 회색 플레이스홀더를 공유하던 오류군 **59종 → 고유 SVG 타이틀카드** 전환(`tools/cards_for_placeholders.js`). 앱에 `makeCoverCard()` 추가(네트워크 불필요, 책마다 id시드 그라데이션+제목+출판사).
- **현재**: 실표지 806/879, SVG카드 73종. 남은 **단일시리즈 중복 73그룹(167종)** = 같은 시리즈 권별로 한 표지 공유(올바른 시리즈, 권만 부정확).
- **차단 이슈**: YES24가 대량요청으로 이 IP를 일시 throttle(검색어 무시·일반추천 반환, ORD_GOODS_OPT 0). 알라딘은 한글 ELT 교재 스코어링 신뢰불가(오매칭)로 폐기.
- **남은 처리(차단 해제 후)**: `tools/recollect_series_v2.js`(YES24, EUC-KR, 권번호 점수, 그룹내 goods중복 배제, 차단감지 백오프) 실행 → 167종 권별 실표지. 차단 전 라이브테스트에서 권별 정확매칭 확인(vol1→8727611, vol3→8637468).
- 대안: 167종도 SVG카드화하면 즉시 distinct+정확(단 실표지 손실).
- 점검: covers/ md5 해시 그룹핑(영어교재 한정).

## 파이프라인/하네스 (tools/)
- `build_app.js` ★ 빌드(DB→index.html, CEFR/Lexile 추출, 가나다/ABC 정렬)
- `expand_master.js` 누락보강+특목고+고난도어휘 / `add_elt.js` `add_special.js` 리서치 병합
- `explode_enrich.js` 시리즈 폭파 / `apply_comments.js` 코멘트 적용
- `clean_titles.js` 이상제목 정규화 / `collect_covers.js` 표지 수집(재개형, 교재/covers·data)
- `curriculum_backend.gs` 공유/집계 백엔드(삼육중 패턴)
- 리서치 산출: `data/_elt_research.json` `_special_research.json` `_enrich_research.json` `_enrich_remaining.json`

## 재개 우선순위
1) 표지 중복 수정(로컬, 지금도 가능) → 2) 나머지 코멘트 enrich(리셋 후) → 3) 교재별 심층 DB + 상세 패널(리셋 후)
