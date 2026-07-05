#!/usr/bin/env node
/* ============================================================================
   교재 시스템 — 전체 파이프라인 하네스
   수확(harvest) → 정제(clean) → 보강(enrich) → 검수(verify) → 색인(index) → 빌드(build)
   를 정해진 순서로 한 번에 실행. 단계별 로깅·타이밍·에러처리·최종 요약.

   사용:
     node tools/pipeline.js                 # 전체 실행
     node tools/pipeline.js --quick         # 정제+빌드만(수확·보강·검수 생략, 빠른 재빌드)
     node tools/pipeline.js --build-only     # 빌드만
     node tools/pipeline.js --only=enrich,build
     node tools/pipeline.js --skip=harvest
     node tools/pipeline.js --dry            # 실행계획만 출력
     node tools/pipeline.js --pages=20       # 수확 깊이(KOBIC_MAXPAGES)
   환경변수(있으면 보강 자동 활성): ALADIN_TTBKEY, KAKAO_REST_KEY, GOOGLE_BOOKS_KEY
   ============================================================================ */
const { execSync } = require("child_process");
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (k, d) => { const a = args.find((x) => x.startsWith("--" + k + "=")); return a ? a.split("=").slice(1).join("=") : d; };
const DRY = has("--dry"), QUICK = has("--quick"), BUILD_ONLY = has("--build-only");
const ONLY = (val("only", "")).split(",").filter(Boolean);
const SKIP = (val("skip", "")).split(",").filter(Boolean);
const PAGES = val("pages", "8");

const MAJOR_TERMS = "영어학개론|영어학|영문학개론|영문학사|영미문학|영미소설|영미시|언어학개론|일반언어학|응용언어학|영어음성학|영어음운론|영어통사론|영어의미론|영어화용론|사회언어학|심리언어학|영어교육론|영어교수법|제2언어습득|통번역|번역학|영어사|코퍼스언어학|담화분석|TESOL|English Linguistics|English Literature";
const FOREIGN_TERMS = "Bricks Reading|Bricks Listening|Bricks Phonics|Subject Link|Smart Phonics|Sounds Great|Build and Grow|Reading Town|Reading Star|Insight Link|Reading Sketch|My First Reading|My Next Reading|Phonics Monster|Reading Champion|Reading Future|Oxford Reading Tree|Reading Explorer|Time Zones|Our World|Wonderful World|Spotlight on English";

// 단계 정의 — group(부분실행 단위) · optional(실패해도 계속) · env
const STAGES = [
  { key: "harvest-main",   group: "harvest", label: "KOBIC 학습교재 신간 발굴", cmd: "node tools/harvest_kobic.js", env: { KOBIC_MAXPAGES: PAGES } },
  { key: "merge-main",     group: "harvest", label: "학습교재 병합(기존 ISBN 건너뜀)", cmd: "node tools/harvest_kobic_merge.js" },
  { key: "harvest-major",  group: "harvest", label: "전공 교재 발굴(대학·영어학/영문학/언어학)", cmd: "node tools/harvest_kobic.js", env: { KOBIC_NOPUBFILTER: "1", KOBIC_MAXPAGES: "5", KOBIC_TERMS: MAJOR_TERMS } },
  { key: "merge-major",    group: "harvest", label: "전공 병합", cmd: "node tools/harvest_kobic_merge.js" },
  { key: "harvest-foreign",group: "harvest", label: "원서 발굴(수입 ELT 시리즈)", cmd: "node tools/harvest_kobic.js", env: { KOBIC_NOPUBFILTER: "1", KOBIC_MAXPAGES: "6", KOBIC_TERMS: FOREIGN_TERMS } },
  { key: "merge-foreign",  group: "harvest", label: "원서 병합(foreign 태깅)", cmd: "node tools/harvest_kobic_merge.js" },

  { key: "harvest-aladin", group: "harvest", label: "🛒 알라딘 영어교재 전수 수확(참고서·시험서·시리즈 — KOBIC 누락 보완)", cmd: "node tools/harvest_aladin.js", env: { }, optional: true },
  { key: "merge-aladin",   group: "harvest", label: "알라딘 수확 병합·정리(영역·학년·레벨 자동부여, 기존 ISBN 건너뜀)", cmd: "node tools/merge_aladin_catalog.js", optional: true },

  { key: "clean-noneng",   group: "clean",   label: "비영어 교재 제거", cmd: "node tools/remove_noneng.js", optional: true },
  { key: "clean-junk",     group: "clean",   label: "불필요 컨텐츠 제거(구식오디오·2000이전·굿즈)", cmd: "node tools/remove_junk.js", optional: true },
  { key: "clean-dedup",    group: "clean",   label: "중복·구버전 정리(최신판만 보존)", cmd: "node tools/dedup_latest.js --apply", optional: true },
  { key: "classify",       group: "clean",   label: "🧩 학년×학교×수준×과목 정밀 분류(gradeForced·성인일반 분리)", cmd: "node tools/classify_books.js", optional: true },

  { key: "enrich-foreign", group: "enrich",  label: "원서 표지·메타 보강(OpenLibrary/GoogleBooks·키 불필요)", cmd: "node tools/enrich_foreign.js", env: { ENRICH_LIMIT: val("enrich-limit", "150") }, optional: true },
  { key: "enrich-aladin",  group: "enrich",  label: "알라딘 보강(인기·가격·표지·절판)", cmd: "node tools/enrich_aladin.js", env: { ENRICH_LIMIT: val("aladin-limit", "1500") }, optional: true },
  { key: "enrich-kakao",   group: "enrich",  label: "카카오 보강(가격·표지 폴백)", cmd: "node tools/enrich_kakao.js", env: { ENRICH_LIMIT: val("kakao-limit", "3000") }, optional: true },

  { key: "verify-covers",  group: "verify",  label: "책↔표지 정합검수+자동교정(ISBN 앵커)", cmd: "node tools/verify_covers.js --fix", env: { VERIFY_LIMIT: val("verify-limit", "600") }, optional: true },

  { key: "index",          group: "index",   label: "랭킹 매칭 색인 갱신(master_index.csv)", cmd: "node tools/export_master_index.js", optional: true },

  { key: "build",          group: "build",   label: "앱 빌드(books.js·index.html 생성)", cmd: "node tools/build_app.js" },

  { key: "rankings",       group: "rankings", label: "판매 인기 랭킹 생성(rankings.json·알라딘 판매지수)", cmd: "node tools/harvest_rankings.js", optional: true },
];

