/* 비영어 교재 제거 — KOBIC NOPUBFILTER 수확으로 섞인 한글/일본어/중국어/프로그래밍 책 정리
   탐지: KDC 710/720/730/000 등 비영어 언어·총류 OR 카테고리 일본어/중국어/한글/프로그래밍
   보호: 영어 ELT 신호(영어/english/reading/phonics/grammar/longman/oxford 등) 있으면 제외(오탐 방지)
   사용: node tools/remove_noneng.js [--dry]
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

// 영어 학습 신호(라틴문자 또는 학습 키워드 또는 전공). 단 '영미문학/영미소설' 같은 '주제 분류'는 신호로 안 봄(번역서일 수 있음)
const ENG_LEARN = /영어|english|영문법|영작|영단어|영숙어|영어단어|문법|grammar|그래머|독해|리딩|reading|리더스|어휘|보카|voca|vocab|phonics|파닉스|듣기|listening|회화|speaking|쓰기|writing|구문|어법|토익|toeic|토플|toefl|텝스|teps|수능|모의고사|내신|서술형|매3영|천일문|미국교과서|reader|sight\s*word|사이트워드|cefr|편입|ielts|\bsat\b|gre|gmat|esl|efl|tesol|토셀|tosel|오픽|opic|지텔프|첨삭|해석|빈칸|어원|spelling|영검|longman|oxford|cambridge|pearson|bricks|scholastic/i;
const MAJOR = /영문학|영어학|언어학|영미문학|통번역|번역학|영어교육|응용언어학|linguistic|literature|phonetic|syntax|semantic|morpholog/i;
function isNonEnglish(b) {
  const t = (b.title || ""), cat = (b.kobicCategory || ""), kdc = (b.kdc || ""), s = t + " " + cat;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const engKw = ENG_LEARN.test(s), major = MAJOR.test(s);
  // 규칙1: 명시적 비영어 언어/분야 (영어 학습키워드 없을 때)
  const kn = (kdc.match(/\b(\d{3})\b/) || [])[1];
  if (!engKw && kn && /^(71|72|73|00|05|09)/.test(kn)) return true;  // 710한국어 720중국어 730일본어 000총류 등
  if (!engKw && /일본어|중국어|광둥어|불어|독일어|스페인어|러시아어|베트남어|아랍어|태국어|한글|한국어\s*학습|한자|한문|프로그래밍|컴퓨터|코딩|파이썬|자바|엑셀|VBA|일본어능력시험|JLPT|JPT|HSK|TOPIK|토픽/i.test(s)) return true;
  // 규칙2: KOBIC 책인데 영어 신호 0 (라틴<3 + 학습키워드無 + 전공無) → 비영어(KDC 840 오태깅 한국책·번역서 등)
  if (b.source === "KOBIC" && latin < 3 && !engKw && !major) return true;
  return false;
}

const eng = master.materials.filter((m) => m.domain === "영어");
const remove = eng.filter(isNonEnglish);
console.log(`비영어 제거 대상: ${remove.length}종`);
remove.forEach((b) => console.log("  -", b.materialUid, (b.title || "").slice(0, 44), "|", (b.kdc || "-").slice(0, 12), "|", (b.kobicCategory || "").slice(0, 20)));
if (DRY) { console.log("\n(dry — 미실행)"); return; }

const rm = new Set(remove.map((b) => b.materialUid));
master.materials = master.materials.filter((m) => !rm.has(m.materialUid));
rm.forEach((uid) => { try { fs.unlinkSync(path.join(COVERS, uid + ".jpg")); } catch (e) {} delete img[uid]; });
fs.writeFileSync(SRC, raw.replace(mm[0], `<script id="master-data" type="application/json">${JSON.stringify(master)}</script>`), "utf8");
fs.writeFileSync(IMG, JSON.stringify(imgData, null, 2), "utf8");
console.log(`\n완료 — 제거 ${rm.size}종 / 영어교재 ${master.materials.filter((m) => m.domain === "영어").length}종`);
