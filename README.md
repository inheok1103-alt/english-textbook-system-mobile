# 이인혁 영어교재 시스템 (English Textbook Curriculum & Ranking)

초·중·고·성인 영어교재 **커리큘럼 설계 + 교재 데이터베이스 + 실시간 랭킹** 통합 시스템.
정적 `index.html`(모바일/PC) + Google Apps Script 백엔드 + GitHub Pages/Actions로 동작.

## 구성
- `index.html` — 메인 앱(빌드 산출물). 설계모드·교재추천·3D 인지매핑·랭킹 대시보드.
- `covers/` — 교재 표지(IH-ENG-XXXX.jpg).
- `data/iinhyuk_english_book_guide_v0.9_expanded.html` — 마스터 데이터(`<script id="master-data">`).
- `data/book_images.json` — 표지 매핑.
- `tools/` — 빌드·수집 파이프라인(아래).

## 빌드 (로컬)
```bash
cd tools && node build_app.js     # master-data + 표지 → ../index.html
```

## 데이터 파이프라인 (tools/)
| 스크립트 | 역할 |
|---|---|
| `build_app.js` | 마스터데이터→index.html (CEFR/Lexile 추출, 가나다/ABC 정렬, 절판/목차 전달) |
| `harvest_kobic.js` | KOBIC 영어교재 후보 발굴(키워드×출판사) |
| `harvest_kobic_merge.js` | 상세보강·병합(표지/목차/분류/절판 pjul_yn) |
| `collect_covers.js` | YES24 표지 수집(재개형) |
| `recollect_kyobo.js` | 교보 권별 표지 재수집(게이트) |
| `cards_for_placeholders.js` | 오매칭 표지 → 고유 SVG 타이틀카드 |
| `export_master_index.js` | 랭킹 매칭용 색인(isbn/titleNorm→uid) |
| `backend_unified.gs` | GAS 백엔드(커리집계+정보나루+YES24 랭킹) |

## 배포
### 1) GitHub Pages (호스팅·공유)
- repo Settings → Pages → Source: **GitHub Actions**.
- `index.html`이 `https://<id>.github.io/<repo>/`로 공개 → file:// 제약 없이 GAS와 JSONP 통신.

### 2) Google Apps Script (백엔드)
1. 구글시트 새 파일 → 확장 > Apps Script → `tools/backend_unified.gs` 붙여넣기.
2. `DATA4LIB_KEY`에 [정보나루](https://www.data4library.kr) 인증키 입력.
3. `setupAll()` 1회 실행(시트·트리거 생성). `export_master_index.js` 산출 CSV를 `master_index` 시트에 붙여넣기.
4. 배포 > 웹앱(실행: 나 / 액세스: 모든 사용자) → `/exec` URL을 앱 설정에 입력.

### 3) GitHub Actions (자동 갱신)
- `.github/workflows/refresh-catalog.yml` — 매일 03:00 KST KOBIC 신간·표지 갱신 → 재빌드 → 커밋 → Pages 배포. (당신 PC 불필요)

## 랭킹 소스 (feasibility)
- **앱 자체**(커리 채택) — JSONP 직접, 실시간.
- **정보나루 대출** — 공식 OpenAPI, 약관 안전(월 단위).
- **YES24 판매** — SSR HTML 파싱(GAS), 준실시간.
- 교보/알라딘/영풍 — CORS·약관 제약, GAS 프록시·조건부.
