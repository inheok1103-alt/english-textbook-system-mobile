# 이인혁 인지 기반 교재 커리큘럼 시스템 — 하네스

> 인지 과정 & 4대영역 밸런스로 영어 교재 커리큘럼을 설계하고, 3D 인지 매핑으로 적합/부적합을
> 직관 진단하며, 공유·집계까지 하는 단일 시스템. (Codex→Claude 인계 후 통합 구축)

## 1. 폴더 구조

```
교재/
  index.html                 ← 메인 앱(빌드 산출물). 더블클릭으로 실행
  README_하네스.md            ← 이 문서
  covers/                    ← 실제 교재 표지 638장 (covers/IH-ENG-XXXX.jpg)
  data/
    iinhyuk_english_book_guide_v0.9_expanded.html  ← 교재 DB 원천(master-data 644종)
    book_images.json         ← 표지 수집 결과(uid→경로/상태/출처)
    book_image_manifest.csv  ← 644종 표지 상태표(검수용)
    materials_app.json       ← 앱 스키마로 변환된 644종(참고)
    특목고_해외부교재.csv/.md  ← 특목고 해외 부교재 별도 정리
  tools/                     ← 하네스(파이프라인 스크립트)
    app_base.html            ← 앱 템플릿(데이터 토큰 __MASTER_DATA__/__TABS__)
    build_app.js             ← ★ 빌드: DB+표지 → index.html
    expand_master.js         ← 교재 DB 확장(누락보강+특목고+고난도어휘+나이/코멘트/파트)
    collect_covers.js        ← YES24 표지 수집기(재개형)
    curriculum_backend.gs    ← 공유/집계 백엔드(Google Apps Script)
    guide_config.js          ← 중앙 서버 /exec URL 설정(참고)
```

## 2. 데이터 파이프라인

```
[원천 커리큘럼 md] → expand_master.js → v0.9_expanded.html(master-data 644종, enrich)
                                            │
                  collect_covers.js ────────┤→ book_images.json + covers/*.jpg
                                            │
                         build_app.js ──────┘→ index.html (앱에 실데이터 주입)
```

### 재빌드(데이터/표지 바뀐 뒤)
```powershell
cd "C:\Users\이인혁\Downloads\교재\tools"
node build_app.js
```

### 표지 더 수집(신간/누락 보충) — 재개형, 이미 받은 건 skip
```powershell
node collect_covers.js "..\data\iinhyuk_english_book_guide_v0.9_expanded.html"
# 끝나면 covers/ 를 교재\covers 로 갱신 후 node build_app.js
```

### 교재 추가/보강
`tools/expand_master.js` 의 ADD/SPECIAL/VOCAB_HARD 배열에 항목을 넣고 재생성 → 표지수집 → 빌드.

## 3. 앱 기능 (index.html)

- **설계 모드(2D)**: 좌측 644종 DB(4대영역/난이도/상황·약점/학년·나이 탭 + 검색),
  우측 3단계×4분기 파이프라인. 클릭(모바일) 또는 드래그로 배치.
- **카드 정보**: 실표지 · 나이(만 N세) · 한줄 코멘트 · 스킬 · 난이도(Lv) · 트랙(특목고/고난도) 배지.
- **AI 인지흐름 추천**: 마지막 배치 영역에 따라 다음 영역 제안(문법→구문→독해→쓰기…),
  8권↑이면 모의/기출 권장.
- **진단**: 난이도 급상승(과부하)/역행/동일단계 영역중복(병목) 실시간 표시.
- **3D 인지 매핑**: y축=난이도, 단계=x, 분기=z. 흐름선 색(빨강=급상승/주황=역행),
  병목 노드 진동. 마우스/터치 360° 회전.
- **어휘 자동 처방**: 배치된 커리 평균 레벨에 맞춰 어휘 교재 추천 → 빈 분기 자동 배치.
- **공유/저장/불러오기**: 커리 JSON 저장·복원, 중앙 서버로 공유(POST).
- **실시간 대시보드**: 인기 교재/커리 집계(일·주·월·년 버킷). 서버 미설정 시 로컬 미리보기.

## 4. 공유·집계 서버(선택) — 삼육중 패턴

1. Google Sheets → 확장 > Apps Script에 `tools/curriculum_backend.gs` 붙여넣기
2. 배포 > 새 배포 > 웹앱 (실행: 나 / 액세스: 모든 사용자) → `/exec` URL 복사
3. `index.html` 상단 `window.GUIDE_ENDPOINT = ""` 에 URL 입력(또는 `guide_config.js` 사용)
4. 배포: Netlify Drop(app.netlify.com/drop)에 `교재` 폴더 통째로 드래그
   → 모바일/PC 어디서나 접속, 공유 데이터가 대시보드에 실시간 집계

집계 항목: 인기 교재 랭킹 · 학년/목표/나이대별 인기 · 4대영역 분포 · 기간 추이 · 동시선택 교재.

## 5. 남은 작업(로드맵)

- [ ] 코멘트를 **검색 자료 요약**으로 고도화(현재 메타기반 자동 코멘트)
- [ ] not_found/저점수 표지 6종 보충·검수
- [ ] 신간 알림(Apps Script 시간 트리거 또는 /schedule 루틴)
- [ ] 3D 매핑에 4대영역 밸런스 게이지/빈영역 경고 추가
- [ ] 학년·나이 프리셋 커리(추천 템플릿)
