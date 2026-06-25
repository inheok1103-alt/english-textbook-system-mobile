/* 교재 시스템 빌드 하네스
   ../data 의 master-data(v0.9) + book_images.json 을 앱 스키마로 매핑하여
   app_base.html 의 토큰(__MASTER_DATA__/__TABS__)을 치환 → ../index.html 생성 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const SRC_HTML = path.join(DATA, "iinhyuk_english_book_guide_v0.9_expanded.html");
const IMG_JSON = path.join(DATA, "book_images.json");
const BASE = path.join(__dirname, "app_base.html");
const OUT = path.join(ROOT, "index.html");

const html = fs.readFileSync(SRC_HTML, "utf8");
const master = JSON.parse(html.match(/<script id="master-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const images = (JSON.parse(fs.readFileSync(IMG_JSON, "utf8")).images) || {};

// 스킬 정규화: 4대영역(+문법/구문/어휘/파닉스/모의기출)으로 수렴
const SKILL_MAP = {
  "인문사회/CLIL": "독해", "과학/CLIL": "독해", "역사/사회": "독해", "지리/문화": "독해",
  "경제/사회": "독해", "문학/스토리": "독해", "미디어/AI": "독해", "논술/토론": "독해",
  "종합": "독해", "글쓰기/문해력": "쓰기",
};
function normSkill(s) { return SKILL_MAP[s] || s || "독해"; }

function toLevel(t) {
  if (!t || !t.length) return 3;
  const mn = Math.min.apply(null, t), mx = Math.max.apply(null, t);
  return Math.max(1, Math.min(5, Math.round((mn + mx) / 2)));
}
function isMajor(m) { return normSkill(m.skill) === "전공" || m.grade === "대학" || (m.ageMin != null && m.ageMin >= 20); }
function gradeBand(m) {
  if (isMajor(m)) return "대학/전공";
  const a = m.ageMin;
  if (a == null) return "전체";
  if (a <= 7) return "유아/예비초";
  if (a <= 12) return "초등";
  if (a <= 15) return "중등";
  if (a <= 18) return "고등";
  return "성인";
}
// 책별 세분 나이대 (gradeBand + level 추정)
function ageBandOf(m) {
  const a = m.ageMin, lv = toLevel(m.tftNums);
  if (isMajor(m)) return "대학(20+)";
  if (a != null) {
    if (a <= 7) return "유아(5-7)";
    if (a <= 10) return "초등저(8-10)";
    if (a <= 13) return "초등고(11-13)";
    if (a <= 16) return "중등(13-16)";
    if (a <= 19) return "고등(16-19)";
    return "성인(19+)";
  }
  const gb = gradeBand(m);
  if (gb === "유아/예비초") return "유아(5-7)";
  if (gb === "초등") return lv <= 2 ? "초등저(8-10)" : "초등고(11-13)";
  if (gb === "중등") return "중등(13-16)";
  if (gb === "고등") return "고등(16-19)";
  if (gb === "성인") return "성인(19+)";
  return "전체";
}
function shortComment(pc) {
  if (!pc) return "";
  const i = pc.indexOf("교재. ");
  let s = i >= 0 ? pc.slice(i + 4) : pc;
  return s.length > 60 ? s.slice(0, 58) + "…" : s;
}
// CEFR 추출(코멘트에서)
function extractCefr(t) {
  const m = String(t || "").match(/\b(pre-?\s?a1|a1\+|a1|a2\+|a2|b1\+|b1|b2\+|b2|c1|c2)\b/i);
  if (!m) return "";
  return m[1].toUpperCase().replace(/\s/g, "").replace("PRE-A1", "PRE-A1").replace("PREA1", "PRE-A1");
}
// Lexile 추출
function extractLexile(t) {
  const m = String(t || "").match(/(\d{2,4})\s*L\b/i) || String(t || "").match(/lexile[^\d]*(\d{2,4})/i);
  return m ? Number(m[1]) : null;
}

const sitCount = {};
const weakCount = {};
const skillSet = new Set();
// 성인(시험/실용) 재분류 — 토익/토플/텝스/공무원/편입/비즈니스 등
function isAdultTitle(m) { return /토익|toeic|토플|toefl|텝스|teps|오픽|opic|아이엘츠|ielts|공무원|편입|비즈니스|business|gre|gmat|\bsat\b|성인/i.test((m.title || "") + " " + (m.kobicCategory || "")); }
function gradeBandAdj(m) { if (isMajor(m)) return "대학/전공"; return isAdultTitle(m) ? "성인" : gradeBand(m); }
function ageBandAdj(m) { if (isMajor(m)) return "대학(20+)"; return isAdultTitle(m) ? "성인(19+)" : ageBandOf(m); }
// 영어 교재만 — 비영어(북트리거 인문/과학/문학 등) domain 제외
const englishOnly = master.materials.filter((m) => m.domain === "영어");
const MASTER_DATA = englishOnly.map((m) => {
  const uid = m.materialUid;
  const info = images[uid] || {};
  const hasCover = !!info.localPath;
  const skill = normSkill(m.skill);
  skillSet.add(skill);
  (m.situations || []).forEach((s) => { sitCount[s] = (sitCount[s] || 0) + 1; });
  (m.weaknesses || []).forEach((s) => { weakCount[s] = (weakCount[s] || 0) + 1; });
  return {
    id: uid,
    pub: m.publisher || "",
    title: m.title || "",
    skill,
    level: toLevel(m.tftNums),
    tags: (m.situations || []).slice(0, 3).map((s) => "#" + s),
    situations: m.situations || [],
    weaknesses: m.weaknesses || [],
    cover: m.coverInline || (hasCover ? `covers/${uid}.jpg` : ""),
    age: m.ageLabel || "",
    comment: shortComment(m.pickComment),
    fullComment: m.pickComment || "",
    part: m.part || "",
    track: m.category || m.kobicCategory || "",   // 특목고 해외 부교재 / 고난도·시험 어휘 / KOBIC 분류
    gradeBand: gradeBandAdj(m),
    cefr: extractCefr(m.pickComment || ""),
    lexile: extractLexile(m.pickComment || ""),
    ageBand: ageBandAdj(m),                          // 세분 나이대
    status: m.status || "정상",                    // 정상 / 절판
    foreign: !!m.foreign,                           // 원서(수입 ELT) 여부
    isbn: m.isbn || "",
    kdc: m.kdc || "",
    pubDate: m.pubDate || "",
    source: m.source || "",
  };
});

// 스킬 탭: 핵심 순서 우선 + 나머지
const SKILL_ORDER = ["듣기", "말하기", "독해", "쓰기", "문법", "구문", "어휘", "파닉스", "모의/기출", "통합", "전공"];
const skills = Array.from(skillSet);
const orderedSkills = SKILL_ORDER.filter((s) => skillSet.has(s)).concat(skills.filter((s) => !SKILL_ORDER.includes(s)).sort());
const topSit = Object.entries(sitCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s]) => "#" + s);
const topWeak = Object.entries(weakCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s]) => "#" + s);

const TABS = {
  skill: ["전체"].concat(orderedSkills),
  level: ["전체", "1단계(입문)", "2단계(기초)", "3단계(기본)", "4단계(실력)", "5단계(실전)"],
  situation: ["전체"].concat(topSit),
  weakness: ["전체"].concat(topWeak),
  grade: ["전체", "유아/예비초", "초등", "중등", "고등", "성인", "대학/전공"],
  age: ["전체", "유아(5-7)", "초등저(8-10)", "초등고(11-13)", "중등(13-16)", "고등(16-19)", "성인(19+)", "대학(20+)"],
};

// 정렬: 한글 가나다 → 영어 ABC → 기타
MASTER_DATA.sort((a, b) => {
  const g = (t) => /^[가-힣]/.test(t) ? 0 : /^[A-Za-z]/.test(t) ? 1 : 2;
  const ga = g(a.title || ""), gb = g(b.title || "");
  if (ga !== gb) return ga - gb;
  return String(a.title || "").localeCompare(String(b.title || ""), ga === 0 ? "ko" : "en");
});

// 데이터는 외부 books.js로 분리 → index.html 경량화·모바일 캐시
const out = fs.readFileSync(BASE, "utf8");
fs.writeFileSync(path.join(ROOT, "books.js"), `window.__BOOKS__=${JSON.stringify(MASTER_DATA)};\nwindow.__TABS__=${JSON.stringify(TABS)};\n`, "utf8");
// 목차(toc)는 용량 절반 이상 → 별도 toc.js(지연 로딩)로 분리해 첫 로딩 가속
const tocMap = {};
englishOnly.forEach((m) => { if (m.toc) tocMap[m.materialUid] = m.toc; });
fs.writeFileSync(path.join(ROOT, "toc.js"), `window.__TOC__=${JSON.stringify(tocMap)};\n`, "utf8");
fs.writeFileSync(OUT, out, "utf8");

// 참고용 데이터 산출
fs.writeFileSync(path.join(DATA, "materials_app.json"), JSON.stringify(MASTER_DATA, null, 1), "utf8");

const withCover = MASTER_DATA.filter((b) => b.cover).length;
console.log(`생성: ${OUT}`);
console.log(`교재 ${MASTER_DATA.length}종 / 실표지 ${withCover}종 / 스킬 ${orderedSkills.length}종`);
console.log(`스킬: ${orderedSkills.join(", ")}`);
