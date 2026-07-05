/* 소뇌(小腦) — 정제·검수·균형(운동조절/QA)
   소뇌가 움직임을 매끄럽게 다듬고 균형을 잡듯, 카탈로그를 정제·검수해
   어긋남(비영어·정크·중복·표지 불일치)을 교정하고 데이터 균형을 유지한다. */
const { runSteps } = require("../lib");

module.exports = {
  id: "cerebellum", ko: "소뇌", role: "정제·검수·균형(비영어·정크·중복·표지·감사)",
  steps: [
    { id: "noneng", ko: "비영어 교재 제거", tier: "routine", cmd: "node tools/remove_noneng.js" },
    { id: "junk", ko: "불필요 컨텐츠 제거(구식오디오·2000이전·굿즈)", tier: "routine", cmd: "node tools/remove_junk.js" },
    { id: "dedup", ko: "중복·구버전 정리(최신판만)", tier: "routine", cmd: "node tools/dedup_latest.js --apply" },
    { id: "classify", ko: "학년×학교×수준×과목 정밀 분류", tier: "routine", cmd: "node tools/classify_books.js" },
    { id: "audit", ko: "카탈로그 감사(자기점검 리포트)", tier: "routine", cmd: "node tools/audit.js" },
    // 표지 정합검수는 네트워크 검사라 느림(~수분) → 매 사이클이 아니라 deep(하루 1회)로.
    { id: "verify-covers", ko: "책↔표지 정합 검수+자동교정", tier: "deep", cmd: "node tools/verify_covers.js --fix", env: { VERIFY_LIMIT: "600" } },
    // 심층 정제(깊은/수동) — 제목 정제·스텁 제거·중복 표지·최종 정리
    { id: "clean-titles", ko: "제목 정제", tier: "deep", cmd: "node tools/clean_titles.js" },
    { id: "legacy-stubs", ko: "레거시 스텁 제거", tier: "deep", cmd: "node tools/remove_legacy_stubs.js" },
    { id: "fix-dup-covers", ko: "중복 표지 교정", tier: "deep", cmd: "node tools/fix_dup_covers.js" },
    { id: "cleanup-final", ko: "최종 정리", tier: "manual", cmd: "node tools/cleanup_final.js" },
  ],
  async run(ctx) { return { steps: await runSteps(ctx, this, this.steps) }; },
};
