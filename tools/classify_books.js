/* 🧩 교재 정밀 분류 하네스 — 학년 × 학교 × 수준 × 과목 축을 정확히 부여.
   목적: "전체"로 뭉뚱그려진 34%(성인 회화·작문·어린이 트레이드북 등)를 정밀 재분류해
   추천이 "고등에 초등/성인일반 교재" 같은 조악함을 내지 않게 한다.
   신호 우선순위: ①제목 강신호 → ②카테고리 루트(참고서=학교학년 / 외국어=성인 / 어린이=초등) → ③레벨.
   각 교재에 gradeForced(정밀 학년대) · gradeMin/Max(서수 0~4 범위) · schoolType · audience 부여.
   사용: node tools/classify_books.js [--dry]
   ※ build_app이 이 필드들을 우선 사용. pipeline/brain에 통합해 상시 유지.
*/
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "iinhyuk_english_book_guide_v0.9_expanded.html");
const DRY = process.argv.includes("--dry");

const raw = fs.readFileSync(SRC, "utf8");
const mm = raw.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/);
const master = JSON.parse(mm[1]);

// 학년 서수: 유아0 · 초1 · 중2 · 고3 · 성인4
const ORD = { "유아/예비초": 0, "초등": 1, "중등": 2, "고등": 3, "성인": 4, "대학/전공": 4 };
const BAND = ["유아/예비초", "초등", "중등", "고등", "성인"];

// 학교유형: 수능·내신·특목·검정고시·일반
function schoolOf(t) {
  if (/수능|모의고사|모평|학력평가|평가원|정시|EBS\s*수능/i.test(t)) return "수능";
  if (/특목|자사고|영재|경시|올림피아드|외고|국제고|toefl\s*junior|토플\s*주니어/i.test(t)) return "특목/영재";
  if (/내신|중간고사|기말고사|학교시험|수행평가/.test(t)) return "내신";
  if (/검정고시/.test(t)) return "검정고시";
  if (/토익|toeic|토플|toefl|텝스|teps|오픽|opic|공무원|편입|비즈니스|business/i.test(t)) return "성인시험";
  return "";
}

// 정밀 학년대 판정 → {band, min, max, conf}
function classify(b) {
  const title = b.title || "";
  const cat = (b.category || "") + " " + (b.kobicCategory || "") + " " + (b.series || "");
  const t = title + " " + cat;

  // ① 제목·시리즈 강신호 (가장 신뢰)
  if (/유아|유치원|유치부|누리과정|3~7세|4~7세|영유아/.test(title)) return band("유아/예비초", 0, 0, 3);
  if (/예비\s*초/.test(title)) return band("유아/예비초", 0, 1, 3);
  if (/예비\s*중|초6.*중1|초등\s*고학년\s*중등/.test(title)) return band("중등", 1, 2, 3);
  if (/예비\s*고|중3.*고1/.test(title)) return band("고등", 2, 3, 3);
  if (/고\s*[123]\b|고1|고2|고3|고등|고교|수능|모의고사|모평|학력평가/.test(title)) return band("고등", 3, 3, 3);
  if (/중\s*[123]학년|중1|중2|중3|중학|중등/.test(title)) return band("중등", 2, 2, 3);
  if (/초\s*[1-6]학년|초등|초등학교/.test(title)) return band("초등", 1, 1, 3);
  if (/토익|toeic|토플|toefl|텝스|teps|오픽|opic|아이엘츠|ielts|지텔프|공무원|편입|비즈니스|business|\bgre\b|\bgmat\b|성인|어학연수|워홀|이민/i.test(title)) return band("성인", 4, 4, 3);

  // ② 카테고리 루트 (참고서=학교 / 어린이=초등 / 유아 / 외국어·인문=성인)
  if (/초등학교참고서|초등참고서|초등영어|초등\s*>/.test(cat)) return band("초등", 1, 1, 2);
  if (/중학교참고서|중등참고서|중학영어|중등영어|중학교\s*>/.test(cat)) return band("중등", 2, 2, 2);
  if (/고등학교참고서|고등영어|고교영어|고등학교\s*>/.test(cat)) return band("고등", 3, 3, 2);
  if (/유아|누리|영유아/.test(cat)) return band("유아/예비초", 0, 0, 2);
  if (/어린이|아동/.test(cat)) return band("초등", 1, 1, 2);   // 어린이 트레이드북(학습만화·동화)
  // 외국어(성인 일반)·인문·자기계발 트리 → 성인 일반
  if (/외국어|인문|자기계발|여행|가정\/살림|자녀교육|성인|비즈니스/.test(cat)) return band("성인", 4, 4, 2);

  // ③ 기존 gradeBand가 이미 구체적이면 유지
  const cur = b.gradeBand || (typeof gradeBandOf === "function" ? "" : "");
  if (cur && cur !== "전체" && ORD[cur] != null) return band(cur, ORD[cur], ORD[cur], 1);

  // ④ 원서(영문 제목)·미상 → 학년 무관(전 학년), 저신뢰
  return band("전체", 1, 4, 0);   // min초~max성인(광범위) — 특정 학년 추천에선 감점되도록
}
function band(b, min, max, conf) { return { band: b, min, max, conf }; }

let changed = 0; const dist = {};
for (const m of master.materials) {
  if (m.domain !== "영어") continue;
  const c = classify(m);
  const school = schoolOf((m.title || "") + " " + (m.kobicCategory || ""));
  const prev = m.gradeForced;
  m.gradeForced = c.band;
  m.gradeMin = c.min; m.gradeMax = c.max; m.gradeConf = c.conf;
  if (school) m.schoolType = school;
  // 성인/일반(외국어 트리)인데 학생용으로 새지 않게 audience 힌트
  m.adultGeneral = (c.band === "성인" && c.conf >= 2 && !/토익|toeic|토플|toefl|텝스|공무원|편입|임용/i.test((m.title || "") + (m.kobicCategory || ""))) ? 1 : 0;
  if (prev !== c.band) changed++;
  dist[c.band] = (dist[c.band] || 0) + 1;
}
console.log("분류 완료 — 영어 " + master.materials.filter(m => m.domain === "영어").length + "종 · 변경 " + changed);
console.log("정밀 학년대 분포:", JSON.stringify(dist));
const low = master.materials.filter(m => m.domain === "영어" && m.gradeConf === 0).length;
console.log("저신뢰(전체·미상): " + low + "종");
if (DRY) { console.log("\n(dry — 미저장)"); return; }
fs.writeFileSync(SRC, raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(master)}</script>`), "utf8");
console.log("✅ 저장 — build_app이 gradeForced/gradeMin/Max를 사용");