function wanted(s) {
  if (BUILD_ONLY) return s.group === "build";
  if (QUICK) return s.group === "clean" || s.group === "build" || s.group === "rankings";
  if (ONLY.length) return ONLY.includes(s.group) || ONLY.includes(s.key);
  if (SKIP.length && (SKIP.includes(s.group) || SKIP.includes(s.key))) return false;
  return true;
}

const plan = STAGES.filter(wanted);
const fmt = (ms) => (ms / 1000).toFixed(1) + "s";
function bar(t) { return "\n" + "─".repeat(64) + "\n" + t + "\n" + "─".repeat(64); }

console.log(bar("📦 교재 파이프라인 — " + plan.length + "단계 " + (DRY ? "(DRY 계획)" : "실행")));
console.log("키: 알라딘 " + (process.env.ALADIN_TTBKEY ? "○" : "×") + " · 카카오 " + (process.env.KAKAO_REST_KEY ? "○" : "×") + " · 구글 " + (process.env.GOOGLE_BOOKS_KEY ? "○" : "×"));
plan.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. [${s.group}] ${s.label}${s.optional ? "  (optional)" : ""}`));
if (DRY) { console.log("\n(dry — 미실행)"); process.exit(0); }

const results = [];
const t0 = Date.now();
for (const s of plan) {
  const st = Date.now();
  process.stdout.write(bar(`▶ [${s.group}] ${s.label}`) + "\n");
  try {
    execSync(s.cmd, { cwd: ROOT, stdio: "inherit", env: Object.assign({}, process.env, s.env || {}) });
    results.push({ s, ok: true, ms: Date.now() - st });
    console.log(`✅ ${s.label} — ${fmt(Date.now() - st)}`);
  } catch (e) {
    results.push({ s, ok: false, ms: Date.now() - st });
    if (s.optional) { console.log(`⚠ ${s.label} 실패(건너뜀) — ${String(e.message).split("\n")[0]}`); }
    else { console.error(`❌ ${s.label} 실패 — 중단`); console.error(String(e.message).split("\n")[0]); summarize(true); process.exit(1); }
  }
}
summarize(false);

function summarize(aborted) {
  console.log(bar("📊 파이프라인 요약 — 총 " + fmt(Date.now() - t0)));
  results.forEach((r) => console.log(`  ${r.ok ? "✅" : "⚠"} ${r.s.label.slice(0, 44).padEnd(44)} ${fmt(r.ms)}`));
  try {
    const src = fs.readFileSync(path.join(ROOT, "books.js"), "utf8");
    const M = JSON.parse(src.match(/window\.__BOOKS__=(\[[\s\S]*?\]);\s*\nwindow\.__TABS__/)[1]);
    const pct = (n) => (100 * n / M.length).toFixed(0) + "%";
    const exam = M.filter((b) => b.examPrep).length, par = M.filter((b) => b.parentBook).length, te = M.filter((b) => b.teacherRef).length;
    console.log("\n  카탈로그 " + M.length + "종");
    console.log("  · 오디언스 — 학생용 " + (M.length - exam - par - te) + " / 학부모용 " + par + " / 임용 " + exam + " / 교사이론서(제외) " + te);
    console.log("  · 표지 " + pct(M.filter((b) => b.cover).length) + " / 가격 " + pct(M.filter((b) => b.price).length) + " / 판매지수 " + M.filter((b) => b.pop > 0).length + "종 / 절판·품절 " + M.filter((b) => b.status !== "정상").length + "종 / 원서 " + M.filter((b) => b.foreign).length + "종");
  } catch (e) { console.log("  (books.js 통계 생략)"); }
  if (!aborted) console.log("\n🎉 파이프라인 완료. (배포는 git add/commit/push 또는 크론이 수행)");
}
