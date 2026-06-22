/*
  이인혁 영어 교재선택가이드 — 중앙 집계 설정
  1. Google Sheets > Apps Script에 curriculum_backend.gs를 붙여넣고 웹 앱으로 배포
  2. 배포된 /exec URL을 아래 따옴표 안에 넣기
  3. 비워 두면 커리 구성/공유는 되지만 결과는 각 기기(localStorage)에만 저장(중앙 집계/대시보드 비활성)
*/
window.GUIDE_ENDPOINT = "";              // 예: "https://script.google.com/macros/s/AKfy.../exec"
window.GUIDE_DASHBOARD_POLL_MS = 30000;  // 임베드 대시보드 자동 새로고침 주기(ms)
