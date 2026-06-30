# 무료 API 키 설정 (선택) — 인기·가격·표지·절판 자동 채우기

크론(`refresh-catalog.yml`)이 매일/매주 무료 API로 **판매지수(인기)·가격·표지·절판상태**를 받아 `books.js`에 구워 넣습니다.
키가 **없어도** 동작합니다(원서 표지는 키리스 Open Library/Google Books로 자동 보강). 아래 키를 넣으면 국내 교재까지 풀로 채워집니다.

## GitHub Secrets 등록 위치
저장소 → **Settings → Secrets and variables → Actions → New repository secret**

| Secret 이름 | 어디서 발급 | 주는 것 | 비고 |
|---|---|---|---|
| `ALADIN_TTBKEY` | aladin.co.kr → `ttb/wblog_manage.aspx` (블로그/사이트 URL 등록 후 익일~1·2일) | **판매지수(인기순)·가격·고해상 표지·절판/품절** | 최우선. 일 5,000회 한도 → 크론이 슬라이스 순환 |
| `KAKAO_REST_KEY` | developers.kakao.com → 앱 생성 → REST API 키(즉시) | 가격·표지·상태 **폴백**(알라딘 결손분) | 즉시 발급 |
| `GOOGLE_BOOKS_KEY` | console.cloud.google.com → Books API 사용설정 → API 키(즉시, 카드 불요) | 원서 표지/설명 안정화 | 선택(키리스로도 동작) |
| `SEOJI_CERT_KEY` | nl.go.kr/seoji → 인증키(사서 승인, 시일 소요) | 권위 서지·정가 | 선택(미구현, 추후) |
| `NAVER_ID` / `NAVER_SECRET` | developers.naver.com (책 카테고리 현행 확인 후) | 표지·가격 최후 폴백 | 선택(미구현) |

## 동작 방식
- `tools/enrich_aladin.js` / `enrich_kakao.js` / `enrich_foreign.js` 가 ISBN별로 호출 → `data/*_enrich.json` 캐시.
- `build_app.js` 가 캐시를 머지: `price`(가격)·`salesPoint`/`pop`(인기)·`cover`(표지)·`status`(절판/품절).
- UI: 추천 카드에 가격(₩)·🆕신간·절판 배지, 장바구니에 **예상 합계**, '인기순' 정렬에 판매지수 반영.
- 키 없는 스크립트는 **그냥 건너뜀**(에러 아님).

## 제외(무료 아님/중단)
인터파크(중단) · Lexile/AR(유료) · ISBNdb(유료) · 11번가(셀러용) — 원서 난이도(Lexile/AR/CEFR)는 수기 큐레이션으로 관리.
