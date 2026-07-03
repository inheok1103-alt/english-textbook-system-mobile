/* 불필요 컨텐츠 정리 — 학습교재가 아닌 고확신 잡것만 제거(보수적)
   ① 구식 오디오(카세트/테이프) ② 비도서 굿즈(달력/스티커/포스터/색칠/모형) ③ 2000년 이전 구판
   보호: 노트·워크북·문제집·플래시카드·사전 등 학습물, CLASSICS(고전원서), 제목에 영어 학습신호 강한 것.
   사용: node tools/remove_junk.js [--dry]
*/
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "iinhyuk_english_book_guide_v0.9_expanded.html");
const IMG = path.join(ROOT, "data", "book_images.json");
const COVERS = path.join(ROOT, "covers");
const DRY = process.argv.includes("--dry");

const raw = fs.readFileSync(SRC, "utf8");
const mm = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const master = JSON.parse(mm[1]);
const imgData = JSON.parse(fs.readFileSync(IMG, "utf8"));
const img = imgData.images || {};

// 알라딘 판매상태 캐시(ISBN 키) — '절판'은 못 사는 책이라 카탈로그에서 제거(품절은 일시적이라 보존)
let OOP = {};
try {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "aladin_enrich.json"), "utf8"));
  const items = en.items || en;
  Object.keys(items).forEach((k) => { if (items[k] && items[k].status === "절판") OOP[k] = 1; });
} catch (e) {}

const yearOf = (m) => +(String(m.pubDate || "").match(/(19|20)\d\d/) || [])[0] || 0;
const OBSOLETE_AUDIO = /카세트|cassette|테이프\s*\d|테이프로\s*영어|tape\s*\d\s*개|오디오\s*테이프/i;
const GOODS = /(^|\s)달력|스티커(?!\s*북)|포스터|색칠공부|색칠놀이|\b모형\b|데스크\s*매트|책받침|북마크\s*세트/;
// 시험용 교재(수능·모의·기출)는 시효성이 생명 — 매년 개정판이 나오고 제도도 바뀜(A/B형 2014 폐지).
// 6년 지난 판은 제거(롤링 기준 — 2026년 실행 시 2020년 이하). "수능완성 B형(2013)" 노출 사고 방지.
const EXAM = /수능|모의고사|기출|학력평가|평가원|수능완성|수능특강/i;
const EXAM_KEEP_YEARS = 6;
function isJunk(b) {
  if (b.source === "CLASSICS") return false;          // 고전원서 보호
  const t = b.title || "", y = yearOf(b);
  // 학습물 보호 신호(있으면 제거 안 함)
  const learn = /문제집|워크북|workbook|사전|단어장|독해|문법|grammar|reading|phonics|파닉스|어휘|구문|듣기\s*모의|수능|내신|교과서|writing|영작|회화|speaking/i.test(t);
  if (OBSOLETE_AUDIO.test(t)) return "구식오디오(카세트/테이프)";
  if (GOODS.test(t) && !learn) return "비도서굿즈";
  if (y && y < 2000) return "2000년이전구판(" + y + ")";
  if (EXAM.test(t)) {
    const cutoff = new Date().getFullYear() - EXAM_KEEP_YEARS;
    if (y && y <= cutoff) return "구판시험서(" + y + ")";
    // 제목의 'YYYY학년도' — 재출간(pubDate 최신)돼도 내용이 그 해 시험이면 구판(학년도 표기는 +1 앞서감)
    const ty = +(t.match(/((?:19|20)\d{2})\s*학년도/) || [])[1] || 0;
    if (ty && ty <= cutoff + 1) return "구판시험서(제목 " + ty + "학년도)";
  }
  if (b.isbn && OOP[String(b.isbn)]) return "절판";
  return false;
}

const eng = master.materials.filter((m) => m.domain === "영어");
const hits = eng.map((b) => [b, isJunk(b)]).filter(([, r]) => r);
const byReason = {};
hits.forEach(([b, r]) => { const k = r.replace(/\(.*\)/, ""); (byReason[k] = byReason[k] || []).push(b); });
console.log(`불필요 컨텐츠 제거 대상: ${hits.length}종`);
Object.entries(byReason).forEach(([k, arr]) => console.log(`  · ${k}: ${arr.length}종`));
console.log("\n예시:");
hits.slice(0, 18).forEach(([b, r]) => console.log("  -", r, "|", (b.title || "").slice(0, 44)));
if (DRY) { console.log("\n(dry — 미실행)"); return; }

const rm = new Set(hits.map(([b]) => b.materialUid));
master.materials = master.materials.filter((m) => !rm.has(m.materialUid));
rm.forEach((uid) => { try { fs.unlinkSync(path.join(COVERS, uid + ".jpg")); } catch (e) {} delete img[uid]; });
fs.writeFileSync(SRC, raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(master)}</script>`), "utf8");
fs.writeFileSync(IMG, JSON.stringify(imgData, null, 2), "utf8");
console.log(`\n완료 — 제거 ${rm.size}종 / 남은 영어교재 ${master.materials.filter((m) => m.domain === "영어").length}종`);
